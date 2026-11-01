// 通知分发器 —— 她看完一轮，把摘要送到哪。
//
// 2026-10-18 主人重定：方式有五种（不推送 / 桌面通知 / QQ私聊 / Webhook / 自定义命令）。
//   · Webhook **按域名自动适配**飞书/钉钉/企业微信/QQ机器人/WorkBuddy 的报文格式
//     （它们各自的 JSON 结构不一样 ✗，让用户去记格式不现实 ✓）
//   · 自定义命令：`cmd` = 可执行文件、`args` = 参数数组，消息自动作为**最后一个参数**传入 ✓
//     （`$MSG` 占位已于 2026-10-18 弃用 ✗ —— 走 shell 有命令注入风险，来源是陌生评论/弹幕）
//   · 兼容旧配置：stdout / file 仍然可用（不删，免得老配置炸 ✗）
//
// 用法：
//   node notify.mjs "消息正文" [--title 标题] [--dry]   （--dry = 只算报文，不真发）
//   node notify.mjs --test                              （发一条测试消息；设置页「发条测试」用它）
//
// 配置（~/.dsh/surfcore/bili.config.json 的 notify 段）：
//   { "type": "none|desktop|qq|webhook|command", "url": "", "template": "text|markdown", "cmd": "" }
//   · qq：只私聊管理员本人（走本机桥接的 /api/notify/owner；不发群）
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import { buildDesktopToastScript } from '../lib/desktop-toast.mjs'
import { QQ_CONFIG, QQ_STATE_DIR } from '../../lib/paths.js'

const argv = process.argv.slice(2)
const DRY = argv.includes('--dry')
const TEST = argv.includes('--test')
const ti = argv.indexOf('--title')
const title = ti >= 0 ? (argv[ti + 1] ?? '通知') : '通知'

let text
if (TEST) {
  text = `这是一条测试消息 ✓\n如果你看到它，说明「消息推送」配好了。\n（${new Date().toLocaleString('zh-CN', { hour12: false })}）`
} else {
  // 第一个不以 -- 开头、且不是 --title 的值的参数
  const skip = new Set()
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--title') { skip.add(i); skip.add(i + 1) }
    if (argv[i] === '--dry' || argv[i] === '--test') skip.add(i)
  }
  text = argv.find((a, i) => !skip.has(i) && !a.startsWith('--'))
}
if (!text) { console.error('用法: node notify.mjs "消息正文" [--title 标题] | --test'); process.exit(2) }

const n = config().notify ?? { type: 'none' }
const type = String(n.type ?? 'none')
const payload = { title, text, at: new Date().toISOString() }

/** 按域名猜服务，生成它认的报文（飞书 / 钉钉 / 企微 / WorkBuddy / 通用）。 */
function buildWebhookBody(url, tpl) {
  const md = tpl === 'markdown'
  const line = `${title}\n${text}`
  const u = String(url)
  if (u.includes('open.feishu.cn') || u.includes('larksuite.com')) {
    return md
      ? { msg_type: 'post', content: { post: { zh_cn: { title, content: [[{ tag: 'text', text: line }]] } } } }
      : { msg_type: 'text', content: { text: line } }
  }
  if (u.includes('oapi.dingtalk.com')) {
    return md
      ? { msgtype: 'markdown', markdown: { title, text: line } }
      : { msgtype: 'text', text: { content: line } }
  }
  if (u.includes('qyapi.weixin.qq.com')) {
    return md ? { msgtype: 'markdown', markdown: { content: line } } : { msgtype: 'text', text: { content: line } }
  }
  if (u.includes('workbuddy')) return { title, text: line, format: md ? 'markdown' : 'text' }
  // 通用兜底（含 QQ 机器人常见的 { content } 约定）
  return { title, text: line, content: line, format: md ? 'markdown' : 'text' }
}

async function sendWebhook(url, tpl) {
  const body = buildWebhookBody(url, tpl)
  if (DRY) { console.log('[dry] webhook 报文：\n' + JSON.stringify(body, null, 2)); return }
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const raw = await r.text().catch(() => '')
  if (!r.ok) throw new Error(`webhook HTTP ${r.status} ${raw.slice(0, 160)}`)
  console.log(`webhook ${r.status} ✓ ${raw.slice(0, 120)}`)
}

