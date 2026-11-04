# 群里的 #sl 刷屏指令不唤醒 SurfCore

日期：2026-11-03

## 现象

群里很多人发 `#sl`，会炸出一堆“鱼”发 `snowluma`；SurfCore 的鱼也可能被带着接话。

## 根因

`#sl` 不是 SurfCore 的命令。SurfCore 当前没有按命令文本过滤入站消息：

```text
群消息进入
→ 白名单/鱼群保护只看群、名字、密度
→ 没有看 #sl
→ AI 可能被唤醒
```

所以能不能回，取决于群白名单、鱼群保护和唤醒额度，而不是“这是不是一条刷屏指令”。

## 修法

### 1. 新增 `src/command-spam.js`

识别：

```text
#sl
#SL
＃sl
#sl 刷屏
#help 一下
```

不识别：

```text
#B站#
#话题
今天 #sl 了吗
```

规则：

```js
/^[#＃][A-Za-z0-9_]{1,24}(?:[\s，。！？,.!?].{0,80})?$/u
```

也就是：

- 必须是消息开头；
- `#` / 全角 `＃` + ASCII 命令词；
- 可带一段尾随文字；
- 不碰中文话题标签。

### 2. bridge 入站过滤

在群消息进入未读/唤醒前：

```js
if (kind === 'group' && !isOwner
    && cfg.socialV2?.ignoreSpamCommands !== false
    && !quoteTargetIsSelf
    && !isDirectAddress(plainContent, event, kind)
    && isSpamCommandText(plainContent)) {
  // 只写节流日志/活动，不 append 未读，不唤醒
  return;
}
```

保留：

- 主人发的指令；
- `@` 鱼 / 引用鱼的指令；
- 私聊；
- 普通中文话题标签。

### 3. 配置

`config.example.json` / 桥接默认：

```json
"socialV2": {
  "ignoreSpamCommands": true
}
```

设置页「鱼群保护（QQ）」新增：

```text
忽略 # 刷屏指令
```

## 没有做

- 没有拦截 SnowLuma 自己的命令；如果 `#sl` 是 SnowLuma/别的插件在回，SurfCore 管不了。
- 没有拦截别人的鱼；只控制 SurfCore 自己这条。
- 没有按“出现 N 次才判定刷屏”；当前是**单条 # 指令**就忽略。
- 没有把忽略原因发到群里（避免二次刷屏），只写节流日志/活动。
- 没有处理 `#sl` 被拆成多条、或图片/表情里的命令。

## 风险

- 如果 `#sl` 本来是用户叫鱼的方式，现在会被忽略；需要关掉 `ignoreSpamCommands` 或 @ 鱼。
- 只忽略非主人；主人发 `#sl` 仍会进模型。
- 只忽略纯命令；`#sl` 后面接中文长句可能仍匹配（当前允许尾随一段）。
- 其他机器人/ SnowLuma 仍可能回，用户可能误以为 SurfCore 没生效。
- 忽略的消息仍会先经过 `recordMemoryInboxEvent` / 鱼群窗口（当前过滤点在 pending 之后），极端情况下可能影响记忆/鱼群统计；后续可把过滤点前移。

## 验证

```text
node scripts/test-command-spam.mjs
node scripts/test-audit-bridge.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
