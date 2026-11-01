#!/usr/bin/env node
/**
 * B站「每日分享 → 自己的动态」（2026-10-23 用户定）。
 *
 *   node bili.mjs share-dynamic --bvid BV... --text "…" --score 15 --reason "…" --dry
 *   node bili.mjs share-dynamic --bvid BV... --text "…" --score 15 --reason "…" --go
 *
 * 默认发**视频卡片**：转发该视频已有的 AV 动态（lib/forward.mjs，2026-10-21 已验证）；
 * 找不到卡片就拒绝（加 --allow-text 才退回“文字 + 链接”）。
 * 发之前检查 daily-dynamic.json：和任意一条四类动态 / 上一次分享至少隔 dynamics.gapMin 分钟。
 * 发之后写 daily-dynamic.json 的 share 记录 + 占一条分享额度（quota --share）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { config } from '../lib/config.mjs'
import { assertInteractEnabled } from '../lib/interact.mjs'
import { biliState } from '../lib/state-paths.mjs'
import { dynamicsGapMin } from '../lib/kinds.mjs'
import { gate, record as recordQuota } from '../lib/quota-gate.mjs'
import { assertOutboundIdentitySafe } from '../lib/outbound-guard.mjs'
import { ownerOf, findVideoDynamic, createForward, verifyForward } from '../lib/forward.mjs'
import { readShareState, dynamicGapWait, mergeShareRecord } from '../lib/share-dynamic.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const args = new Map()
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (!a.startsWith('--')) continue
  const next = argv[i + 1]
  if (next === undefined || next.startsWith('--')) args.set(a.slice(2), true)
  else { args.set(a.slice(2), next); i += 1 }
}

const bvid = String(args.get('bvid') ?? '').trim()
const text = String(args.get('text') ?? '').trim()
const score = Number(args.get('score'))
const reason = String(args.get('reason') ?? '').trim()
const dry = args.get('dry') === true
const go = args.get('go') === true
const allowText = args.get('allow-text') === true

if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) {
  console.error('用法: share-dynamic --bvid BV... --text "…" --score 0-20 --reason "…" [--allow-text] [--dry|--go]')
  process.exit(2)
}
if (!text) { console.error('share-dynamic 需要 --text'); process.exit(2) }
if (text.length > 1000) { console.error('动态正文最多 1000 字'); process.exit(2) }
if (dry && go) { console.error('--dry 和 --go 只能选一个'); process.exit(2) }
if (!dry && !go) { console.error('必须显式 --dry 或 --go'); process.exit(2) }
if (go && !assertInteractEnabled('分享动态')) process.exit(3)

const cfg = config()
if (cfg.share?.enabled === false) {
  console.error('分享已在设置里关闭（share.enabled=false）')
  process.exit(3)
}
const minScore = Number(cfg.share?.minScore ?? 13)
if (!Number.isFinite(score) || String(args.get('score') ?? '') === '') {
  console.error(`需要 --score（每项 0-4，满 20；阈值 ${minScore}）`)
  process.exit(2)
}
if (score < 0 || score > 20) {
  console.error('--score 必须在 0~20 之间')
  process.exit(2)
}
if (score < minScore) {
  console.error(`✗ 评分 ${score} < 阈值 ${minScore} → 这条不值得占用一次分享`)
  process.exit(2)
}
if (reason.length < 8) {
  console.error('需要 --reason "为什么值得分享"（≥8 字）')
  process.exit(2)
}

// ── 和其它动态的 30 分钟间隔 ─────────────────────────────────────────────
const stateFile = biliState('daily-dynamic.json')
const gapMin = dynamicsGapMin(cfg)
const gap = dynamicGapWait(readShareState(stateFile), gapMin, Date.now())
if (!gap.ok) {
  console.error(`✗ 上一条动态刚发不久（${new Date(gap.lastAt).toLocaleTimeString('zh-CN', { hour12: false })}）`
    + ` —— 任意两条动态之间要隔 ${gapMin} 分钟，还差 ${gap.waitMin} 分钟`)
  process.exit(3)
}

// ── 先找视频卡片；默认必须有卡片 ──────────────────────────────────────────
let avDyn = null
try {
  const up = await ownerOf(bvid)
  if (up) avDyn = await findVideoDynamic(bvid, up)
} catch (e) {
  console.log(`（找视频卡片失败：${String(e?.message ?? e).slice(0, 80)}）`)
}
if (!avDyn && !allowText) {
  console.error('✗ 没找到这条视频的 AV 动态卡片 —— 换一条视频，或加 --allow-text 退回“文字 + 链接”')
  process.exit(4)
}
const finalText = avDyn ? text : `${text}\nhttps://www.bilibili.com/video/${bvid}/`
const cardLabel = avDyn ? `视频卡片（转发动态 ${avDyn.id}）` : '文字 + 链接（--allow-text）'

console.log(`[分享·动态] ${bvid}`)
console.log(`  卡片：${cardLabel}`)
console.log(`  正文 ${text.length} 字 · 评分 ${score}/20 · 阈值 ${minScore}`)
if (avDyn?.title) console.log(`  视频标题：${avDyn.title.slice(0, 60)}`)
if (gap.lastAt) console.log(`  距上一条动态：${Math.floor((Date.now() - gap.lastAt) / 60000)} 分钟（要求 ≥${gapMin}）`)

// ── 分享额度（和评论区 @ 共用同一本账）────────────────────────────────────
// 注意：这里用 type=comment + --share，quota 的 share 账只认 x.share，不关心具体通道。
if (!gate({ type: 'comment', target: `BV:${bvid}`, auto: true, share: true })) {
  console.error('✗ 分享额度/7 天判重不通过')
  process.exit(2)
}

if (dry) {
  console.log(`\n[dry] 未发布。${avDyn ? '真发会转发视频卡片。' : '真发会发文字 + 链接。'}`)
  process.exit(0)
}

// ── 发布 ─────────────────────────────────────────────────────────────────
// 出站身份闸（2026-10-23 用户要求：只准自己互认，不许泄露主人和别人的信息）
// 转发卡片/文字动态都是公开面；提示词只是概率约束，这里是硬拦。
try {
  assertOutboundIdentitySafe(finalText, { surface: 'B站 动态' })
} catch (error) {
  console.error(`\n✗ ${error.message}`)
  process.exit(9)
}
let dynId = ''
try {
  if (avDyn) {
    const r = await createForward(avDyn.id, finalText)
    if (!r.ok || !r.id) {
      if (!allowText) {
        console.error(`✗ 转发卡片失败（code=${r.code ?? '?'} ${r.message ?? ''}）—— 加 --allow-text 才退回文字`)
        process.exit(5)
      }
      console.log(`  ⚠️ 转发卡片失败（code=${r.code ?? '?'}），按 --allow-text 退回文字 + 链接`)
      avDyn = null
    } else {
      dynId = r.id
      console.log(`  ✓ 已转发视频卡片 → 新动态 ${dynId}`)
      try {
        const v = await verifyForward(dynId, bvid)
        console.log(`  卡片复核：${v?.ok ? '✓ 转发 + 视频卡' : `⚠️ ${v?.why ?? '没复核到'}（type=${v?.type ?? '?'}）`}`)
      } catch {}
    }
  }
  if (!dynId) {
    const dynamic = path.join(HERE, 'dynamic.mjs')
    const out = execFileSync(process.execPath, [dynamic, 'post', '--text', `${text}\nhttps://www.bilibili.com/video/${bvid}/`, '--go'], {
      encoding: 'utf8', timeout: 180_000, windowsHide: true,
    })
    process.stdout.write(out)
    dynId = (out.match(/dyn_id[=: ]+(\d+)/i) ?? out.match(/dynId[=: ]+(\d+)/i) ?? [])[1] ?? ''
    if (!dynId) {
      console.error('✗ 没从 dynamic 输出里解析到 dyn_id')
      process.exit(6)
    }
  }
} catch (e) {
  console.error(`✗ 发布失败：${String(e?.message ?? e).slice(0, 300)}`)
  process.exit(5)
}

// ── 记账 + 写 daily-dynamic.json（四类动态的间隔会读它）───────────────────
const at = new Date().toISOString()
const atText = new Date().toLocaleTimeString('zh-CN', { hour12: false })
try {
  const st = mergeShareRecord(readShareState(stateFile), {
    date: new Date().toLocaleDateString('sv-SE'),
    at, atText, bvid, dynId, card: Boolean(avDyn), chars: finalText.length,
  })
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  fs.writeFileSync(stateFile, JSON.stringify(st, null, 2) + '\n')
} catch (e) {
  console.log(`  ⚠️ 写 daily-dynamic.json 失败（间隔可能不准）：${String(e?.message ?? e).slice(0, 80)}`)
}
recordQuota({ type: 'comment', target: `BV:${bvid}`, note: `动态分享 ${finalText.slice(0, 30)}`, auto: true, share: true })

// 报备（走用户配置的通知通道；失败不影响已发出的动态）
try {
  const notify = path.join(HERE, 'notify.mjs')
  execFileSync(process.execPath, [notify, `【分享型·动态】${cardLabel}\n${finalText.slice(0, 120)}\nhttps://t.bilibili.com/${dynId}`, '--title', '分享型·动态'], {
    encoding: 'utf8', timeout: 60_000, windowsHide: true,
  })
} catch (e) {
  console.log(`  （报备失败，不影响动态：${String(e?.message ?? e).slice(0, 80)}）`)
}

console.log(`\n✓ 分享动态已发出：https://t.bilibili.com/${dynId}`)
