# 平台功能注入 · 共同基线（小红书 / 贴吧 / 抖音 / 微信）

> 2026-11-02 给四个新平台的交接共同部分。每个平台先读本文，再读自己的专项交接。
> **这不是“再做一个聊天窗口”，而是把平台接成“角色能感知、能记住、能行动”的一等公民。**

## 0. 一句话目标

每个平台最终要回答四个问题：

1. **身份**：这个平台上的“我”是谁？（昵称 / 稳定 ID / 主页 / 人格名）
2. **记忆**：角色能读到哪些**公开**内容？写回哪些记忆？
3. **行动**：角色能做什么？（先只读；写入必须单独审批）
4. **呈现**：设置页/控制台如何显示状态、错误和下一步？

## 1. 现有架构（先读代码，不要凭记忆）

| 位置 | 作用 |
| --- | --- |
| `plugins/surfcore/lib/platforms.js` | `PlatformRegistry`：adapter 契约、`loadLocal()`、`register()`、`statusAll()` |
| `plugins/surfcore/platforms/README.md` | 适配器最小契约与“接贴吧”的原始说明 |
| `plugins/surfcore/platforms/tieba/manifest.json` | 贴吧占位（`status: planned`，无 index.js） |
| `src/self-identity.js` | 跨平台自我身份唯一实现（`normalizeSelfCard` / `buildSelfIdentityBlock`） |
| `docs/guides/CROSS_PLATFORM_IDENTITY.md` | 来源判断、身份锚点、隐私分级、公开面硬闸 |
| `plugins/surfcore/lib/privacy.js` | 隐私闸门：私信/群聊/未公开内容一律不进公开面 |
| `plugins/surfcore/tools/lib/outbound-guard.mjs` | 出站身份保护（完整 QQ 号/群号/受保护 ID） |
| `plugins/surfcore/lib/index.js` | 插件宿主入口；平台卡片/API 可参考 MC 分支（已撤回，仅作参考） |
| `plugins/surfcore/mcp*.js` / `src/mcp-*.js` | 现有工具注册方式；新平台工具不要另起一套协议 |

### 1.1 两个必须先知道的现实

1. **`PlatformRegistry.loadLocal()` 目前没有调用点。**
   `index.js` 里原本 MC 分支补过 `platforms.loadLocal()`，但 MC 未完成、已从 dev 撤回。
   → 四个平台都依赖这一步；建议由**一个共享提交**先补 `loadLocal()`（或由协调会话统一做），
     不要让四个会话各自改同一行 `index.js`，否则必冲突。
2. **`tieba` 是内置占位平台**（`BUILTIN_PLATFORMS`，`status: planned`）。
   `register()` 明确拒绝覆盖内置平台。贴吧要真正启用，必须先在架构上二选一：
   - 把内置 `tieba` 从 `planned` 改为可注入（允许本地 adapter 覆盖 planned 内置）；或
   - 把贴吧适配器直接做成内置实现（改 `BUILTIN_PLATFORMS` + 方法）。
   **贴吧会话不要直接写一个 `platforms/tieba/index.js` 就以为能加载**——它会被 `register()` 拒绝。

## 2. 统一分层：先只读，再写入

| 阶段 | 内容 | 是否允许进 dev |
| --- | --- | --- |
| **P0 只读** | adapter + 状态 + 身份 + 公开内容读取 + prompt.block + 设置页状态 | ✅ 可以 |
| **P1 只读工具** | MCP 工具：搜索/详情/用户公开信息；失败结构化 | ✅ 可以 |
| **P2 写入** | 发帖/评论/回复/私信/点赞 | ⛔ 必须单独设计 + 用户明确批准；默认不做 |

**P2 的硬性要求**（四个平台一样）：

- 先过共享写闸门（参考 B站 `interact.enabled` / `lib/interact.mjs` 的思路），不能只靠提示词；
- 每条写入必须有人确认（控制台/弹窗），不允许模型静默发；
- 频率限制、去重、失败可回滚/可说明；
- 绝不做“批量养号/自动引流/自动私信”。

