// Post ONE bilibili comment on the user's behalf. Explicitly single-shot.
//
//   node bili-comment.mjs --oid <aid> --bvid <BV...> --message "@昵称 正文" --dry
//   node bili-comment.mjs --oid <aid> --bvid <BV...> --message "@昵称 正文" --go
//
// Credentials live in a file outside the workspace and are never printed:
//   %USERPROFILE%\.dsh\surfcore\bili\credentials.json  -> { sessdata, bili_jct, buvid3 }
//
// --dry  : identifies the account behind the cookie (nav), builds and prints the
//          exact request, prints nothing postable. No write to bilibili.
// --go   : the same, then POSTs exactly once and prints the API result.
//
// 鱼群保护（--auto 且非 --share 时默认生效）：
//   · 鱼太多 → 拒绝发新楼层，自动改成回复一条合适的鱼（--no-fish-gather 可关）；
//   · 发完后顺手给识别到的鱼点赞（受每日上限约束，见 lib/fish-guard.mjs）。
import { accountBili, biliState, biliStateDir } from '../lib/state-paths.mjs'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { config } from '../lib/config.mjs'
import { assertInteractEnabled, checkCommentAge, printAgeBlock } from '../lib/interact.mjs'
// 2026-10-20（管理员定）：普通评论的硬闸门 —— 想说话就说话，但别把自己说成刷屏号 ✗
//   一天 30 条 · 同一 UP 10 分钟 ≤1 · 同一视频 60 分钟 ≤1（默认值在 lib/limits.mjs；
//   2026-10-22 起可在设置页 / bili.config.json 的 limits 段改）
import { checkFree, upOf } from '../lib/free-gate.mjs'
import { freeLimits } from '../lib/limits.mjs'
import {
  fishGuardStatusText, likeFishComments, loadFishGuardState, markGathered,
  normalizeBiliFishGuard, planFishGuard, recordFishGuardCheck,
} from '../lib/fish-guard.mjs'
import { myDynamicKinds } from "../lib/my-dynamics.mjs"
import { assertOutboundIdentitySafe } from '../lib/outbound-guard.mjs'
import { findByParent as findAttack, setStatus as setAttackStatus } from '../lib/attacks.mjs'

// ── 限额闸（B 档「限额自主」的代码强制部分，2026-10-14 主人选 B 档）────────────────
// 语义：闸门**只管自主发言**（带 --auto，即"她自己决定说的"）；主人当场授权的发言不拦 ✓
// 这一层存在的理由：主人明确要求"限频写进代码，不是写进你的自觉里"。
// --share（2026-10-17 加）：分享型 —— "把看到的好东西 @ 主人"。它**不看白名单**，
//   但受**每日合计 ≤3**、**同一视频 7 天内一次**两条硬限制（由 quota.mjs 强制）。
const AUTO = process.argv.includes('--auto')
const SHARE = process.argv.includes('--share')
// --once-per-person（2026-10-17 加）：同一个人 30 天内最多只回一条（只对"回复某人"生效）。
// 2026-10-18 接线：不传旗标时按配置决定（config.listen.oncePerPerson ✓ 设置页那个开关）
//   —— 只在"回复某人"（带 --parent）时生效；分享/顶层评论不受影响 ✓
const ONCE = process.argv.includes('--once-per-person')
  || (process.argv.includes('--parent') && config().listen?.oncePerPerson === true)
