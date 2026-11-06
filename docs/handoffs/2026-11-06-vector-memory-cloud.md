# 交接：向量记忆云端配置（四服务商 / 分别保存 / 单选启用）

日期：2026-11-06 11:30（Asia/Shanghai）
分支：`feat/vector-memory-cloud`
基线：`dev ac41081`
HEAD：以分支 tip 为准（功能提交 `458dec1`；之后只有 docs/manifest follow-up）
工作树：`D:\deepseekwork\surfcore-vector-library`
工作区：干净
净 diff：以分支 tip 为准；功能提交 `458dec1` 时为 10 files changed，+482 / -69

> 只改云端配置 UI/存储与文档，不改变量存储格式，不影响本地模型。

---

## 1. 本轮改了什么

### 1.1 使用说明弹窗

`plugins/surfcore/lib/client.js`：

- 弹窗顶部先用大白话说明：
  - 向量记忆是什么；
  - 和叙事记忆相比的优点；
  - 相似不等于事实，敏感记录不显示/不注入。
- 两个一级 Tab：
  - **本地模型**：保留原来的全部说明；
  - **云端模型**：先说明适合谁，再分四个服务商 Tab：
    - 硅基流动
    - 智谱
    - 阿里云百炼
    - OpenAI
- 每个服务商展示：是否要梯子、价格、默认维度、拿 Key 步骤、Endpoint/模型名/模型空间、注意事项。

### 1.2 云端配置区

- 顶部单选“启用哪个服务商”；
- 四个服务商 Tab；
- 每个服务商独立保存自己的 endpoint / model / modelSpace / allowRemote / API Key；
- 「保存这个服务商」只保存，不切换当前启用；
- 「启用这个服务商」/顶部单选才切换 active，并写 `vectorMemory.provider=cloud` 与对应 modelSpace；
- 已保存但没 Key 的服务商不能启用；
- 切到未保存的 Tab 时显示预设值，不带上一个服务商的 Key。

### 1.3 云端配置存储

`state/embedding-packs/cloud/config.json` 升级为 schema 2：

```json
{
  "schema": 2,
  "active": "zhipu",
  "providers": {
    "siliconflow": { "endpoint": "...", "model": "...", "modelSpace": "...", "allowRemote": true, "apiKey": "..." },
    "zhipu": { "...": "..." },
    "alibaba": { "...": "..." },
    "openai": { "...": "..." }
  }
}
```

- mode 0600；
- 读取/状态接口只返回 `hasKey/keyMasked`，不回显 key；
- 旧版单份配置自动迁移到对应 provider；
- `runtimeEnv()` 只读取 active provider，启动时注入 runtime 环境变量。

新增 API：

```text
save-cloud    { provider, endpoint, model, modelSpace, apiKey, allowRemote, activate:false }
activate-cloud { provider }
```

### 1.4 云端维度自动识别

`plugins/surfcore/runtime/embedding-service.mjs`：

- 之前云端维度硬编码 1024，智谱默认 2048、OpenAI 1536 会失败；
- 现在未显式指定维度时按 provider 实际返回维度走；
- 新增 `scripts/test-embedding-cloud-dimension.mjs`，用 1536 维假 provider 验证。

---

## 2. 当前状态

```text
分支：feat/vector-memory-cloud
HEAD：以分支 tip 为准（功能提交 458dec1）
基线：dev ac41081
工作区：干净
版本：0.8.8-dev.1（未发布）
```

本分支没有改版本、没有打 tag、没有发布。

---

## 3. 验证结果

### 已通过

```text
plugins/surfcore npm test                         通过
test-embedding-packs-plugin.mjs                  通过（四服务商分别保存/启用、key 不回显）
test-embedding-packs-wiring.mjs                  通过
test-embedding-cloud-dimension.mjs               通过（1536 维自动识别）
test-client-contract.mjs                         通过
test-ui-contrast.mjs                             通过
test:regressions                                 全部通过
```

