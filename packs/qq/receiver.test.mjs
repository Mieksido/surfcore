/**
 * QQ 接收器测试（注入假 WebSocket，不联网）
 * 跑法：node packs/qq/receiver.test.mjs
 */
import { createReceiver, DEFAULT_RECONNECT } from './receiver.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

/** 假 WebSocket：记录实例，方便手动触发 onopen/onmessage/onclose */
function makeFakeWS() {
  const made = [];
  class FakeWS {
    constructor(url) { this.url = url; this.closed = false; made.push(this); }
    close() { this.closed = true; }
  }
  return { FakeWS, made };
}

console.log('## 连接与令牌');
{
  const { FakeWS, made } = makeFakeWS();
  const r = createReceiver({ url: 'ws://gw:3001', accessToken: 'tok-1', WebSocketImpl: FakeWS, onLog: () => {} });
  r.start();
  ok(made.length === 1, '启动时建立了一个连接');
  ok(made[0].url.includes('access_token=tok-1'), '令牌走 query（WebSocket 握手带不了自定义头）');
  ok(r.status().url.includes('access_token=***'), '状态里令牌被打码（不许进日志）');

  made[0].onopen();
  ok(r.status().connected === true, '打开后：状态为已连接');
  r.stop();
  ok(r.status().connected === false, '停止后：未连接');
}

console.log('\n## 消息转交（只转交，不解析业务）');
{
  const { FakeWS, made } = makeFakeWS();
  const got = [];
  const r = createReceiver({ WebSocketImpl: FakeWS, onEvent: (e) => got.push(e), onLog: () => {} });
  r.start();
  made[0].onopen();

  const message = { post_type: 'message', message_type: 'group', group_id: 1, user_id: 2, raw_message: '你好' };
  const handled = r.handleMessage(JSON.stringify(message));
  ok(handled && got.length === 1, '消息事件：被转交出去');
  ok(got[0].group_id === 1, '原始帧原样转交（业务判断在内核那边）');

  ok(r.handleMessage(JSON.stringify({ post_type: 'request' })) === null, 'request 事件：不处理（前向兼容）');
  ok(r.handleMessage('这不是 JSON') === null, '非 JSON 帧：忽略，不炸');
  ok(got.length === 1, '忽略的帧没有误转交');
}

console.log('\n## 心跳看门狗');
{
  const { FakeWS, made } = makeFakeWS();
  let t = 1000;
  const r = createReceiver({ WebSocketImpl: FakeWS, heartbeatTimeoutMs: 5000, now: () => t, onLog: () => {} });
  r.start();
  made[0].onopen();
  ok(r.checkHeartbeat().ok === true, '刚连上：心跳正常');

  r.handleMessage(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'heartbeat' }));
  ok(r.status().lastBeatAt === t, '收到心跳帧：记录时间');

  t += 10000;   // 超过 5 秒没心跳
  const hb = r.checkHeartbeat();
  ok(hb.ok === false && hb.reason === 'heartbeat-timeout', '太久没心跳：判定掉线');
  r.stop();
}

console.log('\n## 断线重连（指数退避）');
{
  const { FakeWS, made } = makeFakeWS();
  let t = 1000;
  const logs = [];
  const r = createReceiver({ WebSocketImpl: FakeWS, now: () => t, onLog: (lv, m) => logs.push(`${lv}:${m}`), reconnect: { baseMs: 100, maxMs: 400, factor: 2 } });
  r.start();
  ok(made.length === 1, '第一次连接');
  made[0].onclose();
  ok(logs.some((l) => l.includes('重连')), '断开后：安排重连并记录日志');
  ok(r.status().attempts === 1, '重连次数 +1');
  r.stop();
  ok(DEFAULT_RECONNECT.maxMs === 30000, '默认退避上限 30 秒');
}

console.log('\n## 没有 WebSocket 环境');
{
  // 注意：传 null 而不是 undefined —— 传 undefined 会触发默认参数（用全局 WebSocket）
  const r = createReceiver({ WebSocketImpl: null, onLog: () => {} });
  r.start();
  ok(r.status().lastError === 'no-websocket', '没有 WebSocket：明确报错，不静默');
  r.stop();
}

console.log('\n## 合规会话指出的 5 处行为（补上，且不新增通道）');
{
  const got = [];
  const logs = [];
  const r = createReceiver({ onEvent: (e) => got.push(e), onLog: (lv, m) => logs.push(`${lv}:${m}`) });

  // 3.1 notice 透传：走的是**同一条 onEvent**，不是第四条通道
  const notice = { post_type: 'notice', notice_type: 'notify', sub_type: 'poke', group_id: 5, user_id: 6, self_id: 999, target_id: 999 };
  ok(r.handleMessage(JSON.stringify(notice)) !== null, 'notice：被接收（不再静默丢弃）');
  ok(got.length === 1 && got[0].post_type === 'notice', 'notice：从同一个 onEvent 出去（没有新通道）');

  // 3.2 心跳健康度：写进状态，由 health() 读出去
  r.handleMessage(JSON.stringify({ post_type: 'meta_event', meta_event_type: 'heartbeat', status: { online: true, good: false } }));
  ok(r.status().lastUpstream?.online === true && r.status().lastUpstream?.good === false, '心跳：上游健康度被记下（online/good）');

  // 3.3 畸形帧守卫
  const before = got.length;
  ok(r.handleMessage(JSON.stringify({ post_type: 'message', message_id: 1, raw_message: 'x' })) === null, '畸形帧：没有 message_type → 丢弃');
  ok(r.handleMessage(JSON.stringify({ post_type: 'message', message_type: 'group', message_id: 2, raw_message: 'x' })) === null, '畸形帧：group 却没有 group_id → 丢弃');
  ok(r.handleMessage(JSON.stringify({ post_type: 'message', message_type: 'weird', user_id: 1 })) === null, '畸形帧：未知 message_type → 丢弃');
  ok(got.length === before, '畸形帧：一条都没进内核');
  ok(logs.some((l) => l.includes('畸形')), '畸形帧：日志可见（不静默）');

  // 自发回声
  ok(r.handleMessage(JSON.stringify({ post_type: 'message_sent', message_type: 'group', group_id: 5 })) === null, '自发回声：忽略');
  ok(got.length === before, '自发回声：不入库（否则她会把自己的话当用户输入）');

  // 令牌重复拼接
  const r2 = createReceiver({ url: 'ws://gw:3001?access_token=old', accessToken: 'new', WebSocketImpl: null });
  ok(!/access_token=old.*access_token=/.test(r2.status().url), 'url 已带令牌：不再拼第二个');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);

