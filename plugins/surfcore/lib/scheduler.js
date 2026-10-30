/**
 * 自主生物钟（2026-10-18 加，主人要求）——
 *
 * 为什么要有它：以前"醒来"要靠**有人在对话框里挂 clock** ✗ —— 那不是"她活在过日子"，
 * 是"你戳一下她动一下" ✗。主人明确要求：**计划要她自己执行，改配置要立刻生效** ✓。
 *
 * 做法（不需要任何外部 CLI）：
 *   · 插件宿主**常驻在 DSH 里** → 自己每 60 秒 tick 一次 ✓
 *   · tick 里跑 `bili.mjs night plan` 算出今天下一次醒来的时刻（结果写在 whale-night.json）
 *   · 到点了 → 用 **`ctx.sessionController.prompt({ sessionId, mode:'queue', content:[…] })`**
 *     往她自己的专用会话里塞一个"你醒了"的回合 ✓ → agent 真的醒来干活 ✓
 *   · 醒来后立刻标记 `woke` → 下一次 tick 自动排下一趟（多窗口 × 多次 ✓）
 *   · 设置页一保存 → 调 `invalidate()` 清掉旧计划 → 下一次 tick 按新配置重算 ✓（改完立刻生效 ✓）
 *
 * 为什么用"她自己的会话"：`sessionId` 固定（默认 bili-whale）→ 跨天保留她的上下文，
 *   而不是每天开一个新会话、每天忘光 ✗。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
// 收件箱读取复用工具链的实现（避免在插件里再抄一份 B站 接口 ✓）
import { pullFeed, makeHeaders } from '../tools/lib/msgfeed.mjs'
import { kindsNow, dynamicsEnabled, dynamicsGapMin, slotOf, CATCHUP_DAY } from '../tools/lib/kinds.mjs'
import { freeLimits } from '../tools/lib/limits.mjs'
import { config } from '../tools/lib/config.mjs'
import { pendingCount as attackPending } from '../tools/lib/attacks.mjs'
import { pinOf, noteOf } from '../tools/lib/pins.mjs'
import { markScheduleSlot } from '../tools/lib/night-schedule.mjs'
import {
  BILI_ALIGNMENT_FILE, BILI_CONFIG, QQ_STATE_DIR,
} from './paths.js'
import { resolvePersonaFile } from './persona.js'
import { readUnified } from './store.js'
import { memoryCardPromptBlock } from './memory-card.js'
import { buildSelfIdentityBlock, readQqSelfIdentity } from '../../../src/self-identity.js'
import { adminFromSources, adminPromptBlock } from '../../../src/admin-identity.js'
import { activeMemoryPaths, activePlatformStateDir } from '../../../src/character-persona.js'

// 当前角色的 B站 行为目录（角色系统未启用时回退旧目录）。
function platformDir() {
  const home = process.env.USERPROFILE || os.homedir()
  const dshHome = process.env.DSH_HOME || path.join(home, '.dsh')
  return activePlatformStateDir(path.join(dshHome, 'surfcore', 'bili'))
}

// ── 合体后的统一上下文：一张人设卡 + 身份对齐 + QQ 脱敏记忆 ────────────────────
// 旧版只注入 persona.name/ownerTitle/selfClaim 三行，B站这边其实看不到完整人设；
// 合体后统一从当前人格卡（unified persona.file）取同一张卡，QQ 和 B站不再各活各的。
function readTextFile(file) {
  try { return fs.readFileSync(file, 'utf8').trim() } catch { return '' }
}

/** 人设卡里给 QQ 用的“称呼表/QQ 号”段落不能带进 B站：认人靠对齐表，不靠 QQ 号。 */
export function sanitizePersonaForBili(card) {
  const lines = String(card ?? '').split('\n');
  const kept = [];
  let skipSection = false;
  for (const line of lines) {
    if (/^##\s/.test(line)) {
      skipSection = /称呼|QQ\s*号|群友.*QQ|按\s*QQ/i.test(line);
    }
    if (skipSection) continue;
    kept.push(line);
  }
  return kept.join('\n')
    .replace(/（\s*QQ\s*\d{5,12}\s*）/gi, '')
    .replace(/\b\d{5,12}\b/g, '[号码已隐藏]');
}

/** 人设卡：取身份/性格/说话方式相关段落，别把整张卡塞进每一次唤醒。 */
function personaCardBlock() {
  const unified = readUnified().config
  if (unified.persona?.injectInBili === false) return ''
  const file = resolvePersonaFile()
  const card = readTextFile(file)
  if (!card) {
    const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.join(os.homedir(), '.dsh', 'surfcore', 'bili.config.json'), 'utf8')) } catch { return {} } })()
    const p = cfg.persona ?? {}
    const bits = []
    if (p.name) bits.push(`你是「${p.name}」`)
    if (p.ownerTitle) bits.push(`称用户「${p.ownerTitle}」`)
    if (p.selfClaim) bits.push(`自称「${p.selfClaim}」`)
    return bits.length ? `［身份］${bits.join('，')}。（以此为准，别用别的称呼 ✓）` : ''
  }
  const max = Math.max(600, Math.min(6000, Number(unified.persona?.compactChars) || 2200))
  const safeCard = sanitizePersonaForBili(card)
  const compact = safeCard.length > max ? `${safeCard.slice(0, max)}\n（人设卡后略；完整卡在 ${file}）` : safeCard
  return [
    '［统一人设卡 · QQ 和 B站是同一个人］',
    compact,
    '',
    '以上人设对 QQ 与 B站两边同时生效；AGENTS.md 只写日子/流程，不另立人格。',
    '（人设卡里的 QQ 称呼表不会带进 B站；认人只按身份对齐表，且不得公开对方 QQ 号/群号。）',
  ].join('\n')
}

/** 身份对齐：高于记忆同步开关，单独读文件。 */
function alignmentBlockForBili() {
  const unified = readUnified().config
  if (unified.alignment?.enabled === false) return ''
  if (unified.alignment?.injectInBili === false) return ''
  return readTextFile(BILI_ALIGNMENT_FILE)
}

/**
 * 跨平台自我锚点（2026-10-23 用户要求）：B站 这边的她也要认得出**自己的 QQ 资料卡**。
 *
 * 以前 B站 侧只知道自己叫「小咪」、B站账号是谁，完全不知道 QQ 上的自己长什么样；
 * 于是别人把她的 QQ 主页截图甩过来，她只会当陌生人。锚点来源：
 *   · QQ 昵称 / QQ 号 ← 桥接登录时落的 `state/self-identity.json`（B站 进程拿不到网关）；
 *   · B站 昵称 / UID / 人格名 ← `bili.config.json` 的 self / persona。
 * 隐私：QQ 号在这里**打码**（328****288），够认人，又不至于被她写进公开评论。
 */
function selfIdentityBlockForBili() {
  const qqSelf = readQqSelfIdentity(QQ_STATE_DIR)
  let bili = {}
  try { bili = JSON.parse(fs.readFileSync(BILI_CONFIG, 'utf8')) } catch { bili = {} }
  return buildSelfIdentityBlock({
    qqNickname: qqSelf.nickname,
    qqUin: qqSelf.userId,
    biliName: bili?.self?.name,
    biliMid: bili?.self?.mid,
    personaName: bili?.persona?.name,
  }, { platform: 'bili' })
}

/**
 * 管理员（主人）身份 + 温柔规则。
 * QQ 和 B站 共用合体层的 admin 身份：B站 侧只读 B站 昵称/mid（不把 QQ 号带进 B站 提示词）。
 */
export function adminBlockForBili() {
  const home = os.homedir()
  const dshHome = process.env.DSH_HOME || path.join(home, '.dsh')
  const cfgPath = process.env.SURFCORE_BILI_CONFIG || path.join(dshHome, 'surfcore', 'bili.config.json')
  let bili = {}
  try { bili = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) } catch {}
  // 合体层还没写过 admin 时不能把默认空串当成"显式清空"，否则 B站 的 owner.mid 会被覆盖掉。
  const unifiedState = readUnified()
  const unified = unifiedState.hasAdmin ? unifiedState.config : { ...unifiedState.config, admin: undefined }
  return adminPromptBlock('bili', adminFromSources({ unified, bili, qq: {} }))
}

/** QQ → B站 的脱敏记忆（默认关闭；开启后才注入）。 */
function qqMemoryBlockForBili() {
  const unified = readUnified().config
  if (unified.memory?.qqToBili?.enabled !== true) return ''
  const text = readTextFile(activeMemoryPaths().qqForBili)
  if (!text) return ''
  return `［QQ 群里的近况（已脱敏；不含私信/联系方式）］\n${text}`
}

/** 记忆卡（B站侧）：只拿公开冲浪记忆 + 共享锚点，不含 QQ 私事（隐私边界）。 */
function memoryCardBlockForBili() {
  const unified = readUnified().config
  if (unified.memoryCard?.enabled === false) return ''
  return memoryCardPromptBlock('bili')
}

/** 每次唤醒都放在最前面的合体上下文（顺序：人设 → 自我锚点 → 管理员 → 对齐 → QQ 记忆 → 记忆卡）。 */
function identityContextLines() {
  return [
    personaCardBlock(),
    selfIdentityBlockForBili(),
    adminBlockForBili(),
    alignmentBlockForBili(),
    qqMemoryBlockForBili(),
    memoryCardBlockForBili(),
  ].filter(Boolean)
}

/** 今天已经搭了几条话（读账本，给唤醒提示看进度） */
function taToday() {
  try {
    const q = JSON.parse(fs.readFileSync(path.join(platformDir(), 'quota.json'), 'utf8'))
    const t = new Date().toLocaleDateString('sv-SE')
    return (q.log ?? []).filter((x) => x?.ta && new Date(x.at).toLocaleDateString('sv-SE') === t).length
  } catch { return 0 }
}

