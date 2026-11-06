# 2026-11-06 · QQ 高级设置收纳与更新进度大小说明

## QQ 高级设置

用户反馈：QQ 页的「高级设置」位置反人类，下面的东西容易翻过头。

实际情况：QQ 页大部分卡片本来就在 `AdvancedSettings` 里，但「重启 QQ 桥接」按钮还在折叠区**外面**，视觉上像高级设置后面还有一块操作区。

修法：

- 把「重启 QQ 桥接」按钮抽成 `restartBridgeButton`；
- 放进 `AdvancedSettings` 的第一个子元素，展开高级设置就能看到；
- 删除折叠区外面的重复按钮。

这样 QQ 页高级设置下面的操作不再散落。

## 更新进度

用户反馈 dev7 → dev8 没有百分比，也看不到包大小。

原因：

- dev/version 通道走 GitHub zipball/归档；
- 该响应是 `Transfer-Encoding: chunked`，**没有 Content-Length**；
- 没有总大小就算不出真实百分比，前端只能跑马灯。

已做：

- 进度文字始终显示「已下载 X MB」；
- 拿不到总大小时明确写「总大小未知（GitHub 归档）」；
- 待更新列表在 dev/version 无 `asset.size` 时显示「包大小未知（GitHub 归档）」；
- release 资产有 `size` 时仍显示 `安装包 X MB` 和真实百分比。

要真正显示 dev 包大小/百分比，发布侧需要额外上传 zip asset（GitHub release asset 的 `size` 才有值）；这是下一步，不在本批。

## 验证

```
test-session-rollover   179 项全过
test:audit              152/152
插件测试                 0 失败
```

## 回滚

- 把 `restartBridgeButton` 移回 `AdvancedSettings` 外；
- 删除进度里的「总大小未知 / 包大小未知」文案即可。
