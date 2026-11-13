#!/usr/bin/env node
// patch-dsh-session-guard.mjs — 给已安装的 DSH 打一个「坏会话只跳过、不炸服务」的字节级补丁。
//
// 背景（2026-10-22 真实事故）：
//   ~/.dsh/sessions/<项目目录>/session-<id>/session.v4.jsonl.zstd 里有一个「身份错位」的
//   会话文件（文件在 surface_core 目录，头部 cwd 却是 surfcore）。DSH 启动时
//   `@deepseek-ai/dsh-session-persistence-jsonl` 的 listArtifacts() 会逐个读取头部并校验
//   「物理路径 == 头部 cwd/id 推出来的路径」。校验失败时它抛的是**普通 Error**，
//   而 listArtifacts 只吞 `SessionFormatUnsupportedError` / `SessionPersistenceCorruptionError`
//   两类错误 —— 于是这一个坏文件让整个 list() 拒绝，workspace 服务起不来，
//   连锁导致 workspace-controller / session-controller / schedule / 插件全部「服务不可用」。
//
// 补丁内容（保持文件字节长度不变，因此 asar 头部/偏移/完整性都不用重算）：
//   把 `throw new Error(...)` 换成 `throw new SessionPersistenceCorruptionError(...)`，
//   让这个错误落进 listArtifacts 既有的「跳过损坏条目」分支；打开指定会话时仍会照常报错。
//
// 用法：
//   node scripts/patch-dsh-session-guard.mjs --check          # 看本机是否已打补丁（默认 asar 路径）
//   node scripts/patch-dsh-session-guard.mjs --apply          # 打补丁（自动备份 app.asar）
//   node scripts/patch-dsh-session-guard.mjs --apply --asar "D:\deepseek\resources\app.asar"
//   DSH 更新后补丁会消失，重跑 --check / --apply 即可（幂等）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ASAR_DEFAULT = 'D:\\deepseek\\resources\\app.asar';
export const TARGET = '/dsh/node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js';

const OLD = 'throw new Error(`corrupt session log "${path}": header id "${meta.id}" and cwd identify "${expectedPath}"`)';
const NEW_PREFIX = 'throw new SessionPersistenceCorruptionError(`';
const NEW_SUFFIX = '`)';
const NEW_MESSAGE = 'corrupt session log "${path}": cwd mismatch ${expectedPath}';

/** 构造与原文**等长**的替换串；长度不一致就抛错，绝不写文件。 */
export function buildReplacement() {
  const needed = OLD.length - NEW_PREFIX.length - NEW_SUFFIX.length;
  if (NEW_MESSAGE.length > needed) {
    throw new Error(`补丁消息太长：需要 ≤${needed} 字符，实际 ${NEW_MESSAGE.length}`);
  }
  const message = NEW_MESSAGE + ' '.repeat(needed - NEW_MESSAGE.length);
  const replacement = NEW_PREFIX + message + NEW_SUFFIX;
  if (replacement.length !== OLD.length) throw new Error(`内部错误：替换串长度 ${replacement.length} != ${OLD.length}`);
  return replacement;
}

function readAsarHeader(buf) {
  const head = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(16, 16 + head).toString('utf8'));
  return { head, data: 16 + head, json };
}

function findEntry(json, target) {
  const walk = (node, prefix) => {
    for (const [k, v] of Object.entries(node.files ?? {})) {
      const p = `${prefix}/${k}`;
      if (v.files) {
        const hit = walk(v, p);
        if (hit) return hit;
      } else if (p === target) {
        return { path: p, offset: Number(v.offset), size: Number(v.size) };
      }
    }
    return undefined;
  };
  return walk(json, '');
}

export function inspectBytes(buf) {
  const { data, json } = readAsarHeader(buf);
  const entry = findEntry(json, TARGET);
  if (!entry) return { status: 'missing-target' };
  const start = data + entry.offset;
  const text = buf.subarray(start, start + entry.size).toString('utf8');
  if (text.includes(buildReplacement())) return { status: 'patched', entry };
  const hits = text.split(OLD).length - 1;
  if (hits !== 1) return { status: 'unexpected', entry, hits };
  return { status: 'unpatched', entry, hits };
}

export function inspect(asarPath = ASAR_DEFAULT) {
  return { ...inspectBytes(fs.readFileSync(asarPath)), asarPath };
}

export function analyze(buf) {
  const { data, json } = readAsarHeader(buf);
  const entry = findEntry(json, TARGET);
  return { data, entry };
}

/** 在内存里打补丁：返回 { state, buffer }；state.status==='patched' 时 buffer 已含补丁。 */
export function patchBuffer(buf) {
  const state = inspectBytes(buf);
  if (state.status !== 'unpatched') return { state, buffer: buf };
  const { data } = analyze(buf);
  const start = data + state.entry.offset;
  const at = buf.subarray(start, start + state.entry.size).indexOf(OLD);
  if (at === -1) return { state: { status: 'unexpected', hits: 0 }, buffer: buf };
  const replacement = Buffer.from(buildReplacement(), 'utf8');
  if (replacement.length !== OLD.length) throw new Error('替换串长度不一致，拒绝写入');
  replacement.copy(buf, start + at);
  return { state, buffer: buf };
}

