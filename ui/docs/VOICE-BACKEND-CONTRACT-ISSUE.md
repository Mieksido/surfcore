# 语音 API 层级问题（给后端会话的质问稿）

> 时间：2026-11-11
> 来源：前端会话记录；只改 `surfcore-ui`，**没有改任何后端代码**。
> 目的：把“语音页为什么下线”的事实、证据、设计问题列清楚，方便后端会话正面回答。

---

## 0. 一句话

后端把**旧运行时 QQ 桥的语音包管理器**，以一级接口 `/surfcore-api/voice` 暴露出来；前端把它当成了内核语音控制面，于是内核页变成“必须先有 QQ 桥接才能启动语音”。

如果它是**旧运行时兼容管理面**：它不应挂在内核语音入口，也不应要求 UI 先启动桥接。  
如果它是**新内核语音 API**：它的形状不合格——返回包管理器/进程/端口，而不是中性 capability/intent/transport。

---

## 1. 后端自己写的事实

### 1.1 契约原文

`D:\deepseekwork\surfcore-persona-core\docs\persona-core\VOICE-API-CONTRACT.md` 开头：

> 位置：旧运行时插件里的兼容前缀 `/surfcore-api/voice`。  
> 它转发到旧桥的 `/api/voice/*`，复用真实语音包管理器；**不是新层，不改大适配器**。  
> 语音内核的 transport 在新内核，UI 暂不直接调用内核。

同一份契约还写：

> UI 不要直接调旧桥 `/dsh-surfcore/api`；用这个前缀，和其他新 API 一致。

这两句本身就矛盾：

- 一边说“旧桥兼容前缀、不是新层”；
- 一边让 UI 把它当“和其他新 API 一致”的一级接口。

### 1.2 实际转发代码

`D:\deepseekwork\surfcore\plugins\surfcore\lib\index.js`：

```text
const VOICE_API_PREFIX = '/surfcore-api/voice';
route('prefix', VOICE_API_PREFIX, ...)
  → handleVoice(req, res, url)
  → target = `${consoleBase()}/api/voice${suffix}`
  → fetch(target, { headers: { 'x-console-token': ... } })
```

桥接不可达时返回 `502 {ok:false,error}`；`/packs` 直接是旧桥 `voice-packs.js` 的 `list()`。

### 1.3 实际管理面

`D:\deepseekwork\surfcore\src\voice-packs.js`：

- `list()` 返回 `installed/running/external/port/enginePort/install/import/dir/...`；
- `start()` 会 `spawn` 进程、等端口最多 60 秒；
- `stop()` 会跑脚本 / 按端口杀进程；
- `install()` 下载、解压、跑 bootstrap；
- `cloud-config` 写包内 `config.toml`。

这是**语音包管理器**，不是内核语音决策层。

---

## 2. 为什么它违反四层架构

用户明确的架构：

```text
内核
  └─ 大适配器
       ├─ 小适配器
       │    └─ 模块
       └─ 小适配器
            └─ 模块
```

- 本体 = **内核 + 大适配器**；
- 小适配器 + 模块 = 可插拔 **mod**；
- 内核不认识外部平台、外部进程、外部桥，只认识 adapter 给的中性信息。

当前 `/surfcore-api/voice` 的问题：

| 问题 | 具体表现 |
| --- | --- |
| 层级错误 | 一级 `/surfcore-api/voice`，没有 adapter 身份，看起来像内核原生 API |
| 暴露 mod 内部 | 返回 port、enginePort、install/import、dir、进程启停 |
| 依赖外部桥 | 桥接不在就 `VOICE_BRIDGE_DOWN`；语音能力被 QQ 桥绑死 |
| 把管理面当控制面 | UI 需要知道“装包/启进程/端口”，而不是“选择 voice profile / 合成意图” |
| “API 不变”锁死迁移 | 如果新内核沿用这个形状，等于把旧桥管理面固定成新内核契约 |
| 平台耦合 | `voice-local / voice-cloud` 是 mod 实例，不是内核概念；错误提示还要求“先启动 QQ 桥接” |

内核语音应该只发中性 intent，例如：

```text
voice.speak { profileId, text, ... }
voice.stop  { profileId }
voice.select { profileId }
```

由大适配器选择 mod、启动/停止 mod、处理平台差异；内核和内核页都不应该知道桥接/进程/端口。

---

## 3. 前端这边的责任（不推锅）

