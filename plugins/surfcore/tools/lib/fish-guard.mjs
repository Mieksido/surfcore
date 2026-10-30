/**
 * B站评论区「鱼群保护」——纯逻辑 + 评论抓取 + 点赞执行。
 *
 * 三件事：
 *   ① 鱼太多就不发新楼层（顶层评论）；
 *   ② 聚拢：识别到鱼之后，把想说的话变成对那条鱼评论的回复（楼中楼）；
 *   ③ 点赞：给鱼的楼层主评论 / 楼里的鱼回复点赞，让它们被顶上去。
 *
 * 默认只服务“她自己决定说的”（--auto），主人当场授权的手动评论不拦。
 * 所有阈值都能在 SurfCore 设置页里改；状态落 ~/.dsh/surfcore/bili/fish-guard.json。
 *
 * ⚠️ 2026-10-23 修：评论列表必须先登录再取。
 *   /x/v2/reply 不带 cookie 时只返回 0~3 条「游客可见」评论，40 条样本根本拿不到，
 *   于是 fishTopLevel 永远是 0、likeTargets 永远是空 —— 点赞看起来“没反应”，
 *   实际是根本没识别到鱼。现在所有抓取都会带 credentials.json 的 cookie。
 */
import { biliState } from './state-paths.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { dayKey, withConfiguredTimeZone } from './clock.mjs'

export const FISH_GUARD_FILE = biliState('fish-guard.json')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export const DEFAULT_BILI_FISH_GUARD = Object.freeze({
  enabled: true,
  // 只看最近多少条顶层评论（热评/时间线由 sort 决定）
  sampleSize: 40,
  // 鱼顶层评论达到 N 条，或占比达到阈值 → 不发新楼层
  maxFishTopLevel: 3,
  // 不同鱼账号数也单独设阈值：防同一只鱼刷很多楼层
  maxFishMids: 3,
  maxFishRatio: 0.4,
  minSample: 8,
  // 聚拢：优先回一条回复少、还新鲜的鱼；楼里鱼回复太多就不挤进去
  gatherEnabled: true,
  // 2026-10-23 用户定：每次醒来都强制聚拢并主动评论一次；
  // 即使没有满足 gatherMax* 的鱼楼，也从鱼楼里挑一条（默认开，可用 --no-force-gather 关）。
  forceGather: true,
  gatherMaxReplies: 6,
  gatherMaxFishReplies: 2,
  gatherMaxAgeHours: 72,
  gatherCooldownHours: 12,
  // 点赞：每天/每次上限，避免像刷赞
  likeEnabled: true,
  maxLikesPerDay: 6,
  maxLikesPerRun: 4,
  likeFishReplies: true,
  // 两次点赞之间随机间隔：刚发完评论就连续点赞很容易触发风控
  likeGapMinMs: 1500,
  likeGapMaxMs: 4000,
  // 发完评论先缓一下再点赞（同一条视频里「刚发完就点赞」很像脚本）
  likeAfterCommentMs: 12000,
  // 同一个 rpid 失败后多久再试（避免每轮都撞同一个错）
  failedLikeCooldownHours: 24,
  // 风控熔断：遇到 -509/12015/12051 这类码就停手，过一段时间再试
  failCooldownMinutes: 60,
  // 同时取“时间序”和“热度序”，降低采样偏差
  includeHotSample: true,
  // 识别：用户可配「开头词 / 中间包含词 / 结尾词」，任一命中就算鱼；
  // 2026-10-23 用户定：最后一个字是「鱼」也算（咸鱼/摸鱼/鱿鱼…）；
  // 并且名字里**只要包含「肥鱼」**就算（肥鱼观察员 / 大肥鱼研究员…）。接受极小概率误伤真人。
  namePrefixes: [],
  nameSuffixes: ['肥鱼', 'fish', '鱼'],
  nameContains: ['肥鱼'],
  extraFishMids: [],
  exemptNames: [],
  exemptMids: [],
})

