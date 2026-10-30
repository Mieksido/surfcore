/**
 * Token 防爆破的纯逻辑（2026-10-23 用户定）。
 *
 * 和鱼群守则的关系：
 *   · 鱼群守则先判断“群里是不是鱼太多”，决定要不要发；
 *   · 本模块只判断“这一轮值不值得再花一次模型调用/再发一条”，
 *     不绕过鱼群守则；任何一边拒绝都不发。
 */
import { withConfiguredTimeZone } from './timezone.js';

export const DEFAULT_TOKEN_GUARD = Object.freeze({
  enabled: true,
  maxWakesPerDay: 20,
  privateMaxWakesPerDay: 10,
  minWakeGapMs: 120000,
  directBypassGap: true,
  maxOutboundPerTurn: 8,
  maxDailyCostCNY: 8,
});

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 每天 0 点（本地时区）。 */
export function localDayStart(now = Date.now()) {
  return withConfiguredTimeZone(() => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  });
}

/**
 * 醒前预算检查。
 * @param {{key?:string, wakeTimes?:number[], now?:number, guard?:object, cost?:number, direct?:boolean}} opts
 * @returns {{blocked:boolean, error?:string, retryAfterMs?:number, reason?:string, dayCount?:number, maxDay?:number}}
 */
export function evaluateWakeBudget({ key = '', wakeTimes = [], now = Date.now(), guard = DEFAULT_TOKEN_GUARD, cost = null, direct = false } = {}) {
  const g = { ...DEFAULT_TOKEN_GUARD, ...(guard && typeof guard === 'object' ? guard : {}) };
  if (g.enabled === false) return { blocked: false };
  const times = (Array.isArray(wakeTimes) ? wakeTimes : []).map(Number).filter((t) => Number.isFinite(t) && t > 0);
  const isPrivate = String(key ?? '').startsWith('private:');
  const maxDay = Math.max(0, Math.round(num(isPrivate ? g.privateMaxWakesPerDay : g.maxWakesPerDay, 0)));
  const dayCount = times.filter((t) => t >= localDayStart(now)).length;
  if (maxDay > 0 && dayCount >= maxDay) {
    return {
      blocked: true,
      reason: 'day',
      dayCount,
      maxDay,
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
  return { blocked: false, dayCount, maxDay };
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
