/**
 * SurfCore 系统入口：一条命令看整个系统起来
 * ============================================================================
 * 用法：
 *   node app/surfcore.mjs status              只看（不启动任何东西）
 *   node app/surfcore.mjs enable qq           打开一个包
 *   node app/surfcore.mjs disable qq          关掉一个包
 *   node app/surfcore.mjs boot                装载所有已启用的包并跑起来
 *   node app/surfcore.mjs chat                只跑终端包，直接跟她说话
 *
 * 通用参数：--state <目录>（默认 state/persona-core，已被 .gitignore 忽略）
 *           --mode narrative|vector
 *
 * 它自己不做任何业务判断：只负责把"内核 + 包 + 运行时"拼起来，然后打印状态。
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../kernel/index.js';
import { createKernelRuntime } from '../kernel/runtime.js';
import { pickModel } from './model.mjs';
import { formatSettings, setSetting, exportText, importText } from './settings-cli.mjs';
import { discover, loadEnabled, loadPack, createHostState, PROTOCOL } from '../runtime/host.js';
import { ALLOWLIST_SETTINGS, allowlistFromSettings } from '../runtime/allowlist.js';
import { collectUi } from '../runtime/ui.js';
import { listZipEntries, hashFile, extractZip, writeProvenance, defaultGatewayDir } from './gateway.mjs';
import { planGatewayImport } from '../packs/qq/gateway.js';
import { createVoiceEngine } from '../kernel/voice/engine.js';
import { createHttpVoiceTransport } from '../kernel/voice/tts-http.js';
import { createEmbedder, createHttpEmbeddingTransport } from '../kernel/memory/vector/embed.js';
import { planVoiceImport } from '../kernel/voice/import.js';
import { planMigration, formatMigrationPlan, applyMigration } from './migrate.mjs';
import { KERNEL_IDENTITY, KERNEL_SETTINGS } from '../kernel/settings/limits.js';
import { buildLedgerReport, ledgerReportLines } from '../kernel/support/ledger-report.js';
import { DEFAULT_SHARE_TIMES, planShareSchedule } from '../packs/bilibili/slots.js';
import { applyShareResult, planShareJob, runShareJob } from '../packs/bilibili/job.js';
import { createBiliClient } from '../packs/bilibili/api.js';
import { planDynamicSync } from '../packs/bilibili/dynamics.js';
import { toEvent } from '../packs/bilibili/emitter.js';
import { composeSystem } from '../runtime/compose.js';
import { createBatcher } from '../kernel/attention/batch.js';

/**
 * 演示用假适配器（**只在开发工具里**，不是发布的包）。
 * 作用：没有真网关时也能在终端里跟她对话，验证整条回路。
 */
const demoPack = {
  identity: {
    publisher: 'surfcore',
    name: 'demo',
    version: '0.0.0',
    source: 'demo',
    channel: 'demo:local',
  },
  capabilities: { timing: 'realtime', shape: 'single', identityMode: 'known', direction: 'both', frequency: 'human', modality: 'text', special: { recall: false, edit: false, readReceipt: false } },
  settings: [],
  async open(ctx) {
    // 假适配器的"收"：从标准输入读一行，就当成一条私聊事件报上去
    const rl = readline.createInterface({ input: process.stdin });
    rl.on('line', (line) => {
      const text = String(line ?? '').trim();
      if (!text) return;
      ctx.emit({
        from: { channel: 'demo:local', kind: 'private', actor: 'owner', at: Date.now() },
        text,
        to: { owner: true },
      });
    });
  },
  async send(intent) {
    if (intent.kind === 'say') console.log(`  → ${intent.text}`);
    else if (intent.kind === 'send_media') console.log('  →（发了一张图/一段语音）');
    return { status: 'delivered' };
  },
  async health() { return { ok: true }; },
  async close() {},
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKS_DIR = path.join(ROOT, 'packs');

const argv = process.argv.slice(2);
const cmd = argv[0] ?? 'status';
const argOf = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : fallback;
};

const stateDir = path.resolve(ROOT, String(argOf('--state', 'state/persona-core')));
const mode = argOf('--mode', 'narrative') === 'vector' ? 'vector' : 'narrative';
const stateFile = path.join(stateDir, 'packs-state.json');
const host = createHostState({ stateFile });

/* ── 小工具：表格（中文按两格算，否则列会歪） ─────────────────────── */
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const widthOf = (s) => [...String(s ?? '')].reduce((n, ch) => n + (WIDE.test(ch) ? 2 : 1), 0);
const pad = (s, n) => {
  const text = String(s ?? '');
  const gap = n - widthOf(text);
  return gap > 0 ? text + ' '.repeat(gap) : text;
};
function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(widthOf(h), ...rows.map((r) => widthOf(r[i]))) + 2);
  const line = (cells) => cells.map((c, i) => pad(c, widths[i])).join('');
  console.log('  ' + line(headers));
  console.log('  ' + widths.map((w) => '─'.repeat(w)).join(''));
  for (const r of rows) console.log('  ' + line(r));
}

/* ── 建内核（所有命令都要用它的状态） ─────────────────────────────── */
// 运行时自己的设置项（白名单）：它**不是平台包**，但设置模型只认"声明"，
// 所以这里把一个 runtime 声明喂给内核——内核不需要知道它是不是包。
const RUNTIME_DECLARATION = {
  identity: { publisher: 'surfcore', name: 'runtime' },
  settings: ALLOWLIST_SETTINGS,
};

// 内核自己的阈值项（可调参数）：和平台包的设置项进同一个表单
const KERNEL_DECLARATION = {
  identity: KERNEL_IDENTITY,
  settings: KERNEL_SETTINGS,
};

// 各平台的设置项也要进同一个表单：先发现、再加载出它们的声明（只读声明，不启动）
const PACK_DECLARATIONS = [];
for (const entry of discover(PACKS_DIR)) {
  if (!entry.ok) continue;
  const loaded = await loadPack(entry);
  if (loaded.ok) PACK_DECLARATIONS.push({ identity: loaded.pack.identity, settings: loaded.pack.settings ?? [] });
}

// 平台包给模型的"数据类"工具：先留空数组，启动装载后再填进去
// （expression 每次调用都会读这个数组，所以后填也生效）
const PACK_TOOLS = [];
// 工具执行器：真正的执行在包里；这里只做转发（运行时装哪个包就转发给谁）
const toolBridge = { run: async () => ({ ok: false, error: '工具还没就绪（包未装载）' }) };

