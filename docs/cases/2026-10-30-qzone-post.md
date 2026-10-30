# 新功能：QQ 空间说说发布（默认关闭，仅管理员私聊可调用）

## 需求

用户原话：**「帮我写一个功能，让 surfcore QQ 机器人支持发送 QQ 空间动态，默认关闭状态。
我打算你做完后我让我的 AI 机器人使用，使用稳定后再提交功能 PR。不知道 SnowLuma v2.2.1 是否支持。」**

## 能力确认（先查再写）

- SnowLuma v2.2.1 **支持**。它的 OneBot 扩展动作是 `send_qzone_msg`：
  - 参数：`content`（必填）、`images`（可选，`file://` / `http(s)://` / `base64://`，自动上传）、
    `ugc_right`（1=所有人 / 4=好友 / 16=部分可见 / 64=仅自己 / 128=部分不可见，默认 1）、
    `target_uins`（16/128 时必填）；
  - 返回：`{ tid, time }`；
  - 同族还有 `get_qzone_msg_list` / `get_qzone_feeds` / `comment_qzone` / `like_qzone` / `delete_qzone_msg` / `set_qzone_msg_right`。
- 仓库里的 `_snowluma-catalog.json` 已经收录这些动作（`send_qzone_msg` 在第 1181 行附近）。
- 真机只读验证：`POST http://127.0.0.1:3002/get_qzone_msg_list {"num":1}` →
  `{"status":"ok","retcode":0,"data":{"total":3,...}}`，说明 HTTP API 这条链路可用（没有发任何东西）。

## 设计：为什么默认关、为什么只给管理员私聊

发说说和发群消息不是一个量级的风险——**对外公开、发出去收不回**，还可能把本机路径/凭据带上公网。
所以四道闸，任何一道不过都不发：

1. **总开关** `qzone.enabled` 默认 `false`；
2. **调用主体**：桥接只认 `key === private:<管理员QQ>` 的会话（群里的 AI 不能替主人往公开空间发东西）；
3. **内容**：非空、字数上限（默认 500）、`SENSITIVE_RE` 命中本机路径/凭据直接拒；
4. **频率**：每天最多 2 条、两条至少隔 6 小时（`state/qzone.json` 落盘，重启不重置）。

其它默认值都往保守走：只发文字（`allowImages=false`）、好友可见（`ugcRight=4`）、
不允许 `file://` 本机图片（`allowLocalImages=false`，等于禁止把本机文件传到公网）。
另给一个 `dryRun` 演练模式：只返回将要发布的内容，不真发。

权限（`ugc_right` / `target_uins`）**只从配置读**，不让模型自己传——否则它可以把「仅自己可见」
改成「所有人可见」。模型只能决定「说什么」，不能决定「给谁看」。

## 链路

```
QQ 私聊管理员
  → 桥接唤醒 AI（reserved2）
  → MCP 工具 qq_post_qzone({key, token, content, images?})
  → 桥接 POST /api/socialV2/qzone
      ① key 必须是 private:<ownerQQ>（否则 QZONE_OWNER_ONLY）
      ② agent token 绑定该会话（否则 QZONE_BAD_TOKEN）
      ③ socialV2.tools.postQzone 未关（否则 QZONE_TOOL_OFF）
      ④ src/qzone-post.js: validateQzonePost（开关/字数/敏感/图片/权限/每日/间隔）
      ⑤ snowluma.httpUrl + accessToken → send_qzone_msg
      ⑥ 成功写 state/qzone.json（at/tid/time/chars/images/ugcRight）
  → 返回 { ok, tid, time, posted, status }
```

只读入口 `GET /api/socialV2/qzone`：返回开关、今日已发/上限、上次时间、还要等多久；
`?probe=1` 会顺手 `get_qzone_msg_list` 读 1 条，用来确认 SnowLuma 这条链路通（只读，不发）。

## 失败必须可见（仓库刚性要求）

所有拒绝都带 `{ ok:false, code, error, hint }`，MCP 侧把 `hint` 一起回给模型，例如：

| code | 用户/模型看到什么 |
| --- | --- |
| `QZONE_DISABLED` | 「QQ 空间说说未启用（默认关闭）」+ 去哪打开 |
| `QZONE_OWNER_ONLY` | 「只允许管理员私聊会话调用」+ key 应该是什么 |
| `QZONE_SENSITIVE` | 「内容里有本机路径或凭据特征，已阻止发布」 |
| `QZONE_DAILY_LIMIT` | 「今天已经发过 2 条（上限 2）」 |
| `QZONE_TOO_SOON` | 「距离上一条还不满 360 分钟（还要等约 N 分钟）」 |
| `QZONE_UPSTREAM` | SnowLuma 的 wording + 「看 SnowLuma 控制台与桥接日志」 |

## 上线当天踩的坑（写下来防再犯）

- **开关打开了，桥接仍报 `enabled:false`**：`src/bridge.js` 的 `loadConfig()` 是**白名单式重建**——
  只把认识的顶层段抄进 `cfg`，新加的 `qzone` 段没写进去就永远读不到。
  修法：在 `loadConfig` 里显式 `qzone: file.qzone ?? {}`，并在 `test-qzone-post.mjs` 里加静态断言
  （`bridge.includes('qzone: file.qzone')`）。以后再加顶层配置段，记得同步这一处。
