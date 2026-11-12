# QQ 旧 42 个渠道工具 → 新架构落点（对账表）

> 目的：把"旧 MCP 里 42 个工具"逐个说清**落在哪 / 被谁取代 / 为什么不做**，
> 避免能力清单里永远挂着一个含糊的"剩余 26 个未搬"。
>
> 口径：**工具是渠道动作**。新架构里"她说话/发媒体/收尾"走**意图**（intent），
> 不经过工具面；只有"读数据 / 改渠道状态"才做成工具。所以不是所有旧工具都该 1:1 搬。

---

## 汇总

| 落点 | 数量 | 在哪 |
| --- | --- | --- |
| OneBot 原生动作 | 5 | `packs/qq/tools.js`（现 22 个动作，含群历史） |
| 桥接语义工具 | 18 | `packs/qq/bridge-tools.js`（读 16 / 写 2） |
| 由内核 intent 取代 | 12 | `kernel/expression/tools.js` + 包 `send()` |
| 明确缺口（不做/待定） | 7 | 见文末，每条写了理由 |

---

## 一、OneBot 原生动作（5）

| 旧工具 | 新落点 | 状态 |
| --- | --- | --- |
| `qq_status` | `get_login_info` + `get_status` | ✅ |
| `qq_list_groups` | `get_group_list` | ✅ |
| `qq_get_group_members` | `get_group_member_list` | ✅ |
| `qq_get_group_history` | `get_group_msg_history`（可选 messageSeq） | ✅ |
| `qq_send_poke` | `send_poke`（写；默认关） | ✅ |

> 这 5 个是 OneBot v11 的机械动作，不依赖桥接；网关由用户自备。

---

## 二、桥接语义工具（18）

| 旧工具 | 新落点 | 读写 |
| --- | --- | --- |
| `qq_get_message_images` | `qq_get_message_images`（GET /images/message；base64 → 字节 → 模型图片段） | 读 |
| `qq_get_sticker_image` | `qq_get_sticker_image`（GET /sticker-image；同上） | 读 |
| `qq_get_prompt` | `qq_get_prompt`（GET /prompt） | 读（网关可能顺带刷新表情缓存） |
| `qq_get_context_snapshot` | `qq_get_context_snapshot`（GET /snapshot） | 读 |
| `qq_read` | `qq_read`（GET /snapshot） | 读 |
| `qq_get_unread_messages` | `qq_get_unread_messages`（GET /unread） | 读 |
| `qq_get_recent_messages` | `qq_get_recent_messages`（GET /recent） | 读 |
| `qq_social_state` | `qq_social_state`（GET /state） | 读 |
| `qq_get_active_members` | `qq_get_active_members`（GET /active-members） | 读 |
| `qq_get_message_detail` | `qq_get_message_detail`（GET /message-detail） | 读 |
| `qq_get_forward_msg` | `qq_get_forward_msg`（GET /forward-message） | 读（图片只给文字标签） |
| `qq_get_my_recent_messages` | `qq_get_my_recent_messages`（GET /my-recent） | 读 |
| `qq_slang_query` | `qq_slang_query`（GET /slang/query） | 读 |
| `qq_list_stickers` | `qq_list_stickers`（POST /sticker-list；refresh 算写） | 读 / refresh 写 |
| `qq_list_voices` | `qq_list_voices`（GET /voices） | 读 |
| `qq_memory_query` | `qq_memory_query`（GET /memory） | 读 |
| `qq_mark_read` | `qq_mark_read`（POST /mark-read） | **写**（默认关） |
| `qq_wait_for_messages` | `qq_wait_for_messages`（POST /wait） | **写**（默认关） |

> 桥接工具的失败形状统一成 `{ok:false,error:{code,message,hint}}`；
> 令牌由包注入，不进工具参数、不进 URL、不进日志。

---

## 三、由内核 intent 取代（12）

| 旧工具 | 新做法 | 为什么不再做工具 |
| --- | --- | --- |
| `qq_send_message` | `say` 意图 → 包 `send()` | "说什么"是内核判断；发送是包的事 |
| `qq_send_group_message` | 同上（频道是群） | 同上 |
| `qq_send_private_message` | 同上（频道是私聊） | 同上 |
| `qq_reply` | `say` 意图 + `replyTo` | 引用是发送参数，不是工具 |
| `qq_reply_and_finish` | `say` + `close` 意图 | 收尾是内核判断 |
| `qq_send_burst` | `say` 意图（包负责拆条/节奏） | 拆条是包策略 |
| `qq_send_sticker` | `send_media` + 内核表情库挑图 | 挑哪张是"她的判断" |
| `qq_send_voice` | `say(voice)` → 内核语音闸门 → `send_media` | 用不用语音是内核判断 |
| `qq_close_conversation` | `close` 意图 | 收尾是内核判断 |
| `qq_collect_sticker` | `collect_sticker` 意图（媒体库编号 → 表情库） | 收藏是"她的东西" |
| `qq_slang_submit` | `learn_word` 意图 → 黑话候选 | 学词是内核记忆 |
| `qq_memory_append` | `remember` 意图 → 内核记忆唯一写入口 | 记忆只有一套，不能让通道旁路写 |

> 这些旧工具在新架构里**不是缺失**：它们的能力被 intent + 内核模块承接了。
> 如果模型需要"直接发一条"，它用 `say`，不需要知道渠道工具名。

---

## 四、明确缺口（7，逐条理由）

| 旧工具 | 旧用途 | 为什么现在不做 / 待定 |
| --- | --- | --- |
| `qq_get_self_image` | 看自己的 Q 版形象 | 形象图是壳/人设资产，不是渠道数据；应放界面层，不放进 QQ 模块 |
| `qq_report_feedback` | 向控制台反馈问题 | 诊断/运维属于工具/壳，不属于 QQ 渠道 |
| `qq_set_wake_config` | 改桥接的唤醒配置 | 新架构的唤醒由内核 attention 决定；桥接的 wakeConfig 是旧运行时概念，不搬 |
| `qq_set_sticker_remark` | 改 QQ 账号里的表情备注 | 写第三方账号数据；新架构只维护本地表情语义，不改账号 |
| `qq_memory_clear` | 清空桥接轻量记忆 | 新架构记忆只有内核一套，且有衰减/全量卡；通道不能旁路清空 |
| `qq_memory_remove` | 删一条桥接轻量记忆 | 同上；删除应走内核记忆策略，不是渠道工具 |
| `qq_sticker_note` | 给收藏表情写本地备注 | 内核表情库有 `note` 字段，但还没有"改备注"的 intent/工具；**可补**（低优先） |

---

## 五、结论

- **旧 42 个工具里，35 个已有落点或由 intent 承接**（5 OneBot + 18 桥接 + 12 intent）。
- **7 个明确缺口**：3 个属于壳/运维（自画像、反馈、账号备注）；
  3 个是旧桥接记忆/唤醒概念，设计上不搬；1 个（表情备注）可低优先补。
- 所以 `pack.qq` 的“剩余渠道工具”不再是“26 个没搬”，而是**7 个有理由的缺口**。
