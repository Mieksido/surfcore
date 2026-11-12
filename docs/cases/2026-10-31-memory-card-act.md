# 记忆卡手动操作 `item is not defined`

- **日期**：2026-10-31
- **现象**：记忆卡面板里置顶/忘记/确认提醒/手动记一条/恢复自动/恢复备份等按钮报 `item is not defined`，界面不刷新；只有立即整理、压缩、合并、设为初次相遇正常。
- **根因**：`MemoryCardPanel` 的 `act()` 最后一个 toast 分支残留了更新下载面板的 `item.staged`，该变量不在作用域。
- **时序**：POST 已发出 → 服务端可能成功 → 拼 toast 时抛 ReferenceError → catch 显示错误 → `await reload()` 被跳过。
- **修法**：
  - 删除 `item.staged`，fallback 固定为「✓ 已更新」；
  - 把 `reload()` 放到 toast 之前，并用 try/catch 包住；
  - toast 自身也 try/catch，文案异常不再阻断刷新；
  - 失败时仍先 reload，再显示错误。
- **影响**：所有走 `act()` 的记忆卡操作恢复；服务端已成功但界面未刷新的情况也会正确回显。
- **验证**：`node scripts/test-memory-card-act.mjs`；`npm run test:audit`。