const clampInt = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
const clampNumber = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
const list = (value, max = 100) => {
  const arr = Array.isArray(value) ? value : String(value ?? '').split(/[\s,，;；]+/)
  return [...new Set(arr.map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, max)
}

export function normalizeBiliFishGuard(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {}
  return {
    ...DEFAULT_BILI_FISH_GUARD,
    ...src,
    enabled: src.enabled !== false,
    sampleSize: clampInt(src.sampleSize, DEFAULT_BILI_FISH_GUARD.sampleSize, 5, 100),
    maxFishTopLevel: clampInt(src.maxFishTopLevel, DEFAULT_BILI_FISH_GUARD.maxFishTopLevel, 1, 50),
    maxFishMids: clampInt(src.maxFishMids, DEFAULT_BILI_FISH_GUARD.maxFishMids, 1, 50),
    maxFishRatio: clampNumber(src.maxFishRatio, DEFAULT_BILI_FISH_GUARD.maxFishRatio, 0, 1),
    minSample: clampInt(src.minSample, DEFAULT_BILI_FISH_GUARD.minSample, 2, 100),
    gatherEnabled: src.gatherEnabled !== false,
    forceGather: src.forceGather !== false,
    gatherMaxReplies: clampInt(src.gatherMaxReplies, DEFAULT_BILI_FISH_GUARD.gatherMaxReplies, 0, 100),
    gatherMaxFishReplies: clampInt(src.gatherMaxFishReplies, DEFAULT_BILI_FISH_GUARD.gatherMaxFishReplies, 0, 50),
    gatherMaxAgeHours: clampInt(src.gatherMaxAgeHours, DEFAULT_BILI_FISH_GUARD.gatherMaxAgeHours, 1, 24 * 30),
    gatherCooldownHours: clampInt(src.gatherCooldownHours, DEFAULT_BILI_FISH_GUARD.gatherCooldownHours, 0, 24 * 30),
    likeEnabled: src.likeEnabled !== false,
    maxLikesPerDay: clampInt(src.maxLikesPerDay, DEFAULT_BILI_FISH_GUARD.maxLikesPerDay, 0, 200),
    maxLikesPerRun: clampInt(src.maxLikesPerRun, DEFAULT_BILI_FISH_GUARD.maxLikesPerRun, 0, 50),
    likeFishReplies: src.likeFishReplies !== false,
    likeGapMinMs: clampInt(src.likeGapMinMs, DEFAULT_BILI_FISH_GUARD.likeGapMinMs, 0, 30000),
    likeGapMaxMs: Math.max(
      clampInt(src.likeGapMinMs, DEFAULT_BILI_FISH_GUARD.likeGapMinMs, 0, 30000),
      clampInt(src.likeGapMaxMs, DEFAULT_BILI_FISH_GUARD.likeGapMaxMs, 0, 60000),
    ),
    likeAfterCommentMs: clampInt(src.likeAfterCommentMs, DEFAULT_BILI_FISH_GUARD.likeAfterCommentMs, 0, 120000),
    failedLikeCooldownHours: clampInt(src.failedLikeCooldownHours, DEFAULT_BILI_FISH_GUARD.failedLikeCooldownHours, 0, 24 * 30),
    failCooldownMinutes: clampInt(src.failCooldownMinutes, DEFAULT_BILI_FISH_GUARD.failCooldownMinutes, 1, 24 * 60),
    includeHotSample: src.includeHotSample !== false,
    namePrefixes: list(src.namePrefixes ?? DEFAULT_BILI_FISH_GUARD.namePrefixes, 30),
    nameSuffixes: list(src.nameSuffixes ?? DEFAULT_BILI_FISH_GUARD.nameSuffixes, 30),
    nameContains: list(src.nameContains ?? DEFAULT_BILI_FISH_GUARD.nameContains, 30),
    extraFishMids: list(src.extraFishMids, 200).filter((x) => /^\d{4,15}$/.test(x)),
    exemptNames: list(src.exemptNames, 200),
    exemptMids: list(src.exemptMids, 200).filter((x) => /^\d{4,15}$/.test(x)),
  }
}

const normName = (value) => String(value ?? '')
  .replace(/[\u200B-\u200D\uFEFF]/g, '')
  .replace(/[\s_\-—·.。,，!！?？~～]+$/g, '')
  .replace(/[0-9０-９]+$/g, '')
  .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
  .replace(/\s+/g, '')
  .toLowerCase()

export function isFishName(name, config = DEFAULT_BILI_FISH_GUARD) {
  const cfg = normalizeBiliFishGuard(config)
  const n = normName(name)
  if (!n) return false
  if (cfg.exemptNames.some((x) => normName(x) === n)) return false
  // 2026-10-23 用户定：开头词 / 中间包含词 / 结尾词，任一命中就算鱼。
  const prefix = cfg.namePrefixes.some((keyword) => {
    const k = normName(keyword)
    return k && n.startsWith(k)
  })
  const contains = cfg.nameContains.some((keyword) => {
    const k = normName(keyword)
    return k && n.includes(k)
  })
  if (prefix || contains) return true
  return cfg.nameSuffixes.some((suffix) => {
    const s = normName(suffix)
    return s && n.endsWith(s)
  })
}

/**
 * 一条评论是不是“鱼”：先按 mid（改名也不丢），再按昵称后缀。
 * 2026-10-23：设置页一直有 exemptMids，但之前只用于点赞豁免，没用于昵称判定，
 * 这里把 mid 识别补齐，和 QQ 侧的 fishIds 对齐。
 */
export function isFishComment(comment, config = DEFAULT_BILI_FISH_GUARD) {
  if (!comment) return false
  const cfg = normalizeBiliFishGuard(config)
  const mid = String(comment.mid ?? comment.member?.mid ?? '')
  if (mid && cfg.exemptMids.includes(mid)) return false
  if (mid && cfg.extraFishMids.includes(mid)) return true
  return isFishName(comment.uname ?? comment.member?.uname ?? '', cfg)
}

function normalizedComment(raw, kind = 'root') {
  const r = raw ?? {}
  const uname = String(r.member?.uname ?? r.member?.name ?? '')
  return {
    rpid: String(r.rpid_str ?? r.rpid ?? ''),
    root: String(r.root ?? r.rpid_str ?? r.rpid ?? ''),
    parent: String(r.parent ?? '0'),
    mid: String(r.member?.mid ?? r.mid ?? ''),
    uname,
    message: String(r.content?.message ?? '').replace(/\s+/g, ' ').slice(0, 500),
    like: Number(r.like) || 0,
    rcount: Number(r.rcount) || 0,
    ctime: Number(r.ctime) * 1000 || 0,
    kind,
  }
}

function markFish(comment, config) {
  return { ...comment, isFish: isFishComment(comment, config) }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
function randomBetween(min, max) {
  const lo = Math.max(0, Number(min) || 0)
  const hi = Math.max(lo, Number(max) || lo)
  if (hi <= 0) return 0
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

function today() {
  return dayKey()
}

export function loadFishGuardState(file = FISH_GUARD_FILE) {
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (!state || typeof state !== 'object') throw new Error('bad state')
    state.liked ??= {}
    state.gathered ??= {}
    state.daily ??= {}
    state.likeFailed ??= {}
    state.fishGuardLog ??= []
    return state
  } catch {
    return { version: 1, liked: {}, gathered: {}, daily: {}, likeFailed: {}, fishGuardLog: [] }
  }
}

export function saveFishGuardState(state, file = FISH_GUARD_FILE) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 只保留 30 天记录，避免文件无限膨胀
    const cutoff = Date.now() - 30 * 86400000
    for (const bucket of ['liked', 'gathered']) {
      for (const [key, at] of Object.entries(state[bucket] ?? {})) {
        if (new Date(at).getTime() < cutoff) delete state[bucket][key]
      }
    }
    // 失败记录只留 30 天；像 { at, code, message } 这样的对象
    for (const [key, item] of Object.entries(state.likeFailed ?? {})) {
      const at = typeof item === 'string' ? item : item?.at
      if (!at || new Date(at).getTime() < cutoff) delete state.likeFailed[key]
    }
    for (const key of Object.keys(state.daily ?? {})) {
      if (key < dayKey(cutoff)) delete state.daily[key]
    }
    // 鱼群检查记录：30 天 / 最多 50 条；给设置页「最近鱼群检查」用。
    if (Array.isArray(state.fishGuardLog)) {
      state.fishGuardLog = state.fishGuardLog
        .filter((item) => item && item.at && new Date(item.at).getTime() >= cutoff)
        .slice(-50)
    }
    fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n')
    return true
  } catch {
    return false
  }
}

