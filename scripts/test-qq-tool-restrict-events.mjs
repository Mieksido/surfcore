// API-contract unit regression; real DSH dispatch is covered by the isolated fixture.
import assert from 'node:assert/strict';
import { apply } from '../plugins/surfcore/qq-tool-restrict.mjs';
const available = new Set(['bash']);
const installed = new Map();
let listener, guard, calls = 0;
const originalError = console.error;
try {
  console.error = () => {}; // Suppress expected unknown-name diagnostics only.
  apply({
    on(event, callback) { assert.equal(event, 'tools/change'); listener = callback; },
    tools: {
      restrict({ deny: [name] }) {
        calls++;
        if (!available.has(name)) throw new Error('unknown global tool');
        installed.set(name, (installed.get(name) ?? 0) + 1);
        listener?.(); // Real restrict emits synchronously; exercise reentrancy.
      },
      guard(callback) { guard = callback; },
    },
  });
} finally { console.error = originalError; }
assert.equal(installed.get('bash'), 1);
assert.equal(installed.has('pwsh'), false);
available.add('pwsh');
listener();
assert.equal(installed.get('pwsh'), 1, 'late global must be restricted');
for (let i = 0; i < 3; i++) listener();
assert.equal(installed.get('bash'), 1, 'successful restrictions remain idempotent');
assert.equal(installed.get('pwsh'), 1, 'reentrant change must not install twice');
assert.ok(calls < 1000, 'event retries must stay bounded in this fixture');
assert.match(guard({ name: 'future_untrusted_tool' }), /白名单/);
assert.equal(guard({ name: 'todo_write' }), undefined);
assert.equal(guard({ name: 'mcp__web-search-safe__fixture' }), undefined);
console.log('PASS late global restriction, reentrancy, idempotency, fail-closed guard and allowed names');
