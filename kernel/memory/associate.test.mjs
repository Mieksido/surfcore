/**
 * 关联/联想测试（顾问说的"跨视频关联"，其实是检索，不是渠道概念）
 * 跑法：node kernel/memory/associate.test.mjs
 */
import { relatedTo, cluster } from './associate.js';
import { createMemoryKernel } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const NOW = 1000;
const rec = (text, tags = [], at = NOW) => ({ text, tags, from: { channel: 'c', at }, to: {}, media: [] });

console.log('## 强关联：共有标签');
{
  const a = rec('看了个修猫视频', ['bvid:BV1', 'up:阿猫']);
  const b = rec('这个 UP 又发了新视频', ['bvid:BV1']);
  const c = rec('今天天气不错');
  const hits = relatedTo(a, [a, b, c], { max: 3 });
  ok(hits.length === 1 && hits[0].record === b, '同一个 bvid：关联上了');
  ok(hits[0].via.startsWith('标签:'), '说明靠什么关联的');
  ok(hits[0].score >= 3, '标签关联分数更高');
}

console.log('\n## 弱关联：词重合');
{
  const pool = [rec('主人说周五要去看那只猫'), rec('完全不相关的内容'), rec('那只猫又来了')];
  const hits = relatedTo({ text: '那只猫今天怎么样' }, pool, { max: 3 });
  ok(hits.length >= 1, '有重合词的能找回来');
  ok(hits.every((h) => /同词|标签/.test(h.via)), '每条都写清靠什么');
  ok(hits[0].record.text.includes('猫'), '最相关的排前面');
}

console.log('\n## 边界');
{
  ok(relatedTo({ text: 'abc' }, []).length === 0, '空池：空结果');
  const a = rec('重复自己');
  ok(relatedTo(a, [a], { max: 3 }).length === 0, '不和自己关联');
  ok(relatedTo({ text: 'x' }, [rec('y')], { max: 3 }).length === 0, '没有共同点：不硬凑');
  ok(relatedTo({ text: '主人说那只猫很可爱' }, [rec('昨天主人说那只猫很可爱'), rec('那只猫很可爱啊')], { max: 1 }).length === 1, '受上限约束');
}

console.log('\n## 主题簇');
{
  const records = [
    rec('猫视频 1', ['bvid:1', 'up:A']),
    rec('猫视频 2', ['bvid:1']),
    rec('猫视频 3', ['bvid:1']),
    rec('狗视频', ['bvid:2']),
  ];
  const clusters = cluster(records, { minSize: 2 });
  ok(clusters.length === 1 && clusters[0].key === 'bvid:1', '只有够大的簇才出（3 条）');
  ok(clusters[0].size === 3, '簇大小正确');
  ok(cluster(records, { minSize: 5 }).length === 0, 'minSize 不够：不输出');
}

console.log('\n## 接进内核：想起别的什么');
{
  const k = createMemoryKernel({ now: () => NOW });
  const from = { channel: 'c1', kind: 'private', actor: 'o', at: NOW };
  k.ingest({ text: '主人说周五要去看那只猫', from, to: { owner: true }, tags: ['topic:猫'] });
  const second = k.ingest({ text: '那只猫今天又来了', from: { ...from, at: NOW + 1000 }, to: { owner: true }, tags: ['topic:猫'] });
  const viewer = { channelId: 'c1', kind: 'private', isOwner: true };
  const related = k.recall({ text: second.text, tags: second.tags, viewer, exclude: second, max: 3 });
  ok(related.length >= 1, '能想起前一条');
  ok(related[0].record.text.includes('周五'), '想起的是那条旧记录');
  const clusters = k.clusters(viewer, { minSize: 2 });
  ok(clusters.length >= 1 && clusters[0].key === 'topic:猫', '同一主题被聚在一起');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
