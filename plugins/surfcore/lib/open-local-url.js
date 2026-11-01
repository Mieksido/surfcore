import { spawn } from 'node:child_process';

const LOCAL_URL = /^http:\/\/127\.0\.0\.1:\d{2,5}$/;

// 可注入平台与 spawn，仅供独立测试模拟；不会真的打开浏览器。
export function createLocalUrlOpener({
  platform = process.platform,
  env = process.env,
  spawnProcess = spawn,
} = {}) {
  return async function openLocalUrl(url) {
    if (env.SURFCORE_SKIP_AUTOSTART === '1') return false;

    const target = String(url);
    if (!LOCAL_URL.test(target)) return false;

    let command;
    let args;
    const options = { detached: true, stdio: 'ignore' };

    if (platform === 'win32') {
      command = env.ComSpec || 'cmd.exe';
      args = ['/d', '/c', 'start', '""', `"${target}"`];
      options.windowsHide = true;
      options.windowsVerbatimArguments = true;
    } else if (platform === 'darwin') {
      command = 'open';
      args = [target];
    } else if (platform === 'linux') {
      // 无桌面环境的 Debian 不应尝试弹出浏览器。
      if (!env.DISPLAY && !env.WAYLAND_DISPLAY) return false;
      command = 'xdg-open';
      args = [target];
    } else {
      return false;
    }

    try {
      const child = spawnProcess(command, args, options);

      return await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };

        // 必须始终保留 error 监听器，防止异步错误崩溃宿主。
        child.on('error', () => finish(false));
        child.once('spawn', () => {
          try { child.unref?.(); } catch {}
          finish(true);
        });
      });
    } catch {
      return false;
    }
  };
}

export const openLocalUrl = createLocalUrlOpener();
