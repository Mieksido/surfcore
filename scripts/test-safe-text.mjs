/**
 * 孤立代理项（lone surrogate）回归 —— 桌宠对话一直 400 的根因。
 *
 * 现象：桌宠 /chat 与主动搭话返回 `DeepSeek Messages request failed (400)`；用极短系统提示或去掉系统提示都能成功，
 * 逐行累加真实系统提示，第 46 行开始失败。那一行是「最近在想的：…」，来自目的状态里的 goal.intent，
 * 其中一条以 `…折\ud83d…」` 结尾：purpose-engine 的 clip() 用 `s.slice(0, max)` 按 UTF-16 单元截断，
 * 正好把一个 emoji（😭，两个 UTF-16 单元）劈成两半，留下孤立的高位代理。它能存进 JSON、能拼进提示词，
 * 但请求体不合法，DeepSeek 直接 400，响应里还没有 error.message。
 *
 * 钉住：
 *   1. sliceHead / clipText 在任意截断点都不产生孤立代理项（对一整段含 emoji 的文本逐个长度扫描）；
 *   2. wellFormed / deepWellFormed 把漏网的孤立代理项替换成 U+FFFD，没有问题时返回原引用；
 *   3. purpose-engine（零 import，内联实现）与 memory-card 的截断同样安全；
 *   4. pet-chat 的 complete()：即使系统提示 / 用户消息里带孤立代理项，发给 llm.stream 的也是合法文本。
 *
 * 纯逻辑，不连 DSH / QQ。运行：node scripts/test-safe-text.mjs
 */
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

import { sliceHead, clipText, wellFormed, isWellFormed, deepWellFormed } from '../src/safe-text.js';
import { formatMaterialLine } from '../src/purpose-engine.js';
import { createPetChatService } from '../plugins/surfcore/lib/pet-chat.js';

let failures = 0;
function test(name, run) {
  try { run(); console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, error.message); }
}
async function testAsync(name, run) {
  try { await run(); console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, error.message); }
}

const CRY = String.fromCodePoint(0x1F62D);          // 😭：两个 UTF-16 单元
const HIGH_ONLY = '\ud83d';                          // 劈开后残留的孤立高位代理
const LOW_ONLY = '\ude2d';
const sample = `别炒股，赔了token又折${CRY}${CRY}${CRY} 哈哈${CRY}`;

test('原始 bug：slice 会劈开 emoji，留下孤立高位代理', () => {
  const cut = sample.slice(0, sample.indexOf(CRY) + 1);   // 恰好切在 😭 的两个单元中间
  assert.equal(isWellFormed(cut), false, '这个断言证明旧写法确实会产生非法文本');
});

test('sliceHead：任意截断点都合法，且不多不少（只在劈开代理对时少取 1 个单元）', () => {
  for (let n = 0; n <= sample.length + 2; n += 1) {
    const cut = sliceHead(sample, n);
    assert.ok(isWellFormed(cut), `n=${n}`);
    assert.ok(cut.length <= n && cut.length >= Math.min(n, sample.length) - 1, `n=${n} len=${cut.length}`);
    assert.ok(sample.startsWith(cut), `n=${n}`);
  }
  assert.equal(sliceHead('abc', 10), 'abc');
  assert.equal(sliceHead('abc', 0), '');
  assert.equal(sliceHead(null, 5), '');
});

test('clipText：压空白 + 省略号，截断点不劈开代理对', () => {
  for (let max = 2; max <= sample.length + 2; max += 1) {
    const out = clipText(sample, max);
    assert.ok(isWellFormed(out), `max=${max}`);
  }
  assert.equal(clipText('  a   b  ', 10), 'a b');
  assert.equal(clipText('abcdef', 4), 'abc…');
  assert.equal(clipText('a\r\nb', 10, { keepNewlines: true }), 'a\nb');
});

test('wellFormed：孤立代理项 → U+FFFD，正常文本（含完整 emoji）原样', () => {
  assert.equal(wellFormed(`a${HIGH_ONLY}b`), 'a�b');
  assert.equal(wellFormed(`a${LOW_ONLY}b`), 'a�b');
  assert.equal(wellFormed(`${CRY}`), CRY);
  assert.equal(wellFormed(`x${HIGH_ONLY}`), 'x�');
  assert.equal(wellFormed(null), '');
  assert.ok(isWellFormed(wellFormed(`${HIGH_ONLY}${HIGH_ONLY}${LOW_ONLY}`)));
});

test('deepWellFormed：递归修复，不改入参；没问题时返回同一个引用', () => {
  const clean = { a: 'x', b: [1, 'y', { c: CRY }] };
  assert.equal(deepWellFormed(clean), clean);
  const dirty = { a: `p${HIGH_ONLY}`, b: [{ c: `q${LOW_ONLY}` }, 3, null], buf: Buffer.from('hi') };
  const fixed = deepWellFormed(dirty);
  assert.notEqual(fixed, dirty);
  assert.equal(fixed.a, 'p�');
  assert.equal(fixed.b[0].c, 'q�');
  assert.equal(fixed.b[1], 3);
  assert.equal(fixed.buf, dirty.buf, 'Buffer 等非普通对象不碰');
  assert.equal(dirty.a, `p${HIGH_ONLY}`, '入参不被修改');
  assert.ok(isWellFormed(JSON.stringify(fixed)));
});

test('purpose-engine：素材行里的截断不再产生孤立代理项（原 bug 的出处）', () => {
  // clip(text, 140) / clip(quote, 60)：用不同长度的前缀把 emoji 依次推到截断点上，覆盖「正好劈在中间」的位置。
  for (let pad = 0; pad < 8; pad += 1) {
    const filler = '字'.repeat(pad);
    const body = `${filler}${CRY.repeat(80)}`;
    const line = formatMaterialLine({ source: 'memory', kind: 'memory', text: body, quote: body, at: Date.now() }, Date.now());
    assert.ok(isWellFormed(line), `pad=${pad}: ${JSON.stringify(line.slice(-40))}`);
  }
});

await testAsync('pet-chat complete()：系统提示 / 用户消息里的孤立代理项在发给模型前被修掉（老数据兜底）', async () => {
  const captured = [];
  const llm = {
    stream(options) {
      captured.push(options);
      return (async function* () { yield { type: 'text-delta', text: '在的' }; yield { type: 'finish', reason: { kind: 'stop' } }; })();
    },
  };
  const ctx = {
    get(name) {
      if (name === 'llm') return llm;
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'p', model: 'm' }) };
      return null;
    },
  };
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-safe-text-'));
  try {
    const svc = createPetChatService({ ctx, stateDir, pluginLog: () => {} });
    const r = await svc.complete({ system: `最近在想的：突然想起「…折${HIGH_ONLY}…」`, user: `在吗${LOW_ONLY}` });
    assert.equal(r.text, '在的');
    const sent = captured[0];
    assert.ok(isWellFormed(sent.system), JSON.stringify(sent.system));
    assert.ok(isWellFormed(sent.messages[0].content[0].text));
    assert.match(sent.system, /�/);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

if (failures) {
  console.error(`\n${failures} 项失败`);
  process.exit(1);
}
console.log('\n全部通过');
