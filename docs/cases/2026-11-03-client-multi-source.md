# 同一客户端包被两条 Loader 行解析：DSH 启动 fatal

日期：2026-11-03

对应：GitHub issue #35

## 现象

SurfCore 启用时，安装任意会改写 `modules` 行的 client bundle（如 `dsh-vision-router@3.1.0`），DSH 重启后：

```text
DesktopHostFatalError: dsh: startup failed: 1 required plugin did not activate
  - modules (required)
    AggregateError: client-modules: 1 client package failed to compose:
      - package surfcore resolves from multiple active Loader sources:
          "surfcore"
          "file:///.../node_modules/surfcore/lib/qq-mode.js"
```

单独启用 SurfCore 正常；装上 vision-router 才崩。

## 根因

`plugins/surfcore/package.json`：

```json
"dsh": { "client": { "platform": "web", "inject": [] } }
```

`plugins/surfcore/cordis.patch.yml`：

```yaml
- id: surfcore
  name: surfcore
- id: qq-mode
  name: ./lib/qq-mode.js
```

两条 Loader 行都从 `surfcore` 包目录解析：

```text
surfcore          → surfcore 包
./lib/qq-mode.js  → surfcore 包
```

DSH `@deepseek-ai/dsh-client-modules` 要求：

```text
一个客户端包只能有一个 active Loader source
```

冷启动走宽松路径，冲突不暴露；第三方 bundle 重放 `modules` 行时重建 ClientModuleRegistry，走严格校验：

```text
surfcore 两个来源 → compose 失败
modules 是 required → host fatal
```

## 修法

### 1. qq-mode 拆成独立 host-only 包

新增：

```text
plugins/surfcore/qq-mode/
  package.json   # name=surfcore-qq-mode，不声明 dsh.client
  index.js       # 原 lib/qq-mode.js 的实现
```

`cordis.patch.yml`：

```yaml
- id: qq-mode
  name: ./qq-mode/index.js
```

`lib/qq-mode.js` 保留为兼容 re-export，供旧测试/导入。

这样：

```text
surfcore            → surfcore 客户端包（唯一来源）
./qq-mode/index.js  → surfcore-qq-mode 独立 host-only 包（无 dsh.client）
```

client-modules 的 nearest-package 解析会找到 `qq-mode/package.json`，不再把第二行算成 surfcore。

### 2. 兼容体检补规则

`lib/compat.js` 新增 `COMPAT_CLIENT_MULTI_SOURCE`：

- 扫描 profile patch + 各 active bundle 的 `dsh.bundle.patch` 文件；
- 解析每条 Loader 行到最近 package.json；
- 统计声明 `dsh.client.platform === "web"` 的包被多少条行解析；
- ≥2 条 → blocker，带 sources、impact、recommendation。

## 没有做

- 没有改 DSH 上游 `client-modules` 的 fatal 语义。
- 没有删 `qq-mode` 行；DSH settings 的 `qq-mode` 命名空间保留。
- 没有改 profile 的 `dsh.profile.bundles`；嵌套 host-only 包不需要单独 bundle。
- 没有自动清理用户自己手写的重复 Loader 行；体检会报。

## 风险

- 嵌套包依赖 DSH 的 nearest-package 解析；如果未来 DSH 改成“按 patch 所属包”判定，需要改成顶级独立 bundle。
- `lib/qq-mode.js` 现在只是 re-export，旧代码若依赖其源码路径仍能导入，但不再是 Loader 行目标。
- 体检规则会读取所有 bundle patch；坏 YAML 会被跳过，不会阻塞体检。
- 旧 profile 若自己复制过旧的 `qq-mode` 行，仍需删掉；体检会标 blocker。
- 没有真实 DSH + vision-router 的 live 启动测试；需要实机冷启动确认。

## 验证

```text
node scripts/test-qq-mode-plugin.mjs
node scripts/test-plugin-compat.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
