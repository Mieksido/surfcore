// Live-room danmaku: pre-flight permission check, one send, read-back verify,
// and a real-time listener (WebSocket, no dependencies).
//
//   node danmaku.mjs pre     --room 999999004
//   node danmaku.mjs send    --room 999999004 --msg "..." --dry | --go
//                            [--reply-mid <uid> --reply-name <昵称>] [--reply-dmid <弹幕id>]
//   node danmaku.mjs history --room 999999004
//   node danmaku.mjs live    --room 999999004 --seconds 60 [--grep 关键词]
import { accountBili, biliState, biliStateDir } from '../lib/state-paths.mjs'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
// 2026-10-18 修：send 分支用了 `gate(...)` 但**从来没导入过** ✗（一跑到那儿就 ReferenceError）
import { gate } from '../lib/quota-gate.mjs'
import { assertInteractEnabled } from '../lib/interact.mjs'

const argv = process.argv.slice(2)
const mode = argv[0]
const args = new Map()
for (let i = 1; i < argv.length; i += 1) {
  const a = argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true)
}
const roomArg = args.get('room')
const msg = args.get('msg')
const isDry = args.has('dry')
const isGo = args.has('go')
if (mode === 'send' && isGo && !assertInteractEnabled('发弹幕')) process.exit(3)
if (!roomArg) { console.error('需要 --room <房间号>'); process.exit(2) }

const credPath = accountBili('credentials.json')
if (!fs.existsSync(credPath)) { console.error(`缺少凭据文件: ${credPath}`); process.exit(3) }
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'))
for (const k of ['sessdata', 'bili_jct', 'buvid3']) {
  if (!cred[k] || String(cred[k]).trim() === '') { console.error(`凭据文件缺少 ${k}`); process.exit(3) }
}
const cookieHeader = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const H = (shortId) => ({ 'user-agent': UA, referer: `https://live.bilibili.com/${shortId ?? roomArg}`, origin: 'https://live.bilibili.com', cookie: cookieHeader })
const j = async (url, opts) => { const r = await fetch(url, opts); const t = await r.text(); try { return { status: r.status, body: JSON.parse(t) } } catch { return { status: r.status, body: { __raw: t.slice(0, 200) } } } }

