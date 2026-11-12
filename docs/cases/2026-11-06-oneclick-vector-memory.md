# 2026-11-06 · 一键启动：向量记忆 + SnowLuma QQ 账号加载

## 1. 链路

```
概览「一键启动」勾选「向量记忆」
  → POST /dsh-surfcore/api/bridge { action:'start-selected', components:[...,'vector'], vectorPack:'local:<id>'|'cloud:<provider>' }
  → plugins/surfcore/lib/index.js: startComponent('vector')
      → selectEmbeddingPack(local id) / activateCloudProvider(provider)
      → startEmbeddingRuntime()
      → 自检通过才 saveUnified({ memory: { mode: 'vector' } })
  → reload overview，launch.vector 状态回到界面
```

QQ 启动后：

```
start-selected 里的 qq 项带 needsAccount=true
  → 前端自动打开「加载 QQ 账号」弹窗
  → POST /dsh-surfcore/api/snowluma/accounts
      → 读 state/snowluma-webui.pass（或弹窗输入）
      → POST SnowLuma /api/login 拿 X-SnowLuma-Token
      → GET /api/processes + /api/qq-list
  → 用户点「加载」→ POST /snowluma/load { pid }
      → SnowLuma POST /api/processes/<pid>/load
  → 刷新列表；桥接自动连上
```

停止：

```
stop-selected 包含 vector
  → stopEmbeddingRuntime()
  → saveUnified({ memory: { mode: 'narrative' } })
```

## 2. 机制

- 采用「复选框 + 下拉」而不是单独按钮：一键启动本来就是多选，向量记忆只是第 5 个组件；
- 下拉的数据来自 `launchStatus().vector`：
  - `models`：已安装且 `valid` 的本地模型；
  - `providers`：已保存 API Key 的云端 provider；
  - 没有配置时显示空提示，不伪造选项；
- `startComponent('vector')` 在启动 runtime 前先选模型；云端 provider 变化时先停旧 runtime，
  因为云端 endpoint/key 是启动时注入的环境变量；
- 自检失败返回 `VECTOR_SELF_TEST_FAILED`，**不切换** `memory.mode`，避免“切到向量但服务不可用”；
- 停止向量记忆时切回叙事记忆，避免 `memory.mode=vector` 但 runtime 已停。

### SnowLuma 账号加载

- 不自动在 SnowLuma 控制台点按钮，而是走它自己的 WebUI API：
  - `POST /api/login` 用 WebUI 密码换 `X-SnowLuma-Token`；
  - `GET /api/processes` 列出本机 QQ 进程（`pid/uin/nickname/status/loggedIn`）；
  - `GET /api/qq-list` 列出已连接账号；
  - `POST /api/processes/<pid>/load` 加载选中的进程。
- WebUI 密码来源：`state/snowluma-webui.pass`（不进日志、不返回浏览器）；
  读不到时弹窗里临时输入，只用于本次请求。
- 加载成功后不假装已连上：弹窗保留，用户点「刷新」看到 `已加载`；桥接会自行重连。
- 一键启动拉起 SnowLuma 时不再额外打开浏览器控制台（`launchSnowLuma({openWebui:false})`），
  账号操作都在插件弹窗里完成；「只打开 SnowLuma」仍保留浏览器入口。

### 隐藏命令行窗口

- 启动卡片新增「隐藏启动后的命令行黑框」，写到 `platforms.hideConsoles`（默认 false）；
- 勾选后 `launchSnowLuma(hideConsoles:true)` 不再用 `cmd /c start`（它会显式创建窗口），
  改为隐藏的 `cmd /c "<launcher>"`，`windowsHide:true`；直接 exe 也加 `windowsHide`；
- SnowLuma 的 `launcher.bat` 也裸调 `node`，启动时用 `nodePathEnv()` 把 DSH 自带 node 目录前置进 PATH；
- 只是隐藏窗口，不隐藏桌宠窗口；桥接/语音/embedding 本来就带 `windowsHide`。

### 启动卡片位置

- 启动卡片在概览 `qbw-grid` 里用 `order:-1` + `grid-column:1/-1` 排到最上面、整行宽；
  不改 DOM 结构，避免把一大段 JSX 搬来搬去。

## 3. 爆炸半径

- 进程：插件宿主 + embedding runtime（用户显式勾选才启动）；
- SnowLuma WebUI 只发本机回环请求；密码文件只读，不写、不回显；
- 配置：`unified.memory.mode`、`vectorMemory.provider/packId/model`（选模型时）；
- 密钥：只读取已保存的云端 profile / WebUI 密码，不回显；不新增日志；
- 失败：`launchItem` 返回结构化 `code/error/hint`，界面 `launchResult` 展示。

## 4. 取舍

| 路线 | 收益 | 成本/风险 | 结论 |
| --- | --- | --- | --- |
| 单独「启动向量」按钮 | 简单 | 与一键启动割裂，用户要多点一次 | 不选 |
| 一键启动多选 + 模型下拉 | 符合用户原话；一次拉起 | 需要新增 launch 状态字段 | 采用 |
| 勾选即自动切模式 | 少点一次 | runtime 没起来就切会坏记忆读取 | 不选；自检通过才切 |

## 5. 生效与重启

- `client.js` 是插件 UI bundle：DSH 刷新/重载插件后生效；
- `index.js` 是插件宿主：需要重启 DSH（或插件宿主）才生效；
- 向量模型选择写入 `unified`，保存后下一次启动/读取生效。

## 6. 验证

```
node scripts/test-launch-components.mjs      ✅ 一键启动/停止接线通过（含 vector）
node plugins/surfcore/scripts/test-platform-start-host.mjs  ✅ platform-start host wiring OK
npm run test:audit                           152/152
plugins/surfcore npm test                    0 失败
```

## 7. 回滚与残余

回滚：

- 去掉 `LAUNCH_IDS` 的 `vector`、`startComponent/stopComponent` 的 vector 分支；
- 去掉 UI 的复选框/下拉；
- 不涉及版本号、tag、发布。

未验证：

- 真机本地三模型、云端四 provider 的实际启动/自检；
- 真机 SnowLuma WebUI 的进程列表/加载（本批只做静态接线，未启动 SnowLuma 实测）；
- runtime 已在跑时切换本地模型是否需要重启（当前只对云端强制重启）；
- 一键启动中 QQ 失败但 vector 成功时的部分成功体验。
