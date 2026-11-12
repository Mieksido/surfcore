# 语音页设计（已下线，保留为旧兼容面记录）

> **状态：已从内核入口下线/隔离（2026-11-11）。**
> 原因：`/surfcore-api/voice` 是旧运行时插件转发 QQ 桥接语音包管理器的兼容前缀，不是四层架构里的语音控制面；内核/内核页不能依赖外部桥接才能启动语音。
> 现在内核「语音」入口只显示中性待接入页；`VoicePage` 不路由、不请求 `/surfcore-api/voice`。规则见 [`ARCHITECTURE-BOUNDARY.md`](ARCHITECTURE-BOUNDARY.md)。
> 以下内容是旧兼容面的设计记录，不是新实现依据。

> 前端：`surfcore-ui`；后端：`D:\deepseekwork\surfcore` 旧运行时插件，语音前缀 `/surfcore-api/voice`（只读参考，不改）。
> 依据：`docs/persona-core/VOICE-API-CONTRACT.md` + 实际 `plugins/surfcore/lib/index.js#handleVoice`、`src/voice-packs.js`。
> 原则：UI 是壳；只调 `/surfcore-api/voice/*`；不读 state；不启动/停止进程；不伪造成功。

---

## 0. 旧实现摘要（已不路由）

- 文件：`src/lib/voice.js`（旧 API/错误归一/包状态）+ `client.template.js` 的 `VoicePage`、`VoicePackCard` 等组件；**仅存档，内核入口不调用**。
- 入口：原 `BlockPage` 的 `voice` 自定义页已替换为 `VoicePendingPage`；不会再发 `/surfcore-api/voice`。
- 旧页面功能（仅记录，不作为内核能力）：安装/启动/停止/设为当前/试合成/云端配置/用量/维护；依赖旧桥，违反四层边界。

---

## 1. 后端地图（实际形状）

### 1.1 权限与前提

- 本机回环 + DSH 会话；curl 无会话 401/403，浏览器正常。
- 旧桥（QQ 桥接）必须在跑；插件只是带控制台 token 转发到旧桥 `/api/voice/*`。
- Key 永不回显；云端只给 `hasAccessKey` / `accessKeyMasked`。
- 插件未重载 / 路由未注册：404；桥接不可达：代理 502（实际实现不一定带 `VOICE_BRIDGE_DOWN`，UI 归一为 bridge-down）。

### 1.2 端点

| 方法 | 路径 | 入参 | 出参/行为 |
| --- | --- | --- | --- |
| GET | `/packs` | — | `{ok,packsDir,packs[]}`；安装/导入进度也在 packs[] |
| POST | `/packs/install` | `{id,force?,mirror?}` | `{ok,started:true}`；异步，进度看 `/packs` |
| POST | `/packs/import-inspect` | `{id,sourceDir}` | `{ok,id,sourceDir,targetDir,type,sizeBytes,version,verified,manifest,warnings[]}` |
| POST | `/packs/import` | `{id,sourceDir,allowUnverified?}` | `{ok,import:{progress,phase,...}}`；异步 |
| POST | `/packs/import-cancel` | `{id}` | `{ok}` / 无导入时 `{ok:false,error}` |
| POST | `/packs/import-delete-source` | `{id,sourceDir}` | 只允许本次记录的源目录；否则 `IMPORT_SOURCE_DELETE_REFUSED` |
| POST | `/packs/import-delete-backup` | `{id,backupDir}` | 只允许本次记录的备份；否则 `IMPORT_BACKUP_DELETE_REFUSED` |
| POST | `/packs/start` | `{id}` | `{ok,port,seconds,enginePort?,engineUp?,warning?}`；最多等 60s |
| POST | `/packs/stop` | `{id}` | `{ok}` 或 `{ok:false,error}` |
| POST | `/packs/activate` | `{id}` | `{ok,route,port}`；会停其他包、启动本包、写 route |
| POST | `/packs/test` | `{id,text?}` | `{ok,ms,bytes,seconds,duration}`；**不返回音频、不发送到任何聊天** |
| POST | `/packs/remove` | `{id}` | `{ok}`；会先 stop，目录占用时给错误 |
| POST | `/packs/cancel` | `{id}` | 取消安装，标记失败 |
| POST | `/packs/clean` | `{id}` | 清理 `.part/.pNN/models/.download`，返回 `freedBytes` |
| GET | `/packs/cloud-stats` | `?id=` | `todayChars/monthChars/totalChars/todayCalls/monthCalls/pricePerKChar/monthlyQuota/monthCost/remainChars/model/resource/speaker` |
| GET | `/packs/cloud-config` | `?id=` | `appId,hasAccessKey,accessKeyMasked,speaker,configured`（**不返回 resource**） |
| POST | `/packs/cloud-config` | `{id,appId?,accessKey?,resource?,speaker?}` | `{ok,file}`；空字段不改；Key 不回显 |
| GET | `/packs/sample` | `?id=` | `audio/wav` 二进制；不是 JSON |
| POST | `/packs/enable` | `{id,enabled}` | `{ok,enabled}`；只改 state 标记，不启动进程 |
| POST | `/tts-check` | `{}` | `{ok,route,endpoint,stages:[{name,ok,ms,code?,hint?,detail}]}`；真实合成一次，云端会计费 |

