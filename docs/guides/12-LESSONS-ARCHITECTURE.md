# SurfCore 架构与修 Bug 手册（12 课总结）

> 用途：① 人读——从底层机制到架构判断；② 当提示词——直接粘给模型做修 bug 的上下文。
> 基准：2026-10-29 工作树（`plugins/surfcore` 0.6.22 / 桥接 `src/bridge.js` 15,060 行 / DSH 0.2.1-rc.2）。
> 约定：`lib/x.js` = `plugins/surfcore/lib/x.js`；`src/x.js` = 仓库根 `src/x.js`；行号会漂移，改动前先 `grep` 确认。
> 相关：总纲 [ARCHITECTURE.md](ARCHITECTURE.md) · 踩坑 [../PITFALLS.md](../PITFALLS.md) · 风险 [../RISK_REGISTER.md](../RISK_REGISTER.md)。

---

## 目录

0. 可直接粘贴的提示词模板
1. 系统全景（进程 / 端口 / 鉴权 / 分层）
2. 12 课知识摘要（每课：概念 + 本仓库落点 + 口诀）
3. 关键链路（入站 / 工具回环 / 出站 / 目的 / B站 / 语音 / 桌宠 / 记忆卡 / 额度 / 更新）
4. 状态与配置地图（所有权 / 版本现状 / 配置分层）
5. 不变量（改之前必须知道）
6. 脆弱点与已知 bug 候选（P0/P1/P2）
7. 修 bug 标准流程（十问 + 爆炸半径 + 验证 + 回滚）
8. 重启矩阵与验证门禁
9. 术语表（括号即解释）

---

## 0. 可直接粘贴的提示词模板

```text
你是 SurfCore 的维护工程师。SurfCore 是一个装在 DSH（DeepSeek Harness）里的插件：
QQ 桥接进程负责 QQ 收发，插件负责设置页/B站/记忆卡/桌宠/语音/额度，桌宠和语音是仓库外的独立进程。

【硬性规则】
1. 先分析，再动手：写清「现象 → 根因 → 影响面 → 修法 → 怎么验证」。分析不到位就只做只读排查。
2. 不补屎山：新代码必须让下一次改动更容易；同一处出现两套写法就先拆。
3. 改完必测：至少 `npm run test:audit`；碰协议/桥接加 `npm run test:regressions`；碰插件跑 `plugins/surfcore` 的 `npm test`。
4. 删改必隔离：删除/覆盖前先备份或 rename 到 `~/.dsh/_quarantine/` 或 `_backups/`；禁止不可逆删除。
5. 密钥红线：config.json / state/ / ~/.dsh 里的 token 不进代码、不进日志、不进回复；输出前脱敏。
6. 小步提交：一次一件事；提交信息写「现象 + 修法」。
7. 不确定就问：涉及删除、发布、对外发送、改用户数据，先停下来问。

【系统事实（改之前先确认，不要凭记忆）】
- 两套状态根：<仓库>/state/ 属桥接；~/.dsh/surfcore/ 属插件。混写 = 重启后丢数据。
- 三份配置：<仓库>/config.json（QQ）、~/.dsh/surfcore/bili.config.json（B站）、~/.dsh/surfcore/config.json（合体层，唯一真相）。
- 四个鉴权域：设置页 = DSH 会话 Cookie；桥接 = x-console-token；桌宠 = x-pet-token；AI = x-agent-token + x-agent-call。
- 端口会漂移：DSH Web 动态（看 /api/status 或 host.json）；桥接 3100；SnowLuma 3000/3001；voxd 8765/8767；GPT-SoVITS 9880。
- 插件住在 DSH 进程里（不是独立进程）；桥接/桌宠/voxd/MCP 才是独立进程。
- 重启边界：插件代码 → 重启 DSH；桥接代码/config.json → 重启桥接；voxd config → 重启语音包；preset → 重新生成 patch + 重启 DSH。

【诊断流程】
1. 现象：谁不对？什么时候开始？影响哪个包（QQ/B站/桌宠/语音）？
2. 复现：能不能稳定复现？最小步骤是什么？
3. 定位：先看日志（state/bridge.log、~/.dsh/surfcore/plugin.log、state/qq-activity.log），再看状态文件（只读），最后看端口/进程。
4. 影响面：按「进程数 × 读者数 ×（静默=3/报错=1）」估爆炸半径；≥12 必须配契约测试与回滚。
5. 修法：优先「改实现不改接口」「单写者」「加版本/校验」；不要引入新的双写或同步阻塞。
6. 验证：写清命令与预期输出；不能只写「应该好了」。
7. 回滚：写清怎么退回去（git / 备份 / 隔离区）。

【输出格式】
- 现象
- 根因（带 文件:行号）
- 影响面（哪些包/哪些读者/是否静默）
- 修法（最小改动）
- 验证（命令 + 预期）
- 回滚（步骤）
- 风险与残余问题

【禁止】
- 猜；- 跳过测试；- 打印/提交任何 token；- 未备份就覆盖用户数据；- 在桥接里加同步阻塞（fs.*Sync / while 自旋）；- 让两个进程写同一个状态文件。
```

