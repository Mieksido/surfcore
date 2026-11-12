/**
 * 语音导入计划测试（纯函数，不碰盘）
 * 跑法：node kernel/voice/import.test.mjs
 */
import {
  VOICE_AUDIO_EXTS, isVoiceAudioFile, voiceEntryFromFile, planVoiceImport,
} from './import.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 哪些文件算语音');
{
  ok(VOICE_AUDIO_EXTS.includes('.wav') && VOICE_AUDIO_EXTS.includes('.mp3'), '支持 wav/mp3');
  ok(isVoiceAudioFile('晚安.wav'), 'wav：可以');
  ok(isVoiceAudioFile('晚安.MP3'), '大小写不敏感');
  ok(!isVoiceAudioFile('晚安.txt'), 'txt：不行');
  ok(!isVoiceAudioFile('晚安'), '没扩展名：不行');
  ok(!isVoiceAudioFile(''), '空：不行');
}

console.log('\n## 文件名 → 条目');
{
  const e = voiceEntryFromFile('D:/audio/晚安呀.mp3', { emotion: '安慰', tags: ['晚安', '温柔'], note: '睡前' });
  ok(e.id === '晚安呀' && e.name === '晚安呀', 'id/name 去扩展名');
  ok(e.emotion === '安慰' && e.tags.length === 2, '情绪/标签来自参数');
  ok(e.note === '睡前', '备注');
  ok(e.durationMs === null, '时长不知道就 null（不编）');

  ok(voiceEntryFromFile('x.txt') === null, '非音频：null');
  ok(voiceEntryFromFile('.wav') === null, '只有扩展名：null（没 id）');
  const long = voiceEntryFromFile(`${'a'.repeat(100)}.wav`);
  ok(long.id.length <= 64, 'id 有长度上限');
}

console.log('\n## 导入计划：去重 / 过滤 / 上限');
{
  const plan = planVoiceImport({
    files: ['a.wav', 'b.mp3', 'c.txt', 'a.mp3', 'd.ogg'],
    existingIds: ['b'],
    defaults: { emotion: '开心', tags: ['x'] },
    maxEntries: 4,
  });
  ok(plan.entries.length === 2, '只收 a.wav、d.ogg');
  ok(plan.entries[0].id === 'a' && plan.entries[1].id === 'd', '按文件名生成 id');
  ok(plan.skipped.find((s) => s.file === 'c.txt')?.reason === 'unsupported', 'txt 跳过');
  ok(plan.skipped.find((s) => s.file === 'a.mp3')?.reason === 'duplicate', '同 id 跳过');
  ok(plan.skipped.find((s) => s.file === 'b.mp3')?.reason === 'duplicate', '库里已有：跳过');
  ok(plan.entries.every((e) => e.emotion === '开心'), '默认情绪应用');

  const full = planVoiceImport({ files: ['a.wav', 'b.wav'], existingIds: ['1', '2'], maxEntries: 2 });
  ok(full.entries.length === 0 && full.skipped[0].reason === 'library-full', '库满：不收');

  ok(planVoiceImport({ files: [] }).entries.length === 0, '空列表：空');
  ok(planVoiceImport({ files: ['a.wav'], maxEntries: 0 }).entries.length === 1, '上限 0 当 1（至少收一个）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
