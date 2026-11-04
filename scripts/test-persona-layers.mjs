// 人格卡分层：核心/场景/日常的组合、平台选择、预算与 v1/v2 小节过滤。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { composePersonaLayers, personaSceneFromKey } from '../src/persona-layers.js';

assert.equal(personaSceneFromKey('group:123'), 'qq-group');
assert.equal(personaSceneFromKey('private:123'), 'qq-private');
assert.equal(personaSceneFromKey('', 'bili'), 'bili');
assert.equal(personaSceneFromKey('', 'pet'), 'pet');
assert.equal(personaSceneFromKey(''), '');

// 只有核心：保持旧行为，不加标题。
{
  const r = composePersonaLayers({ core: '# 角色\n核心内容', maxChars: 6000 });
  assert.equal(r.text, '# 角色\n核心内容');
  assert.equal(r.chars, r.text.length);
}

// 三层顺序：核心 → 场景 → 日常。
{
  const r = composePersonaLayers({
    core: 'CORE',
    scene: 'SCENE',
    daily: 'DAILY',
    sceneId: 'qq-group',
    maxChars: 6000,
  });
  assert.ok(r.text.indexOf('CORE') < r.text.indexOf('SCENE'));
  assert.ok(r.text.indexOf('SCENE') < r.text.indexOf('DAILY'));
  assert.ok(r.text.includes('【人格核心】'));
  assert.ok(r.text.includes('【场景人格｜QQ 群聊】'));
  assert.ok(r.text.includes('【人格日常】'));
}

// 预算：核心优先，场景次之，日常最后；应能看出 daily 被裁掉。
{
  const r = composePersonaLayers({
    core: 'C'.repeat(20),
    scene: 'S'.repeat(20),
    daily: 'D'.repeat(20),
    sceneId: 'bili',
    maxChars: 70,
  });
  assert.ok(r.text.includes('C'.repeat(20)), '核心必须保留');
  assert.ok(r.text.includes('S'.repeat(20)), '场景优先于日常');
  assert.ok(!r.text.includes('D'.repeat(20)), '日常应被裁');
  assert.ok(r.truncated);
}

// v1/v2 小节过滤仍然生效。
{
  const core = '共同\n\n## 一代专用 〔一代〕\n一代内容\n\n## 二代专用 〔二代〕\n二代内容';
  const v1 = composePersonaLayers({ core, mode: 'v1', maxChars: 6000 }).text;
  const v2 = composePersonaLayers({ core, mode: 'v2', maxChars: 6000 }).text;
  assert.ok(v1.includes('一代内容') && !v1.includes('二代内容'));
  assert.ok(v2.includes('二代内容') && !v2.includes('一代内容'));
}

// 身份底座：tone 模式也必须带“我是谁、主人是谁”。
const identityCompose = composePersonaLayers({ core: '核心XYZ', tone: '语气ABC', identity: '你是小咪；你的主人是主人。', personaMode: 'tone', mode: 'v2', maxChars: 6000 });
assert.ok(identityCompose.text.includes('你是小咪') && identityCompose.text.includes('主人'));
assert.ok(!identityCompose.text.includes('核心XYZ'), 'tone 模式仍不能加载核心正文');

// tone 模式：只语气+场景+日常，不带核心；full 才带核心。
const toneCompose = composePersonaLayers({ core: '核心XYZ', tone: '语气ABC', daily: '日常DEF', personaMode: 'tone', mode: 'v2', maxChars: 6000 });
assert.ok(toneCompose.text.includes('语气ABC'));
assert.ok(!toneCompose.text.includes('核心XYZ'), 'tone 模式不能加载核心');
const fullCompose = composePersonaLayers({ core: '核心XYZ', tone: '语气ABC', daily: '日常DEF', personaMode: 'full', mode: 'v2', maxChars: 6000 });
assert.ok(fullCompose.text.includes('核心XYZ') && fullCompose.text.includes('语气ABC'));
const fallbackCompose = composePersonaLayers({ core: '旧角色核心', personaMode: 'tone', mode: 'v2', maxChars: 6000 });
assert.ok(fallbackCompose.text.includes('旧角色核心'), '旧角色没有语气时回退核心，避免没卡');

// tone 与 core 内容相同时，full 模式不能重复拼两段（旧角色/误复制）。
const duplicateTone = composePersonaLayers({ core: '同一段正文', tone: '同一段正文', personaMode: 'full', mode: 'v2', maxChars: 6000 });
assert.equal((duplicateTone.text.match(/同一段正文/g) || []).length, 1, 'identical tone/core 只能出现一次');
assert.ok(!duplicateTone.text.includes('人格语气'), 'identical tone 不应生成语气段');
const duplicateToneMode = composePersonaLayers({ core: '同一段正文', tone: '同一段正文', personaMode: 'tone', mode: 'v2', maxChars: 6000 });
assert.equal((duplicateToneMode.text.match(/同一段正文/g) || []).length, 1, 'tone 模式 identical 也只能出现一次');
assert.ok(duplicateToneMode.text.includes('同一段正文'), 'tone 模式仍要保留正文');

