/**
 * 组装层（composition root 的"手脚"）
 * ============================================================================
 * 它把三样东西接起来：**内核实例** + **一批平台包** + **运行时管道**。
 *
 * 为什么单独一个文件：这是唯一"知道所有层"的地方（组装点）。
 * 其它任何地方都不许这样——内核不认识包、包不认识内核、运行时不认识两边。
 *
 * 它不 import 内核（内核是传进来的），所以依赖方向依旧干净：
 *   app/ → runtime/ ；app/ 收到 kernel 实例（别人建好的）
 */
import { createAdapter } from '../runtime/index.js';

/**
 * @param {object} input
 *   { kernel（必填）, packs:[{id, pack}], onLog?, idPrefix?,
 *     batching（默认 false；给 {windowMs,maxItems} 才开）, makeBatcher（合批器工厂，由调用方注入）,
 *     allowlist（runtime/allowlist 的实例；给了就拦在门外）,
 *     setTimer?, clearTimer?（测试注入） }
 * @returns {{adapters, start, stop, status, flush}}
 */
export function composeSystem({
  kernel, packs = [], onLog = () => {}, idPrefix = 'sc',
  batching = false, makeBatcher = null, allowlist = null, setTimer, clearTimer,
} = {}) {
  if (!kernel || typeof kernel.respond !== 'function') throw new Error('组装需要内核实例（有 respond）');

  let seq = 0;
  const nextId = () => `${idPrefix}-${Date.now()}-${seq++}`;
  const adapters = [];

  /** 从事件推出"谁在问"（这是唯一的推断点，且只用到事件里的字段） */
  function viewerOf(event = {}) {
    const from = event.from ?? {};
    return {
      channelId: from.channel ?? null,
      kind: from.kind === 'private' ? 'private' : 'group',
      isOwner: event.to?.owner === true,
      activeMode: false,
    };
  }

  /**
   * 合批：把"连发的几条"并成一轮再问她。
   * 位置理由：合批是**运送节奏**，不是"她怎么想"——所以放在组装层，
   * 内核只收到"并好的一条事件"（batch 字段里带着原始条数与起止时间）。
   */
  const batchCfg = { windowMs: 8000, maxItems: 12, ...(batching ?? {}) };
  // 合批器由调用方注入：大适配器不认识内核，也就不 import 内核的模块
  if (batching !== false && typeof makeBatcher !== "function") {
    throw new Error("开了合批却没给 makeBatcher（合批器由调用方注入）");
  }
  const batcher = batching === false ? null : makeBatcher(batchCfg);
  let flushTimer = null;
  const timerFn = setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearFn = clearTimer ?? ((h) => clearTimeout(h));

  /** 把一批并好的事件交给内核，并把她的意图送出去 */
  async function handleEvent(adapterId, adapter, event) {
    const viewer = viewerOf(event);
    const res = await kernel.respond(event, viewer);
    if (!res?.wake) return res;

    for (const intent of res.intents ?? []) {
      // 意图要带上目标频道：包的 send() 据此决定发到哪
      const ack = await adapter.pipes.deliver({ channel: viewer.channelId, ...intent, id: nextId() });
      onLog('info', `[${adapterId}] ${intent.kind} → ${ack.status}${ack.duplicate ? '（重复，已跳过）' : ''}`);
    }
    return res;
  }

  /** 计时器推进：窗口到期的批次出队 */
  function scheduleFlush(adapterId, adapter) {
    if (!batcher || flushTimer) return;
    flushTimer = timerFn(async () => {
      flushTimer = null;
      for (const due of batcher.due()) {
        onLog('info', `[${adapterId}] 合批 ${due.batch.event.batch?.count ?? '?'} 条 → 一轮`);
        await handleEvent(adapterId, adapter, due.batch.event);
      }
      if (batcher.pending() > 0) scheduleFlush(adapterId, adapter);
    }, batchCfg.windowMs);
    if (typeof flushTimer?.unref === 'function') flushTimer.unref();
  }

  /** channel → 适配器（flush 时要知道把批次交给谁） */
  const channelOwner = new Map();

  for (const item of packs) {
    const { id, pack } = item ?? {};
    const adapter = createAdapter(pack, {
      onEvent: async (event) => {
        // 白名单：谁能跟她说话（部署策略，拦在门外；内核不必知道）
        if (allowlist) {
          const verdict = allowlist.check({ channel: event?.from?.channel, actor: event?.from?.actor, isOwner: event?.to?.owner === true });
          if (!verdict.ok) {
            onLog('info', `[${id}] 拒绝（${verdict.reason}）：${event?.from?.channel ?? '?'}`);
            return { wake: false, reason: 'not-allowed', verdict };
          }
        }
        channelOwner.set(String(event?.from?.channel ?? ''), { id, adapter });

        // 关掉合批：直接问她
        if (!batcher) return handleEvent(id, adapter, event);

        const pushed = batcher.push(event);
        if (pushed.ready) {
          onLog('info', `[${id}] 合批 ${pushed.batch.event.batch?.count ?? '?'} 条（到量） → 一轮`);
          return handleEvent(id, adapter, pushed.batch.event);
        }
        scheduleFlush(id, adapter);
        return { wake: false, reason: 'batching' };
      },
    });
    adapters.push({ id, adapter, pack });
  }

  return {
    adapters,

    /** 立刻把积压的批次发出去（停机/退出前用） */
    async flush() {
      if (!batcher) return [];
      const out = [];
      for (const due of batcher.due(Number.MAX_SAFE_INTEGER)) {
        const owner = channelOwner.get(String(due.channel ?? ''));
        if (!owner) continue;
        out.push(await handleEvent(owner.id, owner.adapter, due.batch.event));
      }
      return out;
    },

    /** 逐个上班（顺序启动，任何一个失败都不影响其它） */
    async start(ctx = {}) {
      const results = [];
      for (const { id, adapter } of adapters) {
        try {
          await adapter.lifecycle.start(ctx);
          results.push({ id, ok: true });
        } catch (error) {
          results.push({ id, ok: false, error: String(error?.message ?? error) });
          onLog('error', `[${id}] 启动失败：${error?.message ?? error}`);
        }
      }
      return results;
    },

    /** 倒序下班（后来先关，避免依赖倒挂） */
    async stop() {
      const results = [];
      for (const { id, adapter } of [...adapters].reverse()) {
        try {
          await adapter.lifecycle.stop();
          results.push({ id, ok: true });
        } catch (error) {
          results.push({ id, ok: false, error: String(error?.message ?? error) });
        }
      }
      return results;
    },

    /** 每层现在什么状态（给"一条命令看系统"用） */
    async status() {
      const rows = [];
      for (const { id, adapter } of adapters) {
        let health = null;
        try { health = await adapter.lifecycle.heartbeat(); } catch (error) { health = { status: 'error', error: String(error?.message ?? error) }; }
        rows.push({
          id,
          adapter: `${adapter.identity.publisher}@${adapter.identity.name}@${adapter.identity.version}`,
          modality: adapter.capabilities?.modality ?? '?',
          timing: adapter.capabilities?.timing ?? '?',
          settings: adapter.settings.length,
          health,
        });
      }
      return { kernel: kernel.snapshot?.() ?? null, packs: rows };
    },
  };
}
