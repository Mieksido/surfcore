// 自由评论的硬闸门（2026-10-20 起，陆续加到五本账）
//
// 背景：主人要她"想说话就说话"，但**不能说着说着变成刷屏号** ✗
//   分寸写在 AGENTS.md 里只是自觉；这里把它变成**代码**（不接受参数覆盖 ✓）。
//
// 账本（都用 --auto 判定"是她自己说的"）：
//   · comment   顶层评论      30/天 · 同 UP 10 分钟 1 条 · 同视频 60 分钟 1 条
//   · reply     回找我的人    50/天 · 同一条评论 24 小时 1 次
//   · ta        主动搭话      15/天 · 同一条评论 24 小时 1 次
//   · mine:<k>  回自己动态    **按四类分开记**：每类 10/天 · 每类每人 1 条
//                 k = best / game / anime / gaming（2026-10-21 管理员定）
//   · share     分享型        ↑ 不在这里管（评分/rank/7 天判重在 quota.mjs）
//
// **全局冷却**：任意两条自主发言之间 ≥ globalMin 分钟（所有账共用，跨视频也管 ✓）
//
// 2026-10-22：数字不再是常量 —— 唯一真相是 bili.config.json 的 `limits` 段
//   （设置页可编辑；默认值与旧硬编码完全一致）。本文件只负责按账本查/记。
//
// 数据来源：~/.dsh/surfcore/bili/quota.json 的 log（comment.mjs record 时写 up/reply/ta/mine/toMid/parent）
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.mjs'
import { DEFAULT_LIMITS, freeLimits } from './limits.mjs'
import { biliState } from './state-paths.mjs'
import { dayKey, withConfiguredTimeZone } from './clock.mjs'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
// 尊重 DSH_HOME（测试/多实例）；避免把临时账本写到真实 ~/.dsh。
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')
const FILE = biliState('quota.json')

/** @deprecated 运行期请用 `freeLimits(config())`；保留默认值给旧调用/文档。 */
export const FREE_LIMITS = DEFAULT_LIMITS


const dayOf = (at) => dayKey(at)
const today = () => dayKey()

function loadLog() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).log ?? [] } catch { return [] }
}

const isAutoComment = (x) => x?.type === 'comment' && x?.auto && !x?.share
const isFree = (x) => isAutoComment(x) && !x?.reply
const isReply = (x) => isAutoComment(x) && !!x?.reply && !x?.ta && !x?.mine
const isTa = (x) => isAutoComment(x) && !!x?.reply && !!x?.ta
/** 回自己动态：mine 字段记的是**哪一类**（兼容老的 true = best） */
const isMineOf = (x, k) => isAutoComment(x) && !!x?.reply
  && (k === 'best' ? (x?.mine === true || x?.mine === 'best') : x?.mine === k)

const hhmmss = (t) => withConfiguredTimeZone(() => new Date(t).toLocaleTimeString('zh-CN', { hour12: false }))

const CAPS = { comment: 'daily', reply: 'replyDaily', ta: 'taDaily' }
const LABELS = { comment: '条普通评论', reply: '条回复', ta: '条搭话' }

/**
 * 查这条能不能发。
 * @param {{kind?: 'comment'|'reply'|'ta'|'mine:best'|'mine:game'|'mine:anime'|'mine:gaming',
 *          upMid?: string, bvid?: string, parent?: string, toMid?: string}} opts
 */
