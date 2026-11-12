/**
 * 大适配器（适配器运行时）
 * ============================================================================
 * 它是什么：**通用结构 + 契约词段的槽位 + 三管的管道实现**。
 *          它不包含任何平台的具体内容（那是"小适配器"的事）。
 *
 * 它做什么（全部是机械劳动，没有判断力）：
 *   · 校验小适配器交来的四块是否齐全（缺就拒绝，fail-closed）
 *   · 上行管道：给小适配器的 ctx 加"盖章、去重、计数"
 *   · 下行管道：幂等表、能力门、回执包装、异常兜底
 *   · 生命周期：代理 start/heartbeat/stop/uninstall
 *
 * 【三条硬约束】防的就是 bridge.js 那种腐化（它本来是中间层，最后吃掉了一切）：
 *   ① 只做管道，不做判断（"该不该发"是内核的事，不在这里）
 *   ② 不碰记忆、不认识人格
 *   ③ 输入只有事件、输出只有意图，不许有第三条捷径
 *
 * 铁律：本文件不许出现任何渠道名。
 */
import { MEDIA_LIMITS } from './media-kit.js';

/** 大适配器版本（契约文本/校验规则变更时更新；不改三管结构） */
export const RUNTIME_VERSION = '0.3.0';

/** 六条能力轴：小适配器必须全给（缺一条就说不清自己的物理条件） */
export const CAPABILITY_AXES = Object.freeze([
  'timing', 'shape', 'identityMode', 'direction', 'frequency', 'modality',
]);

/** 身份：两半都要有 */
const IDENTITY_FIELDS = Object.freeze(['publisher', 'name', 'version', 'source', 'channel']);

/**
 * 校验一个小适配器（平台包）。缺什么就抛什么，不猜、不补默认。
 * 这是"契约词段"的落地：大适配器规定槽位，小适配器必须填满。
 */
export function validatePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== 'object') return { ok: false, errors: ['平台包必须是对象'] };

  const id = pack.identity;
  if (!id || typeof id !== 'object') errors.push('缺少 identity（身份）');
  else for (const f of IDENTITY_FIELDS) if (!id[f]) errors.push(`identity 缺少 ${f}`);

  const cap = pack.capabilities;
  if (!cap || typeof cap !== 'object') errors.push('缺少 capabilities（能力）');
  else for (const axis of CAPABILITY_AXES) if (cap[axis] === undefined || cap[axis] === null) errors.push(`capabilities 缺少 ${axis}`);

  if (typeof pack.send !== 'function') errors.push('缺少 send()（把意图真的发出去）');
  if (pack.open !== undefined && typeof pack.open !== 'function') errors.push('open 必须是函数');

  if (pack.settings !== undefined && !Array.isArray(pack.settings)) errors.push('settings 必须是数组');

  return { ok: errors.length === 0, errors };
}

/** 上行的媒体验收：数量与体积超限就削掉（管道职责，不改内容本身） */
export function normalizeMedia(list = []) {
  const arr = Array.isArray(list) ? list : [];
  const kept = [];
  const dropped = [];
  for (const item of arr) {
    const size = Number(item?.bytesLength ?? item?.bytes?.length ?? 0);
    const oversize = item?.oversize === true || size > MEDIA_LIMITS.maxBytes;
    if (oversize) { dropped.push({ reason: 'oversize', kind: item?.kind }); continue; }
    if (kept.length >= MEDIA_LIMITS.maxItems) { dropped.push({ reason: 'too-many', kind: item?.kind }); continue; }
    kept.push(item);
  }
  return { kept, dropped };
}

/** 机器可读的"来源戳"：谁发的，内核据此防冒充 */
function stampOf(identity) {
  return `${identity.publisher}@${identity.name}`;
}

/**
 * 把小适配器包成"完整的适配器"（四块 + 三管）。
 * @param {object} pack 平台包：{ identity, capabilities, settings?, open?, send, health?, close?, uninstall? }
 * @param {object} [options] { onEvent?: (event)=>void } 便于测试/嵌入
 */