// ---- resolve room -----------------------------------------------------------
async function resolveRoom() {
  let info = (await j(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomArg}`, { headers: H() })).body
  if (info.code !== 0) info = (await j(`https://api.live.bilibili.com/room/v1/Room/get_info?short_id=${roomArg}`, { headers: H() })).body
  return info
}

// ---- modes ------------------------------------------------------------------
if (mode === 'pre') {
  console.log('=== 1) 房间信息 ===')
  const info = await resolveRoom()
  console.log(`  get_info code=${info.code} ${info.message ?? ''}`)
  const d = info.data ?? {}
  const realId = d.room_id
  console.log(`  短号=${d.short_id}  真实room_id=${realId}  主播uid=${d.uid}`)
  console.log(`  标题=${d.title}`)
  console.log(`  直播状态=${d.live_status === 1 ? '直播中' : `未开播(${d.live_status})`}  在线=${d.online}  关注=${d.attention}`)
  console.log(`  弹幕限制描述=${d.description ?? '-'}`)

  console.log('\n=== 2) 我这个号能在这个房间发弹幕吗（预检） ===')
  const cfg = (await j(`https://api.live.bilibili.com/xlive/web-room/v1/dM/GetDMConfigByGroup?room_id=${realId ?? roomArg}`, { headers: H(d.short_id) })).body
  console.log(`  GetDMConfigByGroup code=${cfg.code} ${cfg.message ?? ''}`)
  const c = cfg.data ?? {}
  if (Array.isArray(c.group)) {
    console.log(`  可用弹幕颜色 ${c.group.length} 种；可用模式 ${(c.mode ?? []).length} 种`)
    console.log(`  默认 color=${c.color} (${c.color_hex})  mode=${c.mode?.[0]?.mode ?? '-'}  fontsize=${c.fontsize ?? '-'}`)
  } else {
    console.log(`  data: ${JSON.stringify(c).slice(0, 300)}`)
  }
  process.exit(0)
}

if (mode === 'history') {
  console.log('=== 最近历史弹幕 ===')
  const info = await resolveRoom()
  const realId = info.data?.room_id
  for (const id of [realId, roomArg]) {
    if (!id) continue
    const h = (await j(`https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${id}&room_type=0`, { headers: H() })).body
    if (h.code !== 0) { console.log(`  roomid=${id} code=${h.code} ${h.message ?? ''}`); continue }
    const rows = h.data?.room ?? []
    console.log(`  roomid=${id} 取回 ${rows.length} 条，最后 8 条:`)
    // 2026-10-18 加 uid：排"为什么没认出主人"时必须看到它 ✓（凭据不打印 ✓）
    for (const row of rows.slice(-8)) console.log(`    [${row.timeline}] uid=${row.uid} ${row.nickname}: ${row.text}`)
  }
  process.exit(0)
}

if (mode === 'send') {
  if (!msg) { console.error('send 需要 --msg'); process.exit(2) }
  if (isDry === isGo) { console.error('必须且只能给一个 --dry 或 --go'); process.exit(2) }

  // P0-5：弹幕也是对外发言 —— 过闸（白名单里的房间 = room:<房间号>）
  if (!gate({ type: 'danmaku', target: `room:${args.get('room') ?? ''}`, auto: process.argv.includes('--auto') })) {
    console.error('拒绝：限额闸不通过（额度/白名单）'); process.exit(2)
  }
  const info = await resolveRoom()
  const realId = info.data?.room_id ?? roomArg
  const shortId = info.data?.short_id ?? roomArg
  const rnd = Math.round(Date.now() / 1000)
  const form = {
    csrf: String(cred.bili_jct),
    csrf_token: String(cred.bili_jct),
    roomid: String(realId),
    msg,
    rnd: String(rnd),
    fontsize: '25',
    color: '16777215',
    mode: '1',
    bubble: '0',
    room_type: '0',
    jumpfrom: '0',
    statistics: JSON.stringify({ appId: 100, platform: 5 }),
  }
  // 可选：把这条弹幕变成"回复某条弹幕 / @某人"
  if (args.get('reply-dmid')) form.replay_dmid = String(args.get('reply-dmid'))
  if (args.get('reply-mid')) {
    form.reply_mid = String(args.get('reply-mid'))
    if (args.get('reply-name')) form.reply_uname = String(args.get('reply-name'))
  }
  console.log('=== 目标房间 ===')
  console.log(`  短号=${shortId}  真实room_id=${realId}  主播uid=${info.data?.uid}  标题=${info.data?.title}`)
  console.log(`  直播状态=${info.data?.live_status === 1 ? '直播中' : `未开播(${info.data?.live_status})`}`)
  console.log('\n=== 将发送的弹幕 ===')
  console.log(`  POST https://api.live.bilibili.com/msg/send`)
  console.log(`  msg="${msg}" (${msg.length} 字)  roomid=${realId}  rnd=${rnd}  fontsize=25  color=16777215  mode=1`)
  if (form.reply_mid) console.log(`  在弹幕里 @ : ${form.reply_uname ?? '(未给名称)'} (mid ${form.reply_mid})`)
  if (form.replay_dmid) console.log(`  引用回复弹幕 : dmid ${form.replay_dmid}`)
  console.log(`  cookie=SESSDATA=***; bili_jct=***; buvid3=***   csrf=***csrf***`)
  if (isDry) { console.log('\n[dry] 未发送。'); process.exit(0) }

  console.log('\n[go] 发送中…')
  const out = await j('https://api.live.bilibili.com/msg/send', {
    method: 'POST',
    headers: { ...H(shortId), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  })
  const b = out.body
  const hints = { 0: '成功', '-101': '账号未登录', '-111': 'csrf 校验失败', '-400': '请求错误/缺参数', 1003212: '超出长度限制', 10031: '发送频率过快' }
  console.log(`  HTTP ${out.status}  code=${b.code} ${b.message ?? b.msg ?? ''}`)
  console.log(`  ${hints[b.code] ?? ''}`)
  if (b.code !== 0) console.log(`  原始: ${JSON.stringify(b).slice(0, 300)}`)
  process.exit(0)
}

if (mode === 'live') {
  const seconds = Number(args.get('seconds') ?? 60)
  const grep = args.get('grep')
  const info = await resolveRoom()
  const realId = info.data?.room_id ?? roomArg
  const nav = (await j('https://api.bilibili.com/x/web-interface/nav', { headers: H() })).body
  const myUid = nav.data?.mid ?? 0
  // getDanmuInfo 现在必须带 WBI 签名：实测无签名一律 -352，带签名才 0
  const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
  const keyOf = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
  const wbiRaw = keyOf(nav.data?.wbi_img?.img_url ?? '') + keyOf(nav.data?.wbi_img?.sub_url ?? '')
  const mixin = MIXIN_TAB.map((i) => wbiRaw[i]).join('').slice(0, 32)
  const wts = Math.round(Date.now() / 1000)
  const clean = (v) => String(v).replace(/[!'()*]/g, '')
  const qs = Object.keys({ id: realId, type: 0, wts }).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean(k === 'wts' ? wts : k === 'id' ? realId : 0))}`).join('&')
  const wbiQs = `${qs}&w_rid=${crypto.createHash('md5').update(qs + mixin).digest('hex')}`
  const dan = (await j(`https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?${wbiQs}`, { headers: H() })).body
  if (dan.code !== 0) { console.error(`getDanmuInfo code=${dan.code} ${JSON.stringify(dan).slice(0, 200)}`); process.exit(6) }
  const token = dan.data?.token
  const hosts = dan.data?.host_list ?? []
  if (!token || !hosts.length) { console.error('拿不到 token 或弹幕服务器列表'); process.exit(6) }
  const host = hosts[0]
  const url = `wss://${host.host}:${host.wss_port}/sub`
  console.log(`房间 ${realId}「${info.data?.title ?? ''}」  我=${nav.data?.uname ?? '?'} (mid ${myUid})`)
  console.log(`连接 ${url}  监听 ${seconds} 秒${grep ? `，含「${grep}」的弹幕会标 ★` : ''}`)

  const ws = new WebSocket(url)
  try { ws.binaryType = 'arraybuffer' } catch {}
  const enc = new TextEncoder()
  const mkPacket = (op, str) => {
    const body = enc.encode(str)
    const buf = new Uint8Array(16 + body.length)
    const dv = new DataView(buf.buffer)
    dv.setUint32(0, 16 + body.length)
    dv.setUint16(4, 16)
    dv.setUint16(6, 1)
    dv.setUint32(8, op)
    dv.setUint32(12, 1)
    buf.set(body, 16)
    return buf
  }
  const stamp = () => new Date().toLocaleTimeString('zh-CN')
  let got = 0
  let frames = 0
  const handlePacket = (buf) => {
    let off = 0
    while (off + 16 <= buf.length) {
      const total = buf.readUInt32BE(off)
      if (total < 16 || off + total > buf.length) break
      const hlen = buf.readUInt16BE(off + 4)
      const ver = buf.readUInt16BE(off + 6)
      const op = buf.readUInt32BE(off + 8)
      const body = buf.subarray(off + hlen, off + total)
      if (ver === 3) { try { handlePacket(zlib.brotliDecompressSync(body)) } catch {} }
      else if (ver === 2) { try { handlePacket(zlib.inflateSync(body)) } catch {} }
      else if (op === 5) {
        try {
          const o = JSON.parse(body.toString('utf8'))
          const cmd = String(o.cmd ?? '')
          if (cmd.startsWith('DANMU_MSG')) {
            const d = o.info ?? []
            const text = String(d[1] ?? '')
            const uid = d[2]?.[0]
            const uname = String(d[2]?.[1] ?? '')
            const dmid = d[0]?.[5] ?? d[9]?.ct ?? ''
            got += 1
            const mark = grep && text.includes(grep) ? '★' : ' '
            console.log(`${mark}[${stamp()}] ${uname}(uid ${uid}, dmid ${dmid}): ${text}`)
          } else if (cmd === 'INTERACT_WORD') {
            console.log(`  [${stamp()}] · ${o.data?.uname ?? ''} 进入直播间`)
          } else if (cmd.startsWith('INTERACT_WORD')) {
            console.log(`  [${stamp()}] · （进场事件 ${cmd}，昵称在 protobuf 里，未解）`)
          } else if (cmd.startsWith('SEND_GIFT')) {
            console.log(`  [${stamp()}] ✿ ${o.data?.uname ?? ''} 送出 ${o.data?.giftName ?? ''} x${o.data?.num ?? ''}`)
          }
        } catch {}
      }
      off += total
    }
  }
  ws.addEventListener('open', () => {
    ws.send(mkPacket(7, JSON.stringify({ uid: myUid, roomid: realId, protover: 3, platform: 'web', type: 2, key: token })))
  })
  ws.addEventListener('message', async (ev) => {
    try {
      const ab = ev.data instanceof ArrayBuffer ? ev.data : await ev.data?.arrayBuffer?.()
      if (ab) { frames += 1; handlePacket(Buffer.from(ab)) }
    } catch {}
  })
  ws.addEventListener('error', (e) => console.log(`  ⚠ ws 错误: ${e?.message ?? e?.type ?? ''}`))
  const hb = setInterval(() => { try { ws.send(mkPacket(2, '[object Object]')) } catch {} }, 30000)
  setTimeout(() => {
    clearInterval(hb)
    try { ws.close() } catch {}
    console.log(`\n监听结束：${frames} 帧 / 其中弹幕 ${got} 条${frames === 0 ? '（⚠ 一帧都没收到，socket 可能没连上）' : '（连接正常）'}`)
    process.exit(0)
  }, seconds * 1000)
} else {
  console.error('用法: pre | send --msg "..." [--reply-mid <uid> --reply-name <昵称>] --dry|--go | history | live --seconds 60 [--grep 关键词]   （都要 --room <房间号>）')
  process.exit(2)
}
