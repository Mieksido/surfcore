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
// 2026-11-03：B站 页与它的两张高级参数表（BILI_FIELDS / QQ_BILI_SHARE_FIELDS）已随
// B站下线一起物理删除。抖音页的分享参数改由下面的 douyinBridge 断言把关。

const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'lib', 'client.js'), 'utf8');
// 2026-11-03：B 站下线，「B站」页换成「抖音」页。刷视频由 dsh-douyin-agent 插件跑，
// 设置页这边只读它的状态，所以契约改成「读 /douyin/* + 不得再出现 BiliTab」。
assert.ok(source.includes('["douyin", "抖音"]'), '标签页里没有「抖音」');
assert.ok(source.includes('"/douyin/status"'), '抖音页没有读 /douyin/status');
assert.ok(source.includes('"/douyin/history'), '抖音页没有读观看历史');
assert.ok(source.includes('"/douyin/memory/refresh"'), '抖音页缺少「同步抖音记忆到 QQ」');
assert.ok(!source.includes('h(BiliTab'), 'B 站页应该已经下线，不该还挂着 BiliTab');
assert.ok(!source.includes('tab === "bili"'), 'B 站标签页的渲染分支应该已经删掉');

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
//   · 概览的启动卡只留三个动作：一键启动 / 启动QQ / 启动B站；
//   · 人格卡不再在概览重复显示（统一到「角色」页，和角色包在一起）。
assert.ok(source.includes('function PlatformStartCard'), '缺少平台启动开关卡片');
assert.ok(source.includes('"platforms", "start", "qq"'), 'QQ 启动开关没有绑定 platforms.start.qq');
assert.ok(source.includes('h(PlatformStartCard'), 'QQ 页没有渲染启动开关卡片');
// 2026-11-03：B 站下线后只剩 QQ 一个需要「启动」的平台；「启动B站」按钮必须消失，
// 但老书签/老脚本打 start-bili 时插件要明确回 410，不能假装成功。
assert.ok(!source.includes('"启动B站"'), '概览不该再有「启动B站」按钮');
assert.ok(!source.includes('act("start-bili")'), '设置页不该再调用 start-bili');
assert.ok(pluginIndexSource.includes("action === 'start-bili'"), '插件仍应保留 start-bili 分支（回 410 说明已下线）');
assert.ok(pluginIndexSource.includes("action === 'refresh-douyin'"), '插件缺少 refresh-douyin 动作');
for (const label of ['一键启动', '启动QQ']) {
  const ok = label === '一键启动'
    ? source.includes('一键启动')
    : (source.includes(`>${label}<`) || source.includes(`"${label}"`));
  assert.ok(ok, `概览启动卡缺少按钮：${label}`);
}
assert.ok(source.includes('act("start-qq")'), '设置页没有调用 start-qq');
assert.ok(pluginIndexSource.includes("action === 'start-qq'"), '插件代理缺少 start-qq 动作');
assert.ok(!source.includes('启动与人格卡'), '概览不应再出现「启动与人格卡」旧标题');
assert.ok(!source.includes('一键启动全部（含 SnowLuma）'), '旧的「一键启动全部」按钮应被替换成两个按钮');
assert.ok(!source.includes('随 DSH 启动自动拉起 QQ 桥接'), '旧 bridge.autoStart 开关应迁到 QQ 页的「是否启动」');
assert.ok(source.includes('去 QQ 页改启动开关'), '概览缺少去 QQ 页改开关的入口');
assert.ok(source.includes('人格卡在「角色」页维护'), '概览移除人格卡后缺少指路文案');

