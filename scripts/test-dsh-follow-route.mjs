// 2026-11-03 回归：前端调了 /dsh/follow-default，宿主必须注册代理路由。
// 这次根因是“前端路径集合 ⊄ 宿主路由集合”，同类问题出过多次，用静态契约钉住。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const client = read('plugins/surfcore/lib/client.js');
const host = read('plugins/surfcore/lib/index.js');

assert.match(client, /api\("\/dsh\/follow-default"/, '前端必须调用 /dsh/follow-default');

assert.match(
  host,
  /pathname === `\$\{API_PREFIX\}\/dsh\/follow-default`/,
  '宿主必须注册 /dsh/follow-default 路由',
);
assert.match(host, /async function proxyDshFollowDefault\(req, res\)/, '宿主必须有 proxyDshFollowDefault');
assert.match(
  host,
  /callBridge\('\/api\/dsh\/follow-default', \{ method: 'POST', body, timeoutMs: 8000 \}\)/,
  '代理必须转发到桥接 /api/dsh/follow-default',
);
for (const code of ['DSH_FOLLOW_METHOD', 'DSH_FOLLOW_BODY', 'DSH_FOLLOW_BRIDGE']) {
  assert.ok(host.includes(code), `失败路径必须带 ${code}`);
}

console.log('✅ DSH follow-default 路由契约通过');
