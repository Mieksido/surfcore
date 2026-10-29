/**
 * 路径与运行环境解析（合体插件唯一入口）。
 *
 * 关键点：插件可能以 link: 方式装进 DSH profile。Node 对目录 junction 通常会把
 * import.meta.url 解析到真实路径，但不能假设；所以 QQBOT_ROOT 用「候选 + 探针」
 * 解析，而不是写死层级。探针必须同时看到 config.json 和 src/bridge.js。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = process.env.USERPROFILE || os.homedir();
export const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh');
export const STATE_DIR = path.join(DSH_HOME, 'surfcore');
export const BACKUP_DIR = path.join(STATE_DIR, 'backups');
export const MEMORY_DIR = path.join(STATE_DIR, 'memory');
export const AUDIT_LOG = path.join(STATE_DIR, 'audit.jsonl');
export const UNIFIED_FILE = path.join(STATE_DIR, 'config.json');
export const ALIGN_FILE = path.join(STATE_DIR, 'alignments.json');
export const CANDIDATE_FILE = path.join(STATE_DIR, 'align-candidates.json');
export const EXT_STATE_FILE = path.join(STATE_DIR, 'extensions.json');
export const PLUGIN_LOG = path.join(STATE_DIR, 'plugin.log');
export const BRIDGE_SUPERVISOR_LOG = path.join(STATE_DIR, 'bridge-supervisor.log');

const ROOT_CANDIDATES = [
  // 显式覆盖优先（多实例 / 桥接不在本仓库旁边时用）。
  process.env.SURFCORE_ROOT,
  process.env.SURFCORE_QQBOT_ROOT,
  // 兼容迁移前的旧环境变量名。
  process.env.QQBILI_QQBOT_ROOT,
  // 默认布局：<surfcore>/plugins/surfcore/lib/paths.js
  path.resolve(PLUGIN_ROOT, '..', '..'),
  path.resolve(PLUGIN_ROOT, '..', '..', '..'),
  process.cwd(),
].filter(Boolean);

function looksLikeQqbotRoot(dir) {
  try {
    return fs.existsSync(path.join(dir, 'config.json')) && fs.existsSync(path.join(dir, 'src', 'bridge.js'));
  } catch {
    return false;
  }
}

export const QQBOT_ROOT = ROOT_CANDIDATES.find(looksLikeQqbotRoot) || path.resolve(PLUGIN_ROOT, '..', '..');
export const QQ_CONFIG = path.join(QQBOT_ROOT, 'config.json');
export const QQ_CONFIG_EXAMPLE = path.join(QQBOT_ROOT, 'config.example.json');
export const QQ_STATE_DIR = path.join(QQBOT_ROOT, 'state');
export const QQ_PERSONA_DIR = path.join(QQBOT_ROOT, 'roles');
// 新用户没配置 persona.file 时的兜底路径；已有 roles/*.md 时由 resolvePersonaFile() 自动发现。
export const DEFAULT_PERSONA_FILE = path.join(QQ_PERSONA_DIR, '角色卡.md');
export const QQ_ALIGNMENT_BRIEF = path.join(QQ_STATE_DIR, 'alignment-brief.md');
export const QQ_ACTIVITY_LOG = path.join(QQ_STATE_DIR, 'qq-activity.log');
export const QQ_BRIDGE_LOG = path.join(QQ_STATE_DIR, 'bridge.log');
export const QQ_LOCK_FILE = path.join(QQ_STATE_DIR, 'bridge.lock');
// B站数据也收进 SurfCore 自己的状态目录，和 QQ 共用同一个根。
export const BILI_DIR = path.join(STATE_DIR, 'bili');
export const BILI_CONFIG = path.join(STATE_DIR, 'bili.config.json');
export const BILI_CRED = path.join(BILI_DIR, 'credentials.json');
// 主人（用户本人）的 B站 凭据：只用于「一键抓取偏好」的只读扫描，绝不用于发评论/动态。
// 单独一个文件，避免和鱼自己的 cookie 混在一起（身份串号是事故）。
export const OWNER_BILI_CRED = path.join(BILI_DIR, 'owner-credentials.json');
export const BILI_AI_DIR = BILI_DIR;
export const BILI_TOOLS_DIR = path.join(PLUGIN_ROOT, 'tools');
export const BILI_MJS = path.join(BILI_TOOLS_DIR, 'bili.mjs');
export const QQ_FOR_BILI_FILE = path.join(MEMORY_DIR, 'qq-for-bili.md');
export const BILI_FOR_QQ_FILE = path.join(MEMORY_DIR, 'bili-for-qq.md');
export const BILI_ALIGNMENT_FILE = path.join(MEMORY_DIR, 'alignment-for-bili.md');
// 记忆卡：唯一真相 memory-card.json；memory-card.md 给人看；两份 prompt 文件是
// QQ / B站 每次注入时读的裁剪版（桥接和调度器都不需要解析 JSON）。
export const MEMORY_CARD_JSON = path.join(MEMORY_DIR, 'memory-card.json');
export const MEMORY_CARD_MD = path.join(MEMORY_DIR, 'memory-card.md');
export const MEMORY_CARD_PROMPT_QQ = path.join(MEMORY_DIR, 'memory-card-prompt-qq.md');
export const MEMORY_CARD_PROMPT_BILI = path.join(MEMORY_DIR, 'memory-card-prompt-bili.md');
export const MEMORY_CARD_INBOX = path.join(MEMORY_DIR, 'memory-inbox.jsonl');
// 全量记忆卡：只存档（全部清晰、永不遗忘），**不生成 prompt 文件**——
// QQ / B站 平时只加载上面两份来自衰减卡的注入块。
// 存储是 append-only JSONL + stats；10GB 级不读整份、不重写。
export const MEMORY_CARD_FULL_JSONL = path.join(MEMORY_DIR, 'memory-card-full.jsonl');
export const MEMORY_CARD_FULL_STATS = path.join(MEMORY_DIR, 'memory-card-full-stats.json');
export const MEMORY_CARD_FULL_JSON = path.join(MEMORY_DIR, 'memory-card-full.json'); // 旧版，迁移后 .legacy
export const MEMORY_CARD_FULL_MD = path.join(MEMORY_DIR, 'memory-card-full.md');

export const PLATFORM_DIR = path.join(PLUGIN_ROOT, 'platforms');
export const EXTENSIONS_DIR = path.join(PLUGIN_ROOT, 'extensions');

export function ensureDirs() {
  for (const dir of [STATE_DIR, BACKUP_DIR, MEMORY_DIR, MEMORY_DIR, QQ_STATE_DIR, BILI_DIR]) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  }
}

/** 真 node.exe（Electron 的 process.execPath 是 Harness.exe，跑不了部分脚本）。 */
export function findNodeExe() {
  const candidates = [process.env.DSH_NODE];
  try {
    candidates.push(path.join(path.dirname(process.execPath), 'resources', 'runtime', 'primary-runtime',
      'dependencies', 'node', 'bin', 'node.exe'));
  } catch {}
  candidates.push(
    path.join(DSH_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    path.join(HOME, '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    'C:\\Program Files\\nodejs\\node.exe',
  );
  for (const candidate of candidates) {
    try { if (candidate && fs.existsSync(candidate)) return candidate; } catch {}
  }
  return process.execPath;
}

export function maskPath(input) {
  let text = String(input ?? '');
  try {
    if (DSH_HOME) text = text.split(DSH_HOME).join('$DSH_HOME');
    if (HOME) text = text.split(HOME).join('%USERPROFILE%');
    text = text.replace(/[A-Za-z]:\\Users\\[^\\/]+/g, '%USERPROFILE%');
  } catch {}
  return text;
}