// 语音：只有给了 TTS 服务地址才装引擎（没给就只走文字，不假装能说）
const TTS_ENDPOINT = process.env.SURFCORE_TTS_ENDPOINT ?? '';
const TTS_PATH = String(process.env.SURFCORE_TTS_PATH ?? '/tts');
const voiceEngine = TTS_ENDPOINT
  ? createVoiceEngine({
    transport: createHttpVoiceTransport({
      endpoint: TTS_ENDPOINT,
      path: TTS_PATH,
      apiKey: process.env.SURFCORE_TTS_KEY ?? '',
      timeoutMs: Number(process.env.SURFCORE_TTS_TIMEOUT ?? 0) || undefined,
    }),
  })
  : null;

// 嵌入：只有同时给了地址和模型才装（没给就退回关键词近似，不假装有向量）
const EMBED_ENDPOINT = String(process.env.SURFCORE_EMBED_ENDPOINT ?? '').trim();
const EMBED_MODEL = String(process.env.SURFCORE_EMBED_MODEL ?? '').trim();
const EMBED_SPACE = String(process.env.SURFCORE_EMBED_SPACE ?? '').trim() || EMBED_MODEL || 'default';
const embedder = EMBED_ENDPOINT && EMBED_MODEL
  ? createEmbedder({
    model: EMBED_MODEL,
    transport: createHttpEmbeddingTransport({
      endpoint: EMBED_ENDPOINT,
      apiKey: process.env.SURFCORE_EMBED_KEY ?? '',
      timeoutMs: Number(process.env.SURFCORE_EMBED_TIMEOUT ?? 0) || undefined,
    }),
  })
  : null;

// 模型：配了地址就连真模型，没配就用离线桩（桩会明说自己只会按规则回话）
const picked = pickModel(process.env);

const kernel = createKernel({
  mode,
  stateDir,
  persona: { name: '小鲸鱼', core: '你是小鲸鱼。你有点懒散，说话短，但有分寸。' },
  admin: 'owner',
  adminName: '主人',
  model: picked.model,
  packs: [RUNTIME_DECLARATION, KERNEL_DECLARATION, ...PACK_DECLARATIONS],
  extraTools: PACK_TOOLS,
  toolExecutor: toolBridge,
  voiceEngine,
  embedder,
  // 嵌入模型名就是默认的索引空间；用户仍可在设置里改 memory.vector.modelSpace
  settingsValues: { 'surfcore/kernel': { 'memory.vector.modelSpace': EMBED_SPACE } },
  // 离线桩做摘要只会产出"没话说"：开着也没用，还多一条失败审计，所以只对真模型开
  summary: { enabled: picked.kind === 'http' },
});

/** 从内核设置里造出白名单（没配就是保守默认：谁都不放行） */
function currentAllowlist() {
  const values = kernel.settings.values()['surfcore/runtime'] ?? {};
  // 主人是谁由平台包自己声明（QQ 号填在 QQ 设置里）；没填就退回管理员标识
  const qqValues = kernel.settings.values()['surfcore/qq'] ?? {};
  return allowlistFromSettings(values, { ownerId: String(qqValues.ownerId ?? '').trim() || 'owner' });
}

/** 模块 UI 模型（给未来的界面用）：只收集，不渲染 */
async function showUi({ json = false } = {}) {
  const found = discover(PACKS_DIR);
  const declarations = [];
  for (const entry of found) {
    if (!entry.ok) continue;
    const loaded = await loadPack(entry);
    if (loaded.ok) declarations.push({ identity: loaded.pack.identity, ui: loaded.pack.ui });
  }
  const model = collectUi(declarations);
  if (json) { console.log(JSON.stringify(model, null, 2)); return model; }
  console.log('\n=== 模块界面（声明） ===');
  if (!model.groups.length) console.log('  （没有包声明界面）');
  for (const g of model.groups) {
    console.log(`  ${g.title}（${g.id}）`);
    for (const m of g.menu) console.log(`    菜单 ${m.title} [${m.id}]`);
    for (const p of g.pages) console.log(`    页面 ${p.title} [${p.id}] ${p.kind}${p.menu ? ` → ${p.menu}` : ''}`);
  }
  if (model.problems.length) {
    console.log('\n  ⚠ 有声明不合格（已丢弃）：');
    for (const p of model.problems) console.log(`    - ${p.adapter}：${p.errors.join('；')}`);
  }
  return model;
}

/**
 * 导入网关（用户自己的文件）。
 * ★ 三条红线写死在流程里：只处理本机文件 / 不自动启动 / 不写进仓库。
 */
async function importGatewayCmd({ zipPath, dest }) {
  if (!zipPath) {
    console.log('用法：node app/surfcore.mjs gateway import "<网关 zip 的路径>" [--dest <安装目录>]');
    return { ok: false };
  }
  if (!fs.existsSync(zipPath)) { console.error(`找不到文件：${zipPath}`); process.exitCode = 1; return { ok: false }; }

  let entries;
  try { entries = await listZipEntries(zipPath); }
  catch (error) { console.error(`读不了这个压缩包：${error.message}`); process.exitCode = 1; return { ok: false }; }

  const planned = planGatewayImport({ zipPath, entries, destDir: '' });
  if (!planned.ok) {
    console.error(`不能导入：${planned.error.message}`);
    if (planned.error.detail) for (const d of planned.error.detail) console.error(`  · ${d}`);
    process.exitCode = 1;
    return planned;
  }

  const target = dest || defaultGatewayDir(planned.plan.gateway);
  console.log(`\n=== 导入网关：${planned.plan.name} ===`);
  console.log(`  来源：${zipPath}`);
  console.log(`  安装到：${target}`);
  console.log('  说明：第三方运行时，只装在你本机；本程序不会替你启动它');

  const qq = await import('../packs/qq/index.js');
  const result = await qq.importGateway({
    zipPath, destDir: target,
    list: listZipEntries, extract: extractZip, hash: hashFile,
    // 来源文件由这里**写一次**（不再传给 importGateway，避免写两遍）
  });
  if (!result.ok) { console.error(`导入失败：${result.error.message}`); process.exitCode = 1; return result; }

  // 补两样只有装完才知道的信息：版本（release.json 里）与体积
  let version = null;
  try { version = JSON.parse(fs.readFileSync(path.join(target, 'release.json'), 'utf8')).version ?? null; } catch { /* 没有就算了 */ }
  const provenance = { ...result.provenance, version, bytes: fs.statSync(zipPath).size };
  fs.writeFileSync(path.join(target, '_gateway.json'), JSON.stringify(provenance, null, 2) + '\n', 'utf8');
  console.log(`  ✅ 已导入${version ? `（${planned.plan.name} ${version}）` : ''}，sha256 ${String(provenance.sha256).slice(0, 16)}…`);
  console.log('\n  下一步（都在你自己手里）：');
  for (const [i, s] of result.plan.steps.entries()) console.log(`    ${i + 1}. ${s}`);
  console.log(`\n  建议填进设置页的地址：${result.plan.wsHint}`);
  return result;
}

