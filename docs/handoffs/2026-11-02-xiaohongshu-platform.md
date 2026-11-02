# 交接：小红书平台功能注入

> 先读 [`2026-11-02-platform-injection-baseline.md`](2026-11-02-platform-injection-baseline.md)。
> 本文只写小红书特有的部分。

## 0. 目标与边界

**目标**：让角色知道“我在小红书是谁”、能读用户明确给出的公开笔记、把公开内容写进记忆、在设置页有状态卡片。

**第一版明确不做**：

- 不做自动登录、不保存账号密码、不接验证码；
- 不做自动发笔记 / 评论 / 回复 / 私信 / 点赞；
- 不做“搜索全站/批量抓取”——小红书 Web 接口需要 `x-s` / `x-t` 签名，且反爬与封号风险高；
- 不把 cookie 写进仓库/日志。

## 1. 平台事实（先接受现实）

- 小红书**没有面向个人账号的官方开放 API**（企业/商业化接口另说，本项目不接）；
- 网页端接口有签名与风控，直接模拟请求容易 461/风控/封号；
- 最稳的第一版是：**用户手动给链接/分享文本 → 服务端只做一次公开页面解析**；
- 解析失败要明确告诉用户“需要手动复制正文”，不要假装成功。

## 2. 第一阶段（P0）：只读卡片 + 身份 + 记忆

### 2.1 adapter

`plugins/surfcore/platforms/xiaohongshu/`

```json
{
  "id": "xiaohongshu",
  "name": "小红书",
  "version": "0.1.0",
  "status": "active",
  "enabled": true,
  "entry": "index.js",
  "capabilities": ["identity", "memory.read", "prompt.block"]
}
```

adapter 能力：

- `status()`：返回 `{ ok, configured, lastReadAt }`；不访问网络；
- `readMemory(ctx)`：只读 `state/xiaohongshu.json` 里**用户手动导入**的公开笔记摘要；
- `promptBlock(ctx)`：写清“小红书内容只来自用户给的链接/导入；不要声称自己刷过小红书”。

### 2.2 配置（`state/xiaohongshu.json`）

```json
{
  "self": { "nickname": "", "xhsId": "", "homeUrl": "" },
  "notes": [
    { "url": "", "title": "", "author": "", "publishedAt": "", "summary": "", "tags": [], "importedAt": "" }
  ]
}
```

- `self` 由用户在设置页填写；没有就显示“未配置”，不要猜；
- `notes` 只存公开字段；不存评论、私信、手机号、地址；
- 导入方式第一版：用户粘贴链接/分享文本 → 控制台按钮“解析并导入”。

### 2.3 工具（只读，MCP）

工具名建议：

- `xhs_read_note`：入参 `{ url }`；只解析公开页面 meta/正文摘要；返回 `{ ok, platform: '小红书', note: {...}, notice }`；
- 不提供 `xhs_search`（没有稳定公开接口，别做）；
- 失败码：`XHS_URL_INVALID` / `XHS_FETCH_FAILED` / `XHS_LOGIN_REQUIRED`（如果页面要求登录）/ `XHS_PARSE_FAILED`；
- 每个失败都带 `hint`，例如“请在浏览器打开后复制正文，粘贴到控制台导入”。

### 2.4 设置页卡片

- 显示：配置状态、已导入笔记数、最近一次解析时间；
- 按钮：`解析链接` / `打开主页` / `清除导入`；
- 不做“登录小红书”按钮（没有官方 OAuth）。

## 3. 第二阶段（P1）：更多只读能力（可选）

只有在第一版稳定后再做：

- 解析用户主页公开笔记列表（仍建议用户手动提供主页链接，且只解析首屏公开内容）；
- 把笔记正文摘要写入记忆卡（`scope: 'xiaohongshu'`，需先扩 `memory-card.js` 枚举，和 MC 一样要过一次迁移/兼容测试）。

## 4. 写入（P2，默认不做）

如果以后要做评论/发笔记：

- 必须先和用户确认“接受封号风险 + 人工逐条确认”；
- 不允许保存密码/自动登录；
- 每条写入前弹确认，带目标链接与正文预览；
- 频率限制 + 失败可解释；不做批量。

## 5. 测试

离线 fixture：

- `scripts/test-xhs-adapter.mjs`：adapter 契约、status、promptBlock、空配置；
- `scripts/test-xhs-parse.mjs`：正常页面 meta、登录墙、404、风控页；
- `scripts/test-xhs-privacy.mjs`：私信/手机号/地址字段不进 readMemory；
- 注册进 `scripts/test-audit.mjs`。

## 6. 验收清单

- [ ] 设置页能看到“小红书”平台卡片，未配置时明确显示未配置；
- [ ] 粘贴一个公开笔记链接，能解析出标题/作者/摘要；失败有 code+hint；
- [ ] 解析结果只进记忆摘要，不包含评论/私信/手机号；
- [ ] prompt 里出现“小红书内容来源”规则；
- [ ] 没有任何自动登录/自动发内容代码；
- [ ] `npm run test:audit` 通过；case 文档已写。

## 7. 风险

- 页面结构/风控随时变化 → 解析器必须可失败、可手动兜底；
- 服务端抓取可能被 403/461 → 不要重试轰炸，给“手动复制”出口；
- 用户可能要求“自动评论/引流” → 明确拒绝或走 P2 人工确认流程。
