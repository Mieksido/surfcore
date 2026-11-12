# 2026-10-29 · SnowLuma 装在自定义目录时「检测已安装」永远找不到

## 现象

- 用户反馈：装好 SnowLuma2 后，点概览页「检测已安装的 SnowLuma」→ 提示「没找到 SnowLuma：请先下载并解压 SnowLuma2，然后在 QQ → SnowLuma 里填安装目录」。
- 复现：把 SnowLuma2 解压到非标准位置（例如 `D:\软件\SnowLuma2`），不填任何配置，点检测。
- 影响面：只是「检测 / 自动打开 / 读 WebUI 端口」失败；手填对路径后 QQ 仍能正常用。
  不丢数据、不改会话，可随时回滚。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows / DSH 0.2.1-rc.2 |
| SurfCore 版本 | 0.6.22（本机），本次修复未发版 |
| 安装方式 | git 工作区（插件跑在 DSH 宿主进程里） |
| 其它相关版本 | SnowLuma2 v2.0.3；本机装在 `D:\deepseekwork\SnowLuma2`（标准 `app\launcher.bat` 布局） |

## 根因

- 代码位置（修复前）：`plugins/surfcore/lib/index.js` 的 `findSnowLumaInstall()`（旧 1579–1613 行）。
- 规则：候选 = `snowluma.launcherPath` → 环境变量 `SNOWLUMA_HOME`/`SNOWLUMA_DIR` →
  **7 个写死的常见目录**（用户目录 / 桌面 / 下载 / `LOCALAPPDATA\Programs` / 仓库上一级 / `Program Files`）；
  每个候选只认 `app\launcher.bat`、`launcher.bat`、`SnowLuma.exe`。
- 问题链条：用户解压到自定义路径 → 不在候选里 → 永远返回 null；而概览卡片**没有手动入口**，
  唯一能填的 `snowluma.launcherPath` 在 QQ 页「高级设置」里，用户往往找不到。
  于是一个"猜位置"的实现细节，变成了用户眼里的"装好了却检测不到"。
- 为什么之前没发现：0.6.11 只修了"填对路径却认错"（`dirname` 取错），测试也只覆盖了 token 发现；
  **没有测"路径没填/填错时检测应该怎么办"**，也没有测候选列表之外的情况。

## 完整逻辑（给用户看的那一遍）

- **链路**：概览「检测」按钮 → `POST /dsh-surfcore/api/bridge {action:"detect-snowluma"}`
  → 插件进程 `handleBridge` → `findSnowLumaInstall`（读 `<repo>/config.json` 的 `snowluma`，扫候选）
  → 命中后 `saveQqConfig`（**单写者：插件**；deepMerge + 自动备份）把 `launcherPath` 写回 `<repo>/config.json`。
  读者：桥接（`launchSnowLuma` 启动、`snowLumaWebui` 读 `app/config/runtime.json`）、概览 API（显示当前目录）。
- **机制**：检测本质是"**猜 + 验证**"——对每个候选找启动文件。旧实现的候选是**封闭集合**，
  所以实际行为退化成"不在我猜的 7 个地方就永远失败"。这属于配置分层里的"默认值/探测"层，
  是省一步的便利，不该成为硬限制；正确做法是"猜得到就省一步，猜不到让用户点一下"。
  失败时同样走**结构化报告**（`code/title/error/hint/tried`）→ 前端弹窗给行动，而不是让用户自己猜下一步。
- **爆炸半径**：1 写者（插件，且写前有备份）× 2 读者（桥接、UI）× 报错=1 → 约 **2**（自查档）。
  写的是 `config.json` 的一个字段，deepMerge 不会清掉 token 等其它字段，回滚容易。
- **取舍**：A 扫盘/查注册表（能自动找到任意位置，但慢、有权限和误认风险）／B 只给文本框（能用但不直观）／
  **C 目录浏览 + 路径归一（选中）**／D 只允许选 `launcher.bat` 文件（要反推两层，用户容易选错 exe/zip）。
  C 一次点击、可验证、不动数据结构；D 不单独做，但归一函数兼容文件输入。
- **生效与重启**：`lib/*.js` 属插件侧 → 重建 client bundle + **重启 DSH**（桥接不用动）。

## 修法

- 新增 `plugins/surfcore/lib/snowluma-install.js`：
  - `normalizeSnowLumaInstall()`：根目录 / `app` 目录 / `app\launcher.bat` / `launcher.bat` / `SnowLuma.exe` /
    解压多一层的唯一子目录，统一还原成 `{root, launcher}`；
  - `snowLumaCandidates()`：手选 > 配置 > 环境变量 > 常见位置（不扫盘、不查注册表）；
  - `findSnowLumaInstall()`：返回 `{ok, root, launcher, tried}`，失败也带"试过哪些路径"。
- `plugins/surfcore/lib/index.js`：删掉内联实现，改用新模块；`detect-snowluma` 接受**可选** `path`，
  且**显式路径只验证它**（不回退去猜别的安装）；失败时返回结构化报告
  `code / title / error / hint / tried`（`snowLumaMissingReport()`）。
- `plugins/surfcore/lib/client.js`：概览 SnowLuma 卡在「检测」右边加「浏览…」（复用 `/browse` 原生目录选择框），
  选完直接验证并保存；**检测失败弹 `ErrorModal`**（AGENTS 1.7）——写明发生了什么、试过哪些位置（可展开），
  并给「浏览…选择目录」「打开官方下载页」两个下一步，不再只闪一条 toast。
- 启动 / WebUI 逻辑不变：`launcherPath` 仍保存根目录。
- 回滚：`git revert` 本提交即可；已保存的 `launcherPath` 不受影响。

## 验证

- 新增 `plugins/surfcore/scripts/test-snowluma-install.mjs`（已进插件 `npm test`，**30 项**）：
  四种输入归一、多套一层、中文+空格路径、空目录/不存在/无启动文件必须拒绝、候选顺序、去重、
  配置命中和手选命中、失败时 `tried` 完整且不把不存在路径当命中；
  以及**失败报告**：`code` 稳定、`title/error` 非空、`hint` 里真的给了「浏览…」和下载页、
  手选失败时错误里带用户选的路径。
- **失败路径**：点检测失败 → 弹窗「没找到 SnowLuma」+ 试过位置列表 + 「浏览…」「打开官方下载页」；
  手选目录失败 → 弹窗「这个路径里没有 SnowLuma」+ 要能找 `app\launcher.bat` 的说明；均为 `ok:false` 驱动，不吞。
- `cd plugins/surfcore && npm test` → 全绿。
- `npm run test:audit` → 78/78（本改动在插件侧，数量不变）。
- 本机实跑：配置里是 `D:\deepseekwork\SnowLuma2`（有 `app\launcher.bat`），检测命中。
- 没验证：真机点「浏览…」弹原生框（需要桌面会话，自动化点不了）；没在 0.6.22 的 GUI 里手点一遍。

## 遗留 / 后续

- 不解压 zip 的情况仍要用户先解压（EULA 边界：本程序只探测，不代为安装）。
- 检测失败时后端已返回 `tried`，前端暂时只显示一条错误；可以后续做成可展开的"试过这些位置"。
- 若用户装在超过两层的嵌套目录，浏览时选到包含 `app` 的那层即可（测试覆盖了"多一层"）。