---

## 1. 系统全景

### 1.1 拓扑

```
DSH Web GUI(动态端口)   桥接控制台 :3100   桌宠窗口       ← 三个用户可见界面
        │                    │                │
        ▼                    ▼                ▼
┌──────────────────────────────────────────────────────────┐
│ DSH 宿主进程（Electron）                                  │
│  └ surfcore 插件（bundle: surfcore + qq-mode）            │
│      client.js(设置页) / index.js(装配+API) / pet-api.js   │
│      scheduler.js(B站) / memory-card / characters / align  │
│      token-budget / updates / extensions                   │
└───────┬──────────────────────────────┬───────────────────┘
        │ spawn(detached)              │ import（12 个 src 模块）
        ▼                              ▼
┌──────────────────────┐      ┌──────────────────────────────┐
│ QQ 桥接 src/bridge.js │      │ src/ 纯引擎（无宿主依赖）      │
│  OneBot WS / DSH API  │      │ purpose / memory-card / close │
│  控制台 :3100（126 路由）│    │ token-* / voice-* / dsh-client │
└──┬──────────────┬────┘      │ sticker / slang / fish-guard   │
   │WS 3001       │HTTP 3000  └──────────────────────────────┘
   ▼              ▼                        ▲
SnowLuma2      DSH API（单次 RPC 30s 顶）    │ stdio
                                          ┌─┴──────────────────┐
voxd :8765/8767 ← HTTP ← 桥接/桌宠         │ 三个 MCP server     │
桌宠 Electron ← HTTP(x-pet-token) ← 插件    │ qq_* / search       │
                                          └────────────────────┘
```

### 1.2 进程清单

| 名字 | 独立进程 | 谁启动 | 端口 | 挂了会怎样 |
|---|---|---|---|---|
| DSH 宿主 | ✅ | 用户 | 动态 | 插件全停；桥接还在但没人接话 |
| surfcore 插件 | ❌ 住在 DSH 里 | DSH 加载 bundle | 复用 DSH | 设置页/B站/桌宠接口/记忆卡停 |
| QQ 桥接 | ✅ | 插件 spawn / `start.bat` | 3100 | QQ 收发、唤醒、目的 QQ 载体停 |
| 三个 MCP server | ✅ | DSH 的 MCP 客户端 | 不监听（stdio） | AI 失去工具能力 |
| 桌宠 Electron | ✅ | 插件 spawn | 不监听 | 目的回落 QQ；对话不可用 |
| voxd 语音 | ✅ | `voice-packs.start()` | 8765/8767 | 合成 502；语音库发送仍可用 |
| GPT-SoVITS | ✅ | `gsv.bat` | 9880 | 本地音色失败（strict 不降级） |
| SnowLuma | ✅ | 用户（只探测不部署） | 3000/3001 | QQ 消息进不来 |

### 1.3 四个鉴权域

| 域 | 钥匙 | 检查 | 代码 |
|---|---|---|---|
| 设置页 `/dsh-surfcore/api/*` | DSH 会话 Cookie | 回环 Host → 同源 → JSON → `connection.requestRejection` | `lib/index.js:608-636` |
| 桥接 `:3100` | `x-console-token` 或 `?token=` | Host 白名单 → token（timingSafeEqual）→ `x-agent-call` → CSRF → 模式/管理员/agent 白名单 → 只读降级 | `src/bridge.js:3879-4040` |
| 桌宠 `/dsh-surfcore/pet-api/*` | `x-pet-token`（音频用 `?token=`） | 回环 → 同源 → JSON → token | `lib/pet-api.js:108-119` + `lib/http-guard.js` |
| AI（MCP → 桥接） | `x-console-token` + `x-agent-call:1` + `x-agent-token` | 三层缺一不可；管理路径一律 403 | `src/mcp-snowluma-safe.js:112-192`、`bridge.js:3932-4015` |

### 1.4 代码分层（依赖只能从上往下）

```
表现层   client.js（14 标签）            public/console.html（10 页）
装配层   lib/index.js（路由/生命周期）     src/bridge.js（控制台/生命周期）
领域层   scheduler/memory/characters/align/pet-*/token-budget/updates/extensions
         bridge 内部：入站/唤醒/出站/socialV2/目的/语音/鱼群/额度
引擎层   src/* 纯逻辑（不读全局、不碰配置）
外部     DSH API、SnowLuma、voxd、文件系统
```

耦合注意：插件用相对路径 import 仓库根 `src/`（12 个模块、约 26 处）；`src/memory-card.js` 带 `?rev=` 缓存破坏后缀，**同一字符串硬编码在 3 处**（`lib/memory-card.js`、`lib/pet-chat.js:27`、桥接对应引用），改了引擎不 bump rev → 热重载仍跑旧代码。

---

## 2. 12 课知识摘要

### 第 1 课 进程 / 端口 / HTTP

