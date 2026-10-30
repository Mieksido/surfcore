# bot 看不了 QQ 长图（DSH 图像准入按单边像素拒收长截图）

## 现象

- 用户原话：**「bot看不了qq长图」**。
- 现场（2026-10-30 12:05–12:06，`group:100000001`）：
  - bot：「确实看不到，长图单边像素超了我这边的上限，不是群的问题。你要是想让我看，截成两段发…」
  - 用户：「能自己截断看吗」；bot：「不行，我这边看图只能整张读，没有裁剪那一步」。
- 复现：在群里发一张 1320×15378 的 QQ 长截图（`messageId=-100000003`），然后调
  `qq_get_message_images`。工具确实抓到了 2.28MB JPEG（HTTP 200、`ok:true`），但 DSH 侧
  只把这段文字交给模型：
  `[image1][image unavailable: image/jpeg; image admission rejected the result: Image exceeds the configured per-side pixel limit.; raw image data remains available to programmatic callers]`
- 影响面：所有单边 > 8192px 的图（长截图/长漫/拼图）都"能下载、能返回、模型看不见"。
  不丢数据、不花钱、不碰密钥；普通照片/表情不受影响。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.1-rc.2（`app.asar` 内置 sharp 图像管线） |
| SurfCore 版本 | 0.7.8（commit aa683d9）+ 本工作树改动 |
| 安装方式 | 本机 `<repo>`（开发树） |
| 其它 | SnowLuma 在线；模式 reserved2；本机 Python 3.12 + Pillow 12.3.0（DSH 自带运行时） |

## 根因

- 代码位置：
  - 桥接侧：`src/bridge.js` 的 `fetchMediaData()` / `acceptImageBuffer()`（原实现只校验
    **总像素 ≤ 64MP / 字节 ≤ 8MB**，没有"单边"概念）；
  - DSH 侧（`app.asar` 内 `detectImage`）：`maxPixels=64e6`、**`maxDimension=8192`**、
    `maxImageBytes=20MB`；归一化再压到 `normalizedImageMaxPixels=4194304`（4MP）。
- 问题链条：
  1. `qq_get_message_images` → 桥接 `/api/images/message` → `fetchMediaData()` 抓到原图
     （1320×15378，2.28MB）→ `acceptImageBuffer()` 通过（20.3MP < 64MP、2.28MB < 8MB）→
     原样 base64 返回；
  2. MCP 工具把它作为 `type:'image'` 交给 DSH；
  3. DSH 准入 `detectImage` 发现 `max(width,height)=15378 > 8192` → 抛
     `IMAGE_DIMENSION_TOO_LARGE`，**整张图不进模型上下文**，只留一句 `[image unavailable...]`；
  4. 就算把准入放开到 64MP，归一化会把 20.3MP 等比压到 4MP：1320 宽 → 约 600px 宽，
     长截图的字同样看不清。所以"只调大上限"是假解法。
- 为什么之前没发现：图片链路的测试都在测"能不能拿到图 / 能不能发出去"
  （`test-media-search`、`test-vision-media`、`test-media-wake`），没有一条用**超长图**
  走一遍"抓图 → 交给模型"。上游（桥接）和下游（DSH）双方各自的限制都在，但中间没有对齐。

## 完整逻辑（给用户看的那一遍）

- **链路**：QQ 长图 → SnowLuma → `src/bridge.js` `handleIncoming()`（提取 `mediaList`）→
  agent 调 `qq_get_message_images` → 桥接 `/api/images/message` → `fetchMediaData()` →
  MCP server `src/mcp-snowluma-safe.js` 转成 `type:'image'` 内容 → **DSH 图像准入** →
  模型。本修复加在 `fetchMediaData()` 里、MCP 之前：切好的多张图对后面所有环节完全透明
  （MCP 工具、DSH 准入、模型都当普通图片处理）。
