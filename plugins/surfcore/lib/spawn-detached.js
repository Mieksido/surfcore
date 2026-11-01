import { spawn } from 'node:child_process';

// 仅表示子进程已成功创建，不代表目标服务已经就绪。
// 保留 error 监听器，避免启动失败时触发未处理异常。
export async function spawnDetached(
  command,
  args,
  options,
  spawnProcess = spawn
) {
  let child;

  try {
    child = spawnProcess(command, args, options);
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message ?? error),
    };
  }

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    child.on('error', (error) => {
      finish({
        ok: false,
        error: String(error?.message ?? error),
      });
    });

    child.once('spawn', () => {
      try {
        child.unref();
        finish({ ok: true, pid: child.pid ?? null });
      } catch (error) {
        finish({
          ok: false,
          error: String(error?.message ?? error),
        });
      }
    });
  });
}
