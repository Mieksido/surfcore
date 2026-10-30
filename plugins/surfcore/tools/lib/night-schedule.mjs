/**
 * 生物钟的「一天排程」纯逻辑（2026-10-23 用户选 C）。
 *
 * C 的含义：
 *   · 每个有次数的窗口**至少 1 次**（保证覆盖）；
 *   · 全天总次数 ≤ maxWakes（默认 12）；
 *   · 多出来的次数按「该时段最近的内容评分」分给质量更高的窗口；
 *   · 相邻两次苏醒至少隔 minGapMin 分钟（默认 20）；
 *   · skip 只是这个 slot 的「轻醒」，不结束全天；
 *   · 超过窗口 end 的 slot 记为 missed，不补醒。
 *
 * 这个文件只做纯计算，方便单测；whale-night.mjs 负责读写状态和叫醒。
 */
import { withConfiguredTimeZone } from './clock.mjs'


export const DEFAULT_MIN_GAP_MIN = 20

export function hhmmToMin(value) {
  const [h, m] = String(value ?? '').split(':').map(Number)
  return (h === 24 ? 1440 : (Number(h) || 0) * 60) + (Number(m) || 0)
}

export function minToHHMM(min) {
  const n = ((Math.round(Number(min) || 0) % 1440) + 1440) % 1440
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
}

/** 把配置窗口收敛成 [start,end) 分钟；end <= start 视为跨午夜，end += 1440。 */
export function normalizeNightWindows(windows = []) {
  const list = Array.isArray(windows) && windows.length
    ? windows
    : [{ start: '20:00', end: '24:00', wakes: 1 }]
  const toMin = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : hhmmToMin(v))
  return list.map((w) => {
    const start = toMin(w.start)
    let end = toMin(w.end)
    if (end <= start) end += 1440
    const label = w.label ?? `${minToHHMM(start)}–${minToHHMM(end)}`
    return {
      start,
      end,
      wrap: end > 1440,
      label,
      wakes: Math.max(0, Math.floor(Number(w.wakes ?? 1) || 0)),
    }
  }).filter((w) => w.end > w.start)
}

/** 某个分钟是否落在窗口内（支持跨午夜）。 */
export function windowContains(w, min) {
  const m = Number(min)
  if (!w) return false
  if (w.wrap) return m >= w.start || m < w.end - 1440
  return m >= w.start && m < w.end
}

/**
 * 按最近 N 天的评分，算每个窗口的平均内容质量。
 * 没有评分的窗口不返回（调用方按 0 处理）。
 * @param {Record<string, Array<{at?:string, score?:number}>>} scores
 */
export function qualityByWindow(scores = {}, windows = [], { now = Date.now(), days = 30 } = {}) {
  const cutoff = Number(now) - Math.max(1, Number(days) || 30) * 86_400_000
  const acc = new Map()
  for (const rows of Object.values(scores ?? {})) {
    if (!Array.isArray(rows)) continue
    for (const row of rows) {
      const at = new Date(row?.at ?? 0).getTime()
      const score = Number(row?.score)
      if (!Number.isFinite(at) || at < cutoff || !Number.isFinite(score)) continue
      const minute = withConfiguredTimeZone(() => { const d = new Date(at); return d.getHours() * 60 + d.getMinutes() })
      const w = windows.find((x) => windowContains(x, minute))
      if (!w) continue
      const cur = acc.get(w.label) ?? { sum: 0, count: 0 }
      cur.sum += score
      cur.count += 1
      acc.set(w.label, cur)
    }
  }
  const out = {}
  for (const [label, { sum, count }] of acc) out[label] = count ? sum / count : 0
  return out
}

/**
 * 生成一天 slots。
 * @param {object} opts
 * @param {Array} opts.windows 配置窗口
 * @param {number} opts.maxWakes 全天硬上限（C 默认 12）
 * @param {number} opts.minGapMin 相邻两次苏醒最小间隔（默认 20）
 * @param {number} opts.skipChance “轻醒”概率
 * @param {number} opts.nowMin 当前本地分钟（0~1439）
 * @param {Record<string,number>} opts.quality 每个窗口的历史质量
 * @param {() => number} opts.random
 */
