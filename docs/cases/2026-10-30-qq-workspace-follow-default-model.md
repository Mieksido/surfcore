# QQ 聊天 / QQ 黑话学习不跟随 DSH 默认模型

## 现象

- 用户原话（2026-10-30）：「现在让默认模型可以兼容 SurfCore 插件，那么让 QQ 聊天和 QQ 黑化学习这两个
  工作区域的默认模型可以跟着修改，且其他人下载这个插件依然可使用」。
- 复现步骤：
  1. DSH（桌面版 DSH NEXT）设置里用「默认模型」插件把默认模型改成任意模型（例如 `deepseek-account` 的某一档）；
  2. 打开 SurfCore 控制台，或直接在 QQ 里 @ 机器人说一句话，让「QQ 聊天」/「QQ 黑话学习」工作区建会话；
  3. 该会话仍然用 `config.json → dsh.model`（本机是 `dfy/deepseek-v4.1-flash-1017`），与 Web GUI 里的默认模型无关。
- 反向症状（同一根因的另一半）：在 QQ 里聊过天之后，回 Web GUI 看默认模型，会发现它被改回了 `config.json` 的值。
  用户在别处（会话内）手动换模型也会被这条链路反复改写 —— 于是「改了默认模型，新建对话/重启又变回别的」。
- 影响面：只有 QQ 两个工作区（其他 DSH 会话正常）；不丢数据、不花钱，改回去随时可恢复；
  但用户会认为「默认模型设置是假的」，而且 QQ 侧与 Web GUI 会互相覆盖，谁最后写谁赢。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows，DSH NEXT（0.2.1-rc.3，node 24.21.0） |
| SurfCore 版本 | 0.7.19（`bc851a9 release: v0.7.19`） |
| 安装方式 | junction / `link:` 本地目录（`C:\Users\李涵\.dsh\profiles\desktop\node_modules\surfcore` → `D:\Deepseek\工作区\surfcore`） |
| 其它相关版本 | `dsh-default-model` 插件（本地 `link:`，本会话同时修了它的 BOM 读取）；`@deepseek-ai/dsh-api-session-controller` 0.2.1-rc.3 |

## 根因

- 代码位置：
  - `src/bridge.js` 的 `ensureChatModel(sessionId)`（改前约 9349 行）—— 只读 `config.json`：
    ```js
    const provider = String(cfg.dsh?.provider || 'deepseek-official');
    const model = String(cfg.dsh?.model || 'deepseek-flash');
    const effort = String(cfg.dsh?.reasoningEffort || REASONING_EFFORT_DEFAULT);
    ...
    api.sessions.selectModel({ sessionId, provider, model, reasoningEffort: effort });
    ```
  - `node_modules/@deepseek-ai/dsh-api-session-controller/lib/index.js:793-821` 的 `selectModel` 会在切完
    会话模型后**后台**执行 `this.ctx.agentDefaultModel.saveSelection(selected).catch(...)` ——
    即「任何一次会话内换模型都会顺手改写全局默认」。
  - `dsh-default-model` 插件把它读默认值的方式覆写成固定值（覆写 `agentDefaultModel.currentSelection()`），
    但 `ensureChatModel` 根本不读 `session.modelCatalog.default`，所以覆写对 QQ 侧完全无效。
- 问题链条：
  1. QQ 桥接给会话选模型 → 只认 `config.json`，与 DSH 默认模型无关；
  2. 这次 `selectModel` 又触发后台 `saveSelection`，把全局默认改成 `config.json` 的值；
  3. 用户回到 Web GUI 看到默认模型「变了」，再改回来，下次 QQ 说话又被改回去 —— 双向拉锯。
- 为什么之前没发现：`ensureChatModel` 是最早（还没有 DSH 默认模型这一层）写的，`config.json` 里一直填着
  开发者本机的那一个模型，自测时「QQ 能用」就算通过；没有测试断言过「默认模型改了，QQ 是否跟着走」。

## 完整逻辑（给用户看的那一遍）

- **链路**：QQ 消息 → `src/bridge.js`（长驻进程，`node src/bridge.js`）→ `ensureSession()` 建/取 DSH 会话 →
  `ensureChatModel()` 决定 `provider/model/reasoningEffort` → `api.sessions.selectModel(...)`（走
  `session.modelCatalog` / `session.selectModel` 这两个 DSH Host Remote 方法）→ DSH 侧会话级模型 + 后台写全局默认。
  两个工作区（`workspaceTitle: "QQ 聊天"`、`cfg.slang.workspaceTitle = "QQ 黑话学习"`）都走同一个
  `ensureChatModel`，所以一处改覆盖两处。DSH 的默认模型由 Host 服务 `agentDefaultModel.currentSelection()` 提供，
  `session.modelCatalog` 的 `default` 字段就是它。
- **机制**：所有权错位 —— 「管理员想用哪个模型」属于 DSH（Web GUI/插件说了算），「QQ 这个会话用哪个模型」
  属于桥接。桥接把两件事合成一件（直接用 config 里的模型），于是既读错了源，又通过 `selectModel` 的
  全局副作用写坏了源。修法不是去拦 `saveSelection`（那是别人的契约），而是让桥接在自己这一侧
  **读对源**：跟随 `session.modelCatalog.default`，跟不到再退 `config.json`。
