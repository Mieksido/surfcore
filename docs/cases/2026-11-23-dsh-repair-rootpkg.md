# 2026-11-23 「修复 DSH 注册」点了就 500：rootPkg is not defined

## 现象

- 用户在 SurfCore 控制台点「修复 DSH 注册」，界面报 `API 失败： rootPkg is not defined`。
- `E:\DSH\home\surfcore\plugin.log` 记录：`13:33:12.659Z API 失败： rootPkg is not defined`。
- 插件本身是活的（`已激活 v0.8.9`），桥接连着 DSH（`dshReady=true`），只有这一个动作炸。

## 根因

`plugins/surfcore/lib/index.js` 的 `handleDshRepair()` 里要算仓库根，写的是：

```js
const repoRoot = path.dirname(rootPkg);
```

`rootPkg` 却只在 `readOwnVersion()` 内部定义（`index.js:116`）：

```js
const rootPkg = path.resolve(here, '../../../package.json');
```

两个函数互不相干，`handleDshRepair` 里没有任何 `rootPkg` 绑定 → 一执行就是 `ReferenceError`，
路由 catch 到后回 `API 失败：rootPkg is not defined`。这是 **v0.8.9 就带着的 bug**，不是 11-17 那三批改动引入的
（`git show 0ce8580:plugins/surfcore/lib/index.js` 里同一行同样写法）。

为什么测试没抓到：`scripts/test-dsh-health.mjs` 只做静态断言（插件里有没有 `handleDshRepair`、
有没有 `DSH_REPAIR_SCRIPT_MISSING`），从不真的执行这条路径——变量作用域这种错只有跑到才炸。

## 修法

把仓库根提到模块级，不再依赖别的函数的局部变量：

```js
const VERSION = readOwnVersion();
// 仓库根（plugins/surfcore 往上两级）。DSH 注册修复脚本、版本校验都从这里找；
// 2026-11-23 修：handleDshRepair 曾直接引用 readOwnVersion 里的局部变量 rootPkg，点了就 500。
const REPO_ROOT = path.resolve(PLUGIN_ROOT, '..', '..');
```

`handleDshRepair()` 里改成 `const repoRoot = REPO_ROOT;`。

用 `PLUGIN_ROOT`（`paths.js:16`，插件自己的目录）而不是 `QQBOT_ROOT`：仓库根永远在插件往上两级，
而 `QQBOT_ROOT` 是按「有 config.json + src/bridge.js」猜出来的运行目录，两者在自定义安装里可能不同。

## 验证

```text
node --check plugins/surfcore/lib/index.js        # 语法通过
# 解析结果
PLUGIN_ROOT = E:\DSH\surfcore\plugins\surfcore
repoRoot    = E:\DSH\surfcore
setup-dsh   = E:\DSH\surfcore\scripts\setup-dsh.mjs exists= true
node scripts/test-dsh-health.mjs                  # ✅ dsh-health 通过（含新增两条断言）
npm run test:audit                                # Audit suite: 153/153 scripts passed
```

新增的回归断言（`scripts/test-dsh-health.mjs`）：

- `ok(plugin.includes('const REPO_ROOT = path.resolve(PLUGIN_ROOT')`
- `ok(!/repoRoot\s*=\s*path\.dirname\(rootPkg\)/.test(plugin)`

## 残余

- 运行中的 DSH 已经把旧插件模块载入内存，**要点「修复 DSH 注册」不再报错，得重启 DSH** 载入新代码。
- 同类隐患只有这一处：全文件 `rootPkg` 只剩 `readOwnVersion` 里的定义和注释里的说明（`grep -n rootPkg`）。
- 「修复 DSH 注册」按钮本身仍然只跑 `scripts/setup-dsh.mjs`、不会重启 DSH（刻意设计，见 PITFALLS 相关条目）。
