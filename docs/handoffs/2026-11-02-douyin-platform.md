# 交接：抖音平台功能注入

> 先读 [`2026-11-02-platform-injection-baseline.md`](2026-11-02-platform-injection-baseline.md)。

## 0. 目标与边界

**目标**：角色知道“我在抖音是谁”、能读用户给的一条公开视频的元数据、把公开摘要写进记忆、设置页有状态卡。

**第一版明确不做**：

- 不做自动登录、不保存账号密码、不接验证码；
- 不做自动评论 / 私信 / 点赞 / 关注 / 发布；
- 不做“刷抖音推荐流/批量抓取”——风控与封号风险高；
- 不把 cookie/设备指纹写进仓库或日志。

## 1. 平台事实

- 抖音**没有面向个人账号的官方开放 API**；
- 分享链接（`v.douyin.com/...`）可解析出视频 ID，公开页面有标题/作者/文案/封面等 meta；
- 评论、私信、用户主页列表需要登录态与签名，反爬强；
- 第一版只做**单链接公开元数据**，不做登录后接口。

## 2. 第一阶段（P0）：只读卡片 + 身份 + 记忆

### 2.1 adapter

`plugins/surfcore/platforms/douyin/`

```json
{
  "id": "douyin",
  "name": "抖音",
  "version": "0.1.0",
  "status": "active",
  "enabled": true,
  "entry": "index.js",
  "capabilities": ["identity", "memory.read", "prompt.block"]
}
```

- `status()`：`{ ok, configured, lastReadAt }`；不访问网络；
- `readMemory(ctx)`：只读 `state/douyin.json` 里用户手动导入的公开视频摘要；
- `promptBlock(ctx)`：写清“抖音内容只来自用户给的链接/导入，不要声称自己刷过抖音”。

### 2.2 配置（`state/douyin.json`）

```json
{
  "self": { "nickname": "", "douyinUid": "", "homeUrl": "" },
  "videos": [
    { "url": "", "videoId": "", "title": "", "author": "", "publishedAt": "", "summary": "", "cover": "", "importedAt": "" }
  ]
}
```

- 不存评论、私信、手机号、地址；
- 不存 cookie；如果以后要登录，单独设计并加密存储。

### 2.3 工具（只读）

- `douyin_read_video`：`{ url }` → 解析短链 → 公开页面 meta → `{ ok, platform: '抖音', video: {...}, notice }`；
- 不提供 `douyin_search` / `douyin_comments`（没有稳定公开接口）；
- 失败码：`DOUYIN_URL_INVALID` / `DOUYIN_RESOLVE_FAILED` / `DOUYIN_FETCH_FAILED` / `DOUYIN_LOGIN_REQUIRED` / `DOUYIN_PARSE_FAILED`；
- hint 示例：“请在浏览器打开视频，复制文案/标题，粘贴到控制台导入”。

### 2.4 设置页卡片

- 显示：配置状态、已导入视频数、最近解析时间；
- 按钮：`解析链接` / `打开主页` / `清除导入`；
- 不做“登录抖音”按钮（没有官方 OAuth）。

## 3. 第二阶段（P1）：只读扩展（可选）

- 用户主页公开视频列表（仍建议手动给主页链接，只解析首屏公开内容）；
- 把视频文案摘要写入记忆卡（`scope: 'douyin'`，需扩 `memory-card.js` 枚举并做兼容测试）。

## 4. 写入（P2，默认不做）

如果以后要做评论/私信/发布：

- 必须先让用户确认“接受封号风险 + 逐条人工确认”；
- 不允许自动登录/验证码绕过；
- 每条写入弹确认，带视频链接与正文预览；
- 频率限制、失败可解释；不做批量/引流。

## 5. 测试

- `scripts/test-douyin-adapter.mjs`：契约、未配置、promptBlock；
- `scripts/test-douyin-parse.mjs`：短链跳转、正常 meta、登录墙、404、风控页 fixture；
- `scripts/test-douyin-privacy.mjs`：评论/私信/手机号不进 readMemory；
- 注册进 `scripts/test-audit.mjs`。

## 6. 验收清单

- [ ] 设置页有抖音卡片，未配置时明确显示；
- [ ] 粘贴一个公开分享链接，能解析出标题/作者/文案摘要；失败有 code+hint；
- [ ] 不抓评论/私信；不保存 cookie；
- [ ] prompt 里有抖音来源规则；
- [ ] 没有任何自动写入代码；
- [ ] `npm run test:audit` 通过；case 文档已写。

## 7. 风险

- 短链跳转/页面结构变化 → 解析失败要可手动兜底；
- 抖音对自动化非常敏感 → 不要做登录态批量请求；
- 用户可能要求“自动评论/引流” → 明确拒绝或走 P2 人工确认。
