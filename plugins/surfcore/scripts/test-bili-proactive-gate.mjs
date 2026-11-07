/**
 * 「只回找你的人」（interact.proactive）回归 —— 2026-11-08 用户要求：
 *   没人 @ 她 / 回复她时，鱼不再主动发顶层评论、不去热评搭话、不做鱼群聚拢；
 *   回 @ 她 / 回复她的人、回自己动态下的评论、动态、私信分享全部照常。
 *
 * 为什么断言源码而不只断言函数：这个仓库的硬规矩是「工具层必须硬拦，不能只靠提示词」
 * （tools/lib/interact.mjs 文件头）。只改提示词的话，模型偶发手滑就会真发一条。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { proactiveAllowed } from '../tools/lib/interact.mjs';
import { DEFAULTS } from '../tools/lib/config.mjs';
import { normalizeBiliConfig } from '../lib/store.js';

const here = import.meta.dirname;
const read = (rel) => fs.readFileSync(path.join(here, '..', rel), 'utf8');

// ── ① 默认开：老用户升级后行为不变 ──────────────────────────────────────
assert.equal(DEFAULTS.interact.proactive, true, '默认必须是「主动开」，升级后行为不变');
assert.equal(proactiveAllowed({}), true, '缺省配置 = 允许主动');
assert.equal(proactiveAllowed({ interact: {} }), true, 'interact 里没写 = 允许主动');
assert.equal(proactiveAllowed({ interact: { proactive: false } }), false, '显式 false = 只回找你的人');

// ── ② 落盘不被丢 ────────────────────────────────────────────────────
// saveBiliConfig → normalizeBiliConfig 会重建整个对象；不在这里收敛，设置页一保存键就没了。
const normalized = normalizeBiliConfig({ interact: { proactive: false } });
assert.equal(normalized.interact.proactive, false, 'normalizeBiliConfig 必须保留 proactive=false');
assert.equal(normalizeBiliConfig({}).interact.proactive, true, '没写时补成 true');

// ── ③ 工具层硬拦：comment.mjs 真的 exit 3 ─────────────────────────────
const commentSrc = read('tools/commands/comment.mjs');
assert.ok(commentSrc.includes('assertProactiveAllowed'), 'comment.mjs 没接闸门函数');
assert.ok(
  commentSrc.includes("GATE_KIND === 'comment' || GATE_KIND === 'ta'"),
  '闸门必须只拦 comment（顶层主动）/ ta（搭话）两类',
);
assert.ok(
  commentSrc.includes('if (GATE &&'),
  '闸门必须挂在 GATE 里 —— 否则主人当场授权和 --share 分享型会被误伤',
);
assert.ok(
  commentSrc.includes(
    "const GATE_KIND = parent ? (TA ? 'ta' : FISH_GATHER ? 'comment' : DYN_KIND ? 'mine:' + DYN_KIND : 'reply') : 'comment'",
  ),
  'GATE_KIND 分类必须保持原样：reply / mine:* / 鱼群聚拢归 comment 的映射不能变',
);

// ── ④ 提示词同步：只加闸门不删 4.7/4.8 = 每轮撞闸白烧 token ─────────────
const schedulerSrc = read('lib/scheduler.js');
assert.ok(schedulerSrc.includes('proactiveAllowed'), 'scheduler 没读 proactive');
assert.ok(schedulerSrc.includes('只回找你的人'), '唤醒提示缺少「只回找你的人」分支');
assert.ok(
  schedulerSrc.includes('h >= 16 && proactiveAllowed(cfgNow)'),
  '搭话催进度必须跟着开关一起停（否则 16:00 后照样催她去搭话）',
);

// ── ⑤ 设置页能开回来 ────────────────────────────────────────────────
const clientSrc = read('lib/client.js');
assert.ok(clientSrc.includes('"interact.proactive"'), '设置页缺少 interact.proactive 开关');

// ── ⑥ 失败可见且可行动（AGENTS 1.7）：拒绝码 + 下一步提示 ────────────────
const interactSrc = read('tools/lib/interact.mjs');
assert.ok(interactSrc.includes('BILI_PROACTIVE_DISABLED'), '缺少机器可读的拒绝码');
assert.ok(interactSrc.includes('建议：'), '拒绝时必须给出下一步（去哪个设置页开回来）');

console.log('bili proactive gate tests OK');
