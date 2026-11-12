/**
 * 工具面：她的"手"
 * ============================================================================
 * 核心设计（旧架构最需要改的一点）：
 *   旧：模型调渠道工具名 → 外部桥接直接发（工具 = 通道）
 *   新：模型调工具 → **表达层把工具调用变成"意图"** → 运行时 → 外部适配器真发
 *
 * 所以工具在这里只有一种身份：**表达器的输入**，不是第二条发送通道。
 *
 * 两类工具：
 *   · produces:'intent'  → 产生意图（说话/发媒体/记住/收尾/沉默）
 *   · produces:'data'    → 只读，把结果还给模型（不产生意图）
 *
 * 铁律：本文件不认识任何渠道。工具名里也不许出现渠道名。
 */
import { SILENT_MARKER } from './prompt.js';

/** 工具声明：name + 说明 + 参数 + 产出什么 */
export const TOOLS = Object.freeze([
  {
    name: 'say',
    description: '说一句话。要不要说、说什么由你决定。想用语音说就加 voice:true（能不能用由内核判断）。',
    parameters: {
      type: 'object',
      properties: { text: { type: 'string' }, voice: { type: 'boolean' } },
      required: ['text'],
    },
    produces: 'intent',
    build: (a = {}) => ({ kind: 'say', text: String(a.text ?? ''), ...(a.voice === true ? { voice: true } : {}) }),
  },
  {
    name: 'send_media',
    description: '发一张图 / 一段语音 / 一个表情。mediaId 来自你收到内容时附带的编号。',
    parameters: {
      type: 'object',
      properties: { mediaId: { type: 'string' }, kind: { type: 'string' }, caption: { type: 'string' } },
      required: ['mediaId'],
    },
    produces: 'intent',
    build: (a = {}) => ({
      kind: 'send_media',
      media: [{ id: String(a.mediaId), kind: String(a.kind ?? 'image') }],
      caption: String(a.caption ?? ''),
    }),
  },
  {
    name: 'send_sticker',
    description: '发一张收藏的表情。只给情绪（或标签），挑哪张由内核决定。',
    parameters: {
      type: 'object',
      properties: { emotion: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
    },
    produces: 'intent',
    // 这里**不查库**：工具只表达"我想发个表情"，挑哪张是内核的事（库在内核）
    build: (a = {}) => ({
      kind: 'send_media',
      sticker: { emotion: a.emotion ? String(a.emotion) : '', tags: Array.isArray(a.tags) ? a.tags.map(String) : [] },
      caption: '',
    }),
  },
  {
    name: 'save_sticker',
    description: '把对方发的这张图收进自己的收藏。mediaId 用收到内容时带的编号。',
    parameters: {
      type: 'object',
      properties: {
        mediaId: { type: 'string' },
        emotion: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
      },
      required: ['mediaId'],
    },
    produces: 'intent',
    build: (a = {}) => ({
      kind: 'collect_sticker',
      mediaId: String(a.mediaId ?? ''),
      emotion: a.emotion ? String(a.emotion) : '平淡',
      tags: Array.isArray(a.tags) ? a.tags.map(String) : [],
      note: String(a.note ?? ''),
    }),
  },
  {
    name: 'learn_word',
    description: '遇到不认识的说法，先记成候选（不会马上用，要管理员确认）。',
    parameters: {
      type: 'object',
      properties: { word: { type: 'string' }, context: { type: 'string' } },
      required: ['word'],
    },
    produces: 'intent',
    build: (a = {}) => ({ kind: 'learn_word', word: String(a.word ?? ''), context: String(a.context ?? '') }),
  },
  {
    name: 'remember',
    description: '把这件事记下来（只是候选，收不收由内核决定）。',
    parameters: { type: 'object', properties: { text: { type: 'string' }, importance: { type: 'number' } }, required: ['text'] },
    produces: 'intent',
    build: (a = {}) => ({ kind: 'remember', text: String(a.text ?? ''), importance: Number(a.importance) || 40 }),
  },
  {
    name: 'close',
    description: '这段聊完了：记下收在哪、下次怎么接。不发消息。',
    parameters: { type: 'object', properties: { summary: { type: 'string' }, nextOpening: { type: 'string' } } },
    produces: 'intent',
    build: (a = {}) => ({ kind: 'close', summary: String(a.summary ?? ''), nextOpening: String(a.nextOpening ?? '') }),
  },
  {
    name: 'stay_silent',
    description: '这次不说话（沉默是一个决定，不是失败）。',
    parameters: { type: 'object', properties: { reason: { type: 'string' } } },
    produces: 'intent',
    build: (a = {}) => ({ kind: 'stay_silent', reason: String(a.reason ?? '想了想，还是不说') }),
  },
]);

/** 给模型看的工具清单（只要声明，不含实现） */
export function toolSchema() {
  return TOOLS.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
}

/** 名字别名：旧工具叫 send_message，新工具叫 say */
const ALIASES = Object.freeze({ send_message: 'say' });

/** 找出一个工具的声明 */
export function findTool(name) {
  const key = ALIASES[String(name)] ?? String(name);
  return TOOLS.find((t) => t.name === key) ?? null;
}

/**
 * 把一次工具调用解析成意图。
 * @returns {{ok:true, intent:object} | {ok:false, code:string, error:string}}
 */
export function resolveToolCall(call = {}) {
  const tool = findTool(call.name);
  if (!tool) {
    return { ok: false, code: 'tool.unknown', error: `没有这个工具：${call.name}` };
  }
  const args = call.args && typeof call.args === 'object' ? call.args : {};
  const required = tool.parameters?.required ?? [];
  const missing = required.filter((k) => args[k] === undefined || args[k] === null || args[k] === '');
  if (missing.length) {
    return { ok: false, code: 'tool.missing-arg', error: `${tool.name} 缺少参数：${missing.join(', ')}` };
  }
  if (tool.produces !== 'intent') {
    return { ok: false, code: 'tool.not-intent', error: `${tool.name} 不产生意图` };
  }
  const intent = tool.build(args);
  if (intent.kind === 'say' && !String(intent.text).trim()) {
    return { ok: false, code: 'tool.empty-text', error: 'say 的 text 不能为空' };
  }
  return { ok: true, intent };
}

/**
 * 把模型的整段输出（文本或工具调用）解析成意图列表。
 * 规则：**工具调用优先**；没有工具调用时，把文本当"她要说的那句话"。
 * @returns {{intents:object[], errors:object[]}}
 */
export function intentsFromCompletion({ text = '', toolCalls = [] } = {}) {
  const intents = [];
  const errors = [];

  if (Array.isArray(toolCalls) && toolCalls.length) {
    for (const call of toolCalls) {
      const r = resolveToolCall(call);
      if (r.ok) intents.push(r.intent);
      else errors.push({ code: r.code, error: r.error, tool: call?.name });
    }
    if (intents.length) return { intents, errors };   // 工具调用成功就不再走纯文本
  }

  const plain = String(text ?? '').trim();
  if (!plain || plain.startsWith(SILENT_MARKER)) {
    intents.push({ kind: 'stay_silent', reason: '模型选择不说' });
  } else {
    intents.push({ kind: 'say', text: plain });
  }
  return { intents, errors };
}
