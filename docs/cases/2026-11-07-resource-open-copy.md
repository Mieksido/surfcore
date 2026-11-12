# 2026-11-07 · 网盘按钮打不开 + 复制链接兜底

## 现象

用户和测试机点「获取网盘资源」里的夸克 / 迅雷，完全没反应。

## 根因

资源弹窗里的 4 个 `Btn` 只写了 `disabled/title/children`，**没有 `onClick`**：

```js
h(Btn, { key, kind: "qbw-btn2", disabled: !RESOURCE_LINKS[key], title }, label)
```

`openResource()` 函数虽然早就写好，但从未被调用。所以点按钮 = 没反应，不是网盘地址的问题。

## 修法

### 1. 真正打开默认浏览器

新增宿主接口：

```
POST /dsh-surfcore/api/resources/open
body: { url }
```

- 只允许固定网盘域名：`pan.quark.cn` / `pan.xunlei.com` / `pan.baidu.com` / `drive.uc.cn`；
- Windows 用 `cmd /d /c start "" "<url>"` 调系统默认浏览器；
- 拒绝引号/换行/超长 URL，避免命令注入；
- 前端先走这个接口，失败才回退 `window.open`，并提示用「复制链接」。

### 2. 四个网盘各两个按钮

弹窗改成 4 行，每行独立卡片/间距：

```
夸克网盘  [打开] [复制链接]
UC网盘    [打开] [复制链接]  （待补链时禁用）
迅雷网盘  [打开] [复制链接]
百度网盘  [打开] [复制链接]  （待补链时禁用）
```

- 共 8 个按钮；
- 链接文本直接显示在行内，可手动选中；
- 复制用 `navigator.clipboard`，失败时用隐藏 textarea + `execCommand` 兜底；
- 打不开浏览器时明确提示「点右侧复制链接」。

### 3. runtime 大白话解释

使用说明红字下面补一句：

> runtime 可以理解成“让模型跑起来的发动机”：模型是零件，runtime 负责把零件装好并驱动它。没有 runtime，模型包导入了也不会工作。

## 验证

```
test-session-rollover   196 项全过
test:audit              153/153
插件测试                 39 项全过
```

新增断言：

- 四个网盘都有「打开」和「复制链接」的 `onClick`；
- 前端调用 `/resources/open`；
- 宿主有 `openExternalResourceUrl` + 域名白名单；
- 红字下面有 runtime 解释。

## 说明

- 宿主打开失败时，仍会回退到浏览器新窗口；
- 两种方式都被拦时，复制链接是最终兜底；
- 百度 / UC 链接仍为空，按钮保持禁用并标「待补链」。

## 回滚

移除 `/resources/open` 路由和 `openExternalResourceUrl`，恢复原 4 按钮布局；或保留复制按钮，仅去掉宿主打开。
