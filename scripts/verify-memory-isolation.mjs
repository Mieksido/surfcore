// 验证「QQ 会话记忆隔离」：同一张记忆卡，按会话渲染后不应出现别的会话的内容。
// 用法：node scripts/verify-memory-isolation.mjs [memoryDir]
import path from 'node:path';
import os from 'node:os';
import {
  loadMemoryCard, resolveMemoryCardPaths, renderMemoryCard, filterCardForConversation,
} from '../src/memory-card.js';

const dir = process.argv[2]
  || path.join(os.homedir(), '.dsh', 'surfcore', 'characters', 'char-mvs3a96g', 'memory');
const paths = resolveMemoryCardPaths(dir);
const card = loadMemoryCard(paths);
if (!card) {
  console.error(`✗ 读不到记忆卡：${paths.json}`);
  process.exit(1);
}

const keys = [...new Set(card.records.map((r) => String(r.conversationKey ?? '')).filter(Boolean))];
console.log(`记忆卡 ${card.records.length} 条，会话 ${keys.length} 个\n`);

// 每个会话挑几句「只属于它」的话做指纹：优先最近、够长的，注入时最可能被选中
const fingerprint = {};
for (const k of keys) {
  const own = card.records
    .filter((r) => r.conversationKey === k && !r.pinned && !r.anchor)
    .map((r) => String(r.text ?? '').trim())
    .filter((t) => t.length >= 8);
  fingerprint[k] = own.slice(-4).map((t) => t.slice(0, 10));
}

let failed = 0;
for (const k of keys) {
  const filtered = filterCardForConversation(card, k);
  const text = renderMemoryCard(card, { platform: 'qq', maxChars: 2200, conversationKey: k }).trim();
  const leaks = [];
  for (const [other, fps] of Object.entries(fingerprint)) {
    if (other === k) continue;
    for (const fp of fps) if (fp && text.includes(fp)) leaks.push(`${other}:${fp}`);
  }
  // 结构断言：保留下来的记录只能属于本会话、无 key 的老记录、或 pinned 锚点
  const badRecord = filtered.records.find((r) => {
    const rc = String(r.conversationKey ?? '');
    return rc && rc !== k && !r.pinned && !r.anchor;
  });
  const ok = !leaks.length && !badRecord;
  if (!ok) failed += 1;
  console.log(
    `${ok ? '✓ 干净' : '✗ 串了'}  ${k.padEnd(20)} 记录 ${String(filtered.records.length).padStart(4)}/${card.records.length}`
    + `  注入 ${text.length} 字`
    + (leaks.length ? `  文本泄漏: ${leaks.slice(0, 3).join(' | ')}` : '')
    + (badRecord ? `  结构越界: ${badRecord.conversationKey}` : '')
  );
}

// 不带 conversationKey 时应保持全量（后台统计、完整 md 依赖这个行为）
const full = renderMemoryCard(card, { platform: 'qq', maxChars: 2200 }).trim();
const fullHit = Object.values(fingerprint).flat().filter((fp) => fp && full.includes(fp)).length;
console.log(`\n不传 conversationKey（全量，旧行为）: 文本里出现 ${fullHit} 条跨会话指纹，注入 ${full.length} 字`);

process.exit(failed ? 1 : 0);
