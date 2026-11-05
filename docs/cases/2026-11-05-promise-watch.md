# 约定提醒：从「记得住」到「到点会响」

> 这是 B 项目（dsh-memory-brain）六件记忆能力里的第 5 件。前四件见
> [记忆检索](2026-11-05-memory-rag-index.md)、[星图](2026-11-05-brain-live.md)。

## 现象

- **原来只有「记住」，没有「想起来」**：`src/memory-card.js` 早就能把「答应」「约定」「说好」「下次」这类
  说法识别出来（`PROMISE_RE`，`:106`），带日期的还会标成 `kind = 'promise'`（`:1176`）。但识别完就躺在
  记忆档里，**没有任何东西会在到点那天提起它**。她「答应过你」和「记得答应过你」是两件事。
- **影响面**：不丢数据、不花钱，但这是一个**信任缺口**——用户说「你不是答应我了吗」的时候，
  她翻得到、却不会主动说。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.x |
| SurfCore 版本 | 0.8.8（HEAD `0deb826`，编辑会话不改 version） |
| 安装方式 | git（`src/bridge.js` 带 skip-worktree） |
| 其它相关版本 | Node v26.13.0 |

## 根因

- 代码位置：`src/memory-card.js:106`（`PROMISE_RE`）、`:1176`（`kind='promise'`）；缺口在**桥接侧**
  没有任何定时器去读这些记录。
- 问题链条：
  1. 摄取期把「明天一起去猫咪小镇」写成一条记忆，`kind='promise'`；
  2. 到期那天没人读它 —— 唤醒只在**有人说话**时发生，没人说话就不会醒；
  3. 于是「约定」退化成一个可以随时翻出来的档案，而不是一件会被想起的事。
- 为什么之前没发现：`PROMISE_RE` 看上去已经「处理了约定」（它确实识别了），
  所以从没人问「然后呢」；而这类缺陷只在**长时间不说话的会话**里暴露，日常联调撞不上。

## 完整逻辑（给用户看的那一遍）

- **链路**：
  - 数据源：`<角色目录>/memory/memory-card-full.jsonl`（唯一真相，只追加）。
  - 60 秒一次的 `promiseTick()`（`src/bridge.js`）→ 5 分钟节流扫档 → `promiseWatch.syncLedger()`
    把带日期的约定并进旁挂账本 `<角色目录>/promise-due.json`。
  - 到点且到窗口 → `scheduleWakeV2(key, 'promiseDue')` → `buildWakePromptV2` 注入【到期的约定】→ 她按正常
    唤醒逻辑说话。
  - 控制台：`GET /api/promise/list`、`POST /api/promise/status`、`POST /api/promise/tick`。
- **机制**：**先记后投**。排唤醒之前先把这个 id 的 `firedDay` 写进账本，写不进去就不投 —— 否则每 60 秒
  重复提醒一次。同理白名单外/窗口外**不标已提**，留着明天还能提。
- **爆炸半径**：1 个进程 × 2 个读者（桥接自己、控制台）× 静默=3 = **6 分**。碰用户数据（记忆档只读，
  账本是新文件），不碰密钥，**不花钱**（唤醒走既有的额度与暂停闸门）。
- **取舍**：
  - A「复用 `ledger-suggest` 那套建议候选」→ 那套是**主动找话**，语义不对，且它有自己的节奏与额度。
  - B「新写一个旁挂账本 + 独立 tick」（选中）→ 与记忆检索、星图、purpose 都不耦合；关掉只需
    `promiseWake.enabled=false`，账本留着不丢。
  - 直接 `deliverPrompt` 而不走 `scheduleWakeV2` 被明确否决：那会绕过白名单 / 暂停 / 繁忙 / 额度四道闸。
- **生效与重启**：读它的进程是桥接（`src/bridge.js`）→ **改完要重启桥接**。控制台接口随桥接一起。

## 修法

- `src/promise-watch.js`（428 → 约 470 行，纯函数 + 旁挂账本，不碰桥接）：
  - 新增 `inReminderWindow(now, config)`：闭开区间 `[at, until)`，`at === until` 视为不限结束，支持跨零点。
  - `DEFAULT_PROMISE_CONFIG` 加 `until: '22:00'`；`normalizePromiseConfig` 用统一 `clock()` 校验 `at` 与
    `until` 的范围（原来 `'25:99'` 能通过形状校验，变成永远到不了的钟点）。
  - `DUE_PATTERNS` 的 afterdays 认 `N天|N日`（原来中文「二十三日后」解析成 null）。
- `src/bridge.js`（带 skip-worktree）：
  - `import * as promiseWatch`（**必须命名空间**：`audit-bridge-harness.mjs` 是剥 import + 注入 VM 全局）。
  - `cfg.promiseWake = promiseWatch.normalizePromiseConfig(...)`；启动时 `startPromiseLoop()`。
  - `promiseTick()` / `buildWakePromptV2` 的 `promiseDue` 分支 / `WAKE_PRIORITY.promiseDue = 24` /
    `TIMER_WAKE_REASONS` / `sendWakePromptV2` 的 `autoWake` 集合 —— 四处漏一处就会各自出不同的坏事
    （见「验证」里的反向验证）。
  - 三条控制台路由。
- 为什么选这个方案：把「什么时候提」全部收进一个纯函数里的窗口判断，桥接只负责调它。这样深夜弹提醒
  这类只在半夜出现的 bug 可以用单测钉死，不靠联调撞。
- 回滚方式：`promiseWake.enabled: false`（账本保留）；要彻底回退就删掉 `import` 那行与
  `startPromiseLoop()` 调用，`promise-due.json` 留着不影响任何既有功能。

## 验证

