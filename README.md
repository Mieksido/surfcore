# SurfCore 0.8.9-dev

> 干净内核 + 冻结大适配器 + 单包 UI。  
> 旧 `src/bridge.js`、旧宿主、旧兼容层不在这个包里。

## 当前状态

```text
kernel/     干净内核：记忆 / 语音 / 目的 / 表达 / 识图 / 设置
runtime/    冻结大适配器：0.3.0 / d607d26d...
packs/      小适配器 + 模块
ui/         新 UI 源（构建后根目录 client.js）
index.js    DSH 新宿主入口（当前为骨架）
```

```text
大适配器结构冻结；内核可以演进。
扩展包 = 小适配器 + 模块；扩展代码不依赖内核。
```

## 包内结构

```text
index.js                 新宿主入口（不 import 旧 bridge）
client.js                UI 构建产物（由 ui/client.js 复制）
cordis.patch.yml         DSH bundle patch
kernel/                  内核
runtime/                 冻结大适配器
packs/                   小适配器 + 模块
ui/                      UI 源与构建脚本
tools/                   检查、测试、打包工具
docs/                    架构、扩展、发布交接
```

## 构建 UI

```bash
node ui/build.mjs --root .
node -e "require('fs').copyFileSync('ui/client.js','client.js')"
```

或：

```bash
npm run build:ui
```

## 验证

```bash
npm run test:arch
node tools/platform-word-gate.mjs
node tools/core-check.mjs
npm run pack:check
```

## 发布

```text
dev 版本：0.8.9-dev.2
只发 pre-release / 测试机
不发稳定通道
```

发布与备份步骤见：

- [发布交接](docs/persona-core/RELEASE-HANDOFF-0.8.9.md)
- [扩展包交接](docs/persona-core/EXTENSION-HANDOFF.md)
- [架构景观](docs/persona-core/ARCHITECTURE-MAP.md)

## 边界

```text
内核不知道平台
大适配器不知道外界
小适配器接大适配器
模块只做自己的业务
```

旧 SurfCore 只作为备份和回滚材料，不进入新包。