- **机制**：DSH 的图像准入是"单边 + 总像素 + 字节"三道硬闸，**先准入再归一化**；
  桥接原来只按"总像素 + 字节"自检，漏掉了单边这条。长截图的特点恰好是"总像素不高但单边极长"
  （1320×15378 = 20.3MP），所以它是唯一会绕过桥接自检、被 DSH 拒收的一类图。
  而切段后每段 1320×3000 = 3.96MP、单边 3000，三道闸全部通过且**不会触发归一化缩放**
  （4MP 预算内），文字保持原始清晰度。
- **爆炸半径**：1 个进程（bridge）× 读者：`fetchMediaData`（工具链路）+ `resolveMediaList`
  （一代内联链路），两处都接；不改 `state/*.json` 结构、不改 MCP 协议、不新增必填配置。
  失败=静默 3 分 × 2 读者 = 6 分，所以"拿不到 Pillow / 切图失败"都必须把原因交给模型
  （已有失败分支断言）。成本：每张长图多一次进程 spawn + 约 1 秒 CPU；不额外花钱
  （图片 token 反而从"一张不可见"变成"6 张可读"，一次看图多几千 token，但这是用户要的能力）。
  安全面：只处理已经在内存里的图片字节，临时文件写在系统临时目录并在 finally 里删除；
  Python 只执行仓库内置脚本（脚本内容固定，不拼接用户输入）；不碰 state/ 与密钥。
- **取舍**：
  - A. 把 DSH 的 `maxImageDimension` 调大：能收但归一化后字糊，且改的是宿主全局策略 ✗；
  - B. 只在提示词里让模型"请对方截两段"：复现用户已经这么干了，等于没修 ✗；
  - C. 桥接切段（本方案）：每段都落在准入+可读区间内，模型按顺序读多张图 ✓；
  - D. 用纯 JS 图像库（jimp/jpeg-js）切：要新增依赖，1320×15378 纯 JS 解码+重编码
    要几十秒，工具 180s 超时风险高 ✗；Pillow 是 C 实现，实测 0.87s ✓。代价是依赖本机
    Python+Pillow —— 它随 DSH 运行时分发（`$DSH_HOME/dsh-runtimes/.../python`），
    DSH 用户默认都有；没有时降级成一句可行动说明，并可用 `socialV2.media.pythonPath` 指路。
- **生效与重启**：`src/bridge.js` + 新模块 `src/long-image.js` 由**桥接进程**加载，
  只改代码不重启不生效（重启矩阵见 `docs/guides/12-LESSONS-ARCHITECTURE.md` §8）；
  `config.json` 的 `socialV2.media.*` 同样只在桥接启动时读。

## 修法

- 新增 `src/long-image.js`（纯逻辑 + Pillow 执行器，只依赖 fs/os/path）：
  - `planLongImageSlices(w,h,limits)`：触发条件 = 单边 > 8192 **或**（像素 > 4MP 且长宽比 ≥2.5）；
    纵向切段，段高 = min(3000, 4MP/宽)，相邻重叠 80px，段数上限 12，最后一段必须盖到底部；
    宽度超 8192 的图先等比缩（超高不缩，靠切）。
  - `sliceImageWithPillow({buffer,mimeType,plan,pythonPath,run})`：写临时源图 + 计划 + 脚本，
    调 Python 产出 JPEG 段，读回内存后删临时目录；`run` 由调用方注入（测试可换假进程）。
  - `pythonCandidatesFromEnv()`：配置路径 → DSH 自带运行时 → PATH。
- `src/bridge.js`：
  - `media` 配置归一化新增 `sliceLongImages / modelMaxSide / modelMaxPixels / sliceMaxHeight /
    sliceMaxCount / pythonPath`（坏值收敛）；
  - 新增 `resolveImagePython()`（探测 + 缓存）/ `splitLongImageForModel()`（计划 + 切段 +
    错误文案）；`fetchMediaData()` 与 `resolveMediaList()` 都接上，一次工具调用最多 12 张；
  - 每段带 `part:{i,n}` 与"长图第 i/n 段"标签（MCP 工具现有 `img.text` 渲染即可显示）。
- 回滚方式：`config.json` → `socialV2.media.sliceLongImages:false` + 重启桥接（代码不用退）；
  彻底回退 `git revert`。

## 验证

