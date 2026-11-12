# 本地语音包安装慢/卡住/下载失败

日期：2026-11-02

## 1. 现象

- 本地语音包（voice-local）安装：
  - 一开始 `fetch failed`；
  - 绕过代码 zip 后，拉模型卡在 51%（进度条 95%），36 分钟后仍在；
- 报告文件：`C:\Users\Mieksido\Downloads\REPORT-voice-pack-download-failure-2026-11-01.xls`
- 环境：Windows 11、Node 24（undici 默认 connectTimeout 10s）、github.com 直连 10–17s、Python 只有 3.13。

## 2. 根因

### 2.1 代码 zip 秒失败

默认安装源 `<repo>/../voice/packages/voice-local` 在用户机器不存在，回退：

```text
https://github.com/<repo>/archive/refs/heads/main.zip
```

Node `fetch`（undici）连接 github.com 默认 10s 超时；本机实测 codeload 0.97s、release 资产 1.49s，github.com 主站 16.5s。

`fetchToLocal()` 没有超时/重试/镜像，错误只留 `fetch failed`，没有 `cause.code`。

### 2.2 1.84GB 模型分卷

`scripts/fetch-models.mjs`（在语音包内，不在 SurfCore 仓库）：

```js
const args = ['-L','--fail','--retry','3','--retry-delay','2','--progress-bar'];
if (hasPart) args.push('-C','-');
```

`curl --retry` 内部重试会重新打开 `-o` 目标并截断 `.part`；只有跨脚本运行时才带 `-C -`。慢网/抖动会反复归零。

同时：

- 4 分钟无进展就 `taskkill /IM curl.exe /T /F`，会误杀同机其他 curl；
- SurfCore postInstall 45 分钟硬超时，1.84GB 在 0.2–2MB/s 下需要 30–150 分钟，必然误杀。

### 2.3 进度条说谎

```js
rec.progress = Math.min(99, Math.round(90 + pct * 0.09));
rec.phase = `拉取模型 ${pct}%`;
```

51% → 进度条 95%；用户看到“51% 文案 + 95% 进度条”。

### 2.4 失败后仍显示已安装

`installed` 只看 `config.toml` 或端口；安装失败但 config 已生成时仍是 `installed: true`，用户不会去点重装。

### 2.5 Python 3.12 缺口

本地音色 GPT-SoVITS 需要 ≤3.12；用户只有 3.13，`bootstrap-env.mjs` 静默跳过 `.venv-gsv`。voxd 8765 能起，但 9880 没有，发语音 503。

## 3. 本批修了什么（SurfCore 侧，最小风险）

- 代码 zip 回退从 `github.com/.../archive` 改为 `codeload.github.com/.../zip`；
- `fetchToLocal()`：
  - `AbortSignal.timeout(30_000)`；
  - 镜像优先、原地址兜底；
  - 网络错误/5xx 重试 2 次；
  - 错误带 `cause.code`，不再只报 `fetch failed`；
  - 代码 zip 也吃用户选的镜像。
- postInstall 超时 45 分钟 → 默认 3 小时（可用 `postInstallTimeoutMs` 覆盖）；
- 进度拆成：
  - `transferPct`：真实下载百分比；
  - `progress`：总进度；
  - UI 显示“拉取模型 · 下载 51% · 总进度 95%”，不再混成一个数。
- 安装失败时 UI 增加「继续下载 / 重试安装」，调用 `install(force:true)`，保留 `.part`/已完成分卷。

## 4. 没修 / 需要语音包侧

- `scripts/fetch-models.mjs` 在语音包内，SurfCore 仓库没有源码：
  - `curl --retry` 截断 `.part`；
  - `taskkill /IM curl.exe` 误杀。
  这两条需要发新的 voice-local 包；SurfCore 只能延长超时、保留进度和给重试入口。
- Python 3.12 探测/自动安装仍没做；只在报告里明确，不在本批改。
- `installed` 的持久失败状态还没落盘；当前只修了“失败当下”的 UI 重试。

## 5. 风险

- codeload 也可能被网络限制；需要保留镜像/本地导入。
- 3 小时超时可能让真正卡死的安装占更久；包内 4 分钟无进展看门狗仍应负责。
- 代码 zip 重试会重新下载整个 zip（没有持久断点），但代码体积小。
- 进度改成两个数字后，用户第一次看到“总进度 95%”仍可能疑惑；文案已明确“下载 51%”。
- `force:true` 重试会先 `clearPackKeepingAssets`，但保留 `.part`/models；失败不会丢已完成分卷。
- 没改语音包脚本，慢网根因仍可能复发。

## 6. 验证

```text
node scripts/test-voice-packs-default.mjs
node scripts/test-voice-gui.mjs
node scripts/test-voice-system.mjs
node scripts/test-voice-cloud-credentials.mjs
npm run test:audit
cd plugins/surfcore && npm test
```
