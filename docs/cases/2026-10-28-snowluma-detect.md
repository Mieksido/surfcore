# 2026-10-28 · SnowLuma 装好了但「检测已安装」识别不到

## 现象

- 用户按文档装了 SnowLuma2（`D:\Tools\SnowLuma2`），QQ 也登录了；
- 概览页点「检测已安装的 SnowLuma」→ 提示没找到 / 连接失败；
- 控制台日志里 `[Hook] loaded` 正常，说明协议端本身没问题。

## 根因

`src/snowluma-conn.js` 的 `snowLumaHomeCandidates()`：

```js
if (sl.launcherPath) push(path.dirname(String(sl.launcherPath)));
```

用户填的是**根目录** `D:\Tools\SnowLuma2`，取 `dirname` 得到 `D:\Tools` —— 而 OneBot 配置实际在
`SnowLuma2\app\config\onebot_<uin>.json`。候选目录全错，读不到 token，自然"识别不到"。

## 修法（v0.6.11）

1. 候选目录展开成一个根目录的四种写法：`填写路径 / 填写路径\app / 上一级 / 上一级\app`；
2. `SnowLuma home（app 目录）` 字段加「浏览…」，说明改成"内含 config 的那个目录，一般是安装目录下的 app"；
3. 安装目录字段说明也改成"解压出来的根目录（里面有 app）"。

## 验证

- `npm run test:audit` 77/77；
- 未在真实 SnowLuma 安装上复测（用户环境无法直接访问），只做了代码路径核对。

## 遗留

- 若用户把 SnowLuma 装在非标准位置（例如 `D:\SL\bin\SnowLuma2`），仍可能需要手动填 `homeDir`；
- 建议后续加"检测失败时列出所有尝试过的目录"，方便用户自查。