function dailyCount(state, field) {
  return Number(state?.daily?.[today()]?.[field]) || 0
}

function bumpDaily(state, field, n = 1) {
  const d = today()
  state.daily[d] ??= { likes: 0, gathers: 0 }
  state.daily[d][field] = (Number(state.daily[d][field]) || 0) + n
}

function cookieHeader(cred = {}) {
  if (!cred || !cred.sessdata) return ''
  const parts = [`SESSDATA=${cred.sessdata}`, `bili_jct=${cred.bili_jct ?? ''}`]
  if (cred.buvid3) parts.push(`buvid3=${cred.buvid3}`)
  return parts.join('; ')
}

async function getJson(url, { referer = 'https://www.bilibili.com/', fetchImpl = fetch, cred = null } = {}) {
  // 关键：必须带 cookie。游客态 /x/v2/reply 只给 0~3 条评论，40 条样本永远凑不齐。
  const cookie = cookieHeader(cred ?? {})
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': UA,
      referer,
      accept: 'application/json',
      ...(cookie ? { cookie } : {}),
    },
  })
  const json = await response.json().catch(() => ({}))
  if (json?.code !== 0) {
    throw new Error(`B站接口 code=${json?.code ?? '?'} message=${json?.message ?? '未知错误'}`)
  }
  return json.data ?? {}
}

