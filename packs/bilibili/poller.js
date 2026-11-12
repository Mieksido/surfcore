/**
 * B站 轮询：定时去问"有没有新内容"，有就变成事件
 * ============================================================================
 * 位置：平台包内部。**取数是包的事**（要 cookie、要接口、要限速），
 * 内核只收到普通事件，不认识 bvid。
 *
 * 三条规矩：
 *   · 去重：同一个 bvid 只发一次（B站 列表会重复返回旧内容）
 *   · 失败退避：接口挂了不要疯狂重试，也不要让进程倒
 *   · 一次最多发 maxPerTick 条（防止首次拉取把整页刷进记忆）
 */
import { toEvents } from './emitter.js';

export const DEFAULT_BILI_POLL = Object.freeze({
  intervalMs: 10 * 60 * 1000,   // 10 分钟一次
  maxPerTick: 3,
  backoffMs: 60000,
  maxBackoffMs: 30 * 60 * 1000,
  maxSeen: 2000,
});

/**
 * @param {object} opts
 *   { fetchList（必填，async () => 数组）, emit（必填，async (event) => any）,
 *     type, intervalMs, maxPerTick, backoffMs, maxBackoffMs, now, setTimer, clearTimer, onLog }
 */
export function createBiliPoller({
  fetchList,
  emit,
  type = 'video',
  intervalMs,
  maxPerTick,
  backoffMs,
  maxBackoffMs,
  now = () => Date.now(),
  setTimer,
  clearTimer,
  onLog = () => {},
} = {}) {
  if (typeof fetchList !== 'function') throw new Error('B站 轮询需要 fetchList()（取数是包的事）');
  if (typeof emit !== 'function') throw new Error('B站 轮询需要 emit(event)');

  const cfg = {
    intervalMs: Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_BILI_POLL.intervalMs,
    maxPerTick: Number(maxPerTick) > 0 ? Number(maxPerTick) : DEFAULT_BILI_POLL.maxPerTick,
    backoffMs: Number(backoffMs) > 0 ? Number(backoffMs) : DEFAULT_BILI_POLL.backoffMs,
    maxBackoffMs: Number(maxBackoffMs) > 0 ? Number(maxBackoffMs) : DEFAULT_BILI_POLL.maxBackoffMs,
  };
  const timer = setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = clearTimer ?? ((h) => clearTimeout(h));

  const state = { running: false, polls: 0, emitted: 0, errors: 0, lastError: null, delayMs: cfg.intervalMs, lastAt: 0 };
  const seen = new Set();
  let handle = null;

  function remember(id) {
    seen.add(String(id));
    while (seen.size > DEFAULT_BILI_POLL.maxSeen) seen.delete(seen.values().next().value);
  }

  async function tick() {
    if (!state.running) return;
    state.polls += 1;
    state.lastAt = now();

    let list;
    try {
      list = await fetchList();
    } catch (error) {
      state.errors += 1;
      state.lastError = String(error?.message ?? error).slice(0, 120);
      state.delayMs = Math.min(cfg.maxBackoffMs, Math.max(cfg.backoffMs, state.delayMs * 2));
      onLog('warn', `B站 轮询失败（第 ${state.errors} 次）：${state.lastError}；${state.delayMs}ms 后重试`);
      schedule();
      return;
    }

    state.errors = 0;
    state.lastError = null;
    state.delayMs = cfg.intervalMs;

    // 只发没见过的，且一次不超过上限
    const fresh = [];
    for (const item of Array.isArray(list) ? list : []) {
      const id = item?.bvid ?? item?.dynamicId ?? item?.id;
      if (!id) continue;
      const key = `${type}:${id}`;
      if (seen.has(key)) continue;
      fresh.push(item);
      if (fresh.length >= cfg.maxPerTick) break;
    }

    if (fresh.length) {
      const events = toEvents(fresh, { type, at: now(), max: cfg.maxPerTick });
      for (const [i, ev] of events.entries()) {
        try {
          await emit(ev);
          remember(`${type}:${fresh[i]?.bvid ?? fresh[i]?.dynamicId ?? fresh[i]?.id ?? i}`);
          state.emitted += 1;
        } catch (error) {
          onLog('error', `B站 轮询：事件送不出去 ${error?.message ?? error}`);
        }
      }
    }

    schedule();
  }

  function schedule() {
    if (!state.running) return;
    handle = timer(tick, state.delayMs);
    if (typeof handle?.unref === 'function') handle.unref();
  }

  return {
    start() {
      if (state.running) return { ...state };
      state.running = true;
      onLog('info', `B站 轮询已启动（每 ${Math.round(cfg.intervalMs / 60000)} 分钟）`);
      schedule();
      return { ...state };
    },
    stop() {
      state.running = false;
      if (handle) clear(handle);
      handle = null;
      return { ...state };
    },
    /** 立刻轮询一次（测试/手动） */
    async pollOnce() {
      const was = state.running;
      state.running = true;
      await tick();
      state.running = was;
      return { ...state };
    },
    status() { return { ...state, seen: seen.size }; },
    config() { return { ...cfg }; },
  };
}
