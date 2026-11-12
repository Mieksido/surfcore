/**
 * 记忆 shadow tap：只读旧 runtime 的 inbox，灌进新内核的“影子状态”
 * ============================================================================
 * 位置：四层之外的运维工具（一次性/可常驻）；不是新层，不产生输出。
 *
 * 用途：旧 runtime 照常说话；本工具只看旧 inbox 的新行，喂给新内核记忆，
 * 用来验证“新内核记住的东西和旧运行时是否一致”。绝不发消息、不改旧状态。
 *
 * 状态目录建议独立：state/persona-core-shadow（不要指向线上 kernel-state）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createKernel } from '../kernel/index.js';

const OFFSET_FILE = 'shadow-tap.json';

function argOf(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

function readOffset(stateDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(stateDir, OFFSET_FILE), 'utf8'));
    return { offset: Math.max(0, Number(raw?.offset) || 0), lines: Math.max(0, Number(raw?.lines) || 0) };
  } catch { return { offset: 0, lines: 0 }; }
}

function writeOffset(stateDir, value) {
  const file = path.join(stateDir, OFFSET_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function eventOf(line, atFallback = Date.now()) {
  const kind = line?.kind === 'private' ? 'private' : (line?.kind === 'group' ? 'group' : 'other');
  const channel = kind === 'group'
    ? `group:${line?.groupId ?? ''}`
    : (kind === 'private' ? (line?.isOwner === true ? 'private:owner' : `private:${line?.senderId ?? line?.sender ?? ''}`) : `inbox:${line?.senderId ?? 'unknown'}`);
  return {
    text: String(line?.text ?? ''),
    source: 'user',
    from: {
      adapter: 'inbox',
      channel,
      kind,
      actor: line?.sender ? String(line.sender) : null,
      at: Date.parse(line?.at ?? '') || atFallback,
    },
    to: {
      owner: line?.isOwner === true,
      sensitive: false,
      circle: kind === 'group' ? [channel] : [],
    },
  };
}

/**
 * 增量读一次 inbox。
 * @returns {{read:number, ingested:number, duplicate:number, empty:number, skipped:number, private:number}}
 */
export function tapOnce({ inbox, state, fromStart = false } = {}) {
  if (!inbox) throw new Error('缺少 inbox 路径');
  if (!state) throw new Error('缺少 shadow 状态目录');
  const stateDir = path.resolve(state);
  fs.mkdirSync(stateDir, { recursive: true });
  if (!fs.existsSync(inbox)) {
    return { ok: true, read: 0, ingested: 0, duplicate: 0, empty: 0, skipped: 0, private: 0, note: 'inbox 不存在' };
  }
  const size = fs.statSync(inbox).size;
  let { offset, lines: lineCount } = readOffset(stateDir);
  if (fromStart || size < offset) { offset = 0; lineCount = 0; }
  const fd = fs.openSync(inbox, 'r');
  const length = size - offset;
  const buffer = Buffer.alloc(Math.max(0, length));
  if (length > 0) fs.readSync(fd, buffer, 0, length, offset);
  fs.closeSync(fd);
  const text = buffer.toString('utf8');
  const lastNewline = text.lastIndexOf('\n');
  if (lastNewline < 0) {
    return { ok: true, read: 0, ingested: 0, duplicate: 0, empty: 0, skipped: 0, private: 0, note: '没有完整行' };
  }
  const complete = text.slice(0, lastNewline + 1);
  const nextOffset = offset + Buffer.byteLength(complete, 'utf8');

  const kernel = createKernel({ stateDir });
  kernel.load();
  const report = { ok: true, read: 0, ingested: 0, duplicate: 0, empty: 0, skipped: 0, private: 0, offset: nextOffset };
  for (const raw of complete.split(/\r?\n/)) {
    const body = raw.trim();
    if (!body) continue;
    report.read += 1;
    let line;
    try { line = JSON.parse(body); } catch { report.skipped += 1; continue; }
    try {
      const out = kernel.memory.ingest(eventOf(line));
      if (!out?.text) { report.empty += 1; continue; }
      if (out.duplicate) report.duplicate += 1;
      else report.ingested += 1;
      if (out.from?.scene === 'private') report.private += 1;
    } catch { report.skipped += 1; }
  }
  kernel.save();
  writeOffset(stateDir, { offset: nextOffset, lines: lineCount + report.read });
  return report;
}

export function tapWatch({ inbox, state, intervalMs = 5000, onReport = () => {} } = {}) {
  let stopped = false;
  let timer = null;
  const tick = () => {
    if (stopped) return;
    try {
      const r = tapOnce({ inbox, state });
      if (r.read) onReport(r);
    } catch (error) {
      onReport({ ok: false, error: String(error?.message ?? error) });
    }
    timer = setTimeout(tick, Math.max(1000, Number(intervalMs) || 5000));
    if (typeof timer?.unref === 'function') timer.unref();
  };
  tick();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

if (process.argv[1]?.endsWith('shadow-tap.mjs')) {
  const inbox = argOf('inbox', path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh', 'surfcore', 'memory', 'memory-inbox.jsonl'));
  const state = argOf('state', path.join('state', 'persona-core-shadow'));
  const interval = Number(argOf('interval', 5000));
  try {
    if (hasFlag('watch')) {
      console.log(`shadow tap：监听 ${inbox} → ${state}（每 ${interval}ms）`);
      tapWatch({ inbox, state, intervalMs: interval, onReport: (r) => console.log(JSON.stringify(r)) });
    } else {
      const r = tapOnce({ inbox, state, fromStart: hasFlag('from-start') });
      console.log(JSON.stringify(r, null, 2));
    }
  } catch (error) {
    console.error(`shadow tap 失败：${error?.message ?? error}`);
    process.exit(1);
  }
}

export { eventOf as shadowEventOf, readOffset };
