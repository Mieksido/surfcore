/**
 * 设置模型：把各平台包交来的"菜单"合成一个统一表单
 * ============================================================================
 * 规则（准则 001/003/005）：
 *   · 适配器只交**声明**；**界面由内核画**；**配置存在内核**（可导出）
 *   · 每项必须有：默认值 + 可选值 + **代价说明**
 *   · 值必须落在可选范围内；不在范围 → 拒绝并说明，不静默改成默认
 *   · **安全开关不在菜单里**：由调用方决定哪些 key 允许出现（这里只做机械校验）
 *
 * 铁律：本文件不认识任何渠道名（包名由调用方传入）。
 */

export const SETTINGS_VERSION = 1;

/**
 * 判断一个声明是否合格：缺代价说明的直接标问题（不静默放过）。
 * 支持两种形态：
 *   · 选项型（默认）：必须有 options（布尔/数值/枚举）
 *   · 文本型（type:'text'）：不需要 options，但必须有 maxChars（防止把整篇配置塞进来）
 */
export function validateField(field = {}) {
  const errors = [];
  if (!field.key) errors.push('缺少 key');
  if (!field.label) errors.push('缺少显示名');
  if (field.defaultValue === undefined) errors.push('缺少默认值');
  if (!field.cost) errors.push('缺少代价说明（用户不知道选了会怎样）');
  if (field.group && !['basic', 'advanced', 'experiment'].includes(field.group)) errors.push('分组不合法');

  if (field.type === 'text') {
    if (typeof field.defaultValue !== 'string') errors.push('文本型的默认值必须是字符串');
    if (!(Number(field.maxChars) > 0)) errors.push('文本型必须给 maxChars（防止塞进超长内容）');
  } else if (field.type !== undefined) {
    errors.push(`不认识的字段类型：${field.type}`);
  } else if (!Array.isArray(field.options) || field.options.length === 0) {
    errors.push('缺少可选值');
  }
  return { ok: errors.length === 0, errors };
}

/** 把值收敛到可选范围内（文本型：去空白、限长、不猜内容） */
export function coerceValue(field = {}, raw) {
  // 文本型：只做"去空白 + 限长"，**不解析语义**（语义由用它的模块解释）
  if (field.type === 'text') {
    const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
    const max = Number(field.maxChars) > 0 ? Number(field.maxChars) : 500;
    if (s.length > max) return { ok: false, code: 'setting.too-long', error: `最多 ${max} 个字符` };
    return { ok: true, value: s, warning: s !== field.defaultValue ? field.cost : null };
  }

  const options = Array.isArray(field.options) ? field.options : [];
  if (options.length === 0) return { ok: false, code: 'setting.no-options', error: '这一项没有可选值' };

  // 布尔
  if (typeof options[0] === 'boolean') {
    const v = raw === true || raw === 'true' ? true : (raw === false || raw === 'false' ? false : null);
    if (v === null) return { ok: false, code: 'setting.invalid', error: '只能是 true/false' };
    return { ok: true, value: v, warning: v !== field.defaultValue ? field.cost : null };
  }
  // 数值
  if (typeof options[0] === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n) || !options.includes(n)) {
      return { ok: false, code: 'setting.invalid', error: `只能是：${options.join(' / ')}` };
    }
    return { ok: true, value: n, warning: n !== field.defaultValue ? field.cost : null };
  }
  // 字符串/枚举
  if (!options.includes(raw)) return { ok: false, code: 'setting.invalid', error: `只能是：${options.join(' / ')}` };
  return { ok: true, value: raw, warning: raw !== field.defaultValue ? field.cost : null };
}

/**
 * 合成表单模型。
 * @param {Array} packs [{ identity, settings }]
 * @param {object} values 当前用户设定：{ '<发布人/名字>': { key: value } }
 */
export function buildSettingsModel(packs = [], values = {}) {
  const groups = [];
  const issues = [];

  for (const pack of packs) {
    const id = `${pack?.identity?.publisher ?? '?'}/${pack?.identity?.name ?? '?'}`;
    const saved = values?.[id] ?? {};
    const fields = [];

    for (const field of Array.isArray(pack?.settings) ? pack.settings : []) {
      const v = validateField(field);
      if (!v.ok) { issues.push({ adapter: id, key: field?.key ?? '?', errors: v.errors }); continue; }

      const raw = saved[field.key] === undefined ? field.defaultValue : saved[field.key];
      const coerced = coerceValue(field, raw);
      if (!coerced.ok) {
        issues.push({ adapter: id, key: field.key, errors: [coerced.error] });
        continue;
      }

      fields.push({
        key: field.key,
        label: field.label,
        description: field.description ?? '',
        type: field.type === 'text' ? 'text' : 'choice',
        value: coerced.value,
        defaultValue: field.defaultValue,
        options: Array.isArray(field.options) ? [...field.options] : [],
        maxChars: field.type === 'text' ? Number(field.maxChars) : undefined,
        cost: field.cost,
        group: field.group ?? 'basic',
        isDefault: coerced.value === field.defaultValue,
        warning: coerced.warning ?? null,
      });
    }

    if (fields.length) {
      groups.push({
        id,
        publisher: pack?.identity?.publisher ?? '?',
        name: pack?.identity?.name ?? '?',
        displayName: pack?.identity?.displayName ?? pack?.identity?.name ?? '?',
        fields,
      });
    }
  }

  return { version: SETTINGS_VERSION, groups, issues };
}

/** 导出：配置属于用户，随时能带走（换机器不用重配） */
export function exportSettings(model) {
  const values = {};
  for (const g of model.groups ?? []) {
    values[g.id] = {};
    for (const f of g.fields ?? []) values[g.id][f.key] = f.value;
  }
  return { version: SETTINGS_VERSION, exportedAt: Date.now(), values };
}

/**
 * 导入：只接受认识的项，其余逐条拒绝并说明（不静默丢）。
 * @returns {{ok:boolean, applied:object, rejected:Array}}
 */
export function importSettings(json, packs = []) {
  const applied = {};
  const rejected = [];
  const values = json?.values ?? {};
  if (json?.version !== SETTINGS_VERSION) {
    return { ok: false, applied, rejected: [{ key: '*', reason: `版本不符：期望 ${SETTINGS_VERSION}` }] };
  }

  for (const pack of packs) {
    const id = `${pack?.identity?.publisher ?? '?'}/${pack?.identity?.name ?? '?'}`;
    const incoming = values[id];
    if (!incoming) continue;
    applied[id] = {};
    for (const [key, raw] of Object.entries(incoming)) {
      const field = (Array.isArray(pack?.settings) ? pack.settings : []).find((f) => f.key === key);
      if (!field) { rejected.push({ adapter: id, key, reason: '这个包没有这一项' }); continue; }
      const c = coerceValue(field, raw);
      if (!c.ok) { rejected.push({ adapter: id, key, reason: c.error }); continue; }
      applied[id][key] = c.value;
    }
  }
  return { ok: true, applied, rejected };
}
