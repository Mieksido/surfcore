# B站 @ 鱼不在“我那一层”回复：@ 消息缺坐标，不是 source_id 用错

日期：2026-11-03

对应：用户反馈 / 错误报告（B站 @ 后回复跑到别层或新开一层）

## 现象

- 用户在 B站评论区 @ 鱼，鱼有回复，但不在用户那条评论下面；
- 关掉「鱼群管理」后，变成一直新开一层楼回复。

## 先纠正报告里的根因

报告认为：

> `source_id` 是来消息的人自己的 rpid，拿它当 `parent` 是错的。

这个判断反了。

B站 `msgfeed/reply` 字段：

```text
source_id  源评论 id = 直接回复的评论（来消息这条）
target_id  目标评论 id = 被回复的评论
root_id    线程根评论；一级评论为 0
```

参考：
https://github.com/pskdje/bilibili-API-collect/blob/main/docs/message/msg.md

报告表格里：

```text
source_id 的作者 = 发消息的人自己
```

是正常语义。  
要回复“来消息的这个人”，`parent` 就应该用 `source_id`。

## 真正的问题

### 1. `comment-digest` 只给 `reply` 打坐标，不给 `@` 打坐标

```js
if (x.kind === 'reply') {
  console.log(`    坐标：... root=${x.root} parent=${...}`)
}
```

用户是 `@` 鱼，`kind='at'`，digest 没有坐标。  
模型没有 root/parent，只能新开一层。

### 2. `@` 一级评论的 root 需要补成 source_id

如果 `@` 评论是一条一级评论：

```text
root_id = 0
source_id = 该评论 rpid
```

要回到它下面，POST `/x/v2/reply/add` 需要：

```text
root   = source_id
parent = source_id
```

只传：

```text
root=0
parent=source_id
```

B站会当成新楼层。

### 3. `resolveLatestReply` 把 source_id 当 parent 比

旧代码：

```js
mine.find((r) => String(r.parent) === String(parentRpid))
```

调用方传的 `parentRpid` 实际是 `source_id`（来消息那条的 rpid）。  
应该找：

```js
String(r.rpid) === sourceId
```

否则永远匹配不到，最后静默拿 `mine[last]`。

### 4. 鱼群保护在“没有坐标”时聚拢到别人的鱼楼

`comment.mjs`：

```js
const hadThread = Boolean(root || parent)
if (AUTO && fishCfg.enabled && !hadThread) {
  // 鱼群保护，可能把 root/parent 改成别人的鱼楼
}
```

没有坐标 → 触发聚拢；关掉鱼群保护 → 仍然没有坐标 → 新开一层。

## 修法

### 1. `msgfeed` 统一坐标

新增：

```js
export function replyCoordinates({ root, sourceId, targetId }) {
  const threadRoot = exactId(root)
  const source = exactId(sourceId)
  const target = exactId(targetId)
  const parent = source || target
  const rootId = (threadRoot && threadRoot !== '0')
    ? threadRoot
    : (target && target !== '0' ? target : parent)
  return { root: rootId, parent, sourceId: source, targetId: target }
}
```

`pullFeed` 同时保留：

- `root` / `parent`（规范后）
- `sourceId` / `targetId`（原始 id）

### 2. `comment-digest` 对 `@` 也输出坐标

`reply` 和 `at` 都打印：

```text
坐标：type=... oid=... root=... parent=...
```

### 3. `resolveLatestReply` 按 rpid 找

```js
pick = mine.find((r) => String(r.rpid) === wanted)
```

不再用 `r.parent === source_id`。

### 4. 鱼群保护自然不再误触发

`@` 一级评论现在有：

```text
root=parent=source_id
```

`hadThread=true`，不会触发“没坐标 → 聚拢”。

## 没有做

- 没有改 `source_id` 当 parent 的语义；这是正确的。
- 没有用 `target_reply_content` 当 parent；那会回错人。
- 没有真实 B站 账号发评论验证；只做纯函数/桩测试。
- 没有处理“模型拿到坐标但不用”的情况；模型仍可能自己乱填。
- 没有处理 B站 前端折叠展示：即使 parent 正确，也可能折叠在“回复 @某人”里。

## 风险

- `resolveLatestReply` 改为按 rpid 后，正文为空且楼层里找不到 source 时会返回 null/兜底，不再盲猜。
- `@` 一级评论 root=source 后，年龄检查 `parentAuthor` 可能查不到作者（一级评论不在楼中楼列表），但不阻塞。
- 关闭鱼群保护仍会有新楼层，如果模型不按坐标走。
- B站 可能把回复折叠，用户未必一眼看到。

## 验证

```text
node scripts/test-bili-reply-coordinates.mjs
node plugins/surfcore/scripts/test-bili-automation.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
