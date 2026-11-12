/**
 * 平台包宿主（pack host）：发现 / 校验 / 安装 / 启用 / 卸载
 * ============================================================================
 * 这是"zip 可带走、可导入"的那一半。定位：**纯管道 + 机械校验**，不做业务判断。
 *
 * 包的形态 = **一个目录**（zip 解压出来就是它）：
 *
 *   packs/example/
 *     pack.json          ← 清单（唯一真相：发布人/名字/版本/协议/入口/权限）
 *     index.js           ← 入口：四块 + open(收) + send(发)
 *     adapter-private.js ← 平台私有模块（共享能力不放这里）
 *
 * 三条纪律：
 *   ① **清单与代码必须自洽**：代码里声明的发布人/名字/版本要和 pack.json 一致，
 *      不一致就拒绝（防止"包里说自己是官方"）
 *   ② **卸载不删除**：移进 _removed/，可恢复（旧代码的隔离纪律）
 *   ③ **默认不启用**：装进来只是"有了"，要用得显式打开
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { validatePack } from './index.js';
import { scanDir, explain } from './pack-rules.mjs';

export const PACK_MANIFEST = 'pack.json';
export const PROTOCOL = 1;

const ID_RE = /^[a-z][a-z0-9_-]{1,31}$/;

/** 校验清单（只看形状与自洽，不猜意图） */
export function validateManifest(manifest = {}, dirName = '') {
  const errors = [];
  const publisher = String(manifest.publisher ?? '').trim();
  const name = String(manifest.name ?? '').trim();

  if (!publisher) errors.push('缺少 publisher（谁做的）');
  if (!name) errors.push('缺少 name（它叫什么）');
  if (!ID_RE.test(name)) errors.push('name 必须是小写字母开头的 2~32 位标识');
  if (!String(manifest.version ?? '').match(/^\d+\.\d+\.\d+/)) errors.push('version 必须是 x.y.z');
  if (Number(manifest.protocol) !== PROTOCOL) errors.push(`protocol 必须是 ${PROTOCOL}`);
  if (!manifest.entry) errors.push('缺少 entry（入口文件）');
  if (dirName && name && dirName !== name) errors.push(`目录名（${dirName}）与 name（${name}）不一致`);
  if (manifest.trust !== undefined && !Array.isArray(manifest.trust)) errors.push('trust 必须是数组');
  if (Array.isArray(manifest.trust) && manifest.trust.some((x) => typeof x !== 'string')) {
    errors.push('trust 里每一项都必须是字符串');
  }
  if (manifest.requires !== undefined && !Array.isArray(manifest.requires)) errors.push('requires 必须是数组');
  if (Array.isArray(manifest.requires) && manifest.requires.some((x) => typeof x !== 'string' || !x)) {
    errors.push('requires 里每一项都必须是非空字符串');
  }

  return { ok: errors.length === 0, errors, id: `${publisher}/${name}`, publisher, name };
}

/** 发现：目录里有哪些包 */
export function discover(packsDir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(packsDir, { withFileTypes: true }); } catch { return out; }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const dir = path.join(packsDir, entry.name);
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(dir, PACK_MANIFEST), 'utf8').replace(/^\uFEFF/, '')); }
    catch { out.push({ dirName: entry.name, dir, ok: false, errors: ['读不到 pack.json 或不是合法 JSON'] }); continue; }

    const v = validateManifest(manifest, entry.name);
    const entryExists = Boolean(manifest?.entry) && fs.existsSync(path.join(dir, String(manifest.entry)));
    if (!entryExists) v.errors.push(`入口文件不存在：${manifest?.entry ?? '(未指定)'}`), v.ok = false;

    out.push({ dirName: entry.name, dir, manifest, ...v });
  }
  return out;
}

