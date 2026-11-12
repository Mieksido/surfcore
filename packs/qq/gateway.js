/**
 * 网关：导入与适配（QQ 包内）
 * ============================================================================
 * 位置：平台包。**网关是这个平台才有的东西**，内核与运行时都不该认识。
 *
 * 三条红线（合规，写死在流程里）：
 *   1. **只处理用户自己选的文件**：不下载、不探测在线源、不内置任何二进制
 *   2. **不自动启动**：导入≠运行；启动是用户自己的事（也避开关不掉的黑窗）
 *   3. **不写进仓库**：默认装到用户的本地数据目录；仓库里绝不留第三方二进制
 *
 * 所以这里只做：识别 → 校验 → 给计划 → （由调用方执行解压）→ 记录来源。
 * 解压与哈希由调用方注入（Windows 上是 Expand-Archive 之类），保持可单独测。
 */

/** 已知网关的画像（新网关只需在这里加一条） */
export const GATEWAY_PROFILES = Object.freeze([
  {
    id: 'snowluma',
    name: 'SnowLuma',
    marker: 'snowluma/release.json',
    entry: 'snowluma/launcher.bat',
    runtime: 'snowluma/node.exe',
    httpHint: 'http://127.0.0.1:3000',
    wsHint: 'ws://127.0.0.1:3001/',
    note: '第三方运行时：仅本机用户自带，不随包分发；导入后请自行启动',
  },
  {
    id: 'napcat',
    name: 'NapCat',
    marker: 'napcat/package.json',
    entry: 'napcat/launcher.bat',
    runtime: null,
    httpHint: 'http://127.0.0.1:3000',
    wsHint: 'ws://127.0.0.1:3001/',
    note: '第三方运行时：仅本机用户自带，不随包分发',
  },
  {
    id: 'lagrange',
    name: 'Lagrange.OneBot',
    marker: 'Lagrange.OneBot.dll',
    entry: 'Lagrange.OneBot.dll',
    runtime: null,
    httpHint: 'http://127.0.0.1:8080',
    wsHint: 'ws://127.0.0.1:8081/',
    note: '第三方运行时：仅本机用户自带，不随包分发',
  },
]);

/** 从 zip 条目名里认出是哪个网关（认不出就返回 null，不瞎猜） */
export function detectGateway(entries = []) {
  const names = (Array.isArray(entries) ? entries : []).map((x) => String(x).replace(/\\/g, '/').replace(/^\/+/, ''));
  const hit = GATEWAY_PROFILES.find((p) => names.some((n) => n === p.marker || n.endsWith(`/${p.marker}`)));
  if (!hit) return null;

  const has = (suffix) => names.some((n) => n === suffix || n.endsWith(`/${suffix}`));
  return {
    profile: hit.id,
    name: hit.name,
    entry: names.find((n) => n.endsWith(`/${hit.entry}`) || n === hit.entry) ?? null,
    runtime: hit.runtime && has(hit.runtime) ? names.find((n) => n.endsWith(hit.runtime)) : null,
    wsHint: hit.wsHint,
    httpHint: hit.httpHint,
    note: hit.note,
  };
}

/** 危险条目：绝对路径、越级、超量（zip slip） */
export function inspectEntries(entries = [], { maxEntries = 5000 } = {}) {
  const problems = [];
  const list = Array.isArray(entries) ? entries : [];
  if (list.length > maxEntries) problems.push(`条目太多（${list.length} > ${maxEntries}）`);
  for (const raw of list) {
    const name = String(raw).replace(/\\/g, '/');
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) problems.push(`绝对路径：${name}`);
    if (name.split('/').includes('..')) problems.push(`越级路径：${name}`);
  }
  return { ok: problems.length === 0, problems, count: list.length };
}

/**
 * 给"导入网关"按钮：只算出计划，**不执行**。
 * @param {object} input { zipPath, entries, destDir }
 */
export function planGatewayImport({ zipPath = '', entries = [], destDir = '' } = {}) {
  if (!zipPath) return { ok: false, error: { code: 'gateway.no-file', message: '没有选择网关文件' } };
  const safety = inspectEntries(entries);
  if (!safety.ok) {
    return { ok: false, error: { code: 'gateway.unsafe', message: '这个压缩包不安全', detail: safety.problems.slice(0, 3) } };
  }
  const found = detectGateway(entries);
  if (!found) {
    return { ok: false, error: { code: 'gateway.unknown', message: '认不出这是哪个网关（已知：' + GATEWAY_PROFILES.map((p) => p.name).join(' / ') + '）' } };
  }
  const root = (entries.find((n) => n.includes('/')) ?? '').split('/')[0];
  return {
    ok: true,
    plan: {
      gateway: found.profile,
      name: found.name,
      zipPath,
      destDir,
      stripPrefix: root || '',        // 解压时去掉顶层目录，安装目录更干净
      entry: found.entry,
      wsHint: found.wsHint,
      httpHint: found.httpHint,
      note: found.note,
      // 明确写出来：导入 ≠ 启动
      steps: ['解压到本地数据目录', '记录来源（sha256）', '由你自己启动网关', '把 ws 地址填进设置页'],
    },
  };
}

/**
 * 记录来源（写 `_gateway.json`）。**单写者**：只有导入流程写它。
 * @returns {object} 要落盘的内容（调用方负责写文件）
 */
export function provenanceOf({ plan, sha256 = '', importedAt = Date.now(), bytes = 0 } = {}) {
  return {
    schema: 1,
    gateway: plan?.gateway ?? null,
    name: plan?.name ?? null,
    version: plan?.version ?? null,
    sourceZip: plan?.zipPath ?? null,
    sha256: String(sha256 ?? ''),
    bytes: Number(bytes) || 0,
    importedAt: Number(importedAt) || Date.now(),
    note: '第三方运行时：仅本机用户自带，不随包分发；本文件只记录来源',
  };
}
