/**
 * 构建 client.js：把三份真数据打进去（壳只陈列，不推断）
 *   ① packs/<name>/pack.json             小适配器清单（名字/版本/协议/信任）
 *   ② docs/persona-core/capability-map.json  内核各区块的真实能力与状态
 *   ③ kernel/settings/limits.js + 状态文件     可调设置项（当前值/代价）
 *
 * 跑法：node build.mjs [--root <surfcore-persona-core 路径>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const i = args.indexOf('--root');
const root = path.resolve(i >= 0 ? args[i + 1] : path.join(here, '..', 'surfcore-persona-core'));

const readJson = (p, fallback) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
  catch { return fallback; }
};

/* ── ① 小适配器清单 ─────────────────────────────────────────────── */
const packsDir = path.join(root, 'packs');
if (!fs.existsSync(packsDir)) { console.error(`找不到 packs：${packsDir}`); process.exit(1); }
const enabled = readJson(path.join(root, 'state', 'persona-core', 'packs-state.json'), {})?.enabled ?? {};

const adapters = [];
for (const entry of fs.readdirSync(packsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const m = readJson(path.join(packsDir, entry.name, 'pack.json'), null);
  if (!m) continue;
  const id = `${m.publisher}/${m.name}`;
  adapters.push({
    id,
    name: String(m.name ?? entry.name),
    publisher: String(m.publisher ?? '?'),
    version: String(m.version ?? '0.0.0'),
    protocol: Number(m.protocol) || 1,
    entry: String(m.entry ?? ''),
    trust: Array.isArray(m.trust) ? m.trust.map(String) : [],
    requires: Array.isArray(m.requires) ? m.requires.map(String) : [],
    enabled: enabled[id] === true,
  });
}
adapters.sort((a, b) => a.name.localeCompare(b.name));

/* ── ①b 用户丢进来的扩展 zip（两个目录都扫：UI 自己的 imports/ 和仓库的 imports/） ── */
const imports = [];
const seenZip = new Set();
for (const dir of [path.join(here, 'imports'), path.join(root, 'imports')]) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!f.isFile() || !/\.zip$/i.test(f.name) || seenZip.has(f.name)) continue;
    seenZip.add(f.name);
    const st = fs.statSync(path.join(dir, f.name));
    imports.push({
      file: f.name,
      bytes: st.size,
      at: st.mtime.toISOString().slice(0, 16).replace('T', ' '),
      from: dir === path.join(here, 'imports') ? 'ui/imports' : 'repo/imports',
    });
  }
}
imports.sort((x, y) => x.file.localeCompare(y.file));

/* ── ② 内核区块的真实能力（从能力清单里取） ─────────────────────── */
const capMap = readJson(path.join(root, 'docs', 'persona-core', 'capability-map.json'), { modules: [] });
const KERNEL_MODULES = (capMap.modules ?? []).filter((m) => m.layer === 'kernel');

/** 区块 → 它对应的内核模块（识图没有自己的模块，算在表达层） */
const BLOCK_MODULES = {
  purpose: ['kernel.purpose'],
  memory: ['kernel.memory'],
  attention: ['kernel.attention'],
  expression: ['kernel.expression', 'kernel.conversation'],
  voice: ['kernel.voice'],
  vision: ['kernel.expression'],
  lexicon: ['kernel.lexicon'],
  sticker: ['kernel.sticker'],
  closure: ['kernel.closure'],
  settings: ['kernel.settings'],
  support: ['kernel.support', 'kernel.store'],
};

const blocks = {};
for (const [blockId, moduleIds] of Object.entries(BLOCK_MODULES)) {
  const caps = [];
  for (const modId of moduleIds) {
    const mod = KERNEL_MODULES.find((m) => m.id === modId);
    if (!mod) continue;
    for (const c of mod.capabilities ?? []) {
      caps.push({ name: String(c.name), status: String(c.status), evidence: String(c.evidence ?? '') });
    }
  }
  blocks[blockId] = { capabilities: caps, modules: moduleIds };
}

/* ── ③ 可调设置（声明来自内核，当前值来自状态文件） ─────────────── */
let settingsDecl = [];
try {
  const mod = await import(pathToFileURL(path.join(root, 'kernel', 'settings', 'limits.js')).href);
  settingsDecl = mod.KERNEL_SETTINGS ?? [];
} catch (error) {
  console.warn(`读不到内核设置声明：${error.message}`);
}
const savedSettings = readJson(path.join(root, 'state', 'persona-core', 'kernel-state.json'), {})?.settings?.['surfcore/kernel'] ?? {};