/**
 * 设置命令行。
 *   settings                       看（人读）
 *   settings --json                看（机器读）
 *   settings set <组> <键> <值>     改（改完立刻落盘）
 *   settings export [文件]          导出
 *   settings import <文件>          导入（不合格项会被拒绝并列出）
 */
/** 带值的选项（它们后面那一坨不是位置参数） */
const VALUE_FLAGS = new Set(['--state', '--dest', '--tick', '--only']);
function parseArgs(list = []) {
  const pos = [];
  const flags = [];
  for (let i = 0; i < list.length; i++) {
    const t = String(list[i]);
    if (t.startsWith('--')) {
      flags.push(t);
      if (VALUE_FLAGS.has(t) && list[i + 1] !== undefined && !String(list[i + 1]).startsWith('--')) i += 1;
    } else pos.push(t);
  }
  return { pos, flags };
}

async function migrateCmd({ from = '', apply = false, json = false } = {}) {
  if (!from || !fs.existsSync(from)) {
    console.error(`找不到旧配置：${from || '（没给 --from）'}`);
    process.exitCode = 1;
    return { ok: false };
  }
  let old;
  try { old = JSON.parse(fs.readFileSync(from, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) {
    console.error(`旧配置不是合法 JSON：${error?.message ?? error}`);
    process.exitCode = 1;
    return { ok: false };
  }

  const plan = planMigration(old);
  if (json) {
    // 只输出目标与原因，不输出 settings 里的密钥值
    console.log(JSON.stringify({
      mapped: plan.mapped, skipped: plan.skipped, warnings: plan.warnings,
      applied: false, settingsWritten: 0,
    }, null, 2));
  } else {
    console.log('\n=== 旧配置迁移预览（只读；旧文件不动） ===');
    console.log(formatMigrationPlan(plan));
    console.log('\n预览完不写任何东西。确认后加 --apply 才写入新状态。');
  }
  if (!apply) return { ...plan, ok: true, applied: false };

  kernel.load();
  const r = applyMigration(kernel, plan);
  console.log(`\n✅ 已写入 ${r.settingsWritten} 项到新状态；旧配置一个字节没动。`);
  console.log('重启 boot 后生效。');
  if (json) console.log(JSON.stringify({ applied: true, settingsWritten: r.settingsWritten }));
  return { ...plan, ok: true, applied: true, settingsWritten: r.settingsWritten };
}

async function memoryCmd({ json = false } = {}) {
  const sub = String(argv[1] ?? 'status').toLowerCase();
  kernel.load();

  if (sub === 'mode') {
    const mode = String(argv[2] ?? '').toLowerCase();
    if (!['narrative', 'vector'].includes(mode)) {
      console.error('用法：memory mode narrative|vector');
      process.exitCode = 1;
      return { ok: false };
    }
    kernel.settings.set('surfcore/kernel', 'memory.mode', mode);
    kernel.save();
    console.log(`✅ 记忆方式 = ${mode}（只改读取；两套存储继续写）`);
    return { ok: true, mode };
  }

  if (sub === 'maintain') {
    const r = await kernel.flushVectors();
    if (json) console.log(JSON.stringify(r, null, 2));
    else console.log(r.ok ? `✅ 编码 ${r.encoded} 条（失败 ${r.failed}）` : `⚠ 编码 ${r.encoded} 条，失败 ${r.failed}：${r.error?.message ?? ''}`);
    return r;
  }

  if (sub === 'rebuild') {
    const r = kernel.memory.rebuildVectors();
    if (json) console.log(JSON.stringify(r, null, 2));
    else console.log(`✅ 已重建 ${r.modelSpace}：${r.rebuilt} 条退回待编码（再跑 memory maintain）`);
    return r;
  }

  if (sub === 'search') {
    const text = argv.slice(2).join(' ').trim();
    if (!text) { console.error('用法：memory search <一句话>'); process.exitCode = 1; return { ok: false }; }
    let vector = null;
    if (embedder) {
      const emb = await embedder.embed([text]);
      if (emb?.ok) vector = emb.vectors?.[0] ?? null;
    }
    const items = kernel.memory.searchVector({ text, vector, limit: 10 });
    if (json) console.log(JSON.stringify(items, null, 2));
    else {
      if (!items.length) console.log('（没有记忆）');
      for (const x of items) console.log(`${String(x.score.toFixed(3))}  ${x.status.padEnd(7)}  ${x.entry.text}`);
    }
    return { ok: true, items };
  }

  const status = kernel.memory.vectorStatus();
  const out = { mode: kernel.memory.mode, config: kernel.memory.vectorConfig(), status };
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`记忆方式：${out.mode}`);
    console.log(`向量存储：${out.config.enabled ? '开' : '关'} · 当前索引 ${out.config.modelSpace}`);
    console.log(`记录 ${status.records} · 已索引 ${status.indexed} · 待编码 ${status.pending} · 失败 ${status.failed}`);
    for (const [space, row] of Object.entries(status.spaces)) console.log(`  ${space}: ${row.indexed} 已索引 / ${row.pending} 待编码 / ${row.failed} 失败`);
  }
  return { ok: true, ...out };
}

