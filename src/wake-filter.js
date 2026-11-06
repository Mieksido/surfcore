/**
 * 本地唤醒判断（免费漏斗）：在花掉一次模型回合之前，用零成本规则再筛一遍。
 *
 * 为什么需要它：`evaluateWakeTriggerV2` 只回答"这条消息像不像在叫我"，命中就唤醒；
 * 可一次唤醒 = 一整段上下文。实测约 5% 的唤醒最后什么都没说（空转），
 * 还有相当一部分是"关键词命中但其实在聊别的"。
 *
 * 设计原则（2026-11-04 用户定）：
 *   1. **默认关闭**：先让用户自己开，开完先跑 dry-run 统计，看见效果再切真拦；
 *   2. **只拦软触发**：@/叫名字/拍一拍/私聊/管理员 一律不拦（点名必须应）；
 *   3. **每条规则单独开关**：用户可能只想开"垃圾消息"这一条。
 *
 * 纯逻辑，零 I/O。
 */

export const DEFAULT_LOCAL_FILTER = Object.freeze({
  enabled: false,
  dryRun: true,
  junk: true,
  recentReplyMs: 0,     // 0 = 不看"刚回过"
  rateWindowMs: 0,      // 0 = 不看"这个群醒太勤"
  rateMax: 0
});

/** 被这条规则拦下来时给用户的解释（人话）。 */
export const FILTER_LABELS = Object.freeze({
  junk: '垃圾消息（纯表情/纯"6""草"/纯标点）',
  'recently-replied': '刚回过这个群，先不插话',
  rate: '这个群醒得太勤，先压一条',
  'not-about-me': '软触发但看不出在说她'
});

const clampInt = (value, fallback, min, max) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** 从 `socialV2.wake` 里收出本地判断配置（扁平键，方便设置页逐项开关）。 */
export function normalizeLocalFilter(wake = {}) {
  const src = wake && typeof wake === 'object' ? wake : {};
  return {
    enabled: src.localFilterEnabled === true,
    dryRun: src.localFilterDryRun === undefined ? true : src.localFilterDryRun !== false,
    junk: src.localFilterJunk === undefined ? true : src.localFilterJunk !== false,
    recentReplyMs: clampInt(src.localFilterRecentReplyMs, 0, 0, 3_600_000),
    rateWindowMs: clampInt(src.localFilterRateWindowMs, 0, 0, 24 * 3_600_000),
    rateMax: clampInt(src.localFilterRateMax, 0, 0, 1000)
  };
}

/** 硬触发：被点名 / 私聊 / 管理员。这些永远不本地拦。 */
const HARD_REASONS = new Set(['atMention', 'nameMention', 'poke', 'private', 'admin']);

const JUNK_PATTERNS = [
  /^[\s\p{P}\p{S}]+$/u,            // 只有标点/符号/空白
  /^(6|66|666|6666|草|艹|233+|hhh+|哈哈+|笑死|\?{2,}|？{2,}|！{2,}|。{2,})$/u,
];

/**
 * 这条消息是不是"垃圾消息"：没有信息量，回它等于白花一轮。
 * 注意：`?`/`？` 单个不算垃圾（那是在问），只有连串才算。
 */
export function isJunkMessage(text) {
  const t = String(text ?? '').trim();
  if (!t) return true;
  if (t.length > 12) return false;           // 长消息基本都有内容
  for (const re of JUNK_PATTERNS) {
    if (re.test(t)) return true;
  }
  // 同一个字的重复（啊啊啊啊 / 好好好好）
  if (/^(.)\1{2,}$/u.test(t)) return true;
  return false;
}

/**
 * 执行本地漏斗。
 *
 * @param {object} o
 * @param {string} o.reason      唤醒原因（evaluateWakeTriggerV2 的返回值）
 * @param {string} o.text        当前消息自己的文字（不含引用原文）
 * @param {boolean} o.direct     是否被点名（@/叫名字/引用她）
 * @param {boolean} o.isPrivate  是否私聊
 * @param {number} o.recentReplyAt 她上次在这个会话说话的时间
 * @param {number[]} o.wakeTimes 这个会话最近的唤醒时间戳
 * @param {number} o.now
 * @param {object} o.filter      normalizeLocalFilter() 的结果
 * @returns {{blocked:boolean, reason:string, label:string, dryRun:boolean}}
 */
export function evaluateLocalFilter({
  reason = '',
  text = '',
  direct = false,
  isPrivate = false,
  recentReplyAt = 0,
  wakeTimes = [],
  now = Date.now(),
  filter = DEFAULT_LOCAL_FILTER
} = {}) {
  const cfg = { ...DEFAULT_LOCAL_FILTER, ...(filter || {}) };
  const pass = { blocked: false, reason: '', label: '', dryRun: cfg.dryRun };
  if (!cfg.enabled) return pass;
  const base = String(reason ?? '').split(':')[0];
  if (direct || isPrivate || HARD_REASONS.has(base)) return pass;

  if (cfg.junk && isJunkMessage(text)) {
    return { blocked: true, reason: 'junk', label: FILTER_LABELS.junk, dryRun: cfg.dryRun };
  }

  const last = Number(recentReplyAt) || 0;
  if (cfg.recentReplyMs > 0 && last > 0 && now - last < cfg.recentReplyMs) {
    return { blocked: true, reason: 'recently-replied', label: FILTER_LABELS['recently-replied'], dryRun: cfg.dryRun };
  }

  if (cfg.rateWindowMs > 0 && cfg.rateMax > 0) {
    const hits = (Array.isArray(wakeTimes) ? wakeTimes : [])
      .filter((t) => Number.isFinite(Number(t)) && now - Number(t) < cfg.rateWindowMs)
      .length;
    if (hits >= cfg.rateMax) {
      return { blocked: true, reason: 'rate', label: FILTER_LABELS.rate, dryRun: cfg.dryRun };
    }
  }

  return pass;
}
