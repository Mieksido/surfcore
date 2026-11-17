/**
 * QQBOT_ROOT 解析回归：符号链接部署形态（Linux 服务器）。
 *
 * 背景（2026-11-17 真事故）：插件装成
 *   <DSH_HOME>/profiles/<p>/node_modules/surfcore
 * 旁边放一个 `src -> /srv/surfcore/src` 符号链接。旧 `looksLikeQqbotRoot()`
 * 要求目录里同时有 config.json 与 src/bridge.js，profile 目录只有后者 ⇒ 判否 ⇒
 * QQBOT_ROOT 落到 node_modules：
 *   · consoleToken 读空 → 桥接状态接口 401；
 *   · state/bridge.lock 读不到 → 「重启桥接」杀不掉进程；
 * 现象是 plugin.log 每 2 分钟刷「桥接还在旧目录（root=未知）」。
 *
 * 做法：造一个临时目录，只放 `src -> 真实根/src`，import 一份新的 paths.js，
 * 断言解析到真实根。
 *
 * 运行：node scripts/test-paths-root-link.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const realRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-realroot-'));
fs.mkdirSync(path.join(realRoot, 'src'), { recursive: true });
fs.writeFileSync(path.join(realRoot, 'config.json'), JSON.stringify({ consoleToken: 'x' }, null, 2));
fs.writeFileSync(path.join(realRoot, 'src', 'bridge.js'), '// fixture\n');

// 模拟 profiles/<p>：只有 src 符号链接，没有 config.json。
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-profile-'));
const pluginDir = path.join(profileDir, 'node_modules', 'surfcore');
fs.mkdirSync(path.join(pluginDir, 'lib'), { recursive: true });
fs.copyFileSync(
  path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'lib', 'paths.js'),
  path.join(pluginDir, 'lib', 'paths.js'),
);
let linkOk = true;
try {
  fs.symlinkSync(path.join(realRoot, 'src'), path.join(profileDir, 'src'), 'junction');
} catch {
  try { fs.symlinkSync(path.join(realRoot, 'src'), path.join(profileDir, 'src'), 'dir'); } catch { linkOk = false; }
}
if (!linkOk) {
  console.log('⏭  当前环境不允许建符号链接，跳过（Linux/服务器才是目标形态）');
  process.exit(0);
}

// paths.js 还会 import ../../../src/node-path.js（相对插件位置）。被测的只是 QQBOT_ROOT
// 的解析链，这里沿符号链接在真实根里补一个最小桩。
const stubPath = path.join(profileDir, 'src', 'node-path.js');
fs.writeFileSync(stubPath, 'export function findNodeExe() { return process.execPath; }\n');

// 再放一份「污染现场」：旧 bug 曾把 config.json 往 profile 目录写，写完之后 profile
// 看起来就像一个合法的桥接根（有 config.json + src/bridge.js），修好的解析逻辑仍然命中它。
// 这里把这个自我强化的错误点钉住：profile 目录（package.json 名为 dsh-profile-*）必须被排除。
fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({ name: 'dsh-profile-test' }, null, 2));
fs.writeFileSync(path.join(profileDir, 'config.json'), JSON.stringify({ ownerQQ: 'polluted' }, null, 2));
fs.mkdirSync(path.join(profileDir, 'state'), { recursive: true });

// 清掉所有显式覆盖，让候选链走「插件相对位置」这条默认路径。
for (const key of ['SURFCORE_ROOT', 'SURFCORE_QQBOT_ROOT', 'QQBILI_QQBOT_ROOT']) delete process.env[key];

const mod = await import(pathToFileURL(path.join(pluginDir, 'lib', 'paths.js')).href);
const resolved = path.resolve(mod.QQBOT_ROOT);
assert.equal(resolved, path.resolve(realRoot), `QQBOT_ROOT 必须解引用 src 符号链接得到真实根，实际得到 ${resolved}`);
assert.ok(fs.existsSync(path.join(mod.QQBOT_ROOT, 'config.json')), '解析出的根必须能读到 config.json');
assert.equal(path.resolve(mod.QQ_STATE_DIR), path.resolve(realRoot, 'state'), 'state 目录跟着根走');

console.log('✅ QQBOT_ROOT 符号链接解析通过');
