// 唱歌控制台：把「搜歌 → 选歌 → 翻唱 → 看进度 → 试听」这几步落到 HTTP 上。
//
// 为什么要单独一层：
//   点歌（/api/socialV2/sing）是 AI 通道：给它一个歌名，它自己搜、自己挑、自己发到会话，
//   人类看不到中间发生了什么，也没法指定"我要第二首那个版本"。
//   控制台需要的是相反的东西：先看候选，再决定唱哪首，跑的时候能看到卡在哪一步。
//   两者共用同一条链路（songfetch.mjs → remix.mjs → RVC），所以这里不复制翻唱逻辑，
//   只是把 songfetch 当成子进程跑起来，把它的 stdout 翻译成阶段 / 进度。
//
// 契约：
//   · 一次只跑一首（RVC 吃满 CPU，叠两首会互相拖慢），再点会明确告诉你在跑哪首。
//   · 进度是**估算**：分轨/RVC 这两个阶段没有百分比输出，按阶段推进 + 缓慢爬升，
//     只用来告诉用户"没卡死、大概到哪了"，不作为精确依据。
//   · 搜歌与翻唱都允许被取消；取消走 taskkill 整棵进程树，sv 子进程不会残留。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

/** songfetch 的 stdout 行 → 阶段。顺序敏感：先匹配到的先用。 */
const PHASE_RULES = [
  { re: /🔍 搜索/, phase: '搜歌', pct: 6 },
  { re: /候选（|⚠️ 候选/, phase: '挑版本', pct: 10 },
  { re: /⏬ 下载/, phase: '下载音频', pct: 16 },
  { re: /转 wav/, phase: '转码', pct: 26 },
  { re: /交给 remix 翻唱/, phase: '准备分轨', pct: 32, cap: 33 },
  // demucs 分轨是第一个长阶段：40s~3min
  { re: /demucs 分轨/, phase: '分轨（demucs）', pct: 40, cap: 62, tick: 4 },
  { re: /人声 \+ 伴奏已分离/, phase: '分轨完成', pct: 63 },
  // RVC 是第二个长阶段，通常比 demucs 还久
  { re: /RVC 翻唱|Breeze 翻唱/, phase: 'RVC 翻唱', pct: 66, cap: 90, tick: 3 },
  { re: /混音/, phase: '混音', pct: 92, cap: 96 },
  { re: /✓ 完成/, phase: '收尾', pct: 98, cap: 99 },
];

const MAX_LOG = 60;
const MAX_KEEP = 20;

