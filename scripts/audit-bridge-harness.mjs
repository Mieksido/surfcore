// Execute the real bridge initialization/functions against temporary files and fake peers.
// No production config, QQ connection, DSH process, or persistent home is accessed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as markdown from '../src/md-to-plain.js';
import * as sensitive from '../src/sensitive.js';
import * as wait from '../src/v2-wait.js';
import * as safeFetch from '../src/safe-fetch.js';
import * as forward from '../src/forward.js';
import * as selfIdentity from '../src/self-identity.js';
import * as slang from '../src/slang-learner.js';
import * as sticker from '../src/sticker-lib.js';
import * as modelPrices from '../src/model-prices.js';
import * as tokenLedger from '../src/token-ledger.js';
import * as voiceLib from '../src/send-voice-lib.js';
import * as voiceDiagnostics from '../src/voice-diagnostics.js';
import * as allowlist from '../src/allowlist.js';
import * as callname from '../src/callname.js';
import { synthesizeToFile } from '../src/voice-tts.js';
import * as presetPrompt from '../src/preset-prompt.js';
import * as fishGuard from '../src/fish-guard.js';
import * as tokenGuard from '../src/token-guard.js';
import * as tokenBudget from '../src/token-budget.js';
import * as turnGuard from '../src/turn-guard.js';
import * as gateEvents from '../src/gate-events.js';
// bridge 源码是整段丢进 vm 里跑的：它的 `import` 行被剥掉，靠这里展开成全局名字。
// 漏加一行的表现是「xxx is not defined」——不是测试断言失败，而是**整条投递链路静默失败**
// （2026-10-30 加了 dsh-model-follow.js 就踩过：purpose-wiring 等 8 个脚本全红）。
import * as dshModelFollow from '../src/dsh-model-follow.js';
import * as adminIdentity from '../src/admin-identity.js';
import * as questionAnswers from '../src/question-answers.js';
import * as ownerAudit from '../src/owner-audit.js';
import * as roleCard from '../src/role-card.js';
import * as personaLayers from '../src/persona-layers.js';
import * as contextTelemetry from '../src/context-telemetry.js';
import * as memoryCard from '../src/memory-card.js';
import * as characterStore from '../src/character-persona.js';
import * as biliCard from '../src/bili-card.js';
import * as historyCatchup from '../src/history-catchup.js';
import * as purposeEngine from '../src/purpose-engine.js';
import * as conversationClosure from '../src/conversation-closure.js';
import { fetchVideoInfo } from '../src/bili-api.js';
import * as stateAcl from '../src/state-acl.mjs';
import { createBiliMemory } from '../src/bili-memory.js';
import { isLoopbackBaseUrl } from '../src/dsh-port.js';
import { unwrap, createTurnCollector } from '../src/dsh-client.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 0.1s / 16k 单声道的最小 wav（只要头正确，voice-tts 就不会当成空文件）。 */
function wavFixture() {
  const n = 1600;
  const data = Buffer.alloc(n * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export async function bridgeHarness({ config = {}, savedState, files = {}, globals = {}, history = {} } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-audit-bridge-'));
  fs.mkdirSync(path.join(temp, 'src'));
  fs.mkdirSync(path.join(temp, 'state'));
  const harnessConfig = {
    dsh: { authToken: 'fixture-only' }, ownerQQ: 123,
    allow: { private: ['123'], groups: ['456'] }, consolePort: 0,
    consoleToken: 'fixture-console-token', slang: { enabled: false }, ...config,
  };
  // 旧审计用例按“每条消息都能醒”写；Token 防爆破默认会让部分用例被 2 分钟间隔拦住。
  // 这里默认关掉，专门的 test-token-guard 覆盖开启逻辑，需要开启的用例显式覆盖。
  harnessConfig.socialV2 = { tokenGuard: { enabled: false }, ...(config.socialV2 ?? {}) };
  fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify(harnessConfig));
  if (savedState) fs.writeFileSync(path.join(temp, 'state/sessions.json'), JSON.stringify(savedState));
  // 额外状态文件（用于测试"启动时读到损坏/旧版文件"这类路径）。
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(temp, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content));
  }
  const calls = { created: [], archived: [], sent: [], prompts: [], follows: [], cancelled: [], images: [], faces: [], http: [] };
  // 语音发送在桥接里是**直接 fetch 网关**（与文本/表情共用 sendChain，但要自己带 record 段），
  // 所以这里给 VM 注入一个记录型 fetch：既不让测试真的发 QQ 消息，又能断言发出的段内容。
  const fakeFetch = async (url, init = {}) => {
    const body = (() => { try { return JSON.parse(init.body ?? '{}'); } catch { return init.body; } })();
    calls.http.push({ url: String(url), body });
    const action = String(url).split('/').pop();
    // 本地 TTS（voxd）：返回一个最小合法 wav，别让测试去连真实服务。
    if (String(url).includes('/v1/speak/file')) {
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => (String(h).toLowerCase() === 'x-duration-ms' ? '1500' : null) },
        arrayBuffer: async () => wavFixture()
      };
    }
    if (action === 'fetch_ptt_text') {
      return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { text: 'fixture-transcript' } }) };
    }
    // get_msg：语音落地校验用 —— 回一个带 record 段的消息，模拟真实网关
    if (action === 'get_msg') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          retcode: 0,
          data: { message_id: 9001, message: [{ type: 'record', data: { file: 'fixture-record.amr', duration: 3 } }] }
        })
      };
    }
    // 上线补历史：按会话 key 返回夹具消息（默认空），不访问真实 QQ。
    if (action === 'get_group_msg_history' || action === 'get_friend_msg_history') {
      const key = action === 'get_group_msg_history' ? `group:${body.group_id}` : `private:${body.user_id}`;
      const messages = Array.isArray(history[key]) ? history[key] : [];
      return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { messages } }) };
    }
    return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 9001 } }) };
  };
  const success = (value) => ({ result: { ok: true, value } });
  const api = {
    events: { follow: (id) => calls.follows.push(id) },
    // settings.describe 的默认桩：没有 qq-mode 命名空间 ⇒ refreshMode() 回退到本地 mode.json。
    // 测试可覆盖它来验证「DSH 设置里的空 ownerQQ 不得覆盖 config.json」等契约。
    settings: {
      describe: async () => success({ namespaces: [] }),
      update: async () => success({ updated: true })
    },
    workspace: {
      create: async () => success({ created: false, workspace: { workspaceId: 'fixture-workspace' } }),
      archiveSession: async ({ sessionId }) => { calls.archived.push(sessionId); return success({}); },
    },
    sessions: {
      create: async (params) => { calls.created.push(params); return success({ sessionId: `fixture-${calls.created.length}` }); },
      selectModel: async () => success({ selected: { provider: 'fixture', model: 'fixture' } }),
      prompt: async (params) => { calls.prompts.push(params); return success({}); },
    },
    respond: async () => success({}),
    stopSessionWork: async (sessionId) => { calls.cancelled.push(sessionId); return { removed: 0 }; },
    cancelTurn: async (sessionId) => { calls.cancelled.push({ cancelTurn: sessionId }); return { ok: true }; },
    callUnary: async (method, params) => { calls.cancelled.push({ method, params }); return success({ accepted: true }); },
  };
  class FakeBot {
    async sendPrivateMessage(id, text) { calls.sent.push({ kind: 'private', id, text }); }
    async sendGroupMessage(id, text) { calls.sent.push({ kind: 'group', id, text }); }
    async getImage({ file }) {
      calls.images.push(file);
      // Valid 1 × 1 PNG, supplied entirely in memory by the fixture gateway.
      return { base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k3ioAAAAASUVORK5CYII=' };
    }
    async fetchFaceEntity(id) { calls.faces.push(id); return null; }
    async request() { return { status: 'ok', retcode: 0, data: [{ emoji_id: 'fixture-sticker', url: 'https://public.invalid/sticker' }] }; }
  }
  let source = fs.readFileSync(path.join(root, 'src/bridge.js'), 'utf8');
  // 去掉顶层 import（VM 里靠 context 注入提供这些绑定）。
  // 必须按行处理：这些 import 有**多行**写法，用单行正则（/^import[\s\S]*?;/gm）会在
  // 第一个分号处停下，把紧跟其后的正常代码一起删掉（曾把 `cfg.socialV2.voice = {…}`
  // 整段吞掉，导致语音相关断言在虚拟环境里悄悄失真）。
  source = source.split(/\r?\n/).reduce((acc, line) => {
    if (acc.droppingImport) {
      if (/;\s*$/.test(line)) acc.droppingImport = false;
      return acc;
    }
    if (/^import[\s{*]/.test(line) || /^import\s+['"]/.test(line)) {
      if (!/;\s*$/.test(line)) acc.droppingImport = true;
      return acc;
    }
    acc.out.push(line);
    return acc;
  }, { out: [], droppingImport: false }).out.join('\n');
  source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(path.join(temp, 'src/bridge.js')).href));
  source = source.slice(0, source.indexOf("process.on('SIGINT'"));
  source = source.replace('  bot.onPrivateMessage(async (event) => {', `
  return {
    ensureSession, ensureSlangLearnerSession, resolvePresetName, deliverPrompt, drainPromptQueue,
    sendToQQ, sendStickerV2, handleIncoming, startConsoleServer, cfg, state, api, promptQueues,
    getSocialV2State, appendSocialV2Message, recordSentMessagesV2,
    fishChatWindows, evaluateConversationFishGuard, fishGuardSendBlock, recordFishWindow,
    tokenGuardWakeBlock, tokenGuardSendBlock, bridgeDailyUsage, learnerBudgetBlock,
    buildWakePromptV2, buildWakeSnapshotV2, wakeFoldedNoticeV2, sendWakePromptV2, socialV2,
    currentRoleHint, currentRoleHintV2, adminPromptLine, ownerMessageTag,
    memoryCardPromptBlock, recordMemoryInboxEvent, recordSelfMemoryEvent,
    refreshMode, modeAllowed, trackTurnEvent, replayPendingWakeReasonsV2,
    // 人的黑名单（deny.users）：入站按发送者拦截，见 test-blacklist.mjs
    senderBlocked, handlePokeNotice,
    collectors, setupSleepTimerV2,
    getInitialPrompt, setInitialPrompt, loadInitialPrompts, formatInitialPromptV2,
    initialPrompts, initialPromptMaxChars,
    extractMediaFromSegments, segmentsToText, fetchOneBotImage, fetchMediaData, resolveMediaList,
    emojiCdnCandidates, getImageDimensions, acceptImageBuffer, MAX_MEDIA_BYTES, bot,
    isConversationBusyV2, v2TurnStartAt, turnLeaseNoted, TURN_BUSY_LEASE_MS,
    settingFromDshNamespace, selfIdentityTextV2, buildWakeReminderPromptV2,
    getMode() { return currentMode; },
    setSnowlumaHealth(patch = {}) { Object.assign(snowlumaHealth, patch); },
    setSelfIdentity(display, id) {
      selfDisplayName = String(display ?? '');
      selfUserId = String(id ?? '');
      selfNickname = selfDisplayName.toLowerCase() || 'deepseek';
    },
    flushQueue, retireSession,
    // 上线补历史：测试可手动触发，不依赖真实 WebSocket / QQ。
    runHistoryCatchUp, historyCatchUpConfig, appendHistoryCatchupV2, fetchOneBotHistory,
    // 目的机制：测试可只读预览 / 手动触发 / 模拟回合回执（不连真 QQ）。
    runPurpose, purposeState, notePurposeTurnEnded, notePurposeOutbound, startPurposeLoop, warmPurposeState,
    // 对话收尾判断：测试可直接调内部函数（不连真 QQ）。
    closeConversationV2, assessClosureV2, closureConfigV2, closureSuppressesWake, noteClosureReopenV2,
    voiceCfg, voiceLibrary, resolveVoicePathForV2, resolveVoicePathForOperator, synthesizeVoiceText,
    voiceBudgetCheck, sendVoiceV2, sendVoiceForV2, assertOutboundAuditOk,
    setMode(value) { currentMode = value; },
    setReady(value) { dshReady = value; },
    setPresets(value) { dshPresetIds = value; dshDefaultPreset = 'standard'; },
    resetEpoch() { sessionEpoch++; },
  };
  bot.onPrivateMessage(async (event) => {`);
  const timers = new Set();
  const context = vm.createContext({
    fs, os, path, http, crypto, fileURLToPath, URL, Buffer, AbortSignal, console: { log() {}, error() {} },
    fetch: fakeFetch,
    // 锁文件探测用（bridge.js 顶层的 consolePortInUse）；
    // 固定桩掉：测试不应该真去 netstat 宿主机。
    execFileSync: () => '',
    // process 桩要带 env：voice-core / bridge 会读 process.env.FFMPEG_PATH、FFPROBE_PATH 等。
    // 之前只给 pid/platform/kill/exit，导致 `process.env.FFMPEG_PATH` 直接抛 TypeError。
    // DSH_HOME 指向临时目录：记忆卡的 inbox / 注入块只能写在 fixture 里，绝不能碰真实用户数据。
    process: { pid: process.pid, platform: process.platform, kill: process.kill, env: { DSH_HOME: path.join(temp, 'dsh') }, exit: (code) => { throw new Error('unexpected exit ' + code); } },
    setTimeout: (fn, ms) => { const timer = setTimeout(fn, ms); timers.add(timer); return timer; },
    clearTimeout, setInterval: () => ({ unref() {} }), clearInterval: () => {},
    NodeApiClient: class { constructor() { return api; } },
    SnowLumaWebSocketClient: FakeBot, text: (s) => s,
    discoverDshLaunchToken: () => '', unwrap, createTurnCollector, createBiliMemory, fetchVideoInfo,
    // DSH 端口兜底：isLoopbackBaseUrl 是真身（纯函数），两条探测是桩——
    // 测试不该在宿主机上真跑 netstat / 真去连 3080。
    isLoopbackBaseUrl,
    probeDshBaseUrl: async () => true,
    discoverDshBaseUrl: async () => null,
    ...markdown, ...sensitive, ...wait, ...safeFetch, ...forward, ...selfIdentity, ...slang, ...sticker,
    ...modelPrices, ...tokenLedger, ...voiceLib, ...stateAcl, ...presetPrompt, ...fishGuard, ...tokenGuard,
    ...voiceDiagnostics,
    ...allowlist,
    ...callname,
    synthesizeToFile,
    ...tokenBudget,
    ...adminIdentity, ...roleCard, ...personaLayers, ...contextTelemetry, ...memoryCard, ...biliCard, ...characterStore, ...historyCatchup,
    ...questionAnswers, ...ownerAudit, ...turnGuard, ...gateEvents,
    ...dshModelFollow,
    ...purposeEngine,
    ...conversationClosure,
    // 角色系统在 fixture 里等价于「没有角色」：当前角色 null，记忆卡指向 temp/dsh/surfcore/memory。
    // 不能直接用真实 character-store 的 DSH_HOME（它在主进程 import 时已固定）。
    readCurrentCharacter: () => null,
    activePersonaFile: () => '',
    readPersonaLayerText: () => '',
    activeBiliDir: () => path.join(temp, 'dsh', 'surfcore', 'bili'),
    activePlatformStateDir: (legacyDir) => legacyDir,
    activeMemoryPaths: () => {
      const dir = path.join(temp, 'dsh', 'surfcore', 'memory');
      return {
        dir,
        json: path.join(dir, 'memory-card.json'),
        markdown: path.join(dir, 'memory-card.md'),
        promptQq: path.join(dir, 'memory-card-prompt-qq.md'),
        promptBili: path.join(dir, 'memory-card-prompt-bili.md'),
        inbox: path.join(dir, 'memory-inbox.jsonl'),
        fullJsonl: path.join(dir, 'memory-card-full.jsonl'),
        fullStats: path.join(dir, 'memory-card-full-stats.json'),
        fullJson: path.join(dir, 'memory-card-full.json'),
        fullMarkdown: path.join(dir, 'memory-card-full.md'),
      };
    },
    isCurrentEpoch: () => true,
    // ACL 收紧会 spawn icacls 去改**真实**文件系统；测试不该做这件事（同理见下面的
    // cleanupTemp / processAudioVolume 桩）。桩成成功，让 hardenStateDirAcl 走正常分支。
    hardenDir: () => ({ ok: true, detail: 'stub' }),
    // 音量靠 ffmpeg；测试环境不该真跑 ffmpeg（也不该在沙箱里 spawn）。
    // 默认桩成"按倍数记账但不转码"，调用方可用 globals 覆盖来断言真实行为。
    processAudioVolume: async (file, { volume = 1, normalize = false, loudness = 'normal' } = {}) => {
      const v = Number(volume);
      const changed = normalize === true || Math.abs(v - 1) > 1e-9;
      return {
        path: changed ? `${file}.vol` : file,
        converted: changed,
        applied: changed,
        volume: normalize ? 1 : v,
        loudness: normalize ? -16 : null,
        mode: normalize ? 'loudnorm' : (changed ? 'volume' : 'original'),
        detail: normalize ? `智能音量（响度归一 ${loudness === 'loud' ? -13 : loudness === 'quiet' ? -20 : -16} LUFS）`
          : (changed ? `音量 ${Math.round(v * 100)}%` : '原始音量')
      };
    },
    cleanupTemp: () => {},
    ...globals,
  });
  // Execute the pure model view in the bridge realm. Its plain-object checks
  // should see the same prototypes as real bridge messages, just as in Node.
  const modelViewSource = fs.readFileSync(path.join(root, 'src/qq-model-view.js'), 'utf8').replace(/^export /gm, '');
  vm.runInContext(`Object.assign(globalThis, (() => { ${modelViewSource}\nreturn { compactModelMessage, compactModelData, serializeModelData }; })());`, context);
  vm.runInContext(source + '\nglobalThis.auditReady = main();', context);
  const bridge = await context.auditReady;
  // 夹具默认模拟“SnowLuma 已连接”；通道断开用例会显式 setSnowlumaHealth({connected:false})。
  bridge.setSnowlumaHealth({ connected: true, lastSendOkAt: Date.now(), lastSendFailAt: 0 });
  bridge.setPresets(['standard', 'qq-chat', 'qq-chat-v2']);
  bridge.setReady(true);
  return { ...bridge, calls, temp, async close() {
    for (const timer of timers) clearTimeout(timer);
    fs.rmSync(temp, { recursive: true, force: true });
  } };
}
