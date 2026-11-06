# live 插件切 worktree 后，语音包和 SnowLuma 配置“消失”

## 现象

- 用户反馈：语音包明明装过，一键启动却显示“未安装”；
- 用户反馈：以前一键启动会打开 SnowLuma 控制台和终端，现在不打开；
- 设置页出现 `未开启「允许插件打开 SnowLuma」`。

## 根因

- 为验证向量记忆 UI，把 live 插件 junction 从主 worktree
  `D:\deepseekwork\surfcore` 切到功能 worktree
  `D:\deepseekwork\surfcore-memory-impl`；
- 旧代码根的运行时状态和配置是**相对代码根**解析的：
  - `state/voice-packs` 在主 worktree；
  - `config.json`（QQ/SnowLuma 配置）在主 worktree，功能 worktree 是空默认；
- 新 worktree 的 `state/voice-packs` 不存在，`config.json` 里
  `allowLaunch:false`、`launcherPath:""`、`accessToken:""`；
- 桥接按新根目录查语音包 → 误报未安装；插件按新配置文件查 SnowLuma → 不弹终端/浏览器。

## 修法

1. 语音：建 worktree 内 junction
   - `surfcore-memory-impl/state/voice-packs -> surfcore/state/voice-packs`
   - `voice-tts` 同理；
2. SnowLuma：备份功能 worktree 的空配置后，从主 worktree 复制 `config.json`：
   - `allowLaunch:true`
   - `launcherPath:D:\deepseekwork\SnowLuma2`
   - accessToken 恢复；
   - 备份：`~/.dsh/surfcore/backups/config-feature-before-main-restore-20261105-211239.json`；
3. 桥接 `/api/voice/packs` 验证两个包 `installed:true`；
4. 插件 `readQqConfig()` 验证 `allowLaunch:true`、launcherPath 存在。

## 影响面

- 不是用户卸载，也没有删除任何语音包/配置；
- **配置是拷贝不是共享**：在功能 worktree 里保存 QQ 配置会写这份拷贝，可能再次和主 worktree 分叉；
- 语音包和 voice-tts 通过 junction 共享，后续不会再因 worktree 切换丢失。

## 遗留

- 长期应把 state/config 移到 `~/.dsh/surfcore` 或显式共享根，避免 worktree 隔离；
- 在 feature worktree 测试期间，QQ 页保存的配置不会自动回写主 worktree；
  测试结束应合并回 dev，或在主 worktree 恢复 live junction。