- 进程 = 运行中的程序实例；跨进程只能靠**文件 / socket / 管道**。
- IP 是机器，端口是服务；`127.0.0.1` 只保证不出网卡。
- HTTP = 一次请求一次响应；身份在头里（`x-*` / `Cookie`）；401=没认证，403=没权限。
- **落点**：DSH 14157 / 桥接 3100 / SnowLuma 3000/3001 / voxd 8765/8767。
- **口诀**：地址会变，契约不能变；能发现（`host.json`）就不要写死。

### 第 2 课 字节 / 编码 / JSON / 文件

- 磁盘只有字节；UTF-8 中文 3 字节、emoji 4 字节；**"长度"要问单位**（字符/码点/码元/字节）。
- BOM（`EF BB BF`）会让 `JSON.parse` 失败；读时剥掉，写回用户文件时保留。
- 写文件三条铁律：**原子写（tmp+rename）**、唯一临时名（pid+随机）、权限（Windows 上 `0o600` 是空操作 → ACL）。
- 读文件三条铁律：剥 BOM、失败要"大声"（关键文件 fail-fast / 存储只读降级）、别整读大文件（只读尾部/逐行）。
- `.jsonl` 适合日志：追加、坏一行不毁全部、可 tail。
- **落点**：`src/bridge.js:200-277`（readJsonSafe/atomicWriteJson/renameWithRetry）、`snowluma-conn.js:228-232`（保留 BOM）、`state-acl.mjs`。

### 第 3 课 事件循环与异步

- JS 单主线程；`await` 是"让出"，不是并行；`JSON.parse`、`fs.*Sync` 永远阻塞。
- 定时器只会被**推迟**，不会被"打断"；长任务 = 所有包一起等。
- 实测：50ms 定时器遇到 1.5s 同步块 → 第一次 tick 迟到 1503ms。
- **本仓库阻塞点**：`lib/pet.js:358-367` `waitPid()` 自旋最多 6~9s；`src/bridge.js:236-250` `Atomics.wait`（40~120ms/次）；`bridge.js:9668-9706` `saveSocialV2State()` 每条消息同步序列化 ~500KB；记忆卡维护（10 分钟一次）。
- **口诀**：主线程只做决策，体力活交给异步/分片/worker/独立进程。

### 第 4 课 长连接与推送

- 三种推送：轮询（探活）、长轮询（桌宠）、WebSocket（QQ 与 DSH）。
- WebSocket 先借 HTTP 握手（101 Switching Protocols），之后双向帧。
- "连着" ≠ "通着"：SnowLuma 心跳里 `status.good` 才是接收链路的真信号。
- 断线四件套：怎么发现、怎么重连、断线补不补、怎么防重复。
- 桌宠：`wait=25000`、客户端超时 40s、线性退避 3→15s、失败重读 `host.json`；`bootId` 变了就重置游标；首次不带 `since`（防诈尸）。
- **口诀**：补不补取决于"漏掉"的代价，不是技术难度。

### 第 5 课 身份与信任

- 回环不等于安全：本机程序、浏览器网页、AI 都能敲门。
- 四道闸：Host（防 DNS rebinding）、Origin（防 CSRF）、`Content-Type: application/json`（表单发不了 JSON）、token（挡本机其他程序）。
- 钥匙比对用 `timingSafeEqual`；**空令牌永不通过**（fail-closed）。
- 四把钥匙不能合并：console-token = 管理员；agent-token = 单会话；pet-token = 聊天；DSH Cookie = 整个 DSH。
- **落点**：`lib/http-guard.js`（唯一准入判据）、`bridge.js:3879-4040`、`pet-api.js`、`dsh-client.js:119-130`（离线铸造 Cookie，绑定 authority）。
- **口诀**：一把钥匙只开一扇门；最小权限。

### 第 6 课 进程拓扑与生命周期

- 插件不是进程；桥接/桌宠/voxd/MCP 是独立进程，`spawn` 时 `detached`（父进程退出不带走）。
- 单实例锁 = **PID + 端口双判据**（防 PID 复用误判）；陈旧锁自动接管；`exit code 2` = 已有实例。
- 健康四层：进程 → 端口 → 接口 → 业务；"活着"≠"就绪"。
- `/api/restart` 只自杀，真正拉起靠监督者（插件 2 分钟自愈 / `start.bat`）。
- **口诀**：自愈靠监督者，善后靠幂等 + 原子写 + 陈旧锁检测。

### 第 7 课 状态与所有权

- **读-改-写**会丢更新；**原子写只保证文件完整，不保证内容正确**。
- **单写者**：一个文件只允许一个进程写，其他人只读。
- 双写者（现状）：`characters/<id>/purpose-outreach.json`（桥接 + 插件）、`config.json`（插件 + 桥接部分端点）。
- 竞态：载体切换的 30 秒窗口、两边同时 tick。
- 解药：拆文件（按写者拆）/ 加锁（`O_EXCL` 锁文件）/ 乐观锁（version+CAS）/ 停世界（切角色先停桥接）。
- 快照/迁移/回滚：先备份再改；迁移只改名不删除；删除一律 rename 到 `_quarantine/`。
- **口诀**：文件既是数据也是合约；删改前先快照。

### 第 8 课 契约与版本

