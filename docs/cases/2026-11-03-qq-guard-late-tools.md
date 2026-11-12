# 晚注册的全局危险工具没有补装 QQ Schema 限制

日期：2026-11-03

对应：GitHub PR #42

## 现象

QQ preset 挂载后，如果有全局插件晚一步注册 `bash` / `pwsh` 等危险工具：

- `qq-tool-restrict` 启动时已经扫过一遍，不会再 `restrict`；
- 执行阶段 `ctx.tools.guard` 仍会拒绝；
- 但工具的 Schema 已出现在模型工具表里，模型能看到名字、描述和参数。

不是“能执行”，是“能看见、会误以为能用”。

## 根因

`plugins/surfcore/qq-tool-restrict.mjs`：

```js
for (const name of KNOWN_DANGEROUS_GLOBAL_TOOLS) {
  try { ctx.tools.restrict({ deny: [name] }) }
  catch { ... }
}
```

只在 apply 时执行一次；没有监听后续 `tools/change`。

## 修法

```js
const restricted = new Set()
function restrictAvailable(report = false) {
  for (const name of KNOWN_DANGEROUS_GLOBAL_TOOLS) {
    if (restricted.has(name)) continue
    restricted.add(name) // 先登记，防 restrict 同步触发重入
    try { ctx.tools.restrict({ deny: [name] }) }
    catch { restricted.delete(name); ... }
  }
}
restrictAvailable(true)
ctx.on?.('tools/change', () => {
  try { restrictAvailable(false) } catch (error) { console.error(...) }
})
```

- 成功的限制只安装一次；
- `restrict` 同步触发 `tools/change` 时不会重复；
- 晚注册的已知危险工具会在下一次变化时补装；
- 执行白名单保持不变。

## 没有做

- 没有处理工具移除后重新注册：`restricted` 只增不减，重新注册同名工具可能不再补装。
- 没有覆盖未知危险工具：静态名单之外的工具 Schema 仍可能暴露，执行白名单兜底。
- 没有改 DSH 的 restrict 语义。
- 没有真实 DSH 全量验收；只做 API 契约测试。
- 没有处理工具别名/改名。

## 风险

- `tools/change` 可能频繁触发；当前只遍历静态名单并用 Set 跳过，开销可控。
- 旧 DSH 没有 `ctx.on` 时不会补装，退回旧行为。
- 工具移除再注册可能漏限制。
- 静态名单不完整；执行白名单是最后防线，但 Schema 暴露仍可能误导模型。
- 事件监听器本身若抛错会打印日志，不影响主流程。

## 验证

```text
node scripts/test-qq-tool-restrict-events.mjs
node scripts/test-audit-security.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
