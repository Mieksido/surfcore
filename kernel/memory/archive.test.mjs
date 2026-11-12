/**
 * 全量记忆卡 + 目的素材 测试
 * 跑法：node kernel/memory/archive.test.mjs
 *
 * 注意语义：全量卡是**叙事记忆里的另一张卡**（和衰减卡同级），
 * 它在**入库时**就写（不是等遗忘才写）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFullCard } from './narrative/full-card.js';
import { collectMaterials, topicOf } from '../purpose/materials.js';
import { createStore } from '../store/persist.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };
const NOW = Date.parse('2026-11-09T12:00:00');
const DAY = 86400000;

const rec = (text, { at = NOW, owner = false, media = [] } = {}) => ({
  text, media,
  from: { channel: 'c1', kind: 'private', actor: 'u1', at },
  to: { owner },
  importance: 30, source: 'user',
});

console.log('## 全量记忆卡（忘掉 ≠ 消失：入库时就留底）');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-arch-'));
  const store = createStore({ dir, now: () => NOW });
  const full = createFullCard({ store, now: () => NOW });

  full.append(rec('很久以前的事'));
  full.append(rec('另一件旧事'));
  ok(full.size() === 2, '全量卡里有两条');
  ok(fs.existsSync(path.join(dir, 'memory-full.jsonl')), '落到了 jsonl 文件');

  const hits = full.recall({ query: '很久以前' });
  ok(hits.length === 1 && hits[0].text === '很久以前的事', '按关键词召回');

  ok(full.recall({ query: '' , limit: 1 }).length === 1, '不填关键词：按条数上限取最近的');
  ok(full.recall({ query: '', withinDays: 1 }).length === 2, '时间窗过滤');

  // 坏一行不毁全部
  fs.appendFileSync(path.join(dir, 'memory-full.jsonl'), '{ 坏行\n');
  const after = full.recall({ query: '', limit: 10 });
  ok(after.length === 2, '坏行被跳过，好数据还在');

  const st = full.stats();
  ok(st.rows >= 2 && st.bytes > 0, '全量卡概况可用（行数/字节）');
  fs.rmSync(dir, { recursive: true, force: true });
}

{
  const full = createFullCard({ now: () => NOW });   // 没有 store：内存版
  full.append(rec('记得这件事'));
  ok(full.recall({ query: '这件事' }).length === 1, '无落盘时也能用（测试/离线）');
}

console.log('\n## 目的素材（从记忆里挑值得说的）');
{
  const records = [
    rec('今天看到一只猫躺在键盘上', { owner: false }),
    rec('主人说周五要见面，别忘了', { owner: true }),
    rec('好耶！！太开心了', { owner: false }),
    rec('嗯', { owner: false }),                       // 太短
    rec('很久以前的老事', { at: NOW - 30 * DAY }),      // 太旧
  ];
  const m = collectMaterials(records, { now: () => NOW, windowDays: 7 });
  ok(m.length >= 2, `挑出了 ${m.length} 条素材（短的、旧的被排除）`);
  ok(m[0].owner === 'owner', '跟主人有关的排第一（权重最高）');
  ok(m.some((x) => x.need === 'followup'), '约定类 → 追问（followup）');
  ok(m.some((x) => x.need === 'confide'), '情绪类 → 倾诉（confide）');
  ok(!m.some((x) => x.text === '嗯'), '太短的不进素材');
  ok(!m.some((x) => x.text.includes('很久以前')), '太旧的不进素材');

  const once = collectMaterials(records, { now: () => NOW, seen: ['今天看到一只猫'] });
  ok(!once.some((x) => x.text.startsWith('今天看到一只猫')), '已经说过的不再说（去重）');

  ok(topicOf('今天看到一只猫躺在键盘上').length <= 12, '主题抽取有长度上限');
  ok(collectMaterials([], {}).length === 0, '没有记录：返回空，不炸');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
