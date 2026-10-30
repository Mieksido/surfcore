/**
 * QQ 桥接进程的控制与观测。
 *
 * 合体插件**不重写桥接**：QQ 消息、SnowLuma 连接、会话映射仍然由
 * <surfcore>/src/bridge.js 那个进程负责（它是被验证过的那一份）。
 * 这里只做四件事：探活、读状态、启停/重启、把错误翻译成人话。
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  BRIDGE_SUPERVISOR_LOG, QQBOT_ROOT, QQ_CONFIG, QQ_LOCK_FILE, QQ_STATE_DIR,
  findNodeExe,
} from './paths.js';
import { readJson } from './store.js';

function consolePort() {
  const cfg = readJson(QQ_CONFIG, {}) ?? {};
  return Number(cfg.consolePort) || 3100;
}

export function consoleBase() {
  return `http://127.0.0.1:${consolePort()}`;
}

export function consoleToken() {
  const cfg = readJson(QQ_CONFIG, {}) ?? {};
  const configured = String(cfg.consoleToken ?? '').trim();
  if (configured) return configured;
  try { return fs.readFileSync(path.join(QQ_STATE_DIR, 'console-token'), 'utf8').trim(); } catch { return ''; }
}

export function portOpen(port = consolePort(), host = '127.0.0.1', timeout = 900) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export function lockPid() {
  try {
    const raw = fs.readFileSync(QQ_LOCK_FILE, 'utf8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

export function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === 'EPERM'; }
}

export async function callBridge(pathname, { method = 'GET', body, timeoutMs = 4000 } = {}) {
  const token = consoleToken();
  // 桥接控制台的写操作强制 application/json（CSRF 防护，见 src/bridge.js 的 415 分支）。
  // POST 不带参数时也必须发 `{}` —— 否则 content-type 缺失，桥接直接 415
  // 「请求必须是 application/json」，调用方只会看到一句莫名其妙的失败
  // （「立即分享一次」就这么哑过一次，2026-10-23）。
  const isWrite = String(method).toUpperCase() !== 'GET';
  const payload = body === undefined ? (isWrite ? {} : null) : body;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${consoleBase()}${pathname}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(token ? { 'x-console-token': token } : {}),
        ...(payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

export async function status() {
  const port = consolePort();
  const open = await portOpen(port);
  if (!open) {
    return {
      ok: false,
      running: false,
      port,
      pid: null,
      lockPid: lockPid(),
      hint: '桥接没在跑：点「启动 QQ 桥接」，或双击 surfcore 目录里的 start.bat。',
    };
  }
  const result = await callBridge('/api/status');
  if (!result.ok) {
    return {
      ok: false,
      running: true,
      port,
      pid: lockPid(),
      httpStatus: result.status,
      error: result.error || result.data?.error || '控制台已监听但状态接口拒绝访问（检查 consoleToken）',
      hint: '端口在监听，但拿不到状态。通常是 consoleToken 不一致：重启桥接或重新读取 state/console-token。',
    };
  }
  return mapStatusPayload(result.data, { port });
}

/**
 * 把 `/api/status` 的原始返回映射成设置页/启动弹窗用的视图。
 *
 * 单独抽出来只为一件事：**可回归**。这里漏一个字段不会报错，只会让调用方
 * 的判据恒为 undefined —— `dshReady` 就这么漏过一次，导致启动完成弹窗永远
 * 显示「DSH 还没连上」（tests/… 里现在盯着它）。
 *
 * @param data - `/api/status` 的 JSON。
 * @param options.port - 控制台端口（默认取 config.json）。
 * @param options.pid - 锁文件里的 pid（默认现读）。
 */
export function mapStatusPayload(data = {}, { port = consolePort(), pid } = {}) {
  const payload = data ?? {};
  return {
    ok: true,
    running: true,
    port,
    pid: pid === undefined ? lockPid() : pid,
    root: payload.root ?? null,
    dshBaseUrl: payload.dshBaseUrl ?? null,
    // 必须原样透出：启动完成弹窗的判据是 `bridge.dshReady === true`
    // （见 lib/index.js 的 allReady）。以前这里漏了这个字段，于是判据恒为 undefined，
    // 弹窗永远等满 180 秒再误报「DSH 还没连上」。
    dshReady: payload.dshReady === true,
    mode: payload.mode ?? payload.currentMode ?? null,
    dsh: payload.dsh ?? null,
    snowluma: payload.snowluma ?? null,
    // 今日唤醒额度：设置页用它判断「今天还能不能叫醒它」。
    // 以前 token-guard 拦下唤醒只写一行日志，界面上完全看不出来，表现就是「它不理我」。
    wakeGuard: payload.wakeGuard ?? null,
    sessions: payload.sessions ?? null,
    // 对话收尾：设置页卡片读它（最近一次收在哪 / 下次怎么接 / 当前判断）。
    closure: payload.closure ?? null,
    activityTail: typeof payload.activity === 'string' ? payload.activity.split('\n').slice(-8).join('\n') : '',
    raw: {
      mode: payload.mode ?? null,
      socialV2Paused: payload.socialV2Paused ?? null,
      allowGroups: payload.allowGroups ?? null,
      allowPrivate: payload.allowPrivate ?? null,
    },
  };
}

