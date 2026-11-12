/**
 * B站 动态：把"空间动态"的原始 JSON 变成能用的形状，并决定哪些是新的
 * ============================================================================
 * 位置：B站 模块。**B站 的动态 JSON 长什么样、第一次要不要把历史动态倒进群里**，
 * 都是这个平台自己的秘密；内核只收到一条普通事件（由 emitter 转）。
 *
 * 拆成两半：
 *   · 解析/排版：纯函数，离线可测
 *   · 增量计划：给旧状态 + 这次拉到的列表，算出"哪些是新的"和"下一个状态"
 *
 * 不碰 fs、不碰 timer、不碰网络；状态由调用方持久化。
 */

/** 解析一条空间动态（B站 polymer 接口的 item） */
export function parseDynamicItem(item) {
  const id = String(item?.id_str ?? item?.id ?? '').trim();
  const modules = item?.modules ?? {};
  const dynamic = modules?.module_dynamic ?? {};
  const author = modules?.module_author ?? {};
  const desc = dynamic?.desc ?? {};
  const major = dynamic?.major ?? {};
  const archive = major?.archive ?? {};
  const draw = major?.draw ?? {};
  const text = String(desc?.text ?? '').trim();
  const images = (Array.isArray(draw?.items) ? draw.items : [])
    .map((it) => String(it?.src ?? it?.url ?? '').trim())
    .filter(Boolean);
  return {
    id,
    type: String(item?.type ?? ''),
    pubTs: Number(author?.pub_ts ?? 0) || 0,
    pubText: String(author?.pub_time ?? '').trim(),
    text,
    bvid: String(archive?.bvid ?? '').trim(),
    title: String(archive?.title ?? '').trim(),
    images,
    url: id ? `https://t.bilibili.com/${id}` : '',
  };
}

function short(text, n) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

/** 动态 → 要发到群里的纯文本（账号名由配置给，不写死） */
export function formatDynamicMessage(item, { selfName = '' } = {}) {
  const text = String(item?.text ?? '').trim();
  const title = String(item?.title ?? '').trim();
  const url = String(item?.url ?? '').trim();
  const lines = [`【B站动态】${String(selfName || '').trim() || 'B站账号'}刚在B站发了一条动态～`];
  if (text) lines.push(short(text, 420));
  else if (title) lines.push(short(title, 160));
  else if ((item?.images ?? []).length) lines.push(`（图片动态，${item.images.length} 张图）`);
  else lines.push('（这条动态没有文字）');
  if (url && !lines.some((line) => line.includes(url))) lines.push(url);
  return lines.join('\n');
}

/** 空状态 */
export function emptyDynamicState() {
  return { version: 1, baselineAt: 0, seen: {}, lastPollAt: 0 };
}

/**
 * 增量计划：第一次只建基线（不把历史动态倒进群），之后只返回没见过的。
 * @param {object} input { items, state, now, maxSeen }
 * @returns {{baseline:boolean, fresh:object[], nextState:object}}
 */
export function planDynamicSync({
  items = [],
  state = null,
  now = Date.now(),
  maxSeen = 300,
} = {}) {
  const list = (Array.isArray(items) ? items : [])
    .map(parseDynamicItem)
    .filter((it) => it.id);
  const prev = state && typeof state === 'object' ? state : emptyDynamicState();
  const seen = prev.seen && typeof prev.seen === 'object' && !Array.isArray(prev.seen) ? { ...prev.seen } : {};
  const baselineAt = Number(prev.baselineAt) || 0;
  const at = Number(now) || Date.now();

  // 第一次运行：只记基线。旧代码这么做的理由——历史动态倒进群会像刷屏。
  if (!baselineAt) {
    for (const it of list) seen[it.id] = new Date(at).toISOString();
    return {
      baseline: true,
      fresh: [],
      nextState: { version: 1, baselineAt: at, seen: pruneSeen(seen, maxSeen), lastPollAt: at },
    };
  }

  const fresh = list
    .filter((it) => !seen[it.id])
    .sort((a, b) => (a.pubTs || 0) - (b.pubTs || 0));
  for (const it of fresh) seen[it.id] = new Date(at).toISOString();

  return {
    baseline: false,
    fresh,
    nextState: { version: 1, baselineAt, seen: pruneSeen(seen, maxSeen), lastPollAt: at },
  };
}

/** 只保留最近 maxSeen 条（按记录时间倒序） */
export function pruneSeen(seen = {}, maxSeen = 300) {
  const entries = Object.entries(seen);
  const cap = Math.max(1, Number(maxSeen) || 300);
  if (entries.length <= cap) return seen;
  entries.sort((a, b) => (Date.parse(b[1]) || 0) - (Date.parse(a[1]) || 0));
  return Object.fromEntries(entries.slice(0, cap));
}
