# Phase 0A：上下文/成本遥测（只测量）

- **日期**：2026-10-31
- **范围**：只建立基线，不改变 prompt、工具可见性、会话策略、turn-guard 阈值。
- **用户决策**：先测量，再改工具契约与复合快照；本轮不做 Phase 1。

## 1. 链路

```
QQ / B站 / 桌宠 / 黑话学习
        ↓
DSH session/event
  ├─ turn/start
  ├─ assistant/attempt / assistant/message（usage）
  ├─ tool/call / tool/result
  └─ turn/end
        ↓
SurfCore 插件宿主
  ctx.on('session/event')
  ├─ tokenBudget.ingestEvent（原有，不改）
  └─ contextTelemetry.ingestEvent（本批新增，只读）
        ↓
~/.dsh/surfcore/context-telemetry-plugin.jsonl

QQ 唤醒
        ↓
bridge deliverPromptNow
  ├─ buildWakePromptV2（原有）
  └─ contextTelemetry.wake（本批新增，只读）
        ↓
<repo>/state/context-telemetry-bridge.jsonl
        ↓
scripts/context-telemetry-report.mjs
  → 基线报告（唤醒 / 模型调用 / 工具 / prompt 分段）
```

## 2. 机制

### 记录什么

- 唤醒：`wakeId`、key、sessionId、原因、prompt 总字符数、各 prompt 段字符数；
- 模型调用：turn、step、retry、phase、模型、provider、usage 四桶；
- 工具：工具名、callId、结果字符数、耗时、成功/错误；
- 回合：turn 起止、模型调用数、工具调用/结果数、耗时。

### 不记录什么

- 消息正文；
- 工具参数原文；
- 完整 prompt / 工具结果；
- 密钥、QQ 号以外可识别的隐私内容。

### observed / estimated

- usage、turn/step、工具结果字符数、prompt 字符数：**observed**；
- 系统提示、工具 schema、完整会话历史：**尚未拆分**，报告明确标缺口；
- 唤醒与模型调用的关联：插件事件没有 wakeId，按 `sessionId + 最近 wake` 近似归属，报告标 `coveragePct`。

### 写失败

- 遥测写入失败只关闭本进程遥测并写一条日志，**不影响 QQ/DSH 主链路**；
- 文件超过 8MB 轮转为 `.1`，不删除历史。

## 3. 爆炸半径

- 新增两个本地 JSONL 文件；
- 热路径增加同步 append，但失败被吞掉，不参与业务判断；
- 不改变任何模型可见内容、工具、guard、会话；
- 不影响 token 账本/额度。

## 4. 取舍

- **A：只在 token 账本里加总量**：改动最小，但无法回答“哪一步/哪个工具”。
- **B：在 bridge 和插件各加一套遥测**（采用）：覆盖所有会话 + QQ 唤醒语义；
- **C：等 DSH 提供完整请求体**：最准，但当前不可用；先用 observed/estimated 标注。
- 选择 B，但明确不把字符数换算冒充 token。

## 5. 生效与重启

- 插件遥测：重启 DSH 后生效；
- bridge 遥测：重启 QQ 桥接后生效；
- 不需要改配置；默认开启，本地文件。

## 6. 验证

```bash
node scripts/test-context-telemetry.mjs
node scripts/context-telemetry-report.mjs --json
cd plugins/surfcore && npm test
cd ../.. && npm run test:audit
```

覆盖：

- 流式 attempt + 最终 message 去重；
- 工具结果字符数/错误；
- 遥测不记录消息正文；
- 写入失败不抛；
- bridge/插件接线存在。

## 7. 基线怎么采

1. 重启 DSH + QQ 桥接；
2. 正常使用 3–7 天，或至少覆盖：
   - 群聊直接回复；
   - 私聊；
   - 主动唤醒；
   - replyCheck / timeout；
   - B站；
   - 桌宠；
3. 运行：

```bash
node scripts/context-telemetry-report.mjs
node scripts/context-telemetry-report.mjs --json > baseline.json
```

4. 记录当时的 commit / 模型 / preset / reasoningEffort；
5. 不在这段时间改 prompt/工具/guard，否则基线失效。

## 8. 回滚与残余

- 回滚：移除 `contextTelemetry` 接线；JSONL 保留不删；
- 未做：
  - 系统提示 / 工具 schema / 历史 token 的精确拆分；
  - 唤醒与模型调用的强关联（wakeId 贯穿 DSH 事件）；
  - 实时 UI 看板；
  - Phase 1 的工具契约/复合快照。
- 已知边界：`coveragePct` 不是 100% 时，按原因聚合只能作趋势，不能当精确账。