/** 装一个包：从目录复制到 packs/（zip 解压后调它即可） */
export function installFrom({ packsDir, sourceDir, now = () => Date.now() }) {
  const src = path.resolve(sourceDir);
  const manifestPath = path.join(src, PACK_MANIFEST);
  if (!fs.existsSync(manifestPath)) return { ok: false, errors: ['源目录里没有 pack.json'] };

  // ① 内容闸门（入站）：二进制/依赖目录/第三方运行时/凭据，一律不许落盘
  const content = scanDir(src);
  if (!content.ok) {
    return {
      ok: false,
      code: 'pack.forbidden-content',
      errors: [explain(content), ...content.hits.slice(0, 5).map((h) => `${h.path}（${h.id}）`)],
      hits: content.hits,
    };
  }

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return { ok: false, errors: ['pack.json 不是合法 JSON'] }; }

  const v = validateManifest(manifest, '');   // 先不比对目录名（源目录名可能不一样）
  if (!v.ok) return { ok: false, errors: v.errors };

  const target = path.join(packsDir, String(manifest.name));
  if (fs.existsSync(target)) return { ok: false, errors: [`已经装过同名包：${manifest.name}（先卸载再装）`] };

  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(src, target, { recursive: true });

  // 来源留痕：装的时候写死，之后可复核（谁装的、从哪来、清单指纹）
  const origin = {
    id: v.id,
    publisher: v.publisher,
    name: v.name,
    version: manifest.version,
    installedAt: now(),
    source: relOf(packsDir, src),
    manifestSha256: sha256(JSON.stringify(manifest)),
    trust: Array.isArray(manifest.trust) ? manifest.trust : [],
    requires: Array.isArray(manifest.requires) ? manifest.requires : [],
  };
  fs.writeFileSync(path.join(target, ORIGIN_FILE), JSON.stringify(origin, null, 2));

  return { ok: true, id: v.id, dir: target, installedAt: origin.installedAt, origin };
}

/** 只用于留痕的相对路径（不泄漏本机绝对路径） */
function relOf(from, target) {
  const r = path.relative(from, target);
  return r.startsWith('..') ? path.basename(target) : r.replace(/\\/g, '/');
}

/** 卸载：**不删除**，移进 _removed/（可恢复） */
export function uninstall({ packsDir, name, now = () => Date.now() }) {
  const src = path.join(packsDir, String(name));
  if (!fs.existsSync(src)) return { ok: false, errors: ['没有这个包'] };
  const trash = path.join(packsDir, '_removed');
  fs.mkdirSync(trash, { recursive: true });
  const dest = path.join(trash, `${name}-${now()}`);
  fs.renameSync(src, dest);
  return { ok: true, movedTo: dest };
}

/**
 * 加载一个包（动态 import），并校验"清单与代码自洽"。
 * @returns {{ok:boolean, pack?:object, errors?:string[]}}
 */
export async function loadPack(entry) {
  if (!entry?.ok) return { ok: false, errors: entry?.errors ?? ['清单不合格'] };

  // ② 内容闸门（加载前再查一次）：手工拷进 packs/ 的包也逃不掉
  const content = scanDir(entry.dir);
  if (!content.ok) {
    return { ok: false, code: 'pack.forbidden-content', errors: [explain(content), ...content.hits.slice(0, 5).map((h) => `${h.path}（${h.id}）`)] };
  }

  const file = path.join(entry.dir, String(entry.manifest.entry));
  let mod;
  try { mod = await import(`${pathToFileURL(file).href}?t=${Date.now()}`); }
  catch (error) { return { ok: false, errors: [`加载失败：${error?.message ?? error}`] }; }

  const pack = mod.default ?? mod;
  const shape = validatePack(pack);
  if (!shape.ok) return { ok: false, errors: shape.errors };

  // 自洽：代码里的身份必须与清单一致（防止"包里说自己是官方"）
  const id = pack.identity ?? {};
  const mismatch = [];
  if (String(id.publisher) !== String(entry.manifest.publisher)) mismatch.push(`publisher（清单 ${entry.manifest.publisher} / 代码 ${id.publisher}）`);
  if (String(id.name) !== String(entry.manifest.name)) mismatch.push(`name（清单 ${entry.manifest.name} / 代码 ${id.name}）`);
  if (String(id.version) !== String(entry.manifest.version)) mismatch.push(`version（清单 ${entry.manifest.version} / 代码 ${id.version}）`);
  if (mismatch.length) return { ok: false, errors: [`清单与代码不一致：${mismatch.join('；')}`] };

  return { ok: true, pack };
}

