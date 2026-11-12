# 2026-11-06 · 全局体检后的安全优化

## 隐藏命令行开关

原问题：`launchMode` 默认 `detached` 时，`hideConsoles` 复选框实际上不起作用；用户取消勾选仍然隐藏。

修法：

- `platforms.hideConsoles` 默认改为 `true`（新装/未保存配置默认隐藏）；
- UI 初始状态按 `!== false` 判断，和后端默认一致；
- `launchSnowLuma()` 的 `launchMode` 默认跟随 `hideConsoles`：
  - 勾选 → `detached`（VBS 隐藏 + 脱离 DSH）；
  - 取消 → `legacy`（旧可见窗口）；
  - 显式 `snowluma.launchMode` 仍然优先。
- `config.example.json` 不再写死 `launchMode`，避免模板覆盖开关语义。

## SnowLuma WebUI 探活

`portOpen()` 支持 host 参数；`snowLumaWebui()` 返回 host；WebUI 探活/诊断/启动等待都用配置的 host，
不再固定只探 `127.0.0.1`。默认 host 仍是回环，功能不变。

## 验证

```
test-platform-start     OK
test:audit              153/153
```

## 仍刻意没动

- 不拆 `src/bridge.js`（17k 行）——大重构会引入比收益更高的风险；
- 不改同步 `saveSocialV2State()` 写盘策略——会影响持久化时序；
- 不迁移用户显式 `batchWindowMs=8000`——产品口径未定；
- 不把 agent 白名单从 `/api/socialV2/*` 改逐端点——需要完整鉴权审计；
- 不自动删除旧 apply 的下载任务——需要 AbortController 设计。