export async function fetchCommentSection({
  oid,
  type = '1',
  bvid = '',
  pages = 2,
  sort = 0,
  sorts = null,
  cred = null,
  fetchImpl = fetch,
} = {}) {
  if (!oid) throw new Error('缺少 oid')
  const referer = bvid ? `https://www.bilibili.com/video/${bvid}/` : 'https://www.bilibili.com/'
  // 默认同时取「时间序」与「热度序」：只看一种排序会漏掉另一种里的鱼。
  const sortList = Array.isArray(sorts) && sorts.length ? sorts : [sort]
  const seen = new Set()
  const topLevel = []
  for (const s of sortList) {
    for (let pn = 1; pn <= Math.max(1, pages); pn += 1) {
      const url = `https://api.bilibili.com/x/v2/reply?type=${encodeURIComponent(type)}&oid=${encodeURIComponent(oid)}&sort=${encodeURIComponent(s)}&ps=20&pn=${pn}`
      const data = await getJson(url, { referer, fetchImpl, cred })
      const replies = Array.isArray(data.replies) ? data.replies : []
      for (const r of replies) {
        const item = normalizedComment(r, 'root')
        if (item.rpid && seen.has(item.rpid)) continue
        if (item.rpid) seen.add(item.rpid)
        topLevel.push(item)
      }
      if (replies.length < 20) break
    }
  }
  return { topLevel, fetchedAt: Date.now(), sorts: sortList }
}

export async function fetchReplies({
  oid,
  type = '1',
  root,
  bvid = '',
  pages = 1,
  cred = null,
  fetchImpl = fetch,
} = {}) {
  if (!oid || !root) return []
  const referer = bvid ? `https://www.bilibili.com/video/${bvid}/` : 'https://www.bilibili.com/'
  const out = []
  for (let pn = 1; pn <= Math.max(1, pages); pn += 1) {
    const url = `https://api.bilibili.com/x/v2/reply/reply?type=${encodeURIComponent(type)}&oid=${encodeURIComponent(oid)}&root=${encodeURIComponent(root)}&pn=${pn}&ps=20`
    const data = await getJson(url, { referer, fetchImpl, cred })
    const replies = Array.isArray(data.replies) ? data.replies : []
    for (const r of replies) out.push(normalizedComment(r, 'reply'))
    if (replies.length < 20) break
  }
  return out
}

/**
 * 纯判定：给一组已经抓好的评论，返回是否泛滥、该回谁、该赞谁。
 * @param {{topLevel?:Array, repliesByRoot?:Object<string,Array>, config?:object, selfMid?:string, ownerMid?:string,
 *          state?:object, now?:number}} opts
 */
