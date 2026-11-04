// 回归：称呼按人归属（2026-10-31：主人被叫成对象的「琳琳」）
// 根因：对齐表的称呼只在群聊注入；私聊没有"当前对方希望被叫"；
//       记忆卡里非主人的私聊记忆不带说话人，模型把别人的称呼套到眼前的人。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pickPeerAlias, buildPeerAliasTag } from '../src/callname.js';
import { renderMemoryCard } from '../src/memory-card.js';

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label} ${extra}`); }
};

const links = [
  { id: 'a', label: '雨雨', identities: { qq: { id: '10001' } } },
  { id: 'b', label: '琳琳', identities: { qq: { id: '20002' } } },
  { id: 'c', label: '小零', identities: { bili: { id: '37634003' } } },
];

// 1) 按 QQ 精确取，不串号
ok(pickPeerAlias(links, '10001') === '雨雨', 'QQ 10001 → 雨雨');
ok(pickPeerAlias(links, '20002') === '琳琳', 'QQ 20002 → 琳琳');
ok(pickPeerAlias(links, '99999') === '', '没设置称呼的人 → 空');
ok(pickPeerAlias(links, '') === '', '空 QQ → 空');
ok(pickPeerAlias([{ label: '小零', identities: { bili: { id: '37634003' } } }], '37634003') === '', '只有 B站 的登记不会被 QQ 误用');

// 2) 提示块只对当前会话生效，并明确"不要套到别人"
{
  const tag = buildPeerAliasTag({ label: '琳琳', qq: '20002', isOwner: false });
  ok(tag.includes('琳琳') && tag.includes('20002'), '提示块带称呼和 QQ');
  ok(tag.includes('不要把这个称呼套到别人身上'), '明确禁止套用');
  ok(buildPeerAliasTag({ label: '', qq: '1' }) === '', '没有称呼就不注入');
}

// 3) 记忆卡：非主人私聊记录要带说话人，并带"称呼只属于原话的人"规则
{
  const now = Date.now();
  const card = {
    records: [{
      id: 'r1', platform: 'qq', scope: 'qq', source: 'qq-private', clarity: 'clear',
      text: '以后叫我琳琳', title: '琳琳：以后叫我琳琳', isOwner: false, private: true,
      speaker: '琳琳', createdAt: new Date(now - 60_000).toISOString(), lastSeenAt: new Date(now).toISOString(),
      importance: 40, tags: [], recallCount: 0,
    }],
    meta: {}, stats: {}, alerts: {},
  };
  const text = renderMemoryCard(card, { platform: 'qq', maxChars: 4000, now });
  ok(text.includes('琳琳（私聊）：'), '记忆行带说话人与场景', text.slice(0, 200));
  ok(text.includes('不要把别人的称呼套到眼前的人'), '注入"称呼只属于原话的人"规则');
}

// 4) 接线：桥接私聊注入按会话取称呼；群聊不动
{
  const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
  ok(bridge.includes('peerAliasTagV2'), '桥接注入当前对方称呼');
  ok(bridge.includes("if (kind !== 'private') return ''"), '只在私聊注入');
  ok(bridge.includes('pickPeerAlias'), '按 QQ 取称呼');
  const memory = fs.readFileSync(path.resolve('src/memory-card.js'), 'utf8');
  ok(memory.includes('memorySourceLabel(record)'), '记忆行带来源（私聊/群聊/群名）归属');
}

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
console.log('\n✅ test-callname 通过');
