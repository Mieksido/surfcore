// 每天若干个固定时间点，向白名单群分享「她在抖音刷到的一条作品」，并用角色的口吻补两句短评。
//
// 与 bili-share-scheduler 的关系：结构对齐（到点 → 挑素材 → 投提示词 → 记 slot），
// 但数据源换成抖音插件的观看记录（src/douyin-memory.js 的 pickShareCard）。
// 分享过的作品 6 天内不再复用，池子空就跳过 —— 宁可今天不发，也不发旧的。
//
// 注意：这里**不启动浏览器、不碰插件状态**。素材只来自插件已经落盘的观看记录；
// 她还没开始自主观看时池子是空的，调度器会安静跳过（日志里能看到原因）。
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_TIMES = ['07:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00', '23:00'];

function normalizeTimes(times) {
  const valid = [];
  for (const raw of Array.isArray(times) ? times : DEFAULT_TIMES) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw ?? '').trim());
    if (!m) continue;
    const hh = Math.min(23, Math.max(0, Number(m[1])));
    const mm = Math.min(59, Math.max(0, Number(m[2])));
    valid.push(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
  }
  return [...new Set(valid)].sort();
}

function nextOccurrence(now, times) {
  for (const t of times) {
    const [hh, mm] = t.split(':').map(Number);
    const d = new Date(now);
    d.setHours(hh, mm, 0, 0);
    if (d.getTime() > now.getTime() + 1000) return d;
  }
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  const [hh, mm] = (times[0] ?? '07:00').split(':').map(Number);
  d.setHours(hh, mm, 0, 0);
  return d;
}

/** 纯文本卡片：标题 + 链接。QQ 的 JSON 卡片在小号上经常不渲染（PITFALLS #24），所以用文字。 */
export function buildShareCardText(card) {
  const title = String(card?.title ?? '').trim();
  const url = String(card?.url ?? '').trim();
  if (!title && !url) return '';
  if (!url) return `【抖音】${title}`;
  return `【抖音】${title}\n${url}`;
}

export function buildSharePrompt(card, timeLabel, { mode = 'chat', cardSent = false } = {}) {
  const title = String(card?.title ?? '').trim() || '一条抖音视频';
  const url = String(card?.url ?? '').trim();
  const author = String(card?.author ?? '').trim();
  const when = String(card?.date ?? '').trim();
  const lines = [];
  lines.push(`【抖音分享·定时任务】现在是 ${timeLabel}，请主动在群里分享一条你最近在抖音刷到的、觉得有意思的作品。`);
  if (cardSent) {
    lines.push('标题和链接已经由系统发到群里了：这一轮你只需要补 2~3 句短评，不要再发链接或复述完整标题。');
  }
  lines.push('这一轮只做分享：不要回应群里的其他消息，不要把它当成谁在问你，也不要提“定时/任务/素材/记忆库”。');
  lines.push('');
  lines.push('素材（你确实刷到过；细节以素材为准，不要编）：');
  lines.push(`- 标题：${title}`);
  if (author) lines.push(`- 作者：@${author}`);
  if (url) lines.push(`- 链接：${url}`);
  if (when) lines.push(`- 刷到的时间：${when}`);
  lines.push('');
  lines.push('要求：');
  lines.push('1. 用你自己的口吻（按角色卡），像群里随口分享，不要像新闻播报，也不要照抄标题。');
  if (cardSent) {
    lines.push('2. 只写 2~3 句短评，合计 50~100 字；不要再贴链接，也不要重复标题。');
  } else {
    lines.push('2. 先用一句话说清是什么，再写 2~3 句短评；短评合计 50~100 字，链接照抄素材里的那一条。');
  }
  lines.push('3. 不用 Markdown，不 @ 人；句子里的拼音字遵守角色卡（一句最多一个）。');
  lines.push('4. 不聊政治、时政、娱乐圈/明星八卦，只分享好玩的内容。');
  lines.push('5. 不要把「抖音」「推荐算法」这类平台词挂嘴上，说“刚刷到”就够了。');
  if (String(mode) === 'reserved2') {
    lines.push('6. 你是二代仿真模式，文本不会自动发送：请调用 mcp__snowluma__qq_send_message 把这段内容发到当前群，messages 用字符串（一条即可），不要只输出文本。');
  } else {
    lines.push('6. 只输出要发到群里的内容，不要输出 [SILENT]，不要解释，不要加引号。');
  }
  return lines.join('\n');
}

