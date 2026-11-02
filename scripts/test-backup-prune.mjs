// 备份轮转回归：真实文件名必须被正确分组；不能按每个文件一组无限保留。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { backupGroupOf, pruneBackups } from '../plugins/surfcore/lib/store.js';

const stamp = (n) => `2026-10-31T10-01-25-${String(880 + n).padStart(3, '0')}Z`;
const name = (label, n, ext = '.json') => `${label}-${stamp(n)}${ext}`;

assert.equal(backupGroupOf(name('memory-card', 1)), 'memory-card');
assert.equal(backupGroupOf(name('token-budget-before-reset', 2)), 'token-budget-before-reset');
assert.equal(backupGroupOf(name('memory-card', 3, '.md')), 'memory-card');
assert.equal(backupGroupOf(name('character-migration', 4, '')), 'character-migration');
assert.equal(backupGroupOf('not-a-backup.json'), null);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-backup-prune-'));
try {
  const files = [
    ...Array.from({ length: 5 }, (_, i) => name('memory-card', i)),
    ...Array.from({ length: 3 }, (_, i) => name('qq-config', i)),
    name('character-migration', 9, ''),
    'not-a-backup.json',
  ];
  for (let i = 0; i < files.length; i += 1) {
    const full = path.join(dir, files[i]);
    fs.writeFileSync(full, 'x');
    const t = new Date(Date.now() + i * 1000);
    fs.utimesSync(full, t, t);
  }
  const result = pruneBackups(2, dir);
  assert.equal(result.errors.length, 0);
  assert.equal(result.removed.length, 4, 'memory-card 5→2 删 3 份 + qq-config 3→2 删 1 份');
  const left = fs.readdirSync(dir);
  assert.equal(left.filter((n) => n.startsWith('memory-card-')).length, 2);
  assert.equal(left.filter((n) => n.startsWith('qq-config-')).length, 2);
  assert.equal(left.filter((n) => n.startsWith('character-migration-')).length, 1);
  assert.ok(left.includes('not-a-backup.json'), '无关文件不能被误删');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('✅ 备份轮转测试通过');
