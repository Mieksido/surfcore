/**
 * 双向记忆同步（QQ ⇄ B站）。
 *
 * 方向一：B站 → QQ（默认开启，保持原行为）
 *   真正干活的是 QQ 桥接里的 src/bili-memory.js：它只读公开视频打分/评论/收藏/
 *   自己的公开动态/日记里的公开见闻，不读 dm-*，日记里转述私信的段落整段丢弃。
 *   本模块负责：状态、预览、隐私复检、手动刷新（经桥接控制台 API）。
 *
 * 方向二：QQ → B站（默认关闭，用户显式开启）
 *   只读 QQ 桥接写出的 state/qq-public-feed.jsonl —— 这个文件里只有“已通过白名单、
 *   且不是私信”的群消息。本模块再过一遍隐私闸门：私信话题、密钥、手机号、地址、
 *   身份证、QQ号/群号、外部链接全部剔除；再用别名（群A/群友昵称）写成人话。
 *   最终写入 ~/.dsh/surfcore/memory/qq-for-bili.md，由合体后的 B站生物钟
 *   在每次唤醒时注入。
 *
 * 两个方向都不搬运：私信、密码、令牌、联系方式、住址、精确位置、真实姓名。
 */
import fs from 'node:fs';
import path from 'node:path';
import { withConfiguredTimeZone } from '../../../src/timezone.js'
import {
  AUDIT_LOG, BILI_AI_DIR, BILI_ALIGNMENT_FILE, BILI_CONFIG, BILI_CRED,
  QQ_ALIGNMENT_BRIEF, QQ_CONFIG, QQ_STATE_DIR, ensureDirs,
} from './paths.js';
import {
  PRIVACY_POLICY_VERSION, assertSafeOutput, isPublicGroupMessage,
  normalizeText, sanitizeText, scanText,
} from './privacy.js';
import {
  detectCandidatesFromText,
  addCandidate, listLinks, writeAlignmentBriefs,
} from './align.js';
import { activeMemoryPaths, activePlatformStateDir } from '../../../src/character-persona.js';
import { backupFile, readAll, readJson, writeJsonAtomic, writeTextAtomic } from './store.js';

const FEED_FILE = path.join(QQ_STATE_DIR, 'qq-public-feed.jsonl');
const syncStateFile = () => path.join(activeMemoryPaths().dir, 'sync-state.json');
// B站 记忆简报/长文在**当前角色**的 bili 目录里（旧布局回退 repo/state）。
const biliBriefFile = () => path.join(activePlatformStateDir(QQ_STATE_DIR), 'bili-memory-brief.md');
const biliDocFile = () => path.join(activePlatformStateDir(QQ_STATE_DIR), 'bili-memory.md');
const qqForBiliFile = () => activeMemoryPaths().qqForBili;

const TOPIC_RULES = [
  { label: 'AI/DSH', re: /AI|DeepSeek|DSH|大模型|模型|插件|提示词|agent|智能体/i },
  { label: 'B站', re: /B站|b站|视频|UP主|up主|番剧|弹幕|直播|V圈|虚拟主播/i },
  { label: '游戏', re: /游戏|原神|崩铁|星铁|绝区零|杀戮尖塔|Steam|steam|手游|联机|开黑/i },
  { label: '技术', re: /代码|编程|前端|后端|Python|python|JS|js|接口|部署|报错|服务器/i },
  { label: '猫/动物', re: /猫|狗|宠物|小动物|猫猫|狗狗/i },
  { label: '音乐/二次元', re: /音乐|歌|翻唱|Vocaloid|初音|二次元|动漫|动画|MAD|手书/i },
  { label: '学习/工作', re: /学习|考试|作业|上班|工作|加班|面试|论文|学校/i },
  { label: '吃喝日常', re: /吃|饭|奶茶|咖啡|外卖|好吃|夜宵|睡|困|累/i },
  { label: '情绪/吐槽', re: /笑死|难绷|离谱|绷不住|草|无语|开心|难受|郁闷|生气|可爱/i },
];

const MEME_RE = /(?:梗|笑死|难绷|绷不住|离谱|草|乐|典|急了|破防|抽象|整活|好活)/;

