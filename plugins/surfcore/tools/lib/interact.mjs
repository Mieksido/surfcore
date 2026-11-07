/**
 * B站互动闸门：沉默逛 + 评论新鲜度。
 *
 * 设计原则：工具层必须硬拦，不能只靠提示词。每个拒绝都带 code / error / hint，
 * 让 agent 和用户都能知道“为什么没发、去哪改”。
 */
import { config } from './config.mjs'

const DAY = 86400_000

export function interactEnabled(cfg = config()) {
  return cfg?.interact?.enabled !== false
}

export function maxCommentAgeDays(cfg = config()) {
  const n = Number(cfg?.interact?.maxCommentAgeDays)
  return Number.isFinite(n) && n >= 0 ? Math.min(365, Math.round(n)) : 14
}

/** 结构化拒绝：返回 false，并把可读原因写到 stderr；调用方负责 process.exit(3)。 */
export function assertInteractEnabled(action = '互动') {
  if (interactEnabled()) return true
  console.error(`✗ [BILI_INTERACT_DISABLED] 沉默逛 B 站已开启：${action}被禁止。`)
  console.error('  建议：去 设置 → B站 → 互动与静默，打开「正常互动」；或保留沉默逛，只看不说。')
  return false
}

/**
 * 「只回找你的人」（2026-11-08 用户定）：interact.proactive=false 时，
 * 顶层主动评论 / 热评搭话 / 鱼群聚拢一律禁止；回 @ 她、回复她的人照常。
 * 与 interact.enabled 的区别：沉默逛连私信和动态一起停，这个只停"她主动开口"。
 */
export function proactiveAllowed(cfg = config()) {
  return cfg?.interact?.proactive !== false
}

/** 同 assertInteractEnabled：返回 false 并给出可操作建议，调用方 process.exit(3)。 */
export function assertProactiveAllowed(action = '主动评论') {
  if (proactiveAllowed()) return true
  console.error(`✗ [BILI_PROACTIVE_DISABLED] 「只回找你的人」已开启：${action}被禁止。`)
  console.error('  建议：去 设置 → B站 → 互动与静默，打开「主动评论 / 搭话」；或继续只回找你的人。')
  return false
}

/**
 * ctime（毫秒）是否太旧。0/未知时间不拦（无法判断时不要误杀），
 * 但如果目标明确太旧，返回结构化原因。
 */
export function checkCommentAge(ctime, cfg = config()) {
  const limit = maxCommentAgeDays(cfg)
  if (!limit || !Number.isFinite(Number(ctime)) || Number(ctime) <= 0) {
    return { ok: true, code: '', ageDays: null, limit }
  }
  const ageDays = Math.floor((Date.now() - Number(ctime)) / DAY)
  if (ageDays <= limit) return { ok: true, code: '', ageDays, limit }
  return {
    ok: false,
    code: 'BILI_COMMENT_TOO_OLD',
    ageDays,
    limit,
    error: `目标评论是 ${ageDays} 天前的，超过「只回复多少天内的评论」上限 ${limit} 天。`,
    hint: `去 设置 → B站 → 互动与静默 调整「只回复多少天内的评论」；或改回一条更新的评论。`,
  }
}

export function printAgeBlock(result) {
  if (!result || result.ok) return
  console.error(`✗ [${result.code}] ${result.error}`)
  console.error(`  建议：${result.hint}`)
}
