/**
 * 模块 UI 声明测试（装包时一起收进来，不动 pack.json）
 * 跑法：node runtime/ui.test.mjs
 */
import { validateUi, collectUi } from './ui.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 校验：声明简单，坏声明整段丢弃');
{
  const good = validateUi({ menu: [{ id: 'one', title: '一', order: 10 }], pages: [{ id: 'one.a', title: '设置', kind: 'form', menu: 'one' }] });
  ok(good.ok && good.value.menu.length === 1 && good.value.pages.length === 1, '合格声明：收下');
  ok(good.value.pages[0].kind === 'form', '页面类型归一');

  ok(validateUi(undefined).ok === true, '没声明：算合格（空）');
  ok(validateUi('x').ok === false, '不是对象：不合格');
  ok(validateUi({ menu: [{ title: '没有 id' }] }).problems.length === 1, '缺 id：记问题');
  ok(validateUi({ pages: [{ id: 'p', title: 't', kind: '奇怪' }] }).value.pages[0].kind === 'form', '不认识的类型：退回 form');
  ok(validateUi({ menu: Array(30).fill({ id: 'a', title: 'b' }) }).problems.some((p) => p.includes('menu')), '菜单过多：记问题');
}

console.log('\n## 收集：按包分组，菜单按 order 排');
{
  const model = collectUi([
    { identity: { publisher: 'surfcore', name: 'one' }, ui: { menu: [{ id: 'one', title: '一', order: 20 }], pages: [{ id: 'one.gw', title: '导入网关', menu: 'one' }] } },
    { identity: { publisher: 'surfcore', name: 'alpha' }, ui: { menu: [{ id: 'alpha', title: '甲', order: 5 }] } },
    { identity: { publisher: 'surfcore', name: 'none' } },
  ]);
  ok(model.groups.length === 2, '只有声明了的包进模型');
  ok(model.groups[0].menu[0].order <= model.groups[1].menu[0].order, '按 order 排（5 在 20 前）');
  ok(model.total === 3, `总项数 3（实际 ${model.total}）`);
  ok(model.problems.length === 0, '没问题项');
}

console.log('\n## 坏声明：隔离到那个包，不拖垮别的');
{
  const model = collectUi([
    { identity: { publisher: 'x', name: 'bad' }, ui: 'not-an-object' },
    { identity: { publisher: 'x', name: 'good' }, ui: { menu: [{ id: 'g', title: '好' }] } },
  ]);
  ok(model.groups.length === 1, '好的仍然收下');
  ok(model.groups[0].id === 'x/good', '是好那个');
  ok(model.problems.length === 1 && model.problems[0].adapter === 'x/bad', '坏的有记录（能看出是谁）');
}

console.log('\n## 边界');
{
  ok(collectUi([]).total === 0, '空输入：空模型');
  ok(collectUi(null).groups.length === 0, 'null：不崩');
  const long = validateUi({ menu: [{ id: 'a', title: 'x'.repeat(100) }] });
  ok(long.value.menu[0].title.length <= 40, '标题限长（不把整段话塞进菜单）');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
