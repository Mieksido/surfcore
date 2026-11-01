// 每天四类动态（2026-10-21 管理员定）
//
//   08:00 一类 best   ：当天评分最高的视频          → 50~100 字
//   12:00 二类 game   ：六款游戏之一的 AI 二创（轮换）→ 60~200 字
//   16:00 三类 anime  ：动漫（MAD/新番导视/番剧评价/资讯）→ 60~200 字
//   20:00 四类 gaming ：游戏区视频（解说/实况/评测/整活） → 60~200 字
//
// 每类**各自一天一条**，各有固定开头（脚本会自动补到最前面 ✓）。
// 共同规则：公开发给所有人（正文不许 @ 人）· 配图自动挑。
//
//   node bili.mjs daily --text "…" [--kind best|game|anime|gaming] [--bvid BV] [--image 路径] --dry|--go
import { accountBili, biliState, biliStateDir } from '../lib/state-paths.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bestToday, todayScores } from '../lib/scores.mjs'
import { currentGame, advanceRotation, GAMES } from '../lib/games.mjs'
import { rememberKind } from '../lib/my-dynamics.mjs'
import { kindsNow, dynamicsEnabled, dynamicsGapMin, slotOf, dueKind, withPrefix, stripPrefix, CATCHUP_DAY } from '../lib/kinds.mjs'
import { config } from '../lib/config.mjs'
import { assertInteractEnabled } from '../lib/interact.mjs'
import { hasKindSignal } from '../lib/kind-signals.mjs'
import { ownerOf, findVideoDynamic, createForward, verifyForward } from '../lib/forward.mjs'
import { pinOf, clearPin } from '../lib/pins.mjs'

// ── 自举：换用 DSH 自带的 node 24.21（PATH 的 24.19 有 libuv 崩溃）──
{
  const home = process.env.USERPROFILE || process.env.HOME || '.'
  const rt = process.env.DSH_NODE
    || path.join(home, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe')
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
  if (!process.env.DAILY_BOOTSTRAPPED && fs.existsSync(rt) && !same(process.execPath, rt)) {
    const r = spawnSync(rt, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      stdio: 'inherit', env: { ...process.env, DAILY_BOOTSTRAPPED: '1' },
    })
    process.exit(r.status ?? 1)
  }
}

const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  const a = argv[i]
  if (a.startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) opt[a.slice(2)] = true
    else { opt[a.slice(2)] = v; i += 1 }
  }
}
const DRY = !!opt.dry
const GO = !!opt.go
if (DRY === GO) { console.error('必须且只能给一个 --dry 或 --go'); process.exit(2) }
if (GO && !assertInteractEnabled('发动态')) process.exit(3)