export function buildNightSchedule({
  windows = [],
  maxWakes = 12,
  minGapMin = DEFAULT_MIN_GAP_MIN,
  skipChance = 0.3,
  nowMin = 0,
  quality = {},
  random = Math.random,
} = {}) {
  const wins = normalizeNightWindows(windows)
  const warnings = []
  const cap = Math.max(0, Math.min(12, Math.floor(Number(maxWakes) || 0)))
  const gap = Math.max(0, Math.floor(Number(minGapMin) || 0))
  const now = Number(nowMin) || 0
  const enabled = wins.filter((w) => w.wakes > 0)
  // 已经结束的窗口今天不补；只给还没结束的窗口排（跨午夜窗口保持开放）。
  const open = enabled.filter((w) => (w.wrap ? true : w.end > now))
  if (enabled.length > open.length) {
    warnings.push(`有 ${enabled.length - open.length} 个窗口今天已经结束，不再补醒`)
  }

  // C：先保证每个窗口 1 次；如果窗口数 > cap，只能覆盖前 cap 个，明确警告。
  const baseWins = open.slice(0, cap)
  if (open.length > cap) {
    warnings.push(`窗口数 ${open.length} > 全天上限 ${cap}，无法每窗至少 1 次；只覆盖前 ${cap} 个窗口`)
  }
  const counts = new Map(baseWins.map((w) => [w.label, 1]))
  let remaining = Math.max(0, cap - baseWins.length)

  // 多出来的次数按质量分给容量还够的窗口；质量相同优先晚时段（prime time）。
  const order = [...baseWins].sort((a, b) => {
    const qa = Number(quality[a.label] ?? 0)
    const qb = Number(quality[b.label] ?? 0)
    if (qb !== qa) return qb - qa
    return b.start - a.start
  })
  while (remaining > 0) {
    let picked = false
    for (const w of order) {
      if (remaining <= 0) break
      if ((counts.get(w.label) ?? 0) >= w.wakes) continue
      // 质量优先：同一个高质量窗口先吃满，再轮到下一个。
      while (remaining > 0 && (counts.get(w.label) ?? 0) < w.wakes) {
        counts.set(w.label, (counts.get(w.label) ?? 0) + 1)
        remaining -= 1
      }
      picked = true
    }
    if (!picked) break
  }
  if (remaining > 0) warnings.push(`还有 ${remaining} 个额外名额没有任何窗口容量可放`)

  const slots = []
  let lastAt = -Infinity
  let id = 0
  const sorted = [...baseWins].sort((a, b) => a.start - b.start)
  for (const w of sorted) {
    const count = counts.get(w.label) ?? 0
    if (!count) continue
    const span = Math.max(1, w.end - w.start)
    const seg = Math.max(1, span / Math.max(1, count))
    for (let i = 0; i < count; i += 1) {
      const desired = w.start + i * seg + random() * seg
      let at = Math.max(w.start, desired)
      if (Number.isFinite(lastAt)) at = Math.max(at, lastAt + gap)
      // 已经过了窗口：这个窗口今天不补（C 的“不补醒”）
      if (w.end <= now) continue
      // 现在已在窗口内但点已经过去：现在就叫醒（晚到但在窗口内）
      if (at < now && now < w.end) at = now + 1
      // 放不下：base 必须保；extra 丢掉；两者都记 warning
      if (at >= w.end) {
        if (i === 0) {
          const fallback = Math.max(w.start, Math.min(w.end - 1, Number.isFinite(lastAt) ? lastAt + gap : w.start))
          at = fallback
          if (Number.isFinite(lastAt) && at < lastAt + gap) {
            warnings.push(`${w.label} 的保底 slot 放不下 ${gap} 分钟间隔，已压缩到 ${minToHHMM(at)}`)
          }
        } else {
          warnings.push(`${w.label} 的第 ${i + 1} 次和前面的间隔冲突，已跳过（C 只保每窗至少 1 次）`)
          continue
        }
      }
      if (at < now && now < w.end) at = now + 1
      const skip = random() < Number(skipChance ?? 0.3)
      slots.push({
        id: `s${id += 1}`,
        window: w.label,
        start: w.start,
        end: w.end,
        at,
        atText: minToHHMM(at),
        kind: i === 0 ? 'base' : 'extra',
        index: i,
        action: skip ? 'skip' : 'wake',
        status: 'pending',
        gapMin: gap,
      })
      lastAt = Math.max(lastAt, at)
    }
  }
  slots.sort((a, b) => a.at - b.at)

  if (slots.length < baseWins.length) {
    warnings.push(`本应至少 ${baseWins.length} 次，实际排了 ${slots.length} 次（时间/间隔冲突）`)
  }
  return {
    slots,
    warnings,
    cap,
    minGapMin: gap,
    baseCount: baseWins.length,
    extraCount: Math.max(0, slots.length - baseWins.length),
  }
}

/** 取下一个 pending slot；过期 slot 标 missed；窗口内已过点的改成“现在叫醒”。 */
export function nextPendingSlot(schedule, nowMin) {
  const now = Number(nowMin) || 0
  for (const slot of schedule?.slots ?? []) {
    if (slot.status !== 'pending') continue
    if (Number(slot.end) <= now) {
      slot.status = 'missed'
      slot.missedAt = now
      continue
    }
    if (Number(slot.at) < now && now < Number(slot.end)) {
      slot.at = now + 1
      slot.atText = minToHHMM(slot.at)
      slot.late = true
    }
    if (Number(slot.at) >= Number(slot.end)) {
      slot.status = 'missed'
      slot.missedAt = now
      continue
    }
    return slot
  }
  return null
}

export function markScheduleSlot(schedule, id, status, nowMin = Date.now()) {
  const slot = (schedule?.slots ?? []).find((x) => x.id === id)
  if (!slot) return null
  slot.status = status
  if (status === 'fired' || status === 'skipped') slot.doneAt = nowMin
  if (status === 'missed') slot.missedAt = nowMin
  return slot
}
