# 私聊「不回我」+ 体检 SnowLuma 误报：额度用尽不可见、回访吃掉一半额度

## 现象

- 用户原话：**「为什么 DSH 插件 surfcore 不会回我的消息？而且也没有终端让我看状态。」**
- 复现步骤：
  1. 正常聊天到晚上（当天已有若干轮对话 + 几次主动搭话）；
  2. 继续私聊发「在吗？」「你也去发个QQ空间」；
  3. 消息进未读，但 QQ 上没有任何回复，设置页/概览也没有任何提示。
- 同一份体检输出里还有一行：`⚠️ SnowLuma 在线 · 探测结果：onebot-rejected · 多半是 accessToken 不匹配`，
  而实际上桥接连着、账号在线、心跳正常。
- 影响面：私聊/群聊的「今天不再回话」会**静默发生**；不影响已收消息（留在未读），不丢数据，次日 00:00 自动恢复。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.1-rc.2 |
| SurfCore 版本 | v0.7.19（`local/live`） |
| 安装方式 | git（`G:\Project\surfcore`） |
| 其它相关版本 | SnowLuma v2.2.1；Node v24 |

## 根因

三件事叠在一起，用户看到的却只有一句「不理我」。

### A. 私聊每日唤醒额度已经用完（真正的「不回」）

`state/bridge.log`（Asia/Shanghai）：

```text
22:27:26 [reserved2] 计划唤醒 private:2793365099（private），8s 后发送
22:27:34 [token-guard] 跳过唤醒 private:2793365099（private）：
         Token 防爆破：这个会话今天已经醒了 10/10 次，今天不再唤醒
```

21:40:35、21:44:03 两条同样被拦。当天 `private:2793365099` 的 10 次额度是这么花的：

| 时间 | 原因 |
| --- | --- |
| 08:30:01 | 真实消息 |
| 08:32:01 | `replyCheck` |
| 12:43:03 | 真实消息 |
| 12:45:03 | `replyCheck` |
| 16:41:04 | 真实消息 |
| 16:43:04 | `replyCheck` |
| 18:40:33 | 主动搭话 |
| 19:44:59 | 主动搭话 |
| 21:34:37 | 主动搭话 |
| 21:36:31 | `bootstrap` |

**一半额度花在「回复后回访」上**：回完话后 `scheduleReplyCheckV2` 排一次 45 秒后的检查，
被 120 秒最小间隔顶回两次，2 分钟后才真正醒来——这次醒来同样算一次额度。
于是「私聊每天 10 次」实际只够 5 轮对话。

代码位置：
- `src/token-guard.js` 的 `evaluateWakeBudget`：日上限**先判**，`direct`（@/提问/拍一拍）只能越过间隔，越不过次数；
- `src/bridge.js` 的 `tokenGuardWakeBlock` 只收到 `wakeTimes`（全量时间线），分不清哪次是回访。

### B. 体检把「配置」当「桥接状态」（SnowLuma 误报）

`plugins/surfcore/lib/index.js` 的 `installChecks()` 调用
`diagnoseSnowLuma(snow)`，`snow` 是 `config.json` 的 `snowluma` **配置对象**；
而 `diagnoseSnowLuma` 第一行是 `if (bridgeSnow.connected === true)`。
配置里没有 `connected`，于是永远 `false` → 端口 3001 在听 → 一路落到 `onebot-rejected`，
并给出「多半是 accessToken 不匹配」的错误建议。

同一个函数在概览里传的是 `bridge?.snowluma`（正确），只有体检这条传错。
所以**每次体检都会报**，与真实连接状态无关。

### C. 没有任何界面显示「额度用完了」

`token-guard` 拦下唤醒时只写一行日志；`/api/status`、设置页、体检都不带这个状态。
用户没有终端可看（桥接被插件以 `stdio:'ignore'` + `windowsHide` 拉起，本来就没有黑窗口），
于是「额度用完」在用户视角等于「它死了」。

## 完整逻辑（给用户看的那一遍）

- **链路**：QQ 消息 → SnowLuma → `src/bridge.js`（OneBot WS）→ `sendWakePromptV2` →
  `tokenGuardWakeBlock`（`evaluateWakeBudget`）→ 通过则投递 DSH 回合，被拦则**只写日志**并 return。
  额度时间线持久化在 `state/social-v2.json` 的 `conversations[key].wakeTimes`；
  体检链路是 `plugins/surfcore/lib/index.js → installChecks → diagnoseSnowLuma → doctor.js`。
