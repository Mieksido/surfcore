# 2026-10-29 · 提问回答没有身份来源 + 主人特权操作不可审计

## 现象

- 用户在设计「管理员/主人/称呼/语义污染」时提出：AI 的提问被群友回答后，模型不知道回答者是谁，
  可能把群友的话当成主人确认；主人特权操作（审批、角色切换、语音、封闭模式等）也没有独立审计。
- 现状核实：审批是 owner-only；配置/人格卡 AI 写不了；但 **question 分支不读 `isOwner`、不记录回答者**，
  回答原样回给 DSH；`[仅主人]` 分类标记不存在；审计只有记忆维护的 `audit.jsonl`（2MB 原地裁剪，会丢历史）。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows / DSH 0.2.1-rc.2 |
| SurfCore 版本 | 0.6.22 工作区（本改动未发版） |
| 安装方式 | git 工作区（插件跑在 DSH 宿主，桥接独立进程） |
| 其它 | DSH `ask_user_question` 的 `header` 由模型填写；单选答案不允许 `selected + custom` 并存 |

## 根因

- `handlePendingAnswer` 的 question 分支（`src/bridge.js`）只用文本回答，**没有把 `isOwner` 传下去**，
  也不记录 sender；模型收到的只有答案文本。
- DSH question 帧的 `header` 被桥接丢弃（`14647-14669` 只读 question/options），因此无法区分“这个问题该谁答”。
- **DSH 硬约束**：单选题的答案项 `selected` 与 `custom` 只能二选一（`dsh-host-apiproxy/lib/index.js:1316-1318`，
  README.zh.md:25 同义），所以“selected 保持原样 + custom 加来源”对单选题会被判 `bad-response`。
- 审计没有独立结构；`~/.dsh/surfcore/audit.jsonl` 的 2MB 原地裁剪会丢旧记录，不能当特权审计。

## 完整逻辑（给用户看的那一遍）

- **链路**：DSH `question/requested` → 桥接 `registerPending`（新增 `ownerOnly`）→ 入站消息消费点
  `canConsumePending` → `buildQuestionAnswers`（按题型编码 + 程序填来源）→ `api.respond` → 模型看到 answers。
- **机制**：回答者身份只来自 `senderId === ownerQQ`（`bridge.js` 入站判定），不读文本/昵称；
  `[仅主人]` 是模型写的 header，只用于**收窄**谁能回答，不是凭证；单选/多选的编码差异由 DSH 校验决定。
  实际授权（审批、角色切换、封闭模式、语音等）仍在程序里，question 回答只影响模型上下文。
- **爆炸半径**：1 写者（桥接）；读者是 DSH 会话里的模型与插件 UI；失败形态：回答来源错标（静默）或
  审计丢失（静默）→ 按 12 课属于“静默=3”一类，配套了失败分支测试与 health 暴露。
- **取舍**：单选来源编码选 A（custom-only，选项文字嵌入）；B（不带来源）会让本轮模型不知道谁答，
  违背目标；C（follow-up prompt）改变时序、多一次唤醒，不选。
- **生效与重启**：`src/*.js`（question-answers/owner-audit/bridge）→ 重启桥接；`lib/*.js`（插件）
  + preset → 重建 bundle / patch 后重启 DSH。

## 修法

- 新增 `src/question-answers.js`：`isOwnerOnlyFrame` / `canConsumePending` / `responderNote` / `buildQuestionAnswers`。
- `src/bridge.js`：`registerPending` 记录 `ownerOnly`；消费点改为 `canConsumePending`（owner-only 提问 + 非主人
  不消费、不吞消息、继续群聊）；`handlePendingAnswer` 传 sender、按题型生成 answers、写审计。
- 新增 `src/owner-audit.js`：`state/owner-audit.jsonl`，1MB×5 轮转、90 天清理、跨文件读尾、写入/轮转/清理失败
  记录 health + 限频日志（不静默、不阻塞、不截断已有审计）。
- `src/bridge.js`：接入 7 类审计（approval.answer / question.answer / role.switch / closed-agent.access /
  voice.trigger / fish.bypass / memory.alert）；新增 `GET /api/owner-audit`（console token；agent token 显式 403）；
  `/api/status` 暴露 `ownerAudit.health`。
- 插件 `lib/index.js`：`/owner-audit` 代理 + `/owner-audit/open`（固定 `state/` 路径，无用户输入）。
- 插件 `lib/client.js`：管理员卡片新增「管理操作记录（最近 50 条）」弹窗（操作者打码、授权/结果/关联 ID）。
- preset `qq-chat-v2`：新增第 17 条「提问分类」规则（`[仅主人]` 只是分类，不是凭证）。

## 验证

- `node scripts/test-question-answers.mjs`：单选 custom-only、多选 selected+custom、来源标注、owner-only 判定。
- `node scripts/test-owner-audit.mjs`：结构字段、轮转/跨文件读尾、写入失败可见、90 天清理。
- `npm run test:audit` → **80/80**（新增 2 条）。
- `cd plugins/surfcore && npm test` → 全绿；`npm run test:regressions` → 全绿。
- **失败路径**：单选命中时 `selected` 必为空（否则 DSH 拒收）；owner-only + 非主人 → 不消费 pending；
  审计写入失败 → `health.writable=false` + 日志；弹窗显示“审计写入异常”。
- 没验证：真实 DSH 问答往返（需要一次群聊/私聊提问；schema 约束已由 DSH 源码确认）；设置页弹窗手点；
  preset 尚未安装到 DSH profile / 重启验证。

## 遗留 / 后续

- `docs/guides/PERMISSIONS.md` 的 7 项权限逐项程序测试还有几项是“已有/待补”状态；下一步补齐。
- 单选题回看 UI 会显示 custom 文本而不是高亮选项（DSH 约束的代价），已写入文档。
- 旧会话里的“管理员”历史不回溯；新会话自然干净。