// 设置页 IA（2026-10-24 大清理）：人设/角色合并，关键设置常驻，其余进「高级设置」。
assert.ok(source.includes('function AdvancedSettings'), '缺少统一的「高级设置」折叠组件');
assert.ok(source.includes('function Section({ title, note, children, defaultOpen = false, collapsible = true })'), 'Section 必须支持 collapsible（高级设置里不再折叠套折叠）');
assert.ok(source.includes('function PersonaEditor'), '人格卡编辑器没有抽成内嵌组件');
assert.ok(source.includes('h(PersonaEditor'), '「角色」页没有渲染人格卡编辑器');
assert.ok(!source.includes('["persona", "人设"]'), '「人设」标签必须并入「角色」，不能留第二个入口');
assert.ok(!source.includes('function PersonaTab'), '旧的 PersonaTab 必须删掉，避免两套人格卡入口');
assert.ok(!source.includes('goTab?.("persona")'), '还有按钮跳去已删除的「人设」页');
for (const [marker, page] of [
  ['h(QqFishGuardStatusCard, { busy })', 'QQ'],
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

// 2026-11-03：B 站页 + 观看历史页一起下线，「最近看过」并入抖音页。
// 鱼群保护是 B 站评论区特有的（QQ 群成员那套在 QQ 页，没动），所以只保留 QQ 侧断言。
assert.ok(!source.includes('["watch", "观看历史"]'), '「观看历史」标签应该并入抖音页');
assert.ok(source.includes('最近看过'), '抖音页缺少「最近看过」区块');
assert.ok(source.includes('鱼群判定关键词（QQ）'), 'QQ页没有独立的鱼群判定关键词组');
assert.ok(source.includes('function ListInput'), '缺少允许输入逗号的 ListInput（旧实现会吞逗号）');
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
assert.ok(source.includes('容量警告字数') && source.includes('warnChars'), '记忆卡缺少无上限的警告字数设置');
assert.ok(source.includes('被 @/叫到时越过间隔'), 'Token 防爆破缺少 @ 越过间隔开关');
assert.ok(source.includes('chat.presence.onlineShare'), '设置页缺少 chat 在线占比');

// 2026-11-03：B 站扫码登录 / 口味抓取 / 鱼群保护这些「B 站专属」入口随页面一起下线。
// 抖音的心愿单与口味由插件自己维护（设置 → 刷抖音 → 人格与兴趣），这里不再提供第二套。
// 只断言「页面不再渲染」这些组件：它们的定义可能还留在文件里做冷备份，
// 但只要没有 h(...) 调用，用户就看不到、也点不到。
for (const gone of ['h(TasteEditor', 'h(WatchTab', 'h(FishGuardStatusCard', 'h(QqShareSection', 'h(AutomationCard']) {
  assert.ok(!source.includes(gone), `B 站专属入口应已下线：${gone}`);
}
assert.ok(source.includes('设置 → 刷抖音'), '抖音页必须指路到插件的设置入口');

// 分享到群（2026-11-03 第二步）：素材来自她刷过的作品，配置落在 qq 侧 douyinBridge.share。
// 注意路径前缀必须是 set([...]) 而不是 setUnified([...])：douyinBridge 属于 QQ 配置
// （readQqConfig），写到合体层的话桥接读不到，用户会看到「开了但从不发」。
assert.ok(source.includes('分享到群'), '抖音页缺少「分享到群」卡片');
assert.ok(source.includes('"/douyin/share-now"'), '抖音页缺少「立即分享一次」调用');
assert.ok(source.includes('立即分享一次'), '抖音页缺少「立即分享一次」按钮');
for (const path of ['"douyinBridge", "share", "enabled"', '"douyinBridge", "share", "times"', '"douyinBridge", "share", "groups"']) {
  assert.ok(source.includes(`set([${path}]`), `分享配置应写到 QQ 侧的 ${path}`);
  assert.ok(!source.includes(`setUnified([${path}]`), `分享配置不该写到合体层：${path}`);
}
assert.ok(source.includes('6 天内不重复'), '分享卡片应说明去重规则');

// ── 跨平台互认 + 微博下线（2026-10-23）────────────────────────────────────────
// B站 侧唤醒（scheduler.js）已整体删除；跨平台自我锚点现在只走桥接的 QQ 注入路径，
// 由下面的「自我锚点」断言直接盯 bridge.js。
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
// 作息窗口编辑器随 B 站页下线；数组路径的回归用例由上面的 __test.setPath 覆盖。
assert.ok(source.includes('onAllowAllChange: (value) => set(["allowAllWhenEmpty"], value)'), '「白名单为空时全部放行」没有用数组路径绑定');
assert.ok(!source.includes('set("allowAllWhenEmpty"'), '「白名单为空时全部放行」还在传字符串路径');
// 记忆页 抖音→QQ 开关：checked 必须读可编辑草稿，不能读服务端快照 qq.douyinBridge。
assert.ok(source.includes('const douyinToQqDraft ='), '记忆页 抖音→QQ 开关缺少可编辑草稿');
assert.ok(source.includes('checked: douyinToQqDraft'), '记忆页 抖音→QQ 开关没有绑定可编辑草稿（点了会弹回）');
// 草稿必须在保存前落到 QQ 配置的 douyinBridge.memory.enabled，否则桥接读不到。
assert.ok(source.includes('unified?.__douyinToQqToggle'), '保存时没有把草稿落回 douyinBridge.memory.enabled');
assert.ok(!source.includes('__biliToQqToggle'), 'B 站开关的旧草稿字段应已清除');
// 「只同步这些群」必须用允许逗号的列表编辑器，不能每次按键 split/join（PITFALLS #49）。
assert.ok(/只同步这些群[\s\S]{0,400}h\(IdListEditor/.test(source), '「只同步这些群」没有使用 IdListEditor');
assert.ok(!source.includes('(qqToDouyin.includeGroups ?? []).join("，")'), '「只同步这些群」还在用 split/join 绑输入框（逗号会被吞）');
assert.ok(source.includes('onChange: (list) => setQqToDouyin("includeGroups", list)'), '「只同步这些群」没有接线到 includeGroups');
// 记忆页/对齐页不能再出现 B 站口径（用户 2026-11-03 明确要求）。
assert.ok(!source.includes('QQ ⇄ B站'), '记忆页/对齐页还写着 QQ ⇄ B站');
assert.ok(source.includes('QQ ⇄ 抖音'), '记忆页/对齐页应显示 QQ ⇄ 抖音');

console.log('client contract tests OK');
