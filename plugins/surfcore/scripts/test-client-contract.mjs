/**
 * 设置页契约（不启浏览器）：
 *   · 加载 client.js 的 factory，检查 B站页确实暴露了「额度」「四类动态」字段；
 *   · 检查 QQ 分享段的字段指向 biliBridge.share / biliBridge.dynamics；
 *   · 检查自动化快照接口被调用。
 *
 * 运行：node scripts/test-client-contract.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const idle = () => {};
const React = {
  createElement: () => null,
  useCallback: (fn) => fn,
  useEffect: idle,
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (value) => [typeof value === 'function' ? value() : value, idle],
};

let client = null;
globalThis.window = {
  __ModuleLoader__: {
    load({ factory }) {
      const module = { exports: {} };
      client = factory((name) => (name === 'react' ? React : {}));
    },
  },
};

await import('../lib/client.js');
assert.ok(client, 'client.js 没有被 ModuleLoader 加载');
assert.ok(Array.isArray(client.BILI_FIELDS), 'BILI_FIELDS 没有导出');
assert.ok(Array.isArray(client.QQ_BILI_SHARE_FIELDS), 'QQ_BILI_SHARE_FIELDS 没有导出');

const biliPaths = client.BILI_FIELDS.flatMap((group) => group.fields.map((field) => field.path.join('.')));
for (const wanted of [
  'limits.daily',
  'limits.replyDaily',
  'limits.taDaily',
  'limits.mineDaily',
  'limits.minePerPerson',
  'limits.globalMin',
  'limits.perUpMin',
  'limits.perVideoMin',
  'limits.perThreadMin',
  'dynamics.enabled',
  'dynamics.gapMin',
  'dynamics.kinds.best.enabled',
  'dynamics.kinds.best.slot',
  'dynamics.kinds.best.minLen',
  'dynamics.kinds.best.maxLen',
  'dynamics.kinds.best.prefix',
  'dynamics.kinds.gaming.slot',
]) {
  assert.ok(biliPaths.includes(wanted), `B站页缺少可编辑字段：${wanted}`);
}

const sharePaths = client.QQ_BILI_SHARE_FIELDS.map((field) => field.path.join('.'));
for (const wanted of [
  'biliBridge.enabled',
  'biliBridge.share.enabled',
  'biliBridge.share.times',
  'biliBridge.share.groups',
  'biliBridge.share.gapMs',
  'biliBridge.share.cardMode',
  'biliBridge.dynamics.enabled',
  'biliBridge.dynamics.pollIntervalMs',
  'biliBridge.dynamics.groups',
]) {
  assert.ok(sharePaths.includes(wanted), `QQ 分享段缺少字段：${wanted}`);
}

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8');
assert.ok(source.includes('"/bili/automation"'), '设置页没有调用 /bili/automation');
assert.ok(source.includes('AutomationCard'), '设置页没有今天用量卡片');
assert.ok(source.includes('QqShareSection'), '设置页没有 QQ 分享段');
// PITFALLS #21：QQ 分享段以前藏在 B站 页最底部、还是折叠的，用户找不到。
assert.ok(source.includes('定时分享视频到群'), 'QQ 分享段标题必须写人话（含「定时分享视频到群」）');
assert.ok(source.includes('"/bili/share-now"'), '缺少「立即分享一次」接口调用');
assert.ok(source.includes('goTab'), 'QQ 页缺少跳转到 B站 页的入口');
const cardModeField = client.QQ_BILI_SHARE_FIELDS.find((f) => f.path.join('.') === 'biliBridge.share.cardMode');
assert.equal(cardModeField?.kind, 'select', '分享形式必须是下拉，不是布尔开关');
assert.deepEqual((cardModeField.options ?? []).map(([v]) => v), ['text', 'miniapp', 'off']);

// QQ 白名单必须在设置页有一张常驻卡片（PITFALLS #27：以前只藏在折叠的「白名单与权限」组里）。
assert.ok(source.includes('WhitelistCard'), 'QQ 页缺少白名单卡片');
assert.ok(source.includes('QQ 白名单（群 / 人）'), '白名单卡片标题必须写人话');
assert.ok(source.includes('allow.groups') && source.includes('allow.private'), '白名单卡片没有绑定 allow.groups / allow.private');
assert.ok(source.includes('把管理员加进去'), '缺少「管理员不在私聊白名单」的修复入口');
// QQ 黑名单（2026-10-23 用户要求：白名单底下加黑名单，无论什么群都不响应黑名单里的人）。
assert.ok(source.includes('BlacklistCard'), 'QQ 页缺少黑名单卡片');
assert.ok(source.includes('QQ 黑名单（人 / 群 / 私聊）'), '黑名单卡片标题必须写人话');
assert.ok(source.includes('deny.users'), '黑名单卡片没有绑定 deny.users（人的黑名单）');
assert.ok(source.includes('把管理员移出黑名单'), '缺少「管理员在黑名单里」的修复入口');
// 2026-10-23 实测踩坑：把要「彻底拉黑」的人填进了私聊黑名单，群里却还在回。
// 卡片必须把「仅拦私聊」说清楚，并给一键迁移到「拉黑的人」。
assert.ok(source.includes('仅拦私聊'), '私聊黑名单没有标明「只在私聊里生效」');
assert.ok(source.includes('加到「拉黑的人」'), '缺少「只填在私聊黑名单」的一键迁移按钮');
const qqPaths = client.QQ_FIELDS.flatMap((group) => group.fields.map((field) => field.path.join('.')));
for (const dup of ['deny.private', 'deny.groups', 'deny.users']) {
  assert.ok(!qqPaths.includes(dup), `黑名单应只在卡片里编辑（${dup} 不能被高级参数重复一份）`);
}
assert.ok(source.includes('h(BlacklistCard'), 'QQ 页没有渲染黑名单卡片');
assert.ok(source.includes('onDenyChange: (key, list) => set(["deny", key], list)'), '黑名单卡片没有接线到 deny.*');
for (const key of ['users', 'groups', 'private']) {
  assert.ok(source.includes(`setList("${key}")`), `黑名单卡片缺少 ${key} 的输入框`);
  assert.ok(source.includes(`deny.${key}`), `黑名单卡片的标题/提示里没有写出 deny.${key}`);
}
assert.ok(!qqPaths.includes('allow.groups') && !qqPaths.includes('allow.private'), '白名单应只在卡片里编辑，避免两处输入框');

// 目的机制（2026-10-24 用户要求：定期、稳定地主动找主人，分享🧀或索取）。
// 2026-10-25 用户要求：独立成「目的」栏位，载体可选桌宠 / QQ（未安装桌宠默认 QQ）。
assert.ok(source.includes('function PurposeCard'), '缺少「主动找主人 · 目的机制」卡片');
assert.ok(source.includes('主动找主人 · 目的机制'), '目的机制卡片标题必须写人话');
assert.ok(source.includes('function PurposeTab'), '缺少独立的「目的」页组件');
assert.ok(source.includes('function PurposeCarrierCard'), '缺少目的载体（桌宠 / QQ）卡片');
assert.ok(source.includes('["purpose", "目的"]'), '设置页缺少「目的」标签');
assert.ok(source.includes('桌宠气泡 / 语音') && source.includes('QQ 私聊（默认）'), '载体卡片缺少桌宠 / QQ 两个选项');
assert.ok(source.includes('桌宠主动搭话形式'), '载体卡片缺少桌宠主动搭话形式（文本 / 语音）');
assert.ok(source.includes('"purpose", "carrier"'), '载体选择没有写入 purpose.carrier');
assert.ok(source.includes('"purpose", "petModality"'), '主动搭话形式没有写入 purpose.petModality');
assert.ok(source.includes('"purpose", "petFallbackToQQ"'), '缺少「桌宠没开着时回落 QQ」开关');
assert.ok(source.includes('h(PurposeCarrierCard') && source.includes('h(PurposeCard, { cfg: qq'), '「目的」页没有渲染载体 / 目的卡片');
assert.ok(!source.includes('h(PurposeCard, { cfg, set, busy, setBusy, toast })'), 'QQ 页不应再重复渲染目的机制卡片（同一份设置只留一处）');
const purposeCardSource = source.slice(source.indexOf('function PurposeCard'), source.indexOf('// ── 目的机制 · 载体选择'));
for (const key of ['enabled', 'gapMinMs', 'gapMaxMs', 'initialDelayMinMs', 'dailyMax', 'quietStart', 'quietEnd', 'idleThresholdMs', 'materialWindowHours', 'biliWindowDays', 'maxMaterials', 'minMaterials', 'maxCandidates', 'retryMs', 'maxAttempts', 'promptMaxChars', 'ownerUin']) {
  assert.ok(purposeCardSource.includes(`"${key}"`), `目的机制卡片缺少 ${key} 的编辑入口`);
}
for (const endpoint of ['"/purpose/status"', '"/purpose/preview"', '"/purpose/run"']) {
  assert.ok(source.includes(endpoint), `设置页没有调用 ${endpoint}`);
}
assert.ok(source.includes('function PetChatTestCard'), '目的页缺少桌宠对话测试卡');
assert.ok(source.includes('"/pet/chat-test"'), '桌宠对话测试没有调用 /pet/chat-test');
assert.ok(source.includes('function PetTab'), '设置页缺少桌宠页');
assert.ok(source.includes('专注模式（不主动打扰）'), '桌宠页/菜单缺少专注模式');
assert.ok(source.includes('"/pet/focus"'), '设置页没有调用 /pet/focus');
assert.ok(source.includes('启用桌宠对话'), '桌宠页缺少「启用桌宠对话」');
assert.ok(source.includes('把桌宠对话写进记忆卡'), '桌宠页缺少「写进记忆卡」开关');
assert.ok(source.includes('文本回复上限') && source.includes('语音回复上限'), '桌宠页缺少回复字数控');
assert.ok(source.includes('思考强度'), '桌宠页缺少思考强度设置');
const pluginIndexSource = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'index.js'), 'utf8');
assert.ok(pluginIndexSource.includes("pathname.startsWith(`${API_PREFIX}/purpose`)"), '插件缺少 /purpose 路由');
assert.ok(pluginIndexSource.includes('createPetApiService') && pluginIndexSource.includes('path: petApi.prefix'), '插件没有注册桌宠专用 pet-api');
assert.ok(pluginIndexSource.includes('petChat.emit({'), '设置页测试消息没有推给桌宠气泡');
assert.ok(pluginIndexSource.includes('createPetChatService') && pluginIndexSource.includes('createPetPurposeService'), '插件没有装配桌宠对话 / 目的服务');
assert.ok(pluginIndexSource.includes("suffix === '/focus'") && pluginIndexSource.includes('petChat.setFocus'), '插件缺少专注模式接口');
const bridgeSource = fs.readFileSync(path.join(import.meta.dirname, '..', '..', '..', 'src', 'bridge.js'), 'utf8');
assert.ok(bridgeSource.includes('petFocusEnabled') && bridgeSource.includes('PET_FOCUS_FILE'), '桥接没有读桌宠专注模式（QQ 载体也要停）');
// 旧桥接代理动作保留（控制台/旧链接仍可用）。
for (const action of ['purpose-status', 'purpose-preview', 'purpose-run']) {
  assert.ok(pluginIndexSource.includes(`action === '${action}'`), `插件代理缺少 ${action} 动作`);
}

// 平台启动开关（2026-10-24 用户要求：不是所有用户都想同时开 QQ / B站）：
//   · QQ / B站 页各一个「是否启动」开关，写合体层 platforms.start.{qq,bili}；
//   · 概览启动卡整合成「一键启动 SurfCore / 一键停止（全部）」：
//     多选 QQ（含 SnowLuma）/ B站 / 桌宠 / 语音；语音有本地/云端分支；
//   · 人格卡不再在概览重复显示（统一到「角色」页，和角色包在一起）。
assert.ok(source.includes('function PlatformStartCard'), '缺少平台启动开关卡片');
assert.ok(source.includes('"platforms", "start", "qq"'), 'QQ 启动开关没有绑定 platforms.start.qq');
assert.ok(source.includes('"platforms", "start", "bili"'), 'B站 启动开关没有绑定 platforms.start.bili');
assert.ok(source.includes('h(PlatformStartCard'), 'QQ / B站 页没有渲染启动开关卡片');
for (const label of ['一键启动 SurfCore', '一键停止（全部）', '语音分支']) {
  assert.ok(source.includes(label), `概览启动卡缺少：${label}`);
}
for (const action of ['start-selected', 'stop-selected']) {
  assert.ok(source.includes(`"${action}"`), `设置页没有调用 ${action}`);
  assert.ok(pluginIndexSource.includes(`action === '${action}'`), `插件代理缺少 ${action} 动作`);
}
assert.ok(source.includes('voiceBranch'), '语音缺少本地/云端分支选择');
assert.ok(source.includes('start-qq') || source.includes('start-selected'), '概览缺少启动入口');
assert.ok(!source.includes('一键启动（含 SnowLuma）'), '旧的一键启动按钮应被整合');
assert.ok(!source.includes('随 DSH 启动自动拉起 QQ 桥接'), '旧 bridge.autoStart 开关应迁到 QQ 页的「是否启动」');
assert.ok(source.includes('去 QQ 页改启动开关') && source.includes('去 B站 页改启动开关'), '概览缺少去平台页改开关的入口');
assert.ok(source.includes('人格卡在「角色」页维护'), '概览移除人格卡后缺少指路文案');

// 设置页 IA（2026-10-24 大清理）：人设/角色合并，关键设置常驻，其余进「高级设置」。
assert.ok(source.includes('function AdvancedSettings'), '缺少统一的「高级设置」折叠组件');
assert.ok(source.includes('function Section({ title, note, children, defaultOpen = false, collapsible = true })'), 'Section 必须支持 collapsible（高级设置里不再折叠套折叠）');
assert.ok(source.includes('function PersonaEditor'), '人格卡编辑器没有抽成内嵌组件');
assert.ok(source.includes('一页编辑') || source.includes('四层'), '人格卡编辑器缺少一页四层说明');
assert.ok(source.includes('保存全部'), '人格卡编辑器缺少保存全部入口');
assert.ok(source.includes('persona.daily.md') || source.includes('人格日常'), '人格卡编辑器缺少日常层');
assert.ok(source.includes('QQ 群聊') && source.includes('QQ 私聊'), '人格卡编辑器缺少 QQ 群聊/私聊场景');
assert.ok(source.includes('拆分不会写盘') || source.includes('不会自动覆盖'), '人格卡编辑器必须说明拆分不写盘/不自动覆盖');
assert.ok(source.includes('h(PersonaEditor'), '「角色」页没有渲染人格卡编辑器');
assert.ok(!source.includes('["persona", "人设"]'), '「人设」标签必须并入「角色」，不能留第二个入口');
assert.ok(!source.includes('function PersonaTab'), '旧的 PersonaTab 必须删掉，避免两套人格卡入口');
assert.ok(!source.includes('goTab?.("persona")'), '还有按钮跳去已删除的「人设」页');
for (const [marker, page] of [
  ['h(QqFishGuardStatusCard, { busy })', 'QQ'],
  ['h(FishGuardStatusCard, { busy, toast })', 'B站'],
  ['h(MemoryCardPanel, { view: "summary"', '记忆'],
  ['h(Section, { title: `候选人', '对齐'],
  ['h(Section, { title: "配置 JSON（高级）"', '扩展'],
  ['h(Section, { title: `备份', '诊断'],
]) {
  assert.ok(source.includes(marker), `${page}页的关键/高级组件缺失：${marker}`);
}
assert.ok(source.includes('view = "all"') && source.includes('view === "summary"') && source.includes('view === "details"'), '记忆卡没有拆成摘要/详情两态');
assert.ok(source.includes('h(MemoryCardPanel, { view: "details"'), '记忆页高级设置没有渲染记忆卡详情');
assert.ok(source.includes('collapsible: false'), '高级设置里的分组没有用 collapsible:false');

// 角色人格：设置页必须有「角色」页，能创建/加载/存档/回档。
assert.ok(source.includes('function CharactersTab'), '设置页缺少角色人格页');
assert.ok(source.includes('"角色"'), '设置页缺少「角色」标签');
assert.ok(source.includes('创建并加载'), '角色页缺少新建并加载入口');
assert.ok(source.includes('action: "load"') || source.includes('act("load"'), '角色页缺少加载角色动作');
assert.ok(source.includes('act("snapshot"'), '角色页缺少立即存档');
assert.ok(source.includes('act("restore"'), '角色页缺少回档');
assert.ok(source.includes('act("create"'), '角色页缺少创建动作');

// 观看历史 + 鱼群运行状态：用户明确要求「设置里能看到她看过什么 / 到底点没点赞」。
assert.ok(source.includes('function WatchTab'), '设置页缺少观看历史页');
assert.ok(source.includes('["watch", "观看历史"]'), '缺少「观看历史」标签');
assert.ok(source.includes('"/watch-history'), '观看历史页没有调用 /watch-history');
assert.ok(source.includes('"操作"'), '观看历史缺少「操作」列');
assert.ok(source.includes('仅看了'), '观看历史缺少「仅看了」状态');
const watchActionsSource = fs.readFileSync(path.join(import.meta.dirname, '..', 'tools', 'lib', 'watch-actions.mjs'), 'utf8');
assert.ok(watchActionsSource.includes('鱼群保护·聚拢回复'), '观看历史缺少鱼群聚拢标记');
assert.ok(source.includes('function FishGuardStatusCard'), 'B站页缺少鱼群保护运行状态卡');
assert.ok(source.includes('"/bili/fish-guard"'), '鱼群状态卡没有调用 /bili/fish-guard');
assert.ok(source.includes('上次点赞'), '鱼群状态卡没有显示上次点赞结果');
assert.ok(source.includes('最近鱼群检查'), 'B站状态卡没有显示鱼群检查记录');
assert.ok(source.includes('点赞历史'), 'B站状态卡没有显示点赞历史');
assert.ok(source.includes('likeHistory'), 'B站状态卡没有接 likeHistory');
assert.ok(source.includes('鱼群判定关键词（B站）'), 'B站页没有独立的鱼群判定关键词组');
assert.ok(source.includes('鱼群判定关键词（QQ）'), 'QQ页没有独立的鱼群判定关键词组');
assert.ok(source.includes('function ListInput'), '缺少允许输入逗号的 ListInput（旧实现会吞逗号）');
const biliFishPaths = client.BILI_FIELDS.filter((g) => g.group.includes('鱼群')).flatMap((g) => g.fields.map((f) => f.path.join('.')));
for (const wanted of ['fishGuard.namePrefixes', 'fishGuard.nameContains', 'fishGuard.nameSuffixes', 'fishGuard.extraFishMids', 'fishGuard.likeGapMinMs', 'fishGuard.failedLikeCooldownHours', 'fishGuard.forceGather']) {
  assert.ok(biliFishPaths.includes(wanted), `B站鱼群保护缺少字段：${wanted}`);
}
const qqFishPaths = client.QQ_FIELDS.filter((g) => g.group.includes('鱼群')).flatMap((g) => g.fields.map((f) => f.path.join('.')));
for (const wanted of ['fishGuard.namePrefixes', 'fishGuard.nameContains', 'fishGuard.nameSuffixes', 'fishGuard.groupNameSuffixes']) {
  assert.ok(qqFishPaths.includes(wanted), `QQ鱼群保护缺少字段：${wanted}`);
}
// 上线补历史消息（2026-10-24 用户要求：设置里可关，默认勾选打开）。
const qqHistoryPaths = client.QQ_FIELDS.filter((g) => g.group.includes('上线补历史')).flatMap((g) => g.fields.map((f) => f.path.join('.')));
for (const wanted of ['socialV2.history.enabled', 'socialV2.history.limit', 'socialV2.history.maxAgeMinutes', 'socialV2.history.wake', 'socialV2.history.includePrivate']) {
  assert.ok(qqHistoryPaths.includes(wanted), `QQ 上线补历史缺少字段：${wanted}`);
}
assert.ok(client.QQ_FIELDS.find((g) => g.group.includes('上线补历史'))?.note.includes('默认开'), '上线补历史必须标明默认开启');
// 对话收尾判断（2026-10-24 用户要求：发完最后一句可判断这段是否结束，不必每句都回）。
const qqClosurePaths = client.QQ_FIELDS.filter((g) => g.group.includes('对话收尾')).flatMap((g) => g.fields.map((f) => f.path.join('.')));
for (const wanted of [
  'socialV2.closure.enabled', 'socialV2.closure.cooldownMs',
  'socialV2.closure.requireNoOpenQuestion', 'socialV2.closure.promptInWake',
  'socialV2.closure.maxSummaryChars', 'socialV2.closure.maxNextOpeningChars',
]) {
  assert.ok(qqClosurePaths.includes(wanted), `QQ 对话收尾缺少字段：${wanted}`);
}
assert.ok(client.QQ_FIELDS.find((g) => g.group.includes('对话收尾'))?.note.includes('不是潜水'), '对话收尾必须向用户说明「不是潜水」');
assert.ok(source.includes('closeConversation: "对话收尾"'), '工具开关缺少「对话收尾」标签');
assert.ok(source.includes('function ClosureCard'), '设置页缺少对话收尾卡片组件');
assert.ok(source.includes('h(ClosureCard, { cfg, set, overview, busy, reload })'), 'QQ 页没有渲染对话收尾卡片');
assert.ok(source.includes('收尾会留下结束点和下次的接法'), '对话收尾卡片缺少 mark_read/潜水的边界说明');
const qqTokenPaths = client.QQ_FIELDS.find((g) => g.group === 'Token 防爆破')?.fields.map((f) => f.path.join('.')) ?? [];
for (const wanted of ['socialV2.tokenGuard.enabled', 'socialV2.tokenGuard.maxWakesPerDay', 'socialV2.tokenGuard.privateMaxWakesPerDay', 'socialV2.tokenGuard.minWakeGapMs', 'socialV2.tokenGuard.directBypassGap', 'socialV2.tokenGuard.maxOutboundPerTurn']) {
  assert.ok(qqTokenPaths.includes(wanted), `QQ Token 防爆破缺少字段：${wanted}`);
}
// 2026-10-23：花费上限从 QQ 页迁到「Token 额度」页（按自然日，QQ/B站/总额分开管），
// 旧字段不能再在 QQ 页出现第二个入口（PITFALLS #27：同一份数据只留一处可改）。
assert.ok(!qqTokenPaths.includes('socialV2.tokenGuard.maxDailyCostCNY'), 'QQ 页不应再有旧的近 24h 花费上限字段');
assert.ok(client.QQ_FIELDS.find((g) => g.group === 'Token 防爆破')?.note.includes('Token 额度'), 'Token 防爆破组没有指向新的额度页');
assert.ok(source.includes('function TokenTab'), '设置页缺少 Token 额度页组件');
assert.ok(source.includes('["tokens", "Token 额度"]'), '设置页缺少 Token 额度标签');
assert.ok(source.includes('function LimitField') && source.includes('function BudgetScopeCard'), 'Token 额度页缺少额度输入/卡片组件');
assert.ok(source.includes('+1元') || source.includes('+${amount}'), 'Token 额度页缺少快捷加额度按钮');
assert.ok(source.includes('80% 弹窗每天只弹第一次'), 'Token 额度页没有说明每天只提醒一次');
assert.ok(source.includes('今天唯一一次'), '80% 弹窗没有说明每天只提醒一次');
assert.ok(source.includes('只留总额度'), '总额度缺少一键设置');
assert.ok(!source.includes('onReplace'), 'Token 总额度按钮引用了未定义/已删除的 onReplace');
assert.ok(source.includes('/token-budget'), '设置页没有接 /token-budget 接口');

// QQ 鱼群触发记录 + B站 会话权限（2026-10-23 用户要求“都做”）。
assert.ok(source.includes('function QqFishGuardStatusCard'), 'QQ 页缺少鱼群触发记录卡');
assert.ok(source.includes('"/fish-guard/qq"'), 'QQ 鱼群卡没有调用 /fish-guard/qq');
assert.ok(source.includes('最近触发'), 'QQ 鱼群卡标题没有写人话');
const biliAgentField = client.BILI_FIELDS.flatMap((g) => g.fields).find((f) => f.path.join('.') === 'agent.sandbox');
assert.ok(biliAgentField, 'B站页缺少 agent.sandbox 会话权限设置');
assert.equal(biliAgentField.kind, 'select');
assert.deepEqual((biliAgentField.options ?? []).map(([v]) => v), ['danger-full-access', 'workspace-write']);

// 2026-10-23 用户定：每日分享默认发自己的动态（视频卡片），下拉第一项必须是 dynamic。
const shareViaField = client.BILI_FIELDS.flatMap((g) => g.fields).find((f) => f.path.join('.') === 'share.via');
assert.ok(shareViaField, 'B站页缺少 share.via');
assert.equal(shareViaField.kind, 'select');
assert.equal(shareViaField.options?.[0]?.[0], 'dynamic', 'share.via 默认项必须是 dynamic');
assert.ok(source.includes('night.minGapMin'), '作息页缺少 night.minGapMin');
assert.ok(source.includes('每窗至少 1'), '作息页提示没有写清 C 的每窗至少 1');
assert.ok(source.includes('容量警告字数') && source.includes('warnChars'), '记忆卡缺少无上限的警告字数设置');
assert.ok(source.includes('被 @/叫到时越过间隔'), 'Token 防爆破缺少 @ 越过间隔开关');
assert.ok(source.includes('chat.presence.onlineShare'), '设置页缺少 chat 在线占比');

// 2026-10-23 用户要求：每个偏好能调权重；新用户能「一键抓取」关键词。
assert.ok(source.includes('function TasteEditor'), 'B站页缺少口味权重编辑器');
assert.ok(source.includes('/preferences/scan?'), '口味编辑器没有调用 /preferences/scan');
assert.ok(source.includes('一键抓取我的偏好'), '缺少「一键抓取」按钮');
assert.ok(source.includes('抓取账号'), '抓取结果没有显示「抓的是哪个账号」');
assert.ok(source.includes('不读浏览器登录的账号'), '抓取说明没有写清不读浏览器账号');
assert.ok(source.includes('function BiliQrModal'), '缺少扫码登录弹窗');
assert.ok(source.includes('"/bili/qr/start"'), '扫码弹窗没有调用 /bili/qr/start');
assert.ok(source.includes('/bili/qr/poll'), '扫码弹窗没有轮询 /bili/qr/poll');
assert.ok(source.includes('扫码登录小肥鱼'), 'B站 凭据卡缺少「扫码登录小肥鱼」');
assert.ok(source.includes('扫码登录主人的 B站 账号'), '主人扫码弹窗标题缺失');
assert.ok(source.includes('抓取主人'), '抓取目标缺少「抓取主人」');
assert.ok(source.includes('["preferences", "weights"]'), '口味权重没有落到 preferences.weights');
assert.ok(source.includes('权重 0 = 停用'), '口味权重缺少 0=停用 的说明');
const tasteGroup = client.BILI_FIELDS.find((g) => g.group.includes('口味'));
assert.ok(tasteGroup, 'B站参数里缺少口味分组');
assert.ok(tasteGroup.fields.some((f) => f.path.join('.') === 'preferences.like'), '口味分组缺少 preferences.like');

// ── 跨平台互认 + 微博下线（2026-10-23）────────────────────────────────────────
// B站 侧唤醒必须先注入「自己是谁」：QQ 昵称/号（桥接落盘）+ B站 昵称/UID。
// 没有它，别人递来她的 QQ 主页截图，她只会当陌生人（PITFALLS #40）。
const schedulerSource = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'scheduler.js'), 'utf8');
assert.ok(schedulerSource.includes("from '../../../src/self-identity.js'"), 'B站 侧没有引用统一自我卡模块');
assert.ok(schedulerSource.includes('selfIdentityBlockForBili'), 'B站 唤醒缺少自我锚点块');
assert.ok(schedulerSource.includes('readQqSelfIdentity'), 'B站 侧没有读桥接落的 QQ 自我身份');
assert.ok(/identityContextLines[\s\S]{0,400}selfIdentityBlockForBili/.test(schedulerSource), '自我锚点没有接进每轮唤醒的上下文');
// 微博明确不做：注册表里不能再有占位，设置页也不能再提。
const platformsSource = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'platforms.js'), 'utf8');
assert.ok(!/weibo/.test(platformsSource), 'platforms.js 里还留着 weibo 占位');
assert.ok(!/微博/.test(source), '设置页还在提微博（用户明确不做）');

// 2026-10-23 用户要求：设置页「早安」处要写明「小肥鱼需要与问候对象互为 QQ 好友」。
// QQ 对陌生人/单向好友的私聊会直接拒绝（result=16），不写清楚就会重演「到点没收到」。
assert.ok(source.includes('互为 QQ 好友'), '早安卡片没有写明「必须互为 QQ 好友」');
assert.ok(source.includes('result=16'), '早安卡片没有说明非好友私聊会被 QQ 拒绝（result=16）');

// ── 设置页“非只读项必须能改”回归（2026-10-24）──────────────────────────────
// 用户反馈：B站 作息窗口加不了/删不了、输入框打字弹回；同一类问题以前也反复出现。
// 根因是 setPath 收到字符串路径后按字符遍历，生成 n.i.g.h.t... 垃圾键：
// 界面看似改了，但读的仍是旧值，下次渲染立刻弹回。这里从三个层面钉住。
assert.ok(client.__test?.setPath, 'client 没有导出 setPath 测试钩子');
{
  const target = {};
  client.__test.setPath(target, 'night.windows', [{ start: '20:00', end: '22:00', wakes: 1 }]);
  assert.deepEqual(target, { night: { windows: [{ start: '20:00', end: '22:00', wakes: 1 }] } },
    '字符串路径必须按点号展开，不能按字符拆成 n.i.g.h.t');
  const target2 = {};
  client.__test.setPath(target2, ['socialV2', 'closure', 'enabled'], false);
  assert.deepEqual(target2, { socialV2: { closure: { enabled: false } } }, '数组路径仍必须正常工作');
  const target3 = {};
  client.__test.setPath(target3, '', 1);
  assert.deepEqual(target3, {}, '空路径不能写入垃圾键');
}
assert.ok(source.includes('set(["night", "windows"], v)'), '作息窗口没有用数组路径绑定 night.windows');
assert.ok(!source.includes('set("night.windows"'), '作息窗口还在传字符串路径（会退化成字符级嵌套）');
assert.ok(source.includes('onAllowAllChange: (value) => set(["allowAllWhenEmpty"], value)'), '「白名单为空时全部放行」没有用数组路径绑定');
assert.ok(!source.includes('set("allowAllWhenEmpty"'), '「白名单为空时全部放行」还在传字符串路径');
// 记忆页 B站→QQ 开关：checked 必须读可编辑草稿，不能读服务端快照 qq.biliBridge。
assert.ok(source.includes('const biliToQqDraft ='), '记忆页 B站→QQ 开关缺少可编辑草稿');
assert.ok(source.includes('checked: biliToQqDraft'), '记忆页 B站→QQ 开关没有绑定可编辑草稿（点了会弹回）');
// 「只同步这些群」必须用允许逗号的列表编辑器，不能每次按键 split/join（PITFALLS #49）。
assert.ok(/只同步这些群[\s\S]{0,400}h\(IdListEditor/.test(source), '「只同步这些群」没有使用 IdListEditor');
assert.ok(!source.includes('(qqToBili.includeGroups ?? []).join("，")'), '「只同步这些群」还在用 split/join 绑输入框（逗号会被吞）');
assert.ok(source.includes('onChange: (list) => setQqToBili("includeGroups", list)'), '「只同步这些群」没有接线到 includeGroups');

// ── 通知函数接线（2026-10-30 用户反馈：语音页保存后红字 "toast is not a function"）──
// 根因：Settings 里 toast 是"浮层文案字符串"，真正的函数叫 notify；
// VoiceTab 那一处只传了 { toast }，字符串被当函数调用 → 保存成功却显示失败。
assert.ok(source.includes('h(VoiceTab, { toast: notify })'), 'VoiceTab 必须收到 notify 函数（不是字符串 toast）');
assert.ok(!/h\(VoiceTab, \{ toast \}\)/.test(source), 'VoiceTab 不能收裸 toast（字符串）');
{
  // 通用：所有 Tab 的 props 里出现 toast 的，都必须是 toast: notify
  const tabs = [...source.matchAll(/h\((\w+Tab), \{([^}]*)\}/g)];
  const bad = tabs.filter(([, , props]) => /(^|[,{]\s*)toast\s*[,}]/.test(props));
  assert.equal(bad.length, 0, `有 Tab 把字符串 toast 当函数传：${bad.map((m) => m[1]).join(', ')}`);
}
assert.ok(source.includes('const [toastText, setToastText]'), '浮层文案状态应叫 toastText（避免与 notify 混淆）');
assert.ok(source.includes('if (tab === "voice") return h(VoiceTab, { toast: notify });'), '语音页接线固定为 toast: notify');

// ── 语音页网盘离线包入口（2026-10-30 用户要求：网络不稳时可走网盘）──
assert.ok(source.includes('https://pan.quark.cn/s/ec6cf2b123de?pwd=sxUZ'), '语音页必须包含网盘链接');
assert.ok(source.includes('网络不稳定装不上？用网盘下载离线包（本地包 / 云端包都适用）'), '必须说明本地包/云端包都适用');
assert.ok(source.includes('打开网盘下载（提取码 sxUZ）'), '必须有「打开网盘下载」按钮');
assert.ok(source.includes('复制链接'), '必须有复制链接兜底');
assert.ok(source.includes('api("/voice/packs/netdisk"'), '按钮必须走后端打开（Electron 会拦新窗口）');

// ── 桌宠安装：表单必须随请求提交（2026-10-30 用户反馈：填了也不生效）──
assert.ok(/api\("\/pet\/install",[\s\S]{0,200}source: form\.source\.trim\(\)/.test(source), '桌宠安装请求必须带 source');
assert.ok(/api\("\/pet\/install",[\s\S]{0,260}appDir: form\.appDir\.trim\(\)/.test(source), '桌宠安装请求必须带 appDir');
assert.ok(/act\("start", \{ electronPath: form\.electronPath\.trim\(\) \}\)/.test(source), '桌宠启动请求必须带 electronPath');

// ── 手动导入 SnowLuma（2026-10-30 用户要求：检测按钮旁加手动选择 + 说明导入的是什么）──
assert.ok(source.includes('手动选择已安装的 SnowLuma'), '必须提供「手动选择已安装的 SnowLuma」按钮');
assert.ok(/setSnowImport\(true\)/.test(source), '按钮要打开说明弹窗（不是直接开选择框）');
assert.ok(source.includes('导入 SnowLuma 的安装位置'), '说明弹窗标题存在');
assert.ok(source.includes('SnowLuma.exe —— SnowLuma2 目录里的主程序'), '弹窗必须说清要选什么文件');
assert.ok(source.includes('不会下载、不会安装、不会移动或删除任何文件'), '弹窗必须说明不会改动文件');
assert.ok(/browseNative\("file",[^)]*"snowluma"\)/.test(source), '文件选择必须用 snowluma 过滤器');
assert.ok(!/browseNative\("file",[^)]*filter:/.test(source), '不得把原始 filter 串传给宿主');



// ── 更新后必须提示重启 DSH（2026-10-30 用户要求）──
assert.ok(source.includes('restartHint'), '必须有重启提示状态');
assert.ok(source.includes('更新已下载：重启 DSH 后生效'), '下载完成后要提示重启');
assert.ok(source.includes('有可用更新：安装后需要重启 DSH'), '检查到更新后要提示安装需重启');
assert.ok(source.includes('完全退出 DSH'), '提示要说明“完全退出”而不是刷新页面');
assert.ok(/setRestartHint\(\{ staged: true/.test(source), '暂存成功后设置重启提示');
assert.ok(source.includes('下载完成 ≠ 已更新'), '更新卡片要有常驻提示');

// ── B站 登录核查 + 管理员 UID 核查 + 长 UID（2026-10-30 用户要求）──
assert.ok(source.includes('B站 登录账号'), 'B站 页要有登录账号卡片');
assert.ok(source.includes('核查登录'), '登录账号卡片要有「核查登录」');
assert.ok(/api\("\/bili\/account\/verify"/.test(source), '核查登录要调后端');
assert.ok(source.includes('✅ 登录成功'), '扫码成功后弹窗要显示成功账号');
assert.ok(source.includes('核查 UID 与昵称'), '管理员卡片要有 UID/昵称核查');
assert.ok(/api\("\/bili\/verify-user"/.test(source), 'UID 核查要调后端');
assert.ok(source.includes('4~20 位数字'), 'UID 输入要提示位数范围');
assert.ok(source.includes('用 B站 昵称填上'), '昵称不一致要能一键填上');



// ── 断线告警不再“明明连着还弹”（2026-10-31）──
assert.ok(source.includes('snowluma:send-channel-down'), '前端应识别断线告警的 dedupeKey');
assert.ok(source.includes('const stale = events.filter'), '连着时应过滤旧断线告警');
assert.ok(source.includes('body: { ids: stale.map'), '应自动确认旧断线告警');
assert.ok(source.includes('gateOverviewRef'), '用 overview 判断当前连接状态');
assert.ok(source.includes('if (!gateOverviewRef.current) return;'), '概览未就绪时不弹，避免误弹');



// ── L3 弹窗要能看出是哪个工具/哪个会话（2026-10-31）──
assert.ok(source.includes('event.evidence?.tool'), '安全提醒要显示工具名');
assert.ok(source.includes('event.evidence?.fingerprint'), '安全提醒要显示错误摘要');
assert.ok(source.includes('event.subject?.key'), '安全提醒要显示会话');

// ── 更新下载进度：速度 + 百分比（2026-10-31 用户要求）──
assert.ok(source.includes('st?.download'), '应用更新时要轮询下载进度');
assert.ok(source.includes('下载中'), '进度条应显示“下载中”');
assert.ok(source.includes('speedBps'), '进度条应显示网速');
assert.ok(source.includes('dl.percent'), '进度条应显示百分比');

// ── 更新弹窗不能每次打开设置页都自动弹（2026-10-31 用户反馈）──
assert.ok(source.includes('surfcore.updatePromptSeen'), '要记住“这个版本已提醒过”');
assert.ok(source.includes('if (seen === sig) return'), '同一批版本不再自动弹');
assert.ok(source.includes('updatePromptSignature'), '按版本集合生成提醒签名');

// ── SnowLuma 没启动时，不该弹“断线”L2（2026-10-31 用户反馈）──
assert.ok(source.includes('neverStarted'), '未启动（everConnected=false）也要过滤旧断线告警');
assert.ok(source.includes('sl.everConnected === false'), '按 everConnected 判断“从未启动”');

// ── DSH 注册修复入口（2026-11-01）──
assert.ok(source.includes("/dsh/repair"), "设置页要有修复 DSH 注册的入口");
assert.ok(source.includes("修复 DSH 注册"), "按钮文案要能看懂");
assert.ok(source.includes("canRepairDsh"), "L2 弹窗遇到 dsh-profile-mcp-missing 要给修复按钮");
// ── 更新通道单选（2026-11-01）──
assert.ok(source.includes("update-channel"), "检查更新下面要有 main/dev 单选");
assert.ok(source.includes("main（正式版") && source.includes("dev（测试版"), "两个通道文案");
assert.ok(source.includes("switchUpdateChannel"), "切通道要调 set-channel");
// ── 保存按钮/提示（2026-11-02）──
assert.ok(source.includes("保存并生效"), "主保存按钮必须明确“保存并生效”");
assert.ok(source.includes("仅保存（不重启）"), "必须保留明确的“仅保存”次按钮");
assert.ok(source.includes('className: "qbw-toast"'), "保存成功提示必须是固定 toast");
assert.ok(source.includes("qbw-settings-foot"), "弹窗保存按钮必须在固定底栏");
assert.ok(source.includes("onSaveReady"), "群管理保存要交给弹窗底栏");
assert.ok(source.includes("保存管理员并重启桥接"), "管理员卡片要有局部保存按钮");
// ── 模型与思考强度（2026-11-02）──
assert.ok(source.includes("function ModelSettingsCard"), "设置页要有模型/思考强度卡");
assert.ok(source.includes("dshModelSelect"), "模型必须是目录驱动的下拉框");
assert.ok(source.includes("dshEffortSelect"), "思考强度必须是下拉框");
assert.ok(!source.includes("low / medium / high / max"), "不能再提示后端不支持的 medium");
assert.ok(source.includes("会同时修改 DSH 全局默认模型"), "模型切换必须提示全局副作用");
console.log('client contract tests OK');
