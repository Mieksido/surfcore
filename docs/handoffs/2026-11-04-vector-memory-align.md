# 向量记忆会话 · 对齐交接（2026-11-04）

> 给 `feat/vector-memory-impl` 会话：先对齐当前 `dev`，再继续。
> 本文件只同步状态与协作方式，不改变你的实现方案。

## 1. 当前 dev 状态（写交接时）

```
dev HEAD：ef2e313（提交本文件后会再前进一个 docs commit）
版本：0.8.8-dev.1
稳定版：0.8.8
最新已发布 dev：v0.8.8-dev.1
manifest：713 / 0
test:audit：151/151
插件测试：0 失败
test:regressions：全部通过
```

## 2. 你的分支已经合并了

```
feat/vector-memory-impl @ 4b7a040
合并 commit：deecb3e（--no-ff）
```

合并后又发生了这些改动（都在 `dev`）：

| commit | 内容 |
| --- | --- |
| `3c3057f` | 修 `test-vector-memory-plugin.mjs` 读真实 `state/bili-memory.json` 的隔离问题 |
| `fd3d9f4` | 更新 COORDINATION：向量记忆已合并、外部 zip 未入包 |
| `a057784` | 记忆页 UI：公用设置 + 叙事/向量 Tab |
| `4d15943` | 修记忆页白屏（`pane` 状态误插到 `JsonCell`） |
| `ef2e313` | 清单同步 |

**所以你的旧工作树 `surfcore-memory-impl` 已经落后了**，不要直接在 `feat/vector-memory-impl @ 4b7a040` 上继续加东西。

## 3. 正确的继续方式

在 `D:\deepseekwork\surfcore-memory-impl`：

```powershell
git status --porcelain        # 必须干净
git switch -c feat/vector-memory-next dev
```

- 新分支从**当前本地 dev** 切，自动包含你原来的实现 + UI Tab + 白屏修复；
- 不要在旧 `feat/vector-memory-impl` 上 `git merge dev` 硬解 `client.js` 冲突；
- 旧分支保留作历史，不再用于新提交。

## 4. 已合并内容（你原来的范围）

- 向量记忆独立存储/索引/检索/注入，`memory.mode` 二选一；
- 叙事记忆保持不变，两套存储都继续写；
- Embedding 按需安装包：runtime 自带 Ollama CPU、三个模型包、`ollama create`；
- 设置页三个模型包：网盘链接输入、打开网盘、导入 zip、文件名/SHA256 校验；
- 修 `browseNative` 被 CSS 串污染导致原生文件选择框失效。

## 5. 记忆页 UI 现在的结构（不要改回旧布局）

`plugins/surfcore/lib/client.js` 的 `MemoryTab`：

```
公用设置：记忆方式（narrative / vector）
Tab：叙事记忆 | 向量记忆
  叙事：MemoryCardPanel 摘要、双向同步、AdvancedSettings
  向量：Embedding 来源/模型/启用/发现文件、向量状态、整理/重建、EmbeddingPackPanel
```

- `pane` 状态在 `MemoryTab` 内部（`const [pane, setPane]`），**不要再插到 `JsonCell` 或别处**；
- 你后续加向量设置，放在“向量记忆”这个 Tab 里；
- 切 `memory.mode` 会自动切 Tab；Tab 可手动切换。

## 6. 外部四个 zip（仍不在仓库）

目录 `D:\deepseekwork\surfcore-embedding-packs\dist\`：

| 文件 | 大小 | sha256 |
| --- | --- | --- |
| `surfcore-embedding-runtime.zip` | 29.3 MB | `54131dc6…88d40` |
| `bge-small-zh-v1.5.zip` | 46.1 MB | `ed116aaa…1106` |
| `qwen3-embedding-0.6b.zip` | 609.6 MB | `8d67672c…691a0` |
| `bge-m3.zip` | 1104.2 MB | `a2b18771…69a1` |

- **不要**把 zip/gguf 提交进仓库或 `install-manifest`；
- 发 dev 构建前需要先上传、并在设置页 `packLinks` 填好，否则测试机打开是空链接；
- 云端仍需要 runtime 作为共用 HTTP 层。

## 7. 未验收 / 待办（你继续时注意）

- 全新 Windows VM；
- 真实云端 key（目前 mock）；
- GPU 加速包（当前 CPU）；
- 切换模型需手动点「重建索引」；
- `test-vector-memory-plugin` 的隔离修复只改了测试，生产路径未变；
- `start.bat` 的 LF/CRLF 差异是仓库已知问题，不要为了让测试变绿改断言。

## 8. 继续工作的规则

- 分支：`feat/vector-memory-next`，从当前 `dev` 切；
- 只 add 自己的路径，禁止 `git add -A`；
- 不直接改 `dev` / `main`，不 bump 版本、不打 tag、不发 Release；
- 改完跑：

```powershell
npm run test:audit
npm run test:regressions
cd plugins/surfcore; npm test; cd ../..
node scripts/release-manifest.mjs --verify-ref HEAD
```

- 交回方式：`git bundle create ... origin/dev..feat/vector-memory-next`，或 push 分支（如果后续授权）；
- 不把 `config.json` / `state/` / token 打进包。

## 9. 对齐检查清单

```text
[ ] git status 干净
[ ] 已从 dev 切 feat/vector-memory-next（不是继续用 4b7a040）
[ ] 已看 MemoryTab 新结构（公用 + 两个 Tab）
[ ] 向量设置只放在“向量记忆”Tab
[ ] 四个 zip 未进仓库/manifest
[ ] test:audit 151/151；插件 0 失败
[ ] 完成后 bundle 路径 + 测试结果发协调会话
```

## 10. 汇报格式

```text
【向量记忆交付】
分支：feat/vector-memory-next
commit：<hash>
bundle：<路径>
改动文件：<列表>
测试：test:audit N/N；regressions 通过；插件 0 失败
指标/验收：<...>
风险/未验证：<...>
是否已 merge 最新 dev：是
```
