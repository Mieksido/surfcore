// 「QQ 工作区跟随 DSH 默认模型」的纯逻辑 + 接线断言。
//
// 为什么要有这条测试：
//   `ensureChatModel` 以前只用 config.json 里写死的 dsh.model，于是用户在 Web GUI 改默认模型，
//   QQ 聊天 / QQ 黑话学习两个工作区毫无反应；而 selectModel 又会顺手把 DSH 全局默认改回
//   config 那个值 —— 两个方向互相打架。跟随逻辑抽到 src/dsh-model-follow.js 之后，
//   这里把每条分支钉死，包括「想跟随但没读到」这条失败路径（AGENTS.md §1.7）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SOURCE_CONFIG, SOURCE_DSH_DEFAULT, defaultSelectionOf, effectiveChatModel, writesGlobalDefault } from '../src/dsh-model-follow.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = { provider: 'dfy', model: 'deepseek-v4.1-flash-1017', reasoningEffort: 'max' };

test('defaultSelectionOf 只认完整选择，缺手指回 null', () => {
  assert.deepEqual(defaultSelectionOf({ default: { provider: 'dfy', model: 'm1' } }), { provider: 'dfy', model: 'm1' });
  assert.deepEqual(
    defaultSelectionOf({ default: { provider: 'dfy', model: 'm1', reasoningEffort: 'medium' } }),
    { provider: 'dfy', model: 'm1', reasoningEffort: 'medium' },
  );
  // 空白串等同没填：不能把 " " 当 provider 去调 selectModel
  assert.deepEqual(
    defaultSelectionOf({ default: { provider: ' dfy ', model: ' m1 ', reasoningEffort: '  ' } }),
    { provider: 'dfy', model: 'm1' },
  );
  assert.equal(defaultSelectionOf({ default: { provider: 'dfy' } }), null);
  assert.equal(defaultSelectionOf({ default: { model: 'm1' } }), null);
  assert.equal(defaultSelectionOf({ default: null }), null);
  assert.equal(defaultSelectionOf({}), null);
  assert.equal(defaultSelectionOf(null), null);
  assert.equal(defaultSelectionOf(undefined), null);
});

test('跟随开启且读得到默认模型时，用默认模型（含它给的思考强度）', () => {
  const chosen = effectiveChatModel({
    followDefault: true,
    config,
    defaultSelection: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
  });
  assert.equal(chosen.source, SOURCE_DSH_DEFAULT);
  assert.equal(chosen.provider, 'deepseek-account');
  assert.equal(chosen.model, 'deepseek-flash');
  assert.equal(chosen.reasoningEffort, 'high');
  assert.equal(chosen.overridesConfig, true);
  assert.equal(chosen.defaultError, undefined);
});

test('默认模型没指定强度时，沿用 config 的管理员设置而不是清空', () => {
  const chosen = effectiveChatModel({
    followDefault: true,
    config,
    defaultSelection: { provider: 'deepseek-account', model: 'deepseek-flash' },
  });
  assert.equal(chosen.reasoningEffort, 'max');
  assert.equal(chosen.source, SOURCE_DSH_DEFAULT);
});

test('跟随失败必须带原因：defaultError 非空，且退回 config 值', () => {
  const chosen = effectiveChatModel({
    followDefault: true,
    config,
    defaultSelection: null,
    defaultError: 'connect ECONNREFUSED',
  });
  assert.equal(chosen.source, SOURCE_CONFIG);
  assert.equal(chosen.provider, 'dfy');
  assert.equal(chosen.model, 'deepseek-v4.1-flash-1017');
  assert.equal(chosen.defaultError, 'connect ECONNREFUSED');
});

test('跟随失败但没有底层错误时，也给一句可读原因（不能静默）', () => {
  const chosen = effectiveChatModel({ followDefault: true, config, defaultSelection: null });
  assert.equal(chosen.source, SOURCE_CONFIG);
  assert.ok(chosen.defaultError && chosen.defaultError.length > 0, JSON.stringify(chosen));
});

test('显式关闭跟随时用 config 值，且不当作失败（no defaultError）', () => {
  const chosen = effectiveChatModel({
    followDefault: false,
    config,
    defaultSelection: { provider: 'deepseek-account', model: 'deepseek-flash' },
    defaultError: '不该出现',
  });
  assert.equal(chosen.source, SOURCE_CONFIG);
  assert.equal(chosen.provider, 'dfy');
  assert.equal(chosen.defaultError, undefined);
});

