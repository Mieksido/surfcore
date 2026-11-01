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

function makeZip({ withManifest = true, extraMissing = [], corrupt = [] } = {}) {
  const src = path.join(base, 'zip-src', 'surfcore-main');
  fs.rmSync(path.join(base, 'zip-src'), { recursive: true, force: true });
  fs.mkdirSync(path.join(src, 'plugins', 'surfcore'), { recursive: true });
  fs.writeFileSync(path.join(src, 'package.json'), JSON.stringify({ name: 'surfcore', version: '0.7.0' }));
  fs.writeFileSync(path.join(src, 'plugins', 'surfcore', 'package.json'), JSON.stringify({ name: 'surfcore-plugin', version: '0.7.0' }));
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
    fs.writeFileSync(path.join(src, 'release', 'install-manifest.json'), JSON.stringify({ schemaVersion: 1, version: '0.7.0', files }));
  }
  const zip = path.join(base, 'pkg.zip');
  if (process.platform === 'win32') {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Compress-Archive -Path '${src.replaceAll("'", "''")}' -DestinationPath '${zip.replaceAll("'", "''")}' -Force`], { windowsHide: true });
  } else {
    // zip updates an existing archive; remove the disposable fixture first so
    // a previous scenario cannot leak entries into the next fixture.
    fs.rmSync(zip, { force: true });
    execFileSync('zip', ['-q', '-r', zip, path.basename(src)], { cwd: path.dirname(src) });
  }
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

  // POSIX compatibility with the upstream streaming updater: a failed body
  // must fall back to a valid multi-chunk ZIP and discard the partial file.
  {
    const dir = makeTarget('stream-body-fallback', '0.6.22', { withMeta: true });
    const svc = mkService(dir, { archiveUrl: '' });
    const seen = [];
    const restore = stubFetch(async (u) => {
      if (u.includes('/releases/latest')) return new Response(null, { status: 302, headers: { location: 'https://github.com/Mieksido/surfcore-test/releases/tag/v0.7.0' } });
      if (!u.includes('/zip/') && !u.includes('/archive/')) return undefined;
      seen.push(u);
      const stream = new ReadableStream({
        start(controller) {
          if (seen.length === 1) {
            controller.enqueue(ZIP.subarray(0, 4));
            queueMicrotask(() => controller.error(new Error('fixture interrupted body')));
          } else {
            for (let i = 0; i < ZIP.length; i += 73) controller.enqueue(ZIP.subarray(i, i + 73));
            controller.close();
          }
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-length': String(ZIP.length) } });
    });
    process.env.SURFCORE_UPDATE_NO_SPAWN = '1';
    try {
      await svc.check({ fetch: true });
      const result = await svc.apply(['surfcore']);
      ok(seen.length >= 2, '流式 body 失败后尝试下一个候选');
      ok(result.results[0].ok === true && result.results[0].status === 'pending_restart', '多块有效 ZIP 能完成校验和暂存', JSON.stringify(result.results[0]));
      const progress = svc.status().download;
      ok(progress?.active === false && progress.bytes === ZIP.length, '重试下载丢弃残片，字节数等于完整 ZIP', JSON.stringify(progress));
      ok(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version === '0.6.22', '暂存阶段不提前覆盖安装目标');
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
    const runHelper = (name, stagedVersion, toVersion) => {
      const target = makeTarget(name, '0.7.0', { withMeta: true });
      const staging = path.join(base, `${name}-staging`);
      fs.mkdirSync(path.join(staging, 'release'), { recursive: true });
      fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ name: 'surfcore', version: stagedVersion }));
      fs.writeFileSync(path.join(staging, 'release', 'install-manifest.json'), JSON.stringify({ version: stagedVersion, files: {} }));
      // Package attempts to overwrite private data; helper must preserve it.
      for (const rel of ['config.json', 'bili.config.json', 'state/private.json', 'node_modules/private.json', 'tmp-update-old/private.json']) {
        for (const [root, value] of [[target, 'PRIVATE'], [staging, 'PACKAGE']]) {
          fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
          fs.writeFileSync(path.join(root, rel), value);
        }
      }
      fs.writeFileSync(path.join(target, 'user-extra.txt'), 'KEEP');
      if (name === 'verify-target-link') {
        fs.unlinkSync(path.join(target, 'package.json'));
        fs.symlinkSync(path.join(base, 'outside-not-created.json'), path.join(target, 'package.json'));
      }
      if (name === 'verify-link') {
        fs.symlinkSync(path.join(base, 'outside'), path.join(staging, 'escape'));
      }
      const stateDir = path.join(base, `${name}-state`);
      fs.mkdirSync(stateDir, { recursive: true });
      const pendingFile = path.join(stateDir, 'updates-pending.json');
      fs.writeFileSync(pendingFile, JSON.stringify({
        kind: 'zip', component: 'surfcore', target, staging, to: toVersion,
        waitPid: 999999, txn: name, from: '0.7.0', logFile: path.join(stateDir, 'apply.log'),
        meta: { version: toVersion, sha: REMOTE_SHA },
      }));
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

    const okRun = runHelper('verify-ok', '9.9.9', '9.9.9');
    ok(okRun.code === 0, '助手：版本一致时成功退出', String(okRun.code));
    const applied = fs.readdirSync(path.join(okRun.stateDir, 'updates-applied')).filter((f) => f.endsWith('.json'));
    ok(applied.length === 1, '助手：写应用记录');
    const rec = JSON.parse(fs.readFileSync(path.join(okRun.stateDir, 'updates-applied', applied[0]), 'utf8'));
    ok(rec.verified === true && rec.version === '9.9.9', '助手：记录带 verified 与版本', JSON.stringify(rec));
    ok(fs.existsSync(path.join(okRun.target, '.installed-manifest.json')), '助手：写入安装清单副本');
    for (const rel of ['config.json', 'bili.config.json', 'state/private.json', 'node_modules/private.json', 'tmp-update-old/private.json']) {
      ok(fs.readFileSync(path.join(okRun.target, rel), 'utf8') === 'PRIVATE', `助手：保护 ${rel}`);
    }
    ok(fs.readFileSync(path.join(okRun.target, 'user-extra.txt'), 'utf8') === 'KEEP', '助手：保留目标额外文件');
    if (process.platform !== 'win32') {
      const linked = runHelper('verify-link', '9.9.9', '9.9.9');
      const failure = JSON.parse(fs.readFileSync(`${linked.pendingFile}.failed`, 'utf8'));
      ok(linked.code !== 0 && failure.code === 'apply.copy-failed' && Boolean(failure.hint), '助手：符号链接拒绝带 code/hint');
      ok(JSON.parse(fs.readFileSync(path.join(linked.target, 'package.json'), 'utf8')).version === '0.7.0', '助手：拒绝链接前没有覆盖目标');
      const targetLink = runHelper('verify-target-link', '9.9.9', '9.9.9');
      const targetFailure = JSON.parse(fs.readFileSync(`${targetLink.pendingFile}.failed`, 'utf8'));
      ok(targetLink.code !== 0 && targetFailure.code === 'apply.copy-failed' && Boolean(targetFailure.hint), '助手：拒绝目标悬空链接并报告 code/hint');
      ok(!fs.existsSync(path.join(base, 'outside-not-created.json')), '助手：没有经悬空链接写出目录');

    }

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
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
console.log('\n✅ test-update-apply-result 通过');