- 契约 = 给什么 / 什么时候 / 坏了怎么办。
- 三种坏法：改名、少给字段（`dshReady` 事故）、改格式（prompt 文件无校验）。
- 静默事故：不报错、不崩溃，只是结果不对。
- 版本：文件里 `version`、接口路径 `/v1`、只加不改（删/改名/改语义最危险）。
- fail-open（出错放行）vs fail-closed（出错拦截）：安全相关必须 closed。
- **落点**：有 `version` 的（`token-budget.json`、`purpose-outreach.json`、`character.json`）；没有的（`social-v2.json`、`sessions.json`、`token-usage-daily.json`、`host.json`、`mode.json`）。
- **口诀**：没有版本号的跨进程文件，改名就是静默事故。

### 第 9 课 配置分层

- 四层：代码默认值 → 默认模板 → 用户文件 → 运行时值（环境变量/探测/内存）。真正生效的是最后一层。
- 实例 1：`config.json` 的 `dsh.baseUrl` 是 48904，运行时是 14157（插件 spawn 时注入 `DSH_WEB_URL`，优先级更高，且不回写文件）。
- 实例 2：`state/mode.json` 是 `chat`，运行时是 `reserved2`（DSH 设置优先）。
- 实例 3：`purpose.carrier=pet` 但桌宠离线 → 回落 QQ，又撞安静时段 409。
- 实例 4：`tts.route=local` 但 8765/9880 没起 → 配置合法、功能 502。
- 实例 5：合体层没有 `pet.chat` → 全部走代码默认值。
- 六种"改了不生效"：改错文件 / 被更高优先级覆盖 / 读了没重读 / 被 normalize 改写 / 被投影覆盖 / 缓存。
- **口诀**：谁读它，就重启谁；文件值可能只是历史注释，判断真实状态看 `/api/status`。

### 第 10 课 消息驱动

- 消息先入队（`unread` 最多 30、`recent` 最多 100），再由调度器决定节奏。
- 合批：默认 8 秒（`wake.batchWindowMs`）；8 秒内取最高优先级理由（private 100 > @ 90 > question 80 > speaker 75 > name 70 > keyword 60 > anyMessage 50 > replyCheck 40 > timeout 30 > history 25 > proactive 20）。
- 水位：`seq`（本地序号）≠ `messageId`（QQ 编号）≠ `readThroughSeq`（已读水位）≠ 时间水位；只有"模型真看到"才推进已读。
- 背压：丢最旧（unread）/ 拒绝（429）/ 延迟重试；补历史是兜底。
- 送达保证：**至少一次 + 去重**；重复不是 bug，是保证级别的代价。
- **口诀**：水位是书签，只能夹在读过的那页之后。

### 第 11 课 AI 系统

- 模型不记忆，每次只看到一张"纸"（prompt）。
- 五段：preset（行为规范，26,859 B）→ 人格卡（6,564 B）→ 唤醒提示（每次现拼，含记忆卡 4,785 B、B站简报 1,099 B、会话令牌、状态、规则）→ 会话历史 → 工具结果。
- 上下文预算：人格 6,000 字、记忆卡 QQ 2,200 字符 / B站 2,000、未读快照 12 条/6,000 字、目的 16,000 字；超了先撤低优先级。
- 工具回环：文本只是思考，发言必须调工具；本回合有发送工具成功 → 不再自动转发（`sendToolSucceededSessions`）。
- token：缓存命中 0.02 / 未命中 1 / 输出 4（元/百万）；峰谷 ×2（工作日 9-12、14-18 点）。
- 实测：今天 34,589,655 token / ¥0.853 ≈ 0.025 元/百万 → 绝大多数是缓存命中。
- 防注入：不靠"它自觉"，靠工具白名单/权限校验/数据标注/审计。
- **口诀**：模型不记忆只"看纸"；安全靠"没有能力越界"。

### 第 12 课 架构评审

- 耦合七级（轻→重）：非直接 → 接口 → 数据结构 → 标记 → 控制 → 公共 → 内容。
- 爆炸半径 = 进程数 × 读者数 ×（静默=3 / 报错=1）；≥12 必须契约测试 + 回滚。
- 十问清单：接口还是实现 / 谁还读 / 改名了吗 / 有版本吗 / 失败策略 / 契约测试 / 加阻塞了吗 / 改时序了吗 / 双写了吗 / 回滚路径。
- 现状评分：分层 8、进程 7、故障隔离 4、契约 4、配置 6、可观测 3、可回滚 9、安全 8。
- **口诀**：架构 = 边界 + 契约 + 失败策略。

---

## 3. 关键链路

### 3.1 QQ 入站 → 唤醒 → DSH 回合