async function settingsCmd() {
  const { pos, flags } = parseArgs(argv);
  const sub = String(pos[1] ?? '').toLowerCase();
  const wantJson = flags.includes('--json');
  kernel.load();

  if (!sub) {
    const model = kernel.settings.model();
    if (wantJson) { console.log(JSON.stringify(model, null, 2)); return model; }
    console.log('\n=== 设置（* 表示改过） ===');
    console.log(formatSettings(model));
    return model;
  }

  if (sub === 'set') {
    const group = pos[2];
    const key = pos[3];
    const rest = pos.slice(4);
    const value = rest.join(' ');
    const r = setSetting({ kernel, group, key, value });
    if (!r.ok) { console.error(`改不了：${r.error.message}`); process.exitCode = 1; return r; }
    console.log(`✅ ${key} = ${typeof r.value === 'string' ? r.value : JSON.stringify(r.value)}（已保存）`);
    if (r.warning) console.log(`  注意：${r.warning}`);
    return r;
  }

  if (sub === 'export') {
    const text = exportText(kernel);
    const target = argv[2];
    if (target) { fs.writeFileSync(target, text, 'utf8'); console.log(`已导出：${target}`); }
    else console.log(text);
    return { ok: true };
  }

  if (sub === 'import') {
    const file = argv[2];
    if (!file || !fs.existsSync(file)) { console.error(`找不到文件：${file ?? '（没给）'}`); process.exitCode = 1; return { ok: false }; }
    const r = importText(kernel, fs.readFileSync(file, 'utf8'));
    if (!r.ok) { console.error(`导入失败：${r.error?.message ?? '未知原因'}`); process.exitCode = 1; return r; }
    console.log(`已导入（接受 ${Object.keys(r.applied ?? {}).length} 组）`);
    for (const x of r.rejected ?? []) console.log(`  拒绝：${x.adapter}/${x.key} — ${x.error}`);
    return r;
  }

  console.error('用法：settings [--json] | settings set <组> <键> <值> | settings export [文件] | settings import <文件>');
  process.exitCode = 1;
  return { ok: false };
}

/* ── status ──────────────────────────────────────────────────────── */
/**
 * 状态输出。给人看走表格；给界面/脚本看走 --json（同一份数据，两种呈现）。
 * 注意：这里只**读**，不启动任何包、不连任何网关。
 */
async function showStatus({ json = false } = {}) {
  const found = discover(PACKS_DIR);
  // 只读命令：**只 load 一次**，且 load 现在不写盘（修掉"看状态会让全量卡翻倍"）
  const loadedState = kernel.load();
  const snap = kernel.snapshot();
  const settingsModel = kernel.settings.model();
  const allow = currentAllowlist().snapshot();

  if (json) {
    console.log(JSON.stringify({
      worktree: ROOT,
      stateDir,
      packs: found.map((p) => ({
        name: p.manifest?.name ?? p.dirName,
        publisher: p.manifest?.publisher ?? null,
        version: p.manifest?.version ?? null,
        valid: p.ok === true,
        enabled: p.ok ? host.isEnabled(`${p.manifest.publisher}/${p.manifest.name}`) : false,
        trust: p.manifest?.trust ?? [],
        requires: p.manifest?.requires ?? [],
      })),
      kernel: snap,
      degraded: kernel.degraded,
      settings: { groups: settingsModel.groups.length, issues: settingsModel.issues.length },
      allowlist: allow,
    }, null, 2));
    return;
  }

  console.log('\n=== SurfCore 状态 ===');
  console.log(`  工作树：${ROOT}`);
  console.log(`  模型：${picked.info}`);
  console.log(`  状态目录：${stateDir}${fs.existsSync(stateDir) ? '' : '（还没有，首次保存时创建）'}`);

  console.log('\n--- 平台包 ---');
  if (!found.length) {
    console.log('  （packs/ 里没有包）');
  } else {
    table(['包', '发布人', '版本', '清单', '启用', '权限'], found.map((p) => [
      p.manifest?.name ?? p.dirName,
      p.manifest?.publisher ?? '?',
      p.manifest?.version ?? '?',
      p.ok ? '✔' : `✘ ${p.errors[0] ?? ''}`,
      host.isEnabled(`${p.manifest?.publisher}/${p.manifest?.name}`) ? '✔' : '—',
      (p.manifest?.trust ?? []).join(',') || '—',
    ]));
  }

  console.log('\n--- 内核 ---');
  if (loadedState) {
    console.log(`  已从磁盘恢复（保存于 ${new Date(loadedState.savedAt).toLocaleString('zh-CN')}）`);
  } else if (kernel.degraded) {
    console.log(`  ⚠ 读盘降级：${kernel.degraded}（新数据会写到 recovered，原文件保留）`);
  } else {
    console.log('  首次启动（还没有状态文件）');
  }
  table(['项', '值'], [
    ['记忆条数', snap.records],
    ['媒体条数', snap.media],
    ['读取方式', snap.mode],
    ['目的：今天已说', snap.purpose.countToday],
    ['目的：目标假设', snap.purpose.goals],
    ['预算（已花）', JSON.stringify(snap.budget.total)],
    ['审计条数', snap.audit],
    ['语音', `${kernel.voice.config.enabled ? '开' : '关'}（可用：${kernel.voice.config.available ? '是' : '否'}）`],
    ['设置组数', kernel.settings.model().groups.length],
  ]);

  console.log('\n--- 检查 ---');
  console.log(`  协议版本：${PROTOCOL}`);
  const bad = found.filter((p) => !p.ok);
  console.log(`  清单合格：${found.length - bad.length}/${found.length}`);
  console.log(`  已启用：${found.filter((p) => host.isEnabled(`${p.manifest?.publisher}/${p.manifest?.name}`)).length} 个`);
  console.log('');
}

/* ── 账本报表（只读） ───────────────────────────────────────────── */
/**
 * 账本报表：把内核里的真实用量与花费打出来。
 * 只读：不启动包、不联网、不改任何状态。
 */
function showLedger({ json = false } = {}) {
  kernel.load();
  const report = buildLedgerReport(kernel.ledger.summary());
  if (json) {
    console.log(JSON.stringify({ stateDir, report }, null, 2));
    return report;
  }
  console.log('\n=== 账本 ===');
  console.log(`  状态目录：${stateDir}`);
  for (const line of ledgerReportLines(report)) console.log(`  ${line}`);
  console.log('');
  return report;
}

