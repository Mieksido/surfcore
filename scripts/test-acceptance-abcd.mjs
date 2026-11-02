// 2026-11-01 验收报告 A–D 的回归：结构化 403 / 密钥打码 / 目的历史不串文案 / 超时 code 必填。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label} ${extra}`); }
};

// 1) 明确密钥形态：必须打码；正常文本/哈希不能误伤
{
  const { SECRET_TOKEN_RE } = await import('../src/sensitive.js');
  const hits = (text) => new RegExp(SECRET_TOKEN_RE.source, 'g').test(text);
  ok(hits('github_pat_11ABCDEFG0123456789_abcdefghijklmnop'), 'github_pat_ 被识别');
  ok(hits('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'ghp_ 被识别');
  ok(hits('sk-proj-abcdefghijklmnopqrstuvwxyz'), 'sk- 被识别');
  ok(hits('AKIAABCDEFGHIJKLMNOP'), 'AKIA 被识别');
  ok(hits('Bearer abcdefghijklmnopqrstuvwxyz.012345'), 'Bearer 被识别');
  ok(!hits('这是普通消息，没有密钥'), '普通消息不误伤');
  ok(!hits('d41d8cd98f00b204e9800998ecf8427e'), '32 位 md5 不误伤');
}

// 2) 目的历史：silent/failed 不继承上一次文案，并记录 skipReason
{
  const { createPurposeState, applyPurposeOutcome, DEFAULT_PURPOSE_CONFIG } = await import('../src/purpose-engine.js');
  const now = Date.now();
  const state = createPurposeState(now);
  applyPurposeOutcome(state, {
    now, config: DEFAULT_PURPOSE_CONFIG, outcome: 'sent', text: '今天想问你一件事',
    planned: { text: '计划', need: 'play' },
  });
  ok(state.lastText === '今天想问你一件事', 'sent 记录真实文案');
  applyPurposeOutcome(state, {
    now: now + 1000, config: DEFAULT_PURPOSE_CONFIG, outcome: 'silent', text: '', skipReason: 'model-silent',
    planned: { text: '计划', need: 'play' },
  });
  ok(state.lastText === '', 'silent 清空 lastText（不沿用上一句）', state.lastText);
  const last = state.history[state.history.length - 1];
  ok(last.text === '' && last.skipReason === 'model-silent', 'silent 历史 text 为空 + skipReason', JSON.stringify(last));
  ok(state.lastSkipReason === 'model-silent', '快照带 lastSkipReason');
}

// 3) 桥接接线：A / B / D 的关键分支必须存在
{
  const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
  ok(bridge.includes("url.pathname === '/api/notify/owner'"), 'notify/owner 进入 agent-token 白名单');
  ok(bridge.includes("url.pathname === '/api/notice/timeout'"), 'notice/timeout 进入白名单');
  ok(bridge.includes("code: 'CONSOLE_ONLY'"), '外层通用 403 带 code/hint');
  ok(bridge.includes("TIMEOUT_CODE_REQUIRED"), '空 code 返回结构化 400');
  ok(!/body\\.code \\?\\? 'TIMEOUT'/.test(bridge), '不再默认 TIMEOUT');
  ok(bridge.includes('noteSecretInInbound'), '入站密钥检测存在');
  ok(bridge.includes('SECRET_TOKEN_RE'), '日志/活动脱敏使用 SECRET_TOKEN_RE');
  ok(bridge.includes("new RegExp(SECRET_TOKEN_RE.source, 'g'), '***'"), 'redactKnownTokensOnly 也打码密钥');
  ok(/function appendPublicFeed[\s\S]{0,300}redactSensitiveText/.test(bridge), '公共群消息日志也打码（同类漏洞）');
}

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
console.log('\n✅ 验收报告 A–D 回归通过');
