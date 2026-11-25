// 语音包「重装时平铺失败」的回归（纯离线，不下载、不启动任何语音服务）。
//
// 背景（2026-11-23）：用户在设置页点「重装」voice-local，下载完 GitHub archive 后
// 报「安装包里缺少 scripts/fetch-models.mjs（可能下载到了不完整的版本）」。
// 真因不是包坏了：重装第一步 clearPackKeepingAssets 会把 models/vendor/.venv/config.toml
// 留在原地，再解压代码，于是目录里同时有多个目录 + config.toml；
// 旧 flattenSingleDir 看到 `dirs.length !== 1 || files.length > 0` 就直接 return false，
// 解压出来的 `surfvoicelocal-main/` 永远平不掉，postInstall 自然找不到脚本。
//
// 这条测试钉住：
//   1. 带 PACK_KEEP 残留时仍能平铺（返回 true，脚本出现在根）；
//   2. 用户的 config.toml 不被仓库里的模板顶掉；
//   3. 断点续传的 models/ 会合并而不是被 rename 覆盖。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = path.join(REPO_ROOT, 'src', 'voice-packs.js');
const { flattenSingleDir } = await import(pathToFileURL(SOURCE).href);

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label}`); }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-flatten-'));
try {
  // 重装前的残留（PACK_KEEP 里的东西）
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'models', 'voice-local-vendor.tar.gz.part'), 'resume');
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.toml'), 'user = "mine"');

  // 新解压出来的那一层
  const inner = path.join(dir, 'surfvoicelocal-main');
  fs.mkdirSync(path.join(inner, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(inner, 'models'), { recursive: true });
  fs.writeFileSync(path.join(inner, 'scripts', 'fetch-models.mjs'), '// fetch');
  fs.writeFileSync(path.join(inner, 'models', 'piper.onnx'), 'onnx');
  fs.writeFileSync(path.join(inner, 'config.example.toml'), 'example = true');
  fs.writeFileSync(path.join(inner, 'models.json'), '{"archives":[]}');

  const flattened = await flattenSingleDir(dir);

  ok(flattened === true, '带 models/、logs/、config.toml 残留时仍要平铺成功（旧实现这里返回 false）');
  ok(fs.existsSync(path.join(dir, 'scripts', 'fetch-models.mjs')), '平铺后 scripts/fetch-models.mjs 必须在包根');
  ok(!fs.existsSync(inner), '解压出来的 <repo>-main 目录必须被清掉');
  ok(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8') === 'user = "mine"', '用户自己的 config.toml 不能被仓库模板顶掉');
  ok(fs.readFileSync(path.join(dir, 'models', 'voice-local-vendor.tar.gz.part'), 'utf8') === 'resume', '断点续传的 .part 必须保留');
  ok(fs.existsSync(path.join(dir, 'models', 'piper.onnx')), '包里的 models/ 内容要合并进来');

  // 没有任何可平铺的内层目录时不能乱动
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-flatten2-'));
  try {
    fs.writeFileSync(path.join(dir2, 'a.txt'), 'x');
    fs.writeFileSync(path.join(dir2, 'b.txt'), 'y');
    ok((await flattenSingleDir(dir2)) === false, '顶层有两个文件时不要误判成包根');
  } finally {
    fs.rmSync(dir2, { recursive: true, force: true });
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? '\n✅ 语音包重装平铺回归通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
