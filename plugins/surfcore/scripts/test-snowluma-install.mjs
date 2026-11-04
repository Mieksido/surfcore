// SnowLuma 安装位置识别回归（纯离线：临时目录夹具，不装、不启动 SnowLuma）。
//
// 背景（2026-10-29 用户反馈）：装好 SnowLuma2 后点「检测已安装」仍然找不到。
// 旧实现只在一组写死的常见目录里猜；用户解压到 D:\软件\SnowLuma2 这类位置就永远猜不到，
// 而手动填路径的入口藏在 QQ 页高级设置里。
//
// 这条测试钉三件事：
//   1. 归一：根目录 / app 目录 / app\launcher.bat / SnowLuma.exe / 多套一层的 zip 都能认；
//   2. 候选顺序：用户显式选的路径 > 配置 > 环境变量 > 常见位置（不猜注册表、不扫盘）；
//   3. 找不到时返回 tried 列表（设置页据此告诉用户"试过哪些地方"），而不是只给一句"没找到"。
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = fileURLToPath(new URL('..', import.meta.url));
const {
  normalizeSnowLumaInstall, findSnowLumaInstall, snowLumaCandidates, snowLumaMissingReport,
} = await import(pathToFileURL(path.join(PLUGIN_ROOT, 'lib', 'snowluma-install.js')).href);

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label}`); }
};

const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'surfcore-snowluma-'));
const touch = async (rel, body = '') => {
  const file = path.join(base, rel);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, body, 'utf8');
};
const mkdir = (rel) => fsp.mkdir(path.join(base, rel), { recursive: true });
const abs = (rel) => path.join(base, rel);

try {
  console.log('## 1. 归一：四种输入 + 多套一层的 zip');
  await touch('std/app/launcher.bat', '@echo off\r\n');
  {
    const a = normalizeSnowLumaInstall(abs('std'));
    ok(a?.root === abs('std') && /app[\\/]launcher\.bat$/i.test(a.launcher), '根目录（里面有 app）→ 认');
    const b = normalizeSnowLumaInstall(abs('std/app'));
    ok(b?.root === abs('std'), 'app 目录 → 归一到根目录');
    const c = normalizeSnowLumaInstall(abs('std/app/launcher.bat'));
    ok(c?.root === abs('std'), 'app\\launcher.bat 文件 → 归一到根目录');
  }
  await touch('flat/launcher.bat', '@echo off\r\n');
  {
    const hit = normalizeSnowLumaInstall(abs('flat'));
    ok(hit?.root === abs('flat'), 'launcher.bat 直接在根目录（老版本布局）→ 认');
  }
  await touch('exe/SnowLuma.exe', 'x');
  {
    const hit = normalizeSnowLumaInstall(abs('exe'));
    ok(hit?.root === abs('exe') && /SnowLuma\.exe$/i.test(hit.launcher), '目录里有 SnowLuma.exe → 认');
    const viaFile = normalizeSnowLumaInstall(abs('exe/SnowLuma.exe'));
    ok(viaFile?.root === abs('exe'), '直接选 SnowLuma.exe 文件 → 认');
  }
  await touch('wrap/SnowLuma-v2.0.3-win-x64/app/launcher.bat', '@echo off\r\n');
  {
    const hit = normalizeSnowLumaInstall(abs('wrap'));
    ok(hit?.root === abs('wrap/SnowLuma-v2.0.3-win-x64'), '解压多了一层（唯一子目录）→ 往下认一层');
  }
  await touch('中文 目录/app/launcher.bat', '@echo off\r\n');
  ok(normalizeSnowLumaInstall(abs('中文 目录'))?.root === abs('中文 目录'), '中文 + 空格路径 → 认');
  {
    await mkdir('empty');
    ok(normalizeSnowLumaInstall(abs('empty')) === null, '空目录 → null（不乱认）');
    ok(normalizeSnowLumaInstall(path.join(base, 'nope')) === null, '不存在的路径 → null');
    await touch('random/readme.txt', 'x');
    ok(normalizeSnowLumaInstall(abs('random')) === null, '没有启动文件的目录 → null');
  }

  console.log('## 2. 候选顺序：手选 > 配置 > 环境变量 > 常见位置');
  {
    const list = snowLumaCandidates({ snowluma: { launcherPath: 'X:/cfg', homeDir: 'X:/home' }, extraPaths: ['Y:/picked'] });
    ok(list[0] === 'Y:/picked', '显式选中的路径排第一（用户的选择优先）');
    ok(list[1] === 'X:/cfg' && list[2] === 'X:/home', '配置里的 launcherPath / homeDir 排在后面');
    ok(list.some((x) => /SnowLuma/i.test(x)), '仍然保留常见位置兜底');
    const dedup = snowLumaCandidates({ snowluma: { launcherPath: abs('std') }, extraPaths: [abs('std')] });
    ok(dedup.filter((x) => x === abs('std')).length === 1, '同一个路径不重复尝试');
  }

  console.log('## 3. 找安装：配置命中 / 手选命中 / 找不到时给 tried');
  {
    const found = findSnowLumaInstall({ snowluma: { launcherPath: abs('std') } });
    ok(found.ok === true && found.root === abs('std'), '配置里的路径能命中');
  }
  {
    const found = findSnowLumaInstall({ snowluma: {}, extraPaths: [abs('std')] });
    ok(found.ok === true && found.root === abs('std'), '浏览…选中的路径能命中（即使配置里没有）');
  }
  {
    const missing = abs('definitely-not-here');
    const found = findSnowLumaInstall({ snowluma: { launcherPath: missing } });
    ok(Array.isArray(found.tried) && found.tried.length > 1, '无论命中与否都带 tried 列表（给用户看试过哪些地方）');
    ok(found.tried[0].path === missing && found.tried[0].ok === false, 'tried 第一条就是配置里那个路径');
    // 注意：不写死「必然 ok:false」——开发机上 D:\deepseekwork\SnowLuma2 恰好是兜底候选；
    // 这里只钉「不能把那个不存在的路径当成命中」。
    ok(found.ok !== true || found.root !== missing, '不存在的路径绝不被当成命中');
    ok(normalizeSnowLumaInstall(missing) === null, '浏览… 选到不存在的路径 → 校验直接拒绝');
  }

  console.log('## 4. 失败必须给结构化报告（弹窗要用：code / title / error / hint）');
  const darwin = process.platform === 'darwin';
  {
    const notFound = snowLumaMissingReport({ tried: ['C:/a', 'C:/b'] });
    ok(notFound.code === 'snowluma_not_found', '自动检测失败 → code=snowluma_not_found');
    ok(Boolean(notFound.title) && Boolean(notFound.error), '有弹窗标题和人读的错误（不是空字符串）');
    // macOS 移植：mac 上运行时是 NapCat 挂载的官方 QQ.app，一步是「装 QQ + 跑 NapCat 安装器」，
    // 没有 Windows 的「浏览… / 官方下载页」两条。断言按平台分开，Windows 文案保持原样。
    ok(darwin
      ? (/QQ\.app/.test(notFound.hint) && /NapCat/.test(notFound.hint))
      : (/浏览/.test(notFound.hint) && /下载/.test(notFound.hint)), 'hint 给出可执行的两个下一步');
    ok(notFound.tried.length === 2, 'tried 原样带给前端（弹窗里可展开看试过哪些位置）');

    const bad = snowLumaMissingReport({ picked: 'D:/x', tried: ['D:/x'] });
    ok(bad.code === 'snowluma_path_invalid', '手选路径失败 → code=snowluma_path_invalid');
    ok(bad.error.includes('D:/x'), '错误里带上用户选的路径（用户知道在说哪个目录）');
    ok(darwin ? /QQ\.app/.test(bad.hint) : /launcher\.bat/.test(bad.hint), 'hint 说明要填什么路径');
    ok(Boolean(bad.title), '手选失败也有独立标题（弹窗标题不重复用 error）');
  }
} finally {
  await fsp.rm(base, { recursive: true, force: true }).catch(() => {});
}

console.log(failures === 0 ? '\n✅ SnowLuma 安装位置识别回归通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
