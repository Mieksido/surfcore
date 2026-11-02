// QQ scoped 工具限制：晚注册的全局危险工具也要补装 Schema 限制。
import assert from 'node:assert/strict';
import { apply } from '../plugins/surfcore/qq-tool-restrict.mjs';

const available = new Set(['bash']);
const installed = new Map();
let listener;
let guard;
let calls = 0;
const originalError = console.error;
try {
  console.error = () => {};
  apply({
    on(event, callback) {
      assert.equal(event, 'tools/change');
      listener = callback;
    },
    tools: {
      restrict({ deny: [name] }) {
        calls += 1;
        if (!available.has(name)) throw new Error('unknown global tool');
        installed.set(name, (installed.get(name) ?? 0) + 1);
        listener?.(); // restrict 同步触发 tools/change，验证重入不会重复安装
      },
      guard(callback) { guard = callback; },
    },
  });
} finally {
  console.error = originalError;
}

assert.equal(installed.get('bash'), 1, '启动时已存在的危险工具要限制一次');
assert.equal(installed.has('pwsh'), false, '尚不存在的工具先跳过');
available.add('pwsh');
listener();
assert.equal(installed.get('pwsh'), 1, '晚注册的全局危险工具要补装限制');
for (let i = 0; i < 3; i += 1) listener();
assert.equal(installed.get('bash'), 1, '成功的限制保持幂等');
assert.equal(installed.get('pwsh'), 1, '重入的 tools/change 不能重复安装');
assert.ok(calls < 1000, '事件重试必须有界');
assert.match(guard({ name: 'future_untrusted_tool' }), /白名单/);
assert.equal(guard({ name: 'todo_write' }), undefined);
assert.equal(guard({ name: 'mcp__web-search-safe__fixture' }), undefined);
console.log('✅ QQ 工具晚注册限制测试通过');
