/**
 * B站自动化的只读快照 —— 设置页「额度与自动化」用它显示"今天用了多少 / 下一班几点"。
 *
 * 为什么单独一个模块：
 *   · 不改配置、不跑工具、不碰网络，只读三份状态（quota.json / daily-dynamic.json / bili-share-state.json）；
 *   · 额度口径复用 tools/lib/free-gate.mjs 的 usageToday()，避免 UI 和闸门各算一套。
 *
 * 写入仍然走现有路径：B站额度/四类动态 → /api/config 的 bili 段；
 * QQ 视频分享 → /api/config 的 qq.biliBridge 段（保存后需重启桥接）。
 */
import path from 'node:path'
import { BILI_AI_DIR, QQ_STATE_DIR } from './paths.js'
import { readBiliConfig, readQqConfig, readJson } from './store.js'
import { usageToday } from '../tools/lib/free-gate.mjs'
import { DEFAULT_LIMITS, freeLimits } from '../tools/lib/limits.mjs'
import { kindsNow, dynamicsEnabled, dynamicsGapMin, CATCHUP_DAY } from '../tools/lib/kinds.mjs'
import { normalizeCardMode } from '../../../src/share-mode.js'
import { withConfiguredTimeZone } from '../../../src/timezone.js'

const today = () => withConfiguredTimeZone(() => new Date().toLocaleDateString('sv-SE'))

function parseClock(label) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(label ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

/** 下一个 HH:MM 时间点（今天没到就今天，到了就明天第一个）。 */
function nextClock(times, now = new Date()) {
  const list = [...new Set((Array.isArray(times) ? times : []).map((t) => String(t).trim()))]
    .map((label) => ({ label, clock: parseClock(label) }))
    .filter((item) => item.clock)
    .sort((a, b) => (a.clock.hour * 60 + a.clock.minute) - (b.clock.hour * 60 + b.clock.minute))
  if (!list.length) return null
  return withConfiguredTimeZone(() => {
    for (const item of list) {
      const d = new Date(now)
      d.setHours(item.clock.hour, item.clock.minute, 0, 0)
      if (d.getTime() > now.getTime()) return d
    }
    const first = list[0]
    const d = new Date(now)
    d.setDate(d.getDate() + 1)
    d.setHours(first.clock.hour, first.clock.minute, 0, 0)
    return d
  })
}

function isoOrNull(value) {
  const t = Number(value)
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null
}

function readBiliDynamicsState() {
  return readJson(path.join(BILI_AI_DIR, 'daily-dynamic.json'), {}) ?? {}
}

function readQqShareState() {
  return readJson(path.join(QQ_STATE_DIR, 'bili-share-state.json'), {}) ?? {}
}

function readQqDynamicsState() {
  return readJson(path.join(QQ_STATE_DIR, 'bili-dynamics-state.json'), {}) ?? {}
}

export function automationSnapshot(now = new Date()) {
  const bili = readBiliConfig().config
  const qq = readQqConfig().config
  const limits = freeLimits(bili)
  const usage = usageToday()

  const dynState = readBiliDynamicsState()
  const kinds = kindsNow(bili)
  const dynGap = dynamicsGapMin(bili)
  const dynEnabled = dynamicsEnabled(bili)
  const kindRows = Object.entries(kinds).map(([key, kind]) => {
    const posted = dynState?.[key]?.date === today() ? dynState[key] : null
    return {
      key,
      n: kind.n,
      label: kind.label,
      enabled: kind.enabled !== false,
      slot: kind.slot,
      slotText: `${String(kind.slot).padStart(2, '0')}:00`,
      minLen: kind.minLen,
      maxLen: kind.maxLen,
      prefix: kind.prefix,
      postedAt: posted?.at ?? null,
      postedAtText: posted?.atText ?? null,
      postedBvid: posted?.bvid ?? null,
      postedDynId: posted?.dynId ?? null,
    }
  })
  const nextDyn = dynEnabled
    ? kindRows
      .filter((k) => k.enabled)
      .sort((a, b) => a.slot - b.slot)
      .map((k) => ({ ...k, at: nextClock([k.slotText], now) }))
      .filter((k) => k.at)
      .sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null
    : null

  const shareCfg = qq?.biliBridge?.share ?? {}
  const shareGroups = Array.isArray(shareCfg.groups) ? shareCfg.groups : []
  const allowGroups = Array.isArray(qq?.allow?.groups) ? qq.allow.groups : []
  const shareState = readQqShareState()
  const shareEnabled = qq?.biliBridge?.enabled !== false && shareCfg.enabled !== false
  const shareNext = shareEnabled ? nextClock(shareCfg.times, now) : null

  const dynSyncCfg = qq?.biliBridge?.dynamics ?? {}
  const dynSyncState = readQqDynamicsState()

  return {
    ok: true,
    now: now.toISOString(),
    today: today(),
    limits: {
      ...limits,
      defaults: { ...DEFAULT_LIMITS },
    },
    usage,
    share: {
      enabled: bili?.share?.enabled !== false,
      daily: Number(bili?.quota?.shareDaily ?? 3),
      used: usage.share,
      via: bili?.share?.via ?? 'dynamic',
      minScore: Number(bili?.share?.minScore ?? 13),
    },
    dynamics: {
      enabled: dynEnabled,
      gapMin: dynGap,
      catchupDay: CATCHUP_DAY,
      kinds: kindRows,
      next: nextDyn
        ? { key: nextDyn.key, label: nextDyn.label, slotText: nextDyn.slotText, at: nextDyn.at.toISOString() }
        : null,
    },
    qqShare: {
      enabled: shareEnabled,
      times: Array.isArray(shareCfg.times) ? shareCfg.times : [],
      groups: shareGroups,
      groupsEffective: shareGroups.length ? shareGroups : allowGroups,
      gapMs: Number(shareCfg.gapMs ?? 4000),
      card: shareCfg.card !== false,
      cardMode: normalizeCardMode(shareCfg),
      lastSlot: shareState?.lastSlot ?? '',
      lastRunAt: shareState?.lastRunAt ?? null,
      lastSlots: shareState?.lastSlots ?? {},
      nextAt: shareNext ? shareNext.toISOString() : null,
      nextText: shareNext ? shareNext.toTimeString().slice(0, 5) : null,
    },
    dynamicsSync: {
      enabled: qq?.biliBridge?.enabled !== false && dynSyncCfg.enabled !== false,
      pollIntervalMs: Number(dynSyncCfg.pollIntervalMs ?? 180_000),
      groups: Array.isArray(dynSyncCfg.groups) ? dynSyncCfg.groups : [],
      groupsEffective: (Array.isArray(dynSyncCfg.groups) && dynSyncCfg.groups.length) ? dynSyncCfg.groups : allowGroups,
      lastPollAt: isoOrNull(dynSyncState?.lastPollAt),
    },
  }
}