/**
 * @param {{
 *   stateDir:string,
 *   log?:(...args:any[])=>void,
 *   deliverPrompt:(key:string, text:string)=>Promise<any>,
 *   groups:string[],
 *   memory:any,
 *   isReady?:()=>boolean,
 *   times?:string[],
 *   gapMs?:number,
 *   getMode?:()=>string,
 *   sendCard?:(key:string, card:any)=>Promise<boolean>|boolean|null,
 *   isEnabled?:()=>boolean,
 * }} options
 */
export function createDouyinShareScheduler({
  stateDir,
  log = () => {},
  deliverPrompt,
  groups = [],
  memory,
  isReady = () => true,
  times = DEFAULT_TIMES,
  gapMs = 4000,
  getMode = () => 'chat',
  sendCard = null,
  isEnabled = () => true,
}) {
  const timeList = normalizeTimes(times);
  const stateFile = path.join(stateDir, 'douyin-share-state.json');
  let timer = null;
  let running = false;
  let started = false;

  function readState() {
    try {
      let text = fs.readFileSync(stateFile, 'utf8');
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      const parsed = JSON.parse(text);
      return {
        lastSlot: typeof parsed?.lastSlot === 'string' ? parsed.lastSlot : '',
        lastRunAt: typeof parsed?.lastRunAt === 'string' ? parsed.lastRunAt : '',
        lastSlots: parsed && typeof parsed.lastSlots === 'object' && parsed.lastSlots && !Array.isArray(parsed.lastSlots)
          ? parsed.lastSlots
          : {},
      };
    } catch {
      return { lastSlot: '', lastRunAt: '', lastSlots: {} };
    }
  }

  function writeState(patch) {
    const next = { ...readState(), ...patch };
    if (!next.lastSlots || typeof next.lastSlots !== 'object' || Array.isArray(next.lastSlots)) next.lastSlots = {};
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const tmp = `${stateFile}.${process.pid}.${Math.random().toString(16).slice(2, 8)}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, stateFile);
    } catch (error) {
      log(`[抖音分享] 状态写入失败：${error?.message ?? error}`);
    }
  }

  function markSlot(slotKey) {
    const st = readState();
    const lastSlots = { ...(st.lastSlots ?? {}) };
    const nowIso = new Date().toISOString();
    lastSlots[slotKey] = nowIso;
    const cutoff = Date.now() - 30 * 86400000;
    for (const [k, v] of Object.entries(lastSlots)) {
      if (Date.parse(v) < cutoff) delete lastSlots[k];
    }
    writeState({ lastSlot: slotKey, lastRunAt: nowIso, lastSlots });
  }

  function dateKey(now = new Date()) {
    return now.toLocaleDateString('sv-SE');
  }

  function slotIndexOf(timeLabel) {
    return timeList.indexOf(timeLabel);
  }

  async function fire(timeLabel, { manual = false } = {}) {
    if (!isEnabled()) {
      log('[抖音分享] 抖音已停用（设置里的启动开关关了），跳过本次');
      return { ok: false, skipped: true, why: 'douyin-disabled' };
    }
    if (running) {
      log('[抖音分享] 上一轮还没跑完，跳过本次');
      return { ok: false, skipped: true };
    }
    if (!groups.length) return { ok: false, why: '没有白名单群' };
    if (!memory) return { ok: false, why: '记忆模块未初始化' };
    const now = new Date();
    const dk = dateKey(now);
    const slotKey = manual ? `${dk} manual ${now.toTimeString().slice(0, 5)}` : `${dk} ${timeLabel}`;
    const st0 = readState();
    const already = Boolean(st0.lastSlots?.[slotKey]) || st0.lastSlot === slotKey;
    if (!manual && already) {
      log(`[抖音分享] ${slotKey} 已经跑过，跳过`);
      return { ok: true, skipped: true };
    }
    // DSH 离线时不跳过：deliverPrompt 会把提示词放进离线队列，恢复后补投。
    running = true;
    try {
      const slotIndex = Math.max(0, slotIndexOf(timeLabel));
      const card = memory.pickShareCard({ slotIndex, dateKey: dk });
      if (!card) {
        log('[抖音分享] 没有可分享的素材（还没刷过 / 都发过了），本次跳过；不发旧内容');
        return { ok: false, why: '没有新鲜素材' };
      }
      let sent = 0;
      for (const gid of groups) {
        const key = `group:${gid}`;
        let cardSent = false;
        if (sendCard) {
          try {
            cardSent = (await sendCard(key, card)) === true;
            if (cardSent) log(`[抖音分享] ${timeLabel} 已发分享 ${key}：${String(card.title).slice(0, 30)}`);
          } catch (error) {
            log(`[抖音分享] ${timeLabel} 分享发送失败 ${key}：${error?.message ?? error}`);
          }
        }
        const prompt = buildSharePrompt(card, timeLabel, { mode: getMode(), cardSent });
        let promptOk = false;
        try {
          await deliverPrompt(key, prompt);
          promptOk = true;
          log(`[抖音分享] ${timeLabel} 已投递 ${key}：${String(card.title).slice(0, 30)}（${card.videoId || card.id}）`);
        } catch (error) {
          log(`[抖音分享] ${timeLabel} 投递失败 ${key}：${error?.message ?? error}`);
        }
        if (cardSent || promptOk) sent += 1;
        if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
      }
      // 投递成功才记为已用/已跑；全失败时不写 slot，方便补发。
      if (sent > 0) {
        memory.recordShare(card.id, slotKey);
        markSlot(slotKey);
      } else {
        log(`[抖音分享] ${timeLabel} 全部群投递失败，本次不记为已跑`);
      }
      return { ok: sent > 0, sent, card: { id: card.id, title: card.title, videoId: card.videoId } };
    } finally {
      running = false;
    }
  }

  function scheduleNext() {
    if (timer) clearTimeout(timer);
    const next = nextOccurrence(new Date(), timeList);
    const delay = Math.max(1000, next.getTime() - Date.now());
    timer = setTimeout(async () => {
      const label = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
      try { await fire(label); } catch (error) { log(`[抖音分享] 定时异常：${error?.message ?? error}`); }
      scheduleNext();
    }, delay);
    timer.unref?.();
    log(`[抖音分享] 已排定：每天 ${timeList.join(' / ')}（下次 ${next.toLocaleString()}）→ ${groups.length} 个群`);
  }

  function start() {
    if (started) return;
    if (!groups.length) { log('[抖音分享] 没有白名单群，未启动'); return; }
    started = true;
    // 启动补跑：桥接在时间点后 10 分钟内重启，且这个点还没跑过，就补一次。
    try {
      const now = new Date();
      const dk = dateKey(now);
      for (const t of timeList) {
        const [hh, mm] = t.split(':').map(Number);
        const slot = new Date(now);
        slot.setHours(hh, mm, 0, 0);
        const delta = now.getTime() - slot.getTime();
        const st = readState();
        const key = `${dk} ${t}`;
        if (delta >= 0 && delta <= 10 * 60 * 1000 && !st.lastSlots?.[key] && st.lastSlot !== key) {
          log(`[抖音分享] 启动补跑 ${t}（已过点 ${Math.round(delta / 60000)} 分钟）`);
          setTimeout(() => { void fire(t); }, 1500).unref?.();
          break;
        }
      }
    } catch (error) {
      log(`[抖音分享] 补跑检查失败：${error?.message ?? error}`);
    }
    scheduleNext();
  }

  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    started = false;
  }

  function status() {
    const st = readState();
    const next = nextOccurrence(new Date(), timeList);
    return {
      enabled: started,
      times: timeList,
      groups,
      nextAt: next.toISOString(),
      lastSlot: st.lastSlot ?? '',
      lastSlots: st.lastSlots ?? {},
      lastRunAt: st.lastRunAt ?? '',
      running,
      pool: typeof memory?.shareStatus === 'function' ? memory.shareStatus() : null,
    };
  }

  return {
    start,
    stop,
    fire,
    fireNow: (opts = {}) => fire(new Date().toTimeString().slice(0, 5), { ...opts, manual: true }),
    status,
    buildSharePrompt,
  };
}
