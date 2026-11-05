#!/usr/bin/env node
// 记忆索引 CLI：给「全量记忆卡」建/查本地索引（src/memory-index.js）。
//
//   node scripts/memory-index.mjs stats
//   node scripts/memory-index.mjs build [--force]
//   node scripts/memory-index.mjs search "她提过的猫" [-k 8] [--scope qq] [--json]
//
// 默认读当前角色：<DSH_HOME>/surfcore/characters/current.json。
// --dir 可以直接指定 memory 目录（测试/换角色用）。
// 只读 memory-card-full.jsonl，派生库落在 state/memory-rag/index.db。
import fs from 'node:fs';
import path from 'node:path';
import { surfcoreDir } from '../src/token-budget.js';
import {
  memoryIndexPathFor, memoryIndexStats, searchMemoryHybrid, searchMemoryIndex,
  syncMemoryIndex, syncVectors, vectorIndexStats,
} from '../src/memory-index.js';
import { DEFAULT_EMBED_URL, embedTexts, probeEmbedding } from '../src/memory-embed.js';

function argValue(argv, name, fallback = '') {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

function hasFlag(argv, name) {
  return argv.includes(name);
}

/** 取当前角色的 memory 目录。 */
export function resolveMemoryDir(env = process.env) {
  const home = surfcoreDir(env);
  try {
    const current = JSON.parse(fs.readFileSync(path.join(home, 'characters', 'current.json'), 'utf8'));
    if (current?.dir) return path.join(current.dir, current.memory || 'memory');
  } catch {}
  return path.join(home, 'characters', 'memory');
}

function fmtDate(value) {
  const t = Date.parse(String(value ?? ''));
  if (!Number.isFinite(t)) return String(value ?? '');
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function short(text, max = 120) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  const chars = [...s];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : s;
}

const argv = process.argv.slice(2);
const cmd = argv[0] || 'stats';
const json = hasFlag(argv, '--json');
const dirArg = argValue(argv, '--dir', '');
/** 这次要读/写的档案目录（--dir 优先，否则当前角色）。 */
const memoryDir = dirArg ? path.resolve(dirArg) : resolveMemoryDir();
// 派生库必须跟着**这个**档案目录走：`--dir` 指到别的档案时若还用生产库，
// 轻则查的是别人的记忆，重则把生产库重建成这份档案（真实记忆当场没了）。
const dbPath = argValue(argv, '--db', '') || memoryIndexPathFor(memoryDir);

if (cmd === 'stats') {
  const stats = memoryIndexStats(dbPath);
  if (json) {
    console.log(JSON.stringify(stats, null, 2));
  } else if (!stats.exists) {
    console.log(`还没建索引：${dbPath}`);
    console.log('先跑：node scripts/memory-index.mjs build');
  } else {
    console.log(`索引：${stats.path}`);
    console.log(`记录：${stats.total} 条 · 分片：${stats.byScope.map((s) => `${s.scope || '(空)'}=${s.count}`).join(' ') || '无'}`);
    console.log(`最新一条：${fmtDate(stats.newest)} · 文件 ${(stats.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
    const vec = vectorIndexStats(dbPath);
    console.log(vec.exists
      ? `向量：${vec.count} 条 · ${vec.dim} 维 · ${vec.model}`
      : '向量：还没建（node scripts/memory-index.mjs build --vectors）');
  }
} else if (cmd === 'build') {
  const jsonl = path.join(memoryDir, 'memory-card-full.jsonl');
  if (!fs.existsSync(jsonl)) {
    console.error(`找不到全量档案：${jsonl}`);
    process.exitCode = 1;
  } else {
    const started = Date.now();
    const res = syncMemoryIndex(jsonl, { dbPath, force: hasFlag(argv, '--force') });
    if (json) {
      console.log(JSON.stringify({ ...res, dbPath, ms: Date.now() - started }, null, 2));
    } else {
      console.log(`档案：${jsonl}`);
      console.log(`索引：${dbPath}`);
      console.log(`本次新增 ${res.added} 条 / 更新 ${res.updated} 条 / 扫描 ${res.scanned} 条${res.rebuilt ? '（整库重建）' : ''} · 共 ${res.total} 条 · ${Date.now() - started} ms`);
    }
    if (hasFlag(argv, '--vectors')) {
      const embedUrl = argValue(argv, '--embed-url', DEFAULT_EMBED_URL);
      const vs = Date.now();
      try {
        const vec = await syncVectors({
          jsonlPath: jsonl,
          dbPath,
          embed: { baseUrl: embedUrl },
          force: hasFlag(argv, '--force'),
          onProgress: json
            ? null
            : ({ done, total }) => process.stderr.write(`\r向量 ${done}/${total}`),
        });
        if (!json) process.stderr.write('\n');
        if (json) {
          console.log(JSON.stringify({ vectors: vec, ms: Date.now() - vs }, null, 2));
        } else {
          console.log(`向量：本次补 ${vec.embedded} 条 / 共 ${vec.total} 条 · ${vec.dim} 维 · ${vec.model} · ${Date.now() - vs} ms`);
        }
      } catch (err) {
        console.error(`向量化失败：${err?.message || err}`);
        console.error('检查 embedding 服务：node scripts/memory-index.mjs embed-probe');
        process.exitCode = 1;
      }
    }
  }
} else if (cmd === 'search') {
  const query = argv.slice(1).filter((a) => !a.startsWith('-') && a !== argValue(argv, '-k') && a !== argValue(argv, '--scope')).join(' ');
  if (!query.trim()) {
    console.error('用法：node scripts/memory-index.mjs search "关键词" [-k 8]');
    process.exitCode = 1;
  } else {
    const limit = Number(argValue(argv, '-k', '8')) || 8;
    const scope = argValue(argv, '--scope', '');
    const hybrid = hasFlag(argv, '--hybrid');
    const hits = hybrid
      ? (await searchMemoryHybrid(memoryDir, query, {
        dbPath, limit, scope, embed: { baseUrl: argValue(argv, '--embed-url', DEFAULT_EMBED_URL) },
      })).items
      : searchMemoryIndex(query, { dbPath, limit, scope });
    if (json) {
      console.log(JSON.stringify(hits, null, 2));
    } else if (!hits.length) {
      console.log('（没有命中）');
    } else {
      for (const [i, hit] of hits.entries()) {
        const via = Array.isArray(hit.via) && hit.via.length ? ` · via ${hit.via.join('+')}` : '';
        console.log(`${i + 1}. [${fmtDate(hit.createdAt)}] ${hit.speaker ? `${hit.speaker}：` : ''}${short(hit.title || hit.text, 80)}  · score ${Number(hit.score).toFixed(2)}${via}`);
        console.log(`   ${short(hit.text, 220)}`);
      }
    }
  }
} else if (cmd === 'embed-probe') {
  const baseUrl = argValue(argv, '--embed-url', DEFAULT_EMBED_URL);
  const [vec] = await embedTexts(['probe'], { baseUrl }).catch((err) => { throw err; });
  const probe = await probeEmbedding({ baseUrl });
  if (json) {
    console.log(JSON.stringify({ baseUrl, ...probe, firstDim: vec?.length ?? 0 }, null, 2));
  } else if (probe.ok) {
    console.log(`embedding 可用：${baseUrl} · ${probe.dim} 维 · ${probe.model}`);
  } else {
    console.log(`embedding 不可用：${baseUrl}`);
    console.log(`  ${probe.error}`);
    process.exitCode = 1;
  }
} else {
  console.error(`未知命令：${cmd}`);
  console.error('可用：stats | build [--vectors] | search "<关键词>" [--hybrid] | embed-probe');
  process.exitCode = 1;
}