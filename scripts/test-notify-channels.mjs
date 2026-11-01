// 通知通道回归：桌面 toast 脚本不能再用反斜杠转义；QQ 推送只能走控制台专用端点。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildDesktopToastScript } from '../plugins/surfcore/tools/lib/desktop-toast.mjs';

const script = buildDesktopToastScript();
assert.ok(!script.includes('\\"'), 'PowerShell 脚本不能含 \\" 转义');
assert.ok(script.includes('[System.Security.SecurityElement]::Escape'), '标题/正文必须做 XML 转义');
assert.ok(script.includes('ToastGeneric'), '必须仍是 toast XML');
assert.ok(!script.includes('DW_XML'), '不再写临时 XML 文件');
assert.ok(script.includes('DW_TITLE') && script.includes('DW_TEXT'));

const notify = fs.readFileSync(path.resolve('plugins/surfcore/tools/commands/notify.mjs'), 'utf8');
assert.ok(notify.includes("type === 'qq'"), '必须有 QQ 推送分支');
assert.ok(notify.includes('/api/notify/owner'), 'QQ 推送必须走专用端点');
assert.ok(notify.includes("stdio: ['ignore', 'ignore', 'pipe']"), '桌面通知必须捕获 stderr');
assert.ok(notify.includes('桌面通知仅支持 Windows'), '非 Windows 不能假装成功');

const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
const store = fs.readFileSync(path.resolve('plugins/surfcore/lib/store.js'), 'utf8');
const client = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');
const plugin = fs.readFileSync(path.resolve('plugins/surfcore/lib/index.js'), 'utf8');
assert.ok(bridge.includes("url.pathname === '/api/notify/owner'"), '桥接必须有管理员通知端点');
assert.ok(bridge.includes('NOTIFY_CONSOLE_ONLY'), 'AI 不能调用管理员通知');
assert.ok(bridge.includes('NOTIFY_OWNER_MISSING'), '未配置管理员要结构化报错');
assert.ok(bridge.includes('NOTIFY_SENSITIVE'), '敏感正文要阻止并给 hint');
assert.ok(bridge.includes("url.pathname === '/api/notice/timeout'"), '超时提醒必须进错误报告');
assert.ok(bridge.includes('readBiliTimeoutMutes'), '超时静音必须读配置文件');
assert.ok(client.includes('/timeout-mute'), '超时“不再提示”必须写配置');
assert.ok(plugin.includes("endsWith('/timeout-mute')") && plugin.includes('saveBiliConfig'), '超时静音必须写 bili.config.json');

assert.ok(store.includes("'qq'"), '配置必须接受 qq 类型');
assert.ok(client.includes('QQ 私聊管理员'), '设置页必须提供 QQ 推送选项');
console.log('✅ 通知通道测试通过');
