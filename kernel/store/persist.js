/**
 * 落盘：原子写 + 备份 + 只追加
 * ============================================================================
 * 三条铁律（来自旧代码的教训）：
 *   ① **原子写**：先写临时文件再改名，写一半断电不会毁掉旧文件
 *   ② **改前备份**：覆盖前把老的留成 .bak（可回滚）
 *   ③ **单写者**：只有内核写这些文件；别人只读（法则 14）
 *
 * 本文件不认识任何渠道，也不认识任何业务字段——它只会存"一个对象"。
 */
import fs from 'node:fs';
import path from 'node:path';

export function createStore({ dir, now = () => Date.now() } = {}) {
  if (!dir) throw new Error('store 需要一个目录');
  fs.mkdirSync(dir, { recursive: true });

  const fileOf = (name) => path.join(dir, `${name}.json`);
  const LOCK = path.join(dir, '.writer.lock');

  /** pid 还活着吗；EPERM = 进程存在但没权限探测 → 当成活着（保守判断） */
  function pidAlive(pid) {
    const n = Number(pid);
    if (!Number.isInteger(n) || n <= 0) return false;
    try { process.kill(n, 0); return true; }
    catch (error) { return error?.code === 'EPERM'; }
  }

  return {
    dir,

    /**
     * 单写者锁（跨进程）：原子创建 + 记 pid + 陈旧锁回收。
     * 旧代码的教训：**"判断不了"不等于"为真"**——先看 pid，再决定要不要回收。
     */
    acquireLock() {
      const me = process.pid;
      try {
        fs.writeFileSync(LOCK, String(me), { flag: 'wx', mode: 0o600 });
        return { ok: true, pid: me, owner: true };
      } catch (error) {
        if (error?.code !== 'EEXIST') return { ok: false, error: String(error?.message ?? error) };
      }
      let holder = 0;
      try { holder = Number(fs.readFileSync(LOCK, 'utf8').trim()) || 0; } catch {}
      if (holder && pidAlive(holder)) {
        return { ok: false, pid: holder, error: `已有写入者（pid ${holder}）在跑` };
      }
      try { fs.unlinkSync(LOCK); } catch {}
      try {
        fs.writeFileSync(LOCK, String(me), { flag: 'wx', mode: 0o600 });
        return { ok: true, pid: me, owner: true, stale: true };
      } catch (error) {
        return { ok: false, error: `回收陈旧锁失败：${error?.message ?? error}` };
      }
    },

    /** 只由持有者释放：别人的锁不删（防误删） */
    releaseLock() {
      try {
        const holder = Number(fs.readFileSync(LOCK, 'utf8').trim()) || 0;
        if (holder && holder !== process.pid) return { ok: false, error: `锁属于 pid ${holder}，不释放` };
        fs.unlinkSync(LOCK);
        return { ok: true };
      } catch (error) {
        if (error?.code === 'ENOENT') return { ok: true };
        return { ok: false, error: String(error?.message ?? error) };
      }
    },

    lockHolder() {
      try { return Number(fs.readFileSync(LOCK, 'utf8').trim()) || null; } catch { return null; }
    },

    readJson(name, fallback = null) {
      try {
        const raw = fs.readFileSync(fileOf(name), 'utf8').replace(/^\uFEFF/, '');
        return JSON.parse(raw);
      } catch { return fallback; }
    },

    /**
     * 读盘并**报告健康状况**（旧代码的教训：读坏必须只读降级，不许假装正常）。
     * @returns {{ok:boolean, value:any, reason:'ok'|'missing'|'corrupt'}}
     */
    readJsonChecked(name) {
      const file = fileOf(name);
      if (!fs.existsSync(file)) return { ok: false, value: null, reason: 'missing' };
      try {
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
        return { ok: true, value: JSON.parse(raw), reason: 'ok' };
      } catch {
        return { ok: false, value: null, reason: 'corrupt' };
      }
    },

    /** 原子写：tmp → rename；覆盖前留 .bak */
    writeJson(name, value) {
      const target = fileOf(name);
      const tmp = `${target}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      const text = JSON.stringify(value, null, 2);
      fs.writeFileSync(tmp, text);
      try {
        if (fs.existsSync(target)) fs.copyFileSync(target, `${target}.bak`);
        fs.renameSync(tmp, target);
      } catch (error) {
        try { fs.unlinkSync(tmp); } catch {}
        throw error;
      }
      return target;
    },

    /** 只追加：日志类用它（坏一行不毁全部） */
    appendJsonl(name, row) {
      const target = path.join(dir, `${name}.jsonl`);
      fs.appendFileSync(target, `${JSON.stringify(row)}\n`);
      return target;
    },

    exists(name) { return fs.existsSync(fileOf(name)); },
    list() { try { return fs.readdirSync(dir); } catch { return []; } },
  };
}
