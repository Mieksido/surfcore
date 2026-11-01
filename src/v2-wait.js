// 二代仿真模式：等待/结束回合相关的轻量判断工具。
// 这些是“提示/软信号”，不是硬规则；最终是否等待、是否发催话仍由 AI 自主决定。

// 常见“话说一半/没说完”的结尾特征。
const UNFINISHED_TAIL_RE = /(?:你知道|等一下|我跟你讲|其实吧|但是|所以说|然后|那个|就是|我想说|对了|等我|等等|我看看|还有|再说|主要是|毕竟|因为|所以|但是吧|回头|回头说|待会|晚点|等会|再说吧)$/;

// 以中文逗号/顿号/分号/冒号等“非终止标点”结尾，也常表示还没说完。
const UNFINISHED_PUNCT_RE = /[，、；：,;:]$/;

// 明确以终止标点/省略号结尾的消息视为说完。
const FINISHED_TAIL_RE = /[。！？!?…～~]+$/;

export function looksLikeUnfinished(text) {
  const s = String(text ?? '').trim();
  if (!s) return false;
  if (FINISHED_TAIL_RE.test(s)) return false;
  if (UNFINISHED_TAIL_RE.test(s)) return true;
  if (UNFINISHED_PUNCT_RE.test(s)) return true;
  return false;
}

// AI 等不到下文时可以用的“催话”短句。
export const UNFINISHED_PROMPT_REPLIES = ['什么', '啥', '你说啊', '然后呢', '？'];

// 建议的“结束前再等一轮”的等待时长范围（毫秒）。
export const END_ROUND_WAIT_MIN_MS = 5 * 60 * 1000;
export const END_ROUND_WAIT_MAX_MS = 10 * 60 * 1000;

/**
 * wait 返回有界批量：群聊积压几百条时，不把整段历史塞回模型。
 * 优先级由调用方传入（主人/引用自己/直接叫自己/拍自己）；
 * 其余用最近消息补足，超出条数/字符的折叠。
 */
export function selectWaitBatch(messages, {
  maxMessages = 20,
  maxChars = 4000,
  isImportant = () => false,
} = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const maxN = Math.max(1, Math.min(50, Number(maxMessages) || 20));
  const maxC = Math.max(500, Math.min(20000, Number(maxChars) || 4000));
  const important = (m) => Boolean(m && isImportant(m));
  const picked = new Set();
  for (const m of list) {
    if (picked.size >= maxN) break;
    if (important(m)) picked.add(m);
  }
  for (let i = list.length - 1; i >= 0 && picked.size < maxN; i -= 1) picked.add(list[i]);
  const selected = list.filter((m) => picked.has(m));
  const sizeOf = (m) => String(m?.plain || m?.text || '').length + 24;
  let total = selected.reduce((sum, m) => sum + sizeOf(m), 0);
  while (total > maxC && selected.length > 1) {
    let idx = selected.findIndex((m) => !important(m));
    if (idx < 0) idx = 0;
    total -= sizeOf(selected[idx]);
    selected.splice(idx, 1);
  }
  const chosen = new Set(selected);
  return { selected, folded: list.filter((m) => !chosen.has(m)) };
}
