# 给 DSH 的安装指令（复制整段）

> 用法：把下面代码块里的全部内容贴给你的 DSH，让它照着做。你只需要在它停下时回答问题。

```
帮我在这台 Windows 机器上安装 SurfCore（一个 QQ × B站 的 DSH 插件）。
按顺序做，每步结束报告结果；任何一步失败就停下来告诉我原因，不要自己猜着改。

【0. 先检查环境，缺什么先告诉我，别急着装】
- node -v          需要 >= 22.13
- git --version    没有的话改用 zip 方案（见第 2 步备选）
- 确认 DSH 版本是 0.2.1-rc.2（设置 → 关于）
- 检查 SnowLuma 是否已安装并登录（端口 3000/3001）：netstat -ano | findstr "3000 3001"
  如果没装：停下来告诉我，让我先装 SnowLuma（这是第三方程序，你不要替我装、不要代扫码）

【1. 拉代码】
cd $env:USERPROFILE
git clone --depth 1 https://github.com/Mieksido/surfcore.git
cd surfcore
（已经有目录就 git pull --ff-only）

【2. 装依赖】
npm install
失败的话先执行 npm config set registry https://registry.npmmirror.com 再重试一次

【3. 装进 DSH】
node scripts/setup-dsh.mjs
注意：不要给它加 profile 参数，它自己判断。把输出里 "使用 profile" 或写入的 profile 路径记下来。

【4. 自检，把结果贴给我】
node scripts/test-version.mjs
node scripts/detect-profile.mjs
然后读取 %USERPROFILE%\.dsh\profiles\<上一步的 profile>\package.json，
确认 dsh.profile.bundles 里有 "surfcore"。

【5. 停在这里，剩下的必须我自己做，你不能代做】
- 完全退出 DSH 再打开（是重启进程，不是刷新页面）
- 设置 → SurfCore → 诊断 → 点「一键安装（全部）」
- 弹窗里填我自己的 QQ、勾要放行的群
- 去群里 @ 她 验证

【约束】
- 不要把 SnowLuma 打包、安装、自动登录或代扫码（EULA §5.4 禁止）
- 不要改任何已存在的 config.json 字段，不要覆盖我的配置
- 不要 commit / push 任何东西，只做安装
- 不要动 %USERPROFILE%\.dsh 里其它 profile

【如果失败，按这个格式回报】
1. 卡在第几步
2. 完整报错原文
3. node -v 的输出
4. node scripts/detect-profile.mjs 的输出
5. %USERPROFILE%\.dsh\surfcore\plugin.log 的最后 10 行
```

## 附：一行命令版（如果 DSH 不方便分步执行）

```
powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/Mieksido/surfcore/main/scripts/bootstrap.ps1 | iex"
```

跑完同样要：**重启 DSH → 设置 → SurfCore → 诊断 → 一键安装（全部）**。

## 这张图记住就行

```
git clone → npm install → node scripts/setup-dsh.mjs
        ↓
   重启 DSH（必须）
        ↓
设置 → SurfCore → 诊断 → 一键安装（全部）→ 填 QQ / 勾群
        ↓
   群里 @ 她
```
