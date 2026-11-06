# 主人私聊可读白名单群记忆（私聊仍不进群）

日期：2026-11-03

## 现象 / 需求

- 鱼在群里记得的事，一到私聊就像没发生过：私聊记忆块只含“这个私聊自己的记录”。
- 用户希望：
  1. **主人私聊**能想起所有 QQ 白名单群里的事；
  2. 私聊里的事**永远不进群**；
  3. 指定的几个群之间继续互通。

## 现状（改前）

- 群间互通已经存在：`memoryCard.sharing.circles`，默认关闭，同圈互看、不嵌套、不传递。
- 私聊默认只看自己：`visibleFor()` 的 `currentPrivate` 分支只放行 `recordIsPrivate()` 且 `conversationKey === current` 的记录。
- 两个遗留问题：
  - 没有 `conversationKey` 的旧私聊记录会出现在**所有**私聊块里（真实卡里 13 条，来源是主人私聊）；
  - 37 条 `qq-owner` 旧记录没有 key，按旧逻辑不会进任何按会话块。
- 私聊注入预算 `injectMaxChars.qq = 2200`；5 个群块合计约 10,400 字，直接全塞会把私聊自己的记忆挤掉。

## 目标语义

- 默认关闭；开启后**只对 `private:<ownerQQ>`** 生效。
- 只读当前 QQ 白名单群（`allow.groups`），排除 `deny.groups`；可在设置页再收窄到几个群。
- 群记忆单独成节「群里的近况（仅主人私聊可见）」，有自己的条数/字数预算，**不挤占**私聊主块。
- 私聊记录仍然不进群；非主人私聊仍然只看自己；桌宠/B站记忆不混入。
- 无 `conversationKey` 的旧私聊记录只给主人私聊看。

## 修法

### 1. 核心引擎 `src/memory-card.js`

- `sharing` 新增：
  - `privateReadsGroups`（默认 false）
  - `privateGroupIds`（留空 = 跟随 QQ 白名单）
  - `privateGroupLimit`（默认 8 条）
  - `privateGroupChars`（默认 700 字，独立预算）
- `normalizeMemorySharing()` 收敛这些字段（坏值回默认，条数 1~30，字数 200~2000）。
- `visibleFor(..., runtimeSharing)`：
  - 运行时注入 `ownerPrivateKey` / `privateAllowedGroups` / `privateDeniedGroups` / `allowAllWhenEmpty`；
  - 私聊分支：自己的私聊记录照旧；无 key 私聊只给主人；主人私聊且开关开启时，才放行白名单群记录；
  - 白名单为空且 `allowAllWhenEmpty !== true` 时 **fail closed**。
- `sectionize()`：
  - 主人私聊的群记录优先收进 `privateGroup`，**先于** firstMet/anchors/recent 占位，避免置顶群记录挤掉私聊自己的记忆；
  - 私聊主块预算照旧，群近况在渲染后单独追加，插在 footer 之前。
- `saveMemoryCardOutputs(..., runtimeSharing)`：
  - 按会话生成 `memory-card-prompt-qq-groups.json` 时传入运行时边界；
  - 即使主人私聊还没有记录，也生成 `private:<ownerQQ>` 块。
- `maintainMemoryCard(..., runtimeSharing)`：维护时把运行时边界传到写盘。

### 2. 插件 `plugins/surfcore/lib/memory-card.js`

- 新增 `memoryCardRuntimeSharing()`：从 **QQ `config.json`** 读 `ownerQQ` / `allow.groups` / `deny.groups` / `allowAllWhenEmpty`，不写回 unified config。
- 维护、压缩、置顶/忘记/手动记录、恢复备份都传入这份运行时边界，避免操作一次就把群块渲染丢。

### 3. 设置页 `plugins/surfcore/lib/client.js`

记忆页「记忆互通圈」新增：

- 开关「主人私聊可读群记忆」；
- 开启后显示「可读群号」（留空 = 所有 QQ 白名单群）；
- 「最多显示群记忆」条数（1~30）；
- 「群记忆字数」独立预算（200~2000）。

### 4. 测试

- `scripts/test-memory-sharing.mjs`：
  - 默认私聊不看群；
  - 开启后主人私聊看白名单群，非主人私聊不看；
  - 黑名单群、可读群号过滤、白名单为空 fail closed；
  - 无 key 旧私聊只给主人；
  - 群记忆不能把私聊自己的记忆挤出预算；
  - 写入的分会话 map 与内存渲染一致。
- `scripts/test-memory-card-wiring.mjs`：钉住核心/插件/设置页三处接线。

## 验证

```text
node scripts/test-memory-sharing.mjs
node scripts/test-memory-card-wiring.mjs
node scripts/test-memory-card.mjs
node scripts/test-callname.mjs
node scripts/test-console-static.mjs
npm run test:audit
cd plugins/surfcore && npm test
node scripts/release-manifest.mjs --verify-ref HEAD
```

真实卡对比（只读）：

- 默认主人私聊块 2,190 字；开启后主块仍 2,190 字，另加约 700 字的「群里的近况」，私聊自己的记忆没有被挤掉。
- 非主人私聊（`private:336...`）仍然只有 399 字，无「群里的近况」。

## 风险 / 回滚

- **默认关闭**：不开启时行为与 0.8.8 一致；开启只影响主人私聊。
- **非主人私聊**：代码用 `ownerPrivateKey` 硬边界；不会把群记忆给其他私聊。
- **社会隐私**：群友的话被主人私聊看到，这是受众变化；需要用户显式开启，建议按群收窄。
- **预算**：群近况独立预算，默认 700 字；调大仍会增加 token。
- **旧记录**：无 key 私聊只给主人；37 条无 key owner 记录仍不会进按会话块（历史遗留，未在本轮迁移）。
- **手动记忆**：仍保持原行为（不进私聊），不会因为开关被带进来。
- **互通圈**：仍是已有功能；本轮没有改 circles 的语义，也没有校验圈内群是否仍在白名单（后续可补）。
- 回滚：关掉开关即可恢复旧行为；代码回滚到上一提交，注入文件会在下次维护时恢复。

## 没做

- 字面意义的“所有记忆”：当前是衰减卡 + 固定注入预算，只注入最近/重要的群记录；要“查全部”需要另做检索工具/全量卡查询。
- 非主人私聊读群。
- 群→私聊的反向权限（私聊仍不进群）。
- 互通圈与 allow/deny 的强校验。
- 37 条无 key 旧 owner 记录的迁移。
