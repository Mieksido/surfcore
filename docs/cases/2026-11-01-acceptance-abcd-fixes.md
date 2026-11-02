# 2026-11-01 · dev.7 验收 A–D 修复

## 背景

dev.7 验收确认「dev 通道自更新」已修复；同时报 4 个新问题：
A 外层 403 吞掉端点结构化错误、B 入站密钥原样落盘、C 目的历史 text 冻结、D 超时 code 空值共用静音键。

## 修法

| # | 改动 |
| --- | --- |
| A | 外层 agent-token 白名单放行 `/api/notify/owner`、`/api/notice/timeout`，由端点返回 `NOTIFY_CONSOLE_ONLY` / `TIMEOUT_NOTICE_CONSOLE_ONLY`（带 code+hint）；外层通用 403 也补 `CONSOLE_ONLY` + hint |
| B | `src/sensitive.js` 新增 `SECRET_TOKEN_RE`（github_pat/ghp/sk/AKIA/Bearer）；`log()`/活动/公共群消息/出站统一打码；入站检测到密钥写 L1 `SECRET_IN_INBOUND`（60 分钟/会话去重），记忆 inbox 存打码文本 |
| C | `purpose-engine`：只有 `sent` 才更新 `lastText`；`silent/failed` 清空并记 `skipReason`，历史/快照同步 |
| D | `/api/notice/timeout` 空 code → 400 `TIMEOUT_CODE_REQUIRED`（对齐 limit-mute），不再默认 `TIMEOUT` |

## 顺带发现并修的同类漏洞

- `appendPublicFeed()` 写群消息原文（同样可能含密钥）→ 落盘前 `redactSensitiveText`；
- 外层所有 console-only 端点的通用 403 现在都带 `code/hint`。

## 验证

- 新增 `test-acceptance-abcd`：密钥识别/不误伤（32-hex）、silent 历史不串文案、白名单/403/code 必填/公共 feed 打码；
- `npm run test:audit` 115/115；插件测试 0 失败。

## 残余风险（未修）

- `socialV2` 的 unread/会话状态、DSH 会话日志里仍可能保留原始密钥（聊天平台侧原文无法撤回）；
- 已有 `bridge.log` / `state/` 历史文件里的旧密钥不会自动清除；**必须让用户作废该 PAT**；
- `lastEmotion/lastPurpose` 仍有“沿用上次”的语义（不影响 text 复盘，但同样可能重复）；
- 自定义外部调用方若不传 `code`，超时上报会 400（本项目内调用方都已带）。
