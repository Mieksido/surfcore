# DSH Desktop 下找不到真正的 node.exe

日期：2026-11-03

对应：GitHub PR #3 / issue #3

## 现象

DSH Desktop 点击「重启桥接」失败：

```text
找不到真正的 node.exe（当前解析到 …\DeepSeek Harness.exe）
```

`bridge.js` 只接受 basename 为 `node` / `node.exe` 的路径，所以拒绝启动。

## 根因

`plugins/surfcore/lib/paths.js` 的 `findNodeExe()` 只查：

```text
process.env.DSH_NODE
~/.dsh/dsh-runtimes/.../node.exe
C:\Program Files\nodejs\node.exe
```

没有查 DSH Desktop 安装目录：

```text
<Harness.exe 所在目录>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe
```

这些机器上 `~/.dsh/dsh-runtimes` 和 Program Files 都没有 node，于是回退：

```js
return process.execPath   // Harness.exe
```

调用方报错。

## 修法

### 1. 新增 `src/node-path.js`

统一 `findNodeExe()` / `isNodeExe()`：

- DSH_NODE；
- 安装目录 `resources/runtime/primary-runtime/.../node.exe` / `node`；
- 用户缓存 `~/.dsh/dsh-runtimes/...`；
- `C:\Program Files\nodejs\node.exe`；
- 都找不到才返回 `process.execPath`，保留明确报错。

`paths.js` 改为 re-export，旧 import 不变。

### 2. scheduler 复用

`plugins/surfcore/lib/scheduler.js` 删掉自己的 `findNode()`，改：

```js
const NODE_EXE = findNodeExe()
```

否则桥接修好了，B站 调度器仍可能拿 Harness.exe。

### 3. setup-dsh 的 MCP command

`scripts/setup-dsh.mjs`：

```js
let NODE_EXE = process.execPath;
try {
  const { findNodeExe } = await import('../src/node-path.js');
  NODE_EXE = findNodeExe(...);
} catch {}
```

`mcpEntries()` 用 `NODE_EXE`，避免把 `Harness.exe` 写进 profile 的 MCP command。

## 没有做

- 没有把安装目录候选做成配置项；DSH 未来换布局仍需更新候选。
- 没有强制 `DSH_NODE` 校验失败时报错；无效值会继续尝试其他候选。
- 没有改 `bridge.js` 的 basename 校验；它仍是最后一道明确报错。
- 没有做 Linux/macOS 完整运行时布局测试；只加了不带 `.exe` 的候选。

## 风险

- 安装目录布局硬编码；DSH 升级换目录会再次失效。
- 路径含空格：调用方必须用 spawn 参数数组，不能拼命令行。
- `setup-dsh` 复制到别处单独运行时没有 `../src`，退回 `process.execPath`；CLI 下仍是 node，但 Desktop 下仍可能是 Harness.exe。
- 已有 profile 的 MCP command 不会自动改；需要重跑 setup 或迁移。
- `findNodeExe()` 找不到时仍返回 `process.execPath`，错误由 bridge 报，不是 resolver 直接抛。

## 验证

```text
node scripts/test-node-path.mjs
node scripts/test-audit-setup.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
