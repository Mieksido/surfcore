/**
 * QQ 空间说说发布的纯逻辑（不碰网络 / 文件 / 进程）。
 *
 * 背景（2026-10-30）：SnowLuma v2.2.1 已经提供 OneBot 扩展动作 `send_qzone_msg`
 * （content / images / ugc_right / target_uins，返回 { tid, time }），
 * 但「发说说」是**对外公开**的动作，和发群消息不是一个量级的风险：
 * 发出去就收不回、可能被朋友/陌生人看到、还可能把本机路径或凭据带上公网。
 *
 * 所以这里只做一件事：把「这次到底能不能发」判清楚，并且**默认关闭**。
 * 判定顺序就是风险从大到小：总开关 → 内容 → 敏感信息 → 图片 → 权限 → 频率。
 *
 * 纯函数：所有输入（配置、历史记录、当前时间、当天零点）都由调用方传入，
 * 这样桥接和测试用的是同一套判据（scripts/test-qzone-post.mjs 钉住失败分支）。
 */

/** SnowLuma 的 ugc_right 取值（来自其 send_qzone_msg 的 schema）。 */
export const QZONE_UGC_RIGHTS = Object.freeze({
  1: '所有人可见',
  4: '好友可见',
  16: '部分好友可见',
  64: '仅自己可见',
  128: '部分好友不可见',
});

export const QZONE_UGC_VALUES = Object.freeze(Object.keys(QZONE_UGC_RIGHTS).map(Number));

/** 默认配置：关闭、只发文字、好友可见、每天最多 2 条、两条至少隔 6 小时。 */
export const DEFAULT_QZONE = Object.freeze({
  enabled: false,
  ugcRight: 4,
  targetUins: [],
  allowImages: false,
  allowLocalImages: false,
  maxImages: 3,
  maxChars: 500,
  maxPerDay: 2,
  minGapMs: 6 * 60 * 60 * 1000,
  dryRun: false,
});

const toInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
};

const toBool = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true;
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

/** 互动（点赞/评论）默认值：全部关闭，开了也限额。 */
export const DEFAULT_QZONE_INTERACT = Object.freeze({
  enabled: false,
  maxLikesPerDay: 20,
  maxCommentsPerDay: 5,
  minCommentGapMs: 2 * 60 * 1000,
  maxCommentChars: 100,
  // owner-and-mine = 只允许评论主人和自己的说说；any = 允许评论好友动态里的任何一条。
  commentScope: 'owner-and-mine',
});

/** 轮询（被评论/@、主人发新说说）默认值：关闭；开了也只负责"叫醒"，不自动发。 */
export const DEFAULT_QZONE_WATCH = Object.freeze({
  enabled: false,
  pollMs: 10 * 60 * 1000,
  myPostCount: 5,
  commentPageSize: 20,
  replyComments: true,
  commentOnOwnerPosts: false,
  ownerPostMode: 'suggest',
  maxWakesPerDay: 6,
});

export const QZONE_COMMENT_SCOPES = Object.freeze(['owner-and-mine', 'any']);
export const QZONE_OWNER_MODES = Object.freeze(['suggest', 'direct']);

export function normalizeQzoneInteract(raw = {}) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const scope = QZONE_COMMENT_SCOPES.includes(String(q.commentScope)) ? String(q.commentScope) : DEFAULT_QZONE_INTERACT.commentScope;
  return {
    enabled: toBool(q.enabled, DEFAULT_QZONE_INTERACT.enabled),
    maxLikesPerDay: clamp(toInt(q.maxLikesPerDay, DEFAULT_QZONE_INTERACT.maxLikesPerDay), 0, 200),
    maxCommentsPerDay: clamp(toInt(q.maxCommentsPerDay, DEFAULT_QZONE_INTERACT.maxCommentsPerDay), 0, 50),
    minCommentGapMs: clamp(toInt(q.minCommentGapMs, DEFAULT_QZONE_INTERACT.minCommentGapMs), 0, 24 * 60 * 60 * 1000),
    maxCommentChars: clamp(toInt(q.maxCommentChars, DEFAULT_QZONE_INTERACT.maxCommentChars), 1, 500),
    commentScope: scope,
  };
}