export function assessFishFlood({
  topLevel = [],
  repliesByRoot = {},
  config = DEFAULT_BILI_FISH_GUARD,
  selfMid = '',
  ownerMid = '',
  state = { liked: {}, gathered: {}, daily: {} },
  forceGather = false,
  now = Date.now(),
} = {}) {
  const cfg = normalizeBiliFishGuard(config)
  const exempt = new Set([String(selfMid || ''), String(ownerMid || '')].filter(Boolean))
  const sample = topLevel.slice(0, cfg.sampleSize).map((c) => markFish(c, cfg))
  const fishRoots = sample.filter((c) => c.isFish && !exempt.has(String(c.mid)))
  const fishMids = new Set(fishRoots.map((c) => String(c.mid || c.uname)).filter(Boolean))
  const total = sample.length
  const ratio = total ? fishRoots.length / total : 0
  const flooded = cfg.enabled && (fishRoots.length >= cfg.maxFishTopLevel
    || fishMids.size >= cfg.maxFishMids
    || (total >= cfg.minSample && ratio >= cfg.maxFishRatio))

  const gathered = state.gathered ?? {}
  const failedLikes = state.likeFailed ?? {}
  const failedCooldownMs = cfg.failedLikeCooldownHours * 3600000
  const gatherCandidates = fishRoots.filter((c) => {
    if (c.rcount > cfg.gatherMaxReplies) return false
    if (cfg.gatherMaxAgeHours > 0 && c.ctime && now - c.ctime > cfg.gatherMaxAgeHours * 3600000) return false
    const fishReplies = (repliesByRoot[c.rpid] ?? []).filter((r) => isFishComment(r, cfg)).length
    if (fishReplies > cfg.gatherMaxFishReplies) return false
    const last = gathered[c.rpid]
    if (last && now - new Date(last).getTime() < cfg.gatherCooldownHours * 3600000) return false
    return true
  }).sort((a, b) => (a.rcount - b.rcount) || (b.ctime - a.ctime))
  // 2026-10-23 用户定：每次醒来都强行聚拢一次。
  // 没有满足条件的鱼楼时，退而求其次选“回复最少 / 最新”的鱼楼，忽略
  // gatherMaxReplies / gatherMaxAgeHours / gatherMaxFishReplies / gatherCooldownHours。
  const gatherFallbackTarget = flooded && forceGather && cfg.gatherEnabled
    ? fishRoots.slice().sort((a, b) => (a.rcount - b.rcount) || (b.ctime - a.ctime))[0] ?? null
    : null
  const gatherTarget = cfg.gatherEnabled ? (gatherCandidates[0] ?? gatherFallbackTarget) : null
  const gatherFallback = Boolean(gatherTarget && forceGather && !gatherCandidates.length)

  const liked = state.liked ?? {}
  const likeTargets = []
  const pushTarget = (c, kind) => {
    if (!c?.rpid || exempt.has(String(c.mid)) || liked[c.rpid]) return
    // 同一个 rpid 刚失败过 → 冷却期内不再重试，避免每轮都撞同一个风控码
    const failed = failedLikes[c.rpid]
    if (failed && failedCooldownMs > 0) {
      const at = typeof failed === 'string' ? failed : failed.at
      if (at && now - new Date(at).getTime() < failedCooldownMs) return
    }
    if (likeTargets.some((x) => x.rpid === c.rpid)) return
    likeTargets.push({ rpid: c.rpid, root: c.root || c.rpid, uname: c.uname, kind, like: c.like, message: String(c.message ?? '').slice(0, 180) })
  }
  for (const root of fishRoots) pushTarget(root, 'root')
  if (cfg.likeFishReplies) {
    for (const root of fishRoots) {
      for (const reply of repliesByRoot[root.rpid] ?? []) {
        const item = markFish(reply, cfg)
        if (item.isFish) pushTarget(item, 'reply')
      }
    }
  }

  return {
    enabled: cfg.enabled,
    flooded,
    fishTopLevel: fishRoots.length,
    fishMids: fishMids.size,
    fishRatio: ratio,
    totalSample: total,
    fishReplyCount: Object.values(repliesByRoot ?? {}).flat().filter((r) => isFishComment(r, cfg)).length,
    threshold: { maxFishTopLevel: cfg.maxFishTopLevel, maxFishMids: cfg.maxFishMids, maxFishRatio: cfg.maxFishRatio, minSample: cfg.minSample },
    fishNames: [...new Set(fishRoots.map((c) => c.uname).filter(Boolean))].slice(0, 10),
    gatherTarget,
    gatherFallback,
    likeTargets: cfg.likeEnabled ? likeTargets.slice(0, cfg.maxLikesPerRun) : [],
    dailyLikes: dailyCount(state, 'likes'),
    dailyGathers: dailyCount(state, 'gathers'),
    config: cfg,
  }
}

/** 抓评论 + 判定 + 选出聚拢/点赞目标。 */
export async function planFishGuard({
  oid,
  type = '1',
  bvid = '',
  selfMid = '',
  ownerMid = '',
  config = DEFAULT_BILI_FISH_GUARD,
  state = loadFishGuardState(),
  cred = null,
  forceGather = undefined,
  fetchImpl = fetch,
} = {}) {
  const cfg = normalizeBiliFishGuard(config)
  if (!cfg.enabled) return { ok: true, enabled: false, flooded: false, gatherTarget: null, gatherFallback: false, likeTargets: [], stats: null }
  try {
    const section = await fetchCommentSection({
      oid, type, bvid, pages: 2, sorts: cfg.includeHotSample ? [0, 1] : [0], cred, fetchImpl,
    })
    // 只给“候选鱼楼”拉楼中楼，避免一次请求太多（最多 4 条鱼楼；点赞/聚拢都够用）。
    const repliesByRoot = {}
    const needReplies = cfg.gatherEnabled || (cfg.likeEnabled && cfg.likeFishReplies)
    const fishRoots = needReplies ? section.topLevel
      .filter((c) => isFishComment(c, cfg))
      .sort((a, b) => b.ctime - a.ctime)
      .slice(0, 4) : []
    for (const root of fishRoots) {
      try {
        repliesByRoot[root.rpid] = await fetchReplies({ oid, type, root: root.rpid, bvid, cred, fetchImpl })
      } catch {
        repliesByRoot[root.rpid] = []
      }
    }
    const stats = assessFishFlood({ topLevel: section.topLevel, repliesByRoot, config: cfg, selfMid, ownerMid, state, forceGather: forceGather ?? cfg.forceGather })
    const blockedUntil = Date.parse(state.likeBlockedUntil || '') || Number(state.likeBlockedUntil) || 0
    return {
      ok: true,
      enabled: true,
      flooded: stats.flooded,
      stats,
      gatherTarget: stats.gatherTarget,
      gatherFallback: Boolean(stats.gatherFallback),
      likeTargets: stats.likeTargets,
      fetchedAt: section.fetchedAt,
      loggedIn: Boolean(cred?.sessdata),
      ...(blockedUntil > Date.now() ? { likeBlockedUntil: new Date(blockedUntil).toISOString() } : {}),
    }
  } catch (error) {
    return { ok: false, enabled: true, flooded: false, error: String(error?.message ?? error), gatherTarget: null, gatherFallback: false, likeTargets: [], stats: null }
  }
}

