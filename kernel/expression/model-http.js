/**
 * HTTP 模型端口：把"任意兼容 chat/completions 的服务"接成内核认识的 complete()
 * ============================================================================
 * 这是 model-port 的一个**实现**，不是内核的一部分：
 *   · 内核只认 { complete(messages, tools) → { text, toolCalls } }
 *   · 具体是哪个厂商、哪个地址、什么鉴权，全在这个文件里，换掉它内核一行不改
 *   · 不写死任何厂商名：endpoint 由调用方给
 *
 * 三条规矩：
 *   ① **超时可重试**（模型调用没有副作用，重试安全）
 *   ② **鉴权失败不重试**（重试只是再撞一次墙），并给出下一步
 *   ③ 返回值一律收敛成 { text, toolCalls }，上层不需要知道厂商格式
 */
import { normalizeCompletion } from './model-port.js';
import { normalizeUsage, totalTokensOf } from '../support/ledger.js';

/**
 * @param {object} opts
 *   { endpoint, apiKey, model, fetchImpl, timeoutMs=30000, temperature=0.8, maxOutputTokens }
 */
export function createHttpModelPort({
  endpoint,
  apiKey = '',
  model,
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
  temperature = 0.8,
  maxOutputTokens = 1024,
} = {}) {
  if (!endpoint) throw new Error('模型端口需要 endpoint（地址由调用方给，不写死厂商）');
  if (!model) throw new Error('模型端口需要 model（模型名由调用方给）');

  const url = String(endpoint).replace(/\/+$/, '');

  return {
    name: 'http',

    /**
     * @param {object} req { messages, tools }
     * @returns {{text:string, toolCalls:Array}|{error:object}}
     */
    async complete({ messages = [], tools = [] } = {}) {
      if (typeof fetchImpl !== 'function') {
        return { error: { code: 'model.no-fetch', message: '没有可用的 fetch', retryable: false } };
      }

      const body = {
        model,
        messages,
        temperature,
        max_tokens: maxOutputTokens,
      };
      if (Array.isArray(tools) && tools.length) {
        body.tools = tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      let res;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        const msg = String(error?.message ?? error);
        const isTimeout = /timeout|abort/i.test(msg);
        return {
          error: {
            code: isTimeout ? 'model.timeout' : 'model.network',
            message: msg,
            retryable: true,
            hint: isTimeout ? '模型超时：可以重试（调用没有副作用）' : '连不上模型服务：检查地址与网络',
          },
        };
      }

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const unauthorized = res.status === 401 || res.status === 403;
        return {
          error: {
            code: unauthorized ? 'model.unauthorized' : 'model.http',
            status: res.status,
            message: String(payload?.error?.message ?? payload?.message ?? `HTTP ${res.status}`),
            retryable: !unauthorized,
            hint: unauthorized ? '密钥/权限不对：换一个 key 或检查模型是否开通' : '模型服务报错：可重试，持续失败看服务状态',
          },
        };
      }

      const choice = payload?.choices?.[0]?.message ?? {};
      const toolCalls = (choice.tool_calls ?? []).map((c) => ({
        name: c?.function?.name,
        args: parseArgs(c?.function?.arguments),
      }));

      const out = normalizeCompletion({ text: choice.content ?? '', toolCalls });
      if (!out.text && !out.toolCalls.length) {
        return {
          error: { code: 'model.empty', message: '模型返回空内容', retryable: true, hint: '重试一次；持续为空就检查提示词与模型' },
        };
      }
      // 用量是**供应商回报的事实**：有就原样交上去，没有就不编。
      // 归一化在这里做一次，上层（账本）不需要认识任何厂商的字段名。
      const usage = normalizeUsage(payload?.usage);
      if (totalTokensOf(usage)) out.usage = usage;
      return out;
    },
  };
}

/** 工具参数是 JSON 字符串；坏了就当空对象（不因为一个坏参数整轮失败） */
function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}
