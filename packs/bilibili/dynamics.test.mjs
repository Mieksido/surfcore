/**
 * B站 动态：解析 / 排版 / 增量计划（纯计算，不联网）
 * 跑法：node packs/bilibili/dynamics.test.mjs
 */
import {
  parseDynamicItem, formatDynamicMessage, emptyDynamicState, planDynamicSync, pruneSeen,
} from './dynamics.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

/** 一条接近 B站 polymer 接口的真实形状（只留会用到的字段） */
const raw = (id, text, ts = 0) => ({
  id_str: String(id),
  type: 'DYNAMIC_TYPE_WORD',
  modules: {
    module_author: { pub_ts: ts, pub_time: '11-10' },
    module_dynamic: {
      desc: { text },
      major: { archive: { bvid: 'BV1xx', title: '一个视频' } },
    },
  },
});

console.log('## 解析');
{
  const d = parseDynamicItem(raw(101, '今天看了个视频', 1731200000));
  ok(d.id === '101', 'id 取 id_str');
  ok(d.text === '今天看了个视频', '正文取 desc.text');
  ok(d.bvid === 'BV1xx' && d.title === '一个视频', '视频附件取 bvid/title');
  ok(d.url === 'https://t.bilibili.com/101', '动态链接由 id 拼');
  ok(d.pubTs === 1731200000, '发布时间是数字');

  const broken = parseDynamicItem({});
  ok(broken.id === '' && broken.url === '', '空对象不炸：id/url 为空');
  ok(parseDynamicItem(null).text === '', 'null 也不炸');
}

console.log('\n## 排版');
{
  const text = formatDynamicMessage({ text: '正文', url: 'https://t.bilibili.com/1' }, { selfName: '小蓝' });
  ok(text.includes('小蓝'), '用配置里的账号名，不写死');
  ok(text.includes('正文'), '带正文');
  ok(text.includes('https://t.bilibili.com/1'), '带链接');

  const noName = formatDynamicMessage({ text: '正文' });
  ok(noName.includes('B站账号'), '没配名字就用中性称呼');

  const imageOnly = formatDynamicMessage({ images: ['a', 'b'] });
  ok(imageOnly.includes('2 张图'), '纯图片动态：说清有几张图');

  const long = formatDynamicMessage({ text: 'x'.repeat(500) });
  ok(long.length < 500 && long.includes('…'), '长正文会截断（不刷屏）');
}

console.log('\n## 增量计划：第一次只建基线');
{
  const items = [raw(1, '旧动态一', 100), raw(2, '旧动态二', 200)];
  const first = planDynamicSync({ items, now: 1000 });
  ok(first.baseline === true, '第一次：baseline');
  ok(first.fresh.length === 0, '第一次不倒历史进群');
  ok(Object.keys(first.nextState.seen).length === 2, '第一次把历史记为已见');
  ok(first.nextState.baselineAt === 1000, '记下基线时间');

  const empty = planDynamicSync({ items: [], state: null, now: 999 });
  ok(empty.baseline === true && empty.fresh.length === 0, '没有内容也建基线（下次就只看新的）');
}

console.log('\n## 增量计划：之后只推新的');
{
  const state = { version: 1, baselineAt: 500, seen: { 1: '2026-11-09T00:00:00.000Z' }, lastPollAt: 500 };
  const items = [raw(1, '看过了', 100), raw(3, '新动态C', 300), raw(2, '新动态B', 200)];
  const out = planDynamicSync({ items, state, now: 1000 });
  ok(out.baseline === false, '已建基线：不是第一次');
  ok(out.fresh.length === 2, '只挑出两条新的');
  ok(out.fresh[0].id === '2' && out.fresh[1].id === '3', '按发布时间升序（先发的先说）');
  ok(out.nextState.seen['2'] && out.nextState.seen['3'], '新的写进已见');
  ok(out.nextState.baselineAt === 500, '基线时间不变');
  ok(out.nextState.lastPollAt === 1000, '记录这次轮询时间');

  const again = planDynamicSync({ items, state: out.nextState, now: 2000 });
  ok(again.fresh.length === 0, '同一批再来一次：不重复推');
}

console.log('\n## 已见表有上限');
{
  const seen = {};
  for (let i = 0; i < 10; i++) seen[`id${i}`] = new Date(2026, 10, 1, 0, i).toISOString();
  const out = pruneSeen(seen, 3);
  ok(Object.keys(out).length === 3, '只留最近 3 条');
  ok(out.id9 && out.id8 && out.id7, '留的是最新的三条');

  const small = planDynamicSync({
    items: [raw(99, '新', 300)],
    state: { version: 1, baselineAt: 1, seen: Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`old${i}`, new Date(2026, 0, 1 + i).toISOString()])), lastPollAt: 1 },
    now: 1000,
    maxSeen: 3,
  });
  ok(Object.keys(small.nextState.seen).length === 3, '增量计划写入时也裁剪');
}

console.log('\n## 空状态');
{
  const s = emptyDynamicState();
  ok(s.baselineAt === 0 && Object.keys(s.seen).length === 0, '空状态：baseline 0 / seen 空');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
