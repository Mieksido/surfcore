/**
 * 记忆写入流水线测试（顾问 P1：脱敏/去重/评分/容量/最初/分节渲染）
 * 跑法：node kernel/memory/write-pipeline.test.mjs
 *
 * 这些都是**模块策略**，不是契约；改常量表/规则要过这里。
 */
import { createMemoryKernel } from './index.js';
import { scoreMemory, WEIGHTS } from './scoring.js';
import { findDuplicate, dedupeKey } from './dedupe.js';
import { redactText, hasSensitive, REDACT_RULES } from './redact.js';
import { planEviction, capacityLevel, isProtected, DEFAULT_CAPACITY } from './capacity.js';
import { shouldMarkInitial, markFirstMeet, stableUnit, initialProbability } from './initial.js';
import { createNarrativeReader } from './narrative/reader.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = Date.parse('2026-11-10T12:00:00');
// 注意：from / to 要**合并**，不能把 extra 整体展开覆盖掉（踩过一次）
const ev = (text, extra = {}) => ({
  text,
  from: { channel: 'c1', kind: 'private', actor: 'u1', at: NOW, ...(extra.from ?? {}) },
  to: extra.to ?? {},
  ...(extra.importance === undefined ? {} : { importance: extra.importance }),
});

console.log('## ① 评分：什么值得记住');
{
  ok(scoreMemory({ text: '', to: {} }) === WEIGHTS.base, '空内容：只有基准分');
  const ownerPrivate = scoreMemory({ text: '今天见面', from: { kind: 'private' }, to: { owner: true } });
  const ownerGroup = scoreMemory({ text: '今天见面', from: { kind: 'group' }, to: { owner: true } });
  ok(ownerPrivate > ownerGroup, '主人私聊 > 主人在群里');
  const plain = scoreMemory({ text: '今天天气真的很不错啊', to: {} });
  ok(plain < ownerPrivate, '普通人闲话 < 主人的事');
  const emotional = scoreMemory({ text: '太好了！！哈哈哈', to: {} });
  ok(emotional > plain, '有情绪：加分');
  const promise = scoreMemory({ text: '说好了周末见面', to: {} });
  ok(promise > plain, '约定：加分');
  const short = scoreMemory({ text: '嗯', to: {} });
  ok(short < plain, '太短：扣分');
  const withHint = scoreMemory({ text: '今天见面', to: {} }, { channelHint: 60 });
  ok(withHint > plain, '包给的渠道加分：生效');
  ok(scoreMemory({ text: 'x', pinned: true }) === 100, '置顶：永远 100');
  ok(scoreMemory({ text: 'x', to: { owner: true } }, { isFirstOwnerEver: true }) === 100, '主的第一次：100');
  ok(scoreMemory({ text: 'a'.repeat(50), to: {} }) <= 100, '分数不会超过 100');
}

console.log('\n## ② 去重：别记两遍');
{
  const a = { externalId: 'm1', text: '你好', from: { adapter: 'a', channel: 'c', actor: 'u', at: NOW } };
  ok(dedupeKey(a) === 'a|c|u|m1', '几何键可读');
  ok(findDuplicate({ ...a }, [a]) === a, '同平台编号：判重');
  const b = { text: '你好', from: { adapter: 'a', channel: 'c', actor: 'u', at: NOW + 1000 } };
  ok(findDuplicate(b, [a]) === a, '同人同文本、窗口内：判重');
  const far = { text: '你好', from: { adapter: 'a', channel: 'c', actor: 'u', at: NOW + 3 * 86400000 } };
  ok(findDuplicate(far, [a]) === null, '超过窗口：不算重复');
  const other = { text: '你好', from: { adapter: 'a', channel: 'c', actor: 'u2', at: NOW } };
  ok(findDuplicate(other, [a]) === null, '换个人：不算重复');
  const punct = { text: '你好。', from: { adapter: 'a', channel: 'c', actor: 'u', at: NOW + 10 } };
  ok(findDuplicate(punct, [a]) !== null, '标点差异：仍算重复（归一化后相同）');
  ok(findDuplicate({ text: 'x', from: { adapter: 'a', channel: 'c', actor: 'u', at: 0 } }, [], {}) === null, '空库：不判重');
}

console.log('\n## ③ 脱敏：写进去之前藏一次');
{
  const cases = [
    ['我的密码是 abc12345', 'password'],
    ['密码：hunter2', 'password'],
    ['key sk-abcdefghijklmnop', 'apikey'],
    ['拿这个 Bearer abcdefghijklmnop 去', 'bearer'],
    ['身份证 110101199003071234', 'idcard'],
    ['电话 13800138000', 'phone'],
    ['看 https://example.com/a?b=1 这个', 'url'],
  ];
  for (const [text, id] of cases) {
    const r = redactText(text);
    ok(r.hits.some((h) => h.id === id), `认出 ${id}`);
    ok(!/abc12345|hunter2|abcdefghijklmnop|110101199003071234|13800138000|example\.com/.test(r.text), `藏住 ${id} 的原文`);
  }
  ok(redactText('普通的一句话').hits.length === 0, '普通内容：不动');
  ok(redactText('https://a.com', { keepUrls: true }).text.includes('https://a.com'), '保留链接开关：生效');
  ok(hasSensitive('密码是 123456') === true && hasSensitive('今天天气') === false, 'hasSensitive 可单独用');
  ok(REDACT_RULES.length >= 6, '规则表可数（改法：只改这张表）');
}

