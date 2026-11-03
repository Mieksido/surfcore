// 语音引擎（Breeze-TTS-2）的生命周期管理：探活 / 启动 / 停止 / 自愈。
//
// 为什么需要这一层：
//   SurfCore 的 voice-tts.js 只会往 8765 发 POST，服务没起就抛 502。
//   2026-11-03 之前，8765 上的 Breeze 适配层是**手工**用 start-voice.ps1 拉起来的：
//   电脑重启、进程被杀、模型换版本，都没有任何东西负责把它拉回来——现象是
//   "她能聊天但发不出语音"，而报错只有一句 upstream connect failed，很容易误判成引擎坏了。
//   这里把"这个引擎属于 SurfCore 的语音功能"这件事落到代码里：桥接启动时确保它在跑，
//   合成失败时自动拉起一次再重试，控制台能看到状态、能手动启停。
//
// 契约：
//   · 引擎脚本是外部的（D:\大肥鱼功能\语音\说话\breeze\bridge\start-voice.ps1），
//     本模块只负责**调用**，不复制它的逻辑；脚本换位置改 config 即可。
//   · 探活只认「TCP 能连 + /health 返回 ok」，不看进程名——端口被别的服务占了要能发现。
//   · 所有失败都返回可读句子，不抛到调用方崩掉。
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

/** TCP 探活：300ms 够本机服务回应。 */
export function probePort(port, host = '127.0.0.1', timeout = 300) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** GET /health，返回 JSON 或 null。不走环境代理（undici 默认直连，这里再给定超时）。 */
async function healthJson(url, timeoutMs = 2500) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} cfg 完整配置（读 socialV2.voice.tts.engine）
 */
