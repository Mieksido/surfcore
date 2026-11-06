// 会话滚动 + 合并窗口分场景：纯逻辑 + 接线钉子
//   node scripts/test-session-rollover.mjs
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'

import {
  DEFAULT_ROLLOVER, buildHandoffBlock, handoffIsUseful, normalizeRolloverConfig, shouldRollSession,
} from '../src/session-rollover.js'
import { DEFAULT_BATCH_WINDOWS, batchWindowFor, normalizeBatchWindows } from '../src/wake-batch.js'
import { evaluateLocalFilter, normalizeLocalFilter } from '../src/wake-filter.js'
import { createTokenLedger } from '../src/token-ledger.js'

const root = path.resolve(import.meta.dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
let passed = 0
const ok = (cond, label) => {
  assert.ok(cond, label)
  passed += 1
  console.log(`  ✅ ${label}`)
}

console.log('## 1. 阈值归一化')
{
  const d = normalizeRolloverConfig({})
  ok(d.enabled === true, '默认开启')
  ok(d.tokens === 80000, '默认 8 万 token')
  ok(d.turns === 0, '默认不按轮数')
  ok(d.summary === true, '默认留交接')

  ok(normalizeRolloverConfig({ rolloverEnabled: false }).enabled === false, '可以关掉')
  ok(normalizeRolloverConfig({ rolloverTokens: 12345 }).tokens === 12345, '阈值可配')
  ok(normalizeRolloverConfig({ rolloverTokens: -5 }).tokens === 0, '负数收敛到 0（=不按 token）')
  ok(normalizeRolloverConfig({ rolloverTokens: 9e9 }).tokens === 2_000_000, '超大值收敛到上限')
  ok(normalizeRolloverConfig({ rolloverKeepRecent: 1 }).keepRecent === 4, 'keepRecent 下限 4')
  ok(normalizeRolloverConfig({ rolloverSummaryMaxChars: 10 }).summaryMaxChars === 120, '交接字数下限 120')
}

console.log('## 2. 该不该换会话')
{
  const cfg = { ...DEFAULT_ROLLOVER }
  ok(shouldRollSession({ usedTokens: 79000, turns: 10, config: cfg }) === false, '没到阈值不换')
  ok(shouldRollSession({ usedTokens: 80000, turns: 10, config: cfg }) === true, '刚好到阈值就换')
  ok(shouldRollSession({ usedTokens: 200000, turns: 1, config: cfg }) === false, '刚建的会话（1 轮）不滚')
  ok(shouldRollSession({ usedTokens: 0, turns: 99, config: { ...cfg, enabled: false } }) === false, '关掉后永不滚')

  const byTurns = { ...cfg, tokens: 0, turns: 50 }
  ok(shouldRollSession({ usedTokens: 999999, turns: 49, config: byTurns }) === false, '按轮数：49 < 50 不换')
  ok(shouldRollSession({ usedTokens: 0, turns: 50, config: byTurns }) === true, '按轮数：到 50 就换')
  ok(shouldRollSession({ usedTokens: 0, turns: 500, config: { ...cfg, tokens: 0, turns: 0 } }) === false, '两个维度都关 = 不滚')
}

console.log('## 3. 交接块')
{
  const recent = [
    { sender: '小明', plain: '今天加班到十点', isSelf: false },
    { sender: '我', plain: '那你早点睡', isSelf: true },
    { sender: '小明', plain: '嗯，明天再聊', isSelf: false },
  ]
  const block = buildHandoffBlock({ key: 'group:1', recent, closure: '聊到他加班', config: DEFAULT_ROLLOVER })
  ok(block.includes('【会话交接】'), '带标题，下一段会话知道这是交接')
  ok(block.includes('小明：今天加班到十点'), '带最近对话')
  ok(block.includes('聊到他加班'), '带上次收尾摘要')
  ok(!block.includes('我：那你早点睡'), '她自己的话不进交接（isSelf 跳过）')
  ok(block.includes('不要提') && block.includes('换过会话'), '明确要求别提前进换过会话')
  ok(handoffIsUseful(block) === true, '有内容的交接判定为有用')

  const empty = buildHandoffBlock({ recent: [], closure: '', config: DEFAULT_ROLLOVER })
  ok(handoffIsUseful(empty) === false, '空交接判定为无用（不注入）')

  const long = Array.from({ length: 60 }, (_, i) => ({ sender: `人${i}`, plain: `第 ${i} 句很长的话，用来把交接撑爆`.repeat(2) }))
  const capped = buildHandoffBlock({ recent: long, closure: '收尾', config: { ...DEFAULT_ROLLOVER, summaryMaxChars: 400 } })
  ok(capped.length <= 400, `超字数会截断（实得 ${capped.length}）`)
  ok(capped.includes('刚才收在：收尾'), '截断时保留「刚才收在」')
}

console.log('## 4. 合并窗口分场景')
{
  const w = DEFAULT_BATCH_WINDOWS
  ok(w.groupMs === 6000 && w.privateMs === 4000 && w.directMs === 3000, '默认 群 6s / 私聊 4s / 点名 3s')
  ok(batchWindowFor('group:123', 'keyword:梗', {}) === 6000, '群聊普通触发 = 6s')
  ok(batchWindowFor('private:456', 'private', {}) === 4000, '私聊 = 4s（不会被当成点名）')
  ok(batchWindowFor('group:123', 'atMention', {}) === 3000, '@ = 3s')
  ok(batchWindowFor('group:123', 'nameMention', {}) === 3000, '叫名字 = 3s')
  ok(batchWindowFor('group:123', 'poke', {}) === 3000, '拍一拍 = 3s')
  ok(batchWindowFor('group:123', 'atMention', { batchWindowDirectMs: 1200 }) === 1200, '点名窗口可配')
  ok(batchWindowFor('group:1', 'x', { batchWindowMs: 100 }) === 1000, '低于 1s 收敛到 1s')
  const n = normalizeBatchWindows({ batchWindowMs: 8000 })
  ok(n.groupMs === 8000 && n.privateMs === 4000 && n.directMs === 3000, '老配置只覆盖群聊窗口，其余用新默认')
}

console.log('## 5. 账本：会话累计 token')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roll-'))
  const file = path.join(dir, 'usage.jsonl')
  const ledger = createTokenLedger({ file })
  ok(ledger.sessionTotal('s1') === 0, '没有记录时返回 0')

  ledger.ingestEvent({
    sessionId: 's1',
    event: {
      seq: 1, type: 'assistant/message', time: Date.now(),
      data: {
        turn: 3, step: 1,
        // DSH 口径：inputTokens = 未命中部分，cacheReadTokens = 命中部分
        usage: { inputTokens: 200, cacheReadTokens: 800, outputTokens: 50 },
      },
    },
    model: 'deepseek-chat',
  })
  const after1 = ledger.sessionTotal('s1')
  ok(after1 > 0, `一次采样后有量（${after1}）`)
  ok(ledger.sessionTotal('s2') === 0, '别的会话不受影响（按 session 隔离）')
  ok(typeof ledger.sessionTotal === 'function', '账本导出 sessionTotal')
}

