/**
 * 出站消息 outbox：连接类失败时暂存，账号上线后补发。
 * 不做业务判断；只负责持久化、去重、上限/过期、按顺序补发和失败分类。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEDUPE_MS = 10 * 60_000;
const DEFAULT_TTL_MS = 24 * 60 * 60_000;
const DEFAULT_MAX = 60;
const DEFAULT_MAX_TRIES = 12;

function safeRead(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

function hashOf(kind, id, text) {
  return crypto.createHash('sha256').update(`${kind}\0${id}\0${text}`).digest('hex').slice(0, 24);
}

export function createOutbox({
  file,
  send,
  isConnectionError = () => false,
  now = () => Date.now(),
  max = DEFAULT_MAX,
  ttlMs = DEFAULT_TTL_MS,
  maxTries = DEFAULT_MAX_TRIES,
  log = () => {},
} = {}) {
  if (!file || typeof send !== 'function') throw new Error('outbox 需要 file 和 send');
  let entries = safeRead(file);
  const recent = new Map(); // hash -> sentAt
  let flushing = false;

  function cleanRecent(t) {
    for (const [key, at] of recent) if (t - at > DEDUPE_MS) recent.delete(key);
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, file);
    } catch (error) {
      log(`[outbox] 写入失败：${String(error?.message ?? error)}`);
    }
  }

  function push(kind, id, text, { replyToMessageId = null, atUserId = null } = {}) {
    const body = String(text ?? '');
    if (!body || !kind || id == null) return false;
    const t = now();
    cleanRecent(t);
    const hash = hashOf(kind, String(id), body);
    if (recent.has(hash)) return false;
    if (entries.some((e) => e.hash === hash && t - Number(e.at) < DEDUPE_MS)) return false;
    if (entries.length >= max) {
      entries.shift();
      log('[outbox] 队列已满，丢弃最旧一条');
    }
    entries.push({
      hash, kind: String(kind), id: String(id), text: body,
      replyToMessageId, atUserId, at: t, tries: 0,
    });
    save();
    return true;
  }

  /** 正常发送成功后调用：记指纹，并清掉同文本的待补发项（模型自己重试成功时避免双发）。 */
  function markSent(kind, id, text) {
    const body = String(text ?? '');
    if (!body || !kind || id == null) return;
    const hash = hashOf(kind, String(id), body);
    recent.set(hash, now());
    const before = entries.length;
    entries = entries.filter((e) => e.hash !== hash);
    if (entries.length !== before) save();
  }

  function stats() {
    return { count: entries.length, flushing };
  }

  async function flush(reason = 'manual') {
    if (flushing) return { ok: false, skipped: 'busy', sent: 0, left: entries.length };
    const t = now();
    entries = entries.filter((e) => {
      if (t - Number(e.at) <= ttlMs) return true;
      log(`[outbox] 过期丢弃 ${e.kind}:${e.id}`);
      return false;
    });
    if (!entries.length) { save(); return { ok: true, sent: 0, left: 0 }; }
    flushing = true;
    let sent = 0;
    let stopped = false;
    try {
      const keep = [];
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        if (stopped) { keep.push(entry); continue; }
        if (Number(entry.tries) >= maxTries) {
          log(`[outbox] 超过重试上限，丢弃 ${entry.kind}:${entry.id}`);
          continue;
        }
        try {
          await send(entry);
          sent += 1;
          recent.set(entry.hash, now());
          log(`[outbox] 补发成功 ${entry.kind}:${entry.id}`);
        } catch (error) {
          if (isConnectionError(error)) {
            entry.tries = Number(entry.tries || 0) + 1;
            entry.lastError = String(error?.message ?? error).slice(0, 300);
            keep.push(entry);
            stopped = true;
            log(`[outbox] 补发遇到连接错误，保留 ${entry.kind}:${entry.id}（第 ${entry.tries}/${maxTries} 次）`);
          } else {
            log(`[outbox] 非连接错误，丢弃 ${entry.kind}:${entry.id}：${String(error?.message ?? error).slice(0, 200)}`);
          }
        }
      }
      entries = keep;
      save();
      log(`[outbox] 补发结束（触发：${reason}）：成功 ${sent}，剩余 ${entries.length}`);
      return { ok: true, sent, left: entries.length };
    } finally {
      flushing = false;
    }
  }

  return { push, markSent, flush, stats, _entries: () => entries.slice() };
}
