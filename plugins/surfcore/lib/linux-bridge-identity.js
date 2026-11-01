import fs from 'node:fs';
import path from 'node:path';

// 只读验证，不发信号。无法验证时一律拒绝。
export function inspectLinuxBridgePid(pid, {
  root,
  nodeExecutable = process.execPath,
  procRoot = '/proc',
  uid = process.getuid?.(),
  euid = process.geteuid?.(),
} = {}) {
  const deny = (reason) => ({ ok: false, reason });

  if (!Number.isSafeInteger(pid) || pid <= 1) {
    return deny('非法 PID');
  }

  if (!root || uid == null || euid == null) {
    return deny('缺少身份验证条件');
  }

  try {
    const proc = path.join(procRoot, String(pid));
    const args = fs.readFileSync(path.join(proc, 'cmdline'))
      .toString('utf8').split('\0').filter(Boolean);

    if (args.length < 2 || !path.isAbsolute(args[1])) {
      return deny('进程启动参数不符合预期');
    }

    const expectedScript = fs.realpathSync(
      path.join(root, 'src', 'bridge.js')
    );

    if (fs.realpathSync(args[1]) !== expectedScript) {
      return deny('不是目标 bridge.js');
    }

    const expectedNode = fs.realpathSync(nodeExecutable);
    const actualNode = fs.realpathSync(path.join(proc, 'exe'));

    if (actualNode !== expectedNode) {
      return deny('Node.js 可执行文件不匹配');
    }

    if (fs.realpathSync(path.join(proc, 'cwd')) !==
        fs.realpathSync(root)) {
      return deny('工作目录不匹配');
    }

    const status = fs.readFileSync(
      path.join(proc, 'status'), 'utf8'
    );
    const match = status.match(
      /^Uid:\s+(\d+)\s+(\d+)/m
    );

    if (!match ||
        Number(match[1]) !== uid ||
        Number(match[2]) !== euid) {
      return deny('进程 UID 不匹配');
    }

    const stat = fs.readFileSync(
      path.join(proc, 'stat'), 'utf8'
    );
    const closing = stat.lastIndexOf(')');
    if (closing < 0) return deny('进程 stat 格式异常');

    // Linux /proc/<pid>/stat 第 22 字段：启动时钟刻度。
    const fields = stat.slice(closing + 1).trim().split(/\s+/);
    const startTicks = fields[19];

    if (!/^[1-9]\d*$/.test(startTicks ?? '')) {
      return deny('进程启动时间不可验证');
    }

    return { ok: true, pid, startTicks };
  } catch (error) {
    return deny(`无法验证进程：${error?.code ?? error?.message}`);
  }
}
