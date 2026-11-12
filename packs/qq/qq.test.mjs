/**
 * QQ 包测试：文本转义/拆条 + 事件规范化 + 发送（注入假 fetch）+ attach 接线
 * 跑法：node packs/qq/qq.test.mjs
 */
import { escapeCq, unescapeCq, safeText, splitForSend } from './text.js';
import { normalizeEvent, createClient, ONEBOT_ACTION, parseSegments } from './onebot.js';
import pack, { configure, attach, open, send, identity, capabilities, runTool, toolDeclarations } from './index.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

console.log('## 文本：转义与拆条');
{
  ok(escapeCq('[CQ:image,file=x]') === '&#91;CQ:image,file=x&#93;', '方括号被转义（防 CQ 注入）');
  ok(escapeCq('a&b') === 'a&amp;b', '& 被转义');
  ok(unescapeCq(escapeCq('原文[保留]')) === '原文[保留]', '转义可逆');
  ok(!safeText('你好\u0000世界').includes('\u0000'), '控制字符被剥掉');

  const long = '啊'.repeat(1200);
  const parts = splitForSend(long, 500);
  ok(parts.length === 3, '1200 字按 500 拆成 3 条');
  ok(parts.join('').length === 1200, '拆条不丢字');
  ok(splitForSend('短句', 500).length === 1, '短句不拆');

  const emoji = '😀'.repeat(400);           // 每个 emoji 占 2 个 code unit
  const ep = splitForSend(emoji, 501);      // 故意让切口落在代理对中间
  ok(ep.every((p) => !/[\uD800-\uDBFF]$/.test(p)), '不会把 emoji 劈成半个（模型 API 会 400）');
}

console.log('\n## 事件规范化（OneBot v11 → 新架构事件）');
{
  const group = normalizeEvent({
    post_type: 'message', message_type: 'group', self_id: 999,
    group_id: 123, user_id: 456, message_id: 77, time: 1762700000,
    raw_message: '在吗', sender: { user_id: 456, nickname: '小明' },
    message: [{ type: 'text', data: { text: '在吗' } }, { type: 'at', data: { qq: '999' } }],
  });
  ok(group.from.channel === 'group:123' && group.from.kind === 'group', '群消息：频道与类型正确');
  ok(group.from.actor === '456', '带上了说话人');
  ok(group.text === '在吗', '文本正确');
  ok(group.mentioned === true, '认得出 @ 了她');
  ok(group.externalId === '77', '带上了平台消息编号（回执用）');
  ok(group.from.at === 1762700000 * 1000, '时间被换算成毫秒');

  const dm = normalizeEvent({ post_type: 'message', message_type: 'private', self_id: 999, user_id: 456, raw_message: '悄悄话' });
  ok(dm.from.channel === 'private:456' && dm.from.kind === 'private', '私聊：频道与类型正确');
  ok(dm.mentioned === false, '私聊没有 @');

  ok(normalizeEvent({ post_type: 'request' }) === null, '不处理的事件（request）：返回 null（前向兼容）');

  // 拍一拍：不另开通道，统一成事件；打到自己身上才置 mentioned
  const pokeMe = normalizeEvent({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', group_id: 5, user_id: 6, self_id: 999, target_id: 999 });
  ok(pokeMe && pokeMe.source === 'system' && pokeMe.text === '', 'notice：变成事件（text 为空，source=system）');
  ok(pokeMe.mentioned === true, '拍到我：用 mentioned 表达（复用已有注意力信号）');
  ok(!('notice' in pokeMe), 'notice 事件**不加新字段**（形状冻结：只用已有信封）');
  const pokeOther = normalizeEvent({ post_type: 'notice', notice_type: 'notify', sub_type: 'poke', group_id: 5, user_id: 6, self_id: 999, target_id: 777 });
  ok(pokeOther.mentioned === false, '拍到别人：不算叫我');
  ok(normalizeEvent({}) === null, '空事件：返回 null，不炸');

  const asOwner = normalizeEvent({ post_type: 'message', message_type: 'private', user_id: 10001, raw_message: 'x' }, { ownerId: '10001' });
  ok(asOwner.to.owner === true, '能认出主人');
}

console.log('\n## 发送（注入假网关，不联网）');
{
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 555 } }) };
  };
  const client = createClient({ httpUrl: 'http://gw:3000/', accessToken: 'tok', fetchImpl: fakeFetch });
  const r = await client.send({ kind: 'group', id: 123, text: '你好' });
  ok(r.ok && r.status === 'delivered', '发送成功');
  ok(calls[0].url === 'http://gw:3000/send_group_msg', '打到正确的动作地址（末尾斜杠被去掉）');
  ok(calls[0].body.group_id === 123, '参数正确');
  ok(calls[0].headers.authorization === 'Bearer tok', '带上令牌');

  const dm = await client.send({ kind: 'private', id: 456, text: 'x' });
  ok(dm.ok, '私聊发送成功');

  const failClient = createClient({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'failed', retcode: 100, wording: '风控' }) }),
  });
  const f = await failClient.send({ kind: 'group', id: 1, text: 'x' });
  ok(!f.ok && f.error.code === 'qq.send-failed', '网关回失败：结构化失败');
  ok(String(f.error.message).includes('风控'), '把网关的原话带出来');

  const netClient = createClient({ fetchImpl: async () => { throw new Error('fetch failed'); } });
  const n = await netClient.send({ kind: 'group', id: 1, text: 'x' });
  ok(!n.ok && n.error.retryable === true, '网络错误：可重试');

  const timeoutClient = createClient({ fetchImpl: async () => { throw new Error('The operation was aborted due to timeout'); } });
  const t = await timeoutClient.send({ kind: 'group', id: 1, text: 'x' });
  ok(t.status === 'unconfirmed', '超时：判"已发出但无法确认"，不许当失败重发');
  ok(String(t.error.hint).includes('别重发'), '超时要给下一步（别重发）');

  ok(ONEBOT_ACTION.group === 'send_group_msg' && ONEBOT_ACTION.private === 'send_private_msg', '动作名与 OneBot v11 一致');
}

