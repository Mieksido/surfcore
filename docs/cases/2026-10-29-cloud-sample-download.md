# 云端参考音频“下载”点了没反应

- **日期**：2026-10-29
- **现象**：设置页「云端包：密钥与音色」第 1 步「下载参考音频」点击无反应，用户拿不到 `小语-参考音频19秒.wav`。
- **影响**：用户无法按引导上传参考音频做火山声音复刻；不会影响已有密钥/语音，但新用户卡在第一步。

## 原因

1. 桥接接口本身正常：直接带 console token 请求 `/api/voice/packs/sample?id=voice-cloud` 返回 `HTTP 200`、`audio/wav`、922,604 字节，`content-disposition` 也正确。
2. 设置页用的是 `<a href="/dsh-surfcore/api/voice/packs/sample?id=voice-cloud" target="_blank">`：
   - DSH Web/Electron 宿主会拦截 `target=_blank` 新窗口或顶层导航；
   - 文件下载响应不是可渲染页面，宿主没有下载处理器时表现为“点了没反应”。
3. 之前没有失败兜底，所以用户看不到任何错误。

## 修法

- 改成 **JS fetch → Blob → `<a download>`**，不再依赖新窗口/顶层导航；文件名从 `content-disposition` 解析。
- 旁边保留 **「打开所在目录」**：插件新增 `POST /voice/packs/sample-open`，经桥接拿到包路径后用 `explorer.exe /select,<file>` 打开并选中参考音频。
- 失败时在表单下显示具体原因（HTTP/接口错误），不静默。

## 验证

- 桥接 `/api/voice/packs/sample?id=voice-cloud` 实测 200 + WAV（922,604 字节）。
- `node --check` 插件两个 lib 文件通过。
- **设置页实际点击需要重启 DSH 后手测**（本轮没有重启 DSH，避免中断会话）。

## 残余

- 非 Windows 系统 `sample-open` 返回“手动打开目录”的路径提示。
- 若 DSH 宿主仍拦截 Blob 下载，用户可点「打开所在目录」手动复制；这是兜底路径。