/* ── B站分享槽位（给计划任务用的入口；只读/可选标记） ─────────────── */
function readJsonFile(file, fallback) {
  try {
    let text = fs.readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * `bili due`：现在该不该分享、下一个点在哪。
 * `--mark`：确认这次已经投递成功后，把这个槽位记为已跑（不确认就别加，免得丢一次）。
 * 这是给 Windows 计划任务/外部定时器调用的窄入口；不新增层，也不改四段。
 */
function biliDue({ json = false, mark = false, timesArg = '' } = {}) {
  const rawTimes = typeof timesArg === 'string' && timesArg.trim() ? timesArg.split(',') : DEFAULT_SHARE_TIMES;
  const times = rawTimes.map((t) => String(t).trim()).filter(Boolean);
  const file = path.join(stateDir, 'bili-share-state.json');
  const state = readJsonFile(file, {});
  const now = Date.now();
  const plan = planShareSchedule({ now, times, state });
  const out = {
    now: new Date(now).toISOString(),
    stateFile: file,
    due: plan.due,
    reason: plan.reason,
    slot: plan.slot ? { key: plan.slot.key, label: plan.slot.label, at: new Date(plan.slot.at).toISOString() } : null,
    next: { label: plan.next.label, at: new Date(plan.next.at).toISOString() },
    times,
  };

  if (mark && plan.due && plan.slot) {
    const lastSlots = { ...(state.lastSlots && typeof state.lastSlots === 'object' ? state.lastSlots : {}) };
    lastSlots[plan.slot.key] = new Date(now).toISOString();
    writeJsonAtomic(file, { ...state, lastSlot: plan.slot.key, lastRunAt: new Date(now).toISOString(), lastSlots });
    out.marked = plan.slot.key;
  }

  if (json) {
    console.log(JSON.stringify(out, null, 2));
    return out;
  }
  console.log('\n=== B站分享槽位 ===');
  console.log(`  现在：${new Date(now).toLocaleString('zh-CN', { hour12: false })}`);
  console.log(`  该跑：${out.due ? '是' : '否'}（${out.reason}）`);
  if (out.slot) console.log(`  本次槽位：${out.slot.key}`);
  console.log(`  下一个点：${out.next.label}（${new Date(out.next.at).toLocaleString('zh-CN', { hour12: false })}）`);
  if (out.marked) console.log(`  已标记：${out.marked}`);
  else if (out.due) console.log('  提示：确认投递成功后加 --mark 记为已跑；否则下次还会提示该跑。');
  console.log('');
  return out;
}

/* ── B站分享任务（到点投递；工具层组装，不新增层） ────────────────── */
/**
 * `bili run`：到点 → 选卡 → 调模型 → 用 QQ 包的 send 发到白名单群。
 * 这是旧 bili-share-scheduler 的"投递"部分；触发由外部计划任务负责。
 */
async function biliRun({
  json = false,
  dryRun = false,
  timesArg = '',
  modeArg = 'text',
  groupsArg = '',
} = {}) {
  kernel.load();
  const stateFile = path.join(stateDir, 'bili-share-state.json');
  const state = readJsonFile(stateFile, {});
  const rawTimes = typeof timesArg === 'string' && timesArg.trim() ? timesArg.split(',') : DEFAULT_SHARE_TIMES;
  const times = rawTimes.map((t) => String(t).trim()).filter(Boolean);
  const now = Date.now();
  const plan = planShareJob({
    now,
    times,
    state,
    records: kernel.memory.snapshot(),
    shareMode: { cardMode: String(modeArg || 'text') },
  });

  const groups = (typeof groupsArg === 'string' && groupsArg.trim()
    ? groupsArg.split(/[,，\s]+/)
    : currentAllowlist().snapshot().groups)
    .map((g) => String(g).trim().replace(/^group:/, ''))
    .filter(Boolean);

  const summary = {
    now: new Date(now).toISOString(),
    stateFile,
    due: plan.due,
    reason: plan.reason,
    slot: plan.slot ? { key: plan.slot.key, label: plan.slot.label } : null,
    next: { label: plan.next.label, at: new Date(plan.next.at).toISOString() },
    card: plan.card ? { id: plan.card.id, title: plan.card.title, url: plan.card.url } : null,
    cardMode: plan.cardMode ?? null,
    groups,
    dryRun,
  };

  if (json && (dryRun || !plan.due || plan.reason !== 'ready')) {
    console.log(JSON.stringify({ ...summary, prompt: dryRun ? plan.prompt ?? null : undefined }, null, 2));
    return summary;
  }

  if (!plan.due) {
    console.log(`\n[B站分享] 现在不跑：${plan.reason}`);
    console.log(`  下一个点：${plan.next.label}（${new Date(plan.next.at).toLocaleString('zh-CN', { hour12: false })}）`);
    return summary;
  }
  if (plan.reason !== 'ready') {
    console.log(`\n[B站分享] 到点了，但这一场跳过：${plan.reason}`);
    if (plan.hint) console.log(`  ${plan.hint}`);
    return summary;
  }

  if (dryRun) {
    console.log('\n=== B站分享（dry-run） ===');
    console.log(`  槽位：${plan.slot.key}`);
    console.log(`  素材：${plan.card.title}（${plan.card.url || '无链接'}）`);
    console.log(`  模式：${plan.cardMode}${plan.cardText ? '（系统先发标题+链接）' : ''}`);
    console.log(`  群：${groups.length ? groups.map((g) => `group:${g}`).join(', ') : '（没有白名单群）'}`);
    if (plan.cardText) console.log(`  卡片文本：${plan.cardText}`);
    console.log('\n--- 提示词 ---');
    console.log(plan.prompt);
    console.log('--- 提示词结束 ---\n');
    return summary;
  }

  if (picked.kind === 'stub') {
    console.error('[B站分享] 当前是离线桩模型，生成不了分享短评：先配 SURFCORE_MODEL_ENDPOINT/SURFCORE_MODEL，或加 --dry-run 只看计划。');
    process.exitCode = 1;
    return { ...summary, error: 'model-stub' };
  }
  if (!groups.length) {
    console.error('[B站分享] 没有白名单群：先在设置页填 allow.groups，或加 --groups 123,456');
    process.exitCode = 1;
    return { ...summary, error: 'no-groups' };
  }

  const qqValues = kernel.settings.values()['surfcore/qq'] ?? {};
  const qq = await import('../packs/qq/index.js');
  // 一次性任务不需要收：wsUrl 置空，避免顺手连一个 WS；发送仍走同一个包的契约。
  qq.configure({ ...qqValues, wsUrl: '' });
  await qq.open({ log: (level, msg) => { if (level === 'error') console.error(`[qq] ${msg}`); } });

  const result = await runShareJob({
    plan,
    groups,
    model: picked.model,
    system: kernel.identity.personaLayers({ audience: 'group' }).join('\n'),
    send: (channel, intent) => qq.send({ ...intent, channel }),
    now,
    onLog: (level, msg) => (level === 'error' ? console.error(msg) : console.log(msg)),
  });

  if (result.sentGroups > 0) {
    const nextState = applyShareResult(state, { slot: plan.slot, card: plan.card, now });
    writeJsonAtomic(stateFile, nextState);
    console.log(`\n[B站分享] 已发 ${result.sentGroups} 个群；状态已记（${stateFile}）`);
  } else {
    console.error(`\n[B站分享] 一个群都没发出去：${result.reason ?? '未知原因'}`);
    process.exitCode = 1;
  }
  if (result.failures?.length) {
    console.error('  失败明细：');
    for (const f of result.failures) console.error(`    - ${f.group || '（全局）'}：${f.error}`);
  }
  if (json) console.log(JSON.stringify({ ...summary, result }, null, 2));
  await qq.close();
  return { ...summary, result };
}

/* ── B站动态同步（一次拉取；定时由外部计划任务给） ───────────────── */
/**
 * `bili sync`：拉一次自己的空间动态 → 第一次建基线，之后只把新的变成事件入库。
 * 只读公开动态，不读私信；失败可见，不假装同步成功。
 */
async function biliSync({ json = false, dryRun = false } = {}) {
  const mid = String(process.env.SURFCORE_BILI_MID ?? '').trim();
  const cookie = String(process.env.SURFCORE_BILI_COOKIE ?? '').trim();
  const baseUrl = String(process.env.SURFCORE_BILI_BASE_URL ?? '').trim();
  const stateFile = path.join(stateDir, 'bili-dynamics-state.json');
  const state = readJsonFile(stateFile, null);

  const out = {
    now: new Date().toISOString(),
    stateFile,
    mid: mid || null,
    dryRun,
  };

  if (!mid) {
    out.error = 'missing-mid';
    out.hint = '先设 SURFCORE_BILI_MID（空间 mid）；cookie 可选但多数接口需要';
    if (json) console.log(JSON.stringify(out, null, 2));
    else console.error('[B站动态] 没有 mid：先设 SURFCORE_BILI_MID，再跑。');
    process.exitCode = 1;
    return out;
  }

  const client = createBiliClient({ cookie, ...(baseUrl ? { baseUrl } : {}) });
  const res = await client.spaceDynamics({ mid });
  if (!res.ok) {
    out.error = res.error;
    if (json) console.log(JSON.stringify(out, null, 2));
    else {
      console.error(`[B站动态] 拉取失败：${res.error?.message ?? '未知原因'}`);
      if (res.error?.hint) console.error(`  ${res.error.hint}`);
    }
    process.exitCode = 1;
    return out;
  }

  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  const plan = planDynamicSync({ items, state, now: Date.now() });
  out.items = items.length;
  out.baseline = plan.baseline;
  out.fresh = plan.fresh.length;

  if (json && (dryRun || plan.baseline || !plan.fresh.length)) {
    console.log(JSON.stringify({ ...out, freshItems: plan.fresh.map((x) => ({ id: x.id, title: x.title, text: x.text.slice(0, 80) })) }, null, 2));
    if (!dryRun) writeJsonAtomic(stateFile, plan.nextState);
    return out;
  }

  if (!plan.fresh.length) {
    console.log(`[B站动态] 没有新动态（共 ${items.length} 条${plan.baseline ? '，已建基线' : ''}）`);
    if (!dryRun) writeJsonAtomic(stateFile, plan.nextState);
    return out;
  }

  const ingested = [];
  if (!dryRun) {
    kernel.load();
    for (const item of plan.fresh) {
      const event = toEvent({ type: 'dynamic', item, at: Date.now() });
      if (!event) continue;
      kernel.handle(event, { channelId: event.from.channel, kind: 'other', isOwner: false });
      ingested.push(item.id);
    }
    kernel.save();
    writeJsonAtomic(stateFile, plan.nextState);
  } else {
    ingested.push(...plan.fresh.map((x) => x.id));
  }

  out.ingested = ingested;
  if (json) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`[B站动态] ${dryRun ? '（dry-run）' : ''}新动态 ${plan.fresh.length} 条`);
    for (const it of plan.fresh) console.log(`  - ${it.title || it.text.slice(0, 40)}（${it.id}）`);
    if (!dryRun) console.log(`  已入库 ${ingested.length} 条 → ${stateDir}`);
  }
  return out;
}

