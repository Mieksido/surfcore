// 设置页连续保存回归：保存成功必须回传新 stamps；前端必须同步；warning 不能当 error。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileStamp, isStale } from '../src/config-stamps.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-stamps-'));
try {
  const file = path.join(tmp, 'config.json');
  fs.writeFileSync(file, '{"a":1}');
  const loaded = fileStamp(file);
  fs.writeFileSync(file, '{"a":2,"changed":true}');
  const afterSave = fileStamp(file);
  assert.ok(isStale(loaded, afterSave), '第一次保存后旧戳必须被视为过期');
  assert.equal(isStale(afterSave, afterSave), false, '同步新戳后下一次保存不能 stale');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const index = fs.readFileSync(path.resolve('plugins/surfcore/lib/index.js'), 'utf8');
const client = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');
assert.ok(index.includes('result.stamps = {'), 'POST /config 成功响应必须返回新 stamps');
assert.ok(index.includes('result.notes =') || index.includes('notes: []'), '例行提示用 notes，不混进 warnings');
assert.ok(client.includes('setConfigStamps(r.stamps)'), '保存成功后前端必须同步 stamps');
assert.ok(!client.includes('setConfigStamps(latestStamps)'), '409 不能自动套用 stamps，否则会覆盖别人的修改');
assert.ok(client.includes('setWarnings(nextWarnings)'), 'warnings 必须单独存');
assert.ok(!client.includes('setErr(r.warnings.join'), 'warning 不能再写进错误状态');
console.log('✅ 设置保存 stamps 回归通过');
