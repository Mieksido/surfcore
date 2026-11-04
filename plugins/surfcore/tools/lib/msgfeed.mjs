// lib/msgfeed.mjs —— B 站两个"收件箱"的共用读法（回复我的 / @我的）
//
// ⚠️ 踩过的坑：`/x/msgfeed/reply` 的 `item.title` **不总是**那条新回复的正文
//   （实测多条 item 的 title 是同一句，真正的正文跑到 source_content 去了）。
//   所以**要拿"别人到底说了什么"，必须回读楼层**（resolveLatestReply）。
//   收件箱只用来"发现有人找我们"，正文以楼层为准。
//
// 这条经验同样适用于其它项目：官方收件箱字段语义没文档、别直接当正文用。

// P0-7（Kimi 评审 #7）：这两个值改成从配置读（config.self.mid / config.owner.mid）
import { config } from './config.mjs'
export const ME = String(process.env.BILI_ME_MID ?? config().self?.mid ?? '')
export const OWNER = String(process.env.BILI_OWNER_MID ?? config().owner?.mid ?? '')

export function makeHeaders(cred) {
  return {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    referer: 'https://www.bilibili.com/',
    cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,
  }
}

// 拉收件箱：kind = 'reply' | 'at'
//
// ⚠️ 2026-10-22 P0：新版动态 id 是 19 位（例如 1261813571425140745），
//   超过 JS 安全整数（2^53-1）。`JSON.parse` 会把它变成 1261813571425140700 ——
//   **最后几位直接丢**，拿去当 oid 会 -404 / 挂到错的对象。
//   官方收件箱同时给了 `item.uri`（如 https://t.bilibili.com/1261813571425140745#reply…），
//   那是字符串、不丢精度 → **优先从 uri 取 id**；subject_id 只在安全整数范围内才用。
export function idFromUri(uri) {
  const match = /(?:t\.bilibili\.com|bilibili\.com\/opus)\/(\d{6,22})/.exec(String(uri ?? ''))
  return match ? match[1] : ''
}

function exactId(value) {
  if (typeof value === 'string') return value
  if (typeof value === 'number') return Number.isSafeInteger(value) ? String(value) : ''
  return String(value ?? '')
}

/**
 * 把收件箱坐标规范成 POST /x/v2/reply/add 需要的 { root, parent }。
 *
 * 字段语义（bilibili-API-collect）：
 *   source_id  来消息的这条评论（直接回复）
 *   target_id  被回复的那条评论
 *   root_id    线程根评论；一级评论为 0
 *
 * 关键：@ 消息可能挂在一条一级评论上（root_id=0）。要回到这条评论下面，
 * 必须把 root 补成 source_id；否则 root=0 + parent=source_id 会被 B站 当成新楼层。
 */
export function replyCoordinates({ root, sourceId, targetId } = {}) {
  const threadRoot = exactId(root)
  const source = exactId(sourceId)
  const target = exactId(targetId)
  const parent = source || target
  const rootId = (threadRoot && threadRoot !== '0')
    ? threadRoot
    : (target && target !== '0' ? target : parent)
  return { root: rootId, parent, sourceId: source, targetId: target }
}

export async function pullFeed(kind, { headers, pages = 1 }) {
  const out = []
  let cursor = ''
  let lastView = 0
  for (let p = 0; p < pages; p += 1) {
    const url = `https://api.bilibili.com/x/msgfeed/${kind}?platform=web&build=0&mobi_app=web` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '')
    const j = await (await fetch(url, { headers })).json()
    if (j.code !== 0) throw new Error(`${kind} code=${j.code} ${j.message}`)
    if (p === 0) lastView = Number(j.data?.last_view_at ?? 0)
    const items = j.data?.items ?? []
    for (const it of items) {
      const uri = String(it.item?.uri ?? '')
      const coords = replyCoordinates({
        root: it.item?.root_id,
        sourceId: it.item?.source_id,
        targetId: it.item?.target_id,
      })
      out.push({
        kind,
        id: String(it.id),
        t: Number(it.reply_time ?? it.at_time ?? 0),
        who: it.user?.nickname ?? '?',
        mid: String(it.user?.mid ?? ''),
        // 两个字段都留着（语义不可靠，谁有内容用谁）
        title: String(it.item?.title ?? ''),
        source: String(it.item?.source_content ?? ''),
        target: String(it.item?.target_reply_content ?? ''),
        business: Number(it.item?.business_id ?? 1),
        oid: idFromUri(uri) || exactId(it.item?.subject_id),
        root: coords.root,
        parent: coords.parent,
        // 保留 source/target 的原始 id：调用方需要区分“来消息那条”和“被回复那条”。
        sourceId: coords.sourceId,
        targetId: coords.targetId,
        uri,
      })
    }
    cursor = j.data?.cursor ?? ''
    if (!cursor || items.length === 0) break
  }
  // ⚠️ 翻页时 cursor 会给回重叠数据（实测每条都出现两遍）→ 按 id 去重
  const seen = new Set()
  const uniq = out.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
  return { items: uniq, lastView }
}

// 回读楼层，取“这个人在这个楼里、rpid 等于来消息那条”的评论 —— 这才是他真正说的话。
// rpid 是关键：同一个人在一个楼里可能有好几条评论，只有 rpid 对上号的那条才是“新回复”。
// 注意：传进来的应该是 source_id（来消息那条），不是它的 parent。
export async function resolveLatestReply({ business, oid, root, mid, rpid, parentRpid, headers }) {
  const wanted = String(rpid ?? parentRpid ?? '')
  // business 11=图文动态；17=转发/新版动态。以前 17 被当成视频（type=1）→ 读不到楼层。
  const type = business === 11 || business === 17 ? business : 1
  const reps = []
  for (let pn = 1; pn <= 6; pn += 1) {
    const u = `https://api.bilibili.com/x/v2/reply/reply?type=${type}&oid=${oid}&root=${root}&ps=20&pn=${pn}`
    const j = await (await fetch(u, { headers })).json().catch(() => null)
    if (!j || j.code !== 0) return null
    const page = j.data?.replies ?? []
    reps.push(...page)
    if (page.length < 20) break
  }
  const mine = reps.filter((r) => String(r.mid) === String(mid))
  if (!mine.length) return null
  let pick = null
  if (wanted) {
    // ① 优先：父评论对得上（这就是"他回的那条"）
    pick = [...mine].reverse().find((r) => String(r.rpid) === wanted) ?? null
  }
  // ② 退路：他最后一条（可能不是最新的那条，所以输出里会标注）
  const exact = Boolean(pick)
  if (!pick) pick = mine[mine.length - 1]
  return { rpid: String(pick.rpid), text: String(pick.content?.message ?? ''), ctime: Number(pick.ctime ?? 0), exact }
}
