#!/usr/bin/env node
// 星图页面的静态检查：只读 public/brain.html 和 src/bridge.js，不起服务、不发请求。
//
// 为什么要有这一条：这页是从另一个项目（dsh-memory-brain）整页搬过来的，
// 那边的数据源（账本 / 话题块 / 实体 / 日记 / 自己的生活 / memory-rag）SurfCore 一个都没有。
// 搬过来之后最容易出的错不是崩，而是**悄悄地指向不存在的东西**：
// 调用一个桥接没有的路由（页面照旧打开，只是那块永远空着）、或者文案还在讲账本和五路检索，
// 让人以为这些数据是真的。静态检查是唯一能在不启动浏览器的情况下钉住这类问题的手段。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'public', 'brain.html'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'src', 'bridge.js'), 'utf8');

let bad = 0;
const ok = (cond, name, extra = '') => {
  if (cond) console.log(`  OK   ${name}${extra ? ' — ' + extra : ''}`);
  else { bad++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
};

console.log('## 内联脚本能不能编译');
const scripts = [...PAGE.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)]
  .map((m) => ({ attrs: m[1] || '', code: m[2] }))
  .filter((s) => !/\bsrc=/.test(s.attrs));
ok(scripts.length > 0, '有内联脚本', `${scripts.length} 段`);
scripts.forEach((s, i) => {
  try { new vm.Script(s.code, { filename: `brain.html#${i}` }); ok(true, `第 ${i + 1} 段可编译`, `${s.code.length} 字符`); }
  catch (e) { ok(false, `第 ${i + 1} 段可编译`, e.message); }
});

