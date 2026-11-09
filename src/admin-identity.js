/**
 * 管理员身份（QQ ⇄ B站 同一个人）与「温柔 / 不许回嘴」规则。
 *
 * 为什么单独一层：
 *   · 用户要求：管理员的 QQ 号与 B站 UID **默认是同一个人**，QQ 和 B站 两个设置页
 *     改的是同一份身份，不能一边改了另一边还是旧号；
 *   · 提示词同时被 QQ 桥接（src/bridge.js）和 B站 生物钟（plugins/surfcore/lib/scheduler.js）
 *     使用，规则只写一份，避免两边口径漂移；
 *   · 全是纯函数，方便 scripts/test-admin-identity.mjs 单测（桥接主文件太大，
 *     不适合为了几个字符串跑集成测试）。
 *
 * 存储边界：
 *   · 合体层 ~/.dsh/surfcore/config.json 的 `admin` 是唯一真相；
 *   · 保存时由插件投影到 QQ `<仓库>/config.json` 的 `ownerQQ` 和
 *     B站 `~/.dsh/surfcore/bili.config.json` 的 `owner.mid / owner.name`
 *     （桥接和 B站 工具链只认这两份旧格式，投影只是落地，不是第二份真相）；
 *   · 读取时如果合体层还没有 `admin`，就从这两份旧值推导 —— 所以升级后第一次打开
 *     设置页就能看到「同一个人」，不会要求用户重新填一遍。
 */

/** QQ 号：5~12 位数字（现行 QQ 号长度范围，避免把群号/随机数字当管理员）。 */
export const ADMIN_QQ_RE = /^\d{5,12}$/;
/** B站 mid：4~20 位数字（历史 uid 短、新号在变长；用户反馈 15 位填不进去）。 */
export const ADMIN_MID_RE = /^\d{4,20}$/;

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);

function text(value, maxChars) {
  const out = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  return out.slice(0, maxChars);
}

/**
 * 把一个「管理员」对象收敛成固定结构。
 * 空串 / 非法值 = 未设置（''），绝不把非法号码写进配置。
 * @returns {{qq:string, biliMid:string, biliName:string, displayName:string, gentle:boolean}}
 */
export function normalizeAdmin(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const qq = String(source.qq ?? source.ownerQQ ?? '').trim();
  const mid = String(source.biliMid ?? source.mid ?? source.ownerMid ?? '').trim();
  const biliName = text(source.biliName ?? source.biliNameText ?? '', 40);
  const displayName = text(source.displayName ?? source.name ?? '', 24);
  return {
    qq: ADMIN_QQ_RE.test(qq) ? qq : '',
    biliMid: ADMIN_MID_RE.test(mid) ? mid : '',
    biliName,
    // 没填称呼就用 B站昵称：两个设置页和提示词里都显示同一个人。
    displayName: displayName || biliName,
    // 2026-11-01 用户定：新装/缺省默认关闭温柔模式（显式 true 才开）。
    gentle: source.gentle === true,
  };
}

/** 是否至少配置了一边的身份（决定提示词要不要注入）。 */
export function adminConfigured(admin) {
  const a = normalizeAdmin(admin);
  return Boolean(a.qq || a.biliMid || a.biliName);
}

/**
 * 从三份配置推导「当前生效的管理员」。
 * 合体层 admin 里**明确写了**的键优先（空串也算明确清空），没写的键回退旧格式。
 */
export function adminFromSources({ unified = {}, qq = {}, bili = {} } = {}) {
  const a = unified && typeof unified.admin === 'object' && unified.admin ? unified.admin : null;
  // QQ 侧已有 admin 投影、但 unified 还没写时，不能把 displayName 丢掉（升级/旧数据）。
  const qa = qq && typeof qq.admin === 'object' && qq.admin ? qq.admin : null;
  const source = a || qa;
  const biliOwner = bili && typeof bili.owner === 'object' && bili.owner ? bili.owner : {};
  return normalizeAdmin({
    qq: source && hasOwn(source, 'qq') ? source.qq : qq.ownerQQ,
    biliMid: source && hasOwn(source, 'biliMid') ? source.biliMid : biliOwner.mid,
    biliName: source && hasOwn(source, 'biliName') ? source.biliName : biliOwner.name,
    displayName: source && hasOwn(source, 'displayName') ? source.displayName : '',
    gentle: source && hasOwn(source, 'gentle') ? source.gentle : false,
  });
}