export function checkFree({ kind = 'comment', upMid = '', bvid = '', parent = '', toMid = '' } = {}) {
  const L = freeLimits(config())
  const all = loadLog()
  const auto = all.filter(isAutoComment)
  const dynKind = kind.startsWith('mine:') ? kind.slice(5) : ''
  const log = dynKind
    ? all.filter((x) => isMineOf(x, dynKind))
    : kind === 'ta' ? all.filter(isTa)
      : kind === 'reply' ? all.filter(isReply)
        : all.filter(isFree)

  const now = Date.now()
  const used = log.filter((x) => dayOf(x.at) === today()).length
  const cap = dynKind ? L.mineDaily : L[CAPS[kind] ?? 'daily']
  // 0 = 关闭这一类上限（不限量），不是"一条都不许发"
  const limited = cap > 0
  const label = dynKind ? '条动态回复' : (LABELS[kind] ?? '条普通评论')
  const no = (reason) => ({ ok: false, used, cap, reason, text: `✗ ${reason}` })
  const progress = limited ? `今天第 ${used + 1}/${cap}` : `今天第 ${used + 1}`

  // ① 全局冷却（所有账共用）
  const lastAt = auto.reduce((m, x) => Math.max(m, new Date(x.at).getTime() || 0), 0)
  if (L.globalMin > 0 && lastAt && now - lastAt < L.globalMin * 60_000) {
    const wait = Math.ceil((L.globalMin * 60_000 - (now - lastAt)) / 60_000)
    return no(`刚发过一条（${hhmmss(lastAt)}），再等 ${wait} 分钟 —— 连着发像刷屏 ✗`)
  }

  // ② 当天额度（各账分开算）
  if (limited && used >= cap) return no(`今天这一类已经发了 ${used} ${label}（上限 ${cap}）—— 想说的留到明天`)

  // ③ 自己动态下：同一类 + 同一个人一天最多 N 条
  if (dynKind) {
    if (toMid && L.minePerPerson > 0) {
      const n = log.filter((x) => dayOf(x.at) === today() && String(x.toMid ?? '') === String(toMid)).length
      if (n >= L.minePerPerson) {
        return no(`今天已经回过这个人 ${n} 条了（动态下每人上限 ${L.minePerPerson}）—— 剩下的留到明天 ✗`)
      }
    }
    return {
      ok: true, used, cap,
      text: `✓ 通过：${progress} 条「${dynKind}」动态回复`
        + (lastAt ? ` · 距上一条 ${Math.floor((now - lastAt) / 60_000)} 分钟` : '')
        + (toMid ? ` · 这个人今天还没回满` : ''),
    }
  }

  if (kind === 'reply' || kind === 'ta') {
    if (parent && L.perThreadMin > 0) {
      const dup = log.find((x) => String(x.parent ?? '') === String(parent)
        && now - new Date(x.at).getTime() < L.perThreadMin * 60_000)
      if (dup) return no(`这条评论 ${Math.round(L.perThreadMin / 60)} 小时内已经回过一次了（${hhmmss(dup.at)}）—— 换一条`)
    }
    return {
      ok: true, used, cap,
      text: `✓ 通过：${progress} ${label}`
        + (lastAt ? ` · 距上一条 ${Math.floor((now - lastAt) / 60_000)} 分钟` : '')
        + (parent ? ' · 这条没回过' : ''),
    }
  }

  if (bvid && L.perVideoMin > 0) {
    const t = `BV:${bvid}`
    const dup = log.find((x) => String(x.target ?? '') === t && now - new Date(x.at).getTime() < L.perVideoMin * 60_000)
    if (dup) return no(`这个视频 ${L.perVideoMin} 分钟内已经说过一次了（${hhmmss(dup.at)}）—— 别人也看得见，别刷`)
  }
  if (upMid && L.perUpMin > 0) {
    const dup = log.find((x) => String(x.up ?? '') === String(upMid) && now - new Date(x.at).getTime() < L.perUpMin * 60_000)
    if (dup) return no(`同一个 UP 主 ${L.perUpMin} 分钟内已经说过一次了 —— 别在人家底下连刷`)
  }

  return {
    ok: true, used, cap,
    text: `✓ 通过：${progress} 条普通评论`
      + (lastAt ? ` · 距上一条 ${Math.floor((now - lastAt) / 60_000)} 分钟` : '')
      + (bvid ? ` · 本视频 ${L.perVideoMin} 分钟内没说过` : '')
      + (upMid ? ` · 本 UP ${L.perUpMin} 分钟内没说过` : ''),
  }
}

/**
 * 今天各本账用了多少（设置页/自动化快照共用；口径与 checkFree 完全一致）。
 * @returns {{total:number, comment:number, reply:number, ta:number, mine:Record<string,number>, share:number}}
 */
export function usageToday() {
  const day = today()
  const rows = loadLog().filter((x) => x?.at && dayOf(x.at) === day)
  const auto = rows.filter(isAutoComment)
  const mine = { best: 0, game: 0, anime: 0, gaming: 0 }
  for (const key of Object.keys(mine)) mine[key] = auto.filter((x) => isMineOf(x, key)).length
  return {
    total: rows.length,
    comment: auto.filter(isFree).length,
    reply: auto.filter(isReply).length,
    ta: auto.filter(isTa).length,
    mine,
    share: rows.filter((x) => x?.share).length,
  }
}


/** 按 BV 查 UP 主 mid（查不到就返回空串 —— 冷却跳过，不因此拦人） */
export async function upOf(bvid) {
  if (!bvid) return ''
  try {
    const r = await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, {
      headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' },
    })
    const j = await r.json()
    return String(j?.data?.owner?.mid ?? '')
  } catch { return '' }
}