export function createVoiceEngine(cfg) {
  const raw = cfg?.socialV2?.voice?.tts?.engine ?? {};
  const kind = String(raw.kind || 'breeze');
  const port = Number(raw.port) || 8765;
  const host = String(raw.host || '127.0.0.1');
  const script = raw.script ? String(raw.script) : '';
  const dir = raw.dir ? String(raw.dir) : '';
  const label = String(raw.label || 'Breeze-TTS-2');
  const autoStart = raw.autoStart !== false;
  const startTimeoutMs = Number(raw.startTimeoutMs) > 0 ? Number(raw.startTimeoutMs) : 180000;
  // 适配层把上游 breeze-server 的状态也报在 /health 里，排障时一眼能分清"谁没起"
  const healthUrl = `http://${host}:${port}/health`;

  let starting = null; // 并发调用共用同一次启动

  function scriptOk() {
    try { return !!script && fs.statSync(script).isFile(); } catch { return false; }
  }

  async function status() {
    const tcp = await probePort(port, host);
    if (!tcp) {
      return {
        kind, label, port, host, running: false, upstream: 'down', ready: false,
        autoStart, script, scriptOk: scriptOk(), dir,
        hint: autoStart ? '引擎没在跑，下次合成会自动拉起' : '引擎没在跑（自动启动已关闭）'
      };
    }
    const h = await healthJson(healthUrl);
    if (!h) {
      return {
        kind, label, port, host, running: true, upstream: 'unknown', ready: false,
        autoStart, script, scriptOk: scriptOk(), dir,
        hint: `端口 ${port} 有服务但 /health 不像 ${label}（可能被别的程序占用）`
      };
    }
    const upstream = String(h.upstream ?? 'n/a');
    const ready = h.status === 'ok' && (upstream === 'ok' || upstream === 'n/a');
    return {
      kind, label, port, host, running: true, ready, upstream,
      autoStart, script, scriptOk: scriptOk(), dir,
      breezeUrl: h.breezeUrl ?? null,
      hint: ready ? '就绪' : `适配层在跑，但上游 ${upstream === 'unreachable' ? 'breeze-server 没起' : upstream}`
    };
  }

  /**
   * 拉起引擎。脚本自己会等模型加载并做一次端到端自检，所以这里只轮询端口，
   * 不重复实现"等多久"的判断。
   */
  async function start({ silent = false } = {}) {
    const st = await status();
    if (st.ready) return { ok: true, already: true, ...st };
    if (!scriptOk()) {
      return { ok: false, error: `找不到引擎启动脚本：${script || '(未配置 socialV2.voice.tts.engine.script)'}` };
    }
    if (starting) return starting;

    starting = (async () => {
      const t0 = Date.now();
      // 把子进程输出落盘：stdio:'ignore' 时脚本一旦中途报错就完全看不见，
      // 上次"180 秒没就绪"排查了半天才发现只是没日志。日志路径固定在引擎目录的 logs 下。
      let fd = null;
      const logPath = dir ? path.join(dir, 'logs', 'engine-autostart.log') : '';
      try {
        if (logPath) {
          fs.mkdirSync(path.dirname(logPath), { recursive: true });
          fd = fs.openSync(logPath, 'a');
          fs.writeSync(fd, `\n===== ${new Date().toISOString()} 由 SurfCore 拉起 =====\n`);
        }
      } catch { fd = null; }
      try {
        // ⚠️ 这里**不能**用 detached:true（2026-11-03 排查了两轮的真凶）：
        //   Windows 上 detached 会带 DETACHED_PROCESS 标志，让 powershell.exe 拿不到任何控制台。
        //   PS 5.1 在没有控制台时不会报错，而是**立刻 exit 0、脚本一行都不执行**——
        //   现象就是「点了启动、日志里只有一行『由 SurfCore 拉起』、端口永远不亮」，
        //   但手动双击脚本一切正常。
        //   真正需要"脱离"的是脚本里的 breeze-server / voxd 子进程，它们自己会走
        //   Win32_Process.Create 脱离；这一个 powershell.exe 只要跑完自己的 1~2 分钟退出即可。
        const child = spawn('powershell.exe', [
          '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script
        ], {
          cwd: dir || undefined,
          stdio: fd === null ? 'ignore' : ['ignore', fd, fd],
          windowsHide: true
        });
        child.on('error', (e) => {
          try { if (fd !== null) fs.writeSync(fd, `\n[spawn error] ${e.code} ${e.message}\n`); } catch {}
        });
        child.on('exit', (code, sig) => {
          try { if (fd !== null) fs.writeSync(fd, `\n[exit] code=${code} signal=${sig}\n`); } catch {}
        });
        child.unref();
      } catch (error) {
        return { ok: false, error: `启动引擎失败：${error?.message ?? error}` };
      }
      const deadline = Date.now() + startTimeoutMs;
      while (Date.now() < deadline) {
        await sleep(1500);
        const s = await status();
        if (s.ready) {
          return { ok: true, seconds: Math.round((Date.now() - t0) / 1000), ...s };
        }
      }
      const s = await status();
      return {
        ok: false,
        error: `引擎在 ${Math.round(startTimeoutMs / 1000)} 秒内没就绪（${s.hint}），看日志：${dir ? path.join(dir, 'logs') : '引擎脚本同目录下的 logs'}`,
        ...s
      };
    })().finally(() => { starting = null; });

    if (!silent) return starting;
    // 静默模式：后台跑，立即返回，不阻塞桥接启动
    return { ok: true, pending: true };
  }

  async function stop() {
    if (!scriptOk()) return { ok: false, error: '没配置引擎启动脚本，无法停止' };
    try {
      const code = await new Promise((resolve) => {
        const c = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Stop'],
          { cwd: dir || undefined, stdio: 'ignore', windowsHide: true });
        c.on('close', resolve);
        c.on('error', () => resolve(-1));
      });
      const still = await probePort(port, host);
      return still
        ? { ok: false, error: `停止脚本退出码 ${code}，但端口 ${port} 仍在监听` }
        : { ok: true, stopped: true };
    } catch (error) {
      return { ok: false, error: `停止引擎失败：${error?.message ?? error}` };
    }
  }

  /** 确保可用：已就绪直接返回，否则拉起。合成失败重试前会调这里。 */
  async function ensure() {
    const st = await status();
    if (st.ready) return { ok: true, already: true, ...st };
    if (!autoStart) return { ok: false, error: `${label} 没在跑，且自动启动已关闭（socialV2.voice.tts.engine.autoStart）` };
    return start();
  }

  return { kind, port, label, autoStart, script, dir, status, start, stop, ensure };
}

/** 合成失败时判断"是不是服务根本没起"——只在这类错误上重试，别把真正的内容错误也重试一遍。 */
export function looksLikeEngineDown(error) {
  const msg = String(error?.message ?? error ?? '');
  return /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|upstream connect failed|etimedout/i.test(msg)
    || error?.cause?.code === 'ECONNREFUSED';
}
