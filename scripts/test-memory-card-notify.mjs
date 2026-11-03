// 记忆卡容量告警接口（POST /api/memory-card/notify）的契约守卫。
//
// 为什么要有这个测试：这条链路**没有**任何回归覆盖，坏了半年也不会红 ——
// 它的失败只体现为 plugin.log 里每 10 分钟一行「记忆卡告警通知失败」，
// 而真正该发生的事（私聊管理员「记忆卡该压缩了」）从来没发生过。
//
// 钉住三件事：
//   1. readBody() 自己就返回**已解析的对象**（空体返回 {}），处理器里不能再 JSON.parse 一遍
//      —— 否则 JSON.parse({}) 抛「"[object Object]" is not valid JSON」，接口恒 500；
//   2. 收件人是 cfg.ownerQQ，不能由请求体指定（这是管理员私聊，不能被当群发接口用）；
//   3. 同一档位有冷却，避免把主人刷爆。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = fs.readFileSync(path.join(root, 'src', 'bridge.js'), 'utf8');

// 1) readBody 的契约：内部已 JSON.parse，注册表里所有调用点都必须是 `await readBody()`。
assert.match(
  source,
  /const readBody = \(\) => new Promise/,
  'readBody 应当仍是一个 Promise 工厂',
);
const readBodyBody = source.slice(source.indexOf('const readBody = () => new Promise'));
assert.match(
  readBodyBody.slice(0, 4000),
  /parsed = JSON\.parse\(data\)/,
  'readBody 内部负责 JSON.parse；调用方因此拿到的是对象',
);

// 所有调用点：要么直接 await，要么赋给变量后再用；不能包一层 JSON.parse。
const callSites = [...source.matchAll(/JSON\.parse\(\s*await readBody\(\)[^)]*\)/g)];
assert.equal(
  callSites.length,
  0,
  `readBody() 已经返回对象，不能再 JSON.parse 一次（会在运行时抛「"[object Object]" is not valid JSON」）：`
  + callSites.map((m) => m[0]).join(' | '),
);

// 2) 告警处理器：能找到、用 await readBody()、收件人只认 cfg.ownerQQ。
const start = source.indexOf("url.pathname === '/api/memory-card/notify'");
assert.ok(start > 0, '找不到 /api/memory-card/notify 处理器');
const handler = source.slice(start, start + 2200);

assert.match(handler, /const body = await readBody\(\);/, '处理器应直接使用 readBody() 的结果');
assert.match(handler, /if \(!cfg\.ownerQQ\)/, '未配置 ownerQQ 时必须明确拒绝，而不是发给别人');
assert.match(
  handler,
  /sendPrivateMessage\(Number\(cfg\.ownerQQ\)/,
  '收件人必须是 cfg.ownerQQ（不能让请求体指定收件人）',
);
assert.doesNotMatch(
  handler,
  /body\.(qq|userId|target|to)\b/,
  '请求体里的收件人字段一旦被采纳，这个接口就变成了任意人私聊发送器',
);

// 3) 冷却：按档位记录，10 分钟内不重复通知。
assert.match(handler, /memoryCardNotifyAt/, '应当有按档位的通知冷却记录');
assert.match(handler, /10 \* 60 \* 1000/, '同一档位应有 10 分钟冷却');

console.log('记忆卡告警接口契约 OK（readBody 不再重复解析 / 收件人锁 ownerQQ / 有冷却）');