/* ── ③b 记忆（只读快照；控制动作等 Host 接口，当前只展示事实） ── */
const memoryState = readJson(path.join(root, 'state', 'persona-core', 'kernel-state.json'), {});
const memorySettings = memoryState?.settings?.['surfcore/kernel'] ?? {};
const memoryMode = String(memorySettings['memory.mode'] ?? memoryState?.mode ?? 'narrative') === 'vector' ? 'vector' : 'narrative';
const memorySpace = String(memorySettings['memory.vector.modelSpace'] ?? 'default');
const viewRecord = (r) => ({
  at: Number(r?.from?.at) || 0,
  text: String(r?.text ?? '').slice(0, 400),
  channel: String(r?.from?.channel ?? ''),
  kind: String(r?.from?.kind ?? ''),
  actor: r?.from?.actor ?? null,
  importance: Number(r?.importance) || 0,
  initial: r?.initial === true,
  pinned: r?.pinned === true,
  source: String(r?.source ?? 'user'),
});
const decayRows = (Array.isArray(memoryState?.records) ? memoryState.records : []).slice(-80).map(viewRecord);

let fullRows = [];
try {
  const fullPath = path.join(root, 'state', 'persona-core', 'memory-full.jsonl');
  if (fs.existsSync(fullPath)) {
    const st = fs.statSync(fullPath);
    const start = Math.max(0, st.size - 2 * 1024 * 1024);
    const fd = fs.openSync(fullPath, 'r');
    const buf = Buffer.alloc(Math.min(st.size, 2 * 1024 * 1024));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    fullRows = buf.toString('utf8').split(/\r?\n/).filter(Boolean).map((line) => {
      try { const r = JSON.parse(line); return { at: Number(r.at) || 0, text: String(r.text ?? '').slice(0, 400), channel: String(r.channel ?? ''), importance: Number(r.importance) || 0, source: String(r.source ?? 'user') }; }
      catch { return null; }
    }).filter(Boolean).slice(-80);
  }
} catch { /* 档案读不到就空 */ }

const vectorEntries = Array.isArray(memoryState?.vector) ? memoryState.vector : [];
const vectorSpaces = {};
let vectorIndexed = 0; let vectorPending = 0; let vectorFailed = 0;
for (const entry of vectorEntries) {
  const idx = entry?.vectors?.[memorySpace];
  const status = idx?.status ?? 'pending';
  if (status === 'ready') vectorIndexed += 1;
  else if (status === 'failed') vectorFailed += 1;
  else vectorPending += 1;
  for (const [space, row] of Object.entries(entry?.vectors ?? {})) {
    const s = vectorSpaces[space] ?? { indexed: 0, pending: 0, failed: 0 };
    if (row?.status === 'ready') s.indexed += 1;
    else if (row?.status === 'failed') s.failed += 1;
    else s.pending += 1;
    vectorSpaces[space] = s;
  }
}
const memory = {
  mode: memoryMode,
  config: {
    enabled: memorySettings['memory.vector.enabled'] !== false,
    modelSpace: memorySpace,
    batchSize: Number(memorySettings['memory.vector.batchSize']) || 8,
    maxChars: Number(memorySettings['memory.vector.maxChars']) || 1200,
  },
  stats: { decay: decayRows.length, full: fullRows.length, vector: vectorEntries.length },
  records: decayRows,
  full: fullRows,
  vector: { records: vectorEntries.length, indexed: vectorIndexed, pending: vectorPending, failed: vectorFailed, modelSpace: memorySpace, spaces: vectorSpaces },
  controlAvailable: false,
  builtAt: new Date().toISOString(),
  updatedAt: memoryState?.savedAt ?? null,
};

const settings = settingsDecl.map((f) => ({
  key: String(f.key),
  label: String(f.label),
  description: String(f.description ?? ''),
  cost: String(f.cost ?? ''),
  options: Array.isArray(f.options) ? f.options : [],
  value: savedSettings[f.key] === undefined ? f.defaultValue : savedSettings[f.key],
  isDefault: savedSettings[f.key] === undefined,
  block: String(f.key).startsWith('memory.') ? 'memory' : 'settings',
}));