const KIND = String(opt.kind ?? '')
// 2026-10-22：四类动态的开关/时段/长度/前缀读设置页（bili.config.json 的 dynamics 段）。
const CFG = config()
const KINDS_NOW = kindsNow(CFG)
const KIND_KEYS_NOW = Object.keys(KINDS_NOW)
if (!KIND_KEYS_NOW.includes(KIND)) {
  console.error(`✗ --kind 必填，只能是：${KIND_KEYS_NOW.map((k) => `${k}（${KINDS_NOW[k].label}，${KINDS_NOW[k].slot}:00）`).join(' · ')}`)
  process.exit(2)
}
if (!dynamicsEnabled(CFG)) {
  console.error('✗ 四类动态的总开关在设置页里关掉了（dynamics.enabled=false）—— 先打开再发 ✗')
  process.exit(2)
}
const K = KINDS_NOW[KIND]
if (K.enabled === false) {
  console.error(`✗ 「${K.label}」这一类在设置页里关掉了（dynamics.kinds.${KIND}.enabled=false）✗`)
  process.exit(2)
}
/** 任意两条动态之间的最小间隔（分钟）—— 默认 30，设置页可改 */
const GAP_MIN = dynamicsGapMin(CFG)

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const STATE = biliState('daily-dynamic.json')
const MEMES = accountBili('memes')
const TMP = accountBili('tmp')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const today = () => new Date().toLocaleDateString('sv-SE')
const UA = { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' }

const RAW = String(opt.text ?? '').trim()
const BODY = stripPrefix(KIND, RAW, KINDS_NOW)   // 去前缀后的"正文"，数字数用这个
const BVARG = String(opt.bvid ?? '').trim()
// 2026-10-21：管理员会先看候选再拍板 —— 他钦定了哪条，就**照办**（覆盖 --bvid ✓）
const PINNED = pinOf(KIND)

// ── 状态（先读，补发要用）──────────────────────────────────────
function loadState() {
  let j = {}
  try { j = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch {}
  if (j && j.date && !j.best && !j.game && !j.anime && !j.gaming) return { best: j }
  return j ?? {}
}
const st = loadState()
if (st[KIND]?.date === today()) {
  const s = st[KIND]
  console.error(`✗ 今天这类（${K.label}）已经发过了（${s.atText ?? '?'} · ${s.bvid ?? '?'} · dyn=${s.dynId ?? '?'}）—— 每类一天一条 ✗`)
  process.exit(4)
}

// ── 全局间隔：**任意两条动态之间 ≥30 分钟**（2026-10-21 管理员定）──────────
//   他要求补发时一条一条来，别 1 分钟连发两条（看起来像刷屏）
{
  const lastAny = Object.values(st)
    .map((s) => new Date(s?.at ?? 0).getTime())
    .filter((t) => Number.isFinite(t) && t > 0)
    .sort((a, b) => b - a)[0] ?? 0
  if (lastAny && Date.now() - lastAny < GAP_MIN * 60_000) {
    const wait = Math.ceil((GAP_MIN * 60_000 - (Date.now() - lastAny)) / 60_000)
    console.error(`✗ 上一条动态刚发不久（${new Date(lastAny).toLocaleTimeString('zh-CN', { hour12: false })}）—— 两条之间要隔 ${GAP_MIN} 分钟，还差 ${wait} 分钟 ✗`)
    process.exit(3)
  }
}

// ── 时段：08–12 / 12–16 / 16–20 / 20–24 ───────────────────────
//   --catchup（2026-10-21 管理员定）：重启后补发今天错过的那些，
//   放宽"必须在时段内"，但仍要求 ① 这个点的时刻已经过去 ② 两条补发之间隔 ≥30 分钟
const CATCHUP = !!opt.catchup
if (CATCHUP) {
  // 2026-10-21 管理员定：**只有上线日（CATCHUP_DAY）允许补发**，明天起照常
  if (today() !== CATCHUP_DAY) {
    console.error(`✗ 今天不是补发日（只有 ${CATCHUP_DAY} 那天允许补发）—— 按正常时段发，错过了就等明天 ✗`)
    process.exit(3)
  }
  const now = new Date()
  const h = now.getHours() + now.getMinutes() / 60
  if (h < K.slot) {
    console.error(`✗ 「${K.label}」还没到点（${String(K.slot).padStart(2, '0')}:00 起）—— 现在 ${now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}，不能提前补 ✗`)
    process.exit(3)
  }
  const lastAt = Object.values(st).map((s) => new Date(s?.at ?? 0).getTime()).filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => b - a)[0] ?? 0
  if (lastAt && Date.now() - lastAt < GAP_MIN * 60_000) {
    const wait = Math.ceil((GAP_MIN * 60_000 - (Date.now() - lastAt)) / 60_000)
    console.error(`✗ 补发也要隔 ${GAP_MIN} 分钟 —— 上一条刚发不久，还差 ${wait} 分钟 ✗`)
    process.exit(3)
  }
  console.log(`[补发] 今天「${K.label}」错过了时段，这次按补发走（间隔 ${GAP_MIN} 分钟 ✓）`)
} else if (!slotOf(KIND, new Date(), KINDS_NOW)) {
  const now = new Date()
  const due = dueKind(now, KINDS_NOW)
  console.error(`✗ 「${K.label}」的发布时段是 ${K.slot}:00 起（到下一类为止）—— 现在 ${now.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}，不是它的时候 ✗`)
  console.error(due ? `   现在该发的是「${KINDS_NOW[due].label}」` : '   今天的时段都过完了，明天请早（不后补）')
  console.error(`   如果是要补今天错过的，加 --catchup（两条之间要隔 ${GAP_MIN} 分钟）`)
  process.exit(3)
}

// ── 质量与选题 ────────────────────────────────────────────────
// 信号正则在 lib/kind-signals.mjs（可单测）；这里只保留各档的硬门槛。
const LIMITS = {
  best: { days: 999, play: 0, likeRate: 0 },
  game: { days: 21, play: 2000, likeRate: 0.02 },
  anime: { days: 14, play: 5000, likeRate: 0.025 },
  gaming: { days: 14, play: 5000, likeRate: 0.025 },
}

async function viewOf(bvid) {
  try {
    const j = await (await fetch('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid, { headers: UA })).json()
    const d = j?.data
    if (!d) return null
    return {
      title: String(d.title ?? ''), desc: String(d.desc ?? ''), pic: String(d.pic ?? ''),
      pubdate: Number(d.pubdate ?? 0), dur: Number(d.duration ?? 0), tname: String(d.tname ?? ''),
      play: Number(d.stat?.view ?? 0), like: Number(d.stat?.like ?? 0), danmaku: Number(d.stat?.danmaku ?? 0), fav: Number(d.stat?.favorite ?? 0),
    }
  } catch { return null }
}

let meta = {}
let bv = BVARG

if (KIND === 'best') {
  const best = bestToday()
  if (!best) { console.error('✗ 今天还没评过分 —— 先用 `score <BV> --score N` 记分，再发 ✗'); process.exit(5) }
  bv = bv || best.bv
  if (bv !== best.bv) {
    console.error(`✗ 这类必须写当天评分最高的那条：现在是 ${best.bv}（${best.score}/20），你给的是 ${bv} ✗`)
    process.exit(5)
  }
  meta = { title: best.title, score: best.score }
} else {
  // 管理员钦定过就用他那条（一类除外 —— 一类必须是最高分）
  if (PINNED) {
    if (bv && bv !== PINNED) console.log(`  钦定覆盖：你在命令里给了 ${bv}，但管理员拍板的是 ${PINNED} ✓`)
    bv = PINNED
    console.log(`  本条用管理员钦定的视频：${PINNED} ✓`)
  }
  let game = ''
  if (KIND === 'game') {
    game = currentGame()
    if (!bv) { console.error(`✗ 二类要指定视频：--bvid <BV>（今天是「${game}」）`); process.exit(5) }
  } else if (!bv) {
    console.error(`✗ ${K.label}要指定视频：--bvid <BV>（先跑 \`gamefeed --for ${KIND}\` 看候选）`)
    process.exit(5)
  }
  const v = await viewOf(bv)
  if (!v) { console.error(`✗ 拿不到 ${bv} 的信息（视频不存在 / 被删 / 接口抽风）`); process.exit(5) }
  const text = `${v.title} ${v.desc} ${v.tname}`
  const days = Math.floor((Date.now() / 1000 - v.pubdate) / 86400)
  const likeRate = v.play ? v.like / v.play : 0
  const L = LIMITS[KIND]
  const bad = []
  if (KIND === 'game') {
    if (!GAMES.includes(game)) bad.push(`轮换的游戏名异常：${game}`)
    if (!text.includes(game)) bad.push(`标题/简介里没有「${game}」`)
    if (!hasKindSignal('game', text)) bad.push('标题/简介里没有 AI 二创的信号')
  } else if (KIND === 'anime' && !hasKindSignal('anime', text)) {
    bad.push('标题/简介里没有动漫/MAD/新番的信号')
  } else if (KIND === 'gaming' && !hasKindSignal('gaming', text)) {
    bad.push('标题/简介里没有游戏区的信号')
  }
  if (days > L.days) bad.push(`太旧了（${days} 天前，上限 ${L.days} 天）`)
  if (v.play < L.play) bad.push(`播放太低（${v.play} < ${L.play}）`)
  if (likeRate < L.likeRate) bad.push(`点赞率太低（${(likeRate * 100).toFixed(1)}% < ${(L.likeRate * 100).toFixed(1)}%）`)
  if (v.dur < 15) bad.push(`太短（${v.dur}s）`)
  if (bad.length) {
    console.error(`✗ 这条不够格当「${K.label}」的推荐：`)
    for (const b of bad) console.error(`   · ${b}`)
    console.error(`   换一条 —— 先 \`gamefeed${KIND === 'game' ? '' : ' --for ' + KIND}\` 看候选，再 debrief 确认 ✓`)
    process.exit(5)
  }
  meta = { game: game || null, title: v.title, play: v.play, like: v.like, days, score: null }
  console.log(`[${K.n}类] ${K.label}：${bv} 通过质量核对 ✓`)
  console.log(`  ${v.title.slice(0, 50)} · ${v.play} 播放 · 赞/播 ${(likeRate * 100).toFixed(1)}% · ${days} 天前${game ? ' · ' + game : ''}`)
}

// ── 正文字数（不算前缀）──────────────────────────────────────
const n = [...BODY].length
if (n < K.minLen || n > K.maxLen) {
  console.error(`✗ 「${K.label}」正文要 ${K.minLen}~${K.maxLen} 字（现在 ${n} 字，前缀不算）`)
  process.exit(6)
}

// ── 公开发给所有人：正文里不许 @ 人 ───────────────────────────
{
  let ownerName = ''
  let ownerTitle = ''
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(HOME, '.dsh', 'surfcore', 'bili.config.json'), 'utf8'))
    ownerName = String(cfg?.owner?.name ?? '').trim()
    ownerTitle = String(cfg?.persona?.ownerTitle ?? '').trim()
  } catch {}
  if (ownerName && BODY.includes('@' + ownerName)) {
    console.error(`✗ 这条动态是**推给所有人**的 —— 不要 @ ${ownerName} ✗`)
    process.exit(7)
  }
  if (/^\s*@|[@＠]\S/.test(BODY)) {
    console.error('✗ 这条动态是**推给所有人**的 —— 正文里别 @ 人 ✗')
    process.exit(7)
  }
  const mentionsOwner = (ownerName && BODY.includes(ownerName)) || (ownerTitle && BODY.includes(ownerTitle))
  const toEveryone = /(大家|各位|所有人|看到的人|路过的|推荐|安利|一起看|都来)/.test(BODY)
  if (mentionsOwner && !toEveryone) {
    console.log(`  ⚠️ 读起来像只跟 ${ownerName} 说的 —— 动态是推给所有人的，建议换成"给大家…"的口吻 ✓`)
  }
}

