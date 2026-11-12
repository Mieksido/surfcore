/**
 * 旧配置迁移（开发设施，不是四层）
 * ============================================================================
 * 只做一件事：把旧 surfcore 的 config.json **读出来，规划成新设置**。
 *   · 默认只预览，不写任何东西；
 *   · --apply 才写新状态，旧文件一个字节不动；
 *   · 迁移不了的项明确列出来，不猜、不硬塞。
 *
 * 为什么放在 tools/：它认识“旧世界”的字段，属于一次性运维动作；
 * 内核/适配器都不该认识旧 config 的形状。
 */

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const asList = (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,，\s]+/)).map((x) => String(x).trim()).filter(Boolean);
const nonEmpty = (v) => String(v ?? '').trim();

/**
 * @returns {{settings:Object, mapped:Array, skipped:Array, warnings:Array}}
 * settings 形如 { 'surfcore/runtime': { 'allow.groups': '...' }, ... }
 */
export function planMigration(old = {}) {
  const settings = {};
  const mapped = [];
  const skipped = [];
  const warnings = [];

  const put = (adapter, key, value, from) => {
    if (value === undefined || value === null || value === '') return;
    settings[adapter] = { ...(settings[adapter] ?? {}), [key]: value };
    mapped.push({ from, to: `${adapter}.${key}` });
  };

  const allow = isObj(old.allow) ? old.allow : {};
  const groups = asList(allow.groups);
  const privates = asList(allow.private);
  if (groups.length) put('surfcore/runtime', 'allow.groups', groups.join(','), 'allow.groups');
  if (privates.length) put('surfcore/runtime', 'allow.privates', privates.join(','), 'allow.private');
  if (old.allowAllWhenEmpty === true) {
    put('surfcore/runtime', 'allow.all', true, 'allowAllWhenEmpty');
    warnings.push('旧 allowAllWhenEmpty=true 已映射成 allow.all=true：新行为是“所有人放行”，请确认这是你要的');
  }

  const owner = nonEmpty(old.ownerQQ ?? old.admin?.qq ?? old.admin?.owner);
  if (owner) put('surfcore/qq', 'ownerId', owner, 'ownerQQ/admin');

  const sl = isObj(old.snowluma) ? old.snowluma : {};
  if (nonEmpty(sl.wsUrl)) put('surfcore/qq', 'wsUrl', nonEmpty(sl.wsUrl), 'snowluma.wsUrl');
  if (nonEmpty(sl.httpUrl)) put('surfcore/qq', 'httpUrl', nonEmpty(sl.httpUrl), 'snowluma.httpUrl');
  if (nonEmpty(sl.accessToken)) put('surfcore/qq', 'accessToken', nonEmpty(sl.accessToken), 'snowluma.accessToken');

  const ws = isObj(old.webSearch) ? old.webSearch : {};
  const endpoint = nonEmpty(ws.apiSearchURL) || nonEmpty(ws.baseURL);
  if (endpoint) {
    put('surfcore/web', 'searchEndpoint', endpoint, 'webSearch.apiSearchURL/baseURL');
    warnings.push('旧搜索端点按“接受 POST {query,max_results}”使用；如果旧服务协议不同，请先在设置页改端点');
  }
  if (nonEmpty(ws.apiKey)) put('surfcore/web', 'searchKey', nonEmpty(ws.apiKey), 'webSearch.apiKey');

  // 明确不迁的：不是新设置项，或语义已经变了
  if (isObj(old.biliBridge)) {
    skipped.push({ key: 'biliBridge', reason: 'B站分享时间/动态轮询是计划任务参数，不是新设置项；用 bili run/sync 的参数与计划任务表达' });
  }
  if (isObj(old.purpose)) {
    skipped.push({ key: 'purpose', reason: '旧目的配置（dailyMax/quietStart 等）尚未进新设置表；当前由 createKernel 的 purpose 选项给' });
  }
  if (isObj(old.chat)) {
    skipped.push({ key: 'chat', reason: '旧窗口大小/群窗口是内核组装参数，不是设置项；按需在 createKernel 里配置' });
  }
  for (const [key, value] of Object.entries(old)) {
    if (['allow', 'ownerQQ', 'admin', 'snowluma', 'webSearch', 'biliBridge', 'purpose', 'chat'].includes(key)) continue;
    if (isObj(value)) skipped.push({ key, reason: '没有等价的新设置；属于旧运行配置/界面配置' });
  }

  return { settings, mapped, skipped, warnings };
}

/** 人话预览；不打印任何密钥值，只打印目标和数量 */
export function formatMigrationPlan(plan = {}) {
  const out = [];
  const mapped = Array.isArray(plan.mapped) ? plan.mapped : [];
  const skipped = Array.isArray(plan.skipped) ? plan.skipped : [];
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
  out.push(`可迁移：${mapped.length} 项`);
  for (const m of mapped) out.push(`  ✅ ${m.from} → ${m.to}`);
  out.push(`不迁移：${skipped.length} 项`);
  for (const s of skipped) out.push(`  ⏸ ${s.key}：${s.reason}`);
  if (warnings.length) {
    out.push(`注意：${warnings.length} 条`);
    for (const w of warnings) out.push(`  ⚠ ${w}`);
  }
  return out.join('\n');
}

/**
 * 写进新状态。只调用内核设置接口，不碰旧文件。
 * @param {{settings:{set:Function}}} kernel
 * @param {ReturnType<typeof planMigration>} plan
 */
export function applyMigration(kernel, plan = {}) {
  if (!kernel?.settings?.set) throw new Error('applyMigration 需要 kernel.settings.set');
  let n = 0;
  for (const [adapter, values] of Object.entries(plan.settings ?? {})) {
    for (const [key, value] of Object.entries(values ?? {})) {
      kernel.settings.set(adapter, key, value);
      n += 1;
    }
  }
  if (n > 0 && typeof kernel.save === 'function') kernel.save();
  return { settingsWritten: n };
}
