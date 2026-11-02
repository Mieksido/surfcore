/**
 * DSH 模型目录 → 控制台可选项。
 *
 * 只做纯数据整理，不碰配置/会话：
 *   - 过滤不可路由 provider；
 *   - 保留每个模型自己的 reasoning efforts、默认 effort、图片输入能力；
 *   - 按价目表给出「便宜/中档/较贵」提示。
 *
 * 前端不能硬编码模型名：DSH 升版本或换 provider 时目录会变。
 */

const IMAGE_RE = /image|vision|image_url/i;

function modelEfforts(entry) {
  const rows = Array.isArray(entry?.reasoning?.efforts) ? entry.reasoning.efforts : [];
  return rows
    .map((e) => ({
      id: String(e?.id ?? '').trim(),
      name: String(e?.name ?? '').trim(),
      description: String(e?.description ?? '').trim(),
    }))
    .filter((e) => e.id);
}

function modelInputs(entry) {
  const mods = entry?.inputModalities
    ?? entry?.modalities?.input
    ?? entry?.capabilities?.inputModalities;
  if (!Array.isArray(mods)) return null;
  return mods.some((m) => IMAGE_RE.test(String(m?.id ?? m?.type ?? m)));
}

function priceInfo(priceTable, model) {
  const off = priceTable?.models?.[model]?.off;
  if (!off) return { tier: 'unknown', label: '价目表未登记', cacheMiss: null, output: null };
  const flash = priceTable?.models?.['deepseek-flash']?.off;
  const base = Number(flash?.cacheMiss) > 0 ? Number(flash.cacheMiss) : 1;
  const ratio = Number(off.cacheMiss) / base;
  return {
    tier: ratio >= 4 ? 'expensive' : ratio > 1.5 ? 'balanced' : 'cheap',
    label: ratio >= 4 ? '较贵' : ratio > 1.5 ? '中档' : '便宜',
    cacheMiss: Number(off.cacheMiss),
    output: Number(off.output),
  };
}

/**
 * @param {object} catalog session/modelCatalog 的返回值
 * @param {object} opts { priceTable }
 * @returns {{models: Array, providers: string[]}}
 */
export function catalogChoices(catalog, { priceTable } = {}) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
  const routable = new Set((catalog?.routableProviders ?? []).map(String));
  const models = [];
  const seen = new Set();
  for (const group of groups) {
    const provider = String(group?.id ?? '').trim();
    if (!provider) continue;
    if (routable.size && !routable.has(provider)) continue;
    for (const entry of Array.isArray(group?.models) ? group.models : []) {
      const model = String(entry?.id ?? '').trim();
      if (!model || seen.has(`${provider}/${model}`)) continue;
      seen.add(`${provider}/${model}`);
      const efforts = modelEfforts(entry);
      models.push({
        provider,
        model,
        name: String(entry?.name ?? entry?.label ?? model),
        imageInput: modelInputs(entry),
        efforts: efforts.map((e) => e.id),
        effortLabels: Object.fromEntries(efforts.map((e) => [e.id, { name: e.name, description: e.description }])),
        defaultEffort: String(entry?.reasoning?.defaultEffort ?? '').trim() || null,
        price: priceInfo(priceTable, model),
      });
    }
  }
  const providers = [...new Set(models.map((m) => m.provider))];
  return { models, providers };
}

/** 按 provider/model 找目录项；目录里没有返回 null。 */
export function findCatalogModel(models, provider, model) {
  const p = String(provider ?? '').trim();
  const m = String(model ?? '').trim();
  return (Array.isArray(models) ? models : []).find((x) => x.provider === p && x.model === m) ?? null;
}
