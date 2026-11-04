/**
 * schemastery 3.18.3+ 会把 `.extra('volatile')` 字段解析成带 `get()` 的包装对象。
 * 配置边界统一在这里拆包，避免 mode/ownerQQ 被 String() 成 "[object Object]"。
 */
export function unwrapSchemaValue(value) {
  if (value && typeof value === 'object' && typeof value.get === 'function') {
    try { return value.get(); } catch { return value; }
  }
  return value;
}

/** 从 DSH settings 命名空间的 user/value 层取一个已拆包的纯值。 */
export function settingFromDshNamespace(ns, key) {
  if (!ns || typeof ns !== 'object') return undefined;
  for (const layer of [ns.user, ns.value]) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) continue;
    if (Object.prototype.hasOwnProperty.call(layer, key) && layer[key] !== undefined) {
      return unwrapSchemaValue(layer[key]);
    }
  }
  return undefined;
}
