/**
 * 平台包：web（联网）
 * ============================================================================
 * 四段里的**小适配器 + 模块**：
 *   · 小适配器（本文件）：四块契约 + 工具面（toolDeclarations/runTool）；
 *   · 模块（fetch.js / tools.js）：安全抓取、搜索、结果收敛。
 *
 * 为什么是"包"而不是工具层：它可以被启用/禁用、有声明/设置/健康/界面，
 * 是"外部世界"的接入方；工具层只负责装配与门禁，不承载业务能力。
 *
 * 它不产生也不消费聊天事件：没有收、没有发；只把两个只读工具交给模型。
 * 默认不启用（runtime 的包策略）；要使用先 `node tools/cli.mjs enable web`。
 */
import { createWebTools } from './tools.js';

export const identity = {
  publisher: 'surfcore',
  name: 'web',
  version: '0.1.0',
  source: 'web',
  channel: 'web:default',
};

export const capabilities = {
  timing: 'async',
  shape: 'single',
  identityMode: 'known',
  direction: 'out',
  frequency: 'human',
  modality: 'text',
  special: { recall: false, edit: false, readReceipt: false },
};

export const settings = [
  {
    key: 'searchEndpoint', label: '搜索端点', type: 'text', defaultValue: '', maxChars: 300,
    description: '接受 POST {query,max_results} 的搜索服务地址；留空=只提供安全抓取',
    cost: '填错：web_search 会报错；web_fetch 不受影响', group: 'advanced',
  },
  {
    key: 'searchKey', label: '搜索密钥', type: 'text', defaultValue: '', maxChars: 300,
    description: '搜索服务的 Bearer 密钥；没有就留空',
    cost: '这是凭据：别贴到聊天里；填错会被 401 拒绝', group: 'advanced',
  },
  {
    key: 'maxChars', label: '单次抓取最多返回多少字', description: '超了会截断并标记 truncated',
    defaultValue: 50000, options: [20000, 50000, 100000], cost: '越大越贵；太小可能看不全', group: 'basic',
  },
];

const ui = {
  menu: [{ id: 'web', title: '联网', order: 40 }],
  pages: [
    { id: 'web.settings', title: '联网设置', kind: 'form', menu: 'web' },
  ],
};

const runtime = {
  started: false,
  cfg: { searchEndpoint: '', searchKey: '', maxChars: 50000 },
  tools: null,
};

function rebuild() {
  runtime.tools = createWebTools({
    enabled: true,
    searchEndpoint: runtime.cfg.searchEndpoint,
    searchKey: runtime.cfg.searchKey,
    maxChars: runtime.cfg.maxChars,
  });
}

/** 设置页/组装层传入；环境变量只作部署兜底，不覆盖显式设置 */
export function configure(cfg = {}) {
  runtime.cfg = {
    ...runtime.cfg,
    ...cfg,
    searchEndpoint: String(cfg.searchEndpoint ?? runtime.cfg.searchEndpoint ?? '').trim()
      || String(process.env.SURFCORE_WEB_SEARCH_ENDPOINT ?? '').trim(),
    searchKey: String(cfg.searchKey ?? runtime.cfg.searchKey ?? '').trim()
      || String(process.env.SURFCORE_WEB_SEARCH_KEY ?? '').trim(),
    maxChars: Number(cfg.maxChars) > 0 ? Number(cfg.maxChars) : runtime.cfg.maxChars,
  };
  rebuild();
  return { ...runtime.cfg };
}

export async function open(ctx = {}) {
  if (!runtime.tools) configure({});
  runtime.started = true;
  const log = typeof ctx.log === 'function' ? ctx.log : () => {};
  const search = runtime.cfg.searchEndpoint ? '搜索已配置' : '搜索未配置（只提供抓取）';
  log('info', `web 包已装载：${search}`);
}

/** web 包没有可发送的消息：如实说"做不到"，不假装发了 */
export async function send() {
  if (!runtime.started) return { status: 'failed', error: { code: 'adapter.not-started', message: '平台包未启动' } };
  return {
    status: 'unsupported',
    error: { code: 'web.no-outbound', message: 'web 包只提供只读工具，没有可发送的消息' },
  };
}

export async function health() {
  return {
    status: runtime.started ? 'ok' : 'down',
    search: Boolean(runtime.cfg.searchEndpoint),
    tools: runtime.tools?.declarations().length ?? 0,
  };
}

export async function close() {
  runtime.started = false;
}

function toolDeclarations() {
  if (!runtime.tools) configure({});
  return runtime.tools.declarations();
}

async function runTool(name, args = {}) {
  if (!runtime.started) return { ok: false, error: { code: 'adapter.not-started', message: '平台包未启动' } };
  if (!runtime.tools) configure({});
  return runtime.tools.run(name, args);
}

export default {
  identity,
  capabilities,
  settings,
  ui,
  open,
  send,
  health,
  close,
  configure,
  toolDeclarations,
  runTool,
};
