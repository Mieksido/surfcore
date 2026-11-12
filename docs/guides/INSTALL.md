# 手把手安装（Windows）

> 目标：从一台干净的 Windows 电脑，到"她在群里回第一句话"。
> 全程约 **20 分钟**，其中 10 分钟是等下载。
>
> 如果卡住，先看最后的 [§9 出错怎么办](#9-出错怎么办)，那里覆盖了 90% 的失败。

---

## 0. 最省事：用安装包（推荐给"完全没接触过"的人）

把 `surfcore-install-kit-vX.Y.Z.zip` 发过去，对方解压后：

1. 双击 **2-安装.bat** —— 自动检查环境、下载 SurfCore、装依赖、装进 DSH、生成配置；
2. 完全退出 DSH 再打开；
3. 设置 → SurfCore → 诊断 → **一键安装（全部）**，填主人 QQ、勾群；
4. 群里 @ 她。

出问题让 TA 双击 **3-自检.bat**，把生成的 `诊断报告.txt` 发回来。

> 安装包不需要 git，但**仍需要**先装好 Node ≥22.13、DSH、SnowLuma（第三方，不能代装）。

## 0.1 手动安装：开始前，先确认这四样

打开 PowerShell（开始菜单搜 `pwsh` 或 `powershell`），逐条粘贴：

```powershell
node -v          # 需要 >= v22.13.0
git --version    # 需要能输出 git version 2.x
```

再看两样：

| 需要 | 怎么确认 |
| --- | --- |
| **Windows 10/11** | 设置 → 系统 → 关于 |
| **DeepSeek Harness（DSH）** | 能打开 DSH 的 Web 界面；版本需 **0.2.1-rc.2 或更新（rc.3 已能安装，功能未完整回归）** |

少哪个装哪个：

- Node：<https://nodejs.org/> 下 **LTS**（≥22.13），装完**重开终端**再 `node -v`；
- DSH：按你拿到的方式安装，能进 Web GUI 就行；
- SnowLuma：见第 2 步。

> ⚠️ 不要把 git 链接直接丢给 DSH。原因见 [§10 为什么不支持](#10-为什么不能把-git-链接丢给-dsh)。

---

## 1. 装 SnowLuma（收 QQ 必需）

SnowLuma 是第三方的 QQ 运行时，**本项目不打包、不代装**（EULA §5.4），你自己下：

1. 打开 <https://github.com/SnowLuma/SnowLuma/releases/latest>；
2. 下载最新的 Windows 压缩包，解压到一个**路径里没有中文和空格**的目录（例如 `D:\SnowLuma`）；
3. 运行里面的启动程序，**用你的 QQ 扫码登录**（建议先用小号）；
4. 登录后打开它的 **OneBot v11** 设置，记下三样东西：

| 要记的 | 默认值 | 在哪看 |
| --- | --- | --- |
| HTTP 端口 | `3000` | OneBot / 接口设置 |
| WebSocket 端口 | `3001` | 同上 |
| access token | 可能为空 | 同上（如果有，一定要记下来） |

> 端口被占用时 SnowLuma 会自动换端口，**以它界面上显示的为准**。

> 注入失败（`connect ETIMEDOUT \.\pipe\mojo.…`）、检测不到、控制台连不上、
> 「有正在进行的任务不让关」等，见 [SnowLuma 排错](SNOWLUMA_TROUBLESHOOT.md)。

---

## 2. 拿到 SurfCore

```powershell
cd D:\
git clone https://github.com/Mieksido/surfcore.git
cd surfcore
npm install
```

`npm install` 会顺带跑一个补丁脚本（修 `@snowluma/sdk` 的 ESM 问题），看到 `postinstall` 相关的输出是正常的。

> 别下 ZIP 包：ZIP 没有 `.git`，以后"检查更新"会显示不可用。

---

## 3. 生成配置

```powershell
copy config.example.json config.json
```

然后用记事本 / VS Code 打开 `config.json`，**只改这 4 处**：

### 3.1 SnowLuma 连接

```jsonc
"snowluma": {
  "wsUrl": "ws://127.0.0.1:3001",       // 第 1 步记的 WS 端口
  "httpUrl": "http://127.0.0.1:3000",   // 第 1 步记的 HTTP 端口
  "accessToken": ""                      // 有就填，没有留空
}
```

### 3.2 你是谁（管理员）

```jsonc
"ownerQQ": 1000000001                    // 换成你自己的 QQ 号（数字，不要引号）
```

### 3.3 白名单（**最容易漏的一处**）

```jsonc
"allow": {
  "private": [1000000001],               // 允许私聊她的 QQ 号
  "groups":  [100000004]                 // 允许她出现的群号
}
```

> **白名单为空 = 谁都不理**。这不是"全放行"，是"谁都不放行"。第一次装最容易卡在这。

### 3.4 控制台令牌

```jsonc
"consoleToken": ""                       // 留空会自动生成，存在 state/console-token
```

改完保存。**`config.json` 不会被更新覆盖**（它不在 git 里），放心填。

---

## 4. 装进 DSH

```powershell
node scripts/setup-dsh.mjs
```

> 不用填 profile：脚本会自己判断（`DSH_PROFILE` → 正在运行的 DSH 进程 → 最近使用过的那套）。
> 想强制指定就加参数：`node scripts/setup-dsh.mjs desktop`。

它做三件事（可重复跑，幂等）：

1. 往 DSH profile 里插 `qq-chat` / `qq-chat-v2` 两条 agent preset；
2. 在 `cordis.patch.yml` 挂三个 MCP server（QQ 工具 / SnowLuma 探活 / 只读搜索）；
3. 在 profile 的 `package.json` 注册 `surfcore` bundle。

装到别的 profile：

```powershell
node scripts/setup-dsh.mjs desktop
```

**然后重启 DSH**（不是刷新页面，是退出重开）。

---

## 5. 启动，让它跑起来

重启 DSH 后：**设置 → SurfCore → 概览 → 点「启动QQ」**。

或者命令行：

```powershell
npm start
```

看到控制台打印 `[bridge] OneBot 已连接` 就说明连上了 SnowLuma。

---

## 6. 第一次验证（三件事）

1. **群里 @ 她** → 她回一句；
2. **DSH 里出现对应会话** → 说明 prompt 投递成功；
3. 打开控制台 → <http://127.0.0.1:3100/>，用 `?token=你的令牌` 进：

```
http://127.0.0.1:3100/?token=<consoleToken>
```

令牌在哪：`state/console-token` 文件，或设置页「概览」。

> 三件事任一没成，去 [§9](#9-出错怎么办)。

---

## 7. 可选：语音包 / 桌宠

### 语音（二选一或都装）

```powershell
cd state\voice-packs
git clone https://github.com/Mieksido/surfvoicecloud.git voice-cloud
cd voice-cloud
node scripts\fetch-models.mjs      # 下载模型并校验
```

本地包同理（`voice-local`），体积大（约 1.8GB），按它 README 的 `fetch-models` 拉。

装好后：**设置 → 语音 → 选本地/云端 → 启动**。
⚠️ **AI 发语音默认是关的**，要在语音页和「工具开关」里打开 `sendVoice`。

### 桌宠

1. 去 <https://github.com/Mieksido/surfpet/releases/latest> 下 `pet-pack.zip`；
2. 设置 → 桌宠 → 填 Electron 路径（`electron.exe`）→ 填 zip 路径 → 安装 → 启动。

---

## 8. 升级

**设置 → SurfCore → 概览 → 更新 → 检查更新**。

- 本体与语音包走 git：只做 `--ff-only` 快进，**绝不覆盖你的 `config.json` / `state/`**（实测见下）；
- 桌宠走版本清单：下 zip → 校验 sha256 → 替换，**保留 `data/`**；
- 有本地未提交改动时会**拒绝更新**并说明原因，不会强行合并。

> 什么时候会被拒：你改过仓库里**被跟踪**的文件（例如 `config.example.json`、`roles/*.md`）。
> 角色卡请放 `~/.dsh/surfcore/characters/`（设置页「角色」里新建），不要改仓库里的示例文件。

---

## 9. 出错怎么办

| 症状 | 原因 | 解决 |
| --- | --- | --- |
| 设置页没有 SurfCore | 没装进 DSH / 没重启 | 重跑 `node scripts/setup-dsh.mjs`，**完全退出 DSH 再开** |
| 桥接起来了，但收不到消息 | SnowLuma 没登录 / token 不对 / 端口不对 | 看控制台「运行总览」；核对 `snowluma.*` 与 SnowLuma 界面上的端口 |
| 群里 @ 她没反应 | 白名单没加群 / 已暂停 / 模式不对 | 设置 → QQ → 白名单；控制台确认没暂停 |
| 她只会聊天，不调工具 | MCP 没挂上 / 工具被安全守卫限制 | 重跑 setup；看设置页工具开关 |
| 控制台 401 | 没带 token | 地址后面加 `?token=…` |
| `npm install` 后启动报 ESM 错 | postinstall 没跑完 | `npm rebuild`，或手动 `node scripts/patch-snowluma-sdk.mjs` |
| 更新一直说"本地有改动" | 改过被跟踪的文件 | `git status` 看是哪个；恢复或改成放 `~/.dsh` 里 |
| 桌宠装完起不来 | Electron 路径不对 | 设置 → 桌宠，重新选 `electron.exe` |

还不行，先点设置页的 **诊断 → 环境体检**（9 项检查，每项都有"怎么补"），
能自动补齐的缺项点 **一键配置**（只补缺的，不覆盖已有值）。

命令行体检：

```powershell
node scripts/verify-dsh-020-adaptation.mjs
npm run test:audit
```

---

## 10. 为什么不能把 git 链接丢给 DSH

DSH 能装"纯前端插件/技能"，但 SurfCore 不是那种东西：

| 它需要 | DSH 直接装链接做不到 |
| --- | --- |
| `npm install`（含 postinstall 补丁） | 需要在本机跑一遍依赖安装 |
| 一个**独立进程**（`src/bridge.js`） | 需要能起子进程、写 pid、单实例锁 |
| 往 profile 写 **preset + MCP + bundle** | 需要跑 `setup-dsh.mjs` |
| 一份**要你填的配置** | 链接里没有你的 QQ 号/白名单/端口 |
| SnowLuma 扫码 | 只能你自己扫 |

所以它走的是"**克隆 → 安装 → 配置 → 装进 DSH**"这四步，不是"点一下装好"。

未来会做：把它打成 npm 包 + DSH bundle，让 `dsh plugin add surfcore` 一条命令搞定；在那之前，按本文档走。

---

## 11. 安全须知（三句话）

1. **白名单只加你要的群**，别图省事全放行；
2. **`config.json` 里有你的令牌**，别截图、别提交、别发给别人；
3. **先小号试**：确认她说话方式你满意，再放进主群。
