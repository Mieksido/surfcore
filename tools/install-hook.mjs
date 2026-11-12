/**
 * 安装架构门禁（pre-commit hook）
 * ============================================================================
 * 目的：把"架构规则"从"靠自觉跑"变成"提交时自动拦"（准则 018）。
 *
 * 关键设计：**只在提交涉及新架构路径时才跑**（kernel/runtime/packs/tools）。
 * 理由：这个仓库还有旧代码（src/、scripts/、plugins/）在被其它会话改；
 * 如果每次提交都跑新架构门禁，会拖慢甚至误伤无关的提交。
 *
 * 用法：
 *   node tools/install-hook.mjs           安装（已有 hook 会先备份）
 *   node tools/install-hook.mjs --remove  卸载（恢复备份）
 *   node tools/install-hook.mjs --status  看现在装没装
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 用 git 问出 hook 真正该装在哪（兼容 linked worktree 与 core.hooksPath） */
function hooksDir() {
  const r = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const p = r.stdout.trim();
  return path.isAbsolute(p) ? p : path.resolve(ROOT, p);
}

const HOOK = `#!/bin/sh
# SurfCore 架构门禁（由 tools/install-hook.mjs 安装）
# 只在提交涉及新架构路径时运行；不涉及就立即放行。
paths=$(git diff --cached --name-only)
if printf '%s\\n' "$paths" | grep -Eq '^(shared|kernel|runtime|packs|app|tools)/'; then
  echo "[arch-gate] 检测到架构代码变更 → npm run test:arch"
  if ! npm run test:arch --silent; then
    echo ""
    echo "[arch-gate] ❌ 未通过，拒绝提交。"
    echo "           修好再来；实在要跳过用 git commit --no-verify（但那就是在拆免疫系统）。"
    exit 1
  fi
  echo "[arch-gate] ✅ 通过"
fi
exit 0
`;

const dir = hooksDir();
if (!dir) {
  console.error('不是 git 仓库（或 git 不可用），装不了 hook');
  process.exit(1);
}
const target = path.join(dir, 'pre-commit');
const backup = `${target}.bak-surfcore`;
const mode = process.argv[2];

if (mode === '--status') {
  const exists = fs.existsSync(target);
  console.log(`hook 目录：${dir}`);
  console.log(`pre-commit：${exists ? '已安装' : '未安装'}`);
  if (exists) console.log('内容是否为本工具的：', fs.readFileSync(target, 'utf8').includes('[arch-gate]') ? '是' : '否（可能是别人的）');
  process.exit(0);
}

if (mode === '--remove') {
  if (!fs.existsSync(target)) { console.log('本来就没装'); process.exit(0); }
  if (!fs.readFileSync(target, 'utf8').includes('[arch-gate]')) {
    console.error('这个 hook 不是本工具装的，不动它'); process.exit(1);
  }
  fs.unlinkSync(target);
  if (fs.existsSync(backup)) { fs.renameSync(backup, target); console.log('已卸载，并恢复原 hook'); }
  else console.log('已卸载');
  process.exit(0);
}

if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes('[arch-gate]')) {
  fs.copyFileSync(target, backup);
  console.log(`已有别人的 hook，先备份到：${backup}`);
}

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(target, HOOK, { mode: 0o755 });
try { fs.chmodSync(target, 0o755); } catch {}
console.log(`✅ 已安装架构门禁：${target}`);
console.log('   规则：提交涉及 kernel/runtime/packs/tools 时自动跑 npm run test:arch');
console.log('   卸载：node tools/install-hook.mjs --remove');
