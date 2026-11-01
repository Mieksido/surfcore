/**
 * 管理员身份（QQ ⇄ B站 同一个人）与「温柔 / 不许回嘴」规则的单元测试。
 *
 * 覆盖：
 *   1. 号码规范化：非法值不能进配置；称呼回退 B站昵称；
 *   2. 合体层 admin 缺省时，从 QQ ownerQQ / B站 owner.mid 推导（升级不用重填）；
 *   3. 保存冲突：管理员卡片优先，高级参数单独改能回填；
 *   4. 提示词块：QQ 两侧号码都出现，B站 不出现 QQ 号，规则包含「绝不回嘴」；
 *   5. 关掉温柔模式后不再注入任何管理员专属提示词，也不再留【管理员】标记。
 *
 * 运行：node scripts/test-admin-identity.mjs
 */
import assert from 'node:assert/strict';
import {
  adminConfigured, adminDisplayName, adminFromQqConfig, adminFromSources, adminMarker, adminPromptBlock,
  adminSummary, normalizeAdmin, projectAdminSave, resolveAdminUpdate,
} from '../src/admin-identity.js';

// ── 1. 规范化 ──────────────────────────────────────────────────────────────
const normalized = normalizeAdmin({ qq: ' 10001 ', biliMid: '20002', biliName: ' 测试B站昵称 ' });
assert.equal(normalized.qq, '10001');
assert.equal(normalized.biliMid, '20002');
assert.equal(normalized.biliName, '测试B站昵称');
assert.equal(normalized.displayName, '测试B站昵称', '没填称呼时用 B站昵称');
assert.equal(normalized.gentle, false, '温柔模式默认关闭（2026-11-01 用户定）');

assert.equal(normalizeAdmin({ qq: 'abc' }).qq, '', '非数字 QQ 必须丢弃');
assert.equal(normalizeAdmin({ biliMid: '12' }).biliMid, '', '过短 mid 必须丢弃');
// 2026-10-30：B站 UID 变长，15~20 位必须能存进去；非数字仍要拒绝
assert.equal(normalizeAdmin({ biliMid: '123456789012345' }).biliMid, '123456789012345', '15 位 mid 必须保留');
assert.equal(normalizeAdmin({ biliMid: '12345678901234567890' }).biliMid, '12345678901234567890', '20 位 mid 必须保留');
assert.equal(normalizeAdmin({ biliMid: '123456789012345678901' }).biliMid, '', '超长 mid 丢弃');
assert.equal(normalizeAdmin({ biliMid: 'abc12345' }).biliMid, '', '含字母的 mid 丢弃');
assert.equal(normalizeAdmin({ qq: 0 }).qq, '', '0 不是 QQ 号');
assert.equal(normalizeAdmin({ qq: '12345678901234567890' }).qq, '', '超长 QQ 必须丢弃');
assert.equal(normalizeAdmin({ qq: '123456789', gentle: false }).gentle, false);
assert.equal(adminConfigured(normalizeAdmin({})), false);

// ── 2. 从旧字段推导（升级兼容）────────────────────────────────────────────
const fromLegacy = adminFromSources({
  unified: {},
  qq: { ownerQQ: '10001' },
  bili: { owner: { mid: '20002', name: '测试B站昵称' } },
});
assert.deepEqual(
  { qq: fromLegacy.qq, biliMid: fromLegacy.biliMid, biliName: fromLegacy.biliName, gentle: fromLegacy.gentle },
  { qq: '10001', biliMid: '20002', biliName: '测试B站昵称', gentle: false },
  '合体层还没有 admin 时，必须从 ownerQQ / owner.mid 推导',
);

const explicitEmpty = adminFromSources({
  unified: { admin: { qq: '' } },
  qq: { ownerQQ: '10001' },
  bili: { owner: { mid: '20002', name: '测试B站昵称' } },
});
assert.equal(explicitEmpty.qq, '', '显式清空必须生效，不能被旧字段复活');
assert.equal(explicitEmpty.biliMid, '20002', '没被清空的一边仍保留');

assert.equal(adminFromQqConfig({ ownerQQ: '10001' }).qq, '10001', '桥接只读 config.json 也要能认出管理员');
assert.equal(
  adminFromSources({ unified: {}, qq: { admin: { qq: '10001', displayName: '小语', gentle: true } } }).displayName,
  '小语',
  'unified 还没写 admin 时，QQ 已有投影不能丢称呼',
);
assert.equal(adminDisplayName(adminFromQqConfig({ admin: { qq: '111111', displayName: '小语' }, ownerQQ: '999999' })), '小语', '桥接必须能读到 admin.displayName');
assert.equal(adminDisplayName(normalizeAdmin({ qq: '10001' })), '', '没填称呼时不能把“管理员”当名字');
assert.equal(adminFromQqConfig({ admin: { qq: '111111', biliMid: '20002' }, ownerQQ: '999999' }).qq, '111111', 'admin 优先于 ownerQQ');

