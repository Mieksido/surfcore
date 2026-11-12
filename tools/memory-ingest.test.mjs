import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ingestOnce } from './memory-ingest.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-memory-ingest-'));
const inbox = path.join(dir, 'inbox.jsonl');
const bili = path.join(dir, 'bili-memory.json');
const state = path.join(dir, 'state');

fs.writeFileSync(inbox, `${JSON.stringify({ kind: 'private', text: '你好', sender: '主人', isOwner: true, at: '2026-11-12T00:00:00.000Z' })}\n`);
fs.writeFileSync(bili, JSON.stringify({ entries: [{ id: 'b1', type: 'thought', text: 'B站看见一件事', at: '2026-11-12T00:00:01.000Z', priority: 3 }] }));

const first = ingestOnce({ inbox, bili, state });
ok(first.inboxIngested === 1 && first.biliIngested === 1, '首次灌注 QQ/B站');
const second = ingestOnce({ inbox, bili, state });
ok(second.inboxIngested === 0 && second.biliIngested === 0, '重复运行不重灌');
const saved = JSON.parse(fs.readFileSync(path.join(state, 'kernel-state.json'), 'utf8'));
ok(Array.isArray(saved.records) && saved.records.length === 2, '新内核落盘两条');
ok(saved.records.some((r) => r.text === '你好') && saved.records.some((r) => r.text === 'B站看见一件事'), '来源内容正确');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