```
SnowLuma WS :3001
  → handleIncoming（bridge.js:13532）
     ① modeAllowed ② deny.users（任何副作用之前）③ 解析文本/图片/引用/转发
     ④ quoteTargetIsSelf ⑤ 会话是否允许 ⑥ 记录 voiceLastSpeaker ⑦ 空文本丢弃
     ⑧ 记忆 inbox + 鱼群窗口 ⑨ 挂起审批/提问 ⑩ 静默/命令 ⑪ reserved2 分支
  → appendSocialV2Message（unread/recent/seq，落盘 social-v2.json）
  → evaluateWakeTriggerV2（12388）→ scheduleWakeV2 合批 8s（12987）
  → sendWakePromptV2（12730）：鱼群/额度/忙/频率闸门
  → buildWakePromptV2（12601）→ deliverPrompt → DSH sessions.prompt（14007）
```

### 3.2 工具回环

```
preset(qq-chat-v2) → DSH 拉 stdio → mcp-snowluma-safe（39 个 qq_*）
  → 桥接 :3100 /api/socialV2/*（x-console-token + x-agent-call + x-agent-token）
  → 闸门：工具开关/令牌/模式/静默/鱼群/额度/频率/长度/敏感词
  → onebotSend → SnowLuma HTTP :3000 → QQ
  → 结果回 MCP → 模型
```

### 3.3 出站与自动转发抑制

```
DSH mux 事件 → turn/end 文本
  → 本回合有发送工具成功？→ 跳过自动转发
  → 否则 mdToPlain → burst 分条 → sendToQQ（全局 sendChain 串行）
```

### 3.4 目的机制（双载体）

```
素材 → collectMaterials → deriveDrives → formGoalHypotheses → selectPurpose → prompt
  → carrier=qq：桥接 runPurposeOnce → 私聊发
  → carrier=pet：插件 petPurpose.runOnce → chat.complete → chat.proactive → 气泡/语音
  → 回执：turn/end + 20 分钟 watchdog → applyPurposeOutcome → 下一枪
```

### 3.5 B站 生物钟

```
scheduler 60s tick → bili.mjs night plan（子进程）→ whale-night.json
  → 到点：ensurePermission(danger-full-access) → sessionController.prompt('bili-whale-<char>')
  → agent 用 CLI 工具链干活
额度：tokenBudget.block('bili')；服务异常时 fail-open（风险）
注意：B站 会话不传 agentPreset，用 DSH 默认工具面
```

### 3.6 语音

```
A 语音库：qq_send_voice(voice) → /api/socialV2/send-voice → safeJoinLibrary → record 段 → get_msg 回读 verified
B 现场合成：qq_send_voice(text) → synthesizeToFile POST /v1/speak/file → wav（state/voice-tts）→ 回到 A
C 包管理：voice-packs.install/start/stop/activate（activate 会先停另一个包并写 tts.route）
触发：主人 10 分钟窗口 + 一条主人消息最多一条语音 + 每分钟/小时上限
```

### 3.7 桌宠

```
host.json（插件每 2 分钟写）→ 桌宠长轮询 /events?since=&wait=25000（40s 超时）
  → proactive/reply/focus 事件 → 气泡（可选语音）
  → /chat 一问一答：插件直接调 DSH llm（不走 agent 回合）→ 历史落 pet/chat/history-<id>.json
  → /focus 写 focus.json（单一真相）
```

### 3.8 记忆卡

```
QQ/桌宠 → memory-inbox.jsonl（桥接/插件追加）；B站 → 维护器直接读 bili-memory.json
  → 插件每 10 分钟 maintain：ingest → 归档全量 → 每日衰减（4 点后）→ 渲染四件套
  → memory-card-prompt-qq.md(2200) / -bili.md(2000) → 桥接/插件注入
  → 全量卡 append-only，永不回滚
```

### 3.9 额度

```
DSH session/event → 插件 ingestEvent（turn|step|retry 去重）→ token-usage-state/daily.json
  → 桥接读 daily 文件做 QQ 闸门；插件服务给 B站/桌宠 block()
  → 控制台账本 token-usage.jsonl（逐回合、峰谷计价）
```

### 3.10 更新

```
check：git（ff-only）/ version（GitHub commit 或 releases/latest）/ release（version.json + sha256）
apply：git/zip → updates-pending.json + apply-update.mjs（等 DSH 退出）→ merge --ff-only / robocopy /MIR
      release → in-process petService.updateFromZip（保留 data/ 与用户皮肤）
```

---

## 4. 状态与配置地图

### 4.1 两套状态根

| 根 | 归属 | 关键文件 |
|---|---|---|
| `<仓库>/state/` | 桥接 | `sessions.json`、`social-v2.json`、`mode.json`、`console-token`、`bridge.lock`、`bridge.log`、`qq-activity.log`、`qq-public-feed.jsonl`、`slang.json`、`stickers.json`、`tool-calls.jsonl`、`token-usage.jsonl`、`greetings.json`、`purpose-outreach.json`（无角色时）、`initial-prompts.json`、`agents/`、`voice-tts/`、`voice-packs/` |
| `~/.dsh/surfcore/` | 插件 | `config.json`（合体层）、`bili.config.json`、`characters/<id>/`（persona+memory+bili+snapshots）、`memory/`（旧布局）、`bili/credentials.json`、`backups/`、`pet/`（host.json/host-token/focus.json/chat/voice）、`token-budget.json`、`token-alert.json`、`token-usage-daily.json`、`token-usage-state.json`、`plugin.log`、`audit.jsonl`、`updates*.json`、`extensions/`、`downloads/` |

