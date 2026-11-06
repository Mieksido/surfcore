# 2026-11-06 · Embedding 安装进度 + 更新百分比/包大小

## 需求

1. 向量记忆的本地模型 / runtime 导入 zip 后，不能“点了没反应”；
2. 安装进度要显示出来，避免用户重复点击；
3. SurfCore 检查更新的进度条不要一直跑马灯，改成百分比；
4. 更新时显示要安装的包大小。

## 实现

### Embedding 安装

`plugins/surfcore/lib/embedding-packs.js`：

- `jobView()` 返回 `progress`；
- `installFromJob()` 按阶段写进度：
  - 目录安装 / 开始：5→20；
  - 本地 zip：解压 20→55，校验 85，完成 100；
  - URL 下载：下载 10（前端按字节算百分比）→解压 65→校验 85→完成 100；
  - 本地 zip 记录 `totalBytes = zip 大小`，用于显示包大小。

`plugins/surfcore/lib/client.js`：

- 安装任务面板从「云端模型」Tab 移到 **本地/云端 Tab 上方**，两个 Tab 都能看到；
- 面板显示：阶段（下载/解压/校验安装）、百分比、已下载/总大小或包大小、失败原因；
- 安装中禁用「导入」，`importPackFile` 也拒绝重复点击；
- 本地 zip 没有字节进度时用阶段进度（20/55/85%），不再显示 0/大小。

### 更新进度

`client.js`：

- `ProgressBar` 的 `indeterminate` 改为只有完全拿不到 `percent` 时才用跑马灯；
- 有真实百分比时显示 `%`；
- 待更新列表显示 `安装包 X MB`（来自 `item.asset.size`）。

## 验证

```
test-embedding-packs-plugin  通过（新增完成 100% 断言）
test-session-rollover        155 项全过
test:audit                   152/152
plugins/surfcore npm test    0 失败
```

## 残余

- 本地 zip 的进度是阶段估算，不是逐文件字节；
- 更新包大小只有 release 资产有 `size` 时显示；
- 未做真实大包安装的逐秒观察，只验证了任务字段和 UI 接线。