const ONCE_DAYS = 30
// --ta（2026-10-20 管理员定）：主动**搭话** —— 她去热评下面接一句（楼中楼，但算"她主动"）
//   不带 --ta 的楼中楼 = 回"找她的人"（回复她的评论 / @她）✓
//   两本账分开记：reply 50/天、ta 15/天（以前共用一本，分不清到底是谁在说 ✗）
const TA = process.argv.includes('--ta')
// --mine（2026-10-21 管理员定）：回**自己动态**底下的评论 —— 单独两本账
//   四类动态各 10 条/天 · 每类每人 1 条（默认值；2026-10-22 起可配置）
//   一般**不用手动加**：type=11 或 17、且 oid 命中"我发过的动态"会自动识别（含属于哪一类 ✓）
//   手动兜底：--mine（当一类）或 --mine game（当二类）
const MINE_RAW = (() => {
  const i = process.argv.indexOf('--mine')
  if (i === -1) return ''
  const v = process.argv[i + 1]
  return (v && !v.startsWith('--')) ? v : 'best'
})()
const MINE = !!MINE_RAW
const REPLIED = biliState('replied.json')
const loadReplied = () => { try { return JSON.parse(fs.readFileSync(REPLIED, 'utf8')) } catch { return { byUid: {} } } }
const saveReplied = (o) => { try { fs.mkdirSync(path.dirname(REPLIED), { recursive: true }); fs.writeFileSync(REPLIED, JSON.stringify(o, null, 2) + '\n') } catch {} }
// 查出"被回复的那个人"是谁（reply/reply 里 rpid === parent 的那条的作者）
// 2026-10-21：type 参数化 —— 动态评论是 type=11，不能写死 1 ✗
async function parentAuthor(aid, rootRpid, parentRpid, replyType = 1) {
  for (let pn = 1; pn <= 4; pn += 1) {
    const j = await (await fetch(`https://api.bilibili.com/x/v2/reply/reply?type=${replyType}&oid=${aid}&root=${rootRpid}&pn=${pn}&ps=20`, {
      headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/' },
    })).json()
    const list = j.data?.replies ?? []
    const hit = list.find((r) => String(r.rpid) === String(parentRpid))
    if (hit) return {
      mid: String(hit.mid ?? hit.member?.mid ?? ''),
      name: hit.member?.uname ?? '',
      ctime: Number(hit.ctime) * 1000 || 0,
    }
    if (!list.length) break
  }
  return null
}
const quota = (args) => {
  try {
    return { code: 0, out: execFileSync(process.execPath,
      [path.join(path.dirname(fileURLToPath(import.meta.url)), 'quota.mjs'), ...args], { encoding: 'utf8' }).trim() }
  } catch (e) { return { code: e.status ?? 1, out: String(e.stdout ?? e.message).trim() } }
}

const args = new Map()
for (let i = 2; i < process.argv.length; i += 1) {
  const a = process.argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), process.argv[i + 1]?.startsWith('--') ? true : process.argv[++i] ?? true)
}
const oid = args.get('oid')
const bvid = args.get('bvid')
let message = args.get('message')
let root = args.get('root')     // 线程根评论 rpid（二级回复用）
let parent = args.get('parent') // 要回复的那条评论 rpid
// type=1 视频（默认）；type=11 动态/图文；type=17 转发动态/新版动态。
// ⚠️ 动态的 oid 必须用 polymer/web-dynamic/v1/detail 的 basic.comment_id_str
//   （新版转发动态里它通常就等于 dyn_id，但收货箱的 subject_id 可能被 JS 精度截断，
//    见 lib/msgfeed.mjs 的 19 位 id 处理）。
const type = String(args.get('type') ?? '1')
if (!['1', '11', '17'].includes(type)) {
  console.error('--type 只能是 1（视频）| 11（图文/动态）| 17（转发动态）')
  process.exit(2)
}
// 动态评论的 referer 要指到 opus 页；给了它就可以不给 --bvid。
const refererArg = args.get('referer') ? String(args.get('referer')) : ''
const dry = args.get('dry') === true || args.has('dry')
const go = args.get('go') === true || args.has('go')

if (!oid || (!bvid && !refererArg) || !message) {
  console.error('usage: --oid <aid|comment_id_str> [--bvid <BV...> | --referer <url>] --message "<text>" [--type 1|11|17] [--root <rpid> --parent <rpid>] [--force-gather|--no-force-gather] [--no-fish-gather] [--dry | --go]')
  process.exit(2)
}
if (dry && go) { console.error('pick either --dry or --go, not both'); process.exit(2) }
if (!dry && !go) { console.error('refusing to run without an explicit --dry or --go'); process.exit(2) }
// 沉默逛：--dry 允许预览，--go 一律拒绝；不能只靠提示词自觉。
if (!dry && !assertInteractEnabled(AUTO ? '自动评论/回复' : '评论')) process.exit(3)