test('config 本身没有模型时不硬塞 defaultError（没什么可退的时候不制造噪音）', () => {
  const chosen = effectiveChatModel({ followDefault: true, config: {}, defaultSelection: null });
  assert.equal(chosen.provider, '');
  assert.equal(chosen.model, '');
  assert.equal(chosen.defaultError, undefined);
});

test('默认模型与 config 相同时不声称「覆盖了配置」', () => {
  const chosen = effectiveChatModel({ followDefault: true, config, defaultSelection: { provider: 'dfy', model: 'deepseek-v4.1-flash-1017' } });
  assert.equal(chosen.source, SOURCE_DSH_DEFAULT);
  assert.equal(chosen.overridesConfig, false);
});

test('接线：bridge 真的用了跟随逻辑，控制台真的有开关', () => {
  const bridge = fs.readFileSync(path.join(ROOT, 'src/bridge.js'), 'utf8');
  const consoleHtml = fs.readFileSync(path.join(ROOT, 'public/console.html'), 'utf8');

  // 1) 导入纯逻辑，而不是在 bridge 里另写一套判断
  assert.match(bridge, /from '\.\/dsh-model-follow\.js'/);
  // 2) ensureChatModel 里取默认模型并交给 effectiveChatModel
  assert.match(bridge, /async function ensureChatModel\(sessionId\)/);
  assert.match(bridge, /const followed = followsDefaultModel\(\) \? await resolveDefaultModel\(\) : null;/);
  assert.match(bridge, /const chosen = effectiveChatModel\(\{/);
  // 3) 会话模型必须用 chosen 的结果，不能又退回 cfg.dsh.model
  assert.match(bridge, /const provider = chosen\.provider;/);
  assert.match(bridge, /const model = chosen\.model;/);
  assert.doesNotMatch(bridge, /const provider = String\(cfg\.dsh\?\.provider \|\| 'deepseek-official'\);\s*\n\s*const model = String\(cfg\.dsh\?\.model \|\| 'deepseek-flash'\);/);
  // 4) 两个工作区共用 ensureChatModel（QQ 聊天 / QQ 黑话学习），所以跟随一处即可覆盖
  assert.match(bridge, /ensureChatModel\(existing\)/);
  // 5) 控制台：开关 + 失败可见（ok:false 时要带 code/hint）
  assert.match(consoleHtml, /id="dshFollowDefault"/);
  assert.match(consoleHtml, /id="dshFollowNote"/);
  assert.match(consoleHtml, /\/api\/dsh\/follow-default/);
  assert.match(bridge, /url\.pathname === '\/api\/dsh\/follow-default'/);
  assert.match(bridge, /code: 'config-write-failed'/);
  assert.match(bridge, /hint: `手动把/);
  // 6) 日志要说清来源，否则用户永远不知道 QQ 用的是哪个模型
  assert.match(bridge, /（跟随 DSH 默认模型）/);
});
test('writesGlobalDefault：跟随成功且值相同就不算改全局默认', () => {
  const followed = { provider: 'dfy', model: 'm1' };
  // 默认值没给档位（真机上 agentOptions() 只回传 provider/model），沿用 config 的 max 不算改。
  assert.equal(writesGlobalDefault({ followed, provider: 'dfy', model: 'm1', reasoningEffort: 'max' }), false);
  // 默认值显式给了档位且一致。
  assert.equal(
    writesGlobalDefault({ followed: { provider: 'dfy', model: 'm1', reasoningEffort: 'high' }, provider: 'dfy', model: 'm1', reasoningEffort: 'high' }),
    false,
  );
  // 前后空白不该造成误判。
  assert.equal(writesGlobalDefault({ followed, provider: ' dfy ', model: 'm1 ', reasoningEffort: 'max' }), false);
});

test('writesGlobalDefault：真的换了模型或档位就要说实话', () => {
  const followed = { provider: 'dfy', model: 'm1' };
  assert.equal(writesGlobalDefault({ followed, provider: 'dfy', model: 'm2', reasoningEffort: 'max' }), true);
  assert.equal(writesGlobalDefault({ followed, provider: 'other', model: 'm1', reasoningEffort: 'max' }), true);
  assert.equal(
    writesGlobalDefault({ followed: { provider: 'dfy', model: 'm1', reasoningEffort: 'high' }, provider: 'dfy', model: 'm1', reasoningEffort: 'max' }),
    true,
  );
  // 完全没读到默认值（旧 DSH 或 RPC 失败）：不能声称「没副作用」。
  assert.equal(writesGlobalDefault({ followed: null, provider: 'dfy', model: 'm1', reasoningEffort: 'max' }), true);
});