### 1.3 `packs[]` 实际字段

`id/name/version/sizeBytes/port/enginePort/engineUp/requires/voices/about/installed/running/external/dir/install/import/enabled/installedAt/importSource/backupDir/importedAt/verified/needsCloudConfig?`

状态优先级：

```text
import 非空且未完成/失败 → 导入中
install 非空且未完成/失败 → 安装中
!installed → 未安装
needsCloudConfig → 已安装 · 需配置
running → 运行中
installed → 已安装未启动
```

`install` 记录：`progress/phase/startedAt/error/logTail`；`import` 记录：`progress/phase/startedAt/error/code/hint/missing/sourceDir/targetDir/backupDir/verified/result`。

### 1.4 错误

- `IMPORT_*`（结构化 `code/error/hint/missing/detail`）：路径空/不存在/不是目录/包类型不符/不完整/清单坏/哈希不符/未验证/配置坏/环境缺/目标运行中/磁盘不足/复制失败/取消/回滚失败/清理失败/源删除拒绝/备份删除拒绝。
- `VOICE_START_TIMEOUT` / `VOICE_START_EXITED`（start 返回 `ok:false`）。
- 桥接 502：实际可能是 `{ok:false,error:'语音服务不可达...'}`，无 code；UI 归一为 `VOICE_BRIDGE_DOWN`。
- 401/403：DSH 会话缺失；UI 归一为 `VOICE_AUTH_REQUIRED`。
- 404：插件未重载/路由未注册；UI 标 `VOICE_API_NOT_LOADED`。

---

## 2. 用户任务与页面

用户要完成的事：

1. **让声音跑起来**：看当前状态 → 启动/停止 → 设为当前。
2. **换一个声音**：安装在线包 / 导入离线包 → 启动 → 试合成。
3. **云端声音**：填密钥/音色 → 保存 → 启动 → 试合成 → 看用量。
4. **出问题**：看 code/hint → 取消/清理/重试/看日志尾部。
5. **维护**：卸载、清理残留、删除导入源/备份（低频、危险）。

页面：**语音**（BlockPage 的 `voice` 自定义页）。

```text
语音
├─ 顶部状态条：控制面 / 运行中包 / 刷新 / 语音自检
├─ 语音包（两张卡：本地 / 云端）
│   ├─ 状态、版本、端口、要求、音色列表
│   ├─ 主操作：安装 / 启动 / 停止 / 设为当前 / 试合成 / 参考音频
│   ├─ 安装/导入进度 + 取消
│   ├─ 失败：code/message/hint + 重试
│   └─ 卸载 / 启用停用（低频）
├─ 云端配置（仅云端包已安装；折叠）
│   ├─ AppID / Access Key / Resource / 音色 ID
│   ├─ 保存
│   └─ 用量统计（今日/本月/费用/额度）
└─ 维护（折叠，低频）
    ├─ 清理残留
    └─ 删除导入源 / 删除导入备份（只在路径存在时）
```

不做：全局语音总闸/路由规则（不在语音前缀，属设置页）；模型下载镜像/并发（高级安装参数）；合成音频播放（后端不返回音频）。

---

## 3. 接口映射

| 用户动作 | 页面 | 后端 | 数据来源 | 状态 | 缺失备注 |
| --- | --- | --- | --- | --- | --- |
| 看语音包状态 | 顶部/卡片 | `GET /packs` | packs[] | loading/ready/empty/failed/unknown | 无 active id |
| 安装在线包 | 未安装卡 | `POST /packs/install` | `{ok,started}` | submitting/success/failed | 进度轮询 `/packs.install` |
| 检查离线包 | 导入弹窗 | `POST /packs/import-inspect` | inspect 结果 | inspecting/ready/failed | 无原生目录选择（手工路径） |
| 导入离线包 | 导入弹窗 | `POST /packs/import` | import 快照 | submitting/success/failed | 进度轮询 `/packs.import` |
| 取消导入 | 导入中卡片 | `POST /packs/import-cancel` | `{ok}` | submitting/success/failed | — |
| 启动/停止 | 卡片 | `POST /packs/start\|stop` | `{ok,...}` | submitting/success/failed/unknown | start 最多 60s |
| 设为当前 | 卡片 | `POST /packs/activate` | `{ok,route}` | submitting/success/failed | 后端不返回 active 字段 |
| 试合成 | 试合成弹窗 | `POST /packs/test` | `{ms,bytes,seconds}` | submitting/success/failed | **没有音频返回** |
| 参考音频 | 卡片 | `GET /packs/sample` | WAV blob | loading/ready/failed | 二进制，需单独请求 |
| 云端配置回显 | 云端区 | `GET /packs/cloud-config` | appId/hasAccessKey/masked/speaker | loading/ready/failed | resource 不回显 |
| 保存云端配置 | 云端区 | `POST /packs/cloud-config` | `{ok}` | submitting/success/failed | `speaker` 是实际字段 |
| 云端用量 | 云端区 | `GET /packs/cloud-stats` | 字符/费用/额度 | loading/ready/failed | 单价/额度配置在 rules，不在本前缀 |
| 语音自检 | 顶部 | `POST /tts-check` | stages | submitting/success/failed | 真实合成，云端计费 |
| 启用/停用 | 卡片 | `POST /packs/enable` | `{ok,enabled}` | submitting/success/failed | 只改标记，不启动 |
| 卸载 | 卡片 | `POST /packs/remove` | `{ok}` | submitting/success/failed | 外部安装不提供卸载 |
| 取消安装 | 安装中 | `POST /packs/cancel` | `{ok}` | submitting/success/failed | — |
| 清理残留 | 维护 | `POST /packs/clean` | `{freedBytes}` | submitting/success/failed | 删除 `.part` 等，需确认 |
| 删除导入源/备份 | 维护 | `import-delete-*` | `{ok,freedBytes?}` | submitting/success/failed | 只允许本次记录路径，需确认 |

