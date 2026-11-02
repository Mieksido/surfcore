# 交接：微信平台功能注入

> 先读 [`2026-11-02-platform-injection-baseline.md`](2026-11-02-platform-injection-baseline.md)。

## 0. 先做选择：公众号 还是 个人微信？

这两个完全不是一回事，**必须先让用户确认**，否则不要写代码：

| | 微信公众号 | 个人微信 |
| --- | --- | --- |
| 官方 API | ✅ 有（appid/appsecret，需认证） | ❌ 没有 |
| 能做什么 | 发文章、管理素材、接收用户消息（需服务器配置） | 只能人工操作 |
| 风险 | 配置复杂、有频率限制 | **hook/协议挂 = 违反 ToS，封号风险极高** |
| 本项目建议 | 可以做只读/发文，但需用户提供公众号资质 | **不做自动化；最多做“手动导入/导出”** |

**默认立场：不做个人微信 hook、不做协议挂、不代登录。**
如果用户要的是“角色在微信里聊天”，只能走人工转发/导入，或者改用公众号/企业微信官方能力。

## 1. 方案 A：微信公众号（推荐，如果用户有资质）

### 1.1 能力边界

- 官方 API：`api.weixin.qq.com`；
- 读：已发布文章列表/文章内容、用户消息（需公众号后台配置服务器 URL，接收 XML/加密消息）；
- 写：群发/客服消息有严格限制与审核；第一版**只读**；
- 需要 `appid` / `appsecret`，只能存本机 `state/wechat.json`，绝不进 git/日志。

### 1.2 adapter

`plugins/surfcore/platforms/wechat/`（`id: 'wechat'`）

```json
{
  "id": "wechat",
  "name": "微信公众号",
  "version": "0.1.0",
  "status": "active",
  "enabled": true,
  "entry": "index.js",
  "capabilities": ["identity", "memory.read", "prompt.block"]
}
```

- `status()`：`{ ok, configured, accountName }`，不主动调 API；
- `readMemory(ctx)`：只读用户手动同步/缓存的公开文章摘要；
- `promptBlock(ctx)`：写清“这是公众号内容，不是个人微信聊天”。

### 1.3 配置（`state/wechat.json`）

```json
{
  "mode": "official",
  "self": { "accountName": "", "appId": "", "homeUrl": "" },
  "articles": [
    { "title": "", "url": "", "publishedAt": "", "summary": "", "importedAt": "" }
  ]
}
```

- `appsecret` 单独字段，设置页不回显；日志脱敏；
- 不存用户 openid 列表之外的个人信息；不存聊天记录。

### 1.4 工具（只读）

- `wechat_read_article`：`{ url }` → 公开文章标题/作者/正文摘要；
- `wechat_list_articles`：仅当已配置公众号 API，返回已发布文章列表；
- 失败码：`WECHAT_NOT_CONFIGURED` / `WECHAT_AUTH_FAILED` / `WECHAT_FETCH_FAILED` / `WECHAT_PARSE_FAILED`。

## 2. 方案 B：个人微信（默认不做自动化）

只允许两种低风险形态：

1. **手动导入**：用户把聊天记录/文章链接粘贴到控制台，角色只读摘要；
2. **人工转发**：用户在微信里自己发，系统不接触账号。

明确禁止：

- hook PC 微信 / 注入 DLL / 协议挂 / 模拟登录；
- 自动加好友、自动群发、自动朋友圈、自动收红包；
- 保存聊天记录到公开面/记忆卡（私聊默认不进模型，除非用户逐条导入并确认）。

如果用户坚持要“个人微信自动回复”，回答：**没有官方 API，做了就是封号风险，本项目不提供。**

## 3. 测试

- `scripts/test-wechat-adapter.mjs`：契约、未配置、mode 校验、promptBlock；
- `scripts/test-wechat-parse.mjs`：公开文章正常/删除/登录墙 fixture；
- `scripts/test-wechat-privacy.mjs`：聊天记录、手机号、地址不进入 readMemory；
- 注册进 `scripts/test-audit.mjs`。

## 4. 验收清单

- [ ] 已明确是公众号还是个人微信（未确认不动手）；
- [ ] 公众号：卡片显示已配置/未配置，appsecret 不回显；
- [ ] 文章解析失败有 code+hint；
- [ ] 个人微信：没有任何 hook/协议/自动登录代码；
- [ ] 私聊内容默认不进记忆/公开面；
- [ ] `npm run test:audit` 通过；case 文档已写。

## 5. 风险

- 公众号 API 需要资质与服务器配置，测试成本高；
- appsecret 泄露等于公众号被接管；
- 个人微信自动化风险极高，**不要为了 Demo 碰**。
