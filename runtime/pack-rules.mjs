/**
 * 包内容规则：**唯一真相**
 * ============================================================================
 * 同一套"包里不许有什么"的判断，要用在两个地方：
 *   · 出站（我们发出去的包）：tools/pack-check.mjs
 *   · 入站（别人塞进来的包）：runtime/host.js 的 installFrom() / loadPack()
 *
 * 两份规则必然漂移，漂移的那份就是漏的那份（合规回函 §5 的建议，采纳）。
 *
 * 规则只做**机械判定**：看文件名/路径，不读内容、不执行代码。
 * 判据：连接第三方 ≠ 分发第三方；包里只放我们自己写的协议实现。
 */
import fs from 'node:fs';
import path from 'node:path';

/** 每一条：id + 为什么 + 测试函数（入参是相对路径，统一用 / 分隔） */
export const PACK_RULES = Object.freeze([
  {
    id: 'native-binary',
    why: '原生二进制/启动器不许进包（第三方运行时不得复制、不得随包分发）',
    test: (p) => /\.(node|dll|so|dylib|exe|msi|bat|cmd|ps1|vbs)$/i.test(p),
  },
  {
    id: 'vendor-dir',
    why: '依赖目录不许进包（发布物只含自己的源码）',
    test: (p) => /(^|\/)node_modules(\/|$)/.test(p),
  },
  {
    id: 'lockfile',
    why: '锁文件不许进包（会把整个依赖树带出去）',
    test: (p) => /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(p),
  },
  {
    id: 'credentials',
    why: '凭据与运行期数据不许进包',
    test: (p) => /(^|\/)(config\.json|\.env(\..+)?|credentials?\.json|state\/)/i.test(p),
  },
  {
    id: 'vcs',
    why: '版本库元数据不许进包',
    test: (p) => /(^|\/)\.git(\/|$)/.test(p),
  },
]);

const norm = (p) => String(p ?? '').replace(/\\/g, '/').replace(/^\.\//, '');

/**
 * 按路径列表判定（出站用：直接拿打包清单）。
 * @returns {{ok:boolean, hits:Array<{path:string,id:string,why:string}>}}
 */
export function scanPaths(paths = []) {
  const hits = [];
  for (const raw of paths) {
    const p = norm(raw);
    if (!p) continue;
    for (const rule of PACK_RULES) {
      if (rule.test(p)) { hits.push({ path: p, id: rule.id, why: rule.why }); break; }
    }
  }
  return { ok: hits.length === 0, hits };
}

/**
 * 按目录扫描（入站用：装包前、加载前都要过）。
 * 只读目录结构，不读内容、不执行。
 * @param {string} dir
 * @param {object} [opts] { maxEntries=5000 }
 */
export function scanDir(dir, { maxEntries = 5000 } = {}) {
  const hits = [];
  let scanned = 0;

  const walk = (current, prefix) => {
    if (scanned > maxEntries) return;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      scanned += 1;
      if (scanned > maxEntries) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        const dirCheck = scanPaths([`${rel}/`]);
        if (!dirCheck.ok) hits.push(...dirCheck.hits);   // 目录名违规：不再往下走
        else walk(full, rel);
      } else {
        const r = scanPaths([rel]);
        if (!r.ok) hits.push(...r.hits);
      }
    }
  };

  walk(dir, '');
  return { ok: hits.length === 0, hits, scanned };
}

/** 给人看的一句话总结 */
export function explain(result) {
  if (result.ok) return '包内容检查通过（无二进制 / 无依赖目录 / 无第三方运行时 / 无凭据）';
  const ids = [...new Set(result.hits.map((h) => h.id))];
  return `包内容不合规：${ids.join(', ')}（${result.hits.length} 处）`;
}