// 最终发出去的正文 = 固定前缀 + 正文 + **视频链接**（2026-10-21 管理员要求：动态必须能点开视频）
//   ⚠️ 只发文字+链接，**不再配图** —— 图片不算分享视频（他删过一条只有图的 ✗）
const VIDEO_URL = `https://www.bilibili.com/video/${bv}/`
const TEXT = `${withPrefix(KIND, BODY, KINDS_NOW)}\n${VIDEO_URL}`

// ── 旧配图工具（现在默认不用了；留着给 --image 之外的手动用）─────────
function pickMeme() {
  try {
    const files = fs.readdirSync(MEMES).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
    if (!files.length) return ''
    return path.join(MEMES, files[Math.floor(Math.random() * files.length)])
  } catch { return '' }
}
async function fetchCover(bvid) {
  try {
    fs.mkdirSync(TMP, { recursive: true })
    const v = await viewOf(bvid)
    let pic = v?.pic ?? ''
    if (!pic) return ''
    if (pic.startsWith('//')) pic = 'https:' + pic
    const r = await fetch(pic, { headers: UA })
    if (!r.ok) return ''
    const ext = /\.png/i.test(pic) ? '.png' : '.jpg'
    const out = path.join(TMP, `cover-${bvid}${ext}`)
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()))
    return fs.statSync(out).size > 2000 ? out : ''
  } catch { return '' }
}

