# 原生「浏览…」选中文目录，导入报目录不存在

- **日期**：2026-10-29
- **现象**：用户解压出 `voice-local`，在设置页点「导入离线包」选中它，错误弹窗显示
  `IMPORT_PATH_NOT_FOUND`，路径里出现 `�` / `◆` 等乱码；实际目录存在。
- **影响**：中文路径下的语音包无法导入；SnowLuma 选择目录、安装目录等其他「浏览…」也会受影响。

## 原因

`handleBrowse` 用 `execFile('powershell.exe', ...)` 执行 Windows Forms 选择框，然后从
**stdout** 读取路径。Windows PowerShell 5.1 在重定向 stdout 时默认用 OEM/GBK 编码，
Node 按 UTF-8 解码，中文目录就变成乱码；后端拿乱码路径 `fsp.stat` 自然 ENOENT。

截图路径里的 `◆`/`�` 就是这个编码损坏，不是用户选错。

## 修法

- 不再从 stdout 读路径：PowerShell 把 `$d.SelectedPath` / `$d.FileName` 写进临时文件，
  用 `UTF8Encoding($false)` 编码；Node 读该文件后删除。
- 临时文件名只用 ASCII + UUID；标题/路径不参与 stdout 编码。
- 取消 / 超时 / PowerShell 启动失败仍然走原来的 `{ok:false, cancelled/error}` 分支。
- 同一函数服务所有「浏览…」（导入、安装目录、SnowLuma），一处修复全部生效。

## 验证

- `node --check plugins/surfcore/lib/index.js` 通过。
- 用 PowerShell 把中文路径写入临时 UTF-8 文件、Node 读回，内容一致。
- **真实选择框需要重启 DSH 后手测**（本轮不重启，避免中断会话）。

## 残余

- 如果用户已经因为旧 bug 把包放在乱码路径下，重新选择一次即可；不需要移动文件。
- 错误弹窗仍会显示实际路径，中文正常显示后便于排查。
