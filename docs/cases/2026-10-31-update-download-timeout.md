# 2026-10-31 · 慢网络下更新必然失败（180 秒硬超时 + 误分类 + 不回退）

## 现象

0.7.22（zip 安装）用户连点三次更新到 0.8.1，每次都精确 **180 秒**失败；
`lastApplyFailure.code = download.write-failed`，hint 让查磁盘/权限；实测同 URL 7.78 MB / 281 秒 / 27.6 KB/s。

## 根因

1. `fetch` 用 `AbortSignal.timeout(180_000)` 覆盖整个 body：慢网到 180 秒必断；
2. body 阶段失败被 catch 成 `download.write-failed`，提示磁盘/权限（误导），且**跳出候选循环**，不再试镜像；
3. 助手 `waitExit` 15 分钟，用户 15 分钟后才退出 → 暂存静默放弃，卡片没说过期；
4. 下载 3 分钟只有一行日志，用户不知道“在动还是卡死”。

## 修法

| 项 | 改动 |
| --- | --- |
| 超时 | 改为**流式写盘 + 30 秒空闲超时**（有数据就续命）+ 20 分钟兜底总上限；不再用总时长覆盖 body |
| 分类 | 新增 `classifyDownloadFailure()`：abort→`download.timeout`；HTTP→`download.http-N`；fs→`download.write-failed`；其余→`download.network`；hint 按 code 分支 |
| 回退 | body 失败**不 return**，继续试下一个候选（codeload / 镜像）；诊断记录每个地址的结果 |
| 助手 | `waitExit` 15→60 分钟；超时写 `.failed(code=stage.expired)`，卡片提示“上次暂存已过期，请重新下载” |
| 进度 | `status().download` 暴露 `bytes/total/percent/speedBps`；更新弹窗每秒轮询，显示「下载中 3.2 MB / 7.8 MB · 27 KB/s · 41%」 |

## 验证

- `test-update-apply-result`：
  - 分类：abort→timeout、404→http-404、fs→write-failed、网络→network；
  - 慢网断流：code=download.timeout，且**继续试了下一个候选**；
  - 进度：下载中 `bytes>0 / total=1000 / percent 正确`；
  - 过期：`.failed(code=stage.expired)` → lastApply 保留 code，hint 提示重新下载；
- `test-client-contract`：弹窗必须轮询进度、显示速度与百分比；
- audit 107/107；插件测试全绿。

## 教训

**超时是“多久没进展”，不是“总共多久”**；错误分类必须保留“还能不能重试/换路”的语义；
等待类超时要写进 UI，否则用户看到的是“已下载”但什么都没发生。
