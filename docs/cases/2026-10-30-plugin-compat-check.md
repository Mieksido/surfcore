# 插件冲突体检（发现 billion-context 工具被 QQ 策略拒绝）

- **日期**：2026-10-30
- **触发**：用户反馈「设了每日 token 上限，到上限还在跑，一轮烧 20 块」；上游是第三方
  `billion-context` 注入的 `compress` 工具被 QQ 安全白名单拒绝，模型反复重试。
- **范围**：只读静态体检，第一版不做自动修复，不启动/停止任何服务。

## 1. 链路

```
DSH profile
  package.json / cordis.patch.yml / node_modules/*
        ↓
plugins/surfcore/lib/compat.js
  - listProfiles / collectPackages
  - ruleForPackage（billion-context 等已知规则）
  - SAFE_EXACT_TOOLS / SAFE_TOOL_PREFIXES（qq-tool-restrict 导出，唯一来源）
  - findCompactionAutoOff（profile patch + bundle patch）
        ↓
GET /dsh-surfcore/api/compat/scan
        ↓
设置 → 概览 → 更新卡片旁的「插件体检」
        ↓
CompatModal：问题等级 / 证据 / 影响 / 建议 / 未覆盖项
```

## 2. 机制

- 体检**只读** profile 的 `package.json`、`cordis.patch.yml`、`node_modules` 包和
  `surfcore.compat.json`；不执行第三方插件代码。
- `billion-context@0.1.209` 命中已知规则，5 个工具（`compress/decompress/search_context/acp_status/acp_cache`）
  不在 QQ 允许列表 → `COMPAT_TOOL_DENIED`，`confidence=inferred`（工具名来自已知规则，不是运行时枚举）。
- 同时读到 `compaction-basic` 的 `config.auto=false` → `COMPAT_COMPACTION_CONFLICT`，
  `confidence=confirmed`（来自实际配置）。
- 未声明 `surfcore.compat.json` 且没有已知规则的插件 → `COMPAT_TOOL_INVENTORY_UNKNOWN`，
  `confidence=unknown`。**不能把“没查到”当“没有冲突”。**

## 3. 爆炸半径

- 只读文件/配置，不写用户配置，不碰密钥，不启动服务；
- 影响面在设置页一个弹窗；
- 报告里的 profile 路径是本机路径，不包含 token；
- 未覆盖项明确列出：端口/进程归属、运行时工具拒绝/重复回复、任意第三方自定义状态路径。

## 4. 取舍

- **A：只做工具权限交叉**（成本最低，但解释不了“为什么压缩也没了”）。
- **B：工具权限 + 上下文接管一起查**（本版采用；能解释 billion-context 的完整冲突）。
- **C：把端口/进程/运行时行为一起塞进第一版**（成本高、误报多；本版明确标未覆盖，留到 P1）。

选择 B，并在报告里带 `confidence` 与 `unknown`，避免“兼容性评分”式假承诺。

## 5. 生效与重启

- 代码在插件进程里，**重启 DSH 后生效**；
- 不需要重启 QQ 桥接（体检不碰桥接）；
- 扫描时不需要启动 SnowLuma/语音包。

## 6. 验证

```bash
node scripts/test-plugin-compat.mjs   # 夹具：billion-context 被拒/压缩接管/未知插件/放行后可解释
npm run test:audit                    # 含 test-plugin-compat
plugins/surfcore npm test             # 插件侧回归
```

真实 profile 扫描（本机 desktop）：

```bash
node --input-type=module -e "import('./plugins/surfcore/lib/compat.js').then(m=>console.log(m.scanPluginCompatibility({surfcoreVersion:'0.7.18'}).issues))"
```

预期：本机未装 billion-context 时 `ok=true`，仅对未声明工具的 UI bundle 给出 `info/unknown`；
装了 billion-context 的用户会看到 `COMPAT_TOOL_DENIED` blocker + `COMPAT_COMPACTION_CONFLICT` high。

## 7. 回滚与残余

- 回滚：删除 `compat.js`/`compat-rules.js`/`test-plugin-compat.mjs`，移除 `/compat/scan` 路由与
  UI 按钮即可；不改用户配置，无数据迁移。
- 残余：
  - 不能枚举所有第三方工具（`unknown` 必须显示）；
  - 端口/进程归属、运行时熔断不在本版；
  - 不自动修复、不禁用插件；
  - 已知规则需要随插件版本维护。

## 附：第三方声明接口（未来）

插件根目录放 `surfcore.compat.json`：

```json
{
  "schema": 1,
  "tools": [{ "name": "compress", "class": "model-context", "safe": true }],
  "capabilities": ["context-compression"],
  "ports": [],
  "configPaths": [],
  "requires": { "dsh": ">=0.2.1" }
}
```

体检只读该文件，不执行插件代码；没有声明就标 `unknown`。