console.log('## 安全约束（跟控制台同一条：不引外部资源、不拼 HTML）');
ok(!/https?:\/\//i.test(PAGE), '整页不出现 http:// / https://');
ok(!/<script\b[^>]*\bsrc\s*=/i.test(PAGE), '没有 <script src>');
ok(!/@import/i.test(PAGE), '没有 @import');
ok(!/\beval\s*\(/.test(PAGE), '没有 eval(');
ok(!/new\s+Function\b/.test(PAGE), '没有 new Function');
ok(!/\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write/.test(PAGE), '不用 innerHTML / outerHTML / insertAdjacentHTML / document.write');
ok(/<meta name="viewport"/.test(PAGE), '有 viewport');

console.log('## 接口契约：页面调用的每个 /api/brain/* 都必须真的存在');
const called = [...new Set([...PAGE.matchAll(/['"`](\/api\/brain\/[a-z-]+)/g)].map((m) => m[1]))].sort();
ok(called.length > 0, '页面有调用星图接口', called.join(' '));
for (const route of called) {
  const name = route.replace('/api/brain/', '');
  ok(BRIDGE.includes(`'${route}`) || BRIDGE.includes(`url.pathname === '${route}`), `桥接里有 ${route}`);
  ok(BRIDGE.includes(`/api/brain/${name}`), `桥接里提到过 ${name}`);
}
// 反向：桥接实现了但页面没在用 —— 允许（SSE 之外还有给控制台的），但 chunk 这种必须不存在
ok(!BRIDGE.includes("'/api/brain/chunk'"), '桥接没有 /api/brain/chunk（这一版正文随快照一起给）');
ok(PAGE.includes('x-console-token'), '请求带控制台令牌');
ok(/new EventSource\(/.test(PAGE), '用 EventSource 收实时事件');

console.log('## 文案：不能再指向 B 项目才有的东西');
// 注释里允许出现（要说明来龙去脉），所以要先把注释剥掉再查
const body = PAGE.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const BANNED = [
  ['记账本', 'B 项目的账本工具'],
  ['账本条目', 'B 项目的账本'],
  ['话题块', 'B 项目的话题切块'],
  ['五路', 'B 项目的五路检索'],
  ['own-life', 'B 项目的自主生活'],
  ['memory-rag', 'B 项目的 memory-rag 服务'],
  ['long-memory', 'B 项目的 long-memory.js'],
  ['ledger-suggest', 'B 项目的账本建议'],
  ['FSRS-5', 'FSRS 是移植计划里后面的一件'],
];
for (const [word, why] of BANNED) ok(!body.includes(word), `正文里没有「${word}」`, why);

console.log('## 术语：页面认识的 kind 必须和快照发的一模一样');
const kinds = [...PAGE.matchAll(/^\s{2}(\w+):\{name:'/gm)].map((m) => m[1]);
for (const k of ['owner', 'event', 'promise', 'firstMeet', 'other']) ok(kinds.includes(k), `KINDS 里有 ${k}`);
for (const k of ['trait', 'fact', 'pending', 'note', 'chunk', 'sum']) ok(!kinds.includes(k), `KINDS 里没有 B 的 ${k}`);
// 快照的 catOf 只会给这几种（src/brain-feed.js 里的 CATS + 兜底）
const FEED = fs.readFileSync(path.join(ROOT, 'src', 'brain-feed.js'), 'utf8');
for (const c of ['owner', 'event', 'promise', 'firstMeet', 'other']) ok(FEED.includes(`'${c}'`), `brain-feed 认得 ${c}`);

console.log('## 事件载荷：页面要读的字段，桥接必须真的发出来');
// 这一类错最贵：事件照样推下来、页面照样渲染，只是永远显示「成功」「0 段」「原因：undefined」。
// 活体验证时踩过三个（rag.index 少了 added/total、search 把数组发成条数、tool 在调用时就发），
// 所以这里按「页面读什么 → 桥接发什么」逐条钉住。
const payloadOf = (type) => {
  // 从 brainEmit('<type>' 开始截到同层的 });（星图的调用点都是单层对象字面量）
  const start = BRIDGE.indexOf(`brainEmit('${type}'`);
  if (start < 0) return '';
  const end = BRIDGE.indexOf('});', start);
  // 往前带一段：有的载荷先攒成 dataset 字面量再交给 emit（search 就是）
  return BRIDGE.slice(Math.max(0, start - 1600), end < 0 ? start + 800 : end);
};
for (const [type, fields] of [
  ['rag.index', ['added', 'total']],
  ['search', ['query', 'items', 'ms', 'source']],
  ['tool', ['name', 'ok']],
  ['wake', ['reason']],
  ['inject', ['ltm', 'chars']],
  ['remember', ['node', 'text']],
  ['msg.in', ['name', 'text']],
  ['msg.out', ['name', 'text']],
]) {
  const sent = payloadOf(type);
  ok(sent.includes(`brainEmit('${type}'`), `桥接发 ${type}`, '页面要渲染它');
  // 用词边界只看整词：只查 includes 会把 token 当成 tool 的子串放过
  for (const f of fields) ok(new RegExp('\\b' + f + '\\b').test(sent), `${type} 的载荷里有 ${f}`, '页面读它');
}

console.log('## 唤醒原因：桥接会发的每个值，页面都得有中文名');
// 漏一个就会在事件条和回放里露出内部代号（anyMessage / replyCheck …）。
const table = PAGE.match(/const WAKE_REASON = \{[\s\S]*?\n\};/);
const known = new Set(table ? [...table[0].matchAll(/(?:'([^']+)'|([A-Za-z][\w-]*))\s*:/g)].map((m) => m[1] || m[2]) : []);
for (const r of ['anyMessage', 'atMention', 'nameMention', 'private', 'question', 'probability',
  'timeout', 'replyCheck', 'proactiveCheck', 'bootstrap', 'admin', 'history', 'backlog', 'promiseDue', 'purpose']) {
  ok(known.has(r), `WAKE_REASON 里有 ${r}`, '桥接真的会发它');
}

console.log('## 唤醒原因表与桥接的真实来源对得上（不只对上面这张清单）');
// 更好的反向约束：从 TIMER_WAKE_REASONS 里读出桥接真实会发的定时器原因，
// 逐个要求页面有中文名 —— 将来再往桥接加一个原因，忘了改页面就会在这里红。
try {
  const bridgeSrc = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
  const setMatch = bridgeSrc.match(/const TIMER_WAKE_REASONS = new Set\(\[([^\]]*)\]\)/);
  ok(Boolean(setMatch), '能从 bridge.js 里读到 TIMER_WAKE_REASONS');
  const reasonList = setMatch ? [...setMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
  ok(reasonList.length >= 5, `TIMER_WAKE_REASONS 读出 ${reasonList.length} 个原因`);
  for (const r of reasonList) {
    ok(known.has(r), `页面有 ${r} 的中文名（来自 TIMER_WAKE_REASONS）`, '别让事件条露出内部代号');
  }
} catch (error) {
  ok(false, '读取 bridge.js 的 TIMER_WAKE_REASONS', error.message);
}

console.log(bad === 0 ? '\nbrain page tests OK' : `\n${bad} 项失败`);
process.exit(bad === 0 ? 0 : 1);