console.log('\n## 平台包接线');
{
  ok(identity.publisher === 'surfcore' && identity.name === 'qq', '身份：发布人+名字');
  ok(capabilities.modality === 'multi', '能力：多模态');
  ok(typeof pack.attach === 'function', '导出 attach（接 WS 用）');

  const emitted = [];
  const ctx = { emit: (e) => emitted.push(e), log: () => {} };
  const raw = { post_type: 'message', message_type: 'group', self_id: 999, group_id: 5, user_id: 6, raw_message: '喂' };
  await attach(raw, ctx);
  ok(emitted.length === 1 && emitted[0].from.channel === 'group:5', 'attach：把网关事件送到 ctx.emit');
  ok((await attach({ post_type: 'request' }, ctx)) === null, 'attach：不认识的事件不送');

  // 有 wsUrl 时 open 会自己连（网关由用户自备，这里注入假 WebSocket）
  const made = [];
  class FakeWS {
    constructor(url) { this.url = url; made.push(this); }
    close() {}
  }
  configure({ wsUrl: 'ws://user-gateway:3001', accessToken: 't0k', WebSocketImpl: FakeWS, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } }) }) });
  const emitted2 = [];
  const ctx2 = { emit: (e) => emitted2.push(e), log: () => {} };
  await open(ctx2);
  ok(made.length === 1 && made[0].url.includes('access_token=t0k'), 'open：按 wsUrl 建立连接（令牌走 query）');
  made[0].onopen?.();
  made[0].onmessage?.({ data: JSON.stringify({ post_type: 'message', message_type: 'private', user_id: 7, raw_message: '在吗', message: [{ type: 'text', data: { text: '在吗' } }] }) });
  ok(emitted2.length === 1 && emitted2[0].text === '在吗', 'open：收到消息自动转成事件（不用手调 attach）');

  // 没配 wsUrl：只发不收，且说清楚
  const logs = [];
  await pack.close();
  configure({ wsUrl: '', WebSocketImpl: undefined });
  await open({ emit: () => {}, log: (lv, m) => logs.push(m) });
  ok(logs.some((m) => String(m).includes('只发不收')), '没配 wsUrl：日志说清"只发不收"（不静默）');

  // 未启动时发送：如实报错
  await pack.close();
  const notStarted = await send({ kind: 'say', text: 'x', channel: 'group:1' });
  ok(notStarted.status === 'failed' && notStarted.error.code === 'adapter.not-started', '未启动时如实报错（不假装成功）');

  // 启动后：用假网关发一条，验证"拆条 + 转义 + 频道解析"整条链
  const sent = [];
  configure({ httpUrl: 'http://gw', fetchImpl: async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } }) }; }, maxChars: 10 });
  await open({ log: () => {} });
  const ack = await send({ kind: 'say', text: '一二三四五六七八九十十一', channel: { id: 'group:9' } });
  ok(ack.status === 'delivered', '启动后：发送成功');
  ok(sent.length === 2, '超过 10 字：自动拆成两条发');
  ok(sent[0].message[0].data.text.length <= 10, '每一条都在字数上限内');
  ok((await send({ kind: 'stay_silent', channel: 'group:9' })).status === 'delivered', '沉默：回执成功但什么也不发');
  ok((await send({ kind: 'say', text: 'x', channel: '乱写' })).error.code === 'qq.bad-channel', '认不出频道：结构化失败');

  // 发媒体：内核已把编号换成路径，包只负责变成消息段
  sent.length = 0;
  const mediaAck = await send({ kind: 'send_media', channel: 'group:9', media: [{ id: 'm_1', kind: 'image', path: 'D:/media/aa.jpg', caption: '猫图' }] });
  ok(mediaAck.status === 'delivered', '发媒体：成功');
  ok(sent[0].message[0].type === 'image', '发媒体：变成 image 段');
  ok(sent[0].message[0].data.file === 'D:/media/aa.jpg', '发媒体：带的是路径');

  const noPath = await send({ kind: 'send_media', channel: 'group:9', media: [{ id: 'm_x', kind: 'image' }] });
  ok(noPath.error.code === 'qq.media-unresolved', '媒体没路径：结构化失败（不假装发了）');

  // 语音：内核合成后是 send_media(kind=audio)；这里必须变成 record 段
  sent.length = 0;
  const audioAck = await send({ kind: 'send_media', channel: 'group:9', media: [{ kind: 'audio', path: 'D:/media/voice.wav', caption: '语音' }] });
  ok(audioAck.status === 'delivered', '发语音：成功');
  ok(sent[0].message[0].type === 'record', '发语音：变成 record 段');
  ok(sent[0].message[0].data.file === 'D:/media/voice.wav', '发语音：带的是音频路径');

  // AI 标识：内核给事实，包负责让它可见
  sent.length = 0;
  await send({ kind: 'say', channel: 'group:9', text: '你好', aiGenerated: true, label: 'AI 生成' });
  ok(sent[0].message[0].data.text.startsWith('AI 生成'), 'AI 标识：文本前有可见提示');

  sent.length = 0;
  await send({ kind: 'say', channel: 'group:9', text: '你好' });
  ok(!sent[0].message[0].data.text.includes('AI 生成'), '没有标识字段：不加提示（不是所有消息都盖戳）');
}

