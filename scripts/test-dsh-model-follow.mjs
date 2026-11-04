// 「QQ 工作区跟随 DSH 默认模型」的纯逻辑 + 接线断言。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  SOURCE_CONFIG, SOURCE_DSH_DEFAULT, defaultSelectionOf, effectiveChatModel, writesGlobalDefault,
} from '../src/dsh-model-follow.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = { provider: 'dfy', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'max' };

test('defaultSelectionOf 只认完整选择', () => {
  assert.deepEqual(defaultSelectionOf({ default: { provider: 'dfy', model: 'm1' } }), { provider: 'dfy', model: 'm1' });
  assert.deepEqual(defaultSelectionOf({ default: { provider: ' dfy ', model: ' m1 ', reasoningEffort: '  ' } }), { provider: 'dfy', model: 'm1' });
  assert.equal(defaultSelectionOf({ default: { provider: 'dfy' } }), null);
  assert.equal(defaultSelectionOf({ default: null }), null);
});

test('跟随开启且读得到默认模型时用默认（含它给的强度）', () => {
  const chosen = effectiveChatModel({
    followDefault: true, config,
    defaultSelection: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
  });
  assert.equal(chosen.source, SOURCE_DSH_DEFAULT);
  assert.equal(chosen.provider, 'deepseek-account');
  assert.equal(chosen.reasoningEffort, 'high');
  assert.equal(chosen.overridesConfig, true);
});

test('默认模型没给强度时沿用 config 的管理员设置', () => {
  const chosen = effectiveChatModel({
    followDefault: true, config,
    defaultSelection: { provider: 'deepseek-account', model: 'deepseek-flash' },
  });
  assert.equal(chosen.reasoningEffort, 'max');
  assert.equal(chosen.source, SOURCE_DSH_DEFAULT);
});

test('跟随失败带原因并退回 config', () => {
  const chosen = effectiveChatModel({
    followDefault: true, config, defaultSelection: null, defaultError: 'connect ECONNREFUSED',
  });
  assert.equal(chosen.source, SOURCE_CONFIG);
  assert.equal(chosen.provider, 'dfy');
  assert.equal(chosen.defaultError, 'connect ECONNREFUSED');
});

test('显式关闭跟随时不当作失败', () => {
  const chosen = effectiveChatModel({
    followDefault: false, config,
    defaultSelection: { provider: 'deepseek-account', model: 'deepseek-flash' },
    defaultError: '不该出现',
  });
  assert.equal(chosen.source, SOURCE_CONFIG);
  assert.equal(chosen.defaultError, undefined);
});

test('默认模型与 config 相同时不声称覆盖', () => {
  const chosen = effectiveChatModel({
    followDefault: true, config,
    defaultSelection: { provider: 'dfy', model: 'deepseek-v4.1-flash-1017' },
  });
  assert.equal(chosen.overridesConfig, false);
});

test('writesGlobalDefault：跟随成功且值相同就是 false', () => {
  const followed = { provider: 'dfy', model: 'm1' };
  assert.equal(writesGlobalDefault({ followed, provider: 'dfy', model: 'm1', reasoningEffort: 'max' }), false);
  assert.equal(writesGlobalDefault({ followed: { provider: 'dfy', model: 'm1', reasoningEffort: 'high' }, provider: 'dfy', model: 'm1', reasoningEffort: 'high' }), false);
  assert.equal(writesGlobalDefault({ followed, provider: 'dfy', model: 'm2', reasoningEffort: 'max' }), true);
  assert.equal(writesGlobalDefault({ followed: null, provider: 'dfy', model: 'm1', reasoningEffort: 'max' }), true);
});

test('接线：bridge 跟随、控制台和设置页都有开关', () => {
  const bridge = fs.readFileSync(path.join(ROOT, 'src/bridge.js'), 'utf8');
  const consoleHtml = fs.readFileSync(path.join(ROOT, 'public/console.html'), 'utf8');
  const client = fs.readFileSync(path.join(ROOT, 'plugins/surfcore/lib/client.js'), 'utf8');
  assert.match(bridge, /from '\.\/dsh-model-follow\.js'/);
  assert.match(bridge, /const followDefault = followsDefaultModel\(\);/);
  assert.match(bridge, /const followed = followDefault \? await resolveDefaultModel\(\) : null;/);
  assert.match(bridge, /const chosen = effectiveChatModel\(\{/);
  assert.match(bridge, /let provider = chosen\.provider;/);
  assert.match(bridge, /let model = chosen\.model;/);
  assert.match(bridge, /url\.pathname === '\/api\/dsh\/follow-default'/);
  assert.match(bridge, /code: 'config-write-failed'/);
  assert.match(bridge, /does not support reasoning effort/);
  assert.match(bridge, /modelsWithoutEffort/);
  assert.match(consoleHtml, /id="dshFollowDefault"/);
  assert.match(consoleHtml, /id="dshFollowNote"/);
  assert.match(consoleHtml, /\/api\/dsh\/follow-default/);
  assert.match(client, /dsh\.followDefaultModel/);
  assert.match(client, /跟随 DSH 默认模型/);
  assert.match(client, /\/dsh\/follow-default/);
});
