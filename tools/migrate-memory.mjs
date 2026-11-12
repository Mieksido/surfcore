/**
 * 旧记忆 → 新内核 的一次性迁移工具
 * ============================================================================
 * 位置：四层之外的迁移工具（一次性；不是新层，也不是运行时）。
 *
 * 默认 dry-run：只读旧文件、在内存内核里试灌一遍，输出统计；不写任何新状态。
 * 只有显式 --apply + --state 才写新内核状态；不碰旧文件。
 *
 * 旧记录的平台字段只作为「来源 adapter 的值」使用；内核代码里没有平台分支。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createKernel } from '../kernel/index.js';

function argOf(name, fallback = '') {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : fallback;
}
const hasFlag = (name) => process.argv.includes(`--${name}`);

function readJsonFile(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.records) ? value.records : [];
}

function readJsonlFile(file) {
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const body = line.trim();
    if (!body) continue;
    try { out.push(JSON.parse(body)); } catch {}
  }
  return out;
}

function oldRecordsOf(from) {
  const abs = path.resolve(String(from));
  if (!fs.existsSync(abs)) return { records: [], files: [], error: `不存在：${abs}` };
  const stat = fs.statSync(abs);
  if (stat.isFile()) {
    const records = abs.endsWith('.jsonl') ? readJsonlFile(abs) : readJsonFile(abs);
    return { records, files: [abs] };
  }
  const files = [];
  const records = [];
  const card = path.join(abs, 'memory-card.json');
  const full = path.join(abs, 'memory-card-full.jsonl');
  if (fs.existsSync(card)) { records.push(...readJsonFile(card)); files.push(card); }
  if (fs.existsSync(full)) { records.push(...readJsonlFile(full)); files.push(full); }
  return { records, files };
}

function eventOf(record) {
  const tags = Array.isArray(record?.tags) ? record.tags.map(String) : [];
  const owner = tags.includes('owner') || /owner/.test(String(record?.source ?? ''));
  const privateChat = record?.private === true;
  const channel = String(record?.conversationKey ?? '').trim()
    || (record?.groupId ? `group:${record.groupId}` : '')
    || (privateChat ? (owner ? 'private:owner' : `private:${record?.speaker || 'unknown'}`) : '')
    || `${record?.platform || 'imported'}:${record?.scope || 'main'}`;
  const at = Date.parse(record?.createdAt ?? record?.archivedAt ?? '') || Date.now();
  return {
    text: String(record?.text ?? record?.title ?? ''),
    source: record?.isSelf === true ? 'system' : (record?.manual === true ? 'manual' : 'user'),
    tags,
    importance: Number(record?.importance) || 0,
    from: {
      adapter: String(record?.platform || 'imported'),
      channel,
      kind: privateChat ? 'private' : (record?.groupId ? 'group' : 'other'),
      actor: record?.speaker ? String(record.speaker) : (owner ? 'owner' : null),
      at,
    },
    to: {
      owner,
      sensitive: record?.sensitive === true,
      circle: record?.groupId ? [`group:${record.groupId}`] : [],
    },
  };
}

function migrate({ from, state = '', apply = false, json = false } = {}) {
  if (!from) throw new Error('缺少 --from（旧记忆文件或目录）');
  const { records, files, error } = oldRecordsOf(from);
  if (error) throw new Error(error);
  if (apply && !state) throw new Error('--apply 必须同时给 --state（新状态目录）');
  if (apply) {
    const target = path.resolve(state);
    const marker = path.join(target, 'kernel-state.json');
    if (fs.existsSync(marker)) throw new Error(`目标已有 kernel-state.json，拒绝覆盖：${marker}`);
    fs.mkdirSync(target, { recursive: true });
  }

  const kernel = createKernel({ stateDir: apply ? path.resolve(state) : undefined });
  if (apply) kernel.load();
  const report = {
    ok: true,
    mode: apply ? 'apply' : 'dry-run',
    files,
    state: apply ? path.resolve(state) : null,
    read: records.length,
    ingested: 0,
    duplicate: 0,
    empty: 0,
    redacted: 0,
    private: 0,
    public: 0,
    failed: 0,
    errors: [],
  };

  for (const record of records) {
    try {
      const event = eventOf(record);
      if (!event.text.trim()) { report.empty += 1; continue; }
      const out = kernel.memory.ingest(event, { explicitImportance: Number(record?.importance) || 0 });
      if (!out?.text) { report.empty += 1; continue; }
      if (out.duplicate) report.duplicate += 1;
      else report.ingested += 1;
      if (Array.isArray(out.redacted) && out.redacted.length) report.redacted += 1;
      if (out.from?.scene === 'private') report.private += 1;
      else report.public += 1;
    } catch (e) {
      report.failed += 1;
      if (report.errors.length < 20) report.errors.push(String(e?.message ?? e));
    }
  }

  if (apply) {
    kernel.save();
    report.saved = path.join(path.resolve(state), 'kernel-state.json');
  }
  report.records = kernel.snapshot().records;

  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`\n=== 旧记忆迁移（${report.mode}）===`);
    console.log(`旧文件：${report.files.join(' · ') || '（无）'}`);
    if (report.state) console.log(`新状态：${report.state}`);
    console.log(`读到 ${report.read} 条 · 灌入 ${report.ingested} · 重复 ${report.duplicate} · 空 ${report.empty} · 脱敏 ${report.redacted} · 失败 ${report.failed}`);
    console.log(`场合：private ${report.private} / public ${report.public} · 内核现有 ${report.records} 条`);
    if (!apply) console.log('dry-run：没有写任何新状态；加 --apply --state <目录> 才落地。');
    if (report.errors.length) console.log(`错误样例：\n- ${report.errors.join('\n- ')}`);
  }
  return report;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('migrate-memory.mjs')) {
  try {
    migrate({ from: argOf('from'), state: argOf('state'), apply: hasFlag('apply'), json: hasFlag('json') });
  } catch (error) {
    console.error(`迁移失败：${error?.message ?? error}`);
    process.exit(1);
  }
}

export { eventOf, migrate, oldRecordsOf };
