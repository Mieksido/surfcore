# B站评论区监听：`Cannot access 'L' before initialization`

## 现象

- 用户看到什么：`~/.dsh/surfcore/plugin.log` 里每 5 分钟一条 `[bili-whale] 监听失败：Cannot access 'L' before initialization`。设置页没有任何提示，B站有人回复 / @ 她，她也不会被叫醒。
- 复现步骤：登录 B站、打开设置 → B站 → 监听「评论区」→ 等一轮（默认 5 分钟）。
- 影响面：B站评论监听整条不可用（静默）；每次还会白拉一次 `msgfeed/reply`（被 B站限流的风险）。不丢数据。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 10；DSH 0.2.1-rc.x |
| SurfCore 版本 | 0.7.19 |

## 根因

- 代码位置：`plugins/surfcore/lib/scheduler.js` `listenTick()`。
- 问题链条：函数开头 `const L = cfg.listen ?? {}`（监听配置），进入 `try` 后又在块的后半段写 `const L = limitsNow()`（额度）。内层 `const L` 的作用域是整个 `try` 块，所以同一个块里它**之前**的 `L.scope`（`pullFeed('at')` 之前的判断）和 `L.onlyOwner`（过滤新回复）读的是内层那个尚未初始化的 `L` → 暂时性死区，抛 `ReferenceError`，被外层 `catch` 记成「监听失败」。
- 为什么之前没发现：`catch` 只写一行日志；没有任何测试跑过 `listenTick`；`node --check` 查不出暂时性死区。

## 完整逻辑

- **链路**：插件 `startScheduler()` → 每 30 秒 `listenTick()` → 读 `bili.config.json` 的 `listen` → `pullFeed('reply'/'at')` 拉 B站 收件箱 → 过滤新回复 → 叫醒 B站 会话。出错发生在拉收件箱**之后**、过滤**之前**。
- **机制**：块级作用域 + 同名遮蔽。`const` 的声明被提升到块顶，但在声明语句执行前读取会抛 TDZ 错误，而不是回退到外层同名变量。
- **爆炸半径**：进程 1 × 读者 1 ×（静默=3）= 3；不碰用户数据 / 密钥 / 花钱（但多余的收件箱请求有被限流的风险）。
- **取舍**：A. 把外层 `L` 改名：改动面更大（该函数里多处用 `L.xxx` 读监听配置）✗；B.（选这条）只改后声明的额度变量为 `limits`，只有提示词里的 3 处引用要跟着改。
- **生效与重启**：插件代码，重启 DSH 生效。

## 修法

- `listenTick` 内 `const L = limitsNow()` → `const limits = limitsNow()`，提示词里的 `${L.replyDaily}` / `${L.mineDaily}` / `${L.minePerPerson}` 改成 `${limits.xxx}`。

## 验证

- 自动化：新增 `scripts/test-scheduler-listen.mjs`（已并入 `npm run test:audit`）：①首次运行只记基线、不报错；②有新回复时叫醒她，提示词里的额度是真实数字、没有 `undefined`；③`listen.onlyOwner` 时别人的回复被过滤、主人的才叫醒；④源码防回退（`listenTick` 里不能再重复声明 `L`）。**回退修复后这 4 项全部失败**（已验证）。
- 失败路径：该函数的 `catch` 仍然写 `监听失败`，测试断言正常路径下不出现它。
- 手工/集成验证：真机 DSH 上修复前日志确实每 5 分钟一条该错误（`plugin.log`）；修复后**没有**在真机 DSH 上重启验证，靠上面的桩测试覆盖。
- 没验证到的部分：用桩 `fetch` 与桩 `sessionController` 代替真 B站 / DSH；叫醒后她实际怎么回复不在测试范围。

## 遗留 / 后续

- `catch` 里只记一行日志、设置页不可见，属于 AGENTS.md「失败必须可见」的范围，可以后续让监听失败也出现在概览的状态点里。
