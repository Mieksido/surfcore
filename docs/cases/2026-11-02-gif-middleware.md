# 动图只剩第一帧 → GIF 中间层（16 帧胶片条）

## 现象

- 用户看到什么：
  - 群友发了一张 GIF 表情包，`qq_get_message_images` 把图返回给我，但我只能看到**第一帧**——明明是"抖动的米粒"却像一张静止画。
  - 我自己的 `gif-analyze` skill 能抽帧，但它要**磁盘路径**；QQ 消息里拿到的是字节，没有路径，所以那条路对 QQ 不成立。
- 复现步骤：
  1. 让群友（或自己）在群里发一张多帧 GIF；
  2. 调 `qq_get_message_images`（或 `qq_get_forward_msg`）；
  3. 返回的图片块在模型侧被归一化成单帧。
- 影响面：只影响"看懂动图"，不丢数据、不阻断消息；退回首帧就是旧行为。
  但会**持续误导**——模型会把一张 34 帧的动图当成一张静止图来描述。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 / DSH 版本 | Windows 11 / DSH 0.2.2-alpha.2 |
| SurfCore 版本 | `59ec306 release: v0.8.6`（本次改动未发版、未改 version） |
| 安装方式 | junction：`~/.dsh/plugins/surfcore` → 仓库根 |
| 其它相关版本 | SnowLuma `2.2.1-node`（OneBot v11）；node `v22.19.0`；ffmpeg `N-121028`（`C:\Users\gaohu\Desktop\workfile\ffmpeg转码工具\bin\ffmpeg.exe`） |

## 根因

- 代码位置：
  - `src/mcp-snowluma-safe.js` 的四个出图点：`qq_get_message_images`、`qq_get_sticker_image`、`qq_get_self_image`、`qq_get_forward_msg`——它们原本都是
    `content.push({ type: 'image', mimeType, data })`，把桥接给的 base64 原样交给 MCP 客户端。
  - 宿主侧 `@deepseek-ai/dsh-attachment-local`：把任何图片归一化成**单帧** 8 位 sRGB；直通判定排除 `image/gif`，重编码从不设 `animated`/`page`，所以解码只取第 0 页。
- 问题链条：桥接能拿到完整 GIF 字节（`bridge.js:9586` `fetchMediaData` 返回 `data(base64)`）→ MCP 层原样转发 → 宿主归一化那一刀把后续所有帧丢掉 → 模型只看到第 0 页。
- 为什么之前没发现：文本/静态图这条链路一直是对的；动图的问题只在"模型真的需要看懂动作"时才暴露，而且**不报错**——静默降级到首帧，看起来一切正常。

## 完整逻辑（给用户看的那一遍）

- **链路**：QQ → SnowLuma(OneBot) → `bridge.js`（`/api/images/message`，拿 base64）→ `mcp-snowluma-safe.js`（四个出图点）→ DSH 附件库 → 模型视觉输入。中间层必须插在"进 DSH 之前"，也就是 MCP 这一层。
- **机制**：不能改宿主的归一化（那是 DSH 核心契约），只能**在交付前自己把动图变成一张静态网格图**。四段式：
  1. `animationHint(buf, mimeType)`：只做字节特征判断（GIF 头 / WebP 的 `ANIM` / PNG 的 `acTL`），零 IO；静态图直接放行，不进 ffmpeg。
  2. `decode()`：先 `ffprobe -count_frames` 取帧数/尺寸/时长；ffprobe 缺失或输出无效时用 `ffmpeg -i … -f null -` 兜底。
  3. `sample()`：均匀采样到 **16 帧 / 4×4 / 每格长边 240**；帧数不足就全给（12 帧 → 4×3）；总像素超 1.4M 就缩边长。
  4. `render()`：一条滤镜链 `fps=<frames>/<dur>,scale=<edge>:-2,tile=4x4:padding=4:margin=4` 直接出**一张 JPEG**；可选 `drawtext` 打帧号，字体缺失自动降级。中间帧从不落盘。
  5. `encode()`：结构留着，明确返回 `not-implemented`（发送侧还没有图片段通路，现在做没有意义）。
- **爆炸半径**：1 个进程（MCP server）× 4 个出图点 ×（失败静默=3 → 已改成"退回首帧 + 一句人话"，且不阻断）。不碰用户数据、不碰密钥、不花钱（图片按像素计 token，一块 16 帧胶片条 ≈ 0.92M 像素）。
- **取舍**：
  - A：桥接落盘后给模型文件路径（要 pat）；B：只把 url 透给模型（SSRF 味道）；C：装 `dsh-read-animation`（只管本地文件与粘贴，管不到 QQ 消息）。
  - 选 D：**中间层 + 一张网格图**。理由：不碰 SSRF、不改宿主、不新增依赖（复用已装的 ffmpeg，与语音链路同源），失败可退回首帧。
  - 采样档位对比（实测，540×540、34 帧基准）：8 帧 4×2@320 = 111ms/190KB；16 帧 4×4@240 = 109ms/180KB。总像素几乎相同，但 16 帧的时间分辨率是 0.21s/帧 vs 0.42s/帧——对"动作"更重要，所以选 16 帧。
