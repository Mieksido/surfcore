/**
 * 平台包：桌宠
 * ============================================================================
 * 桌宠的特点（旧代码 pet-* / pet-chat / pet-purpose）：
 *   · **本地进程**，靠长轮询拿事件（不是消息流）
 *   · **专注模式**：开着就绝不打扰（用户自己点的"别吵我"）
 *   · **载体互斥**：主动搭话由谁发，由内核判断；这个包只负责"如果轮到我就发"
 *   · 气泡有停留时间，过期就丢（不能堆成山）
 *
 * 这里把可离线的逻辑全写出来：气泡队列 + 专注门 + 语音决策。
 * 真正的长轮询通道留 push/attach 给接入时。
 */

export const identity = {
  publisher: 'surfcore',
  name: 'desktop-pet',
  version: '0.2.0',
  source: 'pet',
  channel: 'pet:main',
};

export const capabilities = {
  timing: 'realtime',
  shape: 'single',
  identityMode: 'known',
  direction: 'both',
  frequency: 'human',
  modality: 'multi',
  special: { recall: false, edit: false, readReceipt: true },
};

export const settings = [
  {
    key: 'pet.bubble.ttlMs', label: '气泡停留时间', description: '主动搭话的气泡挂多久', defaultValue: 12000,
    options: [6000, 12000, 30000], cost: '挂太久会烦人；太短看不清', group: 'basic',
  },
  {
    key: 'pet.voice.enabled', label: '主动搭话用语音', description: '主动时说话而不是弹字', defaultValue: false,
    options: [true, false], cost: '语音更亲近，但会更吵', group: 'basic',
  },
  {
    key: 'pet.focus.hardStop', label: '专注模式硬停', description: '专注时连"她主动想说"也一律不发', defaultValue: true,
    options: [true, false], cost: '关掉之后专注期间仍可能弹气泡', group: 'advanced',
  },
];

const ui = {
  menu: [{ id: 'pet', title: '桌宠', order: 20 }],
  pages: [{ id: 'pet.settings', title: '桌宠设置', kind: 'form', menu: 'pet' }],
};

/* ── 可离线测的逻辑 ─────────────────────────────────────────────────── */

/** 气泡队列：有停留时间、有上限、过期自动清 */
export function createBubbles({ ttlMs = 12000, max = 8, now = () => Date.now() } = {}) {
  const items = [];
  function sweep() {
    const t = now();
    for (let i = items.length - 1; i >= 0; i--) if (items[i].expiresAt <= t) items.splice(i, 1);
  }
  return {
    push({ text, kind = 'say', voice = false, audioPath = '' }) {
      sweep();
      if (items.length >= max) return { ok: false, reason: 'full', hint: '气泡太多：等她说完再弹' };
      const item = { id: `b_${items.length}_${now()}`, kind, text: String(text ?? ''), voice, at: now(), expiresAt: now() + ttlMs };
      if (audioPath) item.audioPath = String(audioPath);
      items.push(item);
      return { ok: true, bubble: item };
    },
    sweep,
    list() { sweep(); return items.slice(); },
    size() { sweep(); return items.length; },
  };
}

/**
 * 专注门：专注开着就一律不发（这是用户自己按的"别吵我"）。
 * @param {object} input { focusOn, hardStop, carrierIsPet }
 */
export function gatePush({ focusOn = false, hardStop = true, carrierIsPet = true } = {}) {
  if (!carrierIsPet) return { ok: false, reason: 'carrier-not-pet', hint: '主动搭话的载体不是桌宠：这一轮该 QQ 发' };
  if (focusOn && hardStop) return { ok: false, reason: 'focus', hint: '专注模式开着：不会主动打扰' };
  return { ok: true };
}

/** 语音决策：想发语音 + 已开启 + 语音通道可用，三者都满足才用语音 */
export function decideVoice({ wantVoice = false, enabled = false, available = false } = {}) {
  if (!wantVoice) return { useVoice: false, reason: 'not-requested' };
  if (!enabled) return { useVoice: false, reason: 'disabled', hint: '设置页 → 桌宠：主动搭话用语音没开' };
  if (!available) return { useVoice: false, reason: 'unavailable', hint: '语音通道没起：先打字' };
  return { useVoice: true, reason: 'ok' };
}

