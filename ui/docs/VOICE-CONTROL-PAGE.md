# 语音 UI（同源控制面）

> 前端：`surfcore-ui`；后端：`surfcore-persona-core` 的 `kernel/voice` + 宿主同源代理。
> 契约：`docs/persona-core/VOICE-UI-API.md`；后端内部：`VOICE-CONTROL-API.md`。
> 状态：**UI v0.34.0 已实现**。

---

## 0. 实现摘要

- 文件：`src/lib/voice-control.js`（同源 API/错误归一，构建内联）+ `client.template.js` 的 `VoiceControlPage`、`VoiceModelCard`、`VoiceProviderPanel`、`VoiceImportDialog`、`VoiceRelinkDialog`、`VoiceSynthDialog`。
- 模型卡自己负责导入：`missing` 卡片显示 **「导入」**，点开弹窗；没有全局导入入口。弹窗只让选 **模型 .zip** 和 **安装根目录**；实际 target 是 `<根目录>\<modelId>`，自动留子目录，不铺满根目录。model id/kind/voiceId/label 由卡片带入，不展示内部参数。
- 安装位置下方有 **「导入成功后删除原 .zip（不可恢复）」**，默认关闭；仅选中 .zip 时可勾；提交前二次确认。成功只按后端 `sourceDeleted/sourceDeleteError` 显示结果。
- 入口：`BlockPage` 的 `voice` 路由。
- **UI 只调 `16460` 的 `/surfcore-api/voice/*`**；不填地址、不填 token、不处理 CORS。
- 4317 已由后端收掉；宿主直接调 `kernel/voice`。
- 页面：状态条 + 模型卡 + 服务商 + 导入 + 试合成。
- 测试：`test-voice-control-api.mjs` 28 项；smoke 21 个组件。

---

## 1. 后端地图（UI 可见部分）

Base：`/surfcore-api/voice`（同源）。

> 4317 已由后端收掉；宿主直接调用 `kernel/voice`。UI 始终只认同源路径，契约不变。

**路径选择（宿主工具，不是语音 API）**：`GET /dsh-surfcore/api/browse?mode=file|dir&title=...` → `{ok,path}`；只在本机桌面可用。  
没有浏览器上传接口；`sourceDir` 必须是宿主本机路径。宿主 browse 目前只支持固定 filter 枚举，zip 暂借用 `embedding-pack` 的 `*.zip` 过滤，后端应补 `voice-pack`。

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| GET | `/status` | — | `{ok,active,models[],providers[]}` |
| GET | `/models` | — | `{ok,models[]}` |
| GET | `/providers` | — | `{ok,providers[]}` |
| POST | `/providers` | provider 对象 | `{ok,provider}`；Key 不回显 |
| DELETE | `/providers/:id` | — | `{ok}` |
| POST | `/models/load` | `{modelId}` | `{ok,modelId,state}` |
| POST | `/models/unload` | `{modelId}` | `{ok,modelId,state}` |
| POST | `/models/select` | `{modelId}` | `{ok,active}` |
| POST | `/models/probe` | `{modelId,text}` | `{ok,bytes,durationMs}` |
| POST | `/models/synthesize` | `{modelId,text,voiceId?}` | `{ok,bytes,durationMs}` |
| POST | `/models/import` | `{sourceDir,targetDir,force?,model{...}}` | `{ok,model}` |

模型：`modelId / kind(local|cloud) / voiceId / label / state(missing|idle|loaded) / available`。  
Provider：`id / kind / configured / hasKey / keyMasked / endpoint / model / voiceId`。

错误：`{ok:false,error:{code,message,hint,retryable}}`。

- 503/502/401/403/404：UI 统一显示「语音服务暂时不可用」+ 重试；不向用户暴露 token/4317/代理细节。
- 参数/操作错误（如 modelId 不存在、导入失败）才显示具体 code/hint。

---

## 2. 用户任务与页面

1. 进入「语音」→ 自动读状态；
2. 看当前模型 / 模型列表 / 服务商；
3. 启动 / 停止 / 设为当前；启动另一个会先停止已启动的（互斥）；本地启动后约 1–3 分钟才可合成；
4. 重新定位已改名/移动的模型目录；
5. 试合成 → 播放试音（probe 返回 Buffer/WAV）；
6. 添加/编辑/删除服务商；
7. 导入模型工件（zip，长任务）。

