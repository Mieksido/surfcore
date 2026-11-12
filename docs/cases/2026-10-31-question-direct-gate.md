# question 触发不再绕过每日唤醒配额

- **日期**：2026-10-31
- **触发数据**：重启后 1 小时，138 次唤醒、15 次发送、116 次 close-only；
  - 一个群 75 次唤醒，其中 65 次 `question`；
  - 另一个群 54 次唤醒，27 次 `keyword:大肥鱼`。

## 现象

`question` 由 `isDirectedAtAi()` 的宽泛启发式触发：
“你/您 + 吗/呢/怎么/是不是…” 都会命中，哪怕只是群友互相聊天。

同时 `sendWakePromptV2` 把 `question` 当成 `direct`，而 `direct` 会绕过：

- 每日唤醒上限 `maxWakesPerDay=20`；
- 最小间隔 `minWakeGapMs=120000`。

结果：普通群聊的“你…吗”也能无限唤醒，20 次/日上限失效。

## 修法

新增 `src/wake-policy.js`：

- `isHardDirectWakeReason()` 只认：
  - `atMention`、`nameMention`、`poke`、`private`、`admin`；
  - `question` **不再**绕过每日配额；
- `hasStrictDirectUnread()` 只认：
  - `isOwner`；
  - `quoteTargetIsSelf`；
  - 真正包含 `@昵称` 或昵称；
  - 不再用宽泛的“你+疑问”判断。

bridge 的 `directWake` 改用严格策略。

## 影响

- 普通 `question` 仍可唤醒，但受每日 20 次/最小 2 分钟限制；
- 真正 @/叫名字/私聊/管理员仍可绕过每日配额；
- 不改 question 触发本身，只改“绕过配额”的资格。

## 验证

```bash
node scripts/test-wake-policy.mjs
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit
```

## 回滚

- 恢复 `isDirectFishGuardWake` 包含 `question`，或让 `directWake` 使用旧的 `fishGuardDirectUnread`；
- 不需要数据迁移。

## 残余

- `question` 触发仍可能偏宽，但不再无限绕过配额；
- close-only 仍需语义复核，不能直接删 close。

## 修复后样本（20 分钟）

- 唤醒 47、发送 26、close-only 21；
- question 12 次；group:389834620 5 次唤醒（修复前 75 次/小时）；
- group:496972996 40 次唤醒，但 22 次发送，atMention 19 次；
- 成本 ¥2.08，成本/交付 ¥0.0551；
- QQ 预算 ¥12.14 / ¥20。

结论：question 不再无限绕过每日配额，保留真实 @/名字唤醒；close-only 仍高，下一步单独看 keyword/close。

## 第二轮样本（14:44–15:54）

- 唤醒 117、发送 13、close-only 104、成本 ¥4.27；
- group:389834620 55 次（44 question）；
- group:496972996 62 次（32 keyword）；
- 说明：上一版 strict direct 仍有两个口子：
  - 裸昵称出现在 unread 文本里也算 direct；
  - fishGuardBypass 仍可让 directWake 为真。

## 第二轮修复

- `hasStrictDirectUnread` 只认真正的 `@昵称` 或引用自己；
- 不再因为裸昵称、owner 自动视为配额绕过；
- `directWake` 去掉 fish bypass；
- 需要再次重启 QQ 桥接验证。

