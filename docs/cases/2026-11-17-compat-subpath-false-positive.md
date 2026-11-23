# 插件体检误报：`pkg/subpath` 的 Loader 行被当成第二个客户端来源

日期：2026-11-17

## 现象

- 用户看到的（原话是直接贴体检 JSON）：`ok:false`，两条要命的结论：
  - `COMPAT_CLIENT_MULTI_SOURCE` **blocker**：`billion-context` 被 `billion-context` 与
    `billion-context/dsh-compaction-gate` 两条 Loader 行解析到同一个客户端包，
    impact 写的是「DSH 重建 client-modules 会报 resolves from multiple active Loader sources，宿主启动失败」。
  - `COMPAT_COMPACTION_CONFLICT` **high**：billion-context 的 bundle patch 把 `compaction-basic` 的 `config.auto` 设成 false。
- 实际环境：DSH 正常跑（多个进程，17:47 启动），本会话的压缩/解压工具就是 billion-context 提供的，一直可用。
- 复现：设置 → 概览 →「插件体检」，profile 里装了 billion-context（外加 30 个 bundle、383 个包）。
- 影响面：不丢数据，但体检把「环境健康」判成 `ok:false`，用户会以为不该升级/不该重启；
  若照着 impact 去改 billion-context 的 patch，反而会弄坏它（注释里明确写了 gate 行承载 preset 等待的服务）。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11；DSH desktop（profile `E:\DSH\home\profiles\desktop`） |
| SurfCore 版本 | 0.8.9（HEAD `0ce8580`） |
| 安装方式 | git 仓库 + junction（`E:\DSH\home\plugins\surfcore` → `E:\DSH\surfcore\plugins\surfcore`） |
| 其它相关版本 | billion-context 0.1.215；DSH app.asar 209 MB（client-modules 内嵌） |

## 根因

- 代码位置：`plugins/surfcore/lib/compat.js` 的 `resolveLoaderPackage(raw, baseDir, packages)`。
  旧逻辑对裸说明符先做 `raw.startsWith(\`${pkg.name}/\`)`——只要 `pkg/subpath` 前缀命中就归属该包；
  没命中再 `path.resolve` 兜底。
- DSH 侧的真实契约（`app.asar` 内 `client-modules`）：

  ```js
  const expectedPackageName = pathLike ? void 0 : exactPackageSpecifier(loaderName);
  if (!pathLike && expectedPackageName === void 0) return void 0;   // 不归属任何包

  function exactPackageSpecifier(specifier) {
    if (specifier.startsWith('@')) {
      const parts = specifier.split('/');
      return parts.length === 2 && parts.every(Boolean) ? specifier : void 0;
    }
    return specifier.length > 0 && !specifier.includes('/') && !specifier.includes(':')
      ? specifier : void 0;
  }
  ```

  只有 `nearestPackage()` 解析到同一个 `packageName` 才会进 `sources`；
  `reconcilePackage` 只在 `sources.length > 1` 时 fatal。
  `billion-context/dsh-compaction-gate` 含 `/` 又不是 `@scope/name` → `undefined` → 不归属 → 不会 fatal。
- 为什么之前没发现：2026-11-03 修 `client-multi-source` 时，真重复用的是**相对路径**行
  （`./lib/qq-mode.js`），它在 DSH 里经 `nearestPackage` 确实归属；
  测试夹具也只有相对路径。子路径（`pkg/subpath`，host-only 模块）从没进过夹具。

## 完整逻辑

- **链路**：体检读 profile 的 `package.json` → `dsh.profile.bundles` → 每个 bundle 的
  `dsh.bundle.patch`（`node_modules/<pkg>/dsh.bundle.patch.yml`）→ 解析 `insert/modules` 行 →
  `resolveLoaderPackage` 归一成包 → 统计声明 `dsh.client.platform === 'web'` 的包被几行命中。
  同一份 patch 也被 DSH 的 client-modules 在启动/重放时读，所以体检必须和 `exactPackageSpecifier` 同构。