async function sendDesktop() {
  if (DRY) { console.log('[dry] 桌面通知：' + String(text).slice(0, 60)); return }
  if (process.platform !== 'win32') {
    throw new Error('[DESKTOP_UNSUPPORTED] 桌面通知仅支持 Windows；请改用 Webhook / QQ / 自定义命令')
  }
  const ps = buildDesktopToastScript()
  const script = path.join(os.tmpdir(), `dw-toast-${Date.now()}.ps1`)
  fs.writeFileSync(script, ps, 'utf8')
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
      env: { ...process.env, DW_TITLE: String(title), DW_TEXT: String(text) },
      stdio: ['ignore', 'ignore', 'pipe'], timeout: 15000,
    })
  } catch (error) {
    const detail = String(error?.stderr ?? '').trim().split(/\r?\n/).filter(Boolean).slice(-3).join(' ');
    const message = `[DESKTOP_TOAST_FAILED] 桌面通知失败：${detail || error?.message || 'PowerShell 未返回错误详情'}`;
    await reportTimeout('DESKTOP_TOAST_FAILED', message, '检查 PowerShell 是否可用；或改用 QQ / Webhook；在概览错误报告可永久静音这类超时');
    throw new Error(message)
  } finally {
    try { fs.rmSync(script, { force: true }) } catch {}
  }
  console.log('桌面通知已发送 ✓')
}

function qqBridgeInfo() {
  const qqConfigFile = process.env.SURFCORE_QQ_CONFIG || QQ_CONFIG
  let qq = {}
  try { qq = JSON.parse(fs.readFileSync(qqConfigFile, 'utf8')) } catch {}
  let token = String(qq.consoleToken ?? '').trim()
  if (!token) {
    try { token = fs.readFileSync(path.join(QQ_STATE_DIR, 'console-token'), 'utf8').trim() } catch {}
  }
  return { ownerQQ: String(qq.ownerQQ ?? '').trim(), port: Number(qq.consolePort) || 3100, token }
}