/**
 * 把一次 `planFishGuard` 的结果记进 `fishGuardLog`，给设置页的「最近鱼群检查」用。
 *
 * 注意：只记**检查结果**，不记录是否真的发了评论；`source` 用来区分 comment / like。
 * 每次 auto 评论都会调用一次，所以即使这次“鱼太多没发”，也能在设置页看到原因。
 */
export function recordFishGuardCheck({
  state,
  plan,
  oid = '',
  bvid = '',
  source = 'comment',
  stateFile = FISH_GUARD_FILE,
  now = Date.now(),
} = {}) {
  if (!state || !plan?.ok) return null
  const stats = plan.stats ?? {}
  const record = {
    at: new Date(now).toISOString(),
    source: String(source || 'comment'),
    oid: String(oid ?? ''),
    bvid: String(bvid ?? ''),
    flooded: Boolean(plan.flooded),
    fishTopLevel: Number(stats.fishTopLevel) || 0,
    fishMids: Number(stats.fishMids) || 0,
    fishRatio: Number(stats.fishRatio) || 0,
    totalSample: Number(stats.totalSample) || 0,
    fishNames: Array.isArray(stats.fishNames) ? stats.fishNames.slice(0, 5) : [],
    gather: plan.gatherTarget ? {
      rpid: String(plan.gatherTarget.rpid ?? ''),
      uname: String(plan.gatherTarget.uname ?? ''),
    } : null,
    gatherFallback: Boolean(plan.gatherFallback),
    likeTargets: Array.isArray(plan.likeTargets) ? plan.likeTargets.length : 0,
    loggedIn: plan.loggedIn !== false,
  }
  state.fishGuardLog = Array.isArray(state.fishGuardLog) ? state.fishGuardLog : []
  state.fishGuardLog.push(record)
  if (state.fishGuardLog.length > 50) state.fishGuardLog.splice(0, state.fishGuardLog.length - 50)
  saveFishGuardState(state, stateFile)
  return record
}

