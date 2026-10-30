// 四类动态的定义（2026-10-21 管理员定；2026-10-22 改成可配置）
//
// 每类**一天一条**，各有默认发布时段和固定开头（前缀默认必须原样出现在正文最前面）：
//   08:00 一类「推荐评分最高的视频」→ 【哦花哇哇哟！早晨视频递上~】
//   12:00 二类「六款游戏的 AI 二创」  → 【午mer！hao看的二创】
//   16:00 三类「动漫」                → 【角色……也算二次元嘛？】
//   20:00 四类「游戏区视频」          → 【打电动时间dao】
//
// 时段规则：从该类的点开始，到**下一类启用的点**为止（默认 08–12 / 12–16 / 16–20 / 20–24）。
//   错过就等明天 —— 不后补（凌晨补发"早晨视频"很怪 ✗）
//
// 2026-10-22：开关/时段/长度/前缀移到 bili.config.json 的 `dynamics` 段，
//   设置页「四类动态」可编辑；本文件只保留默认值和收敛逻辑。
//   质量门槛（近 N 天/播放/点赞率）仍在 daily.mjs 里，故意不开放——
//   那是"选题质量"，不是"发不发"。
import { config } from './config.mjs'
import { withConfiguredTimeZone } from './clock.mjs'

export const CATCHUP_DAY = '2026-10-21'

export const DEFAULT_KINDS = {
  best: {
    n: 1, label: '最高分视频', slot: 8, prefix: '【哦花哇哇哟！早晨视频递上~】',
    minLen: 50, maxLen: 100, enabled: true,
  },
  game: {
    n: 2, label: '游戏 AI 二创', slot: 12, prefix: '【午mer！hao看的二创】',
    minLen: 60, maxLen: 200, enabled: true,
  },
  anime: {
    n: 3, label: '动漫', slot: 16, prefix: '【二次元……也算二次元嘛？】',
    minLen: 60, maxLen: 200, enabled: true,
  },
  gaming: {
    n: 4, label: '游戏区', slot: 20, prefix: '【打电动时间dao】',
    minLen: 60, maxLen: 200, enabled: true,
  },
}

/** @deprecated 运行期请用 `kindsNow(config())`；保留默认值给旧调用/文档。 */
export const KINDS = DEFAULT_KINDS
/** @deprecated 用 `Object.keys(kindsNow(config()))`。 */
export const KIND_KEYS = Object.keys(DEFAULT_KINDS)

function clampInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(max, Math.max(min, n)))
}

function clampPrefix(value, fallback) {
  if (typeof value !== 'string') return fallback
  // 前缀是动态第一行的固定标记：不许换行、不许空得只剩空格；其余原样保留
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, 80)
}

/** 把配置收敛成运行期的四类定义（缺省值来自 DEFAULT_KINDS）。 */
export function kindsNow(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : config()
  const user = src?.dynamics?.kinds && typeof src.dynamics.kinds === 'object' ? src.dynamics.kinds : {}
  const out = {}
  for (const [key, def] of Object.entries(DEFAULT_KINDS)) {
    const u = user[key] && typeof user[key] === 'object' ? user[key] : {}
    const minLen = clampInt(u.minLen, def.minLen, 10, 1000)
    const maxLen = clampInt(u.maxLen, def.maxLen, minLen + 10, 2000)
    out[key] = {
      ...def,
      enabled: u.enabled !== false,
      slot: clampInt(u.slot, def.slot, 0, 23),
      minLen,
      maxLen,
      prefix: clampPrefix(u.prefix, def.prefix),
    }
  }
  return out
}

/** 只返回启用的类（键顺序固定 best/game/anime/gaming）。 */
export function enabledKinds(cfg) {
  const all = kindsNow(cfg)
  return Object.fromEntries(Object.entries(all).filter(([, k]) => k.enabled !== false))
}

export function dynamicsEnabled(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : config()
  return src?.dynamics?.enabled !== false
}

export function dynamicsGapMin(cfg) {
  const src = cfg && typeof cfg === 'object' ? cfg : config()
  return clampInt(src?.dynamics?.gapMin, 30, 5, 240)
}

/** 给 store/UI 用的完整可编辑默认值（只含可编辑字段，不带 n/label）。 */
export function dynamicDefaults() {
  return {
    enabled: true,
    gapMin: 30,
    kinds: Object.fromEntries(Object.entries(DEFAULT_KINDS).map(([key, def]) => [key, {
      enabled: def.enabled !== false,
      slot: def.slot,
      minLen: def.minLen,
      maxLen: def.maxLen,
      prefix: def.prefix,
    }])),
  }
}

/** 保存前收敛：只保留可编辑字段，越界值写回合法范围。 */
export function normalizeDynamics(input) {
  const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const userKinds = src.kinds && typeof src.kinds === 'object' ? src.kinds : {}
  const kinds = {}
  for (const [key, def] of Object.entries(DEFAULT_KINDS)) {
    const u = userKinds[key] && typeof userKinds[key] === 'object' ? userKinds[key] : {}
    const minLen = clampInt(u.minLen, def.minLen, 10, 1000)
    const maxLen = clampInt(u.maxLen, def.maxLen, minLen + 10, 2000)
    kinds[key] = {
      enabled: u.enabled !== false,
      slot: clampInt(u.slot, def.slot, 0, 23),
      minLen,
      maxLen,
      prefix: clampPrefix(u.prefix, def.prefix),
    }
  }
  return {
    enabled: src.enabled !== false,
    gapMin: clampInt(src.gapMin, 30, 5, 240),
    kinds,
  }
}

/** 当前时刻是否落在某一类的发布时段里 */
export function slotOf(kind, d = new Date(), kinds = kindsNow()) {
  const k = kinds[kind]
  if (!k || k.enabled === false) return false
  const h = withConfiguredTimeZone(() => d.getHours() + d.getMinutes() / 60)
  const list = [...new Set(Object.values(kinds)
    .filter((item) => item.enabled !== false)
    .map((item) => item.slot))].sort((a, b) => a - b)
  const i = list.indexOf(k.slot)
  if (i === -1) return false
  const end = i + 1 < list.length ? list[i + 1] : 24
  return h >= k.slot && h < end
}

/** 现在"该发"的类（落在哪个时段就是哪类；都不在 → null） */
export function dueKind(d = new Date(), kinds = kindsNow()) {
  const enabled = Object.entries(kinds)
    .filter(([, k]) => k.enabled !== false)
    .sort((a, b) => a[1].slot - b[1].slot)
  for (const [key] of enabled) if (slotOf(key, d, kinds)) return key
  return null
}

/** 正文去掉开头前缀（用于数字数、判断口吻） */
export function stripPrefix(kind, text, kinds = kindsNow()) {
  const p = kinds[kind]?.prefix ?? ''
  let t = String(text ?? '').trim()
  if (p && t.startsWith(p)) t = t.slice(p.length).trim()
  return t
}

/** 正文确保以该类的固定前缀开头 */
export function withPrefix(kind, text, kinds = kindsNow()) {
  const p = kinds[kind]?.prefix ?? ''
  const body = stripPrefix(kind, text, kinds)
  return p ? `${p}${body}` : body
}