export function createAdapter(pack, options = {}) {
  const v = validatePack(pack);
  if (!v.ok) throw new Error(`平台包不合规：${v.errors.join('；')}`);

  const identity = pack.identity;
  const stamp = stampOf(identity);
  const seen = new Set();       // 幂等表（管道职责，平台包不用管）
  let started = false;
  let ctxRef = null;

  /** 上行管道：把小适配器递进来的事件补全并交给内核 */
  function makeContext(rawCtx = {}) {
    const emit = typeof rawCtx.emit === 'function' ? rawCtx.emit : () => {};
    const log = typeof rawCtx.log === 'function' ? rawCtx.log : () => {};
    return {
      // 上行第一管：报事。管道负责盖来源戳，小适配器不能自称是别人
      emit(event = {}) {
        const from = { ...(event.from ?? {}) };
        from.adapter = stamp;                       // ← 由大适配器盖章，不接受自报
        if (!from.channel) from.channel = identity.channel;
        if (!from.at) from.at = Date.now();
        // 媒体验收：超限的削掉并记下来（不硬塞给内核，也不悄悄丢）
        const { kept, dropped } = normalizeMedia(event.media);
        const normalized = { ...event, media: kept, from };
        if (dropped.length) {
          normalized.mediaDropped = dropped;
          log('warn', `媒体超限已削掉 ${dropped.length} 份：${dropped.map((d) => d.reason).join(',')}`);
        }
        if (typeof options.onEvent === 'function') options.onEvent(normalized);
        return emit(normalized);
      },
      log: (level, message, meta) => log(level, message, meta),
      // 窄口：唯一能读"她是谁"的口子（由内核提供；没有就是没有）
      describePersona: typeof rawCtx.describePersona === 'function'
        ? (opts) => rawCtx.describePersona(opts)
        : async () => '',
    };
  }

  return {
    identity,
    capabilities: pack.capabilities,
    settings: Array.isArray(pack.settings) ? pack.settings : [],

    /* ── 四块之四：生命（代理给小适配器） ── */
    lifecycle: {
      async start(ctx) {
        ctxRef = makeContext(ctx);
        started = true;
        return pack.open ? pack.open(ctxRef) : undefined;
      },
      async heartbeat() {
        if (!started) return { status: 'down' };
        const out = pack.health ? await pack.health() : { status: 'ok' };
        return out ?? { status: 'ok' };
      },
      async stop() {
        started = false;
        return pack.close ? pack.close() : undefined;
      },
      async uninstall() {
        return pack.uninstall ? pack.uninstall() : undefined;
      },
    },

    /* ── 三管之②③：下行 + 回执（管道全包了） ── */
    pipes: {
      async deliver(intent = {}) {
        const id = String(intent.id ?? '');
        const base = () => ({ intentId: id, at: Date.now() });

        // ① 幂等：同一编号第二次只回执，不重复执行
        if (id && seen.has(id)) return { ...base(), status: 'delivered', duplicate: true };
        if (id) seen.add(id);

        // ② 能力门（机械检查，不是判断）：纯文本渠道收不到要发媒体的意图
        const cap = pack.capabilities;
        const wantsMedia = intent.kind === 'send_media' || (Array.isArray(intent.media) && intent.media.length > 0);
        if (wantsMedia && cap.modality === 'text') {
          return {
            ...base(),
            status: 'unsupported',
            error: { code: 'adapter.unsupported-capability', message: '该渠道只支持文本' },
          };
        }

        // ③ 交给平台包真的发；任何异常都包成结构化失败，不让它冒泡成崩溃
        try {
          const out = await pack.send(intent, { ctx: ctxRef });
          const status = out?.status && ['delivered', 'failed', 'unsupported', 'throttled', 'unconfirmed'].includes(out.status)
            ? out.status
            : 'delivered';
          return { ...base(), ...(out ?? {}), intentId: id, status };
        } catch (error) {
          return {
            ...base(),
            status: 'failed',
            error: {
              code: 'adapter.send-failed',
              message: String(error?.message ?? error),
              retryable: true,
            },
          };
        }
      },
    },
  };
}
