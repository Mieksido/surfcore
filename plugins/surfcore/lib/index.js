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
import { buildInstallChecks, installOk, planDoctorFix } from './doctor.js';
import { VOICE_PORTS, readPackCharacters, validateCharacter } from './voice-health.js';
import {
  autoSnapshot, beforeSwitchSnapshot, characterDetail, characterOverview, createCharacterFromPayload,
  deleteCharacter, manualSnapshot, migrateIfNeeded, restoreCharacterSnapshot, switchToCharacter,
  testCurrentCharacter, updateCharacterFromPayload,
} from './characters.js';
import { activeMemoryPaths, activePlatformStateDir, readCurrentCharacter, touchCharacter } from '../../../src/character-persona.js';
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
import { createPetService, detectElectronPath, installElectronRuntime, ELECTRON_VERSION, electronDownloadUrl } from './pet.js';
import { createPetChatService } from './pet-chat.js';
import { createPetPurposeService } from './pet-purpose.js';
import { createPetApiService } from './pet-api.js';
import { createUpdatesService, resumePendingApply } from './updates.js';
import {
  adminFromSources, adminSummary, projectAdminSave,
} from '../../../src/admin-identity.js';
import {
  applyMemoryCardAction, compactMemoryCardNow, fullMemoryCardSnapshot, memoryCardIdle, memoryCardSnapshot,
  memoryCardStatusNow, notifyOwnerIfNeeded, restoreMemoryCardBackup, runMemoryCardMaintenance,
  startMemoryCardTimer,
} from './memory-card.js';
import { readWatchHistory } from '../tools/lib/watch-history.mjs';
import { enrichWatchHistory } from '../tools/lib/watch-actions.mjs';
import { scanPreferences } from '../tools/lib/pref-scan.mjs';
import {
  cancelQrLogin, closeAllQrLogins, pollQrLogin, readFishAccount, readOwnerAccount, startQrLogin,
} from './bili-qr-login.mjs';
import { fishGuardStateSummary } from '../tools/lib/fish-guard.mjs';
import { summarizeQqFishGuard } from './qq-fish-guard.js';
import { applySessionPermission } from './scheduler.js';

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
  let syncTimer = null;
  let memoryCardTimer = null;
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
  // ── 桌宠（独立栏目，默认不安装；用户自己安装才生效）────────────────────
  const petService = createPetService({ stateDir: STATE_DIR, pluginLog, getSubprocess: () => ctx.get('subprocess') });
  // 桌宠对话与「目的机制」的桌宠载体：和 QQ / B站 共用当前角色的人格卡、记忆卡、目的状态。
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
      // 2) 语音包（bridge 管理的安装目录；config.json 的 voicePacks.dir 可覆盖）
      //    是 git clone 就走 git；不是则看有没有配版本清单（updates.voice.*VersionUrl）
      try {
        const qqCfg = readQqConfig().config ?? {};
        const packsDir = String(qqCfg?.voicePacks?.dir || path.join(QQBOT_ROOT, 'state', 'voice-packs'));
        const voice = updCfg.voice ?? {};
        list.push({
          id: 'surfvoice-local', name: '语音包（本地）', dir: path.join(packsDir, 'voice-local'),
          kind: 'auto', branch: 'main', versionUrl: voice.localVersionUrl || '', versionRepo: 'Mieksido/surfvoicelocal',
        });
        list.push({
          id: 'surfvoice-cloud', name: '语音包（云端）', dir: path.join(packsDir, 'voice-cloud'),
          kind: 'auto', branch: 'main', versionUrl: voice.cloudVersionUrl || '', versionRepo: 'Mieksido/surfvoicecloud',
        });
      } catch {}
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
      const sessionId = character ? `bili-whale-${character.id}` : 'bili-whale';
      scheduler = startScheduler(ctx, {
        dshHome: DSH_HOME,
        biliMjs: BILI_MJS,
        cwd: os.homedir(),
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
  startSchedulerNow();

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
    const snowDiag = await diagnoseSnowLuma(bridge?.snowluma ?? {}).catch(() => ({ state: 'unknown', hint: '' }));
    const personaText = readTextFile(resolvePersonaFile());
    const mode = parseModeState();
    let dshMode = null;
    try {
      const settings = ctx.get('settings');
      if (settings?.describe) {
        const rows = settings.describe({ redactSecrets: true });
        const row = rows.find((item) => item.ns === 'qq-mode');
        dshMode = row?.value?.mode ?? null;
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
      admin: adminSummary(all.unified?.admin),
      alignment: alignStats(),
      platforms: platforms.list(),
      extensions: extensionHost.describe(),
      // 平台启动开关：设置页顶部状态点、概览三按钮的可用性都读它。
      platformStart: platformStartState(),
      // 组件更新：概览「更新」卡与启动弹窗都读它（检查结果是缓存的，不在这里触发网络）。
      updates: updates.status(),
      scheduler: schedulerStatus,
      snowluma: {
        launcherPath: String(snow.launcherPath ?? ''),
        allowLaunch: snow.allowLaunch === true,
        downloadUrl: String(snow.downloadUrl ?? 'https://github.com/SnowLuma/SnowLuma/releases/latest'),
        detected: findSnowLumaInstall() !== null,
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
      json(res, 200, { ok: true, ...readAll(), paths: pathSummary(), backups: listBackups(20) });
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    const result = { ok: true, saved: {}, warnings: [] };
    // ── 管理员：QQ ⇄ B站 默认是同一个人 ────────────────────────────────────
    // 合体层 admin 是唯一真相；旧格式（qq.ownerQQ / bili.owner）是投影。
    // 合并逻辑放在 src/admin-identity.js 的 projectAdminSave（纯函数，有单测），
    // 这里只负责把结果写回三份文件，避免「只改了一边」。
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
      const saved = saveQqConfig(body.qq);
      result.saved.qq = true;
      result.qq = saved.config;
      result.qqBackup = saved.backup;
      result.warnings.push('QQ 配置已保存；桥接只在启动时读 config.json，需要「重启桥接」才会生效。');
    }
    if (body.bili && typeof body.bili === 'object') {
      const saved = saveBiliConfig(body.bili);
      result.saved.bili = true;
      result.bili = saved.config;
      result.biliBackup = saved.backup;
      result.warnings.push('B站配置已保存；生物钟每轮重读配置，下一轮即生效。');
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
    if (body.restartBridge === true) {
      // 开关关掉时不允许「保存并重启」把 QQ 又拉起来；否则用户刚关的开关会被绕过。
      if (!platformStartEnabled('qq')) {
        result.warnings.push('QQ 启动开关已关闭：已跳过「保存并重启 QQ 桥接」。');
      } else {
        const restart = await restartBridge({ dshWebUrl: currentDshUrl() });
        result.bridge = restart;
        if (!restart.ok) result.warnings.push(`桥接重启失败：${restart.error ?? restart.message ?? '未知'}`);
      }
    }
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
      if (action === 'test') {
        json(res, 200, await testCurrentCharacter());
        return;
      }
      json(res, 400, { ok: false, error: `未知 action：${action}` });
    } catch (error) {
      json(res, 400, { ok: false, error: String(error?.message ?? error) });
    }
  }

  // ── 人设卡 ──────────────────────────────────────────────────────────────
  async function handlePersona(req, res) {
    if (req.method === 'GET') {
      const text = readTextFile(resolvePersonaFile());
      const backups = listBackups(80).filter((item) => item.name.startsWith('persona-'));
      json(res, 200, {
        ok: true,
        path: resolvePersonaFile(),
        text,
        chars: text.length,
        mtime: mtimeIso(resolvePersonaFile()),
        backups,
        note: 'QQ 与 B站共用这一张人设卡；B站 AGENTS.md 只保留日子/流程，不另立人格。',
      });
      return;
    }
    const body = JSON.parse(await readBody(req) || '{}');
    if (body.action === 'restore') {
      const name = safeBackupName(body.name);
      if (!name) { json(res, 400, { ok: false, error: '备份名非法' }); return; }
      const source = path.join(BACKUP_DIR, name);
      if (!fs.existsSync(source)) { json(res, 404, { ok: false, error: '备份不存在' }); return; }
      backupFile(resolvePersonaFile(), 'persona');
      fs.copyFileSync(source, resolvePersonaFile());
      const cur = readCurrentCharacter();
      if (cur) touchCharacter(cur.id);
      json(res, 200, { ok: true, restored: name, text: readTextFile(resolvePersonaFile()) });
      return;
    }
    const text = String(body.text ?? '');
    if (text.length < 50) { json(res, 400, { ok: false, error: '人设卡太短（至少 50 字）' }); return; }
    if (text.length > 64 * 1024) { json(res, 400, { ok: false, error: '人设卡超过 64KB' }); return; }
    const scan = scanText(text);
    // 人设卡允许出现 QQ 号（称呼表/身份说明本来就需要），但绝不允许密钥、密码、
    // 身份证/银行卡/住址这类真正敏感的内容被写进每次注入的人格提示词。
    const severe = scan.secrets.length > 0 || scan.pii.some((hit) => hit.severe);
    if (severe) {
      json(res, 400, { ok: false, error: '人设卡里命中密钥/密码/身份证/住址规则，拒绝保存', labels: [...new Set([...scan.secrets, ...scan.pii.filter((h) => h.severe)].map((h) => h.label))] });
      return;
    }
    const backup = backupFile(resolvePersonaFile(), 'persona');
    writeTextAtomic(resolvePersonaFile(), text.endsWith('\n') ? text : `${text}\n`);
    const cur = readCurrentCharacter();
    if (cur) touchCharacter(cur.id);
    json(res, 200, { ok: true, chars: text.length, backup, path: resolvePersonaFile() });
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
          if (row) dshSetting = row.value;
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

  async function installChecks() {
    const all = readAll();
    const qqCfg = readQqConfig().config ?? {};
    const snow = qqCfg.snowluma ?? {};
    let snowState = { state: 'unknown', hint: '' };
    try { snowState = await diagnoseSnowLuma(snow); } catch {}
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
        const priv = opts.ownerQQ ? [opts.ownerQQ] : [];
        saveQqConfig({ allow: { groups: opts.groups, private: priv } });
        done(idStep, true, `${opts.groups.length} 个群${opts.ownerQQ ? ' + 主人私聊' : ''}`);
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
      const install = await installChecks();
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
        const priv = owner ? [owner] : (Array.isArray(cfg.allow?.private) ? cfg.allow.private : []);
        saveQqConfig({ allow: { groups, private: priv } });
        changed.push(`写入白名单（${groups.length} 个群${owner ? ' + 主人私聊' : ''}）`);
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
      if (!fs.existsSync(source)) { json(res, 404, { ok: false, error: '备份不存在' }); return; }
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
  function portOpen(port, timeout = 600) {
    return new Promise((resolve) => {
      const socket = net.connect({ port, host: '127.0.0.1' });
      const done = (ok) => { socket.destroy(); resolve(ok); };
      socket.setTimeout(timeout);
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
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

  function findSnowLumaInstall() {
    const cfg = readQqConfig().config?.snowluma ?? {};
    const candidates = [];
    const add = (value) => { const text = String(value ?? '').trim(); if (text) candidates.push(text); };
    add(cfg.launcherPath);
    add(process.env.SNOWLUMA_HOME);
    add(process.env.SNOWLUMA_DIR);
    for (const base of [
      path.join(os.homedir(), 'SnowLuma2'),
      path.join(os.homedir(), 'SnowLuma'),
      path.join(os.homedir(), 'Desktop', 'SnowLuma2'),
      path.join(os.homedir(), 'Downloads', 'SnowLuma2'),
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'SnowLuma2'),
      path.join(path.dirname(QQBOT_ROOT), 'SnowLuma2'),
      path.join(process.env.ProgramFiles || 'C:/Program Files', 'SnowLuma2'),
    ]) add(base);
    for (const raw of candidates) {
      const resolved = path.resolve(raw);
      try {
        if (fs.statSync(resolved).isFile()) {
          if (/launcher\.bat$|SnowLuma\.exe$/i.test(resolved)) {
            const dir = path.dirname(resolved);
            const root = path.basename(dir).toLowerCase() === 'app' ? path.dirname(dir) : dir;
            return { root, launcher: resolved };
          }
          continue;
        }
      } catch {}
      for (const relative of ['app/launcher.bat', 'launcher.bat', 'SnowLuma.exe']) {
        const launcher = path.join(resolved, relative);
        try { if (fs.existsSync(launcher)) return { root: resolved, launcher }; } catch {}
      }
    }
    return null;
  }

  // SnowLuma 没有原生窗口，它的界面是 WebUI（默认 http://127.0.0.1:5100）。
  // 端口从 SnowLuma 自己的 runtime.json 读，读不到就回退 5100。
  function snowLumaWebui() {
    const cfg = readQqConfig().config?.snowluma ?? {};
    let port = 5100;
    try {
      const root = String(cfg.launcherPath ?? '').trim();
      if (root) {
        const runtime = JSON.parse(fs.readFileSync(path.join(root, 'app', 'config', 'runtime.json'), 'utf8'));
        if (Number(runtime?.webuiPort) > 0) port = Number(runtime.webuiPort);
      }
    } catch {}
    return { port, url: `http://127.0.0.1:${port}` };
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

  // SnowLuma 连不上时到底卡在哪一步：进程没起 / 停在登录页 / token 或端口不对。
  // 桥接的 goodError 只有一句 fetch failed，光看它没法给用户任何可执行的信息。
  async function diagnoseSnowLuma(bridgeSnow = {}) {
    if (bridgeSnow.connected === true) return { state: 'ok', hint: '' };
    const webui = snowLumaWebui();
    const onebot = (await portOpen(3000)) || (await portOpen(3001));
    const webuiUp = await portOpen(webui.port);
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

  async function launchSnowLuma() {
    if (process.env.SURFCORE_SKIP_AUTOSTART === '1') {
      return { ok: true, skipped: true, message: '测试环境：跳过打开 SnowLuma' };
    }
    const cfg = readQqConfig().config?.snowluma ?? {};
    if (cfg.allowLaunch !== true) {
      return { ok: false, error: '未开启「允许插件打开 SnowLuma」：设置 → SurfCore → QQ → SnowLuma' };
    }
    const webui = snowLumaWebui();

    // 已登录（OneBot 3000/3001 在听）：什么都不用做，也别弹窗口。
    if (await portOpen(3000) || await portOpen(3001)) {
      return { ok: true, already: true, opened: false, message: 'SnowLuma 已在运行且已登录' };
    }

    // 进程在、但 OneBot 没起 → 多半停在登录页：直接把 WebUI 打开让人扫码。
    if (await portOpen(webui.port)) {
      const opened = openLocalUrl(webui.url);
      return {
        ok: true,
        needsLogin: true,
        opened,
        webui: webui.url,
        message: opened ? `SnowLuma 在登录页，已打开控制台 ${webui.url}` : `SnowLuma 在登录页：请打开 ${webui.url} 扫码`,
      };
    }

    const launcher = resolveSnowLumaLauncher();
    if (!launcher) {
      return { ok: false, error: '找不到 SnowLuma 启动脚本：请在设置里填「SnowLuma 安装目录」或「启动脚本」' };
    }
    try {
      const cwd = path.dirname(launcher);
      const lower = launcher.toLowerCase();
      if (lower.endsWith('.bat') || lower.endsWith('.cmd')) {
        // 2026-10-22 审计：旧写法把 basename 拼进 cmd 命令串，路径里带 `&` 可注入命令。
        // 现在整条路径作为「verbatim 参数」交给 cmd，并且拒绝含引号/换行的路径。
        if (/["\r\n]/.test(launcher)) return { ok: false, error: '启动脚本路径含引号或换行，拒绝执行' };
        spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'start', '""', `"${launcher}"`], {
          cwd, detached: true, stdio: 'ignore', windowsHide: false, windowsVerbatimArguments: true,
        }).unref();
      } else {
        spawn(launcher, [], { cwd, detached: true, stdio: 'ignore', windowsHide: false }).unref();
      }
      // 等 WebUI 端口起来（最多 10 秒）：起来了就打开浏览器；没起来也给出地址让用户自己点。
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (await portOpen(webui.port)) {
          const opened = openLocalUrl(webui.url);
          return {
            ok: true,
            started: true,
            opened,
            webui: webui.url,
            launcher,
            message: opened ? `已启动 SnowLuma 并打开控制台 ${webui.url}` : `已启动 SnowLuma：${webui.url}`,
          };
        }
      }
      return { ok: true, started: true, pending: true, webui: webui.url, launcher, message: `已启动 SnowLuma，控制台稍后可访问：${webui.url}` };
    } catch (error) {
      return { ok: false, error: `打开 SnowLuma 失败：${error?.message ?? error}` };
    }
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
        const snowDiag = await diagnoseSnowLuma(snow).catch(() => ({ state: 'unknown', hint: '' }));
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
    const suffix = url.pathname.slice(`${API_PREFIX}/voice`.length) || '';
    const target = `${consoleBase()}/api/voice${suffix}${url.search || ''}`;
    const headers = { 'x-console-token': consoleToken() };
    const init = { method: req.method };
    const method = String(req.method || 'GET').toUpperCase();
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
  async function handleBrowse(req, res, url) {
    const mode = url.searchParams.get('mode') === 'file' ? 'file' : 'dir';
    const title = url.searchParams.get('title') || (mode === 'file' ? '选择文件' : '选择目录');
    if (process.platform !== 'win32') {
      json(res, 200, { ok: false, error: '只有 Windows 支持原生选择框，请手动填路径' });
      return;
    }
    const ps = mode === 'file'
      ? `Add-Type -AssemblyName System.Windows.Forms;
$d = New-Object System.Windows.Forms.OpenFileDialog;
$d.Title = ${JSON.stringify(title)};
$d.Filter = '可执行文件 (*.exe)|*.exe|所有文件 (*.*)|*.*';
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.FileName }`
      : `Add-Type -AssemblyName System.Windows.Forms;
$d = New-Object System.Windows.Forms.FolderBrowserDialog;
$d.Description = ${JSON.stringify(title)};
$d.ShowNewFolderButton = $true;
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }`;
    const child = execFile('powershell.exe', ['-STA', '-NoProfile', '-Command', ps], { windowsHide: true, timeout: 180_000 }, (error, stdout) => {
      const picked = String(stdout || '').trim().split(String.fromCharCode(10)).pop().trim();
      if (error && !picked) json(res, 200, { ok: false, error: `选择框打不开：${String(error.message || error).slice(0, 160)}` });
      else if (!picked) json(res, 200, { ok: false, cancelled: true, error: '已取消' });
      else json(res, 200, { ok: true, path: picked });
    });
    child.on('error', () => json(res, 200, { ok: false, error: '无法启动 PowerShell（可能不在本机桌面）' }));
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
      if (suffix === '/install') { json(res, 200, await petService.install()); return; }
      if (suffix === '/remove') { json(res, 200, await petService.remove()); return; }
      if (suffix === '/clean') { json(res, 200, await petService.cleanAppDir()); return; }
      if (suffix === '/start') { json(res, 200, await petService.start()); return; }
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
    if (action === 'detect-snowluma') {
      const found = findSnowLumaInstall();
      if (!found) {
        json(res, 200, { ok: false, error: '没找到 SnowLuma：请先下载并解压 SnowLuma2，然后在 QQ → SnowLuma 里填安装目录' });
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
        json(res, 503, { ok: false, error: String(error?.message ?? error) });
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

  // ── 平台 ────────────────────────────────────────────────────────────────
  async function handlePlatforms(req, res) {
    json(res, 200, { ok: true, platforms: await platforms.statusAll(), capabilities: ['identity', 'memory.read', 'memory.write', 'prompt.block', 'actions'] });
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
    if (action === 'apply') { json(res, 200, await updates.apply(ids)); return; }
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
    if (pathname === `${API_PREFIX}/memory`) { await handleMemory(req, res, url); return; }
    if (pathname === `${API_PREFIX}/watch-history`) { handleWatchHistory(res, url); return; }
    if (pathname === `${API_PREFIX}/preferences/scan`) {
      if (req.method !== 'GET') { json(res, 405, { ok: false, error: '只支持 GET' }); return; }
      await handlePreferenceScan(res, url);
      return;
    }
    if (pathname === `${API_PREFIX}/fish-guard/qq`) { handleQqFishGuard(res); return; }
    if (pathname === `${API_PREFIX}/memory-card/full`) { await handleMemoryCardFull(req, res, url); return; }
    if (pathname === `${API_PREFIX}/memory-card`) { await handleMemoryCard(req, res); return; }
    if (pathname === `${API_PREFIX}/align`) { await handleAlign(req, res); return; }
    if (pathname === `${API_PREFIX}/mode`) { await handleMode(req, res); return; }
    if (pathname === `${API_PREFIX}/extensions`) { await handleExtensions(req, res); return; }
    if (pathname === `${API_PREFIX}/platforms`) { await handlePlatforms(req, res); return; }
    if (pathname === `${API_PREFIX}/diagnostics`) { await handleDiagnostics(req, res); return; }
    if (pathname === `${API_PREFIX}/bridge`) { await handleBridge(req, res); return; }
    if (pathname.startsWith(`${API_PREFIX}/purpose`)) { await handlePurpose(req, res, url); return; }
    if (pathname.startsWith(`${API_PREFIX}/voice`)) { await handleVoice(req, res, url); return; }
    if (pathname.startsWith(`${API_PREFIX}/pet`)) { await handlePet(req, res, url); return; }

    if (pathname === `${API_PREFIX}/token-budget`) { await handleTokenBudget(req, res, url); return; }
    if (pathname === `${API_PREFIX}/updates`) { await handleUpdates(req, res); return; }
    if (pathname.startsWith(`${API_PREFIX}/bili/`)) { await handleBili(req, res, url); return; }
    if (pathname === `${API_PREFIX}/logs`) { handleLogs(res, url); return; }
    if (pathname === `${API_PREFIX}/browse`) { await handleBrowse(req, res, url); return; }
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
    try { tokenBudget.dispose(); } catch {}
    try { memoryCardTimer?.stop?.(); } catch {}
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
