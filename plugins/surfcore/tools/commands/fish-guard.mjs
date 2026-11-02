#!/usr/bin/env node
/**
 * B站评论区鱼群保护：status / plan / like。
 *
 *   node bili.mjs fish-guard status --bvid BV... [--oid <aid>] [--type 1] [--json]
 *   node bili.mjs fish-guard plan   --bvid BV... [--oid <aid>] [--json]
 *   node bili.mjs fish-guard like   --bvid BV... [--oid <aid>] [--dry] [--max 1]
 *
 * 2026-10-23：status/plan 也会带 cookie 取评论。
 *   不带登录态时 /x/v2/reply 只回 0~3 条评论，鱼识别与点赞目标会直接变成 0。
 * like 需要 ~/.dsh/surfcore/bili/credentials.json；失败会写进 fish-guard.json 的
 * likeFailed / lastLikeRun，设置页能直接看到「最近一次到底失败在哪」。
 */
import { accountBili } from '../lib/state-paths.mjs'
import fs from 'node:fs'
import { config } from '../lib/config.mjs'
import { assertInteractEnabled } from '../lib/interact.mjs'
import {
  fishGuardStateSummary, fishGuardStatusText, likeFishComments, loadFishGuardState,
  normalizeBiliFishGuard, planFishGuard, recordFishGuardCheck,
} from '../lib/fish-guard.mjs'

const argv = process.argv.slice(2)
const sub = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'status'
const args = new Map()
for (let i = sub === argv[0] ? 1 : 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (!a.startsWith('--')) continue
  const next = argv[i + 1]
  args.set(a.slice(2), next && !next.startsWith('--') ? argv[++i] : true)
}
let oid = args.get('oid') ? String(args.get('oid')) : ''
const bvid = args.get('bvid') ? String(args.get('bvid')) : ''
const type = String(args.get('type') ?? '1')
const jsonOut = args.get('json') === true
const dry = args.get('dry') === true
if (sub === 'like' && !dry && !assertInteractEnabled('给鱼点赞')) process.exit(3)

const cfg = normalizeBiliFishGuard(config().fishGuard)
const state = loadFishGuardState()

function loadCred() {
  try {
    const cred = JSON.parse(fs.readFileSync(accountBili('credentials.json'), 'utf8'))
    return cred?.sessdata && cred?.bili_jct ? cred : null
  } catch {
    return null
  }
}
const cred = loadCred()

async function aidFromBvid(bv) {
  if (!/^BV[0-9A-Za-z]{10}$/.test(String(bv ?? ''))) return ''
  try {
    const headers = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', referer: `https://www.bilibili.com/video/${bv}/` }
    if (cred) headers.cookie = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}${cred.buvid3 ? `; buvid3=${cred.buvid3}` : ''}`
    const res = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bv)}`, { headers })
    const json = await res.json()
    if (json?.code !== 0 || !json?.data?.aid) throw new Error(`view code=${json?.code ?? '?'} ${json?.message ?? ''}`)
    return String(json.data.aid)
  } catch (error) {
    console.error(`无法从 ${bv} 解析 aid：${error?.message ?? error}`)
    return ''
  }
}

if (!oid && bvid) oid = await aidFromBvid(bvid)
if (!oid) {
  console.error('usage: fish-guard status|plan|like --bvid BV... | --oid <aid> [--type 1] [--json] [--dry]')
  process.exit(2)
}

const plan = await planFishGuard({
  oid,
  type,
  bvid,
  selfMid: String(config().self?.mid ?? ''),
  ownerMid: String(config().owner?.mid ?? ''),
  config: cfg,
  state,
  cred,
})
const summary = fishGuardStateSummary(state, cfg)

if (sub === 'status') {
  if (jsonOut) console.log(JSON.stringify({ ...plan, summary }, null, 2))
  else {
    console.log(fishGuardStatusText(plan) || '（没有结果）')
    if (summary.lastRun) {
      const last = summary.lastRun
      console.log(`上次点赞：${last.ok ? '✓' : '✗'} 尝试 ${last.attempted} 条 · 成功 ${last.liked} 条 · 失败 ${last.failed.length} 条（${last.at}）`)
      for (const f of last.failed) console.log(`  ✗ rpid=${f.rpid} code=${f.code ?? '?'} ${f.message ?? ''}`)
      for (const s of last.skipped) console.log(`  · ${s}`)
    }
    if (summary.likeBlockedUntil) console.log(`点赞风控冷却到：${new Date(summary.likeBlockedUntil).toLocaleString('zh-CN')}`)
  }
  process.exit(plan.ok ? 0 : 1)
}

if (sub === 'plan') {
  console.log(JSON.stringify({
    ok: plan.ok,
    error: plan.error,
    loggedIn: plan.loggedIn,
    flooded: plan.flooded,
    gather: plan.gatherTarget,
    like: plan.likeTargets,
    summary,
    stats: plan.stats ? {
      fishTopLevel: plan.stats.fishTopLevel,
      fishMids: plan.stats.fishMids,
      fishRatio: plan.stats.fishRatio,
      totalSample: plan.stats.totalSample,
      fishNames: plan.stats.fishNames,
      threshold: plan.stats.threshold,
    } : null,
  }, null, 2))
  process.exit(plan.ok ? 0 : 1)
}

if (sub === 'like') {
  if (!plan.ok) {
    console.error(`鱼群保护检查失败：${plan.error}`)
    process.exit(1)
  }
  try { recordFishGuardCheck({ state, plan, oid, bvid, source: 'like' }) } catch {}
  if (!cred) {
    console.error(`credentials 缺失或不全：${accountBili('credentials.json')}`)
    process.exit(3)
  }
  if (!plan.likeTargets.length) {
    console.log('没有需要点赞的鱼（或今天额度已用完 / 都已赞过 / 刚失败过在冷却）')
    if (summary.lastRun) console.log(`上次点赞：${summary.lastRun.at}（成功 ${summary.lastRun.liked} / 失败 ${summary.lastRun.failed.length}）`)
    if (summary.likeBlockedUntil) console.log(`风控冷却到：${new Date(summary.likeBlockedUntil).toLocaleString('zh-CN')}`)
    process.exit(0)
  }
  const result = await likeFishComments({
    targets: plan.likeTargets.slice(0, Math.max(1, Number(args.get('max')) || plan.likeTargets.length)),
    oid, type, bvid, cred, state, config: cfg, dry,
  })
  console.log(JSON.stringify(result, null, 2))
  for (const f of result.failed) console.log(`  ✗ rpid=${f.rpid} code=${f.code ?? '?'} ${f.message ?? f.error ?? ''}`)
  if (!dry) console.log(`今天已点赞 ${result.dailyLikes ?? '?'}/${cfg.maxLikesPerDay} 条`)
  process.exit(result.ok ? 0 : 1)
}

console.error(`未知子命令：${sub}（支持 status / plan / like）`)
process.exit(2)