function todayStamp() {
  return withConfiguredTimeZone(() => new Date().toLocaleString('sv-SE'));
}

function readFeedLines({ lookbackDays = 7, maxMessages = 300 } = {}) {
  let raw = '';
  try { raw = fs.readFileSync(FEED_FILE, 'utf8'); } catch { return []; }
  const cutoff = Date.now() - Math.max(1, Math.min(90, Number(lookbackDays) || 7)) * 86_400_000;
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let item;
    try { item = JSON.parse(line); } catch { continue; }
    const at = Date.parse(String(item?.at ?? ''));
    if (!Number.isFinite(at) || at < cutoff) continue;
    out.push({
      at,
      groupId: String(item?.groupId ?? ''),
      senderId: String(item?.senderId ?? ''),
      senderName: normalizeText(item?.senderName ?? '').slice(0, 40),
      isOwner: item?.isOwner === true,
      text: String(item?.text ?? ''),
    });
  }
  return out.slice(-Math.max(1, Math.min(5000, Number(maxMessages) || 300)));
}

function groupAliases(items) {
  const ids = [...new Set(items.map((item) => item.groupId).filter(Boolean))].sort();
  const map = new Map();
  ids.forEach((id, index) => map.set(id, `群${String.fromCharCode(65 + (index % 26))}${index >= 26 ? Math.floor(index / 26) + 1 : ''}`));
  return map;
}

function cleanMessage(text) {
  return sanitizeText(text, { dropUnsafeLines: true, keepNumbers: false, maxChars: 220 });
}

function topicLabels(text) {
  return TOPIC_RULES.filter((rule) => rule.re.test(text)).map((rule) => rule.label);
}

