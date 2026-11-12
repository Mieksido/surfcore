# 权限清单（谁可以做什么）

> 2026-10-29 用户要求：把「管理员/主人」拆成**权限身份**、**关系**、**称呼**三件事；
> 权限必须由程序按真实发送者判定，提示词只负责表达，不负责授权。
> 本文是程序级权限的唯一清单；新增 owner-only 行为必须在这里登记 + 配测试。

## 一、身份判定（唯一可信来源）

| 项 | 规则 | 代码 |
| --- | --- | --- |
| QQ 主人 | 入站 `senderId === config.json` 的 `admin.qq` / `ownerQQ` | `src/bridge.js` 入站 `isOwner` |
| B站 主人 | `bili.config.json` 的 `owner.mid` | B站 工具链 / 调度器 |
| 控制台 | `x-console-token`（timingSafeEqual） | `src/bridge.js` 控制台鉴权 |
| 设置页 | DSH 会话 Cookie + `connection.requestRejection` | `plugins/surfcore/lib/index.js` |
| 智能体 | `x-console-token` + `x-agent-call:1` + `x-agent-token`（会话绑定） | `src/bridge.js` 集中关卡 |

**原则**：聊天内容、昵称、群名片、模型自称、`[仅主人]` 标记，都**不是**身份凭证。

## 二、程序级权限清单

| # | 能力 | 判定 | 代码位置 | 审计事件 | 测试 |
| --- | --- | --- | --- | --- | --- |
| 1 | 审批 AI 工具调用 | 仅 `isOwner`；消费与回执双重检查 | `bridge.js` 消费点 + `handlePendingAnswer` | `approval.answer` | 待补程序断言 |
| 2 | 回答 AI 提问 | 普通提问任何人；`[仅主人]` 提问仅主人（标记只收窄） | `question-answers.js` + 消费点 | `question.answer` | `test-question-answers` |
| 3 | 聊天 `/role` 切换角色 | 仅 `isOwner`（桥接直接执行，不过模型） | 入站管理命令分支 | `role.switch` | 待补程序断言 |
| 4 | 封闭模式（closed-agent） | 仅 owner 私聊 | `modeAllowed` | `closed-agent.access` | 待补程序断言 |
| 5 | 语音触发 | owner（或配置的成员名单） | `voiceTriggerBlock` | `voice.trigger` | 待补程序断言 |
| 6 | 鱼群保护 bypass | 仅 `isOwner` | `evaluateConversationFishGuard` | `fish.bypass` | 待补程序断言 |
| 7 | 记忆卡容量告警 | 只私聊 `ownerQQ` | `/api/memory-card/notify` | `memory.alert` | 待补程序断言 |
| 8 | 控制台/管理 HTTP | console token；agent token 白名单/黑名单 | 请求集中关卡 | — | `test-audit-security*` |
| 9 | 配置 / 人格卡 / 白名单写入 | 设置页 DSH Cookie / 控制台令牌；**AI 无入口** | 插件 `/config`、`/persona`；桥接管理路由 | — | 现有契约测试 |

> “待补程序断言”表示目前只有人工/间接覆盖，尚未钉成独立测试；不改变现有权限行为。

## 三、关系与称呼（不参与授权）

- **关系**：`admin` 配置（默认 owner）+ 可选平台覆盖；角色卡决定“怎么表达”，不能凭文字授予权限。
- **称呼**：`displayName` → 人格卡 `称呼：` → 平台昵称 → 中性“你”；**永不以“管理员/主人”作称呼**。
- **权限标签**：只出现在必要的权限说明与审计里，不作为称呼，也不进系统指令层。

## 四、变更检查单

1. 新能力是否只在程序里判定？有没有把判断交给模型/文本？
2. 失败时是 fail-open 还是 fail-closed？安全相关必须 closed。
3. 是否登记审计事件（谁、凭什么、结果）？
4. 是否补了程序级测试（不只是提示词快照）？
5. 提示词有没有把“权限”写成“称呼”或“更高优先级的指令”？