- **爆炸半径**：2 个进程（QQ 桥接 + DSH）× 读者 2（两个工作区）× 静默 = 3 → 6 分（满 12）。
  不碰用户数据、密钥、不花钱；最坏情况是 QQ 用错模型，且桥接日志会写明来源，能立刻看出来。
- **取舍**：
  - 备选 A：在 `dsh-default-model` 插件里拦 `agentDefaultModel.saveSelection` 或 `selectModel`，让 QQ 侧写不进去。
    没选 —— 等于改别人的契约、劫持所有会话的选择语义，而且会把「在控制台只想给 QQ 换个模型」的能力毁掉。
  - 备选 B（采用）：桥接侧跟随 `session.modelCatalog.default`，并提供 `config.json → dsh.followDefaultModel`
    开关（默认开）+ 控制台勾选。收益：只动自己进程；第三方用户装同一套插件/默认模型，行为一致；
    想写死的人关掉开关即可退回旧行为。风险：多一次 `modelCatalog` 调用（3s 超时 + 15s 缓存）。
- **生效与重启**：`src/bridge.js` 是长驻进程 → **必须重启 QQ 桥接**（`node src/bridge.js`）才生效；
  `public/console.html` 是静态页，刷新即可。DSH 侧不需要重启。

## 修法

- 新文件 `src/dsh-model-follow.js`（纯逻辑，无副作用）：
  - `defaultSelectionOf(catalog)`：从 `session.modelCatalog` 的结果里取 `default`，只接受 `provider` 和
    `model` 都非空（trim 后判断），否则 `null`；
  - `effectiveChatModel({followDefault, config, defaultSelection, defaultError})`：返回
    `{provider, model, reasoningEffort, source, overridesConfig, defaultError?}`；
    默认模型没给 `reasoningEffort` 时沿用 `config` 的强度（不清空管理员的设置）。
- `src/bridge.js`：
  - `resolveDefaultModel()`（TTL 15s、`withTimeout 3000`、失败只记一次日志）、`followsDefaultModel()`；
  - `ensureChatModel` 改成 `const followed = followsDefaultModel() ? await resolveDefaultModel() : null;`
    → `effectiveChatModel(...)` → 用 `chosen.provider/model/reasoningEffort` 调 `selectModel`，
    成功日志末尾加「（跟随 DSH 默认模型）」；
  - `GET /api/dsh/model` 返回 `followDefault / modelSource / effectiveReasoningEffort / configProvider /
    configModel / defaultModel / defaultModelError`；`globalSideEffect` 由纯函数
    `writesGlobalDefault()`（`src/dsh-model-follow.js`）判定 —— 只有 provider/model 真不同，
    或默认值**显式**给了强度且与这次要写的不同，才为 `true`（真机复测：跟随时 `false`）；
  - 新增 `POST /api/dsh/follow-default`：写回 `config.json` 的 `dsh.followDefaultModel`，写盘失败返回
    `{ok:false, code:'config-write-failed', error, hint}`（500）。
- `public/console.html`：模型卡片加「跟随 DSH 默认模型」勾选 + 说明行（关闭 / 正在跟随 / 想跟没读到并给出原因）。
- 为什么选这个方案：不动 DSH 契约、不动别人的插件；失败时既能退回 config 又能把原因显示出来。
- 回滚方式：`config.json` 里 `dsh.followDefaultModel: false`（或用控制台勾掉），立刻回到「只读 config」的老行为；
  代码层面 `git revert` 本次提交即可，无数据迁移、无配置升级步骤。

## 验证

- 自动化：
  - `node scripts/test-dsh-model-follow.mjs` → **9/9**（跟随成功/强度回退/读不到带原因/显式关闭不算失败/
    config 为空不制造噪音/overridesConfig，以及接线断言：bridge 导入并调用 `effectiveChatModel`、
    不再有老的 `cfg.dsh?.provider || 'deepseek-official'` 一对、控制台有开关、`config-write-failed` 与 `hint:` 存在、
    日志含「（跟随 DSH 默认模型）」）；
  - `npm run test:audit`（已把上面这条注册进 `scripts/test-audit.mjs`）。
- 失败路径：跟随失败 → 日志警告带 `defaultError`、控制台说明行显示「想跟随但没读到：<原因>」并继续用 config 值；
  写 config 失败 → `ok:false` + `code` + `hint`，控制台把勾选弹回并把错误显示成红字（不静默）。
- 手工/集成验证：**未做真机**（需要重启 QQ 桥接并向机器人发一条消息，观察日志出现「（跟随 DSH 默认模型）」）。
- 没验证到的部分：真机日志与真实 QQ 往返；控制台勾选的真实点击（浏览器交互）；`python`/语音等无关路径未回归。

## 遗留 / 后续

- 需要补的测试：真机冒烟脚本（桥接启动后断言 `ensureChatModel` 选的是 `modelCatalog.default`）。
- 需要改的文档：`docs/PITFALLS.md` 增加「会话内换模型会后台改写全局默认」这条坑（否则下次又会有人以为是插件坏了）。