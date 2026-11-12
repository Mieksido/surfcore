/**
 * 平台包：QQ
 * ============================================================================
 * 四块齐全；**发送已经能用**（OneBot HTTP，注入 fetch 就能离线测）；
 * **接收还需一个 WS 客户端**（要连真网关才能验，见 attach 的说明）。
 *
 * 它不知道"内核"是什么，只知道自己这个平台的规矩：拆条、转义、白名单之外的事归运行时/内核。
 */
import { createClient, normalizeEvent } from './onebot.js';
import { createReceiver } from './receiver.js';
import { createToolRunner, QQ_TOOLS } from './tools.js';
import { bridgeToolDeclarations, createBridgeToolRunner, createBridgeTransport } from './bridge-tools.js';
import { downloadMedia } from './media-download.js';
import { createGroupInfo } from './group-info.js';
import { flattenForward, forwardBlockOf } from './forward.js';
import { createHistoryCatchup } from './history.js';
import * as gateway from './gateway.js';
import { importGateway } from './gateway-import.js';
import { safeText, splitForSend, markdownToPlain } from './text.js';

export const identity = {
  publisher: 'surfcore',
  name: 'qq',
  version: '0.3.0',
  source: 'qq',
  channel: 'qq:default',
};

export const capabilities = {
  timing: 'realtime',
  shape: 'single',
  identityMode: 'known',
  direction: 'both',
  frequency: 'human',
  modality: 'multi',
  special: { recall: true, edit: false, readReceipt: false },
};


/**
 * 这个包想长什么样（UI 声明）。渲染在 UI 层，这里只是声明。
 * "套娃"就在这两项里：QQ 的设置页里挂一个"导入网关"。
 */
export const ui = {
  menu: [{ id: 'qq', title: 'QQ', order: 10 }],
  pages: [
    { id: 'qq.settings', title: 'QQ 设置', kind: 'form', menu: 'qq' },
    { id: 'qq.gateway', title: '导入网关', kind: 'form', menu: 'qq' },
  ],
};

export const settings = [
  {
    key: 'wsUrl', label: '网关接收地址（ws）', type: 'text', defaultValue: '', maxChars: 200,
    description: '填你自己的 OneBot v11 网关 WebSocket 地址，例如 ws://127.0.0.1:3001/；留空=只发不收',
    cost: '不填就收不到消息；网关由你自备，本包不提供也不代启动',
    group: 'basic',
  },
  {
    key: 'httpUrl', label: '网关发送地址（http）', type: 'text', defaultValue: 'http://127.0.0.1:3000', maxChars: 200,
    description: 'OneBot v11 的 HTTP 接口地址，用来发消息',
    cost: '填错就发不出去（失败会写审计，不会假装发了）',
    group: 'basic',
  },
  {
    key: 'accessToken', label: '网关访问令牌', type: 'text', defaultValue: '', maxChars: 200,
    description: '你的网关设了 token 就填这里；没有就留空',
    cost: '留空但网关要 token：会被拒绝（不会无限重试）',
    group: 'advanced',
  },
  {
    key: 'ownerId', label: '主人 QQ 号', type: 'text', defaultValue: '', maxChars: 20,
    description: '填了之后：这个号的消息算"主人说的"（重要度更高、白名单永远放行）',
    cost: '不填：她分不清谁是主人，所有消息都按普通人处理',
    group: 'basic',
  },
  {
    key: 'maxChars', label: '单条字数上限', description: '一条消息最多多少字，超了会被拆条',
    defaultValue: 500, options: [200, 500, 800], cost: '太长容易刷屏；太短会把一句拆碎',
    group: 'advanced',
  },
  {
    key: 'allowWrite', label: '允许她做"写"操作', description: '撤回、戳一戳、改名片、点赞',
    defaultValue: false, options: [true, false],
    cost: '打开后她能改动群里的东西；关着就只能说话', group: 'basic',
  },
  {
    key: 'allowManage', label: '允许她做"管理"操作', description: '禁言、踢人、改名、审批入群、全员禁言',
    defaultValue: false, options: [true, false],
    cost: '打开后她能影响别人（谨慎）；关着最安全', group: 'advanced',
  },
  {
    key: 'bridgeUrl', label: '桥接控制台地址', type: 'text', defaultValue: 'http://127.0.0.1:3100', maxChars: 200,
    description: '可选的桥接语义接口（未读/上下文/表情/语音/记忆）；不填令牌就不启用',
    cost: '填错：语义工具会报连不上；不影响 OneBot 收发', group: 'advanced',
  },
  {
    key: 'bridgeToken', label: '桥接 agent 令牌', type: 'text', defaultValue: '', maxChars: 200,
    description: '桥接控制台给 agent 的令牌（x-agent-token）；留空=不启用语义工具',
    cost: '这是凭据：别贴到聊天里；填错会被桥接 401 拒绝', group: 'basic',
  },
  {
    key: 'bridgeConsoleToken', label: '桥接控制台令牌', type: 'text', defaultValue: '', maxChars: 200,
    description: '桥接控制台的 x-console-token（有些部署要带）；没有就留空',
    cost: '填错会被拒绝；留空时若桥接要求则语义工具不可用', group: 'advanced',
  },
];