export function normalizeQzoneWatch(raw = {}) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const mode = QZONE_OWNER_MODES.includes(String(q.ownerPostMode)) ? String(q.ownerPostMode) : DEFAULT_QZONE_WATCH.ownerPostMode;
  return {
    enabled: toBool(q.enabled, DEFAULT_QZONE_WATCH.enabled),
    pollMs: clamp(toInt(q.pollMs, DEFAULT_QZONE_WATCH.pollMs), 60 * 1000, 6 * 60 * 60 * 1000),
    myPostCount: clamp(toInt(q.myPostCount, DEFAULT_QZONE_WATCH.myPostCount), 1, 20),
    commentPageSize: clamp(toInt(q.commentPageSize, DEFAULT_QZONE_WATCH.commentPageSize), 1, 100),
    replyComments: toBool(q.replyComments, DEFAULT_QZONE_WATCH.replyComments),
    commentOnOwnerPosts: toBool(q.commentOnOwnerPosts, DEFAULT_QZONE_WATCH.commentOnOwnerPosts),
    ownerPostMode: mode,
    maxWakesPerDay: clamp(toInt(q.maxWakesPerDay, DEFAULT_QZONE_WATCH.maxWakesPerDay), 0, 50),
  };
}

/** 配置归一化：坏值一律回落到安全默认值，不抛错、不把字符串塞进布尔位。 */
export function normalizeQzoneConfig(raw = {}) {
  const q = raw && typeof raw === 'object' ? raw : {};
  const ugcRight = QZONE_UGC_VALUES.includes(toInt(q.ugcRight, NaN)) ? toInt(q.ugcRight, 4) : 4;
  const targets = Array.isArray(q.targetUins)
    ? [...new Set(q.targetUins.map((v) => toInt(v, 0)).filter((v) => Number.isInteger(v) && v > 0))]
    : [];
  return {
    enabled: toBool(q.enabled, DEFAULT_QZONE.enabled),
    ugcRight,
    targetUins: targets.slice(0, 50),
    allowImages: toBool(q.allowImages, DEFAULT_QZONE.allowImages),
    // 允许发本机 file:// 图片是「把本机文件传到公网」的同义词，默认必须关。
    allowLocalImages: toBool(q.allowLocalImages, DEFAULT_QZONE.allowLocalImages),
    maxImages: clamp(toInt(q.maxImages, DEFAULT_QZONE.maxImages), 1, 9),
    maxChars: clamp(toInt(q.maxChars, DEFAULT_QZONE.maxChars), 1, 2000),
    maxPerDay: clamp(toInt(q.maxPerDay, DEFAULT_QZONE.maxPerDay), 0, 20),
    minGapMs: clamp(toInt(q.minGapMs, DEFAULT_QZONE.minGapMs), 0, 7 * 24 * 60 * 60 * 1000),
    dryRun: toBool(q.dryRun, DEFAULT_QZONE.dryRun),
    interact: normalizeQzoneInteract(q.interact),
    watch: normalizeQzoneWatch(q.watch),
  };
}

const IMAGE_SCHEME = /^(?:https?:\/\/|base64:\/\/|file:\/\/)/i;

const fail = (code, error, hint) => ({ ok: false, code, error, hint });

/** 今天已经发了几条（posts 里每条是 { at, tid, ... }）。 */
export function countQzonePostsSince(posts = [], since = 0) {
  return (Array.isArray(posts) ? posts : []).filter((p) => Number(p?.at) >= Number(since || 0)).length;
}

/** 最近一条说说的发布时间；没有就 0。 */
export function lastQzonePostAt(posts = []) {
  return (Array.isArray(posts) ? posts : []).reduce((max, p) => Math.max(max, Number(p?.at) || 0), 0);
}

/**
 * 判断这条说说能不能发。
 *
 * @param {{content?:string, images?:string[]}} input 模型给的原始参数（不含权限/频率，那些只认配置）
 * @param {{config?:object, posts?:object[], now?:number, dayStart?:number, sensitiveRe?:RegExp}} ctx
 * @returns {{ok:true, value:{content:string, images:string[], ugcRight:number, targetUins:number[], dryRun:boolean, dayCount:number, maxPerDay:number}}
 *          | {ok:false, code:string, error:string, hint:string}}
 */