// ── 3. 保存冲突合并 ────────────────────────────────────────────────────────
const current = normalizeAdmin({ qq: '10001', biliMid: '20002', biliName: '测试B站昵称', displayName: '主人', gentle: true });
const cardWins = resolveAdminUpdate({
  current,
  incomingAdmin: { qq: '100001', biliMid: '200002', biliName: '新主人', displayName: '新称呼', gentle: true },
  incomingQqOwner: '999999',
  incomingBiliOwner: { mid: '20002', name: '测试B站昵称' },
});
assert.equal(cardWins.admin.qq, '100001', '管理员卡片必须同时改 QQ');
assert.equal(cardWins.admin.biliMid, '200002', '管理员卡片必须同时改 B站 mid');
assert.equal(cardWins.conflict, true, '两边同时改不同值时要报冲突');

const advancedOnly = resolveAdminUpdate({
  current,
  incomingAdmin: { qq: '10001', biliMid: '20002', biliName: '测试B站昵称', displayName: '主人', gentle: true },
  incomingQqOwner: '100001',
  incomingBiliOwner: undefined,
});
assert.equal(advancedOnly.admin.qq, '100001', '只在高级参数里改 ownerQQ，也要回填管理员身份');
assert.equal(advancedOnly.admin.biliMid, '20002', '另一边不受影响');
assert.equal(advancedOnly.conflict, false);

const untouched = resolveAdminUpdate({
  current,
  incomingAdmin: { ...current },
  incomingQqOwner: current.qq,
  incomingBiliOwner: { mid: current.biliMid, name: current.biliName },
});
assert.deepEqual(untouched.admin, current, '没改任何东西时不应漂移');
assert.equal(untouched.conflict, false);

// ── 4. 提示词 ──────────────────────────────────────────────────────────────
const admin = normalizeAdmin({ qq: '10001', biliMid: '20002', biliName: '测试B站昵称', displayName: '主人', gentle: true });
const qqBlock = adminPromptBlock('qq', admin);
assert.ok(qqBlock.includes('10001'), 'QQ 侧要认出管理员 QQ');
assert.ok(qqBlock.includes('20002'), 'QQ 侧要知道管理员 B站 mid（同一个人）');
assert.ok(qqBlock.includes('主人'), 'QQ 侧要用管理员称呼');
assert.ok(qqBlock.includes('绝不回嘴'), 'QQ 侧必须有「绝不回嘴」规则');
assert.ok(qqBlock.includes('温柔'), 'QQ 侧必须注入温柔语气');

const biliBlock = adminPromptBlock('bili', admin);
assert.ok(biliBlock.includes('20002'), 'B站 侧要认出主人 mid');
assert.ok(biliBlock.includes('测试B站昵称'), 'B站 侧要认出主人昵称');
assert.ok(biliBlock.includes('绝不回嘴'), 'B站 侧也必须不回嘴');
assert.ok(!biliBlock.includes('10001'), 'B站 提示词不得出现管理员的 QQ 号');

const compact = adminPromptBlock('qq', admin, { compact: true });
assert.ok(compact.length < qqBlock.length, 'compact 版必须比完整版短');
assert.ok(compact.includes('绝不回嘴'));

const mild = adminPromptBlock('qq', normalizeAdmin({ ...admin, gentle: false }));
assert.equal(mild, '', '关掉温柔模式后不再注入任何管理员专属提示词');
assert.equal(adminPromptBlock('bili', normalizeAdmin({ ...admin, gentle: false })), '', 'B站关闭后也不注入管理员专属块');

assert.equal(adminPromptBlock('qq', normalizeAdmin({})), '', '未配置管理员时不占提示词');
const unnamed = adminPromptBlock('qq', normalizeAdmin({ qq: '10001', gentle: true }));
assert.ok(!unnamed.includes('称呼「管理员」'), '没填称呼时不得把“管理员”当称呼');
assert.ok(unnamed.includes('直接称呼「你」'), '没填称呼时要明确用“你”');
const namedPrompt = adminPromptBlock('qq', normalizeAdmin({ qq: '10001', displayName: '小语', gentle: true }));
assert.ok(namedPrompt.includes('称呼「小语」'), '有称呼时必须用设置值');
assert.ok(namedPrompt.includes('身份/权限标记'), '必须说明“管理员”是身份不是称呼');
assert.equal(adminPromptBlock('bili', normalizeAdmin({})), '');

assert.equal(adminMarker(admin), '【管理员·温柔】');
assert.equal(adminMarker({ ...admin, gentle: false }), '', '关闭后消息标记也不能留【管理员】');

