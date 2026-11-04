// 宿主只提供 /api/events 快照时的事件归一；remote.mux 仍是正常用户主路径。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { snapshotEventCursor, snapshotEventPayload } from '../src/dsh-client.js';

const a = snapshotEventPayload({ cursor: 12, sessionId: 's1', event: { type: 'assistant/message', data: { text: 'hi' } } });
assert.equal(a.type, 'session/event');
assert.equal(a.sessionId, 's1');
assert.equal(a.event.type, 'assistant/message');
assert.equal(snapshotEventCursor({ cursor: 12 }), 12);

const b = snapshotEventPayload({ type: 'session/event', sessionId: 's2', event: { type: 'turn/end', data: {} } });
assert.equal(b.sessionId, 's2');
assert.equal(b.event.type, 'turn/end');

const q = snapshotEventPayload({ type: 'approval/requested', sessionId: 's3', toolName: 'bash' });
assert.equal(q.type, 'approval/requested');
assert.equal(q.sessionId, 's3');

assert.equal(snapshotEventPayload({ event: { type: 'turn/start' } }), null, '没有 sessionId 不能猜');
assert.equal(snapshotEventPayload(null), null);

const source = fs.readFileSync('src/dsh-client.js', 'utf8');
assert.ok(source.includes('_snapshotEventGenerator'), '必须有 /api/events 回退');
assert.ok(source.includes('remote.mux 不可用'), '失配时必须有可见诊断');
assert.ok(source.includes("Date.now() < this._remoteMuxRetryAt"), '回退后要定期重试 remote.mux');
console.log('✅ DSH 事件流回退测试通过');