console.log('## 6. 接线钉子（防"写了模块但没接上"）')
{
  const bridge = read('src/bridge.js')
  ok(bridge.includes("from './session-rollover.js'"), 'bridge 引入会话滚动模块')
  ok(bridge.includes("from './wake-batch.js'"), 'bridge 引入合并窗口模块')
  ok(/function maybeRollSessionV2\(key\)/.test(bridge), 'bridge 有 maybeRollSessionV2')
  // 2026-11-06 实测修正：换会话与会话交接必须放在 deliverPromptNow 里，
  // 否则「目的机制」这类不走 sendWakePromptV2 的投递路径永远不会换会话，
  // 而唤醒路径里贴好的交接块又会被 deliverPromptNow 重建正文时覆盖。
  const deliverIdx = bridge.indexOf('async function deliverPromptNow(')
  const rollIdx = bridge.indexOf('maybeRollSessionV2(key);', deliverIdx)
  const ensureIdx = bridge.indexOf('sessionId = await ensureSession(key);', deliverIdx)
  ok(deliverIdx > 0 && rollIdx > deliverIdx && ensureIdx > rollIdx, '所有投递路径在建会话前判断换会话（唤醒/目的共用）')
  const rebuildIdx = bridge.indexOf('promptText = buildWakePromptV2(key, opts.wakeReason, vectorBlock);', deliverIdx)
  const handoffIdx = bridge.indexOf('const handoffBlock = consumeHandoffV2(key);', deliverIdx)
  ok(rebuildIdx > 0 && handoffIdx > rebuildIdx, '交接块在正文重建之后才贴（不会被覆盖）')
  ok(!bridge.includes('const handoff = consumeHandoffV2(key);'), '唤醒路径不再重复消费交接（否则会被覆盖/丢）')
  ok(bridge.includes('await deliverPrompt(key, prompt)'), '目的机制走 deliverPrompt（因此共享换会话与交接）')
  ok(/const batchMs = batchWindowFor\(key, reason/.test(bridge), '合并窗口走分场景函数（不再是写死的 8 秒）')
  ok(!/batchWindowMs\) \|\| 8000/.test(bridge), '旧的写死 8000 已清除')
  ok(bridge.includes('st.sessionBaseTokens = tokenLedger.sessionTotal(sessionId)'), '新建会话会记基线')

  const ui = read('plugins/surfcore/lib/client.js')
  ok(ui.includes('socialV2.context.rolloverTokens'), '设置页有换会话阈值')
  ok(ui.includes('socialV2.wake.batchWindowPrivateMs'), '设置页有私聊窗口')
  ok(ui.includes('socialV2.wake.batchWindowDirectMs'), '设置页有点名窗口')

  const example = JSON.parse(read('config.example.json'))
  ok(example.socialV2?.wake?.batchWindowMs === 6000, '示例配置群聊窗口=6000')
  ok(example.socialV2?.wake?.batchWindowPrivateMs === 4000, '示例配置私聊窗口=4000')
  ok(example.socialV2?.wake?.batchWindowDirectMs === 3000, '示例配置点名窗口=3000')
  ok(example.socialV2?.context?.rolloverTokens === 80000, '示例配置换会话阈值=80000')
}

