# 云端语音包的凭据不能随包分发（安装时清空 + 强制用户自填）

## 现象

- 用户原话（2026-10-29）：
  > 「voice-cloud 的 config.toml 里硬编码了火山 app_id / access_key。公开发布会让别人用我们的额度计费 →
  > 改成让用户自己填 + 安装引导 + 文档说明。」
- 核实步骤（只读，先查再动手）：
  1. dev 仓库全历史：`git log --all -S "0f74ZU"` → 0 命中；`git grep "0f74ZU" $(git rev-list --all)` → 0 命中；
  2. 公开镜像 `surfvoicecloud` / `surfvoicelocal` / `surfcore`：worktree 与全历史 `-S` 搜索 AccessKey → 0 命中；
  3. GitHub Releases（三个仓库）资产清单 → 只有 models 压缩包，没有代码包；
  4. 真正带 AccessKey 的文件只有本机 `D:\deepseekwork\voice\packages\{voice-cloud,voice-local}\config.toml`
     —— 不在任何 git 仓库里（这两个目录没有 `.git`）；
  5. 但公开的 `surfvoicecloud/config.example.toml:23` 与 `surfvoicelocal/config.example.toml:27`
     里写着**真实 AppID**，而安装流程会把它复制成用户的 `config.toml`。
- 影响面：
  - **尚未发生真实扣费**（AccessKey 没有外泄，AppID 单独不能调用/计费）；
  - 但存在两条通往事故的路：① `devPackUrl()` 默认安装源正指向上面那个带 key 的本地目录 ——
    只要有人把它打成 zip 分发，所有用户都用开发者的额度；② 安装时复制 example → 用户 `config.toml`，
    新用户会被预填开发者的 AppID，误以为是自己的，而且 example 里将来一旦出现 key 就自动全量分发。
  - 不丢数据，可回滚（只多一步"填密钥"）。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows / DSH 0.2.1-rc.2 |
| SurfCore 版本 | 0.6.22（本次改动未发版） |
| 安装方式 | git 工作区 `D:\deepseekwork\surfcore`（无 remote） |
| 其它 | 火山「豆包声音复刻 2.0」凭据只存在于本机语音包源目录 |

## 根因

- 代码位置：
  - `src/voice-packs.js` `devPackUrl()`：默认安装源 = 仓库上级 `voice/packages/<id>`（开发机目录）；
  - `src/voice-packs.js` install() 原来的「复制 example → config.toml」分支：**逐字复制**，不区分 example 里有没有凭据；
  - 语音包仓库的 `.gitignore` 忽略了 `config.toml`，但 `config.example.toml` 是提交的、且含真实 AppID。
- 问题链条：开发机把真实 key 写进 `voice/packages/*/config.toml`（本地自用，合理）→
  同一个目录又是默认安装源/打包来源 → 安装/分发时 config.toml（或 example）被原样复制 → 用户拿到别人的凭据。
- 为什么之前没发现：以前只在开发机装、只有开发者自己用；「打包分发」和「填密钥」是两条没交汇的路径，
  没有任何测试或闸门检查"装完的包里是否带凭据"。

## 完整逻辑（给用户看的那一遍）

- **链路**：设置页 `client.js` → `/dsh-surfcore/api/voice/*`（`lib/index.js:1846` 原样带令牌转发）→
  桥接 `:3100` `getVoicePacksCached()`（`bridge.js:3784`，按 config.json mtime 缓存实例）→
  `src/voice-packs.js`（跑在**桥接进程**）。新装链路：
  `clearPackKeepingAssets → 取源 → flattenSingleDir → ensurePackConfig → postInstall → verifyDirs → 写 installed.json`。
  `config.toml` 的读者：voxd（独立进程，启动时读一次）、`readCloudConfig()`（UI 回显，打码）。
- **机制**：`config.toml` 是 SurfCore ↔ voxd 的**无版本契约**；旧实现把"开发机运行时值"当默认模板逐字复制
  （12 课 §9 配置分层：模板层混进了运行时值）。空 key 不会崩，失败推迟到首次合成（401/403）；
  带有效 key 则完全静默地扣开发者的钱（§8 静默事故 + 花钱）。`hadOwnConfig` 的判据来自
  `clearPackKeepingAssets` 保留 `config.toml` 的既有语义（为断点续传设计），不是新拍的规则。
- **爆炸半径**：1 写者（桥接）× 2 读者（voxd、设置页）× 静默 3 = **6**（单机自查档）；
  但**分发面 = 每个新装用户**、失败=花开发者的钱 → 按 §6 的 P0 对待。
