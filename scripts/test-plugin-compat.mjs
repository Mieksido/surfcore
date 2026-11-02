// 插件冲突体检：只读夹具，不碰真实 DSH_HOME / 配置 / 网络。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanPluginCompatibility } from '../plugins/surfcore/lib/compat.js';
import { CONTEXT_TOOL_NAMES } from '../plugins/surfcore/lib/compat-rules.js';
import { SAFE_EXACT_TOOLS } from '../plugins/surfcore/qq-tool-restrict.mjs';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfc-compat-'));
const profile = path.join(root, 'profiles', 'desktop');
fs.mkdirSync(path.join(profile, 'node_modules', 'billion-context'), { recursive: true });
fs.mkdirSync(path.join(profile, 'node_modules', 'mystery-context'), { recursive: true });
fs.mkdirSync(path.join(profile, 'node_modules', 'declared-context'), { recursive: true });
fs.mkdirSync(path.join(profile, 'node_modules', 'evil-plugin'), { recursive: true });
fs.mkdirSync(path.join(profile, 'node_modules', 'client-dupe'), { recursive: true });

fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
  name: 'fixture-profile',
  dsh: { profile: { bundles: ['surfcore', 'billion-context', 'mystery-context', 'declared-context', 'evil-plugin', 'client-dupe'] } },
}));
fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), [
  '- id: billion-context',
  '  name: billion-context',
  '- id: compaction-basic',
  "  name: '@deepseek-ai/dsh-compaction-basic'",
  '  config:',
  '    auto: false',
  '',
].join('\n'));
fs.writeFileSync(path.join(profile, 'node_modules', 'billion-context', 'package.json'), JSON.stringify({
  name: 'billion-context', version: '0.1.209',
}));
fs.writeFileSync(path.join(profile, 'node_modules', 'billion-context', 'dsh.bundle.patch.yml'), [
  '- id: billion-context',
  '  name: billion-context',
  '',
].join('\n'));
fs.writeFileSync(path.join(profile, 'node_modules', 'mystery-context', 'package.json'), JSON.stringify({
  name: 'mystery-context', version: '1.0.0',
}));
fs.writeFileSync(path.join(profile, 'node_modules', 'mystery-context', 'dsh.bundle.patch.yml'), '- id: mystery\n  name: mystery-context\n');
fs.writeFileSync(path.join(profile, 'node_modules', 'declared-context', 'package.json'), JSON.stringify({ name: 'declared-context', version: '2.0.0' }));
fs.writeFileSync(path.join(profile, 'node_modules', 'evil-plugin', 'package.json'), JSON.stringify({ name: 'evil-plugin', version: '9.9.9' }));
fs.writeFileSync(path.join(profile, 'node_modules', 'evil-plugin', 'surfcore.compat.json'), JSON.stringify({
  schema: 1,
  tools: [{ name: 'rm_rf', class: 'local-execution' }],
}));
fs.writeFileSync(path.join(profile, 'node_modules', 'client-dupe', 'package.json'), JSON.stringify({
  name: 'client-dupe',
  version: '1.0.0',
  type: 'module',
  exports: { './client': './client.js' },
  dsh: { client: { platform: 'web' }, bundle: { patch: ['./cordis.patch.yml'] } },
}));
fs.writeFileSync(path.join(profile, 'node_modules', 'client-dupe', 'cordis.patch.yml'), [
  '- insert:',
  '    - id: client-main',
  '      name: client-dupe',
  '    - id: client-second',
  '      name: ./entry.js',
  '',
].join('\n'));
fs.writeFileSync(path.join(profile, 'node_modules', 'declared-context', 'surfcore.compat.json'), JSON.stringify({
  schema: 1,
  tools: [{ name: 'acp_status', class: 'model-context' }],
  capabilities: ['context-compression'],
}));

try {
  const r = scanPluginCompatibility({ dshHome: root, profileName: 'desktop', surfcoreVersion: '0.7.18' });
  assert.equal(r.ok, false);
  assert.equal(r.profile.name, 'desktop');
  // 2026-10-30：billion-context 的 5 个工具已进 QQ 白名单 → 不应再报工具拒绝
  assert.ok(!r.issues.some((i) => i.code === 'COMPAT_TOOL_DENIED' && i.evidence.bundle === 'billion-context'),
    'billion-context 工具已白名单放行，不应再报拒绝');
  const denied = r.issues.find((i) => i.code === 'COMPAT_TOOL_DENIED' && i.evidence.bundle === 'evil-plugin');
  assert.ok(denied, '未声明白名单的工具仍要被拒（evil-plugin）');
  assert.equal(denied.confidence, 'confirmed');
  assert.ok(['blocker', 'high'].includes(denied.severity), `严重度应为 blocker/high（实际 ${denied.severity}）`);
  assert.deepEqual(denied.evidence.denied, ['rm_rf']);
  assert.ok(denied.recommendation.length > 4, '建议要指向止损');

  const compact = r.issues.find((i) => i.code === 'COMPAT_COMPACTION_CONFLICT');
  assert.ok(compact, '应发现 compaction auto=false');
  assert.equal(compact.confidence, 'confirmed');

  assert.ok(!r.issues.some((i) => i.code === 'COMPAT_TOOL_DENIED' && i.evidence.bundle === 'declared-context'),
    'declared-context 的 acp_status 已在白名单，不应再报拒绝');

  const unknown = r.issues.find((i) => i.code === 'COMPAT_TOOL_INVENTORY_UNKNOWN');
  assert.ok(unknown, '未知插件必须标 unknown，不能假装通过');
  assert.equal(unknown.confidence, 'unknown');
  assert.equal(unknown.severity, 'info');

  const multi = r.issues.find((i) => i.code === 'COMPAT_CLIENT_MULTI_SOURCE'
    && i.evidence?.package === 'client-dupe');
  assert.ok(multi, '同一客户端包被两条 Loader 行解析时必须报 blocker');
  assert.equal(multi.severity, 'blocker');
  assert.equal(multi.evidence.sources.length, 2);

  // 显式放行上下文工具：工具拒绝应消失；压缩接管冲突仍存在。
  const allowed = scanPluginCompatibility({
    dshHome: root, profileName: 'desktop', surfcoreVersion: '0.7.18',
    safeExact: [...SAFE_EXACT_TOOLS, 'rm_rf'],
  });
  assert.ok(!allowed.issues.some((i) => i.code === 'COMPAT_TOOL_DENIED'), '放行后不应再报工具拒绝');
  assert.ok(allowed.issues.some((i) => i.code === 'COMPAT_COMPACTION_CONFLICT'), '压缩接管仍需报');

  // 没有 profile：必须报 blocker，不能返回空报告冒充通过。
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sfc-compat-empty-'));
  try {
    const none = scanPluginCompatibility({ dshHome: empty });
    assert.equal(none.ok, false);
    assert.equal(none.issues[0]?.code, 'COMPAT_PROFILE_NOT_FOUND');
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
  }

  // 接线契约：后端路由与概览按钮必须存在，避免只写了 scanner 却点不到。
  const indexSource = fs.readFileSync(path.resolve('plugins/surfcore/lib/index.js'), 'utf8');
  const clientSource = fs.readFileSync(path.resolve('plugins/surfcore/lib/client.js'), 'utf8');
  assert.match(indexSource, /compat\/scan/, '后端必须有 /compat/scan 路由');
  assert.match(clientSource, /插件体检/, '概览必须有「插件体检」按钮');
  assert.match(clientSource, /CompatModal/, '报告弹窗必须接线');

  console.log('✅ 插件冲突体检通过');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
