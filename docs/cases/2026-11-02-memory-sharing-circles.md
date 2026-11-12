# 多群记忆串：A 群的事被记成 B 群

日期：2026-11-02

## 现象

- 鱼同时在多个群时，会以为某件事在 A 群发生过，实际发生在 B 群。
- 记忆注入块只写「名字（群聊）」，没有群名/群 ID。
- 主人消息连「群聊」都没有，来源完全不可见。

## 根因

1. 记忆卡是**当前角色一张共享卡**，A/B/私聊都写进同一张 `memory-card.json`。
2. `recordLine()` 只渲染：
   ```text
   名字（群聊）：……
   ```
   不渲染 `groupId` / `conversationKey`。
3. 主人记录走另一个分支，**连「群聊」都不写**。
4. `memoryCardPromptBlock()` 对所有群读同一个 `memory-card-prompt-qq.md`。
5. `buildWakeReminderPromptV2()` 完全不带 key；快照 packet 也没有 key。
6. `findDuplicate()` 不比较 `conversationKey`，跨群同文本可能被合并。

## 目标语义

- 默认隔离：群不在任何互通圈 → 只看自己。
- 封闭互通圈：同圈群互看；不嵌套、不传递。
- 私聊记忆永不进群。
- 即使同圈，每条记忆也必须带来源：
  ```text
  小明（群聊·鱼塘 / group:712144923）：……
  ```
- 旧记忆按已有 `groupId`/`conversationKey` 补标；没有来源的标「来源未知」，不参与互通。

## 修法

### 1. 记录层

`src/memory-card.js`：

- `normalizeRecord` / `makeRecord` 增加 `groupName`；
- inbox 事件增加 `groupName`；
- `recordLine` 统一走 `memorySourceLabel()`：
  - `群聊·群名 / group:ID`
  - `私聊`
  - `桌宠`
  - `B站`
  - `手动记录`
  - `群聊·来源未知`
- `findDuplicate` 增加 `conversationKey` 比较。

### 2. 互通策略

`normalizeMemorySharing()`：

```json
{
  "default": "isolated",
  "circles": [
    { "id": "circle-1", "name": "熟人圈", "groups": ["111", "222"] }
  ]
}
```

- 群在多个圈 → 只认第一个；
- 少于 2 个有效群的圈丢弃；
- 不做传递闭包。

### 3. 渲染过滤

`visibleFor(card, platform, cfg, conversationKey)`：

- 群聊：只看自己 + 同圈；`private`/桌宠/圈外/未知来源不注入；
- 私聊：只看自己的私聊；
- 完整卡/管理端：不传 conversationKey，显示全部。

### 4. 按会话 prompt

`saveMemoryCardOutputs()` 额外写：

```text
memory-card-prompt-qq-groups.json
{
  "blocks": {
    "group:111": "...",
    "group:222": "...",
    "private:999": "..."
  }
}
```

`src/bridge.js` 的 `memoryCardPromptBlock(key)` 优先读这个 map：

- 有 map 且 key 有块 → 用块；
- 有 map 但 key 没有 → 空（默认隔离）；
- map 不存在 → 回退旧全局块（兼容旧插件）。

### 5. 当前会话身份

`buildWakePromptV2` / reminder / snapshot / `qq_get_prompt` / `qq_get_context_snapshot` 增加：

```text
【当前群】QQ 群「鱼塘」｜group:712144923｜成员 37
```

或：

```text
【当前会话】QQ 私聊｜private:123456
```

### 6. UI

记忆卡页增加「记忆互通圈」：

- 每个圈：名称 + 群号列表（逗号/空格分隔）；
- 默认没有圈 = 全部隔离；
- 已知群从记录里的 `groupId/groupName` 提示；
- 私聊永不进圈。

## 没有做

- 不做 B站/桌宠的按群隔离；
- 不做 circle 嵌套/传递；
- 旧记录不重写 JSON，只在渲染时补标；
- 没有来源的旧记录不参与互通；
- 完整卡仍是管理员全量视图；
- 手动记忆默认全局（不属于任何群）；
- 私聊记录没有迁移到按私聊对象分片。

## 风险

- 默认隔离会改变现有体验：鱼不再跨群记得事情。
- 开启互通圈后，A 群的人/事可能被 B 群知道，必须用户显式开启。
- 群名可能含换行/指令：已按纯文本截断，但仍需当成不可信数据。
- 旧记录来源不全：只能显示 `group:ID` 或「来源未知」。
- `findDuplicate` 修正前已经合并的旧记录无法恢复来源。
- 按会话 map 依赖插件维护；map 缺失时回退全局块（兼容，但升级瞬间可能短暂全量）。
- 手动记忆全局可见，可能不符合严格隔离预期。
- 私聊老记录若没有 conversationKey，可能不会出现在新私聊块里。

## 验证

```text
node scripts/test-memory-sharing.mjs
node scripts/test-memory-card-wiring.mjs
node scripts/test-callname.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
