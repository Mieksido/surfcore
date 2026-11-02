/**
 * p-memory 长期记忆后端（插件宿主侧）—— 可选件，默认关闭。
 *
 * 为什么加这一层：记忆卡（memory-card.json）是「规则打分 + 确定性截断」的文件卡，够轻、够稳，
 * 但它刻意不做两件事——不调模型提炼，也不建索引。p-memory 正好反过来：它把写入/索引/检索/
 * 衰减放进一个 Rust 扩展里（中文检索开箱可用），代价是需要一个本地 sidecar 进程。
 *
 * 分工（沿用记忆卡那套「文件是唯一契约」的约定）：
 *   · 本模块（DSH 宿主进程）在每次记忆维护之后，把卡里新增/变化的记录推给 sidecar，再把
 *     sidecar 渲染的概览写成 `pmemory-prompt-qq.md`。
 *   · QQ 桥接（独立进程）只读那个 md —— 和读 `memory-card-prompt-qq.md` 是同一种方式，
 *     不解析 JSON、不调插件 HTTP。
 *
 * 失败策略：sidecar 不在、超时、配置非法，一律当「没有长记忆」处理，绝不影响记忆卡本身。
 * 禁用时会清空注入文件（同记忆卡关掉时的做法），避免「设置关了但提示词还在」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { activeMemoryPaths } from '../../../src/character-persona.js';
import { readQqConfig, writeTextAtomic } from './store.js';
import {
  normalizePmemoryConfig, pmemoryConsume, pmemoryHealth, pmemoryOverview,
} from '../../../src/pmemory-client.js?rev=20261102-pmemory';

/** 注入文件就放在记忆卡同一个目录里，桥接按文件名直读。 */
export const PMEMORY_PROMPT_FILE = 'pmemory-prompt-qq.md';
export const PMEMORY_STATUS_FILE = 'pmemory-status.json';

/** 一次最多推多少条：sidecar 侧会跑 update_index，太大就别一分钟一次地推。 */
const MAX_MIRROR_RECORDS = 400;

function pmemoryPaths(paths = activeMemoryPaths()) {
  return {
    prompt: path.join(paths.dir, PMEMORY_PROMPT_FILE),
    status: path.join(paths.dir, PMEMORY_STATUS_FILE),
  };
}

/** 读 QQ 侧配置里的 pmemory 块（`config.json` → `config.example.json` 默认）。 */
export function pmemoryConfig() {
  try {
    const { config } = readQqConfig();
    return normalizePmemoryConfig(config?.pmemory ?? {});
  } catch {
    return normalizePmemoryConfig({});
  }
}

/** 记忆卡的记录 → sidecar 的 `/consume` 载荷。只搬文本与元信息，不动 id 语义。 */
export function recordsFromCard(card, { limit = MAX_MIRROR_RECORDS } = {}) {
  const records = Array.isArray(card?.records) ? card.records : [];
  const picked = [];
  for (const record of records) {
    const text = String(record?.text ?? '').trim();
    if (!text) continue;
    const createdAtMs = Date.parse(record?.createdAt ?? '');
    picked.push({
      text,
      reasoning: [record?.title, record?.speaker, record?.botReply].filter(Boolean).join(' / '),
      type: String(record?.kind ?? record?.scope ?? 'memory'),
      importance: Number(record?.importance) || 1,
      tags: Array.isArray(record?.tags) ? record.tags.map(String) : [],
      scope: String(record?.scope ?? ''),
      key: String(record?.id ?? ''),
      surfcoreId: String(record?.id ?? ''),
      // 契约定的是毫秒时间戳：sidecar 侧 created_at_us = createdAt * 1000。
      createdAt: Number.isFinite(createdAtMs) ? Math.floor(createdAtMs) : undefined,
    });
    if (picked.length >= limit) break;
  }
  return picked;
}

/** 清空注入文件（禁用 / 后端明确关闭时用；连不上时保留旧文件，见下方注释）。 */
function clearPromptFile(pmPaths) {
  try { writeTextAtomic(pmPaths.prompt, ''); } catch {}
}