// 目的/主动搭话路径也必须带 tone，不能只读 core。
const bridgeSource = fs.readFileSync('src/bridge.js', 'utf8');
assert.match(bridgeSource, /function purposePersonaText\(\)[\s\S]*?readPersonaLayerText\('tone'\)/, 'purposePersonaText 没接语气层');

// 回归（2026-10-31）：没拆分的旧角色 + 身份底座 → tone 模式也必须带上核心人设。
const unsplitCompose = composePersonaLayers({
  core: '旧角色核心正文', identity: '你是小咪；你的主人是雨雨。', personaMode: 'tone', mode: 'v2', maxChars: 6000,
});
assert.ok(unsplitCompose.text.includes('旧角色核心正文'), '未拆分人格在 tone 模式必须注入核心，不能只剩身份底座');
assert.ok(unsplitCompose.text.includes('你的主人是雨雨'), '身份底座也要在');
// 已拆分：tone 模式仍按省 token 行为，不带核心。
const splitCompose = composePersonaLayers({
  core: '核心正文XYZ', tone: '语气ABC', identity: '你是小咪。', personaMode: 'tone', mode: 'v2', maxChars: 6000,
});
assert.ok(!splitCompose.text.includes('核心正文XYZ'), '拆分后 tone 模式不带核心（省 token）');
// 只拆了日常/场景、还没写语气：也要带核心（语气层才是核心的替代品）
const dailyOnly = composePersonaLayers({
  core: '核心正文ABC', daily: '日常DEF', identity: '你是小咪。', personaMode: 'tone', mode: 'v2', maxChars: 6000,
});
assert.ok(dailyOnly.text.includes('核心正文ABC'), '没有语气层时必须带核心（不能只剩日常）');

// 三个注入点都必须走同一套分层逻辑，不能在 UI 分层后桥接仍读单卡。
const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
const scheduler = fs.readFileSync(path.resolve('plugins/surfcore/lib/scheduler.js'), 'utf8');
const pet = fs.readFileSync(path.resolve('plugins/surfcore/lib/pet-chat.js'), 'utf8');
for (const [name, src] of [['bridge', bridge], ['scheduler', scheduler], ['pet', pet]]) {
  assert.ok(src.includes('composePersonaLayers'), `${name} 没有接人格分层组合`);
  assert.ok(src.includes('readPersonaLayerText'), `${name} 没有读人格分层文件`);
}
assert.ok(bridge.includes('currentRoleHintV2(key, personaMode)'), 'QQ qq_get_prompt 必须按会话 key + 人格模式选场景');
assert.ok(bridge.includes('currentRoleHint(key, personaMode)'), 'QQ 角色提示必须按会话 key + 人格模式选场景');
assert.ok(bridge.includes('personaSceneFromKey'), 'QQ 没有按群聊/私聊选择场景');

// 身份底座必须在三个平台都注入，且不依赖用户是否拆分人格（2026-10-31 用户要求）。
const { buildPersonaIdentity } = await import('../src/persona-identity.js');
const idLine = buildPersonaIdentity({ name: '小咪', owner: '雨雨' });
assert.ok(idLine.includes('你是小咪') && idLine.includes('雨雨'), '身份句包含角色与主人');
assert.ok(buildPersonaIdentity({}).includes('这个角色'), '缺省角色名有兜底');
for (const [name, src] of [['bridge', bridge], ['scheduler', scheduler], ['pet', pet]]) {
  assert.ok(/buildPersonaIdentity\(/.test(src) || name === 'bridge', `${name} 没有注入身份底座`);
  assert.ok(/identity:/.test(src), `${name} 的 compose 调用必须传 identity`);
}
assert.ok(scheduler.includes('identity: buildPersonaIdentity('), 'B站 提示词必须带身份底座');
assert.ok(pet.includes('identity: buildPersonaIdentity('), '桌宠 提示词必须带身份底座');
// 语气层也要跟着走：不能只有 QQ 用语气，B站/桌宠还是干巴巴的人设。
assert.ok(scheduler.includes("tone: readPersonaLayerText('tone')"), 'B站 提示词必须带语气层');
assert.ok(pet.includes("tone: readPersonaLayerText('tone')"), '桌宠 提示词必须带语气层');

// 回归（2026-10-31）：保存全部不能把语气层写进人格核心。
{
  const index = fs.readFileSync(path.resolve('plugins/surfcore/lib/index.js'), 'utf8');
  assert.ok(index.includes("layer === 'tone'"), '服务端必须有 tone 保存分支（否则落到 core）');
  assert.ok(index.includes('tone: layers.tone'), '层路径必须包含 tone');
  assert.ok(index.includes('tone: { path: paths.tone'), 'GET /persona 必须返回 tone 文本');
  const client = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');
  assert.ok(client.includes('origTone'), '客户端保存前要知道原层有没有内容，不能盲写空层');
}

console.log('✅ 人格卡分层通过');
