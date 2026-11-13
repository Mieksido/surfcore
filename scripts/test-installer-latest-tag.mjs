// 安装器「最新稳定版」解析的回归：
//   显式指定优先 / GitHub Releases / jsdelivr 兜底 / 全失败走内置兜底 / 预发布不参与比较。
// 只测纯解析逻辑，不发真实网络请求。
import assert from 'node:assert/strict';
import { normalizeTag, compareTags, resolveLatestTag, REPO, FALLBACK_TAG } from '../dist/installer/latest-tag.mjs';

const noFetch = async () => { throw new Error('不应该发请求'); };

// 1) 命令行 --tag 优先，且不做网络请求
assert.equal(await resolveLatestTag({ explicitTag: 'v0.8.9', fetchImpl: noFetch, env: {} }), 'v0.8.9');
assert.equal(await resolveLatestTag({ explicitTag: '0.9.0', fetchImpl: noFetch, env: {} }), 'v0.9.0');

// 2) 环境变量 SURFCORE_INSTALL_TAG
assert.equal(await resolveLatestTag({ env: { SURFCORE_INSTALL_TAG: '0.9.0' }, fetchImpl: noFetch }), 'v0.9.0');

// 3) GitHub Releases 的 latest
{
  const fetchImpl = async (url) => {
    assert.match(url, /api\.github\.com/);
    return { ok: true, status: 200, json: async () => ({ tag_name: 'v0.10.0' }) };
  };
  assert.equal(await resolveLatestTag({ fetchImpl, env: {} }), 'v0.10.0');
}

// 4) API 403（国内常见）→ 用 jsdelivr，过滤预发布、按数字排序
{
  const fetchImpl = async (url) => {
    if (url.includes('api.github.com')) return { ok: false, status: 403, json: async () => ({}) };
    assert.match(url, /data\.jsdelivr\.com/);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        versions: [
          { version: '0.9.10' },
          { version: '0.10.0' },
          { version: '0.10.1-dev.2' },
          { version: '0.9.9' },
        ],
      }),
    };
  };
  assert.equal(await resolveLatestTag({ fetchImpl, env: {} }), 'v0.10.0', '要选最高稳定版，不能把 dev 当最新');
}

// 5) 全部失败 → 内置兜底
{
  const fetchImpl = async () => { throw new Error('offline'); };
  assert.equal(await resolveLatestTag({ fetchImpl, env: {} }), normalizeTag(FALLBACK_TAG));
}

// 6) 归一化与数字比较
assert.equal(normalizeTag('0.8.9'), 'v0.8.9');
assert.equal(normalizeTag('V0.8.9'), 'v0.8.9');
assert.equal(normalizeTag(''), '');
assert.equal(compareTags('v0.10.0', 'v0.9.9'), 1);
assert.equal(compareTags('v0.8.9', 'v0.8.10'), -1);
assert.equal(compareTags('v0.8.9', 'v0.8.9-dev.6'), 0);
assert.equal(REPO, 'Mieksido/surfcore');
assert.match(FALLBACK_TAG, /^v\d+\.\d+\.\d+$/);

console.log('✅ 安装器版本解析通过（6 组断言）');