function writeStatus(pmPaths, status) {
  try {
    writeTextAtomic(pmPaths.status, `${JSON.stringify(status, null, 2)}\n`);
  } catch {}
}

/**
 * 维护后同步一次：mirror 卡 → 取概览 → 写注入文件。
 *
 * 返回的状态永远是可序列化的普通对象，绝不抛错。
 * `state` 取值：`disabled`（没开）/ `unreachable`（开了但连不上）/ `synced`（成功）。
 */
export async function syncPmemory({ config = pmemoryConfig(), card = null, paths = null, now = Date.now() } = {}) {
  const pmPaths = pmemoryPaths(paths ?? activeMemoryPaths());
  const base = {
    at: new Date(now).toISOString(),
    enabled: config?.enabled === true,
    url: config?.url ?? '',
    namespace: config?.namespace ?? '',
    hostAllowed: config?.hostAllowed !== false,
  };
  if (!base.enabled) {
    clearPromptFile(pmPaths);
    const status = { ...base, state: pmPaths === null ? 'disabled' : 'disabled' };
    writeStatus(pmPaths, status);
    return status;
  }
  const health = await pmemoryHealth(config, { timeoutMs: 2500 });
  if (!health.ok) {
    // 连不上不动注入文件：一次 sidecar 重启不该把已有的长记忆注入清空，
    // 但状态要留痕，方便面板/日志判断「长记忆这半天其实是旧的」。
    const status = { ...base, state: 'unreachable', error: health.error ?? 'unreachable' };
    writeStatus(pmPaths, status);
    return status;
  }
  let mirrored = 0;
  if (config.mirrorOnMaintenance && card) {
    const records = recordsFromCard(card);
    if (records.length) {
      const consumed = await pmemoryConsume(config, { namespace: config.namespace, records });
      if (consumed.ok) mirrored = Number(consumed.data?.upserted ?? records.length) || 0;
    }
  }
  const overview = await pmemoryOverview(config, { namespace: config.namespace, maxChars: config.overviewMaxChars });
  if (!overview.ok) {
    const status = { ...base, state: 'unreachable', error: overview.error ?? 'overview failed', mirrored };
    writeStatus(pmPaths, status);
    return status;
  }
  const text = String(overview.data?.text ?? '').trim();
  try { writeTextAtomic(pmPaths.prompt, text ? `${text}\n` : ''); } catch {}
  const status = {
    ...base,
    state: 'synced',
    mirrored,
    hits: Number(overview.data?.count ?? 0) || 0,
    // 契约里 /overview 只保证 `count`（库内条数）；`total` 是兼容旧存根的兜底。
    total: Number(overview.data?.total ?? overview.data?.count ?? 0) || 0,
    chars: text.length,
    engineVersion: health.data?.engineVersion ?? '',
    schemaVersion: health.data?.schemaVersion ?? '',
  };
  writeStatus(pmPaths, status);
  return status;
}

/** 给面板/状态端点用的只读快照（不产生网络请求）。 */
export function pmemoryStatusSnapshot({ paths = null } = {}) {
  const pmPaths = pmemoryPaths(paths ?? activeMemoryPaths());
  const config = pmemoryConfig();
  let status = null;
  try {
    status = JSON.parse(fs.readFileSync(pmPaths.status, 'utf8'));
  } catch {}
  let chars = 0;
  try { chars = fs.readFileSync(pmPaths.prompt, 'utf8').length; } catch {}
  return {
    config: {
      enabled: config.enabled,
      url: config.url,
      namespace: config.namespace,
      hostAllowed: config.hostAllowed !== false,
      mirrorOnMaintenance: config.mirrorOnMaintenance,
      overviewMaxChars: config.overviewMaxChars,
      hasToken: Boolean(config.token),
    },
    promptFile: pmPaths.prompt,
    promptChars: chars,
    status,
  };
}