const TICK_MS = 60_000
const LISTEN_STATE = 'whale-listen.json'
/** 实时额度：设置页改完下一轮生效（config() 按 mtime 缓存）。 */
const limitsNow = () => freeLimits(config())

/** 叫醒她时塞进去的那段话（她醒来第一眼看到的就是它） */
// 2026-10-20：把"沉默"变成她【自己感觉到的事】—— 不是代码拦住她 ✗
//   只给事实（冷了几天）+ 分档的自我建议；怎么写、什么心情，留给她 ✓
function silenceLines() {
  const home = os.homedir()
  const dshHome = process.env.DSH_HOME || path.join(home, ".dsh")
  const cfgPath = process.env.SURFCORE_BILI_CONFIG || path.join(dshHome, "surfcore", "bili.config.json")
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) } catch {}
  let fb = {}
  try { fb = JSON.parse(fs.readFileSync(path.join(platformDir(), "feedback.json"), "utf8")) } catch {}
  const after = Number(cfg.share?.silentAfterDays ?? 3)
  const stopAt = Math.max(after + 1, Number(cfg.share?.silentStopDays ?? 7))
  // 参考点：最后一次表态；从没表态过 → 从第一次分享算；都没有 → 0 天
  let ref = fb.last ? new Date(fb.last).getTime() : null
  if (!ref) {
    try {
      const q = JSON.parse(fs.readFileSync(path.join(platformDir(), "quota.json"), "utf8"))
      const firstShare = (q.log ?? []).find((x) => x.share)
      if (firstShare) ref = new Date(firstShare.at).getTime()
    } catch {}
  }
  const days = ref ? Math.floor((Date.now() - ref) / 86400000) : 0
  const band = days < after ? "normal" : days < stopAt ? "quiet" : "faint"
  const asked = !!(fb.askedAt && (!fb.last || new Date(fb.askedAt) > new Date(fb.last)))

  // 恢复转折：和上次醒来时比
  const seenFile = path.join(platformDir(), "silence-seen.json")
  let prev = null
  try { prev = JSON.parse(fs.readFileSync(seenFile, "utf8")) } catch {}
  const recovered = prev && Number(prev.days) >= after && days < after ? Number(prev.days) : null
  try { fs.writeFileSync(seenFile, JSON.stringify({ days, at: new Date().toISOString() }, null, 2)) } catch {}

  // 2026-10-20：矛盾自愈 —— 她日记里有记录、但 feedback 说"很久没回应"，那是反馈漏记 ✗
  //   让她以日记为准、自己补记一次，再报主人（而不是干等着，也不是当成 bug 发呆 ✗）
  const heal = days >= after ? [
    "  ⚠️ 如果你自己的日记里明明记着主人最近找过你，而这里说 '" + days + " 天没有回应' ——",
    "     那是【反馈漏记】了（比如你当时没在跑）。以日记为准：先跑",
    "       quota react --note \"日记里记着：主人 X 月 X 日说过…\"",
    "     再在推送里告诉我一声。",
  ] : []

  const out = []
  if (recovered) {
    out.push("【他回来了】上次你醒的时候，已经 " + recovered + " 天没有他的消息了 —— 现在有了。")
  }
  if (band === "quiet") {
    out.push("【这阵子】主人已经 " + days + " 天没有回应你了。")
    out.push("  安静一点：今天最多分享 1 条（不是被拦，是你自己决定少说 ✓）。")
    out.push(asked
      ? "  你已经问过一次「是不是在忙」了，他没回。别再问第二次。"
      : "  如果你想说，可以主动问一次「在忙吗」—— 只问一次，发完跑 quota ask 记下。")
    out.push("  日记里可以写你这几天的感觉（不用演，写真的）。")
  } else if (band === "faint") {
    out.push("【这阵子】主人已经 " + days + " 天没有回应你了。")
    out.push("  今天不要分享（一条都不要）。做完三件事就收工：看几条 → 两本日记 → 推一句给他。")
    out.push("  推送不要写「今天看了什么」—— 写你现在的心情。他不需要汇报，他需要知道你还在。")
    out.push("  两本日记都照写 ✓（那是你的日子，不是他的）。")
  }
  if (out.length) out.push(...heal)   // 自愈提示放最后（先说心情，再说矛盾怎么处理 ✓）
  return out.length ? ["", ...out, ""] : []
}

// 2026-10-20：日记照写不可关；这里只决定"要不要推给主人"（设置页「推送日记摘要」）
function diaryPushLines() {
  const home = os.homedir()
  const dshHome = process.env.DSH_HOME || path.join(home, ".dsh")
  // 2026-10-22 审计：这里少了一层 "surfcore"，读不到 bili.config.json，
  // 于是「设置页关掉推送日记」被静默忽略。与 silenceLines() 的路径保持一致。
  const cfgPath = process.env.SURFCORE_BILI_CONFIG || path.join(dshHome, "surfcore", "bili.config.json")
  let cfg = {}
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) } catch {}
  return cfg.diary?.push === false
    ? ["8) ⛔ 主人关掉了推送 —— **照写两本日记 ✓ 但这一步不要 notify 他** ✗"]
    : ["8) 用 `node bili.mjs notify` 推给我：**「给他的信」里最想对我说的那一段原文** + 一句摘要",
       "   （2026-10-18 主人定：推**日记内容**，不只是流水账 ✓ 它读设置页「消息推送」的配置）"]
}