1. 我看到了契约里的“旧桥兼容前缀、不是新层”，还是把它做成了内核语音页。
2. `VoicePage` 直接调 `/surfcore-api/voice`，并显示“试合成 · 不发 QQ”。
3. 错误提示写了“先启动 QQ 桥接”，把外部桥接当成语音前提。
4. 我根据用户的架构纠正，把语音页从内核入口下线；但这一步我做得太急，只被要求写总结时不该顺手改路由。

**责任分担：后端接口层级设计有问题；前端不该把兼容面抬成内核能力。两边都要改。**

---

## 4. 需要后端正面回答的问题

1. `/surfcore-api/voice` 的定位到底是：
   - A. **旧运行时兼容管理面**（只给旧控制台/迁移期用）；
   - B. **新内核语音 API**（要长期稳定）？
2. 如果是 A：为什么 UI 文档让它“和其他新 API 一致”？为什么它出现在内核语音入口，而不是 legacy/admin 命名空间？
3. 如果是 B：为什么返回包管理器/进程/端口？为什么语音启动依赖 QQ 桥？这怎么符合“内核只认识 adapter 中性信息”？
4. “后续切新内核时 API 不变”具体指什么不变？
   - 如果指 `/surfcore-api/voice` 的形状不变，那新内核就被旧桥绑死；
   - 如果指中性契约不变，请给出中性契约，而不是旧桥管理面。
5. 语音的启停/安装/路由到底归谁？
   - 大适配器？
   - 小适配器/模块？
   - 还是让 UI 直接命令旧桥？
6. 平台名/来源 ID 如何隔离？
   - 内核/适配器是否只传不透明 `sourceId` / `transportId`？
   - UI 是否只负责显示翻译？
7. 如果没有语音 mod，内核语音能力应该是什么状态？
   - 应是“能力不可用/未安装”，而不是“先启动 QQ 桥”。

---

## 5. 期望的中性语音契约（方向）

不要求现在实现，但后端需要给出方向：

```text
GET  /.../voice/capabilities
  → { capabilities: [{ id, kind, available, reason? }] }   // 无平台名

GET  /.../voice/status
  → { available, profiles: [{ profileId, label, kind }] }   // kind 可以是 local/cloud，但不能出现 QQ/B站

POST /.../voice/intent
  { intent: 'speak' | 'stop' | 'select', profileId, text? }
  → { accepted, intentId }

GET  /.../voice/intent/:id
  → { state, error? }
```

- `profileId` / `transportId` 是不透明 ID；平台名只在 UI 的 SourceId 映射里出现。
- 启停/安装由大适配器/小适配器负责；内核只发 intent。
- 旧桥可以保留在 `/.../legacy/voice` 或旧运行时管理端，不挂内核页。
- 旧桥不可用不能变成本体启动前提。

---

## 6. 前端当前状态

- UI **v0.32.0**：内核「语音」入口改为 `VoicePendingPage`，只显示“待适配器接入”，不请求 `/surfcore-api/voice`。
- `VoicePage` / `src/lib/voice.js` 保留但**不路由**，仅作旧兼容面存档；后续可删除或移到独立旧运行时管理端。
- 没有改后端；`/surfcore-api/voice` 路由仍在（401 是会话鉴权，不是 404）。
- 等中性语音契约后再重做页面。

---

## 7. 验收（后端回复后）

- [ ] 明确 `/surfcore-api/voice` 是 legacy 还是新 API。
- [ ] 如果是 legacy：改名/隔离，不再出现在内核入口；UI 不需要它。
- [ ] 如果是新 API：给出中性 capability/intent/transport 契约，不出现平台名、桥接、进程、端口。
- [ ] 语音能力缺失时返回“不可用/未安装”，不返回“先启动 QQ 桥”。
- [ ] 新内核迁移不依赖旧桥形状；“API 不变”指中性契约，不是旧管理面。
- [ ] 旧桥/语音包管理器明确归 mod 侧，由大适配器编排。

---

## 8. 可直接转发的一句话

>  `/surfcore-api/voice` 是旧 QQ 桥语音包管理器的兼容代理，却以一级 API 暴露给内核语音页，导致内核依赖外部桥接、暴露进程/端口/安装细节。请明确它是 legacy 还是新内核语音 API；如果是新 API，请改成中性 capability/intent/transport 契约，不要返回包管理器管理面，也不要以 QQ 桥可用作为语音能力前提。
