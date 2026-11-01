// 语音提示词回归：不能再把“默认关闭”写死；必须按当前状态/错误码判断。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const source = fs.readFileSync(path.resolve('dsh/agent-presets/qq-chat-v2/agent.cordis.yml'), 'utf8');
const patch = fs.readFileSync(path.resolve('plugins/surfcore/presets/qq-chat-v2.patch.yml'), 'utf8');
const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
for (const [name, text] of [['source', source], ['patch', patch]]) {
  assert.ok(!/默认没开|默认是关闭/.test(text), `${name} 不能写死“语音默认关闭”`);
  assert.ok(text.includes('VOICE_DISABLED') && text.includes('VOICE_TOOL_DISABLED'), `${name} 必须按错误码判断`);
  assert.ok(text.includes('工具可用就正常发') || text.includes('工具存在就正常使用'), `${name} 必须允许可用时正常发`);
}
assert.ok(bridge.includes('function voiceStatusLine'), 'bridge 必须动态注入当前语音状态');
assert.ok(bridge.includes('【语音状态】'), '唤醒提示必须带语音状态行');
assert.ok(bridge.includes('VOICE_TOOL_DISABLED') && bridge.includes('qq_list_voices / qq_send_voice'), '列表工具错误必须有 code/hint');
assert.ok(bridge.includes('不要因为旧提示/旧记忆'), '必须覆盖旧记忆里的“不能发语音”');
console.log('✅ 语音提示词/状态测试通过');
