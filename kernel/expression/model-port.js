/**
 * 模型端口：内核只认识"一个能说话的接口"，不认识具体是哪个模型
 * ============================================================================
 * 这是架构法则 11 的又一次落地：**内核不认识外部世界，只认识接口**。
 *   · 真模型（任何 API）在接入时实现 complete()
 *   · 测试用 createScriptedModel（按剧本回答）
 *   · 离线演示用 createRuleModel（不联网也能端到端跑）
 *
 * 契约（很小，故意很小）：
 *   complete({ messages, tools? }) → { text?, toolCalls?: [{name, args}] }
 */

/** 校验一个模型端口是否可用 */
export function validateModelPort(port) {
  const ok = Boolean(port) && typeof port.complete === 'function';
  return { ok, errors: ok ? [] : ['模型端口必须实现 complete()'] };
}

/** 把各种形状的返回值收敛成统一形状 */
export function normalizeCompletion(out = {}) {
  if (typeof out === 'string') return { text: out, toolCalls: [] };
  return {
    text: typeof out.text === 'string' ? out.text : '',
    toolCalls: Array.isArray(out.toolCalls) ? out.toolCalls : [],
  };
}

/** 按剧本回答（测试用）：每次调用取一条，用完了返回空 */
export function createScriptedModel(script = []) {
  const queue = [...script];
  return {
    async complete() {
      const next = queue.shift();
      return normalizeCompletion(next ?? { text: '' });
    },
    remaining: () => queue.length,
  };
}

/** 把消息 content（字符串或"文本+图片"数组）里的文字取出来；离线模型只认文字 */
export function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part && (part.type === 'text' || typeof part.text === 'string'))
    .map((part) => String(part.text ?? ''))
    .join('\n');
}

/**
 * 离线规则模型（演示用，明确标注"不是真模型"）。
 * 它只做三件简单事：被问就答、被叫就应、其他时候偶尔接一句。
 * 注意：它看不见图；图段会被忽略，只读文字。
 */
export function createRuleModel({ name = '她' } = {}) {
  return {
    async complete({ messages = [] } = {}) {
      const last = textOfContent([...messages].reverse().find((m) => m.role === 'user')?.content ?? '');
      const said = last.split('\n').pop() ?? '';

      if (/在吗|在不在|在\?|你好|hi\b/i.test(said)) return { text: `${name}在呀。` };
      if (/晚安|睡了|睡觉/.test(said)) return { text: '晚安，做个好梦。' };
      if (/[?？]$/.test(said)) return { text: '我想想……这个我还真不太确定。' };
      if (said.length <= 3) return { text: '嗯。' };
      // 大多数时候不说话（真实场景里她也不会每句都接）
      return { text: '[沉默]' };
    },
  };
}