- **机制**：`wakeTimes` 同时承担三种语义——「两次苏醒最小间隔」「每分钟/每小时限频」「每天最多醒」。
  回访唤醒本质是**同一段对话的收尾**，却因为共用一条时间线而占掉了一次对话额度；
  日上限又在最前面判，`direct` 只能越过间隔，不能越过次数，所以「@ 它」也会被拦。
- **爆炸半径**：1 个桥接进程 × 3 个读者（`/api/status`、`/api/socialV2/states`、控制台/设置页）
  × 静默 3 = 9 分；不碰密钥、不花钱（拦截本身不投递回合），但会让用户误判「插件坏了」。
- **取舍**：
  - 路线 A（选中）：拆出 `wakeBudgetTimes` 只存「计次」的唤醒，回访仍进 `wakeTimes` 维持间隔/限频；
    `replyCheckFree` 可关，退回旧语义。
  - 路线 B：回访也计次，但把私聊上限提到 20——治标；用户一旦聊多还是撞墙，且额度含义变模糊。
  - 路线 C：直接不排回访——省额度但会丢掉「对方没回，要不要补一句」的能力。
  - 回滚：单 commit revert；`replyCheckFree:false` 或删除 `wakeBudgetTimes` 字段即可回到旧行为。
- **生效与重启**：`src/bridge.js` 改动要**重启桥接**；插件 `lib/*.js` 改动要**重启 DSH**（web 端 HMR 不覆盖宿主插件）。

## 修法

1. **回访不再吃额度**（`src/token-guard.js`、`src/bridge.js`）
   - 新增 `isFreeWakeReason(reason, guard)`，默认只认 `replyCheck`，可用
     `socialV2.tokenGuard.replyCheckFree=false` 关掉；
   - `evaluateWakeBudget` 增加 `reason` / `budgetTimes`：日上限只看 `budgetTimes`，
     间隔/限频仍看全量 `wakeTimes`；
   - 会话状态新增 `wakeBudgetTimes`（旧状态回填为 `wakeTimes` 的快照，升级当天不会凭空多额度）；
   - 只有计次的唤醒才 push 进 `wakeBudgetTimes`，回滚时两条时间线一起撤。
2. **体检用桥接状态判断 SnowLuma**（`plugins/surfcore/lib/index.js`）
   - `installChecks()` 先 `bridgeStatus()`，再 `diagnoseSnowLuma(bridge?.snowluma, { bridge })`；
   - `diagnoseSnowLuma` 新增 `bridge-down` / `bridge-error` 两个状态：桥接没跑就别说 token 不对。
3. **额度用尽必须看得见**
   - 桥接 `/api/status` 新增 `wakeGuard`（今日 `dayCount/maxDay/blocked/lastBlock`），
     `/api/socialV2/states` 每会话带一份；
   - 插件 `mapStatusPayload` 透出 `wakeGuard`；概览顶部在额度用完时显示黄色警告条，
     附「去调高额度」按钮直达 QQ 高级；
   - 体检新增「唤醒额度」一项（用完是 warn，不判失败），直接写出「私聊 10/10」和改哪个参数。

## 验证

- 自动化：
  - `node scripts/test-token-guard.mjs`（新增：回访免费/真实消息仍计次/拆线后间隔仍生效/开关关闭退回旧语义/接线断言）
  - `node plugins/surfcore/scripts/test-doctor.mjs`（新增：`bridge-down` 不甩锅 token、`onebot-rejected` 指向 bridge.log、额度用完 warn + 指路、接线断言）
  - `npm run test:audit`、`plugins/surfcore npm test`
- 失败路径：额度用完 → 概览黄条 + 体检 warn，文案包含「10/10」与「调高 私聊每天最多醒」；
  桥接没跑 → 提示「先启动 QQ 桥接」而不是查 token。
- 手工/集成验证（贴关键输出）：
  - `/api/status` 返回 `wakeGuard: { day, conversations: [{ key, dayCount, maxDay, blocked }] }`；
  - 额度满时 `replyCheck` 唤醒日志不再出现 `10/10` 拦截，真实消息仍出现。
- 没验证到的部分：真实 QQ 上跑满一天观察额度曲线；设置页黄条在真实 DSH 里的视觉表现（需重启 DSH 后手测）。

## 遗留 / 后续

- 需要补的测试：桥接层（VM 夹具）断言「回访不计次、消息计次、重启后 `wakeBudgetTimes` 不丢」。
- 需要改的文档：`docs/PITFALLS.md` #90 已记；设置页「Token 防爆破」说明已补 `replyCheckFree`。
