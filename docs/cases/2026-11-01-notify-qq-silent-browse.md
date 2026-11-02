# 通知通道 + 沉默逛 B 站 + 评论年龄闸门

日期：2026-11-01

## 1. 桌面通知 100% 失败

根因：`notify.mjs` 用 JS 的 `\\"` 生成 `.ps1`，落盘成 `\"`；PowerShell 不认反斜杠转义，字符串提前截断，报 `UnexpectedToken`。`stdio:'ignore'` 又吞掉了 stderr。

修法：

- 新增 `tools/lib/desktop-toast.mjs` 纯函数生成脚本；
- XML 用单引号拼接，标题/正文走 `[System.Security.SecurityElement]::Escape`；
- 不再写临时 XML；
- `execFileSync` 捕获 stderr，失败带最后 3 行 PowerShell 错误；
- 非 Windows 明确报 `DESKTOP_UNSUPPORTED`，不再假成功；
- 临时 `.ps1` 在 finally 清理。

验证：`node scripts/test-notify-channels.mjs`；PowerShell `Parser::ParseFile` 返回 `PS syntax OK`。

## 2. QQ 大肥鱼推送通道

新增 `notify.type = "qq"`：

```text
B站 日记/报备 → notify.mjs → 本机桥接 POST /api/notify/owner
→ 只私聊 cfg.ownerQQ
```

桥接端点约束：

- 只允许控制台令牌；带 `x-agent-token` 的 AI 调用直接 403 `NOTIFY_CONSOLE_ONLY`；
- 只发管理员本人，不接受任意收件人；
- 正文做已知 token 脱敏 + 敏感信息检查；
- 空正文/超长/未配置 owner 都有结构化 code + hint；
- 发送失败返回 `NOTIFY_SEND_FAILED` + “确认 SnowLuma/QQ 在线”。

设置页「推送方式」新增「QQ 私聊管理员」。

## 3. 沉默逛 B 站

新增 B站配置：

```json
"interact": {
  "enabled": false,
  "maxCommentAgeDays": 14
}
```

- `interact.enabled=false`：禁止评论、回复、搭话、动态、分享、私信、弹幕、给鱼点赞；
- 仍然允许：deps / feed / debrief / score / 日记 / 记忆；
- 设置页「互动与静默」有开关和评论年龄上限；
- 额度里的 `0` 仍然表示“不限量”，不改变旧语义；要沉默必须用新开关。

工具硬闸：

| 文件 | 拦截 |
|---|---|
| `comment.mjs` | `--go` 评论/回复/搭话 |
| `daily.mjs` | `--go` 动态 |
| `share-dynamic.mjs` | `--go` 分享 |
| `dm.mjs` | `--go` 私信 |
| `danmaku.mjs` | `send --go` 弹幕 |
| `dynamic.mjs` | `post --go` 动态 |
| `fish-guard.mjs` | `like` 真点赞 |

调度器：

- `wakePrompt` 在沉默模式输出“只读/评分/写日记”；
- `dynTick` / `listenTick` / `dmTick` / `liveTick` 直接返回；
- 不再要求“每轮至少发一条评论”。

## 4. 评论年龄闸门

`comment.mjs` 在明确有 parent/fish-gather target 时检查 `ctime`：

```text
ageDays > interact.maxCommentAgeDays
→ BILI_COMMENT_TOO_OLD
→ 年龄 / 上限 / 建议
→ exit 3
```

- 默认 14 天，`0 = 不限`（不推荐）；
- 时间未知不误杀；
- 鱼群聚拢自动 @ 之前先检查目标年龄，避免 @ 2023 年的人。

## 5. 闸门报错规范

新增 `tools/lib/interact.mjs`，统一输出：

```text
✗ [CODE] 原因
  建议：去哪改 / 怎么重试
```

### 超时“不再提示”

- 超时事件 `POST /api/notice/timeout` 进 L1 错误报告；
- 概览错误报告里点「永久不再显示」：
  - 超时事件写 `bili.config.json` 的 `notify.timeoutMutes`；
  - 同时写 `state/limit-mutes.json`，用于桥接内部去重/确认；
- `notify.mjs` 和桥接后续会读 `notify.timeoutMutes`，不再生成同一 code 的超时提醒；
- 同一 code/source 1 小时最多一条，避免刷屏；
- 错误仍会写日志/非零退出，不会把真实失败伪装成成功。

| code | 场景 | 用户下一步 |
|---|---|---|
| `BILI_INTERACT_DISABLED` | 沉默逛开启时尝试发评论/动态等 | 去 B站 → 互动与静默打开“正常互动” |
| `BILI_COMMENT_TOO_OLD` | 目标评论超过年龄上限 | 调大年龄上限，或换新评论 |
| `DESKTOP_UNSUPPORTED` | 非 Windows 选桌面通知 | 改 Webhook / QQ / 命令 |
| `DESKTOP_TOAST_FAILED` | PowerShell 脚本/系统失败 | 看 stderr 摘要；改通知方式或修系统 |
| `QQ_NOTIFY_NO_OWNER` | 未配置 ownerQQ | 设置管理员 QQ |
| `QQ_NOTIFY_NO_TOKEN` | 缺控制台令牌 | 重启桥接/检查 config |
| `QQ_NOTIFY_UNREACHABLE` | 桥接没开/端口不对 | 先启动 QQ 桥接 |
| `QQ_NOTIFY_TIMEOUT` | 15 秒无响应 | 检查 SnowLuma/QQ 在线；可永久静音 |
| `NOTIFY_CONSOLE_ONLY` | AI 调用管理员通知 | 只能控制台调用；AI 不允许 |
| `NOTIFY_SENSITIVE` | 日记含路径/令牌 | 去掉敏感内容再推 |
| `NOTIFY_SEND_FAILED` | 桥接发送失败 | 检查 QQ 在线/拉黑/桥接 |

原则：不静默、不假装成功、非零退出、带 hint。

## 6. 生效

- 桌面/QQ 通知：保存后直接测试；桥接改动需重启 QQ 桥接；
- 沉默逛/年龄：保存后下一轮 tick 生效，不用重启 DSH；
- 设置 UI：刷新浏览器/重启 DSH。

## 7. 风险

- QQ 通知依赖桥接，桥接没开时只能报错，不能送达；
- 沉默逛只阻断工具写操作；模型仍可能读/评分/写日记，token 还会消耗；
- 年龄上限只对明确 parent/fish target 生效；模型自写 @ 仍可能发生（没有 target 时间）；
- `0 = 不限量` 保持旧语义，用户仍可能误以为 0 是关闭；
- B站 gate 错误目前主要回到 agent/工具输出，尚未进概览「错误报告」；
- 桌面通知只 Windows；Linux/macOS 明确失败；
- QQ 通知可能重复（B站报备 + 日记推送），后续可加去重。
