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
  // @ / 叫名字 / 提问 / 拍一拍 也不受每日自动唤醒次数限制（2026-10-31 用户要求）
  directBypassDay: true,
  maxOutboundPerTurn: 8,
  maxDailyCostCNY: 8,
  // 回复后回访是同一段对话的收尾，不再占每日次数（2026-11-03 用户反馈：私聊 10 次只够 5 轮）。
  // 仍受最小间隔、每分钟/每小时限频和每日花费上限约束。
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
 * @param {{key?:string, wakeTimes?:number[], now?:number, guard?:object, cost?:number, direct?:boolean}} opts
 * @returns {{blocked:boolean, error?:string, retryAfterMs?:number, reason?:string, dayCount?:number, maxDay?:number}}
 */
/** 距本地时间「明天 00:00」还有多少毫秒（day 限额在新一天清零）。 */
export function msUntilNextLocalDay(now = Date.now()) {
  const d = new Date(now);
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return Math.max(1_000, next.getTime() - now);
}

/**
 * 醒前预算检查。
 * @param {{key?:string, wakeTimes?:number[], budgetTimes?:number[], reason?:string, now?:number, guard?:object, cost?:number, direct?:boolean}} opts
 *   wakeTimes   全部唤醒时间（判「两次苏醒最小间隔」与每分钟/每小时限频，回复后回访也算）
 *   budgetTimes 真正计入「每天最多醒」的时间；不传时回落到 wakeTimes
 *   reason      本次唤醒原因，用来决定要不要计次（见 isFreeWakeReason）
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
  // direct（@ / 叫名字 / 提问 / 拍一拍）是"有人明确在叫"，不能被每日自动唤醒配额挡住：
  // 否则跨天前主人 @ 也不理（2026-10-31 用户反馈）。可用 directBypassDay=false 关掉。
  const bypassDay = direct === true && g.directBypassDay !== false;
  if (!free && maxDay > 0 && dayCount >= maxDay && !bypassDay) {
    return {
      blocked: true,
      reason: 'day',
      dayCount,
      maxDay,
      free,
      // 到期时间点拨到本地零点（新一天 dayCount 清零）。桥接据此安排重试；
      // 以前没有这个字段 → 重试定时器不启动 → 积压未读永远不补。
      retryAfterMs: Math.max(60_000, msUntilNextLocalDay(now)),
      error: `Token 防爆破：这个会话今天已经醒了 ${dayCount}/${maxDay} 次，今天不再自动唤醒（@ / 叫名字 / 提问不受限）`,
    };
  }
  const gap = Math.max(0, Math.round(num(g.minWakeGapMs, 0)));
  const last = times.length ? Math.max(...times) : 0;
  const bypassGap = direct === true && g.directBypassGap !== false;
  if (!bypassGap && gap > 0 && last && now - last < gap) {
    return {
      blocked: true,
      reason: 'gap',
      free,
      retryAfterMs: gap - (now - last),
      error: `Token 防爆破：同一会话两次苏醒至少隔 ${Math.round(gap / 1000)} 秒`,
    };
  }
  const maxCost = Math.max(0, num(g.maxDailyCostCNY, 0));
  if (maxCost > 0 && Number.isFinite(Number(cost)) && Number(cost) >= maxCost) {
    return {
      blocked: true,
      reason: 'cost',
      free,
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