/* ── 运行态 ─────────────────────────────────────────────────────────── */
const runtime = { started: false, cfg: { ttlMs: 12000, focusOn: false, hardStop: true, voiceEnabled: false, voiceAvailable: false }, bubbles: null };

export function configure(cfg = {}) {
  runtime.cfg = { ...runtime.cfg, ...cfg };
  runtime.bubbles = createBubbles({ ttlMs: runtime.cfg.ttlMs });
  return { ...runtime.cfg };
}

export function setFocus(on) { runtime.cfg.focusOn = Boolean(on); return runtime.cfg.focusOn; }
export function focusOn() { return runtime.cfg.focusOn === true; }

export async function open(ctx) {
  runtime.started = true;
  if (!runtime.bubbles) configure({});
  ctx.log('info', 'desktop-pet 已装载：气泡队列就绪；长轮询通道请在接入时调用 push()');
}

/** 接入时：桌宠长轮询拿到用户的话，转成事件交上来 */
export function push(raw, ctx) {
  const text = String(raw?.text ?? '').trim();
  if (!text) return null;
  return ctx.emit({
    from: { channel: identity.channel, kind: 'private', actor: String(raw?.actor ?? 'owner'), at: Date.now() },
    text,
    source: 'user',
    to: { owner: String(raw?.actor ?? 'owner') === 'owner' },
  });
}

/** 发：把意图变成气泡（专注时拒绝并说明原因） */
export async function send(intent = {}) {
  if (!runtime.started) return { status: 'failed', error: { code: 'adapter.not-started', message: '平台包未启动' } };
  if (intent.kind === 'stay_silent') return { status: 'delivered' };

  // 语音/音频：内核把 voice 合成成 send_media（kind=audio）；这里只把路径放进气泡
  if (intent.kind === 'send_media') {
    const audio = (Array.isArray(intent.media) ? intent.media : []).find((m) => m?.kind === 'audio' && m?.path);
    if (!audio) {
      return { status: 'unsupported', error: { code: 'pet.audio-missing', message: '桌宠只支持带路径的音频媒体' } };
    }
    const gate = gatePush({ focusOn: runtime.cfg.focusOn, hardStop: runtime.cfg.hardStop, carrierIsPet: true });
    if (!gate.ok) {
      return { status: 'unsupported', error: { code: 'pet.blocked', message: gate.hint, reason: gate.reason } };
    }
    const pushed = runtime.bubbles.push({
      text: intent.text ?? audio.caption ?? '',
      kind: 'send_media',
      voice: true,
      audioPath: audio.path,
    });
    if (!pushed.ok) return { status: 'throttled', error: { code: 'pet.bubble-full', message: pushed.hint } };
    return { status: 'delivered', externalId: pushed.bubble.id, voice: true, audioPath: audio.path };
  }

  if (intent.kind !== 'say') {
    return { status: 'unsupported', error: { code: 'adapter.not-implemented', message: `桌宠还不支持 ${intent.kind}` } };
  }
  const gate = gatePush({ focusOn: runtime.cfg.focusOn, hardStop: runtime.cfg.hardStop, carrierIsPet: true });
  if (!gate.ok) {
    // 专注：如实回"被挡住"，让内核去记账，而不是假装发了
    return { status: 'unsupported', error: { code: 'pet.blocked', message: gate.hint, reason: gate.reason } };
  }
  const voice = decideVoice({ wantVoice: intent.voice === true, enabled: runtime.cfg.voiceEnabled, available: runtime.cfg.voiceAvailable });
  const pushed = runtime.bubbles.push({ text: intent.text, voice: voice.useVoice });
  if (!pushed.ok) return { status: 'throttled', error: { code: 'pet.bubble-full', message: pushed.hint } };
  return { status: 'delivered', externalId: pushed.bubble.id, voice: voice.useVoice };
}

export async function health() { return { status: runtime.started ? 'ok' : 'down', focused: runtime.cfg.focusOn === true, bubbles: runtime.bubbles?.size() ?? 0 }; }
export async function close() { runtime.started = false; }

export default { identity, capabilities, ui, settings, open, send, health, close, configure, push, setFocus, focusOn };
