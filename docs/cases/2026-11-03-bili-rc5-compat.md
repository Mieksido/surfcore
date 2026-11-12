# DSH 0.2.1-rc.5 上 B站生物钟的兼容问题（6 条）

日期：2026-11-03

对应：GitHub issue #49

## 现象

DSH 0.2.1-rc.5 下 B站生物钟叫醒后：

```text
turn/start
turn/end { reason: { kind: "blocked" } }
```

没有 `step/start`，模型从未被调用。  
另有日记路径、记忆简报路径、默认 provider、cwd、listenTick TDZ 问题。

## 逐条状态

| # | 问题 | 当前状态 |
|---|---|---|
| 1 | 建会话没有 workspaceId/agentPreset | workspaceId 已有；本批补 agentPreset |
| 2 | cwd 是用户主目录 | 已改 `state/bili-agents` |
| 3 | 默认 provider 不存在 | 本批加模型目录 fallback |
| 4 | 日记提示词账号级 / 工具角色级 | 本批提示词改角色级 |
| 5 | B站→QQ 记忆读账号级 | 本批按当前角色传入 biliDir |
| 6 | listenTick L 重名 TDZ | 已修 |

## 本批改动

### 1. agentPreset

`scheduler.js`：

```js
async function resolveBiliAgentPreset() {
  // 优先 DSH standard（B站需要本地工具/bili.mjs）
  // 没有 standard 时用 default / 第一个可用 preset
}

await sessionController.create({
  sessionId,
  ...biliSessionCreateParams({ workspaceId, cwd, agentPreset }),
})
```

`biliSessionCreateParams()` 现在把 `agentPreset` 一起带上，仍然保持：

```text
workspaceId 与 cwd 互斥
```

### 2. provider fallback

`ensureChatModel()` 在 `selectModel` 明确报：

```text
model-unavailable / select an available model
```

时，读取 DSH 真实 `session/modelCatalog`，用 `pickCatalogFallback()`：

- 优先同名模型、换 provider；
- 否则目录第一项；
- 只重试一次，不改写用户配置。

### 3. 日记路径

`scheduler.js` 唤醒提示词不再写死：

```text
~/.dsh/surfcore/bili/whale-diary.md
```

改成 `platformDir()` 当前角色目录：

```text
~/.dsh/surfcore/characters/<id>/bili/whale-diary.md
```

### 4. 记忆简报路径

`src/bili-memory.js` 新增 `biliDir` 参数：

```js
if (biliDir) paths.bili = biliDir;
```

`src/bridge.js` 启动时传：

```js
biliDir: CHARACTER_ID ? characterPaths(CHARACTER_ID).biliDir : null
```

不再固定读账号级 `~/.dsh/surfcore/bili`。

## 没有做

- 没有自动迁移账号级旧日记/旧额度到角色级；旧数据不会自动出现在新角色。
- 没有把 `agentPreset` 写进配置；默认从 DSH preset 清单选 standard/default。
- 没有把 provider fallback 持久化到 config.json；只影响本次 selectModel。
- 没有修 `turn/end blocked` 的用户可见错误；仍要实机确认 preset 是否足够。

## 风险

- `standard` preset 是否存在于 DSH 0.2.1-rc.5 需实机确认；没有则退 default/第一个。
- B站会话如果用 `standard`，本地工具面会打开；这是 B站 任务本来就需要的能力，但权限仍按 `danger-full-access`。
- 模型 fallback 可能选到更贵模型；日志会写明，未改配置。
- 提示词改角色级后，账号级旧日记不会自动被读到；需要手动迁移或保留旧数据。
- 记忆模块只改 biliDir，不迁移旧账号级数据。
- 旧未分组会话仍可能 blocked；新建角色会话才走新 preset/workspace。

## 验证

```text
node scripts/test-bili-workspace.mjs
node scripts/test-model-options.mjs
node scripts/test-scheduler-permission.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
