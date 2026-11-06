// 一键启动/停止的接线契约：UI 入口、语音分支、结构化失败码必须同时存在。
// 只读源码，不启动任何服务（真正的启动行为由集成环境手测）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'plugins/surfcore/lib/index.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'plugins/surfcore/lib/client.js'), 'utf8');

for (const action of ['start-selected', 'stop-selected']) {
  assert.ok(index.includes(action), `后端必须支持 ${action}`);
}
assert.ok(index.includes('NO_COMPONENTS'), '空选择必须返回结构化错误');
assert.ok(index.includes('VOICE_BRIDGE_DOWN'), '语音依赖桥接必须返回可行动错误');
assert.ok(index.includes('PLATFORM_DISABLED'), '平台开关关闭必须返回结构化错误');
assert.ok(index.includes("'QQ（含 SnowLuma）'"), '启动项标签必须包含 SnowLuma');
assert.ok(index.includes("stopSchedulerNow"), '一键停止必须能停 B站生物钟');
assert.ok(index.includes("['voice', 'qq', 'bili', 'pet', 'vector']"), '停止顺序必须先语音后桥接，向量记忆独立停');
assert.ok(index.includes("'vector'") && index.includes("'向量记忆'"), '一键启动项包含向量记忆');
assert.ok(index.includes('vectorPack') && index.includes('VECTOR_SELF_TEST_FAILED'), '向量记忆必须支持选模型并拒绝自检失败切换');
assert.ok(client.includes('launch.vector?.models') && client.includes('launch.vector?.providers'), '向量模型下拉必须包含本地模型和已配置云端 provider');
assert.ok(index.includes('/snowluma/accounts') && index.includes('/snowluma/load') && index.includes('X-SnowLuma-Token'), '插件必须有 SnowLuma WebUI 账号检测/加载接口');
assert.ok(client.includes('加载 QQ 账号') && client.includes('loadSnowAccount') && client.includes('SnowLuma WebUI 访问密码'), '一键启动后要弹账号选择窗口并支持密码');
assert.ok(client.includes('order: -1') && client.includes('gridColumn: "1 / -1"'), '启动卡片必须排在概览卡片最上面');
assert.ok(index.includes('hideConsoles') && client.includes('隐藏启动后的命令行黑框'), '一键启动必须有隐藏命令行窗口的选项');
assert.ok(index.includes('nodePathEnv'), 'SnowLuma 启动脚本必须能找到 node（不依赖系统 PATH）');
assert.ok(index.includes("['config', 'runtime.json']") && index.includes('cfg.webuiPort') && client.includes('snowluma.webuiPort'), 'SnowLuma WebUI 端口必须读 config/runtime.json，并支持显式覆盖');
assert.ok(client.includes('读不到 SnowLuma 控制台') && client.includes('和 QQ 有没有启动无关'), '账号弹窗不能把控制台错误误报成 QQ 没启动');
assert.ok(index.includes('spawnSnowLumaDetached') && index.includes('WScript.Shell') && index.includes('explorer+vbs'), 'SnowLuma 默认必须隐藏并脱离 DSH 进程树');
assert.ok(client.includes('snowluma.launchMode'), '设置页必须能切回 legacy 启动方式');
assert.ok(index.includes("'stop-snowluma'") && index.includes('stopSnowLuma'), '孤儿 SnowLuma 必须能在插件里关闭');
assert.ok(client.includes('关闭 SnowLuma'), 'SnowLuma 设置卡必须有「关闭 SnowLuma」按钮');

for (const text of ['一键启动 SurfCore', '一键停止（全部）', 'voiceBranch', '语音分支', '向量模型']) {
  assert.ok(client.includes(text), `前端必须有一键启动/停止/语音分支/向量模型：${text}`);
}
assert.ok(client.includes('launchErr'), '启动失败必须显示在界面上');
assert.ok(client.includes('it.hint'), '失败项必须展示下一步建议');

console.log('✅ 一键启动/停止接线通过');