- **取舍**：A 凭据搬出 config.toml（要改 voxd 读配置契约，跨仓库跨进程，成本高）／
  B 只清公开 example（堵不住"zip 自带 config.toml"，也不防下次写回）／
  C 安装入口统一清洗（**选中**：覆盖两条来源、只改值不改契约、重装保留用户配置、一条 revert）／
  D 加密存储（本机回环仍要明文读，收益低）。
- **生效与重启**：`src/voice-packs.js` 属桥接代码 → **重启桥接**；`client.js` 属插件 bundle →
  重建 bundle + **重启 DSH**（只有同时跑 `pnpm run dev:web` 才热更）。

## 修法

- 改了什么：
  1. `src/voice-packs.js` 新增 `stripCloudCredentials(toml)`：只清 `cloud_app_id` / `cloud_access_key`
     两行（保留缩进/CRLF/注释/其它键，`cloud_resource` 不能动，换别的会 403）；
  2. 新增 `ensurePackConfig(dir, { hadOwnConfig })`：没有 `config.toml` 时从 example 复制；
     **新装**（此前没有用户自己的 config.toml）一律清空凭据；重装（`hadOwnConfig=true`）原样保留用户填的；
  3. install() 装完调用它（`src/voice-packs.js:435`），并允许"包里自带 config.toml + 真 key"这种 zip 也被清；
  4. `list()` 增加 `needsCloudConfig`（`src/voice-packs.js:347`）：装好但没填全 → 设置页指路；
  5. `start()` 拒绝未配置的云端包（`src/voice-packs.js:561`），给出「填 AppID / Access Key / 音色 ID」的可读提示，
     避免"启动成功、一说话就 401/403"；
  6. 设置页（`plugins/surfcore/lib/client.js`）：装完自动滚到密钥表单（`:3258`）、卡片显示"待填云端密钥"（`:3284`）、
     明说"安装包不预置任何凭据"（`:3322`）、AppID 输入框换成通用 placeholder（`:3166`）；
     旧控制台 `public/console.html:2038` 同步换掉。
- 为什么选这个方案：在**安装入口**拦比在每个分发脚本里记得清 key 可靠；只在"新装"清、重装保留，
  既不破坏老用户，也不让每次重装都重填。没有走"把凭据存到别处/加密"的路线 —— 那要改 voxd 协议，成本大且没必要。
- 回滚方式：`git revert` 本提交即可；已装的包不受影响（config.toml 本来就在用户机器上）。

## 验证

- 新增 `scripts/test-voice-cloud-credentials.mjs`（26 项断言 + 4 个 `assert.rejects`，已进 `test:audit`）：
  - 只清两个键、保留 `cloud_resource`/其它配置/注释/CRLF；
  - 新装清空、重装保留、zip 自带 config.toml 也清、缺 example 报原来那句错误；
  - 真跑 `install()`（本地夹具、测试专用 id，不碰真实包）：装完无凭据、`force` 重装保住用户填的；
  - `needsCloudConfig` 从 true→false；没配时 `start()` 拒绝并指路。
- `npm run test:audit`：**78/78**（新增 1 条脚本）；`plugins/surfcore npm test` 全绿（client contract 等）。
- 手工/集成：本机 `node scripts/test-voice-cloud-credentials.mjs` 连跑 3 次均通过；
  没有在真机走一次"从 GitHub 公开包全新安装"，因为那会真下载依赖。
- 没验证到的：
  - 公开 `surfvoicecloud` / `surfvoicelocal` 的 `config.example.toml` 里的真实 AppID **还没改**（要发布会话同步公开镜像）；
  - 本机 `voice/packages/*/config.toml` 仍是真实 key（开发要用），"永远不打包这个目录"只能靠流程约束；
  - 真机 UI：装完滚动/提示只做了静态契约检查，未在 Web GUI 点一遍。

## 遗留 / 后续

- 发布会话：把公开镜像 `surfvoicecloud/config.example.toml:23`、`surfvoicelocal/config.example.toml:27`
  的 `cloud_app_id` 换成占位符（或空字符串），并在 CHANGELOG 里连带说明。
- 可选：给 `voice/packages` 打包加一个"发布前扫描 `cloud_access_key`"的脚本（目前靠人工守）。
- 若用户曾把 `voice/packages` 目录发过人：建议轮换火山 AccessKey（本次核实未发现外泄，暂不轮换）。
