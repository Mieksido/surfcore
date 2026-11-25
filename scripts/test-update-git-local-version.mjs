// 回归：git 通道的组件也要报「本地已装版本」。
// 2026-11-24 用户反馈：更新面板显示 `SurfCore 本体（已是最新 v?→v0.8.9）`，左边永远是 `?`。
// 根因：inspectGitComponent 的 base 里没有 installedVersion，界面只能回退成 `v?`。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { inspectGitComponent } from '../plugins/surfcore/lib/updates.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-gitver-'));
const git = (...args) => execFileSync('git', ['-C', dir, ...args], { stdio: 'pipe', encoding: 'utf8' });

try {
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'test');
  git('remote', 'add', 'origin', 'https://example.invalid/surfcore.git'); // 不联网：fetch:false
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'surfcore', version: '0.8.9' }, null, 2));
  git('add', 'package.json');
  git('commit', '--quiet', '-m', 'init');

  const result = await inspectGitComponent({ id: 'surfcore', name: 'SurfCore 本体', dir }, { fetch: false });
  assert.equal(result.installedVersion, '0.8.9', `git 通道必须报本地版本，实际=${JSON.stringify(result.installedVersion)}`);

  // 没有 package.json 的自建仓库：必须给空串而不是 undefined，界面才知道显示「未安装」
  fs.rmSync(path.join(dir, 'package.json'));
  git('add', '-A');
  git('commit', '--quiet', '-m', 'drop package.json');
  const noPkg = await inspectGitComponent({ id: 'surfcore', name: 'SurfCore 本体', dir }, { fetch: false });
  assert.equal(noPkg.installedVersion, '', '没有 package.json 时应是空串');

  console.log('git 通道本地版本回填 OK');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