// ── 配图：**默认不用**（动态是"分享视频"，靠正文里的链接 ✓）──────
//   只有显式给 --image 才配图；以前默认配表情包/封面 → 被管理员否掉 ✗
const explicit = typeof opt.image === 'string' ? String(opt.image) : ''
const image = explicit && fs.existsSync(explicit) ? explicit : ''
const imageSrc = image ? '手动指定' : ''

// ── 打印 ──────────────────────────────────────────────────────
console.log(`[${K.n}类·${K.label}] ${bv}${meta.score ? `（今天最高分 ${meta.score}/20）` : ''}`)
console.log('  这是**公开发给所有人**的动态（推给关注你的人，不是私信、不是只给管理员看）')
if (meta.title) console.log(`  视频：${meta.title.slice(0, 50)}`)
console.log(`  正文 ${n} 字 + 固定前缀：${TEXT.slice(0, 60)}…`)
console.log(`  视频链接：${VIDEO_URL}（点了能跳 ✓）`)
console.log(`  配图：${image ? imageSrc + ' · ' + path.basename(image) : '无（只发文字 + 视频链接）'}`)

// ── 发 ────────────────────────────────────────────────────────
function nodeExe() {
  const cands = [
    process.env.DSH_NODE,
    path.join(HOME, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    process.execPath,
  ]
  for (const c of cands) { try { if (c && fs.existsSync(c)) return c } catch {} }
  return process.execPath
}
const NODE = nodeExe()

// ── 优先发「视频卡片」：转发这条视频已有的 AV 动态（2026-10-21 验证可行）──
//   找不到就退回"文字 + 链接"（老办法，链接也能点 ✓）
let avDyn = null
try {
  const up = await ownerOf(bv)
  if (up) avDyn = await findVideoDynamic(bv, up)
} catch {}
if (avDyn) console.log(`  卡片：找到这条视频的动态（${avDyn.id}），发成**转发**→ 可点视频卡片 ✓`)
else console.log('  卡片：没找到这条视频的 AV 动态 → 退回"文字 + 链接"')

if (DRY) {
  console.log(avDyn
    ? `\n[dry] 会转发 ${avDyn.id}，正文 ${n} 字 + 前缀 ✓`
    : '\n[dry] 会发文字动态（正文 + 视频链接）✓')
  console.log('[dry] 未发布。确认文案后把 --dry 换成 --go ✓')
  process.exit(0)
}

let out = ''
if (avDyn) {
  const r = await createForward(avDyn.id, TEXT)
  if (r.ok && r.id) {
    out = `dyn_id=${r.id}`
    const v = await verifyForward(r.id, bv)
    console.log(`  ✓ 已转发 ${avDyn.id} → 新动态 ${r.id}（type=${v?.type ?? '?'}，卡片=${v?.bvid || '?'}）`)
  } else {
    console.log(`  ⚠️ 转发失败（code=${r.code} ${r.message}）→ 退回文字 + 链接`)
  }
}
if (!out) {
  const target = image
    ? [path.join(HERE, 'dynamic-image.mjs'), '--image', image, '--text', TEXT]
    : [path.join(HERE, 'dynamic.mjs'), 'post', '--text', TEXT]
  target.push('--go')
  try {
    out = execFileSync(NODE, target, { encoding: 'utf8', timeout: 180_000 })
    process.stdout.write(out)
  } catch (e) {
    const text = String(e.stdout ?? '') + String(e.stderr ?? '')
    process.stdout.write(text)
    if (!/dyn_id|dynId|动态已发布/.test(text)) { console.error('✗ 发布失败（见上面输出）'); process.exit(1) }
    console.log('  ⚠️ 子进程退出时崩了一下（node 24.19 的 libuv bug），但输出完整 → 按成功处理 ✓')
    out = text
  }
}

// ── 记账 ──────────────────────────────────────────────────────
const dynId = (out.match(/dyn_id[=: ]+(\d+)/i) ?? out.match(/dynId[=: ]+(\d+)/i) ?? [])[1] ?? ''
const at = new Date().toISOString()
const atText = new Date().toLocaleTimeString('zh-CN', { hour12: false })
st[KIND] = {
  date: today(), at, atText, kind: KIND, bvid: bv,
  game: meta.game ?? null, score: meta.score ?? null, chars: n,
  image: image ? path.basename(image) : null, dynId,
}
fs.mkdirSync(path.dirname(STATE), { recursive: true })
fs.writeFileSync(STATE, JSON.stringify(st, null, 2) + '\n')
try { clearPin(KIND) } catch {}

if (KIND === 'game') advanceRotation(meta.game)
if (dynId) {
  try {
    const cred = JSON.parse(fs.readFileSync(accountBili('credentials.json'), 'utf8'))
    const r = await rememberKind(cred, dynId, KIND)
    if (r?.ok) console.log(`  ✓ 已记住这条动态（评论 oid=${r.oid}）—— 以后回评自动记「${K.label}动态回复」账`)
  } catch {}
}

try {
  fs.appendFileSync(biliState('whale-log.jsonl'), JSON.stringify({
    at, kind: 'daily-dynamic', target: `BV:${bv}`,
    note: `${K.n}类（${K.label}）动态：${BODY.slice(0, 50)}`,
  }) + '\n')
} catch {}
console.log(`\n✓ 今天这类动态发出去了${dynId ? '（dyn=' + dynId + '）' : ''} —— 同类今天不能再发 ✓`)
