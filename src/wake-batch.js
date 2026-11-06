/**
 * 唤醒合并窗口（batch window）：一条消息触发唤醒后，先等几秒，
 * 把这几秒里连发的几条收进同一个唤醒包，只醒一次 —— 省的是"整轮上下文"。
 *
 * 2026-11-04 用户要求分场景（原来一律 8 秒）：
 *   · @ / 叫名字 / 拍一拍：3 秒（被点名要立刻应）
 *   · 私聊：4 秒（私聊节奏快，8 秒太慢）
 *   · 群聊：6 秒（群聊本来就不该秒回）
 *
 * 纯逻辑，零 I/O。
 */

export const DEFAULT_BATCH_WINDOWS = Object.freeze({
  groupMs: 6000,
  privateMs: 4000,
  directMs: 3000
});

/** 被"点名"的唤醒原因：这些走最短窗口，即使在大群里也立刻应。 */
const DIRECT_REASONS = new Set(['atMention', 'nameMention', 'poke', 'admin']);

const clampMs = (value, fallback) => {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  // 1 秒 ~ 1 小时：比 1 秒短等于没有窗口，比 1 小时长等于永远不醒。
  return Math.min(3_600_000, Math.max(1000, n));
};

/**
 * 把配置收成三个窗口。
 * `batchWindowMs` 是老字段（群聊），保留兼容；新字段优先。
 */
export function normalizeBatchWindows(wake = {}) {
  const src = wake && typeof wake === 'object' ? wake : {};
  return {
    groupMs: clampMs(src.batchWindowMs, DEFAULT_BATCH_WINDOWS.groupMs),
    privateMs: clampMs(src.batchWindowPrivateMs, DEFAULT_BATCH_WINDOWS.privateMs),
    directMs: clampMs(src.batchWindowDirectMs, DEFAULT_BATCH_WINDOWS.directMs)
  };
}

/** reason 形如 `keyword:梗` / `speaker:小明`，只取冒号前的主体。 */
function reasonBase(reason) {
  return String(reason ?? '').split(':')[0];
}

/**
 * 这条唤醒该等多久。
 *
 * 顺序很重要：先看是不是被点名（@/叫名字/拍一拍），再看是不是私聊，
 * 最后才是群里的普通触发。私聊的 reason 恒为 `private`，所以不会被误判成 direct。
 */
export function batchWindowFor(key, reason, wake = {}) {
  const windows = normalizeBatchWindows(wake);
  if (DIRECT_REASONS.has(reasonBase(reason))) return windows.directMs;
  if (String(key ?? '').startsWith('private:')) return windows.privateMs;
  return windows.groupMs;
}
