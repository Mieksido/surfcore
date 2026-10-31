// 「QQ 工作区用哪个模型」的纯逻辑。
//
// 为什么单独一个文件：bridge.js 已经 15k 行，而这段判断是**策略**不是**传输**——
// 它只吃「DSH 默认模型长什么样」和「config.json 里写了什么」，回一份该用的选择。
// 把它抽出来，「跟随默认模型」的每条分支都能用纯函数测（scripts/test-dsh-model-follow.mjs），
// 不用起 bridge、不用连 DSH。
//
// 术语：
//   - DSH 默认模型 = `session/modelCatalog` 的 `default`，也就是 agentDefaultModel.currentSelection()。
//     装了「默认模型」插件时，那就是用户固定下来的值；没装时是 DSH 自己的默认。
//   - config 值 = config.json 的 dsh.provider / dsh.model / dsh.reasoningEffort（管理员写死的兜底）。

/** 模型来源：跟着 DSH 默认走。 */
export const SOURCE_DSH_DEFAULT = 'dsh-default'
/** 模型来源：config.json 里写死的。 */
export const SOURCE_CONFIG = 'config'

function text(value) {
  return String(value ?? '').trim()
}

/**
 * 从 `session/modelCatalog` 的返回里取出「默认选择」。
 *
 * 只认 provider + model 都非空的完整选择：缺一个就没法 selectModel，
 * 不如当作「读不到」让调用方退回 config（宁可沿用旧配置，也不要猜）。
 *
 * @returns {{provider: string, model: string, reasoningEffort?: string} | null}
 */
export function defaultSelectionOf(catalog) {
  const value = catalog?.default
  if (value === null || typeof value !== 'object') return null
  const provider = text(value.provider)
  const model = text(value.model)
  if (provider === '' || model === '') return null
  const reasoningEffort = text(value.reasoningEffort)
  return { provider, model, ...(reasoningEffort === '' ? {} : { reasoningEffort }) }
}

/**
 * 算出 QQ 会话该用的模型。
 *
 * 规则（按优先级）：
 *   1. `followDefault !== false` 且读到了 DSH 默认模型 → 用 DSH 默认
 *      （思考强度若默认模型没指定，沿用 config 的管理员设置，而不是跟着模型乱猜）；
 *   2. 其余情况（关掉了跟随 / 读不到 / 旧版 DSH 没这个 RPC）→ 用 config 值，也就是老行为。
 *
 * 返回值里的 `source` 用来给控制台显示「现在这个模型是从哪来的」，
 * `defaultError` 只在「想跟随但没跟成」时带上原因——失败必须可见（AGENTS.md 1.7）。
 *
 * @param {{followDefault?: boolean, config?: object, defaultSelection?: object | null, defaultError?: string}} input
 */
export function effectiveChatModel({ followDefault, config, defaultSelection, defaultError } = {}) {
  const cfg = config ?? {}
  const configProvider = text(cfg.provider)
  const configModel = text(cfg.model)
  const configEffort = text(cfg.reasoningEffort)

  if (followDefault !== false && defaultSelection) {
    const provider = text(defaultSelection.provider)
    const model = text(defaultSelection.model)
    if (provider !== '' && model !== '') {
      const reasoningEffort = text(defaultSelection.reasoningEffort) || configEffort
      return {
        provider,
        model,
        reasoningEffort,
        source: SOURCE_DSH_DEFAULT,
        // 只有「跟随成功」才谈得上覆盖了 config，控制台据此解释为什么改 config 没反应。
        overridesConfig: provider !== configProvider || model !== configModel,
      }
    }
  }
  return {
    provider: configProvider,
    model: configModel,
    reasoningEffort: configEffort,
    source: SOURCE_CONFIG,
    overridesConfig: false,
    ...(followDefault !== false && configProvider !== '' && configModel !== ''
      ? { defaultError: text(defaultError) || 'DSH 没有返回默认模型' }
      : {}),
  }
}

/**
 * 这次 `sessions.selectModel()` 会不会把「全局默认模型」改掉。
 *
 * DSH 的 selectModel 除了设会话模型，还会在后台把同一个选择写进全局默认
 * （`agentDefaultModel.saveSelection()`）。控制台必须把这件事告诉管理员，
 * 但如果这次写的**正是当前默认值**，那就等于没改，不该吓唬人。
 *
 * 强度只在默认值**显式**给了档位时才参与比较：跟随来的默认经常没有
 * reasoningEffort（继承会话/配置），这时沿用 config 的强度不算「换了默认模型」。
 */
export function writesGlobalDefault({ followed, provider, model, reasoningEffort }) {
  if (!followed) return true
  if (text(provider) !== text(followed.provider)) return true
  if (text(model) !== text(followed.model)) return true
  const pinnedEffort = text(followed.reasoningEffort)
  if (pinnedEffort === '') return false
  return pinnedEffort !== text(reasoningEffort)
}