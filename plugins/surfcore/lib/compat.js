/**
 * 插件冲突体检（只读）。
 *
 * 设计边界（2026-10-30 用户确认）：
 *   · 只枚举「已安装包 / 已激活 bundle / 已知插件规则 / 可证实配置」；
 *   · 没有统一工具清单的第三方插件，标 unknown，不冒充“已检查”；
 *   · 不启动/停止服务，不调用第三方工具，不修改任何配置。
 *
 * 它不是“兼容性认证”。报告里的 confidence 就是用来区分：
 *   confirmed = 读到了实际配置/工具声明
 *   inferred  = 按已知插件规则推断
 *   unknown   = 无法枚举，只能提示风险
 */
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { DSH_HOME } from './paths.js';
import { SAFE_EXACT_TOOLS, SAFE_TOOL_PREFIXES } from '../qq-tool-restrict.mjs';
import { ruleForPackage } from './compat-rules.js';

const SCHEMA_VERSION = 1;
const MAX_PACKAGES = 600;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function readYaml(file) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function directories(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch { return []; }
}

function readProfile(profileDir, name) {
  const pkg = readJson(path.join(profileDir, 'package.json')) ?? {};
  const patchFile = path.join(profileDir, 'cordis.patch.yml');
  const patch = readYaml(patchFile);
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
  return {
    name,
    dir: profileDir,
    pkg,
    bundles,
    patch,
    patchFile,
    hasSurfcore: bundles.includes('surfcore')
      || (() => { try { return /surfcore|mcp-snowluma/.test(fs.readFileSync(patchFile, 'utf8')); } catch { return false; } })(),
  };
}

export function listProfiles(dshHome = DSH_HOME) {
  const root = path.join(dshHome, 'profiles');
  return directories(root).map((name) => readProfile(path.join(root, name), name));
}

function pickProfile(profiles, requested = '') {
  const wanted = String(requested || process.env.DSH_PROFILE || '').trim();
  if (wanted) return profiles.find((p) => p.name === wanted) ?? null;
  return profiles.find((p) => p.hasSurfcore) ?? profiles[0] ?? null;
}

function packageDirs(profileDir) {
  const root = path.join(profileDir, 'node_modules');
  const out = [];
  for (const name of directories(root)) {
    if (name.startsWith('@')) {
      for (const child of directories(path.join(root, name))) out.push(path.join(root, name, child));
    } else if (!name.startsWith('.')) {
      out.push(path.join(root, name));
    }
    if (out.length >= MAX_PACKAGES) break;
  }
  return out.slice(0, MAX_PACKAGES);
}

function readCompatManifest(pkgDir) {
  const file = path.join(pkgDir, 'surfcore.compat.json');
  const data = readJson(file);
  if (!data || typeof data !== 'object') return null;
  const tools = Array.isArray(data.tools)
    ? data.tools.map((t) => (typeof t === 'string' ? { name: t } : t)).filter((t) => t && typeof t.name === 'string')
    : [];
  return { ...data, tools, file };
}

/** 单个包可声明的 bundle patch 文件集合（package.json 的 dsh.bundle.patch）。
 * DSH 唯一的声明形式：字符串 = 一个文件；数组 = 按序多个文件（app-boot profile.ts:58-64）。
 * 旧版扫描器只探测固定文件名 dsh.bundle.patch.yml —— DSH 根本不认这个约定，
 * surfcore 自己（package.json 声明 cordis.patch.yml + 两个 preset patch）都扫不到。 */
function declaredBundlePatchFiles(pkgDir, pkg) {
  const declared = pkg?.dsh?.bundle?.patch;
  const list = typeof declared === 'string' ? [declared]
    : Array.isArray(declared) && declared.every((f) => typeof f === 'string') ? declared
      : [];
  return list.map((rel) => path.join(pkgDir, rel)).filter((file) => fs.existsSync(file));
}

function collectPackages(profileDir) {
  return packageDirs(profileDir).map((dir) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg || typeof pkg.name !== 'string') return null;
    const bundlePatchFiles = declaredBundlePatchFiles(dir, pkg);
    const legacyBundlePatch = path.join(dir, 'dsh.bundle.patch.yml'); // 历史夹具兼容；DSH 不加载它
    if (!bundlePatchFiles.length && fs.existsSync(legacyBundlePatch)) bundlePatchFiles.push(legacyBundlePatch);
    return {
      name: pkg.name,
      version: String(pkg.version ?? ''),
      dir,
      pkg,
      hasBundlePatch: bundlePatchFiles.length > 0,
      bundlePatchFiles,
      // 兼容旧消费点：单文件路径（无 patch 时为 null）
      bundlePatch: bundlePatchFiles[0] ?? null,
      compat: readCompatManifest(dir),
    };
  }).filter(Boolean);
}

