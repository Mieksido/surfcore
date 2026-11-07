/**
 * surfcore —— 宿主半边（设置窗口的唯一后端）。
 *
 * 它把原来两个插件的能力装进一个进程：
 *   · QQ 侧：读/写 <surfcore>/config.json、桥接探活/启停/重启、模式与 ownerQQ、
 *            白名单、social/socialV2/chat/slang/webSearch 等全部参数；
 *   · B站侧：读/写 ~/.dsh/surfcore/bili.config.json、cookie 写入、依赖体检、
 *            待审回复、通知测试、生物钟（scheduler.js）；
 *   · 合体层：统一人设卡、QQ→B站 脱敏记忆、身份对齐、扩展接口、平台适配器
 *            （qq/bili 内置，tieba 预留）。
 *
 * 安全：
 *   · 所有路由只接受本机回环 + DSH connection.requestRejection；
 *   · 写操作要求 application/json，且 Origin（若有）必须同源；
 *   · 读配置脱敏（********），保存时 ******** 表示保持原值；
 *   · 每次写文件前备份到 ~/.dsh/surfcore/backups/。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ALIGN_FILE, BACKUP_DIR, BILI_AI_DIR, BILI_ALIGNMENT_FILE, BILI_CONFIG, BILI_CRED, BILI_DIR, BILI_MJS,
  BILI_TOOLS_DIR, DSH_HOME, EXTENSIONS_DIR, MEMORY_DIR, PLUGIN_ROOT, PLUGIN_LOG, QQ_ALIGNMENT_BRIEF,
  QQ_CONFIG, QQBOT_ROOT, STATE_DIR, UNIFIED_FILE, ensureDirs, findNodeExe, maskPath,
} from './paths.js';
import { resolvePersonaFile } from './persona.js';
import { discoverSnowLumaConnection } from '../../../src/snowluma-conn.js';
import { unwrapSchemaValue } from '../../../src/schema-values.js';
import { findSnowLumaInstall as findSnowLumaInstallIn, normalizeSnowLumaInstall, snowLumaMissingReport } from './snowluma-install.js';
import { buildInstallChecks, installOk, planDoctorFix } from './doctor.js';
import { VOICE_PORTS, readPackCharacters, validateCharacter } from './voice-health.js';
import {
  autoSnapshot, beforeSwitchSnapshot, characterDetail, characterOverview, createCharacterFromPayload,
  deleteCharacter, manualSnapshot, migrateIfNeeded, restoreCharacterSnapshot, switchToCharacter,
  updateCharacterFromPayload,
} from './characters.js';
import { activeMemoryPaths, activePersonaLayers, activePlatformStateDir, readCurrentCharacter, touchCharacter } from '../../../src/character-persona.js';
import { automationSnapshot } from './automation.js';
import {
  backupFile, listBackups, pathSummary,
  readAll, readBiliConfig, readJson, readQqConfig, readUnified,
  saveBiliConfig, saveQqConfig, saveUnified, writeJsonAtomic, writeTextAtomic,
} from './store.js';
import {
  PRIVACY_POLICY_VERSION, explainText, scanText,
} from './privacy.js';
import {
  addLink, approveCandidate, exportAlignments, importAlignments, listCandidates,
  listLinks, rejectCandidate, removeLink, stats as alignStats,
  updateLink, writeAlignmentBriefs,
} from './align.js';
import {
  auditTail, biliToQqStatus, memoryStatus, previewQqForBili, rebuildAllPrompts,
  refreshBiliToQq, scanBiliFeedForCandidates, scanQqFeedForCandidates,
  syncQqToBili,
} from './memory.js';
import {
  bridgeLogTail, callBridge, restart as restartBridge, start as startBridge,
  status as bridgeStatus, stop as stopBridge,
  consoleBase, consoleToken } from './bridge.js';
import { PlatformRegistry } from './platforms.js';
import { ExtensionHost } from './extensions.js';
import { isLoopbackReq, json, readBody, sameOrigin } from './http-guard.js';
import { startScheduler } from './scheduler.js';
import { createTokenBudgetService } from './token-budget.js';
import { scanPluginCompatibility } from './compat.js';
import { createGateEventStore } from '../../../src/gate-events.js';
import { normalizeAllowlist } from '../../../src/allowlist.js';
import { createPetService, detectElectronPath, installElectronRuntime, ELECTRON_VERSION, electronDownloadUrl } from './pet.js';
import { createPetChatService } from './pet-chat.js';
import { createPetPurposeService } from './pet-purpose.js';
import { createPetApiService } from './pet-api.js';
import { createUpdatesService, resumePendingApply } from './updates.js';
import { BILI_WORKSPACE_TITLE, biliWorkspacePath } from './bili-workspace.js';
import {
  adminFromSources, adminSummary, normalizeAdmin, projectAdminSave,
} from '../../../src/admin-identity.js';
import {
  applyMemoryCardAction, compactMemoryCardNow, fullMemoryCardSnapshot, memoryCardIdle, memoryCardSnapshot,
  memoryCardStatusNow, notifyOwnerIfNeeded, restoreMemoryCardBackup, runMemoryCardMaintenance,
  startMemoryCardTimer,
} from './memory-card.js';
import {
  listVectorMemoryRecords, rebuildAllVectorIndexes, rebuildVectorMemory, runVectorMemoryMaintenance as runVectorMemoryMaintenanceNow,
  searchVectorMemoryRecords, startVectorMemoryTimer, vectorMemoryIdle, vectorMemorySnapshot, vectorMemoryStatusNow,
} from './vector-memory.js';
import {
  embeddingPacksStatus, getCloudProviderProfile, getEmbeddingPackJob, openEmbeddingShare, registerAllInstalledModels, removeEmbeddingPack,
  saveCloudPackConfig, activateCloudProvider, selectEmbeddingPack, startEmbeddingPackInstall, startEmbeddingRuntime, stopEmbeddingRuntime,
  testEmbeddingPack,
} from './embedding-packs.js';
import { readWatchHistory } from '../tools/lib/watch-history.mjs';
import { enrichWatchHistory } from '../tools/lib/watch-actions.mjs';
import { scanPreferences } from '../tools/lib/pref-scan.mjs';
import {
  cancelQrLogin, closeAllQrLogins, pollQrLogin, readFishAccount, readOwnerAccount, startQrLogin, verifyStoredCredentials,
} from './bili-qr-login.mjs';
import { fishGuardStateSummary } from '../tools/lib/fish-guard.mjs';
import { summarizeQqFishGuard } from './qq-fish-guard.js';
import { applySessionPermission } from './scheduler.js';
import { fileStamp, isStale } from '../../../src/config-stamps.js';
import { createContextTelemetry } from '../../../src/context-telemetry.js';
import { createBillingService } from './billing.js';
import { createPersonaClassifier } from './persona-classify.js';

// 版本号只有一个来源：仓库根 package.json（与 plugins/surfcore/package.json 必须一致，
// 由 scripts/version.mjs check 与 test-version.mjs 把关）。
// 这里不做硬编码，避免"改了一处忘了另一处"。
function readOwnVersion() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url)); // plugins/surfcore/lib
    const rootPkg = path.resolve(here, '../../../package.json');
    return JSON.parse(fs.readFileSync(rootPkg, 'utf8')).version || '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

const VERSION = readOwnVersion();
const API_PREFIX = '/dsh-surfcore/api';
const EXT_PREFIX = '/dsh-surfcore/ext';
const HERE = path.dirname(fileURLToPath(import.meta.url));

const pluginLog = (...args) => {
  const line = `[${new Date().toISOString()}] ${args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    // 2026-10-22 审计：只 append 不轮转会无限增长。超过 2MB 就滚一份 .1（保留一代）。
    try {
      const stat = fs.statSync(PLUGIN_LOG);
      if (stat.size > 2 * 1024 * 1024) fs.renameSync(PLUGIN_LOG, `${PLUGIN_LOG}.1`);
    } catch {}
    fs.appendFileSync(PLUGIN_LOG, line);
  } catch {}
  try { console.log(`[surfcore] ${args.join(' ')}`); } catch {}
};

function safeBackupName(name) {
  const base = path.basename(String(name ?? ''));
  if (!base || base !== String(name)) return '';
  return base;
}

function readTextFile(file, fallback = '') {
  try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; }
}

/** 只读文件尾部（默认 512KB）：日志接口不能因为日志变大就一次读进内存。 */
function readTextTail(file, maxBytes = 512 * 1024) {
  try {
    const stat = fs.statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}

function mtimeIso(file) {
  try { return fs.statSync(file).mtime.toISOString(); } catch { return null; }
}

function fileInfo(file) {
  try {
    const stat = fs.statSync(file);
    return { exists: true, bytes: stat.size, mtime: stat.mtime.toISOString() };
  } catch {
    return { exists: false, bytes: 0, mtime: null };
  }
}

function parseModeState() {
  const local = readJson(path.join(QQ_STATE_DIR(), 'mode.json'), {}) ?? {};
  return { localMode: local.mode ?? null, localRole: local.role ?? null };
}

function QQ_STATE_DIR() {
  return path.join(path.dirname(QQ_CONFIG), 'state');
}

export const name = 'surfcore';
export const inject = ['webServer', 'connection', 'sessionController'];

export function apply(ctx) {
  ensureDirs();

  // 上次的"退出后应用"可能没跑起来（Electron 宿主没带 ELECTRON_RUN_AS_NODE）：
  // 这里重新排队，用户下次退出 DSH 就会应用（2026-10-28 反馈：点几次都还是旧版本）。
  try { resumePendingApply({ stateDir: STATE_DIR, pluginLog }); } catch (error) { pluginLog('[updates] 启动重试失败：', String(error?.message ?? error)); }

  // 2026-10-22 起：`surface_core` 迁移期的一次性逻辑**已整段删除**。
  // 原因：当年为了把旧工作区改名，留了「有 .legacy-workspace 标记就删/移旧目录」的代码；
  // 这类「启动时按标记动用户目录」的代码风险远大于收益（误删不可逆），迁移也早已完成。
  // 现在的约定：插件**不碰**任何工作区目录；清理旧目录一律由人工或用脚本先备份再动。
  // 相关事故与处置见 docs/PITFALLS.md #1/#3。

  const platforms = new PlatformRegistry();
  platforms.setStatus('qq', () => bridgeStatus());
  platforms.setStatus('bili', () => biliToQqStatus());
  const extensionHost = new ExtensionHost({
    platforms,
    memory: { memoryStatus, previewQqForBili, syncQqToBili, refreshBiliToQq, biliToQqStatus, auditTail },
    align: { listLinks, listCandidates, addLink, updateLink, removeLink, approveCandidate, rejectCandidate, stats: alignStats },
    bridge: {
      status: bridgeStatus,
      start: () => startBridge({ dshWebUrl: currentDshUrl() }),
      stop: stopBridge,
      restart: () => restartBridge({ dshWebUrl: currentDshUrl() }),
      call: callBridge,
    },
    log: pluginLog,
  });

  let scheduler = null;
  let schedulerStatus = { running: false, startedAt: null, lastError: null, lastTickAt: null };
  // 关闭温柔模式并丢弃上下文时递增：给 B站 一个全新 DSH sessionId，旧历史不再带入。
  let biliSessionEpoch = 0;
  let syncTimer = null;
  let memoryCardTimer = null;
  let vectorMemoryTimer = null;
  let characterTimer = null;

  // ── 每日 token 额度 / 用量采集（2026-10-23 用户要求）────────────────────
  // 插件是唯一能同时看到 QQ、B站、黑话学习会话的地方：用 session/event 实时累计，
  // 设置页展示、B站 调度器拦截、QQ 桥接（读 daily 快照）都共用这一份。
  const tokenBudget = createTokenBudgetService({
    ctx,
    dshHome: DSH_HOME,
    qqStateDir: QQ_STATE_DIR(),
    getQqConfig: () => readQqConfig().config,
    log: (message) => pluginLog(message),
  });
  // 闸门事件中心：桥接负责写，插件负责展示/确认；同一份文件、同一套分级。
  const gateEvents = createGateEventStore({ dir: STATE_DIR, log: (message) => pluginLog(message) });
  // ── 桌宠（独立栏目，默认不安装；用户自己安装才生效）────────────────────
  const petService = createPetService({ stateDir: STATE_DIR, pluginLog, getSubprocess: () => ctx.get('subprocess') });
  // 桌宠对话与「目的机制」的桌宠载体：和 QQ / B站 共用当前角色的人格卡、记忆卡、目的状态。
  // Phase 0A：旁路遥测（只读事件，不改 prompt/工具/会话行为）。
  const contextTelemetry = createContextTelemetry({
    file: path.join(STATE_DIR, 'context-telemetry-plugin.jsonl'),
    source: 'plugin',
    log: (message) => pluginLog(message),
  });
  // A+B 账单：每 10 分钟刷新到 ~/.dsh/surfcore/billing；只读，不调用模型。
  const personaClassifier = createPersonaClassifier({ ctx, log: (message) => pluginLog(message), tokenBudget });

  const billing = createBillingService({
    stateDir: STATE_DIR,
    qqRoot: QQBOT_ROOT,
    readCurrentCharacter,
    log: (message) => pluginLog(message),
  });
  billing.start();

  const petChat = createPetChatService({ ctx, stateDir: STATE_DIR, pluginLog, tokenBudget });
  const petPurpose = createPetPurposeService({ chat: petChat, tokenBudget, pluginLog, callBridge });
  const petApi = createPetApiService({
    chat: petChat,
    purpose: petPurpose,
    petService,
    stateDir: STATE_DIR,
    currentDshUrl,
    pluginLog,
    version: VERSION,
  });

  // ── 组件更新（2026-10-26 用户要求）──────────────────────────────────────
  // 检查 SurfCore 本体 + 语音包 + 桌宠 + 未来登记的扩展：只读 git fetch，更新只允许 --ff-only。
  // 组件清单每次动态解析：换路径 / 新装包 / 新扩展都不用重启插件。
  const updates = createUpdatesService({
    stateDir: STATE_DIR,
    pluginLog,
    githubToken: () => String(readUnified().config?.updates?.githubToken ?? ''),
    // 更新通道：stable（默认，只走正式 Release）/ dev（只走 Pre-release 的 -dev.N）
    channel: () => String(readUnified().config?.updates?.channel ?? 'stable'),
    blockedReason: (component) => {
      if (component.kind === 'pet' || component.id === 'surfpet') {
        try {
          const st = petService.status();
          if (st?.running) return '桌宠正在运行，先停止再更新';
        } catch {}
      }
      return '';
    },
    components: () => {
      const list = [];
      const updCfg = readUnified().config?.updates ?? {};
      // 1) SurfCore 本体：源码树，走 git
      list.push({ id: 'surfcore', name: 'SurfCore 本体', dir: QQBOT_ROOT, kind: 'git', branch: 'main', versionRepo: 'Mieksido/surfcore' });
      // 2) 语音包**不进入自动更新列表**：它是离线运行时/模型/vendor 包，
      //    不是 SurfCore 那种代码 zip；统一 updateFromZip 会按 surfcore-* + package.json
      //    解析而必然失败（2026-10-30 用户反馈）。需要新包时在「语音」页重新导入离线包，
      //    由 voice-pack-import 保留 config.toml / .venv / models / vendor。
      //    语音包自己的 version.json / models.json 仍由语音页/包管理读取。
      // 3) 桌宠：构建产物，走版本清单（zip 安装包）；更新交给 petService.updateFromZip（保留 data/）
      try {
        const st = petService.status();
        if (st?.dir) {
          list.push({
            id: 'surfpet', name: '桌宠', dir: st.dir, kind: 'release',
            versionUrl: updCfg.pet?.versionUrl || '',
            versionFile: 'package.json',
            installZip: (zipPath) => petService.updateFromZip(zipPath),
          });
        }
      } catch {}
      // 4) 用户/未来扩展登记的组件：unified config 的 updates.components[]
      try {
        const custom = updCfg.components;
        if (Array.isArray(custom)) {
          for (const item of custom) {
            if (!item || typeof item !== 'object' || !item.id || !item.dir) continue;
            list.push({
              id: String(item.id).slice(0, 60),
              name: String(item.name ?? item.id).slice(0, 80),
              dir: String(item.dir),
              kind: ['git', 'release', 'auto'].includes(item.kind) ? item.kind : 'auto',
              branch: item.branch ? String(item.branch).slice(0, 60) : undefined,
              versionUrl: item.versionUrl ? String(item.versionUrl) : '',
            });
          }
        }
      } catch {}
      // 去重（同 id 只留第一个）
      const seen = new Set();
      return list.filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
    },
  });

  let sessionEventOff = null;
  try {
    if (typeof ctx.on === 'function') {
      sessionEventOff = ctx.on('session/event', (session, event) => {
        try { tokenBudget.ingestEvent(session, event); }
        catch (error) { pluginLog('token 用量采集失败：', String(error?.message ?? error).slice(0, 160)); }
        try {
          if (tokenBudget.isTrackedSession(session)) contextTelemetry.ingestEvent(session, event);
        } catch (error) { pluginLog('上下文遥测失败：', String(error?.message ?? error).slice(0, 160)); }
      });
    }
  } catch (error) {
    pluginLog('token 用量采集监听注册失败：', String(error?.message ?? error));
  }

  // 启动时先重建身份对齐提示块（bridge 与 B站调度器都读它）。
  try { writeAlignmentBriefs(); } catch (error) { pluginLog('启动时写对齐简报失败：', error?.message ?? error); }

  // ── 平台启动开关（2026-10-24 用户要求：不是所有用户都想同时开 QQ / B站）──
  // 唯一真相在合体层 config.json 的 platforms.start.{qq,bili}；旧 bridge.autoStart
  // 只在 readUnified() 里做一次迁移。开关关掉 = 不自动启动、不被「一键启动」带上，
  // 保存配置时宿主会把正在跑的那一边停掉（save/restart 流程见 handleConfig）。
  function platformStartState() {
    const start = readUnified().config.platforms?.start ?? {};
    return { qq: start.qq !== false, bili: start.bili !== false };
  }
  function platformStartEnabled(id) {
    return platformStartState()[id] !== false;
  }
  function idleSchedulerStatus(reason = 'disabled') {
    return {
      running: false,
      disabled: !platformStartEnabled('bili'),
      reason,
      startedAt: null,
      lastError: null,
      lastTickAt: null,
      sessionId: schedulerStatus.sessionId ?? null,
    };
  }
  // B站生物钟：合体后由本插件接管（旧 dsh-bili-whale 会被停用）。
  // 抽成函数给「一键启动」复用：DSH 重启后插件加载时按平台开关决定是否自动启动，
  // 失败后也能手动拉起。
  function startSchedulerNow() {
    if (scheduler && schedulerStatus.running) return schedulerStatus;
    if (!platformStartEnabled('bili')) {
      schedulerStatus = idleSchedulerStatus('disabled');
      pluginLog('生物钟未启动：B站 启动开关关闭（设置 → B站 → 启动 B站）');
      return schedulerStatus;
    }
    // 没登录过 B站 就不要自动起会话：新用户第一次装完，60s 一次的 tick 只会空烧 token。
    // （凭据由扫码登录写入 BILI_CRED；用户登录后会自然启动。）
    if (!fs.existsSync(BILI_CRED)) {
      schedulerStatus = idleSchedulerStatus('not-logged-in');
      pluginLog('生物钟未启动：B站 还没登录（设置 → B站 → 扫码登录），避免空转消耗 token');
      return schedulerStatus;
    }
    try {
      const character = readCurrentCharacter();
      const baseSessionId = character ? `bili-whale-${character.id}` : 'bili-whale';
      const sessionId = biliSessionEpoch ? `${baseSessionId}-r${biliSessionEpoch}` : baseSessionId;
      const biliWorkspace = biliWorkspacePath(DSH_HOME);
      scheduler = startScheduler(ctx, {
        dshHome: DSH_HOME,
        biliMjs: BILI_MJS,
        // 新会话走 workspaceId；cwd 只作为旧版 DSH 没有 workspaceController 时的兜底。
        cwd: biliWorkspace,
        workspacePath: biliWorkspace,
        workspaceTitle: BILI_WORKSPACE_TITLE,
        sessionId,
        tokenBudget,
        log: (message) => pluginLog(message),
      });
      schedulerStatus = { running: true, disabled: false, reason: '', startedAt: new Date().toISOString(), lastError: null, lastTickAt: null, sessionId };
      pluginLog(`生物钟已启动（会话 ${sessionId}）`);
    } catch (error) {
      schedulerStatus.lastError = String(error?.message ?? error);
      pluginLog('生物钟启动失败：', schedulerStatus.lastError);
    }
    return schedulerStatus;
  }
  function stopSchedulerNow() {
    const wasRunning = Boolean(scheduler && schedulerStatus.running);
    try { scheduler?.stop?.(); } catch (error) {
      pluginLog('生物钟停止失败：', String(error?.message ?? error));
    }
    scheduler = null;
    schedulerStatus = { running: false, startedAt: null, lastError: null, lastTickAt: null };
    if (wasRunning) pluginLog('生物钟已停止');
    return { ok: true, wasRunning, scheduler: schedulerStatus };
  }
  // 显式“丢弃上下文”：给 B站 换一个新的 DSH sessionId，旧历史不会被新会话读取。
  // 只停/起重启调度器，不删除 B站 的观看历史/行为账本；丢的是模型对话上下文。
  async function resetBiliSchedulerSession() {
    if (!scheduler || !schedulerStatus.running) return { reset: false, reason: 'not-running' };
    try { await scheduler?.retire?.(); } catch (error) {
      pluginLog('B站 旧会话退役失败（继续换新会话）：', String(error?.message ?? error));
    }
    scheduler = null;
    schedulerStatus = idleSchedulerStatus('reset');
    biliSessionEpoch = Date.now();
    const next = startSchedulerNow();
    return { reset: true, sessionId: next?.sessionId ?? null, started: next?.running === true };
  }
  startSchedulerNow();

  // 管理员称呼的存量修复：v0.7.2 及以前只把 ownerQQ 投影到 QQ config.json，
  // displayName/biliName/gentle 留在 unified，桥接独立进程读不到 → 叫“管理员”。
  // 启动时补一次投影（有变化才写），桥接在跑就重启让它重新读配置。
  function ensureAdminProjection() {
    try {
      const qqState = readQqConfig();
      const unifiedState = readUnified();
      const biliState = readBiliConfig();
      const unifiedAdmin = unifiedState.hasAdmin ? unifiedState.config?.admin : undefined;
      const sourceAdmin = unifiedAdmin ?? qqState.config?.admin;
      const current = adminFromSources({
        unified: { admin: sourceAdmin },
        qq: qqState.config,
        bili: biliState.config,
      });
      if (!current.qq && !current.biliMid) return;
      const next = normalizeAdmin(current);
      const prev = normalizeAdmin(qqState.config?.admin);
      if (JSON.stringify(prev) === JSON.stringify(next)) return;
      const planned = projectAdminSave({ current: next, qq: qqState.config });
      if (!planned.qq) return;
      saveQqConfig(planned.qq);
      pluginLog('管理员称呼已补齐到 QQ config.json（桥接重启后生效）');
      setTimeout(() => {
        void bridgeStatus().then((st) => {
          if (!st.running) return;
          return restartBridge({ dshWebUrl: currentDshUrl() });
        }).catch(() => {});
      }, 1500).unref?.();
    } catch (error) {
      pluginLog('管理员称呼投影失败（继续使用现有配置）：', error?.message ?? error);
    }
  }

  ensureAdminProjection();

  // ── 角色人格：启动迁移 + 切换编排 ───────────────────────────────────────
  // 迁移只做一次：有旧记忆/旧 B站 账本才建第一个角色；旧目录原样保留作冷备份。
  function ensureCharacterSystem() {
    if (process.env.SURFCORE_DISABLE_CHARACTER_MIGRATION === '1') return { ok: true, skipped: true, reason: 'disabled' };
    try {
      const result = migrateIfNeeded({
        personaFile: resolvePersonaFile(),
        memoryDir: MEMORY_DIR,
        biliDir: BILI_DIR,
        stateDir: QQ_STATE_DIR(),
      });
      if (result.migrated) {
        pluginLog(`角色系统：已从旧数据迁移出「${result.character?.name ?? result.current?.name}」（备份 ${maskPath(result.backupDir)}）`);
        writeCharacterRolePointer();
        // 桥接可能已经在跑旧路径：给它一次重启，让它读新角色目录。
        setTimeout(() => { void bridgeStatus().then((st) => { if (st.running) return restartBridge({ dshWebUrl: currentDshUrl() }); }).catch(() => {}); }, 1500).unref?.();
      }
      return result;
    } catch (error) {
      pluginLog('角色系统迁移失败（继续用旧布局）：', error?.message ?? error);
      return { ok: false, error: String(error?.message ?? error) };
    }
  }

  function writeCharacterRolePointer() {
    const cur = readCurrentCharacter();
    if (!cur) return;
    const file = path.join(QQ_STATE_DIR(), 'current-role.json');
    const old = readJson(file, {}) ?? {};
    try {
      writeJsonAtomic(file, { role: cur.name, mode: old.mode === 'silent' ? 'silent' : 'active' });
    } catch (error) {
      pluginLog('写 current-role.json 失败：', error?.message ?? error);
    }
  }

  /** 先让桥接停掉全部旧会话（v1 + v2），再停进程；否则旧 DSH 回合可能带着旧人格继续发消息。 */
  async function stopAllBridgeSessions() {
    try {
      const listed = await callBridge('/api/sessions', { timeoutMs: 8000 });
      const sessions = Array.isArray(listed?.data?.sessions) ? listed.data.sessions : [];
      for (const item of sessions) {
        if (!item?.key) continue;
        await callBridge('/api/session/reset', { method: 'POST', body: { key: item.key }, timeoutMs: 15000 }).catch(() => {});
      }
      await callBridge('/api/socialV2/reset', { method: 'POST', timeoutMs: 20000 }).catch(() => {});
    } catch (error) {
      pluginLog('切换角色：停止旧桥接会话失败（继续停进程）：', error?.message ?? error);
    }
  }

  /** 切换角色前把桥接的会话映射挪走：新角色必须从空会话开始，不能带旧人格上下文。 */
  function archiveBridgeRuntimeState() {    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(BACKUP_DIR, `character-switch-${stamp}`);
    fs.mkdirSync(dir, { recursive: true });
    const files = ['sessions.json', 'social-v2.json'];
    const moved = [];
    for (const name of files) {
      const src = path.join(QQ_STATE_DIR(), name);
      try {
        if (!fs.existsSync(src)) continue;
        fs.renameSync(src, path.join(dir, name));
        moved.push(name);
      } catch (error) {
        pluginLog(`切换角色：归档 ${name} 失败：`, error?.message ?? error);
      }
    }
    return { dir, moved };
  }

  async function switchCharacterEverywhere(id) {
    const current = readCurrentCharacter();
    if (current && current.id === id) return { ok: true, already: true, current };
    const target = characterDetail(id).character;
    const skipPlatform = process.env.SURFCORE_DISABLE_PLATFORM_RESTART === '1';
    await memoryCardIdle();
    await vectorMemoryIdle();
    const wasRunning = skipPlatform ? false : (await bridgeStatus()).running;
    let schedulerWasRunning = !skipPlatform && Boolean(scheduler && schedulerStatus.running);
    try {
      if (schedulerWasRunning) {
        try { await scheduler?.retire?.(); } catch (error) { pluginLog('切换角色：停 B站 会话失败：', error?.message ?? error); }
        scheduler = null;
        schedulerStatus = { running: false, startedAt: null, lastError: null, lastTickAt: null };
      }
      if (wasRunning) {
        await stopAllBridgeSessions();
        const stopped = await stopBridge();
        if (!stopped.ok) {
          schedulerWasRunning = true;
          startSchedulerNow();
          throw new Error(`切换失败：QQ 桥接没停下来（${stopped.error || stopped.message || '未知原因'}）`);
        }
      }
      // 到这里两个平台都停了：给旧角色拍切换前存档，然后原子换指针。
      if (current) beforeSwitchSnapshot(current.id);
      const switched = switchToCharacter(id);
      writeCharacterRolePointer();
      const archived = archiveBridgeRuntimeState();
      // 先把新角色的记忆卡 prompt 生成好，再启动桥接/调度器，避免开头几条提示词读不到记忆。
      await runMemoryCardMaintenance({}).catch((error) => pluginLog('切换角色后整理记忆卡失败：', error?.message ?? error));
      if (wasRunning) {
        const started = await startBridge({ dshWebUrl: currentDshUrl() });
        if (!started.ok) pluginLog('切换角色：桥接重启失败（角色已切换，平台保持停止）：', started.error || started.message);
      }
      if (!skipPlatform) startSchedulerNow();
      pluginLog(`角色已切换：${current?.name ?? '（无）'} → ${target.name}（epoch ${switched.current?.epoch}）`);
      return {
        ok: true,
        current: switched.current,
        previous: current,
        bridgeRestarted: wasRunning,
        archived,
        scheduler: schedulerStatus,
      };
    } catch (error) {
      pluginLog('角色切换失败：', error?.message ?? error);
      if (schedulerWasRunning && (!scheduler || !schedulerStatus.running)) startSchedulerNow();
      throw error;
    }
  }

  const characterMigration = ensureCharacterSystem();
  // 迁移发生在 scheduler 启动之后：用新角色重启一次，换掉旧会话 id 与旧状态路径。
  if (characterMigration?.migrated) {
    try { scheduler?.stop?.(); } catch {}
    scheduler = null;
    schedulerStatus = { running: false, startedAt: null, lastError: null, lastTickAt: null };
    startSchedulerNow();
  }


  // 记忆卡：插件宿主是唯一维护者。启动 8 秒后整理一次（摄取桥接 inbox + B站记忆），
  // 之后每 10 分钟一次；每日衰减由 memory-card 自己按 dailyHour 判断。
  memoryCardTimer = startMemoryCardTimer({ log: pluginLog, callBridge });
  // 向量记忆：独立存储/独立开关，默认与记忆卡并行写入；memory.mode 只影响读取。
  vectorMemoryTimer = startVectorMemoryTimer({ log: pluginLog });

  // 角色自动存档：启动 10 秒后跑一次，之后每 6 小时检查（每天最多一份 + 11 个年龄档轮换）。
  const runCharacterAutoSave = () => {
    const cur = readCurrentCharacter();
    if (!cur) return;
    try {
      const result = autoSnapshot(cur.id);
      if (result.pruned?.length) pluginLog(`角色自动存档：${cur.name} 清理 ${result.pruned.length} 个旧档`);
    } catch (error) {
      pluginLog('角色自动存档失败：', error?.message ?? error);
    }
  };
  const characterInitial = setTimeout(runCharacterAutoSave, 10_000);
  characterInitial.unref?.();
  characterTimer = setInterval(runCharacterAutoSave, 6 * 60 * 60 * 1000);
  characterTimer.unref?.();

  // QQ → B站 定时同步（默认关闭；开启后每 30 分钟一次，启动 20 秒后先跑一次）。
  const startSyncTimer = () => {
    if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    const unified = readUnified().config;
    if (unified.memory?.qqToBili?.enabled !== true) return;
    setTimeout(() => {
      try { syncQqToBili(); } catch (error) { pluginLog('首次 QQ→B站 同步失败：', error?.message ?? error); }
    }, 20_000).unref?.();
    syncTimer = setInterval(() => {
      try { syncQqToBili(); } catch (error) { pluginLog('定时 QQ→B站 同步失败：', error?.message ?? error); }
    }, Math.max(5 * 60_000, Number(unified.memory?.qqToBili?.intervalMs) || 30 * 60_000));
  };

  // 扩展：只加载显式启用的；默认示例全部 disabled。
  const activateExtensions = async () => {
    if (readUnified().config.extensions?.enabled === false) return;
    try {
      const results = await extensionHost.activateEnabled();
      if (results.length) pluginLog(`扩展启用结果：${JSON.stringify(results)}`);
    } catch (error) {
      pluginLog('扩展启用失败：', error?.message ?? error);
    }
  };

  function currentDshUrl() {
    try {
      const ws = ctx.get('webServer');
      if (ws?.port) return `${ws.protocol || 'http:'}//127.0.0.1:${ws.port}`;
    } catch {}
    return String(process.env.DSH_WEB_URL ?? '').trim();
  }

  // 桥接是否还是“上一轮 DSH 的”：旧版本不报 root/dshBaseUrl，或者端口已经变了。
  function bridgeStaleReason(status) {
    if (!status?.running) return '';
    const runningRoot = status.root ? path.resolve(String(status.root)) : '';
    if (!runningRoot || runningRoot !== path.resolve(QQBOT_ROOT)) {
      return `桥接还在旧目录（root=${status.root ?? '未知'}）`;
    }
    const expected = currentDshUrl().replace(/\/+$/, '');
    const actual = String(status.dshBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (!actual) return '桥接是旧版本，无法报告 DSH 地址';
    if (expected && actual !== expected) return `桥接还连着旧 DSH（${actual} ≠ ${expected}）`;
    return '';
  }

  // 自动拉起桥接（默认关；用户可在设置里开）。
  // 2026-10-22：除了启动时检查一次，再加一个 2 分钟自愈轮询 ——
  // DSH 重启后端口会变，桥接如果还连着旧端口，下一次轮询会自动重启它（而不是等用户发现）。
  let bridgeRepairBusy = false;
  let bridgeRepairTimer = null;
  const maybeAutoStartBridge = async () => {
    if (bridgeRepairBusy) return;
    bridgeRepairBusy = true;
    try {
      if (process.env.SURFCORE_SKIP_AUTOSTART === '1') return;
      // 新开关是唯一真相；旧 bridge.autoStart 已由 readUnified() 迁移，不再直接读。
      if (!platformStartEnabled('qq')) return;
      const status = await bridgeStatus();
      if (status.running) {
        const stale = bridgeStaleReason(status);
        if (stale) {
          pluginLog(`autoStartBridge：${stale}，自动重启`);
          const restarted = await restartBridge({ dshWebUrl: currentDshUrl() });
          pluginLog('autoStartBridge 重启结果：', restarted.message || restarted.error || '');
        }
        return;
      }
      pluginLog('autoStartBridge：桥接未运行，尝试启动');
      const result = await startBridge({ dshWebUrl: currentDshUrl() });
      pluginLog('autoStartBridge 结果：', result.message || result.error || '');
    } catch (error) {
      pluginLog('autoStartBridge 失败：', error?.message ?? error);
    } finally {
      bridgeRepairBusy = false;
    }
  };

  const disposers = [];
  function route(kind, pathname, handler) {
    disposers.push(ctx.webServer.register({
      kind,
      path: pathname,
      handler: async (req, res) => {
        if (!isLoopbackReq(req)) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return; }
        if (req.method !== 'GET' && !sameOrigin(req)) { json(res, 403, { ok: false, error: '跨站请求被拒绝' }); return; }
        if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
          json(res, 415, { ok: false, error: '写操作必须是 application/json' });
          return;
        }
        try {
          const conn = ctx.get('connection');
          if (conn && typeof conn.requestRejection === 'function') {
            const code = conn.requestRejection(req);
            if (code !== undefined && code !== null && code !== false) {
              res.statusCode = typeof code === 'number' ? code : 403;
              res.end();
              return;
            }
          }
          await handler(req, res);
        } catch (error) {
          pluginLog('API 失败：', error?.message ?? error);
          try { json(res, 500, { ok: false, error: String(error?.message ?? error) }); } catch {}
        }
      },
    }));
  }

  // ── 概览 ────────────────────────────────────────────────────────────────
  async function overview() {
    const all = readAll();
    const snow = readQqConfig().config?.snowluma ?? {};
    const [bridge, bili, memory] = await Promise.all([
      bridgeStatus().catch((error) => ({ ok: false, error: String(error?.message ?? error) })),
      Promise.resolve(biliToQqStatus()),
      Promise.resolve(memoryStatus()),
    ]);
    // SnowLuma 只报「未连接」没用：这里给出可执行的诊断（没启动 / 在登录页 / token 不对）。
    const snowDiag = await diagnoseSnowLuma(bridge?.snowluma ?? {}, { bridge }).catch(() => ({ state: 'unknown', hint: '' }));
    const personaText = readTextFile(resolvePersonaFile());
    const mode = parseModeState();
    let dshMode = null;
    try {
      const settings = ctx.get('settings');
      if (settings?.describe) {
        const rows = settings.describe({ redactSecrets: true });
        const row = rows.find((item) => item.ns === 'qq-mode');
        dshMode = unwrapSchemaValue(row?.value?.mode) ?? null;
      }
    } catch {}
    return {
      ok: true,
      version: VERSION,
      privacyPolicyVersion: PRIVACY_POLICY_VERSION,
      bridge,
      bili,
      memory,
      memoryCard: memoryCardStatusNow(),
      vectorMemory: vectorMemoryStatusNow(),
      admin: adminSummary(all.unified?.admin),
      alignment: alignStats(),
      platforms: platforms.list(),
      extensions: extensionHost.describe(),
      // 平台启动开关：设置页顶部状态点、概览三按钮的可用性都读它。
      platformStart: platformStartState(),
      // 组件更新：概览「更新」卡与启动弹窗都读它（检查结果是缓存的，不在这里触发网络）。
      updates: updates.status(),
      scheduler: schedulerStatus,
      launch: await launchStatus(),
      snowluma: {
        launcherPath: String(snow.launcherPath ?? ''),
        allowLaunch: snow.allowLaunch === true,
        downloadUrl: String(snow.downloadUrl ?? 'https://github.com/SnowLuma/SnowLuma/releases/latest'),
        detected: findSnowLumaInstall().ok,
        everConnected: bridge?.snowluma?.everConnected === true,
        diagnosis: snowDiag,
      },
      mode: {
        local: mode.localMode,
        dsh: dshMode,
        effective: dshMode || mode.localMode,
        role: mode.localRole,
        ownerQQ: all.qq?.ownerQQ ?? null,
        allowGroups: all.qq?.allow?.groups?.length ?? 0,
        allowPrivate: all.qq?.allow?.private?.length ?? 0,
      },
      persona: {
        path: resolvePersonaFile(),
        exists: Boolean(personaText),
        chars: personaText.length,
        mtime: mtimeIso(resolvePersonaFile()),
      },
      character: (() => {
        const cur = readCurrentCharacter();
        return cur ? { id: cur.id, name: cur.name, epoch: cur.epoch, switchedAt: cur.switchedAt } : null;
      })(),
      paths: { ...pathSummary(), ...memory.paths, backupDir: BACKUP_DIR },
      files: {
        pluginLog: fileInfo(PLUGIN_LOG),
        qqConfig: fileInfo(QQ_CONFIG),
        biliConfig: fileInfo(BILI_CONFIG),
        alignment: fileInfo(ALIGN_FILE),
        qqForBili: fileInfo(activeMemoryPaths().qqForBili),
      },
    };
  }

  // ── 配置读写 ────────────────────────────────────────────────────────────
  async function handleConfig(req, res) {
    if (req.method === 'GET') {
      json(res, 200, {
        ok: true, ...readAll(), paths: pathSummary(), backups: listBackups(20),
        // 保存时回传这些戳：服务端据此判断"加载之后配置有没有被别处改过"
        stamps: {
          qq: fileStamp(QQ_CONFIG),
          bili: fileStamp(BILI_CONFIG),
          unified: fileStamp(path.join(STATE_DIR, 'config.json')),
        },
      });
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    // 乐观并发：设置页加载后，如果配置被控制台/别的窗口改过，这里拒绝整份回写，
    // 否则会把别人的修改覆盖掉（2026-10-29：语音开关"自己回弹"）。
    const baseStamp = body?.baseStamp && typeof body.baseStamp === 'object' ? body.baseStamp : null;
    const currentStamps = {
      qq: fileStamp(QQ_CONFIG),
      bili: fileStamp(BILI_CONFIG),
      unified: fileStamp(path.join(STATE_DIR, 'config.json')),
    };
    if (baseStamp) {
      const stale = ['qq', 'bili', 'unified'].filter((k) => isStale(baseStamp[k], currentStamps[k]));
      if (stale.length) {
        json(res, 409, {
          ok: false, code: 'CONFIG_STALE',
          error: `配置已被别处修改（${stale.join(' / ')}），本次保存未执行`,
          hint: '点「重新读取」拿到最新配置后再改；直接覆盖会丢掉别人的修改',
          stamps: currentStamps,
        });
        return;
      }
    }
    const result = { ok: true, saved: {}, warnings: [], notes: [] };
    // ── 管理员：QQ ⇄ B站 默认是同一个人 ────────────────────────────────────
    // 合体层 admin 是唯一真相；旧格式（qq.ownerQQ / bili.owner）是投影。
    // 合并逻辑放在 src/admin-identity.js 的 projectAdminSave（纯函数，有单测），
    // 这里只负责把结果写回三份文件，避免「只改了一边」。
    // 管理员 B站 UID：显式拒绝非法值，别静默清空（用户会以为"填不进去"）
    const rawAdminMid = String(body?.unified?.admin?.biliMid ?? '').trim();
    if (rawAdminMid && !/^\d{4,20}$/.test(rawAdminMid)) {
      json(res, 400, {
        ok: false, code: 'admin.mid-invalid',
        error: `管理员 B站 UID「${rawAdminMid}」不合法`,
        hint: 'B站 UID 是 4~20 位数字（个人空间地址 space.bilibili.com/<数字>）；不要带字母或空格',
      });
      return;
    }

    const currentQq = readQqConfig().config;
    const currentBili = readBiliConfig().config;
    const currentUnifiedState = readUnified();
    const beforePlatformStart = platformStartState();
    // 合并默认值后 admin 永远存在（默认空串）；只有用户文件里明确写过才当"显式清空"，
    // 否则会把旧字段 ownerQQ / owner.mid 当成没配置，保存时把两边投影抹掉。
    const currentUnified = currentUnifiedState.hasAdmin
      ? currentUnifiedState.config
      : { ...currentUnifiedState.config, admin: undefined };
    const currentAdmin = adminFromSources({ unified: currentUnified, qq: currentQq, bili: currentBili });
    const planned = projectAdminSave({ current: currentAdmin, qq: body.qq, bili: body.bili, unified: body.unified });
    if (planned.conflict) {
      result.warnings.push('管理员卡片与高级参数同时改了 ownerQQ / owner.mid：已按管理员卡片对齐，两边会同时写成同一个人。');
    }
    body.qq = planned.qq;
    body.bili = planned.bili;
    body.unified = planned.unified;
    if (body.qq && typeof body.qq === 'object') {
      if (body.qq.allow && typeof body.qq.allow === 'object') {
        const ownerForAllow = planned.unified?.admin?.qq || readQqConfig().config?.ownerQQ || '';
        const { allow, warnings } = normalizeAllowlist({ allow: body.qq.allow, ownerQQ: ownerForAllow });
        body.qq.allow = allow;
        for (const w of warnings) result.warnings.push(`白名单：${w.message}`);
      }
      const saved = saveQqConfig(body.qq);
      result.saved.qq = true;
      result.qq = saved.config;
      result.qqBackup = saved.backup;
      result.notes.push('QQ 配置已保存；桥接只在启动时读 config.json，需要「重启桥接」才会生效。');
    }
    if (body.bili && typeof body.bili === 'object') {
      const saved = saveBiliConfig(body.bili);
      result.saved.bili = true;
      result.bili = saved.config;
      result.biliBackup = saved.backup;
      if (Array.isArray(saved.warnings) && saved.warnings.length) result.warnings.push(...saved.warnings);
      result.notes.push('B站配置已保存；生物钟每轮重读配置，下一轮即生效。');
    }
    // 角色名校验：tts.character 必须是 [voice.characters] 里的名字，不能填音色 id。
    const incomingCharacter = body?.unified?.socialV2?.voice?.tts?.character;
    if (typeof incomingCharacter === 'string' && incomingCharacter.trim()) {
      const packsDir = path.resolve(String(currentQq?.voicePacks?.dir || path.join(QQBOT_ROOT, 'state', 'voice-packs')));
      const { characters } = readPackCharacters(packsDir);
      const verdict = validateCharacter(incomingCharacter, characters);
      if (!verdict.ok) {
        json(res, 400, { ok: false, error: verdict.reason, characters: verdict.characters });
        return;
      }
    }
    if (body.unified && typeof body.unified === 'object') {
      const saved = saveUnified(body.unified);
      result.saved.unified = true;
      result.unified = saved.config;
    }
    if (result.saved.unified) {
      // 切了语音路由就要当场告诉用户"目标服务没起"（否则现象是"切了没反应"）。
      try {
        const tts = readUnified().config?.socialV2?.voice?.tts ?? {};
        if (tts.enabled) {
          const need = tts.route === 'cloud' ? { port: 8767, label: '云端语音包' } : { port: 9880, label: 'GPT-SoVITS（本地音色）' };
          if (!(await portOpen(need.port, 800))) {
            result.warnings.push(`语音路由已切到「${tts.route === 'cloud' ? '云端' : '本地'}」，但 ${need.label}（${need.port}）没在监听：发语音会失败。`);
          }
        }
      } catch {}
      try { writeAlignmentBriefs(); } catch (error) { result.warnings.push(`对齐简报重建失败：${error?.message ?? error}`); }
      try { scheduler?.invalidate?.(); } catch {}
      startSyncTimer();
      // 改了记忆卡容量/注入上限后立刻重渲染，避免「设置保存了但提示词还是旧的」。
      try {
        const memoryCard = await runMemoryCardMaintenance({ config: readUnified().config.memoryCard });
        result.memoryCard = { status: memoryCard.status, changed: memoryCard.changed };
      } catch (error) {
        result.warnings.push(`记忆卡重渲染失败：${error?.message ?? error}`);
      }
      if (readUnified().config.memory?.qqToBili?.enabled === true) {
        try { result.qqMemory = syncQqToBili(); } catch (error) { result.warnings.push(`QQ→B站 同步失败：${error?.message ?? error}`); }
      }
    }
    // 平台启动开关的副作用：保存即生效（不是等下次重启）。
    // 用户关掉哪一边，就把正在跑的那一边停掉；重新打开则拉起来。
    // 这是「是否启动」和「只是改个参数」的区别，不能只写文件不执行。
    // 目的载体同理：切到桌宠后桥接下一次 tick 就不再自动出发（30 秒内生效），
    // 桌宠那边由 petPurpose 接手；不用重启桥接。
    if (result.saved.qq || result.saved.unified) {
      const afterCarrier = readQqConfig().config?.purpose?.carrier === 'pet' ? 'pet' : 'qq';
      const beforeCarrier = currentQq?.purpose?.carrier === 'pet' ? 'pet' : 'qq';
      result.purposeCarrier = afterCarrier;
      if (afterCarrier !== beforeCarrier) {
        result.warnings.push(afterCarrier === 'pet'
          ? '目的载体已切到「桌宠」：QQ 桥接不再自动主动搭话，改由桌宠气泡/语音发出（30 秒内生效，不用重启桥接）。'
          : '目的载体已切回「QQ」：桌宠不再主动搭话，改由桥接私聊你（30 秒内生效）。');
      }
    }
    const afterPlatformStart = platformStartState();
    result.platformStart = afterPlatformStart;
    if (result.saved.unified && process.env.SURFCORE_SKIP_AUTOSTART !== '1') {
      if (!afterPlatformStart.bili && beforePlatformStart.bili) {
        // 用 retire 而不是 stop：除了清定时器，还取消当前在途的 DSH 回合，
        // 否则关掉开关后她这一轮仍可能把消息发出去（见 PITFALLS #62）。
        try { await scheduler?.retire?.(); } catch (error) { result.warnings.push(`取消 B站 在途回合失败：${error?.message ?? error}`); }
        scheduler = null;
        schedulerStatus = idleSchedulerStatus('disabled');
        result.scheduler = schedulerStatus;
        result.warnings.push('B站 启动开关已关闭：生物钟已停止。');
      } else if (afterPlatformStart.bili && !beforePlatformStart.bili) {
        result.scheduler = startSchedulerNow();
        result.warnings.push(result.scheduler.running
          ? 'B站 启动开关已打开：生物钟已启动。'
          : 'B站 启动开关已打开，但生物钟启动失败（看插件日志）。');
      }
      if (!afterPlatformStart.qq && beforePlatformStart.qq) {
        const stopped = await stopBridge();
        // 不要写 result.bridge：前端把它当成「已重启」并显示错误提示；启停单独记。
        result.bridgeStop = stopped;
        result.warnings.push(stopped.ok
          ? 'QQ 启动开关已关闭：QQ 桥接已停止。'
          : `QQ 启动开关已关闭，但桥接没停下来：${stopped.error ?? stopped.message ?? '未知'}`);
      } else if (afterPlatformStart.qq && !beforePlatformStart.qq && body.restartBridge !== true) {
        const started = await startBridge({ dshWebUrl: currentDshUrl() });
        result.bridgeStart = started;
        result.warnings.push(started.ok
          ? 'QQ 启动开关已打开：QQ 桥接已启动。'
          : `QQ 启动开关已打开，但桥接启动失败：${started.error ?? started.message ?? '未知'}`);
      }
    }
    // 关闭管理员温柔模式并选择“丢弃上下文”：保存配置后先退役 QQ 会话/社交上下文，再重启桥接。
    // 顺序很重要：先 reset 再 restart，否则新会话会带着旧 cfg 建出来。
    if (body.resetSessions === true) {
      const bridgeNow = await bridgeStatus().catch(() => ({ running: false }));
      if (bridgeNow?.running) {
        try {
          await stopAllBridgeSessions();
          result.sessionsReset = true;
        } catch (error) {
          result.warnings.push(`重置 QQ 会话上下文失败：${error?.message ?? error}`);
        }
      } else {
        result.warnings.push('QQ 桥接未运行：没有可重置的 QQ 会话上下文。');
      }
      try {
        const biliReset = await resetBiliSchedulerSession();
        if (biliReset.reset) result.biliSessionsReset = true;
      } catch (error) {
        result.warnings.push(`重置 B站 会话上下文失败：${error?.message ?? error}`);
      }
    }
    if (body.restartBridge === true || body.resetSessions === true) {
      // 开关关掉时不允许「保存并重启」把 QQ 又拉起来；否则用户刚关的开关会被绕过。
      if (!platformStartEnabled('qq')) {
        result.warnings.push('QQ 启动开关已关闭：已跳过「保存并重启 QQ 桥接」。');
      } else {
        const restart = await restartBridge({ dshWebUrl: currentDshUrl() });
        result.bridge = restart;
        if (!restart.ok) result.warnings.push(`桥接重启失败：${restart.error ?? restart.message ?? '未知'}`);
      }
    }
    // 保存成功后把新的版本戳一并返回：否则前端仍拿加载时的旧戳，
    // 下一次保存会被自己的第一次写盘判成 CONFIG_STALE（issue #40）。
    result.stamps = {
      qq: fileStamp(QQ_CONFIG),
      bili: fileStamp(BILI_CONFIG),
      unified: fileStamp(path.join(STATE_DIR, 'config.json')),
    };
    json(res, 200, result);
  }

  // ── 角色人格 ────────────────────────────────────────────────────────────
  async function handleCharacters(req, res, url) {
    if (req.method === 'GET') {
      const id = String(url.searchParams.get('id') ?? '').trim();
      try {
        json(res, 200, id ? characterDetail(id) : { ...characterOverview(), migration: characterMigration });
      } catch (error) {
        json(res, 404, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }
    let body = {};
    try { body = JSON.parse(await readBody(req, 16 * 1024 * 1024) || '{}'); } catch { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return; }
    const action = String(body.action ?? '');
    const id = String(body.id ?? readCurrentCharacter()?.id ?? '').trim();
    try {
      if (action === 'create') {
        const created = createCharacterFromPayload(body);
        if (body.load === true) {
          const switched = await switchCharacterEverywhere(created.character.id);
          json(res, 200, { ok: true, created, switched });
        } else {
          json(res, 200, created);
        }
        return;
      }
      if (action === 'load') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, await switchCharacterEverywhere(id));
        return;
      }
      if (action === 'update') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, updateCharacterFromPayload(id, body));
        return;
      }
      if (action === 'snapshot') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, manualSnapshot(id, { label: String(body.label ?? '') }));
        return;
      }
      if (action === 'auto-snapshot') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, autoSnapshot(id, { force: body.force === true }));
        return;
      }
      if (action === 'restore') {
        if (!id) throw new Error('缺少角色 id');
        const current = readCurrentCharacter();
        if (!current || current.id !== id) throw new Error('只能回档当前角色；先加载这个角色再回档');
        const skipPlatform = process.env.SURFCORE_DISABLE_PLATFORM_RESTART === '1';
        const wasRunning = skipPlatform ? false : (await bridgeStatus()).running;
        await memoryCardIdle();
    await vectorMemoryIdle();
        if (!skipPlatform && scheduler?.retire) await scheduler.retire();
        scheduler = null;
        schedulerStatus = { running: false, startedAt: null, lastError: null, lastTickAt: null };
        if (wasRunning) {
          await stopAllBridgeSessions();
          const stopped = await stopBridge();
          if (!stopped.ok) {
            if (!skipPlatform) startSchedulerNow();
            throw new Error(`回档失败：QQ 桥接没停下来（${stopped.error || stopped.message || '未知原因'}）`);
          }
        }
        const restored = restoreCharacterSnapshot(id, String(body.slot ?? ''));
        writeCharacterRolePointer();
        archiveBridgeRuntimeState();
        await runMemoryCardMaintenance({}).catch((error) => pluginLog('回档后整理记忆卡失败：', error?.message ?? error));
        if (wasRunning) await startBridge({ dshWebUrl: currentDshUrl() });
        if (!skipPlatform) startSchedulerNow();
        json(res, 200, { ...restored, bridgeRestarted: wasRunning, scheduler: schedulerStatus });
        return;
      }
      if (action === 'migrate') {
        json(res, 200, ensureCharacterSystem());
        return;
      }
      if (action === 'delete') {
        if (!id) throw new Error('缺少角色 id');
        json(res, 200, deleteCharacter(id));
        return;
      }
      json(res, 400, { ok: false, error: `未知 action：${action}` });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 人设卡 ──────────────────────────────────────────────────────────────
  async function handleGroupPolicy(req, res) {
    try {
      if (req.method === 'GET') {
        const r = await callBridge('/api/socialV2/group-policy');
        if (!r.ok) {
          json(res, 502, { ok: false, code: 'GROUP_POLICY_BRIDGE', error: r.error || '桥接不可用', hint: '先启动 QQ 桥接，再刷新设置页' });
          return;
        }
        json(res, 200, r.data);
        return;
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        const r = await callBridge('/api/socialV2/group-policy', { method: 'POST', body });
        if (!r.ok) {
          json(res, 502, { ok: false, code: 'GROUP_POLICY_SAVE', error: r.error || '保存失败', hint: '检查桥接是否运行，再重试' });
          return;
        }
        json(res, 200, r.data);
        return;
      }
      json(res, 405, { ok: false, code: 'GROUP_POLICY_METHOD', error: '只支持 GET/POST' });
    } catch (error) {
      json(res, 400, { ok: false, code: 'GROUP_POLICY_FAILED', error: String(error?.message ?? error), hint: '检查桥接与配置' });
    }
  }

  async function handlePersonaClassify(req, res) {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, code: 'PERSONA_CLASSIFY_METHOD', error: '只支持 POST', hint: '用角色页的「智能拆分」按钮' });
      return;
    }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const text = String(body.text ?? '');
      const drafts = await personaClassifier.classify(text);
      drafts.daily = withDailyIdentity(drafts.daily);
      json(res, 200, { ok: true, drafts, note: '这是草稿；请检查/编辑后逐层保存。' });
    } catch (error) {
      const code = String(error?.code || 'PERSONA_CLASSIFY_FAILED');
      const message = String(error?.message ?? error);
      const unavailable = code.includes('UNAVAILABLE') || code.includes('NO_MODEL');
      const internal = error instanceof ReferenceError || /is not defined|is not a function|Cannot read|undefined is not/i.test(message);
      const hint = internal
        ? '这是插件内部错误，不是人格卡内容问题；请把错误码/报错发给作者，或手动填写各层'
        : code === 'PERSONA_CLASSIFY_EMPTY_INPUT'
          ? '先写一点人格内容（核心/语气/日常/场景）再拆分'
          : code === 'PERSONA_CLASSIFY_TOO_LARGE'
            ? '人格卡超过 64KB，先精简或手动分层'
            : code === 'PERSONA_CLASSIFY_BAD_JSON'
              ? '模型输出不是可解析的 JSON；可以重试，或手动填写各层'
              : unavailable
                ? '确认 DSH 模型服务已就绪；也可以手动填写各层'
                : '检查人格卡内容，或手动填写各层';
      json(res, 400, {
        ok: false,
        code: internal ? 'PERSONA_CLASSIFY_INTERNAL' : code,
        error: internal ? `人格拆分内部错误：${message}` : message,
        hint,
      });
    }
  }

  function personaIdentityLine() {
    const cur = readCurrentCharacter();
    const name = String(cur?.name || '').trim() || '这个角色';
    let admin = {};
    try {
      const unified = readUnified();
      const qq = readQqConfig();
      admin = adminSummary(unified?.config?.admin ?? qq?.config?.admin);
    } catch {}
    const owner = String(admin?.displayName || '').trim() || '主人';
    return `你是${name}；你的主人是${owner}。`;
  }

  function withDailyIdentity(text, identity = personaIdentityLine()) {
    const body = String(text ?? '').trim();
    if (!body) return identity;
    if (body.includes(identity)) return body;
    // 已有明确“我是谁/主人是谁”的旧日常也保留，不重复堆。
    if (/你是|我是/.test(body) && /主人/.test(body)) return body;
    return `${identity}

${body}`;
  }

  async function handleLimitMute(req, res) {
    if (req.method !== 'POST') { json(res, 405, { ok: false, code: 'LIMIT_MUTE_METHOD', error: '只支持 POST' }); return; }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const r = await callBridge('/api/socialV2/limit-mute', { method: 'POST', body });
      if (!r.ok) { json(res, 502, { ok: false, code: 'LIMIT_MUTE_BRIDGE', error: r.error || '桥接不可用', hint: '先启动/重启 QQ 桥接' }); return; }
      json(res, 200, r.data);
    } catch (error) {
      json(res, 400, { ok: false, code: 'LIMIT_MUTE_FAILED', error: String(error?.message ?? error), hint: '刷新错误报告后重试' });
    }
  }

  async function handlePersona(req, res) {
    const layerPaths = () => {
      const layers = activePersonaLayers();
      return layers ? {
        core: layers.core || resolvePersonaFile(),
        full: layers.full || path.join(path.dirname(layers.core || resolvePersonaFile()), 'persona.full.md'),
        daily: layers.daily,
        tone: layers.tone,
        scenes: layers.scenes,
        scenesDir: layers.scenesDir,
      } : { core: resolvePersonaFile(), full: path.join(path.dirname(resolvePersonaFile()), 'persona.full.md'), daily: '', tone: '', scenes: {}, scenesDir: '' };
    };
    const sceneLabels = { 'qq-group': 'QQ 群聊', 'qq-private': 'QQ 私聊', bili: 'B站', pet: '桌宠' };
    if (req.method === 'GET') {
      const paths = layerPaths();
      const core = readTextFile(paths.core);
      const daily = paths.daily ? withDailyIdentity(readTextFile(paths.daily)) : withDailyIdentity('');
      const scenes = {};
      for (const [id, file] of Object.entries(paths.scenes || {})) {
        scenes[id] = { path: file, text: readTextFile(file), chars: readTextFile(file).length };
      }
      const backups = listBackups(120).filter((item) => /^persona(?:-|$)/.test(item.name));
      json(res, 200, {
        ok: true,
        path: paths.core,
        text: core,
        chars: core.length,
        mtime: mtimeIso(paths.core),
        layers: {
          core: { path: paths.core, text: core, chars: core.length },
          full: { path: paths.full, text: readTextFile(paths.full) || core, chars: (readTextFile(paths.full) || core).length },
          tone: { path: paths.tone, text: readTextFile(paths.tone), chars: readTextFile(paths.tone).length },
          daily: { path: paths.daily, text: daily, chars: daily.length },
          scenes,
        },
        sceneLabels,
        backups,
        note: '人格卡分层：persona.md 是核心；persona.tone.md 是语气；persona.daily.md 是日常；persona.scenes/* 是场景。所有层都手动编辑，不会自动改写。',
      });
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    if (body.action === 'restore') {
      const name = safeBackupName(body.name);
      if (!name) { json(res, 400, { ok: false, error: '备份名非法' }); return; }
      const source = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(source)) { json(res, 404, { ok: false, code: 'PERSONA_BACKUP_MISSING', error: '备份不存在', hint: '刷新备份列表后重试' }); return; }
      const paths = layerPaths();
      let target = paths.core;
      let label = 'persona';
      if (name.startsWith('persona-daily-')) { target = paths.daily; label = 'persona-daily'; }
      else if (name.startsWith('persona-full-')) { target = paths.full; label = 'persona-full'; }
      else if (name.startsWith('persona-tone-')) { target = paths.tone; label = 'persona-tone'; }
      else if (name.startsWith('persona-scene-')) {
        const scene = Object.keys(sceneLabels).find((id) => name.startsWith(`persona-scene-${id}-`));
        if (!scene) { json(res, 400, { ok: false, code: 'PERSONA_SCENE_UNKNOWN', error: '备份对应的场景未知', hint: '检查备份文件名' }); return; }
        target = paths.scenes?.[scene] || '';
        label = `persona-scene-${scene}`;
      }
      if (!target) { json(res, 400, { ok: false, code: 'PERSONA_LAYER_UNAVAILABLE', error: '这个层在当前角色里没有路径（可能未启用角色系统）', hint: '先创建/加载角色' }); return; }
      backupFile(target, label);
      fs.copyFileSync(source, target);
      const cur = readCurrentCharacter();
      if (cur) touchCharacter(cur.id);
      json(res, 200, { ok: true, restored: name, target, text: readTextFile(target), layers: layerPaths() });
      return;
    }
    const layer = String(body.layer || 'core');
    const scene = String(body.scene || '');
    const paths = layerPaths();
    let target = paths.core;
    let label = 'persona';
    if (layer === 'full') {
      target = paths.full;
      label = 'persona-full';
    } else if (layer === 'tone') {
      target = paths.tone;
      label = 'persona-tone';
    } else if (layer === 'daily') {
      target = paths.daily;
      label = 'persona-daily';
    } else if (layer === 'scene') {
      if (!sceneLabels[scene]) { json(res, 400, { ok: false, code: 'PERSONA_SCENE_UNKNOWN', error: `未知场景：${scene}`, hint: '只支持 qq-group / qq-private / bili / pet' }); return; }
      target = paths.scenes?.[scene] || '';
      label = `persona-scene-${scene}`;
    }
    if (!target) {
      json(res, 400, { ok: false, code: 'PERSONA_LAYER_UNAVAILABLE', error: '这个层在当前角色里没有路径（可能未启用角色系统）', hint: '先创建/加载角色' });
      return;
    }
    const text = String(body.text ?? '');
    if ((layer === 'core' || layer === 'full') && text.length < 50) { json(res, 400, { ok: false, code: 'PERSONA_CORE_TOO_SHORT', error: '人格卡太短（至少 50 字）', hint: '整卡/核心是每次注入的底座，不能留空' }); return; }
    if (text.length > 64 * 1024) { json(res, 400, { ok: false, code: 'PERSONA_TOO_LARGE', error: '人格内容超过 64KB', hint: '拆成核心/场景/日常层，或精简内容' }); return; }
    const scan = scanText(text);
    const severe = scan.secrets.length > 0 || scan.pii.some((hit) => hit.severe);
    if (severe) {
      json(res, 400, {
        ok: false,
        code: 'PERSONA_SENSITIVE',
        error: '人格内容里命中密钥/密码/身份证/住址规则，拒绝保存',
        hint: '删掉这些内容后再保存；人格卡不应包含凭据',
        labels: [...new Set([...scan.secrets, ...scan.pii.filter((h) => h.severe)].map((h) => h.label))],
      });
      return;
    }
    const backup = backupFile(target, label);
        writeTextAtomic(target, text.endsWith('\n') ? text : `${text}\n`);
    const cur = readCurrentCharacter();
    if (cur) touchCharacter(cur.id);
    json(res, 200, { ok: true, layer, scene: layer === 'scene' ? scene : '', chars: text.length, backup, path: target, layers: layerPaths() });
  }

  // ── 记忆 ────────────────────────────────────────────────────────────────
  async function handleMemory(req, res, url) {
    if (req.method === 'GET') {
      const previewChars = Math.max(200, Math.min(20_000, Number(url.searchParams.get('chars')) || 4000));
      json(res, 200, {
        ok: true,
        status: memoryStatus(),
        qqPreview: previewQqForBili({ maxChars: previewChars }),
        biliPreview: biliToQqStatus().briefPreview,
        audit: auditTail(40),
        policyVersion: PRIVACY_POLICY_VERSION,
      });
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    if (body.action === 'sync') {
      const result = syncQqToBili({ force: true });
      json(res, 200, result);
      return;
    }
    if (body.action === 'refresh-bili') {
      const result = await refreshBiliToQq({ callBridge });
      json(res, 200, result);
      return;
    }
    if (body.action === 'scan-align') {
      const qq = scanQqFeedForCandidates({ maxMessages: 1200 });
      const bili = await scanBiliFeedForCandidates({ maxPages: 2 });
      json(res, 200, { ok: true, qq, bili });
      return;
    }
    if (body.action === 'rebuild') {
      json(res, 200, { ok: true, ...rebuildAllPrompts() });
      return;
    }
    if (body.action === 'purge') {
      const feed = path.join(QQ_STATE_DIR(), 'qq-public-feed.jsonl');
      backupFile(activeMemoryPaths().qqForBili, 'qq-memory-before-purge');
      for (const file of [feed, activeMemoryPaths().qqForBili, path.join(activeMemoryPaths().dir, 'sync-state.json')]) {
        try { fs.rmSync(file, { force: true }); } catch {}
      }
      json(res, 200, { ok: true, purged: [feed, activeMemoryPaths().qqForBili].map(maskPath), note: '已清空 QQ→B站 记忆与原始公开 feed；对齐表不受影响。' });
      return;
    }
    json(res, 400, { ok: false, error: '未知 action' });
  }

  // ── 记忆卡（角色的长期记忆）──────────────────────────────────────────────
  // 和上面的「双向脱敏同步」不是一回事：memory 是 QQ⇄B站 的搬运；
  // memory-card 是她自己的记忆（冲浪 + 聊天 + 主人互动），带清晰度/遗忘/容量规则。
  async function handleMemoryCard(req, res) {
    const config = readUnified().config.memoryCard;
    if (req.method === 'GET') {
      json(res, 200, memoryCardSnapshot(config));
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    const action = String(body.action ?? '');
    if (action === 'maintain') {
      const result = await runMemoryCardMaintenance({ forceDecay: body.forceDecay === true, config });
      const snapshot = memoryCardSnapshot(config);
      json(res, 200, { ...snapshot, changed: result.changed, addedBili: result.addedBili, addedQq: result.addedQq, addedPet: result.addedPet });
      return;
    }
    if (action === 'compact') {
      const result = await compactMemoryCardNow({ targetRatio: Number(body.targetRatio) || 0.8, config });
      json(res, 200, { ...memoryCardSnapshot(config), steps: result.steps });
      return;
    }
    if (action === 'restore') {
      const result = await restoreMemoryCardBackup(String(body.name ?? ''), { config });
      if (!result.ok) { json(res, 400, result); return; }
      json(res, 200, memoryCardSnapshot(config));
      return;
    }
    if (action === 'notify-test') {
      const result = await notifyOwnerIfNeeded({ callBridge, config });
      json(res, 200, result);
      return;
    }
    if (['pin', 'forget', 'ack', 'add', 'set-first-meet', 'clear-first-meet', 'merge-memories'].includes(action)) {
      const result = await applyMemoryCardAction(action, body, { config });
      if (!result.ok) { json(res, 400, result); return; }
      json(res, 200, memoryCardSnapshot(config));
      return;
    }
    json(res, 400, { ok: false, error: '未知 action' });
  }

  // ── 向量记忆（独立存储；与记忆卡并列）──────────────────────────────────
  async function handleVectorMemory(req, res) {
    const config = readUnified().config.vectorMemory;
    if (req.method === 'GET') {
      json(res, 200, vectorMemorySnapshot(config));
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    const action = String(body.action ?? '');
    if (action === 'maintain') {
      const result = await runVectorMemoryMaintenanceNow({ config });
      json(res, result.ok ? 200 : 500, { ...vectorMemorySnapshot(config), ...result });
      return;
    }
    if (action === 'rebuild') {
      const result = await rebuildVectorMemory(config);
      json(res, result.ok ? 200 : 500, { ...vectorMemorySnapshot(config), ...result });
      return;
    }
    if (action === 'rebuild-all') {
      const packsStatus = embeddingPacksStatus();
      const models = (packsStatus.models ?? []).filter((item) => item.valid && item.model && item.modelSpace);
      if (!models.length) {
        json(res, 400, { ok: false, code: 'vector.models-missing', error: '没有已安装的本地模型', hint: '先在 Embedding 功能里导入至少一个模型包' });
        return;
      }
      const missingIndexes = models.filter((item) => item.indexReady !== true);
      if (!missingIndexes.length) {
        json(res, 200, {
          ok: true,
          skipped: true,
          results: [],
          skippedModels: models.map((item) => item.model),
          status: vectorMemorySnapshot(config),
          message: '所有已安装模型都已有索引，不需要重建',
        });
        return;
      }
      if (!packsStatus.service?.ok) {
        const started = await startEmbeddingRuntime();
        if (!started.ok) {
          json(res, 400, { ok: false, ...started, hint: started.hint || '先启动 Embedding 运行时' });
          return;
        }
      }
      const registrations = await registerAllInstalledModels();
      const result = await rebuildAllVectorIndexes(config, missingIndexes);
      json(res, result.ok ? 200 : 500, { ...result, registrations, status: vectorMemorySnapshot(config) });
      return;
    }
    if (action === 'rebuild-selected') {
      const wanted = Array.isArray(body.models) ? body.models.map((item) => String(item)).filter(Boolean) : [];
      if (!wanted.length) {
        json(res, 400, { ok: false, code: 'vector.models-empty', error: '没有选择要重建的模型', hint: '至少勾选一个模型' });
        return;
      }
      const packsStatus = embeddingPacksStatus();
      const localModels = new Map((packsStatus.models ?? []).map((item) => [String(item.id), item]));
      const targets = [];
      for (const key of wanted) {
        if (key.startsWith('local:')) {
          const id = key.slice('local:'.length);
          const pack = localModels.get(id);
          if (!pack) { json(res, 400, { ok: false, code: 'vector.model-not-installed', error: `本地模型未安装：${id}`, hint: '先在 Embedding 功能导入模型' }); return; }
          targets.push({ kind: 'local', id, model: pack.model, modelSpace: pack.modelSpace });
        } else if (key.startsWith('cloud:')) {
          const id = key.slice('cloud:'.length);
          const profile = getCloudProviderProfile(id);
          if (!profile || !profile.endpoint || !profile.apiKey) {
            json(res, 400, { ok: false, code: 'vector.cloud-not-saved', error: `云端服务商未保存：${id}`, hint: '先在云端模型里保存 endpoint/model/space/key' });
            return;
          }
          targets.push({ kind: 'cloud', id, model: profile.model, modelSpace: profile.modelSpace, profile });
        }
      }
      if (targets.some((item) => item.kind === 'local') && !packsStatus.service?.ok) {
        const started = await startEmbeddingRuntime();
        if (!started.ok) {
          json(res, 400, { ok: false, ...started, hint: started.hint || '先启动 Embedding 运行时' });
          return;
        }
      }
      if (targets.some((item) => item.kind === 'local')) await registerAllInstalledModels();
      const results = [];
      for (const target of targets) {
        const targetConfig = target.kind === 'local'
          ? { ...config, provider: 'local', model: target.model, modelSpace: target.modelSpace, serviceUrl: '', token: '' }
          : { ...config, provider: 'cloud', model: target.model, modelSpace: target.modelSpace, cloudModel: target.model, cloudModelSpace: target.modelSpace, serviceUrl: target.profile.endpoint.replace(/\/embeddings\/?$/i, ''), token: target.profile.apiKey, discoveryFile: '' };
        const result = await rebuildVectorMemory(targetConfig);
        results.push({
          key: `${target.kind}:${target.id}`,
          kind: target.kind,
          id: target.id,
          model: target.model,
          modelSpace: target.modelSpace,
          ok: result.ok !== false,
          embedded: result.embedded ?? 0,
          rebuilt: result.rebuilt === true,
          indexed: result.status?.indexed ?? 0,
          pending: result.status?.pending ?? 0,
          error: result.error ?? '',
          hint: result.hint ?? '',
        });
      }
      json(res, results.every((item) => item.ok) ? 200 : 500, { ok: results.every((item) => item.ok), results, status: embeddingPacksStatus() });
      return;
    }
    if (action === 'library-list') {
      const result = listVectorMemoryRecords({ config, limit: body.limit, offset: body.offset });
      json(res, 200, result);
      return;
    }
    if (action === 'library-search') {
      const result = await searchVectorMemoryRecords({ config, query: body.query, limit: body.limit });
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    json(res, 400, { ok: false, code: 'request.invalid', error: '未知 action', hint: '可用：maintain / rebuild / rebuild-all / library-list / library-search' });
  }

  // ── Embedding 可选安装包（模型/运行时/云端）────────────────────────────
  async function handleEmbeddingPacks(req, res, url) {
    if (req.method === 'GET') {
      const jobId = String(url.searchParams.get('job') ?? '');
      if (jobId) {
        const job = getEmbeddingPackJob(jobId);
        if (!job) { json(res, 404, { ok: false, code: 'pack.job-missing', error: '安装任务不存在或已过期', hint: '刷新列表后重试' }); return; }
        json(res, 200, { ok: true, job });
        return;
      }
      json(res, 200, embeddingPacksStatus());
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    const action = String(body.action ?? '');
    if (action === 'open-share') {
      const result = openEmbeddingShare();
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (action === 'install') {
      const result = startEmbeddingPackInstall({
        source: String(body.path ?? body.source ?? ''), url: String(body.url ?? ''), overwrite: body.overwrite === true,
      });
      json(res, result.ok ? 202 : 400, result);
      return;
    }
    if (action === 'remove') {
      const result = removeEmbeddingPack(String(body.id ?? ''));
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (action === 'select') {
      const result = selectEmbeddingPack(String(body.id ?? ''));
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (action === 'start') {
      const result = await startEmbeddingRuntime();
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (action === 'stop') {
      const result = await stopEmbeddingRuntime();
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (action === 'test') {
      const result = await testEmbeddingPack();
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (action === 'save-cloud') {
      const result = saveCloudPackConfig(body);
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (action === 'activate-cloud') {
      const result = activateCloudProvider(body.provider);
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (action === 'refresh') {
      json(res, 200, embeddingPacksStatus());
      return;
    }
    json(res, 400, { ok: false, code: 'request.invalid', error: '未知 action', hint: '可用：install / remove / select / start / stop / test / save-cloud / refresh' });
  }

  // ── 全量记忆卡（只存档；不参与日常提示词）───────────────────────────────
  async function handleMemoryCardFull(req, res, url) {
    if (req.method !== 'GET') { json(res, 405, { ok: false, error: '只读接口' }); return; }
    const q = String(url.searchParams.get('q') ?? '');
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 40));
    json(res, 200, fullMemoryCardSnapshot({ q, limit, config: readUnified().config.memoryCard }));
  }

  // ── 身份对齐 ────────────────────────────────────────────────────────────
  async function handleAlign(req, res) {
    if (req.method === 'GET') {
      json(res, 200, {
        ok: true,
        labelsSupported: true,
        links: listLinks(),
        candidates: listCandidates(),
        stats: alignStats(),
        platforms: platforms.list(),
        briefs: {
          qqChars: readTextFile(QQ_ALIGNMENT_BRIEF).length,
          biliChars: readTextFile(BILI_ALIGNMENT_FILE).length,
        },
      });
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    const action = String(body.action ?? '');
    if (action === 'add') { json(res, 200, { ok: true, link: addLink(body.link ?? body) }); return; }
    if (action === 'update') { json(res, 200, { ok: true, link: updateLink(String(body.id), body.link ?? body.patch ?? {}) }); return; }
    if (action === 'remove') { json(res, 200, { ok: true, ...removeLink(String(body.id)) }); return; }
    if (action === 'approve') { json(res, 200, { ok: true, link: approveCandidate(String(body.id), body.overrides ?? {}) }); return; }
    if (action === 'reject') { json(res, 200, { ok: true, ...rejectCandidate(String(body.id)) }); return; }
    if (action === 'scan') {
      const qq = scanQqFeedForCandidates({ maxMessages: 1200 });
      const bili = await scanBiliFeedForCandidates({ maxPages: 2 });
      json(res, 200, { ok: true, qq, bili, candidates: listCandidates() });
      return;
    }
    if (action === 'import') { json(res, 200, { ok: true, state: importAlignments(body.payload ?? body.data, { merge: body.merge !== false }) }); return; }
    if (action === 'export') { json(res, 200, { ok: true, ...exportAlignments() }); return; }
    json(res, 400, { ok: false, error: '未知 action' });
  }

  // ── 模式 / ownerQQ ─────────────────────────────────────────────────────
  async function handleMode(req, res) {
    if (req.method === 'GET') {
      let dshSetting = null;
      try {
        const settings = ctx.get('settings');
        if (settings?.describe) {
          const rows = settings.describe({ redactSecrets: true });
          const row = rows.find((item) => item.ns === 'qq-mode');
          if (row) {
            const raw = row.value ?? {};
            dshSetting = {
              ...raw,
              mode: unwrapSchemaValue(raw.mode),
              ownerQQ: unwrapSchemaValue(raw.ownerQQ),
            };
          }
        }
      } catch {}
      json(res, 200, { ok: true, ...parseModeState(), dshSetting });
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    const mode = body.mode ? String(body.mode) : null;
    const ownerQQ = body.ownerQQ === undefined ? undefined : (body.ownerQQ === '' || body.ownerQQ === null ? null : String(body.ownerQQ));
    if (mode && !['chat', 'closed-agent', 'reserved', 'reserved2', 'simulation'].includes(mode)) {
      json(res, 400, { ok: false, error: 'mode 必须是 chat / closed-agent / reserved / reserved2 / simulation' });
      return;
    }
    const stateFile = path.join(QQ_STATE_DIR(), 'mode.json');
    const current = readJson(stateFile, {}) ?? {};
    const next = { ...current, ...(mode ? { mode } : {}) };
    writeJsonAtomic(stateFile, next);
    const settings = ctx.get('settings');
    if (settings?.update) {
      try {
        await settings.update('qq-mode', {
          ...(mode ? { mode } : {}),
          ...(ownerQQ !== undefined ? { ownerQQ: ownerQQ ?? '' } : {}),
        });
      } catch (error) {
        pluginLog('写 DSH qq-mode 设置失败（本地 mode.json 已写）：', error?.message ?? error);
      }
    }
    if (ownerQQ !== undefined) {
      const qq = readQqConfig().config;
      qq.ownerQQ = ownerQQ;
      saveQqConfig(qq);
    }
    if (mode) {
      try { await callBridge('/api/mode', { method: 'POST', body: { mode } }); } catch {}
    }
    json(res, 200, { ok: true, mode: mode ?? current.mode ?? null, ownerQQ: ownerQQ ?? null, note: '若桥接未运行，下次启动时生效。' });
  }

  // ── 扩展 ────────────────────────────────────────────────────────────────
  async function handleExtensions(req, res) {
    if (req.method === 'GET') {
      json(res, 200, { ok: true, extensions: extensionHost.describe(), platforms: platforms.list(), dir: EXTENSIONS_DIR });
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    const action = String(body.action ?? '');
    const id = String(body.id ?? '');
    if (action === 'toggle') { json(res, 200, { ok: true, result: await extensionHost.setEnabled(id, body.enabled === true), extensions: extensionHost.describe() }); return; }
    if (action === 'config') { json(res, 200, { ok: true, config: extensionHost.setConfig(id, body.config ?? {}) }); return; }
    if (action === 'reload') {
      await extensionHost.deactivate(id);
      const result = await extensionHost.activate(id);
      json(res, 200, { ok: true, result, extensions: extensionHost.describe() });
      return;
    }
    json(res, 400, { ok: false, error: '未知 action' });
  }

  // ── 诊断 / 备份 ─────────────────────────────────────────────────────────
  // ── 新手体检（只读）＋ 一键配置（只写"缺失项"，绝不覆盖已有值）────────────
  // 目标：新人装完点一下就知道"还差什么、在哪补"，不用去翻文档。
  function dshProfileWithSurfcore() {
    const root = path.join(DSH_HOME, 'profiles');
    let names = [];
    try { names = fs.readdirSync(root).filter((n) => { try { return fs.statSync(path.join(root, n)).isDirectory(); } catch { return false; } }); } catch { return ''; }
    for (const name of names) {
      // 两种都能作为"已装进 DSH"的证据：
      //   ① profile package.json 的 dsh.profile.bundles 里有 surfcore；
      //   ② cordis.patch.yml 里有我们托管的 mcp 条目（不同版本写的是不同 id）。
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, name, 'package.json'), 'utf8'));
        const bundles = pkg?.dsh?.profile?.bundles;
        if (Array.isArray(bundles) && bundles.includes('surfcore')) return name;
      } catch {}
      try {
        const patch = fs.readFileSync(path.join(root, name, 'cordis.patch.yml'), 'utf8');
        if (/surfcore|mcp-snowluma/.test(patch)) return name;
      } catch {}
    }
    return '';
  }

  async function installChecks(bridge = null) {
    const all = readAll();
    const qqCfg = readQqConfig().config ?? {};
    const snow = qqCfg.snowluma ?? {};
    let runtimeBridge = bridge;
    if (!runtimeBridge) {
      try { runtimeBridge = await bridgeStatus(); } catch { runtimeBridge = null; }
    }
    let snowState = { state: 'unknown', hint: '' };
    try { snowState = await diagnoseSnowLuma(runtimeBridge?.snowluma ?? {}, { bridge: runtimeBridge }); } catch {}
    const bridgeSrc = path.join(QQBOT_ROOT, 'src', 'bridge.js');
    return buildInstallChecks({
      nodeVersion: process.versions.node,
      hasUnified: readUnified().hasUserFile,
      unifiedMasked: maskPath(UNIFIED_FILE),
      ownerQQ: String(all.unified?.admin?.qq ?? '').trim(),
      groups: Array.isArray(qqCfg.allow?.groups) ? qqCfg.allow.groups : [],
      privates: Array.isArray(qqCfg.allow?.private) ? qqCfg.allow.private : [],
      snow,
      snowState,
      wakeGuard: runtimeBridge?.wakeGuard ?? null,
      bridgeSrc: fs.existsSync(bridgeSrc),
      bridgeMasked: maskPath(bridgeSrc),
      profile: dshProfileWithSurfcore(),
      token: String(qqCfg.consoleToken ?? '').trim(),
    });
  }

  let installJob = { running: false, startedAt: null, finishedAt: null, steps: [] };

  function installStep(key, name) {
    const step = { key, name, status: 'running', detail: '', at: new Date().toISOString() };
    installJob.steps.push(step);
    return step;
  }

  function runCommand(cmd, args, { cwd, timeoutMs = 600_000 } = {}) {
    return new Promise((resolve) => {
      const child = spawn(cmd, args, { cwd, windowsHide: true, shell: process.platform === 'win32' });
      let out = '';
      const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
      child.stdout?.on('data', (d) => { out += String(d).slice(0, 4000); });
      child.stderr?.on('data', (d) => { out += String(d).slice(0, 4000); });
      child.on('error', (error) => { clearTimeout(timer); resolve({ ok: false, out: String(error?.message ?? error) }); });
      child.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, out: out.trim() }); });
    });
  }

  async function runInstall(opts) {
    const done = (step, ok, detail = '') => { step.status = ok ? 'ok' : 'fail'; step.detail = String(detail).slice(0, 600); };
    try {
      // 1) 依赖
      const depsStep = installStep('deps', '安装依赖（npm install）');
      if (fs.existsSync(path.join(QQBOT_ROOT, 'node_modules', '.package-lock.json')) || fs.existsSync(path.join(QQBOT_ROOT, 'node_modules', 'express'))) {
        done(depsStep, true, '已经装过，跳过');
      } else {
        const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
        const r = await runCommand(npm, ['install', '--no-audit', '--no-fund'], { cwd: QQBOT_ROOT, timeoutMs: 900_000 });
        done(depsStep, r.ok, r.ok ? '完成' : (r.out.slice(-400)));
        if (!r.ok) throw new Error('依赖安装失败');
      }

      // 2) 装进 DSH
      const dshStep = installStep('dsh', '装进 DSH（预设 / MCP / bundle）');
      if (dshProfileWithSurfcore()) {
        done(dshStep, true, '已注册，跳过');
      } else {
        // profile 必须跟着"当前 DSH 用的那个"走：setup-dsh 默认写 web，
        // 而用户可能是 desktop/自定义 profile —— 写错地方插件根本不会出现。
        let profile = String(process.env.DSH_PROFILE ?? '').trim();
        if (!profile) {
          try {
            const names = fs.readdirSync(path.join(DSH_HOME, 'profiles')).filter((n) => fs.statSync(path.join(DSH_HOME, 'profiles', n)).isDirectory() && !n.includes('.'));
            profile = names.includes('web') ? 'web' : (names[0] ?? 'web');
          } catch { profile = 'web'; }
        }
        const r = await runCommand(process.execPath, [path.join(QQBOT_ROOT, 'scripts', 'setup-dsh.mjs'), profile], { cwd: QQBOT_ROOT, timeoutMs: 120_000 });
        done(dshStep, r.ok, r.ok ? '已注册（重启 DSH 生效）' : (r.out.slice(-400)));
      }

      // 3) 配置与令牌
      const cfgStep = installStep('config', '生成配置 / 控制台令牌');
      const changed = doctorFix({ ownerQQ: opts.ownerQQ });
      done(cfgStep, true, changed.length ? changed.join('、') : '已经齐了');

      // 4) SnowLuma 端点 / token
      const snowStep = installStep('snowluma', '发现并写入 SnowLuma 连接');
      try {
        const found = await discoverSnowLumaConnection({ cfg: readQqConfig().config ?? {}, timeoutMs: 4000 });
        if (found.ok) {
          const snow = { httpUrl: found.baseUrl };
          if (found.wsUrl) snow.wsUrl = found.wsUrl;
          if (found.token) snow.accessToken = found.token;
          saveQqConfig({ snowluma: snow });
          done(snowStep, true, `已连上 ${found.self?.nickname ?? ''}（${found.self?.user_id ?? ''}）`);
        } else {
          done(snowStep, false, String(found.error ?? '没连上：先启动 SnowLuma 并扫码登录'));
        }
      } catch (error) { done(snowStep, false, String(error?.message ?? error)); }

      // 5) 主人 + 白名单
      const idStep = installStep('identity', '写入主人 QQ 与白名单');
      if (opts.groups.length) {
        // 保留用户已有私聊白名单，只追加主人（2026-10-31：以前 [owner] 整体替换会冲掉用户加的人）
        const { allow, warnings } = normalizeAllowlist({
          allow: { ...(readQqConfig().config?.allow ?? {}), groups: opts.groups },
          ownerQQ: opts.ownerQQ,
        });
        saveQqConfig({ allow });
        for (const w of warnings) pluginLog(`[安装] 白名单：${w.code} ${w.message}`);
        done(idStep, true, `${opts.groups.length} 个群${opts.ownerQQ ? ' + 主人私聊' : ''}${warnings.length ? `（${warnings.length} 条修正）` : ''}`);
      } else {
        done(idStep, true, '没选群，跳过（之后在设置 → QQ → 白名单里加）');
      }

      // 6) 可选：语音包 / 桌宠（只报告状态，不自动下 GB 级内容）
      const optStep = installStep('optional', '可选组件（语音包 / 桌宠）');
      const voiceDir = path.join(STATE_DIR, 'voice-packs');
      const voiceInstalled = fs.existsSync(voiceDir) && fs.readdirSync(voiceDir).length > 0;
      done(optStep, true, voiceInstalled ? '语音包已存在' : '未装（体积大，需要时按 INSTALL.md §7 单独装）');

      // 7) 起桥接
      const bridgeStep = installStep('bridge', '启动 QQ 桥接');
      try {
        const before = await bridgeStatus().catch(() => ({ running: false }));
        if (before.running) done(bridgeStep, true, `已在运行（端口 ${before.port}）`);
        else {
          await startBridge({ dshWebUrl: currentDshUrl() });
          done(bridgeStep, true, '已启动');
        }
      } catch (error) { done(bridgeStep, false, String(error?.message ?? error)); }
    } catch (error) {
      const last = installJob.steps[installJob.steps.length - 1];
      if (last && last.status === 'running') { last.status = 'fail'; last.detail = String(error?.message ?? error); }
    } finally {
      installJob.running = false;
      installJob.finishedAt = new Date().toISOString();
    }
  }

  function doctorFix(body) {
    const all = readAll();
    const qqCfg = readQqConfig().config ?? {};
    const actions = planDoctorFix({
      hasUnified: readUnified().hasUserFile,
      hasToken: Boolean(String(qqCfg.consoleToken ?? '').trim()),
      ownerQQ: body?.ownerQQ,
      currentOwnerQQ: all.unified?.admin?.qq,
    });
    for (const action of actions) {
      if (action.startsWith('生成统一配置')) saveUnified({});
      else if (action.startsWith('生成控制台令牌')) saveQqConfig({ consoleToken: randomUUID().replace(/-/g, '') });
      else if (action.startsWith('写入管理员 QQ')) saveUnified({ admin: { qq: String(body.ownerQQ).trim() } });
    }
    return actions;
  }

  async function handleDiagnostics(req, res) {
    if (req.method === 'GET') {
      const checks = [];
      const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });
      add('插件目录', fs.existsSync(PLUGIN_ROOT), PLUGIN_ROOT);
      add('surfcore 根目录', fs.existsSync(QQ_CONFIG), maskPath(QQ_CONFIG));
      add('QQ 桥接源码', fs.existsSync(path.join(path.dirname(QQ_CONFIG), 'src', 'bridge.js')), 'src/bridge.js');
      add('B站工具链', fs.existsSync(BILI_MJS), maskPath(BILI_MJS));
      add('B站配置', fs.existsSync(BILI_CONFIG), maskPath(BILI_CONFIG));
      add('B站 cookie', fs.existsSync(BILI_CRED), fs.existsSync(BILI_CRED) ? '已写入（不回显内容）' : '未写入');
      add('人设卡', fs.existsSync(resolvePersonaFile()), maskPath(resolvePersonaFile()));
      add('身份对齐表', fs.existsSync(ALIGN_FILE), maskPath(ALIGN_FILE));
      const qqMemoryOn = readAll().unified.memory?.qqToBili?.enabled === true;
      add('QQ→B站记忆', qqMemoryOn ? fs.existsSync(activeMemoryPaths().qqForBili) : true,
        qqMemoryOn ? maskPath(activeMemoryPaths().qqForBili) : '未开启（正常）');
      add('B站→QQ简报', fs.existsSync(path.join(activePlatformStateDir(QQ_STATE_DIR()), 'bili-memory-brief.md')), '当前角色 bili/bili-memory-brief.md');
      let ffmpeg = false;
      try {
        const result = await new Promise((resolve) => execFile('ffmpeg', ['-version'], { timeout: 5000, windowsHide: true }, (error) => resolve(!error)));
        ffmpeg = result;
      } catch {}
      add('ffmpeg（可选）', ffmpeg, ffmpeg ? '可用' : '未安装：只影响“抽帧看画面”');
      let bridge = { running: false };
      try { bridge = await bridgeStatus(); } catch {}
      add('QQ 桥接', bridge.running, bridge.running ? `端口 ${bridge.port}` : '未运行');
      const all = readAll();
      add('隐私策略', PRIVACY_POLICY_VERSION >= 3, `v${PRIVACY_POLICY_VERSION}（私信/密钥/PII 一律不跨平台）`);
      const install = await installChecks(bridge);
      // 语音链路：只报端口状态 + 一句怎么补（2026-10-27 用户踩过"只起了 8765 就以为装好了"）
      try {
        const v = readUnified().config?.socialV2?.voice?.tts ?? {};
        for (const item of VOICE_PORTS) {
          const open = await portOpen(item.port, 800);
          const hint = item.key === 'voxd'
            ? '启动语音包：voice-packs\voice-local\run.bat'
            : item.key === 'gsv'
              ? '本地音色还需要 GPT-SoVITS：voice-local\gsv.bat，等约 40 秒'
              : '云端包：voice-cloud\run.bat，并在设置→语音里启用';
          const optional = item.key !== 'voxd';
          install.push({
            name: item.label, level: open ? 'ok' : (optional ? 'warn' : 'fail'), ok: open,
            detail: open ? `端口 ${item.port} 在监听` : `端口 ${item.port} 没监听${v.route === 'cloud' && item.key === 'cloud' ? '（当前路由是云端，会直接失败）' : ''}`,
            fix: open ? '' : hint,
          });
        }
        if (v.enabled && v.route === 'local' && !install.find((x) => x.name.includes('GPT-SoVITS'))?.ok) {
          install.push({
            name: '语音配置', level: 'warn', ok: true,
            detail: `路由=本地，角色=${v.character ?? '(未填)'}：本地引擎没起，合成会 503`,
            fix: '先起 gsv.bat；只想马上能用可把路由切到「本机 Piper」或云端',
          });
        }
      } catch {}

      // 同名检查只留一条（installChecks 与旧 checks 有重叠，比如"QQ 桥接源码"）。
      const seen = new Set();
      const allChecks = [...install, ...checks].filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
      json(res, 200, { ok: allChecks.every((c) => c.ok || c.name.includes('可选')), checks: allChecks, installOk: installOk(install), install: installJob, bridge, paths: pathSummary() });
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    // ── 一键安装：发现 SnowLuma → 拉群 → 写配置（只写这一台机器上真实存在的群）
    if (body.action === 'install-scan') {
      const cfg = readQqConfig().config ?? {};
      let found = { ok: false, error: '未探测' };
      try { found = await discoverSnowLumaConnection({ cfg, timeoutMs: 4000 }); } catch (error) { found = { ok: false, error: String(error?.message ?? error) }; }
      let groups = [];
      if (found.ok) {
        try {
          const resp = await fetch(`${found.baseUrl}/get_group_list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(found.token ? { Authorization: `Bearer ${found.token}` } : {}) },
            body: '{}',
          });
          const data = await resp.json().catch(() => ({}));
          groups = (Array.isArray(data?.data) ? data.data : [])
            .map((g) => ({ id: String(g.group_id ?? ''), name: String(g.group_name ?? '') }))
            .filter((g) => /^\d{5,15}$/.test(g.id));
        } catch {}
      }
      json(res, 200, {
        ok: found.ok,
        error: found.ok ? '' : String(found.error ?? '连不上 SnowLuma'),
        snow: {
          online: Boolean(found.ok),
          uin: String(found.self?.user_id ?? ''),
          nickname: String(found.self?.nickname ?? ''),
          httpUrl: found.baseUrl ?? '',
          wsUrl: found.wsUrl ?? '',
          hasToken: Boolean(found.token),
          wsToken: Boolean(found.wsToken),
        },
        groups,
      });
      return;
    }
    // ── 一键安装：把整机装成"能用"的状态（依赖 → 装进 DSH → 配置 → SnowLuma → 白名单 → 桥接）
    if (body.action === 'install-run') {
      if (installJob.running) { json(res, 200, { ok: true, install: installJob }); return; }
      const opts = {
        ownerQQ: String(body.ownerQQ ?? '').trim(),
        groups: (Array.isArray(body.groups) ? body.groups : []).map((g) => String(g ?? '').trim()).filter((g) => /^\d{5,15}$/.test(g)),
        voice: body.voice === true,
        pet: body.pet === true,
      };
      installJob = { running: true, startedAt: new Date().toISOString(), finishedAt: null, steps: [] };
      void runInstall(opts);
      json(res, 200, { ok: true, install: installJob });
      return;
    }
    if (body.action === 'install-apply') {
      const changed = [];
      const cfg = readQqConfig().config ?? {};
      // 1) 端点 / token：服务端再发现一次（不把 token 交给浏览器）
      if (body.discoverSnow !== false) {
        try {
          const found = await discoverSnowLumaConnection({ cfg, timeoutMs: 4000 });
          if (found.ok) {
            const snow = { httpUrl: found.baseUrl };
            if (found.wsUrl) snow.wsUrl = found.wsUrl;
            if (found.token) snow.accessToken = found.token;
            saveQqConfig({ snowluma: snow });
            changed.push('写入 SnowLuma 地址与 token');
          }
        } catch {}
      }
      // 2) 主人 QQ（用户确认过的才写）
      const owner = String(body.ownerQQ ?? '').trim();
      if (/^\d{5,15}$/.test(owner)) {
        saveUnified({ admin: { qq: owner } });
        changed.push('写入管理员 QQ');
      }
      // 3) 白名单：只写用户点过 confirm 的那些群
      const groups = (Array.isArray(body.groups) ? body.groups : [])
        .map((g) => String(g ?? '').trim())
        .filter((g) => /^\d{5,15}$/.test(g));
      if (body.applyGroups && groups.length) {
        // 同样保留现有私聊白名单（2026-10-31 反馈：安装/诊断修复后用户加的人丢失）
        const { allow, warnings } = normalizeAllowlist({
          allow: { ...(cfg.allow ?? {}), groups },
          ownerQQ: owner || cfg.ownerQQ || '',
        });
        saveQqConfig({ allow });
        for (const w of warnings) pluginLog(`[install-apply] 白名单：${w.code} ${w.message}`);
        changed.push(`写入白名单（${groups.length} 个群${owner ? ' + 主人私聊' : ''}${warnings.length ? `，${warnings.length} 条修正` : ''}）`);
      }
      // 4) 配置骨架 / 控制台令牌
      for (const action of doctorFix({ ownerQQ: owner })) {
        if (!changed.includes(action)) changed.push(action);
      }
      json(res, 200, { ok: true, changed, needRestart: changed.some((c) => /DSH|白名单/.test(c)) });
      return;
    }
    if (body.action === 'doctor-fix') {
      const changed = doctorFix(body);
      json(res, 200, { ok: true, changed, restartRequired: changed.length > 0 });
      return;
    }
    if (body.action === 'backup') {
      const created = [];
      for (const [label, file] of [
        ['qq-config', QQ_CONFIG], ['bili-config', BILI_CONFIG], ['unified-config', path.join(STATE_DIR, 'config.json')],
        ['persona', resolvePersonaFile()], ['alignments', ALIGN_FILE],
        ['qq-memory', activeMemoryPaths().qqForBili], ['qq-alignment', QQ_ALIGNMENT_BRIEF], ['bili-alignment', BILI_ALIGNMENT_FILE],
      ]) {
        const out = backupFile(file, label);
        if (out) created.push({ label, file: maskPath(out) });
      }
      json(res, 200, { ok: true, created });
      return;
    }
    if (body.action === 'restore') {
      const name = safeBackupName(body.name);
      if (!name) { json(res, 400, { ok: false, error: '备份名非法' }); return; }
      const source = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(source)) { json(res, 404, { ok: false, code: 'PERSONA_BACKUP_MISSING', error: '备份不存在', hint: '刷新备份列表后重试' }); return; }
      const map = [
        ['qq-config-', QQ_CONFIG], ['bili-config-', BILI_CONFIG], ['unified-config-', path.join(STATE_DIR, 'config.json')],
        ['persona-', resolvePersonaFile()], ['alignments-', ALIGN_FILE],
      ];
      const hit = map.find(([prefix]) => name.startsWith(prefix));
      if (!hit) { json(res, 400, { ok: false, error: '这个备份不支持一键恢复（请手动复制）' }); return; }
      backupFile(hit[1], 'before-restore');
      fs.copyFileSync(source, hit[1]);
      json(res, 200, { ok: true, restored: name, target: maskPath(hit[1]) });
      return;
    }
    json(res, 400, { ok: false, error: '未知 action' });
  }

  // ── SnowLuma 启动（只打开本机已安装程序，不安装、不部署、不代扫码）──────
  // 默认关闭；必须用户在设置页显式开启 snowluma.allowLaunch，且只在点击
  // 「一键启动 / 打开 SnowLuma」时执行。源码/测试里的 L6 边界仍保持：
  // MCP 工具面没有 start_snowluma，桥接本身也只探测不启动。
  function portOpen(port, timeout = 600, host = '127.0.0.1') {
    return new Promise((resolve) => {
      const socket = net.connect({ port, host });
      const done = (ok) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(timeout);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }

  /** 让 .bat/.cmd 里的裸 `node` 也能找到 DSH 自带的 node（Windows PATH 键名大小写不固定）。 */
  function nodePathEnv() {
    const env = { ...process.env };
    try {
      const nodeDir = path.dirname(findNodeExe());
      const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path';
      const current = String(env[pathKey] ?? '');
      if (nodeDir && !current.split(path.delimiter).includes(nodeDir)) {
        env[pathKey] = current ? `${nodeDir}${path.delimiter}${current}` : nodeDir;
      }
    } catch {}
    return env;
  }

  function resolveSnowLumaLauncher() {
    const cfg = readQqConfig().config?.snowluma ?? {};
    const explicit = String(cfg.launchScript ?? '').trim();
    if (explicit) return path.isAbsolute(explicit) ? explicit : path.resolve(QQBOT_ROOT, explicit);
    const base = String(cfg.launcherPath ?? '').trim();
    if (!base) return '';
    const root = path.isAbsolute(base) ? base : path.resolve(QQBOT_ROOT, base);
    const candidates = [
      path.join(root, 'app', 'launcher.bat'),
      path.join(root, 'launcher.bat'),
      path.join(root, 'SnowLuma.exe'),
    ];
    return candidates.find((file) => { try { return fs.existsSync(file); } catch { return false; } }) ?? '';
  }

  // SnowLuma 安装位置识别：规则在 snowluma-install.js（「检测」与「浏览…」共用同一套，
  // 避免两边各猜各的）。这里只负责把当前 QQ 配置喂进去。
  function findSnowLumaInstall(extraPaths = []) {
    const snow = readQqConfig().config?.snowluma ?? {};
    return findSnowLumaInstallIn({ snowluma: snow, extraPaths });
  }

  // SnowLuma 没有原生窗口，它的界面是 WebUI（内置默认 http://127.0.0.1:5099）；
  // 端口从 SnowLuma 自己的 runtime.json 读，读不到才回退 5099，并会在附近自动发现实际端口。
  function snowLumaWebui() {
    const cfg = readQqConfig().config?.snowluma ?? {};
    // 2026-11-06 真机事故：旧代码只读 root/app/config/runtime.json，但当前 SnowLuma 把
    // runtime.json 放在 root/config/runtime.json。读不到就回退写死的 5100，而真实端口是 5099，
    // 于是探活永远失败 → 弹窗永远说「控制台还没起来」，「加载 QQ 账号」整条流程不可用。
    let host = '127.0.0.1';
    let port = 0;
    const root = String(cfg.launcherPath ?? '').trim();
    if (root) {
      for (const rel of [['config', 'runtime.json'], ['app', 'config', 'runtime.json']]) {
        try {
          const runtime = JSON.parse(fs.readFileSync(path.join(root, ...rel), 'utf8'));
          if (Number(runtime?.webuiPort) > 0) port = Number(runtime.webuiPort);
          const runtimeHost = String(runtime?.webuiHost ?? '').trim();
          if (runtimeHost && runtimeHost !== '0.0.0.0' && runtimeHost !== '::') host = runtimeHost;
          if (port > 0) break;
        } catch {}
      }
    }
    const explicitPort = Number(cfg.webuiPort);
    if (Number.isFinite(explicitPort) && explicitPort > 0) port = explicitPort;
    const explicitUrl = String(cfg.webuiUrl ?? '').trim();
    if (explicitUrl) {
      try {
        const parsed = new URL(explicitUrl);
        if (parsed.port) port = Number(parsed.port);
        if (parsed.hostname && parsed.hostname !== '0.0.0.0' && parsed.hostname !== '::') host = parsed.hostname;
      } catch {}
    }
    if (!port) port = 5099;
    return { host, port, url: explicitUrl || `http://${host}:${port}` };
  }

  /**
   * SnowLuma 在配置端口被占用时会自动往后找（findAvailablePort，最多 50 个），
   * 但 runtime.json 里的 webuiPort 不会跟着改。所以不能只探配置端口：
   * 启动后/加载账号前要在附近扫一轮，并用页面标题确认真的是 SnowLuma。
   */
  function snowLumaWebuiCandidates(webui) {
    const base = Math.max(1, Math.min(65535, Number(webui?.port) || 5099));
    const ports = new Set();
    for (const p of [5099, 5100, base]) ports.add(p);
    // 与 SnowLuma 的 findAvailablePort(maxTries=50) 对齐，避免它挪到第 13 个以后我们漏掉。
    for (let i = 1; i <= 50; i += 1) {
      if (base + i <= 65535) ports.add(base + i);
    }
    return [...ports].filter((p) => p > 0 && p <= 65535);
  }

  async function probeSnowLumaWebui(webui, port = webui?.port) {
    if (!Number.isInteger(Number(port)) || Number(port) <= 0) return false;
    const host = webui?.host || '127.0.0.1';
    if (!(await portOpen(Number(port), 350, host))) return false;
    try {
      const res = await fetch(`http://${host}:${port}/`, {
        headers: { accept: 'text/html' },
        signal: AbortSignal.timeout(1200),
      });
      if (!res.ok) return false;
      const text = (await res.text()).slice(0, 5000);
      // SnowLuma 的登录页/控制台 HTML 标题一定含品牌名；用来排除同端口的其它服务。
      return /snowluma/i.test(text);
    } catch {
      return false;
    }
  }

  async function discoverSnowLumaWebui(webui) {
    const candidates = snowLumaWebuiCandidates(webui);
    const results = await Promise.all(candidates.map(async (port) => ({
      port,
      ok: await probeSnowLumaWebui(webui, port),
    })));
    // 优先级：配置端口 → 默认 5099/5100 → 从小到大。
    const preferred = [Number(webui?.port), 5099, 5100].filter((p) => Number.isInteger(p) && p > 0);
    const found = results.filter((x) => x.ok).sort((a, b) => {
      const ai = preferred.indexOf(a.port);
      const bi = preferred.indexOf(b.port);
      if (ai !== bi) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return a.port - b.port;
    });
    if (!found.length) return null;
    return { host: webui?.host || '127.0.0.1', port: found[0].port, url: `http://${webui?.host || '127.0.0.1'}:${found[0].port}` };
  }

  // SnowLuma WebUI 的访问密码：优先用户显式填的，其次仓库 state 里的口令文件。
  // 只在本进程内使用，不返回给浏览器、不写日志。
  function snowLumaWebuiPassword() {
    try {
      return fs.readFileSync(path.join(QQBOT_ROOT, 'state', 'snowluma-webui.pass'), 'utf8').trim();
    } catch { return ''; }
  }

  function snowLumaWebuiError(code, error, hint = '', status = 200) {
    return Object.assign(new Error(String(error || code)), { code, hint, status });
  }

  // 请求成功后记住实际地址，账号列表返回时不再重复扫一遍端口。
  let resolvedSnowLumaWebui = null;

  async function snowLumaWebuiRequest(pathname, { method = 'GET', body = null, password = '' } = {}) {
    let webui = snowLumaWebui();
    let up = false;
    for (let i = 0; i < 5; i += 1) {
      if (await probeSnowLumaWebui(webui, webui.port)) { up = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (!up) {
      const discovered = await discoverSnowLumaWebui(webui);
      if (discovered) { webui = discovered; up = true; }
    }
    if (!up) {
      throw snowLumaWebuiError('SNOWLUMA_WEBUI_DOWN', 'SnowLuma 控制台还没起来', `先启动 SnowLuma；如果刚点了一键启动，等几秒再点「刷新」（配置端口 ${webui.port}，会在附近自动找实际端口）`);
    }
    resolvedSnowLumaWebui = webui;
    const pass = String(password || '').trim() || snowLumaWebuiPassword();
    if (!pass) {
      throw snowLumaWebuiError(
        'SNOWLUMA_WEBUI_PASSWORD_MISSING',
        '没有 SnowLuma 控制台密码',
        `在弹窗里输入 SnowLuma WebUI 访问密码，或把密码写到 ${path.join(QQBOT_ROOT, 'state', 'snowluma-webui.pass')}`,
      );
    }
    let loginRes;
    try {
      loginRes = await fetch(`${webui.url}/api/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass }), signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw snowLumaWebuiError('SNOWLUMA_WEBUI_DOWN', `连不上 SnowLuma 控制台：${error?.message ?? error}`, `确认 ${webui.url} 能打开；必要时重启 SnowLuma`);
    }
    const login = await loginRes.json().catch(() => ({}));
    if (login?.needsTotp === true) {
      throw snowLumaWebuiError('SNOWLUMA_WEBUI_TOTP', 'SnowLuma 控制台开启了二次验证', '先在 SnowLuma 控制台完成 TOTP，再回来刷新');
    }
    if (!loginRes.ok || typeof login?.token !== 'string' || !login.token) {
      throw snowLumaWebuiError('SNOWLUMA_WEBUI_LOGIN_FAILED', 'SnowLuma 控制台密码不正确', '检查密码后重试；密码只在本机进程内使用');
    }
    let res;
    try {
      res = await fetch(`${webui.url}${pathname}`, {
        method,
        headers: { 'X-SnowLuma-Token': login.token, ...(body != null ? { 'Content-Type': 'application/json' } : {}) },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      throw snowLumaWebuiError('SNOWLUMA_WEBUI_DOWN', `SnowLuma 控制台请求失败：${error?.message ?? error}`, '稍后重试；如果控制台被关闭，重新一键启动');
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      throw snowLumaWebuiError('SNOWLUMA_WEBUI_AUTH', 'SnowLuma 控制台会话失效', '重新输入密码后重试');
    }
    if (!res.ok || data?.ok === false) {
      throw snowLumaWebuiError('SNOWLUMA_WEBUI_HTTP', data?.error || data?.message || `SnowLuma 返回 HTTP ${res.status}`, data?.hint || '刷新后重试');
    }
    if (data?.success === false) {
      throw snowLumaWebuiError('SNOWLUMA_WEBUI_ACTION_FAILED', data?.message || 'SnowLuma 操作失败', data?.hint || '检查 QQ 进程状态后重试');
    }
    return data;
  }

  function snowLumaProcessView(process) {
    const p = process ?? {};
    const uin = String(p.uin || p.account?.uin || '').replace(/\D/g, '').slice(0, 15);
    return {
      pid: Number.isSafeInteger(Number(p.pid)) ? Number(p.pid) : null,
      uin,
      nickname: String(p.account?.nickname || p.nickname || p.name || '').slice(0, 60),
      status: String(p.status || '').slice(0, 40),
      loggedIn: p.loggedIn === true,
      injected: p.injected === true,
      error: String(p.error || p.account?.error || '').slice(0, 200),
    };
  }

  async function snowLumaAccountList(password = '') {
    const processesRaw = await snowLumaWebuiRequest('/api/processes', { password });
    const accountsRaw = await snowLumaWebuiRequest('/api/qq-list', { password }).catch(() => ({ list: [] }));
    const processes = (Array.isArray(processesRaw?.list) ? processesRaw.list : []).map(snowLumaProcessView);
    const accounts = (Array.isArray(accountsRaw?.list) ? accountsRaw.list : []).map((account) => ({
      uin: String(account?.uin || '').replace(/\D/g, '').slice(0, 15),
      nickname: String(account?.nickname || account?.name || '').slice(0, 60),
      online: account?.online === true,
    }));
    const webui = resolvedSnowLumaWebui || snowLumaWebui();
    return { webui: webui.url, processes, accounts };
  }

  async function snowLumaLoadAccount(pid, password = '') {
    const n = Number(pid);
    if (!Number.isSafeInteger(n) || n <= 0) {
      throw snowLumaWebuiError('SNOWLUMA_PROCESS_INVALID', 'QQ 进程号无效', '点「刷新」重新检测，再选一个进程');
    }
    const result = await snowLumaWebuiRequest(`/api/processes/${n}/load`, { method: 'POST', body: {}, password });
    return { process: snowLumaProcessView(result?.process ?? result ?? {}) };
  }

  // 只用系统默认浏览器打开本地回环地址；URL 由端口拼出，不接受外部输入。
  function openLocalUrl(url) {
    if (process.env.SURFCORE_SKIP_AUTOSTART === '1') return false;
    if (!/^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(String(url))) return false;
    try {
      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', `"${url}"`], {
        detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
      }).unref();
      return true;
    } catch {
      return false;
    }
  }

  // 网盘资源用系统默认浏览器打开。只允许固定网盘域名，不接受任意 URL；
  // 前端 window.open 在 Electron/新窗口策略下可能被拦，这个接口是可用的兜底。
  const EXTERNAL_OPEN_HOSTS = new Set(['pan.quark.cn', 'pan.xunlei.com', 'pan.baidu.com', 'drive.uc.cn']);
  function openExternalResourceUrl(raw) {
    if (process.platform !== 'win32') {
      return { ok: false, code: 'OPEN_UNSUPPORTED', error: '当前平台不支持自动打开浏览器', hint: '请复制链接后手动打开' };
    }
    const text = String(raw ?? '').trim();
    if (!text || text.length > 2000 || /["\r\n]/.test(text)) {
      return { ok: false, code: 'OPEN_URL_INVALID', error: '链接格式不合法', hint: '请复制链接后手动打开' };
    }
    let parsed;
    try { parsed = new URL(text); } catch {
      return { ok: false, code: 'OPEN_URL_INVALID', error: '链接不是合法 URL', hint: '请复制链接后手动打开' };
    }
    if (!/^https?:$/.test(parsed.protocol) || !EXTERNAL_OPEN_HOSTS.has(parsed.hostname.toLowerCase())) {
      return { ok: false, code: 'OPEN_URL_NOT_ALLOWED', error: '只允许打开已配置的网盘域名', hint: '请复制链接后手动打开' };
    }
    if (process.env.SURFCORE_SKIP_AUTOSTART === '1') {
      return { ok: false, code: 'OPEN_SKIPPED', error: '测试环境跳过打开浏览器', hint: '请复制链接后手动打开' };
    }
    try {
      spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', `"${text}"`], {
        detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
      }).unref();
      return { ok: true };
    } catch (error) {
      return { ok: false, code: 'OPEN_FAILED', error: `打开浏览器失败：${error?.message ?? error}`, hint: '请复制链接后手动打开' };
    }
  }

  // SnowLuma 连不上时到底卡在哪一步：进程没起 / 停在登录页 / token 或端口不对。
  // 桥接的 goodError 只有一句 fetch failed，光看它没法给用户任何可执行的信息。
  async function diagnoseSnowLuma(bridgeSnow = {}, { bridge = null } = {}) {
    if (bridgeSnow.connected === true) return { state: 'ok', hint: '' };
    if (bridge && bridge.running === false) {
      return {
        state: 'bridge-down',
        hint: 'QQ 桥接没在跑：设置 → SurfCore → 概览 → 启动 QQ 桥接（桥接起来之后才轮到 SnowLuma）',
      };
    }
    if (bridge && bridge.ok === false) {
      return {
        state: 'bridge-error',
        hint: `桥接在跑但状态接口拒绝了：${bridge.error || '检查 consoleToken'} —— 重启桥接或重新读取 state/console-token`,
      };
    }
    // 只有 bridge.snowluma（运行态）才带 connected 字段；config.snowluma 没有。
    // 体检以前误把配置对象传进来，导致“端口在听”被固定判成 onebot-rejected。
    const hasRuntimeState = bridgeSnow && typeof bridgeSnow === 'object'
      && Object.prototype.hasOwnProperty.call(bridgeSnow, 'connected');
    if (!hasRuntimeState) {
      return {
        state: 'bridge-not-running',
        hint: 'QQ 桥接还没运行：设置 → SurfCore → 概览 → 启动 QQ（启动后再体检）',
      };
    }
    let webui = snowLumaWebui();
    const onebot = (await portOpen(3000)) || (await portOpen(3001));
    let webuiUp = await probeSnowLumaWebui(webui, webui.port);
    if (!webuiUp) {
      const discovered = await discoverSnowLumaWebui(webui);
      if (discovered) { webui = discovered; webuiUp = true; }
    }
    if (onebot) {
      return {
        state: 'onebot-rejected',
        hint: 'OneBot 端口在监听但桥接连不上：多半是 accessToken 不匹配（对齐 config.json 的 snowluma.accessToken），或 httpUrl 指到了 WebSocket 端口',
      };
    }
    if (webuiUp) {
      return { state: 'needs-login', hint: `SnowLuma 已启动但还没登录：打开 ${webui.url} 扫码/登录` };
    }
    return { state: 'not-running', hint: 'SnowLuma 没在运行：设置 → SurfCore → 概览 → 一键启动（会按需打开控制台）' };
  }

  /**
   * 2026-11-06 事故：SnowLuma 是插件 spawn 出来的子进程，DSH 退出（每次更新都会退出）时会被
   * 一起结束；而 `cmd /c start` 还会留一个黑框——用户关掉黑框就等于关掉 QQ 网关。
   *
   * 做法（真机验证过，1 秒拉起）：
   *   写一个 VBS（`sh.Run ..., 0, False` = 隐藏窗口）
   *   → 用 explorer.exe 打开它（explorer 不属于 DSH 的 Job，天然的脱离点）
   *   → wscript 退出后 node 变成孤儿进程，taskkill /T DSH 也带不走它。
   * 失败时返回 ok:false，调用方回退旧逻辑（保持原有行为不变）。
   */
  function spawnSnowLumaDetached({ launcher, cwd, env }) {
    if (process.platform !== 'win32') return { ok: false, error: '非 Windows 平台' };
    if (/["\r\n]/.test(String(launcher)) || /["\r\n]/.test(String(cwd))) {
      return { ok: false, error: '启动路径含引号或换行，拒绝写入 VBS' };
    }
    try {
      const appDir = path.dirname(launcher);
      const entry = path.join(appDir, 'index.mjs');
      const lower = launcher.toLowerCase();
      const isBatch = lower.endsWith('.bat') || lower.endsWith('.cmd');
      let target;
      let nodeExe = '';
      if (isBatch && fs.existsSync(entry)) {
        // 直接起 node：绕开 launcher.bat 里的 cmd 窗口和末尾的 pause。
        // 注意：插件在 DSH 宿主里跑，process.execPath 是 Harness.exe，不是 node.exe；
        // 必须用 findNodeExe() 找到真正的 node，否则 VBS 会把 SnowLuma 的 index.mjs 交给 Harness 打开。
        nodeExe = findNodeExe();
        if (!/^node(?:\.exe)?$/i.test(path.basename(String(nodeExe)))) {
          return {
            ok: false,
            code: 'SNOWLUMA_NODE_MISSING',
            error: `找不到真正的 node.exe（当前解析到 ${nodeExe}）`,
            hint: '确认 DSH 的 node 运行时存在，或设置 DSH_NODE 指向 node.exe；也可以把 snowluma.launchMode 改成 legacy 手动启动',
          };
        }
        target = `"${nodeExe}" "${entry}"`;
      } else if (isBatch) {
        target = `"${process.env.ComSpec || 'cmd.exe'}" /d /c ""${launcher}""`;
      } else {
        target = `"${launcher}"`;
      }
      const vbsEsc = (value) => String(value).replace(/"/g, '""');
      const stateDir = path.join(QQBOT_ROOT, 'state');
      fs.mkdirSync(stateDir, { recursive: true });
      const vbsPath = path.join(stateDir, 'snowluma-launch.vbs');
      fs.writeFileSync(vbsPath, [
        "' 由 SurfCore 生成：隐藏窗口（样式 0）启动 SnowLuma，避免留黑框",
        "' explorer.exe 打开本文件 → wscript 退出后 node 成为孤儿进程，脱离 DSH 进程树",
        'Set sh = CreateObject("WScript.Shell")',
        `sh.CurrentDirectory = "${vbsEsc(cwd)}"`,
        `sh.Run "${vbsEsc(target)}", 0, False`,
        '',
      ].join('\r\n'), 'utf8');
      const explorer = path.join(process.env.SystemRoot || 'C:\\Windows', 'explorer.exe');
      spawn(explorer, [vbsPath], { detached: true, stdio: 'ignore', env, windowsHide: true }).unref();
      return { ok: true, method: 'explorer+vbs', target, vbs: vbsPath, nodeExe };
    } catch (error) {
      return { ok: false, code: 'SNOWLUMA_SPAWN_FAILED', error: String(error?.message ?? error), hint: '检查 SnowLuma 安装目录和系统是否允许运行 .vbs；也可改用 snowluma.launchMode=legacy' };
    }
  }

  async function launchSnowLuma({ openWebui = true, hideConsoles = false } = {}) {
    if (process.env.SURFCORE_SKIP_AUTOSTART === '1') {
      return { ok: true, skipped: true, message: '测试环境：跳过打开 SnowLuma' };
    }
    const cfg = readQqConfig().config?.snowluma ?? {};
    if (cfg.allowLaunch !== true) {
      return {
        ok: false,
        code: 'SNOWLUMA_LAUNCH_DISABLED',
        error: '未开启「允许插件打开 SnowLuma」',
        hint: '设置 → SurfCore → QQ → SnowLuma → 打开「允许插件打开 SnowLuma」，保存后再点一键启动',
      };
    }
    let webui = snowLumaWebui();

    // 已登录（OneBot 3000/3001 在听）：什么都不用做，也别弹窗口。
    if (await portOpen(3000) || await portOpen(3001)) {
      return { ok: true, already: true, opened: false, message: 'SnowLuma 已在运行且已登录' };
    }

    // 进程在、但 OneBot 没起 → 多半停在登录页：直接在附近找到实际 WebUI 并打开。
    let existing = (await probeSnowLumaWebui(webui, webui.port)) ? webui : null;
    if (!existing) existing = await discoverSnowLumaWebui(webui);
    if (existing) {
      webui = existing;
      const opened = openWebui ? openLocalUrl(webui.url) : false;
      return {
        ok: true,
        needsLogin: true,
        needsAccount: true,
        opened,
        webui: webui.url,
        message: opened ? `SnowLuma 在登录页，已打开控制台 ${webui.url}` : `SnowLuma 在登录页：请打开 ${webui.url} 扫码`,
      };
    }

    const launcher = resolveSnowLumaLauncher();
    if (!launcher) {
      return {
        ok: false,
        code: 'SNOWLUMA_LAUNCHER_MISSING',
        error: '找不到 SnowLuma 启动脚本',
        hint: '在设置 → QQ → SnowLuma 里填「SnowLuma 安装目录」或「启动脚本」，再点一键启动',
      };
    }
    try {
      const cwd = path.dirname(launcher);
      const lower = launcher.toLowerCase();
      let launchDetail = null;
      // 2026-11-06：默认「隐藏 + 脱离 DSH 进程树」。想恢复旧行为（可见控制台、随 DSH 退出），
      // 设置 snowluma.launchMode = "legacy" 即可（不写默认 detached）。
      // 默认跟随「隐藏命令行黑框」开关；显式 launchMode 仍然优先。
      const launchMode = String(cfg.launchMode ?? (hideConsoles ? 'detached' : 'legacy')).toLowerCase();
      let launchedBy = 'legacy';
      if (launchMode !== 'legacy') {
        const detachedResult = spawnSnowLumaDetached({ launcher, cwd, env: nodePathEnv() });
        launchDetail = detachedResult;
        if (detachedResult.ok) launchedBy = detachedResult.method;
        if (!detachedResult.ok && detachedResult.code === 'SNOWLUMA_NODE_MISSING') {
          return { ...detachedResult, webui: webui.url, launcher, launchMode: 'detached' };
        }
      }
      if (launchedBy === 'legacy' && (lower.endsWith('.bat') || lower.endsWith('.cmd'))) {
        // 2026-10-22 审计：旧写法把 basename 拼进 cmd 命令串，路径里带 `&` 可注入命令。
        // 现在整条路径作为「verbatim 参数」交给 cmd，并且拒绝含引号/换行的路径。
        if (/["\r\n]/.test(launcher)) return { ok: false, error: '启动脚本路径含引号或换行，拒绝执行' };
        if (hideConsoles) {
          // 不经过 `start`：start 会显式创建新控制台窗口，windowsHide 压不住。
          // SnowLuma 的 launcher.bat 最终也是 `node ./index.mjs`；直接起 node，
          // 完全绕开 cmd/Windows Terminal 标签。
          const appDir = path.dirname(launcher);
          const entry = path.join(appDir, 'index.mjs');
          if (fs.existsSync(entry)) {
            spawn(findNodeExe(), [entry], {
              cwd: appDir, detached: true, stdio: 'ignore', env: nodePathEnv(), windowsHide: true,
            }).unref();
          } else {
            spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `"${launcher}"`], {
              cwd, detached: false, stdio: 'ignore', env: nodePathEnv(), windowsHide: true, windowsVerbatimArguments: true,
            }).unref();
          }
        } else {
          spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', `"${launcher}"`], {
            cwd, detached: true, stdio: 'ignore', env: nodePathEnv(), windowsHide: false, windowsVerbatimArguments: true,
          }).unref();
        }
      } else if (launchedBy === 'legacy') {
        spawn(launcher, [], { cwd, detached: true, stdio: 'ignore', env: nodePathEnv(), windowsHide: hideConsoles === true }).unref();
      }
      // 等 WebUI 起来（最多 30 秒）：SnowLuma 在端口被占用时会自动往后挪，
      // 所以不能只探配置端口；每次扫描附近 50 个端口并用页面标题确认真的是 SnowLuma。
      const until = Date.now() + 30_000;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const discovered = await discoverSnowLumaWebui(webui);
        if (discovered) {
          webui = discovered;
          const opened = openWebui ? openLocalUrl(webui.url) : false;
          return {
            ok: true,
            started: true,
            needsAccount: true,
            opened,
            webui: webui.url,
            launcher,
            launchMode: launchedBy,
            message: opened ? `已启动 SnowLuma 并打开控制台 ${webui.url}` : `已启动 SnowLuma：${webui.url}`,
          };
        }
      }
      return {
        ok: false,
        code: 'SNOWLUMA_LAUNCH_TIMEOUT',
        error: `已发出启动命令，但 30 秒内没找到 SnowLuma 控制台（配置端口 ${webui.port}）`,
        hint: '先看 SnowLuma 安装目录下的日志；也可以直接运行 launcher.bat 手动确认能打开控制台。若一直失败，把 snowluma.launchMode 设为 legacy 后再试',
        needsAccount: true,
        webui: webui.url,
        launcher,
        launchMode: launchedBy,
        detail: {
          configuredPort: webui.port,
          scannedPorts: snowLumaWebuiCandidates(webui),
          nodeExe: findNodeExe(),
          launch: launchDetail,
        },
      };
    } catch (error) {
      return {
        ok: false,
        code: 'SNOWLUMA_LAUNCH_FAILED',
        error: `打开 SnowLuma 失败：${error?.message ?? error}`,
        hint: '检查安装目录和 SnowLuma 日志；必要时手动运行 launcher.bat',
      };
    }
  }

  /**
   * 关闭 SnowLuma（包括 explorer+wscript 拉起的孤儿进程）。
   * 不按进程名盲杀：先用配置端口 + 5099~5110/3000/3001 找 PID，再看命令行是否像 SnowLuma/index.mjs；
   * 找不到端口时再按命令行兜底。失败返回结构化原因。
   */
  async function stopSnowLuma() {
    if (process.platform !== 'win32') {
      return { ok: false, code: 'SNOWLUMA_STOP_UNSUPPORTED', error: '当前平台不支持自动关闭 SnowLuma', hint: '请手动结束 SnowLuma 进程' };
    }
    const basePort = Math.max(1, Math.min(65535, Number(snowLumaWebui().port) || 5099));
    const stopPorts = [...new Set([
      ...snowLumaWebuiCandidates({ ...snowLumaWebui(), port: basePort }),
      3000, 3001,
    ])].filter((p) => Number.isInteger(p) && p > 0 && p <= 65535);
    const script = [
      `$ports=@(${stopPorts.join(',')})`,
      '$pids=@()',
      'foreach($p in $ports){ try { $pids += (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction Stop | Select-Object -ExpandProperty OwningProcess) } catch {} }',
      '$pids=$pids | Sort-Object -Unique',
      '$rows=@()',
      'foreach($id in $pids){ $proc=Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue; if($proc -and $proc.CommandLine -match \'index\\.mjs|SnowLuma\'){ $rows += [pscustomobject]@{pid=$id} } }',
      'if($rows.Count -eq 0){ Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match \'SnowLuma.*index\\.mjs\' } | ForEach-Object { $rows += [pscustomobject]@{pid=$_.ProcessId} } }',
      '$rows | ConvertTo-Json -Compress',
    ].join('; ');
    const run = (file, args) => new Promise((resolve) => {
      execFile(file, args, { windowsHide: true, timeout: 15000 }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
    });
    const found = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    if (found.error) {
      return { ok: false, code: 'SNOWLUMA_STOP_FAILED', error: `查找 SnowLuma 进程失败：${found.error.message}`, hint: '可在任务管理器结束 node.exe（命令行含 SnowLuma/index.mjs）' };
    }
    let rows = [];
    try {
      const parsed = JSON.parse(found.stdout.trim() || '[]');
      rows = Array.isArray(parsed) ? parsed : [parsed];
    } catch {}
    const pids = [...new Set(rows.map((row) => Number(row?.pid)).filter((pid) => Number.isInteger(pid) && pid > 0))];
    if (!pids.length) {
      return { ok: true, stopped: [], message: '没找到运行中的 SnowLuma（配置端口/5099~5110/3000/3001 没有匹配进程）' };
    }
    const stopped = [];
    const errors = [];
    for (const pid of pids) {
      const result = await run('taskkill.exe', ['/PID', String(pid), '/T', '/F']);
      if (result.error || result.stderr.trim()) errors.push({ pid, error: result.error?.message || result.stderr.trim() });
      else stopped.push(pid);
    }
    return {
      ok: errors.length === 0,
      stopped,
      errors,
      message: errors.length
        ? `已结束 ${stopped.length} 个，失败 ${errors.length} 个`
        : `已关闭 SnowLuma（PID ${stopped.join(', ')}）`,
      hint: errors.length ? '可能有子进程仍在运行，任务管理器结束 node.exe 或重启 DSH' : '',
    };
  }

  // ── 启动完成弹窗 ────────────────────────────────────────────────────────
  // 用 wscript 的 WScript.Shell.Popup：独立 GUI 窗口，不弹控制台，不依赖 DSH。
  function showStartupPopup(title, text, seconds = 30) {
    if (process.platform !== 'win32' || process.env.SURFCORE_SKIP_AUTOSTART === '1') return false;
    try {
      const wscript = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe');
      if (!fs.existsSync(wscript)) return false;
      const esc = (value) => String(value ?? '').replace(/"/g, '""');
      const body = String(text ?? '').replace(/\r?\n/g, '" & vbCrLf & "');
      const vbs = [
        'Set sh = CreateObject("WScript.Shell")',
        // 64 = vbInformation，4096 = vbSystemModal：强制置顶，避免弹到 DSH 后面。
        `sh.Popup "${body}", ${Math.max(5, Math.round(seconds))}, "${esc(title)}", ${64 + 4096}`,
        '',
      ].join('\r\n');
      const file = path.join(os.tmpdir(), `surfcore-startup-${process.pid}-${Date.now()}.vbs`);
      // VBScript 在 wscript 下按 UTF-16LE + BOM 读最稳，中文不会乱码。
      fs.writeFileSync(file, Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(vbs, 'utf16le')]));
      const child = spawn(wscript, ['//nologo', file], { detached: true, stdio: 'ignore', windowsHide: true });
      child.unref();
      pluginLog(`启动弹窗已请求：${title}（pid ${child.pid ?? '?'}，${seconds}s）`);
      setTimeout(() => { try { fs.unlinkSync(file); } catch {} }, 120000).unref?.();
      return true;
    } catch (error) {
      pluginLog('启动弹窗失败：', error?.message ?? error);
      return false;
    }
  }

  let startupWatcher = null;
  async function watchStartupCompletion({ qq = true, bili = true } = {}) {
    if (startupWatcher) return startupWatcher;
    startupWatcher = (async () => {
      try {
        const notify = readUnified().config.bridge?.startupNotify !== false;
        if (!notify || (!qq && !bili)) return;
        // DSH 重启/桥接切端口时，鉴权握手可能比 90 秒慢；给 3 分钟，
        // 并在超时前再做一次 final check，避免把“还在连”误报成“DSH 未连接”。
        const until = Date.now() + 180_000;
        const qqReady = (bridge) => {
          const snow = bridge?.snowluma ?? {};
          return Boolean(bridge?.running && bridge?.ok !== false && bridge?.dshReady === true
            && snow.connected === true && snow.accountOnline === true);
        };
        const allReady = (bridge, schedulerRunning) => Boolean(
          (!qq || qqReady(bridge)) && (!bili || schedulerRunning),
        );
        const successLines = (bridge) => {
          const snow = bridge?.snowluma ?? {};
          return [
            '全部启动成功 ✓',
            '',
            ...(qq ? [
              `QQ 桥接：运行中（端口 ${bridge.port ?? 3100}，DSH 已连接）`,
              `SnowLuma：已连接，QQ ${snow.accountOnline ? '在线' : '离线'}`,
            ] : ['QQ：启动开关关闭（未启动）']),
            ...(bili ? ['B站生物钟：运行中'] : ['B站：启动开关关闭（未启动）']),
          ];
        };
        let last = null;
        while (Date.now() < until) {
          const [bridge, schedulerRunning] = await Promise.all([
            bridgeStatus().catch((error) => ({ ok: false, running: false, error: String(error?.message ?? error) })),
            Promise.resolve(schedulerStatus.running),
          ]);
          last = { bridge, schedulerRunning };
          if (allReady(bridge, schedulerRunning)) {
            const snow = bridge?.snowluma ?? {};
            pluginLog(`启动检查通过：qq=${qq} bili=${bili} DSH=${bridge.dshBaseUrl ?? '?'} SnowLuma=${snow.connected} 账号=${snow.accountOnline}`);
            showStartupPopup('SurfCore 启动完成', successLines(bridge).join('\n'), 30);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        // 最后一次补查：桥接可能刚好在超时边界上完成 DSH 握手。
        try {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const [bridge, schedulerRunning] = await Promise.all([
            bridgeStatus().catch(() => null),
            Promise.resolve(schedulerStatus.running),
          ]);
          if (bridge) last = { bridge, schedulerRunning };
          if (bridge && allReady(bridge, schedulerRunning)) {
            showStartupPopup('SurfCore 启动完成', successLines(bridge).join('\n'), 30);
            return;
          }
        } catch {}
        const bridge = last?.bridge ?? {};
        const snow = bridge.snowluma ?? {};
        const snowDiag = await diagnoseSnowLuma(snow, { bridge }).catch(() => ({ state: 'unknown', hint: '' }));
        pluginLog(`启动检查未通过：qq=${qq} bili=${bili} running=${Boolean(bridge.running)} dshReady=${Boolean(bridge.dshReady)} dshBaseUrl=${bridge.dshBaseUrl ?? '?'} snow=${Boolean(snow.connected)} snowState=${snowDiag.state} account=${Boolean(snow.accountOnline)} scheduler=${Boolean(last?.schedulerRunning)}`);
        showStartupPopup('SurfCore 启动状态', [
          '还没全部就绪：',
          '',
          ...(qq ? [
            `QQ 桥接：${bridge.running ? (bridge.ok ? '运行中' : '运行中但状态异常') : '未运行'}`,
            `DSH：${bridge.dshReady
              ? '已连接'
              : (bridge.dshBaseUrl && bridge.dshBaseUrl !== currentDshUrl()
                ? `桥接还连着旧端口 ${bridge.dshBaseUrl}（当前 ${currentDshUrl()}）`
                : 'DSH 已打开，但桥接还在鉴权/等待连接')}`,
            `SnowLuma：${snow.connected ? '已连接' : `未就绪（${snowDiag.state}）`}`,
            ...(snowDiag.hint ? [`   → ${snowDiag.hint}`] : []),
          ] : ['QQ：启动开关关闭（未启动）']),
          ...(bili ? [`B站生物钟：${last?.schedulerRunning ? '运行中' : '未启动'}`] : ['B站：启动开关关闭（未启动）']),
        ].join('\n'), 40);
      } catch (error) {
        pluginLog('启动完成检查失败：', error?.message ?? error);
      } finally {
        startupWatcher = null;
      }
    })();
    return startupWatcher;
  }

  // ── 桥接控制 ────────────────────────────────────────────────────────────

  // 语音：把面板请求原样转发给桥接的 /api/voice/*（语音包安装、启停、规则）。
  // 插件自己不做业务，只负责带控制台令牌转发，桥接那边怎么改这里都不用动。
  async function handleVoice(req, res, url) {
    // 语音自检：三步（服务/合成/发送前置）分别给结论，避免"语音坏了"只能靠猜。
    if (url.pathname === `${API_PREFIX}/voice/tts-check`) {
      if (String(req.method || 'GET').toUpperCase() !== 'POST') { json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '只支持 POST' }); return; }
      const result = await callBridge('/api/voice/tts-check', { method: 'POST', body: '{}', timeoutMs: 90_000 });
      const data = result.data ?? { ok: false, code: 'BRIDGE_UNAVAILABLE', error: result.error || '桥接不可用', hint: '确认 QQ 桥接在运行（设置 → 状态）' };
      json(res, result.status || 200, data);
      return;
    }

    const suffix = url.pathname.slice(`${API_PREFIX}/voice`.length) || '';
    const method = String(req.method || 'GET').toUpperCase();
    // 网盘离线包入口：Electron 里 target=_blank 会被拦，统一由宿主打开浏览器。
    // 链接写死（不接受用户输入），避免变成任意 URL 打开器。
    if (url.pathname === `${API_PREFIX}/voice/packs/netdisk`) {
      if (method !== 'POST') { json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '只支持 POST' }); return; }
      const NETDISK_URL = 'https://pan.quark.cn/s/ec6cf2b123de?pwd=sxUZ';
      if (process.platform !== 'win32') {
        json(res, 200, { ok: false, code: 'OPEN_URL_UNSUPPORTED', error: '当前系统不支持自动打开浏览器', hint: `手动打开：${NETDISK_URL}`, url: NETDISK_URL });
        return;
      }
      try {
        // start 的第一个空参数是窗口标题，不能省；.usebackq 不需要，URL 里无 & 之外的 shell 元字符。
        spawn('cmd.exe', ['/c', 'start', '', NETDISK_URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
        json(res, 200, { ok: true, url: NETDISK_URL });
      } catch (error) {
        json(res, 500, { ok: false, code: 'OPEN_URL_FAILED', error: `打开浏览器失败：${String(error?.message ?? error).slice(0, 120)}`, hint: `手动打开：${NETDISK_URL}`, url: NETDISK_URL });
      }
      return;
    }
    // 参考音频“下载”在 Electron/新窗口里会没反应（target=_blank 被宿主拦截），
    // 改为打开包内 voicepack 目录并选中文件；插件侧直接做，不走桥接代理。
    if (url.pathname === `${API_PREFIX}/voice/packs/sample-open`) {
      if (method !== 'POST') { json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '只支持 POST' }); return; }
      try {
        const body = await readBody(req);
        const id = String(body.id || 'voice-cloud');
        const listed = await callBridge('/api/voice/packs', { timeoutMs: 8000 });
        const pack = (listed.data?.packs || []).find((p) => p.id === id);
        if (!pack?.dir) {
          json(res, 404, { ok: false, code: 'SAMPLE_PACK_NOT_FOUND', error: '语音包还没安装，找不到参考音频', hint: '先安装/导入云端语音包，再点「打开所在目录」。' });
          return;
        }
        const dir = path.join(pack.dir, 'voicepack');
        const files = await fs.promises.readdir(dir).catch(() => []);
        const name = files.find((f) => /\.(wav|mp3|m4a)$/i.test(f));
        if (!name) {
          json(res, 404, { ok: false, code: 'SAMPLE_FILE_NOT_FOUND', error: '包内没有参考音频文件', hint: `检查目录：${dir}` });
          return;
        }
        const file = path.join(dir, name);
        if (process.platform !== 'win32') {
          json(res, 200, { ok: false, code: 'OPEN_FOLDER_UNSUPPORTED', error: '当前系统不支持自动打开目录', hint: `手动打开：${dir}` });
          return;
        }
        execFile('explorer.exe', ['/select,', file], { windowsHide: true }, () => {});
        json(res, 200, { ok: true, path: file, dir });
      } catch (e) {
        json(res, 502, { ok: false, code: 'OPEN_FOLDER_FAILED', error: `打开参考音频目录失败：${e?.message || e}`, hint: '桥接/文件管理器是否可用；也可以手动打开语音包目录下的 voicepack。' });
      }
      return;
    }
    const target = `${consoleBase()}/api/voice${suffix}${url.search || ''}`;
    const headers = { 'x-console-token': consoleToken() };
    const init = { method: req.method };
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = await readBody(req);
      headers['content-type'] = 'application/json';
    }
    init.headers = headers;
    try {
      const r = await fetch(target, init);
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(r.status, {
        'content-type': r.headers.get('content-type') || 'application/json; charset=utf-8',
        ...(r.headers.get('content-disposition') ? { 'content-disposition': r.headers.get('content-disposition') } : {}),
      });
      res.end(buf);
    } catch (e) {
      json(res, 502, { ok: false, error: `语音服务不可达（桥接是否在运行？）：${e?.message ?? e}` });
    }
  }

  // 桌宠：安装 / 卸载 / 启动 / 停止 / 状态（本机文件，不经过桥接）
  let electronJob = null;

  // 原生「浏览目录 / 选择文件」——浏览器拿不到绝对路径，只能由宿主进程弹 Windows 对话框。
  // 仅 Windows 且 DSH 跑在本机时有意义；其它情况返回可读错误，前端提示手动填。
  //
  // 路径不能走 PowerShell stdout：Windows PowerShell 5.1 重定向时用 OEM/GBK 编码，
  // Node 按 UTF-8 解码，中文目录会变成 `�`，后端 fsp.stat 直接 ENOENT（2026-10-29 反馈）。
  // 改成：PowerShell 把选中路径写进临时 UTF-8 文件，Node 读文件后删除；彻底绕开控制台编码。
  async function handleBrowse(req, res, url) {
    const mode = url.searchParams.get('mode') === 'file' ? 'file' : 'dir';
    const title = url.searchParams.get('title') || (mode === 'file' ? '选择文件' : '选择目录');
    // 文件过滤只认枚举（目前只有 snowluma）：不接受任意 filter 串，避免用户被诱导选错类型。
    const filterKey = String(url.searchParams.get('filter') || '').trim().toLowerCase();
    const fileFilter = filterKey === 'snowluma'
      ? 'SnowLuma 启动文件 (SnowLuma.exe;launcher.bat)|SnowLuma.exe;launcher.bat|所有文件 (*.*)|*.*'
      : filterKey === 'embedding-pack'
        ? 'Embedding 包 (*.zip)|*.zip|所有文件 (*.*)|*.*'
        : '可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*';
    if (process.platform !== 'win32') {
      json(res, 200, { ok: false, error: '只有 Windows 支持原生选择框，请手动填路径' });
      return;
    }
    const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const outFile = path.join(os.tmpdir(), `surfcore-browse-${process.pid}-${randomUUID()}.txt`);
    const writeOut = (expr) => `[System.IO.File]::WriteAllText(${psQuote(outFile)}, ${expr}, (New-Object System.Text.UTF8Encoding -ArgumentList $false))`;
    const ps = mode === 'file'
      ? `Add-Type -AssemblyName System.Windows.Forms;
$d = New-Object System.Windows.Forms.OpenFileDialog;
$d.Title = ${psQuote(title)};
$d.Filter = ${psQuote(fileFilter)};
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { ${writeOut('$d.FileName')} }`
      : `Add-Type -AssemblyName System.Windows.Forms;
$d = New-Object System.Windows.Forms.FolderBrowserDialog;
$d.Description = ${psQuote(title)};
$d.ShowNewFolderButton = $true;
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { ${writeOut('$d.SelectedPath')} }`;
    const child = execFile('powershell.exe', ['-STA', '-NoProfile', '-Command', ps], { windowsHide: true, timeout: 180_000 }, (error) => {
      let picked = '';
      try { picked = String(fs.readFileSync(outFile, 'utf8')).replace(/^\uFEFF/, '').trim(); } catch {}
      try { fs.unlinkSync(outFile); } catch {}
      if (error && !picked) json(res, 200, { ok: false, error: `选择框打不开：${String(error.message || error).slice(0, 160)}` });
      else if (!picked) json(res, 200, { ok: false, cancelled: true, error: '已取消' });
      else json(res, 200, { ok: true, path: picked });
    });
    child.on('error', () => {
      try { fs.unlinkSync(outFile); } catch {}
      json(res, 200, { ok: false, error: '无法启动 PowerShell（可能不在本机桌面）' });
    });
  }

  async function handlePet(req, res, url) {
    const suffix = url.pathname.slice(`${API_PREFIX}/pet`.length) || '/status';
    const method = String(req.method || 'GET').toUpperCase();
    try {
      if (suffix === '/status' && method === 'GET') {
        const petStatus = petService.status();
        const chatStatus = petChat.status();
        const cfgPet = String(readQqConfig().config?.pet?.appDir || '').trim();
        const detected = detectElectronPath({ cfgPath: petService.status().electronPath || '', appDir: cfgPet, stateDir: STATE_DIR });
        json(res, 200, {
          ...petStatus,
          installing: petStatus.installing || electronJob || null,
          chat: chatStatus.chat,
          role: chatStatus.role,
          proactive: chatStatus.proactive,
          presence: chatStatus.presence,
          voice: chatStatus.voice,
          llm: chatStatus.llm,
          focus: chatStatus.focus,
          events: { ...chatStatus.events, hostFile: petApi.hostFile },
          lastError: chatStatus.lastError,
          defaults: {
            zipUrl: 'https://github.com/Mieksido/surfpet/releases/latest/download/pet-pack.zip',
            electronUrl: electronDownloadUrl(),
            electronVersion: ELECTRON_VERSION,
          },
          electronDetected: detected,
        });
        return;
      }
      if (method !== 'POST') { json(res, 405, { ok: false, error: '只支持 POST' }); return; }
      const body = JSON.parse((await readBody(req)) || '{}');
      if (suffix === '/config') { json(res, 200, { ok: true, ...petService.configure(body) }); return; }
      if (suffix === '/focus') {
        const state = petChat.setFocus(body.enabled === true, body.source || 'settings');
        json(res, 200, { ok: true, focus: state });
        return;
      }
      if (suffix === '/electron-detect') {
        const cfgPet = String(readQqConfig().config?.pet?.appDir || '').trim();
        const found = detectElectronPath({ cfgPath: petService.status().electronPath || '', appDir: cfgPet, stateDir: STATE_DIR });
        if (found) { try { petService.configure({ electronPath: found }); } catch {} }
        json(res, 200, { ok: Boolean(found), electronPath: found, error: found ? '' : '本机没找到 Electron，可点「下载 Electron」自动装' });
        return;
      }
      if (suffix === '/electron-install') {
        const jobKey = 'electron';
        electronJob = { phase: '准备下载 Electron', progress: 0, error: null, key: jobKey };
        const onProgress = (pct, phase) => {
          if (!electronJob) return;
          electronJob = { ...electronJob, progress: pct, phase: phase || electronJob.phase, updatedAt: Date.now() };
        };
        const src = ['github', 'mirror'].includes(String(body.source ?? '')) ? String(body.source) : 'auto';
        let r;
        try {
          r = await installElectronRuntime({ stateDir: STATE_DIR, log: (m) => pluginLog(m), source: src, onProgress });
          electronJob = { ...electronJob, phase: '完成', progress: 100 };
        } catch (error) {
          electronJob = { ...electronJob, phase: '失败', error: String(error?.message ?? error) };
          throw error;
        } finally {
          setTimeout(() => { electronJob = null; }, 60_000).unref?.();
        }
        try { if (r.electronPath) petService.configure({ electronPath: r.electronPath }); } catch {}
        json(res, 200, r);
        return;
      }
      if (suffix === '/install') {
        // body 里带设置页表单：安装请求本身就要落盘 source/appDir/electronPath，
        // 不能要求用户先点「保存设置」（2026-10-30：填了目录点安装仍报"请先填写安装包地址"）。
        const r = await petService.install(body?.source, {
          source: body?.source, appDir: body?.appDir, electronPath: body?.electronPath,
        });
        json(res, 200, r);
        return;
      }
      if (suffix === '/remove') { json(res, 200, await petService.remove()); return; }
      if (suffix === '/clean') { json(res, 200, await petService.cleanAppDir()); return; }
      if (suffix === '/start') {
        // 启动同样接受表单里的 electronPath：用户刚填的路径不该先"保存"才生效。
        if (typeof body?.electronPath === 'string' && body.electronPath.trim()) {
          try { petService.configure({ electronPath: body.electronPath.trim() }); } catch {}
        }
        json(res, 200, await petService.start());
        return;
      }
      if (suffix === '/stop') { json(res, 200, await petService.stop()); return; }
      if (suffix === '/chat-test') {
        // 给设置页「发一条测试消息」用：不占主动搭话，只验证人设/模型/语音链路。
        const result = await petChat.chat({ text: body.text || '在吗', modality: body.modality === 'voice' ? 'voice' : 'text' });
        // 设置页发的测试也要在桌宠那边弹出来（气泡 + 对话框），否则用户不知道有没有通。
        if (result.ok && result.reply) {
          petChat.emit({
            type: 'reply',
            text: result.reply.text,
            modality: result.reply.modality,
            audioKey: result.reply.audio?.key || '',
            messageId: result.reply.id,
          });
        }
        json(res, result.ok ? 200 : 400, result);
        return;
      }
      json(res, 404, { ok: false, error: `未知桌宠接口：${suffix}` });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 目的机制（设置页「目的」）：按当前载体路由到 Bridge 或桌宠 ─────────────
  async function purposeAvailability() {
    const petStatus = petService.status();
    const online = petChat.online();
    let bridge = null;
    try { bridge = await bridgeStatus(); } catch (error) { bridge = { ok: false, running: false, error: String(error?.message ?? error) }; }
    return {
      pet: {
        installed: Boolean(petStatus.installed),
        running: Boolean(petStatus.running),
        online: Boolean(online.online),
        lastPollAt: online.lastSeenAt || 0,
        roleName: petChat.roleInfo().name,
      },
      qq: {
        running: Boolean(bridge?.running),
        mode: bridge?.mode || bridge?.status?.mode || null,
        ok: bridge?.ok !== false,
        error: bridge?.error || '',
      },
    };
  }

  async function handlePurpose(req, res, url) {
    const suffix = url.pathname.slice(`${API_PREFIX}/purpose`.length) || '/status';
    const method = String(req.method || 'GET').toUpperCase();
    const carrier = readQqConfig().config?.purpose?.carrier === 'pet' ? 'pet' : 'qq';
    const availability = await purposeAvailability();
    try {
      if (suffix === '/status' && method === 'GET') {
        if (carrier === 'pet') {
          const st = petPurpose.status();
          json(res, 200, {
            ok: true,
            source: 'pet',
            carrier: 'pet',
            availability,
            enabled: st.enabled,
            modality: st.modality,
            fallbackToQQ: st.fallbackToQQ,
            ownerUin: st.ownerUin,
            ownerName: st.ownerName,
            focus: st.focus,
            config: st.config,
            state: st.state,
            online: st.online,
            lastTickAt: st.lastTickAt,
            lastError: st.lastError,
            lastFallback: st.lastFallback,
          });
          return;
        }
        if (!availability.qq.running) {
          json(res, 200, {
            ok: false,
            source: 'qq',
            carrier: 'qq',
            availability,
            focus: petChat.focusEnabled(),
            error: 'QQ 桥接没在运行：先在「QQ」页启动，或者把载体切到桌宠',
            config: readQqConfig().config?.purpose ?? {},
            state: null,
          });
          return;
        }
        const remote = await callBridge('/api/purpose/status', { timeoutMs: 8000 });
        const data = remote?.data ?? {};
        json(res, remote?.status || 200, {
          ...data,
          source: 'qq',
          carrier: 'qq',
          availability,
          focus: petChat.focusEnabled(),
          ok: data.ok !== false,
          error: data.ok === false ? (data.error || '读取目的状态失败') : '',
        });
        return;
      }
      if (suffix === '/preview' && method === 'POST') {
        if (carrier === 'pet') {
          const result = await petPurpose.preview();
          json(res, result.ok ? 200 : 400, { ...result, source: 'pet', carrier: 'pet', availability });
          return;
        }
        if (!availability.qq.running) {
          json(res, 409, { ok: false, error: 'QQ 桥接没在运行，无法预览 QQ 载体的目的回合', availability });
          return;
        }
        const remote = await callBridge('/api/purpose/preview', { method: 'POST', body: {}, timeoutMs: 20000 });
        json(res, remote?.status || 200, { ...(remote?.data ?? {}), source: 'qq', carrier: 'qq', availability });
        return;
      }
      if (suffix === '/run' && method === 'POST') {
        const body = JSON.parse((await readBody(req)) || '{}');
        if (carrier === 'pet') {
          const result = await petPurpose.run({ force: body.force !== false });
          json(res, result.ok ? 200 : 409, { ...result, source: 'pet', carrier: 'pet', availability });
          return;
        }
        if (!availability.qq.running) {
          json(res, 409, { ok: false, error: 'QQ 桥接没在运行，无法让 QQ 载体出发', availability });
          return;
        }
        const remote = await callBridge('/api/purpose/run', { method: 'POST', body: { force: body.force !== false }, timeoutMs: 30000 });
        json(res, remote?.status || 200, { ...(remote?.data ?? {}), source: 'qq', carrier: 'qq', availability });
        return;
      }
      if (suffix === '/pet-chat' && method === 'POST') {
        // 设置页测一句话（不占主动搭话额度）。
        const body = JSON.parse((await readBody(req)) || '{}');
        const result = await petChat.chat({ text: body.text || '在吗', modality: body.modality === 'voice' ? 'voice' : 'text' });
        json(res, result.ok ? 200 : 400, result);
        return;
      }
      json(res, 404, { ok: false, error: `未知目的接口：${suffix}` });
    } catch (error) {
      json(res, 500, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 一键启动 / 停止（概览、QQ、B站、桌宠、语音共用同一份状态）────────────
  const LAUNCH_IDS = ['qq', 'bili', 'pet', 'voice', 'vector'];
  const LAUNCH_LABELS = { qq: 'QQ（含 SnowLuma）', bili: 'B站', pet: '桌宠', voice: '语音', vector: '向量记忆' };

  function normalizeLaunchComponents(input) {
    const list = Array.isArray(input) ? input : [];
    const picked = list.map((x) => String(x)).filter((x) => LAUNCH_IDS.includes(x));
    return [...new Set(picked)];
  }

  async function voicePacksSnapshot() {
    const bridge = await bridgeStatus().catch(() => ({ running: false }));
    if (!bridge.running) return { ok: false, running: false, packs: [], error: 'QQ 桥接未运行，无法读取语音包状态', code: 'VOICE_BRIDGE_DOWN' };
    try {
      const r = await callBridge('/api/voice/packs', { timeoutMs: 8000 });
      const packs = Array.isArray(r?.data?.packs) ? r.data.packs : [];
      const running = packs.find((p) => p.running) || null;
      return { ok: true, running: Boolean(running), id: running?.id || '', packs, bridge };
    } catch (error) {
      return { ok: false, running: false, packs: [], bridge, error: `读取语音包状态失败：${String(error?.message ?? error).slice(0, 160)}`, code: 'VOICE_STATUS_FAILED' };
    }
  }

  async function launchStatus() {
    const bridge = await bridgeStatus().catch((error) => ({ running: false, error: String(error?.message ?? error) }));
    let voice = { ok: false, running: false, packs: [], id: '', error: bridge.running ? '' : 'QQ 桥接未运行' };
    if (bridge.running) voice = await voicePacksSnapshot();
    const pet = petService.status();
    let vector = { ok: false, running: false, models: [], providers: [], selected: '', provider: '', model: '', modelSpace: '' };
    try {
      const vp = embeddingPacksStatus();
      vector = {
        ok: vp.service?.ok === true,
        running: vp.service?.ok === true,
        selected: String(vp.config?.packId || ''),
        provider: String(vp.config?.provider || ''),
        cloudActive: String(vp.cloudConfig?.active || ''),
        model: String(vp.config?.model || ''),
        modelSpace: String(vp.config?.modelSpace || ''),
        models: (vp.models ?? []).map((m) => ({ id: m.id, name: m.name || m.id, valid: m.valid === true, modelSpace: m.modelSpace || '' })),
        providers: Object.entries(vp.cloudConfig?.providers ?? {}).map(([id, p]) => ({
          id, hasKey: p?.hasKey === true, model: p?.model || '', modelSpace: p?.modelSpace || '',
        })),
        lastError: vp.service?.ok === true ? null : (vp.service?.error || 'Embedding runtime 未启动'),
      };
    } catch (error) {
      vector.lastError = String(error?.message ?? error).slice(0, 200);
    }
    return {
      qq: {
        running: Boolean(bridge.running),
        ok: Boolean(bridge.running && bridge.ok !== false),
        port: bridge.port ?? null,
        pid: bridge.pid ?? bridge.lockPid ?? null,
        snowluma: bridge.snowluma ?? null,
        lastError: bridge.error ?? null,
      },
      bili: {
        running: Boolean(scheduler && schedulerStatus.running),
        lastError: schedulerStatus.lastError ?? null,
        reason: schedulerStatus.reason ?? '',
      },
      pet: {
        running: Boolean(pet.running),
        installed: Boolean(pet.installed),
        pid: pet.pid ?? null,
        lastError: pet.lastError ?? null,
      },
      voice: {
        ok: voice.ok !== false,
        running: Boolean(voice.running),
        id: voice.id || '',
        installed: (voice.packs ?? []).filter((p) => p.installed).map((p) => p.id),
        packs: (voice.packs ?? []).map((p) => ({ id: p.id, installed: Boolean(p.installed), running: Boolean(p.running), name: p.name || p.id })),
        lastError: voice.error || null,
      },
      vector,
    };
  }

  function launchItem(id, ok, extra = {}) {
    return { id, label: LAUNCH_LABELS[id] || id, ok: ok !== false, ...extra };
  }

  async function startComponent(id, opts = {}) {
    try {
      if (id === 'vector') {
        const pick = String(opts.vectorPack || '').trim();
        if (pick.startsWith('local:')) {
          const selected = selectEmbeddingPack(pick.slice('local:'.length));
          if (!selected.ok) return launchItem(id, false, { ...selected, error: selected.error || '选择本地模型失败' });
        } else if (pick.startsWith('cloud:')) {
          const activated = activateCloudProvider(pick.slice('cloud:'.length));
          if (!activated.ok) return launchItem(id, false, { ...activated, error: activated.error || '启用云端服务商失败' });
          // 云端 endpoint/key 是启动时注入 runtime 的环境变量，已运行的服务必须重启才会换 provider。
          if (embeddingPacksStatus().service?.ok) {
            const stopped = await stopEmbeddingRuntime();
            if (!stopped.ok) return launchItem(id, false, { ...stopped, error: stopped.error || '停止旧 Embedding runtime 失败' });
          }
        }
        const started = await startEmbeddingRuntime();
        if (!started.ok) return launchItem(id, false, { ...started, error: started.error || 'Embedding runtime 启动失败' });
        if (started.verified === false) {
          return launchItem(id, false, {
            code: 'VECTOR_SELF_TEST_FAILED',
            error: `runtime 已启动但自检失败：${started.verification?.error || '未知错误'}`,
            hint: '检查模型包/云端 Key 后重试；没有通过自检不会切换到向量记忆',
          });
        }
        saveUnified({ memory: { mode: 'vector' } });
        return launchItem(id, true, { message: `向量记忆已启用${pick ? `（${pick}）` : ''}` });
      }
      if (id === 'qq') {
        if (!platformStartEnabled('qq')) {
          return launchItem(id, false, { code: 'PLATFORM_DISABLED', error: 'QQ 启动开关已关闭', hint: '去「QQ」页打开「启动 QQ」并保存' });
        }
        const status = await bridgeStatus();
        const stale = bridgeStaleReason(status);
        const bridge = stale ? await restartBridge({ dshWebUrl: currentDshUrl() }) : await startBridge({ dshWebUrl: currentDshUrl() });
        const snowluma = await launchSnowLuma({ openWebui: false, hideConsoles: opts.hideConsoles === true }).catch((error) => ({ ok: false, error: String(error?.message ?? error), hint: '检查 SnowLuma 安装目录/允许插件打开设置' }));
        const bridgeOk = bridge?.ok !== false;
        const snowOk = snowluma?.ok !== false || snowluma?.skipped === true || snowluma?.already === true;
        return launchItem(id, bridgeOk && snowOk, {
          message: [bridge?.message, snowluma?.message || snowluma?.error].filter(Boolean).join('；'),
          code: bridgeOk && snowOk ? '' : (bridgeOk ? (snowluma?.code || 'QQ_START_PARTIAL') : (bridge?.code || 'QQ_BRIDGE_START_FAILED')),
          error: bridgeOk ? (snowOk ? '' : `QQ 桥接已启动，但 SnowLuma 未打开：${snowluma?.error || '未知原因'}`) : (bridge?.error || bridge?.message || 'QQ 桥接启动失败'),
          hint: bridgeOk ? (snowOk ? '' : (snowluma?.hint || '启动 SnowLuma（launcher.bat）并确认端口 3000/3001')) : '检查桥接日志/端口；必要时重启 DSH',
          needsAccount: snowluma?.needsAccount === true,
          webui: snowluma?.webui || null,
          detail: { bridge, snowluma },
        });
      }
      if (id === 'bili') {
        if (!platformStartEnabled('bili')) {
          return launchItem(id, false, { code: 'PLATFORM_DISABLED', error: 'B站 启动开关已关闭', hint: '去「B站」页打开「启动 B站」并保存' });
        }
        const state = startSchedulerNow();
        return launchItem(id, state.running === true, {
          code: state.running ? '' : 'BILI_START_FAILED',
          error: state.running ? '' : `B站生物钟未启动：${state.reason || state.lastError || '未登录或配置缺失'}`,
          hint: state.running ? '' : '先在「B站」页完成扫码登录；仍失败看插件日志',
          detail: state,
        });
      }
      if (id === 'pet') {
        const result = await petService.start();
        return launchItem(id, result?.ok !== false, {
          code: result?.ok === false ? 'PET_START_FAILED' : '',
          error: result?.ok === false ? (result.error || '桌宠启动失败') : '',
          hint: result?.ok === false ? (result.hint || '先在「桌宠」页安装桌宠/Electron') : '',
          detail: result,
        });
      }
      if (id === 'voice') {
        const bridge = await bridgeStatus().catch(() => ({ running: false }));
        if (!bridge.running) {
          return launchItem(id, false, { code: 'VOICE_BRIDGE_DOWN', error: '语音包由 QQ 桥接托管，桥接未运行', hint: '同时勾选「QQ（含 SnowLuma）」或先启动 QQ' });
        }
        const packs = await voicePacksSnapshot();
        const wanted = String(opts.voicePack === 'voice-cloud' ? 'voice-cloud' : 'voice-local');
        const pack = (packs.packs ?? []).find((p) => p.id === wanted);
        if (!pack) return launchItem(id, false, { code: 'VOICE_PACK_UNKNOWN', error: `未知语音包：${wanted}`, hint: '在「语音」页确认包 ID' });
        if (!pack.installed) return launchItem(id, false, { code: 'VOICE_PACK_NOT_INSTALLED', error: `${pack.name || wanted} 还没安装`, hint: '先在「语音」页导入离线包或安装语音包' });
        const r = await callBridge('/api/voice/packs/activate', { method: 'POST', body: { id: wanted }, timeoutMs: 90_000 });
        const data = r?.data ?? {};
        return launchItem(id, r?.ok !== false && data.ok !== false, {
          code: data.ok === false ? 'VOICE_START_FAILED' : '',
          error: data.ok === false ? (data.error || '语音包启动失败') : '',
          hint: data.ok === false ? (data.hint || '检查语音包是否装好、端口 8765/8767 是否被占用') : '',
          detail: { packId: wanted, ...data },
        });
      }
      return launchItem(id, false, { code: 'UNKNOWN_COMPONENT', error: `未知启动项：${id}` });
    } catch (error) {
      return launchItem(id, false, {
        code: `${String(id).toUpperCase()}_START_FAILED`,
        error: `${LAUNCH_LABELS[id] || id} 启动失败：${String(error?.message ?? error).slice(0, 300)}`,
        hint: '看设置页状态/日志；修复后重试',
      });
    }
  }

  async function stopComponent(id, opts = {}) {
    try {
      if (id === 'vector') {
        const r = await stopEmbeddingRuntime();
        saveUnified({ memory: { mode: 'narrative' } });
        return launchItem(id, r?.ok !== false, {
          message: '向量记忆已停止，读取方式切回叙事记忆',
          code: r?.ok === false ? 'VECTOR_STOP_FAILED' : '',
          error: r?.ok === false ? (r.error || 'Embedding runtime 停止失败') : '',
          hint: r?.ok === false ? '看 embedding runtime 日志/手动结束进程' : '',
        });
      }
      if (id === 'qq') {
        const r = await stopBridge();
        return launchItem(id, r?.ok !== false, {
          message: 'QQ 桥接已停止（SnowLuma 本体不会被本程序关闭）',
          code: r?.ok === false ? 'QQ_STOP_FAILED' : '',
          error: r?.ok === false ? (r.error || 'QQ 桥接停止失败') : '',
          hint: r?.ok === false ? '看桥接日志/手动结束残留进程' : '',
          detail: r,
        });
      }
      if (id === 'bili') {
        const r = stopSchedulerNow();
        return launchItem(id, true, { message: r.wasRunning ? 'B站生物钟已停止' : 'B站生物钟本来就没在跑', detail: r });
      }
      if (id === 'pet') {
        const r = await petService.stop();
        return launchItem(id, r?.ok !== false, {
          code: r?.ok === false ? 'PET_STOP_FAILED' : '',
          error: r?.ok === false ? (r.error || '桌宠停止失败') : '',
          hint: r?.ok === false ? '在「桌宠」页重试，或手动结束进程' : '',
          detail: r,
        });
      }
      if (id === 'voice') {
        const bridge = await bridgeStatus().catch(() => ({ running: false }));
        if (!bridge.running) return launchItem(id, true, { message: 'QQ 桥接未运行，语音包无需单独停止' });
        const packs = await voicePacksSnapshot();
        const running = (packs.packs ?? []).filter((p) => p.running);
        if (!running.length) return launchItem(id, true, { message: '语音包本来就没在跑' });
        const results = [];
        for (const p of running) {
          const r = await callBridge('/api/voice/packs/stop', { method: 'POST', body: { id: p.id }, timeoutMs: 30_000 });
          results.push({ id: p.id, ok: r?.ok !== false && r?.data?.ok !== false, error: r?.data?.error || r?.error || '' });
        }
        const failed = results.find((x) => !x.ok);
        return launchItem(id, !failed, {
          code: failed ? 'VOICE_STOP_FAILED' : '',
          error: failed ? (failed.error || `语音包 ${failed.id} 停止失败`) : '',
          hint: failed ? '检查端口占用；必要时在「语音」页手动停止' : '',
          detail: results,
        });
      }
      return launchItem(id, false, { code: 'UNKNOWN_COMPONENT', error: `未知停止项：${id}` });
    } catch (error) {
      return launchItem(id, false, {
        code: `${String(id).toUpperCase()}_STOP_FAILED`,
        error: `${LAUNCH_LABELS[id] || id} 停止失败：${String(error?.message ?? error).slice(0, 300)}`,
        hint: '看设置页状态/日志；必要时手动结束进程',
      });
    }
  }

  async function runLaunchAction(action, body) {
    const ids = normalizeLaunchComponents(body.components);
    if (!ids.length) {
      return { ok: false, code: 'NO_COMPONENTS', error: '没有选择要启动/停止的项目', hint: '至少勾选一项', items: [], status: await launchStatus() };
    }
    const items = [];
    // 停止时先停语音（它由 QQ 桥接托管），再停桥接；否则桥接先死，语音进程会变成孤儿。
    const ordered = action === 'stop' ? ['voice', 'qq', 'bili', 'pet', 'vector'].filter((id) => ids.includes(id)) : ids;
    for (const id of ordered) {
      items.push(action === 'stop' ? await stopComponent(id, body) : await startComponent(id, body));
    }
    const status = await launchStatus();
    return { ok: items.every((x) => x.ok), items, status };
  }

  async function handleBridge(req, res) {
    if (req.method === 'GET') { json(res, 200, { ok: true, status: await bridgeStatus() }); return; }
    const body = JSON.parse(await readBody(req) || '{}');
    const action = String(body.action ?? 'status');
    if (action === 'status') { json(res, 200, { ok: true, status: await bridgeStatus() }); return; }
    if (action === 'start') {
      if (!platformStartEnabled('qq')) {
        json(res, 409, { ok: false, error: 'QQ 启动开关已关闭：去「QQ」页打开「启动 QQ」并保存' });
        return;
      }
      json(res, 200, await startBridge({ dshWebUrl: currentDshUrl() }));
      return;
    }
    if (action === 'start-qq') {
      // 概览的「启动 QQ」：桥接 + 按需打开 SnowLuma（仍是用户显式点击，不自动弹）。
      if (!platformStartEnabled('qq')) {
        json(res, 409, { ok: false, error: 'QQ 启动开关已关闭：去「QQ」页打开「启动 QQ」并保存' });
        return;
      }
      const bridge = await startBridge({ dshWebUrl: currentDshUrl() });
      const snowluma = await launchSnowLuma();
      json(res, 200, {
        ok: bridge?.ok !== false,
        message: [bridge?.message, snowluma?.message || snowluma?.error].filter(Boolean).join('；'),
        bridge,
        snowluma,
      });
      return;
    }
    if (action === 'start-bili') {
      if (!platformStartEnabled('bili')) {
        json(res, 409, { ok: false, error: 'B站 启动开关已关闭：去「B站」页打开「启动 B站」并保存' });
        return;
      }
      const running = Boolean(scheduler && schedulerStatus.running);
      const schedulerState = startSchedulerNow();
      json(res, 200, {
        ok: schedulerState.running === true,
        message: running ? 'B站生物钟本来就在跑' : (schedulerState.running ? 'B站生物钟已启动' : `B站生物钟未启动：${schedulerState.lastError ?? '看插件日志'}`),
        scheduler: schedulerState,
      });
      return;
    }
    if (action === 'start-selected' || action === 'start-components') {
      json(res, 200, await runLaunchAction('start', body));
      return;
    }
    if (action === 'stop-selected' || action === 'stop-components') {
      json(res, 200, await runLaunchAction('stop', body));
      return;
    }
    if (action === 'start-all') {
      // 一键启动：按平台启动开关拉起 QQ 桥接 / B站生物钟；QQ 打开时才尝试打开 SnowLuma。
      const starts = platformStartState();
      const status = await bridgeStatus();
      const stale = bridgeStaleReason(status);
      const dshWebUrl = currentDshUrl();
      const bridge = starts.qq
        ? (stale ? await restartBridge({ dshWebUrl }) : await startBridge({ dshWebUrl }))
        : { ok: true, skipped: true, message: 'QQ 启动开关关闭，已跳过桥接' };
      const schedulerState = starts.bili
        ? startSchedulerNow()
        : { ...idleSchedulerStatus('disabled'), message: 'B站 启动开关关闭，已跳过生物钟' };
      const snowluma = starts.qq ? await launchSnowLuma() : { ok: true, skipped: true, message: 'QQ 启动开关关闭，已跳过 SnowLuma' };
      const coreOk = (!starts.qq || bridge?.ok !== false) && (!starts.bili || schedulerState.running);
      const message = [
        bridge?.message,
        starts.bili ? (schedulerState.running ? 'B站生物钟在跑' : 'B站生物钟未启动') : '',
        snowluma?.message || snowluma?.error,
        starts.qq || starts.bili ? '启动完成后会弹窗告诉你结果' : 'QQ 和 B站 的启动开关都关着，没有需要启动的平台',
      ].filter(Boolean).join('；');
      json(res, 200, {
        ok: coreOk,
        pending: starts.qq || starts.bili,
        message,
        bridge,
        scheduler: schedulerState,
        snowluma,
        platformStart: starts,
      });
      if (starts.qq || starts.bili) void watchStartupCompletion(starts);
      return;
    }
    if (action === 'start-snowluma') {
      json(res, 200, await launchSnowLuma());
      return;
    }
    if (action === 'stop-snowluma') {
      json(res, 200, await stopSnowLuma());
      return;
    }
    if (action === 'detect-snowluma') {
      // 可选 path：用户点「浏览…」选了解压目录/app 目录/launcher.bat 时，**只验证这个路径**——
      // 用户明确选了一个，就不能悄悄回退去猜别的目录（否则会"检测成功"但保存的是另一份安装）。
      const picked = String(body.path ?? '').trim();
      const direct = picked ? normalizeSnowLumaInstall(picked) : null;
      const found = picked
        ? (direct ? { ok: true, ...direct, tried: [{ path: picked, ok: true }] } : { ok: false, tried: [{ path: picked, ok: false }] })
        : findSnowLumaInstall();
      if (!found.ok) {
        // 失败必须有结构化报告：code + 人读的 error + 下一步 hint + 试过的路径（AGENTS 1.7）。
        const report = snowLumaMissingReport({ picked, tried: found.tried.map((x) => x.path).slice(0, 12) });
        json(res, 200, { ok: false, code: report.code, title: report.title, error: report.error, hint: report.hint, tried: report.tried });
        return;
      }
      saveQqConfig({ snowluma: { launcherPath: found.root, allowLaunch: true } });
      json(res, 200, { ok: true, found: true, path: found.root, launcher: found.launcher, message: `已找到 SnowLuma：${found.root}` });
      return;
    }
    if (action === 'stop') { json(res, 200, await stopBridge()); return; }
    if (action === 'restart') {
      if (!platformStartEnabled('qq')) {
        json(res, 409, { ok: false, error: 'QQ 启动开关已关闭：先在「QQ」页打开「启动 QQ」并保存' });
        return;
      }
      json(res, 200, await restartBridge({ dshWebUrl: currentDshUrl() }));
      return;
    }
    if (action === 'greeting-test') {
      const result = await callBridge('/api/greeting/test', { method: 'POST', body: {} });
      json(res, result.status || 200, result.data ?? { ok: result.ok, error: result.error });
      return;
    }
    // 目的机制：状态 / 只读预览 / 立刻试一次（真发，设置页会先 confirm）。
    if (action === 'purpose-status') {
      const result = await callBridge('/api/purpose/status', { timeoutMs: 8000 });
      json(res, result.status || 200, result.data ?? { ok: result.ok, error: result.error });
      return;
    }
    if (action === 'purpose-preview') {
      const result = await callBridge('/api/purpose/preview', { method: 'POST', body: {}, timeoutMs: 20000 });
      json(res, result.status || 200, result.data ?? { ok: result.ok, error: result.error });
      return;
    }
    if (action === 'purpose-run') {
      const result = await callBridge('/api/purpose/run', { method: 'POST', body: { force: true }, timeoutMs: 25000 });
      json(res, result.status || 200, result.data ?? { ok: result.ok, error: result.error });
      return;
    }
    // 本地判断（免费漏斗）：设置页开真拦之前先看"会拦掉多少"。
    if (action === 'local-filter') {
      const result = await callBridge('/api/socialV2/local-filter', { timeoutMs: 8000 });
      json(res, result.status || 200, result.data ?? { ok: result.ok, error: result.error });
      return;
    }
    // 花费与会话（2026-11-04）：会话页要一张表回答"今天谁在烧钱、要不要换会话"。
    if (action === 'token-summary') {
      const since = Number.isFinite(Number(body.since)) ? Number(body.since) : '';
      const qs = since === '' ? '' : `?since=${Math.max(0, Math.round(since))}`;
      const result = await callBridge(`/api/tokens/summary${qs}`, { timeoutMs: 15000 });
      json(res, result.status || 200, result.data ?? { ok: result.ok, error: result.error });
      return;
    }
    if (action === 'session-list') {
      const result = await callBridge('/api/sessions', { timeoutMs: 8000 });
      json(res, result.status || 200, result.data ?? { ok: result.ok, error: result.error });
      return;
    }
    if (action === 'session-reset') {
      const key = String(body.key ?? '').trim();
      if (!key) { json(res, 400, { ok: false, error: '缺少 key', hint: '先刷新会话列表再点换会话' }); return; }
      const result = await callBridge('/api/session/reset', { method: 'POST', body: { key }, timeoutMs: 20000 });
      json(res, result.status || 200, result.data ?? { ok: result.ok, error: result.error });
      return;
    }
    if (action === 'refresh-bili') { json(res, 200, await refreshBiliToQq({ callBridge })); return; }
    json(res, 400, { ok: false, error: '未知 action' });
  }

  // ── B站动作：依赖体检 / cookie / 待审 / 通知测试 ────────────────────────
  function runBili(args, timeoutMs = 120_000) {
    return new Promise((resolve) => {
      execFile(findNodeExe(), [BILI_MJS, ...args], {
        cwd: BILI_TOOLS_DIR,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      }, (error, stdout, stderr) => resolve({
        ok: !error,
        code: error?.code ?? 0,
        out: String(stdout ?? '').slice(-20_000),
        err: String(stderr ?? '').slice(-4000),
      }));
    });
  }

  // ── QQ 鱼群保护（设置页「最近触发」）────────────────────────────────────
  // 桥接把每次新触发写进 social-v2.json 的 fishGuardLog（每群最多 30 条）；
  // 设置页只读这个文件，不再靠翻活动日志。见 PITFALLS #30 / #31。
  function handleQqFishGuard(res) {
    try {
      const file = path.join(QQ_STATE_DIR(), 'social-v2.json');
      const data = readJson(file, {}) ?? {};
      const summary = summarizeQqFishGuard(data, { now: Date.now() });
      json(res, 200, {
        ok: true,
        file,
        now: new Date().toISOString(),
        ...summary,
        config: readQqConfig().config?.fishGuard ?? {},
      });
    } catch (error) {
      json(res, 500, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 观看历史（设置页「观看历史」）───────────────────────────────────────
  // 数据来自当前角色 bili/watch-history.jsonl；旧数据从 bili-memory.json 补。
  function handleWatchHistory(res, url) {
    try {
      const current = readCurrentCharacter();
      const data = readWatchHistory({
        limit: Number(url.searchParams.get('limit')) || 200,
        q: url.searchParams.get('q') ?? '',
        days: Number(url.searchParams.get('days')) || 0,
      });
      // 2026-10-23 用户要求：每条看过之后她做了什么（评论怎么发的/收藏/动态）。
      const enriched = enrichWatchHistory(data.items);
      json(res, 200, {
        ok: true,
        character: current ? { id: current.id, name: current.name, epoch: current.epoch } : null,
        ...data,
        items: enriched.items,
        actions: enriched.actions,
      });
    } catch (error) {
      json(res, 500, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 偏好关键词扫描（设置页「口味权重 / 一键抓取」）──────────────────────
  // 只读：从当前账号的观看历史 / 收藏夹 + 本地记录里抽候选词，不写配置、不外发。
  async function handlePreferenceScan(res, url) {
    const raw = String(url.searchParams.get('sources') ?? '').trim();
    const sources = raw
      ? raw.split(/[,，]/).map((item) => item.trim()).filter(Boolean)
      : undefined;
    const target = ['fish', 'owner', 'both'].includes(String(url.searchParams.get('target') ?? ''))
      ? String(url.searchParams.get('target'))
      : 'fish';
    const limit = Math.max(4, Math.min(60, Number(url.searchParams.get('limit')) || 24));
    let timer = null;
    try {
      const result = await Promise.race([
        scanPreferences({ sources, limit, target }),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('扫描超时（20 秒）：网络太慢，可先在命令行跑 prefs scan')), 20_000);
          timer.unref?.();
        }),
      ]);
      json(res, 200, result);
    } catch (error) {
      json(res, 500, { ok: false, error: String(error?.message ?? error) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function handleBili(req, res, url) {
    const pathname = url.pathname;
    if (req.method === 'GET' && pathname.endsWith('/fish-guard')) {
      const dir = activePlatformStateDir(BILI_DIR);
      const stateFile = path.join(dir, 'fish-guard.json');
      const state = readJson(stateFile, {}) ?? {};
      const cfg = readBiliConfig().config?.fishGuard ?? {};
      const current = readCurrentCharacter();
      json(res, 200, {
        ok: true,
        character: current ? { id: current.id, name: current.name, epoch: current.epoch } : null,
        credentials: fs.existsSync(BILI_CRED),
        stateFile,
        fishGuard: fishGuardStateSummary(state, cfg),
      });
      return;
    }
    if (req.method === 'POST' && pathname.endsWith('/session-permission')) {
      // 手动修复：把当前角色的 B站 会话切到配置的权限（默认 danger-full-access）。
      // 定时器也会自动做；这个按钮用于「现在就想让她能跑命令」时立刻生效。
      const body = JSON.parse(await readBody(req) || '{}');
      const current = readCurrentCharacter();
      const sessionId = current ? `bili-whale-${current.id}` : 'bili-whale';
      const target = String(body.target ?? readBiliConfig().config?.agent?.sandbox ?? 'danger-full-access');
      let inspected = false;
      try {
        if (ctx.sessionController?.inspect) { await ctx.sessionController.inspect(sessionId); inspected = true; }
      } catch (error) {
        pluginLog(`[权限] inspect ${sessionId} 失败：${error?.message ?? error}`);
      }
      // inspect 之后 session 可能还没同步进 ctx.sessions。
      if (inspected) await new Promise((resolve) => setTimeout(resolve, 120));
      const result = applySessionPermission(ctx, sessionId, target, (message) => pluginLog(message));
      json(res, 200, {
        ok: result.ok,
        sessionId,
        target,
        inspected,
        ...result,
        message: result.ok
          ? (result.changed ? `已切到 ${target}` : `已经是 ${target}`)
          : ({
            'session-not-active': '会话还没挂上（等下一次醒来会自动设置）',
            'permission-services-unavailable': 'DSH 没有提供 permissionPresets 服务',
            'set-failed': `设置失败：${result.error ?? '未知错误'}`,
          }[result.reason] ?? result.reason),
      });
      return;
    }
    if (req.method === 'GET' && pathname.endsWith('/deps')) {
      const result = await runBili(['deps', '--json'], 60_000);
      let parsed = null;
      try { parsed = JSON.parse(result.out); } catch {}
      json(res, 200, { ok: parsed?.ok === true, ...(parsed ?? {}), raw: result.out.slice(0, 2000), err: result.err });
      return;
    }
    if (req.method === 'GET' && pathname.endsWith('/pending')) {
      const file = path.join(BILI_AI_DIR, 'pending-replies.json');
      const data = readJson(file, { items: [] }) ?? { items: [] };
      json(res, 200, { ok: true, items: data.items ?? [] });
      return;
    }
    if (req.method === 'GET' && pathname.endsWith('/automation')) {
      json(res, 200, automationSnapshot());
      return;
    }
    if (req.method === 'POST' && pathname.endsWith('/timeout-mute')) {
      try {
        const body = JSON.parse((await readBody(req)) || '{}');
        const code = String(body.code ?? '').trim();
        if (!/^[A-Z0-9_]{3,80}$/.test(code)) {
          json(res, 400, { ok: false, code: 'TIMEOUT_MUTE_CODE', error: '无效的超时错误码', hint: '刷新错误报告后重试' });
          return;
        }
        const current = readBiliConfig().config;
        const notify = current.notify && typeof current.notify === 'object' ? current.notify : {};
        const list = Array.isArray(notify.timeoutMutes) ? notify.timeoutMutes.map(String) : [];
        const next = { ...current, notify: { ...notify, timeoutMutes: [...new Set([...list, code])].slice(0, 50) } };
        saveBiliConfig(next);
        json(res, 200, { ok: true, code, muted: true, count: next.notify.timeoutMutes.length });
      } catch (error) {
        json(res, 500, { ok: false, code: 'TIMEOUT_MUTE_SAVE', error: `保存超时静音失败：${error?.message ?? error}`, hint: '检查 bili.config.json 是否可写' });
      }
      return;
    }
    if (req.method === 'GET' && pathname.endsWith('/notify-config')) {
      const cfg = readBiliConfig().config;
      json(res, 200, { ok: true, notify: cfg.notify, listen: cfg.listen, share: cfg.share, quota: cfg.quota });
      return;
    }
    // 「立即分享一次」：转发到桥接控制台的 /api/bili/share-now。
    // 这是**真的会发到群**的操作，UI 侧必须二次确认；这里只做代理，不自己挑素材。
    if (req.method === 'POST' && pathname.endsWith('/share-now')) {
      const result = await callBridge('/api/bili/share-now', { method: 'POST', body: {}, timeoutMs: 120_000 });
      const payload = result.data ?? {};
      // 桥接返回 { ok, result: { ok, sent, card, why } }；这里摊平成 UI 好用的形状。
      const inner = payload.result ?? payload;
      // 留一行日志：点「立即分享一次」后出问题时，能直接看到是桥接没响应还是桥接拒绝。
      pluginLog(`「立即分享一次」bridge=${result.status} ok=${result.ok} sent=${inner.sent ?? 0}`
        + `${inner.card?.bvid ? ` bvid=${inner.card.bvid}` : ''}`
        + `${result.ok ? '' : ` error=${result.error || payload.error || 'unknown'}`}`);
      json(res, result.ok ? 200 : 502, {
        ok: result.ok && payload.ok !== false && inner.ok !== false,
        sent: Number(inner.sent ?? 0),
        card: inner.card ?? null,
        ...(inner.why ? { why: inner.why } : {}),
        ...(result.ok ? {} : { error: result.error || payload.error || '桥接没有响应' }),
      });
      return;
    }
    if (req.method === 'GET' && pathname.endsWith('/accounts')) {
      const cfg = readBiliConfig().config ?? {};
      const fish = readFishAccount();
      // 旧 credentials.json 只有 sessdata/bili_jct/buvid3；mid/昵称回落到配置里的 self。
      if (fish.configured && !fish.mid && cfg.self?.mid) {
        fish.mid = String(cfg.self.mid);
        fish.name = String(cfg.self.name ?? '');
      }
      json(res, 200, {
        ok: true,
        fish,
        owner: readOwnerAccount(),
        expected: {
          self: { mid: String(cfg.self?.mid ?? ''), name: String(cfg.self?.name ?? '') },
          owner: { mid: String(cfg.owner?.mid ?? ''), name: String(cfg.owner?.name ?? '') },
        },
      });
      return;
    }
    if (req.method === 'GET' && pathname.endsWith('/qr/poll')) {
      const id = String(url.searchParams.get('id') ?? '').trim();
      if (!/^qr_[0-9a-f-]{36}$/i.test(id)) { json(res, 400, { ok: false, error: 'id 不合法' }); return; }
      const result = await pollQrLogin(id);
      // ok:false 也是有效状态（wrong-account/failed），用 200 让前端按 status 处理。
      json(res, 200, result);
      return;
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 GET/POST' }); return; }
    const body = JSON.parse(await readBody(req) || '{}');
    const action = String(body.action ?? '');
    if (pathname.endsWith('/qr/start')) {
      const target = body.target === 'fish' ? 'fish' : 'owner';
      const cfg = readBiliConfig().config ?? {};
      const expected = target === 'owner'
        ? { mid: String(cfg.owner?.mid ?? ''), name: String(cfg.owner?.name ?? '') }
        : { mid: String(cfg.self?.mid ?? ''), name: String(cfg.self?.name ?? '') };
      try {
        pluginLog(`[扫码登录] 打开 B站 登录页 target=${target}`);
        const result = await startQrLogin({
          target,
          expectedMid: expected.mid,
          expectedName: expected.name,
          allowSameAsOwner: body.allowSameAsOwner === true,
        });
        json(res, 200, { ok: true, ...result });
      } catch (error) {
        pluginLog(`[扫码登录] 打开失败：${String(error?.message ?? error)}`);
        json(res, 503, {
          ok: false, code: 'bili.qr-start-failed',
          error: String(error?.message ?? error),
          hint: '确认本机有 Edge（扫码用 headless Edge 打开 B站 登录页）；再试一次或重启 DSH 后重试',
        });
      }
      return;
    }
    // 核查已登录账号：读文件 → 再问一次 B站 nav → 核对 mid（不是只信扫码那一刻）。
    if (pathname.endsWith('/account/verify')) {
      const target = body.target === 'fish' ? 'fish' : 'owner';
      try {
        const result = await verifyStoredCredentials(target);
        json(res, 200, { ok: result.ok, target, ...result });
      } catch (error) {
        json(res, 500, {
          ok: false, code: 'bili.verify-failed',
          error: `核查失败：${String(error?.message ?? error).slice(0, 160)}`,
          hint: '确认网络能访问 api.bilibili.com 后重试；持续失败请重新扫码',
        });
      }
      return;
    }

    // 核查「UID 与昵称是否同一个人」：查 B站 公开名片，把真实昵称带回来比对。
    if (pathname.endsWith('/verify-user')) {
      const mid = String(body.mid ?? '').trim();
      const name = String(body.name ?? '').trim();
      if (!/^\d{4,20}$/.test(mid)) {
        json(res, 400, {
          ok: false, code: 'bili.mid-invalid',
          error: `「${mid || '(空)'}」不是合法的 B站 UID`,
          hint: 'B站 UID 是 4~20 位数字（在个人空间地址 space.bilibili.com/<数字> 里能看到）',
        });
        return;
      }
      try {
        const res2 = await fetch(`https://api.bilibili.com/x/web-interface/card?mid=${encodeURIComponent(mid)}`, {
          headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36', referer: 'https://www.bilibili.com/' },
          signal: AbortSignal.timeout(10_000),
        });
        const jsonBody = await res2.json().catch(() => null);
        const actual = jsonBody?.data?.card;
        if (!res2.ok || !actual?.mid) {
          json(res, 200, {
            ok: false, code: 'bili.user-not-found',
            error: `B站 查不到 UID ${mid}${jsonBody?.code ? `（code ${jsonBody.code}）` : ''}`,
            hint: '核对 UID 是否填错（个人空间地址里的数字）；B站 偶发风控时稍后重试',
          });
          return;
        }
        const actualName = String(actual.name ?? '');
        const match = !name || actualName.trim() === name.trim();
        json(res, 200, {
          ok: true, mid: String(actual.mid), actualName, inputName: name, match,
          error: match ? '' : `昵称对不上：UID ${mid} 的 B站 昵称是「${actualName}」，你填的是「${name}」`,
          hint: match ? '' : '点「用 B站 昵称填上」自动改正；或确认 UID 是否填成了别人的',
        });
      } catch (error) {
        json(res, 200, {
          ok: false, code: 'bili.verify-network',
          error: `查询 B站 失败：${String(error?.message ?? error).slice(0, 160)}`,
          hint: '检查网络能否访问 api.bilibili.com；稍后重试',
        });
      }
      return;
    }

    // 换 B站 号：把旧凭据/对齐归档后清掉，允许重新扫码绑定（2026-10-27 用户反馈"换号被卡死"）
    if (pathname.endsWith('/account/reset')) {
      const target = body.target === 'owner' ? 'owner' : (body.target === 'both' ? 'both' : 'fish');
      const archived = [];
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const destDir = path.join(BACKUP_DIR, `bili-switch-${stamp}`);
      const archive = (file, label) => {
        try {
          if (!fs.existsSync(file)) return;
          fs.mkdirSync(destDir, { recursive: true });
          const dest = path.join(destDir, `${label}${path.extname(file) || '.json'}`);
          fs.copyFileSync(file, dest);
          archived.push(maskPath(dest));
        } catch (error) {
          pluginLog(`[换号] 归档失败 ${label}：${String(error?.message ?? error)}`);
        }
      };
      const ownerCred = path.join(BILI_DIR, 'owner-credentials.json');
      if (target === 'fish' || target === 'both') {
        archive(BILI_CRED, 'fish-credentials');
        archive(ALIGN_FILE, 'alignments');
        try { fs.rmSync(BILI_CRED, { force: true }); } catch {}
      }
      if (target === 'owner' || target === 'both') {
        archive(ownerCred, 'owner-credentials');
        try { fs.rmSync(ownerCred, { force: true }); } catch {}
      }
      // 清掉配置里对应的 mid，避免下一次扫码又被"不是当前小肥鱼/主人"挡住
      try {
        const bili = readBiliConfig().config ?? {};
        if (target === 'fish' || target === 'both') bili.self = { mid: '', name: '' };
        if (target === 'owner' || target === 'both') bili.owner = { mid: '', name: '' };
        saveBiliConfig(bili);
      } catch (error) {
        pluginLog(`[换号] 清配置失败：${String(error?.message ?? error)}`);
      }
      pluginLog(`[换号] 已归档并清除 target=${target}；归档 ${archived.length} 个文件`);
      json(res, 200, { ok: true, target, archived });
      return;
    }
    if (pathname.endsWith('/qr/cancel')) {
      const id = String(body.id ?? '').trim();
      if (id) cancelQrLogin(id);
      json(res, 200, { ok: true });
      return;
    }
    if (action === 'cookie') {
      const sessdata = String(body.sessdata ?? '').trim();
      const bili_jct = String(body.bili_jct ?? '').trim();
      const buvid3 = String(body.buvid3 ?? '').trim();
      if (!sessdata || !bili_jct) { json(res, 400, { ok: false, error: 'SESSDATA 和 bili_jct 必填' }); return; }
      fs.mkdirSync(path.dirname(BILI_CRED), { recursive: true });
      writeJsonAtomic(BILI_CRED, { sessdata, bili_jct, buvid3 });
      try { fs.chmodSync(BILI_CRED, 0o600); } catch {}
      let whoNow = null;
      try {
        const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${sessdata}; bili_jct=${bili_jct}; buvid3=${buvid3}` },
        });
        const navJson = await navRes.json().catch(() => ({}));
        if (navJson?.data?.isLogin && navJson.data.mid) {
          whoNow = { mid: String(navJson.data.mid), name: String(navJson.data.uname ?? '') };
          const bili = readBiliConfig().config;
          bili.self = whoNow;
          saveBiliConfig(bili);
        }
      } catch {}
      json(res, 200, { ok: true, detail: whoNow ? `已写入 ✓ 当前登录：${whoNow.name}（mid ${whoNow.mid}）` : '已写入（但 nav 没确认成功 —— cookie 可能缺项或过期）', self: whoNow });
      return;
    }
    if (action === 'notify-test') {
      const notifyMjs = path.join(BILI_TOOLS_DIR, 'commands', 'notify.mjs');
      const result = await new Promise((resolve) => {
        execFile(findNodeExe(), [notifyMjs, '--test'], { cwd: BILI_TOOLS_DIR, timeout: 60_000, windowsHide: true }, (error, stdout, stderr) => resolve({
          ok: !error, out: String(stdout ?? '').slice(0, 2000), err: String(stderr ?? '').slice(0, 2000),
        }));
      });
      json(res, 200, { ok: result.ok, ...result });
      return;
    }
    if (action === 'pending-approve' || action === 'pending-reject') {
      const id = String(body.id ?? '');
      if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return; }
      if (action === 'pending-reject') {
        const result = await runBili(['reply-draft', 'drop', id], 30_000);
        json(res, 200, { ok: result.ok, out: result.out.slice(0, 500), err: result.err.slice(0, 500) });
        return;
      }
      const take = await runBili(['reply-draft', 'take', id], 30_000);
      let item = null;
      try { item = JSON.parse(take.out.trim().split('\n').pop()); } catch {}
      if (!item) { json(res, 400, { ok: false, error: '队列里没有这条（可能已经发过）', out: take.out.slice(0, 500) }); return; }
      const args = ['comment', '--oid', item.oid, '--root', item.root, '--parent', item.parent,
        '--message', item.message, '--auto', '--go'];
      if (item.bvid) args.push('--bvid', item.bvid);
      const send = await runBili(args, 120_000);
      json(res, 200, { ok: send.ok && /code=0/.test(send.out), out: send.out.slice(-1000), err: send.err.slice(-500) });
      return;
    }
    json(res, 400, { ok: false, error: '未知 action' });
  }

  // ── 日志 ────────────────────────────────────────────────────────────────
  function handleLogs(res, url) {
    const lines = Math.max(10, Math.min(500, Number(url.searchParams.get('lines')) || 120));
    const plugin = readTextTail(PLUGIN_LOG).split('\n').slice(-lines).join('\n');
    const bridge = bridgeLogTail(lines);
    json(res, 200, { ok: true, plugin, bridge, paths: { pluginLog: PLUGIN_LOG, bridgeLog: path.join(QQ_STATE_DIR(), 'bridge.log') } });
  }

  // 主人特权操作审计：只读桥接写好的 state/owner-audit.jsonl；agent 永远拿不到。
  async function handleOwnerAudit(req, res, url) {
    if (req.method === 'GET') {
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit')) || 50));
      const result = await callBridge(`/api/owner-audit?limit=${limit}`, { timeoutMs: 8000 });
      json(res, result.status || 200, result.data ?? { ok: false, error: result.error || '桥接不可用' });
      return;
    }
    if (req.method === 'POST') {
      let body = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return; }
      // 只支持「打开所在文件夹」；路径固定，不接受任何用户输入。
      if (body.action !== 'open') { json(res, 400, { ok: false, error: '未知 action' }); return; }
      if (process.platform !== 'win32') { json(res, 200, { ok: false, error: '只有 Windows 支持打开文件夹' }); return; }
      const dir = path.join(QQBOT_ROOT, 'state');
      try {
        spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
        json(res, 200, { ok: true, path: dir });
      } catch (error) {
        json(res, 500, { ok: false, error: String(error?.message ?? error) });
      }
      return;
    }
    json(res, 405, { ok: false, error: 'method not allowed' });
  }

  // ── 平台 ────────────────────────────────────────────────────────────────
  async function handlePlatforms(req, res) {
    json(res, 200, { ok: true, platforms: await platforms.statusAll(), capabilities: ['identity', 'memory.read', 'memory.write', 'prompt.block', 'actions'] });
  }

  // ── DSH 注册修复（2026-11-01）───────────────────────────────────────────
  // 用户点按钮才跑 scripts/setup-dsh.mjs（写 profile 的 bundle/MCP）。
  // 不自动执行、不自动重启 DSH：这一步会改 ~/.dsh，必须由人显式触发。
  // ── DSH 模型 / 思考强度：Web 设置页不直连桥接端口，必须由宿主代理 ────────
  // 以前只有 /dsh/repair，client 调 /dsh/model、/dsh/effort 会 404「未知接口」。
  async function proxyDshModel(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'POST') {
      json(res, 405, { ok: false, code: 'DSH_MODEL_METHOD', error: '只支持 GET/POST' });
      return;
    }
    let body;
    if (method === 'POST') {
      try { body = JSON.parse((await readBody(req)) || '{}'); }
      catch { json(res, 400, { ok: false, code: 'DSH_MODEL_BODY', error: '请求体不是合法 JSON' }); return; }
    }
    const result = await callBridge('/api/dsh/model', { method, body, timeoutMs: 8000 });
    const data = result.data ?? {};
    const status = result.status || (result.ok ? 200 : 502);
    json(res, status, {
      ...data,
      ...(result.ok ? {} : {
        ok: false,
        code: data.code || 'DSH_MODEL_BRIDGE',
        error: data.error || result.error || 'QQ 桥接不可用',
        hint: data.hint || '先启动 QQ 桥接，再刷新模型列表；若桥接版本旧，请重启桥接/升级 SurfCore',
      }),
    });
  }

  async function proxyDshEffort(req, res) {
    if (String(req.method || 'GET').toUpperCase() !== 'POST') {
      json(res, 405, { ok: false, code: 'DSH_EFFORT_METHOD', error: '只支持 POST' });
      return;
    }
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); }
    catch { json(res, 400, { ok: false, code: 'DSH_EFFORT_BODY', error: '请求体不是合法 JSON' }); return; }
    const result = await callBridge('/api/dsh/effort', { method: 'POST', body, timeoutMs: 8000 });
    const data = result.data ?? {};
    const status = result.status || (result.ok ? 200 : 502);
    json(res, status, {
      ...data,
      ...(result.ok ? {} : {
        ok: false,
        code: data.code || 'DSH_EFFORT_BRIDGE',
        error: data.error || result.error || 'QQ 桥接不可用',
        hint: data.hint || '先启动 QQ 桥接，再保存思考强度；若桥接版本旧，请重启桥接/升级 SurfCore',
      }),
    });
  }

  async function proxyDshFollowDefault(req, res) {
    if (String(req.method || 'GET').toUpperCase() !== 'POST') {
      json(res, 405, { ok: false, code: 'DSH_FOLLOW_METHOD', error: '只支持 POST', hint: '在设置页点「跟随 DSH 默认模型」开关' });
      return;
    }
    let body;
    try { body = JSON.parse((await readBody(req)) || '{}'); }
    catch { json(res, 400, { ok: false, code: 'DSH_FOLLOW_BODY', error: '请求体不是合法 JSON' }); return; }
    const result = await callBridge('/api/dsh/follow-default', { method: 'POST', body, timeoutMs: 8000 });
    const data = result.data ?? {};
    const status = result.status || (result.ok ? 200 : 502);
    json(res, status, {
      ...data,
      ...(result.ok ? {} : {
        ok: false,
        code: data.code || 'DSH_FOLLOW_BRIDGE',
        error: data.error || result.error || 'QQ 桥接不可用',
        hint: data.hint || '先启动/重启 QQ 桥接；桥接版本旧时升级 SurfCore',
      }),
    });
  }

  async function handleDshRepair(req, res) {
    if (req.method !== 'POST') { json(res, 405, { ok: false, code: 'DSH_REPAIR_METHOD', error: '只支持 POST', hint: '从设置页点「修复 DSH 注册」' }); return; }
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { json(res, 400, { ok: false, code: 'DSH_REPAIR_BODY', error: '请求体不是合法 JSON' }); return; }
    const profile = String(body.profile ?? '').trim();
    if (profile && (profile === '.' || profile === '..' || /[\\/\x00-\x1f<>:"|?*]/.test(profile) || /[. ]$/.test(profile))) {
      json(res, 400, { ok: false, code: 'DSH_REPAIR_PROFILE', error: 'profile 名非法', hint: '只填 profile 目录名（如 desktop），不要填路径' });
      return;
    }
    const repoRoot = path.dirname(rootPkg);
    const script = path.join(repoRoot, 'scripts', 'setup-dsh.mjs');
    if (!fs.existsSync(script)) {
      json(res, 400, {
        ok: false, code: 'DSH_REPAIR_SCRIPT_MISSING', error: `找不到修复脚本：${script}`,
        hint: '这是 zip 安装缺失 scripts/ 的情况：重新解压完整安装包，或手动在仓库根目录运行 node scripts/setup-dsh.mjs',
      });
      return;
    }
    const args = [script, ...(profile ? [profile] : [])];
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' };
    const run = (cmd) => new Promise((resolve) => {
      execFile(cmd, args, { cwd: repoRoot, timeout: 180_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env }, (error, stdout, stderr) => resolve({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') }));
    });
    let result = await run(process.execPath);
    if (result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {
      result = await run('node');
    }
    const output = `${result.stdout}\n${result.stderr}`.trim();
    if (result.error) {
      json(res, 500, {
        ok: false, code: 'DSH_REPAIR_FAILED',
        error: String(result.stderr || result.error.message || result.error).slice(0, 1200),
        hint: '在宿主机终端手动运行 node scripts\\setup-dsh.mjs <profile> 查看完整输出；按提示完全重启 DSH',
        output: output.slice(-4000),
      });
      return;
    }
    json(res, 200, {
      ok: true,
      profile: profile || '(auto)',
      requiresRestart: true,
      hint: '已写回 profile。请**完全退出并重开 DSH**（不是刷新页面），然后到控制台重置旧的 QQ 会话。',
      output: output.slice(-4000),
    });
  }

  // ── 组件更新 ────────────────────────────────────────────────────────────
  // GET  : 最近一次检查结果 + 待更新项 + 是否该弹窗
  // POST : { action:'check' | 'apply' | 'dismiss' | 'reset', ids?: string[] }
  async function handleUpdates(req, res) {
    if (req.method === 'GET') { json(res, 200, updates.status()); return; }
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch { json(res, 400, { ok: false, error: '请求体不是合法 JSON' }); return; }
    const action = String(body.action ?? '');
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    if (action === 'check') { json(res, 200, await updates.check({ fetch: true })); return; }
    if (action === 'apply') { json(res, 200, await updates.apply(ids, { overwriteModified: body.overwriteModified === true, firstInstall: body.firstInstall === true })); return; }
    if (action === 'set-token' || action === 'clear-token') {
      try {
        const current = readUnified().config ?? {};
        const next = { ...current, updates: { ...(current.updates ?? {}) } };
        if (action === 'clear-token') delete next.updates.githubToken;
        else next.updates.githubToken = String(body.token ?? '').trim();
        saveUnified(next);
        json(res, 200, { ok: true, configured: action === 'set-token' && Boolean(next.updates.githubToken) });
      } catch (error) {
        json(res, 500, {
          ok: false, code: 'token.save-failed',
          error: `保存 token 失败：${String(error?.message ?? error).slice(0, 160)}`,
          hint: '检查 config.json 是否可写；也可以稍后重试',
        });
      }
      return;
    }
    if (action === 'set-channel') {
      if (updates.status().applying) {
        json(res, 409, { ok: false, code: 'UPDATE_CHANNEL_BUSY', error: '正在更新中，不能切换通道', hint: '等本次更新完成或失败后再切' });
        return;
      }
      const nextChannel = String(body.channel ?? '').trim();
      if (!['stable', 'dev'].includes(nextChannel)) {
        json(res, 400, { ok: false, code: 'UPDATE_CHANNEL_INVALID', error: '更新通道只能是 stable 或 dev', hint: '正式用户用 stable；只有测试机才切 dev' });
        return;
      }
      try {
        saveUnified({ updates: { channel: nextChannel } });
        // 切换通道必须清掉上一轮的检查结果：否则 main 通道会被上轮 dev 检查留下的
        // pending 继续弹窗（2026-11-01 用户要求：选 main 时不被 dev 更新打扰）。
        updates.resetCheck?.();
        json(res, 200, { ok: true, channel: nextChannel, requiresCheck: true, hint: nextChannel === 'dev' ? '已切到测试通道：会安装 -dev.N 预发布；正式版用户不要开' : '已切回稳定通道：只跟正式 Release' });
      } catch (error) {
        json(res, 500, { ok: false, code: 'UPDATE_CHANNEL_SAVE', error: `保存通道失败：${String(error?.message ?? error).slice(0, 160)}`, hint: '检查 config.json 是否可写后重试' });
      }
      return;
    }
    if (action === 'rollback') {
      const target = String(body.id ?? ids[0] ?? '').trim();
      json(res, 200, await updates.rollback(target));
      return;
    }
    if (action === 'dismiss') { json(res, 200, updates.dismiss(ids)); return; }
    if (action === 'reset') { json(res, 200, updates.resetDismissed()); return; }
    json(res, 400, { ok: false, error: '未知 action' });
  }

  // ── 每日 token 额度 ─────────────────────────────────────────────────────
  // GET  : 额度 + 今日三类用量 + 比例 + 当天唯一的 80% 提醒（取走即落盘）
  // POST : { limits } 整体保存 / { add:{scope,unit,amount} } 快捷加额度 / { reset:true } 清空
  async function handleTokenBudget(req, res, url) {
    if (req.method === 'GET') {
      const takeAlertFlag = url?.searchParams?.get('alert') !== '0';
      json(res, 200, await tokenBudget.status({ takeAlertFlag }));
      return;
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: '只支持 GET / POST' }); return; }
    let body;
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      json(res, 400, { ok: false, error: '请求体不是合法 JSON' });
      return;
    }
    try {
      if (body?.reset === true) {
        backupFile(tokenBudget.budgetFile, 'token-budget-before-reset');
        tokenBudget.resetLimits();
      } else if (body?.add && typeof body.add === 'object') {
        backupFile(tokenBudget.budgetFile, 'token-budget-before-add');
        tokenBudget.addLimit(body.add.scope, body.add.unit, body.add.amount);
      } else if (body?.limits !== undefined) {
        backupFile(tokenBudget.budgetFile, 'token-budget-before-save');
        tokenBudget.saveLimits(body.limits);
      } else {
        throw new Error('缺少 limits，或 add / reset');
      }
      json(res, 200, await tokenBudget.status({ takeAlertFlag: false }));
    } catch (error) {
      json(res, 400, { ok: false, error: `保存额度失败：${String(error?.message ?? error)}` });
    }
  }

  // ── 路由：API 前缀 ──────────────────────────────────────────────────────
  route('prefix', API_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    if (pathname === `${API_PREFIX}/overview`) { json(res, 200, await overview()); return; }
    if (pathname === `${API_PREFIX}/config`) { await handleConfig(req, res); return; }
    if (pathname === `${API_PREFIX}/characters`) { await handleCharacters(req, res, url); return; }
    if (pathname === `${API_PREFIX}/persona`) { await handlePersona(req, res); return; }
    if (pathname === `${API_PREFIX}/limit-mute`) { await handleLimitMute(req, res); return; }
    if (pathname === `${API_PREFIX}/persona/classify`) { await handlePersonaClassify(req, res); return; }
    if (pathname === `${API_PREFIX}/group-policy`) { await handleGroupPolicy(req, res); return; }
    if (pathname === `${API_PREFIX}/memory`) { await handleMemory(req, res, url); return; }
    if (pathname === `${API_PREFIX}/watch-history`) { handleWatchHistory(res, url); return; }
    if (pathname === `${API_PREFIX}/preferences/scan`) {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: '只支持 GET' }); return; }
      await handlePreferenceScan(res, url);
      return;
    }
    if (pathname === `${API_PREFIX}/fish-guard/qq`) { handleQqFishGuard(res); return; }
    if (pathname === `${API_PREFIX}/memory-card/full`) { await handleMemoryCardFull(req, res, url); return; }
    if (pathname === `${API_PREFIX}/vector-memory`) { await handleVectorMemory(req, res); return; }
    if (pathname === `${API_PREFIX}/embedding-packs`) { await handleEmbeddingPacks(req, res, url); return; }
    if (pathname === `${API_PREFIX}/memory-card`) { await handleMemoryCard(req, res); return; }
    if (pathname === `${API_PREFIX}/align`) { await handleAlign(req, res); return; }
    if (pathname === `${API_PREFIX}/mode`) { await handleMode(req, res); return; }
    if (pathname === `${API_PREFIX}/extensions`) { await handleExtensions(req, res); return; }
    if (pathname === `${API_PREFIX}/platforms`) { await handlePlatforms(req, res); return; }
    if (pathname === `${API_PREFIX}/compat/scan`) {
      try {
        let version = '';
        try { version = String(JSON.parse(fs.readFileSync(path.join(QQBOT_ROOT, 'package.json'), 'utf8')).version ?? ''); } catch {}
        const report = scanPluginCompatibility({ surfcoreVersion: version });
        // 体检结果进闸门事件中心：只记 blocker/high，unknown/info 留在体检报告里，避免噪音。
        for (const issue of report.issues ?? []) {
          if (issue.severity !== 'blocker' && issue.severity !== 'high') continue;
          gateEvents.record({
            gate: 'plugin-compat',
            kind: 'compat',
            event: issue.code,
            action: 'blocked',
            subject: { bundle: issue.evidence?.bundle ?? '', profile: report.profile?.name ?? '' },
            reason: { code: issue.code, message: issue.title },
            impact: issue.impact,
            recommendation: issue.recommendation,
            confidence: issue.confidence,
            dedupeKey: `compat:${issue.code}:${issue.evidence?.bundle ?? ''}`,
            evidence: issue.evidence ?? {},
          });
        }
        json(res, 200, report);
      } catch (error) {
        json(res, 500, {
          ok: false,
          code: 'COMPAT_SCAN_FAILED',
          error: `插件体检失败：${String(error?.message ?? error)}`,
          hint: '先确认 DSH_HOME/profiles 可读；如果刚升级过 DSH，重启 DSH 后再试。',
        });
      }
      return;
    }
    if (pathname === `${API_PREFIX}/gate-events`) {
      if (req.method === 'GET') {
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
        const level = String(url.searchParams.get('level') ?? '').trim();
        const includeAcked = url.searchParams.get('includeAcked') !== '0';
        json(res, 200, { ok: true, ...gateEvents.list({ limit, level, includeAcked }), gateEvents: true });
        return;
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        const acked = gateEvents.ack(Array.isArray(body.ids) ? body.ids : [], body.action === 'ack-all' || body.all === true);
        json(res, 200, { ok: true, ...acked, ...gateEvents.list({ limit: 50, includeAcked: false }) });
        return;
      }
      json(res, 405, { ok: false, code: 'GATE_EVENTS_METHOD', error: '只支持 GET / POST', hint: '刷新页面后重试' });
      return;
    }
    if (pathname === `${API_PREFIX}/diagnostics`) { await handleDiagnostics(req, res); return; }
    if (pathname === `${API_PREFIX}/snowluma/accounts` || pathname === `${API_PREFIX}/snowluma/load`) {
      if (String(req.method || 'GET').toUpperCase() !== 'POST') {
        json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '只支持 POST' });
        return;
      }
      let body = {};
      try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
      try {
        if (pathname.endsWith('/accounts')) {
          const result = await snowLumaAccountList(String(body.password || ''));
          json(res, 200, { ok: true, ...result });
        } else {
          const result = await snowLumaLoadAccount(body.pid, String(body.password || ''));
          json(res, 200, { ok: true, ...result });
        }
      } catch (error) {
        json(res, 200, {
          ok: false,
          code: String(error?.code || 'SNOWLUMA_ACCOUNT_FAILED'),
          error: String(error?.message ?? error).slice(0, 300),
          hint: String(error?.hint ?? '刷新后重试；必要时打开 SnowLuma 控制台检查').slice(0, 300),
        });
      }
      return;
    }
    if (pathname === `${API_PREFIX}/bridge`) { await handleBridge(req, res); return; }
    if (pathname.startsWith(`${API_PREFIX}/purpose`)) { await handlePurpose(req, res, url); return; }
    if (pathname.startsWith(`${API_PREFIX}/voice`)) { await handleVoice(req, res, url); return; }
    if (pathname.startsWith(`${API_PREFIX}/pet`)) { await handlePet(req, res, url); return; }

    if (pathname === `${API_PREFIX}/token-budget`) { await handleTokenBudget(req, res, url); return; }
    if (pathname === `${API_PREFIX}/updates`) { await handleUpdates(req, res); return; }
    if (pathname === `${API_PREFIX}/dsh/model`) { await proxyDshModel(req, res); return; }
    if (pathname === `${API_PREFIX}/dsh/effort`) { await proxyDshEffort(req, res); return; }
    if (pathname === `${API_PREFIX}/dsh/follow-default`) { await proxyDshFollowDefault(req, res); return; }
    if (pathname === `${API_PREFIX}/dsh/repair`) { await handleDshRepair(req, res); return; }
    if (pathname.startsWith(`${API_PREFIX}/bili/`)) { await handleBili(req, res, url); return; }
    if (pathname === `${API_PREFIX}/logs`) { handleLogs(res, url); return; }
    if (pathname === `${API_PREFIX}/owner-audit`) { await handleOwnerAudit(req, res, url); return; }
    if (pathname === `${API_PREFIX}/browse`) { await handleBrowse(req, res, url); return; }
    if (pathname === `${API_PREFIX}/resources/open`) {
      if (req.method !== 'POST') { json(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED', error: '只支持 POST' }); return; }
      let body = {};
      try { body = JSON.parse(await readBody(req) || '{}'); } catch {}
      const result = openExternalResourceUrl(body.url);
      json(res, result.ok ? 200 : 400, result);
      return;
    }
    if (pathname === `${API_PREFIX}/privacy/explain`) {
      const body = req.method === 'POST' ? JSON.parse(await readBody(req) || '{}') : { text: url.searchParams.get('text') ?? '' };
      json(res, 200, { ok: true, ...explainText(String(body.text ?? '')) });
      return;
    }
    json(res, 404, { ok: false, error: `未知接口：${pathname}` });
  });

  // 扩展自定义路由：/dsh-surfcore/ext/<id>/<path>
  route('prefix', EXT_PREFIX, async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const rest = url.pathname.slice(EXT_PREFIX.length + 1);
    const [id, ...parts] = rest.split('/');
    if (!id) { json(res, 404, { ok: false, error: '缺少扩展 id' }); return; }
    const routePath = `/${parts.join('/')}`;
    const record = extensionHost.routeFor(id, req.method, routePath);
    if (!record) { json(res, 404, { ok: false, error: `扩展 ${id} 没有注册 ${req.method} ${routePath}` }); return; }
    await record.handler(req, res, { url, extensionId: id });
  });

  // 桌宠专用本地接口：独立前缀 + 自己的回环/令牌校验。
  // 不能塞进 /dsh-surfcore/api：那里有 DSH 的 connection.requestRejection（桌宠进程没有会话 Cookie，会 401）。
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: petApi.prefix,
    handler: async (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        await petApi.handle(req, res, url);
      } catch (error) {
        pluginLog('[pet-api] 请求失败：', String(error?.message ?? error));
        try { json(res, 500, { ok: false, error: String(error?.message ?? error) }); } catch {}
      }
    },
  }));

  route('exact', '/dsh-surfcore/health', async (req, res) => {
    json(res, 200, { ok: true, name, version: VERSION, privacyPolicyVersion: PRIVACY_POLICY_VERSION });
  });

  // 桌宠发现文件（端口漂移 / 令牌轮换都由它兜底）：启动写一次，之后每 2 分钟对一次。
  try { petApi.writeHostFile(true); } catch (error) { pluginLog('[pet-api] 启动写 host.json 失败：', String(error?.message ?? error)); }
  const petHostTimer = setInterval(() => { try { petApi.writeHostFile(false); } catch {} }, 120_000);
  petHostTimer.unref?.();
  // 目的机制（桌宠载体）：carrier=pet 时由这里每 60 秒 tick；carrier=qq 时它自己会退出。
  try { petPurpose.start(); } catch (error) { pluginLog('[pet-purpose] 启动失败：', String(error?.message ?? error)); }

  // 启动后异步做的事（不阻塞插件激活）
  void activateExtensions();
  void maybeAutoStartBridge();
  // 组件更新检查（2026-10-26）：DSH 起来后延迟 20 秒查一次，之后每 6 小时一次。
  // 结果缓存在 updates.json；设置页概览打开时若 showPrompt 就自动弹窗。
  try {
    const updCfg = readUnified().config?.updates ?? {};
    updates.startAutoCheck({
      delayMs: Number(updCfg.startDelayMs ?? 20_000),
      intervalMs: Number(updCfg.intervalMs ?? 6 * 60 * 60 * 1000),
      enabled: updCfg.enabled !== false && updCfg.checkOnStart !== false,
    });
  } catch (error) {
    pluginLog('[updates] 启动检查失败：', String(error?.message ?? error));
  }
  // 端口漂移自愈：每 2 分钟检查一次（内部会判断 autoStart 是否开启、是否有并发）。
  bridgeRepairTimer = setInterval(() => { void maybeAutoStartBridge(); }, 120_000);
  bridgeRepairTimer.unref?.();
  startSyncTimer();

  // 保存设置后如果开启了“随插件自动启动”，这里也覆盖一次。
  ctx.effect(() => () => {
    try { scheduler?.stop?.(); } catch {}
    try { updates.dispose(); } catch {}
    try { petPurpose.stop?.(); } catch {}
    if (petHostTimer) clearInterval(petHostTimer);
    try { sessionEventOff?.(); } catch {}
    try { billing.dispose(); } catch {}
    try { tokenBudget.dispose(); } catch {}
    try { memoryCardTimer?.stop?.(); } catch {}
    try { vectorMemoryTimer?.stop?.(); } catch {}
    try { closeAllQrLogins(); } catch {}
    if (characterTimer) clearInterval(characterTimer);
    if (syncTimer) clearInterval(syncTimer);
    if (bridgeRepairTimer) clearInterval(bridgeRepairTimer);
    void extensionHost.deactivateAll();
    for (const dispose of disposers) { try { dispose(); } catch {} }
  });

  // 诊断日志：证明插件真的被装配，且知道它读的是哪一份配置。
  pluginLog(`已激活 v${VERSION}；surfcore=${maskPath(path.dirname(QQ_CONFIG))}；biliTools=${maskPath(BILI_MJS)}；privacy=v${PRIVACY_POLICY_VERSION}`);
  // 语音链路自检：本地音色要 9880（GPT-SoVITS）+ 8765（voxd）两个都在；少了就在日志里说清楚，
  // 免得用户以为"语音功能坏了"（2026-10-27 实测：只起 8765 时发语音全 503）。
  void (async () => {
    try {
      const v = readUnified().config?.socialV2?.voice?.tts ?? {};
      if (!v.enabled) return;
      const voxd = await portOpen(8765, 800);
      const gsv = await portOpen(9880, 800);
      if (!voxd) pluginLog('[语音] 8765（voxd）没监听：发语音会失败，先跑 voice-local\run.bat');
      else if (v.route === 'local' && !gsv) pluginLog(`[语音] 8765 在跑但 9880（GPT-SoVITS）没起：角色 ${v.character ?? '(空)'} 走本地音色会 503，先跑 voice-local\gsv.bat 等约 40 秒（也可切到 Piper/云端）`);
    } catch {}
  })();
}

export default { name, inject, apply };
