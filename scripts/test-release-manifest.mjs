// 回归：安装清单必须只包含 **git 跟踪的文件**（= GitHub archive 里会有的东西）。
// 2026-10-30 事故：清单从开发工作目录生成，混入 _backups/、audio/、本地改过的 docs/*
// → 用户下载的归档天然对不上 → 每次更新都在 verify 阶段失败，zip 安装自动更新 100% 不可用。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

let failures = 0;
const ok = (cond, label, extra = '') => {
  if (cond) console.log(`✅ ${label}`);
  else { failures += 1; console.error(`❌ ${label} ${extra}`); }
};

const manifestFile = path.resolve('release/install-manifest.json');
ok(fs.existsSync(manifestFile), '存在 release/install-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
const keys = Object.keys(manifest.files ?? {});
ok(keys.length > 0, `清单非空（${keys.length} 个文件）`);

const tracked = new Set(
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split(String.fromCharCode(0)).filter(Boolean),
);
const extra = keys.filter((rel) => !tracked.has(rel));
ok(extra.length === 0, '清单里没有"未被 git 跟踪"的文件', extra.slice(0, 5).join('、'));

const EXCLUDE_DIRS = ['_backups/', 'audio/', 'state/', 'backups/', 'logs/', 'staging/', 'node_modules/', 'video/', 'dist/', 'roles/', 'assets/', 'examples/'];
const badDir = keys.filter((rel) => EXCLUDE_DIRS.some((d) => rel.startsWith(d)));
ok(badDir.length === 0, '清单里没有运行数据/备份/视频等目录', badDir.slice(0, 5).join('、'));

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
ok(manifest.version === pkg.version, `清单版本与 package.json 一致（${manifest.version}）`, String(manifest.version));

// 清单里每个文件都必须真的存在于仓库（哈希才有意义）
const missing = keys.filter((rel) => !fs.existsSync(path.resolve(rel)));
ok(missing.length === 0, '清单里的文件都存在', missing.slice(0, 5).join('、'));

// ── 校验对象：已发布的那棵树 ──
// 清单描述的是「发布出去的内容」，不是「当前工作分支」。dev 发布后还会继续提交
// （文档、工具脚本），此时拿 HEAD 去比必然红——那不是回归，而是清单在正确地
// 拒绝把一个还没发布的树当成已发布版本。所以：HEAD 就是 tag 就用 HEAD，
// 否则用最近的 tag，并把「dev 领先」这件事明确打印出来。
function gitOut(args) {
  try { return execFileSync('git', args, { encoding: 'utf8' }).trim(); } catch { return ''; }
}
const headSha = gitOut(['rev-parse', 'HEAD']);
const latestTag = gitOut(['describe', '--tags', '--abbrev=0']);
const tagSha = latestTag ? gitOut(['rev-list', '-n', '1', latestTag]) : '';
const VERIFY_REF = tagSha && tagSha !== headSha ? latestTag : 'HEAD';
if (VERIFY_REF !== 'HEAD') {
  console.log(`ℹ️  HEAD 比 ${latestTag} 新（dev 上市后提交），清单按 ${latestTag} 校验`);
}

// ── 核心：清单哈希必须等于 git blob（= GitHub 归档字节），不能等于工作区文件 ──
// 2026-10-30 事故：工作区 CRLF / git 提交 LF → 清单与发布包 92 处哈希不符。
{
  const crypto = await import('node:crypto');
  const probe = ['.gitignore', 'README.en.md', 'docs/guides/VERSIONS.md', 'docs/guides/DSH_SETUP.md', 'package.json'];
  let checked = 0; const bad = [];
  for (const rel of probe) {
    let blob;
    try { blob = execFileSync('git', ['show', `${VERIFY_REF}:${rel}`], { maxBuffer: 32 * 1024 * 1024 }); } catch { continue; }
    const hash = crypto.createHash('sha256').update(blob).digest('hex');
    checked += 1;
    if (manifest.files?.[rel] !== hash) bad.push(rel);
  }
  ok(checked >= 3, `抽查 ${checked} 个文件的 blob 哈希`, '样本文件读不到');
  ok(bad.length === 0, `清单哈希 == git blob 哈希（${VERIFY_REF}，不是工作区文件）`, bad.join('、'));
}

// 发版硬门禁：清单与发布树内容必须逐字节一致
{
  const out = execFileSync(process.execPath, ['scripts/release-manifest.mjs', '--verify-ref', VERIFY_REF], { encoding: 'utf8' });
  ok(/问题 0 个/.test(out), `verify-ref ${VERIFY_REF} 通过（0 问题）`, out.slice(-200));
}

if (failures) { console.error(`\n${failures} 项失败`); process.exit(1); }
console.log('\n✅ test-release-manifest 通过');
