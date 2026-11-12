/**
 * 模块的 UI 声明：装包时一起收进来
 * ============================================================================
 * 位置：大适配器（runtime）。装包是它的活，把"这个包想长什么样"收进来也是它的活。
 *
 * 为什么不用 pack.json 加字段：那样等于改**清单契约**；
 * 这里改成"包**导出** ui（和 settings/capabilities 同一个机制）"——只是模块内容。
 *
 * 声明形状（故意很简单，避免"复杂字段当公约"）：
 *   { menu: [{ id, title, order? }], pages: [{ id, title, kind?:'form'|'list', menu? }] }
 * 真正的渲染在 UI 层（现在还没有）；这里只负责**收集 + 校验 + 归一**。
 */

const MAX_MENU = 20;
const MAX_PAGES = 40;

/** 校验一个包的 ui 声明；不合格的**整段丢弃并给出原因**（不半信半疑地渲染） */
export function validateUi(ui) {
  const problems = [];
  if (ui === undefined || ui === null) return { ok: true, value: { menu: [], pages: [] }, problems };
  if (typeof ui !== 'object' || Array.isArray(ui)) return { ok: false, value: { menu: [], pages: [] }, problems: ['ui 必须是对象'] };

  const menu = Array.isArray(ui.menu) ? ui.menu : [];
  const pages = Array.isArray(ui.pages) ? ui.pages : [];
  if (menu.length > MAX_MENU) problems.push(`menu 超过 ${MAX_MENU} 项`);
  if (pages.length > MAX_PAGES) problems.push(`pages 超过 ${MAX_PAGES} 页`);

  const cleanMenu = [];
  for (const item of menu) {
    if (!item?.id || !item?.title) { problems.push('menu 项缺 id 或 title'); continue; }
    cleanMenu.push({
      id: String(item.id),
      title: String(item.title).slice(0, 40),
      order: Number.isFinite(Number(item.order)) ? Number(item.order) : 100,
    });
  }

  const cleanPages = [];
  for (const page of pages) {
    if (!page?.id || !page?.title) { problems.push('page 缺 id 或 title'); continue; }
    const kind = page.kind === 'list' ? 'list' : 'form';
    cleanPages.push({
      id: String(page.id),
      title: String(page.title).slice(0, 40),
      kind,
      menu: page.menu ? String(page.menu) : null,
    });
  }

  return { ok: problems.length === 0, value: { menu: cleanMenu.sort((a, b) => a.order - b.order), pages: cleanPages }, problems };
}

/**
 * 从"已加载的包"里收 UI：返回 { groups:[{id, title, menu, pages, problems}], problems }
 * @param {Array} packs [{ identity, ui }]
 */
export function collectUi(packs = []) {
  const groups = [];
  const problems = [];

  for (const pack of Array.isArray(packs) ? packs : []) {
    const id = `${pack?.identity?.publisher ?? '?'}/${pack?.identity?.name ?? '?'}`;
    const v = validateUi(pack?.ui);
    if (!v.ok) problems.push({ adapter: id, errors: v.problems });
    if (!v.value.menu.length && !v.value.pages.length) continue;
    groups.push({
      id,
      title: String(pack?.identity?.name ?? id),
      menu: v.value.menu,
      pages: v.value.pages,
    });
  }

  // 分组顺序：按各组菜单的最小 order（没有菜单的排最后）
  groups.sort((a, b) => (a.menu[0]?.order ?? 999) - (b.menu[0]?.order ?? 999));

  return { groups, problems, total: groups.reduce((n, g) => n + g.menu.length + g.pages.length, 0) };
}