console.log('\n## 渠道动作（act）：包翻译成具体调用，写/管理受设置控制');
{
  const calls = [];
  const fake = async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, status: 200, json: async () => ({ status: 'ok', retcode: 0, data: { message_id: 1 } }) }; };

  // 默认只读：写操作被拒
  configure({ httpUrl: 'http://gw', fetchImpl: fake, allowWrite: false, allowManage: false });
  await open({ log: () => {} });
  const denied = await send({ kind: 'act', action: 'delete_msg', args: { messageId: 9 }, channel: 'group:9' });
  ok(denied.status === 'failed' && denied.error.code === 'qq.tool-denied', '默认：写操作被拒（fail-closed）');
  ok(calls.length === 0, '被拒的动作：一次都没打出去');

  // 设置打开写：能撤回
  configure({ httpUrl: 'http://gw', fetchImpl: fake, allowWrite: true, allowManage: false });
  const done = await send({ kind: 'act', action: 'delete_msg', args: { messageId: 9 }, channel: 'group:9' });
  ok(done.status === 'delivered', '打开写之后：撤回成功');
  ok(calls[0].url.endsWith('/delete_msg'), '打到 delete_msg');
  ok(calls[0].body.message_id === 9, '参数被翻译成 snake_case');

  // 管理还是关着
  const manage = await send({ kind: 'act', action: 'set_group_ban', args: { userId: 7, duration: 60 }, channel: 'group:9' });
  ok(manage.status === 'failed' && manage.error.code === 'qq.tool-denied', '管理没开：仍然拒绝（分级生效）');
}

