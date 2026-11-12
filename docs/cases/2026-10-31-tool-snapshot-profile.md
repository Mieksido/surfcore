# 快照 / brief / 工具面 / step guard / Action Planner 第一版

- **日期**：2026-10-31
- **目标**：把 S（模型步骤/工具往返）和 T（上下文长度）从“只靠唤醒收紧”里拆出来；不自动合并写操作。
- **本批范围**：snapshot、brief/caps/refs、工具面 profile、prompt sections、assistant step 计数、close 幂等。
- **未做**：自动 send+close、跨工具批量写、视觉/转发全文默认展开、vector memory。

## 1. 链路

```text
模型
 ├─ qq_get_context_snapshot
 │    → GET /api/socialV2/snapshot
 │    → buildContextSnapshot(st, caps, afterSeq)
 │    → unread/recent/social/activeMembers（默认 brief + truncated + refs）
 │
 ├─ qq_get_prompt
 │    → GET /api/socialV2/prompt
 │    → 默认 sections = role,wake,memory
 │    → stickers/slang/closure/voices 需要显式 sections
 │
 ├─ qq_close_conversation
 │    → POST /api/socialV2/close
 │    → planClose(st)  // 已收尾且无新动作 → 幂等返回
 │    → closeGate / acknowledge / closure record
 │
 └─ 其他发送/控制工具保持不变

工具注册：
  socialV2.toolProfile = full | balanced | compact
    balanced 隐藏旧 unread/recent/social/active/myRecent
    compact 再隐藏群成员/群历史/表情列表/语音列表
```

step guard：

```text
assistant/message → noteStep()
tool/result        → noteToolError()
不再按每个 tool/call 计数
```

## 2. 机制

### snapshot

- `src/context-snapshot.js` 纯函数；
- 默认 unread 12 / recent 10 / 每条 200 字 / active 8；
- 截断必须 `truncated=true`；
- 截断消息生成 `refs`，指回 `qq_get_message_detail`；
- `afterSeq` 用于补读，不重复拉全量；
- `include` 可只取需要段；
- 不默认返回图片/转发全文/群历史。

### prompt sections

- 默认只给 role + wake + memory；
- `sections=stickers,slang,closure,voices` 才返回可选段；
- `mode=tone/full` 仍由人格层控制；
- 目的是避免“一次 prompt 把表情库/黑话/收尾参数全拉一遍”。

### tool profile

- 默认 `balanced`（snapshot 被显式关闭时回退 full），让旧读工具真正退场；`full` 仍可在设置页切回；
- `balanced`（默认）：隐藏旧分散读取，走 snapshot；
- `compact`：进一步隐藏重型列表读取；
- 关掉的工具**注册期不注册**，需要重启 DSH。

### step guard

- 一次 `assistant/message` = 一步；
- 同一步内多个 tool call 不再重复计步；
- 工具错误仍按 tool + 归一化错误计数；
- 业务拒绝不计入重复错误。

### Action Planner 第一版

- `src/action-planner.js`：close 幂等 + `lastSendFailed` 时拒绝 close（`CLOSE_AFTER_SEND_FAILED`）；
- 上次 close 后没有新动作/发送 → `ALREADY_CLOSED`，不重复写 closure/已读；
- 发送后允许再次收尾；重开后允许收尾；
- **不自动 send+close**，不替模型决定；发送失败时明确阻止“假装成功后收尾”。

## 3. 爆炸半径

- bridge：新增 snapshot 路由、prompt section 过滤、close 前置 plan、step guard 事件类型；
- MCP：新增 `qq_get_context_snapshot`、工具 profile 过滤、`getSnapshot` 开关；
- 插件 UI：工具面模式下拉；
- 状态：不改现有持久化字段；`planClose` 只读 `st.closure/st.lastActionAt`；
- 花钱：snapshot 结果有 caps；profile 减少 schema；prompt 默认少返回。

## 4. 取舍

- 先加 snapshot，不删旧读工具；
- 默认 `balanced`，但保留 full 回退；先测再决定是否 compact；
- snapshot 不包含人格/提示词，避免角色卡和消息混在一起；
- 不合并写操作；
- 不用 snapshot 替代图片/转发/群历史这些重型读取。

## 5. 生效与重启

| 改动 | 谁读 | 重启 |
| --- | --- | --- |
| snapshot 路由/构建 | bridge | 重启 QQ 桥接 |
| `qq_get_context_snapshot` schema | MCP/DSH | 重启 DSH |
| toolProfile | MCP 注册期 | 重启 DSH |
| prompt sections | bridge | 下一条消息生效 |
| step guard/close plan | bridge | 重启桥接 |
| 设置页工具面 | 插件 | 重启 DSH |

## 6. 验证

```bash
node scripts/test-context-snapshot.mjs
node scripts/test-action-planner.mjs
node scripts/test-group-policy.mjs
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit
```

预期：

- snapshot 的截断/refs/afterSeq 正确；
- close 重复调用返回 `alreadyClosed`；
- step guard 源码按 `assistant/message` 计数；
- profile 隐藏列表存在；
- 设置页有「工具面模式」。

## 7. 回滚与残余

- 回滚 snapshot：忽略新工具即可，旧读工具仍在；
- 回滚 profile：设置回 `full`；
- 回滚 prompt：`sections=role,wake,memory,stickers,slang,closure,voices` 显式全取；
- 回滚 close plan：去掉 `planClose` 前置；
- 残余：Action Planner 还没有 send 失败/等待状态；brief/detail 还没覆盖旧读工具；工具面默认仍是 full。

## 11. 默认 balanced 与发送失败拦截

- MCP 未配置 `toolProfile` 时默认 `balanced`；若 `tools.getSnapshot=false` 自动回退 `full`；
- 设置页「工具面模式」默认显示 balanced，可切回 full；
- `lastSendFailed` 为真时 close 返回 409 `CLOSE_AFTER_SEND_FAILED`，先重试发送；
- preset 引导优先 `qq_get_context_snapshot`，不再连续 unread/recent/social/active；
- 需要重启 DSH（工具注册/profile）+ 桥接（close/snapshot）。