function safeName(s) {
  return String(s ?? '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || '未命名';
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * @param {object} opts
 * @param {object} opts.sing   socialV2.voice.sing 配置
 * @param {string} opts.outDir 成品目录（绝对路径）
 * @param {string} opts.stateDir 任务记录目录
 * @param {(msg:string)=>void} [opts.log]
 */
export function createSingConsole({ sing = {}, outDir, stateDir, log = () => {} }) {
  const script = String(sing.script || 'D:/大肥鱼功能/语音/说话/breeze/bridge/songfetch.mjs');
  // 站点从脚本名推断，也可以在 config 里显式写死；只影响界面文案与候选链接。
  const provider = /douyin/i.test(String(sing.provider || '')) || (!sing.provider && /douyin/i.test(script))
    ? 'douyin'
    : 'bilibili';
  const applio = String(sing.applio || 'D:/大肥鱼功能/语音/唱歌/applio');
  const defaultModel = String(sing.model || 'age12_real3');
  const defaultVocalGain = Number(sing.vocalGain) > 0 ? Number(sing.vocalGain) : 1.2;
  const defaultAccompGain = Number(sing.accompGain) > 0 ? Number(sing.accompGain) : 0.8;
  const voiceMode = String(sing.voiceMode || 'female') === 'any' ? 'any' : 'female';
  const allowMV = sing.allowMV === true;

  const jobsFile = path.join(stateDir, 'sing-jobs.json');
  const outRoot = path.resolve(outDir);
  /** @type {Map<string, object>} */
  const jobs = new Map();
  let running = null; // { id, child, timer }
  let seq = 0;

  // ── 任务记录持久化（重启后还能看到"上次唱了什么、成不成"）──────────────
  function loadJobs() {
    try {
      const arr = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
      for (const j of Array.isArray(arr) ? arr : []) {
        if (!j?.id) continue;
        jobs.set(j.id, {
          ...j,
          // 进程没了，上次"运行中"的任务不可能还在跑 → 标中断，避免界面永远转圈
          status: j.status === 'running' ? 'interrupted' : j.status,
          phase: j.status === 'running' ? '已中断（桥接重启过）' : j.phase,
          log: [],
        });
      }
    } catch { /* 首次运行没有文件，正常 */ }
  }

  function saveJobs() {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      const arr = [...jobs.values()]
        .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
        .slice(0, MAX_KEEP)
        .map(({ log: _log, pid: _pid, _cap: _cap, ...rest }) => rest);
      fs.writeFileSync(jobsFile, JSON.stringify(arr, null, 2));
    } catch (e) {
      log(`[sing-console] 任务记录写盘失败：${e?.message ?? e}`);
    }
  }

  loadJobs();

  function publicJob(j) {
    if (!j) return null;
    return {
      id: j.id,
      song: j.song,
      bvid: j.bvid,
      model: j.model,
      status: j.status,
      phase: j.phase,
      progress: Math.round(j.progress),
      startedAt: j.startedAt,
      endedAt: j.endedAt,
      ms: j.ms,
      outName: j.outName,
      sizeBytes: j.sizeBytes,
      error: j.error,
      logTail: j.log.slice(-14).join('\n'),
      hasAudio: !!(j.outName && fs.existsSync(path.join(outRoot, j.outName))),
    };
  }

  function list() {
    return [...jobs.values()]
      .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))
      .slice(0, MAX_KEEP)
      .map(publicJob);
  }

  function get(id) {
    return publicJob(jobs.get(String(id)));
  }

  /** 正在跑的那首（界面用来禁用按钮 / 提示"上一首还没唱完"）。 */
  function runningJob() {
    return running ? publicJob(jobs.get(running.id)) : null;
  }

  // ── 搜歌（只搜不唱）────────────────────────────────────────────────────
  // 复用 songfetch 的 --list-only：打分规则只在那边维护一份。
  function search(keyword) {
    const kw = String(keyword ?? '').trim();
    if (!kw) return Promise.reject(new Error('歌名不能为空'));
    if (!fs.existsSync(script)) return Promise.reject(new Error(`找不到 songfetch 脚本：${script}`));
    return new Promise((resolve, reject) => {
      const args = [script, kw, '--list-only', '--voice-mode', voiceMode];
      if (allowMV) args.push('--allow-mv');
      const child = spawn(process.execPath, args, { cwd: path.dirname(script), windowsHide: true });
      let out = '';
      let err = '';
      // 抖音那边的搜索是「起浏览器 + 可能重试 3 次」，最坏要一分多钟，别用 60 秒掐死
      const timer = setTimeout(() => {
        try { child.kill(); } catch {}
        reject(new Error('搜歌超时（150 秒）：抖音可能限流了，等一两分钟再试'));
      }, 150000);
      child.stdout.on('data', (d) => { out += d; });
      child.stderr.on('data', (d) => { err += d; });
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        const line = out.split(/\r?\n/).find((l) => l.startsWith('__JSON__'));
        if (!line) {
          // 栈信息（at xxx）对用户没意义，还会把真原因挤出摘要，先滤掉
          const tail = String(err || out)
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('at ') && !/^Node\.js v/.test(l))
            .slice(-3)
            .join(' | ')
            .slice(0, 240);
          reject(new Error(`搜歌失败（退出码 ${code}）：${tail || '没有输出'}`));
          return;
        }
        try { resolve({ provider, ...JSON.parse(line.slice('__JSON__'.length)) }); }
        catch (e) { reject(new Error(`候选解析失败：${e?.message ?? e}`)); }
      });
    });
  }

  // ── 起一首 ────────────────────────────────────────────────────────────
  function start({ song, bvid = '', model = '', pitch = 0, vocalGain = null, accompGain = null } = {}) {
    const title = String(song ?? '').trim();
    if (!title) throw new Error('歌名不能为空');
    if (running) {
      const r = jobs.get(running.id);
      throw new Error(`「${r?.song ?? '上一首'}」还在唱（${r?.phase ?? '进行中'}），等它结束再点下一首`);
    }
    if (!fs.existsSync(script)) throw new Error(`找不到 songfetch 脚本：${script}`);

    seq += 1;
    const id = `sing-${Date.now().toString(36)}-${seq}`;
    const outName = `唱歌-${safeName(title)}-控制台.wav`;
    const outPath = path.join(outRoot, outName);
    const useModel = String(model || defaultModel);
    const vg = Number(vocalGain) > 0 ? Number(vocalGain) : defaultVocalGain;
    const ag = Number(accompGain) > 0 ? Number(accompGain) : defaultAccompGain;
    const pch = Number.isFinite(Number(pitch)) ? Number(pitch) : 0;

    const job = {
      id, song: title, bvid: String(bvid || ''), model: useModel,
      status: 'running', phase: '排队', progress: 2,
      startedAt: nowIso(), endedAt: '', ms: 0,
      outName, outPath, sizeBytes: 0, error: '', log: [],
    };
    jobs.set(id, job);
    saveJobs();

    fs.mkdirSync(outRoot, { recursive: true });
    const args = [script, title, '--out', outPath, '--voice-mode', voiceMode,
      '--rvc-model', useModel, '--pitch', String(pch),
      '--vocal-gain', String(vg), '--accomp-gain', String(ag)];
    if (allowMV) args.push('--allow-mv');
    if (job.bvid) args.push('--bvid', job.bvid);

    const child = spawn(process.execPath, args, { cwd: path.dirname(script), windowsHide: true });
    job.pid = child.pid;
    const t0 = Date.now();

    // 分轨 / RVC 没有百分比：按阶段上限缓慢爬，只是为了"看起来在动"
    const timer = setInterval(() => {
      const rule = job._cap ? job._cap : null;
      if (!rule) return;
      if (job.progress < rule.cap) job.progress = Math.min(rule.cap, job.progress + rule.tick / 2);
    }, 6000);

    const pushLine = (line) => {
      const s = String(line).replace(/\r$/, '').trim();
      if (!s) return;
      job.log.push(s);
      if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
      for (const rule of PHASE_RULES) {
        if (!rule.re.test(s)) continue;
        job.phase = rule.phase;
        job.progress = Math.max(job.progress, rule.pct);
        job._cap = rule.cap ? { cap: rule.cap, tick: rule.tick || 3 } : null;
        break;
      }
    };
    // songfetch 的阶段信息走 stdout，失败原因常在 stderr，两边都收
    let bufOut = '';
    let bufErr = '';
    child.stdout.on('data', (d) => {
      bufOut += d;
      const parts = bufOut.split(/\r?\n/);
      bufOut = parts.pop() ?? '';
      parts.forEach(pushLine);
    });
    child.stderr.on('data', (d) => {
      bufErr += d;
      const parts = bufErr.split(/\r?\n/);
      bufErr = parts.pop() ?? '';
      parts.forEach(pushLine);
    });

    const finish = (status, error = '') => {
      clearInterval(timer);
      job.status = status;
      job.endedAt = nowIso();
      job.ms = Date.now() - t0;
      job.error = error;
      job._cap = null;
      if (status === 'done') {
        job.progress = 100;
        job.phase = '完成';
        try { job.sizeBytes = fs.statSync(outPath).size; } catch {}
      }
      running = null;
      saveJobs();
      const outcome = status === 'done' ? '唱完' : status === 'cancelled' ? '已取消' : `失败：${error}`;
      log(`[sing-console] ${job.song} ${outcome}（${Math.round(job.ms / 1000)}s）`);
    };

    child.on('error', (e) => finish('failed', `启动翻唱进程失败：${e?.message ?? e}`));
    child.on('close', (code) => {
      if (job.status === 'cancelled') { finish('cancelled'); return; }
      if (code === 0 && fs.existsSync(outPath)) { finish('done'); return; }
      const tail = job.log.slice(-4).join(' · ') || `退出码 ${code}`;
      finish('failed', tail.slice(0, 300));
    });

    running = { id, child, timer };
    return publicJob(job);
  }

  function killTree(pid) {
    if (!pid) return Promise.resolve();
    return new Promise((resolve) => {
      const c = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      c.on('close', resolve);
      c.on('error', resolve);
    });
  }

  async function cancel(id) {
    const job = jobs.get(String(id));
    if (!job) throw new Error('没有这个任务');
    if (job.status !== 'running') return { ok: true, already: job.status };
    job.status = 'cancelled';
    job.phase = '已取消';
    job._cap = null;
    await killTree(job.pid);
    saveJobs();
    return { ok: true };
  }

  /** 试听用：按任务 id 或文件名取成品路径（只允许成品目录内的 wav）。 */
  function audioPath({ id = '', name = '' } = {}) {
    let file = '';
    if (id) {
      const j = jobs.get(String(id));
      if (!j) throw new Error('没有这个任务');
      file = j.outName;
    } else {
      file = path.basename(String(name || ''));
    }
    if (!file || !/\.(wav|mp3|flac|m4a)$/i.test(file)) throw new Error('文件名不对');
    const full = path.join(outRoot, file);
    if (path.dirname(full) !== outRoot) throw new Error('不在成品目录里');
    if (!fs.existsSync(full)) throw new Error('成品文件不在了（可能被移走或删掉）');
    return full;
  }

  /** 成品目录里最近唱过的（跨桥接重启也能试听/发送）。 */
  function recent(limit = 20) {
    try {
      return fs.readdirSync(outRoot)
        .filter((f) => /\.(wav|mp3|flac|m4a)$/i.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(outRoot, f));
          return { name: f, sizeBytes: st.size, mtime: st.mtime.toISOString() };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  /** RVC 模型：logs/<name>/<name>.pth。 */
  function models() {
    const dir = path.join(applio, 'logs');
    let out = [];
    try {
      out = fs.readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .filter((d) => fs.existsSync(path.join(dir, d.name, `${d.name}.pth`)))
        .map((d) => {
          let mb = 0;
          try { mb = Math.round(fs.statSync(path.join(dir, d.name, `${d.name}.pth`)).size / 1024 / 1024); } catch {}
          return { name: d.name, mb, default: d.name === defaultModel };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch { /* 没装 applio 就没有模型，界面会提示 */ }
    return { models: out, defaultModel, applio };
  }

  function settings() {
    return {
      script, provider, applio, model: defaultModel, vocalGain: defaultVocalGain, accompGain: defaultAccompGain,
      voiceMode, allowMV, outDir: outRoot,
    };
  }

  return { search, start, list, get, runningJob, cancel, audioPath, recent, models, settings };
}

/** 生成 id 用的短随机串（保留给以后要按 id 分目录时用）。 */
export function shortId() {
  return crypto.randomBytes(4).toString('hex');
}
