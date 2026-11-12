/**
 * 提示词组装：把"她是谁 + 她记得什么 + 现在什么情况"拼成一张纸
 * ============================================================================
 * 三个规矩：
 *   ① **不认识渠道名**（法则 11）：只说"这是群聊还是私聊""对方是不是主人"
 *   ② **只有一段记忆块**（读取器已经统一输出），这里不区分叙事还是向量
 *   ③ 便宜的先放前面：人格核心 → 记忆 → 现场（模型对开头更敏感）
 *
 * 拼出来的东西是纯文本，不含任何平台格式——渲染归平台包。
 */

/** 沉默标记：模型想"不说"时输出它，表达层会转成 stay_silent 意图 */
export const SILENT_MARKER = '[沉默]';

const AUDIENCE_LABEL = Object.freeze({ group: '一个群里', private: '私聊里' });

/**
 * @param {object} input
 *   { identity（内核身份服务）, memoryBlock（统一记忆块）, history（刚才的对话文本）, viewer, event, rules? }
 * @returns {{system:string, user:string}}
 */
export function buildPrompt({ identity, memoryBlock, history = '', glossary = '', mediaBrief = '', selfBrief = '', viewer = {}, event = {}, rules = [] } = {}) {
  const audience = viewer.kind === 'private' ? 'private' : 'group';
  const isOwner = viewer.isOwner === true;
  const who = event.from?.actor ? (isOwner ? '主人' : '有人') : '有人';
  const text = String(event.text ?? '');

  const layers = identity?.personaLayers ? identity.personaLayers({ audience }) : [];
  const system = [
    ...layers,
    '',
    '【怎么说话】',
    '- 用短句，像真人聊天，不要长篇大论。',
    '- 只说你确定知道的事；记不清就说不清，不要编。',
    '- 如果现在不适合说话，只输出 ' + SILENT_MARKER + ' 四个字，不要解释。',
    ...rules,
  ].filter((x) => x !== undefined).join('\n');

  const user = [
    selfBrief ? `${selfBrief}\n` : '',
    memoryBlock?.text ? `${memoryBlock.text}\n` : '',
    glossary ? `【群里的词】\n${glossary}\n` : '',
    history ? `【刚才】\n${history}\n` : '',
    mediaBrief ? `【对方发来的】\n${mediaBrief}\n` : '',
    `【现在】你在${AUDIENCE_LABEL[audience]}，${who}对你说：`,
    text,
  ].filter(Boolean).join('\n');

  return { system, user };
}

/** 把提示词压成模型端口要的消息数组。
 * 第二参 images：模型能看图时，user 消息从"一段文本"变成"文本 + 图片段"。
 * 没有图片时保持原来的纯字符串（所有旧模型端口都不用改）。
 */
export function toMessages(prompt, { images = [] } = {}) {
  const system = { role: 'system', content: prompt.system };
  const list = Array.isArray(images) ? images.filter(Boolean) : [];
  if (!list.length) return [system, { role: 'user', content: prompt.user }];
  return [system, {
    role: 'user',
    content: [
      { type: 'text', text: prompt.user },
      ...list,
    ],
  }];
}
