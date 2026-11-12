# 2026-11-03 优化基线（第一张表）

> 目的：**先量，再改**。这张表是后续每个优化的“改前”参照；本文不包含任何优化结论。
> 工作树：`D:\deepseekwork\surfcore-optimize`，分支 `feat/optimize`，基线提交 `9db668a`（dev，2026-11-03），版本 `0.8.8`。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows（PowerShell 7） |
| Node | v24.19.0 |
| 仓库 | git 工作树，738 个跟踪文件；安装清单 681 条 |
| 运行态 `state/` | 只读统计主工作区 `D:\deepseekwork\surfcore\state`（正在运行的实例） |
| 网络 | 工作树未配置 git remote，且没有 `GH_TOKEN`；发布类指标只做静态口径，不实际发版 |

## 基线表

| 指标 | 口径 / 命令 | 改前 | 备注 |
| --- | --- | --- | --- |
| 全量 audit 耗时 | `node scripts/test-audit.mjs`，墙钟 | **75.9 s**，142/143 | 143 个脚本串行；唯一失败见下 |
| 插件测试耗时 | `plugins/surfcore` 下 `npm test`，墙钟 | **70.2 s**，全绿 | 末尾 token 服务 39 项通过 |
| dev 发布上传量 | `git ls-files` 的文件数 | **738 个 blob** | 发布脚本对每个文件都 POST 一次 blob |
| dev 发布纯等待下限 | 2 并发 × 每文件 150ms | **≥55.4 s** | 738/2×150ms，不含 738 次 POST 的网络往返；历史发一次“数分钟” |
| 唤醒提示词：群聊 tone | `state/context-telemetry-bridge.jsonl` 的 `kind=wake.promptChars` | n=475，平均 **10,668**，中位 10,662，p90 11,483，最大 12,592 | 2026-10-31 02:34 → 2026-11-02 20:34（UTC） |
| 唤醒提示词：私聊 full | 同上 | n=8，平均 **9,052**，中位 9,307，最大 9,784 | 私聊样本少，不能当稳定基线 |
| `state/` 总体积 | `Get-ChildItem state -Recurse -File \| Measure-Object Length -Sum` | **314,834,084 B ≈ 300.3 MiB**，3,450 文件 | 其中 voice-packs 278.7 MB、voice-tts 14.9 MB |
| `state/` 非语音运行时 | 排除 `voice-packs/`、`voice-tts/` | **6.67 MB**，46 文件 | 日志/账本：token-usage 2.26 MB、context-telemetry 1.68 MB、tool-calls 1.11 MB（含 .1）、bridge.log 0.19 MB、qq-activity 0.13 MB |
| 设置页首屏请求数/耗时 | 浏览器 DevTools（人工） | **未测** | 需要真浏览器；测 E 前补 |

## 已知口径问题（后续对比时必须同一口径）

1. **audit 唯一失败是环境问题，不是代码回归**：`test-stickers.mjs:127` 直接读仓库根 `config.json`，新工作树没有这个本地文件（被 `.gitignore` 排除），报 `ENOENT`。主工作区有 `config.json` 时应为 142/143 → 143/143。**不能把含 token 的 `config.json` 复制进工作树**；要么在测试里改成“文件缺失则跳过该段”，要么用临时夹具。这条本身可能是待选的优化项，等用户定。
2. **提示词字符数来自真实遥测，不是可复现的构建结果**：tone/full 还混着群/私聊不同的上下文段，只能当趋势。若做 C（提示词瘦身），改前改后必须用同一份夹具/同一入口生成提示词再量，不能拿这张表的绝对值当验收。
3. **发布耗时没有真跑**：工作树无 remote、无 token，实际发版会写 dev 远端，不能在优化会话里做。上传量 738 是确定的；耗时用“纯 sleep 下限 + 历史数分钟”描述。做完 A 后，用发布脚本自己的 dry-run/计划输出记录“复用 X / 上传 Y”，再和 738 对比。
4. **`state/` 大头是语音运行时**（293.6 MB），不属于日志轮转目标；D 类优化应盯 token-usage / telemetry / tool-calls / bridge.log / qq-activity 这几个无上限文件。

## 复测命令

```powershell
cd D:\deepseekwork\surfcore-optimize

# 1) audit（串行，约 76s）
Measure-Command { node scripts/test-audit.mjs }

# 2) 插件测试（约 70s）
Push-Location plugins\surfcore; Measure-Command { npm test }; Pop-Location

# 3) 发布静态口径
(git ls-files | Measure-Object).Count
node -e "const m=require('./release/install-manifest.json');console.log(Object.keys(m.files).length)"

# 4) 唤醒提示词（读主工作区运行态遥测）
node -e "const fs=require('fs');const ls=fs.readFileSync('../surfcore/state/context-telemetry-bridge.jsonl','utf8').split(/\r?\n/).filter(Boolean);const g={};for(const l of ls){const o=JSON.parse(l);if(o.kind!=='wake'||!o.promptChars)continue;const k=String(o.key||'').startsWith('group:')?'tone':'full';if(!g[k])g[k]=[];g[k].push(o.promptChars)};for(const[k,a]of Object.entries(g)){a.sort((x,y)=>x-y);console.log(k,'n='+a.length,'avg='+Math.round(a.reduce((x,y)=>x+y,0)/a.length),'p50='+a[a.length>>1],'max='+a.at(-1))}"

# 5) state 体积
Get-ChildItem ..\surfcore\state -Recurse -File | Measure-Object Length -Sum
Get-ChildItem ..\surfcore\state -Recurse -File | Where-Object { $_.FullName -notmatch '\\voice-packs\\|\\voice-tts\\' } | Measure-Object Length -Sum
```

> 注：第 4 条的示例命令为了可读性省略了异常行容错；正式对比时用同一段脚本，别边量边改口径。