---

## 4. 状态矩阵

### 页面

- `loading`：骨架/加载提示。
- `ready`：至少一个包；显示状态和操作。
- `empty`：`packs=[]`；显示“后端没有返回语音包”+重试。
- `failed`：code/message/hint + 重试；401/403/404/502 各有可行动提示。
- `unknown`：超时/断网；不假装在线。
- `unavailable`：404 插件未重载；提示重载/重启 DSH。

### 包

```text
未安装 / 已安装未启动 / 运行中 / 安装中 / 导入中 / 安装失败 / 导入失败 / 需配置 / 已停用 / 外部安装
```

- 安装中/导入中：进度条 + `phase` + 取消；禁用启动/卸载/试合成。
- 失败：显示 `error/code/hint`；允许重试（安装/导入）或清理。
- 需配置：启动/设为当前禁用；主按钮“配置云端”。
- 已停用：可启动，但显示“宿主未启用”提示；启动是进程操作，启用是可用源标记，二者分开。
- 外部安装：`external=true`；不提供卸载（避免删错目录），显示说明。

### 动作

`idle / submitting / success / failed / unknown`；提交中全局禁用所有动作按钮（`useMemoryAction` 全局 busy），防止重复点击；成功后重新拉 `/packs`（或 cloud config/stats）。

---

## 5. 数据更新

- 首屏 `GET /packs`。
- 安装/导入进度：只在 `packs.some(p=>p.install||p.import)` 且页面可见时，用递归 `setTimeout` 2s 轮询 `/packs`；无活动任务立即停；`document.hidden` 暂停；卸载清理 timer/abort。**不用 setInterval**。
- 动作成功后立即 `packs.reload()`；启动/停止/activate 后不乐观改状态，等 `/packs` 确认。
- 云端配置/用量：打开云端区时加载；保存成功后重拉 config/stats/packs。
- 参考音频：按需 fetch blob；替换/卸载时 `URL.revokeObjectURL`。
- 语音自检：手动触发，不自动轮询；90s 超时；结果展示 stages。
- 页面隐藏/卸载停止轮询和请求；旧请求不覆盖新状态（`useMemoryLoad` generation + abort）。

---

## 6. 视觉与分层

- 复用 `sc-page / sc-sect / sc-mem-card / sc-btn / sc-mem-banner / sc-mem-pill / sc-mem-note` 与 tokens；不引入新视觉体系。
- 新增 `sc-voice-*`：卡片网格、状态行、操作行、进度条、表单、stage 列表；深蓝黑底、青/蓝强调。
- 本地包青色、云端紫色；状态同时有文字，不只靠颜色。
- 分层：`voiceApi` → `useMemoryLoad`（packs/config/stats）/`useMemoryAction`（动作）→ `VoicePage` → `VoicePackCard` / `VoiceImportDialog` / `VoiceCloudPanel` / `VoiceTestDialog` / `VoiceCheckResult` / `VoiceMaintenance`。
- `VoicePageView` 纯展示，供 smoke 用 fixtures；逻辑留在 `VoicePage`。

---

## 7. 待补充（不假装）

1. **当前语音包 id**：`/packs` 不返回 active；只能显示“运行中”/多个运行中，不标“当前”。
2. **试合成音频**：`/packs/test` 只返回耗时/字节/秒数，不返回音频；页面不提供“播放合成结果”。
3. **云端连接测试**：没有独立“测试连接”端点；只能在启动后试合成，或运行 `/tts-check`。
4. **云端 `resource` 回显**：`cloud-config` 不返回 resource；表单留空保留，不伪造。
5. **原生目录选择**：语音契约没有 browse；离线导入先用手工绝对路径（宿主 `/surfcore-api/browse` 不在本前缀）。
6. **全局语音总闸/路由/触发规则**：在设置页 `socialV2.voice`，不在本页；不重复做。
7. **安装镜像/并发/强制重装**：安装接口支持，但属高级参数，本轮不做。
8. **删除导入源/备份**：只在维护区、路径存在时出现，需确认；不做批量删除。
9. **桥接错误码**：代理 502 可能没有 `VOICE_BRIDGE_DOWN`；UI 归一显示，不把原始 HTML 当 JSON。
