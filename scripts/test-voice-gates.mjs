// 回归：语音"三个闸门"与配置双写覆盖
// 2026-10-29 复盘：MCP 在进程启动时按配置过滤工具 → 改了开关没重启，模型手里没有 qq_send_voice；
// DSH 面板整份回写 qq 配置 → 会把控制台刚改的语音开关覆盖回 false。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label} ${extra}`); }
};

// 1) 配置版本戳：文件改动后戳变化；缺失戳不过期（兼容旧客户端）
{
  const { fileStamp, isStale } = await import('../src/config-stamps.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-stamp-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, '{"a":1}');
  const s1 = fileStamp(file);
  ok(Boolean(s1), '有文件的戳非空');
  await new Promise((r) => setTimeout(r, 15));
  fs.writeFileSync(file, '{"a":2}');
  const s2 = fileStamp(file);
  ok(s1 !== s2, '文件改动后戳变化');
  ok(isStale(s1, s2) === true, '旧戳对不上新戳 → 过期');
  ok(isStale(s2, s2) === false, '同戳 → 未过期');
  ok(isStale('', s2) === false, '没带戳（旧客户端）→ 不过期');
  ok(isStale(s2, '') === false, '读不到当前文件 → 不过期');
  ok(fileStamp(path.join(dir, 'nope.json')) === '', '文件不存在 → 空戳');
  fs.rmSync(dir, { recursive: true, force: true });
}

// 2) MCP 工具常注册：不能再用"启动期配置"过滤 qq_send_voice
{
  const src = fs.readFileSync(path.resolve('src/mcp-snowluma-safe.js'), 'utf8');
  const gate = /if\s*\(\s*cfg\.socialV2\?\.voice\?\.enabled\s*!==\s*false\s*&&\s*cfg\.socialV2\?\.tools\?\.sendVoice\s*!==\s*false\s*\)\s*\{\s*server\.tool\(/;
  ok(!gate.test(src), 'qq_send_voice 不再被启动期配置过滤');
  ok(/server\.tool\(\s*'qq_send_voice'/.test(src), 'qq_send_voice 始终注册');
  ok(src.includes('code=VOICE_DISABLED'), '工具描述里写明未启用会返回 code');
  ok(/if \(body\?\.code\) err\.code/.test(src), 'MCP 保留桥接返回的 code');
}

// 3) 桥接拒绝时带 code+hint（模型/用户能知道卡在哪一关）
{
  const src = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
  ok(src.includes("code: 'VOICE_DISABLED'"), '总闸关闭返回 VOICE_DISABLED');
  ok(src.includes("code: 'VOICE_TOOL_DISABLED'"), '工具关闭返回 VOICE_TOOL_DISABLED');
  ok(/hint: '设置 → SurfCore → 语音/.test(src), '总闸提示指向语音页');
  ok(/hint: '设置 → SurfCore → 语音/.test(src), '工具提示指向语音页');
}

// 4) 服务端保存必须支持并发拒绝（配置双写覆盖）
{
  const src = fs.readFileSync(path.resolve('plugins/surfcore/lib/index.js'), 'utf8');
  ok(src.includes('CONFIG_STALE'), '保存冲突返回 CONFIG_STALE');
  ok(src.includes('baseStamp'), '保存读取客户端带来的戳');
  ok(/stamps: \{[\s\S]{0,200}qq: fileStamp\(QQ_CONFIG\)/.test(src), 'GET /config 返回 qq 戳');
}

// 5) 客户端：保存带戳、409 不盲目覆盖
{
  const src = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');
  ok(src.includes('baseStamp: configStamps'), '保存时回传 baseStamp');
  ok(/CONFIG_STALE\|已被别处修改/.test(src), '客户端识别冲突并提示重新读取');
  ok(src.includes('语音开关'), '语音页必须有总闸/工具开关卡片');
  ok(src.includes('socialV2.tools.sendVoice'), '语音页必须能切「发语音」工具');
  ok(src.includes('保存语音开关'), '语音页必须能保存这两个开关');
}

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
console.log('\n✅ test-voice-gates 通过');