/* ── 语音库（只读列表 / 从目录导入；不启动引擎） ─────────────────── */
/**
 * `voice list`：看她有哪些声音。
 * `voice import <dir>`：把目录里的音频登记进语音库（不复制文件、不猜时长）。
 */
async function voiceCmd({ json = false, dryRun = false } = {}) {
  const sub = String(argv[1] ?? 'list');
  kernel.load();

  if (sub === 'probe') {
    if (!voiceEngine) {
      const out = { ok: false, code: 'voice.engine-missing', error: '没有配置 TTS 服务', hint: '设置 SURFCORE_TTS_ENDPOINT；请求路径用 SURFCORE_TTS_PATH' };
      if (json) console.log(JSON.stringify(out, null, 2)); else console.error(`${out.error}：${out.hint}`);
      process.exitCode = 1;
      return out;
    }
    const text = String(argOf('--text', '你好，我是 SurfCore。'));
    const voiceId = String(argOf('--voice', ''));
    const started = Date.now();
    const r = await voiceEngine.speak({ text, voiceId });
    const out = r.ok
      ? { ok: true, protocol: TTS_PROTOCOL, bytes: r.bytes?.length ?? 0, format: r.format ?? '', durationMs: r.durationMs ?? null, latencyMs: Date.now() - started }
      : { ok: false, protocol: TTS_PROTOCOL, error: r.error, latencyMs: Date.now() - started };
    if (json) console.log(JSON.stringify(out, null, 2));
    else if (out.ok) console.log(`语音自检通过：${out.bytes} 字节 / ${out.format} / ${out.durationMs ?? '时长未知'}ms / ${out.latencyMs}ms`);
    else console.error(`语音自检失败：${out.error?.code ?? 'voice.failed'} ${out.error?.message ?? ''} ${out.error?.hint ?? ''}`);
    if (!out.ok) process.exitCode = 1;
    return out;
  }

  if (sub === 'import') {
    const dir = String(argv[2] ?? '').trim();
    if (!dir) {
      console.error('用法：node app/surfcore.mjs voice import <音频目录> [--emotion 开心] [--tags 晚安,温柔] [--dry-run]');
      process.exitCode = 1;
      return { ok: false, error: 'missing-dir' };
    }
    if (!fs.existsSync(dir)) {
      console.error(`找不到目录：${dir}`);
      process.exitCode = 1;
      return { ok: false, error: 'no-dir' };
    }
    const files = fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
    const list = kernel.voices.list();
    const plan = planVoiceImport({
      files,
      existingIds: list.map((v) => v.id),
      defaults: {
        emotion: String(argOf('--emotion', '') || ''),
        tags: String(argOf('--tags', '') || '').split(/[,，\s]+/).filter(Boolean),
        note: String(argOf('--note', '') || ''),
      },
      maxEntries: 200,
    });

    if (json || dryRun) {
      const out = { dir, dryRun, entries: plan.entries, skipped: plan.skipped };
      if (json) console.log(JSON.stringify(out, null, 2));
      else {
        console.log(`\n=== 语音导入（dry-run）${dir} ===`);
        for (const e of plan.entries) console.log(`  + ${e.id}（${e.name}）`);
        for (const s of plan.skipped) console.log(`  - ${s.file}：${s.reason}`);
      }
      return out;
    }

    const imported = [];
    const failed = [];
    for (const entry of plan.entries) {
      const r = kernel.voices.register(entry);
      if (r.ok) imported.push(r.value.id);
      else failed.push({ id: entry.id, error: r.error });
    }
    if (imported.length) kernel.save();
    console.log(`\n=== 语音导入：${dir} ===`);
    console.log(`  新增：${imported.length} 个${imported.length ? `（${imported.join(', ')}）` : ''}`);
    if (plan.skipped.length) {
      console.log('  跳过：');
      for (const s of plan.skipped) console.log(`    - ${s.file}：${s.reason}`);
    }
    if (failed.length) {
      console.log('  失败：');
      for (const f of failed) console.log(`    - ${f.id}：${f.error}`);
      process.exitCode = 1;
    }
    return { imported, skipped: plan.skipped, failed };
  }

  const list = kernel.voices.list();
  if (json) console.log(JSON.stringify({ total: list.length, voices: list }, null, 2));
  else {
    console.log('\n=== 语音库 ===');
    if (!list.length) console.log('  （空的：用 voice import <目录> 导入）');
    for (const v of list) {
      console.log(`  ${v.id}  ${v.emotion || '—'}  ${v.tags?.join('/') || '—'}  用过 ${v.uses} 次`);
    }
    console.log(`  共 ${list.length} 个\n`);
  }
  return { total: list.length, voices: list };
}

