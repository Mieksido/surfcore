// 工具库的「本地时钟」统一入口（自定义时区，见 docs/guides/TIMEZONE.md）。
// 这些模块既被 CLI 子进程用（bili.mjs 启动时已把 TZ 设成配置值），也被 DSH 宿主里的插件直接 import；
// 后者不能常驻改宿主的 TZ，所以都过 withConfiguredTimeZone：同步临时切、算完还原。
import { withConfiguredTimeZone } from '../../../../src/timezone.js'

export { withConfiguredTimeZone }

/** 本地日历日 YYYY-MM-DD（at 缺省 = 现在）。 */
export const dayKey = (at = Date.now()) => withConfiguredTimeZone(() => new Date(at).toLocaleDateString('sv-SE'))