/** 点赞：每个目标一次 POST；成功才落状态。 */
export async function likeFishComments({
  targets = [],
  oid,
  type = '1',
  bvid = '',
  cred = {},
  state = loadFishGuardState(),
  stateFile = FISH_GUARD_FILE,
  config = DEFAULT_BILI_FISH_GUARD,
  dry = false,
  fetchImpl = fetch,
} = {}) {
  const cfg = normalizeBiliFishGuard(config)
  const result = { ok: true, liked: [], failed: [], skipped: [], attempted: 0 }
  const save = () => {
    if (dry) return
    state.lastLikeRun = {
      at: new Date().toISOString(),
      oid: oid ? String(oid) : '',
      bvid: String(bvid || ''),
      attempted: result.attempted,
      liked: result.liked.filter((x) => !x.dry).map((x) => String(x.rpid)),
      failed: result.failed.map((x) => ({
        rpid: String(x.rpid ?? ''),
        code: x.code ?? null,
        message: String(x.message ?? x.error ?? '').slice(0, 200),
      })),
      skipped: result.skipped.slice(0, 10),
      dailyLikes: dailyCount(state, 'likes'),
      ...(result.blockedUntil ? { blockedUntil: result.blockedUntil } : {}),
    }
    saveFishGuardState(state, stateFile)
  }
  const finish = (ok = result.failed.length === 0) => {
    result.dailyLikes = dailyCount(state, 'likes')
    result.ok = ok && result.failed.length === 0
    save()
    return result
  }
  if (!cfg.enabled || !cfg.likeEnabled) {
    result.skipped.push('鱼群保护/点赞开关已关闭')
    return finish(false)
  }
  if (!oid) {
    result.skipped.push('缺少 oid')
    return finish(false)
  }
  if (!cred?.sessdata || !cred?.bili_jct) {
    result.skipped.push('缺少 B站 登录凭据（credentials.json）')
    return finish(false)
  }
  const blockedUntil = Date.parse(state.likeBlockedUntil || '') || Number(state.likeBlockedUntil) || 0
  if (blockedUntil > Date.now()) {
    result.skipped.push(`风控冷却中，约 ${Math.ceil((blockedUntil - Date.now()) / 60000)} 分钟后可再点赞`)
    result.blockedUntil = new Date(blockedUntil).toISOString()
    return finish(false)
  }
  const RISK_CODES = new Set([-509, 12015, 12051, 12035, 12011])
  const left = cfg.maxLikesPerDay - dailyCount(state, 'likes')
  if (left <= 0) {
    result.skipped.push(`今天的点赞额度已用完（${cfg.maxLikesPerDay}）`)
    return finish(false)
  }
  const referer = bvid ? `https://www.bilibili.com/video/${bvid}/` : 'https://www.bilibili.com/'
  const failedCooldownMs = cfg.failedLikeCooldownHours * 3600000
  for (const target of targets.slice(0, Math.min(cfg.maxLikesPerRun, left))) {
    if (!target?.rpid) continue
    if (state.liked?.[target.rpid]) {
      result.skipped.push(`${target.rpid} 已赞过`)
      continue
    }
    const previous = state.likeFailed?.[target.rpid]
    if (previous && failedCooldownMs > 0) {
      const at = typeof previous === 'string' ? previous : previous.at
      if (at && Date.now() - new Date(at).getTime() < failedCooldownMs) {
        result.skipped.push(`${target.rpid} 刚失败过，冷却中`)
        continue
      }
    }
    if (dry) {
      result.liked.push({ ...target, dry: true })
      continue
    }
    // 两次点赞之间随机停顿：连续快速 POST 很像脚本，B站 会直接 -509。
    if (result.attempted > 0) await sleep(randomBetween(cfg.likeGapMinMs, cfg.likeGapMaxMs))
    result.attempted += 1
    const body = new URLSearchParams({
      type: String(type), oid: String(oid), rpid: String(target.rpid), action: '1', csrf: String(cred.bili_jct ?? ''),
    })
    try {
      const response = await fetchImpl('https://api.bilibili.com/x/v2/reply/action', {
        method: 'POST',
        headers: {
          'user-agent': UA,
          referer,
          origin: 'https://www.bilibili.com',
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader(cred),
        },
        body,
      })
      const json = await response.json().catch(() => ({}))
      if (json?.code === 0) {
        const at = new Date().toISOString()
        state.liked ??= {}
        state.liked[target.rpid] = at
        // 2026-10-23 用户要求：设置里能看“给谁点过赞”。只记成功点赞，dry-run 不落。
        state.likeLog = Array.isArray(state.likeLog) ? state.likeLog : []
        state.likeLog.push({
          at,
          rpid: String(target.rpid),
          root: String(target.root || target.rpid),
          uname: String(target.uname ?? ''),
          kind: target.kind === 'reply' ? 'reply' : 'root',
          bvid: String(bvid || ''),
          oid: oid ? String(oid) : '',
          message: String(target.message ?? '').slice(0, 180),
          like: Number(target.like) || 0,
        })
        if (state.likeLog.length > 300) state.likeLog.splice(0, state.likeLog.length - 300)
        if (state.likeFailed) delete state.likeFailed[target.rpid]
        bumpDaily(state, 'likes')
        result.liked.push(target)
      } else {
        const failure = { ...target, code: json?.code, message: json?.message }
        result.failed.push(failure)
        state.likeFailed ??= {}
        state.likeFailed[target.rpid] = {
          at: new Date().toISOString(),
          code: json?.code ?? null,
          message: String(json?.message ?? '').slice(0, 200),
        }
        if (RISK_CODES.has(Number(json?.code))) {
          state.likeBlockedUntil = new Date(Date.now() + cfg.failCooldownMinutes * 60000).toISOString()
          result.blockedUntil = state.likeBlockedUntil
          result.skipped.push(`B站风控 code=${json?.code}，已冷却 ${cfg.failCooldownMinutes} 分钟`)
          break
        }
      }
    } catch (error) {
      const failure = { ...target, error: String(error?.message ?? error) }
      result.failed.push(failure)
      state.likeFailed ??= {}
      state.likeFailed[target.rpid] = { at: new Date().toISOString(), code: null, message: String(error?.message ?? error).slice(0, 200) }
    }
  }
  return finish()
}

