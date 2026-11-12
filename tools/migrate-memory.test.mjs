/**
 * 旧记忆迁移工具：dry-run 不写；apply 才写新状态
 * 跑法：node tools/migrate-memory.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrate } from './migrate-memory.mjs';
import { createKernel } from '../kernel/index.js';

let pass = 0; let fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-migrate-'));
const oldFile = path.join(dir, 'memory-card.json');
const stateDir = path.join(dir, 'new-state');
const at = Date.parse('2026-01-02T03:04:05.000Z');
fs.writeFileSync(oldFile, JSON.stringify({
  records: [
    { id: 'a', text: '主人私聊说的话', platform: 'qq', private: true, speaker: 'owner', tags: ['owner'], importance: 80, createdAt: new Date(at).toISOString() },
    { id: 'b', text: '群里说的话', platform: 'qq', groupId: '123', speaker: 'u1', tags: [], importance: 30, createdAt: new Date(at + 1000).toISOString() },
    { id: 'c', text: '敏感内容', platform: 'qq', sensitive: true, createdAt: new Date(at + 2000).toISOString() },
    { id: 'd', text: '', platform: 'qq', createdAt: new Date(at + 3000).toISOString() },
  ],
}));

console.log('## dry-run');
{
  const r = migrate({ from: oldFile, json: true });
  ok(r.mode === 'dry-run', '模式是 dry-run');
  ok(r.read === 4 && r.ingested === 3 && r.empty === 1, '读到 4，空记录跳过');
  ok(r.private === 1, '主人私聊 → private');
  ok(r.state === null && !fs.existsSync(stateDir), 'dry-run 不写新状态');
  ok(r.records === 3, '内存内核有 3 条');
}

console.log('\n## apply');
{
  const r = migrate({ from: oldFile, state: stateDir, apply: true, json: true });
  ok(r.saved && fs.existsSync(r.saved), 'apply 写出 kernel-state.json');
  const k = createKernel({ stateDir });
  k.load();
  const snap = k.snapshot();
  ok(snap.records === 3, '重新加载后仍是 3 条');
  const priv = k.memory.snapshot().find((x) => x.text.includes('私聊'));
  ok(priv?.from?.scene === 'private', '落盘后 private 标签还在');
}

console.log('\n## 拒绝覆盖');
{
  let err = '';
  try { migrate({ from: oldFile, state: stateDir, apply: true, json: true }); } catch (e) { err = String(e?.message ?? e); }
  ok(err.includes('拒绝覆盖'), '已有 kernel-state 时拒绝 apply');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
