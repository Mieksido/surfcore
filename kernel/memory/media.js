/**
 * 媒体库：原件落盘 + 内容指纹去重 + 引用计数 + 保留期
 * ============================================================================
 * 旧代码里这**完全不存在**（媒体只是桥接进程内的一个 Map，重启就没）。
 * 这里按 docs/persona-core/ADAPTER-SHAPE.md §6.3 的规矩做：
 *   · 记忆里只存"路径 + 一句话说明 + 编号"
 *   · 原件由它保管；同一份内容只存一次（指纹去重）
 *   · 有引用计数：删记忆不会误删别人还在用的图
 *   · 有保留期：到期只留摘要（防无限膨胀）
 *
 * 落盘是可选的：给了 dir 就真的写文件；没给就只在内存里登记（便于测试）。
 * 铁律：本文件不认识任何渠道。
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 内容指纹：同一张图转发十次只存一份 */
export function fingerprint(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

export function createMediaStore({ dir = null, now = () => Date.now() } = {}) {
  /** id → { id, kind, sha256, bytes, caption, transcript, frames, refCount, createdAt, keepUntil } */
  const items = new Map();
  /** sha256 → id（去重） */
  const byHash = new Map();

  const makeId = (sha) => `m_${sha.slice(0, 16)}`;

  return {
    /**
     * 存入一份内容。同指纹复用旧条目（refCount+1）。
     * @param {object} input { kind, bytes?, caption?, transcript?, frames?, keepDays? }
     */
    put(input = {}) {
      const kind = ['image', 'audio', 'video', 'file'].includes(input.kind) ? input.kind : 'file';
      const bytes = input.bytes ?? null;
      const sha = bytes ? fingerprint(bytes) : fingerprint(`${kind}:${input.caption ?? ''}:${items.size}`);

      const existed = byHash.get(sha);
      if (existed) {
        const item = items.get(existed);
        item.refCount += 1;
        if (input.caption) item.caption = String(input.caption);
        return item;
      }

      const id = makeId(sha);
      let filePath = null;
      if (dir && bytes) {
        const sub = path.join(dir, sha.slice(0, 2));
        fs.mkdirSync(sub, { recursive: true });
        filePath = path.join(sub, `${sha}${kind === 'image' ? '.img' : kind === 'audio' ? '.audio' : '.bin'}`);
        if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, bytes);
      }

      const keepDays = Number(input.keepDays) > 0 ? Number(input.keepDays) : 0;
      const item = {
        id,
        kind,
        sha256: sha,
        bytes: bytes ? bytes.length : 0,
        caption: String(input.caption ?? ''),        // 一句话说明（记忆里存的就是它）
        transcript: String(input.transcript ?? ''),  // 音频/视频的文字稿
        frames: Array.isArray(input.frames) ? input.frames : [], // 视频关键画面的 id
        path: filePath,                              // 落盘位置（只是"现在在哪"，不是身份）
        refCount: 1,
        createdAt: now(),
        keepUntil: keepDays ? now() + keepDays * 86400000 : 0,
      };
      items.set(id, item);
      byHash.set(sha, id);
      return item;
    },

    /** 取一条 */
    get(id) { return items.get(String(id)) ?? null; },

    /** 记忆被删时调用：引用计数减一，减到 0 才真的删 */
    release(id) {
      const item = items.get(String(id));
      if (!item) return false;
      item.refCount -= 1;
      if (item.refCount > 0) return false;
      if (item.path) { try { fs.unlinkSync(item.path); } catch {} }
      items.delete(item.id);
      byHash.delete(item.sha256);
      return true;
    },

    /** 到期清理：过了保留期的，只留摘要与文字稿（丢原件），条目保留 */
    sweep() {
      let freed = 0;
      const t = now();
      for (const item of items.values()) {
        if (!item.keepUntil || item.keepUntil > t || !item.path) continue;
        try { fs.unlinkSync(item.path); freed += 1; } catch {}
        item.path = null;
        item.bytes = 0;
        item.expired = true;
      }
      return freed;
    },

    size() { return items.size; },
    totalBytes() { let n = 0; for (const i of items.values()) n += i.bytes; return n; },
    /** 记忆里该存的东西：路径 + 说明 + 编号 */
    refFor(id) {
      const item = items.get(String(id));
      if (!item) return null;
      return { id: item.id, kind: item.kind, path: item.path, caption: item.caption };
    },

    /**
     * 读原件字节（识图/转写要用）。只在需要时读，不把大图常驻内存。
     * @param {string} id
     * @param {object} opts { maxBytes（0 = 不限制） }
     * @returns {Buffer|null}
     */
    readBytes(id, { maxBytes = 0 } = {}) {
      const item = items.get(String(id));
      if (!item?.path) return null;
      try {
        const size = fs.statSync(item.path).size;
        if (Number(maxBytes) > 0 && size > Number(maxBytes)) return null;
        return fs.readFileSync(item.path);
      } catch {
        return null;
      }
    },
  };
}