/* ── 运行态（不写进四块：四块是"声明"，这里是"现在"） ───────────────── */
const runtime = {
  started: false,
  client: null,
  receiver: null,
  tools: null,
  bridge: null,
  catchup: null,
  ctx: null,
  cfg: {
    httpUrl: 'http://127.0.0.1:3000', wsUrl: '', accessToken: '', maxChars: 500, ownerId: '',
    bridgeUrl: 'http://127.0.0.1:3100', bridgeToken: '', bridgeConsoleToken: '',
    WebSocketImpl: undefined,
    allowWrite: false, allowManage: false,     // 渠道动作默认只读，写/管理必须显式打开
  },
};

/**
 * 配置（接入时由设置页/环境传入；这里不读文件，保持包的可移植）。
 * ★ 网关不由本包提供、不随包分发：wsUrl/httpUrl 指向**用户自己准备的** OneBot v11 实现。
 * @param {object} cfg { httpUrl, wsUrl, accessToken, maxChars, ownerId, fetchImpl, WebSocketImpl, allowWrite, allowManage }
 */
export function configure(cfg = {}) {
  runtime.cfg = { ...runtime.cfg, ...cfg };
  runtime.client = createClient({
    httpUrl: runtime.cfg.httpUrl,
    accessToken: runtime.cfg.accessToken,
    fetchImpl: runtime.cfg.fetchImpl ?? globalThis.fetch,
  });
  runtime.catchup = createHistoryCatchup({
    client: runtime.client,
    ownerId: runtime.cfg.ownerId,
    log: (level, message) => runtime.ctx?.log?.(level, message),
  });
  runtime.tools = createToolRunner({
    client: runtime.client,
    allowWrite: runtime.cfg.allowWrite === true,
    allowManage: runtime.cfg.allowManage === true,
  });
  // 桥接语义工具是可选的：没填令牌就不建，runTool 自然回落到 OneBot 原生动作
  runtime.bridge = runtime.cfg.bridgeToken
    ? createBridgeToolRunner({
      allowWrite: runtime.cfg.allowWrite === true,
      transport: createBridgeTransport({
        baseUrl: runtime.cfg.bridgeUrl,
        consoleToken: runtime.cfg.bridgeConsoleToken,
        agentToken: runtime.cfg.bridgeToken,
        fetchImpl: runtime.cfg.fetchImpl ?? globalThis.fetch,
      }),
    })
    : null;
  return { ...runtime.cfg };
}

/**
 * 收：把网关推来的原始事件变成新架构事件，交给 ctx.emit。
 * 用法（接入时）：在你自己的 WS 客户端里收到消息就调用它。
 */