export function validateQzonePost(input = {}, {
  config = {}, posts = [], now = Date.now(), dayStart = 0, sensitiveRe = null,
} = {}) {
  const c = normalizeQzoneConfig(config);
  if (!c.enabled) {
    return fail(
      'QZONE_DISABLED',
      'QQ 空间说说未启用（默认关闭）',
      '设置 → SurfCore → QQ → 高级 →「QQ 空间（说说）」打开「启用说说发布」，保存后重启桥接/DSH',
    );
  }

  const content = String(input?.content ?? '').replace(/\r\n/g, '\n').trim();
  if (!content) {
    return fail('QZONE_EMPTY', '说说正文不能为空', '把要说的话放进 content（纯文本）');
  }
  if (content.length > c.maxChars) {
    return fail(
      'QZONE_TOO_LONG',
      `说说最多 ${c.maxChars} 字，当前 ${content.length} 字`,
      '先删减或总结；不要为了凑字数拆成多条（空间里连着刷更难看）',
    );
  }
  if (sensitiveRe instanceof RegExp && sensitiveRe.test(content)) {
    return fail(
      'QZONE_SENSITIVE',
      '内容里有本机路径或凭据特征，已阻止发布到 QQ 空间',
      '删掉路径、token、密码、密钥之类的内容再发——空间是公开的，发出去就收不回',
    );
  }

  let images = Array.isArray(input?.images)
    ? input.images.map((v) => String(v ?? '').trim()).filter(Boolean)
    : [];
  images = [...new Set(images)];
  if (images.length) {
    if (!c.allowImages) {
      return fail(
        'QZONE_IMAGES_DISABLED',
        '当前配置不允许带图',
        '设置里打开「允许带图」；默认只允许发纯文字',
      );
    }
    if (images.length > c.maxImages) {
      return fail('QZONE_IMAGE_TOO_MANY', `最多带 ${c.maxImages} 张图，当前 ${images.length} 张`, '挑最有用的几张');
    }
    for (const image of images) {
      if (!IMAGE_SCHEME.test(image)) {
        return fail(
          'QZONE_IMAGE_SCHEME',
          `不认识的图片地址：${image.slice(0, 40)}`,
          '只接受 http(s)://、base64://、file:// 三种；或者干脆不带图',
        );
      }
      if (/^file:\/\//i.test(image) && !c.allowLocalImages) {
        return fail(
          'QZONE_LOCAL_IMAGE_DISABLED',
          '不允许把本机文件发到 QQ 空间',
          '改用 http(s) 图片链接；确实要发本机图片时，先明确打开「允许本机图片」',
        );
      }
    }
  }

  if (!QZONE_UGC_VALUES.includes(c.ugcRight)) {
    return fail('QZONE_BAD_RIGHT', `查看权限取值不合法：${c.ugcRight}`, `可选 ${QZONE_UGC_VALUES.join(' / ')}`);
  }
  if ((c.ugcRight === 16 || c.ugcRight === 128) && !c.targetUins.length) {
    return fail(
      'QZONE_TARGET_REQUIRED',
      `查看权限是「${QZONE_UGC_RIGHTS[c.ugcRight]}」，但没填名单`,
      '设置里补「权限名单 QQ」，或把权限改成 1/4/64',
    );
  }

  const dayCount = countQzonePostsSince(posts, dayStart);
  if (c.maxPerDay > 0 && dayCount >= c.maxPerDay) {
    return fail(
      'QZONE_DAILY_LIMIT',
      `今天已经发过 ${dayCount} 条（上限 ${c.maxPerDay}）`,
      '明天再说；真需要多发就调高「每天最多几条」，但不建议——频繁发说说容易被风控',
    );
  }
  const lastAt = lastQzonePostAt(posts);
  if (c.minGapMs > 0 && lastAt > 0 && now - lastAt < c.minGapMs) {
    const waitMin = Math.ceil((c.minGapMs - (now - lastAt)) / 60000);
    return fail(
      'QZONE_TOO_SOON',
      `距离上一条说说还不满 ${Math.round(c.minGapMs / 60000)} 分钟（还要等约 ${waitMin} 分钟）`,
      '再等等；空间不是聊天窗口，不需要连着发',
    );
  }

  return {
    ok: true,
    value: {
      content,
      images,
      ugcRight: c.ugcRight,
      targetUins: c.targetUins,
      dryRun: c.dryRun,
      dayCount,
      maxPerDay: c.maxPerDay,
    },
  };
}

