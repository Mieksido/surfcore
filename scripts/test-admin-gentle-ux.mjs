// 管理员温柔模式：默认关闭、开启前风险确认、关闭时上下文取舍、丢弃上下文联动。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve('.');
const identity = fs.readFileSync(path.join(root, 'src/admin-identity.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'plugins/surfcore/lib/client.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'plugins/surfcore/lib/index.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'plugins/surfcore/lib/store.js'), 'utf8');

assert.ok(identity.includes('gentle: source.gentle === true'), '缺省必须是关闭，只有显式 true 才开');
assert.ok(identity.includes('if (!a.gentle) return \'\';'), '关闭后连管理员提示块也不注入');
assert.ok(identity.includes("? '【管理员】' : ''"), '关闭后不再留【管理员】标记');
assert.ok(store.includes('gentle: false'), '新装默认配置必须关闭');

assert.ok(client.includes('AdminGentleEnableModal'), '开启必须有风险弹窗');
assert.ok(client.includes('可能减少诚实纠错和边界提醒'), '风险要写清行为变化');
assert.ok(client.includes('AdminGentleDisableModal'), '关闭必须有上下文取舍弹窗');
assert.ok(client.includes('只关闭，保留上下文'), '关闭必须允许保留上下文');
assert.ok(client.includes('关闭并丢弃上下文'), '关闭必须允许丢弃上下文');
assert.ok(client.includes('checked: value.gentle === true'), '默认未勾选');
assert.ok(client.includes('onAdminDiscardContext'), 'UI 必须把丢弃上下文传给保存流程');

assert.ok(index.includes('body.resetSessions === true'), '后端必须识别 resetSessions');
assert.ok(index.includes('stopAllBridgeSessions()'), '丢弃上下文必须重置 QQ 会话');
assert.ok(index.includes('resetBiliSchedulerSession'), '丢弃上下文必须处理 B站会话');
assert.ok(index.includes('biliSessionEpoch'), 'B站新会话必须有新 sessionId');
assert.ok(index.includes("body.restartBridge === true || body.resetSessions === true"), '丢弃上下文后必须重启桥接');
console.log('✅ 管理员温柔模式 UX/默认值通过');
