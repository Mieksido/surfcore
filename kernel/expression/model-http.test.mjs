/**
 * HTTP 模型端口测试（注入假 fetch，不联网）
 * 跑法：node kernel/expression/model-http.test.mjs
 */
import { createHttpModelPort } from './model-http.js';

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log('  ✅', n); } else { fail++; console.error('  ❌', n); } };

const okJson = (payload) => async () => ({ ok: true, status: 200, json: async () => payload });
const badJson = (status, payload) => async () => ({ ok: false, status, json: async () => payload });

console.log('## 正常返回');
{
  const port = createHttpModelPort({
    endpoint: 'http://model/v1/chat/completions',
    model: 'm1',
    fetchImpl: okJson({ choices: [{ message: { content: '你好呀' } }] }),
  });
  const out = await port.complete({ messages: [{ role: 'user', content: 'hi' }] });
  ok(out.text === '你好呀', '文本被取出');
  ok(Array.isArray(out.toolCalls) && out.toolCalls.length === 0, '没有工具调用：空数组');
}

console.log('\n## 工具调用');
{
  const port = createHttpModelPort({
    endpoint: 'http://model',
    model: 'm1',
    fetchImpl: okJson({ choices: [{ message: { content: '', tool_calls: [{ function: { name: 'say', arguments: '{"text":"说的"}' } }] } }] }),
  });
  const out = await port.complete({ messages: [], tools: [{ name: 'say', description: 'd', parameters: {} }] });
  ok(out.toolCalls[0].name === 'say', '工具名被取出');
  ok(out.toolCalls[0].args.text === '说的', 'JSON 字符串参数被解析成对象');
}

console.log('\n## 坏参数不炸');
{
  const port = createHttpModelPort({
    endpoint: 'http://model', model: 'm1',
    fetchImpl: okJson({ choices: [{ message: { tool_calls: [{ function: { name: 'say', arguments: '{坏JSON' } }] } }] }),
  });
  const out = await port.complete({ messages: [] });
  ok(out.toolCalls[0].args && typeof out.toolCalls[0].args === 'object', '坏参数：当空对象，不整轮失败');
}

console.log('\n## 真实用量：有就交上去，没有就不编');
{
  const withUsage = createHttpModelPort({
    endpoint: 'http://model', model: 'm1',
    fetchImpl: okJson({
      choices: [{ message: { content: '好' } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 60 } },
    }),
  });
  const out = await withUsage.complete({ messages: [] });
  ok(out.usage.cacheHit === 60, '命中桶从 cached_tokens 归一');
  ok(out.usage.cacheMiss === 40, '未命中 = prompt - cached');
  ok(out.usage.output === 20, '输出桶');
  ok(out.text === '好', '文本照旧，不受 usage 影响');

  const noUsage = createHttpModelPort({
    endpoint: 'http://model', model: 'm1',
    fetchImpl: okJson({ choices: [{ message: { content: '好' } }] }),
  });
  const plain = await noUsage.complete({ messages: [] });
  ok(plain.usage === undefined, '供应商没报用量：不编一个 0');
}

console.log('\n## 图片消息：原样发给兼容服务');
{
  let body = null;
  const port = createHttpModelPort({
    endpoint: 'http://model', model: 'm1',
    fetchImpl: async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '看到了' } }] }) };
    },
  });
  const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,xx' } };
  const out = await port.complete({ messages: [{ role: 'user', content: [{ type: 'text', text: '看图' }, image] }] });
  ok(out.text === '看到了', '带图调用：成功');
  ok(Array.isArray(body.messages[0].content) && body.messages[0].content[1].type === 'image_url', '图片段原样进请求体');
}

console.log('\n## 鉴权失败：不重试 + 给下一步');
{
  const port = createHttpModelPort({
    endpoint: 'http://model', model: 'm1',
    apiKey: 'bad', fetchImpl: badJson(401, { error: { message: 'invalid key' } }),
  });
  const out = await port.complete({ messages: [] });
  ok(out.error.code === 'model.unauthorized', '401：结构化错误码');
  ok(out.error.retryable === false, '401：不可重试（重试只是再撞一次墙）');
  ok(String(out.error.hint).includes('密钥'), '401：提示检查密钥');
}

console.log('\n## 网络/超时：可重试（模型调用无副作用）');
{
  const netPort = createHttpModelPort({ endpoint: 'http://m', model: 'm1', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  const n = await netPort.complete({ messages: [] });
  ok(n.error.code === 'model.network' && n.error.retryable === true, '网络错误：可重试');

  const toPort = createHttpModelPort({ endpoint: 'http://m', model: 'm1', fetchImpl: async () => { throw new Error('The operation was aborted due to timeout'); } });
  const t = await toPort.complete({ messages: [] });
  ok(t.error.code === 'model.timeout' && t.error.retryable === true, '超时：可重试，且有下一步');
}

console.log('\n## 空回复与参数校验');
{
  const port = createHttpModelPort({ endpoint: 'http://m', model: 'm1', fetchImpl: okJson({ choices: [{ message: { content: '' } }] }) });
  const out = await port.complete({ messages: [] });
  ok(out.error.code === 'model.empty' && out.error.retryable === true, '空内容：当成可重试的空回复');

  let threw = 0;
  try { createHttpModelPort({ model: 'm1' }); } catch { threw += 1; }
  try { createHttpModelPort({ endpoint: 'http://m' }); } catch { threw += 1; }
  ok(threw === 2, '缺 endpoint 或 model：直接报错（不写死厂商/模型）');

  ok(!/openai|anthropic|deepseek/i.test(createHttpModelPort.toString()), '端口实现里不写死任何厂商名');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
