// QQ 空间说说发布：纯逻辑 + 接线回归（不连 SnowLuma、不发真实说说）。
//
// 为什么要有这份测试：这是**对外公开**的动作，失败代价和发群消息不一样——
// 发错一条收不回，还可能把本机路径/凭据带上公网。所以每个拒绝分支都要钉住。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_QZONE, DEFAULT_QZONE_INTERACT, DEFAULT_QZONE_WATCH, QZONE_UGC_RIGHTS,
  buildQzoneActionParams, buildQzoneCommentParams, countQzonePostsSince, formatQzoneEventLines,
  normalizeQzoneConfig, summarizeQzoneInteract, summarizeQzoneState,
  validateQzoneInteraction, validateQzonePost,
} from '../src/qzone-post.js';
import { SENSITIVE_RE } from '../src/sensitive.js';

const now = new Date('2026-10-30T23:10:00+08:00').getTime();
const dayStart = new Date('2026-10-30T00:00:00+08:00').getTime();
const enabled = { ...DEFAULT_QZONE, enabled: true };

// 1) 默认配置：关闭、纯文字、好友可见、每天 2 条、间隔 6 小时
assert.deepEqual(
  { enabled: DEFAULT_QZONE.enabled, ugcRight: DEFAULT_QZONE.ugcRight, allowImages: DEFAULT_QZONE.allowImages, maxPerDay: DEFAULT_QZONE.maxPerDay },
  { enabled: false, ugcRight: 4, allowImages: false, maxPerDay: 2 },
  '默认必须关闭、不带图、好友可见',
);
assert.equal(DEFAULT_QZONE.allowLocalImages, false, '默认不允许把本机文件发到公网');
assert.equal(normalizeQzoneConfig(undefined).enabled, false);
assert.equal(normalizeQzoneConfig({ enabled: 'true' }).enabled, false, '字符串 true 不算真值，避免手改配置写成字符串');

// 2) 归一化：坏值回落到安全默认，不抛错
{
  const c = normalizeQzoneConfig({ ugcRight: 3, maxChars: 99999, maxPerDay: -5, minGapMs: -1, targetUins: [1, 1, 2, 'x', 0] });
  assert.equal(c.ugcRight, 4, '不认识的权限值回落好友可见');
  assert.equal(c.maxChars, 2000);
  assert.equal(c.maxPerDay, 0);
  assert.equal(c.minGapMs, 0);
  assert.deepEqual(c.targetUins, [1, 2], '去重 + 只留正整数');
}

// 3) 总开关关闭 → 直接拒绝（默认状态就是这条）
{
  const r = validateQzonePost({ content: '你好' }, { config: DEFAULT_QZONE, now, dayStart });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'QZONE_DISABLED');
  assert.ok(r.hint.includes('QQ 空间'), '要告诉用户去哪打开');
}

// 4) 空正文 / 超长
{
  const empty = validateQzonePost({ content: '   ' }, { config: enabled, now, dayStart });
  assert.equal(empty.code, 'QZONE_EMPTY');
  const long = validateQzonePost({ content: '啊'.repeat(501) }, { config: enabled, now, dayStart });
  assert.equal(long.code, 'QZONE_TOO_LONG');
  assert.match(long.error, /500/);
}

// 5) 敏感信息（本机路径 / token 赋值）必须挡在发布之前
{
  const pathHit = validateQzonePost({ content: '我的文件在 C:\\Users\\me\\secret.txt' }, { config: enabled, now, dayStart, sensitiveRe: SENSITIVE_RE });
  assert.equal(pathHit.code, 'QZONE_SENSITIVE');
  const tokenHit = validateQzonePost({ content: 'token=abcdef123456' }, { config: enabled, now, dayStart, sensitiveRe: SENSITIVE_RE });
  assert.equal(tokenHit.code, 'QZONE_SENSITIVE');
  const normal = validateQzonePost({ content: '今天去湖边走了走，风挺大' }, { config: enabled, now, dayStart, sensitiveRe: SENSITIVE_RE });
  assert.equal(normal.ok, true, '正常文字不能被误伤');
}