### 4.2 状态所有权表（现状）

| 文件 | 写者 | 读者 | 版本 | 风险 |
|---|---|---|---|---|
| `state/sessions.json` | 桥接 | 桥接 | 无 | 读坏即只读降级 |
| `state/social-v2.json` | 桥接 | 桥接、插件 | **无** | 26 字段无版本；插件静默读 undefined |
| `state/mode.json` | 桥接/插件 | 桥接 | 无 | DSH 设置优先，文件常过期 |
| `state/qq-public-feed.jsonl` | 桥接 | 插件 | 无 | 只追加 |
| `state/token-usage.jsonl` | 桥接 | 桥接 | 无 | 账本，行数增长 |
| `~/.dsh/surfcore/token-usage-daily.json` | 插件 | 桥接 | **无**（只有 `day`） | 插件没写 → 桥接可能误放行 |
| `~/.dsh/surfcore/token-budget.json` | 插件 | 插件、桥接 | **有** | — |
| `~/.dsh/surfcore/characters/<id>/purpose-outreach.json` | **桥接 + 插件** | 两者 | **有** | **双写竞态** |
| `~/.dsh/surfcore/characters/<id>/memory/memory-card-prompt-qq.md` | 插件 | 桥接 | 无 | 桥接全盘信任；旧布局还有一份僵尸副本 |
| `~/.dsh/surfcore/pet/host.json` | 插件 | 桌宠 | 有（`version:1`） | 现场 `pluginVersion` 与运行版不一致（疑似双写者） |
| `~/.dsh/surfcore/pet/focus.json` | 插件 | 桌宠、桥接 | 无 | 单一真相，靠 `enabled` |
| `<仓库>/config.json` | 插件（保存）/ 桥接（部分端点）/ 探测写回 | 桥接、MCP、插件 | 无 | 多写者；字段含义靠文档 |

### 4.3 三份配置与生效时机

| 文件 | 读法 | 生效 |
|---|---|---|
| `config.json`（QQ） | 桥接启动读一次；MCP 每次读；插件每次读 | 桥接：重启；MCP：多数即时（工具开关除外） |
| `bili.config.json` | 调度器 mtime 缓存 | 下一轮 tick |
| 合体层 `config.json` | 插件每次 `readUnified()` | 大多即时 |

**投影（单向）**：`unified.admin.qq → qq.ownerQQ`、`unified.admin.biliMid → bili.owner.mid`、`unified.platforms.start → qq.bridge.autoStart`（旧读法）。只改旧文件会被下一次保存覆盖回去。

---

## 5. 不变量（改之前必须知道）

1. **Preset fail-closed**：非 closed-agent 模式拿不到 `qq-chat*` 就拒绝建会话（`bridge.js:9193`），绝不退回 DSH 默认 preset。
2. **智能体鉴权双层**：漏 `x-agent-call` 会从"智能体"升级成"控制台全权"；新端点必须同时进 agent allowlist、且不能被 `adminOnlyV2Paths` 漏掉。
3. **沉睡前三标记**：`preSleepWaitSatisfiedAt/ObservedAt/AccumMs`；任何新的"设潜水"路径必须走 `preSleepWaitBlockedV2`。
4. **载体互斥 + 专注单一真相**：`purpose.carrier` 与 `pet/focus.json`；不要在第三处缓存。
5. **两套状态根**：桥接只写 `<repo>/state`，插件只写 `~/.dsh/surfcore`。
6. **全局 `sendChain`**：所有 QQ 发送串行；一条卡住堵所有会话。
7. **MCP 工具开关在进程启动时冻结**：改 `socialV2.tools.*` 要重启 DSH。
8. **DSH 单次 RPC 30 秒顶**（`dsh-client` 未传 timeoutMs，用基类默认）。
9. **只读降级**：`sessions.json`/`slang.json`/`stickers.json` 读坏时写接口返回 503，不假装成功。
10. **单实例锁 = PID + 端口**；`/api/restart` 只自杀。
11. **语音 strict**：`loli12-gsv` 带 `strict:true`，gsv（9880）没起就硬失败，不降级 piper。
12. **令牌不进日志/回复**；`unified` 目前**不脱敏**（`store.js:558-561`），改它时要小心。

---

## 6. 脆弱点与已知 bug 候选

### P0（错误行为 / 假成功 / 安全 / 花钱）