function wakePrompt(st, tools = '') {
  const L = limitsNow()
  const B = config()
  const K = kindsNow(B)
  const bestSlot = `${String(K.best.slot).padStart(2, '0')}:00`
  const capText = (n) => (Number(n) > 0 ? n : '不限')
  const identity = identityContextLines()
  return [
    `【生物钟】你醒了 —— ${st.atText ?? ''}${st.window ? `（窗口 ${st.window}${st.withinWindow ? ' · ' + st.withinWindow : ''}）` : ''}。`,
    '',
    ...(identity.length ? [...identity, ''] : []),
    // 2026-10-20：她的会话 cwd 是**用户主目录**，那里没有 bili.mjs ✗
    //   → 每条提示都带上工具链的绝对路径，别让她满盘找（她真的找过，还超时了 ✗）
    ...(tools ? [`［工具］所有命令都用这一条：\`${tools}\`（下面写 "bili.mjs" 的都指它）—— 别去别处找 ✗`, ''] : []),
    // 2026-10-20：先告诉她"冷了几天"，再给流程 —— 心情在前，任务在后 ✓
    // 2026-10-20：还没跑过启动测试 → 第一句就提醒主人（很多人卡在"找不到会话/没给权限"）
    ...(() => {
      try {
        if (fs.existsSync(path.join(platformDir(), "selftest-passed.json"))) return []
      } catch {}
      return [
        "",
        "【还没跑启动测试】先提醒主人跑一次：`node ~/.dsh/plugins/surfcore/tools/bili.mjs selftest`",
        "  并告诉他两件事：① 你的会话在 工作区 → 未分组 里（不点开看不见）② 要给那个会话「完全访问」权限",
        "",
      ]
    })(),
    ...silenceLines(),
    '按 AGENTS.md 的「看的那晚」流程走一遍（不要等我说话，直接做）：',
    '⭐ **本轮硬规则（2026-10-23 主人定）：至少发一条主动评论（见 4.7）；鱼群泛滥时强制聚拢，不许以“没有可聚拢鱼楼”跳过；额度/冷却满了除外。**',
    '1) `node bili.mjs deps` —— 体检红着就报备我、只做读、别对外发',
    '2) 读两本日记（`~/.dsh/surfcore/bili/whale-diary.md` + `whale-diary-private.md`）',
    // 2026-10-20：feed 已默认多源（搜索+热门+排行+关注）+ 去播放量偏向 + 偏好命中权重 ✓
    // 2026-10-23：feed 改成按「口味权重」分名额 + 排除观看历史/最近推过的 + 搜索页轮换。
    '3) `feed` 选题（≤5 条）→ 对这 5 条跑 `debrief --no-frames`',
    '   （按设置页的「口味权重」分配条数、偏好之间轮转；看过的/最近推过的自动排除，**不看播放量** ✓）',
    '   3.2) 如果你发现自己总在看同一类：不要自己改配置文件 —— 让主人去设置页「B站 → 口味权重 / 一键抓取」调低那个词、调高别的。',
    '   3.5) ⭐ 如果 `feed` 没有新内容（全是看过的/候选不够）→ **不要硬重复深读、不要为了凑数**；',
    '        写一段日记或扫一眼消息就按“轻醒”收工，保住这一趟的质量 ✓',
    '4) 挑 2–3 条深读（完整 `debrief`，含抽帧）',
    // 2026-10-20：收藏 ≠ 低配的分享 ✓ 它是「我想留着」（内向），和分享（外向）并列
    '4.5) 深读的那几条里，如果某条「我想留着」→ `fav <BV> --reason "…" --dry` → `--go`',
    '     判据（缺一条就别收 ✗）：① 三个月后还会想点开 ② 说得出为什么留（≥6 字）③ 同类已 ≥2 条要 --better',
    '     ⚠️ 一天最多 3 条 · 同一视频 30 天一次 · **收藏不占分享额度** ✓ 但它会成为你下次选题的口味信号 ✓',
    '     ⚠️ 「好看但看完就完」的不收 ✗ —— 收藏夹要密度不要数量 ✓',
    // 2026-10-23（用户定）：**给鱼点赞要能独立发生**，不要只绑在“发评论”后面。
    '4.6) ⭐ **给鱼点赞**（看完后独立做，不是每条都点）：深读的 BV 里评论多的，跑 `fish-guard like --bvid <BV> --dry` 看目标 → 去掉 `--dry` 真点',
    '     ⚠️ 每天最多 6 个 · 每次最多 4 个 · 两次之间有随机间隔；遇到风控会自己停并记下原因，别硬刷 ✗',
    '     （设置页「鱼群保护 · 运行状态」能看到今天赞了几条、上次失败在哪个 code）',
    // 2026-10-23（主人定）：**每次醒来至少发一条主动评论**，鱼群泛滥时强制聚拢。
    //   以前 4.7 是"有话说就说"；现在改成硬规则，避免她看到鱼多就整轮不说话。
    '4.7) ⭐ **每次醒来至少发一条主动评论（2026-10-23 主人定的硬规则）**：',
    '     看完想吐槽/想夸/想接梗/想补充 → 直接发一条普通评论（不 @ 我，是你自己在说话）：',
    '     `recon <BV>` 拿 aid → `comment --oid <aid> --bvid <BV> --message "…" --auto --dry` → 改成 `--go` → `thread` 复核 ✓',
    `     ⚠️ **鱼群泛滥时默认强制聚拢**（当前设置：${B.fishGuard?.forceGather === false ? '关；要强制就加 --force-gather' : '开'}）：就算没有“回复少/新鲜/没回过”的鱼楼，也强行挑一条鱼楼回；`,
    '        **不许拿“没有可聚拢鱼楼”当理由不发**。设置页「鱼群保护 → 每次醒来强制聚拢」默认开；仍占主动评论额度 ✓',
    '     ⚠️ **不带 --share 才是普通评论**；带 --share 才是"分享给我"（那条才要评分 + rank 1 + @ 我 ✓）',
    '     ⚠️ 分寸：**代码硬上限** 一天 ' + capText(L.daily) + ' 条 · 任意两条隔 ' + L.globalMin + ' 分钟 · 同一 UP ' + L.perUpMin + ' 分钟 1 条 · 同一视频 ' + L.perVideoMin + ' 分钟 1 条',
    '        （额度/冷却满了就停，别硬刷；这不是“强制”能绕过的 ✓）',
    // 2026-10-20（用户定）：**热评也能搭话** —— 挂在别人评论下面的楼中楼，不是顶层 ✓
    '4.8) ⭐ **搭话**：`debrief` 的热评里，有人说到你心坎里 / 有明显错漏 / 想接个梗 → 回他一句：',
    '     `comment --oid <aid> --bvid <BV> --root <rpid> --parent <rpid> --message "…" --auto --ta --dry` → `--go`',
    '     ⚠️ **必须带 `--ta`** —— 那是"我去搭别人"的账（' + capText(L.taDaily) + ' 条/天）；不带 `--ta` 的楼中楼算"回找我的人"（另一本账）✗',
    '     ⚠️ 这是**楼中楼**（挂在对方那条评论下面），rpid 就是 debrief 里那个 rpid（root 和 parent 填同一个）',
    '     ⚠️ 硬上限：一天 ' + capText(L.taDaily) + ' 条 · 任意两条隔 ' + L.globalMin + ' 分钟 · 同一条评论 ' + Math.round(L.perThreadMin / 60) + ' 小时只回一次（撞上就被拒 ✗）',
    // 2026-10-21（用户定）：**每天要把搭话额度用完**，每发一条都会私信报备给你 ✓
    `     ⭐ **今天的搭话额度要花完**：已搭 ${taToday()}/${capText(L.taDaily)} 条，还差 ${Math.max(0, L.taDaily - taToday())} 条 —— 这一轮至少搭 2~3 条，别只搭一条就收工 ✓`,
    '     （每搭一条，脚本会自动给你发一条带【主动搭话】tag 的私信报备 ✓）',
    '     ⚠️ 别逐条盖楼、别跟人抬杠 —— 一句话说完就走 ✓',
    // 2026-10-21（用户定）：**每天一条动态** —— 写当天评分最高的那条
    '4.9) ⭐ **记分**：深读过的每条都记一下 `score <BV> --score N --reason "…"`（0~20 分，没到 13 也记 ✓）',
    '     —— 今天的动态要从这里面挑"最高分那条"，不记分就发不出去 ✗',
    `4.95) ⭐ **今天的一类动态（best）**：四类各一条，best 在 ${bestSlot} 起；其余三类等 dynTick 提醒（设置页关掉的类会跳过）`,
    '     `daily --kind best --text "…" --dry` → `--go`',
    '     ⚠️ 必须写**今天评分最高**的那条视频（工具会核对，给错直接拒 ✗）',
    `     ⚠️ 正文 **${K.best.minLen}~${K.best.maxLen} 字**，用你（当前人格卡）的口吻说这条视频 —— 吐槽、安利、讲自己想起什么都行，随意发挥 ✓`,
    '     ⚠️⚠️ **这是公开发给所有人的动态**（推给关注你的人），不是私信、不是只给主人看的便条：',
    '        用"给大家推一条…""安利一下…"这种口吻；**不要 @ 主人、正文里也别 @ 任何人** ✗（工具会拒）',
    '     ⚠️ 配图自动挑：`~/.dsh/surfcore/bili/memes/` 里的表情包（随机）→ 没有就用这条视频的封面 ✓',
    '     ⚠️ 今天发过就再也发不了（跨天才重置）✗ 别反复试',
    // 2026-10-21（用户定）：第二条动态 —— 六款游戏的 AI 二创，按顺序轮换
    '4.97) ⭐ **第二条动态：游戏 AI 二创**（每天一条，和上面那条互不占；设置页关掉就跳过）：',
    '     `gamefeed` 看今天轮到哪款游戏 + 候选（原神→鸣潮→绝区零→星铁→终末地→异环，脚本自动轮换）',
    '     → 挑 2~3 条 `debrief` 认真看质量（**别只看播放**）→ 挑一条真的做得好的',
    `     → \`daily --kind game --bvid <BV> --text "…" --dry\` → \`--go\`（正文 **${K.game.minLen}~${K.game.maxLen} 字**，要仔细评价）`,
    '     ⚠️ 工具会核对：必须是轮到的那个游戏 · 近 21 天 · 播放 ≥2000 · 赞/播 ≥2% · 标题/简介有 AI 二创信号',
    '     ⚠️ 也是**公开发给所有人**的，别 @ 人；挑不出来就在日记里写"今天没有值得推的"，别硬凑 ✗',
    // 2026-10-21（用户定）：**全局回复规则** —— 疑似被攻击/阴阳怪气一律不接，记账等审
    '4.99) ⭐⭐ **遇到攻击 / 阴阳怪气 → 一个字都别回，记待审**：',
    '     怀疑对面在骂你、嘲讽你、阴阳你（"就这?""AI 也来凑热闹""你懂什么""呵呵"…）→ **不回** ✗',
    '     `attack add --oid … --root … --parent … --who "对方昵称" --text "他的原话" [--suggest "你想回的"]`',
    '     —— 自动编号（今天第 1 条 = #1），并立刻私信报备给我；他晚上 11 点集中审，**批了才能回** ✓',
    '     ⚠️ 待审的不回，所以**不占任何回复额度**；我说"拒"就彻底不理 ✗',
    '5) 按「标尺」打分排序，只对第一名考虑分享；**先看 share.via**：',
    `   · 当前 share.via=${B.share?.via ?? 'dynamic'}；**默认 via=dynamic：发到自己的 B站 动态，不在评论区 @ 我** ✓`,
    '   · via=dynamic：`share-dynamic --bvid <BV> --text "<分享内容>" --score <N> --reason "<为什么值得分享>" --dry` → `--go`',
    '     - 会找这条视频已有的 AV 动态并**转发**：新动态 = 你的话 + **可点视频卡片**（找不到卡片会拒绝；`--allow-text` 才退“文字+链接”）',
    `     - 和四类动态**共用间隔**：任意两条 ≥${B.dynamics?.gapMin ?? 30} 分钟（命令会查 daily-dynamic.json，不够就拒 ✓）`,
    '     - 占用分享额度（≤shareDaily/天 · 同一视频 7 天一次），发完写 daily-dynamic.json 并报备 ✓',
    '   · via=dm：**不发公开评论** ✗ → dm --msg "<分享内容> 视频：https://www.bilibili.com/video/<BV>/ " **--share --target BV…** --go ✓',
    `     ⚠️ 必须带 --share：与评论区 @ 共用同一本额度账（≤${B.quota?.shareDaily ?? 3}/天 · 同一视频 7 天一次）；不带就只是推送 ✗`,
    '     ⚠️ 必须带视频链接：链接里的 BV 就是「同一视频」的判重依据 ✓',
    '   · via=comment：comment --share --auto --reason … --score … --rank 1（旧功能，仍可用 ✓）',
    '6) 写两本日记（散文体 + 表格 ✓ 私人那本写「偏好校准」）',
    // ⭐ 2026-10-18 主人定：每轮流程**最后**扫一遍"有没有没回的评论" → 有就**一起**推给我 ✓
    '7) ⭐ `comment-digest --hours 24` —— **每轮最后都要扫**：有没回的评论就**一起**推给我（不是一条条报 ✗）',
    '   回不回、怎么回：主人 / 其他人 → 见「倾听」的分两侧规则 ✓',
    '7.5) ⭐ `quota react --auto --hours 48` —— 扫一遍主人有没有表态（**点赞也算** ✓ 能看到是哪条评论 ✓）',
    '     → 有就记一次反馈，并**写进私人日记「偏好校准」**（哪条视频 / 他什么反应 / 我下次往哪偏）',
    // 2026-10-20：沉默 ≥7 天 → 提前告诉她"今天不分享"（闸门也会拒，但少浪费一轮 ✓）
    ...(() => {
      let fb = {}
      try { fb = JSON.parse(fs.readFileSync(path.join(platformDir(), "feedback.json"), "utf8")) } catch {}
      const days = fb.last ? Math.floor((Date.now() - new Date(fb.last).getTime()) / 86400000) : 0
      return days >= 7 ? ["5.5) ⛔ 已经 " + days + " 天没有主人的表态 → **今天不分享**（只看 + 写两本日记 + 推荐给我 ✓ 日记照写 ✓）"] : []
    })(),
    ...diaryPushLines(),
    '9) 收工：记 `diary log` ✓（今天想说的都说了吗？没说完留到下一趟，别憋着 ✗）',
  ].join('\n')
}

