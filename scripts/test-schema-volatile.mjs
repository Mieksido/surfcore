// schemastery 3.18.3+ volatile 包装兼容：配置边界必须先取纯值。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { settingFromDshNamespace, unwrapSchemaValue } from '../src/schema-values.js';

assert.equal(unwrapSchemaValue('chat'), 'chat');
assert.equal(unwrapSchemaValue(undefined), undefined);
assert.equal(unwrapSchemaValue({ get: () => 'reserved2' }), 'reserved2');
assert.equal(unwrapSchemaValue({ get: () => { throw new Error('bad'); } }).get instanceof Function, true);

const ns = {
  user: { mode: { get: () => 'chat' } },
  value: { mode: 'reserved2', ownerQQ: { get: () => '12345' } },
};
assert.equal(settingFromDshNamespace(ns, 'mode'), 'chat', 'user 层优先且要拆包');
assert.equal(settingFromDshNamespace(ns, 'ownerQQ'), '12345');
assert.equal(settingFromDshNamespace({ value: { mode: '' } }, 'mode'), '');
assert.equal(settingFromDshNamespace(null, 'mode'), undefined);

const source = fs.readFileSync('src/bridge.js', 'utf8');
assert.ok(source.includes('function settingFromDshNamespace'), 'bridge 必须有 settings 读取入口');
assert.ok(source.includes("typeof value.get === 'function'"), 'bridge 的 settings 读取必须拆 volatile');
assert.ok(source.includes('settingFromDshNamespace(ns, \'mode\')'), 'mode 读取必须走拆包');
const plugin = fs.readFileSync('plugins/surfcore/lib/index.js', 'utf8');
assert.ok(plugin.includes('unwrapSchemaValue(raw.mode)'), '设置页 dshSetting.mode 必须拆包');
assert.ok(plugin.includes('unwrapSchemaValue(raw.ownerQQ)'), '设置页 dshSetting.ownerQQ 必须拆包');
console.log('✅ schemastery volatile 拆包测试通过');
