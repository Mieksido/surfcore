/**
 * 抖音 → QQ 的记忆生成（替代 src/bili-memory.js）。
 *
 * 数据源是 dsh-douyin-agent 插件自己落盘的东西，本模块**只读**：
 *   <memoryDir>/persona/state.json        看过哪些作品（title/author/url/observedAt）
 *   <memoryDir>/persona/role-card.md      她的人格卡（插件侧在维护）
 *   <memoryDir>/reports/videos/*.md       观看日报
 *
 * 产出与 bili-memory 对齐的三件套（供 QQ 侧提示词注入 / 记忆页展示）：
 *   douyin-memory.md        全量
 *   douyin-memory-brief.md  简报（注入用，压到 2700 字内）
 *   douyin-memory.json      索引（供 recallBlock 关键词召回）
 *
 * 接口刻意做成 biliMemory 的替身（status / briefBlock / recallBlock / refresh / paths），
 * 这样桥接层换一个实例就够，不用改十几处调用点。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLatestReport, readRecentObservations, resolveDouyinPaths } from '../plugins/surfcore/lib/douyin-status.js';

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function atomicWrite(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

function short(text, max) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function dateOf(iso) {
  return String(iso ?? '').slice(0, 10);
}

export function createDouyinMemory({ stateDir, home = os.homedir(), log = () => {}, resolvePluginPaths = null } = {}) {
  const paths = {
    doc: path.join(stateDir, 'douyin-memory.md'),
    brief: path.join(stateDir, 'douyin-memory-brief.md'),
    index: path.join(stateDir, 'douyin-memory.json'),
    // 分享过的作品（6 天内不复用），与 bili-share-history 同构。
    shareHistory: path.join(stateDir, 'douyin-share-history.json'),
  };
  let briefCache = { mtime: -1, text: '' };
  let indexCache = { mtime: -1, data: null };

  function pluginPaths() {
    // 测试可以注入一份假路径，避免碰真实的插件目录。
    return resolvePluginPaths ? resolvePluginPaths() : resolveDouyinPaths();
  }

  /** 收集条目：优先日报（结论），没有日报就用原始观察。 */
  function collectEntries() {
    const pp = pluginPaths();
    const observations = readRecentObservations(pp, 240);
    const entries = observations.map((item) => ({
      id: `douyin:${item.videoId}`,
      type: 'watch',
      title: item.title,
      author: item.author,
      url: item.url,
      videoId: item.videoId,
      date: dateOf(item.time),
      at: item.time,
      duration: item.durationSec,
    }));
    return { entries, report: readLatestReport(pp), paths: pp };
  }

  function buildDoc({ entries, report }) {
    const lines = [];
    lines.push('# 我在抖音上的经历（供 QQ 侧回忆用）');
    lines.push('');
    lines.push(`生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}`);
    lines.push(`记录来源：抖音插件 dsh-douyin-agent（本地只读）`);
    lines.push('');
    if (report) {
      lines.push(`## 最近一份观看日报（${report.date}）`);
      lines.push('');
      lines.push(report.text.trim());
      lines.push('');
    }
    if (entries.length) {
      lines.push('## 看过的作品');
      lines.push('');
      for (const entry of entries.slice(0, 120)) {
        const bits = [entry.date, entry.title].filter(Boolean).join(' · ');
        const author = entry.author ? `｜@${entry.author}` : '';
        lines.push(`- ${bits}${author}${entry.url ? `｜${entry.url}` : ''}`);
      }
      lines.push('');
    }
    if (!report && !entries.length) {
      lines.push('（还没有看过任何作品的记录。）');
      lines.push('');
    }
    lines.push('边界：抖音私信里的内容不在我的记忆里，我也不会编；群友问起就按记得的公开作品回答。');
    return `${lines.join('\n')}\n`;
  }

  function buildBrief({ entries, report }) {
    const lines = [];
    const today = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
    lines.push(`【抖音记忆·${today}】`);
    if (report) {
      const firstLines = report.text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      if (firstLines.length) lines.push(`今天我自己刷的时候记下的：${short(firstLines.slice(0, 6).join('；'), 900)}`);
    }
    const recent = entries.slice(0, 12);
    if (recent.length) {
      const items = recent.map((entry) => short(`${entry.title || entry.videoId}${entry.author ? `（@${entry.author}）` : ''}`, 60));
      lines.push(`最近看过的：${items.join('；')}`);
    }
    if (!report && !recent.length) return '';
    lines.push('这些是公开作品，可以直接当聊天素材；抖音私信内容不在记忆里，不要编。');
    let brief = lines.join('\n');
    if (brief.length > 2700) brief = `${brief.slice(0, 2700)}…`;
    return brief;
  }

  function buildIndex(entries) {
    return {
      generatedAt: new Date().toISOString(),
      platform: 'douyin',
      entries: entries.slice(0, 260).map((entry) => ({
        id: entry.id,
        type: entry.type,
        title: short(entry.title, 200),
        author: short(entry.author, 80),
        videoId: entry.videoId,
        url: entry.url,
        date: entry.date,
        at: entry.at,
      })),
    };
  }

  function readBrief() {
    try {
      const st = fs.statSync(paths.brief);
      if (briefCache.mtime === st.mtimeMs) return briefCache.text;
      const text = fs.readFileSync(paths.brief, 'utf8').trim();
      briefCache = { mtime: st.mtimeMs, text };
      return text;
    } catch {
      return '';
    }
  }

  function readIndex() {
    try {
      const st = fs.statSync(paths.index);
      if (indexCache.mtime === st.mtimeMs && indexCache.data) return indexCache.data;
      const data = JSON.parse(fs.readFileSync(paths.index, 'utf8'));
      indexCache = { mtime: st.mtimeMs, data };
      return data;
    } catch {
      return null;
    }
  }

  async function refresh({ force = false } = {}) {
    const collected = collectEntries();
    const doc = buildDoc(collected);
    const brief = buildBrief(collected);
    const index = buildIndex(collected.entries);
    let changed = force;
    try {
      const prev = fs.readFileSync(paths.doc, 'utf8');
      changed = changed || prev !== doc;
    } catch {
      changed = true;
    }
    if (changed) {
      atomicWrite(paths.doc, doc);
      atomicWrite(paths.brief, brief ? `${brief}\n` : '');
      atomicWrite(paths.index, `${JSON.stringify(index, null, 2)}\n`);
      log(`抖音记忆已刷新：${collected.entries.length} 条作品${collected.report ? `，日报 ${collected.report.date}` : ''}`);
    }
    return { ok: true, changed, entries: collected.entries.length, hasReport: Boolean(collected.report), chars: brief.length };
  }

  function status() {
    let docChars = 0;
    let generatedAt = null;
    try {
      const st = fs.statSync(paths.doc);
      docChars = st.size;
      generatedAt = st.mtime.toISOString();
    } catch {}
    const index = readIndex();
    return {
      platform: 'douyin',
      enabled: true,
      // 兼容旧字段（overview / 记忆页还在读 available / blocked）。
      available: docChars > 0,
      blocked: false,
      docChars,
      briefChars: readBrief().length,
      generatedAt,
      entries: index?.entries?.length ?? 0,
      plugin: pluginPaths(),
    };
  }

  /** 关键词召回：给 QQ 侧「刚聊到某个作品」时补上下文。 */
  function recallBlock(text) {
    const query = String(text ?? '').trim();
    if (!query) return '';
    const index = readIndex();
    const entries = Array.isArray(index?.entries) ? index.entries : [];
    if (!entries.length) return '';
    const tokens = [...new Set(query.toLowerCase().split(/[\s,，。！？!?、:：;；"'“”()（）\[\]【】]+/).filter((t) => t.length >= 2))].slice(0, 8);
    if (!tokens.length) return '';
    const scored = [];
    for (const entry of entries) {
      const haystack = `${entry.title} ${entry.author}`.toLowerCase();
      let score = 0;
      for (const token of tokens) if (haystack.includes(token)) score += token.length;
      if (score > 0) scored.push({ entry, score });
    }
    scored.sort((a, b) => b.score - a.score);
    if (!scored.length) return '';
    const lines = ['【抖音记忆·相关】'];
    for (const { entry } of scored.slice(0, 5)) {
      lines.push(`- ${entry.date ?? ''} ${short(entry.title, 80)}${entry.author ? `（@${entry.author}）` : ''}`);
    }
    return lines.join('\n');
  }

  // ── 分享池 ────────────────────────────────────────────────────────────
  // 和 bili-memory 的 pickShareCard 对齐：从「她真看过」的作品里挑一条，
  // 分享过的不再复用（默认 6 天），池子空了就返回 null —— 宁可今天不发，
  // 也不要把同一条视频反复甩进群里。
  const SHARE_COOLDOWN_MS = 6 * 86400000;
  const SHARE_BAD_WORDS = ['直播回放', '正在直播', '广告', '代购', '优惠券', '拼团', '点击链接'];

  function readShareHistory() {
    const data = readJson(paths.shareHistory, null);
    const out = {};
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      for (const [id, at] of Object.entries(data)) {
        if (typeof at === 'string' && Number.isFinite(Date.parse(at))) out[id] = at;
      }
    }
    return out;
  }

  function writeShareHistory(next) {
    try {
      atomicWrite(paths.shareHistory, `${JSON.stringify(next, null, 2)}\n`);
    } catch (error) {
      log(`[抖音分享] 分享历史写入失败：${error?.message ?? error}`);
    }
  }

  /** 可分享的候选：有标题、有链接、不是广告/直播、6 天内没发过。 */
  function sharePool({ now = Date.now(), cooldownMs = SHARE_COOLDOWN_MS } = {}) {
    const { entries } = collectEntries();
    const history = readShareHistory();
    const seen = new Set();
    const pool = [];
    for (const entry of entries) {
      const id = entry.videoId || entry.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const title = String(entry.title ?? '').trim();
      if (title.length < 6) continue;
      if (!String(entry.url ?? '').trim()) continue;
      if (SHARE_BAD_WORDS.some((word) => title.includes(word))) continue;
      const sharedAt = Date.parse(history[id] ?? '');
      if (Number.isFinite(sharedAt) && now - sharedAt < cooldownMs) continue;
      pool.push({ ...entry, id, title });
    }
    // 新的排前面：插件落盘顺序不保证，按时间显式排一次。
    pool.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
    return pool;
  }

  /**
   * 挑一条分享素材。
   * @param {{slotIndex?:number}} options slotIndex 让一天的不同时间点各挑不同的
   *   条目（8 个点轮 8 条），不是随机，便于复现。
   */
  function pickShareCard({ slotIndex = 0 } = {}) {
    const pool = sharePool();
    if (!pool.length) return null;
    const card = pool[Math.abs(Number(slotIndex) || 0) % pool.length];
    return {
      id: card.id,
      title: card.title,
      author: card.author ?? '',
      url: card.url ?? '',
      videoId: card.videoId ?? card.id,
      date: card.date ?? '',
      // 摘要给提示词用：她的观看记录里只有标题/作者，不编造「她说了什么」。
      reason: [card.author ? `@${card.author}` : '', card.date ? `看过于 ${card.date}` : ''].filter(Boolean).join(' · '),
    };
  }

  function recordShare(id, slotKey = '') {
    const key = String(id ?? '').trim();
    if (!key) return;
    const history = readShareHistory();
    history[key] = new Date().toISOString();
    // 只留 60 天，文件不会无限长。
    const cutoff = Date.now() - 60 * 86400000;
    for (const [k, at] of Object.entries(history)) {
      if (Date.parse(at) < cutoff) delete history[k];
    }
    writeShareHistory(history);
    if (slotKey) log(`[抖音分享] 已记录分享 ${key}（${slotKey}）`);
  }

  function shareStatus() {
    const history = readShareHistory();
    return {
      poolSize: sharePool().length,
      sharedCount: Object.keys(history).length,
      lastSharedAt: Object.values(history).sort().slice(-1)[0] ?? '',
    };
  }

  return {
    paths,
    status,
    refresh,
    pickShareCard,
    recordShare,
    sharePool,
    shareStatus,
    briefBlock: readBrief,
    recallBlock,
    // 抖音这边不掌握账号显示名：插件把身份留在它自己的 profile 里，本模块不去解 cookie。
    selfInfo: () => ({ name: '', mid: '' }),
    selfName: () => '',
  };
}