const summary = adminSummary(admin);
assert.deepEqual(
  { configured: summary.configured, aligned: summary.aligned, gentle: summary.gentle },
  { configured: true, aligned: true, gentle: true },
);
assert.equal(adminSummary(normalizeAdmin({ qq: '10001' })).aligned, false, '只填一边不算对齐');

// ── 6. 保存计划（宿主 handleConfig 用的就是这条路径）──────────────────────
const legacyCurrent = adminFromSources({
  unified: {},
  qq: { ownerQQ: '10001' },
  bili: { owner: { mid: '20002', name: '测试B站昵称' } },
});
const uiQq = { ownerQQ: '10001', consolePort: 3100, dsh: { model: 'x' } };
const uiBili = { owner: { mid: '20002', name: '测试B站昵称' }, night: { windows: [] } };
const uiUnified = { version: 1, persona: { file: 'roles/角色.md' } };

// 6.1 设置页正常保存：三份都带回，管理员原样投影（不能因为默认 admin 空串把两边抹掉）。
const unchanged = projectAdminSave({ current: legacyCurrent, qq: uiQq, bili: uiBili, unified: uiUnified });
assert.equal(unchanged.admin.qq, '10001');
assert.equal(unchanged.qq.ownerQQ, '10001', '正常保存后 QQ ownerQQ 必须还在');
assert.equal(unchanged.qq.admin.displayName, '测试B站昵称', 'QQ 投影必须带上 displayName（桥接读不到 unified）');
assert.equal(unchanged.qq.consolePort, 3100, '其它 QQ 参数不能被截断');
assert.equal(unchanged.bili.owner.mid, '20002', '正常保存后 B站 owner.mid 必须还在');
assert.equal(unchanged.unified.admin.qq, '10001', '合体层 admin 必须落盘');
assert.equal(unchanged.conflict, false);

// 6.2 管理员卡片改 QQ＋B站：两份投影同时改（默认同一个人）。
const cardEdit = projectAdminSave({
  current: legacyCurrent,
  qq: uiQq,
  bili: uiBili,
  unified: { ...uiUnified, admin: { qq: '100001', biliMid: '200002', biliName: '新主人', displayName: '新称呼', gentle: true } },
});
assert.equal(cardEdit.qq.ownerQQ, '100001', '管理员卡片改 QQ 必须落到 config.json');
assert.equal(cardEdit.qq.admin.displayName, '新称呼', '改称呼必须投影到 QQ config.json');
assert.equal(cardEdit.bili.owner.mid, '200002', '管理员卡片改 B站 UID 必须落到 bili.config.json');
assert.equal(cardEdit.bili.owner.name, '新主人');
assert.equal(cardEdit.unified.admin.displayName, '新称呼');

// 6.2b 关闭温柔模式必须投影成 false，不能被默认值改回 true。
const gentleOff = projectAdminSave({
  current: legacyCurrent,
  qq: { ...uiQq, admin: { ...legacyCurrent, gentle: true } },
  bili: uiBili,
  unified: { ...uiUnified, admin: { ...legacyCurrent, gentle: false } },
});
assert.equal(gentleOff.admin.gentle, false);
assert.equal(gentleOff.qq.admin.gentle, false, 'QQ config 投影必须保留 false');
assert.equal(gentleOff.unified.admin.gentle, false, 'unified 必须保留 false');

// 6.3 只传 unified.admin（没有 qq/bili 对象）且改了值 → 自动补最小投影。
const onlyAdmin = projectAdminSave({
  current: legacyCurrent,
  unified: { admin: { qq: '100001', biliMid: '200002', biliName: '新主人', displayName: '新称呼', gentle: true } },
});
assert.equal(onlyAdmin.qq.ownerQQ, '100001', '没有 qq 对象时也要补 ownerQQ 投影');
assert.equal(onlyAdmin.qq.admin.displayName, '新称呼', '没有 qq 对象时也要补称呼投影');
assert.equal(onlyAdmin.bili.owner.mid, '200002', '没有 bili 对象时也要补 owner 投影');
assert.equal(onlyAdmin.unified.admin.qq, '100001');

// 6.4 什么都没改、也没传任何对象 → 三份都不写。
const nothing = projectAdminSave({ current: legacyCurrent });
assert.equal(nothing.qq, undefined);
assert.equal(nothing.bili, undefined);
assert.equal(nothing.unified, undefined);

// 6.5 显式清空 QQ：ownerQQ 变 null，但 B站 那边保留。
const cleared = projectAdminSave({
  current: legacyCurrent,
  unified: { admin: { qq: '', biliMid: '20002', biliName: '测试B站昵称', displayName: '主人', gentle: true } },
});
assert.equal(cleared.qq.ownerQQ, null, '显式清空 QQ 要落成 null');
assert.equal(cleared.bili, undefined, 'B站 没改就不重写（文件里原有 owner.mid 保持不变）');

console.log('admin-identity tests OK');
