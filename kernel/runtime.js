/**
 * 内核运行时：把“长期跑”的循环收进内核，不再散落在 CLI 里
 * ============================================================================
 * 它只做生命周期，不认识平台、不认识包、不 import 大适配器：
 *   · 启动时调注入的 system.start()
 *   · 定时 kernel.tick() + 周期性 save()
 *   · 定时 kernel.flushVectors()（向量积压）
 *   · 停止时 system.flush() → system.stop() → kernel.save()
 *
 * 位置：内核内部模块，不是第五层。
 * system 由组装点（工具层）注入；内核 runtime 只认这个窄接口。
 */
export function createKernelRuntime({
  kernel,
  system,
  tickMs = 60000,
  vectorEveryMs = 30000,
  saveEveryMs = 10 * 60 * 1000,
  onLog = () => {},
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h),
  now = () => Date.now(),
} = {}) {
  if (!kernel || typeof kernel.tick !== 'function' || typeof kernel.save !== 'function') {
    throw new Error('内核运行时需要 kernel.tick / kernel.save');
  }
  if (!system || typeof system.start !== 'function' || typeof system.stop !== 'function') {
    throw new Error('内核运行时需要注入 system.start / system.stop');
  }

  let started = false;
  let startedAt = 0;
  let lastSave = 0;
  let tickTimer = null;
  let vectorTimer = null;
  let vectorFlight = null;
  const log = (level, message) => { try { onLog(level, message); } catch {} };

  function arm(fn, ms) {
    const h = setTimer(fn, ms);
    if (typeof h?.unref === 'function') h.unref();
    return h;
  }

  async function tickOnce() {
    try {
      const out = kernel.tick();
      if (Number(saveEveryMs) > 0 && now() - lastSave >= Number(saveEveryMs)) {
        kernel.save();
        lastSave = now();
      }
      return out;
    } catch (error) {
      log('error', `内核 tick 失败：${error?.message ?? error}`);
      return { error: String(error?.message ?? error) };
    }
  }

  async function flushVectors() {
    if (typeof kernel.flushVectors !== 'function') return { ok: false, encoded: 0, failed: 0 };
    // 同一时间只允许一批向量在飞：编码可能很慢，定时器不能越堆越多；
    // 停机也要等这一批落地，避免 save 之后又写一次索引。
    if (vectorFlight) return vectorFlight;
    vectorFlight = (async () => {
      try {
        const r = await kernel.flushVectors();
        if (r?.encoded || r?.failed) log('info', `向量编码 ${r.encoded ?? 0} 条${r.failed ? `，失败 ${r.failed} 条` : ''}`);
        return r;
      } catch (error) {
        log('error', `向量编码失败：${error?.message ?? error}`);
        return { ok: false, encoded: 0, failed: 0, error: { code: 'runtime.vector-failed', message: String(error?.message ?? error) } };
      } finally {
        vectorFlight = null;
      }
    })();
    return vectorFlight;
  }

  return {
    get started() { return started; },

    async start({ emit = () => {}, log: systemLog = () => {} } = {}) {
      if (started) return { started: false, reason: 'already-started' };
      const packs = await system.start({ emit, log: systemLog });
      started = true;
      startedAt = now();
      lastSave = now();
      if (Number(tickMs) > 0) {
        tickTimer = arm(() => { void tickOnce(); }, Number(tickMs));
      }
      if (Number(vectorEveryMs) > 0) {
        vectorTimer = arm(() => { void flushVectors(); }, Number(vectorEveryMs));
      }
      log('info', '内核运行时已启动');
      return { started: true, packs };
    },

    tickOnce,
    flushVectors,

    async stop() {
      if (!started) return { stopped: false, reason: 'not-started' };
      if (tickTimer !== null) { try { clearTimer(tickTimer); } catch {} tickTimer = null; }
      if (vectorTimer !== null) { try { clearTimer(vectorTimer); } catch {} vectorTimer = null; }
      // 先等在飞的编码落地，再停止系统/保存，避免“保存后又被写一次索引”
      if (vectorFlight) { try { await vectorFlight; } catch {} }
      const errors = [];
      try { if (typeof system.flush === 'function') await system.flush(); } catch (error) { errors.push({ stage: 'flush', message: String(error?.message ?? error) }); }
      try { await system.stop(); } catch (error) { errors.push({ stage: 'stop', message: String(error?.message ?? error) }); }
      try { kernel.save(); } catch (error) { errors.push({ stage: 'save', message: String(error?.message ?? error) }); }
      started = false;
      const out = { stopped: true, errors };
      if (errors.length) log('error', `内核运行时停止有 ${errors.length} 个错误`);
      else log('info', '内核运行时已停止并保存');
      return out;
    },

    status() {
      return {
        started,
        uptimeMs: started ? Math.max(0, now() - startedAt) : 0,
        mode: kernel.memory?.mode ?? null,
        records: typeof kernel.snapshot === 'function' ? kernel.snapshot().records : null,
        vector: typeof kernel.memory?.vectorStatus === 'function' ? kernel.memory.vectorStatus() : null,
      };
    },
  };
}
