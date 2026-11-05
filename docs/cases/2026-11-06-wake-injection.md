# 唤醒注入端到端：不等真实消息，也能证明「四段确实进了提示词」

- 日期：2026-11-06
- 范围：`scripts/test-wake-injection.mjs`（新增）、`scripts/test-release-manifest.mjs`（校验对象改成发布 tag）、`scripts/test-audit.mjs` / `package.json`（收录）
- 前置：第 1 件检索、第 4 件建议候选、第 5 件约定提醒、第 6 件联想都已接线

## 现象

四件记忆能力的单元测试各自全绿，但一直有一个悬着的问题：**它们同时存在时，真实唤醒提示词长什么样？**
真机上能观察的只有「等一条真实 QQ 消息」，然后去 `state/wake-telemetry.jsonl` 看 `layers.*` 的字数。
这条观察链有三个缺陷：

1. 时机不可控：没人说话就永远等不到；
2. 不可复现：等了三天也未必同时出现「正在回忆 + 有到期约定 + 有候选」；
3. 出问题时已经发生过了：00:01 那次真实投递里 `layers.promise = 0`，模型收到「约定到期」的唤醒原因却没看到约定正文，只能事后从日志反推。

## 为什么不能只加单元测试

`buildWakePromptV2` 是拼接层：它按固定顺序把十几段拼成一个字符串，段与段之间还有**互斥与去重**的约定
（例如检索命中时不再叠联想，否则同一件事说两遍）。这些约定属于「组合行为」，
单测每个模块都覆盖不到；而它又是同步函数、不依赖 DSH 与 QQ 网关——正好可以用 VM 夹具直接调。

## 做法

用仓库既有的 `scripts/audit-bridge-harness.mjs`（把真 `src/bridge.js` 读进 `vm`、剥掉顶层 import、
注入假网关与假 DSH）驱动**真**函数：

| 步骤 | 手段 |
| --- | --- |
| 铺记忆档案 | 往夹具 temp 的 `dsh/surfcore/memory/memory-card-full.jsonl` 写两条旧事 |
| 造「对方刚说的话」 | `h.appendSocialV2Message(key, '主人', text, …)`（`lastMsg` 取最后一条非自己消息） |
| 造缓存态 | 直接写 `h.associateCache` / `h.promiseWakePending`，等价于预取与 tick 已完成 |
| 读结果 | `h.buildWakePromptV2(key, reason)` 返回的字符串 |

七条用例：

1. 对方说「你还记得我屋里那根灯带吗」→ 出现【记忆检索…】且带正文，**不带记忆 id**；
2. 对方说「今天外面风挺大的」→ 不出现检索段；
3. 检索命中 + 联想缓存都有 → 只出现检索段（互斥）；
4. 没有检索触发 + 联想缓存有 → 出现【忽然想起】；
5. 有到期约定 → 出现【到期的约定】、正文与「别像闹钟一样念日期」；
6. **约定连建两遍都带**（回归 00:01 事故：消费点必须在投递接受之后）；
7. 私聊说「我不吃香菜」→ 入池后下一次唤醒带【可能值得记住的】。

## 结果

```text
node scripts/test-wake-injection.mjs   # 7/7
npm run test:audit                     # 157/157（连跑三次一致）
```

没有发现新的运行时 bug；价值在于把「只能事后解释」变成「提交前就能拦住」。
顺带修掉一处**审计恒红**：`test-release-manifest.mjs` 原来拿 `HEAD` 比清单，
而清单描述的是**已发布的那棵树**，dev 发布后继续提交必然对不上——一次性的抖动容易和真回归混在一起。
现在 HEAD 就是 tag 时仍用 HEAD，否则用最近的 tag 并打印一行说明。

## 遗留

- 夹具不连真实向量服务：这里验的是「提示词怎么拼」，`mode=hybrid` 的检索质量仍由 `test-memory-index` 与真机 `/api/memory/search` 覆盖。
- 投递链路（`deliverPromptNow` → DSH 会话 → QQ 发送）仍是桩；真实发送失败的分支由 `test-promise-bridge` 与 `test-memory-card-wiring` 覆盖。
- 真机首次「四段齐活」的唤醒仍值得看一眼遥测（`npm run check:wake`），但不再是**唯一**证据。