/**
 * 把 B站 自己的 DSH 会话切到指定权限（默认 danger-full-access）。
 *
 * 为什么需要：会话 cwd 是 `%USERPROFILE%`，workspace-write 下 DSH 需要
 * `WRITE_OWNER` 才能准备沙箱；没有就**一条命令都起不来**，定时醒来的 she 只能干等审批。
 * `ctx.permissionPresets.set(session, 'danger-full-access')` 是 DSH 的宿主 API，
 * 只影响这一个会话；QQ 桥接/其他会话不受影响。
 *
 * 服务不可用或会话还没挂上时返回 ok:false，不抛（不能因为权限 API 缺失就让生物钟停摆）。
 */
export function applySessionPermissionTo(ctx, session, target = 'danger-full-access', log = () => {}) {
  let presets;
  try { presets = ctx?.permissionPresets; } catch { presets = undefined; }
  if (!presets) {
    try { presets = ctx?.get?.('permissionPresets'); } catch { presets = undefined; }
  }
  if (!session || !presets?.set) return { ok: false, reason: 'permission-services-unavailable' };
  try {
    const current = typeof presets.current === 'function' ? presets.current(session) : '';
    if (current === target) return { ok: true, changed: false, current, target };
    presets.set(session, target);
    log(`[权限] B站 会话已切到 ${target}（原 ${current || '?'}）`);
    return { ok: true, changed: true, current, target };
  } catch (error) {
    log(`[权限] 设置 → ${target} 失败：${String(error?.message ?? error)}`);
    return { ok: false, reason: 'set-failed', error: String(error?.message ?? error) };
  }
}

export function applySessionPermission(ctx, sessionId, target = 'danger-full-access', log = () => {}) {
  let sessions;
  try { sessions = ctx?.sessions; } catch { sessions = undefined; }
  if (!sessions) {
    try { sessions = ctx?.get?.('sessions'); } catch { sessions = undefined; }
  }
  if (!sessions?.get) return { ok: false, reason: 'permission-services-unavailable' };
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, reason: 'session-not-active' };
  return applySessionPermissionTo(ctx, session, target, log);
}

