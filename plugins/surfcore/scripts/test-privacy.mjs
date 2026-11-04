/** 隐私闸门回归：私信/密钥/PII 必须被挡住，正常公开内容必须放行。 */
import assert from 'node:assert/strict';
import { sanitizeText, scanText, assertSafeOutput, isPublicGroupMessage } from '../lib/privacy.js';

const cases = [
  { text: '我的QQ是123456789，手机13800138000', ok: false, why: 'QQ号/手机号' },
  { text: '私信我，我告诉你', ok: false, why: '私信话题' },
  { text: '密码：abcd1234', ok: false, why: '密码' },
  { text: 'SESSDATA=abc123456789', ok: false, why: 'cookie' },
  { text: '今天看了个视频 BV1xx411c7mD 很好笑', ok: true, why: '正常内容' },
  { text: '这个猫猫好可爱 mer', ok: true, why: '正常内容' },
  { text: '我住在北京市朝阳区某某小区', ok: false, why: '住址' },
  { text: '身份证 110101199001011234', ok: false, why: '身份证' },
];
for (const item of cases) {
  const result = sanitizeText(item.text);
  assert.equal(result.ok, item.ok, `${item.why}: ${JSON.stringify(result)}`);
}

assert.equal(scanText('sk-1234567890abcdef1234567890abcdef').severe, true);
assert.throws(() => assertSafeOutput('password: hunter2'), /隐私闸门拒绝/);
assert.doesNotThrow(() => assertSafeOutput('今天看了个视频，挺好笑的'));

assert.equal(isPublicGroupMessage({ key: 'private:12345', groupIds: [], text: 'hi' }).ok, false);
assert.equal(isPublicGroupMessage({ key: 'group:767098733', groupIds: ['767098733'], text: 'hi' }).ok, true);
assert.equal(isPublicGroupMessage({ key: 'group:999999999', groupIds: ['767098733'], text: 'hi' }).ok, false);
assert.equal(isPublicGroupMessage({ key: 'group:767098733', groupIds: ['767098733'], text: '/reset' }).ok, false);

// 住址规则：枚举不是赋值。人格卡模板里的“住址、联系方式”不能被当成地址。
const addressCases = [
  ['私信、密码、令牌、住址、联系方式，绝不跨平台搬运。', false],
  ['- 私信、密码、令牌、住址、联系方式绝不跨平台搬运。', false],
  ['收货地址：北京市朝阳区建国路88号', true],
  ['我家住在海淀区中关村大街1号院3号楼', true],
  ['地址是上海市浦东新区世纪大道100号', true],
  ['家庭地址: 广州市天河区体育西路 12 号', true],
  ['不要告诉别人我的住址在哪儿', false],
];
for (const [text, expectSevere] of addressCases) {
  const hits = scanText(text).pii.filter((hit) => hit.severe);
  assert.equal(hits.length > 0, expectSevere, `住址误判: ${JSON.stringify(text)} → ${JSON.stringify(hits)}`);
}

console.log('privacy tests OK');
