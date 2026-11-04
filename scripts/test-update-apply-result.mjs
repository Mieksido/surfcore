// 第 2 步回归：更新失败必须说清原因与建议；“已排队”不等于“已更新”；
// 重启后能读到"上次更新结果"（失败/待重启/已应用未验证）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-apply-'));
let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label} ${extra}`); }
};

function makeTarget(name, version = '0.6.22', { withMeta = false } = {}) {
  const dir = path.join(base, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'surfcore', version }));
  if (withMeta) fs.writeFileSync(path.join(dir, '.installed-meta.json'), JSON.stringify({ version, sha: 'deadbeef' }));
  return dir;
}

function makeZip({ withManifest = true, extraMissing = [], corrupt = [], version = '0.7.0' } = {}) {
  const src = path.join(base, 'zip-src', 'surfcore-main');
  fs.rmSync(path.join(base, 'zip-src'), { recursive: true, force: true });
  fs.mkdirSync(path.join(src, 'plugins', 'surfcore'), { recursive: true });
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'surfcore', version }));
  fs.writeFileSync(path.join(src, 'plugins', 'surfcore', 'package.json'), JSON.stringify({ name: 'surfcore-plugin', version }));
  if (withManifest) {
    const files = {};
    const walk = (dir, rel = '') => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) { walk(path.join(dir, e.name), r); continue; }
        files[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, e.name))).digest('hex');
      }
    };
    walk(src);
    fs.mkdirSync(path.join(src, 'release'), { recursive: true });
    for (const rel of extraMissing) files[rel] = '0'.repeat(64);
    for (const rel of corrupt) if (files[rel]) files[rel] = 'f'.repeat(64);
    fs.writeFileSync(path.join(src, 'release', 'install-manifest.json'), JSON.stringify({ schemaVersion: 1, version, files }));
  }
  const zip = path.join(base, 'pkg.zip');
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Compress-Archive -Path '${src}' -DestinationPath '${zip}' -Force`], { windowsHide: true });
  return fs.readFileSync(zip);
}

const REMOTE_SHA = '1ad2042aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ZIP = makeZip();

function stubFetch(handler) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (handler) {
      const r = await handler(u, opts);
      if (r !== undefined) return r;
    }
    if (u.includes('/commits/main')) return new Response(JSON.stringify({ sha: REMOTE_SHA }), { status: 200 });
    if (u.includes('/contents/package.json')) {
      const content = Buffer.from(JSON.stringify({ version: '0.7.0' }), 'utf8').toString('base64');
      return new Response(JSON.stringify({ content }), { status: 200 });
    }
    if (u.includes('/archive/')) return new Response(ZIP, { status: 200 });
    return new Response('{}', { status: 200 });
  };
  return () => { globalThis.fetch = real; };
}

