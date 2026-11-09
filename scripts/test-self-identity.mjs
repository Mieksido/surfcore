/**
 * 跨平台自我识别 / 来源判断的回归（2026-10-23 用户提的 5 件事里的 1/3/4）。
 *
 * 为什么单独钉：
 *   · 实测①：群里转发她在**别的群**的聊天记录，她说成「这是 wo 在B站说过的话」；
 *   · 实测②：B站 侧只知道自己叫「小咪」，完全不知道 QQ 上的自己叫什么 → 别人的
 *     QQ 主页截图递过来只会当陌生人；
 *   · 这两类错误**都不会报错**，只会在聊天里丢人，所以必须有用例。
 *
 * 纯函数测试，不连任何平台。
 * 运行：node scripts/test-self-identity.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildProvenanceBlock,
  buildSelfIdentityBlock,
  maskQqUin,
  normalizeSelfCard,
  readQqSelfIdentity,
  selfCardConfigured,
  selfIdentityPath,
} from '../src/self-identity.js';

const pass = (name) => console.log('PASS', name);
let failures = 0;
function test(name, run) {
  try { run(); pass(name); }
  catch (error) { failures++; console.error('FAIL', name, error.message); }
}

const CARD = {
  qqNickname: '卡哇伊的小肥鱼',
  qqUin: 3287064288,
  biliName: '卡哇伊的小肥鱼',
  biliMid: 1483638708,
  personaName: '小咪',
};

// ── 打码 / 收敛 ─────────────────────────────────────────────────────────────
test('QQ 号打码：B站 侧只拿到 328****288', () => {
  assert.equal(maskQqUin('3287064288'), '328****288');
  assert.equal(maskQqUin('123456'), '1****6');
  assert.equal(maskQqUin('abc'), '');
  assert.equal(maskQqUin(''), '');
});

test('数字类型的 QQ 号 / mid 也能收进卡里；非法值留空', () => {
  const card = normalizeSelfCard(CARD);
  assert.equal(card.qqUin, '3287064288');
  assert.equal(card.qqUinMasked, '328****288');
  assert.equal(card.biliMid, '1483638708');
  assert.equal(card.biliSpace, 'https://space.bilibili.com/1483638708');
  assert.equal(normalizeSelfCard({ qqUin: '12' }).qqUin, '', '太短的不是 QQ 号');
  assert.equal(normalizeSelfCard({ biliMid: 'x' }).biliMid, '');
  assert.equal(normalizeSelfCard({ qqNickname: 'a\nb' }).qqNickname, 'a b', '换行压成空格');
  assert.equal(normalizeSelfCard({ qqNickname: 'x'.repeat(80) }).qqNickname.length, 40);
});

test('空卡不注入，避免刷一段空话', () => {
  assert.equal(buildSelfIdentityBlock({}), '');
  assert.equal(buildSelfIdentityBlock(null), '');
  assert.equal(selfCardConfigured({}), false);
  assert.equal(selfCardConfigured({ biliName: '只有昵称' }), true);
});

// ── B站 侧：认自己的 QQ 资料卡 ───────────────────────────────────────────────
test('B站 侧自我卡：有 QQ 锚点、QQ 号打码、带隐私句', () => {
  const block = buildSelfIdentityBlock(CARD, { platform: 'bili' });
  assert.match(block, /【你是谁 · 同一副人格/);
  assert.match(block, /昵称「卡哇伊的小肥鱼」/);
  assert.match(block, /UID 1483638708/);
  assert.match(block, /328\*\*\*\*288/, 'QQ 号要打码');
  assert.ok(!block.includes('3287064288'), 'B站 侧不能出现完整 QQ 号');
  assert.match(block, /QQ 资料卡/);
  assert.match(block, /【隐私】/);
  assert.match(block, /人格名「小咪」/);
  assert.match(block, /同一副人格/);
});

test('B站 侧：README 里那种「只知道 B站 昵称」的旧配置也能用', () => {
  const block = buildSelfIdentityBlock({ biliName: '卡哇伊的小肥鱼', biliMid: '1483638708' }, { platform: 'bili' });
  assert.match(block, /space\.bilibili\.com\/1483638708/);
  assert.match(block, /看图先认自己/);
});

// ── QQ 侧：同一张卡（保留给以后接更多平台用）────────────────────────────────
test('QQ 侧自我卡：完整 QQ 号 + B站 锚点 + @ 规则', () => {
  const block = buildSelfIdentityBlock(CARD, { platform: 'qq' });
  assert.match(block, /QQ 3287064288/);
  assert.match(block, /B站上的你/);
  assert.match(block, /space\.bilibili\.com\/1483638708/);
  assert.match(block, /@卡哇伊的小肥鱼/);
  assert.doesNotMatch(block, /【隐私】/, 'QQ 侧不需要 B站 的隐私句');
});

// ── 来源判断（这次真正修的问题）──────────────────────────────────────────────
test('来源块：合并转发 = QQ 聊天记录，不是 B站 内容', () => {
  const block = buildProvenanceBlock();
  assert.match(block, /【来源判断】/);
  assert.match(block, /合并转发/);
  assert.match(block, /不是 B站/);
  assert.match(block, /说成「我在 B站 说过的话」/);
  assert.match(block, /截图/, 'QQ 里发来的截图也要归到 QQ');
});

test('两侧的自我卡都带上来源规则（不只 QQ 侧）', () => {
  for (const platform of ['qq', 'bili']) {
    const block = buildSelfIdentityBlock(CARD, { platform });
    assert.match(block, /合并转发 \/ 聊天记录 = QQ 聊天内容/, `${platform} 侧缺来源规则`);
  }
});

// 2026-10-23 用户定：只准自己互认，不许泄露主人和别人的信息。
test('两侧都写明「身份信息只用于自己，不许外传主人/别人」', () => {
  for (const platform of ['qq', 'bili']) {
    const block = buildSelfIdentityBlock(CARD, { platform });
    assert.match(block, /【只用于自己】/, `${platform} 侧缺外传禁令`);
    assert.match(block, /不要说出对方或任何别人的 QQ 号/, `${platform} 侧没写明禁止外传`);
  }
  assert.match(buildProvenanceBlock(), /【只用于自己】/, 'QQ 每轮注入的来源块也要带外传禁令');
});

// ── 持久化：桥接写、B站 侧读 ─────────────────────────────────────────────────
test('self-identity.json 读写：缺文件/坏文件都当「没配」，不抛错', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'self-identity-'));
  try {
    assert.deepEqual(readQqSelfIdentity(dir), { nickname: '', userId: '', updatedAt: '' }, '缺文件');
    fs.writeFileSync(selfIdentityPath(dir), JSON.stringify({ nickname: '卡哇伊的小肥鱼', userId: '3287064288', updatedAt: '2026-10-23T00:00:00.000Z' }));
    const read = readQqSelfIdentity(dir);
    assert.equal(read.nickname, '卡哇伊的小肥鱼');
    assert.equal(read.userId, '3287064288');
    fs.writeFileSync(selfIdentityPath(dir), '{坏 json');
    assert.equal(readQqSelfIdentity(dir).nickname, '', '坏文件不能炸 B站 唤醒');
    fs.writeFileSync(selfIdentityPath(dir), JSON.stringify({ nickname: 'x', userId: 'abc' }));
    assert.equal(readQqSelfIdentity(dir).userId, '', '非法 QQ 号要丢弃');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

if (failures) process.exitCode = 1;
console.log(failures ? `\n${failures} 项失败` : '\nself-identity tests OK');
