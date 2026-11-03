# 抖音子系统（2026-11-03 取代 B 站）

> 一句话：**「她自己在抖音上刷视频」这件事不在 SurfCore 里跑，交给 DSH 插件 `dsh-douyin-agent`；
> SurfCore 只读它的落盘结果，负责 QQ 那一半。**

原来 B 站那套（`lib/scheduler.js` 1173 行 + `tools/bili.mjs` 40+ 子命令 + `src/bili-memory.js` +
`/api/bili/*` + 「B站」设置页）为什么整体退役：插件已经把自主观看、画面理解、弹幕、人格记忆、
自动问候、私信回复、公开评论、观看日报全做完了，还在自己的专用 Edge 里带登录态。
再写一遍就是两套浏览器抢同一件事，人格记忆也会分裂。

## 职责切分

| 事 | 谁做 | 在哪 |
| --- | --- | --- |
| 打开抖音、登录、过验证 | 插件 | `设置 → 刷抖音 → 打开抖音` |
| 自主观看、抽帧、弹幕、兴趣积累 | 插件 | 同上，`视频观看` |
| 自动问候 / 私信回复 / 公开评论 | 插件 | 同上，`好友互动` / `公开评论`（默认关） |
| 观看日报 | 插件 | `<memoryDir>/reports/videos/YYYY-MM-DD.md` |
| 读状态给设置页看 | SurfCore | `lib/douyin-status.js` → `/dsh-surfcore/api/douyin/status` |
| 生成「抖音→QQ」记忆简报 | SurfCore | `src/douyin-memory.js` → `douyin-memory-brief.md` |
| 注入 QQ 提示词 | 桥接 | `src/bridge.js` 里 `biliMemory`（实例已换成抖音版） |
| 唱 / 表情包 | SurfCore（早就切了） | `src/sing-console.js`、`src/douyin-agent.js` |

## 数据从哪读

插件不给外部 HTTP，所以一律读文件（只读，不写、不启停，避免两套状态打架）：

| 路径 | 内容 |
| --- | --- |
| `<profile>/node_modules/dsh-douyin-agent/state/*.json` | 模型、时段、单轮时长、各项外发开关 |
| `~/.dsh/douyin-browser/control/browser.json` | 专用 Edge 的 pid / CDP 端口 / ready |
| `~/.dsh/douyin-browser/memory/persona/state.json` | `observations`：看过哪些作品（title/author/url/observedAt） |
| `~/.dsh/douyin-browser/memory/reports/videos/*.md` | 观看日报 |

`browser.json` 的 `ready` 只是「上次写文件时是好的」，插件关掉浏览器后不会回写，
所以 `/douyin/status` 会真去敲一次 CDP（`/json/version`，1 秒超时）再报 `alive`。

`~/.dsh/douyin-browser/runtime-location.json`（如果存在）里的 `stateDir` / `memoryDir` 优先，
语义与插件的 `runtime-paths.mjs` 一致。

## 接口

| 路由 | 说明 |
| --- | --- |
| `GET  /dsh-surfcore/api/douyin/status` | 插件版本、浏览器、模型、时段、外发开关、兴趣计数、日报摘要 |
| `GET  /dsh-surfcore/api/douyin/history?limit=&q=` | 最近看过的作品（读 observations，倒序） |
| `GET  /dsh-surfcore/api/douyin/report` | 最新一份日报全文（markdown） |
| `POST /dsh-surfcore/api/douyin/memory/refresh` | 重新生成 `douyin-memory{,.brief,.json}` |
| `GET  /api/douyin/status`（桥接） | 记忆状态（`/api/bili/status` 仍指向它，兼容老脚本） |
| `POST /api/douyin/memory/refresh`（桥接） | 同上 |

插件侧代理动作：`refresh-douyin`（概览的「刷新抖音记忆」）。
`start-bili` 保留但固定回 **410**，说明已下线，不假装成功。

## 配置

- `config.json` → `douyinBridge.{enabled, memory.{enabled,refreshIntervalMs}, share.*}`（结构沿用 biliBridge）
- `~/.dsh/surfcore/config.json` → `platforms.enabled` 迁移成 `['qq','douyin']`；
  `platforms.start = {qq, douyin, bili:false}`（bili 只回显，恒关）
- `memory.qqToDouyin` 与 `memory.qqToBili` 同构，落盘 `qq-for-douyin.md`

## 仍然保留的 B 站代码（冷备份，不可达）

`lib/scheduler.js`、`tools/bili.mjs` + `tools/{commands,lib}`、`lib/bili-qr-login.mjs`、
`lib/automation.js`、`src/bili-*.js`、`client.js` 里的 `BiliTab` 之外的组件定义
（`WatchTab` / `TasteEditor` / `BiliQrModal` / `FishGuardStatusCard` / `QqShareSection` / `AutomationCard`）。

它们**不再有 `h(...)` 渲染点**，所以用户看不到也点不到；`/api/bili/*` 路由仍在服务端
（读的是旧文件，基本是空的）。下一步可以整批物理删除，删之前先确认没有别的扩展在 import。

## 还没做

1. **定时分享抖音作品到群**：B 站那套 `src/bili-share-scheduler.js` 已停；
   抖音要做的话得先有「挑哪条作品」的来源（插件记录 or `src/douyin-agent.js` 的 feed）。
2. **记忆页 / 对齐页的文案**仍是「QQ ⇄ B站」，功能是通的，只是字没改。
3. B 站工具链的物理删除（见上）。