console.log('\n## 消息段解析（图/语音/@/引用）');
{
  const parsed = parseSegments([
    { type: 'reply', data: { id: 88 } },
    { type: 'at', data: { qq: '999' } },
    { type: 'text', data: { text: ' 看这个 ' } },
    { type: 'image', data: { url: 'https://x/a.png', summary: '[猫]' } },
    { type: 'image', data: { file: 'b.jpg' } },
    { type: 'record', data: { url: 'https://x/v.amr' } },
    { type: 'face', data: { id: 1 } },
    { type: '未知段', data: {} },
  ]);
  ok(parsed.text === '看这个 [表情]', '文本段拼起来，表情段降级成[表情]');
  ok(parsed.replyTo === '88', '引用段 → replyTo');
  ok(parsed.mentions.includes('999'), '@ 段被收集');
  ok(parsed.media.length === 3, '两份图 + 一段语音 = 3 份媒体');
  ok(parsed.media[0].kind === 'image' && parsed.media[0].caption === '[猫]', '图片带说明');
  ok(parsed.media[2].kind === 'audio', '语音段被认出来');
  ok(!parsed.text.includes('猫'), '媒体不会混进文本');

  const ev = normalizeEvent({
    post_type: 'message', message_type: 'group', self_id: 999, group_id: 5, user_id: 6, message_id: 12, time: 1762700000,
    message: [{ type: 'reply', data: { id: '77' } }, { type: 'text', data: { text: '看这个' } }, { type: 'image', data: { url: 'u' } }],
  });
  ok(ev.media.length === 1, '事件里带上了媒体');
  ok(ev.replyTo === '77', '事件里带上了引用编号');
  ok(ev.externalId === '12', '事件里带上了平台消息编号');
}

console.log('\n## 桥接语义工具：配了令牌才交给模型，key 由频道自动补');
{
  const calls = [];
  const fake = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200, json: async () => ({ ok: true, unreadCount: 3 }) };
  };
  configure({ httpUrl: 'http://gw', fetchImpl: fake, bridgeToken: '', bridgeUrl: 'http://bridge' });
  ok(!toolDeclarations().some((d) => d.name === 'qq_get_unread_messages'), '没配桥接令牌：语义工具不出现');

  configure({ httpUrl: 'http://gw', fetchImpl: fake, bridgeToken: 'tok', bridgeUrl: 'http://bridge', allowWrite: false });
  const decls = toolDeclarations();
  const unread = decls.find((d) => d.name === 'qq_get_unread_messages');
  ok(Boolean(unread) && unread.parameters.type === 'object', '配了令牌：语义工具进声明');
  ok(!unread.parameters.properties.key, 'key 不交给模型（包从频道补）');
  ok(!decls.some((d) => d.name === 'qq_mark_read'), '写工具默认不交给模型');

  const r = await runTool('qq_get_unread_messages', {}, 'group:7');
  ok(r.ok && r.data.unreadCount === 3, 'runTool 回落到桥接：成功');
  ok(calls[0].url.includes('key=group%3A7'), '频道 → key 自动补');
  ok(calls[0].opts.headers['x-agent-token'] === 'tok', '令牌由包注入');

  const denied = await runTool('qq_mark_read', { throughSeq: 9 }, 'group:7');
  ok(!denied.ok && denied.error.code === 'qq.bridge-tool-denied', '写工具即使被调到也拒绝（fail-closed）');

  configure({ httpUrl: 'http://gw', fetchImpl: fake, bridgeToken: '', bridgeUrl: '' });
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
