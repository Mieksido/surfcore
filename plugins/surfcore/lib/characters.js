/**
 * 角色人格：设置页/宿主用的业务层（纯函数 + 文件操作；不直接启停平台进程）。
 *
 * 12 个自动存档槽：
 *   · before-switch（每次切换角色前，覆盖旧角色）
 *   · 180 / 90 / 60 / 30 / 15 / 10 / 7 / 5 / 3 / 2 / 1 天各一份（按快照时间就近保留）
 *   快照是完整目录包；全量记忆 JSONL 用硬链接，不复制 10GB。
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  CHARACTERS_DIR, bumpEpoch, characterPaths, createCharacter, listCharacters, listSnapshots,
  migrateLegacy, readCurrentCharacter, readManifest, removeSnapshot, restoreSnapshot,
  snapshotCharacter, switchCharacter, updateCharacter, archiveCharacter,
} from '../../../src/character-persona.js';
import { scanText } from './privacy.js';
import { callBridge } from './bridge.js';
import { readQqConfig } from './store.js';

export const AUTO_AGE_DAYS = [180, 90, 60, 30, 15, 10, 7, 5, 3, 2, 1];
export const BEFORE_SWITCH_SLOT = 'before-switch';
const DAY_MS = 24 * 60 * 60 * 1000;

function daySlot(now = Date.now()) {
  const d = new Date(now);
  return `auto-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ageOf(snapshot, now) {
  const at = Date.parse(snapshot.createdAt);
  if (!Number.isFinite(at)) return Infinity;
  return Math.max(0, (now - at) / DAY_MS);
}

/** 自动存档：每天一份 + 按 11 个年龄档轮换保留（加 before-switch 共 12 个自动槽）。 */
export function autoSnapshot(id, { now = Date.now(), force = false } = {}) {
  const existing = listSnapshots(id);
  const slot = daySlot(now);
  if (force || !existing.some((item) => item.slot === slot)) {
    snapshotCharacter(id, { slot, reason: 'auto-daily', now });
  }
  const auto = listSnapshots(id).filter((item) => item.slot.startsWith('auto-'));
  if (auto.length <= AUTO_AGE_DAYS.length) return { created: slot, pruned: [] };
  const keep = new Set();
  for (const days of AUTO_AGE_DAYS) {
    let best = null;
    for (const item of auto) {
      const diff = Math.abs(ageOf(item, now) - days);
      if (!best || diff < best.diff) best = { item, diff };
    }
    if (best) keep.add(best.item.slot);
  }
  // 最新一份永远保留（否则刚拍完就被删）。
  if (auto[0]) keep.add(auto[0].slot);
  const pruned = [];
  for (const item of auto) {
    if (keep.has(item.slot)) continue;
    if (removeSnapshot(id, item.slot)) pruned.push(item.slot);
  }
  return { created: slot, pruned };
}

/** 手动存档：保留最近 20 份。 */
export function manualSnapshot(id, { label = '', now = Date.now() } = {}) {
  const safeLabel = String(label ?? '').replace(/[^A-Za-z0-9_.\-\u4e00-\u9fa5]/g, '_').slice(0, 24);
  const slot = `manual-${safeLabel ? `${safeLabel}-` : ''}${new Date(now).toISOString().replace(/[:.]/g, '-')}`;
  const result = snapshotCharacter(id, { slot, reason: 'manual', now });
  const manual = listSnapshots(id).filter((item) => item.slot.startsWith('manual-'));
  for (const item of manual.slice(20)) removeSnapshot(id, item.slot);
  return result;
}

/** 切换前给旧角色拍的存档（固定槽，覆盖上一份）。 */
export function beforeSwitchSnapshot(id, { now = Date.now() } = {}) {
  if (!id) return null;
  return snapshotCharacter(id, { slot: BEFORE_SWITCH_SLOT, reason: 'before-switch', now });
}

export function characterOverview() {
  const current = readCurrentCharacter();
  return {
    ok: true,
    current: current
      ? { id: current.id, name: current.name, epoch: current.epoch, switchedAt: current.switchedAt, dir: current.dir }
      : null,
    characters: listCharacters(),
    snapshots: current ? listSnapshots(current.id) : [],
    autoAgeDays: AUTO_AGE_DAYS,
  };
}

