/** 核心词面门禁：kernel/runtime 生产文件不得出现平台/旧实现词。 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), '..');
const BANNED = [
  'qq', 'bili', 'bilibili', 'wechat', 'weixin', 'douyin', 'tiktok', 'tieba',
  'xiaohongshu', 'xhs', 'minecraft', 'onebot', 'snowluma', 'napcat', 'lagrange',
  'dsh', 'voxd', 'gsv', 'gpt-sovits', 'run.bat', 'stop.bat', '.venv-gsv',
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if ((name.endsWith('.js') || name.endsWith('.mjs')) && !name.endsWith('.test.mjs')) out.push(p);
  }
  return out;
}

const hits = [];
for (const root of ['kernel', 'runtime']) {
  for (const file of walk(path.join(ROOT, root))) {
    const text = fs.readFileSync(file, 'utf8');
    const lower = text.toLowerCase();
    for (const word of BANNED) {
      // 第三方专有运行时是安全黑名单，不是平台身份；只允许 runtime/pack-rules 这一处。
      if (word === 'snowluma' && path.relative(ROOT, file).replace(/\\/g, '/') === 'runtime/pack-rules.mjs') continue;
      const re = word.includes('.') ? new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : new RegExp(`\\b${word}\\b`, 'i');
      if (re.test(lower)) hits.push({ file: path.relative(ROOT, file).replace(/\\/g, '/'), word });
    }
  }
}

if (hits.length) {
  console.error(`❌ 核心词面门禁：${hits.length} 处`);
  for (const h of hits) console.error(`  - ${h.file}: ${h.word}`);
  process.exit(1);
}
console.log('✅ 核心词面门禁：kernel/runtime 无平台/旧实现词');