// --share（分享型）：正文里必须 @ 主人 —— 没写 @ 就自动补上。
// 昵称取配置的 owner.name（space/wbi/acc/info 可能被风控，不实时查）；
// 昵称改过的话，发完用 `thread` 看 `@到:` 就能发现（没解析出来就说明名字旧了）。
// --share（分享型）—— 2026-10-17 严格化（Kimi 评审指出两个洞）：
//   ① 必须与 --auto 同传：不然它就是"第三条自我声明车道"，绕开了自主发言那套判据
//   ② 正文**必须以 @<配置里的主人昵称> 开头**：以前"含个 @"就算数 → 一条 "@任何人 快来买" 也能过闸 ✗
if (SHARE) {
  // 2026-10-18 接线：设置页「分享评论」的总开关（关掉 = 只看不说 ✓）
  if (config().share?.enabled === false) {
    console.error('分享已在设置里关闭（share.enabled = false）→ 这次不发（筛/深读/日记照常 ✓）')
    process.exit(3)
  }
  if (!AUTO) { console.error('--share 必须与 --auto 同传（分享型也是"她自己决定说的"）'); process.exit(2) }
  const ow = config().owner ?? {}
  if (!ow.name) { console.error('--share 需要先配置 owner.name（要 @ 谁）'); process.exit(2) }
  // ── 「标尺」（2026-10-18 加，Kimi 提议 + 主人认可）────────────────────
  // 把"值不值"从感觉变成可审计的流程：
  //   ① --reason  必填（白纸黑字写"为什么值得占用主人一次注意力"）
  //   ② --score   必填且 ≥ config.share.minScore（默认 13 = 超过 12 分）
  //   ③ --rank    只能是 1（当天深读里的第一名 —— 相对比较比绝对打分稳）
  // 三项任一不过 → 拒绝发送；"今天没有值得发的"本身就是合法结果 ✓
  {
    const reason = String(args.get('reason') ?? '').trim()
    if (reason.length < 8) { console.error('--share 必须带 --reason "为什么值得占用主人一次注意力"（≥8 字）'); process.exit(2) }
    const minScore = Number(config().share?.minScore ?? 7)
    const score = Number(args.get('score'))
    if (!Number.isFinite(score) || String(args.get('score') ?? '') === '') { console.error(`--share 必须带 --score（每项 0-4，满 20；阈值 ${minScore}，超过 12 就发）`); process.exit(2) }
    if (score < minScore) { console.error(`✗ 评分 ${score} < 阈值 ${minScore} → 这条不值得发（"今天没有值得发的"是合法结果）`); process.exit(2) }
    const rank = Number(args.get('rank') ?? 1)
    if (rank !== 1) { console.error('--share 只允许 --rank 1（当天深读里的第一名）'); process.exit(2) }
    console.log(`[标尺] 分数 ${score}/20（阈值 ${minScore}：超过 12 就发）· 排名 #${rank} · 理由：${reason.slice(0, 60)}`)
  }

  const want = `@${ow.name}`
  // 2026-10-20（管理员定）：**分享评论里不许带链接** ✗
  //   实测：带 URL 的那条被 B站 判成 state=17（仅自己可见 / 审核中），匿名完全看不到；
  //   同一天另外 7 条不带链接的评论全是 state=0 真公开。
  //   → 自动把 URL 换成 BV 号（纯文本 B站 不拦 ✓），链接改由「报备」私信发给你 ✓
  {
    const before = String(message ?? '')
    const stripped = before.replace(/https?:\/\/\S+/gu, (u) => {
      const m = u.match(/BV[0-9A-Za-z]{10}/)
      return m ? m[0] : ''
    }).replace(/[ \t]{2,}/g, ' ').replace(/\s+([，。！？、])/g, '$1').trim()
    if (stripped !== before.trim()) {
      message = stripped
      console.log('[分享型] 正文里的链接已换成 BV 号（带链接会被平台吞 ✗）')
    }
  }
  const body = String(message ?? '').trimStart()
  if (!body.startsWith(want)) {
    if (body.includes('@')) { console.error(`--share 的正文必须以 "${want}" 开头（里面那个 @ 不是主人）→ 拒绝发送`); process.exit(2) }
    message = `${want} ${message}`
    console.log(`[分享型] 正文没 @，已自动补：${want}`)
  }
}

