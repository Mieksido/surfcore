/**
 * Windows toast script generation (pure, testable).
 *
 * 为什么单独拆出来：以前脚本拼在 notify.mjs 里，用 JS 的 \\" 生成 PowerShell
 * 字符串；PowerShell 不认反斜杠转义，桌面通知 100% 语法错误。这里把脚本生成
 * 变成纯函数，测试可以直接断言生成物，不再依赖真的弹窗。
 */
export function buildDesktopToastScript() {
  return [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null',
    // 单引号包 XML；标题/正文通过环境变量传入并做 XML 转义，避免 & < > 破坏 XML。
    "$xmlText = '<toast><visual><binding template=\"ToastGeneric\"><text>' + [System.Security.SecurityElement]::Escape($env:DW_TITLE) + '</text><text>' + [System.Security.SecurityElement]::Escape($env:DW_TEXT) + '</text></binding></visual></toast>'",
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    '$xml.LoadXml($xmlText)',
    '[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("DeepSeek Harness").Show([Windows.UI.Notifications.ToastNotification]::new($xml))',
  ].join('\n');
}