/** QQ 桥接侧：只读得到 config.json，用 ownerQQ 兜底。 */
export function adminFromQqConfig(cfg = {}) {
  return adminFromSources({ qq: cfg, bili: {}, unified: { admin: cfg.admin } });
}

/**
 * 保存时的冲突合并（纯函数，方便单测）。
 *
 * 优先级：
 *   1. 设置页「管理员」卡片（合体层 admin）显式改动 → 以它为准，同时投影到两边；
 *   2. 否则，高级参数里单独改了 qq.ownerQQ / bili.owner → 用那个值补 admin；
 *   3. 两个都改且互相矛盾 → 仍以管理员卡片为准，并回一条 warning 让人知道被覆盖。
 *
 * @param {object} input
 * @param {object} input.current 当前生效的管理员
 * @param {object|undefined} input.incomingAdmin 请求里的 unified.admin（没传=没改）
 * @param {string|undefined} input.incomingQqOwner 请求里的 qq.ownerQQ（undefined=没传）
 * @param {{mid?:string,name?:string}|undefined} input.incomingBiliOwner 请求里的 bili.owner
 * @returns {{admin:object, conflict:boolean}}
 */
export function resolveAdminUpdate({ current, incomingAdmin, incomingQqOwner, incomingBiliOwner } = {}) {
  const base = normalizeAdmin(current);
  const next = normalizeAdmin(incomingAdmin ?? {});
  const adminTouched = incomingAdmin != null && (
    next.qq !== base.qq
    || next.biliMid !== base.biliMid
    || next.biliName !== base.biliName
    || next.displayName !== base.displayName
    || next.gentle !== base.gentle
  );
  const qqValue = incomingQqOwner === undefined ? undefined : normalizeAdmin({ qq: incomingQqOwner }).qq;
  const qqTouched = qqValue !== undefined && qqValue !== base.qq;
  const biliMidValue = incomingBiliOwner === undefined ? undefined : normalizeAdmin({ biliMid: incomingBiliOwner?.mid }).biliMid;
  const biliNameValue = incomingBiliOwner === undefined ? undefined : text(incomingBiliOwner?.name ?? '', 40);
  const biliTouched = incomingBiliOwner !== undefined
    && (biliMidValue !== base.biliMid || biliNameValue !== base.biliName);

  const admin = { ...base };
  let conflict = false;
  if (adminTouched) {
    Object.assign(admin, next);
    conflict = qqTouched || biliTouched;
  } else {
    if (qqTouched) admin.qq = qqValue;
    if (biliTouched) {
      admin.biliMid = biliMidValue;
      admin.biliName = biliNameValue;
    }
  }
  return { admin, conflict };
}

/**
 * 保存计划的纯函数版本：把「管理员卡片 / 高级参数」合并成三份要保存的对象。
 * 宿主 index.js 的 handleConfig 直接用它，测试也用它 —— 保证测的就是线上那条路径。
 *
 * 返回里 qq/bili/unified 为 undefined 表示"这份没变、不用写"；
 * 只要传了那份对象（设置页每次都会传全量），就把它原样带回并投影管理员。
 * @param {{current:object, qq?:object, bili?:object, unified?:object}} input
 */
export function projectAdminSave({ current, qq, bili, unified } = {}) {
  const { admin, conflict } = resolveAdminUpdate({
    current,
    incomingAdmin: unified && typeof unified === 'object' && hasOwn(unified, 'admin') ? unified.admin : undefined,
    incomingQqOwner: qq && typeof qq === 'object' && hasOwn(qq, 'ownerQQ') ? qq.ownerQQ : undefined,
    incomingBiliOwner: bili && typeof bili === 'object' && hasOwn(bili, 'owner') ? bili.owner : undefined,
  });
  const base = normalizeAdmin(current);
  const qqChanged = admin.qq !== base.qq;
  const biliChanged = admin.biliMid !== base.biliMid || admin.biliName !== base.biliName;
  const unifiedChanged = JSON.stringify(admin) !== JSON.stringify(base);
  // QQ 桥接是独立进程，只读 config.json；displayName / biliName / gentle 必须一起投影，
  // 否则设置页写的是 unified，桥接永远只能拿到 ownerQQ（2026-10-29 用户反馈）。
  const qqAdmin = { ...admin };
  const outQq = qq && typeof qq === 'object'
    ? { ...qq, ownerQQ: admin.qq || null, admin: qqAdmin }
    : ((qqChanged || unifiedChanged) ? { ownerQQ: admin.qq || null, admin: qqAdmin } : undefined);
  const outBili = bili && typeof bili === 'object'
    ? { ...bili, owner: { ...(bili.owner ?? {}), mid: admin.biliMid, name: admin.biliName } }
    : (biliChanged ? { owner: { mid: admin.biliMid, name: admin.biliName } } : undefined);
  const outUnified = unified && typeof unified === 'object'
    ? { ...unified, admin }
    : (unifiedChanged ? { admin } : undefined);
  return { admin, conflict, qq: outQq, bili: outBili, unified: outUnified, changed: unifiedChanged };
}