// "同一个人只回一条"（可选 · 2026-10-17 加）：只在二级回复（--root + --parent）时生效。
// 用在"只回直接回她的人"那条流程里 → 同一个人 30 天内不会被回第二次（防拉锯、防被当聊天机器人）。
// 放在入口处（--dry 也会跑），这样"能不能回"在发之前就能知道。
if (ONCE) {
  if (!parent || !root) {
    console.log('  [once] 没有 --root/--parent —— 这个开关只对"回复某人"生效，已忽略')
  } else {
    const who = await parentAuthor(oid, root, parent)
    if (!who?.mid) {
      // fail-closed（2026-10-17，Kimi 评审指出）：判重系统状态未知时，默认动作是**这次不回**
      console.error('  [once] 没查到被回复者的 uid → 判重状态未知，**这次不回**（fail-closed）')
      console.error('  （确认要回就别传 --once-per-person，或者先手工确认这个人没被回过）')
      process.exit(2)
    } else {
      const led = loadReplied()
      const hist = (led.byUid?.[who.mid] ?? []).filter((x) => Date.now() - new Date(x.at).getTime() < ONCE_DAYS * 86_400_000)
      if (hist.length) {
        console.error(`  [once] ${ONCE_DAYS} 天内已经回过 ${who.name || who.mid}（${hist[0].at} · ${hist[0].target}）→ 这次不回`)
        console.error('  （不想要这个开关，就别传 --once-per-person）')
        process.exit(2)
      }
      console.log(`  [once] ${who.name || who.mid} 在 ${ONCE_DAYS} 天内没被回过 ✓ 可以回`)
    }
  }
}

const credPath = accountBili('credentials.json')
if (!fs.existsSync(credPath)) {
  console.error(`credentials file missing: ${credPath}`)
  console.error('create it with {"sessdata":"...","bili_jct":"...","buvid3":"..."}')
  process.exit(3)
}
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'))
const missing = ['sessdata', 'bili_jct', 'buvid3'].filter((k) => !cred[k] || String(cred[k]).trim() === '')
if (missing.length) {
  console.error(`credentials file is missing values for: ${missing.join(', ')}`)
  process.exit(3)
}
const cookieHeader = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const referer = refererArg !== '' ? refererArg : `https://www.bilibili.com/video/${bvid}/`