export async function attach(rawEvent, ctx) {
  const event = normalizeEvent(rawEvent, { ownerId: runtime.cfg.ownerId });
  if (!event) return null;
  runtime.catchup?.remember(event);

  // 群规模：内核要判"大群不插嘴"，但它数不了人——由包问网关，塞进事件的 to.memberCount
  if (event.from?.kind === 'group' && /^group:(\d+)$/.test(String(event.from.channel ?? ''))) {
    const groupId = String(event.from.channel).split(':')[1];
    if (!runtime.groupInfo) runtime.groupInfo = createGroupInfo({ client: runtime.client ?? createClient({ httpUrl: runtime.cfg.httpUrl, accessToken: runtime.cfg.accessToken, fetchImpl: runtime.cfg.fetchImpl ?? globalThis.fetch }) });
    const count = await runtime.groupInfo.memberCount(groupId);
    if (count > 0) event.to = { ...(event.to ?? {}), memberCount: count };
  }


  // 合并转发（收）：取回聊天记录，拍平成文本塞进正文；**不发**、也不新增媒体种类
  if (Array.isArray(event.forwards) && event.forwards.length) {
    const blocks = [];
    for (const ref of event.forwards.slice(0, 2)) {
      const flat = await flattenForward({
        ref,
        fetchForward: (id) => (runtime.client ?? createClient({ httpUrl: runtime.cfg.httpUrl, accessToken: runtime.cfg.accessToken, fetchImpl: runtime.cfg.fetchImpl ?? globalThis.fetch })).call('get_forward_msg', { id }),
      });
      if (!flat.ok) ctx.log('info', `qq 转发取不到：${flat.error ?? '未知'}`);
      const block = forwardBlockOf(flat);
      if (block) blocks.push(block);
    }
    delete event.forwards;                       // 包内字段，不进契约
    if (blocks.length) event.text = [event.text, ...blocks].filter(Boolean).join('\n\n');
  }
  if (Array.isArray(event.media) && event.media.length) {
    const got = await downloadMedia({
      items: event.media,
      fetchImpl: runtime.cfg.fetchImpl ?? globalThis.fetch,
      maxBytes: runtime.cfg.maxMediaBytes,
      maxItems: runtime.cfg.maxMediaItems,
      timeoutMs: runtime.cfg.mediaTimeoutMs,
    });
    if (got.skipped) ctx.log('info', `qq 媒体：下到 ${got.downloaded} 张，跳过 ${got.skipped} 张`);
    event.media = got.items;
  }

  return ctx.emit(event);
}

export async function open(ctx) {
  runtime.started = true;
  runtime.ctx = ctx;
  if (!runtime.client) configure({});

  const catchupKnown = async () => {
    if (!runtime.catchup) return;
    for (const channel of runtime.catchup.channels()) {
      try {
        const r = await runtime.catchup.catchup(channel);
        for (const event of r?.missed ?? []) await ctx.emit(event);
      } catch (error) { ctx.log('warn', `qq 补历史失败 ${channel}：${String(error?.message ?? error)}`); }
    }
  };

  // 有 wsUrl 就自己连（协议是 OneBot v11，任何实现都行；网关由用户自己准备）
  if (runtime.cfg.wsUrl) {
    runtime.receiver = createReceiver({
      url: runtime.cfg.wsUrl,
      accessToken: runtime.cfg.accessToken,
      WebSocketImpl: runtime.cfg.WebSocketImpl,
      onEvent: (raw) => attach(raw, ctx),
      onOpen: catchupKnown,
      onLog: (level, message) => ctx.log(level, message),
    });
    runtime.receiver.start();
    ctx.log('info', `qq 接收器已连接：${runtime.cfg.wsUrl}（网关由用户自备）`);
  } else {
    ctx.log('info', 'qq 已装载：只发不收（未配置 wsUrl）；要收请把 wsUrl 指向你自己的 OneBot v11 网关');
  }
}

