/**
 * 设置命令行：看 / 改 / 导出 / 导入
 * ============================================================================
 * 位置：组装层（app）。**改设置是操作者的事**，不属于内核、也不属于任何包；
 * 这里只负责"把用户输入翻译成内核设置接口的调用"，校验交给内核的设置模型。
 *
 * 三条规矩：
 *   · 只认表单里存在的组与键（拼错的键会被拒绝，不会静默丢失）
 *   · 校验/换算交给内核（coerceValue），这里不复制一套规则
 *   · 改完立刻落盘（**单写者**：只有这个进程写）
 */

/** 把设置模型排成人看的行 */
export function formatSettings(model = { groups: [], issues: [] }) {
  const lines = [];
  for (const group of model.groups ?? []) {
    lines.push(`\n【${group.name ?? group.id}】(${group.id})`);
    for (const f of group.fields ?? []) {
      const mark = f.isDefault ? '' : ' *';
      const value = f.type === 'text' ? (f.value ? `"${f.value}"` : '（空）') : String(f.value);
      lines.push(`  ${f.key} = ${value}${mark}`);
      if (f.cost) lines.push(`      ${f.cost}`);
    }
  }
  const issues = model.issues ?? [];
  if (issues.length) {
    lines.push('\n⚠ 有声明不合格（这些项不会出现）：');
    for (const i of issues) lines.push(`  - ${i.adapter} / ${i.key}：${i.errors.join('；')}`);
  }
  return lines.join('\n');
}

/** 在模型里找一项 */
export function findField(model, groupId, key) {
  const group = (model.groups ?? []).find((g) => g.id === groupId);
  if (!group) return { ok: false, error: { code: 'settings.no-group', message: `没有这个组：${groupId}` } };
  const field = (group.fields ?? []).find((f) => f.key === key);
  if (!field) return { ok: false, error: { code: 'settings.no-key', message: `组 ${groupId} 里没有 ${key}` } };
  return { ok: true, group, field };
}

import { coerceValue } from '../kernel/settings/index.js';

/**
 * 改一项并落盘。
 * @param {object} input { kernel, group, key, value }
 * @returns {{ok:boolean, value?:any, warning?:string|null, error?:object}}
 */
export function setSetting({ kernel, group, key, value } = {}) {
  const model = kernel.settings.model();
  const found = findField(model, group, key);
  if (!found.ok) return found;

  // 用内核的换算规则（不在这里复制一份"只能填什么"）
  const coerced = coerceValue(found.field, value);
  if (!coerced.ok) return { ok: false, error: { code: coerced.code, message: coerced.error } };

  kernel.settings.set(group, key, coerced.value);
  const saved = kernel.save();          // 单写者：改完立刻落盘
  // save() 成功时返回写出的文件路径（拿不到锁时返回 { ok:false }）
  const savedPath = typeof saved === 'string' ? saved : null;
  const savedOk = savedPath !== null || saved?.ok === true;
  return { ok: true, value: coerced.value, warning: coerced.warning ?? null, saved: savedOk, savedPath };
}

/** 导出：把当前设置变成可带走的 JSON 文本 */
export function exportText(kernel) {
  return `${JSON.stringify(kernel.settings.export(), null, 2)}\n`;
}

/** 导入：交给内核（它会拒绝不合格项并保留原有值） */
export function importText(kernel, text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (error) { return { ok: false, error: { code: 'settings.bad-json', message: `不是合法 JSON：${error.message}` } }; }
  const r = kernel.settings.import(parsed);
  if (r.ok) kernel.save();
  return r;
}
