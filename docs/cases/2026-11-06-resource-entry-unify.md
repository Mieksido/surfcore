# 2026-11-06 · 网盘资源入口统一 + 向量记忆使用说明

## 需求

1. 填入可用网盘链接：夸克、迅雷；百度 / UC 标「（待补链）」。
2. 语音页把「网络不稳定装不上？」卡片置顶，卡片只留一个「获取网盘资源」按钮。
3. 向量记忆 Tab 顶部加「使用说明」「获取网盘资源」两个按钮。
4. 删掉向量记忆下方多余的「浏览器打开网盘链接」按钮。
5. 「使用说明」弹窗用大白话写清从安装到成功使用的步骤。

## 实现

`plugins/surfcore/lib/client.js`：

- `RESOURCE_LINKS` 填夸克 / 迅雷；百度 / UC 留空并渲染 `（待补链）`、按钮 disabled。
- `VoiceTab` 接收 `onResource`；把旧网盘卡片移到语音页最上方，删除「打开网盘」「复制链接」。
- `MemoryTab` 接收 `onResource`；向量 Tab 顶部加两个按钮。
- 新增 `usageOpen` 弹窗：下载 → 导入 runtime/模型 → 一键启动 → 重建索引 → 切记忆方式 → 记忆库验证。
- `EmbeddingPackPanel` 删除「浏览器打开网盘链接」按钮及 `openShare`/`openNetdisk`/`copyNetdisk` 死代码；高级里的手动安装/下载地址保留。
- 父组件给 `VoiceTab` / `MemoryTab` 传 `onResource: () => setResourceOpen(true)`。

测试：

- `test-client-contract.mjs`：钉住夸克/迅雷链接、待补链、使用说明弹窗，旧按钮必须不存在。
- `test-embedding-packs-wiring.mjs`：旧的「浏览器打开网盘链接」断言改为新入口/使用说明。

## 验证

```
test-client-contract     ✅
test-embedding-packs-wiring ✅
test:audit               151/151
plugins/surfcore npm test 0 失败
```

## 待补

- 百度、UC 链接：填进 `RESOURCE_LINKS.baidu` / `.uc`，并把 `（待补链）` 自动消失（已有条件渲染）。
- 使用说明如果与实际 UI 有出入，需要向量记忆会话校对后改文案。
