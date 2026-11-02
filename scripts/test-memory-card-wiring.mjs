// 记忆卡「接线」静态回归：核心模块单测通过，不代表桥接/调度器/控制台真的用上了它。
// 这里只读源码断言关键接线，不启动服务、不写真实数据。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const bridge = read('src/bridge.js');
const scheduler = read('plugins/surfcore/lib/scheduler.js');
const index = read('plugins/surfcore/lib/index.js');
const client = read('plugins/surfcore/lib/client.js');
const paths = read('plugins/surfcore/lib/paths.js');
const store = read('plugins/surfcore/lib/store.js');
const memoryCardLib = read('plugins/surfcore/lib/memory-card.js');
const pmemoryBackend = read('plugins/surfcore/lib/pmemory-backend.js');
const safeTools = read('src/mcp-snowluma-safe.js');
const exampleConfig = read('config.example.json');

// 1) 桥接：消息进来写 inbox；QQ 提示词两条路径都注入记忆卡；有容量告警私聊端点。
assert.match(bridge, /appendMemoryInboxEvent\(MEMORY_CARD_PATHS/, '桥接没有把消息写入记忆卡 inbox');
assert.match(bridge, /recordMemoryInboxEvent\(\{ key, kind, event, plainContent, textContent, isOwner, quoteTargetIsSelf \}\)/, '桥接没有在 handleIncoming 里记录记忆');
assert.match(bridge, /recordSelfMemoryEvent\(key, sent\.join\('\\n'\)\)/, 'v2 发送没有记录她自己的发言');
assert.match(bridge, /recordSelfMemoryEvent\(key, text\)/, 'v1 发送没有记录她自己的发言');
assert.match(bridge, /isSelf: true/, '桥接 inbox 自发言没有 isSelf 标记');
assert.match(bridge, /const memoryBlock = memoryCardPromptBlock\(\)/, 'v1/chat 角色提示没有注入记忆卡');
assert.match(bridge, /const memoryCardText = memoryCardPromptBlock\(\)/, 'v2 唤醒提示没有注入记忆卡');
assert.match(bridge, /\/api\/memory-card\/notify/, '桥接缺少记忆卡容量告警端点');
assert.match(bridge, /memoryCard: memoryCardPromptBlock\(\)/, 'qq_get_prompt 没有返回记忆卡');

// 2) B站 调度器：每次醒来的统一上下文里有记忆卡（仅 B站 公开 scope）。
assert.match(scheduler, /memoryCardPromptBlock\('bili'\)/, 'B站调度器没有注入记忆卡');
assert.match(scheduler, /memoryCardBlockForBili\(\)/, 'B站记忆卡块没有接进 identityContextLines');

// 3) 插件：定时维护 + 控制台 API + 生命周期清理。
assert.match(index, /startMemoryCardTimer\(\{ log: pluginLog, callBridge \}\)/, '插件没有启动记忆卡定时维护');
assert.match(index, /\/memory-card/, '插件缺少记忆卡 API 路由');
assert.match(index, /handleMemoryCard/, '插件缺少记忆卡处理器');
assert.match(index, /memoryCard: memoryCardStatusNow\(\)/, '概览没有记忆卡状态');
assert.match(index, /memoryCardTimer\?\.stop/, '插件销毁时没有停记忆卡定时器');

// 4) 控制台：容量条 / 弹窗 / 规则面板。
assert.match(client, /function MemoryCardPanel/, '控制台缺少记忆卡面板');
assert.match(client, /qbw-modal-backdrop/, '控制台缺少容量弹窗');
assert.match(client, /记忆卡快满了/, '弹窗文案缺失');
assert.match(client, /压缩到 80%/, '控制台缺少压缩按钮');

// 5) 路径与默认配置：QQ/B站 注入块是文件契约，默认值与核心模块同源。
assert.match(paths, /MEMORY_CARD_PROMPT_QQ/, 'paths.js 缺少 QQ 注入块路径');
assert.match(paths, /MEMORY_CARD_PROMPT_BILI/, 'paths.js 缺少 B站 注入块路径');
assert.match(paths, /MEMORY_CARD_FULL_JSONL/, 'paths.js 缺少全量卡 JSONL 路径');
assert.match(paths, /MEMORY_CARD_FULL_STATS/, 'paths.js 缺少全量卡 stats 路径');
assert.match(store, /DEFAULT_MEMORY_CARD_CONFIG/, '合体层默认配置没有引用记忆卡默认值');

// 5b) 全量卡只存档：桥接/调度器**不能**读它，否则「平时只加载衰减卡」就失效了。
assert.equal(bridge.includes('MEMORY_CARD_FULL'), false, '桥接不应读取全量卡');
assert.equal(scheduler.includes('MEMORY_CARD_FULL'), false, 'B站调度器不应读取全量卡');
assert.match(index, /\/memory-card\/full/, '插件缺少全量卡只读路由');
assert.match(index, /fullMemoryCardSnapshot/, '插件缺少全量卡快照');
assert.match(client, /function FullMemoryCardPanel/, '控制台缺少全量记忆卡面板');
assert.match(client, /当前提示词加载：/, '控制台没有明确标出当前加载的是哪张卡');
assert.match(client, /全量记忆卡（只存档）/, '控制台没有全量卡标识');
assert.match(client, /衰减卡字数上限/, '控制台没有衰减卡字数上限输入（用户可改）');
assert.match(client, /全量卡上限（GB）/, '控制台没有全量卡 GB 上限输入');
assert.match(client, /设为初次相遇/, '控制台没有“设为初次相遇”入口');
assert.match(client, /合并为一个事件/, '控制台没有“合并为一个事件”入口');
assert.match(client, /合并后置顶/, '控制台没有合并后置顶选项');
assert.match(index, /merge-memories/, '插件动作白名单没有 merge-memories');
assert.match(client, /初次相遇：/, '控制台没有显示当前初次相遇');
assert.match(index, /set-first-meet/, '插件动作白名单没有 set-first-meet');
assert.match(client, /最初/, '控制台没有「最初」说明/标记');

// 6) 真实 bridge.js（VM fixture）：注入块能读、主人消息能进 inbox、不会写真实 ~/.dsh。
const { bridgeHarness } = await import('./audit-bridge-harness.mjs');
const harness = await bridgeHarness({ config: { ownerQQ: 123, allow: { private: ['123'], groups: ['456'] } } });
try {
  const memoryDir = path.join(harness.temp, 'dsh', 'surfcore', 'memory');
  fs.mkdirSync(memoryDir, { recursive: true });
  fs.writeFileSync(path.join(memoryDir, 'memory-card-prompt-qq.md'), '【测试记忆卡】主人第一次对角色说话，要永远记得。');
  assert.match(harness.memoryCardPromptBlock(), /测试记忆卡/, '桥接没有读到记忆卡注入块');
  assert.match(harness.currentRoleHint(), /测试记忆卡/, 'v1/chat 角色提示没有拼上记忆卡');
  harness.recordMemoryInboxEvent({
    key: 'private:123',
    kind: 'private',
    event: { user_id: '123', sender: { nickname: '主人' }, self_id: '999' },
    plainContent: '今天想你了',
    textContent: '今天想你了',
    isOwner: true,
    quoteTargetIsSelf: false,
  });
  harness.recordSelfMemoryEvent('private:123', '测试她的回复');
  const inboxLines = fs.readFileSync(path.join(memoryDir, 'memory-inbox.jsonl'), 'utf8').trim().split('\n');
  assert.equal(inboxLines.length, 2, '主人消息 + 她自己的发言没有都写进 fixture inbox');
  assert.match(inboxLines[0], /今天想你了/);
  assert.match(inboxLines[1], /测试她的回复/);
  assert.match(inboxLines[1], /"isSelf":true/);
  assert.equal(inboxLines[0].includes('sk-'), false);
} finally {
  await harness.close();
}


// 7) pmemory 长记忆（可选后端）：默认关闭；开了才读注入文件，文件契约与记忆卡一致。
assert.match(bridge, /function pmemoryPromptBlock\(/, '桥接缺少长记忆注入块读取函数');
assert.match(bridge, /const pmemoryBlock = cfg\.pmemory\?\.enabled === true \? pmemoryPromptBlock\(\) : ''/, 'v1/chat 角色提示没有按开关注入长记忆块');
assert.match(bridge, /pmemory: pmemoryPromptBlock\(\)/, 'qq_get_prompt 没有返回长记忆块');
assert.match(memoryCardLib, /syncPmemory/, '插件维护后没有同步长记忆后端');
assert.match(pmemoryBackend, /PMEMORY_PROMPT_FILE = 'pmemory-prompt-qq\.md'/, '长记忆注入文件名与桥接读取的不一致');
assert.match(pmemoryBackend, /state: 'unreachable'/, '长记忆不可用时没有留痕状态');
assert.match(safeTools, /qq_memory_recall/, 'MCP 没有暴露长记忆召回工具');
assert.match(exampleConfig, /"pmemory"/, 'config.example.json 没有长记忆默认块');

const pmHarness = await bridgeHarness({
  config: {
    ownerQQ: 123,
    allow: { private: ['123'], groups: ['456'] },
    pmemory: { enabled: true, url: 'http://127.0.0.1:8791', namespace: 'qq' },
  },
});
try {
  const pmDir = path.join(pmHarness.temp, 'dsh', 'surfcore', 'memory');
  fs.mkdirSync(pmDir, { recursive: true });
  fs.writeFileSync(path.join(pmDir, 'pmemory-prompt-qq.md'), '\u3010\u957f\u671f\u8bb0\u5fc6\u3011\u4e3b\u4eba\u5728\u5199\u836f\u5b66\u4f5c\u4e1a\n');
  assert.match(pmHarness.pmemoryPromptBlock(), /\u836f\u5b66\u4f5c\u4e1a/, '桥接没有读到长记忆注入块');
  assert.match(pmHarness.currentRoleHint(), /\u836f\u5b66\u4f5c\u4e1a/, 'v1/chat 角色提示没有拼上长记忆块');
  fs.writeFileSync(path.join(pmDir, 'pmemory-prompt-qq.md'), '');
  assert.equal(pmHarness.pmemoryPromptBlock(), '', '长记忆注入文件清空后不该还留着旧块');
} finally {
  await pmHarness.close();
}

console.log('memory-card wiring: OK');
