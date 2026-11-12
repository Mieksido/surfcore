/**
 * 影子对比：只读旧记忆和新影子全量卡
 * 跑法：node tools/shadow-diff.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffShadow } from './shadow-diff.mjs';

let pass = 0; let fail = 0;
const ok = (c, n) => { if (c) { pass += 1; console.log('  ✅', n); } else { fail += 1; console.error('  ❌', n); } };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-diff-'));
const oldDir = path.join(dir, 'old');
const stateDir = path.join(dir, 'shadow');
fs.mkdirSync(oldDir); fs.mkdirSync(stateDir);
fs.writeFileSync(path.join(oldDir, 'memory-card.json'), JSON.stringify({ records: [{ text: 'A' }, { text: 'B' }] }));
fs.writeFileSync(path.join(oldDir, 'memory-card-full.jsonl'), ['{"text":"C"}', '{"text":"D"}'].join('\n'));
fs.writeFileSync(path.join(stateDir, 'memory-full.jsonl'), ['{"text":"A"}', '{"text":"B"}', '{"text":"C"}', '{"text":"E"}'].join('\n'));

const r = diffShadow({ oldDir, stateDir });
ok(r.old.full === 2 && r.old.card === 2 && r.old.uniqueTexts === 4, '旧记忆计数');
ok(r.shadow.full === 4 && r.shadow.uniqueTexts === 4, '影子计数');
ok(r.missingCount === 1 && r.missing[0] === 'D', '发现缺失 D');
ok(r.extraCount === 1 && r.extra[0] === 'E', '发现多出 E');
ok(r.coverage === 0.75, '覆盖率 75%');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
