# 2026-10-28 · 卸载桌宠把聊天记录一起删了

## 现象

- 用户按提示「卸载后重装」修桌宠问题；
- 重装后发现**聊天记录和设置都没了**（`data/` 被删）。

## 环境

| 项 | 值 |
| --- | --- |
| 系统 | Windows 11 |
| SurfCore | 0.6.x（`lib/pet.js` 的 `remove()`） |
| 桌宠 | 0.2.x（`data/` 在安装目录内） |

## 根因

SurfCore 的 `remove()` 直接 `fs.rmSync(安装目录, { recursive: true })`，
而桌宠把用户数据存在 `<安装目录>/data/`（Chromium profile + 聊天记录 + 设置）
→ 卸载 = 数据一起没。

`updateFromZip()`（更新路径）其实早就做了 `data/` 保留，**只有卸载这条路径漏了**。

## 修法（SurfCore v0.6.4）

1. 卸载前把 `data/` 复制到 `~/.dsh/surfcore/pet-data-keep/data`；
2. 再次安装时，如果新目录没有 `data/`，自动把备份搬回去；
3. 更新路径继续走 `updateFromZip` 自己的保留逻辑（`data/` + 用户皮肤）。

## 验证

- 插件测试 `test-pet-update.mjs` 覆盖「更新保留 data」；
- **卸载→重装链路已补自动测试**：`test-pet-uninstall-keep.mjs`（2026-10-28）：
  卸载后 `pet-data-keep/data` 存在且内容正确 → 重装自动恢复 → 第二次卸载备份覆盖为最新、不叠加。

## 遗留

- 已删除的数据无法恢复（没有回收站）；
- ~~补测试~~（已完成，见上）；
- 文档里"卸载只删 app"的说法要改（现在还会备份 data）。
