# 自定义时区（覆盖系统时区）

## 现象

- 用户看到什么：很多服务器的系统时区是错的，甚至是默认 UTC。安静时段、每日额度换天、B站作息窗口、定点问候全部按「本地时钟」算，结果整体错位（例如 UTC 服务器上，国内用户的 08:00 问候在 16:00 发出）。
- 复现步骤：把系统时区调成 UTC 或任意错误时区 → 看桥接日志时间戳、`/api/status` 里目的机制的 `nextFireText`、`quietStart/quietEnd` 的命中、额度「今天」的 key。
- 影响面：所有读本地时钟的子系统；不丢数据，但额度/排程/静默时段错位（可能半夜打扰）。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 10；DSH 0.2.1-rc.x |
| SurfCore 版本 | 0.7.3 |
| 安装方式 | git + junction |

## 根因

- 没有「覆盖系统时区」的入口：约 150 处 `new Date().getHours()` / `toLocaleDateString('sv-SE')` / `setHours()` 全部依赖进程的系统时区。
- 开发机的系统时区碰巧是东八区，所以一直没暴露。本次在一台系统时区为 `America/Los_Angeles` 的机器上跑 `npm run test:audit`，原本就有 6 项失败（`test-token-budget` / `test-token-guard` / `test-night-schedule` / `test-qq-fish-guard` / `test-watch-history` / `test-agent-preset-patches`），其中 `test-qq-fish-guard` / `test-night-schedule` / `test-token-guard` / `test-token-budget` 四项在 `SURFCORE_TIMEZONE=Asia/Shanghai` 下转绿，说明它们的失败就是时区假设。

## 完整逻辑

- **链路**：`config.json`（或环境变量）`timezone` → `src/timezone.js`；桥接 `main()` 启动时 `applyProcessTimeZone()` 并每分钟复查；`bili.mjs` 起子进程时带 `TZ`；DSH 宿主里的插件和共享模块（`token-budget` / `token-guard` / `memory-card` / `purpose-engine` / 插件 `scheduler` 等）用 `withConfiguredTimeZone()` 包住本地时钟计算。读者：桥接、B 站 CLI、插件调度器、桌宠、设置页（`/overview` 带 `timezone` 说明）。
- **机制**：Node 里改 `process.env.TZ` 会让 `Date` 的本地方法立即按新时区算（Windows 上也生效，已实测）。自己拥有的进程常驻设置；宿主进程不是我们的，只在同步计算期间临时切换，结束必须**显式**设回系统时区后再删变量（`delete process.env.TZ` 单独不会让 V8 重读，实测）。
- **爆炸半径**：进程数 3（桥接 / 宿主插件 / CLI 子进程）× 读者数（十几个模块）×（静默=3）。不碰用户数据、密钥、花钱。不配置时所有路径与以前字节级一致（`withConfiguredTimeZone` 直接执行 `fn`）。
- **取舍**：
  - A. 只在桥接设 `TZ`：改动最小，但插件里的调度器 / 桌宠仍按系统时区，同一台机器两个进程时间观不一致 ✗。
  - B. 自己写带时区的日期运算替换全部 150 处：正确但 diff 巨大，`setHours(+1 天)`、夏令时边界容易错 ✗。
  - C.（选这条）进程层设 `TZ` + 宿主内用同步临时切换的 wrapper：几十处调用只需在少数函数外套一层；夏令时由原生 `Date` 处理。代价：`fn` 必须同步；每次切换约 40µs（仅在配置了且进程层未对齐时发生）。
  - 回滚：删掉 `config.json` 的 `timezone` 即回到旧行为；整个功能撤销 = revert 本提交。
- **生效与重启**：设置页保存 → 插件立即生效；桥接每分钟自动跟上，**不需要重启**；CLI 下一次调用生效。

## 修法

- 新增 `src/timezone.js`（校验 / 读取 / `withTimeZone` / `withConfiguredTimeZone` / `applyProcessTimeZone` / `describeTimeZone`）。
- 包装本地时钟计算：`src/{purpose-engine,memory-card,token-budget,token-guard}.js`；`plugins/surfcore/lib/{scheduler,automation,characters,memory-card,memory,pet-chat,pet-purpose,qq-fish-guard}.js`；`plugins/surfcore/tools/lib/*`（新增 `clock.mjs`）。
- 入口：`src/bridge.js`（启动应用 + 每分钟复查 + 日志）、`tools/bili.mjs`（子进程带 `TZ`）。
- 设置：`store.js` `normalizeQqConfig`、`index.js` `/config` 入口校验（非法 → 400 `invalid_timezone` + `hint`）、`/overview.timezone`、`client.js` 概览页「时区」卡片、`config.example.json`。
- 文档：`docs/guides/TIMEZONE.md`、`CHANGELOG.md`、本记录。

## 验证

- 自动化：`node scripts/test-timezone.mjs`（校验 / 切换与还原 / 嵌套 / 抛错还原 / 夏令时 / 进程层热切换 / 共享模块按配置时区 / BOM / 损坏的 config；并在系统时区为 UTC、东京、美西三种情况下各整套再跑一遍）已并入 `npm run test:audit`。
- 失败路径：非法时区 → `normalizeTimeZone` 返回 `error` + `hint`（断言钉住两者非空）；`/config` 入口 400 `invalid_timezone`；手改文件填错 → 回退系统时区，桥接日志和设置页红字提示（`configuredTimeZone().error`）。
- 回归：`npm run test:audit` 与改动前一致，仅有上述 6 项原本就因开发机时区失败的脚本；插件侧 `npm test` 全部通过，除 `test-pet-install-guards.mjs`（改动前同样失败）。桥接夹具 `audit-bridge-harness.mjs` 为新增的两个导入补了桩。
- 手工：`SURFCORE_TIMEZONE=Asia/Shanghai node src/bridge.js` 日志首行 `时区：Asia/Shanghai（UTC+08:00，现在 …）← 来自环境变量`；填 `Bad/Zone` 时打印警告并回退系统时区。
- 没验证到的部分：设置页新卡片只做了 `node --check` 与 `test-client-contract`，没有在真实 DSH 界面里点过；桥接在真实 QQ 会话中跨天 / 跨安静时段的行为没有长时间观察。

## 遗留 / 后续

- 需要补的测试：把 `bili-share-scheduler` / `greeting-schedule` 这类桥接独占模块也加一条「配置时区下定点时间」的断言（它们靠进程层 `TZ` 生效，目前只有间接覆盖）。
- 需要改的文档：无。
