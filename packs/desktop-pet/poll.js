/**
 * 桌宠长轮询：把"用户在她那边说的话"取回来
 * ============================================================================
 * 位置：平台包内部。桌宠是本地进程，通道在仓库外；这里只负责**定时去问**，
 * 拿到就通过 `push()` 转成事件（走现有 ctx.emit，不新增消息类型）。
 *
 * 为什么把 transport 注入：桌宠的接口形态由用户那边的工程决定；
 * 包不该假设它的 HTTP 形状，只约定"一次调用返回一批消息"。
 *
 * 三条规矩：
 *   · 失败不抛：记日志、退避重试，进程不倒
 *   · 断线重连有上限（避免疯狂打日志）
 *   · 重复消息按 id 去重（对方可能重发）
 */
export const DEFAULT_POLL = Object.freeze({ intervalMs: 2000, backoffMs: 5000, maxBackoffMs: 60000 });

/**
 * @param {object} opts
 *   { transport:{fetch(sinceToken)→{items:[{id,actor,text,at}], nextToken}}, onBatch(items), onLog, now,
 *     setTimer, clearTimer, intervalMs, backoffMs, maxBackoffMs }
 */
export function createPoller({
  transport,
  onBatch = () => {},
  onLog = () => {},
  now = () => Date.now(),
  setTimer,
  clearTimer,
  intervalMs,
  backoffMs,
  maxBackoffMs,
} = {}) {
  if (!transport || typeof transport.fetch !== 'function') throw new Error('长轮询需要一个 transport.fetch()');

  const cfg = {
    intervalMs: Number(intervalMs) > 0 ? Number(intervalMs) : DEFAULT_POLL.intervalMs,
    backoffMs: Number(backoffMs) > 0 ? Number(backoffMs) : DEFAULT_POLL.backoffMs,
    maxBackoffMs: Number(maxBackoffMs) > 0 ? Number(maxBackoffMs) : DEFAULT_POLL.maxBackoffMs,
  };
  const timer = setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clear = clearTimer ?? ((h) => clearTimeout(h));

  const state = { running: false, token: null, errors: 0, lastError: null, polls: 0, delivered: 0, delayMs: cfg.intervalMs };
  const seen = new Set();
  let handle = null;

  async function tick() {
    if (!state.running) return;
    state.polls += 1;
    let out;
    try {
      out = await transport.fetch(state.token);
    } catch (error) {
      state.errors += 1;
      state.lastError = String(error?.message ?? error);
      state.delayMs = Math.min(cfg.maxBackoffMs, Math.max(cfg.backoffMs, state.delayMs * 2));
      onLog('warn', `桌宠长轮询失败（第 ${state.errors} 次）：${state.lastError}；${state.delayMs}ms 后重试`);
      schedule();
      return;
    }

    state.errors = 0;
    state.lastError = null;
    state.delayMs = cfg.intervalMs;
    if (out?.nextToken !== undefined && out.nextToken !== null) state.token = out.nextToken;

    const items = Array.isArray(out?.items) ? out.items : [];
    const fresh = items.filter((it) => {
      const key = String(it?.id ?? `${it?.actor ?? ''}:${it?.at ?? ''}:${it?.text ?? ''}`);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    while (seen.size > 2000) seen.delete(seen.values().next().value);

    if (fresh.length) {
      state.delivered += fresh.length;
      try { await onBatch(fresh); } catch (error) { onLog('error', `桌宠长轮询：处理消息失败 ${error?.message ?? error}`); }
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
      if (state.running) return state;
      state.running = true;
      onLog('info', '桌宠长轮询已启动');
      schedule();
      return state;
    },
    stop() {
      state.running = false;
      if (handle) clear(handle);
      handle = null;
      return state;
    },
    /** 测试/手动触发：立刻轮询一次（不改变运行状态） */
    async pollOnce() {
      state.running = true;
      const prev = state.running;
      await tick();
      state.running = prev;
      return { ...state };
    },
    status() { return { ...state }; },
    config() { return { ...cfg }; },
  };
}