function appendSupervisorLog(text) {
  try {
    const line = `[${new Date().toISOString()}] ${String(text).replace(/\s+$/, '')}\n`;
    fs.mkdirSync(path.dirname(BRIDGE_SUPERVISOR_LOG), { recursive: true });
    fs.appendFileSync(BRIDGE_SUPERVISOR_LOG, line);
  } catch {}
}

export async function start({ dshWebUrl = '' } = {}) {
  if (await portOpen()) return { ok: true, already: true, message: '桥接已经在跑' };
  const env = { ...process.env };
  if (dshWebUrl) env.DSH_WEB_URL = String(dshWebUrl);
  // 直接 spawn node.exe，不经过 cmd/start.bat：
  // Windows 11 的默认终端会把 start.bat 里的 node 控制台托管成 WindowsTerminal 窗口，
  // 即使 cmd 用了 windowsHide 也仍会弹一个标题为“node src/bridge.js”的黑框。
  // 桥接启动时会自己收紧 state/ ACL，所以这里不需要 start.bat 的那一步；
  // 手动双击 start.bat 仍然保留（可见日志 + 崩溃循环）。
  const nodeExe = findNodeExe();
  if (!/^node(\.exe)?$/i.test(path.basename(String(nodeExe)))) {
    return { ok: false, error: `找不到真正的 node.exe（当前解析到 ${nodeExe}）` };
  }
  const child = spawn(nodeExe, [path.join(QQBOT_ROOT, 'src', 'bridge.js')], {
    cwd: QQBOT_ROOT,
    env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  appendSupervisorLog(`已请求启动 bridge.js（无窗口，pid ${child.pid ?? '?'}，DSH=${env.DSH_WEB_URL ?? 'config'}）`);
  // 等最多 12 秒
  for (let i = 0; i < 24; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (await portOpen()) return { ok: true, started: true, message: '桥接已启动' };
  }
  return { ok: false, error: '启动后 12 秒仍未监听控制台端口，请查看桥接日志', log: BRIDGE_SUPERVISOR_LOG };
}

export async function stop() {
  if (!(await portOpen()) && !lockPid()) return { ok: true, already: true, message: '桥接本来就没在跑' };
  if (process.platform === 'win32') {
    const script = path.join(QQBOT_ROOT, 'scripts', 'stop-qq-bot.ps1');
    if (!fs.existsSync(script)) return { ok: false, error: `找不到 ${script}` };
    const result = await new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], {
        cwd: QQBOT_ROOT,
        windowsHide: true,
      });
      let out = '';
      let err = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { err += chunk; });
      child.on('exit', (code) => resolve({ code, out: out.slice(-2000), err: err.slice(-1000) }));
      child.on('error', (error) => resolve({ code: -1, out: '', err: String(error?.message ?? error) }));
    });
    appendSupervisorLog(`stop-qq-bot.ps1 exit=${result.code} ${result.out}`);
    let stopped = !(await portOpen());
    if (!stopped) {
      // 兜底：PowerShell 脚本可能因编码/权限/解析失败（2026-10-22 真实事故：UTF-8 无 BOM
      // 被 Windows PowerShell 5.1 当 ANSI 读，整脚本解析失败 → 每次都「停止脚本跑完了，但端口仍在监听」）。
      // 此时退回 bridge.js 自己写的 lock 里的 pid，确认还活着就直接结束它。
      const pid = lockPid();
      if (pid && pidAlive(pid)) {
        try {
          process.kill(pid);
          for (let i = 0; i < 10 && (await portOpen()); i += 1) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
          appendSupervisorLog(`停止脚本失败，已按 bridge.lock 的 pid=${pid} 兜底结束`);
        } catch (error) {
          appendSupervisorLog(`兜底结束 pid=${pid} 失败：${String(error?.message ?? error)}`);
        }
        stopped = !(await portOpen());
      }
    }
    return { ok: stopped, ...result, stopped, message: stopped ? '桥接已停止' : '停止脚本跑完了，但端口仍在监听' };
  }
  const pid = lockPid();
  if (pid && pidAlive(pid)) {
    try { process.kill(pid); } catch (error) { return { ok: false, error: String(error?.message ?? error) }; }
  }
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    if (!(await portOpen())) return { ok: true, stopped: true, message: '桥接已停止' };
  }
  return { ok: false, error: '进程没有在预期时间内退出' };
}

export async function restart(options = {}) {
  const stopped = await stop();
  if (!stopped.ok) return stopped;
  await new Promise((resolve) => setTimeout(resolve, 800));
  const started = await start(options);
  return { ...started, restarted: started.ok, stop: stopped };
}

export async function refreshConfig() {
  return callBridge('/api/status');
}

export function bridgeLogTail(lines = 80) {
  const files = [
    path.join(QQ_STATE_DIR, 'bridge.log'),
    path.join(QQ_STATE_DIR, 'bridge.log.1'),
  ];
  for (const file of files) {
    try {
      const text = fs.readFileSync(file, 'utf8');
      return text.split('\n').slice(-Math.max(1, Math.min(500, lines))).join('\n');
    } catch {}
  }
  return '';
}
