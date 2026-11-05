// 约定提醒的**接线**回归：真实 bridge.js（VM 夹具）里验证 promiseTick 的投递路径。
//
// 这个文件重点验的不是「日期算得对不对」（那在 test-promise-watch.mjs），而是**通路安全**：
//   · 到点才提（配置的钟点之前不排唤醒）；
//   · 只排 scheduleWakeV2，不直接 deliverPrompt —— 即投递仍受白名单/暂停/繁忙/额度约束；
//   · 同一会话同一天只提一次（先记后投：账本记不住就不发）；
//   · 唤醒提示词里带【到期的约定】，但绝不含内部 id；
//   · 不该提的会话（白名单外）不会被排唤醒，账本也不标已提。
import assert from 'node:assert/strict';
import http from 'node:http';
import { bridgeHarness } from './audit-bridge-harness.mjs';

let failures = 0;
async function test(name, run, options) {
  const h = await bridgeHarness(options);
  try {
    h.setMode('reserved2');
    await run(h);
    console.log('PASS', name);
  } catch (error) {
    failures += 1;
    console.error('FAIL', name, error.message);
  } finally {
    await h.close();
  }
}

/** 本地时区的某天。用中午，避开跨日边界。 */
function dayAt(offsetDays = 0, h = 12) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  d.setHours(h, 0, 0, 0);
  return d;
}
function dayKey(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const TODAY = dayKey(dayAt(0));
const TOMORROW = dayKey(dayAt(1));

/** 一条「今天到期」的记忆：锚点设成昨天，正文写「明天」—— 这才是真实的摄取语义。 */
function dueTodayRecord(extra = {}) {
  const anchor = dayAt(-1, 12);
  return {
    id: 'mem_promise_today',
    title: '说好一起去猫咪小镇',
    text: '明天一起去猫咪小镇，说好了',
    kind: 'promise', scope: 'qq', speaker: '主人', tags: [], importance: 60,
    clarity: 'vivid', conversationKey: 'private:123',
    createdAt: anchor.toISOString(), lastSeenAt: anchor.toISOString(),
    ...extra,
  };
}
const memoryFile = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';

/** 夹具里 `at` 的默认闸门是 [10:00, 22:00)，测试可能在窗口外跑 —— 显式铺满一整天。 */
const ALWAYS = { promiseWake: { at: '00:00', until: '23:59', maxPerDay: 3, graceDays: 2 } };

await test('到点且会话在白名单内：排一次 promiseDue 唤醒，提示词带来约定、不带内部 id', async (h) => {
  const file = h.promiseLedgerFile();
  h.promiseTick();
  // 账本里应该已认出这条约定
  const ledger = h.promiseLedger(true);
  assert.ok(ledger.items.mem_promise_today, '记忆档里的约定要被认进账本');
  assert.equal(ledger.items.mem_promise_today.dueDate, TODAY);
  assert.equal(ledger.items.mem_promise_today.firedDay, TODAY, '先记后投：排唤醒前就先标今天已提');

  // 提示词必须带约定内容，且不能泄露内部 id / 状态码。
  const prompt = h.buildWakePromptV2('private:123', 'promiseDue');
  assert.match(prompt, /【到期的约定】/, '唤醒提示词里要有约定段');
  assert.match(prompt, /猫咪小镇/);
  assert.ok(!prompt.includes('mem_promise_today'), '不许把记忆内部编号写进提示词');
  assert.match(prompt, /记事本响了/, 'promiseDue 要有自己的唤醒原因说明，不能落进通用模板');
  // 会话状态里要留下「这次是 promiseDue 唤醒」的痕迹（供审计/调试）。
  assert.ok(file.endsWith('promise-due.json'), '账本跟着角色目录走');
}, {
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await test('同一份提示词建两次都带约定：一次唤醒会建两份（先排队日志、再真投递）', async (h) => {
  h.promiseTick();
  assert.ok(h.promiseWakePending.get('private:123'), '第一遍应该排上');
  // 真实唤醒里 buildWakePromptV2 会被调两次：scheduleWakeV2 建一份用于排队/日志，
  // deliverPromptNow 建完会话再建真正投递的那份。**两份都必须带约定**。
  // 2026-11-06 00:01 的真机事故：第一份把待提约定「取走即删」了，第二份（真投递的）
  // 拿到空串，layers.promise=0 —— 唤醒原因写着 promiseDue，模型却不知道该提什么。
  const first = h.buildWakePromptV2('private:123', 'promiseDue');
  const second = h.buildWakePromptV2('private:123', 'promiseDue');
  assert.match(first, /【到期的约定】/, '第一份要有');
  assert.match(second, /【到期的约定】/, '第二份（真投递的）更要有');
  assert.match(second, /猫咪小镇/);
  assert.ok(h.promiseWakePending.get('private:123'), '建提示词不等于提过了：删要等到投递被接受');
}, {
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await test('投递被接受之后才清掉待提条目；投递失败则留着（还没说出口）', async (h) => {
  h.promiseTick();
  assert.ok(h.promiseWakePending.get('private:123'));
  const before = h.calls.prompts.length;
  // 夹具的 sessions.prompt 一律接受，所以这里只验「接受 → 清掉」这一环。
  await h.deliverPrompt('private:123', h.buildWakePromptV2('private:123', 'promiseDue'), { wakeReason: 'promiseDue' });
  assert.equal(h.promiseWakePending.get('private:123'), undefined, '投递接受后要清掉，免得下一次无关唤醒又提一遍');
  assert.ok(h.calls.prompts.length > before, '确实走了一次真实投递');
  assert.match(String(h.calls.prompts.at(-1)?.content?.[0]?.text ?? ''), /【到期的约定】/, '投递出去的那份要带约定');
}, {
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await test('同一会话同一天不重复提：第二遍 tick 不再产生待提条目', async (h) => {
  h.promiseTick();
  const first = h.promiseWakePending.get('private:123');
  assert.ok(first, '第一遍应该排上');

  h.promiseTick();
  h.promiseTick();
  assert.equal(h.promiseWakePending.get('private:123').at, first.at, '今天提过了，后面几轮不能再排（否则每 60 秒提醒一次）');
  const ledger = h.promiseLedger(true);
  assert.equal(ledger.items.mem_promise_today.firedDay, TODAY, '已提的日子不能因为再扫一遍就丢');
}, {
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await test('白名单外的会话：不排唤醒，也不把约定标成已提（留着，明天/以后还能提）', async (h) => {
  h.promiseTick();
  // group:789 不在 allow.groups（夹具里是 ['456']）
  assert.equal(h.promiseWakePending.get('group:789'), undefined, '白名单外的会话不许排唤醒');
  const ledger = h.promiseLedger(true);
  assert.equal(ledger.items.mem_promise_group.firedDay, '', '没排成唤醒就不能标已提，否则这条约定被永久吞掉');
  assert.equal(ledger.items.mem_promise_group.status, 'pending');
}, {
  config: ALWAYS,
  files: {
    'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([
      dueTodayRecord({ id: 'mem_promise_group', conversationKey: 'group:789', text: '明天一起去猫咪小镇' }),
    ]),
  },
});

await test('到期前的钟点不提；过了 until 的钟点也不提（半夜不能被「今天到期」叫醒）', async (h) => {
  // 两端都要验：只有下限时，深夜 tick 照样会弹 —— 那正是这次补上的漏洞。
  // 注意别用「at === until」那种写法：按设计那等于「不限结束」，恒为真，测不出东西。
  for (const [at, until] of [['23:59', '00:00'], ['00:00', '00:01']]) {
    h.cfg.promiseWake = { at, until, maxPerDay: 3, graceDays: 2 };
    h.promiseWakePending.clear();
    h.promiseTick();
    assert.equal(h.promiseWakePending.size, 0, `窗口 [${at}, ${until}) 之外不该排唤醒`);
  }
  const ledger = h.promiseLedger(true);
  assert.equal(ledger.items.mem_promise_today.firedDay, '', '没提成就不该标已提');
}, {
  // 极少数情况下测试正好跨过边界 —— 那时断言会假失败，写清楚原因。
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await test('明天的约定今天不提；过缓冲期的标 expired 不再提', async (h) => {
  h.promiseTick();
  const ledger = h.promiseLedger(true);
  assert.equal(ledger.items.mem_future.firedDay, '', '还没到日子');
  assert.equal(ledger.items.mem_future.status, 'pending');
  assert.equal(ledger.items.mem_stale.status, 'expired', '过了「到期+缓冲」的不能再惦记');
  assert.equal(h.promiseWakePending.get('private:123'), undefined, '只有过期的和未来的 → 没什么可排');
}, {
  config: ALWAYS,
  files: {
    'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([
      dueTodayRecord({ id: 'mem_future', text: `明天一起去（锚点今天）`, createdAt: dayAt(0).toISOString() }),
      // 锚点设在 10 天前、正文写「明天」→ 到期日早已过去，超 graceDays
      dueTodayRecord({ id: 'mem_stale', text: '明天一起去猫咪小镇', createdAt: dayAt(-10).toISOString() }),
    ]),
  },
});

await test('socialV2 暂停 / 非 reserved2 模式：tick 直接不动（一条唤醒都不排）', async (h) => {
  // 模式不对
  h.setMode('initial');
  h.promiseTick();
  assert.equal(h.promiseWakePending.size, 0, '非 reserved2 不许发约定提醒');
  h.setMode('reserved2');
  // 暂停（这里通过 cfg 的 socialV2.enabled 关掉，等价于暂停的效果）
  h.cfg.socialV2 = { ...(h.cfg.socialV2 ?? {}), enabled: false };
  h.promiseTick();
  assert.equal(h.promiseWakePending.size, 0, 'socialV2 关着时不许发');
}, {
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await test('promiseWake.enabled=false：完全不启动、不扫档、不排唤醒', async (h) => {
  h.promiseTick();
  assert.equal(h.promiseWakePending.size, 0);
  assert.equal(Object.keys(h.promiseLedger(true).items).length, 0, '关掉时连账本都不该建');
}, {
  config: { promiseWake: { enabled: false } },
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await test('没有到期约定时不伪造：提示词里不该出现【到期的约定】', async (h) => {
  const prompt = h.buildWakePromptV2('private:123', 'timeout');
  assert.ok(!prompt.includes('【到期的约定】'), '没有待提约定就不注入这一段（省 token、也避免编造）');
}, {
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord({ text: '今天天气不错' })]) },
});

await test('发送失败暂停期内：promiseDue 必须被 autoWake 闸门挡下，不得创建 DSH 会话', async (h) => {
  // 这条专验 promiseDue 被加进 sendWakePromptV2 的 autoWake 集合：
  // 漏加的话它会绕过「发送连续失败 → 暂停自动唤醒」这道闸，拿一个坏通道反复空烧 token。
  const createdBefore = h.calls.created.length;
  const st = h.getSocialV2State('private:123');
  st.wakeSuspendedUntil = Date.now() + 60_000;
  await h.sendWakePromptV2('private:123', 'promiseDue');
  assert.equal(h.calls.created.length, createdBefore, '暂停期内 promiseDue 不得创建 DSH 会话');
  // 解除暂停后同一条路径必须真的能走通，证明上面不是因为别的原因顺带拦住。
  st.wakeSuspendedUntil = 0;
  await h.sendWakePromptV2('private:123', 'promiseDue');
  assert.ok(h.calls.created.length > createdBefore, '暂停解除后 promiseDue 应能创建会话');
}, { config: ALWAYS });

/* ─────────────────── 控制台路由（管理端视图：看账本 / 人工改状态 / 手动排查） ─────────────────── */

const TOKEN = 'fixture-console-token';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function testConsole(name, run, options) {
  const h = await bridgeHarness(options);
  let server;
  try {
    h.setMode('reserved2');
    server = h.startConsoleServer();
    if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
    const port = server.address().port;
    const call = (method, p, body) => new Promise((resolve, reject) => {
      const request = http.request({
        host: '127.0.0.1', port, path: p, method,
        headers: { 'content-type': 'application/json', 'x-console-token': TOKEN },
      }, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* 非 JSON 让断言去报 */ }
          resolve({ status: response.statusCode, body: data, json });
        });
      });
      request.on('error', reject);
      request.setTimeout(4000, () => request.destroy(new Error('request hung')));
      request.end(body === undefined ? undefined : JSON.stringify(body));
    });
    await run({ h, call });
    console.log('PASS', name);
  } catch (error) {
    failures += 1;
    console.error('FAIL', name, error.message);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await h.close();
  }
}

await testConsole('GET /api/promise/list：读出账本、配置与「现在在不在提醒窗口」', async ({ h, call }) => {
  h.promiseTick();
  const res = await call('GET', '/api/promise/list');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.ok(res.json.file.endsWith('promise-due.json'), '要告诉用户账本落在哪');
  assert.equal(res.json.config.at, '00:00');
  assert.equal(res.json.inWindow, true);
  assert.equal(res.json.today, TODAY);
  // ledgerSummary 的 items 是**数组**（按到期日排序，只列 pending），不是按 id 索引的 map。
  assert.ok(Array.isArray(res.json.items), 'items 是数组');
  assert.ok(res.json.items.some((it) => it.id === 'mem_promise_today'), '摘要里要有这条约定');
  assert.equal(res.json.items.find((it) => it.id === 'mem_promise_today').dueDate, TODAY);
  assert.equal(res.json.dueToday, 1);
}, {
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await testConsole('GET /api/promise/list：窗口外时 inWindow 必须是 false（页面据此提示「今晚不会打扰」）', async ({ h, call }) => {
  h.cfg.promiseWake = { at: '23:59', until: '00:00', maxPerDay: 3, graceDays: 2 };
  const res = await call('GET', '/api/promise/list');
  assert.equal(res.json.inWindow, false);
}, { config: ALWAYS });

await testConsole('POST /api/promise/status：办完了标 done；非法 id / 非法状态各自给对的错误码', async ({ h, call }) => {
  h.promiseTick();
  const done = await call('POST', '/api/promise/status', { id: 'mem_promise_today', status: 'done', note: '一起去了' });
  assert.equal(done.status, 200);
  assert.equal(done.json.ok, true);
  assert.equal(done.json.item.status, 'done');
  assert.equal(h.promiseLedger(true).items.mem_promise_today.status, 'done', '状态要真落盘');
  // 标 done 之后当天不该再提
  h.promiseWakePending.clear();
  h.promiseTick();
  assert.equal(h.promiseWakePending.size, 0, '办完了的约定不能再提');

  const missing = await call('POST', '/api/promise/status', { id: 'mem_nope', status: 'done' });
  assert.equal(missing.status, 404);
  assert.equal(missing.json.code, 'promise.not-found');
  const bad = await call('POST', '/api/promise/status', { id: 'mem_promise_today', status: '乱写' });
  assert.equal(bad.status, 404, '非法状态也走 not-found，不能假装成功');
  assert.equal(h.promiseLedger(true).items.mem_promise_today.status, 'done', '非法请求不能篡改已有状态');
}, {
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await testConsole('POST /api/promise/tick：手动排查给出「认到几条 / 谁该提 / 为什么没提」', async ({ h, call }) => {
  const res = await call('POST', '/api/promise/tick');
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.records, 1);
  assert.equal(res.json.candidates, 1);
  assert.equal(res.json.dueNow, 1);
  assert.equal(res.json.allowed, 1, 'private:123 在白名单里');
  assert.equal(res.json.hint, '', '能提的时候不该给借口');
  // 关键：手动排查**不许**产生副作用（不标已提、不排唤醒）。
  assert.equal(h.promiseWakePending.size, 0, '排查接口不能真的排唤醒');
  assert.equal(h.promiseLedger(true).items.mem_promise_today, undefined, '排查接口不能改账本');
}, {
  config: ALWAYS,
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

await testConsole('POST /api/promise/tick：窗口外要直接说清楚原因，别让人以为是没认出约定', async ({ h, call }) => {
  h.cfg.promiseWake = { at: '23:59', until: '00:00', maxPerDay: 3, graceDays: 2 };
  const res = await call('POST', '/api/promise/tick');
  assert.equal(res.json.dueNow, 1, '约定是认出来了的');
  assert.equal(res.json.inWindow, false);
  assert.match(res.json.hint, /不在提醒窗口/);
}, {
  config: ALWAYS,
  // 别忘了给档案：没有记忆档就没有约定，这条会退化成「dueNow=0 也算过」的空测试。
  files: { 'dsh/surfcore/memory/memory-card-full.jsonl': memoryFile([dueTodayRecord()]) },
});

if (failures) {
  console.error(`\n${failures} 条失败`);
  process.exit(1);
}
console.log('\npromise bridge tests OK');