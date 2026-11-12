/**
 * 「我是谁」测试（旧 self-identity.js 的三件事）
 * 跑法：node kernel/support/self-card.test.mjs
 */
import { maskId, normalizeSelfCard, selfCardConfigured, buildSelfBrief, PROVENANCE_RULES } from './self-card.js';
import { buildPrompt } from '../expression/prompt.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## ① 打码：认自己够用，抄不走');
{
  ok(maskId('3287064288') === '328****288', '长号：留前 3 后 3');
  ok(maskId('123456') === '1****6', '短号：留首尾');
  ok(maskId('') === '' && maskId('ab') === '', '太短/空：不产生');
  ok(!maskId('3287064288').includes('7064'), '中间被盖住');
  ok(maskId('user_abc') === 'use****abc', '非纯数字也认');
}

console.log('\n## ② 身份卡归一：有就写，空就丢');
{
  const card = normalizeSelfCard({
    personaName: '小鲸鱼',
    accounts: { one: { id: '100010001', name: '小明' }, two: { name: '小明B' }, three: {} },
  });
  ok(card.personaName === '小鲸鱼', '名字保留');
  ok(Object.keys(card.accounts).length === 2, '空的来源被丢掉');
  ok(card.accounts.one.masked === '100****001', '带打码');
  ok(card.accounts.two.id === '' && card.accounts.two.name === '小明B', '只有昵称也能用');

  ok(selfCardConfigured(card) === true, '有内容：算已配置');
  ok(selfCardConfigured({ accounts: {} }) === false, '全空：不算配置');
  ok(selfCardConfigured(null) === false, 'null：不崩，算未配置');
}

console.log('\n## ③ 提示词：没配置就不刷空话');
{
  ok(buildSelfBrief({ accounts: {} }) === '', '全空：空串（不注入空话）');

  const brief = buildSelfBrief({ personaName: '小鲸鱼', accounts: { one: { id: '100010001', name: '小明' } } });
  ok(brief.includes('【我是谁】'), '有标题');
  ok(brief.includes('小鲸鱼'), '有名字');
  ok(brief.includes('小明'), '有昵称');
  ok(!brief.includes('100010001'), '**完整账号不进提示词**');
  ok(brief.includes('100****001'), '只给打码后的');
  ok(brief.includes('来源判断'), '带来源规则');
}

console.log('\n## ④ 来源规则：看载体，不点名任何平台');
{
  ok(PROVENANCE_RULES.length >= 2, '至少两条');
  const text = PROVENANCE_RULES.join(' ');
  ok(text.includes('合并转发') || text.includes('聊天记录'), '说清"转发/聊天记录"是什么');
  ok(text.includes('不要靠感觉') || text.includes('看载体'), '给出判断方法');
  // 平台名不许出现：这条全局由 core-check 守（它扫 kernel/ 的源码）。
  // 这里只确认规则本身是按"载体"写的，不依赖任何具体平台。
  ok(text.includes('载体') || text.includes('聊天内容'), '按载体判断，不依赖平台名');
}

console.log('\n## ⑤ 打码与昵称同时出现时，格式不崩');
{
  const brief = buildSelfBrief({ accounts: { one: { id: '100010001', name: '小明' } } });
  const line = brief.split('\n').find((l) => l.includes('小明'));
  ok(line.includes('小明') && line.includes('100****001'), '同一行里既有昵称也有打码账号');
}

console.log('\n## ⑥ 接进提示词：只在用户消息里，且不打全号');
{
  const brief = buildSelfBrief({ personaName: '小鲸鱼', accounts: { one: { id: '100010001', name: '小明' } } });
  const p = buildPrompt({
    identity: { personaLayers: () => ['你是小鲸鱼'] },
    selfBrief: brief,
    viewer: { kind: 'private' },
    event: { text: '在吗', from: { actor: 'o' } },
  });
  ok(p.user.includes('【我是谁】'), '用户消息里有身份块');
  ok(!p.system.includes('【我是谁】'), '系统提示词里没有（不污染人格）');
  ok(!p.user.includes('100010001'), '全号不进提示词');
  ok(p.user.includes('100****001'), '只给打码后的');

  const empty = buildPrompt({ identity: { personaLayers: () => [] }, selfBrief: '', viewer: {}, event: { text: 'x' } });
  ok(!empty.user.includes('【我是谁】'), '没配置：不注入');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
