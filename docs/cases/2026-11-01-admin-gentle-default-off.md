# 管理员温柔模式：默认关闭 + 开启风险提示 + 关闭上下文取舍

- **日期**：2026-11-01
- **用户要求**：
  1. 新版本用户下载后默认不勾选“对管理员更温柔、绝不回嘴”；
  2. 用户勾选时必须弹窗提示全部风险；
  3. 已勾选用户取消勾选时，提供“是否丢弃上下文”的选择，并解释原因，可选否。

## 1. 现象与根因

旧实现：

- `normalizeAdmin` 缺省 `gentle:true`，新用户默认开启；
- 关闭后仍注入 `【管理员】管理员是 ...`，没有称呼规则，模型可能叫“管理员”；
- 只删当前提示词，旧会话历史里的“温柔/绝不回嘴”仍在；
- UI pill 永远写“对 TA 温柔 · 不回嘴”，关闭后自相矛盾。

## 2. 行为规则

### 默认关闭

```text
normalizeAdmin: gentle = source.gentle === true
adminFromSources: 缺省 false
store.DEFAULT_UNIFIED.admin.gentle: false
UI checkbox: checked = value.gentle === true
```

已有显式 `gentle:true` 的配置保持不变；缺省/旧配置按新默认关闭。

### 开启

必须先弹 `AdminGentleEnableModal`，列全部风险：

- 更温柔、先接情绪；
- 绝不回嘴，可能减少诚实纠错/边界提醒；
- 可能与人格卡、安全规则冲突；
- 模型行为只能引导，不能硬保证；
- 每次唤醒多一点上下文 token；
- 旧会话可能仍受历史规则影响，彻底清需重置；
- 管理员权限/审批/白名单不变。

取消则保持未勾选。

### 关闭

先弹 `AdminGentleDisableModal`：

- **只关闭，保留上下文**：不丢聊天记忆，旧语气可能残留；
- **关闭并丢弃上下文**：清空相关会话上下文；丢记忆，不可恢复；
- **取消**：不改变开关。

关闭后：

```text
adminPromptBlock() -> ''
adminMarker() -> ''
ownerMessageTag() -> ''
ownerLabel 不再含“管理员”
```

管理员权限、审批、白名单硬校验完全不变。

## 3. 会话历史为什么必须给选择

模型每轮读的是完整上下文，不是只看当前提示词。旧会话里的 `【管理员·温柔模式】绝不回嘴` 已经是历史 token；关掉当前注入不会删除历史。

因此：

- 保留上下文：只能保证“以后不再注入”，不能保证旧语气立刻消失；
- 丢弃上下文：QQ 会话 + 社交状态重置；B站 scheduler 换新 sessionId，新会话读不到旧历史。

## 4. 丢弃上下文的实现

- UI 选择“关闭并丢弃上下文” → `onAdminDiscardContext(true)`；
- 主保存函数发送：
  ```json
  { "resetSessions": true, "restartBridge": true }
  ```
- 插件 `handleConfig`：
  1. 保存配置；
  2. `stopAllBridgeSessions()` 重置 QQ 会话与社交状态；
  3. `resetBiliSchedulerSession()` 停 B站 调度器，`biliSessionEpoch=Date.now()`，用新 sessionId 重启；
  4. 自动重启 QQ 桥接，读新配置。
- 顺序必须 reset → restart；否则新会话会带旧 cfg 建出来。

## 5. 生效与重启

- QQ：保存后自动重启桥接（丢弃上下文时）；
- B站：立即换新会话；
- 只关闭不丢上下文：保存后需要手动重启桥接才影响 QQ 新提示；
- 旧会话：保留则旧语气可能残留；丢弃则清空。

## 6. 验证

```text
node scripts/test-admin-identity.mjs
node scripts/test-admin-prompt-wiring.mjs
node scripts/test-admin-gentle-ux.mjs
plugins/surfcore/scripts/test-admin-bili-prompt.mjs
plugins/surfcore/scripts/test-admin-config-api.mjs
npm run test:audit
```

预期：audit 112/112；插件测试 0 失败。

## 7. 风险

- 关闭后模型不再知道“管理员”身份，可能不再优先照顾管理员（权限仍硬校验）。
- 人格卡本身可能仍温柔；关闭只去掉“因管理员而温柔”。
- 丢弃上下文会丢当前聊天记忆，必须明确同意。
- B站旧 DSH session 文件仍在磁盘，但新 sessionId 不再读取；不会自动归档。
- 显式 `gentle:true` 的存量用户不会被强制关闭；新装/缺省才默认关。
- 提示词只能引导，不能保证模型绝不回嘴。

## 8. 回滚

- 代码回退本提交；
- 配置 `admin.gentle` 可手动改回 `true`；
- 已丢弃的 QQ 上下文不可恢复（设计如此）；
- B站旧 sessionId 仍存在，可手动改回配置恢复旧上下文（不提供 UI）。
