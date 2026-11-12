# 用户反馈：QQ 群聊/私聊/B站像是一个会话

- **日期**：2026-10-31
- **反馈**：多名用户说 QQ 私聊、群聊、B站像在同一个会话里。
- **结论**：先分三层看，不能把“工作区 / 角色记忆 / DSH 会话”混为一谈。

## 1. 本机实测

```text
state/sessions.json：
  private:3287064288 -> session-536...
  group:389834620   -> session-bd8...
  group:496972996   -> session-9b9...
  group:829983444   -> session-8e4...
  group:816938074   -> session-167...
```

本机每个 QQ key 都是独立 sessionId。

用 DSH API 在同一个 workspace 连续创建两个 session：

```text
A: session-a907...
B: session-804...
same? false
```

说明 DSH 的 session/create 本身不会把同 workspace 的两个会话合并。

## 2. 三种“看起来像一个会话”

### A. 工作区相同（正常）

`ensureSession` 把所有 QQ 会话挂到同一个 workspace：

```text
workspaceTitle = "QQ 聊天"
```

DSH 侧看到的是一个工作区里有多个会话，不是同一个 session。  
这会让 GUI 看起来“都在一起”，但上下文仍应按 sessionId 隔离。

### B. B站本来就是一个角色一个会话（设计如此）

B站 scheduler：

```text
bili-whale-<characterId>
```

同一个角色下所有 B站 自动行为共享一个会话，这是设计，不是 QQ 串台。  
如果用户想“每个 B站 账号/每条视频一个会话”，需要另做产品设计。

### C. 角色/记忆跨平台共享（设计如此）

当前角色、人格卡、记忆卡、B站行为账本按角色共享；QQ 群/私聊/B站会看到同一个“她”。  
这不是 DSH session 合并，而是**同一个角色**。

### D. 真正的会话映射污染（bug）

如果 `state/sessions.json` 里多个 key 指向同一个 sessionId，那么所有消息会确实进入同一段上下文。  
旧版本/异常重置/手工改文件都可能造成。

## 3. 修法

新增 `src/session-map.js`：

```text
findDuplicateSessionIds(mappings)
dedupeSessionMappings(mappings)
```

bridge 启动时：

- 找出被多个 key 共用的 sessionId；
- **删除所有重复映射**（不保留其中一个，避免继续串）；
- 写 gate event `session-map-duplicate`；
- 这些会话下一条消息重建独立 session；
- 记录日志。

另外新建 session 后调用：

```text
api.sessions.rename({ sessionId, title: "QQ 聊天 · group:xxx" })
```

让 GUI 里每个 QQ 会话有可辨认标题；失败不影响隔离。

## 4. 验证

```bash
node scripts/test-session-map.mjs
npm run test:audit
```

本机：

```text
✅ 会话映射审计通过
```

## 5. 残余

- 如果用户的 DSH 版本把 workspace 当成唯一 session（与本机 0.2.1 实测不同），需要改成每会话独立 workspace；
- B站一个角色一个会话仍是设计；
- 角色/记忆跨平台共享仍是设计；
- 需要用户提供 `state/sessions.json` 和 DSH 会话列表，才能确认他们属于哪一类。
