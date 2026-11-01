// 四类动态前缀回归：空前缀必须真的不加；历史默认前缀不能在清空后复活。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_KINDS, normalizeDynamics, kindsNow, withPrefix, stripLegacyPrefix } from '../plugins/surfcore/tools/lib/kinds.mjs';

const normalized = normalizeDynamics({ kinds: { best: { prefix: '' } } });
assert.equal(normalized.kinds.best.prefix, '', '空串必须原样保存');
const cfg = { dynamics: normalized };
const kinds = kindsNow(cfg);
assert.equal(kinds.best.prefix, '', '空串不能被默认值回填');
assert.equal(withPrefix('best', '正文', kinds), '正文', '空前缀不能再加默认前缀');
const old = DEFAULT_KINDS.best.prefix;
assert.equal(stripLegacyPrefix('best', `${old}正文`), '正文', '空前缀要清掉模型带来的旧默认前缀');
assert.equal(stripLegacyPrefix('best', '正文'), '正文', '没有前缀时保持正文');

const daily = fs.readFileSync(path.resolve('plugins/surfcore/tools/commands/daily.mjs'), 'utf8');
assert.ok(daily.includes('stripLegacyPrefix'), 'daily 必须清历史默认前缀');
assert.ok(daily.includes('K.prefix ? stripPrefix'), '有当前前缀时仍按当前前缀处理');
assert.ok(daily.includes('无固定前缀'), 'dry 预览必须说明当前无前缀');

const scheduler = fs.readFileSync(path.resolve('plugins/surfcore/lib/scheduler.js'), 'utf8');
assert.ok(scheduler.includes('不添加固定前缀'), '空前缀时提示词不能再要求固定前缀');

const toolsConfig = fs.readFileSync(path.resolve('plugins/surfcore/tools/lib/config.mjs'), 'utf8');
const paths = fs.readFileSync(path.resolve('plugins/surfcore/lib/paths.js'), 'utf8');
assert.ok(toolsConfig.includes('DSH_HOME'), '工具配置必须认 DSH_HOME');
assert.ok(toolsConfig.includes('SURFCORE_BILI_CONFIG'), '工具配置必须认显式配置文件');
assert.ok(paths.includes('SURFCORE_BILI_CONFIG') && paths.includes('DSH_HOME'), '插件路径必须与工具同源');

// 真正在子进程里解析一次，防止“源码里有 DSH_HOME、运行时仍读 HOME”。
{
  const dshHome = path.resolve('.tmp-test-dsh-home');
  const code = "import { configPath } from './plugins/surfcore/tools/lib/config.mjs'; console.log(configPath)";
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: path.resolve('.'),
    env: { ...process.env, DSH_HOME: dshHome, SURFCORE_BILI_CONFIG: '' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || 'configPath 子进程失败');
  assert.equal(r.stdout.trim(), path.join(dshHome, 'surfcore', 'bili.config.json'), 'DSH_HOME 必须和插件同源');
  const pcode = "import { BILI_CONFIG } from './plugins/surfcore/lib/paths.js'; console.log(BILI_CONFIG)";
  const p = spawnSync(process.execPath, ['--input-type=module', '-e', pcode], {
    cwd: path.resolve('.'),
    env: { ...process.env, DSH_HOME: dshHome, SURFCORE_BILI_CONFIG: '' },
    encoding: 'utf8',
  });
  assert.equal(p.status, 0, p.stderr || 'plugin path 子进程失败');
  assert.equal(p.stdout.trim(), r.stdout.trim(), '插件与工具必须解析出同一个配置文件');
}
console.log('✅ 四类动态前缀/配置路径测试通过');