// 6) 图片：默认不许带 → 允许后校验协议与数量 → file:// 还要单独开关
{
  const blocked = validateQzonePost({ content: '看图', images: ['https://a/b.png'] }, { config: enabled, now, dayStart });
  assert.equal(blocked.code, 'QZONE_IMAGES_DISABLED');

  const cfg = { ...enabled, allowImages: true, maxImages: 2 };
  const scheme = validateQzonePost({ content: '看图', images: ['ftp://a/b.png'] }, { config: cfg, now, dayStart });
  assert.equal(scheme.code, 'QZONE_IMAGE_SCHEME');

  const local = validateQzonePost({ content: '看图', images: ['file:///C:/Users/me/a.png'] }, { config: cfg, now, dayStart });
  assert.equal(local.code, 'QZONE_LOCAL_IMAGE_DISABLED');
  const localOn = validateQzonePost({ content: '看图', images: ['file:///C:/Users/me/a.png'] }, { config: { ...cfg, allowLocalImages: true }, now, dayStart });
  assert.equal(localOn.ok, true);

  const tooMany = validateQzonePost({ content: '看图', images: ['https://a/1.png', 'https://a/2.png', 'https://a/3.png'] }, { config: cfg, now, dayStart });
  assert.equal(tooMany.code, 'QZONE_IMAGE_TOO_MANY');
}

// 7) 权限 16/128 必须有名单（配置来自设置页，模型不能自己改权限）
{
  const missing = validateQzonePost({ content: '只给几个人看' }, { config: { ...enabled, ugcRight: 16 }, now, dayStart });
  assert.equal(missing.code, 'QZONE_TARGET_REQUIRED');
  const ok = validateQzonePost({ content: '只给几个人看' }, { config: { ...enabled, ugcRight: 16, targetUins: [10001] }, now, dayStart });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.value.targetUins, [10001]);
  assert.equal(ok.value.ugcRight, 16);
}

// 8) 频率：每天上限 + 最小间隔
{
  const posts = [{ at: dayStart + 1000 }, { at: dayStart + 2000 }];
  const daily = validateQzonePost({ content: '第三条' }, { config: enabled, posts, now, dayStart });
  assert.equal(daily.code, 'QZONE_DAILY_LIMIT');
  assert.match(daily.error, /2\/2|2 条/);

  const recent = [{ at: now - 60_000 }];
  const soon = validateQzonePost({ content: '马上再发' }, { config: enabled, posts: recent, now, dayStart });
  assert.equal(soon.code, 'QZONE_TOO_SOON');
  assert.match(soon.error, /分钟/);

  const yesterday = [{ at: dayStart - 3600_000 }];
  const okAgain = validateQzonePost({ content: '今天第一条' }, { config: enabled, posts: yesterday, now, dayStart });
  assert.equal(okAgain.ok, true, '昨天的不算今天的额度');
  assert.equal(countQzonePostsSince(yesterday, dayStart), 0);
}

// 9) 通过时：内容 trim、权限/名单来自配置、dryRun 透传
{
  const r = validateQzonePost({ content: '  今天风很大\n' }, { config: { ...enabled, dryRun: true }, now, dayStart });
  assert.equal(r.ok, true);
  assert.equal(r.value.content, '今天风很大');
  assert.equal(r.value.dryRun, true);
  assert.equal(r.value.ugcRight, 4);
}

// 10) 状态摘要：剩余条数 / 上次时间 / 还要等多久
{
  const posts = [{ at: dayStart + 1000 }, { at: now - 60_000 }];
  const s = summarizeQzoneState({ config: enabled, posts, now, dayStart });
  assert.equal(s.postedToday, 2);
  assert.equal(s.remaining, 0);
  assert.equal(s.lastAt, now - 60_000);
  assert.ok(s.retryAfterMs > 0);
  assert.equal(s.ugcLabel, QZONE_UGC_RIGHTS[4]);
  const unlimited = summarizeQzoneState({ config: { ...enabled, maxPerDay: 0 }, posts, now, dayStart });
  assert.equal(unlimited.remaining, null);
}