```text
语音
├─ 状态条：当前模型 / 模型数 / 服务商数 / 刷新
├─ 模型 cards：启动 / 停止 / 设为当前 / 试合成 / 重新定位
├─ 服务商：火山引擎 · 声音复刻 2.0；AppID / AccessKey / Resource ID / speaker；Key 留空保留
├─ 导入：卡片「导入」→ 选 .zip + 安装根目录（实际 <root>\<modelId>）
└─ 试合成弹窗：text → bytes/duration → 播放试音
```

不做的按钮：启动控制面、导入进度、浏览器上传、QQ/B站/桥接。

---

## 3. 接口映射

| 用户动作 | 页面 | 后端 | 数据 | 状态 | 缺失 |
| --- | --- | --- | --- | --- | --- |
| 进页面 | 全局 | `GET /status` | active/models/providers | loading/ready/empty/failed/unknown | — |
| 启动 | 模型卡 | `POST /models/load` | `{ok,state}` | submitting/success/failed/unknown | 先停止其他已启动模型；本地等 1–3 分钟 |
| 停止 | 模型卡 | `POST /models/unload` | `{ok,state}` | submitting/success/failed | — |
| 设为当前 | 模型卡 | `POST /models/select` | `{ok,active}` | submitting/success/failed | — |
| 重新定位 | 模型卡 | `POST /models/relink` | `{ok,artifactDir}` | submitting/success/failed | 只改指针，不复制 |
| 试合成 | 弹窗 | `POST /models/probe` | `{bytes(Buffer),durationMs}` | submitting/success/failed | 播放用 Buffer.data |
| 保存服务商 | 服务商 | `POST /providers` | `{ok,provider,applied}` | submitting/success/failed | Key 不回显；写入 config.toml/voice.json |
| 删除服务商 | 服务商 | `DELETE /providers/:id` | `{ok}` | submitting/success/failed | 需确认 |
| 导入 | 导入弹窗 | `POST /models/import` | `{ok,model}` | submitting/success/failed/unknown | 无进度、本机路径 |

---

## 4. 状态

页面：`loading / ready / empty / failed / unknown`；无单独“连接”状态，代理失败直接显示错误 + 重试。

模型：`missing / idle / loaded`；动作 `idle/submitting/success/failed/unknown`；提交中禁用重复点击。

导入：同步长请求；显示“导入中，可能数分钟，不要重复提交”；无百分比；超时是 unknown；失败不自动重试。

---

## 5. 数据更新

- 首屏 `GET /status`；
- 动作成功后重拉 status；
- **不轮询**（没有 job/进度）；
- 页面卸载/隐藏：GET 由 `useMemoryLoad` abort；长导入不可安全取消，提示不要关闭页面；
- 旧响应不覆盖新状态（generation + abort）。

---

## 6. 视觉与分层

- 复用 `sc-page / sc-sect / sc-mem-* / sc-btn / sc-mem-pill`；新增 `sc-voicec-*`。
- 模型卡 local 青 / cloud 紫；状态文字，不只靠颜色。
- `voice-control.js` → `useMemoryLoad/useMemoryAction` → `VoiceControlPage` → 模型卡/服务商/导入/试合成。
- 不读 state、不启动进程、不接触 4317/token。

---

## 7. 待补充

1. 浏览器文件上传/zip 上传：控制面只接受本机路径；当前用宿主原生选择器，非浏览器 `<input type=file>`。
2. 导入进度 job：无。
3. 宿主 browse 的 `voice-pack` filter：暂无；现在 zip 借用 `embedding-pack`，对话框过滤名不准确。
4. 音频输出格式：probe 返回 Buffer/WAV，UI 用 Blob 播放；synthesize 路由仍只回数字。若未来改成音频 URL/流，再切换。
5. 控制面启动/停止：宿主负责；UI 不做。
6. 模型版本/描述：status 没有，不显示。
7. 服务商独立“测试连接”：无，保存后靠 probe/status。
