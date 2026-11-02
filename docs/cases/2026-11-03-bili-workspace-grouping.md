# B站生物钟会话永远落在「未分组」

日期：2026-11-03

对应：GitHub issue #27

## 现象

- DSH 侧边栏里，B站生物钟会话永远在「未分组」。
- 每换一次角色多一条 `bili-whale-<charId>`，旧的不清理。
- 会话 cwd 是 `%USERPROFILE%`；QQ 桥接会话在「QQ 聊天」工作区正常归组。

## 根因

`plugins/surfcore/lib/index.js`：

```js
cwd: os.homedir(),
```

`plugins/surfcore/lib/scheduler.js`：

```js
await ctx.sessionController.create({ sessionId, cwd })
```

DSH 的 `session/create`：

- `workspaceId` 与 `cwd` 互斥；
- 只传 `cwd` 不会把会话 attach 到任何 Workspace；
- 所以会话建出来、cwd 也对，但侧边栏归到「未分组」。

QQ 桥接走的是：

```js
const ws = await workspace.create({ path: dir })
await sessions.create({ workspaceId: ws.workspace.workspaceId })
```

因此正常归组。

## 修法

### 新会话

新增 `plugins/surfcore/lib/bili-workspace.js`：

```js
biliWorkspacePath(dshHome)
// <dshHome>/surfcore/state/bili-agents
biliSessionCreateParams({ workspaceId, cwd })
// 有 workspaceId → { workspaceId }
// 没有 → { cwd }（旧版 DSH 兜底）
```

`index.js` 传：

```js
cwd: biliWorkspace,
workspacePath: biliWorkspace,
workspaceTitle: 'B站生物钟',
```

`scheduler.js`：

```js
const controller = service('workspaceController')
const ws = await controller.create({ path: workspacePath })
await ctx.sessionController.create({
  sessionId,
  ...biliSessionCreateParams({ workspaceId, cwd: workspacePath }),
})
```

### 旧用户

- 已有会话仍然先 `inspect`，存在就不重建：
  - 保留历史/上下文；
  - 旧会话可能仍在「未分组」，不会强行迁移。
- DSH 公开 API 没有“把已有会话 attach 到 Workspace”的方法；`insertSessionBefore` 只移动已归组会话。
- 新角色/新会话会自动进入 B站生物钟工作区。
- 旧版 DSH 没有 `workspaceController` 时，退回专用 `cwd`：
  - 至少不再用用户主目录；
  - 仍可能未分组，但功能可用。

### 同时修复

`ensureSession` 创建失败不再把 `sessionReady=true`：

```js
catch (error) {
  log(`[bili] 创建生物钟会话失败，下一 tick 重试`)
  return
}
```

避免后续 prompt 一直打到一个不存在的会话。

## 没有做

- 没有自动 archive 旧未分组会话：会隐藏历史，不能静默做。
- 没有实现“已有会话无损迁移”：DSH 没有公开 attach API。
- 没有改 `danger-full-access` 默认；只缩小 cwd 爆炸半径。
- 没有清理所有历史 `bili-whale-*` 会话。

## 风险

- 旧会话仍在「未分组」；用户需手动归档/保留。
- `workspaceController.create` 失败时会退回专用 cwd（未分组），但不会回用户主目录。
- workspace 标题/Created 行为依赖 DSH API；rename 失败只 log。
- 新工作区目录需要可创建；权限错误会退回 cwd。
- 旧版 DSH 无 workspace 服务时仍然未分组。

## 验证

```text
node scripts/test-bili-workspace.mjs
node scripts/test-scheduler-permission.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