/* ── enable / disable ────────────────────────────────────────────── */
function setEnabled(name, on) {
  const target = discover(PACKS_DIR).find((p) => p.manifest?.name === name);
  if (!target) {
    console.error(`没有这个包：${name}（现有：${discover(PACKS_DIR).map((p) => p.manifest?.name).join(', ')}）`);
    process.exit(1);
  }
  const id = `${target.manifest.publisher}/${target.manifest.name}`;
  host.setEnabled(id, on);
  console.log(`${on ? '已启用' : '已关闭'}：${id}`);
  if (on) console.log('提示：真正加载它要跑 `node app/surfcore.mjs boot`');
}

/* ── boot / chat ─────────────────────────────────────────────────── */
async function boot({ onlyTerminal = false } = {}) {
  kernel.load();

  // 终端包永远可用（它是"假适配器"，不连网也能验证整条链）
  const loaded = [{ id: 'surfcore/demo', pack: demoPack, dir: ROOT }];
  if (!onlyTerminal) {
    const r = await loadEnabled({ packsDir: PACKS_DIR, stateFile });
    for (const item of r.loaded) {
      if (item.id === 'surfcore/demo') continue;   // 上面已经加了
      loaded.push({ id: item.id, pack: item.pack, dir: item.dir });
    }
    if (r.failed.length) {
      console.log('\n⚠ 有包加载失败（已跳过）：');
      for (const f of r.failed) console.log(`  - ${f.id}：${(f.errors ?? []).join('；')}`);
    }
  }

  const allowlist = currentAllowlist();

  // 把设置页里的值交给各包（包自己解释这些键；组装层只负责"递过去"）
  const savedValues = kernel.settings.values();
  for (const item of loaded) {
    const values = savedValues[item.id];
    if (values && typeof item.pack.configure === 'function') {
      try { item.pack.configure(values); } catch (error) { console.error(`[app] ${item.id} 应用设置失败：${error?.message ?? error}`); }
    }
  }

  // 数据类工具：把"能自动调的工具"和执行器接上（只有声明了 runTool 的包才参与）
  const toolPacks = loaded.filter((x) => typeof x.pack.runTool === 'function');
  PACK_TOOLS.length = 0;
  for (const item of toolPacks) {
    const decls = typeof item.pack.toolDeclarations === 'function' ? item.pack.toolDeclarations() : [];
    PACK_TOOLS.push(...decls);
  }
  toolBridge.run = async (name, args, ctx) => {
    const channel = ctx?.viewer?.channelId ?? '';
    for (const item of toolPacks) {
      const res = await item.pack.runTool(name, args, channel);
      if (res && res.error?.code !== 'qq.tool-unknown') return res;
    }
    return { ok: false, error: { code: 'app.tool-unknown', message: `没有包能执行：${name}` } };
  };
  if (PACK_TOOLS.length) console.log(`  [app] 模型可自动调用 ${PACK_TOOLS.length} 个工具（渠道 + 联网）`);

  const system = composeSystem({
    kernel,
    packs: loaded,
    makeBatcher: createBatcher,
    allowlist,
    batching: { windowMs: 8000, maxItems: 12 },   // 运行入口显式开合批
    onLog: (level, msg) => { if (level === 'error') console.error(`[${level}] ${msg}`); },
  });

  const tickMs = Number(argOf('--tick', 60000));
  const runtime = createKernelRuntime({
    kernel,
    system,
    tickMs,
    vectorEveryMs: embedder ? 30000 : 0,
    saveEveryMs: 10 * 60 * 1000,
    onLog: (level, msg) => {
      if (level === 'error') console.error(`[runtime] ${msg}`);
      else if (msg.startsWith('向量编码')) console.log(`[vector] ${msg}`);
    },
  });
  const started = (await runtime.start({
    emit: () => {},
    log: (lv, m) => { if (lv === 'error') console.error('[rt]', m); },
  })).packs ?? [];

  console.log('\n=== SurfCore 已启动 ===');
  console.log(`  状态目录：${stateDir}`);
  console.log(`  模型：${picked.info}`);
  const allow = allowlist.snapshot();
  table(['层', '内容'], [
    ['内核', `记忆 ${kernel.snapshot().records} 条 · 模式 ${kernel.memory.mode} · 九件套已接线`],
    ['内核运行时', `tick ${tickMs}ms · 向量 ${embedder ? '30s' : '关'} · 保存 10min`],
    ['运行时', `管道就绪 · 包宿主就绪（协议 ${PROTOCOL}）· 白名单 ${allow.allowAll ? '全放行' : `${allow.groups.length} 群 / ${allow.privates.length} 私聊`}`],
    ['平台包', loaded.map((p) => p.id).join(' · ') || '（无）'],
    ['启动结果', started.map((s) => `${s.id}:${s.ok ? 'ok' : 'FAIL'}`).join('  ')],
  ]);

  const status = await system.status();
  console.log('\n--- 包的健康 ---');
  table(['包', '模态', '时序', '菜单项', '健康'], status.packs.map((p) => [
    p.id, p.modality, p.timing, p.settings, p.health?.status ?? '?',
  ]));

  console.log('\n打字跟她说话（终端包）；Ctrl+C 退出。\n');

  const shutdown = async () => {
    const out = await runtime.stop();
    if (out.errors?.length) console.error(`[runtime] 停止错误：${out.errors.map((x) => `${x.stage}:${x.message}`).join(' | ')}`);
    console.log(`\n[已保存] 记忆 ${kernel.snapshot().records} 条 → ${stateDir}`);
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.stdin.on('end', async () => {
    await new Promise((r) => setTimeout(r, 300));   // 给异步回合一点时间
    await shutdown();
  });
}

/* ── 分发 ────────────────────────────────────────────────────────── */
if (cmd === 'status') await showStatus({ json: argv.includes('--json') });
else if (cmd === 'ui') await showUi({ json: argv.includes('--json') });
else if (cmd === 'ledger') showLedger({ json: argv.includes('--json') });
else if (cmd === 'memory') await memoryCmd({ json: argv.includes('--json') });
else if (cmd === 'voice') await voiceCmd({ json: argv.includes('--json'), dryRun: argv.includes('--dry-run') });
else if (cmd === 'bili') {
  const sub = String(argv[1] ?? 'due');
  if (sub === 'run') {
    await biliRun({
      json: argv.includes('--json'),
      dryRun: argv.includes('--dry-run'),
      timesArg: argOf('--times', ''),
      modeArg: argOf('--mode', 'text'),
      groupsArg: argOf('--groups', ''),
    });
  } else if (sub === 'sync') {
    await biliSync({ json: argv.includes('--json'), dryRun: argv.includes('--dry-run') });
  } else {
    biliDue({
      json: argv.includes('--json'),
      mark: argv.includes('--mark'),
      timesArg: argOf('--times', ''),
    });
  }
}
else if (cmd === 'gateway') await importGatewayCmd({ zipPath: argv[2], dest: argOf('--dest', '') });
else if (cmd === 'migrate') await migrateCmd({ from: argOf('--from', ''), apply: argv.includes('--apply'), json: argv.includes('--json') });
else if (cmd === 'settings') await settingsCmd();
else if (cmd === 'enable') setEnabled(argv[1], true);
else if (cmd === 'disable') setEnabled(argv[1], false);
else if (cmd === 'chat') await boot({ onlyTerminal: true });
else if (cmd === 'boot') await boot();
else {
  console.log(`用法：
  node app/surfcore.mjs status              看状态
  node app/surfcore.mjs ledger [--json]      看账本（token/花费/按模型/峰谷）
  node app/surfcore.mjs memory status [--json]  看记忆方式/向量索引状态
  node app/surfcore.mjs memory mode narrative|vector
  node app/surfcore.mjs memory maintain        编码待处理向量（一批）
  node app/surfcore.mjs memory rebuild         重建当前模型的向量索引
  node app/surfcore.mjs memory search <一句话> 语义/关键词搜记忆库
  node app/surfcore.mjs voice list [--json]  看语音库
  node app/surfcore.mjs voice import <目录> [--emotion 开心] [--tags 晚安,温柔] [--dry-run]
                                             把目录里的音频登记进语音库（不复制、不猜时长）
  node app/surfcore.mjs bili due [--json] [--mark] [--times 07:00,21:00]
                                             B站分享槽位：该不该跑/下一个点（--mark 记为已跑）
  node app/surfcore.mjs bili run [--dry-run] [--json] [--groups 123,456] [--mode text|off]
                                             B站分享：到点→选卡→调模型→发白名单群（trigger 由外部计划任务给）
  node app/surfcore.mjs bili sync [--dry-run] [--json]
                                             B站动态：拉一次空间动态→首次建基线→新的入库（env: SURFCORE_BILI_MID/COOKIE）
  node app/surfcore.mjs migrate --from <旧config.json> [--apply] [--json]
                                             旧配置迁移：默认只预览；--apply 只写新状态，旧文件不动
  node app/surfcore.mjs enable <包名>        启用
  node app/surfcore.mjs disable <包名>       关闭
  node app/surfcore.mjs boot                启动所有已启用包
  node app/surfcore.mjs chat                只跑终端（直接聊天）`);
  process.exit(1);
}
