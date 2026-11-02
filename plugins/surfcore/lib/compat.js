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

function collectPackages(profileDir) {
  return packageDirs(profileDir).map((dir) => {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (!pkg || typeof pkg.name !== 'string') return null;
    const bundlePatch = path.join(dir, 'dsh.bundle.patch.yml');
    return {
      name: pkg.name,
      version: String(pkg.version ?? ''),
      dir,
      pkg,
      hasBundlePatch: fs.existsSync(bundlePatch),
      bundlePatch,
      compat: readCompatManifest(dir),
    };
  }).filter(Boolean);
}

/** package 声明的 bundle patch 文件；DSH 0.2 用 dsh.bundle.patch 数组。 */
function bundlePatchFiles(pkg) {
  const declared = pkg?.pkg?.dsh?.bundle?.patch;
  const rels = Array.isArray(declared) ? declared : [];
  const files = rels.map((rel) => path.resolve(pkg.dir, String(rel)));
  if (!files.length && pkg?.hasBundlePatch) files.push(pkg.bundlePatch);
  return [...new Set(files)].filter((file) => {
    try { return fs.statSync(file).isFile(); } catch { return false; }
  });
}

function walkLoaderRows(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) walkLoaderRows(item, out);
    return out;
  }
  if (!node || typeof node !== 'object') return out;
  if (node.disabled === true) return out;
  if (typeof node.name === 'string' && typeof node.id === 'string' && node.name.trim()) {
    out.push({ id: node.id, name: node.name.trim() });
  }
  for (const value of Object.values(node)) walkLoaderRows(value, out);
  return out;
}

function nearestPackage(start) {
  let dir = path.resolve(start);
  try { if (fs.statSync(dir).isFile()) dir = path.dirname(dir); } catch {}
  for (;;) {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (pkg && typeof pkg.name === 'string') return { name: pkg.name, dir, pkg };
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveLoaderPackage(name, baseDir, packages) {
  const raw = String(name ?? '').trim();
  if (!raw) return null;
  if (!raw.startsWith('.') && !raw.startsWith('file:') && !path.isAbsolute(raw)) {
    const exact = packages.find((pkg) => pkg.name === raw || raw.startsWith(`${pkg.name}/`));
    if (exact) return { name: exact.name, dir: exact.dir, pkg: exact.pkg };
  }
  let candidate;
  if (raw.startsWith('file:')) {
    try { candidate = new URL(raw).pathname; } catch { return null; }
  } else if (path.isAbsolute(raw)) {
    candidate = raw;
  } else {
    candidate = path.resolve(baseDir, raw);
  }
  return nearestPackage(candidate);
}

/** 同一个客户端包被多条 Loader 行解析时，DSH 重建 modules 会直接 fatal。 */
function clientMultiSourceIssues(profile, activePackages) {
  const rows = [];
  for (const row of walkLoaderRows(profile.patch)) rows.push({ ...row, baseDir: profile.dir, source: profile.patchFile });
  for (const pkg of activePackages) {
    for (const file of bundlePatchFiles(pkg)) {
      for (const row of walkLoaderRows(readYaml(file))) rows.push({ ...row, baseDir: pkg.dir, source: file });
    }
  }
  const sources = new Map();
  const clientPackages = new Set(activePackages
    .filter((pkg) => pkg?.pkg?.dsh?.client?.platform === 'web')
    .map((pkg) => pkg.name));
  for (const row of rows) {
    const resolved = resolveLoaderPackage(row.name, row.baseDir, activePackages);
    if (!resolved || !clientPackages.has(resolved.name)) continue;
    const list = sources.get(resolved.name) ?? [];
    list.push({ loaderName: row.name, id: row.id, baseDir: row.baseDir, source: row.source });
    sources.set(resolved.name, list);
  }
  const issues = [];
  for (const [packageName, list] of sources) {
    if (list.length < 2) continue;
    issues.push({
      code: 'COMPAT_CLIENT_MULTI_SOURCE',
      severity: 'blocker',
      confidence: 'confirmed',
      title: `${packageName} 被 ${list.length} 条 Loader 行解析到同一个客户端包`,
      evidence: {
        package: packageName,
        sources: list.map((item) => ({
          id: item.id,
          loaderName: item.loaderName,
          baseDir: item.baseDir,
          patch: path.relative(profile.dir, item.source) || item.source,
        })),
      },
      impact: 'DSH 重建 client-modules 时会报 “resolves from multiple active Loader sources”；modules 是 required 插件，宿主会直接启动失败。',
      recommendation: '只保留一条指向该客户端包的 Loader 行；第二行必须是独立 host-only 包（自带 package.json，且不声明 dsh.client），或合并该行的 Config。',
    });
  }
  return issues;
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
  for (const issue of clientMultiSourceIssues(profile, activePackages)) add(issue);

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
    if (!pkg.hasBundlePatch) continue;
    pushAutoOff(readYaml(pkg.bundlePatch), pkg.bundlePatch);
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
