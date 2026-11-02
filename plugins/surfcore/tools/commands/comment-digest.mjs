// comment-digest.mjs —— "今天谁找过人家"：给主人的日终汇报（只读，一句都不回）
//
// 用途：她过完一天（或主人睡前）时跑一遍，把结果推给主人看 ——
//   回复陌生人要过闸门/要主人点头，**她自己不回**，只负责"让主人知道"。
//
// 数据源（都不需要维护线程清单）：
//   · /x/msgfeed/reply  「回复我的」
//   · /x/msgfeed/at     「@我的」
// ⚠️ 收件箱的 title/source 字段语义不可靠（实测多条 title 是同一句）→
//    **正文一律回读楼层核实**（lib/msgfeed.mjs 的 resolveLatestReply）。
//
// 用法:
//   node bili.mjs comment-digest [--hours 24] [--pages 2] [--only-unread] [--max-resolve 20] [--raw]
//     --raw          不核实正文，直接用收件箱字段（快，但可能不准）
import { accountBili, biliState, biliStateDir } from '../lib/state-paths.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { makeHeaders, pullFeed, resolveLatestReply } from '../lib/msgfeed.mjs'

const args = process.argv.slice(2)
const get = (k, d) => {
  const i = args.indexOf('--' + k)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d
}
const HOURS = Number(get('hours', '24'))
const PAGES = Math.max(1, Number(get('pages', '2')))
const MAX_RESOLVE = Number(get('max-resolve', '20'))
const ONLY_UNREAD = args.includes('--only-unread')
const RAW = args.includes('--raw')

const cred = JSON.parse(fs.readFileSync(accountBili('credentials.json'), 'utf8'))
const H = makeHeaders(cred)
const hhmm = (t) => (t ? new Date(t * 1000).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '时间未知')

const now = Math.floor(Date.now() / 1000)
const since = now - HOURS * 3600
const reply = await pullFeed('reply', { headers: H, pages: PAGES }).catch((e) => ({ items: [], err: e.message, lastView: 0 }))
const at = await pullFeed('at', { headers: H, pages: PAGES }).catch((e) => ({ items: [], err: e.message, lastView: 0 }))
if (reply.err) console.log(`（回复收件箱读不到：${reply.err}）`)
if (at.err) console.log(`（@收件箱读不到：${at.err}）`)

let all = [...reply.items, ...at.items].filter((x) => x.t === 0 || x.t >= since)
if (ONLY_UNREAD) {
  const lv = Math.max(reply.lastView ?? 0, at.lastView ?? 0)
  if (lv) all = all.filter((x) => x.t >= lv)
}
all.sort((a, b) => a.t - b.t)

const replies = all.filter((x) => x.kind === 'reply')
const ats = all.filter((x) => x.kind === 'at')
console.log(`【B 站 · 谁找过人家】最近 ${HOURS} 小时`)
console.log(`共 ${all.length} 条 —— 回复 ${replies.length} · @ ${ats.length}${ONLY_UNREAD ? '（只看未读）' : ''}${RAW ? '（未核实正文）' : ''}`)
if (!all.length) { console.log('\n安静得很，没人找。'); process.exit(0) }

// 回读楼层核实正文（同一楼同一人只查一次）
const cache = new Map()
let resolved = 0
async function realText(x) {
  // source_content 才是我要的正文（title 是不可靠的陈旧字段）；为空才回读楼层兜底
  if (x.source || x.title) return { text: (x.source || x.title).replace(/\n/g, ' '), rpid: x.parent }
  if (RAW || x.kind !== 'reply' || resolved >= MAX_RESOLVE) return { text: '', rpid: x.parent }
  const key = `${x.oid}|${x.root}|${x.mid}`
  if (cache.has(key)) return cache.get(key)
  resolved += 1
  const r = await resolveLatestReply({ business: x.business, oid: x.oid, root: x.root, mid: x.mid, rpid: x.parent, headers: H }).catch(() => null)
  const out = { text: (r?.text ?? '').replace(/\n/g, ' '), rpid: r?.rpid || x.parent, ctime: r?.ctime }
  cache.set(key, out)
  return out
}

console.log('')
for (const x of all) {
  const tag = x.kind === 'reply' ? '回复' : '@ '
  const real = await realText(x)
  const text = (real.text || '(读不到正文)').slice(0, 80)
  console.log(`· ${hhmm(real.ctime || x.t)} [${tag}] ${x.who}`)
  console.log(`    「${text}」`)
  if (x.uri) console.log(`    位置：${x.uri}`)
  if (x.kind === 'reply') console.log(`    坐标：type=${x.business} oid=${x.oid} root=${x.root} parent=${real?.rpid || x.parent}`)
  else if (x.root || x.parent) console.log(`    坐标：type=${x.business} oid=${x.oid} root=${x.root} parent=${real?.rpid || x.parent}`)
}

const byWho = new Map()
for (const x of all) byWho.set(x.who, (byWho.get(x.who) ?? 0) + 1)
const multi = [...byWho.entries()].filter(([, n]) => n > 1)
if (multi.length) console.log(`\n话最多的：` + multi.map(([w, n]) => `${w}（${n} 条）`).join(' · '))
console.log(`\n⚠️ 这是"别人找我们"，回不回由主人定（回复要过 quota 闸门；陌生人不在白名单）。`)
