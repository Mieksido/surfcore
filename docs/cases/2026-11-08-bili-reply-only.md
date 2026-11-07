# B站「只回找你的人」：主动评论 / 搭话可以单独关掉

日期：2026-11-08

## 现象

- 用户原话：「我希望鱼在没有人@的情况下，不会发评论，但是会通过b站私信的方式跟我分享，qq那边照现在这样就可以了。」
- 实际行为：唤醒提示 4.7 是**硬规则**「每次醒来至少发一条主动评论」，4.8 还催「今天的搭话额度要花完」，鱼群泛滥时**强制聚拢**——没人找她，她也会主动去别人视频下发评论。
- 已有开关都不满足：
  - `interact.enabled=false`（沉默逛）会连 B站 私信一起拦（`tools/commands/dm.mjs:42` 也过这道闸）→ 用户的「私信分享」会一起死；
  - 额度里的 `0` 是**不限量**不是关闭（`tools/lib/limits.mjs:8-9`）；
  - `fishGuard.forceGather=false` 只关「没鱼楼也硬回」，鱼多时仍会改成回鱼。
- 影响面：只涉及 B站 **公开面**（评论）。不动私信、不动动态、不动 QQ。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows / DSH 0.2.1-rc.5 |
| SurfCore 版本 | v0.8.8（分支 `feat/bili-reply-only`） |
| 安装方式 | git 工作区 + `~/.dsh/plugins/surfcore` junction |
| 其它 | Node v24.18.0 |

## 根因

- 代码位置：
  - 唤醒硬规则 `plugins/surfcore/lib/scheduler.js:330`、4.7/4.8 流程 `:352-369`；
  - 16:00 后的搭话催进度 `:1149`（`dynTick`）；
  - 鱼群强制聚拢 `plugins/surfcore/tools/commands/comment.mjs:283-327`，被归进 `comment` 账（`:331-337`）；
  - 闸门函数 `plugins/surfcore/tools/lib/interact.mjs:11-26`。
- 问题链条：**「主动开口」有三条驱动**（唤醒硬规则 / 搭话催进度 / 鱼群聚拢），但配置面只有一个总闸 `interact.enabled`，它的语义是「什么都不发」，粒度太粗。用户要的是「不主动开口，但被叫到要回」——介于两者之间，现有配置表达不了。
- 为什么之前没发现：`plugins/surfcore/scripts/` 里原本**没有任何针对 `interact.*` 的断言**；沉默逛（2026-11-01）只验证了「全停」，没验证「只停主动」。

## 完整逻辑（给用户看的那一遍）

1. **链路**：DSH 插件进程（`lib/scheduler.js`）定时把提示词投给 B站 那个会话 → 会话里的模型调 `tools/bili.mjs comment …` → `comment.mjs` 在本地做闸门判断 → 通过才 `POST x/v2/reply/add`。新开关同时改两头：提示词（别让她去撞墙）+ 工具（真去撞也拦住）。
2. **机制**：`comment.mjs` 用 `GATE = AUTO && !SHARE` 区分「她自己决定的发言」和「主人当场授权 / 分享型」；再用 `GATE_KIND` 把发言分成 `comment`（顶层主动）/ `ta`（热评搭话）/ `reply`（回找她的人）/ `mine:*`（回她自己动态）。新闸门只拦前两类——而鱼群聚拢被特意归进 `comment`，所以自动跟着关，不用单独改。
3. **爆炸半径**：3 个进程读配置（插件、B站 工具链、QQ 桥接只读 `notify.timeoutMutes`），4 个读者文件（`config.mjs` / `store.js` / `scheduler.js` / `client.js`）。静默失败=3：默认值写错会「看起来生效、其实没拦」——所以默认 `true`（升级后行为不变），只有显式 `false` 才变。不碰密钥、不花钱。
4. **取舍**：
   - A（选了）：新增 `interact.proactive` + 工具硬拦 + 提示词三态。收益：精确、可回滚、可被设置页开回来；成本 5 个文件 ~60 行 + 测试。
   - B：只改提示词删 4.7/4.8。成本最低，但靠模型自觉，偶发手滑会真发一条 —— 违反本仓库「工具层必须硬拦」的规矩。
   - C：沉默逛 + 给 `dm.mjs` 开例外。改 1 行，但把「不对外发言」的契约撕了个口子，且会连私信监听一起变味，不选。