export function characterDetail(id) {
  const manifest = readManifest(id);
  if (!manifest) throw new Error(`角色不存在：${id}`);
  const paths = characterPaths(id);
  let persona = '';
  try { persona = fs.readFileSync(paths.persona, 'utf8'); } catch {}
  return {
    ok: true,
    character: manifest,
    persona,
    snapshots: listSnapshots(id),
    paths: {
      dir: paths.dir,
      persona: paths.persona,
      memoryDir: paths.memoryDir,
      biliDir: paths.biliDir,
      snapshotsDir: paths.snapshotsDir,
    },
    current: readCurrentCharacter()?.id === id,
  };
}

/** 新建角色：接受字符串或对象；记忆卡至少要有 records 数组。 */
export function createCharacterFromPayload(body = {}) {
  const name = String(body.name ?? '').trim();
  if (!name) throw new Error('角色名不能为空');
  const personaText = String(body.personaText ?? '');
  if (personaText.length > 64 * 1024) throw new Error('人格卡超过 64KB');
  if (personaText.trim()) {
    const scan = scanText(personaText);
    const severe = scan.secrets.length > 0 || scan.pii.some((hit) => hit.severe);
    if (severe) throw new Error('人格卡命中密钥/密码/身份证/住址规则，拒绝保存');
  }
  let memoryCard = body.memoryCard ?? null;
  if (typeof memoryCard === 'string' && memoryCard.trim()) {
    try { memoryCard = JSON.parse(memoryCard); } catch { throw new Error('记忆卡不是合法 JSON'); }
  }
  if (memoryCard && (!Array.isArray(memoryCard.records))) {
    throw new Error('记忆卡缺少 records 数组');
  }
  let fullRecords = body.fullRecords ?? null;
  if (typeof fullRecords === 'string' && fullRecords.trim()) {
    const lines = fullRecords.split('\n').map((line) => line.trim()).filter(Boolean);
    try { fullRecords = lines.map((line) => JSON.parse(line)); } catch { throw new Error('全量记忆必须是每行一个 JSON'); }
  }
  const created = createCharacter({
    name,
    personaText,
    memoryCard,
    fullRecords,
    source: 'manual',
  });
  return { ok: true, ...created };
}

export function updateCharacterFromPayload(id, body = {}) {
  const personaText = body.personaText == null ? undefined : String(body.personaText);
  if (typeof personaText === 'string') {
    if (personaText.length > 64 * 1024) throw new Error('人格卡超过 64KB');
    const scan = scanText(personaText);
    const severe = scan.secrets.length > 0 || scan.pii.some((hit) => hit.severe);
    if (severe) throw new Error('人格卡命中密钥/密码/身份证/住址规则，拒绝保存');
  }
  const updated = updateCharacter(id, {
    name: body.name,
    personaText,
  });
  return { ok: true, character: updated };
}

export function switchToCharacter(id, { now = Date.now() } = {}) {
  return switchCharacter(id, { now });
}

export function markEpoch(id) {
  return bumpEpoch(id);
}

export function restoreCharacterSnapshot(id, slot) {
  const result = restoreSnapshot(id, slot);
  bumpEpoch(id);
  return result;
}

export function deleteCharacter(id) {
  return archiveCharacter(id);
}

/** 测试当前人设：以机器人身份私聊管理员一句话，确认人格卡是否真的生效。 */
export async function testCurrentCharacter() {
  const current = readCurrentCharacter();
  if (!current) throw new Error('还没有当前角色');
  const qq = readQqConfig().config;
  const owner = String(qq.ownerQQ ?? '').trim();
  if (!/^\d{4,15}$/.test(owner)) throw new Error('未配置管理员 QQ（设置 → 管理员），无法测试');
  const result = await callBridge('/api/test-send', {
    method: 'POST',
    body: {
      kind: 'private',
      id: Number(owner),
      message: '【人设测试】你现在是谁？用你的性格口吻回一句介绍自己。',
    },
    timeoutMs: 8000,
  });
  if (!result.ok) throw new Error(result.data?.error || result.error || '发送失败');
  return { ok: true, sentTo: owner };
}

/** 旧数据迁移；没有旧数据时返回 skipped，不创建空角色。 */
export function migrateIfNeeded({ personaFile, memoryDir, biliDir, stateDir, name } = {}) {
  if (readCurrentCharacter()) return { ok: true, skipped: true };
  const hasLegacy = (() => {
    try { return fs.existsSync(memoryDir) || fs.existsSync(biliDir); } catch { return false; }
  })();
  if (!hasLegacy) return { ok: true, skipped: true, reason: 'no-legacy-data' };
  return migrateLegacy({ personaFile, memoryDir, biliDir, stateDir, name });
}

export { CHARACTERS_DIR };