// 11) SnowLuma 参数：空图片不传 null；target_uins 只在 16/128 时带
{
  const base = buildQzoneActionParams({ content: 'x', ugcRight: 4, images: [], targetUins: [1] });
  assert.deepEqual(base, { content: 'x', ugc_right: 4 });
  const withImages = buildQzoneActionParams({ content: 'x', ugcRight: 4, images: ['https://a/b.png'], targetUins: [] });
  assert.deepEqual(withImages.images, ['https://a/b.png']);
  assert.equal('target_uins' in withImages, false);
  const restricted = buildQzoneActionParams({ content: 'x', ugcRight: 16, images: [], targetUins: [10001] });
  assert.deepEqual(restricted.target_uins, [10001]);
}

// 12) 互动（点赞/评论）：独立开关、范围、频率、楼中楼参数
{
  const on = { ...DEFAULT_QZONE, enabled: true, interact: { ...DEFAULT_QZONE_INTERACT, enabled: true } };
  const base = { config: on, actions: undefined, now, dayStart, ownerUin: '1000000001', selfUin: '1000000002', myTids: ['mine1'] };

  assert.equal(normalizeQzoneConfig({}).interact.enabled, false, '互动默认必须关');
  assert.equal(normalizeQzoneConfig({}).watch.enabled, false, '轮询默认必须关');
  assert.equal(normalizeQzoneConfig({}).watch.pollMs, DEFAULT_QZONE_WATCH.pollMs);

  const master = validateQzoneInteraction({ kind: 'like', tid: 't1' }, { ...base, config: DEFAULT_QZONE });
  assert.equal(master.code, 'QZONE_DISABLED');

  const off = validateQzoneInteraction({ kind: 'like', tid: 't1' }, { ...base, config: { ...DEFAULT_QZONE, enabled: true } });
  assert.equal(off.code, 'QZONE_INTERACT_DISABLED');

  assert.equal(validateQzoneInteraction({ kind: 'nope', tid: 't1' }, base).code, 'QZONE_BAD_KIND');
  assert.equal(validateQzoneInteraction({ kind: 'like', tid: '' }, base).code, 'QZONE_TID_REQUIRED');

  const like = validateQzoneInteraction({ kind: 'like', tid: 't1', targetUin: 10001 }, base);
  assert.equal(like.ok, true);
  assert.deepEqual(like.value.params, { tid: 't1', target_uin: 10001 });

  const likeLimit = validateQzoneInteraction({ kind: 'like', tid: 't1' }, {
    ...base,
    interactions: { likes: Array.from({ length: 20 }, () => now - 1000), comments: [] },
  });
  assert.equal(likeLimit.code, 'QZONE_LIKE_LIMIT');

  // 评论范围：默认只许主人/自己的
  const stranger = validateQzoneInteraction({ kind: 'comment', tid: 'other1', targetUin: 10009, content: '不错' }, base);
  assert.equal(stranger.code, 'QZONE_COMMENT_SCOPE');
  const ownerPost = validateQzoneInteraction({ kind: 'comment', tid: 'o1', targetUin: 1000000001, content: '好看' }, base);
  assert.equal(ownerPost.ok, true);
  const myPost = validateQzoneInteraction({ kind: 'comment', tid: 'mine1', targetUin: 1000000001, content: '谢谢' }, base);
  assert.equal(myPost.ok, true, '自己说说下的评论要允许');
  // 省略 targetUin = SnowLuma 默认「机器人自己」：老说说不在发布记录里，也必须允许
  const legacyOwn = validateQzoneInteraction({ kind: 'comment', tid: 'legacy-own-tid', content: '谢谢' }, base);
  assert.equal(legacyOwn.ok, true, '省略 targetUin 的自己的说说要允许（老说说不在发布记录里）');

  // 主人的同一条说说不能重复发顶层评论；回复不算
  const dup = validateQzoneInteraction({ kind: 'comment', tid: 'o1', targetUin: 1000000001, content: '再来一条' }, {
    ...base,
    interactions: { likes: [], comments: [{ at: dayStart + 1, tid: 'o1', targetUin: 1000000001, commentId: '' }] },
  });
  assert.equal(dup.code, 'QZONE_ALREADY_COMMENTED');

  // 内容闸门
  assert.equal(validateQzoneInteraction({ kind: 'comment', tid: 'o1', targetUin: 1000000001, content: ' ' }, base).code, 'QZONE_COMMENT_EMPTY');
  assert.equal(validateQzoneInteraction({ kind: 'comment', tid: 'o1', targetUin: 1000000001, content: '啊'.repeat(101) }, base).code, 'QZONE_COMMENT_TOO_LONG');
  assert.equal(validateQzoneInteraction({ kind: 'comment', tid: 'o1', targetUin: 1000000001, content: 'C:\\Users\\me\\a.txt' }, { ...base, sensitiveRe: SENSITIVE_RE }).code, 'QZONE_COMMENT_SENSITIVE');

  // 频率
  const commentDaily = validateQzoneInteraction({ kind: 'comment', tid: 'o1', targetUin: 1000000001, content: '好' }, {
    ...base,
    interactions: { likes: [], comments: Array.from({ length: 5 }, (_, i) => ({ at: dayStart + i, tid: `x${i}`, targetUin: 1 })) },
  });
  assert.equal(commentDaily.code, 'QZONE_COMMENT_LIMIT');
  const tooSoon = validateQzoneInteraction({ kind: 'comment', tid: 'o1', targetUin: 1000000001, content: '好' }, {
    ...base,
    interactions: { likes: [], comments: [{ at: now - 30_000, tid: 'x', targetUin: 1 }] },
  });
  assert.equal(tooSoon.code, 'QZONE_COMMENT_TOO_SOON');

  // 楼中楼参数：有 commentId 才带 comment_id/comment_uin，reply_* 只在真回复某人时带
  assert.deepEqual(buildQzoneCommentParams({ tid: 't', content: 'c', targetUin: 1 }), { tid: 't', content: 'c', target_uin: 1 });
  assert.deepEqual(
    buildQzoneCommentParams({ tid: 't', content: 'c', commentId: '0', commentUin: 2 }),
    { tid: 't', content: 'c', comment_id: '0', comment_uin: 2 },
  );
  assert.deepEqual(
    buildQzoneCommentParams({ tid: 't', content: 'c', commentId: '0', commentUin: 2, replyUin: 3, replyName: 'x' }),
    { tid: 't', content: 'c', comment_id: '0', comment_uin: 2, reply_uin: 3, reply_name: 'x' },
  );

  const sum = summarizeQzoneInteract({
    config: on,
    interactions: { likes: [now - 1], comments: [{ at: now - 1, tid: 'a' }] },
    now,
    dayStart,
  });
  assert.equal(sum.likesToday, 1);
  assert.equal(sum.commentsToday, 1);
  assert.equal(sum.commentsRemaining, 4);
}