function quoteOf(text, max = 72) {
  const cleaned = String(text ?? '').replace(/\s+/g, ' ').trim();
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

export function collectQqMemory({ unified, qqConfig } = {}) {
  const all = unified ?? readAll().unified;
  const qq = qqConfig ?? readAll().qq;
  const cfg = all.memory?.qqToBili ?? {};
  const privacy = all.memory?.privacy ?? {};
  const allowedGroups = (Array.isArray(cfg.includeGroups) && cfg.includeGroups.length ? cfg.includeGroups : qq.allow?.groups ?? []).map(String);
  const ownerId = String(qq.ownerQQ ?? '');
  const items = readFeedLines({ lookbackDays: cfg.lookbackDays, maxMessages: cfg.maxMessages });
  const groups = groupAliases(items);
  const stats = {
    scanned: items.length,
    kept: 0,
    dropped: 0,
    redactions: 0,
    ownerSkipped: 0,
    privateSkipped: 0,
    groupSkipped: 0,
    byReason: {},
    groups: groups.size,
    policyVersion: PRIVACY_POLICY_VERSION,
  };
  const kept = [];
  for (const item of items) {
    const gate = isPublicGroupMessage({
      key: `group:${item.groupId}`,
      groupIds: allowedGroups,
      text: item.text,
      senderId: item.senderId,
      ownerId,
      includeOwner: cfg.includeOwner === true,
    });
    if (!gate.ok) {
      stats.dropped += 1;
      if (gate.reason.includes('管理员')) stats.ownerSkipped += 1;
      else if (gate.reason.includes('私信')) stats.privateSkipped += 1;
      else if (gate.reason.includes('白名单')) stats.groupSkipped += 1;
      stats.byReason[gate.reason] = (stats.byReason[gate.reason] ?? 0) + 1;
      continue;
    }
    const result = cleanMessage(item.text);
    if (!result.ok) {
      stats.dropped += 1;
      stats.byReason[result.reason || 'privacy'] = (stats.byReason[result.reason || 'privacy'] ?? 0) + 1;
      continue;
    }
    stats.redactions += result.hits.length;
    stats.kept += 1;
    const safeName = sanitizeText(item.senderName, { dropUnsafeLines: false, keepNumbers: false, maxChars: 24 });
    kept.push({
      ...item,
      clean: result.text,
      groupAlias: groups.get(item.groupId) || '群?',
      senderAlias: (cfg.useNicknames !== false && safeName.ok && safeName.text) ? safeName.text : '群友',
      topics: topicLabels(result.text),
    });
  }
  return { cfg, privacy, allowedGroups, stats, kept, groups };
}

function buildQqForBiliDoc(collected, { qqConfig } = {}) {
  const { cfg, stats, kept, groups } = collected;
  const links = listLinks();
  const qqById = new Map(links.filter((link) => link.identities.qq).map((link) => [link.identities.qq.id, link]));
  const lines = [];
  lines.push('# QQ 群里的近况（给 B站 那边看）');
  lines.push('');
  lines.push(`> 自动同步：${todayStamp()}`);
  lines.push('> 来源：只来自**已通过白名单的公开群消息**；没有私信、没有私聊、没有密码/令牌/联系方式/住址。');
  lines.push(`> 本次扫描 ${stats.scanned} 条，保留 ${stats.kept} 条，丢弃 ${stats.dropped} 条（隐私/命令/媒体），脱敏 ${stats.redactions} 处。`);
  lines.push('');

  // 群友画像
  const bySender = new Map();
  for (const item of kept) {
    const key = `${item.groupAlias}|${item.senderId}|${item.senderAlias}`;
    if (!bySender.has(key)) bySender.set(key, { groupAlias: item.groupAlias, senderId: item.senderId, senderAlias: item.senderAlias, topics: new Map(), samples: [] });
    const entry = bySender.get(key);
    for (const topic of item.topics) entry.topics.set(topic, (entry.topics.get(topic) ?? 0) + 1);
    if (entry.samples.length < 2 && item.clean.length >= 8) entry.samples.push(quoteOf(item.clean, 60));
  }
  lines.push('## 一、群友近况');
  lines.push('');
  const senderEntries = [...bySender.values()].sort((a, b) => b.samples.length - a.samples.length);
  if (!senderEntries.length) {
    lines.push('- （这段时间没有可同步的公开群消息）');
  } else {
    for (const entry of senderEntries.slice(0, 20)) {
      const topics = [...entry.topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([label]) => label);
      const aligned = links.find((link) => link.identities.qq?.id === entry.senderId)?.identities?.bili;
      const who = aligned?.name ? `（B站「${aligned.name}」）` : '';
      lines.push(`- ${entry.groupAlias} · ${entry.senderAlias}${who}：${topics.length ? `最近常聊 ${topics.join('、')}` : '最近聊得比较杂'}${entry.samples[0] ? `；说过「${entry.samples[0]}」` : ''}`);
    }
  }
  lines.push('');

  // 最近话题（每群最多 8 条）
  lines.push('## 二、最近群里在聊什么');
  lines.push('');
  const byGroup = new Map();
  for (const item of kept) {
    if (!byGroup.has(item.groupAlias)) byGroup.set(item.groupAlias, []);
    byGroup.get(item.groupAlias).push(item);
  }
  let printed = 0;
  for (const [groupAlias, list] of [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`### ${groupAlias}`);
    for (const item of list.slice(-8)) {
      lines.push(`- ${item.senderAlias}：${quoteOf(item.clean, 110)}`);
      printed += 1;
    }
    lines.push('');
  }
  if (!printed) lines.push('- （暂无）');
  lines.push('');

  // 梗
  const memes = kept.filter((item) => MEME_RE.test(item.clean)).slice(-8).map((item) => `${item.groupAlias} · ${item.senderAlias}：${quoteOf(item.clean, 80)}`);
  lines.push('## 三、最近的梗 / 口头禅');
  lines.push('');
  if (memes.length) {
    for (const meme of memes) lines.push(`- ${meme}`);
  } else {
    lines.push('- （这段时间没有特别明显的梗）');
  }
  lines.push('');

  // 与 B 站交集
  lines.push('## 四、和 B 站的交集');
  lines.push('');
  if (links.length) {
    for (const link of links.slice(0, 30)) {
      const qq = link.identities.qq;
      const bili = link.identities.bili;
      if (!qq || !bili) continue;
      lines.push(`- QQ 群友「${qq.name || '群友'}」= B站「${bili.name || bili.id}」(mid ${bili.id})`);
    }
  } else {
    lines.push('- （还没有登记身份对齐；如果群友在群里说过自己的 B 站号，可以在「身份对齐」里确认）');
  }
  lines.push('');

  lines.push('## 五、边界（不可越过）');
  lines.push('');
  lines.push('1. 这些是**公开群聊**的脱敏摘要，不是私信，也不是群友的完整原话。');
  lines.push('2. 不要在 B 站公开评论/动态/直播间里提到 QQ 群号、群昵称、任何人的 QQ 号。');
  lines.push('3. 不要用这些内容去追问、验证或“开盒”任何人；认出来就够了。');
  lines.push('4. 涉及钱、地址、联系方式、账号密码、身份证、家庭信息的内容一律不在记忆里；如果群友问起，就说不知道。');
  lines.push('5. 对齐身份只用于认人；认错时以对方当场说的为准。');
  lines.push('');

  let doc = lines.join('\n');
  const maxChars = Math.max(1200, Math.min(20_000, Number(cfg.maxChars) || 6000));
  if (doc.length > maxChars) {
    // 保留头部 + 边界，截断中间的话题列表
    const boundary = doc.indexOf('## 五、边界');
    const head = doc.slice(0, Math.max(800, maxChars - 900));
    const tail = boundary > 0 ? doc.slice(boundary) : '';
    doc = `${head}\n\n（中略：这次同步内容太长，已截断；旧内容见上一份备份）\n\n${tail}`;
    doc = doc.slice(0, maxChars);
  }
  return doc;
}

function appendAudit(entry) {
  try {
    ensureDirs();
    fs.appendFileSync(AUDIT_LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
    // 保持文件不超过 ~2MB
    try {
      const stat = fs.statSync(AUDIT_LOG);
      if (stat.size > 2 * 1024 * 1024) {
        const lines = fs.readFileSync(AUDIT_LOG, 'utf8').split('\n').filter(Boolean).slice(-2000);
        fs.writeFileSync(AUDIT_LOG, `${lines.join('\n')}\n`);
      }
    } catch {}
  } catch {}
}

export function readSyncState() {
  return readJson(syncStateFile(), {
    lastQqToBili: null,
    lastBiliToQq: null,
    lastAlignmentScan: null,
  }) ?? {};
}

function writeSyncState(patch) {
  const next = { ...readSyncState(), ...patch, updatedAt: new Date().toISOString() };
  writeJsonAtomic(syncStateFile(), next);
  return next;
}

/** QQ → B站：生成脱敏记忆文件。 */
export function syncQqToBili({ force = false } = {}) {
  const all = readAll();
  const unified = all.unified;
  const qq = all.qq;
  if (unified.memory?.qqToBili?.enabled !== true) {
    return { ok: true, skipped: 'disabled', reason: 'QQ → B站 记忆同步没有开启' };
  }
  const collected = collectQqMemory({ unified, qqConfig: qq });
  if (!collected.kept.length) {
    const doc = buildQqForBiliDoc(collected);
    backupFile(qqForBiliFile(), 'qq-for-bili');
    writeTextAtomic(qqForBiliFile(), `${doc}\n`);
    const stats = { ...collected.stats, chars: doc.length, ok: true, empty: true };
    writeSyncState({ lastQqToBili: { at: new Date().toISOString(), ...stats } });
    appendAudit({ direction: 'qq->bili', ok: true, ...stats });
    return { ok: true, stats, path: qqForBiliFile() };
  }
  const doc = buildQqForBiliDoc(collected, { qqConfig: qq });
  // 最后一道闸：任何严重命中都拒绝落盘（不把“疑似泄露”写成事实）。
  assertSafeOutput(doc.replace(/\b\d{5,12}\b/g, ''), 'QQ→B站记忆');
  backupFile(qqForBiliFile(), 'qq-for-bili');
  writeTextAtomic(qqForBiliFile(), `${doc}\n`);
  const stats = { ...collected.stats, chars: doc.length, ok: true };
  writeSyncState({ lastQqToBili: { at: new Date().toISOString(), ...stats } });
  appendAudit({ direction: 'qq->bili', ok: true, ...stats });
  // 顺手扫描身份对齐候选（只从公开群消息里找“我B站是…”）
  let candidates = 0;
  if (all.unified.alignment?.autoDetect !== false) {
    candidates = scanQqFeedForCandidates({ maxMessages: 800 }).added;
  }
  return { ok: true, stats, path: qqForBiliFile(), candidates };
}

/** 读取 QQ → B站 记忆文件（给 UI 预览/给 B站调度器注入）。 */
export function readQqForBili({ maxChars = 6000 } = {}) {
  try {
    const text = fs.readFileSync(qqForBiliFile(), 'utf8').trim();
    const scan = scanText(text);
    const blocked = scan.hits.some((hit) => hit.severe);
    if (blocked) {
      return { ok: false, blocked: true, text: '', chars: 0, labels: [...new Set(scan.hits.filter((h) => h.severe).map((h) => h.label))] };
    }
    return { ok: true, blocked: false, text: text.slice(0, maxChars), chars: text.length };
  } catch {
    return { ok: true, blocked: false, text: '', chars: 0 };
  }
}

/** B站 → QQ：桥接侧生成，本模块只复检与展示。 */
export function biliToQqStatus() {
  const all = readAll();
  const enabled = all.qq?.biliBridge?.enabled !== false && all.qq?.biliBridge?.memory?.enabled !== false;
  let brief = '';
  let doc = '';
  try { brief = fs.readFileSync(biliBriefFile(), 'utf8'); } catch {}
  try { doc = fs.readFileSync(biliDocFile(), 'utf8'); } catch {}
  const scanBrief = scanText(brief);
  const severe = scanBrief.hits.filter((hit) => hit.severe);
  let mtime = null;
  try { mtime = fs.statSync(biliBriefFile()).mtime.toISOString(); } catch {}
  return {
    enabled,
    available: Boolean(brief),
    generatedAt: mtime,
    briefChars: brief.length,
    docChars: doc.length,
    blocked: severe.length > 0,
    labels: [...new Set(severe.map((hit) => hit.label))],
    briefPreview: severe.length ? '' : brief.slice(0, 4000),
    policyVersion: PRIVACY_POLICY_VERSION,
  };
}

/** QQ 方向的手动刷新：通过桥接控制台触发它自己的 bili-memory 生成器。 */
export async function refreshBiliToQq({ callBridge }) {
  if (typeof callBridge !== 'function') return { ok: false, error: '桥接控制不可用' };
  const result = await callBridge('/api/bili/memory/refresh', { method: 'POST', body: {} });
  if (!result.ok) return { ok: false, error: result.data?.error || result.error || `HTTP ${result.status}` };
  const stats = result.data?.stats ?? null;
  appendAudit({ direction: 'bili->qq', ok: true, refreshed: true, stats });
  writeSyncState({ lastBiliToQq: { at: new Date().toISOString(), stats } });
  return { ok: true, stats, status: biliToQqStatus() };
}

export function memoryStatus() {
  const all = readAll();
  const qqToBili = all.unified.memory?.qqToBili ?? {};
  const sync = readSyncState();
  const qqMemory = readQqForBili({ maxChars: 200 });
  const bili = biliToQqStatus();
  const alignBili = (() => { try { return fs.readFileSync(BILI_ALIGNMENT_FILE, 'utf8').trim(); } catch { return ''; } })();
  const alignQq = (() => { try { return fs.readFileSync(QQ_ALIGNMENT_BRIEF, 'utf8').trim(); } catch { return ''; } })();
  return {
    qqToBili: {
      enabled: qqToBili.enabled === true,
      lookbackDays: qqToBili.lookbackDays ?? 7,
      maxChars: qqToBili.maxChars ?? 6000,
      chars: qqMemory.chars,
      blocked: qqMemory.blocked,
      path: qqForBiliFile(),
      last: sync.lastQqToBili ?? null,
      preview: qqMemory.text.slice(0, 1200),
    },
    biliToQq: {
      ...bili,
      path: biliBriefFile(),
      last: sync.lastBiliToQq ?? null,
    },
    privacy: {
      policyVersion: PRIVACY_POLICY_VERSION,
      blockPrivateMessages: true,
      blockSecrets: true,
      blockPii: true,
      blockContact: true,
      auditPath: AUDIT_LOG,
      auditLines: (() => { try { return fs.readFileSync(AUDIT_LOG, 'utf8').split('\n').filter(Boolean).length; } catch { return 0; } })(),
    },
    alignment: {
      qqBriefChars: alignQq.length,
      biliBriefChars: alignBili.length,
    },
    files: {
      qqForBili: qqForBiliFile(),
      biliBrief: biliBriefFile(),
      qqAlignmentBrief: QQ_ALIGNMENT_BRIEF,
      biliAlignmentBrief: BILI_ALIGNMENT_FILE,
    },
  };
}

export function previewQqForBili({ maxChars = 8000 } = {}) {
  return readQqForBili({ maxChars });
}

export function auditTail(limit = 60) {
  try {
    const lines = fs.readFileSync(AUDIT_LOG, 'utf8').split('\n').filter(Boolean).slice(-Math.max(1, Math.min(500, limit)));
    return lines.map((line) => {
      try { return JSON.parse(line); } catch { return { raw: line.slice(0, 200) }; }
    });
  } catch {
    return [];
  }
}

/** 从公开群消息里找“我B站是…”的候选（不自动生效）。 */
export function scanQqFeedForCandidates({ maxMessages = 800 } = {}) {
  const items = readFeedLines({ lookbackDays: 30, maxMessages });
  const qqConfig = readJson(QQ_CONFIG, {}) ?? {};
  const ownerId = String(qqConfig.ownerQQ ?? '');
  const allowed = new Set((qqConfig.allow?.groups ?? []).map(String));
  let added = 0;
  for (const item of items) {
    if (allowed.size && !allowed.has(item.groupId)) continue;
    if (ownerId && item.senderId === ownerId) continue;
    const hit = detectCandidatesFromText({
      platform: 'qq',
      text: item.text,
      author: { id: item.senderId, name: item.senderName },
      source: 'qq-public-feed',
      counterpartPlatform: 'bili',
    });
    for (const candidate of hit) {
      const result = addCandidate(candidate);
      if (result) added += 1;
    }
  }
  const state = { at: new Date().toISOString(), scanned: items.length, added };
  writeSyncState({ lastAlignmentScan: state });
  return state;
}

/** 从 B 站公开回复/@ 里找 QQ 号候选。需要 cookie；失败只记录不抛。 */
export async function scanBiliFeedForCandidates({ maxPages = 2 } = {}) {
  try {
    const { pullFeed, makeHeaders } = await import('../tools/lib/msgfeed.mjs');
    const credentials = readJson(BILI_CRED, null);
    if (!credentials?.sessdata || !credentials?.bili_jct) {
      return { ok: false, error: 'B站 cookie 未配置，无法扫描 B 站侧候选', added: 0 };
    }
    const headers = makeHeaders(credentials);
    const items = [];
    for (const kind of ['reply', 'at']) {
      try {
        const page = await pullFeed(kind, { headers, pages: maxPages });
        items.push(...(page.items ?? []));
      } catch {}
    }
    let added = 0;
    for (const item of items.slice(0, 400)) {
      const text = String(item?.text ?? item?.content ?? '');
      const hit = detectCandidatesFromText({
        platform: 'bili',
        text,
        author: { id: String(item?.mid ?? ''), name: String(item?.who ?? item?.uname ?? '') },
        source: 'bili-public-feed',
        counterpartPlatform: 'qq',
      });
      for (const candidate of hit) {
        if (addCandidate(candidate)) added += 1;
      }
    }
    const state = { at: new Date().toISOString(), scanned: items.length, added };
    writeSyncState({ lastAlignmentScan: state });
    return { ok: true, ...state };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error), added: 0 };
  }
}

export function rebuildAllPrompts() {
  const alignment = writeAlignmentBriefs();
  const qqMemory = readQqForBili();
  return { alignment, qqMemoryChars: qqMemory.chars };
}

export function pathsSummary() {
  return {
    qqFeed: FEED_FILE,
    qqForBili: qqForBiliFile(),
    biliForQq: biliBriefFile(),
    qqAlignment: QQ_ALIGNMENT_BRIEF,
    biliAlignment: BILI_ALIGNMENT_FILE,
    biliConfig: BILI_CONFIG,
    biliCred: BILI_CRED,
    biliAiDir: BILI_AI_DIR,
  };
}
