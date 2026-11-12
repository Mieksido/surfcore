/**
 * 记忆 shadow tap：只读旧 inbox，增量灌新内核
 * 跑法：node tools/shadow-tap.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKernel } from '../kernel/index.js';
import { tapOnce } from './shadow-tap.mjs';

let pass = 0; let fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-shadow-'));
const inbox = path.join(dir, 'inbox.jsonl');
const state = path.join(dir, 'state');
const line = (x) => `${JSON.stringify(x)}\n`;
fs.writeFileSync(inbox, [
  line({ at: '2026-01-01T00:00:00.000Z', kind: 'group', sender: 'u1', senderId: '1', groupId: 'g1', isOwner: false, text: '群消息一' }),
  line({ at: '2026-01-01T00:00:01.000Z', kind: 'private', sender: 'owner', senderId: '9', isOwner: true, private: true, text: '主人私聊' }),
].join(''));

console.log('## 第一次增量');
{
  const r = tapOnce({ inbox, state });
  ok(r.read === 2 && r.ingested === 2, '读到并灌入 2 条');
  ok(r.private === 1, '主人私聊计入 private');
  const k = createKernel({ stateDir: state }); k.load();
  ok(k.snapshot().records === 2, '影子状态落盘 2 条');
}

console.log('\n## 没有新行：不重复灌');
{
  const r = tapOnce({ inbox, state });
  ok(r.read === 0 && r.ingested === 0, '第二次没有新行');
}

console.log('\n## 追加一行：只读新增');
{
  fs.appendFileSync(inbox, line({ at: '2026-01-01T00:00:02.000Z', kind: 'group', sender: 'u2', senderId: '2', groupId: 'g1', isOwner: false, text: '群消息二' }));
  const r = tapOnce({ inbox, state });
  ok(r.read === 1 && r.ingested === 1, '只处理新增 1 条');
  const k = createKernel({ stateDir: state }); k.load();
  ok(k.snapshot().records === 3, '影子状态 3 条');
}

console.log('\n## 坏行跳过');
{
  fs.appendFileSync(inbox, '{not-json}\n');
  const r = tapOnce({ inbox, state });
  ok(r.read === 1 && r.skipped === 1 && r.ingested === 0, '坏行 skipped，不中断');
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
