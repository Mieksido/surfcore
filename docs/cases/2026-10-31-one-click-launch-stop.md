# 一键启动 SurfCore + 一键停止（QQ/B站/桌宠/语音）

- **日期**：2026-10-31
- **需求**：概览的一键启动整合成多选；按钮改名「一键启动 SurfCore」；
  下面增加「一键停止（全部）」；语音要选本地/云端分支；每项显示是否启动；
  切换 QQ/B站/桌宠/语音页看到的状态一致；失败必须可见并给建议。

## 1. 链路

```
设置 → 概览「一键启动 SurfCore」
  ├─ 多选：QQ（含 SnowLuma）/ B站 / 桌宠 / 语音
  ├─ 语音分支单选：voice-local / voice-cloud
  └─ 一键停止（全部）
        ↓
POST /dsh-surfcore/api/bridge
  action: start-selected / stop-selected
        ↓
plugins/surfcore/lib/index.js
  runLaunchAction()
    ├─ QQ：bridgeStatus → start/restart bridge → launchSnowLuma
    ├─ B站：startSchedulerNow / stopSchedulerNow
    ├─ 桌宠：petService.start / stop
    └─ 语音：callBridge /api/voice/packs/activate / stop
        ↓
launchStatus() → overview.launch
        ↓
概览状态 / QQ 卡 / B站卡 / 桌宠页 / 语音页（同一后端状态）
```

## 2. 机制

- **一项一个结果**：`items[]` 每项有 `id/label/ok/code/error/hint/detail`；不再是一个笼统的 `ok:false`。
- **启动顺序**：QQ → B站 → 桌宠 → 语音（语音依赖 QQ 桥接；桥接没起时给
  `VOICE_BRIDGE_DOWN` + “同时勾选 QQ”建议）。
- **停止顺序**：语音 → QQ → B站 → 桌宠。语音先停，避免 QQ 桥接先死留下孤儿进程。
- **SnowLuma 边界**：QQ 启动会按需打开已安装的 SnowLuma；一键停止**不会关闭 SnowLuma 本体**
  （本程序不控制第三方进程），UI 明确说明。
- **语音分支**：`voicePack: voice-local|voice-cloud`，对应本地/云端；未安装的选项标“未安装”，
  启动时给 `VOICE_PACK_NOT_INSTALLED` + 去语音页导入的建议。
- **状态来源唯一**：`overview.launch` 由 `bridgeStatus`、`schedulerStatus`、`petService.status()`、
  `/api/voice/packs` 统一生成；各页读同一后端，不在前端各存一份。
- **失败可见**：每项失败行 + `launchErr`（HTTP 网络/解析失败）+ `lastError` 状态行；
  全部带建议；前端不吞。

## 3. 爆炸半径

- 启动/停止会真实拉进程（QQ 桥接、B站生物钟、桌宠、语音包）；只在用户点按钮时执行；
- 一键停止不会删数据、不卸载；SnowLuma 不受影响；
- 启动失败不写“成功”；不会因为一项失败而静默跳过其他项（每项独立结果）。

## 4. 取舍

- **A：只加一个「一键启动全部」按钮**（不能选、不能停；不满足需求）。
- **B：多选 + 每项结果 + 独立停止**（本版采用）。
- **C：把桌宠/语音也合并进 QQ 启动**（不灵活；不选）。
- 停止采用“全部”而不是“按勾选”，避免用户忘记勾选导致残留进程。

## 5. 生效与重启

- 改插件代码；**重启 DSH** 后 UI 生效；
- 不重启桥接也能打开设置页，但启动/停止操作会按需要重启桥接；
- 语音状态依赖桥接运行；桥接未运行会明确报错。

## 6. 验证

```bash
cd plugins/surfcore
node scripts/test-platform-start-host.mjs   # mock ctx：start-selected 结构化失败、空选择、stop-selected 幂等
node scripts/test-client-contract.mjs       # 新按钮/多选/语音分支/停止
npm test
cd ../..
node scripts/test-launch-components.mjs
npm run test:audit                          # 90/90
```

## 7. 回滚与残余

- 回滚：恢复旧的 `start-all/start-qq/start-bili` 按钮，删除 `start-selected/stop-selected`
  与 `launch` 状态即可；无数据迁移。
- 残余：
  - 真实进程启停（尤其 SnowLuma、语音 4.7G 包）需要手测；
  - 语音包未启动时只显示“未运行”，没有自动打开语音页的深链；
  - 一键停止不关闭 SnowLuma 本体（设计边界，不是缺陷）；
  - 桌宠/语音状态依赖各自服务；服务不可达时显示错误，不猜测“已启动”。