function activeNames(profile, packages) {
  const names = new Set(profile.bundles.map((x) => String(x)));
  const walk = (node) => {
    if (Array.isArray(node)) { for (const item of node) walk(item); return; }
    if (!node || typeof node !== 'object') return;
    if (typeof node.name === 'string' && node.name.trim()) names.add(node.name.trim());
    for (const value of Object.values(node)) walk(value);
  };
  walk(profile.patch);
  for (const pkg of packages) {
    if (pkg.compat) names.add(pkg.name);
  }
  return names;
}

function isActive(pkg, active) {
  return active.has(pkg.name)
    || [...active].some((name) => name === pkg.name || name.endsWith(`/${pkg.name}`));
}

function findCompactionAutoOff(value, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) findCompactionAutoOff(item, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  const name = String(value.name ?? value.id ?? '');
  if (/compaction(?:-basic)?/i.test(name) && value.config && value.config.auto === false) {
    found.push({ name, id: value.id ?? '', config: value.config });
  }
  for (const item of Object.values(value)) findCompactionAutoOff(item, found);
  return found;
}

function allowedTool(name, safeExact, safePrefixes) {
  const n = String(name ?? '');
  return safeExact.includes(n) || safePrefixes.some((prefix) => n.startsWith(prefix));
}

// ── #35 单包单来源（client-modules 硬约束）────────────────────────────────────
// DSH client-modules 的 reconcilePackage（client/modules src/index.ts:1042-1054）
// 对「同一客户端包被 ≥2 条不同 Loader 行解析」抛 ClientPackageCompositionError；
// modules 是 required 插件 → 宿主启动即崩。这里按 DSH 的解析语义重演：
//   · exactPackageSpecifier（manifest.ts:201-207）：裸说明符无 `/` 无 `:` 才是包名；
//   · 相对/绝对路径行：nearestPackage 上溯找最近的 package.json（src/index.ts:892-953）；
//   · 子路径说明符（pkg/sub/path）：不是包根，跳过（preset 守卫行因此安全）；
//   · cordis:/node:/file: 内建/URL：跳过；
//   · 同名行在多个 patch 重复声明不算多来源（cordis 同 id 覆盖合并）；只有
//     不同行名（entry id）解析到同一包才算（sourceKey = `${baseUrl}\0${loaderName}`）。
// 解析不了的行不计入（不冒充已确认）；fail-closed 的部分交给「未检查」coverage。

/** DSH exactPackageSpecifier 的最小重演；与 scripts/test-qq-mode-plugin.mjs 保持一致。 */
function exactPackageSpecifier(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    return parts.length === 2 && parts.every(Boolean) ? specifier : undefined;
  }
  return specifier.length > 0 && !specifier.includes('/') && !specifier.includes(':') ? specifier : undefined;
}

