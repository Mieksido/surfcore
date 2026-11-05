# 记忆强度分：星图的 R 从「五档阶梯」换成真的 R/S/D

> B 项目（dsh-memory-brain）六件记忆能力里的第 3 件。前两件见
> [记忆检索](2026-11-05-memory-rag-index.md)、[星图](2026-11-05-brain-live.md)。

## 现象

- 星图的「时间推演」面板画的是 R 曲线，但这条曲线**不是**记忆的真实衰减：它是把卡面的
  `vivid/clear/fuzzy/trace/forgotten` 五档映射成 1 / 0.75 / 0.5 / 0.25 / 0.05，再按
  `applyDailyDecay()` 的「每天最多降一档」逐日推。同一条曲线里 `D` 恒为 `null`，`S` 记的
  其实是「第几天掉到冻结线」——**借了 FSRS 的字段名，装的不是 FSRS 的东西**。
- 后果是**两个不同的东西被画成一样**：一条刚被提起过、但卡面还停在 `clear` 的旧事，
  和一条半年没人提、卡面也是 `clear` 的事，曲线完全相同。前者其实很牢，后者已经在悬崖边。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.x |
| SurfCore 版本 | 0.8.8（编辑会话不改 version） |
| 其它相关版本 | Node v26.13.0（`node:test`） |

## 根因

- 数据源里**没有评分序列**：`memory-card-full.jsonl` 只有 `recallCount`（被再次提起 = 复习）、
  `decaySteps`（降过档 = 遗忘事件）、`lastSeenAt`/`createdAt`。真正的 FSRS 要每次复习的
  again/hard/good/easy，这里没有，也不该为了凑公式去编。
- 所以这次做的是**强度估计**而不是复现 FSRS 训练：
  1. `S`/`D` 初值由字段映射（重要度、`kind`、`tags`、`pinned`/`isInitial`）得到；
  2. 用上面两个计数按「遗忘先把 S 打下来、复习再拉回去」的次序重放；
  3. R 用 FSRS-4.5 的公开曲线形状 `R = (1 + 19/81 · t/S)^(-0.5)`（这条性质稳定：`R(t=S)=0.9`）；
  4. 事件发生的**时刻不知道**，只能假设均匀分布在 `createdAt..lastSeenAt`，并写进
     `assumedSpread` 字段——把假设摆在明面上，别当成事实。
- **不改 `memory-card.js` 的降档规则**：`targetClarity()` 仍是「卡面上写什么」的唯一真相。
  这里回答的是另一个问题——「现在有多容易想起来」。

## 完整逻辑

- 新文件 `src/memory-strength.js`（271 行，纯函数，不写盘不联网）：
  `retrievability` / `daysUntilRetention` / `stabilityForRetention`（互为反解）/
  `initialStability` / `initialDifficulty` / `replayHistory` / `strengthOf` /
  `retrievabilityInDays`（星图推演用）/ `strengthLabel`（牢·稳·松·摇·将忘）。
- **卡面上界**：清晰度档是「已经承认的事实」，R 取 `min(预测, 卡面档位)`。一条刚记下却被降成
  `forgotten` 的记忆，R 是 0.05 而不是 1；一条被钉住/最初/主人重要的记忆**不吃这个上界**，
  直接报卡面档位、且不给「到期/冻结天数」（它们不随时间淡忘，给天数就是撒谎）。
- `src/brain-decay.js` 改为只做「接线 + 星图认识的名词」：`decayCurveFor()` 出
  `shape:'fsrs-strength'`、`R0`、`S`（稳固度天）、`D`（1~10）、`dueInDays`、`daysToFreeze`、
  `frozenAtDay`、`assumedSpread`、`points`。曲线起点与 `strengthOf().R` **严格相等**。
- `src/brain-feed.js`：节点 `decay` 从 `{R,S:null,frozen,exempt}` 变成
  `{R,S,D,label,frozen,exempt}`——S/D 现在是真数字（页面的悬浮提示与时间推演面板直接用）。
- `public/brain.html`：时间推演改成三块瓦片（现在的 R / 稳固度 S（天）/ 难度 D），
  说明文案从「这条阶梯」改成「R 来自强度分，卡面清晰度只当上界」。

## 验证

```
node scripts/test-memory-strength.mjs   # 8/8（曲线定义性质 R(t=S)=0.9、单调性、重放次序、
                                        #   保护类不淡忘、卡面上界、推演起点一致）
npm run test:brain                      # feed 13 / replay 11 / bridge / page 全过
npm run test:audit                      # 152 个脚本：dev 上 151/152
                                        #   （唯一失败 test-release-manifest，dev 与已发布清单必然对不上）
npm run test:regressions                # 17/17
```

- **真实档案抽查**（2026-11-06，最近 30 条记录）：R/S/D 全部有限、推演曲线单调非增、
  `frozenAtDay` 与 `exempt` 自洽，0 异常。例：一条今天记下的 `vivid` 非保护记忆
  `S=3.86 / D=8.1` → 第 50 天跌破冻结线；同批「主人 + 高重要度」条目 `exempt=true`、曲线是平的。
- **反向验证**：把 `replayHistory` 的次序反过来（先复习后遗忘）→「次序确实被固定住」那条变红；
  把 `min(预测, 卡面)` 的 `min` 去掉 →「卡面上界」两条变红；把保护类也吃完上界 →「不随时间淡」
  变红。三处都恢复后才全绿。

## 遗留 / 后续

- **S 的语义变了**：旧 API 里 `decayCurve.S` 是「降到冻结线的天数」，现在是「稳固度（天）」；
  `frozenAtDay` 才是原来那个数。页面与桥接**必须同版本**发，否则瓦片会把 128 显示成「稳固度 S」。
  已写进 `docs/PITFALLS.md`。
- `dueInDays` 已经过了就报 0（不报负数）：调用方拿它当日程，0 和 -12 是同一件事。
- 事件时刻是均匀假设（`assumedSpread: true`）；将来若记录里能带上「哪次复习」的时刻，可以改成真重放。
- 第 4 件（建议候选）未开工。