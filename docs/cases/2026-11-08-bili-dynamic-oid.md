# B站 动态里的 @ 回了却看不见：oid 用成了动态 id

日期：2026-11-08

## 现象

- 用户原话：「我 b站艾特他了，他为什么不回」→ 随后：「他刚刚好像发了，但是问题是，我 b站没看到啊」。
- 事实：鱼**确实回复了**（`quota.json` 有记账，B站 返回 `code:0`），但用户刷新动态页看不到；鱼自己账号里也看不到。
- 视频下的 @ 正常，**只有动态（opus）下的 @ 会这样消失**。
- 影响面：不丢数据、不花钱，但"回复"这个功能在动态场景等于失效，且**没有任何报错**（静默）。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows / DSH 0.2.1-rc.5 |
| SurfCore 版本 | v0.8.8 + 本地分支 `feat/bili-reply-only` |
| 安装方式 | git 工作区 + `~/.dsh/plugins/surfcore` junction |

## 根因

- 代码位置：`plugins/surfcore/tools/lib/msgfeed.mjs:91`（改动前）：
  ```js
  oid: idFromUri(uri) || exactId(it.item?.subject_id),
  ```
- 问题链条：
  1. 动态收件箱的 `item.uri` 形如 `https://t.bilibili.com/<dyn_id>#reply<rpid>`，`idFromUri()` 取出的是**动态 id**；
  2. 但评论接口（`POST /x/v2/reply/add`、`GET /x/v2/reply/wbi/main`）要的 oid 是**评论区 oid**（`comment_id_str`，本例 `413846048`，和 19 位的动态 id 完全是两个数）；
  3. 用动态 id 发评论，B站 返回 `code:0` + rpid —— 看起来成功，实际挂在一个不存在的评论区；
  4. 结果：新版 opus 页面不展示，谁都看不见，也没有任何错误码。
- 为什么之前没发现：文件头（`:25-29`）只处理了"19 位 id 超过 JS 安全整数会丢精度"这个坑，没意识到"动态 id ≠ 评论 oid"；而且这个失败**没有报错**，只有拿正确 oid 回读才看得出来。

## 完整逻辑（给用户看的那一遍）

1. **链路**：`at/reply` 收件箱 → `pullFeed` 把每条消息归一化成 `{oid, root, parent}` → `comment-digest` 把坐标打给 B站 会话里的模型 → 模型跑 `comment --oid <oid> --type 11 --root … --parent …`。
2. **机制**：B站 有两套动态评论 id —— 动态 id（`dyn_id`）和评论区 id（`comment_id_str`）。收件箱只给前者，评论接口只认后者。用错不会报错，只会"发到一个没有人的评论区"。
3. **爆炸半径**：3 个读者（`comment-digest`、`scheduler.listenTick`、测试）× 1 个文件；静默失败=3（最难查的一档：成功码 + 不可见）。不碰密钥、不花钱。
4. **取舍**：
   - A（选了）：在 `pullFeed` 里对 business 11/17 调一次 `polymer/web-dynamic/v1/detail` 换 `comment_id_str`，按 dyn_id 缓存（上限 200），失败退回原 oid。收益：一处修好，digest / 监听 / 将来的调用方全受益；成本：动态类消息每条多一次请求（有缓存）。
   - B：在 `comment.mjs` 里自己解析一次。要改两处（发之前 + 读之前），且 `comment-digest` 打出来的坐标仍然是错的，容易再踩。
   - C：给动态类单独写一套坐标。重复代码，不选。
5. **生效与重启**：`comment-digest` / `comment` 都是独立进程，改完**立刻生效**，不用重载插件；`scheduler` 里的 `listenTick` 只用时间/人/类型，不用 oid，因此不受影响。
6. **验证**：见下节。
7. **回滚与残余**：`git revert` 单提交即可。残余：已经发到空评论区的那条救不回来（B站 侧不展示）。

## 修法

```js
// msgfeed.mjs：动态（11/17）的 uri 是动态 id，必须换成 comment_id_str
const business = Number(it.item?.business_id ?? 1)
const rawOid = idFromUri(uri) || exactId(it.item?.subject_id)
const oid = (business === 11 || business === 17)
  ? ((await dynamicCommentOid(rawOid, headers)) || rawOid)
  : rawOid
```

`dynamicCommentOid()`：`GET /x/polymer/web-dynamic/v1/detail?id=<dyn_id>` → `data.item.basic.comment_id_str`；按 dyn_id 缓存（上限 200 条），解析失败返回空串并退回原 oid，**绝不阻断收件箱**。

## 验证

- `node plugins/surfcore/scripts/test-msgfeed-oid.mjs` → OK（新增两例：动态必须换成 `comment_id_str`；detail 失败要退回原 oid）
- `node scripts/test-bili-reply-coordinates.mjs` → 通过
- `node scripts/test-bili-listen-error.mjs` → 通过
- `npm run test:audit` → 136/143，与改动前一致（7 个失败均为沙箱 `spawn EPERM`）
- **真实收件箱（只读）**：`comment-digest --hours 4` 的坐标从
  `oid=1264999573864054790`（动态 id）变成 `oid=413846048`（评论区 oid）✅
- 用户真机验收：再次在动态里 @ 她，回复出现在楼中楼里 ✅

## 遗留 / 后续

- 已经挂空的那条回复无法恢复。
- 动态类消息多一次 detail 请求（已缓存，不会重复打）。
- 同类风险点：`dynamic-image` / `share-dynamic` 等发动态的工具里，如果将来也要回读评论区，同样要认 `comment_id_str`。
