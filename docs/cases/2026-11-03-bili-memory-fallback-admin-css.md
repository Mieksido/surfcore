# B站记忆旧数据回退 + 管理员输入框超框

日期：2026-11-03

对应：GitHub issue #36

## 状态

issue 的 4 条：

| # | 问题 | 当前 |
|---|---|---|
| 1 | listenTick `L` TDZ | 已修 |
| 2 | 跨午夜窗口被 `inWindow` 算错 | 已修 |
| 3 | B站记忆只读账号级 | 角色级已修；本批补旧数据回退 |
| 4 | 管理员卡片输入框超框 | 本批修 CSS |

## Bug 3：旧数据回退

`src/bili-memory.js`：

- 角色级路径优先：
  ```text
  characters/<id>/bili/
  ```
- 角色级缺文件时，只读回退账号级：
  ```text
  ~/.dsh/surfcore/bili/
  ```

实现：

```js
const accountBili = paths.bili;
if (biliDir) paths.bili = biliDir;
const ledgerFile = (name) => {
  for (const dir of [paths.bili, accountBili]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return path.join(paths.bili, name);
};
```

四处读取都走 `ledgerFile()`：

- `whale-diary.md`
- `scores.json`
- `favorites.json`
- `quota.json`（评论账）

效果：

- 新角色有文件 → 读角色级；
- 角色级缺文件 → 读账号级旧数据；
- 新数据仍写角色级，不会把账号级旧文件覆盖。

## Bug 4：输入框盒模型

`plugins/surfcore/lib/client.js`：

```css
.qbw-input,.qbw-select,.qbw-textarea {
  box-sizing: border-box;
  ...
}

.qbw-admin-field .qbw-input,
.qbw-admin-field .qbw-select {
  min-width: 0;
  width: 100%;
  max-width: 240px;
}
```

- `box-sizing:border-box`：`width:100%` 不再额外加 padding/border 溢出；
- `max-width:240px`：宽屏不再把输入框拉满整格。

240px 是参考值，仍建议按实际 DSH 宽度/缩放实机看。

## 没有做

- 没有迁移账号级旧文件到角色级，只做只读回退。
- 没有改 `qbw-input` 的 `min-width:180px` 全局值。
- 没有做 CSS 截图回归，只做静态规则测试。
- 没有处理 4 个输入框之外的卡片宽度。

## 风险

- 只读回退可能把上一个角色的旧账号级数据读进新角色；如果多角色共用账号级旧文件，需要用户手动迁移/清理。
- 新角色写角色级，旧账号级不会被自动更新，长期仍是两份。
- `max-width:240px` 在不同屏幕/缩放下可能过窄或过宽。
- `box-sizing` 改变所有基础输入控件尺寸，可能让其他卡片布局略变。
- 静态测试不能保证视觉不重叠。

## 验证

```text
node scripts/test-admin-input-css.mjs
node scripts/test-bili-workspace.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