| # | 位置 | 现象 |
|---|---|---|
| 1 | `src/bridge.js:1950` | `voice.trigger.who="list"` + 群聊 → 引用未声明 `last`，抛 `ReferenceError` |
| 2 | `lib/client.js:2808` | 记忆卡"置顶/忘记/新增/确认"服务端成功但前端 toast 报 `item is not defined` |
| 3 | `src/voice-packs.js:686` | `activate()` 写 `process.cwd()/config.json`，cwd 不同 → "切了没生效" |
| 4 | 两个语音包都缺 `models.json` | 全新安装会在 postInstall 第一步 `exit(2)`；安装也不做 sha256 |
| 5 | `voice-local/voxd/api.py:230-245` | `warm_background` 忽略 `names`，cloud 每次启动真花钱合成一句 |
| 6 | `voice-cloud/scripts/*` | `doctor.py/say.py/audition.py` 默认 8765（local 端口） |
| 7 | `lib/store.js:558-561` | `readAll()` 只脱敏 qq/bili，`unified` 不脱敏 |
| 8 | 现场 `pet/host.json` | `pluginVersion=0.6.19` 与运行中 0.6.22 不一致（疑似多写者） |
| 9 | `lib/scheduler.js:462,552` | 额度服务异常 fail-open；建会话失败被吞仍置 `sessionReady=true` |
| 10 | 桌宠 `chat-host.ts` | 藏起桌宠仍会弹主动气泡；专注开关离线时静默失败 |

### P1（误导排查 / 降级体验）

| # | 位置 | 现象 |
|---|---|---|
| 11 | `src/mcp-snowluma-safe.js:37` | 工具开关冻结，改完要重启 DSH |
| 12 | `src/memory-card.js` | `maxChars=0` 时自动压缩永不触发（只告警） |
| 13 | `src/conversation-closure.js:71` | 单发"？"被判 `ack`，未答提问硬闸可能漏 |
| 14 | `src/voice-tts.js` / voxd | 宿主 60s 超时不取消 GPU 作业；缓存键不含 `lang`/`speed` |
| 15 | `src/voice-packs.js:756` | `requests.jsonl` 的 `ms` 是音频时长，不是延迟 |
| 16 | `src/dsh-client.js:300` | `dsh.authHeader/authPrefix` 是死配置 |
| 17 | `src/dsh-client.js:798` | 审批 `sessionId` 取自 `value.agentId`，字段改名会静默投错 |
| 18 | 桌宠 `surfcore.ts:96` | 只认 `127.0.0.1`，`localhost`/`::1` 被判"找不到 SurfCore" |
| 19 | 桌宠 `chat-host.ts:75-79` | `config.focus` 缺失会把专注强制关掉 |

### P2（结构性债务，优化时考虑，别顺手改）

- `src/bridge.js` 单体 15k 行 + 126 路由一条 if 链；`lib/client.js` 4.8k 行无 schema。
- 两处 `rootOffsetFor`、两套版本比较、额度三处实现、端口常量散落 8 处。
- 两处默认值（桥接硬编码 + `config.example.json`）会漂移。

### 排查前先确认真实环境

现场可能同时存在：SnowLuma 断线（`fetch failed`）、8765/8767/9880 未启动、桌宠未运行、`carrier=pet` 但回落 QQ 又撞安静时段 409。**这些不是 bug，是环境**；先排除环境再定位代码。

---

## 7. 修 bug 标准流程

### 7.1 十问清单

1. 改的是接口还是实现？
2. 除了我，还有谁读这个文件/接口？（用 `grep`，不凭记忆）
3. 改名/删字段了吗？
4. 有版本号或校验吗？
5. 失败时 fail-open 还是 fail-closed？
6. 有契约测试吗？
7. 加了同步阻塞吗？（`fs.*Sync`、`while` 自旋、大 `JSON.parse`）
8. 改了时序吗？（合批、重试、超时）
9. 引入双写了吗？
10. 回滚路径是什么？

### 7.2 爆炸半径

`得分 = 进程数 × 读者数 ×（静默=3 / 报错=1）`

- ≥12：必须契约测试 + 灰度/回滚。
- 7~11：至少写清验证命令与回滚。
- ≤6：自查即可。

### 7.3 定位手段（只读优先）

| 想知道 | 看哪里 |
|---|---|
| 桥接状态/模式/会话数 | `curl -H "x-console-token: <token>" http://127.0.0.1:3100/api/status` |
| 谁在监听 | `Get-NetTCPConnection -State Listen` + `Get-Process` |
| 桥接锁与端口是否一致 | `state/bridge.lock` 的 PID vs 3100 的 OwningProcess |
| 最近收发 | `state/qq-activity.log`（尾 20 行） |
| 桥接内部 | `state/bridge.log`（尾 100 行） |
| 插件内部 | `~/.dsh/surfcore/plugin.log` |
| 会话状态 | `state/social-v2.json`（只看键/长度，不打印内容） |
| 记忆卡 | `characters/<id>/memory/memory-card.json` + 两份 prompt 的大小 |
| 额度 | `~/.dsh/surfcore/token-usage-daily.json` 的 `day`/`total` |
| 桌宠是否在线 | `pet/host.json` 的 `updatedAt`（应在 2 分钟内）+ 60 秒内有无 `/events` |
| 语音 | 8765/8767/9880 端口 + `~/.dsh/surfcore/plugin.log` 的 `[语音]` 行 |

### 7.4 修法与验证

