# 更新面板显示「已是最新 v?→v0.8.9」：git 通道没报本地版本

- **日期**：2026-11-24
- **组件**：`plugins/surfcore/lib/updates.js`、`scripts/test-update-git-local-version.mjs`
- **触发**：用户在更新面板看到 `SurfCore 本体（已是最新 v?→v0.8.9）`，左侧版本永远是 `?`。

## 现象

- 检查更新结果：`status=latest`、`ahead=0`、`behind=0`，但界面写成 `v?→v0.8.9`。
- 只有「本体」这种走 **git 通道**的组件有问题；桌宠（走 release/version 通道）能正常显示 `v0.2.3→v0.2.3`。

## 根因

`inspectGitComponent()` 返回的对象里**没有 `installedVersion`**：

```js
const base = { id, name, dir: dir || String(component?.dir ?? ''), kind: component?.kind ?? 'component' };
```

版本号读取逻辑只存在于 `inspectVersionComponent()`（读 `<dir>/package.json` → `version.json` → `.installed-meta.json`）。
`client.js:2466` 渲染时写的是 `v${item.installedVersion ?? "?"}→v${item.latestVersion}`，于是 git 通道必然落到 `?`。

影响面：只要组件是 git 工作区（本体就是），即使一切正常，界面也会显示一个看起来像「读不到本地版本」的 `v?`，
容易被误读成更新检查坏了。功能本身（ahead/behind/blocked）不受影响。

## 修法

1. 新增模块级 `readLocalVersion(dir)`：`package.json` → `version.json`，读到就 trim 返回，都没有返回 `''`。
2. `inspectGitComponent()` 的 `base` 带上 `installedVersion: readLocalVersion(dir)`，所有 return 分支（no-git / not-a-git-repo / no-origin / detached-head / 正常结果）自动继承。

没有改 `inspectVersionComponent()` 的读取顺序，避免两条通道对「本地版本」给出不同答案。

## 验证

- `node --check plugins/surfcore/lib/updates.js` OK。
- 新增 `scripts/test-update-git-local-version.mjs`（临时目录 `git init` + `package.json` + 假 origin，`fetch:false` 不联网）：
  - 有 `package.json` 时必须 `installedVersion === '0.8.9'`；
  - 删掉 `package.json` 后必须是 `''`（不是 `undefined`）。
- 真实仓库只读校验：`inspectGitComponent({dir:'E:/DSH/surfcore'}, {fetch:false})` → `installedVersion: "0.8.9"`、`ahead 0`、`behind 0`。
- `npm run test:audit` 全量回归见提交说明。

## 遗留

- 界面 `fmtV()` 对空串仍有美化空间（例如显示「未安装」而不是 `v?`），本次只补数据源，不改文案。
- `versionStale`/`latestVersion` 的语义没有动：git 通道的 `latestVersion` 仍来自远端 `package.json`。