/**
 * 给状态接口/体检用的摘要。
 * remaining 为 null 表示不限次数。
 */
export function summarizeQzoneState({ config = {}, posts = [], now = Date.now(), dayStart = 0 } = {}) {
  const c = normalizeQzoneConfig(config);
  const dayCount = countQzonePostsSince(posts, dayStart);
  const lastAt = lastQzonePostAt(posts);
  const gapLeft = c.minGapMs > 0 && lastAt > 0 ? Math.max(0, c.minGapMs - (now - lastAt)) : 0;
  return {
    enabled: c.enabled,
    dryRun: c.dryRun,
    ugcRight: c.ugcRight,
    ugcLabel: QZONE_UGC_RIGHTS[c.ugcRight] ?? String(c.ugcRight),
    allowImages: c.allowImages,
    allowLocalImages: c.allowLocalImages,
    maxChars: c.maxChars,
    maxPerDay: c.maxPerDay,
    minGapMs: c.minGapMs,
    postedToday: dayCount,
    remaining: c.maxPerDay > 0 ? Math.max(0, c.maxPerDay - dayCount) : null,
    lastAt,
    retryAfterMs: gapLeft,
  };
}

/** 组装 SnowLuma send_qzone_msg 的参数（把「可选」字段真的省略，而不是塞 null）。 */
export function buildQzoneActionParams(value = {}) {
  const params = {
    content: String(value.content ?? ''),
    ugc_right: Number(value.ugcRight) || 4,
  };
  if (Array.isArray(value.images) && value.images.length) params.images = value.images.map(String);
  // target_uins 只在 16 / 128 时有意义；其它权限带上会被 SnowLuma 的规则当成多余参数。
  if ((params.ugc_right === 16 || params.ugc_right === 128) && Array.isArray(value.targetUins) && value.targetUins.length) {
    params.target_uins = value.targetUins.map(Number);
  }
  return params;
}

// ── 互动（点赞 / 评论）──────────────────────────────────────────────────
//
// 和「发说说」不同的风险：评论会直接出现在别人的空间里，而且可能被回怼。
// 所以这里多两道：一是独立开关（interact.enabled，默认关），二是默认只允许
// 评论「主人和自己的说说」（commentScope=owner-and-mine），不碰陌生人的动态。

/**
 * 今天已经做过几次互动。
 * likes 存的是时间戳数组（数字），comments 存的是 { at, ... } 对象，两种都要认。
 */
export function countQzoneInteractionsSince(list = [], since = 0) {
  const at = (x) => Number(typeof x === 'object' && x !== null ? x.at : x);
  return (Array.isArray(list) ? list : []).filter((x) => Number.isFinite(at(x)) && at(x) >= Number(since || 0)).length;
}

/**
 * 判断这次点赞/评论能不能发。
 *
 * @param {{kind?:'like'|'comment', tid?:string, targetUin?:number, content?:string, like?:boolean,
 *          commentId?:string, commentUin?:number, replyUin?:number, replyName?:string}} input
 * @param {{config?:object, interactions?:{likes?:number[],comments?:object[]}, now?:number, dayStart?:number,
 *          sensitiveRe?:RegExp, ownerUin?:string, selfUin?:string, myTids?:string[]}} ctx
 */
