# 向量记忆会话 · 同步交接（2026-11-06）

> 给 `feat/vector-memory-library` / 向量记忆会话：先对齐 `dev`，再继续云端模型配置与验收。
> 写交接时 `dev`：`9fbac62`（提交本文件后会再前进一个 docs commit，以 fetch 到的 dev 最新为准）

## 1. 当前基线

```text
dev HEAD：9fbac62
版本：0.8.8-dev.1
manifest：724 / 0
test:audit：151/151
插件测试：0 失败
```

## 2. 已合并的向量相关提交

| commit | 内容 |
| --- | --- |
| `7678422` | 合并 `feat/vector-memory-library`：记忆库最近记录 + 语义搜索 |
| `c5fb625` | 合并后 manifest |
| `a057784` 等 | 更早：记忆页公用设置 + 叙事/向量 Tab |
| `b189e6c` | 自动补索引 + 三模型建索引 + 使用说明 |
| `93a1efb` | 三模型建索引跳过已有索引 |

## 3. 这轮改了什么

### 3.1 自动补索引（重点）

`plugins/surfcore/lib/vector-memory.js`：

- 启动 15 秒后第一次整理；
- 如果 `pending > 0` 且服务正常，**30 秒后续跑**，直到清零；
- 没积压 / 服务失败才回到 10 分钟检查；
- 不再依赖用户手点「立即整理」。

「立即整理」仍然只补新记忆；「重建索引」仍然全部重算。

### 3.2 三模型建索引

- `embedding-packs.js` 新增导出 `registerAllInstalledModels()`；
- `vector-memory.js` 新增 `rebuildAllVectorIndexes(config, models)`：
  - 只处理 `indexReady !== true` 的模型；
  - 已有索引的模型跳过，不重建；
  - 按每个模型的 `modelSpace` 写各自索引；
  - 不改变全局选中模型；
- `index.js` 新增 `rebuild-all` action：
  - 先过滤已安装模型；
  - 全部已有索引时直接返回 `skipped`，不启动 runtime、不跑 embedding；
  - 有缺失时才启动 runtime、注册所有本地模型、逐个补；
- `client.js` 新增「为三个模型建索引」按钮，确认框和完成 toast 都写明“已有索引会跳过”。

### 3.3 使用说明

`client.js` 的「使用说明」弹窗新增：

- 索引是什么；
- 新记忆全自动，不需要手点；
- 「立即整理」只补新记忆，「重建」全部重算；
- 三个模型各有独立索引；
- 三模型按钮只补缺索引的模型，已有索引跳过；要全部重算用单模型「重建索引」。

### 3.4 记忆库

已合并你之前的 `feat/vector-memory-library`：

- 最近记录 30 条，默认隐藏 sensitive；
- 语义搜索，返回相似度；
- 设置 → 记忆 → 向量记忆 → 记忆库。

### 3.5 网盘入口（UI）

- 顶部统一「获取网盘资源（语音、向量记忆模型）」；
- 夸克 / 迅雷已填，百度 / UC 显示「（待补链）」；
- 语音页旧「打开网盘 / 复制链接」已删除，卡片置顶；
- 向量页顶部有「使用说明」+「获取网盘资源」；
- Embedding 总览旧的「浏览器打开网盘链接」按钮已删除。

## 4. 云端模型配置要注意

你正在配云端模型，代码层面：

- 云端 provider 和本地 provider 共用 `vectorMemory.modelSpace`；云端必须用**独立的 modelSpace**（例如 `bge-m3@1024-cloud-v1`），不要和本地 `bge-m3@1024-f16-v1` 混用；
- 「为三个模型建索引」**只处理本地模型**，不碰云端；
- 云端索引要在选中云端 provider 后，用单模型「重建索引」建；
- 自动补索引跟随当前选中的 provider/modelSpace；切云端后 pending 会按云端索引算；
- 真实云端 key/endpoint 仍未验证，配完需要做一次真实 `/v1/embeddings` 自检 + 搜索。

## 5. 你的工作树怎么对齐

旧工作树：

```text
D:\deepseekwork\surfcore-vector-library
分支 feat/vector-memory-library @ cd834ed
```

它已经被合并进 dev，不要继续在旧分支上叠新提交。建议：

```powershell
cd D:\deepseekwork\surfcore-vector-library
git status --porcelain          # 必须干净
git switch -c feat/vector-memory-cloud dev
```

如果你还有未提交的本地改动，先自己收走/提交，再切新分支；不要直接 `git merge dev` 后硬解旧 `client.js`。

## 6. 需要你确认/继续的

1. 看一遍「使用说明」文案，和当前 UI 按钮是否一致；不一致直接改文案；
2. 配好云端后，验证：
   - 云端 `/v1/embeddings` 自检；
   - 云端独立 modelSpace 的索引能建；
   - 切回本地后本地索引仍可用；
3. 真实数据上跑一次「最近记录 / 语义搜索」，确认 sensitive 不显示；
4. 如果要改 `rebuild-all` 的跳过策略（例如“索引存在但不完整也要补”），先和协调会话说，不要直接改。

## 7. 验证命令

```powershell
npm run test:audit
npm run test:regressions
cd plugins/surfcore; npm test; cd ../..
node scripts/test-vector-memory-wiring.mjs
node plugins/surfcore/scripts/test-client-contract.mjs
node scripts/release-manifest.mjs --verify-ref HEAD
```

## 8. 边界

- 不改版本、不打 tag、不发布；
- 不把模型权重/zip 提交进仓库；
- 不把真实云端 key 写进代码/文档；
- 这是本地 `dev`，没发版；发 dev 构建要用户明确说“发”。