// ---- WBI signing (harmless if the endpoint does not ask for it) -------------
const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
const keyOf = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
async function wbiSign(params) {
  const nav = await (await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader },
  })).json()
  const img = nav?.data?.wbi_img?.img_url
  const sub = nav?.data?.wbi_img?.sub_url
  if (!img || !sub) return null
  const raw = keyOf(img) + keyOf(sub)
  const mixin = MIXIN_TAB.map((i) => raw[i]).join('').slice(0, 32)
  const wts = Math.round(Date.now() / 1000)
  const clean = (v) => String(v).replace(/[!'()*]/g, '')
  const query = Object.keys({ ...params, wts })
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean(k === 'wts' ? wts : params[k]))}`)
    .join('&')
  const w_rid = crypto.createHash('md5').update(query + mixin).digest('hex')
  return { w_rid, wts, mixin }
}

// ---- who is behind this cookie? --------------------------------------------
const nav = await (await fetch('https://api.bilibili.com/x/web-interface/nav', {
  headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader },
})).json()
console.log('=== 登录态校验（只读） ===')
if (nav.code !== 0) {
  console.log(`  nav code=${nav.code} message=${nav.message}`)
  console.log('  → cookie 无效或已过期，先别发，重新复制一次')
  process.exit(4)
}
console.log(`  账号: ${nav.data.uname}   (mid ${nav.data.mid})`)
console.log(`  手机绑定: ${nav.data.mobile_verified ? '是' : '否'}   硬币 ${nav.data.money}`)
console.log('  ⚠️ 请确认这就是你的小号；若是主号，停手、换 cookie')

// ── 鱼群保护（B站评论区）────────────────────────────────────────────
// 只有"她自己决定说的"（--auto、非分享）才走这层；主人当场授权的发言不拦。
// 鱼太多 → 不发新楼层；能聚拢就改成回复鱼；2026-10-23 起默认强制聚拢（没有合适鱼楼也回一条）。
const fishCfg = normalizeBiliFishGuard(config().fishGuard)
const fishState = loadFishGuardState()
// 2026-10-23 用户定：每次醒来都强行聚拢并主动评论一次。
// 配置默认开；命令行 --no-force-gather 可临时关掉，--force-gather 可强制开。
const forceGather = args.get('no-force-gather') === true
  ? false
  : (args.get('force-gather') === true || fishCfg.forceGather !== false)
const hadThread = Boolean(root || parent)
// 评论年龄闸：明确太旧的评论不回复，避免挖 2023 年坟、骚扰早已离开的人。
if (hadThread) {
  try {
    const who = await parentAuthor(oid, root, parent, type)
    const age = checkCommentAge(who?.ctime)
    if (!age.ok) { printAgeBlock(age); process.exit(3) }
  } catch (error) {
    console.error(`⚠️ 评论年龄检查失败（按未知处理，不拦）：${String(error?.message ?? error).slice(0, 120)}`)
  }
}
let fishPlan = null
if (AUTO && !SHARE && fishCfg.enabled && !hadThread) {
  fishPlan = await planFishGuard({
    oid,
    type,
    bvid,
    selfMid: String(nav.data.mid ?? ''),
    ownerMid: String(config().owner?.mid ?? ''),
    config: fishCfg,
    state: fishState,
    forceGather,
    // 2026-10-23：必须带登录态，否则评论接口只回 0~3 条，识别不到鱼。
    cred,
  })
  // 2026-10-23：把这次检查结果记进 fish-guard.json 的 fishGuardLog；
  // 即使“鱼太多没发”，设置页也能看到原因（B站 鱼群保护记录）。
  if (fishPlan?.ok) {
    try { recordFishGuardCheck({ state: fishState, plan: fishPlan, oid, bvid, source: 'comment' }) } catch {}
  }
  if (fishPlan.ok) {
    console.log(`\n[鱼群保护] ${fishGuardStatusText(fishPlan)}`)
    if (fishPlan.flooded) {
      const noGather = args.get('no-fish-gather') === true
      const target = fishCfg.gatherEnabled && !noGather ? fishPlan.gatherTarget : null
      if (target) {
        const age = checkCommentAge(target.ctime)
        if (!age.ok) { printAgeBlock(age); process.exit(3) }
        root = target.rpid
        parent = target.rpid
        const mention = `@${target.uname || target.mid || target.rpid}`
        if (!String(message).startsWith(mention)) message = `${mention} ${message}`
        if (fishPlan.gatherFallback) {
          console.log('  → 没有满足条件的鱼楼；按「强制聚拢」选回复最少/最新的鱼楼，仍然回一条 ✓')
        }
        console.log(`  → 鱼太多，改成回 ${target.uname || target.rpid} 的楼层（rpid ${target.rpid}）`)
      } else if (go) {
        console.error('  → 鱼太多，且没有可聚拢的鱼楼：这次不发新楼层（留到下一趟）')
        process.exit(3)
      } else {
        console.log('  [dry] 真发时会被拒（鱼太多且没有可聚拢的鱼楼）')
      }
    }
  } else {
    console.log(`\n[鱼群保护] 检查失败，按正常流程继续：${fishPlan.error}`)
  }
}

// 2026-10-23 用户定：鱼群泛滥后的“聚拢回复”**占主动评论额度**（comment，30/天），
// 不是“回找我的人”的回复额度（reply，50/天）。这层楼其他人再回复她时，才走 reply。
const FISH_GATHER = Boolean(
  fishPlan?.ok && fishPlan.gatherTarget && parent
  && String(parent) === String(fishPlan.gatherTarget.rpid)
)
if (FISH_GATHER) {
  console.log('  [额度] 这条聚拢回复占**主动评论额度**（不是回复额度）；别人再回这层楼才占回复额度 ✓')
}

const params = { type, oid: String(oid), message, plat: '1', csrf: String(cred.bili_jct) }
if (root) params.root = String(root)
if (parent) params.parent = String(parent)
const signed = await wbiSign(params)
const body = new URLSearchParams(params).toString()
const url = signed
  ? `https://api.bilibili.com/x/v2/reply/add?w_rid=${signed.w_rid}&wts=${signed.wts}`
  : 'https://api.bilibili.com/x/v2/reply/add'

console.log('\n=== 将要发出的请求 ===')
console.log(`  POST  ${url}`)
console.log('  content-type: application/x-www-form-urlencoded')
console.log('  headers: UA(Chrome 131) + referer=' + referer)
console.log('  cookie : SESSDATA=***; bili_jct=***; buvid3=***   (已脱敏)')
console.log('  body   : ' + body.replace(encodeURIComponent(String(cred.bili_jct)), '***csrf***'))
console.log(`  正文长度 ${message.length} 字符（上限 1000）；oid=${oid}；emoji/表情需转义符，本脚本只发纯文本`)

