#!/usr/bin/env node
/**
 * 发布后第一次真机唤醒的自检。
 *
 * 为什么单独写一个：唤醒提示词里那四段可选注入（检索 / 联想 / 候选 / 约定）都是
 * 「有内容才加字节」，所以「没报错」不等于「接上了」。真正能证明链路通的是
 * `state/context-telemetry-bridge.jsonl` 里 `kind:"wake"` 那条事件的 layers ——
 * 它记的是本次唤醒实际拼进去的每一段长度。
 *
 * 用法：
 *   node scripts/wake-selfcheck.mjs              # 看最近一次唤醒
 *   node scripts/wake-selfcheck.mjs --last 5     # 最近五次
 *   node scripts/wake-selfcheck.mjs --json       # 原始结构，给脚本用
 *   node scripts/wake-selfcheck.mjs --file <路径> # 指定的遥测文件
 *
 * 退出码：0 正常；1 找不到遥测文件或文件里没有唤醒事件（此时说明还没被叫醒过）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = path.join(ROOT, 'state');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json');
const lastIdx = args.indexOf('--last');
const lastN = lastIdx >= 0 ? Math.max(1, Number(args[lastIdx + 1]) || 1) : 1;
const fileIdx = args.indexOf('--file');
const file = fileIdx >= 0
  ? path.resolve(args[fileIdx + 1])
  : path.join(STATE_DIR, 'context-telemetry-bridge.jsonl');

/** 四段记忆注入 + 记忆卡正文，按「该不该有内容」分组，便于一眼看出哪段没接上。 */
const MEMORY_LAYERS = [
  ['memory', '记忆卡正文'],
  ['memoryRecall', '检索（对方提到的那件事）'],
  ['associate', '联想（快淡忘的旧事）'],
  ['suggest', '候选（关于他自己的事）'],
  ['promise', '约定（到期要提）'],
];

function readWakes(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (obj && obj.kind === 'wake') out.push(obj);
  }
  return out;
}

function pad(text, width) {
  const s = String(text);
  // 中文按两列算，避免表格歪掉
  let cols = 0;
  for (const ch of s) cols += ch.codePointAt(0) > 0x2e80 ? 2 : 1;
  return s + ' '.repeat(Math.max(0, width - cols));
}

function localTime(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function ago(ms, now = Date.now()) {
  const diff = Math.max(0, now - ms);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时 ${min % 60} 分钟前`;
  return `${Math.floor(hr / 24)} 天前`;
}

if (!fs.existsSync(file)) {
  console.error(`找不到遥测文件：${file}`);
  console.error('（桥接没跑过，或 STATE_DIR 不在默认位置 —— 用 --file 指定）');
  process.exit(1);
}

const wakes = readWakes(file);
if (!wakes.length) {
  console.error(`遥测文件里还没有唤醒事件：${file}`);
  console.error('说明发布后还没被叫醒过（或桥接刚重启、日志还在旧文件里）。');
  process.exit(1);
}

const picked = wakes.slice(-lastN);

if (jsonOut) {
  console.log(JSON.stringify(picked.map((w) => ({
    at: new Date(w.ts).toISOString(),
    key: w.key,
    reason: w.reason || '',
    promptChars: w.layers?.prompt ?? null,
    layers: w.layers ?? {},
  })), null, 2));
  process.exit(0);
}

for (const w of picked) {
  const layers = w.layers ?? {};
  console.log('');
  console.log(`唤醒 @ ${localTime(w.ts)}（${ago(w.ts)}）  key=${w.key || '?'}  reason=${w.reason || '?'}`);
  console.log(`提示词 ${layers.prompt ?? '?'} 字（base ${layers.base ?? '?'} + 快照 ${layers.snapshot ?? 0} 等）`);
  for (const [field, label] of MEMORY_LAYERS) {
    const len = Number(layers[field] ?? 0);
    console.log(`  ${pad(label, 34)} ${len > 0 ? `✅ ${len} 字` : '—  0'}`);
  }
  const injected = MEMORY_LAYERS.filter(([f]) => Number(layers[f] ?? 0) > 0).map(([, l]) => l.split('（')[0]);
  if (injected.length) {
    console.log(`  → 本次注入了：${injected.join('、')}`);
  } else {
    console.log('  → 本次四段都没注入（可能这轮本来就不需要，也可能是没数据/没触发词）');
  }
}

console.log('');
console.log('怎么读：');
console.log('  · 「检索」有字节 = 第 1 件接上了；对方那句话里得有触发词（记得/上次/之前…）。');
console.log('  · 「联想」有字节 = 第 6 件接上了；而且要档案里有 R 落在 0.2~0.7 的旧事，新库通常要等衰减。');
console.log('  · 「候选」有字节 = 第 4 件接上了；前提是之前有私聊/主人说过「我不吃…」「我住在…」这类话。');
console.log('  · 「约定」有字节 = 第 5 件接上了；得先有一条明天/今天到期的约定，且当前在提醒窗口内（默认 10:00 后）。');