- **自动化**：
  - `scripts/test-promise-watch.mjs` **22/22**（含 `config.example.json` 必须有 `promiseWake` 段且与代码
    默认值一致）。
  - `scripts/test-promise-bridge.mjs` **16/16**（VM 夹具走真实 `src/bridge.js`，含 3 条控制台路由；
    其中两条是 2026-11-06 端到端事故后补的，见下）。
  - `npm run test:audit` **151/151**（**在 `main` 上**；在 `dev` 上是 150/151，唯一那条是
    `test-release-manifest.mjs`：清单是「已发布状态」的产物，dev 上必然对不上 —— 不是回归）；
    `npm run test:regressions` 17/17；`npm run test:brain` 全绿。

### 端到端真机验证（2026-11-06 00:01–00:13）→ 抓到一个测试没覆盖的真 bug

第一次真实投递（00:01:02 排唤醒 → 00:01:10 起会话 → 00:01:19 发送 2/2 条成功）**发出去的却是
「还没睡？」「白天那只金蝴蝶，你点开看了没」——完全没提约定**。`firedDay` 已写下，账本显示「已提」，
但用户根本没听到。这是比「提醒晚一点」严重得多的形态：**记了却没说**。

- 定位手段：`state/context-telemetry-bridge.jsonl` 里 kind=`wake` 那条的 `layers`；
  事故那次 `promise = 0`（`base = 11038`），说明提示词里那段根本没生成。
- 根因：**`buildWakePromptV2` 在一次唤醒里会被调用两次** —— `scheduleWakeV2`（`src/bridge.js:15549` 附近）
  先建一份用于排队/日志/额度，`deliverPromptNow`（`:13623`）建完 DSH 会话后再建**真正投递**的那一份
  （重建是有意的：排队期间可能来了新消息、token 也可能轮换）。而待提条目当时是「读的时候顺手删」，
  于是**第一次调用把条目吃掉，第二份拿到空串**。
- 修法（两处）：
  1. `buildWakePromptV2` 只读不删；超过 10 分钟的旧条目才丢弃（兜住「排了但一直投不出去」）；
  2. 删除挪到 `deliverPromptNow` 的**接受点**，与星图 `brainLastInject` 同一口径：投出去了才算提过。
- 复验：重置 `firedDay` → 重启 → 00:12:56 重新排唤醒 → 00:13:04 起会话 → 00:13:13 发送 2/2 条成功，
  `layers.promise = 145`，真机第一句是「对了，还有个事 / 你之前说要介绍几个朋友给我，这事还算数不」——
  自然提起、没念日期。账本 `firedDay = 2026-11-06`。
- 新增两条用例按**真实调用序**写：连调两次 `buildWakePromptV2`，两份都必须带约定；再走一次
  `deliverPrompt`，断言接受后 `promiseWakePending` 才被清掉。
- **失败路径**：
  - 账本写盘失败 → 回滚内存、这一轮不发（`promise.save-failed` 500）。
  - 白名单外 → 不排唤醒、不标已提（`firedDay` 保持空）。
  - 状态值非法 → `promise.not-found` 404，不动已有状态。
  - 投递被拒/被闸门挡下 → 待提条目**保留**（还没说出口），10 分钟后过期丢弃。
- **反向验证（都做过，且都变红后被恢复）**：
  | 改坏什么 | 谁变红 |
  | --- | --- |
  | 去掉白名单预检查 | 白名单外那条 FAIL |
  | `promiseDue` 从 `autoWake` 拿掉 | 发送失败暂停那条 FAIL |
  | `ledger = synced.ledger` 退回 `promiseSaveLedger(synced.ledger)` | 3 条同时 FAIL |
  | `inReminderWindow` 退回「只有下限」 | 2 条窗口用例 FAIL |
  | `/api/promise/tick` 改成会写账本 | 「排查接口不能改账本」FAIL |
  | `config.example.json` 删掉 `promiseWake` | 模板那条 FAIL |
  | 退回「建提示词时就删条目」 | 「同一份提示词建两次」FAIL（`/猫咪小镇/` 不匹配） |
- **手工/集成验证**（真实档案 118 条）：
  ```
  认出带到期日的约定 = 1
     2026-11-05 | private:3532251800 | 明天可以给你介绍几个新朋友
  默认配置 = {"enabled":true,"at":"10:00","until":"22:00","maxPerDay":3,"graceDays":2}
  现在 = 2026/11/5 22:13:49 → 在提醒窗口内 = false   ← 今晚不会打扰
  明早 10:30 在窗口内 = true
  ```
  另两条含时间词的是「回头」「以后」这类**没有具体日期**的说法，模块正确地没有采纳 —— 宁可漏，
  不可编。锚点语义也对：这条记录写在昨天，所以正文里的「明天」= 今天。
- **端到端**：已在 2026-11-06 00:13 真实 QQ 上验证通过（见上），不再是「待观察」。

## 遗留 / 后续

- **已观察完毕**：首次真实到点投递就是修掉那个「取走即删」bug 之后的那次（00:13）。
- 「过期约定」的提示词仍说「别像闹钟一样念日期」，但过期时日期恰恰是唯一线索 —— 措辞待改进。
- `config.json` 的 `promiseWake` 段是本次加进本地文件的；`config.example.json` 也同步了（并有测试钉住）。
- `config.json` 只在启动时读一次（`loadConfig()` 在 `:873`，无 `fs.watch`）：改窗口必须重启桥接。
  验证时临时改成 `[00:00, 00:00)`（闭开区间里 `at === until` 视为不限）来立刻试，测完已按备份恢复成
  `[10:00, 22:00)`，文件与 `config.json.bak-promise-live-1205` 逐字节一致。
- 第 3 件（FSRS 分）、第 4 件（建议候选）仍未开工。