/**
 * QQ 提问的回答编码（纯函数，便于单测）。
 *
 * DSH 的硬约束（`node_modules/@deepseek-ai/dsh-host-apiproxy/lib/index.js:1316-1318`，
 * 以及 `dsh-host-apiproxy/README.zh.md:25`）：
 *   · 多选题：`selected` 与 `custom` **可以**并存；
 *   · 单选题：`selected` 与 `custom` **只能二选一**，否则整批答案被 DSH 判 `bad-response`。
 *
 * 所以来源标注（“谁回答的、是不是主人”）按题目的选择模式分开编码：
 *   · 多选：保留用户选中的标签，`custom` 只放来源；
 *   · 单选：把「选项文字 + 来源」一起放进 `custom`，`selected` 留空（方案 A，2026-10-29 用户拍板）。
 * 来源由桥接按真实发送者填写，群友/模型无法伪造。
 */

export const OWNER_ONLY_TAG = '[仅主人]';

/** 一帧里任一问题带 [仅主人] → 整帧按 owner-only 处理。 */
export function isOwnerOnlyFrame(questions) {
  return Array.isArray(questions)
    && questions.some((q) => String(q?.header ?? '').includes(OWNER_ONLY_TAG));
}

/**
 * 当前消息能不能消费这个 pending。
 * · approval：只有主人能消费（非主人消息继续走正常群聊，不吞）；
 * · question：普通提问谁都能答；带 [仅主人] 的只有主人能答。
 */
export function canConsumePending(pending, isOwner) {
  if (!pending) return false;
  if (pending.kind === 'approval') return isOwner === true;
  if (pending.kind === 'question') return isOwner === true || pending.ownerOnly !== true;
  return false;
}

/** 程序填的来源说明（给模型看的上下文，不是权限凭证）。 */
export function responderNote({ isOwner = false, sender = '' } = {}) {
  const name = String(sender ?? '').trim().slice(0, 40) || '未知';
  return isOwner ? '【回答者：管理员】' : `【回答者：群友「${name}」（非管理员）】`;
}

/**
 * 把一条 QQ 文本回答编码成 DSH 的 answers 数组。
 * 每个问题都按现有交互“用同一段文字回答”，与桥接旧行为一致。
 */
export function buildQuestionAnswers(pending, answerText, { isOwner = false, sender = '' } = {}) {
  const text = String(answerText ?? '').trim();
  const note = responderNote({ isOwner, sender });
  const answers = [];
  for (const q of pending?.questions ?? []) {
    const options = Array.isArray(q?.options) ? q.options : [];
    const hit = options.find((o) => String(o?.label ?? '').trim().toLowerCase() === text.toLowerCase());
    if (q?.multiSelect === true) {
      // 多选：selected 是合法的；custom 用来带来源（无选项命中时带原文）。
      answers.push({
        id: q.id,
        selected: hit ? [String(hit.label)] : [],
        custom: hit ? note : `${text}\n${note}`,
      });
    } else if (hit) {
      // 单选：selected 与 custom 不能并存 → 选项文字放进 custom，来源同段。
      answers.push({ id: q.id, selected: [], custom: `选项「${hit.label}」\n${note}` });
    } else {
      answers.push({ id: q.id, selected: [], custom: `${text}\n${note}` });
    }
  }
  return answers;
}