5. **生效与重启**：改 `bili.config.json` → 下一轮 tick 生效（`config()` 按 mtime 缓存）；改 `lib/*.js` / `tools/*` → 需重载插件（重启 DSH 或重载 surfcore）；设置页新增的开关要刷新页面才看得见。
6. **验证**：见下节。
7. **回滚与残余**：配置侧把 `proactive` 设回 `true` 即恢复原行为（不用回退代码）；代码侧 `git revert` 单个提交。残余：`--share` 走 `comment` 渠道时**不受**本开关管（设计如此——分享有独立账本和标尺），已写进文档。

## 修法

| 文件 | 改动 |
| --- | --- |
| `tools/lib/config.mjs` | `DEFAULTS.interact.proactive = true` |
| `lib/store.js` | `normalizeBiliConfig` 收敛 `proactive`（不加就会被 `saveBiliConfig` 重建时静默丢掉） |
| `tools/lib/interact.mjs` | 新增 `proactiveAllowed()` / `assertProactiveAllowed()`，拒绝码 `BILI_PROACTIVE_DISABLED` + hint |
| `tools/commands/comment.mjs` | `GATE` 内硬拦 `comment`/`ta`，`exit 3` |
| `lib/scheduler.js` | 唤醒提示三态（沉默逛 / 只回找你的人 / 正常）；4.7/4.8 整段按开关替换；`dynTick` 搭话催进度跟开关一起停 |
| `lib/client.js` | 「互动与静默」组新增 `interact.proactive` 开关，并改写该组 note 区分两个开关 |
| `scripts/test-bili-proactive-gate.mjs` | 新增回归（默认值 / 落盘 / 闸门源码契约 / 分类未变 / 设置页 / 拒绝码） |

**明确不改**：`dm.mjs`（私信分享通道）、`daily.mjs` / `dynamics.*` / `dynTick` 的动态提醒、`listenTick` / `dmTick` / `liveTick`、`fishGuard`、`src/` 下 QQ 桥接任何代码。

## 验证

- 新增：`node plugins/surfcore/scripts/test-bili-proactive-gate.mjs` → `bili proactive gate tests OK`
- 相关插件测试：`test-client-contract` / `test-store` / `test-persona` / `test-admin-bili-prompt` / `test-bili-automation` 全 OK
- 全量：`npm run test:audit` → **136/143**；7 个失败全是 `spawn EPERM`（沙箱禁止子进程），已用 `git stash` 在 HEAD 基线复现同样失败 → 与本次改动无关
- 失败路径（用户可见）：`comment --auto --go` 被拒时打印
  `✗ [BILI_PROACTIVE_DISABLED] 「只回找你的人」已开启：主动评论被禁止。` + 「建议：去 设置 → B站 → 互动与静默，打开「主动评论 / 搭话」」
- **没验证到的**：真实 B站 发送（要真发一条评论，留给用户验收）；真实一轮唤醒的提示词观感

## 遗留 / 后续

- `dm-await.mjs:152` 的 `lastSeen` 无差别前推（自己发过私信后，主人更早那条会被吞）—— 另一个问题，本次未动。
- 若将来把 `share.via` 切回 `comment`，需要再决定「分享型评论」算不算"主动开口"（现在算例外）。
- 文档：`docs/guides/SUBSYSTEM-BILI.md` §6.7、`docs/guides/DATA-AND-CONFIG.md` 配置表已同步。