// 13) 轮询事件 → 唤醒提示的几行文字
{
  const lines = formatQzoneEventLines([
    { type: 'comment', tid: 't1', commentId: 'c1', uin: 10001, name: '小明', content: '这啥', post: '今天风很大' },
    { type: 'ownerPost', tid: 't2', content: '新买的鱼' },
  ], { ownerUin: '1000000001', ownerMode: 'suggest' });
  assert.equal(lines.length, 2);
  assert.ok(lines[0].includes('小明') && lines[0].includes('tid=t1') && lines[0].includes('comment_id=c1'));
  assert.ok(lines[1].includes('主人刚发了新说说'));
  assert.ok(lines[1].includes('先私聊问主人'), 'suggest 模式必须先问主人');
  const direct = formatQzoneEventLines([{ type: 'ownerPost', tid: 't2', content: 'x' }], { ownerMode: 'direct' });
  assert.ok(direct[0].includes('直接'), 'direct 模式提示直接评论');
}

// 14) 接线：桥接端点、SnowLuma 动作名、MCP 工具与开关、设置页字段、示例配置
{
  const bridge = fs.readFileSync(new URL('../src/bridge.js', import.meta.url), 'utf8');
  assert.ok(bridge.includes("'/api/socialV2/qzone'"), '桥接缺少 QQ 空间端点');
  assert.ok(bridge.includes("onebotAction('send_qzone_msg'"), '桥接没有调用 SnowLuma 的 send_qzone_msg');
  assert.ok(bridge.includes('validateQzonePost'), '桥接没有接发布前的判定');
  assert.ok(bridge.includes('QZONE_OWNER_ONLY'), '桥接没有限制「只有管理员私聊能发」');
  assert.ok(bridge.includes('QZONE_FILE'), '桥接没有把发布记录落盘（每日上限就靠它）');
  // loadConfig 是白名单式重建：新顶层段漏加就会「配置里开了、桥接里永远 disabled」。
  // 第一版就踩了这个坑（开关打开、桥接仍报 enabled:false），所以用静态断言钉住。
  assert.ok(bridge.includes('qzone: file.qzone'), 'loadConfig 没有透传 qzone 段（配置里开了也读不到）');
  // 只读四件套要真的接上；互动动作名是变量拼的（like/unlike 同一处），按名字断言
  for (const action of ['get_qzone_msg_list', 'get_qzone_msg_detail', 'get_qzone_feeds', 'get_qzone_profile']) {
    assert.ok(bridge.includes(`onebotAction('${action}'`), `桥接没有调用 ${action}`);
  }
  for (const action of ['like_qzone', 'unlike_qzone', 'comment_qzone']) {
    assert.ok(bridge.includes(`'${action}'`), `桥接没有调用 ${action}`);
  }
  assert.ok(bridge.includes('validateQzoneInteraction'), '桥接没有接互动前判定');
  assert.ok(bridge.includes('startQzoneWatch'), '桥接没有启动空间轮询');
  assert.ok(bridge.includes("reason === 'qzone'"), '唤醒提示没有 QQ 空间事件分支');

  const mcp = fs.readFileSync(new URL('../src/mcp-snowluma-safe.js', import.meta.url), 'utf8');
  assert.ok(mcp.includes("'qq_post_qzone'"), 'MCP 缺少 qq_post_qzone');
  assert.ok(mcp.includes("'qq_qzone_status'"), 'MCP 缺少 qq_qzone_status');
  assert.ok(mcp.includes('cfg.qzone?.enabled === true'), '工具注册没有跟 qzone.enabled 联动');
  // 互动工具只跟总开关走：跟 interact 走的话，用户每开一次互动都要重启 DSH（已连踩两次）。
  assert.ok(!mcp.includes('qzone?.interact?.enabled === true'), '互动工具的注册不该依赖 interact 开关（会导致每次开互动都要重启 DSH）');
  assert.ok(mcp.includes("'qq_qzone_comment'"), 'MCP 缺少 qq_qzone_comment');

  const client = fs.readFileSync(new URL('../plugins/surfcore/lib/client.js', import.meta.url), 'utf8');
  assert.ok(client.includes('"qzone.enabled"'), '设置页缺少 QQ 空间开关');
  assert.ok(client.includes('QQ 空间（说说）'), '设置页缺少 QQ 空间分组');

  const example = JSON.parse(fs.readFileSync(new URL('../config.example.json', import.meta.url), 'utf8'));
  assert.equal(example.qzone?.enabled, false, '示例配置里 QQ 空间必须是关闭的');

  const catalog = JSON.parse(fs.readFileSync(new URL('../_snowluma-catalog.json', import.meta.url), 'utf8'));
  assert.ok(catalog.some((a) => a.name === 'send_qzone_msg'), 'SnowLuma 能力清单里没有 send_qzone_msg（v2.2.1 起才有）');
}

console.log('QQ 空间说说（qzone）测试通过');
