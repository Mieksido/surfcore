# SurfCore 协调/发布会话交接（2026-11-08）

> 用途：把这个会话的规则、发布状态、当前代码状态、C 系列审阅结论交给新的协调/发布会话。
> 本文件**不包含** GitHub PAT 明文。原因见 §7。
> 交接时请先读：`AGENTS.md`、`docs/ROADMAP.md`、`docs/HANDOFF.md`、`docs/PITFALLS.md`、`docs/RELEASE.md`。

---

## 0. 当前坐标

```text
仓库：D:\deepseekwork\surfcore
当前分支：dev
当前 HEAD：e44470c（build(dev): v0.8.9-dev.1）
当前版本：0.8.9-dev.1
最新稳定版：v0.8.9（GitHub）
最新 dev：v0.8.9-dev.1（GitHub Pre-release）
```

工作区当前可能有几份**未提交的审阅文档**（本轮新增）：

- `docs/handoffs/2026-11-08-c-series-review-reply.md`
- `docs/handoffs/2026-11-08-c-series-r3-review.md`
- `docs/handoffs/2026-11-08-c-series-r4-review.md`
- `docs/handoffs/2026-11-08-c-series-r5-review.md`

如果新会话开工时 `git status` 仍有这些文件：它们是**文档**，不是代码；按需提交到 dev，不要和 C 系列代码混在一起。

---

## 1. 发布状态（必须按这个理解）

### 稳定线

- `v0.8.9` 已发布，GitHub Release 为 **Stable**，prerelease=false。
- 远端 main：`0ce8580`（v0.8.9 release commit，由 Data API 创建）。
- 本地 main：`dacbc1a`（`release: v0.8.9`）。
- 本地 tag `v0.8.9` 指向 `dacbc1a`；远端 tag 指向 `0ce8580`。
- 远端 main 的 tree 与本地 release commit **不是同一个 commit SHA**，但安装清单 753/754 已通过 `verify-remote-manifest` 核对。
- 发布后已把 main 合回 dev；dev 当前版本 `0.8.9-dev.1`。

**注意：**

- 不要假设本地 main == 远端 main；
- 不要用本地 `git push`（github.com:443 常被挡），发布会话用 GitHub Data API；
- 远端 main 由 `publish-via-api.mjs --all` 发布，包含部分本地额外文件（video 等），但安装清单只包含 754 个受控文件；
- 需要重新核对时用 `verify-remote-manifest.mjs`，不要只看本地。

### dev 线

- `v0.8.9-dev.1` 已发布，Pre-release。
- 远端 tag：`v0.8.9-dev.1` → `88a9237`。
- 本地 build commit：`e44470c`。
- 该 dev.1 包含：
  - SnowLuma VBS 改用真实 `node.exe`（不是 Harness.exe）；
  - 端口被占用后扫描 SnowLuma 自身 50 个后移位；
  - 一键启动失败不再 `ok:true,pending`，改为 `SNOWLUMA_LAUNCH_TIMEOUT` 等结构化错误；
  - 网盘资源打开 + 复制链接；
  - 之前 dev 线的 0.8.9 基线内容。

**重要：稳定版 v0.8.9 不包含 SnowLuma 的 node/端口修复；如果稳定用户遇到 5100/一键启动失败，需要发 v0.8.10 hotfix。**

---

## 2. 发布规则（硬规则）

### 2.1 分支与权限

- 日常修改只进 `dev`；**编辑会话不改 package version、不打 tag、不发 Release、不推公开仓库**。
- `main` 只接受：
  1. 发布会话从 dev 合并；
  2. hotfix 分支。
- 发布前必须由用户明确说“发”；用户没发话，不允许自己发 dev 或 main。
- 版本号由用户确认；发布前把「版本号 / 改了什么 / 影响谁 / 验证结果」列给用户。

### 2.2 发布门禁（缺一不可）

1. 工作区干净：
   ```powershell
   git status --porcelain
   ```
2. 清单从 Git 对象生成，不从工作区：
   ```powershell
   node scripts/release-manifest.mjs
   node scripts/release-manifest.mjs --verify-ref HEAD
   ```
   预期：`问题 0 个`。
3. 发完必须核对真实制品：
   ```powershell
   # 下载 tag 归档后
   node scripts/release-manifest.mjs --verify <解压目录>
   ```
   codeload 不可达时用：
   ```powershell
   $env:GH_TOKEN = ...   # 只在当前进程
   node scripts/verify-remote-manifest.mjs Mieksido/surfcore vX.Y.Z
   ```
   预期：`一致 N / 不符 0 / 缺失 0`。

### 2.3 dev 发布

```powershell
$env:GH_TOKEN = ...  # 从安全渠道注入，不写文件
node scripts/publish-dev.mjs Mieksido/surfcore --yes
```

- 只创建 `vX.Y.Z-dev.N` Pre-release；
- 不改 main，不影响稳定用户；
- 发完在测试机切 dev 通道验证。

