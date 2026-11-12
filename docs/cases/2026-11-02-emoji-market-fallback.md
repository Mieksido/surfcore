# 商城表情取图失败 + 非多模态模型看图报错

日期：2026-11-02

## 1. 现象

- 对方发商城表情，AI 只看到“（表情获取失败）”；
- `qq_get_message_images` 在非多模态模型上报 `does not declare image input`；
- 取图失败时明明有 `summary` / 本地表情库备注，却没有转成文字。

## 2. 根因

1. `emojiCdnCandidates` 只有 `gxh.vip` 一条兜底，报告实测 404；
2. 没有 p.qpic 候选，`uin/resId` 也没有从消息段保留；
3. `fetchMediaData` / 自动内联失败只写“获取失败”，不查 `summary`/本地 `desc/localNote`；
4. 非多模态模型没有图片能力检测，MCP 仍返回 image block，ACP 整条拒绝；
5. `/api/images/message`、sticker/self-image 没有文字兜底。

## 3. 修法

- `extractMediaFromSegments` 保留 `uin` / `resId`；
- `emojiCdnCandidates(media)`：
  - 有 `uin` + emojiId 时生成 `https://p.qpic.cn/qq_expression/<uin>/<resId>/0`；
  - 保留 gxh 为最后一跳；
- 新增 `mediaFallbackText`：
  - 优先 `summary`、本地表情库 `desc/localNote/content`；
  - 明确“原图没取到，仅知标签”/“当前模型不支持图片输入”；
- `fetchMediaData` / `resolveMediaList` 失败都走文字兜底；
- `vision.imageInput` 配置：auto / true / false；
  - auto 查 DSH 模型目录 `inputModalities`；
  - false 时媒体工具只回文字，不再发 image block；
- `/sticker-image`、`/self-image` 在 false 时返回 text；MCP 消费 text；
- 设置页新增「图片能力」。

## 4. 生效/风险

- 重启 DSH（bridge/cfg）；MCP 工具列表不新增，无需重启 MCP 本身；
- 第三方目录外模型 auto 默认按“不支持”走文字兜底；确认支持图片时可强制选「支持」；
- 商城表情仍可能取不到原图，但至少保留标签；
- p.qpic 依赖 uin/resId，缺失时不盲拼；
- 文字标签可能含对方可控内容，已 sanitize/限长；
- 没有真实 QQ 商城表情 live 测试；用单测/静态覆盖。

## 5. 验证

```text
node scripts/test-media-fallback.mjs
node scripts/test-media-search.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
