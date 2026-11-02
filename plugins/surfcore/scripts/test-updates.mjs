// 组件更新（lib/updates.js）的离线回归：用真实的临时 git 仓库跑，不碰网络。
//
// 覆盖的是"会伤到用户"的几条边界：
//   · 只做 fetch 检查，不动工作区；
//   · 只允许 --ff-only；本地有改动 / 有未推送提交时**拒绝**；
//   · "不再提示本次"按远端 commit 记，远端再前进会重新提示；
//   · 不是 git 仓库的目录只是"不可查"，不能让整个功能报错。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createUpdatesService, inspectComponent, compareVersions, gitAvailable } from '../lib/updates.js';

let failures = 0;
const ok = (cond, label) => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label}`); }
};

const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
function git(args, cwd) {
  return execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], {
    cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-updates-'));
const remote = path.join(base, 'remote.git');
const work = path.join(base, 'work');
const other = path.join(base, 'other');
const stateDir = path.join(base, 'state');
fs.mkdirSync(stateDir, { recursive: true });

try {
  console.log('## 0. 准备两个克隆 + 一个裸仓库');
  git(['-c', 'init.defaultBranch=main', 'init', '--bare', remote], base);
  git(['clone', remote, work], base);
  git(['checkout', '-b', 'main'], work);
  fs.writeFileSync(path.join(work, 'README.md'), '# demo\n');
  git(['add', '.'], work);
  git(['commit', '-m', 'init'], work);
  git(['push', '-u', 'origin', 'main'], work);
  git(['clone', remote, other], base);
  ok(Boolean(await gitAvailable()), `git 可用（${await gitAvailable()}）`);

  console.log('## 1. 没更新时：available + behind=0');
  {
    const r = await inspectComponent({ id: 'core', name: '本体', dir: work }, { fetch: true });
    ok(r.available === true, '能识别为 git 工作区');
    ok(r.behind === 0 && r.updateAvailable === false, 'behind=0、无更新');
    ok(r.branch === 'main', '分支识别为 main');
  }

  console.log('## 2. 远端前进后：检出 behind 与 changelog');
  fs.writeFileSync(path.join(other, 'a.txt'), 'a\n');
  git(['add', '.'], other);
  git(['commit', '-m', 'feat: add a'], other);
  git(['push', 'origin', 'main'], other);
  {
    const r = await inspectComponent({ id: 'core', name: '本体', dir: work }, { fetch: true });
    ok(r.behind === 1, `behind=1（实际 ${r.behind}）`);
    ok(r.changelog.some((line) => line.includes('feat: add a')), 'changelog 带上了提交信息');
    ok(r.blocked === '', '干净的工作区可以自动更新');
  }

  console.log('## 3. 本地有改动 / 未推送提交：拒绝，而不是覆盖');
  {
    fs.appendFileSync(path.join(work, 'README.md'), 'local edit\n');
    const dirty = await inspectComponent({ id: 'core', name: '本体', dir: work }, { fetch: false });
    ok(dirty.dirty >= 1, `识别出本地改动（${dirty.dirty} 处）`);
    ok(/未提交改动/.test(dirty.blocked), 'blocked 说明是"未提交改动"');
    git(['checkout', '--', 'README.md'], work);   // 还原测试现场

    // 本地领先：造一个未推送提交，再让它与远端分叉
    fs.writeFileSync(path.join(work, 'local.txt'), 'local\n');
    git(['add', '.'], work);
    git(['commit', '-m', 'local only'], work);
    await inspectComponent({ id: 'core', name: '本体', dir: work }, { fetch: false });
    // 本地领先 1、落后 1 → ff-only 会失败
    fs.writeFileSync(path.join(other, 'b.txt'), 'b\n');
    git(['add', '.'], other);
    git(['commit', '-m', 'feat: add b'], other);
    git(['push', 'origin', 'main'], other);
    const diverged = await inspectComponent({ id: 'core', name: '本体', dir: work }, { fetch: true });
    ok(diverged.ahead === 1 && diverged.behind === 2, `识别出分叉（ahead=${diverged.ahead} behind=${diverged.behind}）`);
    ok(/未推送提交/.test(diverged.blocked), '分叉时明确拒绝自动更新');
    // 收尾：回到与远端一致（测试继续用干净状态）
    git(['reset', '--hard', 'origin/main'], work);
  }

  console.log('## 4. 服务层：check → pending → dismiss → 远端再前进 → 重新提示');
  {
    const svc = createUpdatesService({
      stateDir,
      components: () => [{ id: 'core', name: '本体', dir: work }],
      blockedReason: () => '',
    });
    let st = await svc.check({ fetch: true });
    ok(st.pendingCount === 0, '当前已是最新（pending=0）');

    fs.writeFileSync(path.join(other, 'c.txt'), 'c\n');
    git(['add', '.'], other);
    git(['commit', '-m', 'feat: add c'], other);
    git(['push', 'origin', 'main'], other);

    st = await svc.check({ fetch: true });
    ok(st.pendingCount === 1 && st.showPrompt === true, '远端新提交 → pending=1、showPrompt=true');
    ok(st.results[0].behind === 1, 'behind=1');

    const dismissed = svc.dismiss(['core']);
    ok(dismissed.showPrompt === false && dismissed.pendingCount === 0, '「不再提示本次」后不再 prompt');
    ok(fs.existsSync(path.join(stateDir, 'updates.json')), 'dismiss 落盘到 updates.json');

    fs.writeFileSync(path.join(other, 'd.txt'), 'd\n');
    git(['add', '.'], other);
    git(['commit', '-m', 'feat: add d'], other);
    git(['push', 'origin', 'main'], other);
    st = await svc.check({ fetch: true });
    ok(st.showPrompt === true, '远端又有新提交 → 重新提示（dismiss 只对上一版生效）');
  }

  console.log('## 5. 应用更新：只快进，且拒绝被 blocked 的组件');
  {
    const svc = createUpdatesService({
      stateDir,
      components: () => [{ id: 'core', name: '本体', dir: work }],
      blockedReason: () => '',
    });
    await svc.check({ fetch: true });
    const headBefore = git(['rev-parse', 'HEAD'], work);
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1'; // 测试里不起"等宿主退出"的进程
    const result = await svc.apply(['core']);
    delete process.env.SURFCORE_UPDATE_NO_SPAWN;
    // 2026-10-29 起：暂存（staged）不算"已更新"，单列为 pendingRestart；updated 只统计真正落地的
    ok(result.ok === true && result.updated === 0 && result.pendingRestart === 1,
      `git 更新排队成功（updated=${result.updated} pendingRestart=${result.pendingRestart}）`);
    // 2026-10-28 起：git 更新也必须等宿主退出后再 merge（进程内 merge 会动正在加载的文件）
    ok(git(['rev-parse', 'HEAD'], work) === headBefore, '宿主进程内不改工作区（更新排队到退出后）');
    ok(result.results[0]?.staged === true, 'git 更新标记为 staged（退出后应用）');
    ok(result.restartRequired === true, '提示需要重启');
    const afterStage = await svc.check({ fetch: true });
    ok(afterStage.pendingCount === 0, 'staged 后再次检查不再把同一更新当 pending');
    ok(afterStage.lastApply?.status === 'pending_restart', 'staged 状态显示为等待重启');

    // blocked 的组件不动
    const blockedSvc = createUpdatesService({
      stateDir: path.join(base, 'state2'),
      components: () => [{ id: 'core', name: '本体', dir: work }],
      blockedReason: () => '桌宠正在运行，先停止再更新',
    });
    fs.mkdirSync(path.join(base, 'state2'), { recursive: true });
    fs.writeFileSync(path.join(other, 'e.txt'), 'e\n');
    git(['add', '.'], other);
    git(['commit', '-m', 'feat: add e'], other);
    git(['push', 'origin', 'main'], other);
    await blockedSvc.check({ fetch: true });
    const blockedApply = await blockedSvc.apply(['core']);
    ok(blockedApply.ok === false && /正在运行/.test(blockedApply.results[0].error), '运行中的组件被拒绝更新');
  }

  console.log('## 7. 版本号比较（semver，不是字符串比较）');
  {
    ok(compareVersions('0.10.0', '0.9.0') === 1, '0.10.0 > 0.9.0');
    ok(compareVersions('0.2.0', '0.2.0') === 0, '同版本相等');
    ok(compareVersions('v0.3', '0.2.9') === 1, 'v 前缀照常比较');
    ok(compareVersions('1.0.0-beta', '1.0.0') === -1, '预发布低于正式版');
    ok(compareVersions('2', '1.9.9') === 1, '位数不同也能比');
  }

  console.log('## 8. release 通道：读已装版本 + 比 version.json（桌宠这类 zip 安装）');
  {
    const petDir = path.join(base, 'petapp');
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(path.join(petDir, 'package.json'), JSON.stringify({ name: 'feiyu-pet', version: '0.2.0' }));
    const pack = path.join(base, 'pet-pack.zip');
    fs.writeFileSync(pack, 'fake-zip-bytes');
    const sha = createHash('sha256').update(fs.readFileSync(pack)).digest('hex');
    const manifest = path.join(base, 'version.json');
    fs.writeFileSync(manifest, JSON.stringify({
      version: '0.3.0',
      notes: 'fix: 气泡不消失\nfeat: 专注模式',
      file: { url: `file://${pack.replace(/\\/g, '/')}`, sha256: sha, size: fs.statSync(pack).size },
    }));

    const component = {
      id: 'surfpet', name: '桌宠', dir: petDir, kind: 'release',
      versionUrl: `file://${manifest.replace(/\\/g, '/')}`, versionFile: 'package.json',
    };
    const checked = await inspectComponent(component, { fetch: true });
    ok(checked.available === true && checked.channel === 'release', 'release 通道可用');
    ok(checked.installedVersion === '0.2.0' && checked.latestVersion === '0.3.0', `读出已装/最新版本（${checked.installedVersion} → ${checked.latestVersion}）`);
    ok(checked.updateAvailable === true && checked.behind === 1, '版本更高 → 有更新');
    ok(checked.changelog.length === 2, 'notes 折成 changelog');

    // 装了新版后：不再提示
    fs.writeFileSync(path.join(petDir, 'package.json'), JSON.stringify({ name: 'feiyu-pet', version: '0.3.0' }));
    const upToDate = await inspectComponent(component, { fetch: true });
    ok(upToDate.updateAvailable === false, '已是最新时不提示');

    // 应用更新：下载 → sha256 校验 → 交给 installZip
    let received = null;
    let receivedBytes = null;
    let receivedExisted = false;
    const svc = createUpdatesService({
      stateDir: path.join(base, 'state-pet'),
      components: () => [{
        ...component,
        installZip: async (zipPath) => {
          received = zipPath;
          receivedExisted = fs.existsSync(zipPath);
          receivedBytes = receivedExisted ? fs.readFileSync(zipPath, 'utf8') : null;
          return { ok: true };
        },
      }],
      pluginLog: () => {},
    });
    fs.mkdirSync(path.join(base, 'state-pet'), { recursive: true });
    fs.writeFileSync(path.join(petDir, 'package.json'), JSON.stringify({ name: 'feiyu-pet', version: '0.2.0' }));
    await svc.check({ fetch: true });
    const applied = await svc.apply(['surfpet']);
    ok(applied.ok === true && applied.updated === 1, `release 更新成功（updated=${applied.updated}）`);
    ok(receivedExisted && receivedBytes === 'fake-zip-bytes', '安装器收到的就是下载好的包');
    ok(received && !fs.existsSync(received), '安装完成后临时包被清理');
  }

  console.log('## 9. release 通道：sha256 不对必须拒绝');
  {
    const dir = path.join(base, 'petapp2');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'p', version: '0.1.0' }));
    const pack = path.join(base, 'bad.zip');
    fs.writeFileSync(pack, 'tampered');
    const manifest = path.join(base, 'bad-version.json');
    fs.writeFileSync(manifest, JSON.stringify({
      version: '0.2.0',
      file: { url: `file://${pack.replace(/\\/g, '/')}`, sha256: 'deadbeef' },
    }));
    let called = false;
    const svc = createUpdatesService({
      stateDir: path.join(base, 'state-bad'),
      components: () => [{
        id: 'surfpet', name: '桌宠', dir: dir, kind: 'release',
        versionUrl: `file://${manifest.replace(/\\/g, '/')}`,
        installZip: async () => { called = true; return { ok: true }; },
      }],
    });
    fs.mkdirSync(path.join(base, 'state-bad'), { recursive: true });
    await svc.check({ fetch: true });
    const applied = await svc.apply(['surfpet']);
    ok(applied.ok === false && /校验失败/.test(applied.results[0].error), `校验失败被拒（${applied.results[0].error}）`);
    ok(called === false, '校验没过就不会调用安装器');
  }

  {
    const plain = path.join(base, 'not-a-repo');
    fs.mkdirSync(plain, { recursive: true });
    const r = await inspectComponent({ id: 'x', name: 'X', dir: plain }, { fetch: true });
    ok(r.available === false && /git/.test(r.reason), `不可查原因可读（${r.reason}）`);
    const svc = createUpdatesService({ stateDir, components: () => [{ id: 'x', name: 'X', dir: plain }] });
    const st = await svc.check({ fetch: false });
    ok(st.pendingCount === 0, '不可查的组件不会算进 pending');
  }
  {
    const updatesSrc = fs.readFileSync(new URL('../lib/updates.js', import.meta.url), 'utf8');
    const clientSrc = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');
    ok(updatesSrc.includes('stagedTargets'), 'staged 用下载前捕获的目标键，不能从 no-fetch 结果算 vnull');
    ok(updatesSrc.includes("phase: 'extract'") && updatesSrc.includes("'pending'"), '下载/解压/排队阶段可上报');
    ok(clientSrc.includes('phaseText') && clientSrc.includes('onStaged') && clientSrc.includes('dl.phase'),
      '进度条保留下载统计并区分阶段，staged 后弹重启提示');
  }
} finally {
  try { fs.rmSync(base, { recursive: true, force: true }); } catch {}
}

console.log(failures === 0 ? '\n✅ 组件更新回归通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