/** 宿主状态：哪些启用（默认全关） */
export function createHostState({ stateFile }) {
  function read() {
    try { return JSON.parse(fs.readFileSync(stateFile, 'utf8').replace(/^\uFEFF/, '')) ?? { enabled: {} }; }
    catch { return { enabled: {} }; }
  }
  function write(s) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(s, null, 2));
  }
  return {
    isEnabled(id) { return read().enabled?.[id] === true; },
    setEnabled(id, on) { const s = read(); s.enabled = { ...(s.enabled ?? {}), [id]: Boolean(on) }; write(s); return s.enabled[id]; },
    all() { return read().enabled ?? {}; },
  };
}

/* ── 来源留痕 / 政策 / 启用闸门 ───────────────────────────────────────
 * 三件东西，都是"证据"而不是"承诺"：
 *   _origin.json   包从哪来、什么时候装的、清单指纹是多少（装的时候写死，之后可复核）
 *   _policy.json   谁的包算可信（allowedPublishers）、未背书的要不要二次确认
 *   enablePack()   未背书的包，不给明确确认就不启用
 *
 * 铁律：这里只做机械判定，不认识任何具体渠道。
 */
export const POLICY_FILE = '_policy.json';
export const ORIGIN_FILE = '_origin.json';

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

/** 读政策；没有就用保守默认（只信自己的发布人 + 未背书要确认） */
export function readPolicy(packsDir) {
  const file = path.join(packsDir, POLICY_FILE);
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) ?? {}; } catch {}
  return {
    allowedPublishers: Array.isArray(raw.allowedPublishers) && raw.allowedPublishers.length
      ? raw.allowedPublishers.map(String)
      : ['surfcore'],
    requireAckForUnverified: raw.requireAckForUnverified !== false,
    notice: typeof raw.notice === 'string' ? raw.notice : '',
  };
}

/** 读某个包的来源记录；没有就 null（说明不是通过 installFrom 装的） */
export function readOrigin(packsDir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(packsDir, String(name), ORIGIN_FILE), 'utf8').replace(/^\uFEFF/, ''));
  } catch { return null; }
}

/** 这个包的发布人是否被背书 */
export function isVerified(packsDir, id) {
  const publisher = String(id).split('/')[0];
  return readPolicy(packsDir).allowedPublishers.includes(publisher);
}

/**
 * 启用闸门：未背书的包必须带 ack 才放行（fail-closed）。
 * @returns {{ok:boolean, verified:boolean, code?:string, errors?:string[]}}
 */
export function enablePack({ packsDir, stateFile, id, ack = false }) {
  const policy = readPolicy(packsDir);
  const verified = isVerified(packsDir, id);

  if (!verified && policy.requireAckForUnverified && ack !== true) {
    return {
      ok: false,
      verified,
      code: 'pack.needs-ack',
      errors: [
        `发布人「${String(id).split('/')[0]}」不在受信名单里（${policy.allowedPublishers.join(', ') || '空'}）。`,
        `确认要继续，请用 enablePack({ ack: true })；它会跑在你的进程里，能读你给的任何东西。`,
      ],
    };
  }

  const host = createHostState({ stateFile });
  host.setEnabled(id, true);
  if (policy.notice) return { ok: true, verified, notice: policy.notice };
  return { ok: true, verified };
}

/**
 * 一步到位：发现 → 只加载"已启用"的包。
 * @returns {{loaded:Array, skipped:Array, failed:Array}}
 */
export async function loadEnabled({ packsDir, stateFile }) {  const host = createHostState({ stateFile });
  const loaded = []; const skipped = []; const failed = [];

  for (const entry of discover(packsDir)) {
    if (!entry.ok) { failed.push({ id: entry.dirName, errors: entry.errors }); continue; }
    if (!host.isEnabled(entry.id)) { skipped.push({ id: entry.id, reason: 'not-enabled' }); continue; }
    const r = await loadPack(entry);
    if (r.ok) loaded.push({ id: entry.id, pack: r.pack, dir: entry.dir });
    else failed.push({ id: entry.id, errors: r.errors });
  }
  return { loaded, skipped, failed, host };
}