/** 提示词里怎么称呼管理员：称呼 > B站昵称 > 空（空 = 不把“管理员”当名字）。 */
export function adminDisplayName(admin) {
  const a = normalizeAdmin(admin);
  return a.displayName || a.biliName || '';
}

/** 管理员消息的标记：开启「管理员模式」时更醒目，方便模型在长上下文里一眼看到。 */
export function adminMarker(admin) {
  const a = normalizeAdmin(admin);
  return a.gentle && adminConfigured(a) ? '【管理员】' : '';
}

/**
 * 生成给模型看的「管理员」提示块。
 *
 * 2026-11-09 用户要求：关系要平等，不做主仆/情侣化。
 * 所以这里只描述**权限事实**（谁能审批/发命令），不写「主人」「撒娇」「乖乖照做」「更黏更乖」；
 * 语气仍然按人格卡走，管理员身份不改变人格与边界。
 *
 * @param {'qq'|'bili'} platform
 * @param {object} admin
 * @param {{compact?:boolean}} [options]
 * @returns {string} 未配置管理员、或未开启管理员模式时返回空串（不占提示词预算）
 */
export function adminPromptBlock(platform, admin, options = {}) {
  const a = normalizeAdmin(admin);
  if (!adminConfigured(a)) return '';
  // 关闭「管理员模式」= 不注入任何管理员专属提示词（不是只删语气规则）。
  if (!a.gentle) return '';
  const name = adminDisplayName(a);
  const whoQt = name ? `${name}（这台机器的操作者）` : '这台机器的操作者';
  const compact = options.compact === true;

  if (platform === 'bili') {
    const who = `${a.biliName ? `B站「${a.biliName}」` : '这个 B站 账号'}${a.biliMid ? `（mid ${a.biliMid}）` : ''}`;
    if (compact) {
      return `【管理员】${who} 是这台机器的操作者；带标记的消息按权限处理审批/命令，语气照人格卡，不用讨好、不用撒娇。`;
    }
    return [
      '【管理员模式（只影响权限处理，不改变人格）】',
      `- 管理员是${who}，也是这台机器的操作者${name ? `（${name}）` : ''}。`,
      '- 带【管理员】标记的消息：优先处理审批/命令/待答问题；按正常语气回复，不用讨好、不用撒娇、不用认错。',
      '- 涉及隐私、安全、代发敏感内容：照规则拒绝；做不到就直接说，不用低姿态。',
      '- 对其他人照旧按人格卡。',
    ].join('\n');
  }

  const ids = [
    a.qq ? `QQ ${a.qq}` : '',
    a.biliMid ? `B站「${a.biliName || name}」（mid ${a.biliMid}）` : '',
  ].filter(Boolean).join('；');
  const who = ids ? `${whoQt}；${ids} —— 两边是同一个人` : whoQt;
  if (compact) {
    return `【管理员】${who}。带标记的消息按权限处理审批/命令；语气照人格卡，不用讨好、不用撒娇、不用认错。`;
  }
  return [
    '【管理员模式（只影响权限处理，不改变人格）】',
    `- 管理员是${who}，也是你认识的人。`,
    '- 带【管理员】标记的消息：优先处理审批/命令/待答问题；按正常语气回复，不用讨好、不用撒娇、不用认错。',
    '- 涉及隐私、安全、代发敏感内容：照规则拒绝；做不到就直接说，不用低姿态。',
    '- 对群里其他人照旧按人格卡；管理员身份不改变你的性格和边界。',
  ].join('\n');
}

/** 给控制台/诊断看的摘要（不含任何额外隐私）。 */
export function adminSummary(admin) {
  const a = normalizeAdmin(admin);
  return {
    configured: adminConfigured(a),
    qq: a.qq,
    biliMid: a.biliMid,
    biliName: a.biliName,
    displayName: a.displayName,
    gentle: a.gentle,
    aligned: Boolean(a.qq && a.biliMid),
  };
}
