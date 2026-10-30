# 案例索引（每次修 bug 都要在这里留一条）

> 规矩：**修完一个 bug，必须写一份 case 记录并在此登记**（模板见 [`_TEMPLATE.md`](_TEMPLATE.md)）。
> 目的：下次遇到相似现象能直接搜到「当时怎么定位、怎么修的、怎么验证的」，
> 而不是从头再猜一遍。只写结论不算记录，至少要有：现象、根因、修法、验证、影响面。

| 日期 | 案例 | 一句话 | 版本 |
| --- | --- | --- | --- |
| 2026-10-30 | [QQ 空间说说发布（默认关闭）](2026-10-30-qzone-post.md) | SnowLuma `send_qzone_msg` 可用；默认关、仅管理员私聊、纯文字、每日 2 条/6 小时间隔 | 待发布 |
| 2026-10-30 | [语音包被误放进 zip 自动更新](2026-10-30-voice-pack-no-auto-update.md) | 语音包没有 package.json/清单 → 从自动更新移除，改语音页手动重新导入 | 待发布 |
| 2026-10-30 | [SnowLuma 断线时主动唤醒空烧](2026-10-30-snowluma-channel-gate.md) | 唤醒前查发送通道；断开/连续失败不创建 DSH 会话；L2 事件 + 建议 | 待发布 |
| 2026-10-30 | [闸门事件中心 + 单轮 L3 止血](2026-10-30-gate-events-turn-guard.md) | 重复 compress / 步数 / 回合内额度到顶 → cancel-only + 直接通知；L0-L3 事件中心 | 待发布 |
| 2026-10-30 | [插件冲突体检](2026-10-30-plugin-compat-check.md) | 第三方 compress 被 QQ 白名单拒 → 只读体检报工具/压缩冲突；未知插件标 unknown | 待发布 |
| 2026-10-29 | [设置称呼「弥叭」仍叫管理员](2026-10-29-admin-display-name-projection.md) | QQ 投影只写 ownerQQ，桥接兜底把「管理员」当称呼 → 完整投影 + 空串兜底 | 待发布 |
| 2026-10-29 | [原生浏览选中文目录后导入报不存在](2026-10-29-browse-chinese-path.md) | PowerShell stdout GBK 被 Node 当 UTF-8 → 路径乱码；改 UTF-8 临时文件 | 待发布 |
| 2026-10-29 | [云端参考音频“下载”没反应](2026-10-29-cloud-sample-download.md) | 接口 200 但 `<a target=_blank>` 被宿主拦 → fetch+Blob，加「打开所在目录」 | 待发布 |
| 2026-10-29 | [语音包离线导入](2026-10-29-voice-pack-offline-import.md) | 只有“改安装目录”且静默失败 → 校验/复制/备份/回滚/结构化错误，本地+云端 | 待发布 |
| 2026-10-29 | [提问回答无身份来源 + 特权操作无审计](2026-10-29-owner-question-audit.md) | question 不读 isOwner、DSH 单选不许 selected+custom → custom-only；7 类主人审计 | 待发布 |
| 2026-10-29 | [SnowLuma 装在自定义目录检测不到](2026-10-29-snowluma-detect-manual-path.md) | 检测只猜固定目录 + 手动入口藏在 QQ 页 → 概览加「浏览…」，路径归一 | 待发布 |
| 2026-10-29 | [云端语音包凭据不能随包分发](2026-10-29-voice-cloud-credentials.md) | 安装包复制 example 时会带上开发者的火山 AppID/AccessKey → 新装一律清空、强制自填 | 待发布 |
| 2026-10-28 | [更新导致 DSH 硬崩](2026-10-28-update-crash.md) | 进程内覆盖自己的安装目录 → 宿主被终止（0xFFFF7003） | v0.6.12 |
| 2026-10-28 | [本地语音装完不可用（位置/import/工具）](2026-10-28-voice-pack-layout-and-imports.md) | 归档解压落点、jieba_fast、MCP 工具快照 | v0.6.22 |
| 2026-10-28 | [语音包卡在依赖安装 50 分钟](2026-10-28-voice-install-stuck-deps.md) | 依赖阶段无百分比、无耗时、无取消、pip 走官方源 | v0.6.21 |
| 2026-10-28 | [语音安装没有进度条](2026-10-28-voice-progress-lost.md) | 每请求新建服务实例，安装进度被请求生命周期吞掉 | v0.6.20 |
| 2026-10-28 | [点更新没反应，版本不变](2026-10-28-update-helper-never-runs.md) | Electron 宿主 spawn .mjs 静默退出，助手从未执行 | v0.6.19 |
| 2026-10-28 | [语音包装完不可用（嵌套/启不动/停不掉）](2026-10-28-voice-pack-install-start.md) | flatten 判定看 config.toml、bat 里 pause、stop 假设单对象 | v0.6.18 |
| 2026-10-28 | [桌宠安装一直无效（无报错）](2026-10-28-pet-install-silent-fail.md) | 只认根目录 package.json + 失败残留被安全闸拦 + 报错不显眼 | v0.6.17 |
| 2026-10-28 | [语音包「安装完成」但只有 490KB](2026-10-28-voice-install-false-complete.md) | 前端谎报完成 + 后端无完整性校验 + 只读属性 | v0.6.13 |
| 2026-10-28 | [语音包「装了却说没装」](2026-10-28-voice-pack-not-detected.md) | 包在别的目录（旧 cwd 默认）→ 只认一个目录 | v0.6.10 |
| 2026-10-28 | [本地语音包默认音色 503](2026-10-28-voice-default-voice-missing.md) | `voices/`、`voicepack/` 被 .gitignore 排除，没随包分发 | v0.6.8 |
| 2026-10-28 | [SnowLuma 一直检测不到](2026-10-28-snowluma-detect.md) | 填根目录时取了 dirname，候选全错 | v0.6.11 |
| 2026-10-27 | [桌宠 125% 缩放拖动漂移](2026-10-27-pet-drag-drift.md) | `setPosition` 在缩放屏上让窗口每帧变大 | 桌宠 v0.2.3 |
| 2026-10-27 | [桌宠拖拽永不结束](2026-10-27-pet-drag-never-ends.md) | 指针离开窗口后收不到 `pointerup` | 桌宠 v0.2.1 |

> 更早的坑（更新检查误报、主题对比度、桌宠数据被删等）见 [`../PITFALLS.md`](../PITFALLS.md)；
> 那份是"按坑记"，这里按"按 bug 记"，两者互补。