## 3. 身份与记忆（统一规则）

- **身份只用 `src/self-identity.js`**：给 `normalizeSelfCard()` 加字段（如 `tiebaUid` / `xhsId` / `douyinUid` / `wechatName`），
  在 `buildSelfIdentityBlock()` 加一行锚点；不要自己拼身份句。
- **来源由载体决定**：工具返回必须带 `platform` 字段 + 每轮 prompt 里写清来源规则；
  不要用“内容看起来像”判断平台。
- **只读公开内容**：帖子/笔记/视频/文章的公开文本、作者公开资料、公开互动数；
  私信、群聊、未公开内容、手机号/地址/完整 QQ 号一律不进模型上下文（`privacy.js` 统一拦）。
- **记忆写回**：`memory.write` 只写公开内容摘要；带 `platform` / `scope`；不要把 cookie、token、私信写进去。

## 4. 适配器最小契约（照这个写）

```js
// platforms/<id>/index.js
export default async function createAdapter({ manifest }) {
  return {
    id: '<id>',                 // 2~24 位小写字母/数字/下划线
    name: '<平台名>',
    version: '0.1.0',
    status: 'active',           // active | planned | disabled
    capabilities: ['identity', 'memory.read', 'prompt.block'], // 写入阶段才加 memory.write/actions
    async status() { return { ok: true, ... }; },
    async readMemory(ctx) { /* 只返回公开内容 */ },
    promptBlock(ctx) { return '【平台规则】...'; },
  };
}
```

`manifest.json`：

```json
{
  "id": "<id>",
  "name": "<平台名>",
  "version": "0.1.0",
  "status": "active",
  "enabled": true,
  "entry": "index.js",
  "capabilities": ["identity", "memory.read", "prompt.block"]
}
```

## 5. 配置与密钥（红线）

- 平台配置放 `state/<id>.json` 或 `config.json` 的 `platforms.<id>`；
  **cookie / token / BDUSS / appsecret 绝不进 git、不进日志、不进回复**；
- 日志走 `redactSensitiveText` / `SECRET_TOKEN_RE`；
- 设置页只显示“已配置/未配置”，不回显完整密钥；
- 登录必须人工完成；**不要做账号密码代填、验证码绕过、hook 注入**。

## 6. 失败必须可见且可行动（AGENTS §1.7）

统一结构：

```json
{ "ok": false, "code": "XHS_LOGIN_REQUIRED", "error": "人话原因", "hint": "现在该点什么" }
```

- 设置页/卡片必须展示 `code + error + hint`；
- 每个失败分支至少一条测试钉住 `code` 与 `hint` 非空；
- 禁止“返回空数组当成功”。

## 7. 测试与交付

- 所有解析用**离线 fixture**（HTML/JSON 快照），`test:audit` 不访问真实网络；
- 新增 `scripts/test-<id>-*.mjs`，注册进 `scripts/test-audit.mjs`；
- 至少覆盖：adapter 契约、正常解析、登录失效、限流/风控、隐私过滤、身份锚点；
- 交付物：代码 + 测试 + `docs/cases/2026-11-02-<id>-platform.md` + 合并请求块。

## 8. 协作方式（与 Minecraft/向量记忆一致）

- 工作树：`D:\deepseekwork\surfcore-<id>`；
- 分支：`feat/platform-<id>`，从最新 `dev` 切出；
- **禁止 `git add -A`**，只 add 自己的路径；
- 不直接改 `dev` / `main`、不 bump 版本、不打 tag、不发 Release；
- 完成后按 [`docs/COORDINATION.md`](../COORDINATION.md) 的合并请求格式交给协调会话；
- 先跟协调会话确认 `loadLocal()` 的共享改动由谁做，避免四个分支改同一行。
