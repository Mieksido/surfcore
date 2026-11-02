# DEV 测试机清单（B 机）

> 目标：用**普通用户的更新器链路**验证 dev 构建，而不是 git pull。
> 适用版本：0.8.6+（带 `updates.channel` 的单选）。更新通道：main = 正式版；dev = 测试版。

## 0. 测试机隔离（先做）

- [ ] SurfCore 装在**独立目录**（不要覆盖开发机/自用目录）。
- [ ] 独立 `DSH_HOME` 或独立 Windows 用户/虚拟机：SurfCore 的 config/state 在 `~/.dsh/surfcore`，
      装两份会共用配置与记忆。
- [ ] 使用**测试 QQ 机器人**，不要连正式号。
- [ ] 记录基线：当前版本号、DSH 版本、SnowLuma 是否启动。

## 1. 安装稳定版 0.8.6

- [ ] 从 Release 下载 `v0.8.6` zip（或沿用已装好的 0.8.6）。
- [ ] 启动 DSH，确认设置页版本显示 `0.8.6`。
- [ ] 记录：更新卡片、通道单选显示 **main（正式版）**。

## 2. 首次装 dev（手动 bootstrap，只有这一次）

> ⚠️ 0.8.6 **正式版里没有 dev 通道代码**：它的「检查更新」只会看 `/releases/latest`，
> 按设计忽略 Pre-release。所以第一次必须手动装一个 dev 包；装上之后，通道才会生效。

- [ ] 完全退出 DSH。
- [ ] 下载最新的 dev Pre-release zip：
      `https://codeload.github.com/Mieksido/surfcore/zip/refs/tags/v0.8.6-dev.2`
      （tag 换成当时的 dev 版本；只解压出 `surfcore-0.8.6-dev.2/` 这一层）。
- [ ] 备份现有安装目录（改名或复制一份），把新包内容覆盖过去。
- [ ] 启动 DSH，确认设置页版本是 `0.8.6-dev.2`。
- [ ] 打开更新卡片：应能看到并选择 **dev** 通道（这段代码只有 dev 包才有）。

**失败时看**：

- `~/.dsh/surfcore/updates.json` 的 `lastApplyFailure.code`：
  - `download.timeout` → 网络慢，重试；
  - `verify.staging-mismatch` → 发布物问题，停止测试并把 tag 发回开发者；
  - `stage.expired` → 超过 60 分钟才退出 DSH，重新下载。

## 3. 基础功能（dev 构建也要能日常用）

- [ ] DSH 正常启动，无 welcome/403 弹窗。
- [ ] QQ 桥接启动；私聊 bot：能收能回。
- [ ] 群里 @ 一次：能醒、能回。
- [ ] `qq_wait_for_messages` 能返回本轮期间的新消息（不晚一轮）。
- [ ] 角色页：人格卡四层能读、能保存，核心不被语气覆盖。
- [ ] 高级设置 →「DSH 注册（MCP / bundle）」按钮存在；点击能返回输出（不要求真的修复）。

## 4. dev 更新通道继续升级

- [ ] 开发机发下一个 dev 构建（例如 `0.8.6-dev.3`）。
- [ ] B 机保持 dev 通道 → 检查更新 → 能看到并安装新 dev。
- [ ] 重启 DSH 后版本变为新 dev 版本。

## 5. 回稳定版（重要）

- [ ] 通道选回 **main（正式版）**。
- [ ] 点「检查更新」：因为 `0.8.6` > `0.8.6-dev.2`，应提示升级回 `0.8.6`。
- [ ] 安装并重启，确认版本回到 `0.8.6`。
- [ ] 确认**没有**残留的 dev 更新弹窗（切回 main 时会清空旧检查结果）。

## 6. 故障与边界

- [ ] 把网络断掉/限速：更新应报 `download.timeout`，并给“稍后重试/手动下载”建议，不能静默。
- [ ] 更新下载完成后不退出 DSH：超过 60 分钟再退出，应提示 `stage.expired`（需要重新下载）。
- [ ] 未授权群/私聊：不应触发回复；日志有节流，不刷屏。

## 7. 记录模板

```text
日期/时间：
B 机基线：SurfCore 版本 / DSH 版本 / Windows 版本
测试到哪一步：
结果：通过 / 失败（附 code + 截图或日志路径）
失败复现：
是否影响正式用户： 否（dev 通道） / 是（需要立即 hotfix）
```

## 8. 给开发机的反馈

- 通过：告诉我“B 机 dev.1 通过”，我把该批从 dev 合到 main 发稳定版；
- 失败：把 `lastApplyFailure` 的 `code/error/hint` 或 `plugin.log` 相关行贴回来，**不要只说“更新失败”**。