export function validateQzoneInteraction(input = {}, {
  config = {}, interactions = {}, now = Date.now(), dayStart = 0,
  sensitiveRe = null, ownerUin = '', selfUin = '', myTids = [],
} = {}) {
  const c = normalizeQzoneConfig(config);
  if (!c.enabled) {
    return fail('QZONE_DISABLED', 'QQ 空间未启用（默认关闭）', '设置 → QQ → 高级 →「QQ 空间（说说）」先打开总开关');
  }
  const it = c.interact;
  if (!it.enabled) {
    return fail(
      'QZONE_INTERACT_DISABLED',
      'QQ 空间互动（点赞/评论）未启用',
      '设置 → QQ → 高级 →「QQ 空间（说说）」→ 打开「允许点赞与评论」',
    );
  }
  const kind = String(input.kind ?? '').trim();
  if (kind !== 'like' && kind !== 'comment') {
    return fail('QZONE_BAD_KIND', `不认识的动作：${kind || '(空)'}`, '只支持 like / comment');
  }
  const tid = String(input.tid ?? '').trim();
  if (!tid) return fail('QZONE_TID_REQUIRED', '缺少 tid（说说编号）', '先用 qq_qzone_posts / qq_qzone_feeds 拿到 tid');
  const targetUin = toInt(input.targetUin, 0);
  const likes = Array.isArray(interactions?.likes) ? interactions.likes : [];
  const comments = Array.isArray(interactions?.comments) ? interactions.comments : [];

  if (kind === 'like') {
    const used = countQzoneInteractionsSince(likes, dayStart);
    if (it.maxLikesPerDay > 0 && used >= it.maxLikesPerDay) {
      return fail('QZONE_LIKE_LIMIT', `今天已经点过 ${used} 个赞（上限 ${it.maxLikesPerDay}）`, '明天再点；别把人家的空间刷成一片赞');
    }
    return {
      ok: true,
      value: { kind, tid, targetUin, like: input.like !== false, params: { tid, ...(targetUin ? { target_uin: targetUin } : {}) } },
    };
  }

  const content = String(input.content ?? '').trim();
  if (!content) return fail('QZONE_COMMENT_EMPTY', '评论内容不能为空', '写一句真想说的大白话');
  if (content.length > it.maxCommentChars) {
    return fail('QZONE_COMMENT_TOO_LONG', `评论最多 ${it.maxCommentChars} 字（当前 ${content.length} 字）`, '短一点，空间评论不是写作文');
  }
  if (sensitiveRe instanceof RegExp && sensitiveRe.test(content)) {
    return fail('QZONE_COMMENT_SENSITIVE', '评论里有本机路径或凭据特征，已阻止', '删掉路径/token/密码再发');
  }

  // 评论范围：默认只允许评论主人和自己的说说，避免 AI 跑去陌生人的动态下面说话。
  // 「自己的」有两种写法：tid 在我们发布记录里（myTids），或者 targetUin 省略/等于自己
  // ——SnowLuma 对省略 target_uin 的处理就是「机器人自己」，老说说不在记录里也算自己的。
  const asNumber = (v) => toInt(v, 0);
  const owner = asNumber(ownerUin);
  const self = asNumber(selfUin);
  const mine = new Set((Array.isArray(myTids) ? myTids : []).map(String));
  const isOwnerPost = owner > 0 && targetUin === owner;
  const isMyPost = mine.has(tid);
  const isSelf = targetUin === 0 || (self > 0 && targetUin === self);
  if (it.commentScope === 'owner-and-mine' && !isOwnerPost && !isMyPost && !isSelf) {
    return fail(
      'QZONE_COMMENT_SCOPE',
      '当前设置只允许评论「主人或自己」的说说',
      '把 commentScope 改成 any 才允许评论陌生人；不建议，容易被当成机器人',
    );
  }

  // 同一条说说（主人的）不重复发顶层评论；回复楼中楼不受此限。
  const isReply = input.commentId !== undefined && input.commentId !== null && String(input.commentId) !== '';
  if (!isReply && isOwnerPost && comments.some((x) => String(x?.tid) === tid && Number(x?.targetUin) === owner && !x?.commentId)) {
    return fail('QZONE_ALREADY_COMMENTED', '这条说说你已经评论过了', '想补充就回复那条评论（带 commentId），别再发一条新的');
  }

  const usedComments = countQzoneInteractionsSince(comments, dayStart);
  if (it.maxCommentsPerDay > 0 && usedComments >= it.maxCommentsPerDay) {
    return fail('QZONE_COMMENT_LIMIT', `今天已经评论过 ${usedComments} 条（上限 ${it.maxCommentsPerDay}）`, '明天再说');
  }
  const lastAt = comments.reduce((m, x) => Math.max(m, Number(x?.at) || 0), 0);
  if (it.minCommentGapMs > 0 && lastAt > 0 && now - lastAt < it.minCommentGapMs) {
    const waitSec = Math.ceil((it.minCommentGapMs - (now - lastAt)) / 1000);
    return fail('QZONE_COMMENT_TOO_SOON', `距上一条评论还不到 ${Math.round(it.minCommentGapMs / 1000)} 秒（还要等约 ${waitSec} 秒）`, '再等等');
  }

  return {
    ok: true,
    value: {
      kind,
      tid,
      targetUin,
      content,
      params: buildQzoneCommentParams({ ...input, tid, targetUin, content }),
    },
  };
}

