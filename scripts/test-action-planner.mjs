// Action Planner 第一版：只做 close 幂等，不自动合并写操作。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planClose } from '../src/action-planner.js';

assert.equal(planClose({ st: null }).blocked, false);
const st = { lastActionAt: 100, closure: { at: 100, cooldownUntil: 500, summary: '收尾', nextOpening: '下次' } };
const repeat = planClose({ st, now: 200 });
assert.equal(repeat.blocked, true);
assert.equal(repeat.code, 'ALREADY_CLOSED');
assert.equal(repeat.alreadyClosed, true);
assert.equal(repeat.summary, '收尾');

const afterSend = { lastActionAt: 300, closure: { at: 100 } };
assert.equal(planClose({ st: afterSend }).blocked, false, '发送后允许再次收尾');
const reopened = { lastActionAt: 100, closure: { at: 100, reopenedAt: 200 } };
assert.equal(planClose({ st: reopened }).blocked, false, '重开后允许收尾');

const failed = planClose({ st: { lastActionAt: 100 }, sendFailed: true });
assert.equal(failed.blocked, true);
assert.equal(failed.code, 'CLOSE_AFTER_SEND_FAILED');
assert.equal(failed.nextStep, 'send');
// 2026-11-04：失败记录过期 / 明确放弃 时不应永久挡着收尾
const stale = planClose({ st: { lastActionAt: 100 }, sendFailed: true, sendFailedAgeMs: 11 * 60 * 1000 });
assert.equal(stale.blocked, false, '失败超过 10 分钟应放行');
assert.equal(stale.staleSendFailure, true);
const abandoned = planClose({ st: { lastActionAt: 100 }, sendFailed: true, allowAbandon: true });
assert.equal(abandoned.blocked, false, '明确放弃本轮应放行');
assert.equal(abandoned.abandonedSendFailure, true);
const fresh = planClose({ st: { lastActionAt: 100 }, sendFailed: true, sendFailedAgeMs: 30 * 1000 });
assert.equal(fresh.blocked, true, '新鲜失败仍要拦');

const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
assert.ok(bridge.includes('planClose({'), 'close 必须接 Action Planner');
assert.ok(bridge.includes('sendFailedAgeMs'), 'close 必须把失败时间传给 planner');
assert.ok(bridge.includes("type === 'assistant/message'"), 'step guard 必须按 assistant step 计数');
const mcp = fs.readFileSync(path.resolve('src/mcp-snowluma-safe.js'), 'utf8');
assert.ok(mcp.includes('PROFILE_HIDDEN'), '工具面 profile 必须存在');
console.log('✅ Action Planner 通过');
