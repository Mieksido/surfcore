# 交接：贴吧平台功能注入

> 先读 [`2026-11-02-platform-injection-baseline.md`](2026-11-02-platform-injection-baseline.md)。
> 贴吧已有占位：`plugins/surfcore/platforms/tieba/manifest.json`（`status: planned`，无 index.js）。

## 0. 第一件事：解决内置占位

`PlatformRegistry` 的 `BUILTIN_PLATFORMS` 里已经有 `tieba`（`planned`），而 `register()` **拒绝覆盖内置平台**。
所以直接写 `platforms/tieba/index.js` + 改 manifest 为 active 会被拒绝。

二选一（先和协调会话确认，**不要自己改架构**）：

- **A（推荐）**：让内置 `tieba` 允许被本地 adapter 覆盖（仅当 builtin.status === 'planned'），
  或把内置 `tieba` 改成“占位但可注入”；
- **B**：把贴吧直接做成内置实现（改 `BUILTIN_PLATFORMS` + adapter 方法），不依赖 `loadLocal()`。

同时：`loadLocal()` 目前**没有调用点**（MC 分支补过但被撤回），需要先补一次共享接线。

## 1. 平台事实

- 百度贴吧**没有稳定的个人开放 API**；网页/客户端接口是非公开的；
- 读：吧列表、帖子列表、帖子详情、用户公开资料；
- 写：发帖/回复需要登录态（`BDUSS` cookie）与 `tbs` token，且有验证码/风控；
- 私信、群聊、付费内容、手机号/地址一律不碰。

## 2. 第一阶段（P0）：只读 + 身份 + 记忆

### 2.1 adapter

`plugins/surfcore/platforms/tieba/`（按上面 A/B 决策接线）

```json
{
  "id": "tieba",
  "name": "贴吧",
  "version": "0.1.0",
  "status": "active",
  "enabled": true,
  "entry": "index.js",
  "capabilities": ["identity", "memory.read", "prompt.block"]
}
```

- `status()`：返回登录态（`configured: true/false`）、最近读取时间；**不主动发网络请求**；
- `readMemory(ctx)`：读 `state/tieba.json` 的公开帖子摘要；
- `promptBlock(ctx)`：写清来源与“只读公开内容”。

### 2.2 配置（`state/tieba.json`）

```json
{
  "self": { "nickname": "", "tiebaUid": "", "homeUrl": "" },
  "auth": { "bduss": "", "updatedAt": "" },
  "watchedForums": [],
  "recentPosts": []
}
```

红线：

- `auth.bduss` 只存在本机 `state/`，**绝不进 git、不进日志、不回显**；
- 设置页只显示“已登录/未登录”，不显示 cookie；
- 登录必须人工在浏览器完成后粘贴 cookie，或明确说明“不做自动登录”。

### 2.3 工具（只读）

- `tieba_search`：`{ keyword, forum? }` → 公开帖子列表（标题/作者/回复数/链接）；
- `tieba_read_thread`：`{ url | tid }` → 楼主内容 + 前 N 楼公开回复；
- `tieba_user`：`{ uid | name }` → 公开资料；
- 返回统一带 `platform: '贴吧'`、`source: 'public-thread'`；
- 失败码：`TIEBA_LOGIN_REQUIRED` / `TIEBA_FORUM_NOT_FOUND` / `TIEBA_FETCH_FAILED` / `TIEBA_PARSE_FAILED` / `TIEBA_RATE_LIMITED`。

### 2.4 设置页卡片

- 状态：已登录/未登录、关注吧数量、最近读取；
- 按钮：`测试登录` / `导入关注吧` / `清除 cookie`；
- 错误显示 code + hint（例如“cookie 过期，请重新登录后粘贴 BDUSS”）。

## 3. 第二阶段（P1）：写入（默认不做）

如果用户明确要求发帖/回复：

- 先过共享写闸门（类似 B站 `interact.enabled`），工具层硬拦；
- 每条写入必须人工确认（控制台弹窗显示吧名/标题/正文预览）；
- 必须带 `tbs`，失败区分“登录失效/验证码/被删/限流”；
- 频率限制 + 去重；不做批量顶帖/挖坟/引流；
- 默认关闭，配置项 `tieba.write.enabled: false`。

## 4. 测试

- `scripts/test-tieba-adapter.mjs`：契约、未登录、promptBlock；
- `scripts/test-tieba-parse.mjs`：帖子列表/详情/登录墙/验证码页 fixture；
- `scripts/test-tieba-privacy.mjs`：私信、手机号、地址不进 readMemory；
- 注册进 `scripts/test-audit.mjs`。

## 5. 验收清单

- [ ] 内置 `tieba` 的覆盖/启用方案已定，不是“写完发现 register 拒绝”；
- [ ] 未配置时卡片明确显示“未登录”，不伪造数据；
- [ ] 只读工具能解析公开帖子；失败有 code+hint；
- [ ] cookie 不出现在日志/仓库/回复；
- [ ] 默认没有任何写入工具启用；
- [ ] `npm run test:audit` 通过；case 文档已写。

## 6. 风险

- 贴吧页面/接口变动频繁，解析器要能失败并可手动打开链接；
- 登录态 cookie 敏感，泄露等于账号被盗；
- 写入极易触发验证码/封号，**没有用户明确批准不要做**。