/** 组装 comment_qzone 的参数：只有真的回复楼中楼时才带 comment_id / reply_*。 */
export function buildQzoneCommentParams(input = {}) {
  const params = { tid: String(input.tid ?? ''), content: String(input.content ?? '') };
  const targetUin = toInt(input.targetUin, 0);
  if (targetUin > 0) params.target_uin = targetUin;
  const commentId = input.commentId === undefined || input.commentId === null ? '' : String(input.commentId);
  if (commentId !== '') {
    params.comment_id = commentId;
    const commentUin = toInt(input.commentUin, 0);
    if (commentUin > 0) params.comment_uin = commentUin;
  }
  const replyUin = toInt(input.replyUin, 0);
  if (replyUin > 0) {
    params.reply_uin = replyUin;
    if (input.replyName) params.reply_name = String(input.replyName);
  }
  return params;
}

/** 点赞/评论的今日摘要（给设置页/状态接口）。 */
export function summarizeQzoneInteract({ config = {}, interactions = {}, now = Date.now(), dayStart = 0 } = {}) {
  const it = normalizeQzoneConfig(config).interact;
  const likesUsed = countQzoneInteractionsSince(interactions?.likes, dayStart);
  const commentsUsed = countQzoneInteractionsSince(interactions?.comments, dayStart);
  return {
    enabled: it.enabled,
    commentScope: it.commentScope,
    maxLikesPerDay: it.maxLikesPerDay,
    maxCommentsPerDay: it.maxCommentsPerDay,
    likesToday: likesUsed,
    commentsToday: commentsUsed,
    likesRemaining: it.maxLikesPerDay > 0 ? Math.max(0, it.maxLikesPerDay - likesUsed) : null,
    commentsRemaining: it.maxCommentsPerDay > 0 ? Math.max(0, it.maxCommentsPerDay - commentsUsed) : null,
  };
}

// ── 轮询事件（被评论 / 主人发新说说）────────────────────────────────────
// 桥接每 pollMs 拉一次，命中新东西就"叫醒"AI；发不发、怎么回，仍然由 AI 用
// qq_qzone_comment / qq_qzone_like 自己决定（桥接不替它发）。

const clip = (value, max) => {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

/** 把事件格式化成唤醒提示里的几行；纯函数，方便单测。 */
export function formatQzoneEventLines(events = [], { ownerUin = '', ownerMode = 'suggest' } = {}) {
  const lines = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || typeof e !== 'object') continue;
    if (e.type === 'comment') {
      const who = e.name ? `${e.name}（${e.uin ?? '?'}）` : String(e.uin ?? '未知');
      lines.push(`· ${who} 评论了你的说说「${clip(e.post, 24)}」：${clip(e.content, 80)}（tid=${e.tid}${e.commentId ? `，comment_id=${e.commentId}` : ''}）`);
    } else if (e.type === 'ownerPost') {
      const hint = ownerMode === 'direct'
        ? '想评论就直接用 qq_qzone_comment（targetUin=主人）'
        : '想评论的话先私聊问主人一句，他同意再发';
      lines.push(`· 主人刚发了新说说「${clip(e.content, 60)}」（tid=${e.tid}），${hint}`);
    }
  }
  return lines;
}

