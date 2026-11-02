/**
 * qq-mode —— 只保留 QQ 桥接模式命名空间的 Config。
 *
 * 为什么合体后还要这一条 loader entry：
 *   QQ 桥接（<仓库路径>\src\bridge.js）通过 DSH settings 读写 `qq-mode`
 *   命名空间来切换 chat / closed-agent / reserved / reserved2。DSH 0.2.x 的命名空间
 *   由「loader entry id + 该 entry 的 Config」推导：
 *     ① entry id 必须精确等于 `qq-mode`   —— 见 cordis.patch.yml 的 `- id: qq-mode`
 *     ② 插件模块必须导出 `Config`          —— 本文件
 *     ③ Config 至少有一个带 volatile 的字段 —— mode / ownerQQ
 *
 * 所以它不是第二个用户插件，只是把旧 qq-mode-console 的 host 半并进来。
 * 设置窗口本身在 surfcore 的 client 半；这里不注册任何 UI。
 */
import { createRequire } from 'node:module';

// ⚠️ 工程坑：仓库里钉的 @deepseek-ai/schemastery@3.18.1 只发布了 lib/index.cjs，
// 但 package.json 的 import 条件指向不存在的 lib/index.mjs；纯 ESM `import` 会直接
// ERR_MODULE_NOT_FOUND。旧 qq-mode-console 能跑是因为 DSH 的加载路径走了 require。
// 这里用 createRequire 显式取 CJS，行为一致且不依赖宿主的解析策略。
const require = createRequire(import.meta.url);
const z = require('@deepseek-ai/schemastery');

export const name = 'surfcore/qq-mode';
export const inject = ['settings'];

export const Config = z.object({
  mode: z.union([
    z.const('chat'),
    z.const('closed-agent'),
    z.const('reserved'),
    z.const('reserved2'),
    z.const('simulation'),
  ]).default('reserved2').extra('volatile', true),
  ownerQQ: z.string().description('管理员 QQ（ownerQQ）；留空表示不通过 DSH 设置覆盖 config.json').extra('volatile', true),
});

/** 0.2.x 下命名空间由 entry id + Config 推导，apply 不需要注册任何东西。 */
export function apply() {}
