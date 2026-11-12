# 2026-11-01 · DSH 升级后 QQ 会话没有 qq_* 工具，机器人只能收不能发

## 现象（用户报告）

- 主人 QQ 私聊 bot，入站正常（模型读得到），但回复从不出现；
- 唯一能送达的是「❓ agent 需要你回答」卡片（说明桥接主动发送通道可用）；
- 模型侧工具表只有 `bash/read/write/edit/glob/grep/compress`，**没有任何 qq_\***；
- 会话从凌晨创建、跨多次重启存活；DSH 刚从 0.2.1-rc.x 升级到 rc.5。

## 根因（两个独立故障面）

1. **profile 的 MCP 条目被升级摘掉**：`~/.dsh/profiles/<p>/cordis.patch.yml` 里
   `mcp-snowluma / mcp-snowluma-host / mcp-web-search-safe` 缺失（或 bundle 被摘）→
   新会话也拿不到 `qq_*` 工具；
2. **旧会话的工具表在创建时定死**：即使 profile 修好，01:40 创建的会话仍按当时的
   preset/工具表运行；`ensureSession` 只检查 `sessionPolicy`（模式+preset 名+owner），
   **不检查 DSH 侧会话实际的 `agentPreset`** → 一直复用坏会话。

## 修法（可见 + 可行动 + 自动恢复）

| 层 | 改动 |
| --- | --- |
| 新增 `src/dsh-health.js` | `checkProfileMcp()` 扫所有 profile 的 `cordis.patch.yml`，列出缺哪些 MCP；`presetMismatch()` 只在“实际 preset 有值且不同”时判坏（旧会话没记录不误删） |
| 桥接启动审计 | DSH 就绪后 `auditDshHealth()`：<br>① profile 缺 MCP → **L2 `dsh-profile-mcp-missing`**，建议 `node scripts/setup-dsh.mjs <profile>` + 完全重启 DSH；<br>② 已映射会话的 `agentPreset` 与当前配置不一致 → `retireSession()` 重建，写 **L1 `session-preset-rebuilt`**（列表里能看到哪些 key） |

## 验证

- 新增 `scripts/test-dsh-health.mjs`：三条 MCP 齐全/缺失/全坏/无 profiles 四种情况；
  preset 相同/不同/缺失；桥接必须调用审计、写事件、给 setup-dsh.mjs 建议；
- `npm run test:audit` 108/108；插件测试全绿。

## 用户的应急处置（升级前版本也会中）

```powershell
# 1) 恢复 profile 的 MCP + bundle
node scripts/setup-dsh.mjs desktop

# 2) 完全退出并重开 DSH（不是刷新页面）

# 3) 控制台里重置那条私聊会话（让它按新 preset 重建），或等升级后的自动审计
```

## 用户反馈的补充：模型自己跑不了 setup 脚本

用户在 0.8.4 里反馈：让模型跑 `node scripts/setup-dsh.mjs`，被桥接守卫拦下
（`工具 "ops_bash" 不在 QQ 桥接白名单内，已拒绝`）。

**这是设计正确**：QQ 会话里的模型没有本地工具权限（RULES「无本地工具」）。所以：

- 建议文案必须写「**宿主机终端**执行，QQ 里的模型跑不了」；
- `setup-dsh.mjs` **不会重启 DSH**（只写 profile 并打印重启提示），不存在“脚本把会话中断”；
- 跑完需要**完全退出并重开 DSH**；旧会话仍可能要在控制台重置一次。

0.8.5 的 L2 事件已按上述修正文案，并在 evidence 里标 `manualOnly: true`。

## 教训

**“会话创建后工具表就定死”必须当成契约检查**：只比对本地映射/sessionPolicy 不够，
要读 DSH 侧会话的真实 `agentPreset`；升级 DSH 后先查 profile MCP，否则会表现为
“能收不能发”的静默故障。

## 0.8.7：控制台「修复 DSH 注册」按钮（用户要求 A）

- 设置 → QQ → 高级设置新增「DSH 注册（MCP / bundle）」卡片：填 profile（可留空自动检测）→
  点「修复 DSH 注册」→ 后端执行 `scripts/setup-dsh.mjs`，返回输出；**不会自动重启 DSH**；
- L2 `dsh-profile-mcp-missing` 弹窗里直接带「修复 DSH 注册」按钮：点完显示“请完全退出并重开 DSH”；
- 失败路径结构化：`DSH_REPAIR_METHOD` / `DSH_REPAIR_BODY` / `DSH_REPAIR_PROFILE` /
  `DSH_REPAIR_SCRIPT_MISSING` / `DSH_REPAIR_FAILED`，都带 hint；
- 接口只接受 POST、只由用户点击触发（测试断言“不能自动执行”）。

以后 DSH 升级出问题，统一让用户来这里点这个按钮，再重启 DSH。
