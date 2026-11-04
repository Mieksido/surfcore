/**
 * 角色人格（Character Persona）存储层。
 *
 * 一个角色 = `~/.dsh/surfcore/characters/<id>/` 目录包：
 *   character.json          清单（名字、创建/更新时间、路径约定）
 *   persona.md              人格卡
 *   memory/                 衰减记忆卡 + 全量记忆卡 + QQ inbox + 两份注入块
 *   bili/                   B站 行为账本（额度/动态/日记/评分…，按角色独立）
 *   snapshots/              自动存档 / 手动存档 / 切换前存档
 *
 * 为什么不是字面意义的“一个 JSON 文件”：
 *   全量记忆卡默认上限 10GB，且是 append-only JSONL。单文件 JSON 每次保存都要整份重写，
 *   迟早写坏；目录包可以原子写小文件、大文件按行追加。需要单文件时用导出 zip。
 *
 * 唯一真相：
 *   · `characters/current.json` 是**当前角色 + epoch**（切换时原子替换）；
 *   · 所有进程在任务开始时读一次，并只写自己捕获到的那份目录；
 *   · 切换角色 = epoch +1；旧 epoch 的任务不许再向平台发消息（调用方用 `isCurrentEpoch`）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHARACTER_VERSION = 1;
export const HOME = process.env.USERPROFILE || os.homedir();
export const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh');
export const SURFCORE_DIR = path.join(DSH_HOME, 'surfcore');
export const CHARACTERS_DIR = path.join(SURFCORE_DIR, 'characters');
export const CURRENT_FILE = path.join(CHARACTERS_DIR, 'current.json');
export const INDEX_FILE = path.join(CHARACTERS_DIR, 'index.json');
export const LEGACY_MEMORY_DIR = path.join(SURFCORE_DIR, 'memory');
export const LEGACY_BILI_DIR = path.join(SURFCORE_DIR, 'bili');

const BILI_BEHAVIOR_FILES = new Set([
  'scores.json', 'favorites.json', 'quota.json', 'daily-dynamic.json', 'dyn-kinds.json',
  'dynamic-pins.json', 'feedback.json', 'game-rotation.json', 'my-dynamics.json',
  'pending-replies.json', 'attacks.json', 'dm-quota.json', 'dm-await-state.json',
  'silence-seen.json', 'whale-diary.md', 'whale-diary-private.md', 'whale-log.jsonl',
  'whale-night.json', 'whale-night.config.json', 'whale-listen.json', 'fish-guard.json',
  'replied.json', 'commented-videos.md', 'liked-videos.json', 'await-state.json',
  'selftest-passed.json',
  // 角色行为/身份/分享排期（快照与迁移都要带上，否则回档会丢“今天发过什么”）
  'bili-share-state.json', 'bili-share-history.json',
  'bili-dynamics-state.json', 'bili-dynamics-cache.json',
  'bili-memory.json', 'bili-memory.md', 'bili-memory-brief.md', 'bili-video-titles.json',
  // 观看历史（设置页展示；迁移/回档要带上，否则换角色后历史看起来“消失”）
  'watch-history.jsonl', 'watch-history.1.jsonl',
]);
const MEMORY_FILES = [
  'memory-card.json', 'memory-card.md', 'memory-card-prompt-qq.md', 'memory-card-prompt-bili.md',
  'memory-inbox.jsonl', 'memory-card-full-stats.json', 'memory-card-full.md',
  'qq-for-bili.md', 'bili-for-qq.md', 'sync-state.json',
];
const MEMORY_APPEND_FILES = ['memory-card-full.jsonl'];

let currentCache = { key: '', value: null };

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file, fallback = null) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function atomicWriteJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (error) {
    try { fs.unlinkSync(tmp); } catch {}
    throw error;
  }
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

/** 复制核心/日常/场景三层人格文件（不存在的层跳过）。 */
function copyPersonaLayers(paths, fixtureRoot) {
  copyFile(paths.persona, path.join(fixtureRoot, 'persona.md'));
  copyFile(paths.personaDaily, path.join(fixtureRoot, 'persona.daily.md'));
  copyFile(paths.personaTone, path.join(fixtureRoot, 'persona.tone.md'));
  for (const [scene, file] of Object.entries(paths.personaScenes || {})) {
    copyFile(file, path.join(fixtureRoot, 'persona.scenes', `${scene}.md`));
  }
}

