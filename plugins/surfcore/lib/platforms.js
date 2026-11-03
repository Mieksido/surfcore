/**
 * 平台接入层（为后续贴吧预留；微博 2026-10-23 明确不做，已移除占位）。
 *
 * 核心数据模型不是“QQ 和 B站写死”，而是：
 *   PlatformAdapter = {
 *     id, name, version, status: 'active'|'planned'|'disabled',
 *     capabilities: ['identity','memory.read','memory.write','prompt.block','actions'],
 *     async status(), async readMemory(), async writeMemory(), promptBlock(ctx),
 *     dispose()
 *   }
 *
 * v1 内置 qq / bili 两个适配器；tieba 以 planned 占位，UI 里可见但不可用。
 * 后续要接贴吧（或其它平台），只需新增一个 adapter（或独立扩展包调用 registerPlatform），
 * 不需要改记忆同步、身份对齐、设置窗口的主流程。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLATFORM_DIR } from './paths.js';

export const PLATFORM_CAPABILITIES = Object.freeze([
  'identity',
  'memory.read',
  'memory.write',
  'prompt.block',
  'actions',
]);

const BUILTIN_PLATFORMS = [
  { id: 'qq', name: 'QQ', version: '1.0.0', status: 'active', builtin: true, capabilities: ['identity', 'memory.read', 'prompt.block', 'actions'] },
  // 2026-11-03：B 站下线，抖音接位。「刷视频」本身由 dsh-douyin-agent 插件跑，
  // 这里只登记身份/记忆/提示词这一层（与 qq 对等）。
  { id: 'douyin', name: '抖音', version: '1.0.0', status: 'active', builtin: true, capabilities: ['identity', 'memory.read', 'memory.write', 'prompt.block', 'actions'] },
  { id: 'bili', name: 'B站（已下线）', version: '0.0.0', status: 'disabled', builtin: true, capabilities: [] },
  { id: 'tieba', name: '贴吧', version: '0.0.0', status: 'planned', builtin: true, capabilities: ['identity', 'memory.read', 'memory.write', 'prompt.block'] },
];

function normalizeAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new Error('平台适配器必须是对象');
  const id = String(adapter.id ?? '').trim();
  if (!/^[a-z][a-z0-9_-]{1,23}$/.test(id)) throw new Error('平台 id 必须是 2~24 位小写字母/数字/下划线');
  const name = String(adapter.name ?? id).slice(0, 40);
  const capabilities = Array.isArray(adapter.capabilities)
    ? adapter.capabilities.filter((item) => PLATFORM_CAPABILITIES.includes(item))
    : [];
  return {
    id,
    name,
    version: String(adapter.version ?? '0.0.0').slice(0, 20),
    status: ['active', 'planned', 'disabled'].includes(adapter.status) ? adapter.status : 'active',
    builtin: Boolean(adapter.builtin),
    capabilities,
    statusFn: typeof adapter.status === 'function' ? adapter.status : null,
    readMemory: typeof adapter.readMemory === 'function' ? adapter.readMemory : null,
    writeMemory: typeof adapter.writeMemory === 'function' ? adapter.writeMemory : null,
    promptBlock: typeof adapter.promptBlock === 'function' ? adapter.promptBlock : null,
    actions: adapter.actions && typeof adapter.actions === 'object' ? adapter.actions : {},
    dispose: typeof adapter.dispose === 'function' ? adapter.dispose : null,
  };
}

export class PlatformRegistry {
  constructor() {
    this.adapters = new Map();
    this.extensions = new Map();
    for (const platform of BUILTIN_PLATFORMS) {
      this.adapters.set(platform.id, normalizeAdapter(platform));
    }
  }

  /** 扩展登记的平台适配器；返回 disposer。 */
  register(adapter, owner = 'extension') {
    const normalized = normalizeAdapter(adapter);
    if (this.adapters.has(normalized.id) && this.adapters.get(normalized.id).builtin) {
      throw new Error(`平台 ${normalized.id} 是内置平台，不能被覆盖`);
    }
    normalized.owner = String(owner);
    const previous = this.adapters.get(normalized.id);
    this.adapters.set(normalized.id, normalized);
    return () => {
      try { normalized.dispose?.(); } catch {}
      if (previous) this.adapters.set(normalized.id, previous);
      else this.adapters.delete(normalized.id);
    };
  }

  get(id) {
    return this.adapters.get(String(id)) ?? null;
  }

  /** 给内置平台挂运行态探针（不改变适配器身份/能力）。 */
  setStatus(id, fn) {
    const adapter = this.adapters.get(String(id));
    if (!adapter) return false;
    adapter.statusFn = typeof fn === 'function' ? fn : null;
    return true;
  }

  require(id) {
    const adapter = this.get(id);
    if (!adapter) throw new Error(`未知平台：${id}`);
    if (adapter.status !== 'active') throw new Error(`平台 ${id} 尚未启用（${adapter.status}）`);
    return adapter;
  }

  list() {
    return [...this.adapters.values()].map((adapter) => ({
      id: adapter.id,
      name: adapter.name,
      version: adapter.version,
      status: adapter.status,
      builtin: adapter.builtin,
      owner: adapter.owner ?? 'builtin',
      capabilities: adapter.capabilities,
    }));
  }

  async statusAll() {
    const out = [];
    for (const adapter of this.adapters.values()) {
      let runtime = null;
      try { runtime = adapter.statusFn ? await adapter.statusFn() : null; } catch (error) { runtime = { ok: false, error: String(error?.message ?? error) }; }
      out.push({
        id: adapter.id,
        name: adapter.name,
        version: adapter.version,
        status: adapter.status,
        builtin: adapter.builtin,
        capabilities: adapter.capabilities,
        runtime,
      });
    }
    return out;
  }

  /** 载入 platforms/ 下可选的本地适配器（默认只有 README 与占位清单）。 */
  async loadLocal(directory = PLATFORM_DIR) {
    const loaded = [];
    let entries = [];
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return loaded; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestFile = path.join(directory, entry.name, 'manifest.json');
      let manifest;
      try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { continue; }
      if (manifest.enabled === false || manifest.status === 'planned') continue;
      try {
        const moduleFile = path.join(directory, entry.name, manifest.entry ?? 'index.js');
        const mod = await import(`${pathToFileURL(moduleFile).href}?t=${Date.now()}`);
        const adapterFactory = mod.default ?? mod.adapter ?? mod.createAdapter;
        if (typeof adapterFactory !== 'function') continue;
        const adapter = await adapterFactory({ manifest });
        this.register(adapter, `local:${entry.name}`);
        loaded.push(entry.name);
      } catch (error) {
        loaded.push({ name: entry.name, error: String(error?.message ?? error) });
      }
    }
    return loaded;
  }

  dispose() {
    for (const adapter of this.adapters.values()) {
      try { adapter.dispose?.(); } catch {}
    }
    this.adapters.clear();
  }
}