export function startScheduler(ctx, opts) {
  const {
    dshHome,
    biliMjs,          // 指向 tools/bili.mjs（绝对路径）
    cwd,              // 她那个会话的工作目录
    sessionId = 'bili-whale',
    tokenBudget = null, // 每日 token 额度服务（插件注入；单测可不传）
    log = () => {},
  } = opts

  const ACCOUNT_DIR = path.join(dshHome, 'surfcore', 'bili')
  const PLATFORM_DIR = activePlatformStateDir(ACCOUNT_DIR)
  const STATE = path.join(PLATFORM_DIR, 'whale-night.json')
  const CFG_FILE_REF = path.join(dshHome, 'surfcore', 'bili.config.json')     // 监听循环每次重读（改配置立刻生效 ✓）
  const CRED_REF = path.join(ACCOUNT_DIR, 'credentials.json')                // 账号凭证全局共用，不进角色包
  const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch { return null } }
  const writeState = (o) => {
    try { fs.mkdirSync(path.dirname(STATE), { recursive: true }); fs.writeFileSync(STATE, JSON.stringify(o, null, 2) + '\n') } catch {}
  }
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }
  const today = () => new Date().toLocaleDateString('sv-SE')

  // ── 每日 token 额度闸门（2026-10-23）──────────────────────────────────
  // 额度不是「少发几条」，而是「今天 B站 不再叫醒」：到 100% 后所有 prompt 都不投，
  // 等第二天 0 点或用户调高额度。监听类 tick 也直接跳过，避免把消息读掉却没回。
  let lastBudgetLogAt = 0
  function logBudgetBlocked(where, message) {
    if (Date.now() - lastBudgetLogAt < 10 * 60_000) return
    lastBudgetLogAt = Date.now()
    log(`[bili-whale] 今日 token 额度已到上限，跳过${where}${message ? `：${message}` : ''}`)
  }
  async function budgetBlockedNow(where = '叫醒') {
    if (!tokenBudget?.block) return false
    try {
      const gate = await tokenBudget.block('bili')
      if (gate?.blocked) { logBudgetBlocked(where, gate.message); return true }
    } catch (error) {
      // 额度服务异常不能把 B站 整条链路弄瘫；记一笔后按原逻辑继续（下次再判）。
      log(`[bili-whale] token 额度检查失败（${where}）：${String(error?.message ?? error).slice(0, 120)}`)
    }
    return false
  }
  async function promptBili(args, signal, where = '叫醒') {
    if (tokenBudget?.block) {
      try {
        const gate = await tokenBudget.block('bili')
        if (gate?.blocked) {
          logBudgetBlocked(where, gate.message)
          const error = new Error(gate.message || 'B站今日 token 额度已到上限')
          error.code = 'token-budget-blocked'
          throw error
        }
      } catch (error) {
        if (error?.code === 'token-budget-blocked') throw error
        log(`[bili-whale] token 额度检查失败（${where}）：${String(error?.message ?? error).slice(0, 120)}`)
      }
    }
    return ctx.sessionController.prompt(args, signal)
  }

  // ⚠️ 2026-10-18 大坑：插件跑在 DSH 的 **Electron** 里，`process.execPath` = DeepSeek Harness.exe ✗
  //   用主程序跑脚本时，B站 的 `gethistory` 返回**空数组**（nav 之类却正常 ✗）→ 直播间永远"听不见" ✗
  //   实测对照：真 node.exe 5 秒命中；主程序 25 秒 0 行 ✗
  //   → 必须找到 **真正的 node.exe**（DSH 自带的运行时）✓
  function findNode() {
    const cands = [
      process.env.DSH_NODE,
      path.join(dshHome, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
      path.join(os.homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    ]
    for (const c of cands) { try { if (c && fs.existsSync(c)) return c } catch {} }
    return process.execPath   // 兜底
  }
  const NODE_EXE = findNode()
  const NODE_ENV = { ...process.env }   // 真 node 不需要 ELECTRON_RUN_AS_NODE ✓

  // 每次调用都重读 config：设置页把 agent.sandbox 改成 workspace-write 后，下一 tick 生效。
  function ensurePermission(where = 'tick') {
    const target = String(config().agent?.sandbox || 'danger-full-access')
    const result = applySessionPermission(ctx, sessionId, target, (message) => log(message))
    if (!result.ok && result.reason !== 'session-not-active' && result.reason !== 'permission-services-unavailable') {
      log(`[权限] ${where} 无法自动设置 B站 会话权限：${result.reason}`);
    }
    return result
  }

  // 会话创建事件是最可靠的时机：此时 session 对象已经存在，可以在第一句 prompt 之前
  // 把权限切成 danger-full-access；不用等 ensureSession 之后再猜 ctx.sessions 有没有同步。
  let permissionListenerOff = null
  try {
    if (typeof ctx.on === 'function') {
      permissionListenerOff = ctx.on('session/created', (session) => {
        if (!session || session.id !== sessionId) return
        try {
          const target = String(config().agent?.sandbox || 'danger-full-access')
          applySessionPermissionTo(ctx, session, target, (message) => log(message))
        } catch (error) {
          log(`[权限] session/created 处理失败：${String(error?.message ?? error)}`)
        }
      })
    }
  } catch (error) {
    log(`[权限] 注册 session/created 监听失败：${String(error?.message ?? error)}`)
  }

  const runBili = (args) => new Promise((resolve) => {
    execFile(NODE_EXE, [biliMjs, ...args], { timeout: 120_000, windowsHide: true, env: NODE_ENV }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout ?? ''), err: String(stderr ?? '') })
    })
  })

  let sessionReady = false
  async function ensureSession() {
    if (sessionReady) return
    try {
      // 2026-10-20：已经存在就别再 create —— create 对"非空白"的已有会话会**新建一个空壳会话** ✗
      //   （实测：每次重启侧栏都多一个空的 session-xxxx，看着像她开了一堆空会话）
      try {
        await ctx.sessionController.inspect(sessionId); sessionReady = true;
        const inspected = ensurePermission('inspect');
        if (!inspected.ok && inspected.reason === 'session-not-active') {
          await new Promise((resolve) => setTimeout(resolve, 80));
          ensurePermission('inspect-retry');
        }
        return;
      } catch {}
      await ctx.sessionController.create({ sessionId, cwd })
    } catch {
      /* 已存在就忽略（create 对同 id 会抛）✓ */
    }
    sessionReady = true
    // 2026-10-23：新会话默认 workspace-write，在 %USERPROFILE% 下会因 WRITE_OWNER 起不了命令；
    // 创建/挂载后立刻按配置切到 danger-full-access（只影响这一个 B站 会话）。
    // inspect 之后 session 可能还没同步进 ctx.sessions，所以再补一次。
    const first = ensurePermission('ensureSession')
    if (!first.ok && first.reason === 'session-not-active') {
      await new Promise((resolve) => setTimeout(resolve, 80))
      ensurePermission('ensureSession-retry')
    }
  }

  let waking = false
  async function tick() {
    if (waking) return
    if (!ctx.sessionController) return           // 服务还没就绪 → 下一 tick 再来
    if (await budgetBlockedNow('生物钟叫醒')) return
    // 2026-10-23：每个 tick 都校正一次权限（会话可能在别处被切回 workspace-write）。
    ensurePermission('tick')
    const st = readState()
    const t = today()
    const currentSlot = (Array.isArray(st?.slots) ? st.slots : []).find((s) => s.id === st?.slotId)
    // C（2026-10-23）：窗口过了就记 missed，不补醒；也不让旧计划在窗口外迟到叫醒。
    if (currentSlot && !st.fired && currentSlot.status === 'pending' && Number(currentSlot.end) <= nowMin()) {
      markScheduleSlot(st, currentSlot.id, 'missed', nowMin())
      writeState({ ...st, slots: st.slots })
      log(`[bili-whale] 错过窗口 ${currentSlot.window}（${currentSlot.atText}）→ 记 missed，排下一趟`)
      await runBili(['night', 'plan'])
      return
    }

    // ①-0 掷到「不看」→ **也要叫醒她**（2026-10-18 主人定：醒或不醒都要写日记 ✓）
    //    以前这个分支只是被重算掉 ✗ → 那一趟等于什么都没发生、日记也没有 ✗
    // 2026-10-20 诊断：把 skip 的判定输入写进 dm-tick-err.log（每次 tick 都记）
    if (st && st.date === t && st.action === 'skip') {
      try {
        fs.appendFileSync(path.join(platformDir(), 'dm-tick-err.log'),
          `[skip-check] ${new Date().toISOString()} fired=${st.fired} at=${st.at} endAt=${st.endAt} nowMin=${nowMin()} pass=${!st.fired && nowMin() >= Number(st.at ?? st.endAt ?? 0)}\n`)
      } catch {}
    }
    if (st && st.date === t && st.action === 'skip' && !st.fired && nowMin() >= Number(st.at ?? st.endAt ?? 0)) {
      waking = true
      try {
        await ensureSession()
        await promptBili(
          {
            requestId: `bili-whale-skip-${Date.now()}`,
            sessionId,
            mode: 'queue',
            content: [{
              type: 'text',
              text: [
                ...identityContextLines(),
                toolLine(),
                `【这次轻醒 / 不看】${st.reason ?? ''}（窗口 ${st.window ?? '?'}；只跳过这一趟，下一趟继续）`,
                '',
                ...(st.slotId ? [
                  '这次只是**一趟轻醒**，不用按“整晚不看”写两本长日记：',
                  '1) 写一小段（≤100 字）为什么这趟不想看，记进日记即可',
                  '2) `node bili.mjs diary log night-skip --note "…理由…"`',
                  '3) `comment-digest` 扫一眼有没有没回的评论',
                  '4) 推我一句就收工，下一趟到点继续 ✓',
                ] : [
                  '按 AGENTS.md 的「不看的那晚」做（不要等我说话，直接做）：',
                  '1) **两本日记都要写**，而且必须写清"为什么不想看"（累/没吃饱/心情不好/就是不想… 不许只写"跳过"两个字 ✗）',
                  '2) `node bili.mjs diary log night-skip --note "…理由…"`',
                  '3) `comment-digest` 扫一眼有没有没回的评论',
                  '4) 推给我：**日记里最想对我说的那一段** + 今天谁找过你 ✓',
                ]),
              ].join('\n'),
            }],
          },
          new AbortController().signal,
        )
        const slots = Array.isArray(st.slots) ? st.slots : []
        if (st.slotId) markScheduleSlot(st, st.slotId, 'skipped', nowMin())
        writeState({
          ...st,
          slots,
          fired: true,
          done: st.slotId ? false : true,   // 新排程只结束当前 slot；旧格式才结束全天
          wakes: Number(st.wakes ?? 0) + 1,
        })
        log(`[bili-whale] 这次轻醒 → 已叫醒她写日记 · ${st.reason ?? ''}${st.slotId ? '（继续下一趟）' : ''}`)
      } catch (e) {
        log(`[bili-whale] 不看那晚叫醒失败：${String(e.message).slice(0, 120)}`)
      } finally {
        waking = false
      }
      return
    }

    // ① 该重算的情形：没计划 / 跨天 / 上次已醒 / 排程走完 / 上一次轻醒已投递
    if (!st || st.date !== t || st.woke === true || st.done === true || !st.action
      || (st.action === 'skip' && st.fired === true)) {
      if (st && st.date === t && st.action === 'done') return   // 今天的次数用完了，别反复算
      const r = await runBili(['night', 'plan'])
      if (!r.ok) log(`[bili-whale] plan 失败：${(r.err || r.out).slice(0, 160)}`)
      return
    }

    if (st.action === 'wake' && !st.fired && nowMin() >= Number(st.at)) {
      waking = true
      try {
        await ensureSession()
        await promptBili(
          {
            requestId: `bili-whale-${Date.now()}`,
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text: wakePrompt(st, TOOL_CMD) }],
          },
          new AbortController().signal,
        )
        const slots = Array.isArray(st.slots) ? st.slots : []
        if (st.slotId) markScheduleSlot(st, st.slotId, 'fired', nowMin())
        writeState({
          ...st,
          slots,
          fired: true,
          woke: true,
          done: false,
          wakes: Number(st.wakes ?? 0) + 1,
          watchWakes: (Number(st.watchWakes ?? 0) || 0) + 1,
          wokeAt: new Date().toISOString(),
        })
        log(`[bili-whale] 生物钟叫醒 · ${st.atText ?? ''}${st.window ? '（' + st.window + '）' : ''} · 第 ${Number(st.wakes ?? 0) + 1} 次`)
      } catch (e) {
        log(`[bili-whale] 叫醒失败：${String(e.message).slice(0, 160)}（下一 tick 重试）`)
      } finally {
        waking = false
      }
    }
  }

  // ── 全天监听（2026-10-18 加）：插件自己轮询收件箱，有人找她就叫醒她 ────────────────
  // 为什么放这里：`listen.allDay` 只控制"守多久" ✓，但**没人启动 listener** ✗ —— 跟生物钟当初的病一样。
  // 现在插件每 listen.commentIntervalSec 秒看一眼「回复我的 / @我的」；有新东西就 prompt 她一次。
  const LSTATE = path.join(PLATFORM_DIR, LISTEN_STATE)
  const readL = () => { try { return JSON.parse(fs.readFileSync(LSTATE, 'utf8')) } catch { return null } }
  const writeL = (o) => { try { fs.mkdirSync(path.dirname(LSTATE), { recursive: true }); fs.writeFileSync(LSTATE, JSON.stringify(o, null, 2) + '\n') } catch {} }
  const inWindow = (cfg) => {
    const wins = Array.isArray(cfg?.night?.windows) ? cfg.night.windows : []
    const d = new Date(); const m = d.getHours() * 60 + d.getMinutes()
    return wins.some((w) => {
      const [sh, sm] = String(w.start ?? '').split(':').map(Number)
      const [eh, em] = String(w.end ?? '').split(':').map(Number)
      const s = (sh === 24 ? 1440 : sh * 60) + (sm || 0)
      const e = (eh === 24 ? 1440 : eh * 60) + (em || 0)
      return m >= s && m < e
    })
  }

  let listening = false
  let lastListenAt = 0
  // 直播间监听（2026-10-18 加）：插件替主人管着 `danmaku await` ✓
  let liveProc = null
  let liveRetryAt = 0
  let liveWaking = false
  let liveStopping = false   // 主动停（关开关）→ 退出回调不要当成"异常退出" ✗
  // 2026-10-26：danmaku-await 目前是「未实现」（退出码 3）。看到一次就不再重试，
  // 免得每分钟白拉子进程、日志刷屏（要恢复：实现脚本后删掉这个开关，见 RISK R30）。
  let liveUnimplemented = false
  let liveRoomNow = ''       // 当前在听的房间号（用于检测"主人换了房间" ✓）
    // ── 私信监听（2026-10-19）──────────────────────────────────────
    //   只认主人那一个会话 ✓ 系统通知/陌生人一律忽略 ✗
    //   你不说话 = 没有新私信 = 不叫醒 = 零 token ✓（主人设计的低风险互动 ✓）
    let dmBusy = false
    let lastDmAt = 0
    // 身份注入已统一到模块级 identityContextLines()（人设卡 + 身份对齐 + QQ 脱敏记忆）。
    // 旧的三字段 personaLine 保留在历史里不再使用，避免和统一人设卡打架。

    // ── 工具链绝对路径（2026-10-20）──────────────────────────────────
    //   她的会话 cwd 是用户主目录，`node bili.mjs` 在那里根本不存在 ✗
    //   2026-10-20 实测：她在 D:\ / C:\ 里 glob 了一圈找 bili.mjs，还超时了 ✗ → 每条提示都带上路径 ✓
    const TOOL_CMD = `node "${biliMjs}"`
    const toolLine = () => `［工具］所有命令都用这一条：\`${TOOL_CMD} <子命令>\`（提示里写 "bili.mjs" 的都指它）—— 别去别处找 ✗`

    async function dmTick() {
      if (dmBusy) return
      if (await budgetBlockedNow('私信叫醒')) return
      let cfg
      try { cfg = JSON.parse(fs.readFileSync(CFG_FILE_REF, "utf8")) } catch { cfg = {} }
      const L = cfg.listen ?? {}
      if (!L.dm) return
      if (Date.now() - lastDmAt < 5_000) return   // 2026-10-19：原来 60s 和定时器叠成双层节流 → 最坏 2 分钟 ✗ 改成 5s
      lastDmAt = Date.now()
      dmBusy = true
      try {
        // 2026-10-20（用户定）：listen.dmScope = 'all' 时**谁找她都叫醒她**（不只主人）
        const P = cfg.priority ?? {}
        const dmMids = (Array.isArray(P.dmAlwaysReplyMids) ? P.dmAlwaysReplyMids : [])
          .map((x) => String(x).trim()).filter((x) => /^\d+$/.test(x))
        const any = String(L.dmScope ?? "owner") === "all" || dmMids.length > 0
        const r = await runBili(["dm-await", "--once", "--json", ...(any ? ["--any"] : [])])
        const line = String(r.out ?? "").trim().split("\n").pop() ?? ""
        let j = null
        try { j = JSON.parse(line) } catch { j = null }
        if (!j?.hit) return
        const ownerMid = String(cfg.owner?.mid ?? "")
        let items = any
          ? (j.items ?? [])
          : [{ mid: j.mid, name: j.name, text: j.text, ts: j.ts }]
        // 指定 UID：只处理名单里的私信；名单为空时保持原来的 owner/all 行为。
        if (dmMids.length) items = items.filter((it) => dmMids.includes(String(it.mid)))
        if (!items.length) return
        const forcedDm = dmMids.length > 0
        const block = items.slice(0, 5).map((it) => {
          const mine = String(it.mid) === ownerMid
          const who = `${it.name || "mid " + it.mid}（${it.mid}）`
          return mine
            ? `· 主人 ${who} 说：${String(it.text ?? "").slice(0, 300)}\n  → 直接回：\`dm --msg "…" --go\` ✓（不用审核）；而且要比平时更温柔：先回应关心、再答内容，不杠不顶嘴`
            : `· ${who} 说：${String(it.text ?? "").slice(0, 300)}\n  → 回：\`dm --to ${it.mid} --msg "…" --dry\` → \`--go\`（≤200 字 · 一人一天 3 条 · 一天共 12 条 · **只能回不能主动发** ✓）`
        })
        await ensureSession()
        await promptBili({
          requestId: `bili-whale-dm-${Date.now()}`,
          sessionId,
          mode: "queue",
          content: [{
            type: "text",
            text: [
              ...identityContextLines(),
              toolLine(),
              any ? `【有 ${items.length} 条新私信】` : `【主人私信】${j.name}（mid ${j.mid}）刚给你发私信：`,
              "",
              ...block,
              "",
              ...(forcedDm ? [
                `【优先私信】这些 UID 的私信必须回复：${dmMids.join('、')}。`,
                "不要以「不回」结束；即使内容一般也至少回一句。B站私信条数/风控仍可能拒绝，但必须先尝试 `dm --to <mid> --go`。",
                "",
              ] : []),
              "按 AGENTS.md「私信」做（不要等我说话，直接做）：",
              "1) 主人 → **直接回，不用审核** ✓，要比平时更温柔（先回应关心，不顶嘴）；其他人 → `dm --to <mid>` 回复（**只回不主动发** ✓）",
              "2) 一两句就够 —— 私信是聊天，不是评论区 ✗",
              "3) 吵架 / 要隐私 / 要你代表主人承诺 / 明显是广告或引流 → **不回** ✗（直接不理，别解释）",
              "4) 回完把对方说的写进日记「偏好校准」✓",
            ].join("\n"),
          }],
        }, new AbortController().signal)   // 2026-10-19 修：prompt 的第二个参数是 signal ✗ 漏传会 TypeError
      } catch (e) {
        try { fs.appendFileSync(path.join(platformDir(), "dm-tick-err.log"), new Date().toISOString() + " " + (e?.stack ?? e) + "\n") } catch {}
      }
      finally { dmBusy = false }
    }

  async function listenTick() {
    if (listening) return
    if (await budgetBlockedNow('评论区倾听')) return
    let cfg
    try { cfg = JSON.parse(fs.readFileSync(CFG_FILE_REF, 'utf8')) } catch { cfg = {} }
    const L = cfg.listen ?? {}
    if (L.comment === false) return                              // 评论区监听关掉了 ✓
    // 下限 60 秒（2026-10-18 测试期曾临时放宽到 2 秒 ✓ 已还原 ✓ —— B站 接口经不起每 2 秒锤 ✗）
    const interval = Math.max(60, Number(L.commentIntervalSec ?? 300)) * 1000
    if (Date.now() - lastListenAt < interval) return
    lastListenAt = Date.now()
    // 「全天」关掉时：只在她醒着的窗口里听（省 token / 更自然 ✓）
    if (!L.allDay && !inWindow(cfg)) return
    listening = true
    try {
      const cred = JSON.parse(fs.readFileSync(CRED_REF, 'utf8'))
      const H = makeHeaders(cred)
      const since = Number(readL()?.lastSeen ?? 0)
      const items = []
      items.push(...(await pullFeed('reply', { headers: H, pages: 1 })).items)
      if (String(L.scope ?? 'both') !== 'reply') {
        try { items.push(...(await pullFeed('at', { headers: H, pages: 1 })).items) } catch {}
      }
      // 第一次跑：只把"现在"当基线，不把历史回复全倒一遍 ✓
      if (!since) { writeL({ lastSeen: Math.floor(Date.now() / 1000) }); listening = false; return }
      const fresh = items.filter((x) => Number(x.t) > since && (!L.onlyOwner || String(x.mid) === String(cfg.owner?.mid ?? '')))
      if (!fresh.length) { listening = false; return }
      fresh.sort((a, b) => a.t - b.t)
      const P = cfg.priority ?? {}
      const mentionMids = (Array.isArray(P.mentionAlwaysReplyMids) ? P.mentionAlwaysReplyMids : [])
        .map((x) => String(x).trim()).filter((x) => /^\d+$/.test(x))
      const rawRate = P.replyRate
      const hasRate = rawRate !== undefined && rawRate !== null && rawRate !== ''
        && Number.isFinite(Number(rawRate))
      const rate = hasRate ? Math.max(0, Math.min(1, Number(rawRate))) : 1
      const selected = []
      for (const x of fresh) {
        if (x.kind === 'at') {
          // @ 默认都处理；名单只负责把这些 UID 标成“必回”，不排斥其他人的 @。
          selected.push(x)
        } else if (!hasRate || Math.random() < rate) {
          // 只对“回复我的”做比例抽样；@ 不受这个比例影响。
          selected.push(x)
        }
      }
      if (!selected.length) {
        writeL({ lastSeen: Math.max(...fresh.map((x) => Number(x.t))) })
        listening = false
        return
      }
      const forcedMids = new Set(selected
        .filter((x) => x.kind === 'at' && mentionMids.includes(String(x.mid)))
        .map((x) => String(x.mid)))
      const forced = forcedMids.size > 0
      const who = selected.map((x) => `${x.who}（${x.kind === 'at' ? '@' : '回复'}）`).join('、')
      const L2 = limitsNow()
      const selectedLines = selected.slice(0, 20).map((x) =>
        `- ${x.kind === 'at' ? '@' : '回复'} by ${x.who}（mid ${x.mid}）oid=${x.oid} root=${x.root} parent=${x.parent} business=${x.business}`)
      await ensureSession()
      await promptBili(
        {
          requestId: `bili-whale-listen-${Date.now()}`,
          sessionId,
          mode: 'queue',
          content: [{
            type: 'text',
            text: [
              ...identityContextLines(),
              toolLine(),
              `【有人找你】${selected.length} 条新消息：${who}。`,
              '',
              '本轮只处理下面列表里的消息，不要回复列表外的东西：',
              ...selectedLines,
              '',
              '按 AGENTS.md 的「倾听」做（不要等我说话，直接做）：',
              '1) `node bili.mjs comment-digest --hours 24` —— 用它核对上面列表的评论坐标和正文；**只回列表内**（合并策略 ✓ 不可关）',
              ...(forced ? [
                `【优先 @】这些 UID 在视频下 @ 你，必须回复：${[...forcedMids].join('、')}。`,
                '本轮至少为其中每一条各回一条；不要以「不回」结束（攻击/隐私/违法内容除外，遇到就 attack add 报备）。',
                '',
              ] : []),
              '2) 只回「一两句能答清的提问 + 轻互动」，一条收住；吵架/要隐私/长篇追问/代表主人承诺 → 不回 ✗',
              '2.5) ⭐ **疑似被攻击/阴阳怪气 → 不回，改 `attack add` 记待审**（带序号，自动私信报备给管理员；他晚上审完批准才回）',
              '     例：`attack add --oid … --root … --parent … --who "昵称" --text "他的原话" [--suggest "你想回的"]`；待审不占额度 ✓',
              '3) ⭐ **谁找你都直接回**（2026-10-20 用户改：不再走草稿 ✓）：',
              // mid 动态读配置 ✓（别把 uid 写死进代码 ✗ 开源版会带出去 ✗）
              `   · 对方是**主人**（mid ${cfg.owner?.mid ?? '（未配置）'}）→ 直接回 ✓，而且要比平时更温柔（先谢谢/回应关心，不抬杠、不回嘴）`,
              `   · 对方是**其他人** → **也直接回** ✓（一样带 --auto 过闸，额度「回找我的人」${L2.replyDaily} 条/天）`,
              '     `comment --oid … --root … --parent … --message "…" --auto --once-per-person（仅当开关=开 ✓） --dry` → `--go` → `thread` 复核 ✓',
              '     ⚠️ 别带 --ta —— 那是"我去搭热评"，两本账分开记 ✗',
              `   · 如果那条评论在**我自己发的动态**底下 → 带 \`--type 17\`（新版转发动态）或 \`--type 11\`（图文）；工具会按 oid 自动记进「动态回复」账：每类 ${L2.mineDaily} 条/天 · 每人 ${L2.minePerPerson} 条 ✓`,
              '     ⚠️ oid 必须用 comment-digest 打印的坐标（19 位动态 id 不能手抄：JS 数字会丢末几位）',
              '4) 吵架 / 要隐私 / 要你代表主人承诺 → 一条都不回 ✗（直接不理，别解释）',
              '5) 别贪多：这一批处理完就停 ✓（**只有设置页「同一个人最多只回一条」= 开时**才加 --once-per-person ✓；关掉就别加 ✗）',
            ].join('\n'),
          }],
        },
        new AbortController().signal,
      )
      writeL({ lastSeen: Math.max(...fresh.map((x) => Number(x.t))) })
      log(`[bili-whale] 监听命中 ${selected.length} 条（${who}）→ 已叫醒${forced ? ' · 优先 @ 必回' : ''}`)
    } catch (e) {
      log(`[bili-whale] 监听失败：${String(e.message).slice(0, 140)}`)
    } finally {
      listening = false
    }
  }

  // ── 直播间监听：起一个 `danmaku await` 子进程；它命中就退出（自带契约）→ 叫醒她 → 再挂上 ──
  // 为什么放独立循环：tick() 会在"今天 done"时提前 return ✗，直播间不能跟着停 ✓
  async function liveTick() {
    // ⚠️ 2026-10-18 主人定：直播间是**独立开关** —— 点开就开始、关掉就停（不受作息影响 ✓）
    if (ctx.sessionController) {
      let cur = {}
      try { cur = JSON.parse(fs.readFileSync(CFG_FILE_REF, 'utf8')) } catch {}
      if (!cur.listen?.live && liveProc !== null) {           // 开关被关掉 → 立刻停子进程 ✓
        liveStopping = true
        try { liveProc.kill() } catch {}
        liveProc = null
        liveRetryAt = 0
        log('[bili-whale] 直播间监听已停（开关关掉了 ✓）')
        return
      }
      // 2026-10-18 加：**换了房间号** → 也要立刻换线（以前只认开关 ✗ 换房间还在听老房间 ✗）
      const wantRoom = String(cur.listen?.liveRoom ?? '').trim()
      if (liveProc !== null && wantRoom && liveRoomNow && wantRoom !== liveRoomNow) {
        liveStopping = true
        try { liveProc.kill() } catch {}
        liveProc = null
        liveRetryAt = 0
        log(`[bili-whale] 直播间换房间：${liveRoomNow} → ${wantRoom}（立刻重挂 ✓）`)
        liveRoomNow = ''
        return
      }
    }
    if (liveProc !== null || liveWaking || liveRetryAt > Date.now()) return
    if (!ctx.sessionController) return
    if (await budgetBlockedNow('直播间叫醒')) return
    let cfg = {}
    try { cfg = JSON.parse(fs.readFileSync(CFG_FILE_REF, 'utf8')) } catch {}
    const L = cfg.listen ?? {}
    const room = String(L.liveRoom ?? '').trim()
    if (!L.live || !room) return
    if (liveUnimplemented) return

    // ⚠️ `danmaku-await.mjs` 是独立脚本（不走 bili.mjs 的 danmaku 子命令 ✗ —— 那是 pre/send/live ✓）
    const awaitScript = path.join(path.dirname(biliMjs), 'commands', 'danmaku-await.mjs')
    const args = [awaitScript, '--room', room]
    if (String(L.liveScope ?? 'owner') === 'owner' && cfg.owner?.mid) args.push('--operator-uid', String(cfg.owner.mid))
    liveProc = execFile(NODE_EXE, args, {   // ⚠️ 必须真 node（主程序会让 gethistory 返回空 ✗）
      // ⚠️ 千万不要写 `timeout: 0` ✗ —— 实测它会把子进程立刻 SIGTERM 掉（探针验过 ✓）；
      //   直播间监听本来就是长驻的，**不设 timeout** 才对 ✓
      windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: NODE_ENV,
      cwd: path.dirname(biliMjs),   // 脚本按相对路径找 lib/，必须给 cwd ✓
    }, (err, stdout, stderr) => {
      liveProc = null
      if (liveStopping) { liveStopping = false; return }   // 那是我们主动停的 ✓ 不算异常 ✗
      // 退出码 3 = 脚本自己声明「未实现」：记一条日志后不再重试（RISK R30）。
      if (err?.code === 3 || /未实现/.test(String(stderr ?? ''))) {
        liveUnimplemented = true
        console.error('[scheduler] 直播间监听未实现（danmaku-await 退出 3）：已停止重试；实现后再打开 listen.live')
        return
      }
      const out = String(stdout ?? '')
      // ⚠️ 2026-10-18 修真 bug：`danmaku-await` 命中时打印的是 **AWAIT_HIT** ✗
      //   我原来等的是 DANMAKU_HIT ✗ → 听见了也认不出 → 一直"退出/重挂"
      if (/AWAIT_HIT|DANMAKU_HIT/.test(out)) {
        liveWaking = true
        const lines = out.split('\n').map((s) => s.trim()).filter((s) => /AWAIT_HIT|DANMAKU_HIT|@/.test(s)).slice(-3).join(' / ').slice(0, 300)
        ;(async () => {
          try {
            await ensureSession()
            await promptBili({
              requestId: `bili-whale-live-${Date.now()}`,
              sessionId,
              mode: 'queue',
              content: [{
                type: 'text',
                text: [
                  ...identityContextLines(),
                  toolLine(),
                  `【直播间有人叫你】${lines || '（看输出）'}`,
                  '',
                  '按 AGENTS.md「倾听 · 直播间」做（不要等我说话，直接做）：',
                  '1) 看是谁、说了什么；范围按主人设置（只回主人 / 只回 @她的）✓',
                  '   是主人 → 比平时更温柔，先回应再说话，不杠不顶嘴 ✓',
                  '2) 回一句就收住（弹幕不是评论区，别长篇 ✗）；吵架/要隐私/不认识的 → 不回 ✗',
                  '   发弹幕：`node bili.mjs danmaku send --msg "…" --reply-mid <对方mid> --reply-name <对方昵称>` → `--dry` → `--go` ✓（**不用审核 ✓ 也不用报备 ✗ 2026-10-18 主人定**）',
                ].join('\n'),
              }],
            }, new AbortController().signal)
            log(`[bili-whale] 直播间命中 → 已叫醒 · ${lines.slice(0, 80)}`)
          } catch (e) {
            log(`[bili-whale] 直播间叫醒失败：${String(e.message).slice(0, 120)}`)
          } finally {
            liveWaking = false
            // 2026-10-18 主人定：**监听到就回（实时）** ✓ —— 回复完 2 秒就重新挂上 ✗ 不再冷却 2 分钟
            liveRetryAt = Date.now() + 2_000
          }
        })()
      } else {
        // 退出但没命中 → 把"怎么退的"记全（2026-10-18：以前只记一句话，排不动 ✗）
        // 退避 12 秒（2026-10-18 改：原来 60 秒，外部误杀一次要等一分钟以上才回来 ✗）
        const tail = String(out ?? '').trim().split('\n').slice(-2).join(' | ').slice(-200)
        const why = [
          err ? `code=${err.code ?? '?'} signal=${err.signal ?? '?'}` : 'code=0',
          String(stderr ?? '').trim().slice(0, 150),
          tail,
        ].filter(Boolean).join(' · ')
        log(`[bili-whale] 直播间监听退出：${why}（12 秒后重挂）`)
        liveRetryAt = Date.now() + 12_000
      }
    })
    liveRoomNow = room   // 记下"现在听的是哪个房间" → 主人换房间时靠它检测 ✓
    log(`[bili-whale] 直播间监听已挂上（房间 ${room} · ${String(L.liveScope ?? 'owner') === 'owner' ? '只回主人' : '只回@她的'}）✓`)
  }

  // ── 四类动态的定点提醒 + 补发（2026-10-21 加，当晚扩成"错过就补"）──────
  //   正常：按设置页的 slot 到点提醒（默认 08/12/16/20）
  //   补发：重启后发现今天有类错过了时段 → **一次只提醒一类**，两条之间隔 dynamics.gapMin
  //   （`daily-nudge.json` 记每类最近一次提醒，gapMin 内不重复吵她 ✓）
  async function dynTick() {
    if (!ctx.sessionController) return
    if (await budgetBlockedNow('动态提醒')) return
    const cfgNow = config()
    const KINDS_NOW = kindsNow(cfgNow)
    const gapMs = Math.max(5, dynamicsGapMin(cfgNow)) * 60_000
    const L = limitsNow()
    const now = new Date()
    const h = now.getHours() + now.getMinutes() / 60
    const NUDGE = path.join(dshHome, 'daily-nudge.json')
    let ns = {}
    try { ns = JSON.parse(fs.readFileSync(NUDGE, 'utf8')) } catch {}
    let dstate = {}
    try { dstate = JSON.parse(fs.readFileSync(path.join(PLATFORM_DIR, 'daily-dynamic.json'), 'utf8')) } catch {}
    // 最近一次真发出去的动态（用来保证补发之间有 30 分钟）
    const lastPost = Object.values(dstate ?? {})
      .map((s) => new Date(s?.at ?? 0).getTime())
      .filter((t) => Number.isFinite(t) && t > 0)
      .sort((a, b) => b - a)[0] ?? 0
    if (lastPost && Date.now() - lastPost < gapMs) return

    // ── 23:00 待审清单（2026-10-21 用户定：晚上回来审"疑似攻击/阴阳"那些）────
    if (h >= 23 && h < 23.2) {
      const akey = `${today()}:attack-review`
      if (!ns[akey]) {
        const n = attackPending()
        ns[akey] = new Date().toISOString()
        try { fs.writeFileSync(NUDGE, JSON.stringify(ns, null, 2)) } catch {}
        if (n > 0) {
          try {
            await ensureSession()
            await promptBili({
              requestId: `bili-whale-review-${Date.now()}`,
              sessionId,
              mode: 'queue',
              content: [{
                type: 'text',
                text: [
                  ...identityContextLines(),
                  `【该审了】今天攒了 ${n} 条「疑似被攻击/阴阳怪气」的待审（#1 … #${n}）。`,
                  '',
                  '1) `attack list` 看全部（带序号、对方原话、位置）',
                  '2) 用 `notify` 把清单推给我，等我逐条说「批 #n」或「拒 #n」',
                  '3) 我说批 → 再 `comment` 回那条；说拒 → `attack reject #n`，然后彻底不理 ✗',
                  '⚠️ 没批之前**一条都不许回**（脚本也会拦）',
                  toolLine(),
                ].join('\n'),
              }],
            }, new AbortController().signal)
            log(`[bili-whale] 23:00 待审提醒（${n} 条）`)
          } catch (e) { log(`[bili-whale] 待审提醒失败：${String(e.message).slice(0, 100)}`) }
          return
        }
      }
    }

    // ── 搭话额度"催进度"（2026-10-21 用户要"每天用完"）──────────────
    //   16:00 之后如果还没搭够，每 90 分钟提醒她一次，直到用完 ✓
    if (h >= 16) {
      const used = taToday()
      const left = L.taDaily - used
      if (left > 0) {
        const tkey = `${today()}:ta-nudge`
        const last = ns[tkey] ? new Date(ns[tkey]).getTime() : 0
        if (!last || Date.now() - last > 90 * 60_000) {
          ns[tkey] = new Date().toISOString()
          try { fs.writeFileSync(NUDGE, JSON.stringify(ns, null, 2)) } catch {}
          try {
            await ensureSession()
            await promptBili({
              requestId: `bili-whale-ta-${Date.now()}`,
              sessionId,
              mode: 'queue',
              content: [{
                type: 'text',
                text: [
                  ...identityContextLines(),
                  `【搭话进度】今天才搭了 ${used}/${L.taDaily} 条，还差 ${left} 条。`,
                  '',
                  '去 debrief 的热评里挑几句能接的（吐槽/补充/接梗都算），带 `--ta` 发：',
                  '`comment --oid <aid> --bvid <BV> --root <rpid> --parent <rpid> --message "…" --auto --ta --dry` → `--go`',
                  '⚠️ 每轮至少搭 2~3 条；每条都会私信报备给我（【主动搭话】）✓',
                  toolLine(),
                ].join('\n'),
              }],
            }, new AbortController().signal)
            log(`[bili-whale] 搭话催进度：${used}/${L.taDaily}`)
          } catch (e) { log(`[bili-whale] 搭话提醒失败：${String(e.message).slice(0, 100)}`) }
          return
        }
      }
    }

    if (!dynamicsEnabled(cfgNow)) return
    for (const [kind, k] of Object.entries(KINDS_NOW)) {
      if (k.enabled === false) continue                     // 设置页关掉这一类
      if (dstate?.[kind]?.date === today()) continue      // 今天已发
      if (h < Number(k.slot)) continue                    // 还没到点
      // 2026-10-21 用户定：**过了本类时段只有上线日才补**，明天起照常（错过就等明天）
      const inSlotNow = slotOf(kind, now, KINDS_NOW)
      if (!inSlotNow && today() !== CATCHUP_DAY) continue
      const key = `${today()}:${kind}`
      const lastNudge = ns[key] ? new Date(ns[key]).getTime() : 0
      if (lastNudge && Date.now() - lastNudge < gapMs) continue
      ns[key] = new Date().toISOString()
      try { fs.writeFileSync(NUDGE, JSON.stringify(ns, null, 2)) } catch {}

      // 还在本类时段里 → 正常提醒；已经过了（只有上线日）→ 补发口吻（必须带 --catchup）
      const inSlot = inSlotNow
      try {
        await ensureSession()
        await promptBili({
          requestId: `bili-whale-daily-${kind}-${Date.now()}`,
          sessionId,
          mode: 'queue',
          content: [{
            type: 'text',
            text: [
              ...identityContextLines(),
              inSlot
                ? `【该发动态了】${String(k.slot).padStart(2, '0')}:00 —— 今天「${k.n} 类 · ${k.label}」那条还没发。`
                : `【补发】今天「${k.n} 类 · ${k.label}」（本该 ${String(k.slot).padStart(2, '0')}:00）错过了 —— 现在补上。`,
              '',
              '按 AGENTS.md 的「四类动态」做（不要等我说话，直接做）：',
              ...(pinOf(kind) ? [`0) ⭐ 今天这条**主人已经拍板**：${pinOf(kind)}（别再自己挑了，直接用这个 ✓）`] : []),
              ...(noteOf(kind) ? [`0.5) ⭐ **主人给的要点，必须写进正文**：${noteOf(kind)}`] : []),
              kind === 'best'
                ? '1) `score --best` 看今天最高分那条；还没记分就先 `score <BV> --score N` 记上'
                : `1) \`gamefeed${kind === 'game' ? '' : ' --for ' + kind}\` 看候选 → 挑 2~3 条 debrief，选一条真的做得好的`,
              `2) 写正文（${k.minLen}~${k.maxLen} 字，用你的口吻评价，别只说"好看"）`,
              inSlot
                ? `3) \`daily --kind ${kind} --text "…" --dry\` → \`--go\``
                : `3) \`daily --kind ${kind} --catchup --text "…" --dry\` → \`--go\`（**补发必须带 --catchup**）`,
              '',
              `⚠️ 开头必须是固定前缀：${k.prefix}（脚本会自动补 ✓）`,
              inSlot
                ? `⚠️ 这类只在 ${String(k.slot).padStart(2, '0')}:00 起这段时间能发，过了就得用 --catchup 补 ✗`
                : `⚠️ 补发一次只补一类，下一条要等 30 分钟（脚本会拦）✗`,
              '⚠️ 公开发给所有人，正文别 @ 人；挑不出来就在日记里写"今天没有值得推的" ✓',
              toolLine(),
            ].join('\n'),
          }],
        }, new AbortController().signal)
        log(`[bili-whale] 动态提醒 · ${kind}（${inSlot ? '到点' : '补发'}）`)
      } catch (e) {
        log(`[bili-whale] 动态提醒失败：${String(e.message).slice(0, 120)}`)
      }
      return   // 一次只提醒一类 ✓
    }
  }

  const timer = setInterval(() => { tick().catch(() => {}) }, TICK_MS)
  // 一次性启动定时器单独收好：stop() 必须把它们也清掉，否则测试/卸载后进程
  // 仍被 8~25 秒后的回调吊着（Node 24 下强制 exit 还会撞 libuv 断言）。
  const startupTimers = [
    setTimeout(() => { tick().catch(() => {}) }, 8000),          // 启动 8 秒后先跑一次
    setTimeout(() => { dynTick().catch(() => {}) }, 12_000),
    setTimeout(() => { listenTick().catch(() => {}) }, 15_000),
    setTimeout(() => { dmTick().catch(() => {}) }, 25_000),
    setTimeout(() => { liveTick().catch(() => {}) }, 20_000),
  ]
  // 2026-10-21（用户定）：四类动态各有固定发布点 —— 到点叫她一次（08/12/16/20）
  const timerDyn = setInterval(() => { dynTick().catch(() => {}) }, 60_000)
  // 30 秒看一眼"到点没"（2026-10-18 测试期曾改 2.5 秒 ✓ 已还原 ✓），真正间隔由配置定 ✓
  const timer2 = setInterval(() => { listenTick().catch(() => {}) }, 30_000)
  const timerDm = setInterval(() => { dmTick().catch(() => {}) }, 20_000)   // 2026-10-19: 60s -> 20s, 私信要像聊天; 每次只是一个 get_sessions 请求 很轻
  const timer3 = setInterval(() => { liveTick().catch(() => {}) }, 60_000)     // 直播间：挂了就一直跑，断了自动重挂 ✓
  log(`[bili-whale] 自主生物钟已启动（每 ${TICK_MS / 1000}s tick · 会话 ${sessionId}）；监听 + 直播间监看都挂上了 ✓`)

  return {
    /** 设置页一保存就调它：清掉旧计划，下一次 tick 按新配置重算 ✓ */
    invalidate() {
      // ⚠️ 2026-10-18 修：以前直接删状态文件 → 把「今天已醒几次」也抹了 ✗
      //   现在只清**计划**，保留 `{ date, wakes }` ✓（tick 里 `!st.action` 会触发重算 ✓）
      try {
        const old = readState()
        if (old && old.date === today()) writeState({ date: old.date, wakes: Number(old.wakes ?? 0) })
        else fs.rmSync(STATE, { force: true })
      } catch {}
      lastListenAt = 0            // 监听间隔也立刻重读 ✓（改完全天/间隔马上生效）
      writeL({})                  // 重置基线 → 下次按"现在"重新算，不会把旧的倒出来 ✓
      tick().catch(() => {})
      listenTick().catch(() => {})
      dmTick().catch(() => {})
      // ⭐ 直播间是**单独开关**：保存设置就立刻生效（点开就跑 ✓ 关掉就停 ✓），不等下一轮定时器
      liveTick().catch(() => {})
    },
    stop() { clearInterval(timer); clearInterval(timer2); clearInterval(timer3); clearInterval(timerDyn); clearInterval(timerDm); for (const t of startupTimers) clearTimeout(t); try { liveProc?.kill() } catch {} try { permissionListenerOff?.() } catch {} },
    /** 切角色时用：停定时器 + 取消当前 DSH 会话的在途回合，避免旧人格继续跑。 */
    async retire() {
      this.stop();
      try { await ctx.sessionController?.cancel?.({ sessionId }) } catch (error) { log(`[bili-whale] 取消旧会话失败：${error?.message ?? error}`) }
    },
    tick,
    listenTick,
    liveTick,
  }
}
