/**
 * 表达层：把"模型说了什么"变成"她要做什么"
 * ============================================================================
 * 它只做三件事：
 *   ① 拼提示词（prompt.js）
 *   ② 调模型（model-port.js）
 *   ③ 把输出解析成意图（tools.js）——**工具调用优先**，其次才是纯文本
 *
 * 它不发消息、不认识渠道、不碰存储。
 */
import { buildPrompt, toMessages } from './prompt.js';
import { normalizeCompletion } from './model-port.js';
import { intentsFromCompletion, toolSchema, findTool } from './tools.js';
import { fitPrompt } from './context-budget.js';
import { buildVisionParts } from './vision.js';

export { estimateTokens, trimToTokens, fitPrompt } from './context-budget.js';
export { createHttpModelPort } from './model-http.js';

export { SILENT_MARKER } from './prompt.js';
export { TOOLS, toolSchema, resolveToolCall, intentsFromCompletion } from './tools.js';

/**
 * @param {object} deps
 *   { model, identity, extraTools?（接入时追加的"数据类"工具声明）,
 *     execute?（执行数据类工具：async (name, args) → 结果，由组装层注入）,
 *     onUsage?（模型回报了真实用量时回调：({usage, step}) → void；账本由组装层接）,
 *     maxSteps?（工具往返最多几轮，默认 3） }
 */
export function createExpression({ model, identity, extraTools = [], execute = null, onUsage = null, maxSteps = 3, maxTokens = 3000, reserveForOutput = 512 } = {}) {
  if (!model || typeof model.complete !== 'function') {
    throw new Error('表达层需要一个模型端口（实现 complete()）');
  }

  return {
    /** 给模型看的工具面（内置 + 接入时追加的） */
    tools() {
      return [...toolSchema(), ...extraTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))];
    },

    /**
     * 让她对这条消息做出反应。
     * **工具往返**：模型可以先调"数据类"工具（读消息/看群信息），拿到结果再继续，
     * 最多 maxSteps 轮；产生意图的工具（说话/发媒体/收尾…）结束这一轮。
     * @returns {{intents:Array, errors:Array, raw:object, prompt:object, usage:object, steps?:number}}
     */
    async respond({ event = {}, viewer = {}, memoryBlock = null, history = '', glossary = '', mediaBrief = '', selfBrief = '', turn = 0, images = [] } = {}) {
      const rawPrompt = buildPrompt({ identity, memoryBlock, history, glossary, mediaBrief, selfBrief, viewer, event });
      // 上下文预算：人格不剪，先剪记忆，再剪正文（见 context-budget.js）
      const fitted = fitPrompt({ system: rawPrompt.system, user: rawPrompt.user, maxTokens, reserveForOutput });
      const prompt = { system: fitted.system, user: fitted.user };
      const usage = { tokens: fitted.tokens, trimmed: fitted.trimmed };

      let messages = toMessages(prompt, { images });
      let steps = 0;
      /** 记账失败不能拖垮对话，但也不许静默：随 errors 一起交上去 */
      const usageErrors = [];

      while (steps < Math.max(1, Number(maxSteps) || 1)) {
        steps += 1;
        const completion = await model.complete({ messages, tools: this.tools() });
        // 模型端口可以返回 { error }（比如鉴权失败）：不抛、不假装成功，交给上层
        if (completion && completion.error) {
          return { intents: [], errors: [completion.error, ...usageErrors], raw: { text: '', toolCalls: [] }, prompt, usage, modelError: completion.error, steps };
        }

        // 模型给了真实用量 → 交给组装层记进账本（价格/落盘都不是表达层的事）
        if (completion?.usage && typeof onUsage === 'function') {
          try {
            onUsage({ usage: completion.usage, step: steps, turn });
          } catch (error) {
            usageErrors.push({ code: 'usage.record-failed', message: String(error?.message ?? error), hint: '这次用量没记上：看账本/存储是否可用' });
          }
        }

        const out = normalizeCompletion(completion);
        const calls = Array.isArray(out.toolCalls) ? out.toolCalls : [];

        // 把"意图类"和"数据类"分开：认得的（say/send_media/…）产生意图，
        // 认不得的（get_msg/get_group_info…）交给执行器，拿到结果再问一遍。
        const intentCalls = calls.filter((c) => findTool(c?.name));
        const dataCalls = calls.filter((c) => c && !findTool(c.name));

        if (dataCalls.length && typeof execute === 'function') {
          // 把模型这次的工具调用原样记进对话（OpenAI 兼容格式），再逐条回灌结果
          messages = [...messages, { role: 'assistant', content: out.text ?? '', tool_calls: dataCalls.map((c, i) => ({ id: `call_${steps}_${i}`, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args ?? {}) } })) }];
          const toolImages = [];
          for (const [i, call] of dataCalls.entries()) {
            let content;
            try {
              const raw = await execute(call.name, call.args ?? {}, { viewer, event, steps });
              // 工具可以带回图片字节（比如"取这条消息的图"）：字节不进 JSON，
              // 换成一条"工具取回的图片"的 user 消息再问模型（兼容性最好）。
              const media = Array.isArray(raw?.media) ? raw.media : [];
              let result = raw;
              if (media.length) {
                const vision = buildVisionParts(
                  media.map((m, k) => ({ id: `tool_${steps}_${i}_${k}`, kind: m.kind ?? 'image', bytes: m.bytes, caption: m.caption ?? '' })),
                  { readBytes: null },
                );
                toolImages.push(...vision.parts);
                if (vision.dropped.length) result = { ...raw, mediaDropped: vision.dropped };
              }
              const { media: _ignored, ...rest } = result ?? {};
              content = JSON.stringify(rest).slice(0, 4000);
            } catch (error) {
              content = JSON.stringify({ ok: false, error: String(error?.message ?? error) }).slice(0, 4000);
            }
            messages = [...messages, { role: 'tool', tool_call_id: `call_${steps}_${i}`, name: call.name, content }];
          }
          if (toolImages.length) {
            messages = [...messages, {
              role: 'user',
              content: [{ type: 'text', text: '（工具取回的图片）' }, ...toolImages],
            }];
          }
          continue;   // 带着工具结果再问模型一次
        }

        if (dataCalls.length) {
          // 没有执行器：如实告诉模型"这个工具不能用"，让它改用别的（不再直接报错中断）
          messages = [...messages, { role: 'assistant', content: out.text ?? '', tool_calls: dataCalls.map((c, i) => ({ id: `call_${steps}_${i}`, type: 'function', function: { name: c.name, arguments: '{}' } })) }];
          for (const [i, call] of dataCalls.entries()) {
            messages = [...messages, { role: 'tool', tool_call_id: `call_${steps}_${i}`, name: call.name, content: JSON.stringify({ ok: false, error: '这个工具当前不可用' }) }];
          }
          continue;
        }

        const parsed = intentsFromCompletion({ text: out.text, toolCalls: intentCalls });
        return { intents: parsed.intents, errors: [...parsed.errors, ...usageErrors], raw: { text: out.text, toolCalls: calls }, prompt, usage, steps };
      }

      // 往返用尽：不硬编，交给她沉默
      return { intents: [{ kind: 'stay_silent', reason: '工具往返步数用尽' }], errors: [...usageErrors], raw: { text: '', toolCalls: [] }, prompt, usage, steps, exhausted: true };
    },
  };
}