/** 发：把意图变成真的发出去 */
export async function send(intent = {}) {
  if (!runtime.started) {
    return { status: 'failed', error: { code: 'adapter.not-started', message: '平台包未启动' } };
  }
  const channel = String(intent.channel?.id ?? intent.channel ?? '');
  const m = /^(group|private):(.+)$/.exec(channel);
  if (!m) {
    return { status: 'failed', error: { code: 'qq.bad-channel', message: `认不出目标频道：${channel}` } };
  }
  const kind = m[1];
  const id = m[2];

  if (intent.kind === 'stay_silent') return { status: 'delivered' };

  // 渠道动作（撤回/禁言/改名片/戳一戳…）：内核只说"做一件事"，包翻译成具体调用
  if (intent.kind === 'act') {
    if (!runtime.tools) configure({});
    const res = await runtime.tools.run(intent.action, intent.args ?? {}, channel);
    return res.ok
      ? { status: 'delivered', data: res.data }
      : { status: 'failed', error: res.error };
  }

  // 发媒体：内核已把 media id 换成路径（见 kernel.respond），这里只负责变成消息段
  if (intent.kind === 'send_media') {
    const list = (Array.isArray(intent.media) ? intent.media : []).filter((x) => x?.path);
    if (!list.length) {
      return { status: 'failed', error: { code: 'qq.media-unresolved', message: '媒体没有可用的路径（内核没解析出路径）' } };
    }
    // AI 标识（显式）：媒体前面先发一句可见提示（形式由包决定，事实由内核给）
    if (intent.aiGenerated === true && intent.label) {
      await runtime.client.send({ kind, id, text: safeText(markdownToPlain(String(intent.label))), replyTo: intent.replyTo });
    }
    const res = await runtime.client.sendMedia({ kind, id, media: list, replyTo: intent.replyTo });
    return res.ok
      ? { status: 'delivered', externalId: res.data?.message_id === undefined ? undefined : String(res.data.message_id) }
      : { status: res.status ?? 'failed', error: res.error };
  }

  if (intent.kind !== 'say') {
    return { status: 'unsupported', error: { code: 'adapter.not-implemented', message: `qq 还不支持 ${intent.kind}` } };
  }

  const text = markdownToPlain(String(intent.text ?? ''));
  if (!text.trim()) return { status: 'failed', error: { code: 'qq.empty-text', message: '内容为空' } };

  // AI 标识（显式）：文本前一行放可见提示（事实来自内核，呈现由包决定）
  const label = intent.aiGenerated === true && intent.label ? markdownToPlain(String(intent.label)) : '';
  const body = label ? `${label}\n${text}` : text;

  // 拆条 + 转义（防 CQ 注入）
  const parts = splitForSend(body, runtime.cfg.maxChars);
  let lastId = null;
  for (const part of parts) {
    const res = await runtime.client.send({ kind, id, text: safeText(part), replyTo: intent.replyTo });
    if (!res.ok) return { status: res.status ?? 'failed', error: res.error };
    lastId = res.data?.message_id ?? null;
  }
  return { status: 'delivered', externalId: lastId === null ? undefined : String(lastId) };
}

/**
 * 把渠道工具交给"工具执行器"用（组装层注入给模型）。
 * 先查 OneBot 原生动作；不认得且配了桥接令牌 → 落到桥接语义工具。
 * 会话 key 能由频道自动补时就不让模型填（少传外部消息）。
 */
export async function runTool(name, args = {}, channel = '') {
  if (!runtime.tools) configure({});
  const res = await runtime.tools.run(name, args, channel);
  if (res.ok || res.error?.code !== 'qq.tool-unknown' || !runtime.bridge) return res;
  const bag = { ...args };
  if (!bag.key && /^(group|private):\d+$/.test(String(channel ?? ''))) bag.key = String(channel);
  return runtime.bridge.run(name, bag);
}

/** 给模型看的工具声明（只要声明，不含实现）；默认只给只读工具 */
export function toolDeclarations({ includeWrite = false, includeManage = false } = {}) {
  const onebot = QQ_TOOLS
    .filter((t) => t.kind === 'read' || (t.kind === 'write' && includeWrite) || (t.kind === 'manage' && includeManage))
    .map((t) => ({
      name: t.name,
      description: `QQ 渠道工具（${t.kind}）：${t.action}`,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(t.params.map((p) => [p, { type: 'string' }])),
        required: [],
      },
    }));
  // 桥接语义工具：只在配了令牌时交给模型（没配就别让它看见用不了的家伙）
  const bridge = runtime.cfg.bridgeToken
    ? bridgeToolDeclarations({ includeKey: false, includeWrite })
    : [];
  return [...onebot, ...bridge];
}

export { importGateway };

export async function health() {
  if (!runtime.started) return { status: 'down' };
  const info = await runtime.client.getLoginInfo();
  const receiver = runtime.receiver?.status() ?? { connected: false, attempts: 0, lastUpstream: null };
  const upset = receiver.lastUpstream;
  // 上游健康度不是新通道：它只是 health() 的一部分
  if (receiver.connected && upset && upset.good === false) {
    return { status: 'degraded', account: info.data, receiver, hint: '网关连着但上游心跳不健康：通道可能收不到消息' };
  }
  return info.ok
    ? { status: receiver.connected || !runtime.cfg.wsUrl ? 'ok' : 'degraded', account: info.data, receiver }
    : { status: 'degraded', error: info.error, receiver };
}

export async function close() {
  runtime.receiver?.stop();
  runtime.receiver = null;
  runtime.started = false;
}

export default { identity, capabilities, settings, ui, open, send, health, close, configure, attach, runTool, toolDeclarations, gateway };
