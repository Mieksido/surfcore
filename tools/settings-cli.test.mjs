/**
 * 设置命令行测试（真内核，不启动世界）
 * 跑法：node app/settings-cli.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createKernel } from '../kernel/index.js';
import { KERNEL_IDENTITY, KERNEL_SETTINGS } from '../kernel/settings/limits.js';
import { formatSettings, findField, setSetting, exportText, importText } from './settings-cli.mjs';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const QQI = { publisher: 'surfcore', name: 'qq' };
const QQ_SETTINGS = [
  { key: 'wsUrl', label: 'ws', type: 'text', defaultValue: '', maxChars: 200, cost: '不填就收不到', group: 'basic' },
  { key: 'maxChars', label: '字数', defaultValue: 500, options: [200, 500], cost: '太长刷屏', group: 'advanced' },
];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'surfcore-set-'));

const mk = (dir) => createKernel({
  stateDir: dir, now: () => 1000, persona: { name: 'T', core: 'c' }, admin: 'o',
  packs: [
    { identity: KERNEL_IDENTITY, settings: KERNEL_SETTINGS },
    { identity: QQI, settings: QQ_SETTINGS },
  ],
});

console.log('## 看：排版可读、改过的标 *');
{
  const dir = tmp();
  const k = mk(dir);
  const text = formatSettings(k.settings.model());
  ok(text.includes('【kernel】') || text.includes('【runtime】') || text.includes('【qq】'), '按组列出');
  ok(text.includes('wsUrl'), '列出键名');
  ok(!text.includes(' *'), '全是默认值：没有星号');
  k.settings.set('surfcore/qq', 'wsUrl', 'ws://x');
  ok(formatSettings(k.settings.model()).includes('*'), '改过的项标星号');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 改：只认表里的组与键');
{
  const dir = tmp();
  const k = mk(dir);
  ok(!findField(k.settings.model(), 'surfcore/不存在', 'wsUrl').ok, '不存在的组：拒绝');
  ok(!findField(k.settings.model(), 'surfcore/qq', '不存在').ok, '不存在的键：拒绝');

  const r = setSetting({ kernel: k, group: 'surfcore/qq', key: 'wsUrl', value: '  ws://127.0.0.1:3001/  ' });
  ok(r.ok === true, '合法值：改成功');
  ok(r.value === 'ws://127.0.0.1:3001/', '按内核规则去空白');
  ok(r.saved === true && typeof r.savedPath === 'string', '**改完立刻落盘**（拿到文件路径）');

  const bad = setSetting({ kernel: k, group: 'surfcore/qq', key: 'maxChars', value: 999 });
  ok(bad.ok === false && bad.error.code === 'setting.invalid', '不在选项里：拒绝');
  ok(k.settings.values()['surfcore/qq'].maxChars === undefined, '被拒绝的值没写进去');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 落盘：重启后设置还在');
{
  const dir = tmp();
  const k = mk(dir);
  setSetting({ kernel: k, group: 'surfcore/qq', key: 'wsUrl', value: 'ws://a' });
  setSetting({ kernel: k, group: KERNEL_IDENTITY.publisher + '/' + KERNEL_IDENTITY.name, key: 'memory.maxRecords', value: 200 });

  const k2 = mk(dir);
  k2.load();
  ok(k2.settings.values()['surfcore/qq'].wsUrl === 'ws://a', 'wsUrl 恢复');
  ok(k2.memory.configure().maxRecords === 200, '内核阈值也恢复，并立即生效');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\n## 导出/导入：能带走');
{
  const dir = tmp();
  const k = mk(dir);
  setSetting({ kernel: k, group: 'surfcore/qq', key: 'wsUrl', value: 'ws://b' });
  const text = exportText(k);
  ok(JSON.parse(text).values['surfcore/qq'].wsUrl === 'ws://b', '导出含设置值');

  const k2 = mk(tmp());
  const r = importText(k2, text);
  ok(r.ok === true, '导入成功');
  ok(k2.settings.values()['surfcore/qq'].wsUrl === 'ws://b', '导入后值对上');
  ok(importText(k2, '{坏的').error.code === 'settings.bad-json', '坏 JSON：明确报错');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
