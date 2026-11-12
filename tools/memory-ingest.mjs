/**
 * 记忆事件灌注（工具，不属于四层）
 * ============================================================================
 * 只读旧运行时的事件源，灌到新内核状态；不启动服务、不发消息、不写旧状态。
 * 来源：memory-inbox.jsonl（QQ/桌宠）、bili-memory.json（B站 entries）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createKernel } from '../kernel/index.js';

const STATE_FILE = 'memory-ingest.json';

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

function inboxEvent(line, fallbackAt = Date.now()) {
  const kind = line?.kind === 'private' ? 'private' : (line?.kind === 'group' ? 'group' : 'other');
  const pet = String(line?.platform ?? '').toLowerCase() === 'pet';
  const channel = kind === 'group'
    ? `group:${line?.groupId ?? ''}`
    : (kind === 'private' ? (line?.isOwner === true ? 'private:owner' : `private:${line?.senderId ?? line?.sender ?? ''}`) : `inbox:${line?.senderId ?? 'unknown'}`);
  return {
    text: String(line?.text ?? ''),
    source: 'user',
    from: {
      adapter: pet ? 'pet' : 'inbox',
      channel,
      kind,
      actor: line?.sender ? String(line.sender) : null,
      at: Date.parse(line?.at ?? '') || fallbackAt,
      scene: pet ? 'private' : undefined,
    },
    to: {
      owner: line?.isOwner === true,
      sensitive: false,
      circle: kind === 'group' ? [channel] : [],
    },
  };
}

function biliEvent(entry) {
  const at = Date.parse(entry?.at ?? '') || Date.now();
  const text = String(entry?.text ?? entry?.quote ?? entry?.title ?? '').trim();
  return {
    text,
    source: entry?.type === 'thought' ? 'self' : 'bili',
    importance: Number(entry?.priority) > 0 ? Math.min(60, Number(entry.priority) * 10) : 0,
    from: {
      adapter: 'bili',
      channel: 'bili:feed',
      kind: 'other',
      actor: entry?.type === 'thought' ? 'self' : 'feed',
      at,
    },
    to: { owner: false, sensitive: false, circle: [] },
  };
}

export function ingestOnce({ inbox, bili, state, fromStart = false } = {}) {
  if (!state) throw new Error('缺少 state 目录');
  const stateDir = path.resolve(state);
  fs.mkdirSync(stateDir, { recursive: true });
  const metaFile = path.join(stateDir, STATE_FILE);
  const meta = readJson(metaFile, { inboxOffset: 0, biliSeen: [] });
  const kernel = createKernel({ stateDir });
  kernel.load();
  const report = { ok: true, inboxRead: 0, inboxIngested: 0, inboxDuplicate: 0, biliRead: 0, biliIngested: 0, biliDuplicate: 0, skipped: 0 };

  if (inbox && fs.existsSync(inbox)) {
    const size = fs.statSync(inbox).size;
    let offset = fromStart ? 0 : Math.max(0, Number(meta.inboxOffset) || 0);
    if (size < offset) offset = 0;
    const fd = fs.openSync(inbox, 'r');
    const buf = Buffer.alloc(Math.max(0, size - offset));
    if (buf.length) fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const nl = text.lastIndexOf('\n');
    const complete = nl >= 0 ? text.slice(0, nl + 1) : '';
    const nextOffset = offset + Buffer.byteLength(complete, 'utf8');
    for (const raw of complete.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      report.inboxRead += 1;
      let line;
      try { line = JSON.parse(raw); } catch { report.skipped += 1; continue; }
      try {
        const out = kernel.memory.ingest(inboxEvent(line));
        if (!out?.text) { report.skipped += 1; continue; }
        if (out.duplicate) report.inboxDuplicate += 1;
        else report.inboxIngested += 1;
      } catch { report.skipped += 1; }
    }
    meta.inboxOffset = nextOffset;
  }

  if (bili && fs.existsSync(bili)) {
    const raw = readJson(bili, {});
    const entries = Array.isArray(raw?.entries) ? raw.entries : [];
    const seen = new Set(Array.isArray(meta.biliSeen) ? meta.biliSeen : []);
    for (const entry of entries) {
      const id = String(entry?.id ?? '');
      if (!id || seen.has(id)) continue;
      report.biliRead += 1;
      try {
        const out = kernel.memory.ingest(biliEvent(entry));
        if (!out?.text) { report.skipped += 1; continue; }
        if (out.duplicate) report.biliDuplicate += 1;
        else report.biliIngested += 1;
        seen.add(id);
      } catch { report.skipped += 1; }
    }
    meta.biliSeen = [...seen].slice(-20000);
  }

  kernel.save();
  writeJson(metaFile, meta);
  return report;
}

if (process.argv[1]?.endsWith('memory-ingest.mjs')) {
  const arg = (name, fallback = '') => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
  };
  const home = process.env.USERPROFILE ?? process.env.HOME ?? '';
  const inbox = arg('inbox', path.join(home, '.dsh', 'surfcore', 'memory', 'memory-inbox.jsonl'));
  const bili = arg('bili', path.join(process.cwd(), 'state', 'bili-memory.json'));
  const state = arg('state', path.join('state', 'persona-core-shadow'));
  try {
    console.log(JSON.stringify(ingestOnce({ inbox, bili, state, fromStart: process.argv.includes('--from-start') }), null, 2));
  } catch (error) {
    console.error(`记忆灌注失败：${error?.message ?? error}`);
    process.exit(1);
  }
}

export { inboxEvent, biliEvent };
