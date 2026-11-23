# 2026-11-23 语音包「重装」必然失败：平铺函数看不到残留，还坚持 `dirs.length === 1`

## 现象

- 用户在设置 → SurfCore → 语音里对「本地语音包」点**重装**，进度走到 96% 后变成「失败」：
  `安装包里缺少 scripts/fetch-models.mjs（可能下载到了不完整的版本），请重试或先删掉
  E:\DSH\surfcore\state\voice-packs\voice-local 再装`
- 按提示删目录再装会「成功」（因为目录被删干净，没有残留），但**只要目录里已经有 config.toml / models / logs，
  重装就一定失败**，等于「装过一次就再也修不好」。
- 影响面：单个包目录，不丢模型、不丢配置（失败发生在 postInstall 之前）；但用户看到的是「包不完整」，
  很可能被引导去删掉整个 1.8GB 的 models 目录，恢复成本很高。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 build 26300 / DSH 桌面版 |
| SurfCore 版本 | v0.8.9 + 本机未提交改动（HEAD `0ce8580`） |
| 安装方式 | junction（`E:\DSH\home\plugins\surfcore` → `E:\DSH\surfcore\plugins\surfcore`） |
| 其它相关版本 | voice-local 包 source = `codeload.github.com/Mieksido/surfvoicelocal/zip/refs/heads/main` |

## 根因

- 代码位置：`src/voice-packs.js`
  - `install()` 第 800 行上下：`await clearPackKeepingAssets(dir)` → `fetchToLocal(...)` → `await flattenSingleDir(dir)`
  - `clearPackKeepingAssets()`：把 `PACK_KEEP`（`models`、`vendor`、`.venv`、`logs`、`config.toml` …）挪出去再挪回来
  - `flattenSingleDir()` 旧实现：
    ```js
    const dirs = entries.filter((e) => e.isDirectory());
    const files = entries.filter((e) => !e.isDirectory());
    if (dirs.length !== 1 || files.length > 0) return false;
    if (await exists(path.join(destDir, 'config.toml'))) return false;
    ```
- 问题链条：
  1. 重装 = 先保住 `PACK_KEEP`，清空其余，再解压代码 zip；
  2. 解压后目录里同时有：保留下来的 `models/`、`logs/`、`config.toml`，以及新解压的 `surfvoicelocal-main/`；
  3. 旧 `flattenSingleDir` 要求「恰好一个子目录、零个文件、没有 config.toml」——这三个条件在全被残留破坏；
  4. 平铺被跳过，包根永远是空的，`postInstall` 的 `scripts/fetch-models.mjs` 自然找不到 → 报「包不完整」。
- 为什么之前没发现：新装（目录不存在）时没有残留，条件刚好成立；测试与本机自测都只走过「全新安装」。
  另外 `flattenSingleDir` 虽然被 export 了，但没有单元测试。

## 完整逻辑（给用户看的那一遍）

- **链路**：设置页「重装」→ `POST /api/voice/packs/install { id, force:true }` → `install()` →
  解压 GitHub archive 到包目录 → `flattenSingleDir()` → `node scripts/fetch-models.mjs`（1.84GB）→
  `node scripts/bootstrap-env.mjs`（建 `.venv` / `.venv-gsv`）→ 起 `voxd`（8765）与 GPT-SoVITS（9880）。
- **机制**：重装不是「删了重来」，而是「保资产、换代码」——这是为了断点续传的 `.part` 和用户的 `config.toml`。
  但平铺函数是按「干净目录」写的，两者契约不一致：保留下来的东西被当成「不是包根」的证据。
- **爆炸半径**：桥接进程 1 × 读写该目录的 1 个函数 × 静默=3 = 3 分；不碰密钥、不花钱，但会把用户推向「删 1.8GB 模型」的错误恢复路径。
- **取舍**：
  - A. 重装前把 `PACK_KEEP` 挪到同盘临时目录，平铺完再挪回：改动大，多一次 1.8GB 目录 rename（同盘 rename 其实很快）。
  - B. 让 `flattenSingleDir` 忽略 `PACK_KEEP` 的名字、并对同名目标做合并：改动集中在 20 行，且天然兼容「用户 config.toml 不能被模板顶掉」。**选 B**。
  - C. 解压到临时目录、平铺好再整体拷进包目录：最干净，但要复制 1.84GB 的 models，浪费 IO。
- **生效与重启**：桥接 `E:\DSH\surfcore\src\bridge.js` 下次启动才载入新代码；设置页「重装」走的是桥接进程，所以要重启桥接。

## 修法

- `src/voice-packs.js`
  - `PACK_KEEP` 提到**模块作用域**（原来在 `createVoicePacks` 闭包里，`flattenSingleDir` 根本引用不到——
    修完第一条才会暴露这个 `ReferenceError`，所以两处一起改）。
  - `flattenSingleDir()`：先过滤掉 `PACK_KEEP` 里的名字再判断「是不是恰好一层」；删掉「有 config.toml 就放弃」的守卫；
    逐项搬运，目标已存在时目录用 `fsp.cp({ recursive:true, force:false, errorOnExist:false })` 合并、文件保留用户版本。
- `scripts/test-voice-flatten-reinstall.mjs`（新增）：造一个「残留模型/日志/config.toml + 新解压 `<repo>-main/`」的目录，
  断言平铺成功、脚本到位、用户 config 未被顶掉、`.part` 保留、models 合并；再断言「顶层两个文件」不会被误判为包根。
- 回滚：`git checkout -- src/voice-packs.js scripts/test-voice-flatten-reinstall.mjs`（重装问题回到旧行为，不影响已装好的包运行）。

## 验证

- `node scripts/test-voice-flatten-reinstall.mjs` → 7 项全绿。
- `node --check src/voice-packs.js` → OK。
- 本机真机：手动把 `surfvoicelocal-main/` 平铺进包根后，`node scripts/fetch-models.mjs` 正常开始下载 1.84GB 模型
  （修复前这一步的入口就是「找不到脚本」）。
- `npm run test:audit` 待整批改动一起跑。

## 遗留 / 下一步

- 模型下载 + `bootstrap-env.mjs`（要真 Python 3.10~3.13）是安装包自身的长尾，与本次修法无关。
- 本机现在只有应用商店的 `python.exe` 占位符，`bootstrap-env.mjs` 的 `findPythons()` 会全部落空——
  这条也值得在设置页给出「没有可用 Python」的明确提示（当前表现为 bootsrap 失败）。

## 补充（2026-11-23 22:50）：「引擎明明起来了，界面却报启动失败 exit 0」

冷启动实测暴露的第二个 bug：`run.bat` 用 `start "" /b pythonw.exe -m voxd …` 拉起 voxd 后**立刻**
`exit /b 0`，而 `start()` 的等待循环 `if (exitCode !== null) break;` 把「启动器退出 0」当成失败，
于是界面报 `VOICE_START_EXITED … exit 0；脚本输出：另一个程序正在使用此文件`，但端口其实 2 秒后就起来了。

- 修法：`src/voice-packs.js` 等待循环改成 `if (exitCode !== null && exitCode !== 0) break;`
  —— 退出 0 只说明启动器把服务甩出去了，继续按端口轮询；退出非 0 才是真失败。
- 真机验证（先杀掉 8765/9880 两个进程再点启动）：`{"ok":true,"port":8765,"seconds":2,"enginePort":9880,
  "engineStarted":true,"warning":"本地音色引擎加载约 40 秒…"}`；约 30 秒后 8765/9880 都监听，
  `packs/test` 合成返回 `{"ok":true,"ms":3810,"bytes":138240}`。