console.log('## 7. 账本：今日用量与渠道（会话页的数据源）')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cost-'))
  const ledger = createTokenLedger({
    file: path.join(dir, 'usage.jsonl'),
    resolveKey: (sid) => (sid === 'g1' ? 'group:100' : 'private:200'),
  })
  const t = Date.now()
  ledger.ingestEvent({
    sessionId: 'g1',
    event: { seq: 1, type: 'assistant/message', time: t, data: { turn: 1, step: 1, usage: { inputTokens: 100, cacheReadTokens: 900, outputTokens: 100 } } },
    model: 'deepseek-chat',
  })
  ledger.ingestEvent({
    sessionId: 'p1',
    event: { seq: 1, type: 'assistant/message', time: t, data: { turn: 1, step: 1, usage: { inputTokens: 50, cacheReadTokens: 50, outputTokens: 50 } } },
    model: 'deepseek-chat',
  })

  const all = ledger.summary({ since: 0 })
  ok(all.ok === true, 'summary 正常返回')
  ok(all.conversations.some((c) => c.key === 'group:100' && c.channel === 'qq-group'), '群会话渠道 = qq-group')
  ok(all.conversations.some((c) => c.key === 'private:200' && c.channel === 'qq-private'), '私聊渠道 = qq-private')

  const today = ledger.summary({ since: t - 1000 })
  const g = today.conversations.find((c) => c.key === 'group:100')
  ok(g.todayTokens === 1100, `今日 token 只算今天的（实得 ${g.todayTokens}）`)
  ok(g.todayCost > 0, '今日花费非零')
  ok(today.totals.todayTokens === 1250, `今日合计跨会话相加（实得 ${today.totals.todayTokens}）`)
  ok(today.totals.byChannel['qq-group'].tokens === 1100, '按渠道汇总：群 1100')
  ok(today.totals.byChannel['qq-private'].tokens === 150, '按渠道汇总：私聊 150')

  const future = ledger.summary({ since: t + 60_000 })
  ok(future.conversations.find((c) => c.key === 'group:100').todayTokens === 0, '阈值在未来 → 今日为 0（不会把历史算进来）')
}