/** 说明符 → 包名（nearestPackage 上溯）；解析不了返回 undefined。 */
function resolveLoaderPackageName(specifier, patchDir, packageNames) {
  if (typeof specifier !== 'string' || !specifier) return undefined;
  if (specifier.startsWith('cordis:') || specifier.startsWith('node:') || specifier.startsWith('file:')) return undefined;
  const bare = exactPackageSpecifier(specifier);
  if (bare) return packageNames.has(bare) ? bare : undefined;
  const pathLike = specifier.startsWith('.') || specifier.startsWith('file:') || path.isAbsolute(specifier);
  if (!pathLike) return undefined; // 子路径说明符 → 非包根
  let dir = path.resolve(patchDir, specifier);
  for (;;) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      const name = readJson(candidate)?.name;
      if (typeof name === 'string' && name) return packageNames.has(name) ? name : name;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** 从一个 patch 文档收集 loader 行 [{ id, name }]。
 * 两种形态都算行（DSH 都会挂成 Loader entry）：insert 数组里的新行，
 * 以及 profile patch 顶层的裸 {id,name} 覆盖行（override 也参与来源计数）。 */
function collectLoaderRows(doc, found = []) {
  if (Array.isArray(doc)) {
    for (const op of doc) collectLoaderRows(op, found);
    return found;
  }
  if (!doc || typeof doc !== 'object') return found;
  if (Array.isArray(doc.insert)) {
    for (const entry of doc.insert) {
      if (entry && typeof entry === 'object' && typeof entry.name === 'string' && !entry.insert) {
        found.push({ id: typeof entry.id === 'string' && entry.id ? entry.id : entry.name, name: entry.name });
      }
    }
    return found;
  }
  // 裸覆盖行：顶层映射自带 id+name（profile patch 的 config override 形态）。
  if (typeof doc.name === 'string' && typeof doc.id === 'string') {
    found.push({ id: doc.id || doc.name, name: doc.name });
    return found;
  }
  for (const value of Object.values(doc)) collectLoaderRows(value, found);
  return found;
}

/**
 * 单包单来源检查：扫描 profile patch + active 包的 bundle patch，找出被 ≥2 个
 * 不同行名解析到同一「声明 dsh.client.platform === 'web'」包的冲突。
 * @returns {{ issues: object[], scannedRows: number, unresolvedRows: number }}
 */
function checkClientMultiSource(profile, activePackages, add) {
  const packageNames = new Set(activePackages.map((p) => p.name));
  const clientPackages = new Set(
    activePackages.filter((p) => p.pkg?.dsh?.client?.platform === 'web').map((p) => p.name),
  );
  // patch 文件 → 它的解析锚点（行内相对路径按文件所在目录解析）
  const patchFiles = [{ file: profile.patchFile, doc: profile.patch }];
  for (const pkg of activePackages) {
    for (const file of pkg.bundlePatchFiles) {
      patchFiles.push({ file, doc: readYaml(file), pkgName: pkg.name });
    }
  }
  let scannedRows = 0;
  let unresolvedRows = 0;
  // packageName → Map(entryId → { name, sources: [{file, row}] })
  const byPackage = new Map();
  for (const { file, doc, pkgName } of patchFiles) {
    if (!doc) continue;
    const patchDir = path.dirname(file);
    for (const row of collectLoaderRows(doc)) {
      scannedRows += 1;
      const pkg = resolveLoaderPackageName(row.name, patchDir, packageNames);
      if (!pkg) { unresolvedRows += 1; continue; }
      if (!clientPackages.has(pkg)) continue; // 只对声明 dsh.client.platform=web 的包判
      if (!byPackage.has(pkg)) byPackage.set(pkg, new Map());
      const rowsById = byPackage.get(pkg);
      if (!rowsById.has(row.id)) rowsById.set(row.id, { name: row.name, sources: [] });
      rowsById.get(row.id).sources.push({ file, ...(pkgName ? { bundle: pkgName } : {}) });
    }
  }
  for (const [packageName, rowsById] of byPackage) {
    if (rowsById.size < 2) continue; // 同 id 多文件重复声明 = cordis 覆盖合并，不算多来源
    const entries = [...rowsById.entries()].map(([id, { name, sources }]) => ({
      id,
      name,
      sources: sources.map((s) => path.relative(profile.dir, s.file) || s.file),
    }));
    add({
      code: 'COMPAT_CLIENT_MULTI_SOURCE',
      severity: 'blocker',
      confidence: 'confirmed',
      title: `客户端包 ${packageName} 被 ${entries.length} 条 Loader 行解析（DSH 启动会崩）`,
      evidence: {
        package: packageName,
        entries,
        rule: '一个声明 dsh.client.platform 的包只允许一个 active Loader 来源（client-modules reconcilePackage）',
      },
      impact: `任何重放/改写 modules 行的插件都会让 ClientModuleRegistry 重建时抛 ClientPackageCompositionError；modules 是 required 插件，宿主启动直接失败（Mieksido/surfcore#35）。`,
      recommendation: `只保留一条解析到 ${packageName} 的 Loader 行：合并各行的 Config 到同一行（命名空间由行 id 推导，功能不受影响），或删除多余的行。冲突行：${entries.map((e) => `id=${e.id}（${e.sources.join('、')}）`).join('；')}。`,
    });
  }
  return { scannedRows, unresolvedRows };
}

/**
 * @param {object} opts
 * @param {string} [opts.dshHome] 测试可注入临时目录
 * @param {string} [opts.profileName]
 * @param {string} [opts.surfcoreVersion]
 * @param {string[]} [opts.safeExact] 测试可模拟“已放行上下文工具”
 * @param {string[]} [opts.safePrefixes]
 */
export function scanPluginCompatibility({
  dshHome = DSH_HOME,
  profileName = '',
  surfcoreVersion = '',
  safeExact = SAFE_EXACT_TOOLS,
  safePrefixes = SAFE_TOOL_PREFIXES,
  now = new Date(),
} = {}) {
  const scannedAt = now.toISOString();
  const issues = [];
  const add = (issue) => issues.push(issue);
  const profiles = listProfiles(dshHome);
  const profile = pickProfile(profiles, profileName);
  const base = {
    schemaVersion: SCHEMA_VERSION,
    scannedAt,
    ok: false,
    profile: null,
    versions: { surfcore: String(surfcoreVersion || 'unknown'), dsh: String(process.env.DSH_VERSION || 'unknown') },
    coverage: {
      profiles: profiles.map((p) => p.name),
      bundles: [],
      packages: 0,
      knownBundles: [],
      unknownBundles: [],
      toolsKnown: [],
      unchecked: ['端口/进程归属', '运行时工具拒绝/重复回复', '任意第三方插件的自定义状态路径'],
    },
    issues,
  };

  if (!profile) {
    add({
      code: 'COMPAT_PROFILE_NOT_FOUND',
      severity: 'blocker',
      confidence: 'confirmed',
      title: '找不到 DSH profile',
      evidence: { dshHome, profiles: profiles.map((p) => p.name) },
      impact: '无法读取已安装插件和 SurfCore 策略，体检没有可信输入。',
      recommendation: '确认 DSH 已安装、DSH_HOME 正确，并至少有一个 profiles/<name>/package.json。',
    });
    return base;
  }

  base.profile = { name: profile.name, path: profile.dir };
  const packages = collectPackages(profile.dir);
  const active = activeNames(profile, packages);
  const activePackages = packages.filter((pkg) => isActive(pkg, active));
  base.coverage.bundles = [...active];
  base.coverage.packages = packages.length;

  // 上下文压缩被谁关掉：profile patch + 已激活插件的 bundle patch。
  const autoOff = [];
  const autoOffSources = [];
  const pushAutoOff = (value, file) => {
    for (const hit of findCompactionAutoOff(value)) {
      autoOff.push(hit);
      autoOffSources.push(file);
    }
  };
  pushAutoOff(profile.patch, profile.patchFile);
  for (const pkg of activePackages) {
    for (const file of pkg.bundlePatchFiles) pushAutoOff(readYaml(file), file);
  }

  const known = [];
  const unknown = [];
  for (const pkg of activePackages) {
    const rule = ruleForPackage(pkg.name);
    if (rule) {
      known.push({ pkg, rule });
      base.coverage.knownBundles.push({ name: pkg.name, version: pkg.version, rule: rule.id });
      continue;
    }
    if (pkg.compat) {
      known.push({ pkg, rule: null, manifest: pkg.compat });
      base.coverage.knownBundles.push({ name: pkg.name, version: pkg.version, manifest: true });
      base.coverage.toolsKnown.push(...pkg.compat.tools.map((t) => t.name));
      continue;
    }
    // 只有“确实是 bundle/插件”的包才列入 unknown；普通依赖不制造噪音。
    if (pkg.hasBundlePatch || pkg.pkg?.dsh) {
      unknown.push(pkg);
      base.coverage.unknownBundles.push({ name: pkg.name, version: pkg.version, hasBundlePatch: pkg.hasBundlePatch });
    }
  }

  // 已知插件：工具是否会被 QQ guard 拒绝。
  for (const { pkg, rule, manifest } of known) {
    const tools = rule?.tools ?? manifest?.tools?.map((t) => t.name) ?? [];
    const denied = tools.filter((name) => !allowedTool(name, safeExact, safePrefixes));
    const contextProvider = rule?.contextProvider === true
      || (manifest?.capabilities ?? []).includes('context-compression')
      || tools.some((name) => name === 'compress');
    const isLocalOnly = rule?.localOnly === true;

    if (denied.length && !isLocalOnly) {
      add({
        code: 'COMPAT_TOOL_DENIED',
        severity: contextProvider ? 'blocker' : 'high',
        confidence: rule ? 'inferred' : 'confirmed',
        title: `${pkg.name} 的工具会被 QQ 会话拒绝`,
        evidence: {
          bundle: pkg.name,
          version: pkg.version,
          source: rule ? 'known-rule' : 'surfcore.compat.json',
          tools,
          denied,
          allowed: tools.filter((name) => allowedTool(name, safeExact, safePrefixes)),
          policy: { safeExact, safePrefixes },
        },
        impact: contextProvider
          ? 'QQ 会话无法使用第三方上下文压缩；工具被拒只是普通工具错误，模型可能继续重试并增加 token 消耗。'
          : '这些工具在 QQ 会话里不可用；如果模型反复调用，可能陷入重试。',
        recommendation: contextProvider
          ? '先确认插件用途；在 QQ 安全策略里显式允许这些“只改模型上下文”的工具，或在 QQ 会话禁用该插件。另需独立开启回合熔断。'
          : '确认工具用途后显式允许，或在 QQ 会话禁用该插件。',
      });
    }

    if (contextProvider && autoOff.length) {
      add({
        code: 'COMPAT_COMPACTION_CONFLICT',
        severity: 'high',
        confidence: 'confirmed',
        title: '第三方上下文插件接管压缩，但 DSH 自动压缩被关闭',
        evidence: {
          bundle: pkg.name,
          version: pkg.version,
          compactionAutoOff: autoOff,
          sources: autoOffSources.map((f) => path.relative(profile.dir, f) || f),
        },
        impact: '如果 QQ 又拒绝该插件的压缩工具，这个会话既没有 DSH 自动压缩、也没有可用的第三方压缩，上下文会持续变长。',
        recommendation: '确认压缩由哪一套负责：要么恢复 DSH compaction-basic 的 auto，要么允许该插件的上下文工具；不要两套都关。',
      });
    }
  }

  for (const pkg of unknown) {
    add({
      code: 'COMPAT_TOOL_INVENTORY_UNKNOWN',
      severity: 'info',
      confidence: 'unknown',
      title: `${pkg.name} 的工具清单未声明`,
      evidence: { bundle: pkg.name, version: pkg.version, hasBundlePatch: pkg.hasBundlePatch },
      impact: '无法判断它注册的工具是否会被 QQ guard 拒绝；这不代表有冲突，也不代表没有。',
      recommendation: '让插件提供 surfcore.compat.json（声明 tools/capabilities），或从插件文档确认工具名后再加已知规则。',
    });
  }

  // 已知本地工具在 QQ 会话被隐藏是预期边界，但 SurfCore 自己要确认策略仍在。
  if (!safeExact.includes('ask_user_question') || safeExact.length < 2 || safePrefixes.length < 1) {
    add({
      code: 'COMPAT_POLICY_EMPTY',
      severity: 'blocker',
      confidence: 'confirmed',
      title: 'QQ 工具白名单异常为空/缺少基础工具',
      evidence: { safeExact, safePrefixes },
      impact: '模型可能连提问/待办/QQ 工具都不可用，表现为“只会说话但不行动”。',
      recommendation: '检查 qq-tool-restrict 是否被正确装配；不要在 QQ 会话放行本地执行工具。',
    });
  }

  // #35 单包单来源：装前体检能报、但拦不住启动期 fatal —— 它的定位是
  // 「安装/配置变更时提前发现」，不能替代 PR1 的结构修复。
  const multiSource = checkClientMultiSource(profile, activePackages, add);
  base.coverage.unchecked = [
    ...base.coverage.unchecked.filter((x) => !x.includes('Loader 来源')),
    `客户端包 Loader 来源唯一性（已扫 ${multiSource.scannedRows} 行；${multiSource.unresolvedRows} 行解析不了，未计入判定）`,
  ];

  base.coverage.toolsKnown = [...new Set([...base.coverage.toolsKnown, ...known.flatMap((k) => k.rule?.tools ?? [])])];
  base.issues = issues.sort((a, b) => {
    const order = { blocker: 0, high: 1, warn: 2, info: 3 };
    return (order[a.severity] ?? 9) - (order[b.severity] ?? 9);
  });
  base.ok = !base.issues.some((i) => i.severity === 'blocker' || i.severity === 'high');
  base.coverage.knownBundles = [...new Map(base.coverage.knownBundles.map((x) => [x.name, x])).values()];
  base.coverage.unknownBundles = [...new Map(base.coverage.unknownBundles.map((x) => [x.name, x])).values()];
  return base;
}

export { SCHEMA_VERSION };
