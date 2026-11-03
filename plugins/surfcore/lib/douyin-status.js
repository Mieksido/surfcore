/**
 * 抖音侧运行状态（只读）。
 *
 * 2026-11-03：B 站那半下线，「自己刷视频」交给 DSH 插件 dsh-douyin-agent 跑。
 * SurfCore 不再自己起刷视频的会话，只读插件落盘的状态，供：
 *   · 设置窗口的「抖音」页显示（登录态、浏览器、时段、各项外发开关、今天看过什么）
 *   · QQ 侧提示词注入（抖音→QQ 记忆简报）
 *
 * 这里一律只读，不写插件的 state，也不启动/停止插件——
 * 启停必须由用户在「设置 → 刷抖音」里点，避免两套 UI 抢同一个浏览器和同一份记忆。
 *
 * 路径语义对齐插件自己的 runtime-paths.mjs：
 *   ~/.dsh/douyin-browser/runtime-location.json 里的 stateDir/memoryDir 优先。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const HOME = process.env.USERPROFILE || os.homedir();
const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh');
const DOUYIN_HOME = path.join(DSH_HOME, 'douyin-browser');

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** 插件装在哪个 profile 的 node_modules 下（用第一个找到的）。 */
export function resolvePluginDir() {
  if (process.env.DOUYIN_PLUGIN_DIR && isDir(process.env.DOUYIN_PLUGIN_DIR)) return process.env.DOUYIN_PLUGIN_DIR;
  const profiles = path.join(DSH_HOME, 'profiles');
  let names = [];
  try {
    names = fs.readdirSync(profiles);
  } catch {
    return null;
  }
  for (const name of names) {
    const candidate = path.join(profiles, name, 'node_modules', 'dsh-douyin-agent');
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  return null;
}

/** 插件的运行位置（state / memory / 浏览器资料）。 */
export function resolveDouyinPaths() {
  const pluginDir = resolvePluginDir();
  const locationFile = path.join(DOUYIN_HOME, 'runtime-location.json');
  const stored = readJson(locationFile, null);
  const storedOk = stored && stored.version === 1 && typeof stored.stateDir === 'string' && path.isAbsolute(stored.stateDir);
  const stateDir = storedOk ? stored.stateDir : pluginDir ? path.join(pluginDir, 'state') : path.join(DOUYIN_HOME, 'state');
  const memoryDir = storedOk && typeof stored.memoryDir === 'string' && path.isAbsolute(stored.memoryDir)
    ? stored.memoryDir
    : path.join(DOUYIN_HOME, 'memory');
  return {
    pluginDir,
    stateDir,
    memoryDir,
    reportsDir: path.join(memoryDir, 'reports', 'videos'),
    controlDir: path.join(DOUYIN_HOME, 'control'),
    profileDir: path.join(DOUYIN_HOME, 'cli-profile'),
    locationFile,
  };
}

/** 浏览器控制文件：{pid, port, ready, startedAt(ms)} */
export function readBrowserControl(paths = resolveDouyinPaths()) {
  const data = readJson(path.join(paths.controlDir, 'browser.json'), null);
  if (!data || typeof data !== 'object') return null;
  const startedAt = Number(data.startedAt) || 0;
  return {
    pid: Number(data.pid) || 0,
    port: Number(data.port) || 0,
    ready: data.ready === true,
    startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    profile: typeof data.profile === 'string' ? data.profile : null,
  };
}

/** 真去敲一下 CDP，判断浏览器还活着（1 秒超时）。 */
export function probeCdp(port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0) return resolve(false);
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: timeoutMs }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function readPolicy(paths, name) {
  return readJson(path.join(paths.stateDir, name), null);
}

/** 最近的观看观察（插件人格记忆里的 observations，倒序）。 */
export function readRecentObservations(paths = resolveDouyinPaths(), limit = 20) {
  const state = readJson(path.join(paths.memoryDir, 'persona', 'state.json'), null);
  const rows = Array.isArray(state?.observations) ? state.observations : [];
  return rows
    .slice(-Math.max(1, limit))
    .reverse()
    .map((item) => ({
      videoId: String(item?.videoId ?? ''),
      url: typeof item?.url === 'string' ? item.url : '',
      title: String(item?.title ?? '').slice(0, 200),
      author: String(item?.author ?? '').slice(0, 80),
      observedAt: Number(item?.observedAt) || 0,
      time: item?.observedAt ? new Date(Number(item.observedAt)).toISOString() : null,
      durationSec: Math.round(Number(item?.playback?.duration) || 0),
    }))
    .filter((item) => item.videoId);
}

/** 最新一份观看日报（markdown）。 */
export function readLatestReport(paths = resolveDouyinPaths()) {
  let files = [];
  try {
    files = fs.readdirSync(paths.reportsDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort();
  } catch {
    return null;
  }
  if (!files.length) return null;
  const name = files[files.length - 1];
  const file = path.join(paths.reportsDir, name);
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return { date: name.replace(/\.md$/, ''), file, chars: text.length, text: text.slice(0, 20000) };
}

/** 汇总给 UI / 诊断用的状态。同步、只读、不抛。 */
export function readDouyinStatus() {
  const paths = resolveDouyinPaths();
  const pkg = paths.pluginDir ? readJson(path.join(paths.pluginDir, 'package.json'), null) : null;
  const browser = readBrowserControl(paths);
  const model = readPolicy(paths, 'native-model.json') ?? {};
  const video = readPolicy(paths, 'video-policy.json') ?? {};
  const session = readPolicy(paths, 'video-sessions.json') ?? {};
  const spark = readPolicy(paths, 'spark-policy.json') ?? {};
  const chat = readPolicy(paths, 'chat-policy.json') ?? {};
  const replies = readPolicy(paths, 'replies-policy.json') ?? {};
  const comments = readPolicy(paths, 'comments-policy.json') ?? {};
  const persona = readJson(path.join(paths.memoryDir, 'persona', 'state.json'), null);
  const current = session?.current ?? null;
  const report = readLatestReport(paths);
  return {
    installed: Boolean(pkg),
    version: pkg ? String(pkg.version ?? '') : null,
    pluginDir: paths.pluginDir,
    stateDir: paths.stateDir,
    memoryDir: paths.memoryDir,
    browser,
    model: { provider: model.provider ?? null, model: model.model ?? null },
    watch: {
      windows: Array.isArray(video.windows) ? video.windows : [],
      sessionMinutes: Number(video.sessionMinutes) || 0,
      running: Boolean(current),
      startedAt: current?.startedAt ?? null,
      endsAt: current?.endsAt ?? null,
    },
    outbound: {
      greeting: { enabled: spark.enabled === true, windows: spark.windows ?? [], dailyLimit: spark.dailyLimit ?? 0 },
      dmReply: { enabled: chat.enabled === true, allowlist: chat.allowlist ?? [], dailyLimit: chat.dailyReplyLimit ?? 0 },
      comment: { enabled: comments.enabled === true },
      reply: { enabled: replies.enabled === true, perVideo: replies.perVideo ?? 0 },
    },
    persona: {
      observations: Array.isArray(persona?.observations) ? persona.observations.length : 0,
      interests: Array.isArray(persona?.interests) ? persona.interests.length : 0,
      initializedAt: persona?.initializedAt ?? null,
    },
    report: report ? { date: report.date, chars: report.chars } : null,
  };
}