console.log('## 8. 回合形态 / 峰时 / 等待方式（接线 + 默认值）')
{
  const bridge = read('src/bridge.js')
  ok(/function engineMode\(\)/.test(bridge), '有 engineMode()')
  ok(/mode === 'machine'/.test(bridge) && /machinePreset/.test(bridge), '机器模式会换 preset')
  ok(/function peakOffloadActive\(at = Date\.now\(\)\)/.test(bridge), '有峰时判断')
  ok(/function backgroundTasksAllowed\(/.test(bridge), '有后台任务闸门')
  ok(/if \(!backgroundTasksAllowed\(\)\) return;/.test(bridge), '后台 tick 真的接了闸门')
  ok(bridge.includes('机器模式：跳过后台动态同步'), '机器模式跳过 B 站动态同步')
  ok(bridge.includes('【机器模式】') && bridge.includes('【桥接等待】'), '唤醒提示会加回合形态说明')
  ok(bridge.includes('工具开关变化，已退役'), '改工具面会退役会话（前缀缓存别失效）')

  const example = JSON.parse(read('config.example.json'))
  ok(example.socialV2?.engine?.mode === 'human', '示例：默认人类模式')
  ok(example.socialV2?.engine?.machinePreset === 'qq-chat', '示例：机器模式用 qq-chat 预设')
  ok(example.socialV2?.cost?.peakOffload === true, '示例：峰时顺延默认开')
  ok(example.socialV2?.wait?.mode === 'model', '示例：等待默认模型侧')

  const ui = read('plugins/surfcore/lib/client.js')
  ok(ui.includes('socialV2.engine.mode'), '设置页有回合形态开关')
  ok(ui.includes('socialV2.cost.peakOffload'), '设置页有峰时顺延开关')
  ok(ui.includes('socialV2.wait.mode'), '设置页有等待方式开关')
  ok(ui.includes('applyPreset(') && ui.includes('套用「省钱」'), '花费页有三档省钱预设')
  ok(ui.includes('SAVE_TOKEN_FIELDS') && ui.includes('将改') && ui.includes('应用改动'), '预设展开后可看到改动项并直接编辑')
  ok(ui.includes('persona.mode') && ui.includes('人格卡拆分注入'), '省钱预设包含人格卡拆分，且弹窗有说明')
  ok(ui.includes('安装任务') && ui.includes('qbw-meter') && ui.includes('progress'), 'Embedding 安装进度面板在通用区且带百分比')
  ok(ui.includes('asset?.size') && ui.includes('安装包'), '检查更新时显示安装包大小')
  ok(/indeterminate: !dl \|\| dl\.percent == null/.test(ui), '更新有百分比时不再使用跑马灯')
  ok(/h\(CostCard, \{ toast, set \}\)/.test(ui), '花费页拿得到配置写入句柄（预设才能真正落地）')
}

console.log('## 9. 本地判断（免费漏斗）')
{
  const f = normalizeLocalFilter({})
  ok(f.enabled === false, '默认关闭（用户自己开）')
  ok(f.dryRun === true, '开启后默认 dry-run（只统计不拦）')
  const on = normalizeLocalFilter({ localFilterEnabled: true, localFilterDryRun: false, localFilterRateWindowMs: 6e5, localFilterRateMax: 3 })
  ok(on.enabled === true && on.dryRun === false, '可以切到真拦')
  ok(on.rateWindowMs === 600000 && on.rateMax === 3, '频率阈值可配')

  for (const r of ['atMention', 'nameMention', 'poke', 'private', 'admin']) {
    ok(evaluateLocalFilter({ reason: r, text: '6', direct: true, filter: on }).blocked === false, `${r} 不拦`)
  }

  ok(evaluateLocalFilter({ reason: 'probability', text: '6', filter: on }).blocked === true, '纯「6」会被拦')
  ok(evaluateLocalFilter({ reason: 'probability', text: '？？？', filter: on }).blocked === true, '纯标点会被拦')
  ok(evaluateLocalFilter({ reason: 'probability', text: '啊啊啊啊', filter: on }).blocked === true, '叠字会被拦')
  ok(evaluateLocalFilter({ reason: 'probability', text: '这个插件怎么装', filter: on }).blocked === false, '有内容的消息不拦')

  const recent = { ...on, recentReplyMs: 120000 }
  ok(evaluateLocalFilter({ reason: 'keyword:梗', text: '这个梗笑死我了', recentReplyAt: Date.now() - 30000, filter: recent }).blocked === true, '刚回过就压普通触发')
  ok(evaluateLocalFilter({ reason: 'keyword:梗', text: '这个梗笑死我了', recentReplyAt: Date.now() - 600000, filter: recent }).blocked === false, '隔久了不压')

  const now = Date.now()
  ok(evaluateLocalFilter({ reason: 'keyword:梗', text: '这个梗笑死我了', wakeTimes: [now - 1000, now - 2000, now - 3000], now, filter: on }).blocked === true, '窗口内醒够次数就压')
  ok(evaluateLocalFilter({ reason: 'keyword:梗', text: '这个梗笑死我了', wakeTimes: [now - 1000], now, filter: on }).blocked === false, '没到次数不压')
  ok(evaluateLocalFilter({ reason: 'probability', text: '6', filter: { ...on, enabled: false } }).blocked === false, '关掉后什么都不拦')

  const bridge = read('src/bridge.js')
  ok(bridge.includes("from './wake-filter.js'"), 'bridge 引入本地判断模块')
  ok(/function evaluateLocalWakeFilterV2\(/.test(bridge), '有 evaluateLocalWakeFilterV2')
  ok(/const gate = evaluateLocalWakeFilterV2\(/.test(bridge), '唤醒调度前真的调了它')
  ok(/if \(gate\.blocked && !gate\.dryRun\)/.test(bridge), 'dry-run 时只统计不拦')
  ok(bridge.includes('/api/socialV2/local-filter'), '有统计接口给设置页看')
  ok(bridge.includes("'/api/socialV2/local-filter']"), 'local-filter 只能控制台调（agent token 拒绝，避免跨群统计泄露）')

  const example = JSON.parse(read('config.example.json'))
  ok(example.socialV2?.wake?.localFilterEnabled === false, '示例配置：本地判断默认关')
  ok(example.socialV2?.wake?.localFilterDryRun === true, '示例配置：默认 dry-run')
  const ui = read('plugins/surfcore/lib/client.js')
  ok(ui.includes('socialV2.wake.localFilterEnabled'), '设置页有本地判断开关')
}

console.log('## 10. 账本：外部渠道（桌宠/代办/独立脚本）')
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-'))
  const ledger = createTokenLedger({ file: path.join(dir, 'u.jsonl') })
  ok(ledger.ingestExternal({ channel: 'pet', tokens: 5000, cost: 0.05 }) === true, '可以上报外部用量')
  ok(ledger.ingestExternal({ channel: 'pet', tokens: 0, cost: 0 }) === false, '全零被拒（不写垃圾行）')
  const s = ledger.summary({ since: 0 })
  ok(s.totals.external.tokens === 5000, `外部 token 进总账（实得 ${s.totals.external.tokens}）`)
  ok(Math.round(s.totals.external.cost * 100) === 5, '外部花费进总账')
  ok(s.totals.external.byChannel.pet.tokens === 5000, '按渠道拆分')

  const again = createTokenLedger({ file: path.join(dir, 'u.jsonl') })
  ok(again.summary({ since: 0 }).totals.external.tokens === 5000, '重启后外部用量还在（写进了 jsonl）')

  const bridge = read('src/bridge.js')
  ok(bridge.includes('/api/tokens/external'), '桥接有外部用量上报接口')
}

console.log('\n## 11. 峰时闸门 + 云端 embedding 记账')
{
  const scheduler = read('plugins/surfcore/lib/scheduler.js')
  ok(scheduler.includes('function peakBlockedNow('), 'B站 scheduler 有峰时闸门')
  for (const label of ['生物钟叫醒', '私信叫醒', '评论区倾听', '直播间叫醒', '动态提醒']) {
    ok(scheduler.includes(`peakBlockedNow('${label}')`), `B站 ${label} 接了峰时闸门`)
  }
  const packs = read('plugins/surfcore/lib/embedding-packs.js')
  ok(packs.includes('SURFCORE_LEDGER_URL') && packs.includes('consoleToken()'), 'runtime 启动时注入账本地址和令牌')
  const runtime = read('plugins/surfcore/runtime/embedding-service.mjs')
  ok(runtime.includes('reportCloudUsage('), 'embedding runtime 会上报云端用量')
  const vm = read('plugins/surfcore/lib/vector-memory.js')
  ok(vm.includes('reportDirectCloudUsage('), '插件直连云端的 embedding 用量也会记账')
}

console.log('## 11. 交付位置：省钱入口必须在 Token 额度页最上方')
{
  const ui = read('plugins/surfcore/lib/client.js')
  const start = ui.indexOf('function TokenTab(')
  ok(start > 0, '存在 TokenTab')
  const body = ui.slice(start, start + 2600)
  const entryAt = body.indexOf('SaveTokenEntry')
  const summaryAt = body.indexOf('qbw-budget-summary')
  ok(entryAt > -1, '额度页里有省钱入口')
  ok(summaryAt > -1 && entryAt < summaryAt, '省钱入口排在预算卡片之前（即页面最上方）')
  ok(body.includes('CostCard'), '额度页也显示按会话花费（用户第 8 条：额度栏位里也要有）')
  ok(ui.includes('toast: notify, set: setQqPath'), '额度页拿得到配置写入句柄（预设才能真正落地）')
  ok(ui.includes('function SaveTokenTipsModal('), '省钱清单是弹窗（用户第 13 条原话）')
  ok(ui.includes('打开省钱清单'), '入口是一个明确的按钮')
}

console.log('## 12. 成本标签 / 重启标记 / 每会话额度 / 表情频率 / 搜索框')
{
  const ui = read('plugins/surfcore/lib/client.js')
  const bridge = read('src/bridge.js')
  const example = JSON.parse(read('config.example.json'))

  ok(ui.includes('const FIELD_META = {'), '设置页有成本标签表')
  ok(ui.includes('"💰".repeat(meta.cost)'), '标签按档位显示 💰')
  ok(ui.includes('改完需重启 DSH'), '需要重启的设置项有明确标记')
  ok(ui.includes('^socialV2\\.tools\\.'), '工具开关自动带"重启"标记（工具表在 DSH 启动时固化）')
  ok(ui.includes('badge: f.badge'), '字段渲染会把 badge 传下去')

  ok(ui.includes('socialV2.sticker.matchEveryNWakes'), '设置页有表情推荐频率')
  ok(ui.includes('socialV2.tokenGuard.perGroupEnabled'), '设置页有每会话额度开关')
  ok(ui.includes('socialV2.tokenGuard.perGroupDailyCostCNY'), '设置页有每会话每日上限')

  ok(bridge.includes('function stickerMatchDueV2('), '桥接有表情推荐频率闸门')
  ok(bridge.includes('stickerMatchDueV2(key) ? stickerMatchFor(messages)'), 'unread 路径接了频率闸门')
  ok(bridge.includes('stickerMatchDueV2(key) ? stickerMatchFor(newMessages)'), 'wait 路径接了频率闸门')
  ok(bridge.includes('function perGroupSpentToday('), '桥接有按会话当日花费查询（带缓存）')
  ok(bridge.includes('per-group-budget'), '超每会话额度会结构化拒绝唤醒')

  ok(example.socialV2?.sticker?.matchEveryNWakes === 1, '示例配置：表情推荐默认每次都带')
  ok(example.socialV2?.tokenGuard?.perGroupEnabled === false, '示例配置：每会话额度默认关')
  ok(example.socialV2?.tokenGuard?.perGroupDailyCostCNY === 0, '示例配置：每会话上限默认 0')

  // 搜索框：QQ 页与全部参数页都要有（用户第 13 条：293 项靠翻找不到）
  const qqStart = ui.indexOf('function QQTab(')
  const advStart = ui.indexOf('function AdvancedTab(')
  ok(qqStart > 0 && ui.slice(qqStart, qqStart + 800).includes('setQuery'), 'QQ 页有搜索框')
  ok(advStart > 0 && ui.slice(advStart, advStart + 800).includes('setQuery'), '全部参数页有搜索框')
}

console.log(`\n🚀 会话滚动 + 合并窗口测试通过（${passed} 项）`)
