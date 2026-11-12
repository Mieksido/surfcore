/**
 * 记忆归档（全量卡）：忘掉的记忆不是消失了，是搬到档案里
 * ============================================================================
 * 旧代码的规矩（memory-card.js 的全量卡）：
 *   · **append-only**：只追加，永不修改、永不删除
 *   · **不进提示词**：只存档，不参与她说话
 *   · **坏一行不毁全部**：逐行 JSON，读的时候跳过坏行
 *   · 10GB 级不整读：召回只看尾部
 *
 * 铁律：不认识渠道（法则 11）。
 */
import fs from 'node:fs';
import path from 'node:path';

const DAY = 86400000;

/**
 * @param {object} opts
 *   { store?（有就落到 store.dir 下的 jsonl）, now, maxScanBytes? }
 */
export function createFullCard({ store = null, now = () => Date.now(), maxScanBytes = 2 * 1024 * 1024 } = {}) {
  const memory = [];                       // 没有 store 时用它（测试/离线）
  const file = store ? path.join(store.dir, 'memory-full.jsonl') : null;

  function rowOf(record) {
    return {
      at: record?.from?.at ?? now(),
      text: String(record?.text ?? ''),
      channel: record?.from?.channel ?? '',
      kind: record?.from?.kind ?? 'other',
      actor: record?.from?.actor ?? null,
      importance: Number(record?.importance) || 0,
      clarity: record?.clarity ?? 'clear',
      media: Array.isArray(record?.media) ? record.media.map((m) => m?.id).filter(Boolean) : [],
      source: record?.source ?? 'user',
    };
  }

  return {
    /** 追加（唯一写入口）：**入库时就写**，不等遗忘——它是全量卡 */
    append(record) {
      const row = rowOf(record);
      if (file) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
      } else {
        memory.push(row);
      }
      return row;
    },

    /**
     * 召回：按关键词找回旧事。
     * 有文件时只读尾部（大档案不整读）；坏行跳过。
     * @returns {Array} 命中行（新→旧）
     */
    recall({ query = '', limit = 5, withinDays = 0 } = {}) {
      const rows = file ? readTail(file, maxScanBytes) : memory.slice();
      const q = String(query ?? '').trim();
      const since = withinDays > 0 ? now() - withinDays * DAY : 0;

      const hits = [];
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        if (!r) continue;
        if (since && Number(r.at) < since) continue;
        if (q && !String(r.text).includes(q)) continue;
        hits.push(r);
        if (hits.length >= limit) break;
      }
      return hits;
    },

    /** 档案概况（给人看的） */
    stats() {
      const rows = file ? readTail(file, maxScanBytes) : memory;
      let bytes = 0;
      if (file) { try { bytes = fs.statSync(file).size; } catch {} }
      return { rows: rows.length, bytes, file };
    },

    size() { return file ? readTail(file, maxScanBytes).length : memory.length; },
  };
}

/** 从文件尾部读（不整读大档案）；坏行跳过 */
function readTail(file, maxBytes) {
  let text = '';
  try {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const len = Math.min(maxBytes, size - start);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, start);
    fs.closeSync(fd);
    text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');            // 丢掉被切断的半行
      text = nl >= 0 ? text.slice(nl + 1) : '';
    }
  } catch { return []; }

  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* 坏一行不毁全部 */ }
  }
  return out;
}