- 优先"改实现不改接口"；必须改接口时：加字段（安全）→ 双写 → 所有人升级 → 再删旧字段。
- 涉及双写：拆文件 > 加锁 > 乐观锁 > 停世界。
- 涉及阻塞：先量化（打时间戳），再决定异步/分片/worker/独立进程。
- 验证写清：命令 + 预期输出；UI 问题附截图或按钮路径。
- 回滚写清：git 回退 / 备份文件名 / 隔离区路径。

---

## 8. 重启矩阵与验证门禁

### 8.1 重启矩阵

| 改动 | 生效方式 |
|---|---|
| `lib/client.js` | 重建插件 client bundle；重启 DSH（除非同时跑 `pnpm run dev:web`） |
| `lib/index.js` / 其余 `lib/*.js` | 重启 DSH |
| `src/bridge.js`、桥接读的配置 | 重启桥接（`/api/restart` 只退出，靠 supervisor 拉起） |
| `src/*.js` 且被插件 import | bump `?rev=` + 重启 DSH |
| preset / `dsh/agent-presets` | `build-agent-preset-patches.mjs` → `setup-dsh.mjs` → 重启 DSH |
| `config.json`（QQ） | 重启桥接（部分控制台接口可即时） |
| 合体层 `config.json` | 大多即时 |
| `bili.config.json` | 下一轮 tick |
| voxd `config.toml` / `voice.json` | 重启语音包（`voice.json` 热加载） |
| 桌宠 `dist/` | 重新打包安装 / `updateFromZip`，再启动 |

### 8.2 验证门禁

```powershell
npm run test:audit          # 默认门禁（离线，不发真消息）
npm run test:regressions    # 碰协议/桥接时加跑
cd plugins/surfcore; npm test   # 插件侧
npm run ui:audit            # 改设置页时
npm run verify:adaptation   # 改 DSH 适配/preset 时
npm run guard:check         # DSH 升级后（app.asar 会话守卫补丁）
```

---

## 9. 术语表

| 术语 | 解释 |
|---|---|
| DSH | DeepSeek Harness，宿主程序，插件跑在它里面 |
| 桥接（bridge） | 独立进程 `src/bridge.js`，负责 QQ 收发 |
| 插件（plugin） | 装在 DSH 里的功能集合，不是独立进程 |
| bundle | 打包在一起的一组插件 |
| profile | DSH 的用户配置档（如 `web`） |
| preset / 预设 | 一套人设 + 工具白名单（`qq-chat` / `qq-chat-v2`） |
| session / 会话 | 一段连续的对话上下文 |
| turn / 回合 | 一次"用户说 → AI 想 → AI 做/说" |
| prompt / 提示词 | 发给模型的那段文字 |
| token | ① 模型计费单位 ② 身份令牌（看上下文） |
| 唤醒（wake） | 把 AI 从潜水叫起来处理消息 |
| 潜水（diving） | 不主动说话，等触发条件 |
| 载体（carrier） | 主动搭话从哪发：`qq` / `pet` |
| 目的机制（purpose） | 让她"自己想说点什么"的机制 |
| 收尾（closure） | 判断一段对话是否自然结束 |
| 记忆卡 | 长期记忆（会遗忘、有清晰度） |
| 全量卡 | 只存档、不进提示词的完整记忆 |
| inbox | 记忆的收件箱（原始事件先写这里） |
| scope | 适用范围：`qq`/`bili`/`shared`/`pet` |
| 鱼群（fish guard） | 群里同类机器人太多时主动闭嘴 |
| 黑话（slang） | 群里的梗/网络用语 |
| 额度 / 账本 | 每日 token 花费上限 / 逐回合花费记录 |
| 降级（degrade） | 出问题时退到更差但能用的方案 |
| fail-open / fail-closed | 出错时放行 / 拦截 |
| 幂等（idempotent） | 做多次和做一次效果一样 |
| 原子写 | 先写临时文件再改名，防止写一半坏掉 |
| 快照 / 回滚 | 存档 / 读档 |
| 迁移（migrate） | 旧数据搬到新结构 |
| 退役（retire） | 结束旧会话（清队列 + 归档） |
| 归档（archive） | 不删除，只藏起来 |
| 门禁 / 冒烟测试 | 必须通过的自动测试 / 最小可用性测试 |
| 契约（contract） | 双方约定的输入输出格式与行为 |
| 不变量（invariant） | 任何情况下都必须成立的规则 |
| 爆炸半径（blast radius） | 改一处会影响多远 |
| 回声（echo） | 同一句语音被两个窗口同时播放 |
| 水位（watermark） | "处理到哪了"的标记 |
| 合批（batching） | 攒一批再处理 |
| 背压（backpressure） | 生产比消费快时的应对 |
| 退避（backoff） | 失败后等一会儿再试，越失败等越久 |
| 竞态（race condition） | 两个操作抢同一资源导致结果不确定 |
| 时序攻击 | 靠响应快慢逐字符猜令牌 |
| DNS rebinding | 把恶意域名解析到 127.0.0.1 绕过同源 |
| CSRF | 跨站请求伪造：别的网页借你的浏览器发请求 |
| prompt injection | 用话术让模型违背原规则 |
| 静默事故（silent failure） | 不报错、不崩溃，只是结果不对 |
