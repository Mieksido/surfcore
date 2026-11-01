# 记忆卡“忘记/取消置顶”无效（初次相遇锚点）

日期：2026-11-01

## 1. 现象

用户在「记忆 → 高级」里点“忘记”，弹确认后记录还在；点“取消置顶”后记录又变回置顶。普通记录不一定复现。

## 2. 根因

1. **`refreshInitialState` 每次读卡都强制 `firstMet.pinned=true`**  
   `pin` 把 pinned 写成 false 后，下一次 GET / 重新读取又把它写回 true。
2. **`forget` 过滤条件保留 pinned 记录**  
   `filter(item => item.id !== id || item.pinned)`；初次相遇/置顶记录永远删不掉。
3. **UI 对 pinned 记录禁用“忘记”，但不解释**  
   用户只能看到按钮没反应；如果服务端拒绝，也只给一句泛化错误。
4. **`act` 静默吞掉 reload 失败**  
   服务端已保存/拒绝，但界面刷新失败仍显示成功提示，记录看起来还在。
5. **`firstMet` 与 `pinned` 语义绑死**  
   初次相遇既不能取消置顶，也不能忘记；“恢复自动/改指定”是唯一出口，但界面没讲清。

## 3. 修法（B 方案：拆开 firstMet 与 pinned）

- `refreshInitialState`：
  - `firstMet` 记录只在**新成为初次相遇**时自动置顶；
  - 已有 `firstMet` 的 `pinned=false` 会被保留，不再每次刷新复活；
  - `anchor=true` 仍标记初次相遇锚点，但不等于用户置顶。
- `sectionize`：
  - `## 初次相遇` 只看 `firstMet`，不再要求 `pinned`；
  - 取消置顶后它仍留在初次相遇分区。
- `forget`：
  - 允许删除任意记录（含 pinned/firstMet）；
  - 删除后调用 `refreshInitialState`，让下一条最早主人互动接管；
  - 不存在时返回 `MEMORY_NOT_FOUND + hint`。
- `pin`：
  - 取消置顶对 firstMet 真实生效；
  - 不存在时返回 `MEMORY_NOT_FOUND + hint`。
- UI：
  - “忘记”不再因 pinned 禁用；初次相遇确认框提示会接管；
  - `reload` 失败显示“服务端已保存，但界面刷新失败”，不再假装成功；
  - 错误 toast 带 hint。

## 4. 生效

- 重启 DSH 插件；
- 现有 firstMet 记录默认仍置顶；用户取消后保留 false；
- 旧卡第一次刷新仍会自动置顶（兼容），之后尊重用户选择。

## 5. 验证

```text
node scripts/test-memory-card.mjs        # 26 passed
node scripts/test-memory-card-act.mjs
npm run test:audit                       # 119/119
cd plugins/surfcore && npm test          # 0 失败
```

覆盖：

- 初次相遇取消置顶后 refresh 不复活；
- 初次相遇仍出现在初次相遇分区；
- forget 允许 pinned/firstMet，删除后重算接管；
- reload 失败必须提示；
- UI 不再禁用 pinned 记录的忘记。

## 6. 风险

- 删除初次相遇后会自动选下一条最早主人互动，用户可能不想自动换人；确认框已说明。
- 取消置顶的初次相遇仍留在提示词/初次相遇分区，只是不再属于“锚点置顶”；这是有意语义。
- 旧卡 `firstMet=true,pinned=false` 现在会被尊重，不再自动修正；可能和旧视觉预期不同。
- 全量卡有归档副本；衰减卡删除不可逆。
- 没有真实浏览器点击 live 测试；用单测与静态契约。
- 维护器/归档路径也会 refresh；需要后续真实数据观察。
