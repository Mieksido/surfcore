# 强制更新提示词（给 0.6.18 及更早用户）

> 背景：0.6.18 及更早版本的「退出后应用」助手在 DSH（Electron）里起不来，
> 点「立即更新」不会生效。需要让用户把下面这段**原样粘贴给自己的 DSH**，让它代为完成覆盖。

## 用法

1. 复制下面代码块里的全部内容；
2. 在 DSH 里新开一个会话，粘贴发送；
3. 按它的提示操作（关键是**最后要完全退出 DSH 再打开**）；
4. 重开后确认版本是 `0.6.20` 或更新。

## 提示词正文

```text
帮我手动更新 SurfCore 到最新版，要求按下面的步骤做，不要跳步，也不要删掉安装目录。

背景：0.6.18 及更早版本的自动更新有个 bug（更新助手在 DSH 里起不来），所以我需要你帮我
做一次"带暂存 + 退出后覆盖"的更新。这个插件跑在 DSH 进程里，**运行中直接覆盖文件会让 DSH 崩溃**，
所以覆盖动作必须等我退出 DSH 之后再做。

【第一步：先摸清环境，只读，不要改任何东西】
1. 找到 SurfCore 安装目录：在下面几个路径里找带 `plugins/surfcore/package.json` 的那个：
   - %USERPROFILE%\surfcore
   - D:\surfcore
   - C:\surfcore
   - %USERPROFILE%\Documents\surfcore
   如果都不在，问我。
2. 读它的 `package.json`，告诉我当前版本号。
3. 看一眼这个目录是 git 仓库（有 .git）还是 zip 安装。
4. 把上面三件事的结果先报给我，然后停下等我确认，不要继续。

【第二步：我确认后，准备暂存包】
1. 下载最新源码包到 %TEMP%\surfcore-update\main.zip：
   优先 https://codeload.github.com/Mieksido/surfcore/zip/refs/heads/main
   如果超时/被墙，改用镜像前缀再试：
   https://gh-proxy.com/https://codeload.github.com/Mieksido/surfcore/zip/refs/heads/main
   https://ghproxy.net/https://codeload.github.com/Mieksido/surfcore/zip/refs/heads/main
2. 解压到 %TEMP%\surfcore-update\stage\，里面会有一层 `surfcore-main\`；
   把 `surfcore-main\` 里的内容当作"新版本根目录"（后面的 staging 指它）。
3. 检查 staging 里确实有 `package.json`、`plugins\surfcore\lib\index.js`，并把 staging 里的
   `package.json` 版本号报给我。

【第三步：生成"等我退出后再覆盖"的脚本】
在 %TEMP%\surfcore-update\ 下创建 `apply.cmd`，内容必须满足：
1. 先等 DSH 退出：循环 `tasklist /FI "PID eq <我当前DSH进程PID>" | find "<PID>"`，
   存在就 `timeout /t 3 >nul` 继续等，最多等 30 分钟；
2. 备份：把安装目录的 `config.json`、`bili.config.json`、`state\` 复制到
   `%USERPROFILE%\.dsh\_backups\surfcore-<时间戳>\`（用 robocopy /E，不要删原文件）；
3. 覆盖（**不要删除安装目录本身**，里面有 junction 指向它）：
   `robocopy "<staging>" "<安装目录>" /MIR /NFL /NDL /NJH /NJS /NP /R:2 /W:1 ^
     /XD state backups node_modules .git logs staging pet characters voice-packs ^
     /XF config.json bili.config.json`
4. 覆盖完把新版本号写进 `%USERPROFILE%\.dsh\surfcore\updates-applied\` 下（没有就创建），
   并写一行日志到 `%TEMP%\surfcore-update\apply.log`；
5. 最后尝试重新启动 DSH（命令用你启动我的那个可执行文件；如果找不到就跳过，只提示我手动打开）。

脚本写好后，把它打印给我看一遍，等我确认。

【第四步：我确认后，启动脚本并提醒我退出】
1. 用 `start "" /b cmd /c "%TEMP%\surfcore-update\apply.cmd"` 以独立进程启动它
   （不要用同步方式等它，它会一直阻塞）；
2. 告诉我："现在请**完全退出 DSH**（不是最小化），覆盖会在你退出后自动完成，
   重新打开 DSH 就是新版本。"
3. 如果 apply.cmd 没能启动，或你发现任何一步失败，**停下来**把错误原文发给我，
   不要反复重试，也不要改用"直接覆盖"的快捷方式。

【禁止事项】
- 不要在 DSH 运行期间直接往安装目录复制/覆盖文件（会崩，而且可能更新失败）；
- 不要 `rmdir` / 删除安装目录（junction 会断，配置和记忆也可能没）；
- 不要动 `state\`、`config.json`、`.git`、`node_modules`；
- 不要改 `%TEMP%\surfcore-update\` 以外的任何用户目录。
```

## 更新完成后怎么确认

让用户重开 DSH 后，在设置 → SurfCore 看版本是不是 **0.6.20 或更新**；也可以让他再问一次 DSH：

```text
读一下 SurfCore 安装目录的 package.json，告诉我现在是哪个版本。
```

如果版本没变：看 `%TEMP%\surfcore-update\apply.log`，以及
`%USERPROFILE%\.dsh\surfcore\updates-applied\` 下有没有记录。

## 升级成功之后

从 0.6.19/0.6.20 起，界面里的「立即更新」才是真正可用的：
下载 → 提示退出 → 退出后自动覆盖 → 重开即新版本。