### 2.4 main 发布

- 在 dev 上完成并验证后：
  ```powershell
  git checkout main
  git merge --no-ff dev
  node scripts/version.mjs bump patch|minor   # 按用户确认
  # 写 CHANGELOG
  git commit -m "release: vX.Y.Z"
  node scripts/release-manifest.mjs
  git add release/install-manifest.json
  git commit --amend --no-edit
  node scripts/release-manifest.mjs --verify-ref HEAD
  git tag -a vX.Y.Z -m "SurfCore vX.Y.Z"
  ```
- 用 GitHub Data API 发布 main：
  ```powershell
  node scripts/publish-via-api.mjs Mieksido/surfcore D:\deepseekwork\surfcore --all --message "release: vX.Y.Z"
  ```
  然后用 API 创建 tag + Release（`target_commitish` 用远端 main SHA）。
- 发布后把 main 合回 dev：
  ```powershell
  git checkout dev
  git merge --no-ff main
  ```
- 在 `docs/RELEASE.md` 记录版本、日期、远端/本地 commit、Release URL。

### 2.5 其他硬规则

- **禁止 `git add -A` / `git add .` / `git commit -a`**；只 add 明确路径。
- 改行为必须写 `docs/cases/*.md`；发布批次写 `docs/RELEASE-QUEUE.md`。
- 删除/覆盖前必须备份或隔离到 `_backups/` / `~/.dsh/_quarantine/`；禁止不可逆删除。
- 失败必须可见：`ok:false` + `code` + `error` + `hint` + 可操作下一步；不能只写日志。
- 不确定就问，尤其：删除、发布、对外发送、改用户数据。
- 一个工作区同一时间只允许一个会话写代码；其他会话用独立 worktree。
- 本机 DSH 升级会覆盖 `app.asar`，升级后先 `npm run guard:check`。

---

## 3. 最近一次稳定版 v0.8.9 的内容

- 向量记忆完整链路（本地 3 模型 + 云端 4 服务商、多模型索引、记忆库、一键启动）；
- 会话滚动改为「当前上下文」口径，**默认关闭**，开启前确认后果；
- SnowLuma WebUI 端口、账号弹窗、黑框、脱离 DSH Job、关闭按钮；
- 更新进度/包大小、busy 自愈、`applyGeneration` ABA 防护；
- `release-manifest --verify` 读被校验目录自己的清单；
- 网盘资源打开 + 复制链接、红色安装说明；
- 桥接启动时序、ACL、语音/Embedding 状态修复。

详细 CHANGELOG 在 `CHANGELOG.md` 的 `[0.8.9]`。

---

## 4. 当前未合入的 C 系列（测试机）

### 4.1 最新 bundle

```text
r5 bundle：surfcore-c-opt-2026-11-08-r5.bundle
分支：feat/opt-voice-models
HEAD：9e1e5ff
基线：669beb8（0.8.9-dev.1 快照）
```

**没有合入 main/dev**；仍在审阅阶段。

### 4.2 功能

- C6 语音包：使用说明、zip 导入、sha256 校验、在线下载折叠；
- C4 场景模型：QQ/B站/桌宠按平台选模型；
- C5 直连 TTS：MiniMax / 阿里 CosyVoice；
- C3 自定义服务商：写 DSH profile + `.env`，设置页【模型】栏。

### 4.3 r5 已验证

- `test-dsh-provider-patch` 32/32
- `test-provider-env` 24/24
- `test-provider-ui` 12/12
- `test-scene-models` 11/11
- `test-secret-store` 12/12
- `test-voice-import-checksum` 6/6
- `test-voice-direct-tts` 12/12
- `test-voice-pack-import` 9/9

### 4.4 仍然不能合的原因（P0/P1）

- **P0 两文件事务**：`/provider` apply 先写 `.env` 再写 profile；冲突时 key 已改；clear 反过来。
- **P0 冲突检测仍按行匹配**：`- id: 'llm-deepseek'`、缩进在 `insert:` 里会漏。
- **P0 YAML 预校验/DSH 启动验证**未做。
- **P0 API code 仍被覆盖**：`handleProvider` 把 `provider.env.invalid-value` 改成 `provider.env`，把 `provider.conflict` / `provider.patch.block-corrupt` 改成 `provider.patch`。文字/hint 对，code 不对。
- **P1 checksum 完整性**：清单只列一个文件也会 `verified:true`；路径穿越；checksum 文件名匹配过宽。
- **P1 zip 临时目录/空间/超时**：`state/voice-import-tmp` 不清理，解压前不查磁盘。
- **P1 B站场景模型**：scheduler 不走 `ensureChatModel`，可能静默使用全局模型。
- **P1 直连 TTS 没有专用 UI**：只能去「全部参数」改；文案已诚实但仍未完成。
- **P1 测试覆盖**：没有 API 级 error code 透传、事务回滚、checksum 部分清单测试。

