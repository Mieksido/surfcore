/**
 * 时钟（内核侧入口）
 * ============================================================================
 * 真正的实现在 kernel/support/time.js —— 因为平台包也要用它，而平台包不许 import 内核。
 * 这里只是转出去，保持内核内部 import 路径稳定。
 */
export {
  localDayKey,
  minutesOfDay,
  inQuietHours,
  quietEndAfter,
  inWindow,
} from '../support/time.js';