- 自动化：`node scripts/test-long-image.mjs` — 16 条全过：
  - 纯计划 11 条：普通照片不切、1320×15378 切成多段且每段在预算内/盖到底部、超长图段数封顶、
    宽超标先缩、坏尺寸不抛、配置覆盖、`isRescaleOnly`、开关收敛、Python 候选顺序、
    **探针必须是合法 Python（PIL_OK 带引号）**、脚本输出解析；
  - 桥接接线 5 条（假 Python 进程）：长图 → 多段带标签、普通图原样、**没有 Pillow 时不静默**
    （断言文案含 Pillow + "截成两三段"）、切图失败降级、`sliceLongImages:false` 回退。
- `node scripts/test-audit.mjs` → 80/86；6 个失败全是沙箱 `spawn EPERM`
  （`test-audit-setup` / `test-qq-model-view` / `test-bili-state-paths` / `test-preset-local-tools` /
  `test-update-apply-result` / `test-update-version-fallback`），失败点在 spawn、未进入被测代码，
  与本次改动无关（本会话沙箱只放行 node 子进程，git/python 被拦）。
- 真机：用**真实 Pillow** 跑模块里的 `PILLOW_SLICE_SCRIPT` + `planLongImageSlices` 的输出：
  1320×15378 → 6 段（1320×3000 ×5 + 1320×778），479/586/468/463/531/110KB，0.87s；
  每段单边 3000 < 8192、3.96MP < 4.19MP，**落在 DSH 准入与归一化预算内**。
  抽看第 1 段：小作文截图文字清晰可读（原图是一张 X/Twitter 长截图）。
- 失败路径（用户看到什么 / 下一步）：图片工具结果里直接出现
  「长图 1320x15378 超过模型单边 8192 上限，本机又没找到带 Pillow 的 Python，没法自动切段；
  请把长图截成两三段再发，或直接告诉我想看哪一段。」——模型会原样转述给用户，不再瞎猜。
- **真机端到端已闭环**（2026-10-30 12:42，正常守护窗口启动的桥接）：
  - `state/bridge.log`：`12:42:48 [media] 长图切段可用：***` →
    `12:42:49 [media] 长图切段：1320x15378 → 6 段（每段 ≤1320x3000，原 2227KB）`；
  - 对 `messageId=-100000003` 调 `qq_get_message_images`，返回
    `[图片1 长图第 1/6 段] … [图片1 长图第 6/6 段]` 共 6 张，全部通过 DSH 图像准入
    （预览 1320×3000 ×5 + 1320×778），六段内容连续、文字清晰可读。
- 开发过程踩的坑（值得记）：第一版探针写成了 `python -c "import PIL; ...; print(PIL_OK)"`，
  `PIL_OK` 没有引号 → Python `NameError` → 非 0 退出 → 被当成"没有 Pillow"，
  真机第一次验证仍报"看不了长图"。修法：`PIL_PROBE_CODE` 常量写成 `print('PIL_OK')`，
  并加了一条单测钉住"PIL_OK 必须是字符串字面量、探针不能是 print(PIL_OK)"。
- 没验证到的部分（老实写）：移动端超长图段数 >12 的场景只测了计划层（会明确告知"只提供前
  12 段"），没有真机样本；设置页 UI 开关未做。

## 遗留 / 后续

- 设置页还没暴露 `socialV2.media.sliceLongImages` 等开关（config.json-only）；要进 UI 需
  同步 `console-ui-contracts.json` 与 `test-console-*` 契约，另开一批。
- 移动端超长图可能超过 12 段上限：当前会明确告知"共 n 段，本次只提供前 12 段"，够用；
  若用户常发更长的图，可再把 `sliceMaxCount` 调大（每段 token 成本要一起评估）。
- 运维注意：桥接的 `/api/restart` 只是 `process.exit(0)`，**依赖 start.bat 守护窗口**
  才会自动拉起；如果桥接是手动/插件裸起的，点重启会留下停机（这次调试中发生过一次）。
  以后要重启，确认守护窗口在跑，或直接双击 `restart.bat`。
