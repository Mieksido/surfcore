# SnowLuma 未启动时不再弹“断线”告警

- **日期**：2026-10-31
- **现象**：只开 SurfCore 设置页、还没启动 SnowLuma，就弹“SnowLuma 未连接”L2 告警。
- **根因**：桥接启动后 WS close → 30 秒观察窗口 → `notifySendChannelDown()`；UI 只看 `bridge.running`，没看“本次是否真的连过”。
- **修法**：
  - `snowlumaHealth.everConnected`：WS `open` 成功才置 true；
  - 未连过时只写日志，不写 gate event、不弹 L2；
  - `/api/status` 返回 `everConnected`；插件 overview 透传；
  - UI 只在 `bridge.running && snow.everConnected === true` 时显示连接异常。
- **效果**：
  - 没启动 SnowLuma → 不弹报错；
  - 一旦连过又断开 → 仍会告警；
  - 启动 SnowLuma 成功 → 自动置 everConnected。
- **验证**：`node scripts/test-snowluma-startup-warning.mjs`；`npm run test:audit`。
- **回滚**：去掉 everConnected 条件即恢复旧行为（不建议）。