- **生效与重启**：MCP server 由 DSH 的 MCP 客户端 spawn，改完必须**重启 DSH**（桥接进程也要跟着重启才能加载新 `config.json` 里的 `socialV2.gif`）。
  缓存是**进程内 LRU**（键 = 字节 sha256 + 采样参数），重启即清，不落盘。

## 修法

- 新建 `src/gif-middleware.js`（533 行）：
  - 导出 `GIF_DEFAULTS`（`frames:16, maxEdge:240, cols:4, quality:4, maxInputBytes:32MB, maxFrames:600, timeoutMs:5000, cacheEntries:48, cacheBytes:24MB, label:true`）、`animationHint`、`resolvePaths`、`decode`、`sample`、`render`、`encode`、`toModelImages`、`buildEnvelope`、`fallbackNote`、`cacheStats`、`cacheClear`。
  - 子进程一律 `spawn(..., { stdio: 'ignore' | [fd] })`，**不用 pipe**（受限沙箱下 pipe 会 EPERM），与 `src/voice-core.js` 的 `probeAudio` 同款。
  - `toModelImages()` 是唯一入口：任何失败都返回 `{ ok:false, reason }`，由调用方决定退回原图。
- 改 `src/mcp-snowluma-safe.js`：
  - 顶部 `import { toModelImages, fallbackNote } from './gif-middleware.js';`
  - 新增 `expandImageContent(img)`：能展开 → `{ parts:[胶片条], note:信封 }`；展不开 → `{ parts:[原图], note:fallbackNote(...) }`；自己抛错 → 原图 + 空提示。
  - 四个出图点全部改走它（`qq_get_message_images` / `qq_get_sticker_image` / `qq_get_self_image` / `qq_get_forward_msg`），信封作为文本行插入。
  - 两个工具描述补一句"动图会自动展开成 16 帧胶片条"（模型看到网格图才知道那是什么）。
- `config.example.json`：`socialV2.gif` 段落（`enabled/frames/maxEdge/cols/quality/maxInputBytes/maxFrames/timeoutMs/cacheEntries/cacheBytes/label/ffmpegPath/ffprobePath`）。
- 为什么不在桥接里做：桥接的发送侧也读这些图片字节（会不会顺便把内容写进日志、审计），放 MCP 层只有"给模型看"这一个出口，改动面最小。
- 回滚方式：`socialV2.gif.enabled=false`（立刻退回旧行为，无需改代码）；或整段 revert 本次提交。

## 验证

- 自动化：
  - `node scripts/test-gif-middleware.mjs` → `✅ GIF 中间层通过（解码/采样/渲染/缓存 + 6 条 fail-open 分支）`
  - `npm run test:audit`、`npm run test:regressions` 结果见下（本次提交前跑）。
- 失败路径（都断言了 code 与文案）：
  - `static`（静态图/单帧 GIF）→ 不加任何提示；
  - `disabled` → 不加提示；
  - `too-large` → `（动图展开失败：文件太大，下面只有首帧，原图共 34 帧）`；
  - `too-many-frames` → 同上句式；
  - 坏数据 / ffmpeg 不可用 → `ok:false` 且 `reason` 非空，调用方退回首帧。
- 真实踩到的坑（都写成断言钉住了）：
  1. **ffprobe 对垃圾字节退出码 0**、还会从随机 GIF 头里读出 `28192x29807` 这种鬼尺寸 → 加了 `saneSize()`（16 ≤ 边长 ≤ 16384）。
  2. **async try/finally 陷阱**：`return decodeWithFfmpeg(...)` 不 await 时，finally 先把临时输入删掉，兜底 ffmpeg 拿去读就没了 → 三处改成 `return await`。
  3. 缓存键原先只有 sha256 → 调小 `maxFrames` 后仍命中旧缓存返回成功 → 键里加入采样参数，且命中缓存也重过一次上限校验。
- 手工：`%TEMP%\gifmw\bench.gif`（540×540/34 帧）上量到 16 帧 4×4@240 = 109ms / 180KB / 960×960。
- 本地文件实测：一张 15 帧的 GIF（540×540、1.5s、2.2MB）
  → 213ms 出 4×4 网格 980×980 / 259KB，二次调用命中缓存，`enabled:false` 明确退回首帧。
- 真实链路实测：**QQ 群消息端到端已验证**——群里发一张动图，模型侧收到完整 16 帧胶片条 + 文字信封，
  收发都完整。
- 已知降级：`drawtext` 帧号在字体缺失时自动退回无标注版（不阻断）。

## 遗留 / 后续

- 需要补的测试：真实 QQ 表情包（含 `mface` 商城表情）端到端一条；`qq_get_forward_msg` 里多张动图的组合。
- 需要改的文档：`docs/PITFALLS.md` 本条；`docs/HANDOFF.md` 快照。
- 已知边界：QQ 图片 url 带 rkey 会过期，事后补取会失败；`mface` 常常根本没有图片字节（此时连首帧都没有）。
- 待定：胶片条会进 DSH 附件库（内容寻址、同字节只存一份、**永不自动清理**），一条动图 ≈ 180KB。如果要更省，可把 `quality` 调到 6–8，或整段关掉。
