/**
 * 语音库测试（旧 voice-packs 的可复用那一半）
 * 跑法：node kernel/voice/library.test.mjs
 */
import { createVoiceLibrary, normalizeVoice, DEFAULT_LIBRARY } from './library.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 校验：不合格整条丢掉，给原因');
{
  ok(normalizeVoice({ name: '小鲸鱼' }).ok, '有名字就能进');
  ok(normalizeVoice({}).error === '缺少 id', '没名字：拒绝');
  ok(normalizeVoice({ id: 'a', durationMs: -1 }).error.includes('时长'), '负数时长：拒绝');
  ok(normalizeVoice({ id: 'a', durationMs: 1200 }).value.durationMs === 1200, '时长保留');
  const dirty = normalizeVoice({ id: 'a', name: 'x'.repeat(100), tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] });
  ok(dirty.value.name.length <= DEFAULT_LIBRARY.maxNameChars, '名字限长');
  ok(dirty.value.tags.length <= DEFAULT_LIBRARY.maxTags, '标签限条数');
  ok(normalizeVoice({ id: 'a', note: 'x\u0000y' }).value.note === 'xy', '控制字符被去掉');
}

console.log('\n## 注册与去重');
{
  const lib = createVoiceLibrary({ now: () => 1000 });
  ok(lib.register({ id: 'v1', name: '软软的', emotion: '卖萌' }).ok, '注册成功');
  ok(lib.register({ id: 'v1', name: '重复' }).error === 'already-exists', '重复 id：不覆盖');
  ok(lib.size() === 1, '还是 1 个');
  ok(lib.register({ id: 'v2', name: '低音', tags: ['旁白'] }).ok, '第二个');
  ok(lib.remove('v2') === true && lib.size() === 1, '删除');
}

console.log('\n## 挑声音：情绪优先、标签其次、用得少优先');
{
  const lib = createVoiceLibrary({ now: () => 1000 });
  lib.register({ id: 'happy', name: '开心音', emotion: '开心' });
  lib.register({ id: 'sad', name: '难过音', emotion: '难过', tags: ['低声'] });
  lib.register({ id: 'any', name: '普通音' });

  ok(lib.pick({ emotion: '开心' }).id === 'happy', '情绪对得上：挑它');
  ok(lib.pick({ emotion: '难过' }).id === 'sad', '另一个情绪：挑另一个');
  ok(lib.pick({ emotion: '惊讶' }) === null, '没有这个情绪：null（不硬凑）');
  ok(lib.pick({ tags: ['低声'] }).id === 'sad', '按标签挑');
  ok(lib.pick({}) !== null, '什么都不给：随便给一个（不限）');

  lib.markUsed('happy'); lib.markUsed('happy');
  ok(lib.pick({}) !== null, '用过的照样能挑');
  ok(lib.stats().total === 3 && lib.stats().byEmotion['开心'] === 1, '统计按情绪');
}

console.log('\n## 语言过滤');
{
  const lib = createVoiceLibrary();
  lib.register({ id: 'zh', name: '中文', lang: 'zh' });
  lib.register({ id: 'jp', name: '日文', lang: 'jp' });
  ok(lib.pick({ lang: 'jp' }).id === 'jp', '按语言挑');
  ok(lib.pick({ lang: 'en' }) === null, '没有这个语言：null');
}

console.log('\n## 落盘往返');
{
  const lib = createVoiceLibrary({ now: () => 1000 });
  lib.register({ id: 'v1', name: '一', emotion: '开心' });
  lib.markUsed('v1');
  const snap = lib.snapshot();
  const lib2 = createVoiceLibrary();
  lib2.restore(snap);
  ok(lib2.size() === 1 && lib2.get('v1').uses === 1, '恢复后使用次数也在');
  ok(lib2.pick({ emotion: '开心' }).id === 'v1', '恢复后照样挑得出来');
}

console.log('\n## 上限');
{
  const lib = createVoiceLibrary({ max: 2 });
  for (let i = 0; i < 5; i++) lib.register({ id: `v${i}`, name: `第${i}个` });
  ok(lib.size() === 2, '受上限约束');
  ok(lib.get('v0') === null, '最早被挤掉');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