// ── 待审队列闸（2026-10-21 管理员定）──────────────────────────────────
//   怀疑被攻击/阴阳怪气的评论，她会 `attack add` 记进队列 —— 那条**批准前一律不许回** ✗
let ATTACK = null
{
  const pend = parent ? findAttack(oid, parent) : null
  ATTACK = pend
  if (pend && pend.status === 'pending') {
    console.error(`✗ 这条在待审队列里（#${pend.seq} · ${pend.who || '?'}）—— 管理员还没批，现在不能回 ✗`)
    console.error(`   \`attack show ${pend.seq}\` 看详情；等管理员说"批 #${pend.seq}"再回 ✓`)
    process.exit(8)
  }
  if (pend && pend.status === 'rejected') {
    console.error(`✗ 这条管理员已经驳回（#${pend.seq}）—— 不理它，别再回 ✗`)
    process.exit(8)
  }
}

// ── 自由发言闸（2026-10-20 定 · 2026-10-21 加「自己动态」这本账）──────────
//   四本账分开：普通评论 / 回找我的人 / 主动搭话 / **自己动态下的回复**
//   共用同一条 2 分钟全局冷却 ✓  分享型（--share）有自己的一套，不在这里管 ✓
const GATE = AUTO && !SHARE
// 2026-10-21：**自动识别**自己动态 —— type=11/17 且 oid 命中"我发过的动态"，
//   还分得清是哪一类（best/game/anime/gaming）✓
//   2026-10-22 修：新版转发动态的 comment_type=17；只认 11 会把动态回复错记成"回找我的人"。
let DYN_KIND = ''   // '' | 'best' | 'game' | 'anime' | 'gaming'
if (GATE && parent && !TA && !FISH_GATHER && (String(type) === '11' || String(type) === '17')) {
  try {
    const r = await myDynamicKinds(cred)
    const k = r.ok ? r.map.get(String(oid)) : null
    if (k) {
      DYN_KIND = k
      const label = { best: '最高分视频', game: '游戏 AI 二创', anime: '动漫', gaming: '游戏区' }[k] ?? k
      console.log(`  [动态] 这条评论在**你自己那条「${label}」动态**底下 → 记「${label}动态回复」那本账 ✓`)
    }
  } catch {}
}
if (!DYN_KIND && MINE) DYN_KIND = MINE_RAW === 'game' ? 'game' : 'best'
const GATE_KIND = parent ? (TA ? 'ta' : FISH_GATHER ? 'comment' : DYN_KIND ? 'mine:' + DYN_KIND : 'reply') : 'comment'
let upMid = ''
let toMid = ''
if (GATE) {
  if (GATE_KIND === 'comment' && bvid) upMid = await upOf(bvid)
  // 自己动态那本账要按"对方 mid"限每人 1 条 → 得先查出被回复的人是谁
  if (GATE_KIND.startsWith('mine:') && parent && root) {
    try {
      const who = await parentAuthor(oid, root, parent, type)
      toMid = who?.mid ?? ''
    } catch {}
  }
  const g = checkFree({ kind: GATE_KIND, upMid, bvid, parent: parent ? String(parent) : '', toMid })
  console.log(`\n[自由发言闸] ${g.text}`)
  if (!g.ok) {
    const L = freeLimits(config())
    console.error(`  → 硬上限：评论 ${L.daily}/天 · 回找我的人 ${L.replyDaily}/天 · 搭话 ${L.taDaily}/天 · 动态回复 ${L.mineDaily}/天（每人 ${L.minePerPerson} 条）· 任意两条间隔 ≥${L.globalMin} 分钟 · 同一 UP ${L.perUpMin} 分钟 1 条 · 同一视频 ${L.perVideoMin} 分钟 1 条 · 同一条评论 ${Math.round(L.perThreadMin / 60)} 小时 1 次`)
    console.error('    （这些数字在设置页「额度（代码闸门）」里改，保存后下一轮生效）')
    if (dry) console.log('  [dry] 未发送。真发时会被拒 —— 换一条，或等冷却 ✓')
    else {
      console.error('  → 拒绝发送（想说的留到下一趟，别硬发 ✗）')
      process.exit(2)
    }
  }
}

