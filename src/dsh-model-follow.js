// 「QQ 工作区用哪个模型」的纯逻辑。
//
// DSH 默认模型 = session/modelCatalog 的 default（agentDefaultModel.currentSelection()）。
// config 值 = config.json 的 dsh.provider / dsh.model / dsh.reasoningEffort（管理员写死的兜底）。

export const SOURCE_DSH_DEFAULT = 'dsh-default';
export const SOURCE_CONFIG = 'config';

function text(value) {
  return String(value ?? '').trim();
}

/** 从 session/modelCatalog 的返回里取出默认选择；provider/model 缺一不可。 */
export function defaultSelectionOf(catalog) {
  const value = catalog?.default;
  if (value === null || typeof value !== 'object') return null;
  const provider = text(value.provider);
  const model = text(value.model);
  if (provider === '' || model === '') return null;
  const reasoningEffort = text(value.reasoningEffort);
  return { provider, model, ...(reasoningEffort === '' ? {} : { reasoningEffort }) };
}

/**
 * 算出 QQ 会话该用的模型。
 * 1. followDefault !== false 且读到了默认 → 用默认；默认没给强度就沿用 config。
 * 2. 其余 → 用 config，也就是老行为。
 */
export function effectiveChatModel({ followDefault, config, defaultSelection, defaultError } = {}) {
  const cfg = config ?? {};
  const configProvider = text(cfg.provider);
  const configModel = text(cfg.model);
  const configEffort = text(cfg.reasoningEffort);

  if (followDefault !== false && defaultSelection) {
    const provider = text(defaultSelection.provider);
    const model = text(defaultSelection.model);
    if (provider !== '' && model !== '') {
      return {
        provider,
        model,
        reasoningEffort: text(defaultSelection.reasoningEffort) || configEffort,
        source: SOURCE_DSH_DEFAULT,
        overridesConfig: provider !== configProvider || model !== configModel,
      };
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
  };
}

/**
 * 这次 sessions.selectModel() 会不会改掉全局默认。
 * 跟随成功且值相同 → false；默认值显式给了强度且不同 → true。
 */
export function writesGlobalDefault({ followed, provider, model, reasoningEffort }) {
  if (!followed) return true;
  if (text(provider) !== text(followed.provider)) return true;
  if (text(model) !== text(followed.model)) return true;
  const pinnedEffort = text(followed.reasoningEffort);
  if (pinnedEffort === '') return false;
  return pinnedEffort !== text(reasoningEffort);
}
