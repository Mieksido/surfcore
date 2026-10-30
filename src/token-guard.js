/**
 * Token 防爆破的纯逻辑（2026-10-23 用户定）。
 *
 * 和鱼群守则的关系：
 *   · 鱼群守则先判断“群里是不是鱼太多”，决定要不要发；
 *   · 本模块只判断“这一轮值不值得再花一次模型调用/再发一条”，
 *     不绕过鱼群守则；任何一边拒绝都不发。
 */
export const DEFAULT_TOKEN_GUARD = Object.freeze({
  enabled: true,
  maxWakesPerDay: 20,
  privateMaxWakesPerDay: 10,
  minWakeGapMs: 120000,
  directBypassGap: true,
  maxOutboundPerTurn: 8,
  maxDailyCostCNY: 8,
  // 回复后回访（replyCheck）是「同一次对话的收尾动作」，不是一段新对话：
  // 它还要冒一次模型回合，但不能再占「每天最多醒」的次数，否则一次对话等于花掉两次额度，
  // 私聊 10 次/天实际只能聊 5 轮（2026-10-30 用户反馈「私聊不回我」）。
  // 仍受两次苏醒最小间隔、每分钟/每小时限频和每日额度（¥）约束。
  replyCheckFree: true,
});

/** 不占「每天最多醒」次数的唤醒理由（默认只有回复后回访）。 */
export function isFreeWakeReason(reason, guard = DEFAULT_TOKEN_GUARD) {
  const g = { ...DEFAULT_TOKEN_GUARD, ...(guard && typeof guard === 'object' ? guard : {}) };
  if (g.replyCheckFree === false) return false;
  return String(reason ?? '').split(':')[0] === 'replyCheck';
}

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 每天 0 点（本地时区）。 */
export function localDayStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 醒前预算检查。
 * @param {{key?:string, wakeTimes?:number[], budgetTimes?:number[], reason?:string, now?:number, guard?:object, cost?:number, direct?:boolean}} opts
 *   wakeTimes   全部唤醒时间（判「两次苏醒最小间隔」与每分钟/每小时限频，回复后回访也算）
 *   budgetTimes 真正计入「每天最多醒」的时间（回复后回访不落进来；不传时回落到 wakeTimes）
 *   reason      本次唤醒原因，用来决定要不要计次（见 isFreeWakeReason）
 * @returns {{blocked:boolean, error?:string, retryAfterMs?:number, reason?:string, dayCount?:number, maxDay?:number, free?:boolean}}
 */
export function evaluateWakeBudget({
  key = '', wakeTimes = [], budgetTimes = null, reason = '',
  now = Date.now(), guard = DEFAULT_TOKEN_GUARD, cost = null, direct = false,
} = {}) {
  const g = { ...DEFAULT_TOKEN_GUARD, ...(guard && typeof guard === 'object' ? guard : {}) };
  const clean = (arr) => (Array.isArray(arr) ? arr : []).map(Number).filter((t) => Number.isFinite(t) && t > 0);
  const times = clean(wakeTimes);
  const counted = Array.isArray(budgetTimes) ? clean(budgetTimes) : times;
  const isPrivate = String(key ?? '').startsWith('private:');
  const maxDay = Math.max(0, Math.round(num(isPrivate ? g.privateMaxWakesPerDay : g.maxWakesPerDay, 0)));
  const free = isFreeWakeReason(reason, g);
  const dayCount = counted.filter((t) => t >= localDayStart(now)).length;
  if (g.enabled === false) return { blocked: false, dayCount, maxDay, free };
  if (!free && maxDay > 0 && dayCount >= maxDay) {
    return {
      blocked: true,
      reason: 'day',
      dayCount,
      maxDay,
      free,
      error: `Token 防爆破：这个会话今天已经醒了 ${dayCount}/${maxDay} 次，今天不再唤醒`,
    };
  }
  const gap = Math.max(0, Math.round(num(g.minWakeGapMs, 0)));
  const last = times.length ? Math.max(...times) : 0;
  const bypassGap = direct === true && g.directBypassGap !== false;
  if (!bypassGap && gap > 0 && last && now - last < gap) {
    return {
      blocked: true,
      reason: 'gap',
      retryAfterMs: gap - (now - last),
      error: `Token 防爆破：同一会话两次苏醒至少隔 ${Math.round(gap / 1000)} 秒`,
    };
  }
  const maxCost = Math.max(0, num(g.maxDailyCostCNY, 0));
  if (maxCost > 0 && Number.isFinite(Number(cost)) && Number(cost) >= maxCost) {
    return {
      blocked: true,
      reason: 'cost',
      cost: Number(cost),
      maxCost,
      error: `Token 防爆破：近 24 小时花费 ¥${Number(cost).toFixed(2)} ≥ ¥${maxCost.toFixed(2)}，暂停唤醒`,
    };
  }
  return { blocked: false, dayCount, maxDay, free };
}

/**
 * 发送前条数检查（一次醒来内累计）。
 * @returns {{blocked:boolean, next:number, max:number, error?:string}}
 */
export function evaluateOutbound({ used = 0, count = 1, guard = DEFAULT_TOKEN_GUARD } = {}) {
  const g = { ...DEFAULT_TOKEN_GUARD, ...(guard && typeof guard === 'object' ? guard : {}) };
  const max = Math.max(1, Math.round(num(g.maxOutboundPerTurn, 8)));
  const n = Math.max(1, Math.round(num(count, 1)));
  const before = Math.max(0, Math.round(num(used, 0)));
  const next = before + n;
  if (g.enabled === false) return { blocked: false, next, max };
  if (next > max) {
    return {
      blocked: true,
      next,
      max,
      error: `Token 防爆破：本次醒来最多发 ${max} 条（已发 ${before} 条）。内容太长请先总结/挑重点，不要拆成 10 条刷屏；超过 ${max} 条会被硬拦，合并成几句或下次再说。`,
    };
  }
  return { blocked: false, next, max };
}
