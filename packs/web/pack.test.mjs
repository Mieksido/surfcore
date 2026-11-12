/**
 * web 包契约测试（不联网）
 * 跑法：node packs/web/pack.test.mjs
 */
import pack, { identity, capabilities, settings, configure, open, send, health, close } from './index.js';
import { validatePack } from '../../runtime/index.js';

const { ui, toolDeclarations, runTool } = pack;

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 契约四块');
{
  const v = validatePack(pack);
  ok(v.ok, `四块齐全：${v.errors.join('；') || '无错误'}`);
  ok(identity.publisher === 'surfcore' && identity.name === 'web', 'identity 与 pack.json 一致');
  ok(capabilities.timing === 'async' && capabilities.modality === 'text', '能力轴：异步/文本');
  ok(settings.length === 3, '设置：端点/密钥/上限');
  ok(ui.menu[0].id === 'web' && ui.pages[0].id === 'web.settings', '界面声明：联网菜单 + 设置页');
}

console.log('\n## 工具面');
{
  configure({ searchEndpoint: 'https://search.example.com/api', searchKey: 'k', maxChars: 1000 });
  await open({ log: () => {} });
  const decls = toolDeclarations();
  ok(decls.length === 2, '两个工具：web_fetch / web_search');
  ok(decls.find((d) => d.name === 'web_fetch').parameters.required.includes('url'), 'fetch 必填 url');
  ok(decls.find((d) => d.name === 'web_search').parameters.required.includes('query'), 'search 必填 query');

  const missing = await runTool('web_fetch', {});
  ok(!missing.ok && missing.error.code === 'web.missing-url', '缺 url：结构化错误');
  const unknown = await runTool('web_nope', {});
  ok(!unknown.ok && unknown.error.code === 'web.unknown-tool', '未知工具：结构化错误');
}

console.log('\n## 生命周期 / 健康 / 发送');
{
  const h = await health();
  ok(h.status === 'ok' && h.search === true && h.tools === 2, '健康：启动/搜索/工具数');
  const s = await send({ kind: 'say', text: 'x' });
  ok(s.status === 'unsupported' && s.error.code === 'web.no-outbound', '没有可发送的消息：如实说');
  await close();
  ok((await health()).status === 'down', '关闭后 down');
  const after = await runTool('web_fetch', { url: 'https://x' });
  ok(!after.ok && after.error.code === 'adapter.not-started', '未启动：工具拒绝');
}

console.log('\n## 搜索未配置：明确报错');
{
  configure({ searchEndpoint: '', searchKey: '' });
  await open({ log: () => {} });
  const r = await runTool('web_search', { query: 'x' });
  ok(!r.ok && r.error.code === 'web.search-unconfigured', '没配端点：明确说没配');
  await close();
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