详细审阅：

- `docs/handoffs/2026-11-08-c-series-review-reply.md`
- `docs/handoffs/2026-11-08-c-series-r3-review.md`
- `docs/handoffs/2026-11-08-c-series-r4-review.md`
- `docs/handoffs/2026-11-08-c-series-r5-review.md`

### 4.5 架构判断

- C6/C4/C5 是功能/内容层，不需要重构 SurfCore 进程架构；
- **C3 是新的 DSH 配置写入边界**，必须事务/回滚/YAML 预校验，否则风险高于收益；
- 不要把整个 C 系列直接合 main。

---

## 5. 当前架构景观（简版）

```text
DSH Electron 宿主（动态 Web 端口）
├─ surfcore 插件（同进程）
│   ├─ client.js       设置页 / 概览 / 模型 / 语音 / 更新
│   ├─ index.js        宿主 API / SnowLuma / 更新 / 记忆卡 / 向量包 / provider
│   ├─ scheduler.js    B站 tick / 私信 / 动态
│   └─ pet-api         桌宠
│
├─ QQ 桥接 src/bridge.js（:3100）
│   ├─ OneBot :3000 / :3001 ↔ SnowLuma
│   ├─ DSH Web API → 会话
│   ├─ 3 个 MCP（snowluma / host / web-search）
│   ├─ 会话滚动 / 唤醒 / 收尾 / 语音
│   └─ 场景模型 / 直连 TTS
│
├─ Embedding runtime :18765 → Ollama :11435 / 云端
├─ 语音包 pythonw :8765 / :8767
├─ 桌宠 Electron
├─ SnowLuma（VBS + explorer，孤儿进程）
└─ 更新 helper
```

两套 state：

- QQ 桥接：`<repo>/state`
- 插件：`~/.dsh/surfcore`

三份配置：

- `<repo>/config.json`（QQ）
- `~/.dsh/surfcore/config.json`（合体层）
- `~/.dsh/surfcore/bili.config.json`（B站）

关键边界：

- 控制台：`x-console-token`
- 模型工具：`x-agent-token` + `x-agent-call`
- 桌宠：`x-pet-token`
- SnowLuma WebUI：独立密码
- state ACL：`icacls` 收紧；失败会告警

---

## 6. 已知 P1/P2（非 C 系列）

- 更新看门狗复位后旧 apply 任务仍在跑（锁 ABA 已修，任务未 abort）；
- agent 白名单按 `/api/socialV2/*` 前缀放行，需逐端点收紧；
- `saveSocialV2State()` 同步全量写 400KB+；
- 换会话 P0 修复缺真机长会话复验；
- VBS 启动依赖 explorer/.vbs，30 秒超时后报错但不会自动 fallback；
- WebUI TLS 启用的 SnowLuma 端口发现未覆盖；
- 配置模板仍有缺段；
- 安装目录 audit 有环境性失败；
- bridge 17k 行单文件、client 8k 行。

---

## 7. GitHub Token（重要）

**本文件不写 PAT 明文。**

原因：

- 仓库规则明确“token 不进代码、日志、回复”；
- 这个 Markdown 会被提交/转发，明文 token 等于把发布权限交给所有能读文件的人；
- 一旦提交进 Git 历史，删文件也无法真正撤销。

新发布会话开工时这样拿 token：

1. 由用户在当前会话/密码管理器里提供；
2. 只在命令进程里设置：
   ```powershell
   $env:GH_TOKEN = '<从安全渠道粘贴>'
   ```
3. 不写入任何文件、不打印完整值；
4. 用完关闭该终端/进程。

如果用户希望把 token 交给新会话，请在新会话里直接粘贴，或使用系统凭据管理器；不要写进本文件。

> 备注：本会话此前使用过的 token 已按上述规则只在命令环境变量中使用，**没有落盘到仓库文件**。

---

## 8. 新会话开工顺序

1. 读 `AGENTS.md`、`docs/ROADMAP.md`、`docs/HANDOFF.md`、`docs/PITFALLS.md`、`docs/RELEASE.md`。
2. `cd D:\deepseekwork\surfcore`
3. `git status --porcelain`、`git branch --show-current`、`git log --oneline -5`
4. 确认当前是 `dev`，版本 `0.8.9-dev.1`；不要直接改 main。
5. 如果继续 C 系列：先看第 4 节审阅文档，按 P0 顺序修，不要整包合。
6. 如果发版：先向用户确认版本和范围，再走门禁。
7. 所有改动写 case；发布批次写 release queue。

---

## 9. 一句话交接

**稳定版 v0.8.9 已发；dev.1 已发，包含 SnowLuma node/端口修复；C 系列 r5 还在审阅，P0 两文件事务、YAML 冲突、checksum 完整性、API code 透传和 B站场景未解决，不能直接合 main。发布 token 不落盘，新会话向用户安全获取。**
