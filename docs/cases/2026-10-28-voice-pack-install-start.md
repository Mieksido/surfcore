# 2026-10-28 · 语音包装完不可用：嵌套目录 / 启不动 / 停不掉

> 来源：用户提交的《语音包安装与启动问题分析》（含实测证据与代码定位）。作者据此复核并修复。

## 现象

1. 装完目录是嵌套的 `voice-local/surfvoicelocal-main/…`，顶层没有 `config.toml` / `models/` / `voices/`；
2. 点「启动」转圈 60 秒，报「启动超时（60 秒内端口没起来）」；
3. 点「停止」没反应，提示「端口还在监听（可能不是这个包占的）」；
4. 启动会弹出控制台窗口（uvicorn INFO 刷屏）；
5. GSV 环境装不全（缺 ffmpeg/pytorch_lightning/matplotlib/resampy/onnxruntime/python-multipart，`jieba_fast`/`pyopenjtalk` 在 Windows 装不上），且缺 `logs/gsv/tts_infer.yaml`；
6. pip 直连 pypi 超时。

## 根因

| # | 根因 | 位置 |
| --- | --- | --- |
| 1 | **拍平判定看 `config.toml`**，而仓库只有 `config.example.toml` → 永远不拍平 | `src/voice-packs.js` `flattenSingleDir()` |
| 2 | `run.bat` 里有 `pause`，被隐藏窗口拉起时永久等待 → 端口起不来 | 语音包仓库 `run.bat` |
| 3 | `stop.bat` 假设 `Get-NetTCPConnection` 只返回一个对象 → 数组时 `Get-Process` 报错，什么都不杀 | 语音包仓库 `stop.bat` |
| 4 | 用 `python.exe` 起 voxd → 有控制台窗口 | `run.bat` / `gsv.bat` |
| 5 | `requirements-gsv.txt` 缺 6 个包；`jieba_fast`（C 扩展）、`pyopenjtalk`（要 cmake）在 Windows 装不上 | `requirements-gsv.txt` |
| 6 | 仓库里没有 `logs/gsv/tts_infer.yaml`（api_v2 必须有） | 语音包仓库 |
| 7 | pip 直连 pypi 在国内不稳 | `bootstrap-env.mjs` |

## 修法

**插件侧（SurfCore）**

- `flattenSingleDir`：判定改成 `package.json / models.json / version.json / config.example.toml` 任一存在，并返回布尔；
- `start()`：子进程 `stdio: ['ignore','ignore','pipe']`（stdin 给空句柄，pause 也不会卡死），收 stderr 进错误信息；
  60 秒超时后 `taskkill /T /F` 杀掉本次拉起的进程树；
- `stop()`：`stop.bat` 之后仍占端口 → 按端口找监听进程强杀（兜底老脚本）；
- `remove()`：端口仍在监听 / 目录 EBUSY 时给人话提示，不抛原始错误。

**语音包侧（surfvoicelocal / surfvoicecloud）**

- `run.bat`：删掉所有 `pause`；8765 已占用直接 `exit /b 0`；voxd 用 `pythonw.exe` 并重定向日志；
- `stop.bat`：`netstat -ano | findstr :端口 | findstr LISTENING` + `taskkill /PID … /T /F`；
- `gsv.bat`：删 `pause`，改 `pythonw`，日志写 `logs/gsv/api.log`；
- `requirements-gsv.txt`：补 `ffmpeg-python / pytorch-lightning / matplotlib / resampy / onnxruntime / python-multipart`；
  `jieba_fast → jieba`、`pyopenjtalk → pyopenjtalk-prebuilt`；
- `bootstrap-env.mjs`：pip 失败自动换清华/阿里镜像重试；自动生成 `logs/gsv/tts_infer.yaml`
  （按 `nvidia-smi` 是否可用写 `device: cuda/cpu`、`is_half: true/false`）。

## 验证

- 新增 `test-voice-flatten.mjs`（已进 `npm test`）：
  真实仓库布局（无 config.toml）能拍平；顶层已有包文件 / 多目录 / 无包标记时不误拍；
- `npm run test:audit` 77/77；插件测试 0 失败；
- **未验证**：真实 Windows 无显卡机器上跑完整「装 → 启 → 合成 → 停」链路（需要一台干净机器）。

## 遗留

- 本地包仍要求能装 torch；无 N 卡时 CPU 推理慢（报告实测 2~5 秒/句）；
- `models` 归档内容（`zh_CN-huayan-medium.onnx`）靠默认 `--dir models` 落地；若有人手动跑脚本要注意 `--dir`；
- 拍平只处理「恰好一层」；更多层嵌套仍会失败（报错已可读）。