/* ── 生成 ──────────────────────────────────────────────────────── */
const meta = {
  protocol: adapters.length ? Math.max(...adapters.map((a) => a.protocol)) : 1,
  root,
  builtAt: new Date().toISOString(),
};
const stamp = new Date();
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));
const buildTag = `UI v${pkg.version} · ${stamp.toISOString().slice(0, 16).replace('T', ' ')}`;

/* ── ①c 背景图 ────────────────────────────────────────────────────
 * 默认用 art/girl.webp（101KB）：2.8MB 的 PNG 内联进 client.js 后浏览器没渲染出来，
 * 先回到能显示的这一版。想试原图：SURFCORE_BG=original 再构建。
 */
let BG = '';
try {
  const useOriginal = process.env.SURFCORE_BG === 'original';
  const webp = path.join(here, 'art', 'girl.webp');
  const png = path.join(here, 'art', 'girl.png');
  const file = useOriginal && fs.existsSync(png) ? png : (fs.existsSync(webp) ? webp : png);
  if (fs.existsSync(file)) {
    const mime = file.endsWith('.png') ? 'image/png' : 'image/webp';
    BG = 'data:' + mime + ';base64,' + fs.readFileSync(file).toString('base64');
  } else {
    console.warn('art/ 下没有 girl.webp 或 girl.png，背景留空');
  }
} catch (error) {
  console.warn('背景图读取失败：' + error.message);
}

const templatePath = path.join(here, 'client.template.js');
const template = fs.readFileSync(templatePath, 'utf8');
const sourceLibPath = path.join(here, 'src', 'lib', 'source.js');
if (!fs.existsSync(sourceLibPath)) { console.error(`找不到来源映射：${sourceLibPath}`); process.exit(1); }
const sourceLib = fs.readFileSync(sourceLibPath, 'utf8')
  .replace(/^export\s+/gm, '')
  .trim();
const voiceLibPath = path.join(here, 'src', 'lib', 'voice-control.js');
if (!fs.existsSync(voiceLibPath)) { console.error(`找不到语音控制面 API：${voiceLibPath}`); process.exit(1); }
const voiceLib = fs.readFileSync(voiceLibPath, 'utf8')
  .replace(/^export\s+/gm, '')
  .trim();
for (const ph of ['__ADAPTERS__', '__ADAPTER_META__', '__BUILD__', '__KERNEL_DATA__', '__IMPORTS__', '__BG__', '__MEMORY_DATA__', '__SOURCE_LIB__', '__VOICE_CONTROL_LIB__']) {
  if (!template.includes(ph)) { console.error(`模板缺占位符 ${ph}`); process.exit(1); }
}

const out = template
  .replace('/* __SOURCE_LIB__ */', sourceLib)
  .replace('/* __VOICE_CONTROL_LIB__ */', voiceLib)
  .replace('__ADAPTERS__', JSON.stringify(adapters, null, 2))
  .replace('__ADAPTER_META__', JSON.stringify(meta, null, 2))
  .replace('__KERNEL_DATA__', JSON.stringify({ blocks, settings }, null, 2))
  .replace('__MEMORY_DATA__', JSON.stringify(memory))
  .replace('__IMPORTS__', JSON.stringify(imports, null, 2))
  .replace('__BG__', JSON.stringify(BG))
  .replace('__BUILD__', JSON.stringify(buildTag));

fs.writeFileSync(path.join(here, 'client.js'), out, 'utf8');

console.log('已生成 client.js');
console.log(`  小适配器 ${adapters.length} 个：${adapters.map((a) => `${a.name} v${a.version}`).join(' / ')}`);
console.log(`  内核区块 ${Object.keys(blocks).length} 个，能力 ${Object.values(blocks).reduce((n, b) => n + b.capabilities.length, 0)} 条`);
console.log(`  可调设置 ${settings.length} 项`);
console.log(`  记忆：${memoryMode} · 衰减 ${decayRows.length} / 全量 ${fullRows.length} / 向量 ${vectorEntries.length}（${vectorIndexed} 已索引）`);
console.log(`  背景图 ${BG ? Math.round(BG.length / 1024) + ' KB（内联）' : '无'}`);
console.log(`  待导入 zip ${imports.length} 个${ imports.length ? '：' + imports.map((x) => x.file).join(', ') : '' }`);
console.log(`  构建标识：${buildTag}`);