- **机制**：不是“哪行写错了”，而是**包归属算法**与 DSH 不一致：
  体检把「同包目录」等同于「同一个客户端包」，而 DSH 把「精确包名」等同于「归属」。
  子路径是 DSH 支持的 host-only 独立模块（不声明 `dsh.client` 就不参与 client 组合）。
- **爆炸半径**：1 个进程（体检） × 1 个读者（用户看报告） × 静默=3 → 3 分；
  blocker 会让 `ok:false`，属于“误判优先级”而不是数据损坏。
- **取舍**：
  - A：保持宽松前缀匹配，只在 `dsh.client` 声明时才记 source —— 仍会把子路径算进去，因为
    `billion-context/dsh-compaction-gate` 的父包确实声明了 `dsh.client`；pass。
  - B（选用）：在 `resolveLoaderPackage` 里复刻 DSH 的 `exactPackageSpecifier`：
    裸说明符必须是「精确包名且在 packages 里」，否则返回 `null`（=不归属）。
    相对路径 / 绝对路径 / `file://` 仍走 `nearestPackage`，因此真重复（`./lib/qq-mode.js`）照样报。
- **生效与重启**：`compat.js` 在 DSH 主进程里被 `import` 并驻留内存；改完要**重启 DSH**，
  GUI 里的「插件体检」才会用新逻辑（命令行 `node` 立刻生效）。

## 修法

1. `plugins/surfcore/lib/compat.js`
   - 新增 `exactPackageSpecifier(raw)`，与 DSH 同名函数逐字同构；
   - `resolveLoaderPackage` 裸说明符分支：

     ```js
     if (exactPackageSpecifier(raw) === undefined) return null;
     const byName = packages.find((pkg) => pkg.name === raw);
     return byName ?? null;
     ```

   （不再 `path.resolve` 兜底拼 `raw` 当相对路径。）
2. `COMPAT_COMPACTION_CONFLICT` 的严重度按“是否真的两套都没有”分级：

   ```js
   const bothOff = denied.length > 0;   // denied = 该插件名下被 QQ 策略注入的工具
   severity: bothOff ? 'high' : 'warn'
   ```

   工具全放行时标题改成「第三方上下文插件接管压缩，DSH 自动压缩按设计关闭」，
   impact 说明“仅 QQ 侧拒绝工具时才会两套都没有，保持现状即可”；被拒时仍是 high 并指向恢复 auto。
3. `scripts/test-plugin-compat.mjs`
   - 新夹具 `subpath-client`：同包 `exports` 有 `./client` 和 `./gate`，bundle patch 两行
     `subpath-client` / `subpath-client/gate`，断言**不报** MULTI_SOURCE；
   - 断言工具放行时 `compact.severity === 'warn'`；
   - 新增 `deniedScan`（`safeExact` 去掉 `compress`），断言压缩冲突升级回 `high`。

## 验证

```text
node scripts/test-plugin-compat.mjs          → ✅ 插件冲突体检通过
npm run test:audit                           → ✅
真实 profile：
  scanPluginCompatibility({dshHome:'E:/DSH/home', profileName:'desktop', surfcoreVersion:'0.8.9'})
  → ok=true；MULTI_SOURCE 消失；剩 1 条 warn（压缩接管，工具已放行）+ 12 条 info（工具清单未声明）
```

- 失败路径：如果 DSH 未来把子路径也归属到父包（改为按 patch 所属包判定），
  体检会重新漏报真重复；届时 `exactPackageSpecifier` 要跟着 DSH 的解析一起改。
- 没验证到的：没在真实 GUI 里重启后点一次「插件体检」（要重启运行中的 DSH，等用户决定）。

## 没有做 / 遗留

- 没动 billion-context 的 patch：它的 gate 行是必需的，auto=false 是配套设计。
- 没改 DSH 上游语义；体检只是对齐。
- 12 条 `COMPAT_TOOL_INVENTORY_UNKNOWN` 仍是 info：那些插件没声明 `dsh.tools`，属于“不知道”，不是故障。
- 改动尚未提交（当前仓库只有 `main`，`AGENTS.md` 约定的 `dev` 分支在本机不存在；等用户确认再提交）。