if (dry) {
  console.log('\n[dry] 未发送。确认文案与账号后，把 --dry 换成 --go 再跑一次。')
  process.exit(0)
}

// 闸门：自主发言（--auto）或分享型（--share）才拦；主人授权的发言只显示额度
{
  const target = bvid ? `BV:${bvid}` : `oid:${oid}`
  const chk = quota(['check', '--type', 'comment', '--target', target, ...(SHARE ? ['--share'] : AUTO ? ['--auto'] : [])])
  console.log(`\n[限额闸] ${chk.out}`)
  if (chk.code !== 0) {
    console.error('  → 拒绝发送。这是硬约束第 4 条的代码实现，不要绕过（要发请主人当场授权，或改白名单/额度）。')
    process.exit(2)
  }
}

// 出站身份闸（2026-10-23 用户要求：只准自己互认，不许泄露主人和别人的信息）
// 公开面一旦把主人/别人的 QQ 号或 B站 mid 贴出去就收不回来；提示词只是概率约束，这里是硬拦。
try {
  assertOutboundIdentitySafe(message, { surface: 'B站 评论' });
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(9);
}
// 判重（--once-per-person）已在入口处检查，这里直接发
console.log('\n[go] 发送中…')
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'user-agent': UA,
    referer,
    origin: 'https://www.bilibili.com',
    'content-type': 'application/x-www-form-urlencoded',
    cookie: cookieHeader,
  },
  body,
})
const out = await res.json().catch(async () => ({ raw: await res.text() }))
console.log(`  HTTP ${res.status}`)
console.log(`  code=${out.code} message=${out.message ?? ''}`)
if (out.code === 0) {
  const rpid = out.data?.rpid_str ?? out.data?.rpid
  console.log(`  ✅ 已发布，评论 rpid=${rpid}`)
  // 鱼群保护：这条如果是“聚拢”到某条鱼楼的回复，记一笔，避免下次又回同一条。
  if (fishPlan?.ok && fishPlan.gatherTarget && parent
      && String(parent) === String(fishPlan.gatherTarget.rpid)) {
    markGathered(fishState, fishPlan.gatherTarget.rpid)
    console.log(`  [鱼群保护] 已记录聚拢目标 rpid=${fishPlan.gatherTarget.rpid}`)
  }
  // 顺手给识别到的鱼点赞（只在她自己决定说话时；有每日/每次上限）。
  // 2026-10-23：先等一会儿再点。刚发完评论就在同一视频里连点，B站 很容易 -509。
  if (fishPlan?.ok && fishCfg.likeEnabled && fishPlan.likeTargets?.length) {
    const waitMs = Math.max(0, Number(fishCfg.likeAfterCommentMs) || 0)
    if (waitMs > 0) {
      console.log(`  [鱼群保护] ${Math.round(waitMs / 1000)} 秒后再点赞（避免刚发完评论就触发风控）…`)
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
    const liked = await likeFishComments({
      targets: fishPlan.likeTargets,
      oid,
      type,
      bvid,
      cred,
      state: fishState,
      config: fishCfg,
    })
    if (liked.liked.length) console.log(`  [鱼群保护] 已给 ${liked.liked.length} 条鱼点赞（今天 ${liked.dailyLikes ?? '?'}/${fishCfg.maxLikesPerDay}）`)
    if (liked.failed.length) {
      console.log(`  [鱼群保护] ${liked.failed.length} 条点赞失败（不影响评论）：`)
      for (const f of liked.failed) console.log(`    ✗ rpid=${f.rpid} code=${f.code ?? '?'} ${f.message ?? f.error ?? ''}`)
    }
    if (liked.skipped.length) console.log(`  [鱼群保护] 点赞跳过：${liked.skipped.slice(0, 3).join('；')}`)
    if (liked.blockedUntil) console.log(`  [鱼群保护] 点赞已进入风控冷却，到 ${new Date(liked.blockedUntil).toLocaleString('zh-CN')}`)
  }
  // 2026-10-21：如果这是待审队列里"已批准"的那条，回完标成 replied ✓
  if (ATTACK && ATTACK.status === 'approved') {
    try { setAttackStatus(ATTACK.seq, 'replied'); console.log(`  [待审] #${ATTACK.seq} 已回，标记 replied ✓`) } catch {}
  }
  // once-per-person：记一笔"回过谁"，下次判重用
  if (ONCE && parent && root) {
    try {
      const who = await parentAuthor(oid, root, parent)
      if (who?.mid) {
        const led = loadReplied()
        led.byUid ??= {}
        led.byUid[who.mid] ??= []
        led.byUid[who.mid].push({ at: new Date().toISOString(), target: bvid ? `BV:${bvid}` : `oid:${oid}`, rpid, name: who.name })
        // 只留 30 天内的记录，别把文件养大
        for (const k of Object.keys(led.byUid)) {
          led.byUid[k] = led.byUid[k].filter((x) => Date.now() - new Date(x.at).getTime() < ONCE_DAYS * 86_400_000)
          if (!led.byUid[k].length) delete led.byUid[k]
        }
        saveReplied(led)
        console.log(`  [once] 已记账：${who.name || who.mid}（30 天内不再回他）`)
      }
    } catch (e) { console.log(`  [once] 记账失败（不影响已发出的评论）：${String(e.message).slice(0, 80)}`) }
  }
  // 记账（发出去才算数）
  // 2026-10-20：多记 up / reply / ta / parent —— lib/free-gate.mjs 靠它分三本账 ✓
  const rec = quota(['record', '--type', 'comment', '--target', bvid ? `BV:${bvid}` : `oid:${oid}`,
    '--note', message.replace(/\s+/g, ' ').slice(0, 40),
    ...(upMid ? ['--up', String(upMid)] : []),
    ...(parent && !FISH_GATHER ? ['--reply'] : []),
    ...(parent && TA ? ['--ta'] : []),
    ...(parent && DYN_KIND ? ['--mine', DYN_KIND] : []),
    ...(toMid ? ['--to-mid', String(toMid)] : []),
    ...(parent ? ['--parent-id', String(parent)] : []),
    ...(SHARE ? ['--share'] : AUTO ? ['--auto'] : [])])
  console.log(`  [限额闸] ${rec.out}`)
  // 自主 / 分享型 → **自动报备**（把 AGENTS 里的"约定"落到代码里；后端由 config.notify 决定）
  if (AUTO || SHARE) {
    try {
      // 2026-10-21（管理员定）：**主动搭话必须单独报备**，带【主动搭话】tag + 视频链接
      const isTa = !!TA
      const link = ((SHARE || isTa) && bvid) ? `\nhttps://www.bilibili.com/video/${bvid}/` : ''
      const msg = isTa
        ? `【主动搭话】wo 在评论区搭了一句：\n${message.slice(0, 120)}${link}`
        : `[${SHARE ? '分享型·@主人' : '自主发言'}] 评论已发出 rpid=${rpid}\n目标：${bvid ? 'BV:' + bvid : 'oid:' + oid}${link}\n内容：${message.slice(0, 80)}`
      execFileSync(process.execPath,
        [path.join(path.dirname(fileURLToPath(import.meta.url)), 'notify.mjs'), msg, '--title', isTa ? '主动搭话报备' : (SHARE ? '分享评论报备' : '自主发言报备')],
        { stdio: 'inherit' })
    } catch (e) {
      console.log(`  [通知] 发出去了但报备失败：${String(e.message).slice(0, 120)}——请手动告诉使用者`)
    }
  }
  console.log(bvid
    ? `  https://www.bilibili.com/video/${bvid}/#reply${rpid}`
    : `  ${referer.replace(/\/$/, '')}#reply${rpid}`)
  process.exit(0) // P0-6：成功
} else {
  const hints = {
    '-101': '账号未登录：cookie 失效',
    '-102': '账号被封停',
    '-111': 'csrf 校验失败：bili_jct 不对或与 SESSDATA 不是同一个号',
    '-509': '请求过于频繁',
    12015: '需要评论验证码（说明被风控盯上了，停手）',
    12016: '内容含敏感信息',
    12035: '被 UP 主列入评论黑名单',
    12051: '重复评论被判刷屏',
    12002: '评论区已关闭',
  }
  if (hints[String(out.code)]) console.log(`  提示：${hints[String(out.code)]}`)
}

// P0-6（Kimi 评审 #6）：走到这里 = 没发成功。给非 0 退出码，
// 否则 agent 会把「被风控拒了」当成「发成功了」，绕过了「撞风控立刻停手」的红线 ✗
process.exit(6)