/** 运行中原地打补丁：只改发生变化的字节区间（asar 允许同长度写，只是不允许改名/删除）。 */
export function applyInPlace(asarPath = ASAR_DEFAULT) {
  const state = inspect(asarPath);
  if (state.status === 'patched') return { ...state, changed: false };
  if (state.status !== 'unpatched') return { ...state, changed: false };
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${asarPath}.bak-${stamp}`;
  fs.copyFileSync(asarPath, backup);
  const before = fs.readFileSync(asarPath);
  const buf = Buffer.from(before);
  const { state: patchedState } = patchBuffer(buf);
  if (patchedState.status !== 'unpatched') return { ...state, changed: false, error: `补丁失败：${patchedState.status}` };
  let start = -1;
  let end = -1;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] !== before[i]) { if (start === -1) start = i; end = i + 1; }
  }
  if (start === -1) return { ...state, changed: false, error: '没有检测到差异' };
  const fd = fs.openSync(asarPath, 'r+');
  try {
    fs.writeSync(fd, buf.subarray(start, end), 0, end - start, start);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  const after = inspect(asarPath);
  return { ...state, changed: after.status === 'patched', backup, bytesWritten: end - start, at: start, verify: after.status };
}

export function apply(asarPath = ASAR_DEFAULT, { dryRun = false } = {}) {
  const state = inspect(asarPath);
  if (state.status === 'patched') return { ...state, changed: false };
  if (state.status !== 'unpatched') return { ...state, changed: false };
  if (dryRun) return { ...state, changed: true, dryRun: true };
  const buf = fs.readFileSync(asarPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = `${asarPath}.bak-${stamp}`;
  fs.copyFileSync(asarPath, backup);
  const { state: patchedState } = patchBuffer(buf);
  if (patchedState.status !== 'unpatched') return { ...state, changed: false, error: `补丁失败：${patchedState.status}` };
  const tmp = `${asarPath}.tmp-guard`;
  fs.writeFileSync(tmp, buf);
  // 原子替换：先备份再换名（运行中的 Electron 会拒绝，见 install-session-guard.mjs）。
  fs.renameSync(asarPath, `${asarPath}.old-${stamp}`);
  fs.renameSync(tmp, asarPath);
  return { ...state, changed: true, backup, previous: `${asarPath}.old-${stamp}` };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const asarArg = args.indexOf('--asar');
  const asarPath = asarArg === -1 ? ASAR_DEFAULT : args[asarArg + 1];
  const outArg = args.indexOf('--out');
  if (outArg !== -1) {
    // 只生成补丁副本，绝不碰正在使用的 app.asar（用于「先做副本、验证后再替换」）。
    const out = args[outArg + 1];
    const state = inspect(asarPath);
    if (state.status !== 'unpatched') {
      console.log(JSON.stringify({ status: state.status }, null, 2));
      process.exit(1);
    }
    const buf = fs.readFileSync(asarPath);
    patchBuffer(buf);
    fs.writeFileSync(out, buf);
    const after = inspectBytes(fs.readFileSync(out));
    console.log(JSON.stringify({ out, bytes: buf.length, verify: after.status }, null, 2));
    process.exit(after.status === 'patched' ? 0 : 1);
  }
  const mode = args.includes('--apply-in-place') ? 'in-place' : args.includes('--apply') ? 'apply' : 'check';
  if (mode === 'in-place') {
    const r = applyInPlace(asarPath);
    console.log(JSON.stringify(r, null, 2));
    console.log(r.changed ? '[guard] 已原地打补丁（下一次启动 DSH 生效）。' : '[guard] 未修改。');
    process.exitCode = r.changed || r.status === 'patched' ? 0 : 1;
  } else if (mode === 'check') {
    const s = inspect(asarPath);
    console.log(`[guard] ${asarPath}`);
    console.log(`[guard] 状态：${s.status}`);
    if (s.status === 'patched') console.log('[guard] 补丁已在位，无需处理。');
    else if (s.status === 'unpatched') console.log('[guard] 未打补丁；运行 --apply 应用（会自动备份 app.asar）。');
    else if (s.status === 'missing-target') console.log('[guard] 找不到目标模块（DSH 版本可能变了，需重新定位）。');
    else console.log(`[guard] 原文命中 ${s.hits} 次（期望 1 次），版本可能已变化，拒绝自动修改。`);
    process.exitCode = s.status === 'patched' ? 0 : 1;
  } else {
    const r = apply(asarPath);
    console.log(JSON.stringify(r, null, 2));
    if (r.changed) console.log(`[guard] 已打补丁。旧 asar 保留为 ${r.previous}；重启 DSH 后生效。`);
    else console.log(`[guard] 未修改（状态：${r.status}）。`);
    process.exitCode = r.changed || r.status === 'patched' ? 0 : 1;
  }
}
