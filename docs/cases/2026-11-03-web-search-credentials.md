# DSH 0.2.x 凭据结构变化导致 web_search 静默回退 Bing

日期：2026-11-03

对应：GitHub PR #6 / issue #17

## 现象

- DSH 0.2.x 的 `.credentials.yaml` 已从 `refs` 改为 `records`。
- `src/web-search.js` 只读 `doc.refs[name]`，读不到 `deepseek-account-platform/default` 的 token。
- `resolveSearchApiKey()` 返回空，`deepseekSearch()` 抛 `NO_KEY`。
- `webSearch()` 的 auto 路径捕获后回退 Bing；用户看到“能搜”，但实际一直走 Bing。

当前机器确认结构（不打印 token）：

```text
top: version, records
records:
  deepseek-account-platform/default:
    payload: version, token, issuer
```

## 修法

### 1. 凭据两代都认

`readDshCredential()`：

```js
const legacy = doc?.refs?.[name];
if (legacy) return legacy;
const token = doc?.records?.[name]?.payload?.token;
return token ?? '';
```

### 2. 账号级凭据 fallback

`resolveSearchApiKey()`：

```text
apiKey / env / 指定 ref
→ 指定 ref 没有时读 deepseek-account-platform/default
→ source = dsh-account-credential
```

### 3. 账号 token 只发官方域名

`deepseek-account-credential` 走：

```text
https://api.deepseek.com
x-dsh-auth-token
```

`assertAccountEndpoint()` 拒绝：

- 非 https；
- hostname 不是 `api.deepseek.com`；
- 带非默认端口；
- 自定义 `baseURL` / `apiSearchURL` 指向别处。

这是为了避免账号平台 token 被配置带到第三方域名。

### 4. 新增 Search API 直连

`deepseekApiSearch()`：

```text
POST https://api.deepseek.com/v1/tools/search
```

auto 顺序：

```text
Search API 直连
→ 模型轮次 DeepSeek
→ Bing
```

每一步失败原因都保留在 `fallbackFrom` / `note` 里。

### 5. 配置入口

`config.example.json`、设置页新增：

```text
webSearch.apiSearchURL
```

默认空 = `https://api.deepseek.com/v1/tools`。

## 没有做

- 没有自动刷新账号 token；token 过期后仍会回退。
- 没有 `issuer` 校验；只校验 endpoint。
- 没有把 Bing 回退强制展示到 UI；仍靠 `note`/`provider`。
- 没有真实网络测试账号 token 直连 Search API；用假凭据测试结构/端点。
- 没有改 `PR #6` 本身；本批是独立实现。

## 风险

- **账号 token 安全边界**：如果未来有人绕过 `assertAccountEndpoint()`，token 可能外发；测试已钉住。
- **endpoint 兼容性**：`/v1/tools/search` 或 `x-dsh-auth-token` 若变更，会回退模型轮次/Bing。
- **token 过期**：没有 refresh，长期运行可能再次静默回退。
- **Bing 缓存**：5 分钟内可能继续返回回退结果。
- **直连 API 结果形状**：只认 `results`；若上游改成 `data.results`，会返回空结果而不是报错。
- **API key 自定义 endpoint**：仍允许公网 HTTPS，这是给自建代理的既有能力。

## 验证

```text
node scripts/test-web-search-credentials.mjs
node scripts/test-media-search.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
