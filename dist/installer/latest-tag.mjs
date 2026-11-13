// 解析「最新稳定 tag」。安装器与测试共用这一份，避免两套实现漂移。
//
// 顺序（以最新版为标准）：
//   1) 显式指定（--tag / SURFCORE_INSTALL_TAG）
//   2) GitHub Releases 的 latest（最新非预发布）
//   3) jsdelivr 的版本清单（国内 api.github.com 常被限流/阻断）
//   4) 内置兜底 tag（发版时随仓库更新）
//
// 只认稳定版：带 -dev / -rc 的一律不参与「最新稳定版」比较。

export const REPO = 'Mieksido/surfcore';
/** 网络全不可用时的兜底版本。发版时随仓库更新，不要在这里写老版本。 */
export const FALLBACK_TAG = 'v0.8.9';

export function normalizeTag(tag) {
  const t = String(tag || '').trim();
  if (!t) return '';
  return /^v/i.test(t) ? `v${t.slice(1)}` : `v${t}`;
}

/** 只比较稳定版 x.y.z；返回 1 / 0 / -1。 */
export function compareTags(a, b) {
  const pa = String(a).replace(/^v/i, '').split('-')[0].split('.').map(Number);
  const pb = String(b).replace(/^v/i, '').split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0) ? 1 : -1;
  }
  return 0;
}

/**
 * @param {object} [options]
 * @param {string} [options.explicitTag] 命令行 --tag
 * @param {Function} [options.fetchImpl] 便于测试注入
 * @param {object} [options.env]
 * @param {Function} [options.say] 进度输出
 * @param {number} [options.timeoutMs]
 * @param {string} [options.repo]
 * @param {string} [options.fallback]
 * @returns {Promise<string>}
 */
export async function resolveLatestTag({
  explicitTag = '',
  fetchImpl = globalThis.fetch,
  env = process.env,
  say = () => {},
  timeoutMs = 8000,
  repo = REPO,
  fallback = FALLBACK_TAG,
} = {}) {
  const explicit = normalizeTag(explicitTag || env.SURFCORE_INSTALL_TAG || '');
  if (explicit) return explicit;

  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'surfcore-installer' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) {
      const tag = normalizeTag((await r.json())?.tag_name);
      if (tag) return tag;
    } else {
      say(`  （GitHub API 返回 ${r.status}，改用 jsdelivr 查版本）`);
    }
  } catch (error) {
    say(`  （GitHub API 不可用：${error?.message || error}，改用 jsdelivr 查版本）`);
  }

  try {
    const r = await fetchImpl(`https://data.jsdelivr.com/v1/packages/gh/${repo}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.ok) {
      const versions = ((await r.json())?.versions || [])
        .map((item) => normalizeTag(item?.version))
        .filter((tag) => tag && !tag.includes('-'));
      if (versions.length) return versions.sort(compareTags).pop();
    }
  } catch {}

  say(`  （在线版本查询都失败，退回内置兜底 ${fallback}）`);
  return normalizeTag(fallback);
}