### audit 的一个无关失败

```text
test:audit：150/151
失败：test-voice-cloud-credentials.mjs
```

- 这个测试测的是**语音云端包凭据安装**，不在本分支改动文件里；
- 同一测试在 `D:\deepseekwork\surfcore`（dev）通过，在本功能 worktree 失败；
- 初判是 worktree/临时目录环境差异，不是本功能代码；
- **合并前请协调在 dev 重跑一次**；如果 dev 也失败，再单独查语音 worktree 隔离，不要阻断云端配置验收。

### 还未验证

- **React 真实渲染**：四个 Tab、保存/启用交互还没有在 DSH 里人工点过；
- 真实云端 Key 自检/索引（当前没有 endpoint/key）；
- 从 A 服务商切到 B 后，one-click 重启 runtime 的真实行为；
- 旧版单份云配置迁移在真实用户目录的兼容性（测试只覆盖逻辑）。

---

## 4. 合并后必须人工验收

重启 DSH：

```text
设置 → 记忆 → 向量记忆
→ 使用说明：本地模型 / 云端模型 → 四个服务商 Tab
→ Embedding 功能 → 云端模型：四个 Tab、顶部单选启用
```

检查：

- 四个 Tab 都能打开，不白屏；
- 每个服务商可以分别保存；
- 保存一个不会覆盖其他三个；
- 顶部单选只能启用已保存 Key 的服务商；
- 切 Tab 不会把上一个 Key 带进来；
- 启用后点「一键启动 runtime + 云端」能重启并自检；
- 旧单份云配置能正常读出。

---

## 5. 合并建议

1. 从 dev 合并：
   ```text
   git checkout dev
   git merge --no-ff feat/vector-memory-cloud
   ```
2. 重新生成 manifest：
   ```text
   node scripts/release-manifest.mjs
   node scripts/release-manifest.mjs --verify-ref HEAD
   ```
3. 重跑：
   ```text
   npm run test:audit
   npm run test:regressions
   cd plugins/surfcore && npm test
   ```
4. 人工打开记忆页和云端配置四个 Tab；
5. 不改版本、不打 tag、不发布；是否进 dev 由用户/协调决定。

---

## 6. 回滚

- 代码：`git revert` 合并提交；
- 云端配置：只影响 `state/embedding-packs/cloud/config.json`，可备份/恢复该文件；
- 本地向量索引/记录不受影响；
- 不要动 `vector-memory.jsonl`。

---

## 7. 给协调会话的转发块

```text
【向量记忆云端配置：合 dev 交接】

分支：feat/vector-memory-cloud
基线：dev ac41081
HEAD：以分支 tip 为准（功能提交 458dec1）
工作树：D:\deepseekwork\surfcore-vector-library
工作区：干净
净 diff：以分支 tip 为准（功能提交 458dec1 时为 10 files +482/-69）

范围：
- 使用说明弹窗：本地模型 / 云端模型两个一级 Tab；
- 云端模型下再分硅基流动 / 智谱 / 阿里云百炼 / OpenAI 四个 Tab；
- 云端配置区四个服务商 Tab + 顶部单选启用；
- 四个服务商分别保存 endpoint/model/modelSpace/key，互不覆盖；
- 旧单份云端配置自动迁移；
- 云端维度自动识别（1024/1536/2048 等）。

验证：
- 插件测试、四服务商保存/启用测试、cloud dimension 测试、client contract、UI contrast、regressions 通过；
- test:audit 150/151：test-voice-cloud-credentials 在当前 worktree 失败，dev 主工作区通过；
  它是语音测试，不在本分支改动文件里；请合并在 dev 重跑确认。

必须人工验收：
重启 DSH → 记忆 → 向量记忆 → 使用说明 / Embedding 云端模型
确认四个 Tab、分别保存、顶部单选启用、无白屏。

不改版本、不打 tag、不发布。
```