try {
  const { createUpdatesService } = await import('../plugins/surfcore/lib/updates.js');

  const mkService = (dir, extra = {}) => createUpdatesService({
    stateDir: path.join(dir, '.state'),
    components: () => [{
      id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/surfcore-test',
      archiveUrl: 'https://example.com/archive/main.zip', ...extra,
    }],
    pluginLog: () => {},
  });

  // 0) 下载失败分类（2026-10-31：慢网超时被误报成 write-failed）
  {
    const { classifyDownloadFailure } = await import('../plugins/surfcore/lib/updates.js');
    ok(classifyDownloadFailure({ aborted: true }).code === 'download.timeout', 'abort → download.timeout');
    ok(classifyDownloadFailure({ httpStatus: 404 }).code === 'download.http-404', 'HTTP 404 → download.http-404');
    ok(classifyDownloadFailure({ fsError: true }).code === 'download.write-failed', 'fs 错误 → download.write-failed');
    ok(classifyDownloadFailure({ error: 'ECONNRESET' }).code === 'download.network', '网络错误 → download.network');
    ok(/网络太慢/.test(classifyDownloadFailure({ aborted: true }).hint), '超时的 hint 指向网络而不是磁盘');
  }

  // 1) 下载 404 → 失败带 code/hint
  {
    const dir = makeTarget('dl-404', '0.6.22', { withMeta: true });
    const svc = mkService(dir);
    const restore = stubFetch(async (u) => (u.includes('/archive/') ? new Response('nope', { status: 404 }) : undefined));
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.ok === false, '404：ok=false');
      ok(row.code === 'download.http-404', '404：code=download.http-404', String(row.code));
      ok(typeof row.hint === 'string' && row.hint.length > 0, '404：带建议', String(row.hint));
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 2) 下载超时 → download.timeout
  {
    const dir = makeTarget('dl-timeout', '0.6.22', { withMeta: true });
    const svc = mkService(dir);
    const restore = stubFetch(async (u) => {
      if (u.includes('/archive/')) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        throw err;
      }
      return undefined;
    });
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.code === 'download.timeout', '超时：code=download.timeout', String(row.code));
      ok(row.status === 'failed', '超时：status=failed');
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 3) 包损坏（不是 zip）→ verify.unzip-failed
  {
    const dir = makeTarget('bad-zip', '0.6.22', { withMeta: true });
    const svc = mkService(dir);
    const restore = stubFetch(async (u) => (u.includes('/archive/') ? new Response(Buffer.from('this is not a zip'), { status: 200 }) : undefined));
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.ok === false, '坏包：ok=false');
      // 坏包可能表现为"解压报错"或"解压出空目录"，两者都属于校验阶段失败
      ok(row.code === 'verify.unzip-failed' || row.code === 'verify.bad-archive', '坏包：code 属于校验失败', String(row.code));
      ok(row.stage === 'verify', '坏包：stage=verify', String(row.stage));
      ok(typeof row.hint === 'string' && row.hint.length > 0, '坏包：带建议');
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 4) 更新助手缺失 → stage.helper-missing
  {
    const dir = makeTarget('no-helper', '0.6.22', { withMeta: true });
    const svc = mkService(dir);
    const restore = stubFetch();
    process.env.SURFCORE_UPDATE_HELPER = path.join(base, 'no-such-helper.mjs');
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.ok === false, '助手缺失：ok=false');
      ok(row.code === 'stage.helper-missing', '助手缺失：code=stage.helper-missing', String(row.code));
      ok(typeof row.hint === 'string' && row.hint.length > 0, '助手缺失：带建议');
    } finally { restore(); delete process.env.SURFCORE_UPDATE_HELPER; }
  }

  // 5) 正常暂存 → pending_restart（不是已更新）
  {
    const dir = makeTarget('staged', '0.6.22', { withMeta: true });
    const svc = mkService(dir);
    const restore = stubFetch();
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.ok === true, '暂存：ok=true');
      ok(row.status === 'pending_restart', '暂存：status=pending_restart', String(row.status));
      ok(/尚未更新/.test(String(row.message)), '暂存：文案含"尚未更新"', String(row.message));
      ok(r.updated === 0, '暂存：updated=0（不算已更新）', String(r.updated));
      ok(r.pendingRestart === 1, '暂存：pendingRestart=1');
      ok(fs.existsSync(path.join(dir, '.state', 'updates-pending.json')), '暂存：pending 文件已写');
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 3.4) 清单哈希与包内内容不符（发布包自身不一致）→ 确定性失败，别让用户反复点
  {
    const ZIP_BAD_HASH = makeZip({ corrupt: ['package.json'] });
    const dir = makeTarget('bad-hash', '0.6.22', { withMeta: true });
    const svc = mkService(dir);
    const restore = stubFetch(async (u) => (u.includes('/archive/') ? new Response(ZIP_BAD_HASH, { status: 200 }) : undefined));
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.ok === false && row.code === 'verify.staging-mismatch', '哈希不符：code=verify.staging-mismatch', JSON.stringify(row));
      ok(row.deterministic === true, '哈希不符：标为确定性失败（重试无效）', String(row.deterministic));
      ok(/\d+ 个文件哈希不符/.test(String(row.reason)), '哈希不符：原因带数量', String(row.reason));
      ok(String(row.hint).includes('手动下载'), '哈希不符：建议手动下载', String(row.hint));
      const la = svc.status().lastApply;
      ok(la?.deterministic === true && Number(la?.mismatchCount) >= 1, '常驻失败状态带 mismatchCount', JSON.stringify(la));
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 3.5) 清单里有包内不存在的文件（旧清单/分支差异）→ 不能因此判失败
  {
    const ZIP_MISSING = makeZip({ extraMissing: ['_backups/should-not-exist.json', 'audio/cloud-test.wav'] });
    const dir = makeTarget('staging-missing', '0.6.22', { withMeta: true });
    const svc = mkService(dir);
    const restore = stubFetch(async (u) => (u.includes('/archive/') ? new Response(ZIP_MISSING, { status: 200 }) : undefined));
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      ok(r.results[0].ok === true, '清单缺文件：不判失败（交集校验）', JSON.stringify(r.results[0]));
      ok(r.results[0].status === 'pending_restart', '清单缺文件：仍能进入待重启');
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 3.55) 下载走 codeload 直连；codeload 失败自动换 github 归档（不押单一域名）
  {
    const dir = makeTarget('codeload', '0.6.22', { withMeta: true });
    const svc = mkService(dir, { archiveUrl: '' });
    const seen = [];
    const restore = stubFetch(async (u) => {
      if (u.includes('codeload.github.com')) { seen.push(u); return new Response('down', { status: 500 }); }
      if (u.includes('/archive/refs/tags/')) { seen.push(u); return new Response(ZIP, { status: 200 }); }
      if (u.includes('/releases/latest')) return new Response(null, { status: 302, headers: { location: 'https://github.com/Mieksido/surfcore-test/releases/tag/v0.7.0' } });
      return undefined;
    });
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      ok(r.results[0].ok === true, 'codeload 失败后换归档成功', JSON.stringify(r.results[0]));
      ok(seen[0].includes('codeload.github.com'), '首先尝试 codeload 直连', seen[0] || '');
      ok(seen.some((u) => u.includes('github.com/Mieksido') && u.includes('/archive/')), '失败后回退 github 归档', seen.join(' | '));
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 3.56) 目标只有提交号（没有版本）→ 阻止自动更新，不装"版本不变的快照"
  {
    const dir = makeTarget('no-semver', '0.6.22', { withMeta: true });
    fs.writeFileSync(path.join(dir, '.installed-meta.json'), JSON.stringify({ version: '0.6.22', sha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }));
    const svc = mkService(dir, { archiveUrl: '' });
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases/latest')) return new Response('', { status: 404 });
      if (u.includes('/tags?')) return new Response('[]', { status: 200 });
      return undefined;
    });
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      const blocked = row.ok === false && row.code === 'version-unknown';
      const noPending = row.ok === false && (r.results[0].status === 'blocked');
      ok(blocked || noPending, '没有版本号 → 阻止自动更新', JSON.stringify(row));
      ok(/未发版|没有对应的发布版本/.test(String(row.reason)), '原因说明"没有发布版本"', String(row.reason));
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 3.55) 慢网断流：空闲超时归为 download.timeout，并且继续试下一个候选（镜像回退）
  {
    const dir = makeTarget('slow-dl', '0.6.22', { withMeta: true });
    const svc = mkService(dir, { archiveUrl: '' });
    const seen = [];
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases/latest')) return new Response(null, { status: 302, headers: { location: 'https://github.com/Mieksido/surfcore-test/releases/tag/v0.7.0' } });
      if (!u.includes('/zip/') && !u.includes('/archive/') && !u.startsWith('https://gh-')) return undefined;
      seen.push(u);
      // 先给一小段数据，然后长时间不再给 → 触发空闲超时
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array([80, 75, 3, 4]));
          setTimeout(() => c.error(Object.assign(new Error('aborted'), { name: 'AbortError' })), 120);
        },
      });
      return new Response(stream, { status: 200 });
    });
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    process.env.SURFCORE_UPDATE_IDLE_TIMEOUT_MS = '40';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.ok === false && row.code === 'download.timeout', '慢网断流 → download.timeout', JSON.stringify(row));
      ok(/网络太慢|断流/.test(String(row.hint)), '超时 hint 指向网络', String(row.hint));
      ok(seen.length >= 2, 'body 失败后继续试了下一个候选（镜像回退）', seen.join(' | '));
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; delete process.env.SURFCORE_UPDATE_IDLE_TIMEOUT_MS; }
  }

  // 3.555) 下载进度：status().download 应能看到 bytes/total/percent/speed
  {
    const dir = makeTarget('progress', '0.6.22', { withMeta: true });
    const svc = mkService(dir, { archiveUrl: '' });
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases/latest')) return new Response(null, { status: 302, headers: { location: 'https://github.com/Mieksido/surfcore-test/releases/tag/v0.7.0' } });
      if (!u.includes('/zip/') && !u.includes('/archive/')) return undefined;
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(400));
          setTimeout(() => c.enqueue(new Uint8Array(300)), 80);
          setTimeout(() => { try { c.close(); } catch {} }, 160);
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-length': '1000' } });
    });
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const p = svc.apply(['surfcore']);
      let mid = null;
      for (let i = 0; i < 150 && !mid?.active; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
        const d = svc.status().download;
        if (d && d.bytes > 0) mid = d;
      }
      ok(mid?.active === true && mid.bytes > 0 && mid.total === 1000, '下载中能看到已下载/总量', JSON.stringify(mid));
      ok(mid.percent === 40 || mid.percent === 30 || (mid.percent > 0 && mid.percent < 100), '百分比按 Content-Length 计算', String(mid.percent));
      const r = await p;
      ok(r.results[0].ok === false, '坏包最终仍会失败（进度不影响失败可见）');
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 3.56) 助手过期：.failed(code=stage.expired) 要被 status 读出来并给“重新下载”建议
  {
    const dir = makeTarget('expired', '0.6.22', { withMeta: true });
    const stateDir = path.join(dir, '.state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'updates-pending.json.failed'), JSON.stringify({
      component: 'surfcore', code: 'stage.expired', error: '等 DSH 退出超时（60 分钟）：本次暂存已过期，需要重新下载', at: new Date().toISOString(),
    }));
    const svc = createUpdatesService({
      stateDir,
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/t' }],
      pluginLog: () => {},
    });
    const la = svc.status().lastApply;
    ok(la?.status === 'failed' && la.code === 'stage.expired', '过期暂存 → lastApply.code=stage.expired', JSON.stringify(la));
    ok(/过期|重新下载/.test(String(la.hint)), '过期提示让用户重新下载', String(la.hint));
  }

  // 3.6) 有版本号时下载 tag 归档（main.zip 会漂移，和清单对不上）
  {
    const dir = makeTarget('tag-url', '0.6.22', { withMeta: true });
    const svc = mkService(dir, { archiveUrl: '' });
    const seen = [];
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases/latest')) {
        return new Response(null, { status: 302, headers: { location: 'https://github.com/Mieksido/surfcore-test/releases/tag/v0.7.0' } });
      }
      if (u.includes('/zip/') || u.includes('/archive/')) { seen.push(u); return new Response(ZIP, { status: 200 }); }
      return undefined;
    });
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      await svc.apply(['surfcore']);
      ok(seen.some((u) => /(codeload\.github\.com\/.*\/zip\/refs\/tags\/v0\.7\.0|\/archive\/refs\/tags\/v0\.7\.0\.zip$)/.test(u)), '有版本号时下载 tag 归档', seen.join(' | '));
      ok(!seen.some((u) => u.includes('/refs/heads/main.zip')), '不再下载分支归档');
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 3.7) 失败后必须清掉 staging（报告：每次留 11.8MB，点 10 次 100MB+）
  {
    const dir = makeTarget('cleanup', '0.6.22', { withMeta: true });
    const svc = mkService(dir);
    const restore = stubFetch(async (u) => (u.includes('/archive/') ? new Response('nope', { status: 500 }) : undefined));
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      await svc.apply(['surfcore']);
      const stagingDir = path.join(dir, '.state', 'staging');
      const left = fs.existsSync(stagingDir) ? fs.readdirSync(stagingDir) : [];
      ok(left.length === 0, '失败后 staging 已清理', JSON.stringify(left));
      const st = svc.status();
      ok(st.lastApply?.status === 'failed', '失败状态常驻（不靠 toast）', JSON.stringify(st.lastApply));
      ok(st.lastApply?.code === 'download.http-500', '常驻状态带 code', String(st.lastApply?.code));
      // 下载失败后 30 分钟内不再自动弹同一条（用户关一次不该下次检查又弹）
      ok((st.pending ?? []).length === 0, '失败后不再进待办（30 分钟退避）', JSON.stringify(st.pending));
      const persisted = JSON.parse(fs.readFileSync(path.join(dir, '.state', 'updates.json'), 'utf8'));
      ok(Boolean(persisted.applyBackoff?.surfcore), '退避状态已持久化', JSON.stringify(persisted.applyBackoff));
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 4.5b) 首次 zip 更新：用户显式确认后才允许，且必须先备份
  {
    const dir = makeTarget('first-install');
    const svc = mkService(dir);
    const restore = stubFetch();
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore'], { firstInstall: true });
      const row = r.results[0];
      ok(row.ok === true, '首次 zip 更新：显式确认后允许', JSON.stringify(row));
      ok(row.status === 'pending_restart', '首次 zip 更新：进入待重启', String(row.status));
      const backups = path.join(dir, '.state', 'backups');
      ok(fs.existsSync(backups) && fs.readdirSync(backups).length > 0, '首次 zip 更新：先备份');
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 4.5) 没有任何安装证据 → 阻止自动覆盖（不冒险）
  {
    const dir = makeTarget('no-evidence');
    const svc = mkService(dir);
    const restore = stubFetch();
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.ok === false && row.status === 'blocked', '无证据：blocked', JSON.stringify(row));
      ok(row.code === 'evidence-insufficient', '无证据：code=evidence-insufficient', String(row.code));
      ok(typeof row.hint === 'string' && row.hint.includes('手动'), '无证据：给手动下载建议', String(row.hint));
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 4.6) 有上次清单、但文件被本地改过 → 阻止（不覆盖用户改动）
  {
    const dir = makeTarget('modified', '0.6.22', { withMeta: true });
    fs.writeFileSync(path.join(dir, '.installed-manifest.json'), JSON.stringify({
      version: '0.6.22',
      files: { 'package.json': '0'.repeat(64) }, // 故意对不上
    }));
    const svc = mkService(dir);
    const restore = stubFetch();
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.ok === false && row.status === 'blocked', '改过的文件：blocked', JSON.stringify(row));
      ok(row.code === 'local-modifications', '改过的文件：code=local-modifications', String(row.code));
      ok(/package\.json/.test(String(row.reason)), '改过的文件：原因里列出文件', String(row.reason));
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 4.7) 回滚：从备份恢复文件并校验版本
  {
    const dir = makeTarget('rollback', '0.7.0', { withMeta: true });
    const oldPkg = JSON.stringify({ name: 'surfcore', version: '0.6.22' });
    const txn = 'surfcore-test';
    const bdir = path.join(dir, '.state', 'backups', txn, 'files');
    fs.mkdirSync(bdir, { recursive: true });
    fs.writeFileSync(path.join(bdir, 'package.json'), oldPkg);
    fs.writeFileSync(path.join(dir, '.state', 'backups', txn, 'manifest.json'), JSON.stringify({
      component: 'surfcore', from: '0.6.22', to: '0.7.0', txn,
      files: { 'package.json': crypto.createHash('sha256').update(oldPkg).digest('hex') },
      at: new Date().toISOString(),
    }));
    const svc = mkService(dir);
    const r = await svc.rollback('surfcore');
    ok(r.ok === true && r.status === 'rolled_back', '回滚：成功', JSON.stringify(r));
    const now = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
    ok(now === '0.6.22', '回滚：版本已恢复', now);
  }

  // 5.5) 更新助手跑完后校验：版本不符 → .failed(verify.version-mismatch)；一致 → 记录 verified
  {
    const { execFileSync } = await import('node:child_process');
    const helper = path.resolve('scripts/apply-update.mjs');
    const runHelper = (name, stagedVersion, toVersion, opts = {}) => {
      const target = makeTarget(name, '0.7.0', { withMeta: true });
      const staging = path.join(base, `${name}-staging`);
      fs.mkdirSync(path.join(staging, 'release'), { recursive: true });
      fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ name: 'surfcore', version: stagedVersion }));
      fs.writeFileSync(path.join(staging, 'release', 'install-manifest.json'), JSON.stringify({ version: stagedVersion, files: {} }));
      const stateDir = path.join(base, `${name}-state`);
      fs.mkdirSync(stateDir, { recursive: true });
      const pendingFile = path.join(stateDir, 'updates-pending.json');
      fs.writeFileSync(pendingFile, JSON.stringify({
        kind: 'zip', component: 'surfcore', target, staging, to: toVersion,
        waitPid: 999999, txn: name, from: '0.7.0', logFile: path.join(stateDir, 'apply.log'),
        meta: { version: toVersion, sha: REMOTE_SHA },
      }));
      if (opts.staleFailed) fs.writeFileSync(`${pendingFile}.failed`, JSON.stringify({ component: 'surfcore', error: '旧失败', code: 'apply.failed', at: '2020-01-01T00:00:00.000Z' }));
      let code = 0;
      try {
        execFileSync(process.execPath, [helper, '--pending', pendingFile], { stdio: 'ignore' });
      } catch (e) { code = e.status ?? 1; }
      return { target, stateDir, pendingFile, code };
    };

    const bad = runHelper('verify-mismatch', '9.9.8', '9.9.9');
    ok(bad.code !== 0, '助手：版本不符时非 0 退出', String(bad.code));
    ok(fs.existsSync(`${bad.pendingFile}.failed`), '助手：写 .failed 证据');
    const jf = JSON.parse(fs.readFileSync(`${bad.pendingFile}.failed`, 'utf8'));
    ok(jf.code === 'verify.version-mismatch', '助手：code=verify.version-mismatch', String(jf.code));
    ok(!fs.existsSync(bad.pendingFile), '助手：失败后删掉 pending（.failed 才是唯一真相）');

    const okRun = runHelper('verify-ok', '9.9.9', '9.9.9', { staleFailed: true });
    ok(okRun.code === 0, '助手：版本一致时成功退出', String(okRun.code));
    const applied = fs.readdirSync(path.join(okRun.stateDir, 'updates-applied')).filter((f) => f.endsWith('.json'));
    ok(applied.length === 1, '助手：写应用记录');
    const rec = JSON.parse(fs.readFileSync(path.join(okRun.stateDir, 'updates-applied', applied[0]), 'utf8'));
    ok(rec.verified === true && rec.version === '9.9.9', '助手：记录带 verified 与版本', JSON.stringify(rec));
    ok(fs.existsSync(path.join(okRun.target, '.installed-manifest.json')), '助手：写入安装清单副本');
    ok(!fs.existsSync(`${okRun.pendingFile}.failed`), '助手：成功后清掉旧 .failed（不会永远显示旧失败）');
  }

  // 5.55) 未知 kind：结构化失败，不默认当 zip
  {
    const { execFileSync } = await import('node:child_process');
    const helper = path.resolve('scripts/apply-update.mjs');
    const target = makeTarget('unknown-kind', '0.7.0', { withMeta: true });
    const stateDir = path.join(base, 'unknown-kind-state');
    fs.mkdirSync(stateDir, { recursive: true });
    const pendingFile = path.join(stateDir, 'updates-pending.json');
    fs.writeFileSync(pendingFile, JSON.stringify({ kind: 'weird', component: 'surfcore', target, to: '0.7.0', waitPid: 999999 }));
    let code = 0;
    try { execFileSync(process.execPath, [helper, '--pending', pendingFile], { stdio: 'ignore' }); } catch (e) { code = e.status ?? 1; }
    ok(code !== 0, '助手：未知 kind 非 0 退出', String(code));
    const jf = JSON.parse(fs.readFileSync(`${pendingFile}.failed`, 'utf8'));
    ok(jf.code === 'apply.unknown-kind', '助手：code=apply.unknown-kind', String(jf.code));
    ok(!fs.existsSync(pendingFile), '助手：未知 kind 也清掉 pending');
  }

  // 5.57) 清理 staging 时必须跳过 pending 正在用的目录
  {
    const dir = makeTarget('staging-pending', '0.8.6', { withMeta: true });
    const stateDir = path.join(dir, '.state');
    const keep = path.join(stateDir, 'staging', 'surfcore-keep');
    const drop = path.join(stateDir, 'staging', 'surfcore-drop');
    fs.mkdirSync(path.join(keep, 'surfcore-0.8.6-dev.4'), { recursive: true });
    fs.mkdirSync(drop, { recursive: true });
    fs.writeFileSync(path.join(keep, 'pkg.zip'), 'x');
    fs.writeFileSync(path.join(drop, 'pkg.zip'), 'x');
    const past = Date.now() - 4 * 24 * 3600_000;
    fs.utimesSync(keep, new Date(past), new Date(past));
    fs.utimesSync(drop, new Date(past), new Date(past));
    fs.writeFileSync(path.join(stateDir, 'updates-pending.json'), JSON.stringify({ kind: 'zip', staging: path.join(keep, 'surfcore-0.8.6-dev.4'), target: dir }));
    const svc = createUpdatesService({
      stateDir,
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/surfcore-test' }],
      pluginLog: () => {},
    });
    await svc.check({ fetch: false });
    ok(fs.existsSync(keep), '待重启的 staging 不会被清理');
    ok(!fs.existsSync(drop), '无引用的过期 staging 仍会被清理');
  }

  // 5.6) 磁盘版本变了 → 旧的检查结果要丢弃（否则弹窗显示 v0.7.3→旧提交）
  {
    const dir = makeTarget('stale-results', '0.7.5', { withMeta: true });
    const stateDir = path.join(dir, '.state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'updates.json'), JSON.stringify({
      lastCheckAt: Date.now(),
      results: [{
        id: 'surfcore', name: 'SurfCore 本体', dir, available: true,
        installedVersion: '0.7.3', latestVersion: 'db18896', updateAvailable: true,
      }],
    }));
    const svc = createUpdatesService({
      stateDir,
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/t' }],
      pluginLog: () => {},
    });
    const st = svc.status();
    ok((st.results ?? []).length === 0, '版本变了 → 旧结果被丢弃', JSON.stringify(st.results));
    ok((st.pending ?? []).length === 0, '版本变了 → 不再待更新（不会弹旧提示）');
  }

  // 6) 重启后读取"上次更新结果"
  {
    const dir = makeTarget('last-apply');
    const stateDir = path.join(dir, '.state');
    const svc = mkService(dir);

    fs.mkdirSync(path.join(stateDir, 'updates-applied'), { recursive: true });
    fs.writeFileSync(path.join(stateDir, 'updates-applied', '1.json'), JSON.stringify({ component: 'surfcore', to: '0.7.0', at: '2026-10-29T00:00:00.000Z' }));
    ok(svc.status().lastApply?.status === 'applied_unverified', '旧记录 → applied_unverified（不能直接叫成功）', JSON.stringify(svc.status().lastApply));

    fs.writeFileSync(path.join(stateDir, 'updates-pending.json'), JSON.stringify({ component: 'surfcore' }));
    ok(svc.status().lastApply?.status === 'pending_restart', '有 pending → pending_restart');

    fs.writeFileSync(path.join(stateDir, 'updates-pending.json.failed'), JSON.stringify({ component: 'surfcore', error: 'robocopy 失败（exit 8）', at: '2026-10-29T00:00:00.000Z' }));
    const la = svc.status().lastApply;
    ok(la?.status === 'failed', '有 .failed → failed', JSON.stringify(la));
    ok(/robocopy/.test(String(la.reason)), '.failed 原因可见', String(la.reason));
    ok(typeof la.hint === 'string' && la.hint.length > 0, '.failed 带建议');
  }

  // 7) 预发布比较：0.8.6 > 0.8.6-dev.2 > 0.8.6-dev.1；0.8.7-dev.1 > 0.8.6
  {
    const { compareVersions } = await import('../plugins/surfcore/lib/updates.js');
    ok(compareVersions('0.8.6', '0.8.6-dev.1') === 1, '稳定版高于同号 dev');
    ok(compareVersions('0.8.6-dev.2', '0.8.6-dev.1') === 1, 'dev.2 高于 dev.1');
    ok(compareVersions('0.8.7-dev.1', '0.8.6') === 1, '下一版的 dev 高于当前稳定版');
    ok(compareVersions('0.8.6-dev.1', '0.8.6') === -1, 'dev 低于同号稳定版');
  }

  // 8) 测试通道（dev）：只认 pre-release；从稳定版切换时允许安装一次 dev（channel-switch）
  {
    const dir = makeTarget('dev-channel', '0.8.6', { withMeta: true });
    const svc = createUpdatesService({
      stateDir: path.join(dir, '.state'),
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/surfcore-test' }],
      pluginLog: () => {},
      channel: () => 'dev',
    });
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases?per_page')) {
        return new Response(JSON.stringify([
          { tag_name: 'v0.8.5', prerelease: false },
          { tag_name: 'v0.8.6', prerelease: false },
          { tag_name: 'v0.8.6-dev.2', prerelease: true },
          { tag_name: 'v0.8.6-dev.10', prerelease: true },
        ]), { status: 200 });
      }
      return undefined;
    });
    try {
      const r = await svc.check({ fetch: true });
      const row = r.results[0];
      ok(row.channel === 'dev', '通道标记为 dev', JSON.stringify(row));
      ok(row.latestVersion === '0.8.6-dev.10', 'dev 构建按数字比较（dev.10 > dev.2）', String(row.latestVersion));
      ok(row.updateAvailable === true && row.code === 'channel-switch', '稳定版切 dev 允许安装一次', JSON.stringify(row));
      ok(r.channel === 'dev', 'status 暴露 channel');
    } finally { restore(); }
  }

  // 9) dev 通道在已装 dev 构建时按版本比较
  {
    const dir = makeTarget('dev-newer', '0.8.6-dev.1', { withMeta: true });
    const svc = createUpdatesService({
      stateDir: path.join(dir, '.state'),
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/surfcore-test' }],
      pluginLog: () => {},
      channel: () => 'dev',
    });
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases?per_page')) {
        return new Response(JSON.stringify([{ tag_name: 'v0.8.6-dev.3', prerelease: true }]), { status: 200 });
      }
      return undefined;
    });
    try {
      const r = await svc.check({ fetch: true });
      ok(r.results[0].latestVersion === '0.8.6-dev.3' && r.results[0].updateAvailable === true, '已装 dev.1 → 发现 dev.3', JSON.stringify(r.results[0]));
    } finally { restore(); }
  }


  // 10) 通道切换清空旧结果：main 不被 dev 的 pending 继续打扰
  {
    const dir = makeTarget('channel-reset', '0.8.6', { withMeta: true });
    const svc = createUpdatesService({
      stateDir: path.join(dir, '.state'),
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/surfcore-test' }],
      pluginLog: () => {},
      channel: () => 'dev',
    });
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases?per_page')) {
        return new Response(JSON.stringify([{ tag_name: 'v0.8.6-dev.1', prerelease: true }]), { status: 200 });
      }
      return undefined;
    });
    try {
      await svc.check({ fetch: true });
      ok(svc.status().pendingCount === 1, 'dev 检查后有 pending');
      svc.resetCheck();
      const st = svc.status();
      ok(st.pendingCount === 0 && st.showPrompt === false, '切换通道清空 pending/showPrompt（main 不被 dev 打扰）', JSON.stringify(st));
    } finally { restore(); }
  }

  // 11) main 通道完全不查 dev（不请求 releases?per_page）
  {
    const dir = makeTarget('stable-no-dev', '0.8.6', { withMeta: true });
    const svc = createUpdatesService({
      stateDir: path.join(dir, '.state'),
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/surfcore-test' }],
      pluginLog: () => {},
      channel: () => 'stable',
    });
    let devProbes = 0;
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases?per_page')) { devProbes += 1; return new Response('[]', { status: 200 }); }
      return undefined;
    });
    try {
      await svc.check({ fetch: true });
      ok(devProbes === 0, 'main 通道不探测 dev 预发布（不会被 dev 弹窗打扰）', String(devProbes));
    } finally { restore(); }
  }


  // 12) dev 通道必须走 zip，不能落到 git merge（2026-11-01 测试机反馈 spawn git ENOENT）
  {
    const dir = makeTarget('dev-apply', '0.8.6-dev.2', { withMeta: true });
    const devZip = makeZip({ version: '0.8.6-dev.3' });
    const svc = createUpdatesService({
      stateDir: path.join(dir, '.state'),
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/surfcore-test' }],
      pluginLog: () => {},
      channel: () => 'dev',
    });
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases?per_page')) {
        return new Response(JSON.stringify([{ tag_name: 'v0.8.6-dev.3', prerelease: true }]), { status: 200 });
      }
      if (u.includes('/zip/refs/tags/') || u.includes('/archive/')) return new Response(devZip, { status: 200 });
      if (u.includes('/contents/package.json')) {
        const content = Buffer.from(JSON.stringify({ version: '0.8.6-dev.3' }), 'utf8').toString('base64');
        return new Response(JSON.stringify({ content }), { status: 200 });
      }
      return undefined;
    });
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const r = await svc.apply(['surfcore']);
      const row = r.results[0];
      ok(row.ok === true && row.staged === true, 'dev 通道走 zip 并成功排队', JSON.stringify(row));
      ok(row.code !== 'apply.git-failed', '不再走 git merge', String(row.code));
      const last = svc.status().lastApply;
      ok(!last || last.code !== 'apply.failed', '不再回落 apply.failed', JSON.stringify(last));
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 13) 未知 channel 必须有结构化分支（apply 会先重新检查，直接构造 results 会被覆盖，
  //     这里用静态契约 + 运行时代码检查，防止以后又落到 git merge）
  {
    const source = fs.readFileSync(path.resolve('plugins/surfcore/lib/updates.js'), 'utf8');
    ok(source.includes("code: 'apply.unknown-channel'"), '未知 channel 有 apply.unknown-channel');
    ok(source.includes("if (report.channel === 'version' || report.channel === 'dev')"), 'dev 和 version 共用 zip 流水线');
    ok(source.includes('if (!report.channel) {'), '只有旧数据（没有 channel）才走 git 兜底');
  }

  // 14) 3 天前的 staging 会被清理（pkg.zip 残留）
  {
    const dir = makeTarget('staging-clean', '0.8.6', { withMeta: true });
    const stateDir = path.join(dir, '.state');
    const old = path.join(stateDir, 'staging', 'surfcore-old');
    fs.mkdirSync(old, { recursive: true });
    fs.writeFileSync(path.join(old, 'pkg.zip'), 'x');
    const past = Date.now() - 4 * 24 * 3600_000;
    fs.utimesSync(old, new Date(past), new Date(past));
    const svc = createUpdatesService({
      stateDir,
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/surfcore-test' }],
      pluginLog: () => {},
    });
    await svc.check({ fetch: false });
    ok(!fs.existsSync(old), '过期 staging 目录被清理');
  }


  // 15) 本地改动：默认确定性拦截；显式 overwriteModified 才备份并覆盖
  {
    const dir = makeTarget('local-mod', '0.7.0', { withMeta: true });
    fs.writeFileSync(path.join(dir, '.installed-meta.json'), JSON.stringify({ version: '0.7.0' }));
    const stateDir = path.join(dir, '.state');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.installed-manifest.json'), JSON.stringify({
      version: '0.7.0', files: { 'package.json': 'deadbeef' },
    }));
    const zip = makeZip({ version: '0.7.1' });
    const svc = createUpdatesService({
      stateDir,
      components: () => [{ id: 'surfcore', name: 'SurfCore 本体', dir, kind: 'version', versionRepo: 'Mieksido/surfcore-test-localmod' }],
      pluginLog: () => {},
    });
    const restore = stubFetch(async (u) => {
      if (u.includes('/contents/package.json')) {
        const content = Buffer.from(JSON.stringify({ version: '0.7.1' }), 'utf8').toString('base64');
        return new Response(JSON.stringify({ content }), { status: 200 });
      }
      if (u.includes('/zip/refs/tags/') || u.includes('/archive/')) return new Response(zip, { status: 200 });
      return undefined;
    });
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const blocked = await svc.apply(['surfcore']);
      const row = blocked.results[0];
      ok(row.code === 'local-modifications', '本地改动默认拦截', String(row.code));
      ok(row.deterministic === true, 'local-modifications 标记 deterministic');
      ok(row.diagnostics?.total === 1, '诊断带改动总数', JSON.stringify(row.diagnostics));
      ok(svc.status().lastApply?.deterministic === true, 'lastApply 记录确定性失败');
      const over = await svc.apply(['surfcore'], { overwriteModified: true });
      const okRow = over.results[0];
      ok(okRow.ok === true && okRow.staged === true, 'overwriteModified 后成功排队', JSON.stringify(okRow));
      const backups = fs.existsSync(path.join(stateDir, 'backups')) ? fs.readdirSync(path.join(stateDir, 'backups')) : [];
      const hasBackup = backups.some((txn) => fs.existsSync(path.join(stateDir, 'backups', txn, 'files', 'package.json')));
      ok(hasBackup, '覆盖前备份了被改文件');
    } finally { restore(); delete process.env.SURFCORE_UPDATE_NO_SPAWN; }
  }

  // 15.5) UI/API：首次 zip 更新必须有显式确认入口
  {
    const client = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');
    const index = fs.readFileSync(path.resolve('plugins/surfcore/lib/index.js'), 'utf8');
    ok(client.includes('firstInstall: true'), 'UI 会传 firstInstall');
    ok(client.includes('首次更新（先备份）'), 'UI 有首次更新按钮');
    ok(index.includes('firstInstall: body.firstInstall === true'), 'API 接收 firstInstall');
  }

} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
console.log('\n✅ test-update-apply-result 通过');