export function markGathered(state, rpid) {
  if (!rpid) return state
  state.gathered ??= {}
  state.gathered[String(rpid)] = new Date().toISOString()
  bumpDaily(state, 'gathers')
  saveFishGuardState(state)
  return state
}

export function fishGuardStatusText(plan) {
  if (!plan) return ''
  if (!plan.ok) return `鱼群保护检查失败：${plan.error}`
  if (!plan.enabled) return '鱼群保护：已关闭'
  const s = plan.stats
  if (!s) return ''
  const bits = [
    plan.loggedIn === false ? '⚠️ 未带登录态（样本会很少）' : '已登录采样',
    `样本 ${s.totalSample} 条`,
    `鱼楼层 ${s.fishTopLevel} 条 / ${s.fishMids} 个鱼账号（阈值 ${s.threshold.maxFishTopLevel} / ${s.threshold.maxFishMids}）`,
    `占比 ${Math.round(s.fishRatio * 100)}%（阈值 ${Math.round(s.threshold.maxFishRatio * 100)}%）`,
  ]
  if (s.fishNames.length) bits.push(`识别到：${s.fishNames.join('、')}`)
  bits.push(plan.flooded ? (plan.gatherTarget ? '→ 鱼太多：聚拢回复' : '→ 鱼太多：不发新楼层') : '→ 可以发新楼层')
  if (plan.gatherTarget) bits.push(`→ ${plan.gatherFallback ? '没有合适鱼楼，强制聚拢到' : '可聚拢到'} ${plan.gatherTarget.uname || plan.gatherTarget.rpid}（rpid ${plan.gatherTarget.rpid}）`)
  if (plan.likeTargets?.length) bits.push(`→ 可点赞 ${plan.likeTargets.length} 条（今天已赞 ${s.dailyLikes}/${s.config?.maxLikesPerDay ?? '?'}）`)
  if (plan.likeBlockedUntil) bits.push(`→ 点赞风控冷却到 ${withConfiguredTimeZone(() => new Date(plan.likeBlockedUntil).toLocaleString('zh-CN'))}`)
  return `鱼群保护：${bits.join('；')}`
}

/** 给设置页的只读摘要：今天赞了几个、上次结果、风控冷却到什么时候。 */
export function fishGuardStateSummary(state = {}, config = DEFAULT_BILI_FISH_GUARD) {
  const cfg = normalizeBiliFishGuard(config)
  const blockedUntil = Date.parse(state?.likeBlockedUntil || '') || Number(state?.likeBlockedUntil) || 0
  const last = state?.lastLikeRun ?? null
  const checkLog = Array.isArray(state?.fishGuardLog) ? state.fishGuardLog : []
  const records = checkLog.slice(-10).reverse()
  const likeLog = Array.isArray(state?.likeLog) ? state.likeLog : []
  const loggedRpids = new Set(likeLog.map((x) => String(x?.rpid ?? '')))
  const legacyLikes = Object.entries(state?.liked ?? {})
    .filter(([rpid]) => !loggedRpids.has(String(rpid)))
    .map(([rpid, at]) => ({ at, rpid, root: rpid, uname: '', kind: 'root', bvid: '', oid: '', message: '', like: 0, legacy: true }))
  const likeHistory = [...likeLog, ...legacyLikes]
    .filter((x) => x && x.at)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 100)
  return {
    today: today(),
    dailyLikes: dailyCount(state, 'likes'),
    dailyGathers: dailyCount(state, 'gathers'),
    maxLikesPerDay: cfg.maxLikesPerDay,
    likedCount: Object.keys(state?.liked ?? {}).length,
    likeHistory,
    gatheredCount: Object.keys(state?.gathered ?? {}).length,
    failedCount: Object.keys(state?.likeFailed ?? {}).length,
    checkCount: checkLog.length,
    lastCheckAt: records[0]?.at ?? '',
    records,
    likeBlockedUntil: blockedUntil > Date.now() ? new Date(blockedUntil).toISOString() : '',
    lastRun: last ? {
      at: last.at ?? '',
      ok: !(Array.isArray(last.failed) && last.failed.length),
      attempted: Number(last.attempted) || 0,
      liked: Array.isArray(last.liked) ? last.liked.length : 0,
      failed: Array.isArray(last.failed) ? last.failed.slice(0, 5) : [],
      skipped: Array.isArray(last.skipped) ? last.skipped.slice(0, 5) : [],
    } : null,
  }
}