- **工具没出现**：`qq_post_qzone` 是 MCP 工具，注册发生在 **MCP 进程启动时**（DSH spawn），
  和「重启桥接」是两回事。改完开关必须 **重启 DSH**；只看桥接日志/接口会误判成"功能没生效"。

## 第二批：只读 / 互动 / 轮询（2026-10-30 追加）

用户问「还有没有别的工具要补」，并选了全部四块。SnowLuma 一共 26 个空间动作，第二批补了 6 个工具 + 1 个轮询器：

| 类型 | 工具 | 说明 |
| --- | --- | --- |
| 只读 | `qq_qzone_posts` | 说说列表（tid / 正文 / 时间 / 评论数 / 是否私密） |
| 只读 | `qq_qzone_post` | 单条说说 + 评论 + 楼中楼 |
| 只读 | `qq_qzone_feeds` | 好友动态（游标翻页） |
| 只读 | `qq_qzone_profile` | 空间名称和说明 |
| 互动 | `qq_qzone_like` | 点赞 / 取消赞（默认关，独立开关） |
| 互动 | `qq_qzone_comment` | 评论 / 楼中楼回复（默认关，独立开关） |
| 自动 | 轮询器（无新工具） | 新评论/@、主人发新说说 → 唤醒 AI；**桥接不替 AI 发** |

设计要点：

- **互动是独立开关** `qzone.interact.enabled`（默认 false）。评论会出现在别人空间里，比发自己的说说更需要克制。
- **评论范围默认 `owner-and-mine`**：只允许评论主人或自己的说说；想评论陌生人必须显式改成 `any`（不建议）。
- 频率：点赞 ≤20/天、评论 ≤5/天、两条评论 ≥2 分钟；同一条主人的说说不能重复发顶层评论（回复不受限）。
- **轮询没有推送可用**：SnowLuma 只有 `get_qzone_msg_list` / `get_qzone_msg_detail` / `get_qzone_feeds` 这类拉取接口，
  没有 unread / notice / mention，WebSocket 也不推空间事件。所以只能定时拉（默认 10 分钟）。
- **首轮只建水位**：第一次成功轮询只记录"当前已有哪些评论/说说"，不唤醒——避免刚打开就对着三天前的评论回一句。
- **唤醒只负责通知**：`qzone` 唤醒提示里列出事件（谁评论了什么、主人发了什么），发不发、回不回由 AI 自己调工具决定。
  主人新说说默认 `suggest` 模式（先私聊问主人），`direct` 才允许直接评论。
- 每日唤醒上限 `qzone.watch.maxWakesPerDay` 默认 6；`state/qzone.json` 记录已见 comment_id / 已见主人 tid，重启不重复。

第二批次踩的坑：

- **`agentTokenOk` 的作用域**：它是 `startConsoleServer()` 里的 `const`，我在外面写了一个
  `qzoneAgentGuard()` 去用它 → 请求时直接 500「agentTokenOk is not defined」。
  修法：把 guard 挪进 `startConsoleServer()` 内、紧挨 `agentTokenOk` 定义，并加注释说明为什么不能挪出去。

## 生效与重启

- 桥接 `src/bridge.js` / `src/qzone-post.js`：**重启桥接**（只读配置在启动时加载）；
- MCP 工具（`qq_post_qzone` / `qq_qzone_status` / 四个只读 / 两个互动）：只在对应开关为 true 时注册，
  改开关后要 **重启 DSH**（MCP 进程随 DSH 起）；
- 设置页字段在 QQ → 高级 →「QQ 空间（说说）/（互动）/（轮询）」，保存后同样按上面的顺序生效。

## 验证

- `node scripts/test-qzone-post.mjs`：默认关闭、坏值归一化、空/超长/敏感、图片协议与数量、
  16/128 名单、每日上限、最小间隔、状态摘要、SnowLuma 参数组装、**互动范围/频率/楼中楼参数、轮询事件文案**、接线断言。
- `scripts/test-audit-bridge.mjs`：端点守卫（默认关闭 / 只认管理员私聊 / 演练不调上游 / 互动独立开关 / 陌生人评论被范围拦下）。
- 真机只读：`GET /api/socialV2/qzone?probe=1` 返回 `probe.ok=true` 且 `total` 与空间实际条数一致。
- 真机发布（用户手测）：打开开关 → 重启桥接 + DSH → 私聊让 AI 发一条 → 空间出现 → `state/qzone.json` 有记录。
- 没验证到的部分：带图上传（`images`）没有在真机跑过；`ugc_right=16/128` 的名单语义未实测；
  真机上「别人评论我的说说 → 轮询 → 唤醒 → 回复」整条链路还没跑过。

## 遗留 / 后续

- 带图只做了参数与协议校验，真机上传路径未验证（`file://` 还需要 `allowLocalImages`）。
- 没有做「发完回一条 QQ 通知」：目前靠工具返回值；如果用户想要，可以再加。
- `delete_qzone_msg` / `set_qzone_msg_right` / `set_qzone_ban` 和「空友爱看」公开推荐流没有暴露——
  删除/改权限不可逆，公开推荐流是陌生人社交，风险最高，等有明确需求再单独评估。
