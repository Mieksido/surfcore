# 闸门事件中心 + 单轮止血（L3）

- **日期**：2026-10-30
- **触发**：`billion-context` 的 `compress` 被 QQ 白名单拒，模型在单个回合里重试 197 次，
  46 分钟、约 ¥20；每日额度只在唤醒前检查，管不到已经开始的一轮。
- **范围**：统一事件分级 + 回合级步数/重复错误/额度熔断；本批不按闸门逐个改
  `L0/L1` 通知，也不做单轮费用上限（价格表未覆盖全部模型，先不放假上限）。

## 1. 链路

```
DSH session/event
  └─ bridge.pumpMux
       ├─ guardTurnEvent()
       │    ├─ turn/start   → turnGuard.begin
       │    ├─ tool/call    → 步数 +1
       │    ├─ tool/result  → 同 tool+error 计数
       │    └─ assistant/message / tool/result → 回合内额度检查
       ├─ 超限 → recordTurnStop()
       │    ├─ gateEvents.record()       （~/.dsh/surfcore/gate-events.jsonl）
       │    ├─ api.cancelTurn(sessionId) （只取消 turn，不清 inbox）
       │    └─ sendToQQ() 直接通知
       └─ turn/end → turnGuard.end

插件
  GET /gate-events          → 列表/计数
  POST /gate-events         → ack / ack-all
  client.js                 → 概览「安全提醒」卡片；L2/L3 弹窗
```

## 2. 机制

- `turnGuard` 只管三件事：
  1. 单轮工具步数 > 40（默认，可配置 `socialV2.turnGuard.maxSteps`）；
  2. 同一 `tool + 归一化错误` 重复 ≥ 3（默认）；
  3. 回合内每日额度已耗尽（桥接 `evaluateBudget`）。
- 达到条件后：
  - 写 `gate-events.jsonl`，`kind=cost/fault`、`action=stopped`；
  - 调用 **cancel-only** 的 `session/cancel`，不调用会清 inbox 的 `stopSessionWork`；
  - 直接发 QQ 提示“本轮已停止”，不依赖模型再生成文字；
  - 用户确认（UI ack）后不再自动弹同一事件。
- 分级由 `src/gate-events.js` 统一决定：同一闸门可 L0–L3；`action=stopped` 的回合止血固定 L3。
- 事件文件默认 2MB 轮转；ack 存在 `gate-events-ack.json`。

## 3. 爆炸半径

- 改的是桥接 `pumpMux` 的每条 `session/event`；阈值只在命中时触发；
- 直接发 QQ 消息，但只在本轮被停止时发一条；
- 写 `~/.dsh/surfcore/` 两个小文件；不碰配置、密钥、记忆卡；
- 最坏情况：误判导致正常长任务被 cancel；可回滚/调高阈值。

## 4. 取舍

- **A：只做兼容性体检**（已做）——只能提前警告，不能止损。
- **B：在 bridge 做回合 watchdog + cancel**（本批采用）——能止损；缺点是桥接不在模型调用链上，
  只能在下一条事件到达时停，不能保证正在进行的模型请求立刻停止计费。
- **C：改 DSH 宿主做 pre-call 预算**——最彻底，但跨宿主改动大、版本兼容风险高；不在本批。

本批选 B，并明确“单轮费用上限未做”，避免用一个不准的价格表做假闸门。

## 5. 生效与重启

- 改 `src/bridge.js` / `src/dsh-client.js` / `plugins/surfcore/lib/*`：
  - **重启 DSH** 加载插件代码；
  - 桥接由插件启动时拉起；桥接重启后 guard 生效。
- 不需要改 `config.json`（默认阈值即生效）；要改阈值需手工写
  `socialV2.turnGuard`，当前无设置页入口。

## 6. 验证

```bash
node scripts/test-gate-events.mjs       # 分级、ack、脱敏、步数/重复错误/预算
node scripts/test-audit-bridge.mjs      # 桥接 VM 夹具，确认注入/装配没坏
npm run test:audit                      # 88/88
plugins/surfcore npm test               # 插件侧
```

未手测：真实设置页 L2/L3 弹窗、真实 DSH 回合中 cancel 的时延/计费停止边界。

## 7. 回滚与残余

- 回滚：移除 `src/turn-guard.js`、`src/gate-events.js` 的接线，恢复 `pumpMux` 不调用
  `guardTurnEvent` 即可；事件文件可保留/删除，不影响配置。
- 残余：
  - **单轮费用上限未做**（价格表未覆盖 `deepseek-v4.1-flash-1017` 等）；
  - 只能在下一条事件到达时停止，无法保证已发出的模型请求立刻停止计费；
  - L0/L1 生产者还没逐个接入（白名单/控制台/出站等仍走原日志）；
  - 阈值无 UI，默认 40 步/3 次；
  - 端口/进程检查仍不在体检里。