/** 大文件优先硬链接：同一卷上不复制 10GB；失败再复制。 */
function linkOrCopy(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  try { fs.linkSync(src, dest); return true; } catch {}
  try { fs.copyFileSync(src, dest); return true; } catch { return false; }
}

function removeDirSafe(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

/** 只允许 ASCII 字母数字/下划线/短横线；中文名生成 `char-<时间>`。 */
export function sanitizeCharacterId(name) {
  const raw = String(name ?? '').trim().toLowerCase();
  const ascii = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (ascii) return ascii;
  return `char-${Date.now().toString(36)}`;
}

export function isValidCharacterId(id) {
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(String(id ?? ''));
}

export function characterDir(id) {
  if (!isValidCharacterId(id)) throw new Error(`非法角色 id：${id}`);
  return path.join(CHARACTERS_DIR, id);
}

export function characterPaths(id) {
  const dir = characterDir(id);
  const memoryDir = path.join(dir, 'memory');
  return {
    id,
    dir,
    manifest: path.join(dir, 'character.json'),
    persona: path.join(dir, 'persona.md'),
    personaDaily: path.join(dir, 'persona.daily.md'),
    personaTone: path.join(dir, 'persona.tone.md'),
    personaScenesDir: path.join(dir, 'persona.scenes'),
    personaScenes: {
      'qq-group': path.join(dir, 'persona.scenes', 'qq-group.md'),
      'qq-private': path.join(dir, 'persona.scenes', 'qq-private.md'),
      bili: path.join(dir, 'persona.scenes', 'bili.md'),
      pet: path.join(dir, 'persona.scenes', 'pet.md'),
    },
    memoryDir,
    memoryJson: path.join(memoryDir, 'memory-card.json'),
    memoryMd: path.join(memoryDir, 'memory-card.md'),
    memoryPromptQq: path.join(memoryDir, 'memory-card-prompt-qq.md'),
    memoryPromptBili: path.join(memoryDir, 'memory-card-prompt-bili.md'),
    memoryInbox: path.join(memoryDir, 'memory-inbox.jsonl'),
    memoryFullJsonl: path.join(memoryDir, 'memory-card-full.jsonl'),
    memoryFullStats: path.join(memoryDir, 'memory-card-full-stats.json'),
    memoryFullMd: path.join(memoryDir, 'memory-card-full.md'),
    biliDir: path.join(dir, 'bili'),
    snapshotsDir: path.join(dir, 'snapshots'),
  };
}

/** 旧布局（没有角色系统时）的记忆路径，供调用方回退。 */
export function legacyMemoryPaths() {
  return {
    dir: LEGACY_MEMORY_DIR,
    json: path.join(LEGACY_MEMORY_DIR, 'memory-card.json'),
    markdown: path.join(LEGACY_MEMORY_DIR, 'memory-card.md'),
    promptQq: path.join(LEGACY_MEMORY_DIR, 'memory-card-prompt-qq.md'),
    promptBili: path.join(LEGACY_MEMORY_DIR, 'memory-card-prompt-bili.md'),
    inbox: path.join(LEGACY_MEMORY_DIR, 'memory-inbox.jsonl'),
    fullJsonl: path.join(LEGACY_MEMORY_DIR, 'memory-card-full.jsonl'),
    fullStats: path.join(LEGACY_MEMORY_DIR, 'memory-card-full-stats.json'),
    fullJson: path.join(LEGACY_MEMORY_DIR, 'memory-card-full.json'),
    fullMarkdown: path.join(LEGACY_MEMORY_DIR, 'memory-card-full.md'),
    qqForBili: path.join(LEGACY_MEMORY_DIR, 'qq-for-bili.md'),
    biliForQq: path.join(LEGACY_MEMORY_DIR, 'bili-for-qq.md'),
  };
}

/** 当前角色记忆路径（没有角色系统时回退旧布局）。 */
export function activeMemoryPaths() {
  const cur = readCurrentCharacter();
  if (!cur) return legacyMemoryPaths();
  const p = characterPaths(cur.id);
  return {
    dir: p.memoryDir,
    json: p.memoryJson,
    markdown: p.memoryMd,
    promptQq: p.memoryPromptQq,
    promptBili: p.memoryPromptBili,
    inbox: p.memoryInbox,
    fullJsonl: p.memoryFullJsonl,
    fullStats: p.memoryFullStats,
    fullJson: path.join(p.memoryDir, 'memory-card-full.json'),
    fullMarkdown: p.memoryFullMd,
    qqForBili: path.join(p.memoryDir, 'qq-for-bili.md'),
    biliForQq: path.join(p.memoryDir, 'bili-for-qq.md'),
  };
}

export function activeBiliDir() {
  const cur = readCurrentCharacter();
  return cur ? characterPaths(cur.id).biliDir : LEGACY_BILI_DIR;
}

/** 平台运行状态目录：有角色时用角色自己的 bili/，没有角色时回退调用方给的旧目录。 */
export function activePlatformStateDir(legacyDir) {
  const cur = readCurrentCharacter();
  return cur ? characterPaths(cur.id).biliDir : String(legacyDir || LEGACY_BILI_DIR);
}

export function activePersonaFile() {
  const cur = readCurrentCharacter();
  return cur ? characterPaths(cur.id).persona : '';
}

/** 读当前角色的一层人格文本；文件不存在返回空串。 */
export function readPersonaLayerText(kind = 'core', scene = '') {
  const layers = activePersonaLayers();
  if (!layers) return '';
  const file = kind === 'daily'
    ? layers.daily
    : kind === 'scene'
      ? (layers.scenes?.[scene] || '')
      : kind === 'tone'
        ? layers.tone
        : kind === 'core'
          ? layers.core
          : (() => {
            try {
              console.warn(`[persona] 未知人格层 "${kind}"，回退核心；请检查调用方`);
            } catch {}
            return layers.core;
          })();
  try { return file ? fs.readFileSync(file, 'utf8') : ''; } catch { return ''; }
}

/** 当前角色的人格分层路径；没有角色系统时只返回核心（旧布局由调用方回退）。 */
export function activePersonaLayers() {
  const cur = readCurrentCharacter();
  if (!cur) return null;
  const p = characterPaths(cur.id);
  return {
    id: cur.id,
    core: p.persona,
    daily: p.personaDaily,
    tone: p.personaTone,
    scenesDir: p.personaScenesDir,
    scenes: p.personaScenes,
  };
}

export function readCurrentCharacter() {
  let key = 'missing';
  try {
    const stat = fs.statSync(CURRENT_FILE);
    key = `${stat.mtimeMs}:${stat.size}`;
  } catch {
    currentCache = { key, value: null };
    return null;
  }
  if (currentCache.key === key) return currentCache.value;
  const raw = readJson(CURRENT_FILE, null);
  if (!raw || !isValidCharacterId(raw.id) || !fs.existsSync(characterDir(raw.id))) {
    currentCache = { key, value: null };
    return null;
  }
  const value = {
    version: Number(raw.version) || 1,
    id: raw.id,
    name: String(raw.name ?? raw.id),
    epoch: Number(raw.epoch) || 1,
    dir: characterDir(raw.id),
    switchedAt: String(raw.switchedAt ?? ''),
  };
  currentCache = { key, value };
  return value;
}

export function isCurrentEpoch(epoch) {
  const cur = readCurrentCharacter();
  return Boolean(cur) && Number(epoch) === cur.epoch;
}

/** 让当前角色 epoch +1（回档/导入后让旧任务失效）。 */
export function bumpEpoch(id) {
  const cur = readCurrentCharacter();
  if (!cur || cur.id !== id) return cur;
  const nextEpoch = (Number(cur.epoch) || 0) + 1;
  const manifest = readManifest(id);
  const next = {
    version: CHARACTER_VERSION,
    id,
    name: manifest?.name || cur.name,
    epoch: nextEpoch,
    dir: characterPaths(id).dir,
    switchedAt: new Date().toISOString(),
  };
  atomicWriteJson(CURRENT_FILE, next);
  currentCache = { key: 'missing', value: null };
  return readCurrentCharacter();
}

export function readIndex() {
  const raw = readJson(INDEX_FILE, null);
  if (raw && Array.isArray(raw.characters)) return raw;
  // 目录还在、索引丢了：按目录重建（不写盘，调用方保存时再落）。
  const characters = [];
  try {
    for (const name of fs.readdirSync(CHARACTERS_DIR)) {
      if (!isValidCharacterId(name)) continue;
      if (!fs.existsSync(path.join(CHARACTERS_DIR, name, 'character.json'))) continue;
      const manifest = readJson(path.join(CHARACTERS_DIR, name, 'character.json'), null);
      if (manifest) characters.push(manifest);
    }
  } catch {}
  return { version: CHARACTER_VERSION, currentId: readCurrentCharacter()?.id ?? '', epoch: readCurrentCharacter()?.epoch ?? 0, characters };
}

function writeIndex(next) {
  atomicWriteJson(INDEX_FILE, next);
}

function upsertIndex(manifest, patch = {}) {
  const index = readIndex();
  const list = index.characters.filter((item) => item.id !== manifest.id);
  list.push({ ...manifest, ...patch });
  list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN'));
  const next = { version: CHARACTER_VERSION, currentId: index.currentId, epoch: index.epoch, characters: list };
  writeIndex(next);
  return next;
}

export function listCharacters() {
  const index = readIndex();
  const current = readCurrentCharacter();
  return index.characters.map((item) => {
    const paths = characterPaths(item.id);
    let bytes = 0;
    try { bytes = fs.statSync(paths.memoryFullJsonl).size; } catch {}
    return {
      id: item.id,
      name: String(item.name ?? item.id),
      createdAt: item.createdAt ?? '',
      updatedAt: item.updatedAt ?? '',
      lastLoadedAt: item.lastLoadedAt ?? '',
      current: Boolean(current && current.id === item.id),
      fullMemoryBytes: bytes,
      dir: paths.dir,
      personaChars: (() => { try { return fs.readFileSync(paths.persona, 'utf8').length; } catch { return 0; } })(),
      snapshots: countSnapshots(item.id),
    };
  });
}

export function readManifest(id) {
  return readJson(characterPaths(id).manifest, null);
}

/** 当前/指定角色的展示用 persona 元数据；老角色清单没写时从人格卡标题补。 */
export function characterPersonaMeta(id) {
  const manifest = readManifest(id);
  if (!manifest) return null;
  const meta = manifest.personaMeta && typeof manifest.personaMeta === 'object' ? manifest.personaMeta : {};
  let name = String(meta.name ?? '').trim();
  if (!name) {
    try { name = personaNameFromText(fs.readFileSync(characterPaths(id).persona, 'utf8'), manifest.name); } catch {}
  }
  return { name: name || manifest.name, ownerTitle: meta.ownerTitle, selfClaim: meta.selfClaim };
}

function countSnapshots(id) {
  try {
    return fs.readdirSync(characterPaths(id).snapshotsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).length;
  } catch {
    return 0;
  }
}

function defaultPersona(name) {
  return `# 角色卡：${name}\n\n（在这里写这个人格卡：你是谁、说话方式、对谁温柔、边界。）\n`;
}

/** 从人格卡标题里取角色名（`# 角色卡：小咪` / `# 小咪`）；取不到就用角色名。 */
export function personaNameFromText(text, fallback = '') {
  const heading = /^#\s*(?:角色卡[：:]\s*)?(.+)$/m.exec(String(text ?? ''))?.[1]?.trim();
  return (heading || fallback || '').replace(/[#*`]/g, '').trim().slice(0, 40);
}

function uniqueId(base, exclude = '') {
  let id = base;
  let n = 2;
  while (fs.existsSync(characterDir(id)) && id !== exclude) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

/** 新建角色：只负责落盘，不切换、不碰平台。 */
export function createCharacter({ name, personaText, memoryCard, fullRecords, id: wantedId, source = 'manual', now = Date.now() } = {}) {
  const cleanName = String(name ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40);
  if (!cleanName) throw new Error('角色名不能为空');
  const baseId = sanitizeCharacterId(wantedId || cleanName);
  const id = uniqueId(baseId);
  const paths = characterPaths(id);
  ensureDir(paths.dir);
  ensureDir(paths.memoryDir);
  ensureDir(paths.biliDir);
  ensureDir(paths.snapshotsDir);
  const persona = String(personaText ?? '').trim() || defaultPersona(cleanName);
  fs.writeFileSync(paths.persona, `${persona}\n`, { encoding: 'utf8', mode: 0o600 });
  if (memoryCard && typeof memoryCard === 'object') {
    atomicWriteJson(paths.memoryJson, memoryCard);
  }
  if (Array.isArray(fullRecords) && fullRecords.length) {
    fs.writeFileSync(paths.memoryFullJsonl, `${fullRecords.map((record) => JSON.stringify(record)).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  const manifest = {
    version: CHARACTER_VERSION,
    id,
    name: cleanName,
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    source,
    persona: 'persona.md',
    memory: 'memory',
    bili: 'bili',
    // B站 提示词/记忆里用的角色名；不再从全局 bili.config.persona.name 读（换角色会串）。
    personaMeta: { name: personaNameFromText(persona, cleanName) },
  };
  atomicWriteJson(paths.manifest, manifest);
  upsertIndex(manifest);
  return { ok: true, character: manifest, paths };
}

export function updateCharacter(id, { name, personaText, memoryCard, now = Date.now() } = {}) {
  const paths = characterPaths(id);
  const manifest = readManifest(id);
  if (!manifest) throw new Error(`角色不存在：${id}`);
  if (typeof personaText === 'string') {
    fs.writeFileSync(paths.persona, `${personaText.trim()}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  if (memoryCard && typeof memoryCard === 'object') atomicWriteJson(paths.memoryJson, memoryCard);
  const next = {
    ...manifest,
    name: name ? String(name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 40) || manifest.name : manifest.name,
    personaMeta: typeof personaText === 'string'
      ? { ...(manifest.personaMeta ?? {}), name: personaNameFromText(personaText, manifest.personaMeta?.name || manifest.name) }
      : manifest.personaMeta,
    updatedAt: new Date(now).toISOString(),
  };
  atomicWriteJson(paths.manifest, next);
  upsertIndex(next);
  return next;
}

export function touchCharacter(id, now = Date.now()) {
  const manifest = readManifest(id);
  if (!manifest) return null;
  const next = { ...manifest, updatedAt: new Date(now).toISOString() };
  atomicWriteJson(characterPaths(id).manifest, next);
  upsertIndex(next);
  return next;
}

/** 写当前角色指针 + epoch。调用方负责先停平台进程/存旧档。 */
export function switchCharacter(id, { now = Date.now() } = {}) {
  const paths = characterPaths(id);
  const manifest = readManifest(id);
  if (!manifest) throw new Error(`角色不存在：${id}`);
  const index = readIndex();
  const current = readCurrentCharacter();
  if (current && current.id === id) {
    return { ok: true, already: true, current };
  }
  const epoch = Math.max(Number(index.epoch) || 0, Number(current?.epoch) || 0) + 1;
  const next = {
    version: CHARACTER_VERSION,
    id,
    name: manifest.name,
    epoch,
    dir: paths.dir,
    switchedAt: new Date(now).toISOString(),
  };
  atomicWriteJson(CURRENT_FILE, next);
  currentCache = { key: 'missing', value: null };
  const nextManifest = { ...manifest, lastLoadedAt: next.switchedAt };
  atomicWriteJson(paths.manifest, nextManifest);
  writeIndex({
    version: CHARACTER_VERSION,
    currentId: id,
    epoch,
    characters: index.characters
      .filter((item) => item.id !== id)
      .concat([nextManifest])
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-CN')),
  });
  return { ok: true, current: readCurrentCharacter() };
}

function snapshotManifest(id, name, reason, now) {
  return {
    version: CHARACTER_VERSION,
    characterId: id,
    slot: name,
    reason,
    createdAt: new Date(now).toISOString(),
  };
}

/**
 * 给角色拍一份快照。
 * slot 相同会整体替换（用于自动存档的固定槽）；手动存档用 `manual-<时间>`。
 */
export function snapshotCharacter(id, { slot, reason = 'manual', now = Date.now() } = {}) {
  const paths = characterPaths(id);
  const manifest = readManifest(id);
  if (!manifest) throw new Error(`角色不存在：${id}`);
  const name = String(slot || `manual-${new Date(now).toISOString().replace(/[:.]/g, '-')}`).replace(/[^\w\u4e00-\u9fa5.-]/g, '_').slice(0, 80);
  ensureDir(paths.snapshotsDir);
  const dest = path.join(paths.snapshotsDir, name);
  const tmp = `${dest}.tmp-${process.pid}-${now}`;
  removeDirSafe(tmp);
  ensureDir(tmp);
  atomicWriteJson(path.join(tmp, 'snapshot.json'), snapshotManifest(id, name, reason, now));
  copyPersonaLayers(paths, tmp);
  copyFile(paths.manifest, path.join(tmp, 'character.json'));
  ensureDir(path.join(tmp, 'memory'));
  for (const file of MEMORY_FILES) copyFile(path.join(paths.memoryDir, file), path.join(tmp, 'memory', file));
  let fullMode = 'missing';
  if (fs.existsSync(paths.memoryFullJsonl)) {
    fullMode = linkOrCopy(paths.memoryFullJsonl, path.join(tmp, 'memory', 'memory-card-full.jsonl')) ? 'link-or-copy' : 'failed';
  }
  ensureDir(path.join(tmp, 'bili'));
  try {
    for (const entry of fs.readdirSync(paths.biliDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!BILI_BEHAVIOR_FILES.has(entry.name)) continue;
      copyFile(path.join(paths.biliDir, entry.name), path.join(tmp, 'bili', entry.name));
    }
  } catch {}
  const meta = readJson(path.join(tmp, 'snapshot.json'), {});
  atomicWriteJson(path.join(tmp, 'snapshot.json'), { ...meta, fullMemoryMode: fullMode });
  // Windows 不能 rename 覆盖非空目录：先把旧槽挪走再换入。
  if (fs.existsSync(dest)) {
    const trash = `${dest}.old-${process.pid}-${now}`;
    try { fs.renameSync(dest, trash); } catch { removeDirSafe(dest); }
    try { fs.renameSync(tmp, dest); } catch { removeDirSafe(tmp); throw new Error('快照写入失败'); }
    removeDirSafe(trash);
  } else {
    fs.renameSync(tmp, dest);
  }
  return { ok: true, slot: name, dir: dest, createdAt: new Date(now).toISOString() };
}

export function listSnapshots(id) {
  const paths = characterPaths(id);
  const list = [];
  try {
    for (const entry of fs.readdirSync(paths.snapshotsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const dir = path.join(paths.snapshotsDir, entry.name);
      const meta = readJson(path.join(dir, 'snapshot.json'), {});
      let bytes = 0;
      try { bytes = fs.statSync(path.join(dir, 'memory', 'memory-card.json')).size; } catch {}
      list.push({
        slot: entry.name,
        reason: meta.reason ?? '',
        createdAt: meta.createdAt ?? '',
        fullMemoryMode: meta.fullMemoryMode ?? '',
        memoryBytes: bytes,
        manual: String(meta.reason ?? '').startsWith('manual'),
      });
    }
  } catch {}
  return list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** 删一份快照（只允许 snapshots/ 下的目录；自动存档轮换用）。 */
export function removeSnapshot(id, slot) {
  const paths = characterPaths(id);
  const target = path.join(paths.snapshotsDir, String(slot ?? ''));
  if (!slot || !target.startsWith(paths.snapshotsDir + path.sep)) return false;
  if (!fs.existsSync(target)) return false;
  removeDirSafe(target);
  return true;
}

/** 删除角色（不可逆操作 → 只移不删）：整个目录移进 backups/deleted-character-*，并从索引移除。 */
export function archiveCharacter(id, { now = Date.now() } = {}) {
  const cur = readCurrentCharacter();
  if (cur && cur.id === id) throw new Error('不能删除当前角色；先加载别的角色');
  const paths = characterPaths(id);
  const dest = path.join(SURFCORE_DIR, 'backups', `deleted-character-${new Date(now).toISOString().replace(/[:.]/g, '-')}-${id}`);
  let archived = '';
  try {
    if (fs.existsSync(paths.dir)) {
      ensureDir(path.dirname(dest));
      fs.renameSync(paths.dir, dest);
      archived = dest;
    }
  } catch (error) {
    throw new Error(`归档角色失败：${error?.message ?? error}`);
  }
  const index = readIndex();
  writeIndex({ ...index, characters: index.characters.filter((item) => item.id !== id) });
  return { ok: true, archived };
}

/** 回档：先给当前状态拍一份 `pre-restore-*`，再覆盖人格卡 + 衰减记忆 + B站 行为账本。
 *  全量记忆卡是 append-only，不截断（避免回档把后来真实发生过的记忆删掉）。 */
export function restoreSnapshot(id, slot, { now = Date.now() } = {}) {
  const paths = characterPaths(id);
  const source = path.join(paths.snapshotsDir, String(slot ?? ''));
  if (!slot || !source.startsWith(paths.snapshotsDir) || !fs.existsSync(path.join(source, 'snapshot.json'))) {
    throw new Error('快照不存在');
  }
  const before = snapshotCharacter(id, { slot: `pre-restore-${new Date(now).toISOString().replace(/[:.]/g, '-')}`, reason: 'before-restore', now });
  copyFile(path.join(source, 'persona.md'), paths.persona);
  copyFile(path.join(source, 'persona.daily.md'), paths.personaDaily);
  copyFile(path.join(source, 'persona.tone.md'), paths.personaTone);
  try {
    for (const entry of fs.readdirSync(path.join(source, 'persona.scenes'), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      copyFile(path.join(source, 'persona.scenes', entry.name), path.join(paths.personaScenesDir, entry.name));
    }
  } catch {}
  // 只回档衰减卡与其注入块；全量记忆是 append-only，连 stats 都不回退（避免把后来的记忆统计抹掉）。
  for (const file of ['memory-card.json', 'memory-card.md', 'memory-card-prompt-qq.md', 'memory-card-prompt-bili.md', 'memory-inbox.jsonl']) {
    copyFile(path.join(source, 'memory', file), path.join(paths.memoryDir, file));
  }
  try {
    for (const entry of fs.readdirSync(path.join(source, 'bili'), { withFileTypes: true })) {
      if (entry.isFile()) copyFile(path.join(source, 'bili', entry.name), path.join(paths.biliDir, entry.name));
    }
  } catch {}
  const manifest = readManifest(id);
  if (manifest) {
    const next = { ...manifest, updatedAt: new Date(now).toISOString() };
    atomicWriteJson(paths.manifest, next);
    upsertIndex(next);
  }
  return { ok: true, restored: slot, backupSlot: before.slot };
}

export function snapshotSize(id, slot) {  let bytes = 0;
  try {
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else bytes += fs.statSync(full).size;
      }
    };
    walk(path.join(characterPaths(id).snapshotsDir, slot));
  } catch {}
  return bytes;
}

/**
 * 从旧布局迁移出第一个角色。**不删除旧数据**（旧目录继续作为冷备份）。
 * 大文件（全量记忆 JSONL）优先硬链接，避免复制 10GB。
 */
export function migrateLegacy({ personaFile, memoryDir = LEGACY_MEMORY_DIR, biliDir = LEGACY_BILI_DIR, stateDir = '', name, now = Date.now() } = {}) {
  ensureDir(CHARACTERS_DIR);
  const existing = readCurrentCharacter();
  if (existing) return { ok: true, skipped: true, current: existing };
  let personaText = '';
  try { personaText = fs.readFileSync(personaFile, 'utf8'); } catch {}
  const heading = /^#\s*(?:角色卡[：:]\s*)?(.+)$/m.exec(personaText)?.[1]?.trim();
  const cleanName = String(name || heading || '默认角色').replace(/[#*`]/g, '').trim().slice(0, 40) || '默认角色';
  const created = createCharacter({ name: cleanName, personaText, source: 'migration', now });
  const paths = created.paths;
  const backupDir = path.join(SURFCORE_DIR, 'backups', `character-migration-${new Date(now).toISOString().replace(/[:.]/g, '-')}`);
  ensureDir(backupDir);
  const backup = { at: new Date(now).toISOString(), from: { personaFile, memoryDir, biliDir }, to: paths.dir, files: [] };
  const copySmall = (src, dest) => {
    try {
      const stat = fs.statSync(src);
      if (stat.size > 8 * 1024 * 1024) return;
      ensureDir(path.dirname(dest));
      fs.copyFileSync(src, dest);
      backup.files.push({ src, bytes: stat.size });
    } catch {}
  };
  // 记忆：小文件复制，全量 JSONL 硬链接/复制。
  for (const file of MEMORY_FILES) {
    const src = path.join(memoryDir, file);
    if (!fs.existsSync(src)) continue;
    copyFile(src, path.join(paths.memoryDir, file));
    copySmall(src, path.join(backupDir, 'memory', file));
  }
  for (const file of MEMORY_APPEND_FILES) {
    linkOrCopy(path.join(memoryDir, file), path.join(paths.memoryDir, file));
  }
  // B站 行为账本：只迁行为文件；凭证/表情包/二进制工具留在全局。
  try {
    for (const entry of fs.readdirSync(biliDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!BILI_BEHAVIOR_FILES.has(entry.name)) continue;
      const src = path.join(biliDir, entry.name);
      copyFile(src, path.join(paths.biliDir, entry.name));
      copySmall(src, path.join(backupDir, 'bili', entry.name));
    }
  } catch {}
  // repo/state 里的分享排期/素材使用记录也要进角色包：否则迁移后当天可能重发已发过的分享。
  if (stateDir) {
    for (const file of ['bili-share-state.json', 'bili-share-history.json']) {
      const src = path.join(stateDir, file);
      if (!fs.existsSync(src)) continue;
      copyFile(src, path.join(paths.biliDir, file));
      copySmall(src, path.join(backupDir, 'bili', file));
    }
  }
  atomicWriteJson(path.join(backupDir, 'manifest.json'), backup);
  // 写当前指针（epoch 1）。
  switchCharacter(created.character.id, { now });
  return { ok: true, migrated: true, character: created.character, current: readCurrentCharacter(), backupDir, paths };
}