async function reportTimeout(code, message, hint) {
  if (Array.isArray(n.timeoutMutes) && n.timeoutMutes.includes(code)) return
  const info = qqBridgeInfo()
  if (!info.token) return
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    await fetch(`http://127.0.0.1:${info.port}/api/notice/timeout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-console-token': info.token },
      body: JSON.stringify({ code, message: String(message).slice(0, 300), hint: String(hint).slice(0, 300), source: 'notify' }),
      signal: controller.signal,
    })
  } catch {
    // 通知失败本身不能因为“上报失败”再抛一次。
  } finally {
    clearTimeout(timer)
  }
}

async function sendQQ() {
  const { ownerQQ, port, token } = qqBridgeInfo()
  if (!ownerQQ) throw new Error('[QQ_NOTIFY_NO_OWNER] QQ 推送失败：config.json 未配置 ownerQQ（管理员 QQ）')
  if (!token) throw new Error('[QQ_NOTIFY_NO_TOKEN] QQ 推送失败：没有控制台令牌（检查 config.json.consoleToken / state/console-token）')
  if (DRY) {
    console.log(`[dry] QQ 私聊管理员 ${ownerQQ}：${String(text).slice(0, 60)}`)
    return
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/notify/owner`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-console-token': token },
      body: JSON.stringify({ title, message: String(text) }),
      signal: controller.signal,
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body?.ok === false) {
      throw new Error(`QQ 推送失败：${body?.error || `桥接 HTTP ${res.status}`}${body?.hint ? `；${body.hint}` : ''}`)
    }
    console.log(`QQ 私聊管理员已发送 ✓${body?.messageId ? `（messageId ${body.messageId}）` : ''}`)
  } catch (error) {
    if (error?.name === 'AbortError') {
      const message = '[QQ_NOTIFY_TIMEOUT] QQ 推送超时：桥接 15 秒没响应；确认 SnowLuma/QQ 在线，重启桥接后重试';
      await reportTimeout('QQ_NOTIFY_TIMEOUT', message, '检查 SnowLuma/QQ 是否在线；重启 QQ 桥接；在概览错误报告可永久静音这类超时');
      throw new Error(message)
    }
    if (!String(error?.message || '').startsWith('QQ 推送失败')) {
      throw new Error(`[QQ_NOTIFY_UNREACHABLE] QQ 推送失败：${error?.message || error}；确认 QQ 桥接已启动（默认 http://127.0.0.1:${port}）`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function sendCommand(cmd) {
  const c = String(cmd ?? '')
  if (!c.trim()) throw new Error('config.notify.cmd 没配')
  // 2026-10-18 加保险：命令不存在（换电脑/插件被删/路径变了）→ 别静默失败 ✗，
  //   退回桌面通知 ✓ 并说明一句 ✓ —— 开源模板里最容易踩的就是"写死的绝对路径" ✗
  try {
    const looksPath = /[\\/]/.test(c) && !c.includes('$MSG')
    if (looksPath && !fs.existsSync(c)) {
      console.log(`⚠️ 推送命令不存在：${c}`)
      console.log('   → 自动退回「桌面通知」✓（去设置里改「消息推送」即可）')
      return sendDesktop()
    }
  } catch {}
  if (DRY) { console.log('[dry] 命令：' + c + '  (消息作为最后一个参数)'); return }
  if (c.includes('$MSG')) {
    // 2026-10-18 弃用（KIMI 评审指出）✗：$MSG 要走 shell，而 cmd.exe **不认 \" 转义** →
    //   消息里一个英文双引号就能破开引号边界，等于**遥控执行命令** ✗（消息来源是陌生评论/弹幕）
    //   要拼命令请用下面 cmd + args 那条路 ✓（execFileSync，不走 shell ✓）
    throw new Error('$MSG 已弃用（有命令注入风险）：请把 cmd 填成可执行文件、把参数放 args，消息会自动作为最后一个参数传入 ✓')
  } else {
    // 2026-10-18 加：支持 cmd + args（推荐用法 ✓）—— 消息作为**最后一个参数**传进去，
    // 不走 shell → 中文/emoji/引号都不会被 cmd.exe 弄坏 ✓（比如 dsh-wechat-send）
    const argv = Array.isArray(n.args) ? n.args.map(String) : []
    execFileSync(c, [...argv, String(text)], {
      stdio: 'inherit', timeout: 60000,
      env: { ...process.env, WHALE_NOTIFY_TEXT: String(text), WHALE_NOTIFY_TITLE: String(title) },
    })
  }
  console.log('命令已执行 ✓')
}

try {
  if (type === 'none') {
    console.log(DRY ? '[dry] 方式=none（不推送）→ 什么也不做 ✓' : '（方式=none：不推送）')
  } else if (type === 'desktop') {
    await sendDesktop()
  } else if (type === 'qq') {
    await sendQQ()
  } else if (type === 'webhook') {
    if (!n.url) throw new Error('config.notify.url 没配')
    await sendWebhook(n.url, n.template)
  } else if (type === 'command') {
    // 2026-10-18：命令不存在（换电脑/插件被删/写死路径失效）→ 直接改用桌面通知 ✓ 别静默失败 ✗
    const c = String(n.cmd ?? '')
    const isPath = /[\\/]/.test(c) && !c.includes('$MSG')
    if (isPath && !fs.existsSync(c)) {
      console.log(`⚠️ 推送命令不存在：${c}`)
      console.log('   → 已自动改用「桌面通知」✓（去设置里改「消息推送」即可）')
      await sendDesktop()
    } else {
      await sendCommand(n.cmd)
    }
  } else if (type === 'dm') {
    // 2026-10-26：这条分支从来没实现过（原稿引用未定义的 p，一跑就 ReferenceError），
    // 设置页里的「B站私信」选项也已移除。老配置里还留着 type=dm 时给一条能看懂的错，
    // 而不是 ReferenceError。真要实现，需接 commands/dm.mjs 的三道闸（只发主人 / 互关 / 每日一人）。
    throw new Error('推送方式「B站私信」未实现（2026-10-26 已从设置页移除）：请改用桌面通知 / Webhook / 自定义命令')
  } else {
    throw new Error(`未知的推送方式：${type}`)
  }
} catch (e) {
  console.error(`通知失败（${type}）：${e.message}`)
  console.error(`原文：${title} / ${String(text).slice(0, 200)}`)
  process.exit(1)
}
