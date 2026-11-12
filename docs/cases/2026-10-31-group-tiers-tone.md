# 群分层 + 人格语气 / 智能拆分

- **日期**：2026-10-31
- **背景**：上一轮把 `question` 全局收紧，方向错了：小群朋友群也被误伤。这轮把唤醒和人格都改成“按群分层”，并把人格卡拆出独立语气层。
- **范围**：群分层设置、语气层、`qq_get_prompt` 模式、载入人格卡后的模型智能拆分。工具合并/快照是下一批，不在本 case。

## 1. 链路

```text
QQ 群消息
  → bridge.handleIncoming
  → ensureGroupMeta(groupId)  // OneBot get_group_info，缓存 10 分钟
  → groupProfile(key, st)
       成员数 + 近10分钟消息数 + 用户覆盖
  → evaluateWakeTriggerV2
       小群：原积极策略
       大群：跳过 question/keyword/probability/anyMessage
  → sendWakePromptV2
       小群：原 direct 绕过
       大群：严格 direct（@/名字/拍一拍/私聊/管理员/引用自己）
  → 模型调用 qq_get_prompt
       群聊默认 tone：人格语气 + 场景 + 日常
       private 默认 full：核心 + 语气 + 场景 + 日常
       mode=full 可显式请求核心
```

设置页：

```text
QQ 页 → 群分层
  GET  /dsh-surfcore/api/group-policy
  POST /dsh-surfcore/api/group-policy
  → 插件代理 bridge /api/socialV2/group-policy
  → state/group-policy.json
```

人格：

```text
角色页 → 人格核心 / 人格语气 / 人格日常 / 场景人格
  /dsh-surfcore/api/persona
    GET layers.tone
    POST layer=tone → persona.tone.md
  /dsh-surfcore/api/persona/classify
    → 一次低强度模型调用
    → 返回 core/tone/daily/scenes 草稿
    → 前端填进编辑器，用户检查/编辑/逐层保存
```

## 2. 机制

### 群分层

- `largeThreshold` 默认 200 人；
- `activeMessageThreshold` 默认 60 条 / 10 分钟；
- 手动覆盖 `auto/small/large` 永远优先；
- 未知群默认小群，不误伤；
- 大群只跳过 `question/keyword/probability/anyMessage`，仍保留 `atMention/nameMention/poke/speaker`。

### 语气模式

- `personaMode=tone`：语气 + 场景 + 日常，不加载核心；
- `personaMode=full`：核心 + 语气 + 场景 + 日常；
- 旧角色没有语气、也没有场景/日常时，回退核心，避免“没卡”；
- 群聊 `qq_get_prompt` 默认 tone；私聊默认 full；可显式 `mode=full`。

### 智能拆分

- 只返回草稿，不写盘；
- 模型不可用/JSON 坏/输入空都返回 `ok:false + code + hint`；
- 前端把草稿填进四层编辑器，用户确认后逐层保存。

## 3. 爆炸半径

- **进程**：bridge（群策略/提示词）、DSH 插件（设置页/拆分接口）；
- **读者**：QQ 唤醒、`qq_get_prompt`、角色页、设置页；
- **用户数据**：`state/group-policy.json`（新文件）、`persona.tone.md`（新文件）；
- **花钱**：智能拆分一次模型调用；群策略会减少大群唤醒；
- **静默风险**：群成员数 API 失败 → 默认小群（不会误杀，但大群可能不够严）；设置页显示“未知”。

## 4. 取舍

- **不做全局收紧**：小群保留积极策略，避免朋友群被误伤；
- **不做纯人数硬切**：加高活跃阈值，避免小群突然刷屏；
- **不自动写人格文件**：拆分只出草稿，用户逐层确认，避免模型改坏人设；
- **不一次上快照工具**：先保证群/人格正确，再合并工具，避免同时改太多变量。

## 5. 生效与重启

| 改动 | 谁读 | 重启 |
| --- | --- | --- |
| `src/group-policy.js`、`src/bridge.js` | bridge | **重启 QQ 桥接** |
| `state/group-policy.json` | bridge 每次读取（mtime 缓存） | 下一条消息生效，无需重启 |
| `persona.tone.md` | bridge `qq_get_prompt` | 下一条消息生效 |
| `plugins/surfcore/lib/*` 设置页/拆分接口 | DSH 插件 | **重启 DSH** |
| `qq_get_prompt` 工具 schema | MCP 进程/DSH | **重启 DSH** |

## 6. 验证

```bash
node scripts/test-group-policy.mjs
node scripts/test-persona-layers.mjs
node scripts/test-persona-classify.mjs
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit
```

预期：群分层、小群积极/大群严格、tone 不加载核心、拆分失败 code/hint 非空。

手工：

1. 设置页 QQ → 群分层：能看到群名/人数/近10分钟/自动判定；可强制小群/大群；保存后刷新仍在。
2. 角色页：能看到「人格语气」页；保存后 `persona.tone.md` 存在。
3. 载入完整人格卡，点「智能拆分当前人格」：四层出现草稿；可编辑、逐层保存。
4. 群聊 `qq_get_prompt` 默认 `role.mode=tone`；传 `mode=full` 返回核心。

## 7. 回滚与残余

- 群分层：删除 `state/group-policy.json` 或设置页全部“自动”，即回默认小群积极；
- 语气：把 `persona.tone.md` 清空，tone 模式回退场景/日常/核心；
- 智能拆分：不调用即可；没有自动写盘；
- 残余：群列表只显示 bridge 已见过的群；工具合并（`qq_get_context_snapshot`）与 brief/detail 仍是下一批。

## 8. 2026-10-31 用户反馈后的修正

- 设置页群分层从 QQ 页底部移到顶部，避免“找不到”；
- 人格页取消 tab 分栏，改成**一页四层**：核心/语气/日常/场景同时可见；
- 保存改为「保存全部」，逐层失败会在页面红字列出，不再静默；
- 拆分只生成**预览草稿**，必须显式「应用到编辑区（不保存）」；空白建议保留原文，不会清空；
- **身份底座**：无论 tone/full/日常，都自动带「你是谁、主人是谁」，不再只靠核心；
- 群分层面板加警示：人数过多/过于活跃会大大加快 Token 消耗，谨慎设置；
- 场景说明明确包含 QQ 群聊、QQ 私聊、B站、桌宠等平台，并加警告：不保证跨平台隐私完全隔离，请谨慎填写，出了事不负责。

## 9. 拆分失败修正（2026-10-31）

- 模型第一次输出不是 JSON 时，自动用“只输出 JSON”重试一次；
- 失败错误带输出前 180 字，便于判断是模型拒绝、截断还是格式跑偏；
- 不再只说“模型没有返回 JSON”。

## 10. 日常层身份副本

用户要求：**角色是谁、主人是谁，除了身份底座，还要多拆一份写进日常层。**

- 插件在拆分结果、日常 GET、日常 POST 三处统一调用 `withDailyIdentity`；
- 日常层保存时自动以“你是X；你的主人是Y。”开头；
- 已有明确“我是谁/主人是谁”的旧日常不重复堆；
- 身份仍由 `personaIdentityLine` 从当前角色 + 管理员称呼派生；
- 这样即使 tone 模式不加载核心，日常层本身也有身份副本。
