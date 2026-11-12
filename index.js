/**
 * SurfCore 新宿主入口（骨架）
 * ============================================================================
 * 旧 src/bridge.js 已不进入新包。
 * 这里只负责：把新内核、大适配器和 packs 接起来；不写平台业务、不写人格。
 *
 * 当前状态：内核 + 冻结大适配器已就绪；宿主接线仍在实现中。
 * 这个文件不允许 import 旧 bridge、旧 UI 或旧兼容层。
 */
export const name = 'surfcore';

/**
 * DSH host plugin 入口。
 * 后续真正接线时，只允许依赖：
 *   kernel/index.js           createKernel
 *   runtime/compose.js        composeSystem
 *   runtime/host.js           discover/load packs
 * 不允许复制 runtime 内部实现，也不允许改 runtime/。
 */
export function apply(ctx) {
  const log = ctx?.logger?.info;
  if (typeof log === 'function') {
    log('surfcore: new host skeleton loaded; old bridge is not part of this package');
  }
}
