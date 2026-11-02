// 模型设置契约：设置页 → 宿主代理 → 桥接；保存只是请求，selectModel 回执才算应用。
import assert from 'node:assert/strict';
import fs from 'node:fs';

const client = fs.readFileSync('plugins/surfcore/lib/client.js', 'utf8');
const index = fs.readFileSync('plugins/surfcore/lib/index.js', 'utf8');
const bridge = fs.readFileSync('src/bridge.js', 'utf8');

assert.match(client, /api\("\/dsh\/model"\)/, '设置页必须请求宿主 /dsh/model');
assert.match(client, /api\("\/dsh\/effort"/, '设置页必须请求宿主 /dsh/effort');
assert.match(index, /proxyDshModel/, '宿主必须有 /dsh/model 代理');
assert.match(index, /proxyDshEffort/, '宿主必须有 /dsh/effort 代理');
assert.match(index, /API_PREFIX\}\/dsh\/model/, '宿主必须注册 /dsh/model 路由');
assert.match(index, /API_PREFIX\}\/dsh\/effort/, '宿主必须注册 /dsh/effort 路由');
assert.match(bridge, /recordModelApplied/, '桥接必须记录 selectModel 回执');
assert.match(bridge, /recordModelUsed/, '桥接必须记录 model/selection 证据');
assert.match(bridge, /lastApplyStale/, '桥接必须标记跨进程的旧回执');
assert.match(client, /DSH 已接受/, 'UI 必须展示 DSH 已接受');
assert.match(client, /待下一条消息|等待下一条消息/, '保存后不能直接宣称已生效');
assert.match(client, /未知接口.*重启 DSH/s, '旧宿主 404 必须给可执行提示');
console.log('✅ 模型设置/证据链契约测试通过');
