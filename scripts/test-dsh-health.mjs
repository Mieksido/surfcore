// DSH 升级后的健康审计（2026-11-01 用户反馈：升级后 QQ 会话没有 qq_* 工具）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkProfileMcp, presetMismatch, REQUIRED_MCP_IDS } from '../src/dsh-health.js';

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label} ${extra}`); }
};

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-health-'));
try {
  const writeProfile = (name, body) => {
    const dir = path.join(home, '.dsh', 'profiles', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cordis.patch.yml'), body, 'utf8');
  };

  // 1) 三条 MCP 都在 → 健康
  writeProfile('desktop', [
    'plugins:',
    '  - id: mcp-snowluma',
    '  - id: mcp-snowluma-host',
    '  - id: mcp-web-search-safe',
    '  - id: surfcore',
  ].join('\n'));
  {
    const r = checkProfileMcp(home);
    ok(r.ok === true && r.checked === 1, '三条 MCP 齐全 → 健康', JSON.stringify(r));
    ok(r.healthy.includes('desktop'), '健康的 profile 被记下');
  }

  // 2) 升级后 profile 被摘掉 MCP → 必须报缺
  writeProfile('web', 'plugins:\n  - id: surfcore\n');
  {
    const r = checkProfileMcp(home);
    ok(r.ok === true, '仍有一个健康 profile 时整体不判坏（用户的 desktop 还在）');
    const web = r.broken.find((x) => x.profile === 'web');
    ok(web && web.missing.length === REQUIRED_MCP_IDS.length, 'web 缺三条 MCP 被列出', JSON.stringify(web));
  }

  // 3) 全坏 → ok=false（触发 L2）
  fs.rmSync(path.join(home, '.dsh', 'profiles', 'desktop'), { recursive: true, force: true });
  {
    const r = checkProfileMcp(home);
    ok(r.ok === false && r.checked === 1, '全部 profile 都缺 MCP → ok=false', JSON.stringify(r));
  }

  // 4) 没有 profiles 目录：不能判坏（可能是非标准安装）
  {
    const emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-health-empty-'));
    const r = checkProfileMcp(emptyHome);
    ok(r.ok === false && r.checked === 0, '没有 profile 时 checked=0（调用方不应据此报警）');
    fs.rmSync(emptyHome, { recursive: true, force: true });
  }

  // 5) preset 一致性：只在双方都有值时判不一致
  ok(presetMismatch('qq-chat-v2', 'qq-chat-v2') === false, 'preset 相同 → 无需重建');
  ok(presetMismatch('qq-chat-v2', 'standard') === true, 'preset 不同 → 重建');
  ok(presetMismatch('qq-chat-v2', '') === false, '旧会话没记录 preset → 不误删');
  ok(presetMismatch('', 'standard') === false, '当前模式没有预设 → 不误删');

  // 6) 接线：桥接必须真的做这两件事
  const bridge = fs.readFileSync(path.resolve('src/bridge.js'), 'utf8');
  ok(bridge.includes('checkProfileMcp'), '桥接要检查 profile MCP');
  ok(bridge.includes('auditDshHealth'), '桥接要调用健康审计');
  ok(bridge.includes('presetMismatch(expected, item.agentPreset)'), '按 session 的 agentPreset 判断是否重建');
  ok(bridge.includes('retireSession(key)'), 'preset 不一致要退役会话');
  ok(bridge.includes('dsh-profile-mcp-missing'), '缺 MCP 要写 L2 事件');
  ok(bridge.includes('session-preset-rebuilt'), '重建会话要写事件');
  ok(bridge.includes('setup-dsh.mjs'), '建议里要给出 setup-dsh.mjs 这条下一步');
  // 2026-11-01：QQ 会话里没有本地工具，模型跑不了 setup 脚本；建议必须写明“宿主机终端”。
  ok(bridge.includes('宿主机终端'), '建议要说明在宿主机终端执行（模型没有本地工具）');
  ok(bridge.includes('脚本本身不会重启 DSH'), '要说明 setup 脚本不会自动重启，避免用户以为会话被中断');
  ok(bridge.includes('manualOnly: true'), '事件里标记 manualOnly，便于 UI/调用方区分');

  // 7) 控制台一键修复入口（2026-11-01 用户要求 A）：只显式触发，不自动跑
  const plugin = fs.readFileSync(path.resolve('plugins/surfcore/lib/index.js'), 'utf8');
  ok(plugin.includes('handleDshRepair'), '插件要有 DSH 注册修复接口');
  ok(plugin.includes('DSH_REPAIR_SCRIPT_MISSING'), '缺脚本要给出结构化 code');
  ok(plugin.includes('ELECTRON_RUN_AS_NODE'), '用 Electron 内置 node 跑脚本的兜底');
  ok(!/startup[\s\S]{0,80}handleDshRepair\(/.test(plugin), '修复不能自动执行（只能点按钮）');
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
console.log('\n✅ dsh-health 通过');