console.log('\n## ④ 容量：超了淘汰最不重要的');
{
  const mk = (i, importance, extra = {}) => ({ text: `第${i}条`, importance, from: { at: NOW + i }, to: {}, ...extra });
  const records = [mk(1, 80), mk(2, 10), mk(3, 50), mk(4, 5)];
  const { keep, evict } = planEviction(records, { maxRecords: 2 });
  ok(evict.length === 2 && keep.length === 2, '超 2 条：淘汰 2 条');
  ok(evict.every((r) => r.importance <= 10), '被淘汰的是最不重要的');
  const pinned = [mk(1, 5, { pinned: true }), mk(2, 90), mk(3, 5)];
  const r2 = planEviction(pinned, { maxRecords: 2 });
  ok(!r2.evict.includes(pinned[0]), '置顶的：不淘汰');
  ok(isProtected(pinned[0]) === true && isProtected(mk(9, 5)) === false, 'isProtected 可单测');
  ok(capacityLevel(0, 100) === 'ok' && capacityLevel(85, 100) === 'warn80' && capacityLevel(95, 100) === 'warn90' && capacityLevel(120, 100) === 'full', '四档告警');
  ok(DEFAULT_CAPACITY.maxRecords === 600, '默认上限 600');
}

console.log('\n## ⑤「最初」：稳定，不随刷新变');
{
  ok(stableUnit('abc') === stableUnit('abc'), '同一输入：结果稳定');
  ok(stableUnit('abc') !== stableUnit('abd'), '不同输入：结果不同');
  ok(initialProbability(0.5) > initialProbability(20), '越靠近第一次：概率越高');
  ok(initialProbability(400) === 0, '窗口外：不可能');

  const rec = { text: '第一次一起吃饭', to: { owner: true }, from: { at: NOW, channel: 'c', actor: 'o' } };
  const a = shouldMarkInitial(rec, { now: NOW, firstOwnerAt: NOW });
  const b = shouldMarkInitial(rec, { now: NOW, firstOwnerAt: NOW });
  ok(a === b, '同一条记录：判定稳定');
  ok(shouldMarkInitial({ ...rec, to: {} }, { now: NOW, firstOwnerAt: NOW }) === false, '跟主人无关：不标');
  ok(shouldMarkInitial(rec, { now: NOW, firstOwnerAt: NOW - 400 * 86400000 }) === false, '窗口外：不标');

  const list = [{ text: 'a', to: {}, from: { at: NOW + 5 } }, { text: 'b', to: { owner: true }, from: { at: NOW } }];
  const first = markFirstMeet(list);
  ok(first && first.text === 'b' && first.importance === 100, '初遇：最早那条主人记录 → 100 分置顶');
  ok(markFirstMeet(list) === null, '初遇：幂等（第二次不动）');
}

console.log('\n## ⑥ 分节渲染：形状不变，内容分节');
{
  const reader = createNarrativeReader();
  const recs = [
    { text: '最初的相遇', firstMeet: true, importance: 100, from: { at: NOW, channel: 'c' }, media: [] },
    { text: '主人说周末见面', to: { owner: true }, importance: 80, from: { at: NOW, channel: 'c' }, media: [] },
    { text: '今天天气不错', importance: 20, from: { at: NOW, channel: 'c' }, media: [] },
    { text: '很久以前模糊的事', clarity: 'fuzzy', importance: 15, from: { at: NOW, channel: 'c' }, media: [] },
    { text: '完全想不起来的事', clarity: 'trace', importance: 10, from: { at: NOW, channel: 'c' }, media: [] },
  ];
  const out = reader.build({ records: recs, query: { maxChars: 2000 } });
  ok(typeof out.text === 'string' && Array.isArray(out.refs), '返回形状仍是 {text, refs}');
  ok(out.text.includes('【最初的相遇】'), '有"最初的相遇"节');
  ok(out.text.includes('【关于主人】'), '有"关于主人"节');
  ok(out.text.includes('【最近】'), '有"最近"节');
  ok(out.text.includes('【有点模糊的事】'), '有"有点模糊"节');
  ok(out.refs.every((r) => r.section), '引用里带节名（便于排查）');
  const traceLine = out.text.split('\n').find((l) => l.includes('完全想不起来'));
  ok(traceLine && traceLine.length < 40, '想不起来的：只留一小段');
  ok(reader.build({ records: [], query: {} }).text === '', '空记录：空字符串');
}

console.log('\n## ⑦ 流水线串联：一次入库走完六步');
{
  const k = createMemoryKernel({ now: () => NOW });
  const a = k.ingest(ev('主人说周五见面，别忘了', { to: { owner: true } }), { direct: true });
  ok(a.importance >= 70, `评分生效（${a.importance}）`);
  ok(a.firstMeet === true, '第一条主人记录：初遇');
  const dup = k.ingest(ev('主人说周五见面，别忘了', { to: { owner: true }, from: { at: NOW + 500 } }));
  ok(dup.duplicate === true, '同一句：被判重');
  ok(k.stats().duplicates === 1, '统计里能看到判重次数');
  const secret = k.ingest(ev('我的密码是 hunter2'));
  ok(secret.text.includes('[已隐藏]'), '密码：入库前就藏了');
  ok(k.stats().narrative === 2, '真正的记录只有 2 条（重复的没进）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
