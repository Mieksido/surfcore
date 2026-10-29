/**
          rfcore —— 客户端半边：DSH 设置里的「SurfCore」窗口。
 *
 * 这是合体后唯一的设置入口。它按标签页装下：
 *   概览 / 角色 / QQ / 语音 / 桌宠 / B站 / Token 额度 / 观看历史 / 记忆 / 对齐 / 扩展 / 全部参数 / 诊断
 *
 * 数据流：本组件 ⇄ /dsh-surfcore/api/*（同源 fetch）⇄ 原生配置文件。
 * 不制造第二份配置：QQ 仍写 <surfcore>/config.json，B站仍写
 * ~/.dsh/surfcore/bili.config.json，跨域设置写 ~/.dsh/surfcore/config.json。
 */
window.__ModuleLoader__.load({
  id: "surfcore",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const React = require("react");
    const {
      createElement: h,
      useCallback,
      useEffect,
      useMemo,
      useRef,
      useState,
    } = React;

    const API = "/dsh-surfcore/api";

  // 原生「浏览」：浏览器拿不到绝对路径，交给宿主进程弹 Windows 对话框。
  // 统一进度条：所有安装入口都用它（用户要求"每个安装都要能明显看到进度"）。
  function ProgressBar({ pct = 0, phase = "", err = "", indeterminate = false, style = {} }) {
    const v = Math.max(0, Math.min(100, Number(pct) || 0));
    return h("div", { style: { marginTop: "8px", ...style } },
      h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12px", opacity: 0.82, marginBottom: "4px" } },
        h("span", null, phase || "安装中"),
        h("span", null, indeterminate ? "…" : `${v}%`)),
      h("div", { className: "qbw-progress" + (indeterminate ? " indet" : "") }, h("i", { style: { width: `${Math.max(2, v)}%` } })),
      err ? h("div", { className: "qbw-err", style: { marginTop: "6px" } }, err) : null);
  }

  async function browseNative(mode = "dir", title = "") {
    const q = `mode=${mode === "file" ? "file" : "dir"}&title=${encodeURIComponent(title)}`;
    const res = await fetch(`${API}/browse?${q}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(180000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return data;
  }
    const CSS_TAG = "surfcore/console.css";

    const CSS = `
.qbw-app{max-width:1020px;margin:0 auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:rgba(127,127,127,.04);box-shadow:0 10px 30px rgba(0,0,0,.12);overflow:hidden}
.qbw-head{padding:18px 20px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);background:linear-gradient(135deg,rgba(31,111,235,.10),rgba(255,122,162,.08))}
.qbw-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);margin:0 0 4px}
.qbw-title{margin:0;font-size:19px;font-weight:600;line-height:28px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-sub{margin:4px 0 0;color:var(--dsw-alias-label-tertiary);font-size:12px}
.qbw-dots{display:inline-flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.qbw-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.10);padding:2px 8px;border-radius:999px}
.qbw-dot i{width:7px;height:7px;border-radius:50%;background:#8a8f98;display:inline-block}
.qbw-dot.ok i{background:#2fbf71}.qbw-dot.warn i{background:#ffb020}.qbw-dot.bad i{background:#ff5c5c}
.qbw-tabs{display:flex;gap:2px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-x:auto;background:rgba(127,127,127,.025)}
.qbw-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:8px 10px 9px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;border-radius:6px 6px 0 0}
.qbw-tab:hover{background:rgba(127,127,127,.08);color:var(--dsw-alias-label-primary)}
.qbw-tab.on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.qbw-body{padding:16px 20px 8px;max-height:min(68vh,760px);overflow:auto}
.qbw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
.qbw-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 13px;background:rgba(127,127,127,.03)}
.qbw-card h4{margin:0 0 6px;font-size:13px;font-weight:600}
.qbw-card p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:17px}
.qbw-kv{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:12px}
.qbw-kv:last-child{border-bottom:none}
.qbw-kv span:first-child{color:var(--dsw-alias-label-tertiary)}
.qbw-kv span:last-child{text-align:right;word-break:break-all}
.qbw-group{margin:16px 0 8px;font-size:13px;font-weight:650;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-group small{font-weight:400;color:var(--dsw-alias-label-tertiary);font-size:11px}
.qbw-rows{display:flex;flex-direction:column}
.qbw-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 20px;padding:9px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}
.qbw-row:last-child{border-bottom:none}
.qbw-row>div:first-child{flex:1;min-width:190px}
.qbw-label{font-size:12.5px;line-height:19px}
.qbw-hint{color:var(--dsw-alias-label-tertiary);margin-top:2px;font-size:11px;line-height:17px}
.qbw-input,.qbw-select,.qbw-textarea{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;min-height:28px;padding:3px 8px;min-width:180px;outline:none;font-family:inherit}
.qbw-input:focus-visible,.qbw-select:focus-visible,.qbw-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.qbw-input.wide,.qbw-textarea.wide{min-width:320px}
.qbw-textarea{width:100%;min-height:90px;resize:vertical;line-height:18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.qbw-textarea.card{min-height:360px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.qbw-btn{background:#2f6fed;color:#fff;border:none;border-radius:6px;font-size:12.5px;min-height:29px;padding:0 12px;cursor:pointer;white-space:nowrap}
.qbw-progress{height:6px;background:rgba(255,255,255,.14);border-radius:99px;overflow:hidden}
.qbw-progress>i{display:block;height:100%;background:#2f6fed;border-radius:99px;transition:width .35s ease}
.qbw-progress.indet>i{width:35%!important;animation:qbw-indet 1.1s ease-in-out infinite}
@keyframes qbw-indet{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}
.qbw-btn:disabled{opacity:.5;cursor:default}
.qbw-btn:hover:not(:disabled){background:#2a63d4}
.qbw-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.qbw-btn3{background:transparent;border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.qbw-btn.danger{background:#e5484d}
.qbw-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}
.qbw-foot{position:sticky;bottom:0;background:rgba(127,127,127,.06);border-top:1px solid var(--dsw-alias-border-l2);padding:10px 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.qbw-foot .spacer{flex:1}
.qbw-dirty{color:#ffb020;font-size:12px}
.qbw-ok{color:#2fbf71;font-size:12px}
.qbw-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.qbw-out{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:280px;overflow:auto;margin-top:10px}
.qbw-badge{display:inline-block;font-size:10.5px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px}
.qbw-badge.ok{background:rgba(47,191,113,.16);color:#2fbf71}
.qbw-badge.warn{background:rgba(255,176,32,.16);color:#b97800}
.qbw-badge.bad{background:rgba(229,72,77,.14);color:#e5484d}
.qbw-list{display:flex;flex-direction:column;gap:6px}
.qbw-item{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 10px;display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.qbw-item>div:first-child{flex:1;min-width:220px}
.qbw-table{width:100%;border-collapse:collapse;font-size:12px}
.qbw-table th,.qbw-table td{text-align:left;padding:6px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2);vertical-align:top}
.qbw-table th{color:var(--dsw-alias-label-tertiary);font-weight:500;font-size:11px}
.qbw-pill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 9px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.qbw-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.qbw-chip{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font-size:11.5px;line-height:18px;background:transparent;color:var(--dsw-alias-label-secondary)}
.qbw-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.qbw-chip.on{border-color:var(--dsw-alias-brand-primary);background:rgba(31,111,235,.14);color:var(--dsw-alias-label-primary)}
.qbw-warnbox{border:1px solid rgba(255,176,32,.35);background:rgba(255,176,32,.08);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:18px}
.qbw-infobox{border:1px solid rgba(31,111,235,.28);background:rgba(31,111,235,.06);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:18px}
.qbw-dangerbox{border:1px solid rgba(229,72,77,.30);background:rgba(229,72,77,.06);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:18px}
.qbw-admin{border:1px solid rgba(31,111,235,.45);border-radius:12px;padding:12px 14px;margin:0 0 12px;background:linear-gradient(135deg,rgba(31,111,235,.10),rgba(255,122,162,.07))}
.qbw-admin-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
.qbw-admin-title{font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-admin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:10px}
.qbw-admin-field{display:flex;flex-direction:column;gap:4px;font-size:12px}
.qbw-admin-field small{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
.qbw-admin-field .qbw-input{min-width:0;width:100%}
.qbw-admin-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:.5px dashed var(--dsw-alias-border-l2)}
.qbw-admin-check{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer}
.qbw-alias{border:1px solid rgba(255,122,162,.45);background:rgba(255,122,162,.07);border-radius:10px;padding:10px 12px;margin:0 0 10px}
.qbw-alias .qbw-input{width:100%;min-width:0;margin-top:6px}
.qbw-alias-title{font-size:13px;font-weight:650;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-switch{width:16px;height:16px;accent-color:#2f6fed;margin-top:2px}
.qbw-search{display:flex;gap:8px;align-items:center;margin:4px 0 10px;flex-wrap:wrap}
.qbw-search .qbw-input{flex:1;min-width:220px}
.qbw-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:760px){.qbw-cols{grid-template-columns:1fr}.qbw-body{padding:12px}.qbw-foot{padding:8px 12px}.qbw-app{border-radius:0;border-left:none;border-right:none}}
.qbw-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:rgba(127,127,127,.10);border-radius:4px;padding:1px 5px}
.qbw-scroll{max-height:260px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;background:rgba(127,127,127,.03)}
.qbw-scroll pre{margin:0;white-space:pre-wrap;font-size:11.5px;line-height:17px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.qbw-meter{height:9px;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden;margin:8px 0 6px}
.qbw-meter>i{display:block;height:100%;border-radius:inherit;background:#2fbf71;transition:width .3s ease}
.qbw-meter.warn>i{background:#ffb020}
.qbw-meter.bad>i{background:#e5484d}
.qbw-meter-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:12px}
.qbw-meter-head b{font-size:15px}
.qbw-rec{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;margin:6px 0;display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.qbw-rec>div:first-child{flex:1;min-width:260px}
.qbw-rec-title{font-size:12.5px;font-weight:600;line-height:18px}
.qbw-rec-text{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:17px;margin-top:2px;word-break:break-word}
.qbw-rec-actions{display:flex;gap:6px;flex-wrap:wrap}
.qbw-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 7px;font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-right:5px}
.qbw-chip.on{background:rgba(47,191,113,.14);border-color:rgba(47,191,113,.4);color:#2fbf71}
.qbw-chip.warn{background:rgba(255,176,32,.14);border-color:rgba(255,176,32,.4);color:#b97800}
.qbw-chip.bad{background:rgba(229,72,77,.12);border-color:rgba(229,72,77,.4);color:#e5484d}
.qbw-modal-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:18px}
.qbw-modal{width:100%;max-width:470px;background:#1c1f24;color:#f2f5f7;border:1px solid #3a3f46;border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.5);padding:18px 18px 14px}
.qbw-modal h3{margin:0 0 8px;font-size:16px;line-height:24px;display:flex;align-items:center;gap:8px}
.qbw-modal p{margin:0 0 10px;font-size:12.5px;line-height:19px;color:#c3c9d1}
.qbw-modal .qbw-hint{color:#9aa3ad}
.qbw-modal .qbw-chip{background:rgba(255,255,255,.12);color:#f2f5f7}
.qbw-modal .qbw-actions{margin-top:14px}
/* 弹窗内所有文字强制浅色：浅色主题下主题变量是深字，会和深色卡片糊在一起 */
.qbw-modal h3,.qbw-modal p,.qbw-modal label,.qbw-modal div,.qbw-modal span,.qbw-modal strong,.qbw-modal li{color:#f2f5f7}
.qbw-modal .qbw-hint{color:#9aa3ad}
.qbw-modal input.qbw-input{background:rgba(255,255,255,.08);color:#f2f5f7;border:1px solid #3a3f46}
.qbw-modal input[type=checkbox]{accent-color:#2f6fed}
/* ── Token 额度页 ─────────────────────────────────────────────── */
.qbw-budget-summary{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;border:1px solid rgba(31,111,235,.28);background:linear-gradient(135deg,rgba(31,111,235,.10),rgba(255,122,162,.06));border-radius:12px;padding:12px 14px;margin:0 0 12px}
.qbw-budget-summary .qbw-kicker{margin-bottom:2px}
.qbw-budget-big{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:2px 0 3px}
.qbw-budget-big b{font-size:23px;line-height:30px;font-weight:700}
.qbw-budget-big span{font-size:13px;color:var(--dsw-alias-label-secondary)}
.qbw-budget-status{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:420px}
.qbw-budget-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.qbw-budget-card{padding:11px 12px}
.qbw-budget-card.total{grid-column:1/-1;order:-1;border-color:rgba(31,111,235,.35);background:linear-gradient(135deg,rgba(31,111,235,.05),rgba(127,127,127,.02))}
.qbw-budget-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:7px}
.qbw-budget-head h4{margin:0 0 3px}
.qbw-budget-head p{margin:0;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px;max-width:440px}
.qbw-budget-today{display:flex;flex-direction:column;align-items:flex-end;gap:1px;font-size:11px;color:var(--dsw-alias-label-tertiary)}
.qbw-budget-today b{font-size:17px;line-height:22px;color:var(--dsw-alias-label-primary)}
.qbw-budget-lines{display:flex;flex-direction:column;gap:7px}
.qbw-budget-line{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:7px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.qbw-budget-field{display:flex;flex-direction:column;gap:3px;font-size:11.5px;min-width:170px;flex:1}
.qbw-budget-field>span{color:var(--dsw-alias-label-tertiary);font-size:11px}
.qbw-budget-field .qbw-input{min-width:150px;width:100%}
.qbw-budget-field small{color:var(--dsw-alias-label-tertiary);font-size:10.5px;line-height:15px}
.qbw-budget-meters{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:7px}
.qbw-budget-meter-empty{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--dsw-alias-label-tertiary);padding:5px 0}
.qbw-budget-meter .qbw-meter-head{font-size:11px}
.qbw-budget-meter .qbw-meter-head b{font-size:12px}
.qbw-budget-extra{margin-top:9px;padding-top:8px;border-top:.5px dashed var(--dsw-alias-border-l2)}
.qbw-budget-quick{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.qbw-budget-note{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}
.qbw-budget-note .qbw-hint{max-width:760px;line-height:18px}
.qbw-budget-note .qbw-btn{flex:0 0 auto}
@media(max-width:860px){.qbw-budget-grid{grid-template-columns:1fr}.qbw-budget-meters{grid-template-columns:1fr}}
`;

    // ── 基础工具 ────────────────────────────────────────────────────────────
    const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    const getPath = (obj, path) => path.reduce((o, k) => (o == null ? undefined : o[k]), obj);
    // 路径既接受 ["night","windows"]，也接受 "night.windows"。
    // 2026-10-24 踩坑：WindowsEditor 传的是字符串，旧 setPath 按字符下标遍历，
    // 生成了 n.i.g.h.t... 这样的垃圾嵌套键——界面看起来"改了但没保存"，
    // 表现就是添加/删除窗口、改时间全部弹回原值。这里统一归一化，避免同类事故。
    const pathKeys = (path) => (Array.isArray(path) ? path : String(path ?? "").split(".")).filter((key) => key !== "");
    const setPath = (obj, path, value) => {
      const keys = pathKeys(path);
      if (!keys.length) return;
      let cur = obj;
      for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i];
        if (cur[key] == null || typeof cur[key] !== "object" || Array.isArray(cur[key])) cur[key] = {};
        cur = cur[key];
      }
      cur[keys[keys.length - 1]] = value;
    };
    const p = (str) => str.split(".");
    const labelize = (str) =>
      String(str)
        .replace(/\./g, " · ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ");

    async function api(path, options = {}) {
      const res = await fetch(`${API}${path}`, {
        ...options,
        headers: {
          accept: "application/json",
          ...(options.body ? { "content-type": "application/json" } : {}),
          ...(options.headers ?? {}),
        },
        ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      });
      let data = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) {
        const error = new Error(data?.error || `HTTP ${res.status}`);
        error.status = res.status;
        error.data = data;
        throw error;
      }
      return data;
    }

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === "undefined") return;
        if (!document.getElementById(CSS_TAG)) {
          const el = document.createElement("style");
          el.id = CSS_TAG;
          el.textContent = CSS;
          document.head.appendChild(el);
        }
      }, []);
    }

    function fmtTime(iso) {
      if (!iso) return "—";
      try { return new Date(iso).toLocaleString("zh-CN", { hour12: false }); } catch { return iso; }
    }
    function fmtBytes(n) {
      const v = Number(n) || 0;
      if (v > 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB`;
      if (v > 1024) return `${(v / 1024).toFixed(1)} KB`;
      return `${v} B`;
    }

    // ── 通用控件 ────────────────────────────────────────────────────────────
    function Row({ label, hint, children, badge }) {
      return h("div", { className: "qbw-row" },
        h("div", null,
          h("div", { className: "qbw-label" }, label, badge ? h("span", { className: "qbw-badge" }, badge) : null),
          hint ? h("div", { className: "qbw-hint" }, hint) : null),
        children);
    }

    // 逗号分隔的列表输入框（2026-10-23 修）：
    // 以前每次按键都把 text 按逗号切开再 join 回去，逗号还没输进去就被吞掉 ✗。
    // 现在本地保存原始文本，输入过程中允许逗号；解析后的数组同步给父组件，失焦时再规范化。
    function ListInput({ value, onChange, readOnly, placeholder, className }) {
      const list = Array.isArray(value) ? value.map(String) : [];
      const joined = list.join("，");
      const [text, setText] = useState(joined);
      const focused = useRef(false);
      const last = useRef(joined);
      useEffect(() => {
        if (!focused.current && joined !== last.current) {
          last.current = joined;
          setText(joined);
        }
      }, [joined]);
      const parse = (raw) => [...new Set(String(raw ?? "").split(/[,，]/).map((s) => s.trim()).filter(Boolean))];
      const commit = (nextText) => {
        const next = parse(nextText);
        last.current = next.join("，");
        onChange(next);
      };
      return h("input", {
        className,
        value: text,
        readOnly,
        placeholder,
        autoComplete: "off",
        onFocus: () => { focused.current = true; },
        onChange: (e) => { setText(e.target.value); commit(e.target.value); },
        onBlur: () => {
          focused.current = false;
          const next = parse(text);
          last.current = next.join("，");
          setText(next.join("，"));
          onChange(next);
        },
      });
    }

    function Field({ f, value, onChange, readOnly }) {
      const common = { className: "qbw-input" + (f.wide ? " wide" : "") };
      let control;
      if (f.kind === "switch") {
        control = h("input", { className: "qbw-switch", type: "checkbox", checked: !!value, disabled: readOnly, onChange: (e) => onChange(e.target.checked) });
      } else if (f.kind === "number") {
        control = h("input", { ...common, type: "number", step: f.step ?? "any", min: f.min, max: f.max, value: value ?? "", readOnly, onChange: (e) => onChange(e.target.value === "" ? undefined : Number(e.target.value)) });
      } else if (f.kind === "select") {
        control = h("select", { className: "qbw-select", value: value ?? "", disabled: readOnly, onChange: (e) => onChange(e.target.value) },
          (f.options ?? []).map((opt) => {
            const [v, l] = Array.isArray(opt) ? opt : [opt, opt];
            return h("option", { key: v, value: v }, l);
          }));
      } else if (f.kind === "list") {
        control = h(ListInput, {
          className: common.className,
          value,
          readOnly,
          placeholder: f.placeholder ?? "逗号分隔",
          onChange,
        });
      } else if (f.kind === "times") {
        control = h(ListInput, {
          className: common.className,
          value,
          readOnly,
          placeholder: "07:00，11:00",
          onChange,
        });
      } else if (f.kind === "textarea") {
        control = h("textarea", { className: "qbw-textarea" + (f.wide ? " wide" : ""), value: value ?? "", readOnly, style: f.rows ? { minHeight: `${f.rows * 18}px` } : undefined, onChange: (e) => onChange(e.target.value) });
      } else if (f.kind === "json") {
        control = h(JsonCell, { value, onChange, readOnly, placeholder: f.placeholder });
      } else if (f.kind === "password") {
        control = h("input", { ...common, type: "password", value: value ?? "", readOnly, placeholder: f.placeholder ?? "已设置（保持 ******** 不变）", onChange: (e) => onChange(e.target.value) });
      } else {
        control = h("input", { ...common, value: value ?? "", readOnly, placeholder: f.placeholder, onChange: (e) => onChange(e.target.value) });
        if (f.browse && !readOnly) {
          control = h("div", { style: { display: "flex", gap: "8px", alignItems: "center" } },
            control,
            h("button", {
              type: "button",
              className: "qbw-btn2",
              onClick: async () => {
                const r = await browseNative(f.browse, f.label || "选择路径").catch((e) => ({ ok: false, error: e.message }));
                if (r.ok && r.path) onChange(String(r.path));
                else if (!r.cancelled) (window.__surfcoreToast || console.warn)(r.error || "打不开选择框，请手动填写");
              },
            }, "浏览…"));
        }
      }
      return h(Row, { label: f.label, hint: f.hint, badge: f.badge }, control);
    }

    // 高级设置里的参数组：QQ / B站 共用同一套渲染，避免两份 map 慢慢漂移。
    function FieldGroups({ groups, cfg, set, readOnly, groupExtra }) {
      return h("div", null, groups.map((g) => h(Section, {
        key: g.group,
        title: g.group,
        note: g.note,
        collapsible: false,
      },
        typeof groupExtra === "function" ? groupExtra(g) : null,
        g.fields.map((f) => h(Field, {
          key: f.path.join("."),
          f,
          value: getPath(cfg, f.path),
          readOnly: typeof readOnly === "function" ? readOnly(f) : f.readOnly,
          onChange: (v) => set(f.path, v),
        })))));
    }

    function JsonCell({ value, onChange, readOnly, placeholder }) {
      const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
      const [err, setErr] = useState("");
      useEffect(() => { setText(JSON.stringify(value ?? null, null, 2)); setErr(""); }, [JSON.stringify(value ?? null)]);
      return h("div", { style: { minWidth: "260px", flex: 1 } },
        h("textarea", {
          className: "qbw-textarea", style: { minHeight: "90px" },
          value: text, readOnly, placeholder,
          onChange: (e) => {
            const next = e.target.value;
            setText(next);
            try { onChange(JSON.parse(next)); setErr(""); } catch (error) { setErr("JSON 语法错误：" + error.message); }
          },
        }),
        err ? h("div", { className: "qbw-err" }, err) : null);
    }

    function Section({ title, note, children, defaultOpen = false, collapsible = true }) {
      const [open, setOpen] = useState(defaultOpen || !collapsible);
      return h("div", null,
        h("div", {
          className: "qbw-group",
          style: { cursor: collapsible ? "pointer" : "default" },
          onClick: collapsible ? () => setOpen((v) => !v) : undefined,
        },
          collapsible ? h("span", { style: { width: "14px", display: "inline-block" } }, open ? "▾" : "▸") : null,
          title,
          note ? h("small", null, note) : null),
        open || !collapsible ? h("div", { className: "qbw-rows" }, children) : null);
    }

    // 每个标签页只留最关键的几张卡；其余统一收进这个抽屉。
    // 抽屉里的分组用 <Section collapsible={false}>，避免“折叠套折叠”点两次。
    function AdvancedSettings({ children, note = "不常用的参数都在这里；展开后同样可改，改完统一点底部保存" }) {
      return h(Section, { title: "高级设置", note, defaultOpen: false }, children);
    }

    function StatusDot({ ok, warn, children }) {
      return h("span", { className: "qbw-dot " + (ok ? "ok" : warn ? "warn" : "bad") }, h("i"), children);
    }

    function Btn({ children, onClick, disabled, kind = "", title, type = "button" }) {
      return h("button", { type, title, className: `qbw-btn ${kind}`.trim(), onClick, disabled }, children);
    }

    // ── 管理员卡片（QQ / B站 两个标签页共用同一份身份）──────────────────────
    // 为什么放在最上面：用户要求管理员的 QQ 号与 B站 UID 默认是同一个人，
    // 这是比「鱼群保护 / 作息」更基础的身份设置。两个标签页改的是同一个
    // unified.admin，保存时由宿主投影到 qq.ownerQQ 与 bili.owner.mid。
    function AdminCard({ admin, onChange, qqPrivate = [], qqAllowAll = false }) {
      const value = admin && typeof admin === "object" ? admin : {};
      const set = (key, next) => onChange({ ...value, [key]: next });
      const configured = Boolean(value.qq || value.biliMid || value.biliName);
      const aligned = Boolean(value.qq && value.biliMid);
      const privateList = (Array.isArray(qqPrivate) ? qqPrivate : []).map(String);
      const blockedPrivate = Boolean(value.qq) && !qqAllowAll && !privateList.includes(String(value.qq));
      const badge = aligned ? "ok" : configured ? "warn" : "bad";
      const badgeText = aligned ? "同一个人 ✓" : configured ? "只填了一边" : "未设置";
      const digits = (next) => String(next ?? "").replace(/[^\d]/g, "");
      return h("div", { className: "qbw-admin" },
        h("div", { className: "qbw-admin-head" },
          h("div", null,
            h("div", { className: "qbw-admin-title" },
              "管理员（QQ ⇄ B站 · 同一个人）",
              h("span", { className: "qbw-badge " + badge }, badgeText),
              h("span", { className: "qbw-pill" }, "对 TA 温柔 · 不回嘴")),
            h("div", { className: "qbw-hint" },
              "默认就是同一个人：这里填一次，QQ 的 ownerQQ 和 B站 的 owner.mid 会同时写成这两个号（QQ 侧保存后需重启桥接，B站 下一轮生效）。"))),
        h("div", { className: "qbw-admin-grid" },
          h("label", { className: "qbw-admin-field" },
            h("span", null, "管理员 QQ"),
            h("input", {
              className: "qbw-input", inputMode: "numeric", placeholder: "例如 3287064288",
              value: value.qq ?? "",
              onChange: (e) => set("qq", digits(e.target.value)),
            }),
            h("small", null, "审批、管理命令、封闭模式都用这个 QQ")),
          h("label", { className: "qbw-admin-field" },
            h("span", null, "管理员 B站 UID（mid）"),
            h("input", {
              className: "qbw-input", inputMode: "numeric", placeholder: "例如 37634003",
              value: value.biliMid ?? "",
              onChange: (e) => set("biliMid", digits(e.target.value)),
            }),
            h("small", null, "B站 评论区 / 私信 / 直播间认主用这个 mid")),
          h("label", { className: "qbw-admin-field" },
            h("span", null, "怎么称呼 TA"),
            h("input", {
              className: "qbw-input", placeholder: "留空就用 B站 昵称",
              value: value.displayName ?? "",
              onChange: (e) => set("displayName", e.target.value),
            }),
            h("small", null, "人格卡和提示词里都用这个称呼")),
          h("label", { className: "qbw-admin-field" },
            h("span", null, "B站 昵称"),
            h("input", {
              className: "qbw-input", placeholder: "例如 你的B站昵称",
              value: value.biliName ?? "",
              onChange: (e) => set("biliName", e.target.value),
            }),
            h("small", null, "B站 提示词里用来认人"))),
        h("div", { className: "qbw-admin-foot" },
          h("label", { className: "qbw-admin-check" },
            h("input", {
              type: "checkbox", className: "qbw-switch",
              checked: value.gentle !== false,
              onChange: (e) => set("gentle", e.target.checked),
            }),
            h("span", null, "对管理员更温柔、绝不回嘴")),
          h("span", { className: "qbw-hint" }, "QQ 消息和 B站 回复都适用；关掉 = 只按人格卡。")),
        blockedPrivate
          ? h("div", { className: "qbw-warnbox" }, "⚠️ 管理员 QQ 不在私聊白名单 allow.private 里：私聊会被拦截（白名单为空时也没人放行）。去下面的「QQ 白名单」把 TA 加进去。")
          : null,
        configured && !aligned
          ? h("div", { className: "qbw-warnbox" }, "⚠️ 只填了一边：QQ 和 B站 要分别是同一个人的两个号，两边才都认得出。")
          : null);
    }

    // ── QQ 白名单（群 / 人）──────────────────────────────────────────────────
    // 功能一直都在（allow.groups / allow.private），但以前只藏在 QQ 页折叠的
    // 「白名单与权限」组里，用户找不到。这里单独做成卡片，并把常见错误
    // （管理员不在私聊白名单、白名单为空时全放行）直接显示出来。
    function parseIdListText(text) {
      return [...new Set(String(text ?? "").split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean))];
    }

    // 逗号分隔的 ID 输入框：本地保留原始文本（能正常打逗号），同时把解析结果
    // 同步给父组件；chips 可单个删除。外部 reset / reload 时跟着更新。
    function IdListEditor({ value, onChange, placeholder, ownerQQ = "", emptyHint = "" }) {
      const list = (Array.isArray(value) ? value : []).map(String);
      const asText = list.join("，");
      const [text, setText] = useState(asText);
      const last = useRef(asText);
      useEffect(() => {
        if (asText !== last.current) { last.current = asText; setText(asText); }
      }, [asText]);
      const parsed = parseIdListText(text);
      const commit = (nextText) => {
        const next = parseIdListText(nextText);
        last.current = next.join("，");
        onChange(next);
      };
      const change = (nextText) => { setText(nextText); commit(nextText); };
      const remove = (id) => {
        const next = parsed.filter((item) => item !== id);
        setText(next.join("，")); commit(next.join("，"));
      };
      return h("div", null,
        h("input", {
          className: "qbw-input wide", value: text, placeholder,
          onChange: (e) => change(e.target.value),
          onBlur: () => { const next = parseIdListText(text); setText(next.join("，")); commit(next.join("，")); },
        }),
        h("div", { style: { display: "flex", gap: "5px", flexWrap: "wrap", marginTop: "7px" } },
          parsed.length
            ? parsed.map((id) => h("span", {
                key: id,
                className: "qbw-chip" + (ownerQQ && id === String(ownerQQ) ? " on" : "") + (/^\d{4,15}$/.test(id) ? "" : " bad"),
              },
                ownerQQ && id === String(ownerQQ) ? "管理员 " : "",
                id,
                h("span", {
                  title: "移除", style: { cursor: "pointer", opacity: 0.65, marginLeft: "1px" },
                  onClick: () => remove(id),
                }, "×")))
            : h("span", { className: "qbw-hint" }, emptyHint || "（空）")));
    }

    function WhitelistCard({ allow = {}, allowAll = false, ownerQQ = "", onAllowChange, onAllowAllChange }) {
      const groups = Array.isArray(allow?.groups) ? allow.groups.map(String) : [];
      const people = Array.isArray(allow?.private) ? allow.private.map(String) : [];
      const ownerMissing = Boolean(ownerQQ) && !people.includes(String(ownerQQ));
      const setList = (key) => (list) => onAllowChange(key, list);
      return h("div", { className: "qbw-admin", style: { borderColor: "rgba(47,191,113,.45)", background: "linear-gradient(135deg,rgba(47,191,113,.10),rgba(31,111,235,.06))" } },
        h("div", { className: "qbw-admin-head" },
          h("div", null,
            h("div", { className: "qbw-admin-title" },
              "QQ 白名单（群 / 人）",
              h("span", { className: "qbw-badge " + (groups.length && people.length && !ownerMissing ? "ok" : "warn") }, `群 ${groups.length} · 人 ${people.length}`),
              allowAll ? h("span", { className: "qbw-badge warn" }, "空名单 = 全放行") : null),
            h("div", { className: "qbw-hint" },
              "只有名单里的群和私聊 QQ 能触发 QQ 侧智能体；没进名单的会被拦截。改完点底部「保存」，重启 QQ 桥接后生效。"))),
        h("div", { className: "qbw-admin-grid" },
          h("div", { className: "qbw-admin-field" },
            h("span", null, "群白名单（allow.groups）"),
            h(IdListEditor, {
              value: groups,
              placeholder: "群号，逗号分隔：123456789，987654321",
              emptyHint: "还没有群：机器人不会在任何群响应（除非开启下面的全放行）",
              onChange: setList("groups"),
            }),
            h("small", null, "群号在 QQ 群资料里看；填 5~12 位数字")),
          h("div", { className: "qbw-admin-field" },
            h("span", null, "私聊白名单（allow.private）"),
            h(IdListEditor, {
              value: people, ownerQQ: String(ownerQQ || ""),
              placeholder: "QQ 号，逗号分隔：12345678，87654321",
              emptyHint: "还没有人：所有私聊都会被拦截（管理员也进不来）",
              onChange: setList("private"),
            }),
            h("small", null, "管理员的 QQ 必须在里面，否则审批 / 私聊都不通"))),
        ownerMissing
          ? h("div", { className: "qbw-warnbox" },
              "⚠️ 管理员 QQ ", h("b", null, String(ownerQQ)), " 不在私聊白名单里：私聊和审批会被拦截。",
              h("span", { style: { marginLeft: "8px" } },
                h(Btn, { kind: "qbw-btn2", onClick: () => setList("private")([...people, String(ownerQQ)]) }, "把管理员加进去")))
          : null,
        allowAll
          ? h("div", { className: "qbw-dangerbox" }, "⚠️ 「白名单为空时全部放行」开着：任何群 / 任何 QQ 都能触发智能体。建议先填名单，再关掉这个开关。")
          : null,
        h("div", { className: "qbw-admin-foot" },
          h("label", { className: "qbw-admin-check" },
            h("input", {
              type: "checkbox", className: "qbw-switch", checked: allowAll,
              onChange: (e) => onAllowAllChange(e.target.checked),
            }),
            h("span", null, "白名单为空时全部放行（不推荐）")),
          h("span", { className: "qbw-hint" }, "黑名单（deny.*）优先于白名单，在下面的「QQ 黑名单」卡片里设置。")));
    }

    // ── QQ 黑名单（人 / 群 / 私聊）──────────────────────────────────────────
    // 2026-10-23 用户要求：「白名单那里底下加一个黑名单功能，不响应黑名单中的人的消息，无论什么群」。
    // 三档分别对应 config.deny.users / deny.groups / deny.private：
    //   users   → 按**人**拦：无论在哪个群、还是私聊，他说的话都不响应（不入库、不触发唤醒）；
    //   groups  → 按群拦：整个群不响应（即使它在白名单里）；
    //   private → 按私聊对象拦。
    // 以前 deny.private / deny.groups 藏在「黑名单（高级）」折叠组里，和白名单隔着好几屏；
    // 现在统一收到这张卡，和 allow.* 一一对应，同一份数据只留一处可改（PITFALLS #27 的教训）。
    function BlacklistCard({ deny = {}, ownerQQ = "", onDenyChange }) {
      const people = Array.isArray(deny?.users) ? deny.users.map(String) : [];
      const groups = Array.isArray(deny?.groups) ? deny.groups.map(String) : [];
      const privates = Array.isArray(deny?.private) ? deny.private.map(String) : [];
      const ownerBlocked = Boolean(ownerQQ) && people.includes(String(ownerQQ));
      // 「只在私聊里被拉黑」的人：群里照样会回复。2026-10-23 真实踩过——
      // 要「彻底不理这个人」却填进了私聊黑名单，然后在群里测试发现还在回。
      const privateOnly = privates.filter((id) => !people.includes(id));
      const total = people.length + groups.length + privates.length;
      const setList = (key) => (list) => onDenyChange(key, list);
      return h("div", { className: "qbw-admin", style: { borderColor: "rgba(229,72,77,.40)", background: "linear-gradient(135deg,rgba(229,72,77,.08),rgba(255,176,32,.05))" } },
        h("div", { className: "qbw-admin-head" },
          h("div", null,
            h("div", { className: "qbw-admin-title" },
              "QQ 黑名单（人 / 群 / 私聊）",
              h("span", { className: "qbw-badge " + (total ? "warn" : "") }, `人 ${people.length} · 群 ${groups.length} · 私聊 ${privates.length}`)),
            h("div", { className: "qbw-hint" },
              "黑名单优先于白名单：名单里的群 / 私聊 / 人，桥接直接不响应 —— 不回复、不触发唤醒、不写进上下文和记忆。改完点底部「保存」，重启 QQ 桥接后生效。"))),
        h("div", { className: "qbw-admin-grid" },
          h("div", { className: "qbw-admin-field" },
            h("span", null, "拉黑的人（deny.users）"),
            h(IdListEditor, {
              value: people,
              placeholder: "QQ 号，逗号分隔：12345678，87654321",
              emptyHint: "还没有人：任何人都能触发（仍受上面的白名单约束）",
              onChange: setList("users"),
            }),
            h("small", null, "无论在哪个群、还是私聊，这个 QQ 说的话都不响应")),
          h("div", { className: "qbw-admin-field" },
            h("span", null, "拉黑的群（deny.groups）"),
            h(IdListEditor, {
              value: groups,
              placeholder: "群号，逗号分隔：123456789",
              emptyHint: "还没有群：白名单里的群都能触发",
              onChange: setList("groups"),
            }),
            h("small", null, "整个群不响应；即使它在群白名单里")),
          h("div", { className: "qbw-admin-field" },
            h("span", null, "仅拦私聊（deny.private）"),
            h(IdListEditor, {
              value: privates,
              placeholder: "QQ 号，逗号分隔：12345678",
              emptyHint: "还没有人：白名单里的私聊都能触发",
              onChange: setList("private"),
            }),
            h("small", null, "⚠️ 只在私聊里不理他；他在群里照常会被回复"))),
        privateOnly.length
          ? h("div", { className: "qbw-warnbox" },
              "⚠️ 有 ", h("b", null, String(privateOnly.length)), " 个人只填在「仅拦私聊」里：他们在群里照样会被回复。",
              h("span", { style: { marginLeft: "8px" } },
                h(Btn, { kind: "qbw-btn2", onClick: () => setList("users")([...new Set([...people, ...privateOnly])]) }, `把这 ${privateOnly.length} 人加到「拉黑的人」`)))
          : null,
        ownerBlocked
          ? h("div", { className: "qbw-dangerbox" },
              "⚠️ 管理员 QQ ", h("b", null, String(ownerQQ)), " 在黑名单里：审批、私聊、管理命令都会被忽略，智能体会静默失联。",
              h("span", { style: { marginLeft: "8px" } },
                h(Btn, { kind: "qbw-btn2", onClick: () => setList("users")(people.filter((id) => id !== String(ownerQQ))) }, "把管理员移出黑名单")))
          : null,
        h("div", { className: "qbw-admin-foot" },
          h("span", { className: "qbw-hint" },
            "「拉黑的人」只拦入站：她主动发消息仍受 allow.groups / allow.private 约束；拉黑也不会删掉已经记进记忆卡的内容。")));
    }

    // ── 平台启动开关（2026-10-24 用户要求）──────────────────────────────────
    // 不是所有用户都想同时开 QQ 和 B站。开关放在各自标签页顶部：
    //   · 开 = DSH 启动时自动拉起该平台，并纳入「一键启动」；
    //   · 关 = 不自动启动、不被「一键启动」带上；保存后宿主会停掉正在跑的那一边。
    // 唯一真相是合体层 config.json 的 platforms.start.{qq,bili}（不是两份配置各存一份）。
    function PlatformStartCard({ platform, hint, enabled, onChange, running, overview }) {
      const start = overview?.platformStart ?? {};
      const savedEnabled = start[platform] !== false;
      const nextEnabled = enabled !== false;
      const pending = nextEnabled !== savedEnabled;
      return h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
        h("h4", null, `${platform === "qq" ? "QQ" : "B站"} 启动`),
        h(Row, {
          label: "是否启动",
          hint,
        }, h("input", {
          type: "checkbox",
          checked: nextEnabled,
          onChange: (e) => onChange(e.target.checked),
        })),
        h("div", { className: "qbw-hint" },
          pending
            ? `改动还没保存：保存后会${nextEnabled ? "启动并纳入「一键启动」" : "停掉正在运行的一边，也不再参与「一键启动」"}。`
            : nextEnabled
              ? (savedEnabled && running ? "当前：运行中" : "当前：未运行；可在「概览」点单平台启动或「一键启动」。")
              : "当前：已关闭；不会被「一键启动」带上。"));
    }

    // ── 对齐表里的「称呼」单元格 ─────────────────────────────────────────────
    // 称呼是管理员点名：以后 QQ / B站 都只用这个叫法，不再用群名片 / B站昵称。
    // 每行独立组件，才有自己的未保存状态（改一行、按 Enter 或点保存就写回）。
    function AliasCell({ link, onSave, busy, disabled }) {
      const current = String(link?.label ?? "");
      const [value, setValue] = useState(current);
      useEffect(() => { setValue(current); }, [current]);
      const dirty = value.trim() !== current.trim();
      const commit = () => { if (dirty && !busy && !disabled) onSave(link.id, value.trim()); };
      return h("div", { style: { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" } },
        h("input", {
          className: "qbw-input",
          style: { minWidth: "110px", width: "120px" },
          placeholder: disabled ? "重启 DSH 后可设" : "设个称呼",
          value,
          disabled: !!disabled,
          onChange: (e) => setValue(e.target.value),
          onKeyDown: (e) => { if (e.key === "Enter") commit(); },
        }),
        dirty && !disabled ? h(Btn, { kind: "qbw-btn2", onClick: commit, disabled: !!busy }, "保存") : null);
    }

    // ── 字段描述 ────────────────────────────────────────────────────────────
    const F = (path, label, hint, kind = "text", extra = {}) => ({ path: p(path), label, hint, kind, ...extra });
    // 原生选择框：浏览器拿不到绝对路径，只能让宿主进程弹 Windows 对话框。
    const Browse = ({ mode = "dir", onPick, title, label = "浏览…" }) => h(Btn, {
      kind: "qbw-btn2",
      onClick: async () => {
        try {
          const r = await browseNative(mode, title || (mode === "file" ? "选择文件" : "选择目录"));
          if (r.ok && r.path) onPick(String(r.path));
          else if (!r.cancelled) (window.__surfcoreToast || console.warn)(r.error || "打不开选择框，请手动填路径");
        } catch (e) { (window.__surfcoreToast || console.warn)(e.message); }
      },
    }, label);

    const QQ_FIELDS = [
      { group: "连接与身份", note: "QQ 桥接 / DSH 连接", fields: [
        F("dsh.baseUrl", "DSH 地址", "桥接连接本机 DSH 的 Web 地址"),
        F("dsh.provider", "模型提供方", "例如 deepseek-account"),
        F("dsh.model", "模型", "QQ 会话使用的模型"),
        F("dsh.reasoningEffort", "思考强度", "low / medium / high / max"),
        F("dsh.authToken", "DSH token", "通常留空，由桥接自动发现", "password"),
        F("dsh.allowRemote", "允许远程 DSH", "默认关；关掉只连本机", "switch"),
        // ownerQQ 不在这里：它已上移到两个标签页顶部的「管理员（QQ ⇄ B站 · 同一个人）」卡片，
        // 和 B站 owner.mid 一起保存，避免两个入口各改一边。
        F("agentPreset", "一代 preset", "默认 qq-chat"),
        F("workspaceTitle", "工作区名称", "QQ 会话在 DSH 里的归组名"),
F("sessionCwd", "会话工作目录", "留空用 surfcore 根目录", "text", { browse: "dir" }),
      ]},
      { group: "SnowLuma", note: "OneBot 网关；「一键启动」只在你点击时打开本机已安装的 SnowLuma 窗口，不安装、不部署、不代扫码", fields: [
        F("snowluma.wsUrl", "OneBot WebSocket", "例如 ws://127.0.0.1:3001"),
        F("snowluma.httpUrl", "OneBot HTTP", "例如 http://127.0.0.1:3000（不能和 WS 同端口）"),
        F("snowluma.accessToken", "OneBot accessToken", "SnowLuma 里配置的 token", "password"),
        F("snowluma.followDiscoveredEndpoint", "跟随自发现端点", "网关换端口时自动跟随", "switch"),
        F("snowluma.silenceWarnMs", "静默告警阈值（ms）", "多久没事件包就警告", "number", { min: 60000 }),
        F("snowluma.allowLaunch", "允许插件打开 SnowLuma", "默认关；开启后一键启动会弹出 SnowLuma 窗口，仍需你扫码", "switch"),
        F("snowluma.launcherPath", "SnowLuma 安装目录", "解压出来的根目录（里面有 app）；例如 D:/Tools/SnowLuma2", "text", { browse: "dir" }),
        F("snowluma.launchScript", "启动脚本（可选）", "留空自动找 安装目录\\app\\launcher.bat", "text", { wide: true }),
        F("snowluma.homeDir", "SnowLuma home（app 目录）", "内含 config 的那个目录，一般是 安装目录 下的 app；填错会导致「检测不到」", "text", { browse: "dir" }),
      ]},
      { group: "控制台", note: "桥接本地控制台", fields: [
        F("consolePort", "控制台端口", "默认 3100", "number", { min: 1024, max: 65535 }),
        F("consoleToken", "控制台令牌", "留空 = 自动生成并保存到 state/console-token", "password"),
        F("ackMessage", "收到消息的自动回复", "空字符串关闭"),
        F("sendDelayMs", "发送间隔（ms）", "防频率限制", "number", { min: 0 }),
        F("questionTimeoutMs", "提问/审批超时（ms）", "默认 5 分钟", "number", { min: 10000 }),
      ]},
      { group: "安全通知", note: "黑名单（deny.users / deny.groups / deny.private）在页面顶部的「QQ 黑名单」卡片里，这里不再重复输入框", fields: [
        F("security.interceptNotify", "安全拦截通知", "拦截到敏感操作时通知管理员", "switch"),
      ]},
      { group: "人格与注入", note: "人格卡在「角色」页统一编辑", fields: [
        F("role.maxInjectChars", "人格注入上限（字符）", "1000~20000；默认 6000", "number", { min: 1000, max: 20000 }),
      ]},
      { group: "一代仿真（reserved）", note: "文本自动转发 + [SILENT]", fields: [
        F("social.enabled", "启用一代仿真", "", "switch"),
        F("social.maxReplyChars", "单条最大字数", "", "number", { min: 20 }),
        F("social.mustReplyKeywords", "必须回复关键词", "逗号分隔", "list"),
        F("social.contextWindow", "上下文条数", "", "number", { min: 0 }),
        F("social.triggerProbability", "普通消息触发概率", "0~1", "number", { min: 0, max: 1, step: 0.01 }),
        F("social.activeCheckMinMs", "活跃检测最小间隔（ms）", "", "number"),
        F("social.activeCheckMaxMs", "活跃检测最大间隔（ms）", "", "number"),
        F("social.idleWindowMs", "空闲窗口（ms）", "", "number"),
        F("social.idleRetryProbability", "空闲重试概率", "", "number", { min: 0, max: 1, step: 0.01 }),
        F("social.proactiveEnabled", "主动搭话", "", "switch"),
        F("social.proactiveIdleThresholdMs", "主动搭话空闲阈值（ms）", "", "number"),
        F("social.proactiveCheckMinMs", "主动检查最小间隔（ms）", "", "number"),
        F("social.proactiveCheckMaxMs", "主动检查最大间隔（ms）", "", "number"),
        F("social.proactiveProbability", "主动搭话概率", "", "number", { min: 0, max: 1, step: 0.01 }),
        F("social.activeReplyDelayMinMs", "回复延迟最小（ms）", "", "number"),
        F("social.activeReplyDelayMaxMs", "回复延迟最大（ms）", "", "number"),
        F("social.activeDurationEnabled", "活跃时长限制", "", "switch"),
        F("social.activeDurationMinMs", "活跃时长最小（ms）", "", "number"),
        F("social.activeDurationMaxMs", "活跃时长最大（ms）", "", "number"),
        F("social.skipProbability", "跳过概率", "", "number", { min: 0, max: 1, step: 0.01 }),
        F("social.surrenderProbability", "放弃概率", "", "number", { min: 0, max: 1, step: 0.01 }),
        F("social.idleRetryWaitMs", "空闲重试等待（ms）", "", "number"),
        F("social.burstEnabled", "分条发送", "", "switch"),
        F("social.burstIntervalMinMs", "分条最小间隔（ms）", "", "number"),
        F("social.burstIntervalMaxMs", "分条最大间隔（ms）", "", "number"),
        F("social.longGapProbability", "长间隔概率", "", "number", { min: 0, max: 1, step: 0.01 }),
        F("social.longGapMinMs", "长间隔最小（ms）", "", "number"),
        F("social.longGapMaxMs", "长间隔最大（ms）", "", "number"),
      ]},
      { group: "二代仿真（reserved2）", note: "工具化收发 + 自主潜水", fields: [
        F("socialV2.enabled", "启用二代仿真", "", "switch"),
        F("socialV2.autoReplyCheckMs", "自动回复检查间隔（ms）", "", "number"),
        F("socialV2.agentPreset", "二代 preset", "默认 qq-chat-v2"),
        F("socialV2.provideRecommendations", "提供推荐值", "", "switch"),
        F("socialV2.initialPromptMaxChars", "初始提示词上限（字符）", "100~8000", "number", { min: 100, max: 8000 }),
      ]},
      { group: "鱼群判定关键词（QQ）", note: "开头 / 中间 / 结尾任一命中即算鱼；默认 肥鱼 + 结尾 fish/鱼；群名关键词只收紧鱼窝阈值，不把人算鱼", fields: [
        F("fishGuard.namePrefixes", "鱼名开头词", "逗号分隔；名字以这些词开头就算鱼（默认空，例如 DSH）", "list", { placeholder: "点击输入，例如 DSH（逗号分隔）" }),
        F("fishGuard.nameContains", "鱼名包含词", "逗号分隔；名字里只要包含这些词就算鱼（默认 肥鱼，例如 吃白饭）", "list"),
        F("fishGuard.nameSuffixes", "鱼名结尾词", "逗号分隔；默认 肥鱼,fish,鱼（最后一个字是鱼也算；接受极小概率误伤真人）", "list"),
        F("fishGuard.groupNameSuffixes", "鱼窝群名包含词", "逗号分隔；群名包含这些词时收紧阈值（不把人算成鱼）", "list"),
        F("fishGuard.fishIds", "额外认定的鱼 QQ", "逗号分隔；名字不像但确认是鱼时填这里", "list"),
        F("fishGuard.exemptNames", "豁免昵称", "逗号分隔；人类用鱼名时不误伤", "list"),
        F("fishGuard.exemptIds", "豁免 QQ", "逗号分隔", "list"),
      ]},
      { group: "鱼群保护（QQ）", note: "多个同类角色同群时自动少说；只影响群聊自动参与，私聊/管理员不受影响；保存后重启 QQ 桥接生效", fields: [
        F("fishGuard.enabled", "启用 QQ 鱼群保护", "关掉 = 永远按原逻辑参与", "switch"),
        F("fishGuard.windowMs", "统计窗口（ms）", "默认 600000（10 分钟）", "number", { min: 60000 }),
        F("fishGuard.cooldownMs", "触发后冷却（ms）", "默认 600000；冷却内只回直接叫它的人", "number", { min: 60000 }),
        F("fishGuard.maxFish", "多少条不同的鱼算泛滥", "默认 5（不同发送者）", "number", { min: 2, max: 20 }),
        F("fishGuard.maxConsecutiveFish", "连续多少条鱼消息算刷屏", "默认 5；至少要 2 条不同的鱼", "number", { min: 2, max: 30 }),
        F("fishGuard.singleFishMaxConsecutive", "单只鱼连续多少条才拦", "默认 5；想更宽松可调到 8", "number", { min: 2, max: 50 }),
        F("fishGuard.maxFishMessages", "补充：鱼消息条数阈值", "默认 8；与占比同时命中才拦", "number", { min: 2 }),
        F("fishGuard.maxFishRatio", "补充：鱼消息占比阈值", "0~1；默认 0.6", "number", { min: 0, max: 1, step: 0.05 }),
        F("fishGuard.minSample", "补充：最少样本条数", "默认 8；样本太少不按占比判定", "number", { min: 2 }),
        F("fishGuard.minFishSendersForRatio", "补充：至少几条不同的鱼", "默认 2；防单鱼占比误判", "number", { min: 1 }),
        F("fishGuard.groupNestMaxFish", "鱼窝群的收紧阈值", "群名像鱼窝时，不同鱼≥3 就触发", "number", { min: 2 }),
        F("fishGuard.groupNestIds", "指定鱼窝群号", "逗号分隔；这些群直接按鱼窝收紧阈值", "list"),
        F("fishGuard.bypassDirectAddress", "被直接叫到时放行", "默认开；只回一句，不主动展开", "switch"),
        F("fishGuard.blockSends", "保护期内硬拦发送", "默认开；防止 AI 趁冷却偷偷发", "switch"),
      ]},
      { group: "Token 防爆破", note: "和鱼群守则同时生效：鱼群守则先拦，再按这里限制唤醒次数/单次发送条数；每日花费/额度已迁移到「Token 额度」页（按自然日，QQ/B站/总额分开管）", fields: [
        F("socialV2.tokenGuard.enabled", "启用 Token 防爆破", "默认开；关掉 = 只按旧限频", "switch"),
        F("socialV2.tokenGuard.maxWakesPerDay", "单会话每天最多醒", "默认 20；群聊；超过后不再唤醒", "number", { min: 0, max: 200 }),
        F("socialV2.tokenGuard.privateMaxWakesPerDay", "私聊每天最多醒", "默认 10；私聊爆破先卡这里", "number", { min: 0, max: 200 }),
        F("socialV2.tokenGuard.minWakeGapMs", "两次苏醒最小间隔（ms）", "默认 120000；普通消息再多也先合并", "number", { min: 0, max: 3600000 }),
        F("socialV2.tokenGuard.directBypassGap", "被 @/叫到时越过间隔", "默认开；@、引用、叫名字、提问、拍一拍可立即唤醒；每日次数/额度上限仍生效", "switch"),
        F("socialV2.tokenGuard.maxOutboundPerTurn", "每次醒来最多发", "默认 8 条；连续回 10 条仍会被硬拦", "number", { min: 1, max: 20 }),
      ]},
      { group: "二代 · 唤醒与潜水", note: "qq_set_wake_config 的边界", fields: [
        F("socialV2.wake.defaultMode", "默认状态", "diving / active", "select", { options: [["diving", "潜水"], ["active", "活跃"]] }),
        F("socialV2.wake.preSleepWaitEnabled", "沉睡前必须观察", "", "switch"),
        F("socialV2.wake.preSleepWaitMs", "沉睡前观察时长（ms）", "默认 300000", "number", { min: 10000 }),
        F("socialV2.wake.recommendedDefaultInfinite", "推荐无限期潜水", "", "switch"),
        F("socialV2.wake.sleepMinMs", "潜水最短（ms）", "", "number"),
        F("socialV2.wake.sleepMaxMs", "潜水最长（ms；0=无限）", "", "number"),
        F("socialV2.wake.recommendedSleepMinMs", "推荐最短（ms）", "", "number"),
        F("socialV2.wake.recommendedSleepMaxMs", "推荐最长（ms）", "", "number"),
        F("socialV2.wake.recommendedProbability", "推荐普通消息概率", "", "number", { min: 0, max: 1, step: 0.01 }),
        F("socialV2.wake.recommendedKeywords", "推荐唤醒关键词", "逗号分隔", "list"),
        F("socialV2.wake.recommendedAtMention", "推荐 @ 唤醒", "", "switch"),
        F("socialV2.wake.recommendedNameMention", "推荐名字唤醒", "", "switch"),
        F("socialV2.wake.recommendedQuestion", "推荐提问唤醒", "", "switch"),
        F("socialV2.wake.recommendedPoke", "推荐拍一拍唤醒", "", "switch"),
        F("socialV2.wake.batchWindowMs", "合并唤醒窗口（ms）", "", "number"),
        F("socialV2.wake.maxWakePerMinute", "每分钟最多唤醒", "", "number", { min: 0 }),
        F("socialV2.wake.maxWakePerHour", "每小时最多唤醒", "", "number", { min: 0 }),
        F("socialV2.wake.noActionLimit", "无动作上限", "", "number", { min: 0 }),
        F("socialV2.wake.maxWakeConfigReminders", "唤醒配置提醒上限", "", "number", { min: 0 }),
        F("socialV2.wake.recommendedHint", "推荐提示词", "给模型的推荐说明", "textarea", { rows: 4 }),
      ]},
      { group: "二代 · 对话收尾判断", note: "让每段对话有自然终点：判断该结束时不再补一句，而是记下收在哪、下次怎么接；不是潜水，被叫到/私聊仍会醒", fields: [
        F("socialV2.closure.enabled", "启用对话收尾判断", "默认开；关掉后模型不会收到收尾建议，也不能调用 qq_close_conversation", "switch"),
        F("socialV2.closure.cooldownMs", "收尾后软冷却（ms）", "默认 1200000（20 分钟）；只压普通概率唤醒/回复检查/主动机会，@/提问/私聊不受影响", "number", { min: 60000 }),
        F("socialV2.closure.requireNoOpenQuestion", "对方还在问时拒绝收尾", "默认开；防止用「结束」逃避该回的问题", "switch"),
        F("socialV2.closure.promptInWake", "每次唤醒注入判断参数", "默认开；有近期对话时才注入，没对话不占 token", "switch"),
        F("socialV2.closure.maxSummaryChars", "收尾摘要上限（字）", "默认 160", "number", { min: 20, max: 500 }),
        F("socialV2.closure.maxNextOpeningChars", "下次接法上限（字）", "默认 120", "number", { min: 10, max: 300 }),
      ]},
      { group: "二代 · 上线补历史消息", note: "桥接/QQ 账号上线时，用 SnowLuma 的历史消息接口补看离线期间错过的白名单会话；默认开，保存后重启 QQ 桥接生效", fields: [
        F("socialV2.history.enabled", "每次上线补看历史消息", "默认开；关掉后不请求历史接口", "switch"),
        F("socialV2.history.limit", "每个会话最多补几条", "默认 30；历史接口按最新 N 条返回", "number", { min: 1, max: 100 }),
        F("socialV2.history.maxAgeMinutes", "只补最近多少分钟", "默认 720（12 小时）", "number", { min: 1, max: 10080 }),
        F("socialV2.history.wake", "发现漏消息时主动醒一次", "默认开；关掉则只并入未读，等下次有人说话再看", "switch"),
        F("socialV2.history.includePrivate", "也补私聊", "默认开；只补白名单会话", "switch"),
      ]},
      { group: "二代 · 发送与节奏", fields: [
        F("socialV2.send.burstEnabled", "分条发送", "", "switch"),
        F("socialV2.send.burstMaxMessages", "单轮最多条数", "", "number", { min: 1 }),
        F("socialV2.send.burstIntervalMinMs", "分条最小间隔（ms）", "", "number"),
        F("socialV2.send.burstIntervalMaxMs", "分条最大间隔（ms）", "", "number"),
        F("socialV2.send.longGapProbability", "长间隔概率", "", "number", { min: 0, max: 1, step: 0.01 }),
        F("socialV2.send.longGapMinMs", "长间隔最小（ms）", "", "number"),
        F("socialV2.send.longGapMaxMs", "长间隔最大（ms）", "", "number"),
        F("socialV2.send.maxSendPerMinute", "每分钟最多发送", "", "number", { min: 1 }),
        F("socialV2.send.maxSendPerHour", "每小时最多发送", "", "number", { min: 1 }),
        F("socialV2.send.maxMessageChars", "单条最大字符", "", "number", { min: 10 }),
        F("socialV2.send.maxGapMs", "最大间隔（ms）", "", "number"),
        F("socialV2.send.gapBaseMs", "基础间隔（ms）", "", "number"),
        F("socialV2.send.gapPerCharMs", "每字追加间隔（ms）", "", "number"),
        F("socialV2.send.recommendedHint", "节奏提示词", "给模型的分条建议", "textarea", { rows: 4 }),
      ]},
      { group: "二代 · 等待与上下文", fields: [
        F("socialV2.wait.defaultMs", "默认等待（ms）", "", "number"),
        F("socialV2.wait.minMs", "最短等待（ms）", "", "number"),
        F("socialV2.wait.maxMs", "最长等待（ms）", "", "number"),
        F("socialV2.wait.defaultQuietMs", "默认静默（ms）", "", "number"),
        F("socialV2.wait.minQuietAfterNewMs", "新消息后最短静默（ms）", "", "number"),
        F("socialV2.context.recentLimit", "最近消息上限", "", "number"),
        F("socialV2.context.unreadLimit", "未读上限", "", "number"),
        F("socialV2.context.contextWindow", "上下文窗口", "", "number"),
        F("socialV2.context.inlineWakeMessages", "唤醒时内联消息", "", "switch"),
        F("socialV2.context.wakeFoldOld", "唤醒只带最近一窗（更早的未读折叠）", "开 = 从最近往回看；关 = 从最早未读开始塞（旧行为，积压时会先回老消息）", "switch"),
        F("socialV2.context.wakeMessageLimit", "唤醒消息上限", "", "number"),
        F("socialV2.context.wakeRecentLimit", "唤醒最近消息上限", "", "number"),
        F("socialV2.context.wakeMaxChars", "唤醒上下文最大字符", "", "number"),
      ]},
      { group: "二代 · 主动与反馈", fields: [
        F("socialV2.proactive.enabled", "主动搭话", "", "switch"),
        F("socialV2.proactive.checkIntervalMinMs", "检查最小间隔（ms）", "", "number"),
        F("socialV2.proactive.checkIntervalMaxMs", "检查最大间隔（ms）", "", "number"),
        F("socialV2.proactive.idleThresholdMs", "空闲阈值（ms）", "", "number"),
        F("socialV2.proactive.probability", "主动概率", "", "number", { min: 0, max: 1, step: 0.01 }),
        F("socialV2.feedback.maxLength", "反馈最大字符", "", "number"),
        F("socialV2.feedback.notifyOwnerOnError", "出错通知管理员", "", "switch"),
        F("socialV2.media.maxBytes", "图片单条最大字节", "", "number"),
        F("socialV2.media.maxPixels", "单张最大像素", "", "number"),
        F("socialV2.media.maxCount", "单条最多图片", "", "number", { min: 1 }),
      ]},
      { group: "群聊（chat 模式）", note: "只影响 chat 一代逐条回复；reserved2 的发言/唤醒在「二代仿真」「鱼群保护」「Token 防爆破」", fields: [
        F("chat.contextMessages", "群聊上下文条数", "默认 10；0=关闭", "number", { min: 0, max: 100 }),
        F("chat.groupContextMessages", "按群覆盖上下文", "JSON：{\"群号\": 条数}", "json"),
        F("chat.addressFilter.enabled", "别人之间说话时过滤（chat 模式）", "只影响 chat 逐条回复；reserved2 不用这个判定", "switch"),
        F("chat.addressFilter.silenceWhenAddressedToOther", "别人互相说话时沉默概率（chat 模式）", "0.4=40% 沉默、60% 插话；日志里的“不插话”可能来自这里，只在 chat 生效", "number", { min: 0, max: 1, step: 0.01 }),
        F("chat.presence.enabled", "群聊生物钟（chat 模式）", "只影响 chat 模式逐条回复；reserved2 用唤醒/鱼群/Token 判定，不用这个", "switch"),
        F("chat.presence.onlineShare", "每小时在线/看群占比（chat 模式）", "0.4=40% 在线、60% 不看群；只影响 chat；0=一直离线，1=一直在线", "number", { min: 0, max: 1, step: 0.01 }),
        F("chat.presence.offlineMinMs", "最短离线（ms，chat 模式）", "", "number"),
        F("chat.presence.wakeWindowMs", "被叫醒后在线窗口（ms，chat 模式）", "", "number"),
        F("chat.proactive.enabled", "群聊主动搭话", "", "switch"),
        F("chat.proactive.minIntervalMs", "最小间隔（ms）", "", "number"),
        F("chat.proactive.minMessages", "最少消息数", "", "number", { min: 1 }),
      ]},
      { group: "黑话学习", fields: [
        F("slang.enabled", "启用黑话学习", "", "switch"),
        F("slang.extractMinMessages", "触发提取的最少消息", "", "number", { min: 1 }),
        F("slang.extractCooldownMs", "提取冷却（ms）", "", "number"),
        F("slang.inferenceThresholds", "推断阈值", "逗号分隔，例如 2，4，8", "list"),
        F("slang.injectMax", "每条注入上限", "", "number", { min: 0 }),
        F("slang.learnerPreset", "学习用 preset", ""),
        F("slang.workspaceTitle", "学习工作区名称", ""),
        F("slang.autoResearch", "自动联网研究", "", "switch"),
      ]},
      { group: "联网搜索", fields: [
        F("webSearch.provider", "搜索后端", "auto / deepseek / bing", "select", { options: [["auto", "auto"], ["deepseek", "deepseek"], ["bing", "bing"]] }),
        F("webSearch.apiKeyEnv", "凭据环境变量", "默认 DEEPSEEK_API_KEY"),
        F("webSearch.apiKey", "搜索 API Key", "不推荐写死；留 ******** 保持原值", "password"),
        F("webSearch.baseURL", "搜索端点", "必须 https 且解析到公网"),
        F("webSearch.model", "搜索模型", ""),
        F("webSearch.maxUses", "单次最多搜索", "", "number", { min: 1 }),
        F("webSearch.maxTokens", "最大 token", "", "number", { min: 1 }),
        F("webSearch.maxResults", "返回条数", "", "number", { min: 1 }),
        F("webSearch.timeoutMs", "超时（ms）", "", "number"),
      ]},
    ];

    const TOOL_LABELS = {
      getPrompt: "读取提示词", getUnread: "读未读", getRecent: "读最近", socialState: "社交状态",
      sendGroup: "发群消息", sendPrivate: "发私聊", reply: "引用回复", sendBurst: "分条发送",
      sendMessage: "统一发送", waitMessages: "等消息", feedback: "反馈", getMyRecent: "看我最近",
      getMessageDetail: "消息详情", getActiveMembers: "活跃成员", setWakeConfig: "设置唤醒",
      markRead: "标记已读", closeConversation: "对话收尾", memory: "轻量记忆", slangQuery: "查黑话", slangSubmit: "提交黑话",      getImages: "看图", getForwardMsg: "看合并转发", sendPoke: "拍一拍", listStickers: "表情列表",
      getStickerImage: "表情图片", sendSticker: "发表情", setStickerRemark: "改表情备注",
      stickerNote: "表情笔记", collectSticker: "收藏表情", getSelfImage: "看自己形象", sendVoice: "发语音",
    };

    // B站 → QQ 自动分享（写根 config.json 的 biliBridge；保存后重启桥接生效）。
    const QQ_BILI_SHARE_FIELDS = [
      F("biliBridge.enabled", "启用 B站 桥接", "", "switch"),
      F("biliBridge.share.enabled", "启用定时视频分享", "每天按下面的时间点给群发 B站 视频卡片", "switch"),
      F("biliBridge.share.times", "分享时间点", "HH:MM，逗号分隔；默认 07/11/13/15/17/19/21/23", "times"),
      F("biliBridge.share.groups", "只发这些群", "留空 = 跟随 allow.groups", "list"),
      F("biliBridge.share.gapMs", "卡片到短评的间隔（ms）", "默认 4000", "number", { min: 0, max: 60000 }),
      F("biliBridge.share.cardMode", "分享形式", "文本链接 = 标题 + 链接两条消息（推荐：QQ 不显示第三方卡片，会提示「发送者版本过低」）；小程序卡片点了会提示「小程序已下架」", "select", {
        options: [["text", "文本链接（推荐）"], ["miniapp", "小程序卡片（已下架，不推荐）"], ["off", "不发卡片（链接由短评带）"]],
      }),
      F("biliBridge.dynamics.enabled", "B站新动态同步到 QQ", "", "switch"),
      F("biliBridge.dynamics.pollIntervalMs", "动态轮询间隔（ms）", "默认 180000（3 分钟）", "number", { min: 60000, max: 3600000 }),
      F("biliBridge.dynamics.groups", "动态只发这些群", "留空 = 跟随 allow.groups", "list"),
    ];

    const BILI_FIELDS = [
      { group: "她自己（只读）", note: "管理员（主人）的 QQ 与 B站 mid 在标签页顶部统一设置 →", fields: [
        // owner.mid / owner.name 不在这里：已上移到「管理员」卡片，和 QQ 号一起保存。
        F("self.mid", "她自己 mid", "只读（来自 cookie / nav）", "text", { readOnly: true }),
        F("self.name", "她自己昵称", "只读（来自 nav）", "text", { readOnly: true }),
      ]},
      { group: "作息", note: "生物钟窗口", fields: [
        F("night.skipChance", "今晚不看的概率", "0.3 = 三成；轻醒只结束当前 slot，不结束全天", "number", { min: 0, max: 0.95, step: 0.01 }),
        F("night.maxVideos", "单次初筛视频数", "", "number", { min: 1, max: 20 }),
        F("night.maxWakesPerDay", "每天最多醒来", "0~12；C 模式：每窗至少 1 次，剩余按该时段评分分配", "number", { min: 0, max: 12 }),
        F("night.minGapMin", "两次苏醒最小间隔（分钟）", "默认 20；相邻窗口也按这个错开；太小会低质量空跑", "number", { min: 0, max: 120 }),
      ]},
      { group: "口味（文本）", note: "逗号分隔；单个关键词的权重在下面「口味权重 / 一键抓取」里调", fields: [
        F("preferences.like", "爱看", "逗号分隔；喂给选题器", "list"),
        F("preferences.dislike", "不爱看", "逗号分隔", "list"),
        F("preferences.keywords", "额外关键词", "逗号分隔；只扩大搜索，默认权重 0.75", "list"),
      ]},
      { group: "分享", fields: [
        F("share.enabled", "开启分享", "关掉 = 只看不说", "switch"),
        F("share.via", "分享方式", "默认发自己的动态（视频卡片）；也可评论区 @ / B站私信", "select", { options: [["dynamic", "发自己的动态（视频卡片）"], ["comment", "评论区 @ 你"], ["dm", "B站私信"]] }),
        F("quota.shareDaily", "每天上限", "建议 ≤3；0 = 不分享", "number", { min: 0, max: 20 }),
        F("share.minScore", "最低评分", "0~20；不到就不发", "number", { min: 0, max: 20 }),
        F("share.silentAfterDays", "沉默几天后降额", "", "number", { min: 0 }),
        F("share.decayPerDay", "每天降多少", "", "number", { min: 0 }),
      ]},
      { group: "额度（代码闸门）", note: "四本账的硬上限；0 = 不限量（关闭该上限）。保存后下一轮生效，不用重启 DSH。", fields: [
        F("limits.daily", "普通评论 / 天", "默认 30", "number", { min: 0, max: 200 }),
        F("limits.replyDaily", "回找我的人 / 天", "默认 50", "number", { min: 0, max: 500 }),
        F("limits.taDaily", "主动搭话 / 天", "默认 15", "number", { min: 0, max: 200 }),
        F("limits.mineDaily", "动态回复 / 类 / 天", "默认 10；四类各自算", "number", { min: 0, max: 100 }),
        F("limits.minePerPerson", "动态回复 / 人 / 类 / 天", "默认 1", "number", { min: 0, max: 20 }),
        F("limits.globalMin", "任意两条发言间隔（分钟）", "默认 2；0 = 不冷却", "number", { min: 0, max: 120 }),
        F("limits.perUpMin", "同一 UP 冷却（分钟）", "默认 10", "number", { min: 0, max: 1440 }),
        F("limits.perVideoMin", "同一视频冷却（分钟）", "默认 60", "number", { min: 0, max: 1440 }),
        F("limits.perThreadMin", "同一条评论冷却（分钟）", "默认 1440（24 小时）", "number", { min: 0, max: 10080 }),
      ]},
      { group: "四类动态", note: "每类一天一条；时段从该类的点开始，到下一类启用的点为止。前缀留空 = 不加固定开头。", fields: [
        F("dynamics.enabled", "四类动态总开关", "关掉 = 不再定时提醒发动态", "switch"),
        F("dynamics.gapMin", "任意两条动态间隔（分钟）", "默认 30；5~240", "number", { min: 5, max: 240 }),
        ...Object.entries({
          best: "一类 · 最高分视频",
          game: "二类 · 游戏 AI 二创",
          anime: "三类 · 动漫",
          gaming: "四类 · 游戏区",
        }).flatMap(([key, label]) => [
          F(`dynamics.kinds.${key}.enabled`, `${label} · 开关`, "", "switch"),
          F(`dynamics.kinds.${key}.slot`, `${label} · 时段（点）`, "0~23；从该点起，到下一类启用的点", "number", { min: 0, max: 23 }),
          F(`dynamics.kinds.${key}.minLen`, `${label} · 最短字数`, "", "number", { min: 10, max: 1000 }),
          F(`dynamics.kinds.${key}.maxLen`, `${label} · 最长字数`, "", "number", { min: 20, max: 2000 }),
          F(`dynamics.kinds.${key}.prefix`, `${label} · 固定开头`, "留空 = 不加前缀", "text", { wide: true }),
        ]),
      ]},
      { group: "鱼群判定关键词（B站）", note: "开头 / 中间 / 结尾任一命中即算鱼；默认 肥鱼 + 结尾 fish/鱼；只要评论者昵称命中就算，不涉及视频/UP 名", fields: [
        F("fishGuard.namePrefixes", "鱼名开头词", "逗号分隔；名字以这些词开头就算鱼（默认空，例如 DSH）", "list", { placeholder: "点击输入，例如 DSH（逗号分隔）" }),
        F("fishGuard.nameContains", "鱼名包含词", "逗号分隔；名字里只要包含这些词就算鱼（默认 肥鱼，例如 吃白饭）", "list"),
        F("fishGuard.nameSuffixes", "鱼名结尾词", "逗号分隔；默认 肥鱼,fish,鱼（最后一个字是鱼也算；接受极小概率误伤真人）", "list"),
        F("fishGuard.extraFishMids", "额外认定的鱼 mid", "逗号分隔；改名了也能认出来（B站 mid）", "list"),
        F("fishGuard.exemptNames", "豁免昵称", "逗号分隔", "list"),
        F("fishGuard.exemptMids", "豁免 mid", "逗号分隔；主人/自己会被代码强制排除", "list"),
      ]},
      { group: "鱼群保护（B站）", note: "评论区鱼太多就不发新楼层；优先回鱼；给鱼点赞（只拦她自己决定的发言，下一轮醒来生效）", fields: [
        F("fishGuard.enabled", "启用 B站鱼群保护", "关掉 = 永远发新楼层", "switch"),
        F("fishGuard.sampleSize", "取样顶层评论数", "默认 40；看最近/最热由接口排序决定", "number", { min: 5, max: 100 }),
        F("fishGuard.maxFishTopLevel", "多少条鱼的楼层算泛滥", "默认 3", "number", { min: 1, max: 50 }),
        F("fishGuard.maxFishMids", "多少个鱼账号算泛滥", "默认 3；防同一只鱼刷很多楼层", "number", { min: 1, max: 50 }),
        F("fishGuard.maxFishRatio", "鱼楼层占比阈值", "0~1；默认 0.4", "number", { min: 0, max: 1, step: 0.05 }),
        F("fishGuard.minSample", "占比判定最少样本", "默认 8", "number", { min: 2, max: 100 }),
        F("fishGuard.includeHotSample", "同时取热度序样本", "默认开；时间序+热度序去重，降低采样偏差", "switch"),
        F("fishGuard.gatherEnabled", "聚拢：改成回鱼", "鱼太多时把想说的话变成对鱼评论的回复", "switch"),
        F("fishGuard.forceGather", "每次醒来强制聚拢", "默认开；鱼群泛滥时就算没有满足条件的鱼楼，也强行挑一条回（仍受额度/冷却）", "switch"),
        F("fishGuard.gatherMaxReplies", "只回回复少的鱼楼", "默认 ≤6 条回复", "number", { min: 0, max: 100 }),
        F("fishGuard.gatherMaxFishReplies", "鱼楼里鱼回复太多就跳过", "默认 >2 条鱼回复不挤进去，防鱼群串", "number", { min: 0, max: 50 }),
        F("fishGuard.gatherMaxAgeHours", "只回多新的鱼楼（小时）", "默认 72；太旧的不打扰", "number", { min: 1 }),
        F("fishGuard.gatherCooldownHours", "同一鱼楼冷却（小时）", "默认 12；避免反复回同一条", "number", { min: 0 }),
        F("fishGuard.likeEnabled", "点赞机制", "给鱼的楼层/楼里的鱼回复点赞", "switch"),
        F("fishGuard.maxLikesPerDay", "每天最多点赞", "默认 6；避免像刷赞", "number", { min: 0, max: 200 }),
        F("fishGuard.maxLikesPerRun", "每次最多点赞", "默认 4", "number", { min: 0, max: 50 }),
        F("fishGuard.likeFishReplies", "也赞楼里的鱼回复", "默认开；让整楼的鱼一起被顶上去", "switch"),
        F("fishGuard.likeAfterCommentMs", "发完评论等多久再点赞", "默认 12000ms；刚发完就点容易被风控", "number", { min: 0, max: 120000 }),
        F("fishGuard.likeGapMinMs", "两次点赞最小间隔（ms）", "默认 1500；随机间隔更像真人", "number", { min: 0, max: 30000 }),
        F("fishGuard.likeGapMaxMs", "两次点赞最大间隔（ms）", "默认 4000", "number", { min: 0, max: 60000 }),
        F("fishGuard.failedLikeCooldownHours", "点赞失败后冷却（小时）", "默认 24；同一个 rpid 失败过就先跳过", "number", { min: 0 }),
        F("fishGuard.failCooldownMinutes", "风控失败冷却（分钟）", "默认 60；遇到 -509/12015 等码自动停手", "number", { min: 1 }),
      ]},
      { group: "B站 会话权限", note: "只影响她自己的 DSH 会话（bili-whale-*），不影响 QQ 桥接；改完下一次 tick 生效", fields: [
        F("agent.sandbox", "会话权限", "danger-full-access = 定时醒来能跑 bili.mjs（推荐；C:\\Users\\Mieksido 用 workspace-write 会因 WRITE_OWNER 起不了命令）；workspace-write = 更安全但可能什么都跑不了", "select", {
          options: [["danger-full-access", "完全访问（推荐，能跑工具）"], ["workspace-write", "仅工作区（更安全，可能跑不了命令）"]],
        }),
      ]},
      { group: "倾听（别人找她）", fields: [
        F("listen.comment", "评论区监听", "", "switch"),
        F("listen.commentIntervalSec", "检查间隔（秒）", "建议 ≥300", "number", { min: 60 }),
        F("listen.scope", "监听范围", "回复我的 / 回复+@", "select", { options: [["both", "回复 + @"], ["reply", "只回复我"]] }),
        F("listen.oncePerPerson", "同一个人最多回一条", "30 天内只回一次", "switch"),
        F("listen.allDay", "全天监听", "关掉 = 只在她醒着的窗口里回", "switch"),
        F("listen.dm", "私信监听", "有私信就叫醒她", "switch"),
        F("listen.dmScope", "私信监听范围", "只认主人 / 谁找她都回", "select", { options: [["owner", "只认主人"], ["all", "谁找她都回"]] }),
        F("listen.live", "直播间监听", "", "switch"),
        F("listen.liveRoom", "直播间房间号", "留空 = 不蹲直播"),
        F("listen.liveScope", "直播间只回", "只回主人 / 只回艾特她的", "select", { options: [["owner", "只回主人"], ["mention", "只回艾特她的"]] }),
      ]},
      { group: "日记与推送", fields: [
        F("diary.push", "推送日记摘要", "日记照写；只控制推不推", "switch"),
        F("diary.enabled", "写日记（锁定开）", "旧版本可关；现在照写不可关", "switch", { readOnly: true }),
        F("notify.type", "推送方式", "不推送 / 桌面通知 / Webhook / 自定义命令", "select", { options: [["none", "不推送"], ["desktop", "桌面通知"], ["webhook", "Webhook"], ["command", "自定义命令"]] }),
        F("notify.url", "Webhook 地址", "飞书/钉钉/企业微信/QQ机器人", "text", { wide: true }),
        F("notify.template", "模板", "纯文本 / markdown", "select", { options: [["text", "纯文本"], ["markdown", "markdown"]] }),
        F("notify.cmd", "自定义命令", "可执行文件；消息自动作为最后一个参数", "text", { wide: true }),
        F("notify.args", "命令参数", "JSON 数组", "json"),
      ]},
      { group: "工具链", fields: [
F("toolsPath", "bili.mjs 路径", "留空 = 用合体插件自带的 tools/", "text", { wide: true, browse: "file" }),
      ]},
    ];

    // ── 作息窗口编辑器 ──────────────────────────────────────────────────────
    const NUMS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];
    function WindowsEditor({ value, onChange }) {
      const list = Array.isArray(value) ? value : [];
      const upd = (i, patch) => onChange(list.map((w, j) => (j === i ? { ...w, ...patch } : w)));
      const del = (i) => onChange(list.filter((_, j) => j !== i));
      const add = () => onChange([...list, { start: "20:00", end: "22:00", wakes: 1 }]);
      return h("div", null,
        list.length === 0 ? h("div", { className: "qbw-warnbox" }, "没有窗口 = 永远不醒；至少加一个。") : null,
        h("div", { className: "qbw-list" }, list.map((w, i) => h("div", { className: "qbw-item", key: i },
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
            h("span", { className: "qbw-hint", style: { minWidth: "18px" } }, NUMS[i] ?? String(i + 1)),
            h("input", { className: "qbw-input", style: { width: "90px", minWidth: "90px" }, value: w.start ?? "", onChange: (e) => upd(i, { start: e.target.value }) }),
            h("span", { className: "qbw-hint" }, "–"),
            h("input", { className: "qbw-input", style: { width: "90px", minWidth: "90px" }, value: w.end ?? "", onChange: (e) => upd(i, { end: e.target.value }) }),
            h("span", { className: "qbw-hint" }, "醒来"),
            h("input", { className: "qbw-input", style: { width: "64px", minWidth: "64px" }, type: "number", min: 1, max: 12, value: w.wakes ?? 1, onChange: (e) => upd(i, { wakes: Number(e.target.value) || 1 }) }),
            h("span", { className: "qbw-hint" }, "次")),
          h(Btn, { kind: "qbw-btn2", disabled: list.length <= 1, onClick: () => del(i), title: list.length <= 1 ? "至少保留一个窗口；要换时间直接改" : "删掉这个窗口" }, "×")))),
        h("div", { style: { marginTop: "8px" } },
          h(Btn, { kind: "qbw-btn2", onClick: add }, "+ 添加窗口"),
          h("span", { className: "qbw-hint", style: { marginLeft: "8px" } }, "至少保留一个窗口；最后一个的 × 会置灰，想换时段直接改时间")));
    }

    // ── 全部参数：把任意配置扁平化 ──────────────────────────────────────────
    function flatten(value, prefix = []) {
      const out = [];
      if (value == null || typeof value !== "object") {
        out.push({ path: prefix, value });
        return out;
      }
      if (Array.isArray(value)) {
        out.push({ path: prefix, value });
        return out;
      }
      for (const [key, item] of Object.entries(value)) {
        out.push(...flatten(item, [...prefix, key]));
      }
      return out;
    }
    function inferKind(value) {
      if (typeof value === "boolean") return "switch";
      if (typeof value === "number") return "number";
      if (Array.isArray(value)) return value.every((v) => typeof v === "string") ? "list" : "json";
      if (value && typeof value === "object") return "json";
      if (typeof value === "string" && value.length > 160) return "textarea";
      return "text";
    }
    function flattenFields(cfg) {
      return flatten(cfg).filter((item) => item.path.length > 0).map((item) => ({
        path: item.path,
        label: labelize(item.path.join(".")),
        kind: inferKind(item.value),
        value: item.value,
      }));
    }

    // ── 概览 ────────────────────────────────────────────────────────────────
    function UpdatesModal({ status, onClose, onDone, toast }) {
      const pending = Array.isArray(status?.pending) ? status.pending : [];
      const [selected, setSelected] = useState(() => new Set(pending.map((item) => item.id)));
      const [never, setNever] = useState(false);
      const [working, setWorking] = useState(false);
      const toggle = (id) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      const applySelected = async () => {
        const ids = [...selected];
        if (!ids.length) return;
        setWorking(true);
        try {
          const r = await api("/updates", { method: "POST", body: { action: "apply", ids } });
          const failed = (r.results ?? []).filter((x) => !x.ok);
          const staged = (r.results ?? []).filter((x) => x.ok && x.staged);
          if (r.ok && staged.length) {
            // 延后应用：文件已下载到 staging，宿主退出后才覆盖（避免覆盖正在使用的模块导致崩溃）
            toast(`✓ 已下载 ${staged.length} 个组件；退出并重新打开 DSH 后自动完成更新`);
          } else if (r.ok) toast(`✓ 已更新 ${r.updated} 个组件${r.restartRequired ? "，请重启对应服务" : ""}`);
          else toast(`✗ ${failed[0]?.error ?? "更新失败"}`);
          onDone?.(r);
        } catch (e) { toast(`✗ 更新失败：${e.message}`); }
        finally { setWorking(false); }
      };
      const dismissThis = async () => {
        setWorking(true);
        try {
          await api("/updates", { method: "POST", body: { action: "dismiss" } });
          toast("✓ 本次更新不再提示（远端有新提交时会再提醒）");
        } catch (e) { toast(`✗ ${e.message}`); }
        finally { setWorking(false); onClose?.(); }
      };
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget && !working) onClose?.(); } },
        h("div", { className: "qbw-modal", style: { maxWidth: "600px", maxHeight: "82vh", overflow: "auto" } },
          h("h3", null, pending.length > 1 ? `发现 ${pending.length} 个可用更新` : "发现可用更新"),
          h("p", null, (() => {
            // 让用户一眼看到"这次更新到什么版本"（以前只有提交列表，用户不知道是哪个版本）
            const withVer = pending.filter((x) => x.latestVersion);
            if (!withVer.length) return "git 安装做快进（--ff-only）；zip 安装会下载新包覆盖代码。两种都不会动 config.json 与记忆卡。";
            const parts = withVer.map((x) => `${x.name} v${x.installedVersion || "?"} → v${x.latestVersion}`);
            return `${parts.join("　")}；更新不会动 config.json 与记忆卡。`;
          })()),
          pending.length ? pending.map((item) => h("div", { key: item.id, style: { border: "1px solid rgba(127,127,127,.24)", borderRadius: "10px", padding: "10px 12px", margin: "0 0 8px" } },
            h("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontWeight: 600 } },
              h("input", { type: "checkbox", checked: selected.has(item.id), onChange: () => toggle(item.id), disabled: working }),
              item.name,
              h("span", { className: "qbw-chip", style: { marginLeft: "auto" } },
                item.channel === "version"
                  ? `v${item.installedVersion} → v${item.latestVersion}`
                  : item.channel === "release"
                    ? `${item.installedVersion ? `v${item.installedVersion}` : "未安装"} → v${item.latestVersion}`
                    : (item.latestVersion
                      ? `v${item.installedVersion || "?"} → v${item.latestVersion}（${item.behind} 个提交）`
                      : `${item.behind} 个提交（到 ${String(item.remote || "").slice(0, 7)}）`))),
            h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
              `${item.dir} · ${item.branch ?? ""}${item.dirty ? ` · ⚠️ 本地有 ${item.dirty} 处改动` : ""}${item.ahead ? ` · ⚠️ 本地领先 ${item.ahead}` : ""} · ${item.channel === "release" ? "版本清单" : item.channel === "version" ? "提交追踪" : "git 仓库"}`),
            item.blocked ? h("div", { className: "qbw-hint", style: { color: "#c0392b" } }, `不能自动更新：${item.blocked}`) : null,
            item.blocked ? h("div", { className: "qbw-hint" }, "处理办法：本仓库有未提交改动时，先 commit/stash 再更新；或者直接用新版本的 zip 覆盖安装。") : null,
            (item.changelog ?? []).length ? h("ul", { style: { margin: "6px 0 0 18px", padding: 0, fontSize: "11.5px", lineHeight: "18px", opacity: 0.82 } },
              item.changelog.slice(0, 8).map((line, index) => h("li", { key: index }, line))) : null,
            (item.changelog ?? []).length > 8 ? h("div", { className: "qbw-hint" }, `…另有 ${item.changelog.length - 8} 条`) : null)) : h("p", null, "当前没有可用更新。"),
          h("label", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" } },
            h("input", { type: "checkbox", checked: never, onChange: (e) => setNever(e.target.checked), disabled: working }),
            h("span", { className: "qbw-hint" }, "不再提示本次更新（只对这次的远端版本生效；有更新提交时会重新提醒）")),
          working ? h(ProgressBar, { phase: "正在下载/应用更新…", indeterminate: true }) : null,
          h("div", { className: "qbw-actions" },
            h(Btn, { kind: "qbw-btn2", onClick: () => (never ? dismissThis() : onClose?.()), disabled: working },
              never ? "不再提示本次" : "稍后"),
            h(Btn, { onClick: applySelected, disabled: working || !selected.size },
              working ? "更新中…" : `立即更新（${selected.size}）`))));
    }

    function OverviewTab({ overview, reload, busy, setBusy, toast, unified, setUnified, goTab }) {
      const bridge = overview?.bridge ?? {};
      const bili = overview?.bili ?? {};
      const memory = overview?.memory ?? {};
      const align = overview?.alignment ?? {};
      const scheduler = overview?.scheduler ?? {};
      const snow = overview?.snowluma ?? {};
      const platformStart = overview?.platformStart ?? {};
      const qqStart = platformStart.qq !== false;
      const biliStart = platformStart.bili !== false;
      // ── 组件更新（2026-10-26）──────────────────────────────────────────
      // 检查在插件里做（git fetch，只读）；界面只负责展示与确认。
      const updates = overview?.updates ?? {};
      const [updateOpen, setUpdateOpen] = useState(false);
      const [autoPrompted, setAutoPrompted] = useState(false);
      useEffect(() => {
        if (!autoPrompted && updates?.showPrompt) {
          setAutoPrompted(true);
          setUpdateOpen(true);
        }
      }, [updates?.showPrompt, autoPrompted]);
      const checkUpdates = async ({ openOnHit = true } = {}) => {
        setBusy("updates");
        try {
          const r = await api("/updates", { method: "POST", body: { action: "check" } });
          const n = r.pendingCount ?? 0;
          toast(n ? `发现 ${n} 个组件有更新` : "已是最新");
          if (n && openOnHit) setUpdateOpen(true);
          await reload();
          return r;
        } catch (e) {
          toast(`✗ 检查更新失败：${e.message}`);
          return null;
        } finally { setBusy(""); }
      };
      const detectSnowLuma = async () => {
        setBusy("detect-snowluma");
        try {
          const result = await api("/bridge", { method: "POST", body: { action: "detect-snowluma" } });
          toast(result.ok ? `✓ ${result.message}` : `✗ ${result.error ?? "没找到 SnowLuma"}`);
          if (result.ok) reload();
        } catch (error) {
          toast(`✗ ${error.message}`);
        } finally {
          setBusy("");
        }
      };
      const act = async (action) => {
        setBusy(action);
        try {
          const res = await api("/bridge", { method: "POST", body: { action } });
          toast(res.ok ? `✓ ${res.message ?? "完成"}` : `✗ ${res.error ?? "失败"}`);
          await reload();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "一个窗口管两边：QQ 仍然由原来那个桥接进程收发消息，B站仍然用同一份 bili.config.json。",
          "合体插件不复制配置，只把参数、记忆、身份对齐和扩展接口装到一起。"),
        h("div", { className: "qbw-grid" },
          h("div", { className: "qbw-card" },
            h("h4", null, "QQ 桥接 ", h(StatusDot, { ok: bridge.running && bridge.ok, warn: bridge.running && !bridge.ok }, bridge.running ? "运行中" : "未运行")),
            h("div", { className: "qbw-kv" }, h("span", null, "端口"), h("span", null, bridge.port ?? "—")),
            h("div", { className: "qbw-kv" }, h("span", null, "PID"), h("span", null, bridge.pid ?? bridge.lockPid ?? "—")),
            h("div", { className: "qbw-kv" }, h("span", null, "模式"), h("span", null, overview?.mode?.effective ?? overview?.mode?.local ?? bridge.mode ?? "—")),
            h("div", { className: "qbw-kv" }, h("span", null, "群白名单"), h("span", null, `${overview?.mode?.allowGroups ?? 0} 个`)),
            h("div", { className: "qbw-kv" }, h("span", null, "私聊白名单"), h("span", null, `${overview?.mode?.allowPrivate ?? 0} 人`)),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: () => act("start"), disabled: !!busy || bridge.running }, "启动"),
              h(Btn, { kind: "qbw-btn2", onClick: () => act("restart"), disabled: !!busy }, "重启"),
              h(Btn, { kind: "qbw-btn2", onClick: () => act("stop"), disabled: !!busy || !bridge.running }, "停止"))),
          h("div", { className: "qbw-card" },
            h("h4", null, "B站 ", h(StatusDot, { ok: Boolean(bili.available), warn: bili.enabled && !bili.available }, bili.available ? "记忆已生成" : "暂无记忆")),
            h("div", { className: "qbw-kv" }, h("span", null, "记忆同步"), h("span", null, bili.enabled ? "开" : "关")),
            h("div", { className: "qbw-kv" }, h("span", null, "记忆简报"), h("span", null, `${bili.briefChars ?? 0} 字`)),
            h("div", { className: "qbw-kv" }, h("span", null, "生成时间"), h("span", null, fmtTime(bili.generatedAt))),
            h("div", { className: "qbw-kv" }, h("span", null, "隐私复检"), h("span", null, bili.blocked ? "命中，已拦截" : "通过")),
            h("div", { className: "qbw-actions" },
              h(Btn, { kind: "qbw-btn2", onClick: async () => {
                setBusy("refresh-bili");
                try { const r = await api("/memory", { method: "POST", body: { action: "refresh-bili" } }); toast(r.ok ? "✓ B站记忆已刷新" : `✗ ${r.error ?? "失败"}`); await reload(); } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
              }, disabled: !!busy }, "刷新 B站记忆"))),
          h("div", { className: "qbw-card" },
            h("h4", null, "合体层 ", h(StatusDot, { ok: scheduler.running }, scheduler.running ? "生物钟在跑" : "生物钟未启动")),
            h("div", { className: "qbw-kv" }, h("span", null, "身份对齐"), h("span", null, `${align.links ?? 0} 条 / 候选 ${align.candidates ?? 0}`)),
            h("div", { className: "qbw-kv" }, h("span", null, "QQ→B站记忆"), h("span", null, memory.qqToBili?.enabled ? "开" : "关")),
            h("div", { className: "qbw-kv" }, h("span", null, "B站→QQ记忆"), h("span", null, memory.biliToQq?.enabled ? "开" : "关")),
            h("div", { className: "qbw-kv" }, h("span", null, "隐私策略"), h("span", null, `v${overview?.privacyPolicyVersion ?? "?"}`)),
            h("div", { className: "qbw-actions" },
              h(Btn, { kind: "qbw-btn2", onClick: () => act("refresh-bili"), disabled: !!busy }, "刷新 B站记忆"))),
          h("div", { className: "qbw-card" },
            h("h4", null, "启动"),
            h("div", { className: "qbw-hint", style: { marginBottom: "8px" } },
              "一键启动会按 QQ / B站 页里的「是否启动」开关拉起对应平台；也可以只启动一边。",
              qqStart ? "" : " QQ 启动开关已关闭。",
              biliStart ? "" : " B站 启动开关已关闭。"),
            h("div", { className: "qbw-kv" },
              h("span", null, "QQ"),
              h("span", null, qqStart ? (bridge.running ? "启动开关开 · 运行中" : "启动开关开 · 未运行") : "启动开关关")),
            h("div", { className: "qbw-kv" },
              h("span", null, "B站"),
              h("span", null, biliStart ? (scheduler.running ? "启动开关开 · 生物钟在跑" : "启动开关开 · 未运行") : "启动开关关")),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: () => act("start-all"), disabled: !!busy || (!qqStart && !biliStart) }, "一键启动（含 SnowLuma）"),
              h(Btn, { kind: "qbw-btn2", onClick: () => act("start-qq"), disabled: !!busy || !qqStart || Boolean(bridge.running) }, "启动QQ"),
              h(Btn, { kind: "qbw-btn2", onClick: () => act("start-bili"), disabled: !!busy || !biliStart || Boolean(scheduler.running) }, "启动B站")),
            h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "2px", paddingTop: "2px" } },
              h(Btn, { kind: "qbw-btn3", onClick: () => goTab?.("qq"), disabled: !!busy }, "去 QQ 页改启动开关"),
              h(Btn, { kind: "qbw-btn3", onClick: () => goTab?.("bili"), disabled: !!busy }, "去 B站 页改启动开关")),
            h("label", { className: "qbw-row", style: { alignItems: "center" } },
              h("span", { className: "qbw-label" }, "一键启动成功后弹窗提示"),
              h("input", {
                type: "checkbox",
                checked: unified?.bridge?.startupNotify !== false,
                onChange: (e) => setUnified(["bridge", "startupNotify"], e.target.checked),
              })),
            h("div", { className: "qbw-hint" }, "已在跑的服务不会重复启动；QQ 启动时会按需打开已安装的 SnowLuma（仍需你扫码）。人格卡在「角色」页维护（和角色包在一起），这里不再重复显示。")),
          h("div", { className: "qbw-card" },
            h("h4", null, "更新 ", (() => {
              const rows = updates.results ?? [];
              const bad = rows.filter((x) => !x.available);
              const stale = rows.filter((x) => x.versionStale);
              if (updates.pendingCount > 0) return h(StatusDot, { ok: false, warn: true }, `${updates.pendingCount} 个可更新`);
              if (bad.length) return h(StatusDot, { ok: false, warn: true }, `部分查不到（${bad[0].name}：${bad[0].reason || "网络/限流"}）`);
              if (stale.length) return h(StatusDot, { ok: false, warn: true }, "用的是缓存结果（上次拉取失败）");
              return h(StatusDot, { ok: true }, "已是最新");
            })()),
            h("div", { className: "qbw-kv" }, h("span", null, "上次检查"), h("span", null, updates.lastCheckAt ? fmtTime(updates.lastCheckAt) : "还没查过")),
            h("div", { className: "qbw-kv" }, h("span", null, "组件"), h("span", null,
              (updates.results ?? []).length
                ? updates.results.map((item) => {
                  if (item.available) {
                    const ver = item.latestVersion
                      ? (item.ahead
                        ? ` 本地 v${item.installedVersion} 领先发布 v${item.latestVersion}`
                        : ` v${item.installedVersion ?? "?"}→v${item.latestVersion}`)
                        + (item.versionStale ? "（缓存）" : "")
                      : "";
                    return `${item.name}${item.updateAvailable ? `（有更新${ver}）` : `（最新${ver}）`}`;
                  }
                  return `${item.name}（${item.installedVersion ? `v${item.installedVersion} · ` : ""}不可查）`;
                }).join(" · ")
                : "还没检查")),
            (updates.results ?? []).filter((item) => item.available && item.blocked && item.updateAvailable).length
              ? h("div", { className: "qbw-hint", style: { color: "#c0392b" } },
                "有组件因本地改动/未推送提交被拒，详情点「查看详情」。")
              : null,
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: () => checkUpdates(), disabled: !!busy }, busy === "updates" ? "检查中…" : "检查更新"),
              (updates.results ?? []).some((x) => x.updateAvailable && x.downloadUrl)
                ? h(Btn, { kind: "qbw-btn2", onClick: () => window.open((updates.results ?? []).find((x) => x.updateAvailable && x.downloadUrl).downloadUrl, "_blank", "noopener") }, "去下载新版")
                : null,
              h(Btn, { kind: "qbw-btn2", onClick: () => setUpdateOpen(true), disabled: !(updates.results ?? []).length }, "查看详情"))),
          h(AdvancedSettings, { note: "SnowLuma 安装 / 扩展与平台：装好后很少改" },
            h("div", { className: "qbw-card" },
              h("h4", null, "SnowLuma 安装"),
              h("p", null, "第一次使用：下载官方 SnowLuma2 → 解压 → 点「检测已安装的 SnowLuma」→ 启动 QQ 并扫码。"),
              h("div", { className: "qbw-kv" }, h("span", null, "当前安装目录"), h("span", null, snow.launcherPath || "未设置")),
              h("div", { className: "qbw-actions" },
                h(Btn, { kind: "qbw-btn2", onClick: () => window.open(snow.downloadUrl || "https://github.com/SnowLuma/SnowLuma/releases/latest", "_blank", "noopener") }, "打开官方下载页"),
                h(Btn, { onClick: detectSnowLuma, disabled: !!busy }, "检测已安装的 SnowLuma"),
                h(Btn, { kind: "qbw-btn2", onClick: () => act("start-snowluma"), disabled: !!busy }, "只打开 SnowLuma")),
              h("div", { className: "qbw-hint" }, "SurfCore 只负责检测、打开和查看连接状态；SnowLuma2 本体按 EULA 不随插件分发，安装与扫码仍需你完成。")),
            h("div", { className: "qbw-card" },
              h("h4", null, "扩展与平台"),
              h("div", { className: "qbw-kv" }, h("span", null, "已启用扩展"), h("span", null, `${(overview?.extensions ?? []).filter((x) => x.enabled).length} / ${(overview?.extensions ?? []).length}`)),
              h("div", { className: "qbw-kv" }, h("span", null, "平台"), h("span", null, (overview?.platforms ?? []).map((x) => `${x.name}${x.status === "planned" ? "(预留)" : ""}`).join(" · "))),
              h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, "贴吧已预留接口：接适配器即可，不改主流程。")))),
        h("div", { className: "qbw-actions" },
          h(Btn, { kind: "qbw-btn2", onClick: reload, disabled: !!busy }, "刷新状态"),
          h(Btn, { kind: "qbw-btn3", onClick: async () => {
            setBusy("backup");
            try { const r = await api("/diagnostics", { method: "POST", body: { action: "backup" } }); toast(`✓ 已备份 ${r.created?.length ?? 0} 个文件`); } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
          }, disabled: !!busy }, "立即备份配置")),
        updateOpen ? h(UpdatesModal, {
          status: updates,
          toast,
          onClose: () => setUpdateOpen(false),
          onDone: async () => { setUpdateOpen(false); await reload(); },
        }) : null);
    }

    // ── QQ 鱼群保护 · 最近触发（QQ 页顶部）────────────────────────────────
    // 以前触发只写活动日志，设置页看不到「刚才为什么没说话」。桥接现在把每次新触发
    // 写进 social-v2.json 的 fishGuardLog，这张卡直接读它。
    function QqFishGuardStatusCard({ busy }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const load = useCallback(async () => {
        try { setData(await api("/fish-guard/qq")); setErr(""); }
        catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const items = Array.isArray(data?.items) ? data.items : [];
      const reasonText = (item) => {
        if (item.reason === "fish-count") return `不同鱼 ${item.fishCount} 条`;
        if (item.reason === "fish-streak") return `连续 ${item.consecutiveFish} 条鱼`;
        if (item.reason === "fish-streak-single") return `单鱼连发 ${item.consecutiveFish} 条`;
        if (item.reason === "fish-ratio") return `鱼占比 ${Math.round((item.fishRatio || 0) * 100)}%（${item.fishMessages}/${item.totalMessages}）`;
        if (item.reason === "cooldown") return "冷却续期";
        return item.reason || "触发";
      };
      const remain = (item) => {
        const t = item.until ? new Date(item.until).getTime() : 0;
        return t > Date.now() ? `${Math.ceil((t - Date.now()) / 60000)} 分钟后解除` : "已解除";
      };
      return h("div", { className: "qbw-card", style: { margin: "0 0 10px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" } },
          h("div", null,
            h("h4", { style: { margin: 0 } }, "QQ 鱼群保护 · 最近触发",
              data ? h("span", { className: "qbw-badge " + (data.active > 0 ? "warn" : "ok") }, data.active > 0 ? `保护中 ${data.active} 个群` : "当前没有保护中的群") : null),
            h("p", { style: { marginTop: "4px" } },
              data ? `最近 30 次触发 · 今天 ${data.today ?? 0} 次 · 记录在 social-v2.json` : "读取中…")),
          h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, "刷新触发记录")),
        err ? h("div", { className: "qbw-err", style: { marginTop: "6px" } }, err) : null,
        data && items.length === 0 ? h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          "还没有触发记录。鱼群密度到阈值时，这里会出现「哪个群、什么原因、保护到什么时候」。") : null,
        items.length ? h("div", { className: "qbw-list", style: { marginTop: "6px" } },
          items.slice(0, 6).map((item, i) => h("div", { key: `${item.key}|${item.at}|${i}`, className: "qbw-item", style: { marginTop: "4px" } },
            h("div", null,
              h("div", { className: "qbw-label" },
                item.groupName || `群 ${item.groupId || "?"}`,
                h("span", { className: "qbw-badge " + (item.active ? "warn" : "") }, item.active ? "保护中" : "已结束"),
                item.ended ? h("span", { className: "qbw-badge" }, "最近一次") : null),
              h("div", { className: "qbw-hint" }, `${reasonText(item)} · ${fmtTime(item.at)}${item.until ? ` · ${remain(item)}` : ""}`)),
            h("span", { className: "qbw-pill" }, `${item.fishCount} 条鱼 / ${item.fishMessages} 条鱼消息`))),
          items.length > 6 ? h("div", { className: "qbw-hint" }, `还有 ${items.length - 6} 条更早的记录（接口最多返回 30 条）`) : null) : null,
        data?.config ? h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          `规则：窗口 ${Math.round((data.config.windowMs || 0) / 60000)} 分钟 · 冷却 ${Math.round((data.config.cooldownMs || 0) / 60000)} 分钟 · 不同鱼 ≥${data.config.maxFish} · 连续 ${data.config.maxConsecutiveFish} 条 · 单鱼 ${data.config.singleFishMaxConsecutive} 条`) : null);
    }

    // ── 目的机制（主动找主人）：独立栏目「目的」里的设置与状态 ──────────────
    // 载体（QQ / 桌宠）由 PurposeCarrierCard 选择；这里只做节奏、素材、预览与试一次。
    // 状态/预览/出发都走 /purpose/*：插件按当前载体路由到桥接或桌宠。
    function PurposeCard({ cfg, set, busy, setBusy, toast, carrier }) {
      const P = cfg?.purpose && typeof cfg.purpose === "object" ? cfg.purpose : {};
      const pv = (key, fallback) => (P[key] === undefined || P[key] === null || P[key] === "" ? fallback : P[key]);
      const setP = (key, value) => set(["purpose", key], value);
      const [status, setStatus] = useState(null);
      const [error, setError] = useState("");
      const [preview, setPreview] = useState(null);
      const [msg, setMsg] = useState("");

      const load = async () => {
        try {
          const r = await api("/purpose/status");
          setStatus(r);
          setError(r.ok === false ? (r.error || "读取目的状态失败") : "");
        } catch (e) { setError(e.message); }
      };
      useEffect(() => { void load(); }, []);

      const doPreview = async () => {
        setBusy("purpose-preview");
        setMsg("");
        try {
          const r = await api("/purpose/preview", { method: "POST", body: {} });
          if (!r.ok) throw new Error(r.error ?? r.reason ?? "预览失败");
          setPreview(r);
          setMsg(`✓ 预览已生成（素材 ${r.materials?.length ?? 0} 条，未发送）`);
        } catch (e) {
          setPreview(null);
          setMsg(`✗ ${e.message}${e.data?.reason ? `（${e.data.reason}）` : ""}`);
        } finally { setBusy(""); }
      };

      const doRun = async () => {
        const toPet = (carrier ?? P.carrier) === "pet";
        const ok = confirm(toPet
          ? "现在就让小肥鱼在桌宠气泡里主动搭话一次？\n\n会真的生成一句话（算一次模型回合）；语音载体还会合成语音。"
          : "现在就让小肥鱼按「目的机制」主动私聊你一次？\n\n这会真的发 QQ 消息（不占每日分享/评论额度，但会算一次模型回合）。");
        if (!ok) return;
        setBusy("purpose-run");
        setMsg("");
        try {
          const r = await api("/purpose/run", { method: "POST", body: { force: true } });
          if (!r.ok) throw new Error(r.error ?? r.reason ?? "投递失败");
          setMsg(toPet
            ? `✓ 已推到桌宠气泡：${r.message?.text ?? r.selected?.text ?? "一句话"}`
            : `✓ 已投递：${r.selected?.text ?? "一轮目的"}（等她说）`);
          toast(toPet ? "✓ 桌宠主动搭话已发送" : "✓ 目的回合已投递");
          await load();
        } catch (e) {
          setMsg(`✗ ${e.message}${e.data?.reason ? `（${e.data.reason}）` : ""}`);
        } finally { setBusy(""); }
      };

      const applyPreset = (name) => {
        const presets = {
          calm: { label: "保守", gapMinMs: 240 * 60000, gapMaxMs: 480 * 60000, dailyMax: 2, quietStart: "23:00", quietEnd: "09:00", initialDelayMinMs: 60 * 60000 },
          normal: { label: "默认", gapMinMs: 150 * 60000, gapMaxMs: 300 * 60000, dailyMax: 4, quietStart: "23:30", quietEnd: "08:30", initialDelayMinMs: 30 * 60000 },
          active: { label: "活跃", gapMinMs: 60 * 60000, gapMaxMs: 120 * 60000, dailyMax: 6, quietStart: "00:30", quietEnd: "07:30", initialDelayMinMs: 15 * 60000 },
        };
        const p = presets[name];
        if (!p) return;
        for (const [key, value] of Object.entries(p)) if (key !== "label") setP(key, value);
        toast(`✓ 已套用「${p.label}」节奏，记得保存`);
      };

      const st = status?.state ?? {};
      const dailyMax = Number(pv("dailyMax", 4)) || 0;
      const outcomeText = {
        sent: "已发出", silent: "她选择没说", failed: "失败，将重试",
        "delivery-failed": "投递失败，将重试", pending: "等回合",
      }[st.lastOutcome] ?? (st.lastOutcome || "—");
      const at = (ms) => (ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "—");
      const numberRow = (label, key, fallback, hint, { min = 0, max = 9999, step = 1 } = {}) => h(Row, { label, hint },
        h("input", {
          className: "qbw-input", type: "number", min, max, step,
          value: pv(key, fallback),
          onChange: (e) => setP(key, e.target.value === "" ? undefined : Number(e.target.value)),
        }));
      const minutesRow = (label, key, fallback, hint, { min = 0, max = 1440 } = {}) => h(Row, { label, hint },
        h("input", {
          className: "qbw-input", type: "number", min, max,
          value: Math.round(Number(pv(key, fallback * 60000)) / 60000),
          onChange: (e) => setP(key, Math.max(0, Math.round(Number(e.target.value) || 0)) * 60000),
        }));
      const textRow = (label, key, fallback, hint, placeholder) => h(Row, { label, hint },
        h("input", {
          className: "qbw-input", value: pv(key, fallback), placeholder,
          onChange: (e) => setP(key, e.target.value),
        }));
      const stepBox = (label, value, hint) => h("div", {
        key: label,
        style: { flex: "1 1 92px", minWidth: "92px", padding: "7px 9px", border: "1px solid #e3e6ee", borderRadius: "8px", background: "#fafbff" },
      },
        h("div", { style: { fontSize: "11px", opacity: 0.65 } }, label),
        h("div", { style: { fontWeight: 600, fontSize: "15px", lineHeight: 1.4 } }, value),
        hint ? h("div", { style: { fontSize: "11px", opacity: 0.6 } }, hint) : null);
      const needLabel = { play: "玩", learn: "学", install: "装", connect: "陪", care: "关心", share: "分享", identity: "自我", create: "创作", consume: "体验" };
      const drives = st.drives && typeof st.drives === "object" ? st.drives : {};
      const driveRows = Object.entries(drives)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .slice(0, 5)
        .map(([need, value]) => {
          const pct = Math.max(0, Math.min(100, Math.round(Number(value) * 100) || 0));
          return h("div", { key: need, style: { display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" } },
            h("span", { style: { width: "34px", fontSize: "12px", opacity: 0.75 } }, needLabel[need] ?? need),
            h("div", { style: { flex: 1, height: "7px", borderRadius: "4px", background: "#e9edf5", overflow: "hidden" } },
              h("div", { style: { width: `${pct}%`, height: "100%", borderRadius: "4px", background: "#6aa9ff" } })),
            h("span", { style: { width: "34px", textAlign: "right", fontSize: "12px", opacity: 0.7 } }, `${pct}%`));
        });
      const goals = Array.isArray(st.goals) ? st.goals : [];
      const flow = [
        ["素材", st.materialCount ?? "—", "QQ/B站/记忆/人格"],
        ["观察", st.observationCount ?? 0, "出现/谁提/正负"],
        ["目标假设", st.goalCount ?? goals.length, "归属/置信/风险"],
        ["候选", st.candidateCount ?? "—", "去重/多样性"],
        ["今天", `${st.countToday ?? 0}/${dailyMax || "∞"}`, "已投递"],
      ];

      return h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" } },
          h("div", null,
            h("h4", { style: { margin: 0 } }, "主动找主人 · 目的机制",
              status ? h("span", { className: "qbw-badge " + (status.enabled ? "ok" : "warn") }, status.enabled ? "开" : "关") : null,
              status?.carrier ? h("span", { className: "qbw-badge" }, status.carrier === "pet" ? "载体：桌宠" : "载体：QQ") : null,
              status?.focus ? h("span", { className: "qbw-badge warn" }, "专注中 · 自动停") : null),
            h("p", { style: { marginTop: "4px" } },
              "不是关键词触发器：从 QQ + B站 + 人格卡 + 记忆卡里形成「目标假设」，带归属 / 置信度 / 风险，再决定分享、索取、邀请还是倾诉。",
              "载体在顶部卡片里选：桌宠 = 气泡/语音，QQ = 私聊；两边共用这一套逻辑与状态。")),
          h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, "刷新状态")),
        error ? h("div", { className: "qbw-err", style: { marginTop: "6px" } }, error) : null,
        status?.availability ? h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
          `载体现状：${status.availability.pet?.installed ? (status.availability.pet.running ? (status.availability.pet.online ? "桌宠在线" : "桌宠已启动 · 还没连上") : "桌宠已安装 · 未运行") : "桌宠未安装"}；` +
          `QQ ${status.availability.qq?.running ? "桥接在跑" : "桥接没在跑"}${status.availability.qq?.mode ? `（模式 ${status.availability.qq.mode}）` : ""}。`) : null,
        status?.focus ? h("div", { className: "qbw-hint", style: { marginTop: "4px", color: "#b26a00" } },
          "专注模式开着：自动主动搭话已暂停（QQ / 桌宠都不发）；手动「立即试一次」仍可用。去「桌宠」页或右键菜单关闭。") : null,
        status ? h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          `今天 ${st.countToday ?? 0}/${dailyMax || "不限"} · 上次：${outcomeText}${st.lastRunAt ? `（${at(st.lastRunAt)}）` : ""} · 下次：${at(st.nextFireAt)}`,
          st.lastPurpose ? h("div", null, `上次的目的：${st.lastPurpose}`) : null,
          st.lastSkip?.reason ? h("div", null, `最近一次没出发：${st.lastSkip.reason}${st.lastSkip.at ? `（${at(st.lastSkip.at)}）` : ""}`) : null,
          st.pending?.length ? h("div", null, `心里还惦记着：${st.pending.slice(-3).map((p) => p.text).join("；")}`) : null) : h("div", { className: "qbw-hint" }, status?.ok === false ? "这个载体暂时读不到状态" : "读取中…"),

        h("details", { open: true, style: { marginTop: "10px", borderTop: "1px dashed #e1e6f0", paddingTop: "8px" } },
          h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, "它是怎么想的 · 当前链路"),
          h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
            "素材 → 事件理解（谁的目标）→ 评价/驱力 → 目标假设（置信度/风险）→ 选择 → 发送 → 回执/反馈。每一步都在下面可调。"),
          h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" } },
            flow.map(([label, value, hint]) => stepBox(label, value, hint))),
          driveRows.length ? h("div", { style: { marginTop: "10px" } },
            h("div", { style: { fontSize: "12px", opacity: 0.7, marginBottom: "2px" } }, "当前驱力（凭什么这次更想聊这个）"),
            driveRows) : null,
          goals.length ? h("div", { style: { marginTop: "10px" } },
            h("div", { style: { fontSize: "12px", opacity: 0.7, marginBottom: "2px" } }, "当前目标假设（前 3 个）"),
            goals.slice(0, 3).map((g) => h("div", { key: g.id, className: "qbw-hint", style: { marginTop: "3px" } },
              `[${g.ownerLabel}/${g.domain}] ${g.intent}（置信 ${Math.round((g.confidence || 0) * 100)}% · 风险 ${Math.round((g.risk || 0) * 100)}%）`))) : null,
          (st.lastEmotionLabel || st.lastEmotionText) ? h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
            `最近情绪：${st.lastEmotionLabel || st.lastEmotionText}`) : null),

        h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "8px", paddingTop: "0", flexWrap: "wrap" } },
          h("span", { className: "qbw-hint" }, "节奏预设（只改节奏，不改开关/素材）："),
          h(Btn, { kind: "qbw-btn2", onClick: () => applyPreset("calm"), disabled: !!busy }, "保守"),
          h(Btn, { kind: "qbw-btn2", onClick: () => applyPreset("normal"), disabled: !!busy }, "默认"),
          h(Btn, { kind: "qbw-btn2", onClick: () => applyPreset("active"), disabled: !!busy }, "活跃")),

        h("details", { open: true, style: { marginTop: "8px" } },
          h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, "节奏与安静"),
          h(Row, { label: "启用目的机制", hint: "关掉后不会主动私聊；手动「立即试一次」仍可用" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: pv("enabled", true) !== false, onChange: (e) => setP("enabled", e.target.checked) })),
          minutesRow("两次之间至少（分钟）", "gapMinMs", 150, "默认 150；两枪之间至少隔这么久", { min: 5, max: 1440 }),
          minutesRow("两次之间最多（分钟）", "gapMaxMs", 300, "默认 300；到点后随机挑", { min: 5, max: 1440 }),
          minutesRow("启动后先等（分钟）", "initialDelayMinMs", 30, "重启/换角色后第一枪的起跑延迟", { min: 1, max: 720 }),
          numberRow("每天最多几次", "dailyMax", 4, "0 = 不限（仍受 token 额度约束）", { min: 0, max: 24 }),
          h(Row, { label: "安静时段", hint: "HH:MM，例如 23:30 ~ 08:30；两个相同 = 不设安静时段" },
            h("div", { style: { display: "flex", gap: "6px", alignItems: "center" } },
              h("input", { className: "qbw-input", style: { width: "90px" }, value: pv("quietStart", "23:30"), onChange: (e) => setP("quietStart", e.target.value) }),
              h("span", null, "~"),
              h("input", { className: "qbw-input", style: { width: "90px" }, value: pv("quietEnd", "08:30"), onChange: (e) => setP("quietEnd", e.target.value) }))),
          minutesRow("你空闲多久才打扰（分钟）", "idleThresholdMs", 30, "你刚说过话 / 她刚发过言时先不插嘴", { min: 0, max: 720 })),

        h("details", { style: { marginTop: "8px" } },
          h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, "素材与目标"),
          numberRow("翻多久以内的 QQ 记忆（小时）", "materialWindowHours", 72, "默认 72；B站 另有窗口", { min: 1, max: 336 }),
          numberRow("B站 记忆窗口（天）", "biliWindowDays", 7, "默认 7 天", { min: 1, max: 60 }),
          numberRow("最多带多少条素材", "maxMaterials", 36, "默认 36；太多会挤占提示词", { min: 6, max: 80 }),
          numberRow("素材少于多少就不硬找话", "minMaterials", 2, "有 pending / 人格卡 / 记忆卡时不受此限", { min: 0, max: 20 }),
          numberRow("提示词最多给几个方向", "maxCandidates", 6, "默认 6；会按需要/归属去重", { min: 3, max: 10 })),

        h("details", { style: { marginTop: "8px" } },
          h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, "重试 / 上限 / 目标"),
          minutesRow("失败后多久重试（分钟）", "retryMs", 15, "投递失败 / 回合报错", { min: 1, max: 360 }),
          numberRow("最多重试几次", "maxAttempts", 3, "连续失败后回到正常间隔", { min: 1, max: 10 }),
          numberRow("提示词硬上限（字符）", "promptMaxChars", 16000, "超出会截中间、保留头尾指令", { min: 4000, max: 30000, step: 1000 }),
          textRow("找哪个 QQ（留空 = ownerQQ）", "ownerUin", "", "必须同时在 allow.private，且与小肥鱼互为好友", "3287064288")),

        h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "8px", paddingTop: "0", flexWrap: "wrap" } },
          h(Btn, { kind: "qbw-btn2", onClick: doPreview, disabled: !!busy }, busy === "purpose-preview" ? "生成中…" : "预览这一轮（不发）"),
          h(Btn, { kind: "qbw-btn2", onClick: doRun, disabled: !!busy }, busy === "purpose-run" ? "投递中…" : "立即试一次（真发）")),
        msg ? h("div", { className: msg.startsWith("✗") ? "qbw-err" : "qbw-hint", style: { marginTop: "6px" } }, msg) : null,
        preview ? h("details", { style: { marginTop: "8px" } },
          h("summary", null, `预览：${preview.selected?.text ?? "（没有选中目的）"}${preview.selected?.needLabel ? ` · 需求 ${preview.selected.needLabel}` : ""}${preview.selected?.actionLabel ? ` · 行动 ${preview.selected.actionLabel}` : ""} · 素材 ${preview.materials?.length ?? 0} 条`),
          h("textarea", { className: "qbw-textarea", readOnly: true, rows: 18, style: { marginTop: "6px" }, value: preview.prompt ?? "" })) : null,
        h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          "载体 = 桌宠时：所有节奏参数保存即生效（插件每次读配置）；不需要重启桥接。",
          "载体 = QQ 时：节奏参数要重启桥接才生效（桥接只在启动时读 config.json），但切换载体本身 30 秒内生效。",
          "目的状态跟着当前角色走：换人格卡/记忆卡后按新角色重新生成动机，不会继承上一个角色。",
          "硬闸门：安静时段 / 每天上限 / 你正在聊天 / token 额度 / 好友关系，任一不过都不会发。"));
    }

    // ── 目的机制 · 载体选择（桌宠 / QQ）──────────────────────────────────
    // 2026-10-25 用户要求：目的机制独立成一个栏目；载体可选桌宠或 QQ，
    // 未安装桌宠的用户默认 QQ。同一时刻只有一个载体在发，避免两边同时收到。
    function PurposeCarrierCard({ cfg, set, busy, toast }) {
      const P = cfg?.purpose && typeof cfg.purpose === "object" ? cfg.purpose : {};
      const carrier = P.carrier === "pet" ? "pet" : "qq";
      const modality = P.petModality === "voice" ? "voice" : "text";
      const [status, setStatus] = useState(null);
      useEffect(() => {
        api("/purpose/status").then(setStatus).catch(() => {});
      }, []);
      const pet = status?.availability?.pet ?? {};
      const qq = status?.availability?.qq ?? {};
      const choose = (value) => {
        set(["purpose", "carrier"], value);
        toast(`✓ 载体改为「${value === "pet" ? "桌宠" : "QQ"}」，记得点底部保存`);
      };
      const seg = (options, value, onChange) => h("div", { style: { display: "inline-flex", gap: "4px", padding: "2px", borderRadius: "999px", background: "#fff", border: "1px solid #e3e6ee" } },
        options.map(([val, label]) => h("button", {
          key: val,
          type: "button",
          onClick: () => onChange(val),
          style: {
            border: "none",
            borderRadius: "999px",
            padding: "3px 12px",
            fontSize: "12px",
            lineHeight: 1.7,
            cursor: "pointer",
            background: value === val ? "linear-gradient(180deg,#8ab8ff,#5f97f0)" : "transparent",
            color: value === val ? "#fff" : "#6d6a78",
          },
        }, label)));
      const cardStyle = (active) => ({
        flex: "1 1 240px",
        minWidth: "220px",
        padding: "10px 12px",
        borderRadius: "10px",
        border: `1px solid ${active ? "#6aa9ff" : "#e3e6ee"}`,
        background: active ? "rgba(106,169,255,.08)" : "#fafbff",
        cursor: "pointer",
        boxShadow: active ? "0 0 0 2px rgba(106,169,255,.14)" : "none",
      });
      const petText = !status ? "读取中…"
        : !pet.installed ? "未安装桌宠：先去「桌宠」页安装，再回来选"
        : !pet.running ? "已安装 · 未运行（去「桌宠」页启动）"
        : pet.online ? `在线${pet.roleName ? ` · 角色「${pet.roleName}」` : ""}`
        : "已启动 · 还没连上（等几秒，或看「桌宠」页状态）";
      const qqText = qq.running
        ? `桥接运行中${qq.mode ? ` · 模式 ${qq.mode}` : ""}`
        : "桥接没在运行：选了也要先在「QQ」页启动";
      return h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
        h("h4", null, "触发载体",
          h("span", { className: "qbw-badge" }, carrier === "pet" ? "桌宠" : "QQ"),
          status?.ok === false ? h("span", { className: "qbw-badge warn" }, "状态读不到") : null),
        h("p", null, "目的机制只有一套（素材 → 驱动 → 目标假设 → 选择 → 回执）；这里决定这一句从哪个载体发出去。同一时刻只有一个执行者，不会桌宠和 QQ 同时收到。"),
        h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "8px" } },
          h("div", { style: cardStyle(carrier === "qq"), onClick: () => choose("qq"), role: "button" },
            h("div", { style: { fontWeight: 600, fontSize: "13px" } }, "QQ 私聊（默认）"),
            h("div", { className: "qbw-hint" }, qqText),
            h("div", { className: "qbw-hint" }, "没安装桌宠的用户保持这一项即可。")),
          h("div", { style: cardStyle(carrier === "pet"), onClick: () => choose("pet"), role: "button" },
            h("div", { style: { fontWeight: 600, fontSize: "13px" } }, "桌宠气泡 / 语音"),
            h("div", { className: "qbw-hint" }, petText),
            h("div", { className: "qbw-hint" }, "在桌面上说话：语音会念出来，气泡里始终显示文字。"))),
        h("div", { style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginTop: "10px" } },
          h("span", { style: { fontSize: "12px", opacity: 0.75 } }, "桌宠主动搭话形式"),
          seg([["text", "文本"], ["voice", "语音"]], modality, (value) => {
            set(["purpose", "petModality"], value);
            toast(`✓ 桌宠主动搭话改为「${value === "voice" ? "语音" : "文本"}」，记得保存`);
          }),
          h("span", { className: "qbw-hint" }, carrier === "pet" ? "语音也会同时显示气泡文字" : "切到桌宠载体后生效")),
        h(Row, { label: "桌宠没开着时回落到 QQ", hint: "开：桌宠没运行时由桥接照常私聊（按它自己的闸门/排程）；关：宁可这轮不发" },
          h("input", {
            className: "qbw-switch",
            type: "checkbox",
            checked: P.petFallbackToQQ !== false,
            onChange: (e) => set(["purpose", "petFallbackToQQ"], e.target.checked),
          })),
        status?.ok === false ? h("div", { className: "qbw-hint", style: { marginTop: "4px" } }, status.error || "") : null);
    }

    // ── 桌宠对话测试：验证人设 / 模型 / 语音链路（也能看到气泡是否弹出）────
    function PetChatTestCard({ toast }) {
      const [status, setStatus] = useState(null);
      const [text, setText] = useState("在干嘛呀");
      const [modality, setModality] = useState("text");
      const [busy, setBusy] = useState("");
      const [reply, setReply] = useState(null);
      const [err, setErr] = useState("");
      const load = async () => {
        try { setStatus(await api("/pet/status")); } catch (e) { setErr(e.message); }
      };
      useEffect(() => { void load(); }, []);
      const send = async () => {
        setBusy("chat"); setErr(""); setReply(null);
        try {
          const r = await api("/pet/chat-test", { method: "POST", body: { text: text.trim() || "在吗", modality } });
          if (!r.ok) throw new Error(r.error || "发送失败");
          setReply(r.reply ?? null);
          toast("✓ 她回了；桌宠那边也会弹气泡");
          await load();
        } catch (e) { setErr(e.message); } finally { setBusy(""); }
      };
      const chat = status?.chat ?? {};
      const llm = status?.llm ?? {};
      const voice = status?.voice ?? {};
      const proactive = status?.proactive ?? {};
      return h("div", { className: "qbw-card" },
        h("h4", null, "桌宠对话",
          h("span", { className: "qbw-badge " + (proactive.online ? "ok" : "warn") }, proactive.online ? "桌宠在线" : "桌宠离线")),
        h("p", null, "对话走 DSH 默认模型，人设卡 / 记忆卡来自当前角色；用量计入 token 额度「其他」。语音回复走「语音」页的 TTS 配置。"),
        h("div", { className: "qbw-hint" },
          `角色：${status?.role?.name ?? "—"} · 模型：${llm.provider || "—"}/${llm.model || "—"} · 语音：${voice.enabled ? `${voice.route}（${voice.endpoint}）` : "未开启"} · 历史 ${chat.messages ?? 0} 条`),
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" } },
          h("input", {
            className: "qbw-input",
            style: { flex: "1 1 220px" },
            value: text,
            placeholder: "对她说一句…",
            onChange: (e) => setText(e.target.value),
            onKeyDown: (e) => { if (e.key === "Enter") void send(); },
          }),
          h("select", { className: "qbw-select", value: modality, onChange: (e) => setModality(e.target.value) },
            h("option", { value: "text" }, "文本回复"), h("option", { value: "voice" }, "语音回复")),
          h(Btn, { kind: "qbw-btn2", onClick: send, disabled: !!busy || !proactive.online }, busy === "chat" ? "发送中…" : "发一句试试")),
        !proactive.online ? h("div", { className: "qbw-hint", style: { marginTop: "4px" } }, "桌宠没在线：先在「桌宠」页启动；也可以切回 QQ 载体。") : null,
        err ? h("div", { className: "qbw-err", style: { marginTop: "6px" } }, err) : null,
        reply ? h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
          `她回（${reply.modality === "voice" ? "语音" : "文本"}）：${reply.text}`) : null);
    }

    function PurposeTab({ qq, setQq, unified, setUnified, overview, busy, setBusy, toast, reload, goTab }) {
      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "「目的」现在是一个独立栏目：管小肥鱼什么时候主动找你、想说什么；载体可选桌宠或 QQ。",
          "没装桌宠的用户默认走 QQ；装了桌宠后可以切到桌宠，同一时间只会有一个载体收到。"),
        h(PurposeCarrierCard, { cfg: qq, set: setQq, busy, toast }),
        h(PurposeCard, { cfg: qq, set: setQq, busy, setBusy, toast, carrier: qq?.purpose?.carrier }),
        h(PetChatTestCard, { toast }),
        h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          "桌宠的安装/启动、对话参数在「桌宠」页；人设与记忆在「角色 / 记忆」页。",
          goTab ? h(Btn, { kind: "qbw-btn2", onClick: () => goTab("pet"), style: { marginLeft: "8px" } }, "去「桌宠」页") : null));
    }

    // ── 对话收尾判断：每段对话有自然终点；收尾不是潜水 ──────────────────
    // 2026-10-24 用户要求：发完最后一句后判断这段能不能结束，可以就不回复；
    // 结束不是终止，而是合理结束 + 下次更好的开始。
    function ClosureCard({ cfg, set, overview, busy, reload }) {
      const C = cfg?.socialV2?.closure && typeof cfg.socialV2.closure === "object" ? cfg.socialV2.closure : {};
      const cv = (key, fallback) => (C[key] === undefined || C[key] === null || C[key] === "" ? fallback : C[key]);
      const setC = (key, value) => set(["socialV2", "closure", key], value);
      const st = overview?.bridge?.closure ?? null;
      const latest = st?.active ?? null;
      const enabledNow = st ? st.enabled !== false : cv("enabled", true) !== false;
      const at = (ms) => (ms ? new Date(ms).toLocaleString("zh-CN", { hour12: false }) : "—");
      const reasonText = {
        natural: "自然收尾", "topic-done": "话题聊完", "explicit-end": "对方道别",
        busy: "各自去忙", tired: "聊累了", other: "自然收尾",
      }[latest?.reason] ?? "自然收尾";
      const verdictText = { close: "可以自然收尾", linger: "先等一等", continue: "还在聊" }[latest?.verdict] ?? "—";
      const cooldownLeft = latest?.cooldownUntil > Date.now()
        ? Math.max(1, Math.ceil((latest.cooldownUntil - Date.now()) / 60000)) : 0;
      const minutes = Math.round(Number(cv("cooldownMs", 1200000)) / 60000);

      return h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" } },
          h("div", null,
            h("h4", { style: { margin: 0 } }, "对话收尾判断",
              h("span", { className: "qbw-badge " + (enabledNow ? "ok" : "warn") }, enabledNow ? "开" : "关")),
            h("p", { style: { marginTop: "4px" } },
              "一段对话有自然终点：双方都收尾时不再补一句，而是记下「收在这、下次怎么接」。不是潜水——被叫到、被提问、私聊仍会醒。")),
          h(Btn, { kind: "qbw-btn2", onClick: () => reload?.(), disabled: !!busy }, "刷新状态")),
        latest ? h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          `最近一次：${latest.key} · ${at(latest.at)} · ${reasonText}`,
          latest.summary ? h("div", null, `收在：「${latest.summary}」`) : null,
          latest.nextOpening ? h("div", null, `下次可以接：「${latest.nextOpening}」`) : null,
          h("div", null, `当前判断：${verdictText}${latest.score != null ? `（${Math.round(latest.score * 100)}%）` : ""}${cooldownLeft ? ` · 软冷却还剩约 ${cooldownLeft} 分钟` : ""}`),
          Array.isArray(latest.reasons) && latest.reasons.length
            ? h("div", null, `依据：${latest.reasons.slice(0, 4).join("；")}`) : null)
          : h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, "还没有收过尾；下次她判断这段聊完了，这里会出现收尾记录。"),
        h("details", { open: true, style: { marginTop: "10px", borderTop: "1px dashed #e1e6f0", paddingTop: "8px" } },
          h("summary", { style: { cursor: "pointer", fontWeight: 600 } }, "收尾规则"),
          h(Row, { label: "启用对话收尾判断", hint: "关掉后不会注入判断参数，也不能用 qq_close_conversation" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: cv("enabled", true) !== false, onChange: (e) => setC("enabled", e.target.checked) })),
          h(Row, { label: "收尾后软冷却（分钟）", hint: "只压普通概率唤醒/回复检查/主动机会；@、提问、关键词、私聊不受影响" },
            h("input", { className: "qbw-input", type: "number", min: 1, max: 1440, value: minutes,
              onChange: (e) => setC("cooldownMs", Math.max(1, Math.round(Number(e.target.value) || 1)) * 60000) })),
          h(Row, { label: "对方还在问时拒绝收尾", hint: "默认开；防止用「结束」逃避该回的问题（桥接会返回 409）" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: cv("requireNoOpenQuestion", true) !== false, onChange: (e) => setC("requireNoOpenQuestion", e.target.checked) })),
          h(Row, { label: "每次唤醒注入判断参数", hint: "有近期对话才注入；关掉后仍可收尾，但模型看不到实时信号" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: cv("promptInWake", true) !== false, onChange: (e) => setC("promptInWake", e.target.checked) })),
          h(Row, { label: "收尾摘要上限（字）", hint: "summary 写这次收在哪" },
            h("input", { className: "qbw-input", type: "number", min: 20, max: 500, value: cv("maxSummaryChars", 160), onChange: (e) => setC("maxSummaryChars", Number(e.target.value) || 160) })),
          h(Row, { label: "下次接法上限（字）", hint: "nextOpening 写下一次可以怎么开始" },
            h("input", { className: "qbw-input", type: "number", min: 10, max: 300, value: cv("maxNextOpeningChars", 120), onChange: (e) => setC("maxNextOpeningChars", Number(e.target.value) || 120) }))),
        h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          "和 mark_read 的区别：mark_read 只是划走消息；收尾会留下结束点和下次的接法。",
          "和潜水的区别：收尾不改下一次唤醒，也不需要沉睡前观察；长时间不参与才用潜水。",
          "改完先保存，再点底部「重启 QQ 桥接」才生效（桥接只在启动时读 config.json）。"));
    }

    // ── QQ 标签页 ───────────────────────────────────────────────────────────
    function QQTab({ cfg, set, admin, setAdmin, unified, setUnified, overview, busy, setBusy, toast, reload, goTab }) {
      const [query, setQuery] = useState("");
      const tools = Object.keys(cfg?.socialV2?.tools ?? {});
      const groups = [...QQ_FIELDS];
      if (tools.length) {
        groups.push({ group: "二代 · 工具开关", note: "关掉即从模型工具面移除", fields: tools.map((key) => F(`socialV2.tools.${key}`, TOOL_LABELS[key] ?? key, key, "switch")) });
      }
      groups.push({ group: "表情包", fields: [
        F("socialV2.sticker.enabled", "启用表情包", "", "switch"),
        F("socialV2.sticker.syncTtlMs", "同步 TTL（ms）", "", "number"),
        F("socialV2.sticker.maxListCount", "列表上限", "", "number", { min: 1 }),
        F("socialV2.sticker.includeInPrompt", "注入提示词", "", "switch"),
        F("socialV2.sticker.promptMaxStickers", "提示词最多几张", "", "number", { min: 0 }),
        F("socialV2.sticker.collect.enabled", "允许收藏表情", "", "switch"),
        F("socialV2.sticker.collect.maxPerMinute", "每分钟最多收藏", "", "number", { min: 0 }),
        F("socialV2.sticker.collect.maxPerHour", "每小时最多收藏", "", "number", { min: 0 }),
        F("socialV2.sticker.collect.maxRemarkChars", "备注最大字符", "", "number", { min: 0 }),
      ]});
      groups.push({ group: "语音", fields: [
        F("socialV2.voice.enabled", "启用语音发送", "", "switch"),
F("socialV2.voice.dir", "语音库目录", "相对 surfcore 根目录；也可以点「浏览…」选绝对路径（需打开下面的开关）", "text", { browse: "dir" }),
        F("socialV2.voice.maxSeconds", "最长秒数", "", "number", { min: 1 }),
        F("socialV2.voice.maxBytes", "最大字节", "", "number"),
        F("socialV2.voice.maxPerMinute", "每分钟最多", "", "number", { min: 0 }),
        F("socialV2.voice.maxPerHour", "每小时最多", "", "number", { min: 0 }),
        F("socialV2.voice.allowAbsolutePath", "允许绝对路径", "⚠️ 会扩大文件读取面", "switch"),
        F("socialV2.voice.defaultVolume", "默认音量倍数", "", "number", { min: 0, max: 4, step: 0.1 }),
        F("socialV2.voice.loudness", "响度档位", "quiet / normal / loud", "select", { options: [["quiet", "quiet"], ["normal", "normal"], ["loud", "loud"]] }),
F("socialV2.voice.ffmpegPath", "ffmpeg 路径", "留空走 PATH", "text", { wide: true, browse: "file" }),
        F("socialV2.voice.autoReadback", "自动回读", "", "switch"),
      ]});
      const filtered = query.trim()
        ? groups.map((g) => ({ ...g, fields: g.fields.filter((f) => `${g.group} ${f.label} ${f.hint ?? ""} ${f.path.join(".")}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter((g) => g.fields.length)
        : groups;

      const testGreeting = async () => {
        setBusy("greeting-test");
        try {
          const r = await api("/bridge", { method: "POST", body: { action: "greeting-test" } });
          toast(r.ok ? `✓ ${r.message ?? "早安问候已试发"}` : `✗ ${r.error ?? "试发失败"}`);
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      return h("div", null,
        h(PlatformStartCard, {
          platform: "qq",
          hint: "开 = DSH 启动时自动拉起 QQ 桥接，并纳入「一键启动」；关 = 不自动启动、也不参与一键启动（保存后会停掉当前桥接）。",
          enabled: unified?.platforms?.start?.qq !== false,
          onChange: (value) => setUnified(["platforms", "start", "qq"], value),
          running: Boolean(overview?.bridge?.running || overview?.bridge?.ok),
          overview,
        }),
        h(AdminCard, { admin, onChange: setAdmin, qqPrivate: cfg?.allow?.private ?? [], qqAllowAll: cfg?.allowAllWhenEmpty === true }),
        h(WhitelistCard, {
          allow: cfg?.allow ?? {},
          allowAll: cfg?.allowAllWhenEmpty === true,
          ownerQQ: admin?.qq || cfg?.ownerQQ || overview?.mode?.ownerQQ || "",
          onAllowChange: (key, list) => set(["allow", key], list),
          onAllowAllChange: (value) => set(["allowAllWhenEmpty"], value),
        }),
        h(BlacklistCard, {
          deny: cfg?.deny ?? {},
          ownerQQ: admin?.qq || cfg?.ownerQQ || overview?.mode?.ownerQQ || "",
          onDenyChange: (key, list) => set(["deny", key], list),
        }),
        // 目的机制已独立成「目的」栏目；QQ 页只留一张指路卡，避免两处各改一半。
        h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
          h("h4", null, "主动找主人 · 目的机制"),
          h("p", null, "已独立成「目的」栏目：可选载体（桌宠 / QQ）、主动搭话形式、节奏、素材、预览与试一次。",
            "目的状态和 QQ / B站 / 记忆共用当前角色；载体切到桌宠后不会同时私聊你。"),
          h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "6px", paddingTop: "0" } },
            h(Btn, { kind: "qbw-btn2", onClick: () => goTab?.("purpose") }, "去「目的」页设置"))),
        h(AdvancedSettings, { note: "工具开关 / 早安问候 / 全部 QQ 参数：展开后同样可改" },
          h(QqFishGuardStatusCard, { busy }),
          h(ClosureCard, { cfg, set, overview, busy, reload }),
          h("div", { className: "qbw-search" },
            h("input", { className: "qbw-input", placeholder: "搜索 QQ 高级参数（白名单在顶部卡片）", value: query, onChange: (e) => setQuery(e.target.value) }),
            h(Btn, { kind: "qbw-btn2", onClick: () => api("/mode", { method: "GET" }).then((r) => toast(`当前模式：${r.dshSetting?.mode ?? r.localMode ?? "—"}`)).catch((e) => toast(`✗ ${e.message}`)) }, "查看模式")),
          h("div", { className: "qbw-infobox" },
            "QQ 参数写入 ", h("code", { className: "qbw-code" }, "<surfcore>/config.json"), "。",
            "保存后需要重启桥接才会全部生效（桥接只在启动时读配置）；B站参数下一轮即生效。"),
          // 定时分享是「往 QQ 群发」，用户会先来 QQ 页找；这里只做指路，真正的开关在 B站 页顶部。
          h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
            h("h4", null, "定时分享视频到群"),
            h("p", null, "每天按时间点往白名单群发 B站 视频卡片 + 角色短评；时间点、目标群、卡片样式都在「B站」页顶部。"),
            h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "6px", paddingTop: "0" } },
              h(Btn, { kind: "qbw-btn2", onClick: () => goTab?.("bili") }, "去 B站 页设置"))),
          h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
            h("h4", null, "QQ 早安问候"),
            h("p", null, "每天固定时间给指定 QQ 发一句早安；只在 DSH 在线时发，换着花样，不 @ 人。"),
            h("p", { className: "qbw-hint" },
              "⚠️ 小肥鱼需要和早安对象「互为 QQ 好友」：QQ 对陌生人/单向好友的私聊会直接拒绝（result=16「请先添加对方为好友」）。",
              "桥接发之前会先查小肥鱼这边的好友列表并提示；请确保对方也加了小肥鱼，别只单向添加。",
              "08:00 没发出去时会在 3 小时内补发，DSH 掉线则每 10 分钟重试；试发失败会直接显示原因。"),
            h(Field, {
              f: { path: ["greetings", "enabled"], label: "启用早安问候", kind: "switch" },
              value: getPath(cfg, ["greetings", "enabled"]),
              onChange: (v) => set(["greetings", "enabled"], v),
            }),
            h(Field, {
              f: { path: ["greetings", "morning", "time"], label: "问候时间", hint: "HH:MM，例如 08:00", kind: "text" },
              value: getPath(cfg, ["greetings", "morning", "time"]),
              onChange: (v) => set(["greetings", "morning", "time"], v),
            }),
            h(Field, {
              f: { path: ["greetings", "morning", "uin"], label: "要问候的 QQ", hint: "必须是 allow.private 里的 QQ，且与小肥鱼「互为好友」", kind: "text" },
              value: getPath(cfg, ["greetings", "morning", "uin"]),
              onChange: (v) => set(["greetings", "morning", "uin"], v),
            }),
            h(Field, {
              f: { path: ["greetings", "morning", "name"], label: "怎么称呼 TA", hint: "可空；留空就用「QQ 号」", kind: "text" },
              value: getPath(cfg, ["greetings", "morning", "name"]),
              onChange: (v) => set(["greetings", "morning", "name"], v),
            }),
            h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "6px", paddingTop: "0" } },
              h(Btn, { kind: "qbw-btn2", onClick: testGreeting, disabled: !!busy }, busy === "greeting-test" ? "试发中…" : "立即试发"),
              h("span", { className: "qbw-hint" }, "试发读取的是已保存的配置；改了先点底部「保存」再试发。"))),
          h(FieldGroups, {
            groups: filtered,
            cfg,
            set,
            readOnly: (f) => f.readOnly || (f.path.join(".") === "self.mid") || (f.path.join(".") === "self.name"),
            groupExtra: (g) => g.group === "连接与身份" ? h(Row, { label: "运行模式", hint: "chat=普通安全聊天；reserved=一代仿真；reserved2=二代工具仿真；closed-agent=仅主人私聊全工具。只运行当前模式，其他模式配置不生效" },
              h("select", { className: "qbw-select", value: overview?.mode?.effective ?? "reserved2", onChange: async (e) => {
                try { await api("/mode", { method: "POST", body: { mode: e.target.value } }); toast(`✓ 模式已切到 ${e.target.value}`); await reload(); } catch (err) { toast(`✗ ${err.message}`); }
              } },
                [["chat", "chat（一代普通）"], ["reserved", "reserved（一代仿真）"], ["reserved2", "reserved2（二代仿真）"], ["closed-agent", "closed-agent（封闭）"], ["simulation", "simulation（=reserved2）"]].map(([v, l]) => h("option", { key: v, value: v }, l)))) : null,
          })),
        h("div", { className: "qbw-actions" },
          h(Btn, { kind: "qbw-btn2", onClick: async () => {
            setBusy("restart");
            try { const r = await api("/bridge", { method: "POST", body: { action: "restart" } }); toast(r.ok ? "✓ 桥接已重启" : `✗ ${r.error ?? r.message ?? "失败"}`); await reload(); } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
          }, disabled: !!busy || unified?.platforms?.start?.qq === false, title: unified?.platforms?.start?.qq === false ? "先在顶部打开「启动 QQ」" : undefined }, "重启 QQ 桥接")));
    }

    // ── B站标签页 ───────────────────────────────────────────────────────────
    // ── B站自动化：今天用了多少（只读）──────────────────────────────────
    function AutomationCard({ data, onRefresh, busy }) {
      const u = data?.usage ?? {};
      const L = data?.limits ?? {};
      const mine = u.mine ?? {};
      const capText = (n) => (Number(n) > 0 ? n : "不限");
      const kindLine = (data?.dynamics?.kinds ?? []).map((k) => `${k.label}${k.postedAt ? "✓" : k.enabled ? "·" : "关"}`).join("  ");
      const kv = (label, value) => h("div", { className: "qbw-kv", key: label },
        h("span", null, label), h("span", null, value));
      return h("div", { className: "qbw-card" },
        h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } },
          h("h4", { style: { margin: 0 } }, "今天（只读）"),
          h(Btn, { kind: "qbw-btn2", onClick: onRefresh, disabled: !!busy }, "刷新")),
        data?.ok === false
          ? h("div", { className: "qbw-err" }, `自动化快照读取不到（重启 DSH 后 /bili/automation 才可用）：${data.error ?? ""}`)
          : data
            ? h("div", { style: { marginTop: "6px" } },
            kv("普通评论", `${u.comment ?? 0} / ${capText(L.daily)}`),
            kv("回找我的人", `${u.reply ?? 0} / ${capText(L.replyDaily)}`),
            kv("主动搭话", `${u.ta ?? 0} / ${capText(L.taDaily)}`),
            kv("动态回复", `一类 ${mine.best ?? 0} · 二创 ${mine.game ?? 0} · 动漫 ${mine.anime ?? 0} · 游戏 ${mine.gaming ?? 0}（每类 ${capText(L.mineDaily)}）`),
            kv("分享型", `${data.share?.used ?? 0} / ${data.share?.daily ?? "?"}`),
            h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, `四类动态：${kindLine || "—"}`),
            h("div", { className: "qbw-hint" }, `下一类：${data.dynamics?.next ? `${data.dynamics.next.label} ${data.dynamics.next.slotText}` : "—"}`),
            h("div", { className: "qbw-hint" },
              `QQ 分享：${data.qqShare?.enabled ? `下一班 ${data.qqShare.nextText ?? "—"} → ${(data.qqShare.groupsEffective ?? []).length} 个群` : "已关"}`))
          : h("div", { className: "qbw-hint" }, "读取中…"));
    }

    // ── B站 → QQ 自动分享（写根 config.json 的 biliBridge，保存后需重启桥接）──
    // 放在 B站 页最上面 + 默认展开：以前埋在页面最底部、还是折叠的，
    // 用户找了半天都找不到（见 PITFALLS #21）。
    function QqShareSection({ qq, set, data, busy, setBusy, toast }) {
      const fields = QQ_BILI_SHARE_FIELDS;
      const share = data?.qqShare;
      const [shareMsg, setShareMsg] = useState("");
      const shareNow = async () => {
        if (!confirm("现在就让角色往白名单群分享一条 B站 视频？这会真的发到群里，并占用今天的一个分享名额。")) return;
        setBusy("share-now");
        setShareMsg("");
        try {
          // 先确认网关在线：SnowLuma 没起来时桥接仍会「投递成功」，但群里什么都收不到。
          const s = await api("/bridge");
          if (s?.status?.running && s.status.snowluma?.connected !== true) {
            throw new Error("SnowLuma 没连上（先启动 SnowLuma，再点这里）");
          }
          const r = await api("/bili/share-now", { method: "POST", body: { action: "share-now" } });
          if (!r.ok) throw new Error(r.error ?? r.why ?? "桥接返回失败");
          setShareMsg(`✓ 已投递：${r.card?.title ?? "一条视频"}（${r.sent ?? 0} 个群）`);
          toast(`✓ 已投递：${r.card?.title ?? "一条视频"}（${r.sent ?? 0} 个群）`);
        } catch (e) {
          // 不能只弹 toast：toast 一闪而过，「没反应」的观感就是这么来的。
          setShareMsg(`✗ ${e.message}`);
          toast(`✗ ${e.message}`);
        } finally { setBusy(""); }
      };
      return h(Section, {
        title: "定时分享视频到群（B站 → QQ）",
        note: "每天按时间点发「标题 + 链接」+ 角色短评；改完点底部「保存并重启 QQ 桥接」",
        defaultOpen: true,
      },
        h("div", { className: "qbw-hint", style: { margin: "6px 0" } },
          share
            ? `开关：${share.enabled ? "开" : "关"} · 今天最后一班 ${share.lastSlot || "—"} · 下一班 ${share.nextText || "—"} · ${(share.groupsEffective ?? []).length} 个群 · 形式：${{ text: "文本链接", miniapp: "小程序卡片（已下架）", off: "不发" }[share.cardMode] ?? "文本链接"}`
            : "状态读取中…"),
        fields.map((f) => h(Field, {
          key: f.path.join("."),
          f,
          value: getPath(qq, f.path),
          onChange: (v) => set(f.path, v),
        })),
        h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "6px", paddingTop: "0" } },
          h(Btn, { kind: "qbw-btn2", onClick: shareNow, disabled: !!busy }, busy === "share-now" ? "发送中…" : "立即分享一次"),
          h("span", { className: "qbw-hint" }, "会真的发到白名单群；用来验证排期和卡片是否正常。")),
        shareMsg ? h("div", { className: shareMsg.startsWith("✓") ? "qbw-ok" : "qbw-err", style: { marginTop: "4px" } }, shareMsg) : null);
    }

    // ── 鱼群保护 · 运行状态卡（B站页顶部）────────────────────────────────
    // 用户最关心「到底有没有真的点赞」：这里直接显示今天赞了几条、上次失败在哪个 code、
    // 以及风控冷却到什么时候。数据来自 /bili/fish-guard（当前角色的 fish-guard.json）。
    function FishGuardStatusCard({ busy, toast }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const [permBusy, setPermBusy] = useState(false);
      const [permMsg, setPermMsg] = useState("");
      const load = useCallback(async () => {
        try { setData(await api("/bili/fish-guard")); setErr(""); }
        catch (e) { setErr(e.message); }
      }, []);
      const fixPermission = async () => {
        setPermBusy(true); setPermMsg("");
        try {
          const r = await api("/bili/session-permission", { method: "POST", body: {} });
          setPermMsg(`${r.ok ? "✓" : "✗"} ${r.message ?? (r.ok ? "已处理" : "失败")}`);
        } catch (e) { setPermMsg(`✗ ${e.message}`); }
        finally { setPermBusy(false); }
      };
      useEffect(() => { load(); }, [load]);
      const fg = data?.fishGuard;
      const last = fg?.lastRun;
      const records = Array.isArray(fg?.records) ? fg.records : [];
      const likeHistory = Array.isArray(fg?.likeHistory) ? fg.likeHistory : [];
      const blockedUntil = fg?.likeBlockedUntil ? new Date(fg.likeBlockedUntil).getTime() : 0;
      const blockedMin = blockedUntil > Date.now() ? Math.ceil((blockedUntil - Date.now()) / 60000) : 0;
      const lastOk = last ? (last.failed.length === 0 && last.attempted > 0) : null;
      const lastSkipped = Boolean(last && last.attempted === 0);
      const badge = !data ? "" : blockedMin > 0 ? "warn" : last && last.failed.length ? "bad" : lastOk ? "ok" : "";
      const badgeText = blockedMin > 0 ? `风控冷却 ${blockedMin} 分钟` : lastSkipped ? "上次跳过（0 次请求）" : lastOk === false ? "上次失败" : lastOk ? "上次成功" : "还没跑过";
      const likeHistoryList = likeHistory.length
        ? h("div", { className: "qbw-list" },
            likeHistory.slice(0, 10).map((l, i) => h("div", { key: `${l.at}|${l.rpid}|${i}`, className: "qbw-item", style: { marginTop: "4px" } },
              h("div", { className: "qbw-label" },
                h("span", { className: "qbw-badge ok" }, l.kind === "reply" ? "楼中楼" : "楼层"),
                h("b", null, l.uname ? `@${l.uname}` : "（旧记录，未存昵称）"),
                l.bvid ? h("a", { href: `https://www.bilibili.com/video/${l.bvid}`, target: "_blank", rel: "noreferrer" }, l.bvid) : null),
              h("div", { className: "qbw-hint" },
                l.message ? `「${String(l.message).slice(0, 80)}」` : "（没有评论正文）",
                ` · rpid ${l.rpid ?? "?"}`,
                l.legacy ? " · ⚠️ 旧版只存了 rpid/时间，昵称缺失" : ""),
              h("span", { className: "qbw-hint", style: { whiteSpace: "nowrap" } }, fmtTime(l.at)))))
        : h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
            "她成功点赞后，这里会显示给谁点的、哪条视频、评论内容；dry-run 不记录。");
      return h("div", { className: "qbw-card", style: { margin: "0 0 10px" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "10px", alignItems: "flex-start", flexWrap: "wrap" } },
          h("div", null,
            h("h4", { style: { margin: 0 } }, "鱼群保护 · 运行状态",
              data ? h("span", { className: "qbw-badge " + badge }, badgeText) : null),
            h("p", { style: { marginTop: "4px" } },
              data?.character ? `当前角色：${data.character.name}（${data.character.id}）` : "当前角色：读取中…",
              " · 记录在 ", h("code", { className: "qbw-code" }, "fish-guard.json"))),
          h("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
            h(Btn, { kind: "qbw-btn2", onClick: fixPermission, disabled: !!busy || permBusy }, permBusy ? "修复中…" : "修复会话权限"),
            h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, "刷新状态"))),
        err ? h("div", { className: "qbw-err", style: { marginTop: "6px" } }, err) : null,
        fg ? h("div", { style: { marginTop: "6px" } },
          h("div", { className: "qbw-kv" }, h("span", null, "今天点赞"), h("span", null, `${fg.dailyLikes ?? 0} / ${fg.maxLikesPerDay ?? "?"} 条`)),
          h("div", { className: "qbw-kv" }, h("span", null, "累计成功 / 失败缓存"), h("span", null, `${fg.likedCount ?? 0} 条 / ${fg.failedCount ?? 0} 条`)),
          h("div", { className: "qbw-kv" }, h("span", null, "登录态"), h("span", null, data.credentials ? "cookie 已配置 ✓" : "缺 cookie —— 取评论会只剩 0~3 条，点赞目标会很少")),
          permMsg ? h("div", { className: permMsg.startsWith("✓") ? "qbw-ok" : "qbw-err", style: { marginTop: "4px" } }, permMsg) : null,
          last ? h("div", { className: "qbw-kv" }, h("span", null, "上次点赞"),
            h("span", { className: lastOk ? "qbw-ok" : lastSkipped ? "qbw-hint" : "qbw-err" },
              lastSkipped
                ? `跳过（${last.skipped[0] ?? "没有目标"}） · ${fmtTime(last.at)}`
                : `${lastOk ? "✓" : "✗"} 尝试 ${last.attempted} 条 · 成功 ${last.liked} 条 · 失败 ${last.failed.length} 条${last.at ? ` · ${fmtTime(last.at)}` : ""}`)) : h("div", { className: "qbw-kv" }, h("span", null, "上次点赞"), h("span", null, "还没跑过（等下一次评论/深读）")),
          last && last.failed.length ? h("div", { className: "qbw-hint", style: { color: "var(--dsw-alias-state-error-primary)" } },
            last.failed.map((f) => `✗ rpid=${f.rpid} code=${f.code ?? "?"} ${f.message ?? ""}`).join("；")) : null,
          last && last.skipped.length ? h("div", { className: "qbw-hint" }, `上次跳过：${last.skipped.join("；")}`) : null,
          blockedMin > 0 ? h("div", { className: "qbw-warnbox" }, `B站 风控冷却中：到 ${fmtTime(fg.likeBlockedUntil)}（约 ${blockedMin} 分钟后可再点）`) : null,
          h("div", { className: "qbw-group", style: { marginTop: "10px" } },
            "最近鱼群检查",
            h("small", null, records.length ? `最近 ${records.length} 条 / 共 ${fg.checkCount ?? records.length} 条` : "还没有记录")),
          records.length ? h("div", { className: "qbw-list" },
            records.slice(0, 6).map((r, i) => {
              const status = r.source === "like"
                ? (r.flooded ? "鱼太多 · 只点赞" : r.likeTargets ? "有鱼 · 可点赞" : "没有鱼 · 不点赞")
                : r.flooded
                  ? (r.gather ? (r.gatherFallback ? "鱼太多 · 强制聚拢" : "鱼太多 · 聚拢到鱼楼") : "鱼太多 · 不发新楼层")
                  : "可发新楼层";
              const cls = r.flooded ? "warn" : r.gather ? "ok" : "";
              return h("div", { key: `${r.at}|${i}`, className: "qbw-item", style: { marginTop: "4px" } },
                h("div", null,
                  h("div", { className: "qbw-label" },
                    h("span", { className: "qbw-badge " + cls }, status),
                    r.bvid ? h("a", { href: `https://www.bilibili.com/video/${r.bvid}`, target: "_blank", rel: "noreferrer" }, r.bvid) : (r.oid ? `oid ${r.oid}` : "—"),
                    h("span", { className: "qbw-badge" }, r.source === "like" ? "点赞检查" : "评论检查")),
                  h("div", { className: "qbw-hint" },
                    `鱼楼层 ${r.fishTopLevel ?? 0} 条 / ${r.fishMids ?? 0} 个鱼账号 · 占比 ${Math.round((r.fishRatio || 0) * 100)}% · 样本 ${r.totalSample ?? 0} 条`,
                    r.gather ? ` · ${r.source === "like" || !r.flooded ? "聚拢候选" : "聚拢到"} ${r.gather.uname || r.gather.rpid}${r.gatherFallback ? "（强制）" : ""}` : "",
                    r.likeTargets ? ` · 可点赞 ${r.likeTargets} 条` : "",
                    r.loggedIn === false ? " · ⚠️ 未带登录态" : "")),
                h("span", { className: "qbw-hint", style: { whiteSpace: "nowrap" } }, fmtTime(r.at)));
            })) : h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
              "还没有检查记录。她下一次 auto 评论 / 独立点赞时会记一笔（鱼太多没发也会记）。"),
          h("div", { className: "qbw-group", style: { marginTop: "10px" } },
            "点赞历史",
            h("small", null, likeHistory.length ? `最近 ${Math.min(likeHistory.length, 10)} 条 / 共 ${fg.likedCount ?? likeHistory.length} 个赞` : "还没有成功点赞记录")),
          likeHistoryList,
          h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
            "点赞只在「她自己决定评论」或单独跑 fish-guard like 时触发；失败原因会写进这里，不再只显示一个「没反应」。"))
          : h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, "读取中…"));
    }

    // ── 观看历史（B站页之外的单页）────────────────────────────────────────
    // 数据来源：debrief / watch-video 写入的 watch-history.jsonl；
    // 旧角色没有历史文件时，自动从 bili-memory.json 补出「看过」的视频。
    function WatchTab({ busy, setBusy, toast, goTab }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const [q, setQ] = useState("");
      const [expandedRows, setExpandedRows] = useState(() => new Set());
      const load = useCallback(async () => {
        setBusy("watch-load");
        try { setData(await api("/watch-history?limit=300")); setErr(""); }
        catch (e) { setErr(e.message); }
        finally { setBusy(""); }
      }, [setBusy]);
      useEffect(() => { load(); }, [load]);
      const items = useMemo(() => {
        const all = Array.isArray(data?.items) ? data.items : [];
        const query = q.trim().toLowerCase();
        if (!query) return all;
        return all.filter((x) => `${x.title} ${x.up} ${x.bvid}`.toLowerCase().includes(query));
      }, [data, q]);
      const stats = data?.stats ?? {};
      const fmtDur = (sec) => {
        const n = Number(sec) || 0;
        if (!n) return "—";
        return n >= 3600 ? `${Math.floor(n / 3600)}:${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
      };
      const modeText = (item) => item.mode === "memory" ? "旧记忆" : item.mode === "full" ? (item.frames ? "深看 · 有截图" : "深看") : item.mode === "frames" ? "抽帧" : "浅看";
      const timeText = (item) => {
        if (item.unknownDate) return "日期未知";
        if (item.dateOnly) return `${new Date(item.at).toLocaleDateString("zh-CN")}（旧记忆）`;
        return fmtTime(item.at);
      };
      const actions = data?.actions ?? {};
      const actionsReady = Boolean(data && data.actions);
      const badgeOf = (kind) => kind === "gather" ? "warn" : (kind === "ta" || kind === "share" ? "ok" : "");
      const toggleRow = (key) => setExpandedRows((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      const actionCell = (item, rowKey) => {
        if (!actionsReady) return h("span", { className: "qbw-hint" }, "—");
        const list = Array.isArray(item.actions) ? item.actions : [];
        if (!list.length) return h("span", { className: "qbw-hint" }, "仅看了");
        const expanded = expandedRows.has(rowKey);
        const shown = expanded ? list : list.slice(0, 3);
        const rest = list.length - shown.length;
        return h("div", { className: "qbw-list", style: { gap: "3px" } },
          shown.map((action, index) => h("div", {
            key: `${action.kind}|${action.at}|${index}`,
            style: { display: "flex", gap: "6px", alignItems: "baseline", flexWrap: "wrap" },
          },
            h("span", { className: "qbw-badge " + badgeOf(action.kind) }, action.label),
            action.text ? h("span", { className: "qbw-hint", style: { maxWidth: "240px" } }, action.text) : null,
            h("span", { className: "qbw-hint", style: { opacity: 0.7 } }, fmtTime(action.at).slice(5, 16)),
            action.beforeFirstWatch ? h("span", { className: "qbw-hint", style: { opacity: 0.55 } }, "早于本地观看") : null)),
          rest > 0 ? h(Btn, { kind: "qbw-btn2", onClick: () => toggleRow(rowKey), style: { padding: "0 6px", fontSize: "10.5px" } }, `展开 +${rest}`) : null,
          expanded && list.length > 3 ? h(Btn, { kind: "qbw-btn2", onClick: () => toggleRow(rowKey), style: { padding: "0 6px", fontSize: "10.5px" } }, "收起") : null);
      };
      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "这里是她**真正看过**的视频历史（按当前角色隔离）：每次 ", h("code", { className: "qbw-code" }, "debrief"),
          " / ", h("code", { className: "qbw-code" }, "watch-video"), " 都会自动记一笔；",
          "「操作」列来自评论记账 + 收藏 + 动态（旧评论只存前 40 字预览；聚拢回复会标「鱼群保护」）。",
          "旧角色没有历史文件时，会从 B站 记忆里补出「看过」的视频。文件：", h("code", { className: "qbw-code" }, "watch-history.jsonl")),
        h("div", { className: "qbw-grid", style: { marginTop: "10px" } },
          h("div", { className: "qbw-card" }, h("h4", null, "今天"), h("div", { className: "qbw-meter-head" }, h("b", null, stats.today ?? 0), h("span", { className: "qbw-hint" }, "条"))),
          h("div", { className: "qbw-card" }, h("h4", null, "最近 7 天"), h("div", { className: "qbw-meter-head" }, h("b", null, stats.last7d ?? 0), h("span", { className: "qbw-hint" }, "条"))),
          h("div", { className: "qbw-card" }, h("h4", null, "深看 / 抽帧"), h("div", { className: "qbw-meter-head" }, h("b", null, stats.deep ?? 0), h("span", { className: "qbw-hint" }, "条"))),
          h("div", { className: "qbw-card" }, h("h4", null, "不同视频"), h("div", { className: "qbw-meter-head" }, h("b", null, stats.uniqueVideos ?? 0), h("span", { className: "qbw-hint" }, stats.backfilled ? `其中 ${stats.backfilled} 条来自旧记忆` : "条")))),
        h("div", { className: "qbw-search", style: { marginTop: "12px" } },
          h("input", { className: "qbw-input", placeholder: "搜标题 / UP / BV", value: q, onChange: (e) => setQ(e.target.value) }),
          h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, busy === "watch-load" ? "刷新中…" : "刷新"),
          h(Btn, { kind: "qbw-btn2", onClick: () => goTab?.("bili"), disabled: !!busy }, "去 B站 页")),
        data && actionsReady ? h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
          `操作（已关联观看）：评论 ${actions.comments ?? 0} 条（主评论 ${actions.main ?? 0} · 聚拢 ${actions.gather ?? 0} · 回复 ${actions.reply ?? 0} · 搭话 ${actions.ta ?? 0} · 分享 ${actions.share ?? 0}）`,
          ` · 收藏 ${actions.favorite ?? 0} · 发动态 ${actions.dynamic ?? 0} · 仅看 ${actions.watchedOnly ?? 0} 条`) : null,
        data && !actionsReady ? h("div", { className: "qbw-warnbox" },
          "操作列需要新版宿主：当前 DSH 还是旧代码（接口没返回 actions）。重启 DSH 或重载 surfcore 后再刷新本页。") : null,
        err ? h("div", { className: "qbw-err", style: { margin: "8px 0" } }, `✗ ${err}`) : null,
        !data && !err ? h("div", { className: "qbw-hint", style: { padding: "20px 0" } }, "读取观看历史…") : null,
        data && items.length === 0 ? h("div", { className: "qbw-card", style: { marginTop: "10px" } },
          h("div", { className: "qbw-hint" }, q ? "没有匹配的记录。" : "还没有观看记录。下一次 debrief / watch-video 会自动记一笔；旧数据会在读取时从 B站 记忆补出来。")) : null,
        items.length ? h("div", { className: "qbw-scroll", style: { maxHeight: "420px", marginTop: "10px" } },
          h("table", { className: "qbw-table" },
            h("thead", null, h("tr", null,
              h("th", null, "时间"), h("th", null, "视频"), h("th", null, "UP"), h("th", null, "时长"), h("th", null, "读法"), h("th", null, "评分"), h("th", null, "操作"))),
            h("tbody", null, items.map((item, i) => {
              const rowKey = `${item.bvid}|${item.at}|${i}`;
              return h("tr", { key: rowKey },
                h("td", { style: { whiteSpace: "nowrap", color: "var(--dsw-alias-label-tertiary)" } }, timeText(item)),
                h("td", null,
                  item.bvid
                    ? h("a", { href: `https://www.bilibili.com/video/${item.bvid}`, target: "_blank", rel: "noreferrer" }, item.title || item.bvid)
                    : (item.title || "（无标题）"),
                  item.bvid && item.title ? h("div", { className: "qbw-hint" }, item.bvid) : null),
                h("td", null, item.up || "—"),
                h("td", { style: { whiteSpace: "nowrap" } }, fmtDur(item.duration)),
                h("td", { style: { whiteSpace: "nowrap" } }, h("span", { className: "qbw-badge " + (item.mode === "full" || item.mode === "frames" ? "ok" : "") }, modeText(item))),
                h("td", { style: { whiteSpace: "nowrap" } }, item.score == null ? "—" : `${item.score}/20`),
                h("td", { style: { minWidth: "220px" } }, actionCell(item, rowKey)));
            })))) : null,
        data ? h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
          `共 ${data.total ?? items.length} 条${q ? `（过滤后 ${items.length} 条）` : ""} · 数据文件 ${data.file || "—"}`) : null);
    }

    // ── B站 扫码登录（鱼 / 主人）────────────────────────────────────────────
    // 用宿主启动 Edge headless 打开官方登录页，把页面里的二维码取出来显示给用户；
    // 扫码成功后宿主只保存 cookie（鱼写 credentials.json，主人写 owner-credentials.json），
    // 客户端永远拿不到 cookie，只拿到 mid/昵称。
    function BiliQrModal({ target = "owner", onClose, onConfirmed }) {
      const [state, setState] = useState({ phase: "starting" });
      const [allowSameAsOwner, setAllowSameAsOwner] = useState(false);
      const [notice, setNotice] = useState("");
      const idRef = useRef("");
      const confirmedRef = useRef(onConfirmed);
      useEffect(() => { confirmedRef.current = onConfirmed; }, [onConfirmed]);

      const start = useCallback(async () => {
        idRef.current = "";
        setState({ phase: "starting" });
        try {
          const result = await api("/bili/qr/start", { method: "POST", body: { target, allowSameAsOwner } });
          if (!result?.id || !result?.image) throw new Error(result?.error || "没有拿到二维码");
          idRef.current = result.id;
          setState({ phase: "waiting", id: result.id, image: result.image, expected: result.expected ?? {} });
        } catch (e) {
          const message = String(e?.message ?? e);
          setState({
            phase: "error",
            error: (message.includes("未知接口") || message.includes("只支持 GET/POST"))
              ? `${message}（宿主插件还是旧代码：重启 DSH 或重载 surfcore 后这个接口才注册）`
              : message,
          });
        }
      }, [target, allowSameAsOwner]);

      useEffect(() => { start(); }, [start]);

      useEffect(() => {
        const id = state.id;
        if (!id || (state.phase !== "waiting" && state.phase !== "scanned")) return undefined;
        let stopped = false;
        const timer = setInterval(async () => {
          try {
            const result = await api(`/bili/qr/poll?id=${encodeURIComponent(id)}`);
            if (stopped) return;
            if (result.status === "confirmed") {
              stopped = true; clearInterval(timer); idRef.current = "";
              confirmedRef.current?.(result.account, target);
            } else if (result.status === "scanned") {
              setState((s) => ({ ...s, phase: "scanned" }));
            } else if (result.status === "expired") {
              stopped = true; clearInterval(timer); idRef.current = "";
              setState({ phase: "expired" });
            } else if (result.status === "wrong-account") {
              stopped = true; clearInterval(timer); idRef.current = "";
              setState({ phase: "wrong", error: result.error, account: result.account, expected: result.expected });
            } else if (result.status === "failed") {
              stopped = true; clearInterval(timer); idRef.current = "";
              setState({ phase: "error", error: result.error });
            }
          } catch { /* 网络抖动继续轮询；二维码过期会被宿主判 expired */ }
        }, 1500);
        return () => { stopped = true; clearInterval(timer); };
      }, [state.id, state.phase, target]);

      useEffect(() => () => {
        const id = idRef.current;
        idRef.current = "";
        if (id) api("/bili/qr/cancel", { method: "POST", body: { id } }).catch(() => {});
      }, []);

      const close = async () => {
        const id = idRef.current;
        idRef.current = "";
        if (id) await api("/bili/qr/cancel", { method: "POST", body: { id } }).catch(() => {});
        onClose?.();
      };

      const title = target === "fish" ? "扫码绑定小肥鱼的 B站 账号" : "扫码登录主人的 B站 账号";
      const live = state.phase === "waiting" || state.phase === "scanned";
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) close(); } },
        h("div", { className: "qbw-modal", style: { maxWidth: "430px" } },
          h("h3", null, title),
          state.phase === "starting" ? h("p", { className: "qbw-hint" }, "正在打开 B站 登录页并取二维码…（约 5~10 秒）") : null,
          live ? h("div", null,
            h("img", {
              src: state.image, alt: "B站登录二维码",
              style: { width: "220px", height: "220px", imageRendering: "pixelated", display: "block", margin: "12px auto", background: "#fff", padding: "10px", borderRadius: "10px" },
            }),
            h("p", { className: "qbw-hint", style: { textAlign: "center" } },
              state.phase === "scanned" ? "已扫码，请在手机上确认登录" : "打开 B站 App → 扫一扫 → 确认登录"),
            h("p", { className: "qbw-hint", style: { textAlign: "center" } },
              target === "owner"
                ? "只保存 cookie 用来读取偏好；不会用主人号发评论/动态。"
                : "绑定后她会用这个号看视频、评论、发动态。"),
            state.expected?.mid ? h("p", { className: "qbw-hint", style: { textAlign: "center" } }, `期望账号：${state.expected.name || (target === "fish" ? "小肥鱼" : "主人")}（${state.expected.mid}）；扫错号会被拒绝。`) : null,
            target === "fish" ? h("label", { className: "qbw-hint", style: { display: "flex", gap: "6px", alignItems: "center", justifyContent: "center", marginTop: "8px" } },
              h("input", { type: "checkbox", checked: allowSameAsOwner, onChange: (e) => setAllowSameAsOwner(e.target.checked) }),
              "我只有一个 B站 号（主人=小肥鱼），允许用主人号当小肥鱼") : null) : null,
          state.phase === "expired" ? h("p", { className: "qbw-err" }, "二维码已过期，请重新生成。") : null,
          state.phase === "wrong" ? h("div", null,
            h("p", { className: "qbw-err" }, `✗ ${state.error || "扫错账号"}`),
            h("p", { className: "qbw-hint" }, "扫错号不会保存。要点：① 想用主人同一个号 → 勾下方「我只有一个 B站 号」再扫；② 想换到别的号 → 点下面「换号（清除旧凭据）」再扫。"),
            h("p", { className: "qbw-hint" }, state.hint || "")) : null,
          state.phase === "error" ? h("p", { className: "qbw-err" }, `✗ ${state.error || "扫码失败"}`) : null,
          notice ? h("p", { className: "qbw-hint", style: { textAlign: "center" } }, notice) : null,
          h("div", { className: "qbw-actions", style: { justifyContent: "center" } },
            live ? null : h(Btn, { onClick: start }, "重新生成"),
            h(Btn, {
              kind: "qbw-btn2",
              onClick: async () => {
                try {
                  const r = await api("/bili/account/reset", { method: "POST", body: { target } });
                  setNotice(`✓ 已清除旧凭据并归档 ${r.archived?.length ?? 0} 个文件；点「重新生成」扫新号即可。`);
                } catch (e) { setNotice(`✗ ${e.message}`); }
              },
            }, "换号（清除旧凭据）"),
            h(Btn, { kind: "qbw-btn2", onClick: close }, "取消"))));
    }

    // ── 口味权重 / 一键抓取 ─────────────────────────────────────────────────
    // 用户反馈（2026-10-23）：小肥鱼总盯着一两个偏好，而且新用户不知道「爱看」填什么。
    // 这个组件做两件事：① 每个偏好一个 0~5 的权重；② 从用户自己的 B站 数据里抓候选词，
    // 勾选后填进「爱看」（不自动保存，仍走底部「保存」）。
    function TasteEditor({ cfg, set, toast }) {
      const [newWord, setNewWord] = useState("");
      const [scan, setScan] = useState(null);
      const [scanErr, setScanErr] = useState("");
      const [scanning, setScanning] = useState(false);
      const [picked, setPicked] = useState([]);
      const [target, setTarget] = useState("owner");
      const [qrTarget, setQrTarget] = useState("");
      const [accounts, setAccounts] = useState(null);
      useEffect(() => {
        api("/bili/accounts").then(setAccounts).catch(() => { /* 旧宿主没有这个接口 */ });
      }, []);
      const prefs = cfg?.preferences ?? {};
      const like = Array.isArray(prefs.like) ? prefs.like : [];
      const extras = Array.isArray(prefs.keywords) ? prefs.keywords : [];
      const weights = prefs.weights && typeof prefs.weights === "object" && !Array.isArray(prefs.weights) ? prefs.weights : {};
      const weightOf = (label) => {
        const value = Number(weights[label]);
        return Number.isFinite(value) ? value : 1;
      };
      const setWeight = (label, value) => {
        const next = Math.max(0, Math.min(5, Number(value) || 0));
        set(["preferences", "weights"], { ...weights, [label]: Math.round(next * 100) / 100 });
      };
      const removeWord = (label, kind) => {
        const list = kind === "extra" ? extras : like;
        set(["preferences", kind === "extra" ? "keywords" : "like"], list.filter((word) => word !== label));
        const next = { ...weights };
        delete next[label];
        set(["preferences", "weights"], next);
      };
      const addWord = () => {
        const word = newWord.replace(/\s+/g, " ").trim();
        if (!word) return;
        const exists = [...like, ...extras].some((item) => String(item).toLowerCase() === word.toLowerCase());
        if (!exists) set(["preferences", "like"], [...like, word]);
        setNewWord("");
      };
      const runScan = async () => {
        setScanning(true); setScanErr("");
        try {
          const result = await api(`/preferences/scan?sources=history,favorites,local&limit=24&target=${target}`);
          if (result?.ok === false) throw new Error(result.error || "扫描失败");
          // 旧宿主不认 target 会直接按鱼扫；不能把鱼的结果冒充主人，宁可让用户重载插件。
          if (target !== "fish" && result.target !== target) {
            setScan(null);
            setScanErr("宿主插件还是旧代码（不认「抓取主人/两者」）：重启 DSH 或重载 surfcore 后再抓。");
            return;
          }
          if (result.ownerLoginRequired) { setScan(null); setQrTarget("owner"); return; }
          const fishMissing = (result.sources ?? []).some((item) => item.name === "fish-credential");
          if (fishMissing) { setScan(null); setQrTarget("fish"); return; }
          setScan(result); setPicked([]);
        } catch (e) {
          const message = String(e?.message ?? e);
          setScanErr(message.includes("未知接口") ? `${message}（宿主插件还是旧代码：重启 DSH 或重载 surfcore 后这个接口才注册）` : message);
        }
        finally { setScanning(false); }
      };
      const onQrConfirmed = (account, role) => {
        setQrTarget("");
        setAccounts((prev) => ({
          ...(prev ?? {}),
          [role]: { configured: true, mid: account.mid, name: account.name, savedAt: account.savedAt },
        }));
        toast(`✓ 已登录 ${account.name || account.mid}（${account.mid}）`);
        setTimeout(() => { runScan(); }, 250);
      };
      const exists = (keyword) => [...like, ...extras].some((item) => String(item).toLowerCase() === String(keyword).toLowerCase());
      const candidates = Array.isArray(scan?.candidates) ? scan.candidates : [];
      // 大小写重复的关键词（DeepSeek / Deepseek / deepseek）在选题器里会合并成一条，
      // 但设置页仍会显示三行；提前说清楚，免得用户以为「权重没生效」。
      const duplicateGroups = (() => {
        const map = new Map();
        for (const label of [...like, ...extras]) {
          const key = String(label).toLowerCase();
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(label);
        }
        return [...map.values()].filter((group) => group.length > 1);
      })();
      const toggle = (keyword) => setPicked((list) => list.includes(keyword) ? list.filter((item) => item !== keyword) : [...list, keyword]);
      const addPicked = () => {
        const add = picked.filter((keyword) => !exists(keyword));
        if (!add.length) { toast("没有可加入的新关键词"); return; }
        set(["preferences", "like"], [...like, ...add]);
        setPicked([]);
        toast(`✓ 已加入 ${add.length} 个关键词（点底部「保存」才生效）`);
      };
      const pickTop = (count) => setPicked(candidates
        .filter((item) => !exists(item.keyword))
        .slice(0, count)
        .map((item) => item.keyword));
      const weightRow = (label, kind) => h("div", { className: "qbw-item", key: `${kind}:${label}` },
        h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
          h("span", { className: "qbw-label" }, label),
          kind === "extra" ? h("span", { className: "qbw-badge" }, "额外关键词") : null,
          h("span", { className: "qbw-hint" }, "权重"),
          h("input", {
            type: "range", min: 0, max: 5, step: 0.5,
            style: { width: "130px" },
            value: weightOf(label),
            onChange: (e) => setWeight(label, e.target.value),
          }),
          h("span", { className: "qbw-hint", style: { minWidth: "34px", display: "inline-block" } }, weightOf(label).toFixed(1)),
          weightOf(label) === 0 ? h("span", { className: "qbw-badge warn" }, "停用") : null),
        h("div", { style: { display: "flex", gap: "6px" } },
          h(Btn, { kind: "qbw-btn2", onClick: () => removeWord(label, kind), title: "删掉这个关键词" }, "×")));
      return h("div", null,
        h("div", { className: "qbw-hint", style: { marginBottom: "6px" } },
          "权重 0 = 停用（不搜、不计分）；1 = 默认；越高，每轮选题分到的条数越多。",
          "所有偏好至少会分到 1 条（条数不够时按权重抽样轮换）。改完点底部「保存」，下一轮醒来生效。"),
        h("div", { className: "qbw-list" }, like.length ? like.map((label) => weightRow(label, "like")) : h("div", { className: "qbw-hint" }, "还没有「爱看」关键词：手动加一个，或点下面「一键抓取」。")),
        extras.length ? h("div", { style: { marginTop: "10px" } },
          h("div", { className: "qbw-hint" }, "额外关键词（只用来扩大搜索，默认权重 0.75，可调）："),
          h("div", { className: "qbw-list", style: { marginTop: "4px" } }, extras.map((label) => weightRow(label, "extra")))) : null,
        duplicateGroups.length ? h("div", { className: "qbw-warnbox" },
          "检测到 ", duplicateGroups.length, " 组大小写重复（",
          duplicateGroups.map((group) => group.join(" / ")).join("；"),
          "）：选题器会按同一条合并计分，想省事可以删掉多余的。") : null,
        h("div", { className: "qbw-actions", style: { marginTop: "10px" } },
          h("input", { className: "qbw-input", placeholder: "新关键词（如：猫咪 / 异环 / 手书）", value: newWord, onChange: (e) => setNewWord(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") addWord(); } }),
          h(Btn, { kind: "qbw-btn2", onClick: addWord, disabled: !newWord.trim() }, "+ 加到爱看"),
          h("select", { className: "qbw-select", value: target, onChange: (e) => setTarget(e.target.value), title: "抓谁的口味" },
            h("option", { value: "owner" }, "抓取主人"),
            h("option", { value: "fish" }, "抓取小肥鱼"),
            h("option", { value: "both" }, "两者都抓")),
          h(Btn, { onClick: runScan, disabled: scanning }, scanning ? "抓取中…" : "一键抓取我的偏好")),
        accounts ? h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
          "主人账号：", accounts.owner?.configured ? `${accounts.owner.name || "（未取到昵称）"}（${accounts.owner.mid}）已扫码登录` : "未登录（点抓取会弹二维码）",
          " · 小肥鱼：", accounts.fish?.configured ? `${accounts.fish.name || "（未取到昵称）"}（${accounts.fish.mid}）已绑定` : "未绑定（B站 页可扫码）") : null,
        h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
          "抓取是只读的：读当前选中账号的观看历史 / 收藏夹 + 本地观看记录；不读浏览器登录的账号、不读 QQ 聊天、不点赞、不改账号。",
          "抓主人需要先用主人的 B站 App 扫二维码；扫错号会被拒绝。"),
        scanErr ? h("div", { className: "qbw-err", style: { marginTop: "6px" } }, `✗ ${scanErr}`) : null,
        scan ? h("div", { style: { marginTop: "8px" } },
          (scan.accounts ?? []).length ? h("div", { className: "qbw-hint" },
            `抓取账号：${(scan.accounts ?? []).map((item) => `${item.role === "owner" ? "主人" : "小肥鱼"} ${item.name || item.mid}（${item.mid}）`).join(" · ")}`) : null,
          h("div", { className: "qbw-hint" }, `来源：${(scan.sources ?? []).map((item) => `${item.ok ? "✓" : "✗"} ${item.name}${item.items != null ? `（${item.items}）` : ""}${item.error ? ` ${item.error}` : ""}`).join(" · ")}`),
          candidates.length ? h("div", { className: "qbw-chips" }, candidates.map((item) => {
            const already = exists(item.keyword);
            return h("button", {
              key: item.key, type: "button",
              className: "qbw-chip" + (picked.includes(item.keyword) ? " on" : ""),
              title: `命中 ${item.count} 次 · ${(item.sources ?? []).join("/")}${item.samples?.length ? `\n例：${item.samples.join("\n例：")}` : ""}`,
              disabled: already,
              onClick: () => toggle(item.keyword),
            }, `${item.keyword}`, h("span", { className: "qbw-badge" }, already ? "已有" : String(item.count)));
          })) : h("div", { className: "qbw-hint" }, "没抓到候选：可能是观看记录太少，或候选都已包含在现有偏好里。"),
          candidates.length ? h("div", { className: "qbw-actions", style: { marginTop: "8px" } },
            h(Btn, { onClick: addPicked, disabled: !picked.length }, `加入爱看（${picked.length}）`),
            h(Btn, { kind: "qbw-btn2", onClick: () => pickTop(6), disabled: !candidates.length }, "选前 6 个"),
            h(Btn, { kind: "qbw-btn2", onClick: () => setPicked([]), disabled: !picked.length }, "清空选择"),
            h("span", { className: "qbw-hint" }, "加入后仍要点底部「保存」")) : null) : null,
        qrTarget ? h(BiliQrModal, {
          target: qrTarget,
          onClose: () => setQrTarget(""),
          onConfirmed: onQrConfirmed,
        }) : null);
    }

    function BiliTab({ cfg, set, qq, setQqPath, admin, setAdmin, unified, setUnified, qqPrivate, qqAllowAll, overview, busy, setBusy, toast, reload }) {
      const [query, setQuery] = useState("");
      const [cookie, setCookie] = useState({ sessdata: "", bili_jct: "", buvid3: "" });
      const [cookieMsg, setCookieMsg] = useState("");
      const [qrFish, setQrFish] = useState(false);
      const [deps, setDeps] = useState("");
      const [pending, setPending] = useState([]);
      const [pendingMsg, setPendingMsg] = useState("");
      const [automation, setAutomation] = useState(null);
      const bili = overview?.bili ?? {};

      const loadAutomation = useCallback(async () => {
        try { setAutomation(await api("/bili/automation")); }
        catch (e) { setAutomation({ ok: false, error: String(e?.message ?? e) }); }
      }, []);
      useEffect(() => { loadAutomation(); }, [loadAutomation]);

      const loadPending = useCallback(async () => {
        try { const r = await api("/bili/pending"); setPending(r.items ?? []); } catch {}
      }, []);
      useEffect(() => { loadPending(); }, [loadPending]);

      const groups = query.trim()
        ? BILI_FIELDS.map((g) => ({ ...g, fields: g.fields.filter((f) => `${g.group} ${f.label} ${f.hint ?? ""} ${f.path.join(".")}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter((g) => g.fields.length)
        : BILI_FIELDS;
      const runDeps = async () => {
        setBusy("deps"); setDeps("检查中…");
        try {
          const r = await api("/bili/deps");
          const lines = (r.items ?? []).map((i) => `${i.ok ? "✓" : "✗"} ${i.name} — ${i.detail ?? ""}`);
          if (r.self) lines.push("", `她自己：${r.self.name}（mid ${r.self.mid}）✓`);
          setDeps([...lines, "", r.ok ? "全部可用 ✓" : "有项不可用 ✗"].join("\n"));
          await reload();
        } catch (e) { setDeps(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const saveCookie = async () => {
        setBusy("cookie"); setCookieMsg("");
        try {
          const r = await api("/bili/cookie", { method: "POST", body: { action: "cookie", ...cookie } });
          setCookieMsg(`✓ ${r.detail ?? "已写入"}`);
          setCookie({ sessdata: "", bili_jct: "", buvid3: "" });
          await reload();
        } catch (e) { setCookieMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const testNotify = async () => {
        setBusy("notify");
        try { const r = await api("/bili/notify-config"); const t = await api("/bili/notify", { method: "POST", body: { action: "notify-test" } }); setDeps(`${r.notify?.type ?? "?"} 测试：\n${t.out || ""}${t.err ? "\n" + t.err : ""}`); }
        catch (e) { setDeps(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const pendingAct = async (action, id) => {
        setBusy(action + id); setPendingMsg("");
        try {
          const r = await api("/bili/pending", { method: "POST", body: { action, id } });
          setPendingMsg(r.ok ? "✓ 完成" : `✗ ${r.error ?? r.err ?? "失败"}`);
          await loadPending();
        } catch (e) { setPendingMsg(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      return h("div", null,
        h(PlatformStartCard, {
          platform: "bili",
          hint: "开 = DSH 启动时自动运行 B站 生物钟，并纳入「一键启动」；关 = 生物钟不自动跑、也不参与一键启动（保存后会停掉当前生物钟）。B站→QQ 的定时分享/记忆是桥接里的独立任务，由下面的「定时分享视频到群」和 QQ 侧「启用 B站 桥接」控制。",
          enabled: unified?.platforms?.start?.bili !== false,
          onChange: (value) => setUnified(["platforms", "start", "bili"], value),
          running: Boolean(overview?.scheduler?.running),
          overview,
        }),
        h(AdminCard, { admin, onChange: setAdmin, qqPrivate, qqAllowAll }),
        h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
          h("h4", null, "B站 账号"),
          h("div", { className: "qbw-kv" }, h("span", null, "登录态"), h("span", null, bili.available ? `记忆已生成 · ${bili.briefChars ?? 0} 字` : "暂无记忆（先扫码登录）")),
          h("div", { className: "qbw-kv" }, h("span", null, "隐私复检"), h("span", null, bili.blocked ? "命中拦截" : "通过")),
          h("p", null, "推荐扫码登录小肥鱼（用 B站 App 扫一扫）；手动粘贴 cookie 和待审核队列在「高级设置」里。"),
          h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "6px", paddingTop: "0" } },
            h(Btn, { onClick: () => setQrFish(true), disabled: !!busy }, "扫码登录小肥鱼"))),
        h(QqShareSection, { qq, set: setQqPath, data: automation, busy, setBusy, toast }),
        h(Section, { title: "作息窗口", note: "C 模式：每个窗口至少 1 次；全天上限见「每天最多醒来」，剩余次数按该时段最近评分分配，相邻两次至少隔「最小间隔」", defaultOpen: true },
          h("div", { style: { padding: "6px 0" } }, h(WindowsEditor, { value: cfg?.night?.windows, onChange: (v) => set(["night", "windows"], v) }))),
        h(AdvancedSettings, { note: "凭据 / 鱼群状态 / 口味权重 / 待审核 / 全部 B站 参数：展开后同样可改" },
          h(FishGuardStatusCard, { busy, toast }),
          h(AutomationCard, { data: automation, onRefresh: loadAutomation, busy }),
          h("div", { className: "qbw-search" },
            h("input", { className: "qbw-input", placeholder: "搜索 B站 参数", value: query, onChange: (e) => setQuery(e.target.value) }),
            h(Btn, { kind: "qbw-btn2", onClick: runDeps, disabled: !!busy }, busy === "deps" ? "体检中…" : "依赖体检"),
            h(Btn, { kind: "qbw-btn2", onClick: testNotify, disabled: !!busy }, "发条通知测试")),
          h("div", { className: "qbw-infobox" },
            "B站参数写入 ", h("code", { className: "qbw-code" }, "~/.dsh/surfcore/bili.config.json"), "；",
            "cookie 单独写入 ", h("code", { className: "qbw-code" }, "~/.dsh/surfcore/bili/credentials.json"), "，永不回显。",
            "人设卡已合体到「角色」页，这里不再重复一套。"),
          h("div", { className: "qbw-grid" },
            h("div", { className: "qbw-card" }, h("h4", null, "B站状态"),
              h("div", { className: "qbw-kv" }, h("span", null, "记忆"), h("span", null, bili.available ? `${bili.briefChars} 字` : "暂无")),
              h("div", { className: "qbw-kv" }, h("span", null, "生成时间"), h("span", null, fmtTime(bili.generatedAt))),
              h("div", { className: "qbw-actions" }, h(Btn, { kind: "qbw-btn2", onClick: runDeps, disabled: !!busy }, "依赖体检"))),
            h("div", { className: "qbw-card" }, h("h4", null, "手动粘贴凭据（备用）"),
              h("p", null, "只在 Edge 不可用 / 扫码失败时用；平时优先上面的扫码登录。"),
              h("div", { className: "qbw-list" },
                h("input", { className: "qbw-input", placeholder: "SESSDATA", value: cookie.sessdata, onChange: (e) => setCookie((s) => ({ ...s, sessdata: e.target.value })) }),
                h("input", { className: "qbw-input", placeholder: "bili_jct", value: cookie.bili_jct, onChange: (e) => setCookie((s) => ({ ...s, bili_jct: e.target.value })) }),
                h("input", { className: "qbw-input", placeholder: "buvid3（可空）", value: cookie.buvid3, onChange: (e) => setCookie((s) => ({ ...s, buvid3: e.target.value })) }),
                h(Btn, { kind: "qbw-btn2", onClick: saveCookie, disabled: !!busy || !cookie.sessdata || !cookie.bili_jct }, "写入凭据"),
                cookieMsg ? h("div", { className: cookieMsg.startsWith("✓") ? "qbw-ok" : "qbw-err" }, cookieMsg) : null)),
            h("div", { className: "qbw-card" }, h("h4", null, "待审核"),
              h("p", null, "她回复别人之前，草稿先到这儿；你点「发」才发。"),
              pending.length === 0 ? h("p", null, "（队列是空的）") : pending.map((x) => h("div", { key: x.id, className: "qbw-item", style: { marginTop: "6px" } },
                h("div", null,
                  h("div", { className: "qbw-label" }, `→ ${x.who || "对方"}`, h("span", { className: "qbw-badge" }, String(x.at ?? "").slice(5, 16).replace("T", " "))),
                  x.src ? h("div", { className: "qbw-hint" }, `他说：${String(x.src).slice(0, 80)}`) : null,
                  h("div", { className: "qbw-hint", style: { color: "var(--dsw-alias-label-primary)" } }, `你要回：${x.message}`)),
                h("div", { style: { display: "flex", gap: "6px" } },
                  h(Btn, { onClick: () => pendingAct("pending-approve", x.id), disabled: !!busy }, "发"),
                  h(Btn, { kind: "qbw-btn2", onClick: () => pendingAct("pending-reject", x.id), disabled: !!busy }, "删")))),
              pendingMsg ? h("div", { className: pendingMsg.startsWith("✓") ? "qbw-ok" : "qbw-err" }, pendingMsg) : null,
              h("div", { className: "qbw-actions" }, h(Btn, { kind: "qbw-btn2", onClick: loadPending, disabled: !!busy }, "刷新待审")))),
          query.trim() ? null : h(Section, { title: "口味权重 / 一键抓取", note: "每个偏好 0~5 权重；也能从你的 B站 观看历史/收藏夹里抓候选词", collapsible: false },
            h("div", { style: { padding: "6px 0" } }, h(TasteEditor, { cfg, set, toast }))),
          h(FieldGroups, { groups, cfg, set }),
          deps ? h("div", { className: "qbw-out" }, deps) : null),
        qrFish ? h(BiliQrModal, {
          target: "fish",
          onClose: () => setQrFish(false),
          onConfirmed: async (account) => {
            setQrFish(false);
            setCookieMsg(`✓ 已绑定 ${account.name || account.mid}（${account.mid}）`);
            await reload();
          },
        }) : null);
    }

    // ── 人格卡编辑器（嵌在「角色」页里，不再单开「人设」标签）──────────────
    // 用户反馈「人设 / 角色」两个栏目重复：角色包和人格卡本来就是同一件事的两面。
    // 现在只有一个「角色」页：上面切角色，下面直接编辑当前角色的人格卡。
    function PersonaEditor({ busy, setBusy, toast, unified, setUnified }) {
      const [data, setData] = useState(null);
      const [text, setText] = useState("");
      const [err, setErr] = useState("");
      const load = useCallback(async () => {
        try { const r = await api("/persona"); setData(r); setText(r.text ?? ""); setErr(""); }
        catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const save = async () => {
        setBusy("persona-save");
        try {
          const r = await api("/persona", { method: "POST", body: { text } });
          toast(`✓ 人格卡已保存（${r.chars} 字）`);
          await load();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const restore = async (name) => {
        setBusy("persona-restore");
        try { const r = await api("/persona", { method: "POST", body: { action: "restore", name } }); setText(r.text ?? ""); toast("✓ 已从备份恢复"); await load(); }
        catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "当前角色的人格卡：", h("code", { className: "qbw-code" }, data?.path ?? "persona"),
          "。QQ 桥接每条消息注入它；B站生物钟每次醒来也注入它。角色包切换时，人格卡跟着角色走。"),
        h(Row, {
          label: "人格卡文件",
          hint: "相对 surfcore 或绝对路径；留空自动发现 roles/*.md。改完点底部「保存」；下面的文本编辑用「保存人格卡」。",
        }, h("input", {
          className: "qbw-input wide",
          value: unified?.persona?.file ?? "",
          onChange: (e) => setUnified(["persona", "file"], e.target.value),
          placeholder: "roles/你的角色.md",
        })),
        h("div", { className: "qbw-group" }, "人格卡内容", data ? h("small", null, `${data.path} · ${data.chars} 字 · ${fmtTime(data.mtime)}`) : null),
        err ? h("div", { className: "qbw-err" }, err) : null,
        h("textarea", { className: "qbw-textarea card", value: text, onChange: (e) => setText(e.target.value), spellCheck: false }),
        h("div", { className: "qbw-actions" },
          h(Btn, { onClick: save, disabled: !!busy }, busy === "persona-save" ? "保存中…" : "保存人格卡"),
          h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, "重新读取"),
          h("span", { className: "qbw-hint" }, "保存即生效；QQ 下一条消息、B站下一次醒来就会用新卡。")),
        data?.backups?.length ? h(Section, { title: "人格卡历史备份", note: `${data.backups.length} 份` },
          data.backups.slice(0, 12).map((b) => h("div", { key: b.name, className: "qbw-item" },
            h("div", null, h("div", { className: "qbw-label" }, b.name), h("div", { className: "qbw-hint" }, `${fmtBytes(b.bytes)} · ${fmtTime(new Date(b.mtime).toISOString())}`)),
            h(Btn, { kind: "qbw-btn2", onClick: () => restore(b.name), disabled: !!busy }, "恢复")))) : null);
    }

    // ── 记忆卡（角色的长期记忆）────────────────────────────────────────────
    // 和下面「双向脱敏同步」分开：那边是 QQ⇄B站 搬运，这边是她自己的记忆 +
    // 清晰度 / 遗忘 / 容量规则。容量 80/90/100% 时主界面还会弹窗提醒。
    function MemoryCardPanel({ data, reload, busy, setBusy, toast, unified, setUnified, onChanged, view = "all" }) {
      const [manual, setManual] = useState({ open: false, text: "", importance: 70, scope: "qq" });
      const [selected, setSelected] = useState([]);
      const [mergeTitle, setMergeTitle] = useState("");
      const [mergePinned, setMergePinned] = useState(true);
      if (!data) return h("div", { className: "qbw-card" }, h("div", { className: "qbw-hint" }, "记忆卡读取中…"));
      const status = data.status ?? {};
      // 关键：表单必须绑到**可编辑的 unified.memoryCard**，不能绑服务端快照 data.config。
      // 旧写法导致输入一个字符后 React 又用旧快照值覆盖 → 输入框看起来完全没反应。
      const config = {
        ...(data.config ?? {}),
        ...(unified?.memoryCard ?? {}),
        injectMaxChars: {
          ...(data.config?.injectMaxChars ?? {}),
          ...(unified?.memoryCard?.injectMaxChars ?? {}),
        },
      };
      const level = Math.max(Number(status.level) || 0, Number(status.alertLevel) || 0);
      const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
      const meterClass = "qbw-meter" + (level >= 2 ? " bad" : level >= 1 ? " warn" : "");
      const needsAttention = level > 0 && level > (Number(status.acknowledgedLevel) || 0);
      const selectedRecords = (data.records ?? []).filter((record) => selected.includes(record.id));
      const selectedHasNonOwner = selectedRecords.some((record) => !record.tags?.includes('owner'));
      const act = async (action, extra = {}) => {
        setBusy(`mc-${action}`);
        try {
          const r = await api("/memory-card", { method: "POST", body: { action, ...extra } });
          toast(action === "maintain" ? `✓ 已整理：新增 QQ ${r.addedQq ?? 0} / 桌宠 ${r.addedPet ?? 0} / B站 ${r.addedBili ?? 0} / 全量归档 ${r.addedFull ?? 0} 条`
            : action === "compact" ? `✓ 已压缩（降级 ${r.steps ?? 0} 档）`
              : action === "merge-memories" ? `✓ 已合并 ${r.merged ?? 0} 条为一个事件`
                : action === "set-first-meet" ? `✓ 已设为初次相遇（${r.merged ?? 1} 条）`
                  : (item.staged ? "✓ 已下载，退出 DSH 后自动应用" : "✓ 已更新"));
          await reload();
          onChanged?.();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const pin = (record) => act("pin", { id: record.id, pinned: !record.pinned });
      const forget = (record) => {
        if (!confirm(`确定忘掉「${record.title || record.text.slice(0, 20)}」？这是不可逆的（会先备份整张卡）。`)) return;
        act("forget", { id: record.id });
      };
      const toggleSelect = (id) => setSelected((list) => list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
      const setFirstMeet = async () => {
        if (!selected.length) { toast("✗ 先勾选至少一条和主人的互动"); return; }
        const msg = selected.length > 1
          ? `把选中的 ${selected.length} 条合并成一个「和主人的初次相遇」事件？原记录会从衰减卡移除，但全量卡已保留。`
          : "把这条设为和主人的初次相遇？";
        if (!confirm(msg)) return;
        await act("set-first-meet", { ids: selected });
        setSelected([]);
      };
      const clearFirstMeet = async () => {
        if (!confirm("取消手动指定的初次相遇，恢复为“最早一条主人互动”？")) return;
        await act("clear-first-meet");
        setSelected([]);
      };
      const mergeSelected = async () => {
        if (selected.length < 2) { toast("✗ 至少选 2 条记忆才能合并成事件"); return; }
        if (selectedRecords.some((record) => record.firstMet)) {
          toast("✗ 初次相遇记录不能合并；请先「恢复自动」");
          return;
        }
        const msg = `把选中的 ${selected.length} 条记忆合并成一个事件${mergePinned ? "（合并后置顶）" : ""}？原记录会从衰减卡移除，但全量卡已保留。`;
        if (!confirm(msg)) return;
        await act("merge-memories", { ids: selected, title: mergeTitle.trim(), pinned: mergePinned });
        setSelected([]);
        setMergeTitle("");
      };
      const setConfig = (key, value) => setUnified(["memoryCard", key], value);
      const setInject = (key, value) => setUnified(["memoryCard", "injectMaxChars", key], value);
      const addManual = async () => {
        if (!manual.text.trim()) { toast("✗ 先写点内容"); return; }
        await act("add", { text: manual.text.trim(), importance: Number(manual.importance) || 70, scope: manual.scope });
        setManual({ open: false, text: "", importance: 70, scope: "qq" });
      };
      const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("sv-SE"); } catch { return ""; } };
      const clarityLabel = { vivid: "清晰", clear: "清楚", fuzzy: "模糊", trace: "只剩印象", forgotten: "已遗忘" };
      const platformLabel = { qq: "QQ", bili: "B站", shared: "共享" };
      const summary = h("div", null,
        h("div", { className: "qbw-infobox" },
          h("b", null, "当前提示词加载："),
          status.loadedLabel || "衰减记忆卡（日常加载）",
          "。全量记忆卡（所有记忆保持清晰、永不遗忘）只存档，不会自动注入；在下方「全量记忆卡」里查看 / 搜索。",
          h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
            `QQ 注入文件：${status.paths?.promptQq ?? "—"} · B站 注入文件：${status.paths?.promptBili ?? "—"}`)),
        h("div", { className: "qbw-card", style: { borderColor: level >= 2 ? "rgba(229,72,77,.45)" : level >= 1 ? "rgba(255,176,32,.45)" : undefined } },
          h("div", { className: "qbw-meter-head" },
            h("div", null, h("b", null, "记忆卡"), h("span", { className: "qbw-hint" }, "长期记忆 · 角色卡管“她是谁”，这张卡管“她记得什么”")),
            h("div", null, h("span", { className: "qbw-chip " + (level >= 2 ? "bad" : level >= 1 ? "warn" : "on") }, status.levelLabel ?? "正常"))),
          h("div", { className: "qbw-meter-head", style: { marginTop: "6px" } },
            h("span", null, `${status.chars ?? 0} / ${status.unlimited ? `警告值 ${status.warnChars ?? 0}` : `${status.maxChars ?? 0}`} 字（${status.percent ?? 0}%）`),
            h("span", { className: "qbw-hint" }, `清晰 ${status.counts?.vivid ?? 0} · 清楚 ${status.counts?.clear ?? 0} · 模糊 ${status.counts?.fuzzy ?? 0} · 印象 ${status.counts?.trace ?? 0} · 锚点 ${status.counts?.anchors ?? 0} · 最初 ${status.counts?.initial ?? 0}`)),
          h("div", { className: meterClass }, h("i", { style: { width: `${percent}%` } })),
          needsAttention ? h("div", { className: "qbw-warnbox" },
            h("b", null, status.unlimited ? `记忆卡到警告值的 ${status.percent}% 了。` : `容量到 ${status.percent}% 了。`),
            status.unlimited
              ? "已设为不限制字数，不会自动压缩或删除；建议手动整理，或把上限/警告值调低。"
              : "建议压缩：会先把最不重要的旧记忆模糊化，置顶的、和主人相关的重要记忆不会动。",
            !status.unlimited && level >= 3 ? "（已满 100%，新记忆会自动压缩，但仍建议检查。）" : "") : null,
          h("div", { className: "qbw-hint" },
            `最近整理：${fmtTime(status.lastMaintenanceAt)} · 上次每日遗忘：${status.lastDecayDate || "还没跑"} · 注入预算 QQ ${config.injectMaxChars?.qq ?? 0} / B站 ${config.injectMaxChars?.bili ?? 0} 字`),
          h("div", { className: "qbw-search", style: { marginTop: "8px" } },
            h("span", { className: "qbw-label" }, "衰减卡字数上限"),
            h("input", {
              className: "qbw-input", type: "number", min: 0, step: 1000,
              value: config.maxChars ?? 0,
              placeholder: "0 = 不限制",
              onChange: (e) => setConfig("maxChars", e.target.value === "" ? "" : Number(e.target.value)),
              style: { minWidth: "130px" },
            }),
            h("span", { className: "qbw-hint" }, "0 = 无上限；正数 = 软上限（达到后只告警/可手动压缩，不自动删）")),
          h("div", { className: "qbw-search", style: { marginTop: "6px" } },
            h("span", { className: "qbw-label" }, "容量警告字数"),
            h("input", {
              className: "qbw-input", type: "number", min: 0, step: 1000,
              value: config.warnChars ?? 60000,
              placeholder: "0 = 不警告",
              onChange: (e) => setConfig("warnChars", e.target.value === "" ? "" : Number(e.target.value)),
              style: { minWidth: "130px" },
            }),
            h("span", { className: "qbw-hint" }, "无上限时：到 80/90/100% 只告警；默认 60000 字，0 = 关闭告警")),
          h("div", { className: "qbw-actions" },
            h(Btn, { onClick: () => act("maintain"), disabled: !!busy }, busy === "mc-maintain" ? "整理中…" : "立即整理"),
            h(Btn, { kind: "qbw-btn2", onClick: () => act("compact", { targetRatio: 0.8 }), disabled: !!busy }, busy === "mc-compact" ? "压缩中…" : "压缩到 80%"),
            h(Btn, { kind: "qbw-btn2", onClick: () => setManual((m) => ({ ...m, open: !m.open })), disabled: !!busy }, manual.open ? "收起手动记忆" : "手动记一条"),
            needsAttention ? h(Btn, { kind: "qbw-btn2", onClick: () => act("ack", { level }), disabled: !!busy }, "确认提醒") : null)),
        manual.open ? h("div", { className: "qbw-card" },
          h("h4", null, "手动记一条"),
          h("div", { className: "qbw-hint" }, "自动记忆之外，你（管理员）可以直接写一条；scope=QQ 的不会进 B站 提示词。"),
          h("textarea", { className: "qbw-textarea", style: { marginTop: "8px" }, value: manual.text, onChange: (e) => setManual((m) => ({ ...m, text: e.target.value })), placeholder: "例：2026-10-22 主人说周末带我去看海。" }),
          h("div", { className: "qbw-actions" },
            h("label", { className: "qbw-hint" }, "重要度 ",
              h("input", { className: "qbw-input", type: "number", min: 1, max: 100, value: manual.importance, onChange: (e) => setManual((m) => ({ ...m, importance: Number(e.target.value) })), style: { width: "90px", minWidth: "90px" } })),
            h("select", { className: "qbw-select", value: manual.scope, onChange: (e) => setManual((m) => ({ ...m, scope: e.target.value })) },
              h("option", { value: "qq" }, "QQ（不进 B站）"),
              h("option", { value: "bili" }, "B站（公开经历）"),
              h("option", { value: "shared" }, "共享（两边都可见）")),
            h(Btn, { onClick: addManual, disabled: !!busy }, "记下"))) : null);
      const details = h("div", null,
        h(Section, { title: "记忆卡规则", note: "容量 / 遗忘 / 注入边界", collapsible: false },
          h(Row, { label: "启用记忆卡", hint: "关掉 = QQ / B站 都不再注入记忆（已存的文件不删）" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: config.enabled !== false, onChange: (e) => setConfig("enabled", e.target.checked) })),
          h(Row, { label: "全量卡上限（GB）", hint: "默认 10GB；填 0 = 不限制。全量卡只存档、不参与提示词，超过只告警、绝不自动删除" },
            h("input", {
              className: "qbw-input", type: "number", min: 0, max: 100, step: 0.5,
              value: config.fullMaxBytes === 0 ? 0 : Math.round((Number(config.fullMaxBytes ?? 10 * 1024 ** 3) / 1024 ** 3) * 10) / 10,
              onChange: (e) => {
                const gb = Number(e.target.value);
                setConfig("fullMaxBytes", Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1024 ** 3) : 0);
              },
            })),
          h(Row, { label: "QQ 注入上限（字）", hint: "每条 QQ 提示词最多带这么多记忆；完整卡仍可在控制台看" },
            h("input", { className: "qbw-input", type: "number", min: 400, max: 8000, value: config.injectMaxChars?.qq ?? 2200, onChange: (e) => setInject("qq", Number(e.target.value)) })),
          h(Row, { label: "B站 注入上限（字）", hint: "B站每次醒来注入的记忆预算" },
            h("input", { className: "qbw-input", type: "number", min: 400, max: 8000, value: config.injectMaxChars?.bili ?? 2000, onChange: (e) => setInject("bili", Number(e.target.value)) })),
          h(Row, { label: "最近 N 天保持清楚", hint: "这段时间内的事至少是「清楚」" },
            h("input", { className: "qbw-input", type: "number", min: 1, max: 60, value: config.recentDays ?? 7, onChange: (e) => setConfig("recentDays", Number(e.target.value)) })),
          h(Row, { label: "多少天后开始模糊", hint: "新记忆的保护期；到期后每天降一档" },
            h("input", { className: "qbw-input", type: "number", min: 0, max: 60, value: config.fuzzyAfterDays ?? 7, onChange: (e) => setConfig("fuzzyAfterDays", Number(e.target.value)) })),
          h(Row, { label: "多少天后可以遗忘", hint: "只对「不重要且非主人」的记忆生效" },
            h("input", { className: "qbw-input", type: "number", min: 7, max: 365, value: config.forgetAfterDays ?? 60, onChange: (e) => setConfig("forgetAfterDays", Number(e.target.value)) })),
          h(Row, { label: "每日整理时间（点）", hint: "到点后第一次 tick 执行；本地时间" },
            h("input", { className: "qbw-input", type: "number", min: 0, max: 23, value: config.dailyHour ?? 4, onChange: (e) => setConfig("dailyHour", Number(e.target.value)) })),
          h(Row, { label: "满 100% 自动压缩", hint: "仅正数上限时生效：自动把不重要的旧记忆压到 90%，并保留告警；0=无上限时不会自动压缩" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: config.autoCompact !== false, onChange: (e) => setConfig("autoCompact", e.target.checked) })),
          h(Row, { label: "容量告警私聊管理员", hint: "80/90/100% 时私聊 ownerQQ；同一档 12 小时只发一次" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: config.notifyOwner !== false, onChange: (e) => setConfig("notifyOwner", e.target.checked) })),
          h(Row, { label: "B站 提示词带 QQ 记忆", hint: "默认关：QQ 的私事不跨平台（隐私红线）" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: config.includeQqInBili === true, onChange: (e) => setConfig("includeQqInBili", e.target.checked) }))),
        h(Section, { title: "最近记忆", note: `${data.records?.length ?? 0} 条（按重要度）`, collapsible: false },
          h("div", { className: "qbw-infobox" },
            h("b", null, "初次相遇："),
            data.firstMet?.source === "manual" ? "手动指定" : "自动（最早一条主人互动）",
            data.firstMet?.at ? ` · ${fmtDate(data.firstMet.at)}` : "",
            data.firstMet?.mergedCount > 1 ? ` · 由 ${data.firstMet.mergedCount} 条合并` : "",
            h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
              data.firstMet?.preview || "（还没有主人互动；有了以后会自动把最早一条标为初次相遇）")),
          h("div", { className: "qbw-search" },
            h("span", { className: "qbw-label" }, "多选操作"),
            h("span", { className: "qbw-hint" }, `已选 ${selected.length} 条${selectedHasNonOwner ? "（含非主人记忆）" : ""}；多选会合并为一个事件；初次相遇只能选主人的互动`),
            h(Btn, { onClick: setFirstMeet, disabled: !!busy || !selected.length || selectedHasNonOwner }, "设为初次相遇"),
            h(Btn, { onClick: mergeSelected, disabled: !!busy || selected.length < 2 }, "合并为一个事件"),
            data.firstMet?.source === "manual" ? h(Btn, { kind: "qbw-btn2", onClick: clearFirstMeet, disabled: !!busy }, "恢复自动") : null),
          h("div", { className: "qbw-search" },
            h("input", {
              className: "qbw-input", placeholder: "合并后的事件标题（可选；默认取第一条的标题）",
              value: mergeTitle, onChange: (e) => setMergeTitle(e.target.value),
              style: { flex: 1, minWidth: "240px" },
            }),
            h("label", { className: "qbw-hint", style: { display: "inline-flex", alignItems: "center", gap: "5px" } },
              h("input", { type: "checkbox", checked: mergePinned, onChange: (e) => setMergePinned(e.target.checked) }),
              "合并后置顶"),
            h("span", { className: "qbw-hint" }, "合并会移除原记录（全量卡已保留），只留一个事件；可稍后取消置顶")),
          h("div", { className: "qbw-hint", style: { marginBottom: "6px" } },
            `「最初」是独立判定：只算和主人的互动，从首次互动起 30 天窗口；前 10 天最容易被标为最初，之后逐渐降低。当前标记 ${status.counts?.initial ?? 0} 条。`),
          (data.records ?? []).slice(0, 30).map((record) => h("div", { key: record.id, className: "qbw-rec" },
            h("div", null,
              h("div", { className: "qbw-rec-title" },
                h("input", {
                  type: "checkbox", checked: selected.includes(record.id),
                  onChange: () => toggleSelect(record.id),
                  title: "选中后可合并为一个事件；初次相遇只能选主人的互动",
                  style: { verticalAlign: "middle", marginRight: "6px" },
                }),
                h("span", { className: "qbw-chip " + (record.clarity === "vivid" ? "on" : record.clarity === "fuzzy" ? "warn" : record.clarity === "trace" ? "bad" : "") }, clarityLabel[record.clarity] ?? record.clarity),
                h("span", { className: "qbw-chip" }, platformLabel[record.platform] ?? record.platform),
                record.tags?.includes("merged") ? h("span", { className: "qbw-chip on" }, "合并事件") : null,
                record.isSelf ? h("span", { className: "qbw-chip" }, "她自己说的") : null,
                record.isInitial ? h("span", { className: "qbw-chip on" }, record.firstMet ? "初次相遇" : `最初 ${record.initialTier ?? ""}`) : null,
                ` 重要 ${record.importance}`,
                record.pinned ? h("span", { className: "qbw-chip on" }, "置顶") : null),
              h("div", { className: "qbw-rec-text" }, `${fmtDate(record.date)} · ${record.title || ""}`),
              h("div", { className: "qbw-rec-text" }, record.text),
              record.botReply ? h("div", { className: "qbw-rec-text" }, `她回：${record.botReply}`) : null),
            h("div", { className: "qbw-rec-actions" },
              h(Btn, { kind: "qbw-btn2", onClick: () => pin(record), disabled: !!busy }, record.pinned ? "取消置顶" : "置顶"),
              h(Btn, { kind: "qbw-btn2", onClick: () => forget(record), disabled: !!busy || record.pinned }, "忘记"))))),
        h("div", { className: "qbw-cols" },
          h("div", null,
            h("div", { className: "qbw-group" }, "QQ 注入预览 ", h("small", null, `${status.promptChars?.qq ?? 0} 字`)),
            h("div", { className: "qbw-scroll" }, h("pre", null, data.promptQq || "（还没有记忆；点「立即整理」）"))),
          h("div", null,
            h("div", { className: "qbw-group" }, "B站 注入预览 ", h("small", null, `${status.promptChars?.bili ?? 0} 字`)),
            h("div", { className: "qbw-scroll" }, h("pre", null, data.promptBili || "（还没有 B站 记忆）")))),
        h(Section, { title: "完整记忆卡（memory-card.md）", note: `${data.markdown?.length ?? 0} 字`, collapsible: false },
          h("div", { className: "qbw-scroll" }, h("pre", null, data.markdown || "（空）"))),
        (data.backups ?? []).length ? h(Section, { title: "记忆卡备份", note: `${data.backups.length} 份`, collapsible: false },
          data.backups.slice(0, 12).map((b) => h("div", { key: b.name, className: "qbw-item" },
            h("div", null, h("div", { className: "qbw-label" }, b.name), h("div", { className: "qbw-hint" }, `${fmtBytes(b.bytes)} · ${fmtTime(new Date(b.mtime).toISOString())}`)),
            h(Btn, { kind: "qbw-btn2", onClick: async () => { if (!confirm(`用 ${b.name} 覆盖当前记忆卡？会先备份当前卡。`)) return; await act("restore", { name: b.name }); }, disabled: !!busy }, "恢复")))) : null);
      if (view === "details") return details;
      if (view === "summary") return summary;
      return h("div", null, summary, details);
    }

    // ── 全量记忆卡（只存档，不参与日常提示词）──────────────────────────────
    function FullMemoryCardPanel({ reloadKey = 0, busy, toast }) {
      const [data, setData] = useState(null);
      const [q, setQ] = useState("");
      const [err, setErr] = useState("");
      const [loading, setLoading] = useState(false);
      const load = useCallback(async (query = "") => {
        setLoading(true);
        try {
          const r = await api(`/memory-card/full?q=${encodeURIComponent(query)}&limit=40`);
          setData(r);
          setErr("");
        } catch (e) { setErr(e.message); } finally { setLoading(false); }
      }, []);
      useEffect(() => { load(q); }, [load, reloadKey]);
      const status = data?.status ?? {};
      const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("sv-SE"); } catch { return ""; } };
      const platformLabel = { qq: "QQ", bili: "B站", shared: "共享" };
      const search = async () => { await load(q); };
      return h("div", { className: "qbw-card" },
        h("div", { className: "qbw-meter-head" },
          h("div", null,
            h("b", null, "全量记忆卡（只存档）"),
            h("span", { className: "qbw-hint" }, "所有记忆永久清晰、不模糊、不遗忘；不参与日常提示词")),
          h("div", null, h("span", { className: "qbw-chip" }, "未加载到提示词"))),
        h("div", { className: "qbw-warnbox" },
          h("b", null, "当前提示词加载的是上面的衰减记忆卡。"),
          " 这张全量卡只用于「以后回查/召回」：日常 QQ / B站 不会自动带它；需要某段记忆时，用下面的搜索找到原文。"),
        h("div", { className: "qbw-meter-head", style: { marginTop: "6px" } },
          h("span", null, `${status.records ?? 0} 条 · ${fmtBytes(status.bytes ?? 0)} / ${status.unlimited ? "不限制" : fmtBytes(status.maxBytes ?? 0)}（${status.percent ?? 0}%）`),
          h("span", { className: "qbw-hint" },
            `更新 ${fmtTime(status.updatedAt)} · 最近归档 ${fmtTime(status.lastArchiveAt)}`)),
        status.level >= 1 ? h("div", { className: "qbw-warnbox" },
          `全量卡已达到软上限的 ${status.percent}%。它不会自动删除或压缩；建议导出 / 备份，或把更早的档案移到外部存储。`) : null,
        data?.corrupt ? h("div", { className: "qbw-dangerbox" }, "全量卡文件损坏过，已自动备份原始文件并新建空卡；请到备份目录检查。") : null,
        h("div", { className: "qbw-search" },
          h("input", {
            className: "qbw-input", placeholder: "按关键词搜索全量记忆（例如：第一次、难过、B站、某个群友）",
            value: q, onChange: (e) => setQ(e.target.value),
            onKeyDown: (e) => { if (e.key === "Enter") search(); },
          }),
          h(Btn, { onClick: search, disabled: loading || !!busy }, loading ? "搜索中…" : "搜索"),
          h(Btn, { kind: "qbw-btn2", onClick: () => { setQ(""); load(""); }, disabled: loading || !!busy }, "显示最近")),
        err ? h("div", { className: "qbw-err" }, err) : null,
        h("div", { className: "qbw-group" }, data?.query ? `搜索结果（${data.records?.length ?? 0} 条）` : "最近归档（40 条）",
          h("small", null, data?.query ? `关键词：${data.query}` : "按时间倒序")),
        (data?.records ?? []).length ? (data.records.map((record) => h("div", { key: record.id, className: "qbw-rec" },
          h("div", null,
            h("div", { className: "qbw-rec-title" },
              h("span", { className: "qbw-chip on" }, "清晰"),
              h("span", { className: "qbw-chip" }, platformLabel[record.platform] ?? record.platform),
              record.isSelf ? h("span", { className: "qbw-chip" }, "她自己说的") : null,
              ` 重要 ${record.importance}`,
              record.matchScore ? h("span", { className: "qbw-chip warn" }, `匹配 ${record.matchScore}`) : null),
            h("div", { className: "qbw-rec-text" }, `${fmtDate(record.date)} · ${record.title || ""}`),
            h("div", { className: "qbw-rec-text" }, record.text),
            record.botReply ? h("div", { className: "qbw-rec-text" }, `她回：${record.botReply}`) : null),
          h("div", { className: "qbw-rec-actions" },
            h("span", { className: "qbw-hint" }, record.archivedAt ? `归档 ${fmtDate(record.archivedAt)}` : ""))))) : h("div", { className: "qbw-hint" }, "（没有匹配的全量记忆）"),
        h(Section, { title: "全量卡原文（memory-card-full.md）", note: `${data?.markdownChars ?? 0} 字`, defaultOpen: false },
          h("div", { className: "qbw-scroll" }, h("pre", null, data?.markdownPreview || "（还没有归档）"))),
        h("div", { className: "qbw-hint" }, `文件：${data?.paths?.markdown ?? ""} · 这张卡没有 prompt 注入文件，所以不会被自动加载。`));
    }

    // ── 记忆 ────────────────────────────────────────────────────────────────

    // ── 语音页：语音包安装 / 启停 / 试听 / 触发规则 ─────────────────

    // 云端实时用量：模型 / 今日 / 本月 / 估算费用 / 剩余额度（5 秒刷新）
    function CloudStats() {
      const [st, setSt] = useState(null);
      const [err, setErr] = useState("");
      useEffect(() => {
        let alive = true;
        const tick = async () => {
          try {
            const r = await api("/voice/packs/cloud-stats?id=voice-cloud");
            if (alive) { setSt(r); setErr(""); }
          } catch (e) { if (alive) setErr(e.message); }
        };
        tick();
        const timer = setInterval(tick, 5000);
        return () => { alive = false; clearInterval(timer); };
      }, []);
      const cell = (label, value, hint) => h("div", { style: { minWidth: "110px" } },
        h("div", { style: { fontSize: "11px", opacity: 0.6 } }, label),
        h("div", { style: { fontSize: "15px", fontWeight: 600 } }, value),
        hint ? h("div", { style: { fontSize: "11px", opacity: 0.55 } }, hint) : null);
      return h("div", { style: { marginTop: "10px", padding: "10px", borderRadius: "8px", background: "rgba(127,127,127,.06)" } },
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" } },
          h("strong", { style: { fontSize: "13px" } }, "云端用量"),
          h("span", { style: { fontSize: "11px", opacity: 0.6 } }, "每 5 秒刷新")),
        err ? h("div", { style: { fontSize: "12px", color: "#e66" } }, err) : null,
        st ? h("div", { style: { display: "flex", gap: "20px", flexWrap: "wrap" } },
          cell("当前模型", st.model || "—", st.speaker ? "音色 " + st.speaker : ""),
          cell("今日", st.todayChars + " 字", st.todayCalls + " 次"),
          cell("本月", st.monthChars + " 字", st.monthCalls + " 次"),
          cell("估算费用", st.monthCost == null ? "未设单价" : "¥" + st.monthCost, st.pricePerKChar ? "¥" + st.pricePerKChar + "/千字" : "在下方填"),
          cell("剩余额度", st.remainChars == null ? "未设额度" : st.remainChars + " 字", st.monthlyQuota ? "额度 " + st.monthlyQuota : "在下方填")) : null,
        h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "8px", flexWrap: "wrap", fontSize: "12px" } },
          "单价 ¥", h("input", { type: "number", step: "0.01", value: st ? st.pricePerKChar || "" : "", onChange: async (e) => {
            await api("/voice/rules", { method: "POST", body: { pricePerKChar: Number(e.target.value) } }).catch(() => {});
          }, style: { width: "80px" } }), "/千字",
          "本月额度", h("input", { type: "number", value: st ? st.monthlyQuota || "" : "", onChange: async (e) => {
            await api("/voice/rules", { method: "POST", body: { monthlyQuota: Number(e.target.value) } }).catch(() => {});
          }, style: { width: "100px" } }), "字"),
        h("div", { style: { fontSize: "11px", opacity: 0.55, marginTop: "6px" } },
          "费用/额度是按你填的数字估算的（火山不提供余额查询）；字数来自本机实际合成日志。"));
    }


    // 云端密钥表单：始终可见，已配置也只打码显示，随时能改。
    function CloudForm({ toast }) {
      const [cfg, setCfg] = useState(null);
      const [form, setForm] = useState({ appId: "", accessKey: "", speaker: "" });
      const [busy, setBusy] = useState(false);
      const [msg, setMsg] = useState("");

      const read = useCallback(async () => {
        try {
          const r = await api("/voice/packs/cloud-config?id=voice-cloud");
          setCfg(r);
          setForm({ appId: r.appId || "", accessKey: "", speaker: r.speaker || "" });
        } catch (e) { setMsg(e.message); }
      }, []);
      useEffect(() => { read(); }, [read]);

      const save = async () => {
        setBusy(true); setMsg("保存中…");
        try {
          await api("/voice/packs/cloud-config", { method: "POST", body: { id: "voice-cloud", ...form } });
          setMsg("已保存"); toast("✓ 云端密钥已保存"); await read();
        } catch (e) { setMsg("保存失败：" + e.message); }
        finally { setBusy(false); }
      };
      const test = async () => {
        setBusy(true); setMsg("测试中…");
        try { const r = await api("/voice/packs/test", { method: "POST", body: { id: "voice-cloud" } }); setMsg("✅ 连接成功，" + r.ms + "ms"); }
        catch (e) { setMsg("❌ " + e.message); }
        finally { setBusy(false); }
      };

      const row = (label, node) => h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" } },
        h("span", { style: { width: "96px", fontSize: "13px" } }, label), node);

      return h("div", { style: { marginTop: "14px", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
        h(CloudStats, null),
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginTop: "12px" } },
          h("strong", null, "云端包：密钥与音色"),
          h("span", { style: { fontSize: "12px", opacity: 0.75 } }, cfg && cfg.configured ? "已配置（可随时修改）" : "未配置 —— 填完才能用")),
        h("ol", { style: { fontSize: "12px", margin: "8px 0", paddingLeft: "20px", lineHeight: "1.7", opacity: 0.8 } },
          h("li", null, h("a", { href: "/dsh-surfcore/api/voice/packs/sample?id=voice-cloud", target: "_blank", rel: "noreferrer" }, "下载参考音频"), "（19 秒，包里自带，不用自己录）"),
          h("li", null, h("a", { href: "https://console.volcengine.com/speech/service/8", target: "_blank", rel: "noreferrer" }, "打开火山引擎控制台 ↗"), " → 语音技术 → 声音复刻 → 上传 wav → 训练，拿到 S_xxxxxxxx"),
          h("li", null, "把下面三项填进来，点「保存」，再点「测试连接」")),
        row("AppID", h("input", { type: "text", value: form.appId, placeholder: "例如 3773727341", onChange: (e) => setForm({ ...form, appId: e.target.value }), style: { width: "240px" } })),
        row("Access Key", h("input", { type: "password", value: form.accessKey, placeholder: cfg && cfg.hasAccessKey ? "已保存：" + cfg.accessKeyMasked + "（留空则不修改）" : "控制台里的 Access Key", onChange: (e) => setForm({ ...form, accessKey: e.target.value }), style: { width: "240px" } })),
        row("音色 ID", h("input", { type: "text", value: form.speaker, placeholder: "S_xxxxxxxx", onChange: (e) => setForm({ ...form, speaker: e.target.value }), style: { width: "240px" } })),
        h("div", { style: { display: "flex", gap: "8px", marginTop: "10px", alignItems: "center", flexWrap: "wrap" } },
          h(Btn, { disabled: busy, onClick: save }, busy ? "保存中…" : "保存"),
          h(Btn, { kind: "qbw-btn2", disabled: busy, onClick: test }, "测试连接"),
          msg ? h("span", { style: { fontSize: "12px", opacity: 0.85 } }, msg) : null),
        h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } },
          "密钥只写在本机包内的 config.toml，不上传任何服务器。"));
    }

    function VoiceTab({ toast }) {
      const [packs, setPacks] = useState([]);
      const [packsDir, setPacksDir] = useState("");
      const [dirInput, setDirInput] = useState("");
      const [adoptInput, setAdoptInput] = useState("");
      const [mirror, setMirror] = useState("");
      const [rules, setRules] = useState(null);
      const [err, setErr] = useState("");
      const [busyId, setBusyId] = useState("");
      const [pick, setPick] = useState("voice-local");
      const [switchMsg, setSwitchMsg] = useState("");
      const [msg, setMsg] = useState({});

      const load = useCallback(async () => {
        try {
          const r = await api("/voice/packs");
          setPacks(r.packs || []);
          setPacksDir(r.packsDir || "");
          setDirInput((prev) => prev || r.packsDir || "");
          setErr("");
          setRules(await api("/voice/rules"));
          const run = (r.packs || []).find((p) => p.running);
          if (run) setPick(run.id);
        } catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); }, [load]);

      const poll = useCallback(async (id, tries = 240) => {
        for (let i = 0; i < tries; i += 1) {
          await new Promise((r) => setTimeout(r, 1500));
          try {
            const r = await api("/voice/packs");
            setPacks(r.packs || []);
            const p = (r.packs || []).find((x) => x.id === id);
            if (!p) return "failed";
            if (p.install && p.install.phase === "失败") { setMsg((m) => ({ ...m, [id]: "✗ " + (p.install.error || "安装失败") })); return "failed"; }
            if (p.installed && !p.install) return "ok";
          } catch {}
        }
        return "timeout";
      }, []);

      const runningId = ((packs.filter((p) => p.running)[0]) || {}).id || "";
      // 单选 + 一个按钮：没在跑就启动选中的那个；跑的就是选中的 → 停止
      const toggle = async () => {
        setBusyId("__switch"); setSwitchMsg("");
        try {
          if (runningId === pick) {
            await api("/voice/packs/stop", { method: "POST", body: { id: pick } });
            setSwitchMsg("已停止");
          } else {
            const r = await api("/voice/packs/activate", { method: "POST", body: { id: pick } });
            setSwitchMsg(r.ok ? "已启动：" + (pick === "voice-cloud" ? "云端" : "本地") : ("启动失败：" + (r.error || "")));
          }
          await load();
        } catch (e) { setSwitchMsg("失败：" + e.message); }
        finally { setBusyId(""); }
      };

      const act = async (id, action, body) => {
        setBusyId(id);
        setMsg((m) => ({ ...m, [id]: action === "install" ? "开始安装…" : "处理中…" }));
        try {
          await api("/voice/packs/" + action, { method: "POST", body: { id, ...(action === "install" ? { mirror } : {}), ...(body || {}) } });
          if (action === "install") {
            const done = await poll(id);
            setMsg((m) => ({
              ...m,
              [id]: done === "ok" ? "✓ 安装完成"
                : done === "failed" ? "✗ 安装失败：见上方进度条下方的原因"
                  : "⏳ 还在安装（依赖阶段可能要几十分钟）；卡住可以点「取消安装」再来",
            }));
          }
          else setMsg((m) => ({ ...m, [id]: "" }));
          await load();
        } catch (e) {
          setMsg((m) => ({ ...m, [id]: e.message }));
        } finally { setBusyId(""); }
      };

      const fmt = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + " GB" : Math.round(b / 1e6) + " MB");
      const saveRules = async () => {
        try { await api("/voice/rules", { method: "POST", body: rules }); toast("✓ 触发规则已保存"); }
        catch (e) { toast("✗ " + e.message); }
      };

      const card = (p) => h("div", {
        key: p.id,
        style: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px", padding: "12px", marginBottom: "10px" },
      },
        h("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", flexWrap: "wrap" } },
          h("strong", null, p.name),
          h("span", { style: { opacity: 0.75, fontSize: "12px" } },
            fmt(p.sizeBytes) + " · 端口 " + p.port + " · " + (p.install
              ? p.install.phase + " " + p.install.progress + "%"
              : p.running
                ? ((p.external ? "● 运行中（外部目录）" : "● 运行中")
                  + (p.enginePort && p.engineUp === false ? " · ⚠️ 音色引擎未起" : ""))
                : p.installed ? "○ 已安装 · 未运行" : "未安装"))),
        h("div", { style: { opacity: 0.8, margin: "6px 0", fontSize: "13px" } }, p.about && p.about.summary ? p.about.summary : ""),
        h("div", { style: { display: "flex", gap: "18px", flexWrap: "wrap", fontSize: "12px", opacity: 0.8 } },
          h("ul", { style: { margin: 0, paddingLeft: "18px" } }, ((p.about && p.about.pros) || []).map((x) => h("li", { key: x }, x))),
          h("ul", { style: { margin: 0, paddingLeft: "18px", opacity: 0.7 } }, ((p.about && p.about.cons) || []).map((x) => h("li", { key: x }, x)))),
        p.about && p.about.billing ? h("div", { style: { fontSize: "12px", marginTop: "6px", opacity: 0.75 } },
          p.about.billing, h("br"), p.about.disclaimer || "") : null,
        (p.install || busyId === p.id)
          ? h("div", null,
            h(ProgressBar, {
              pct: p.install?.progress ?? 0,
              // 依赖阶段没有百分比：显示"已 X 分钟 + 最近在装什么"，否则用户不知道卡没卡
              phase: (() => {
                if (!p.install) return "正在启动安装…";
                const mins = Math.max(0, Math.round((Date.now() - Number(p.install.startedAt || Date.now())) / 60000));
                const tail = String(p.install.logTail || "").split(String.fromCharCode(10)).filter(Boolean).pop() || "";
                const phase = String(p.install.phase || "安装中");
                return `${phase} · 已 ${mins} 分钟${tail ? ` · ${tail.slice(-60)}` : ""}`;
              })(),
              err: p.install?.error,
              indeterminate: !p.install || (/依赖|模型/.test(String(p.install.phase || '')) && Number(p.install.progress || 0) >= 99),
            }),
            p.install && p.install.phase !== "完成" && p.install.phase !== "失败"
              ? h("div", { style: { marginTop: "6px" } },
                h(Btn, { kind: "qbw-btn2", onClick: async () => {
                  try {
                    await api("/voice/packs/cancel", { method: "POST", body: { id: p.id } });
                    if (toast) toast("已取消安装（已下载的模型会保留）");
                    await load();
                  } catch (e) { if (toast) toast(`✗ ${e.message}`); }
                } }, "取消安装"))
              : null)
          : null,
        p.installed && p.dir ? h("div", { style: { fontSize: "12px", marginTop: "4px", opacity: 0.7 } }, "路径：", h("code", null, p.dir)) : null,
        p.enginePort && p.running && p.engineUp === false
          ? h("div", { style: { fontSize: "12px", marginTop: "4px", opacity: 0.85 } },
            `本地音色引擎（GPT-SoVITS ${p.enginePort}）还没起来：点「启动」会自动拉起，约 40 秒后再试；期间发语音会失败。`)
          : null,
        h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" } },
          !p.installed ? h(Btn, { disabled: busyId === p.id, onClick: () => act(p.id, "install") }, "安装（" + fmt(p.sizeBytes) + "）") : null,
          p.external ? h("span", { style: { fontSize: "12px", opacity: 0.7 } }, p.dir ? `已在别处安装：${p.dir}` : "已在别处安装（端口在跑）") : null,
          p.external && p.dir
            ? h(Btn, { kind: "qbw-btn2", onClick: async () => {
              const parent = String(p.dir).replace(/[\/][^\/]+$/, "");
              try {
                await api("/config", { method: "POST", body: { qq: { voicePacks: { dir: parent.split("\\").join("/") } } } });
                if (toast) toast(`✓ 安装目录已指向 ${parent}`);
                await load();
              } catch (e) { if (toast) toast(`✗ ${e.message}`); }
            } }, "把安装目录设为这里")
            : null,
          p.installed ? h(Btn, { kind: "qbw-btn2", disabled: busyId === p.id, onClick: () => act(p.id, "remove") }, "卸载") : null,
          !p.installed ? h(Btn, { kind: "qbw-btn2", onClick: async () => {
            try {
              const r = await api("/voice/packs/clean", { method: "POST", body: { id: p.id } });
              const mb = ((r.freedBytes || 0) / 1024 / 1024).toFixed(1);
              toast(`✓ 已清理未完成的下载（${mb} MB）`);
              await load();
            } catch (e) { toast(`✗ ${e.message}`); }
          } }, "清理下载残留") : null,
          msg[p.id] ? h("span", { style: { fontSize: "12px", opacity: 0.8 } }, msg[p.id]) : null));

      const cloud = packs.find((p) => p.id === "voice-cloud");
      return h("div", null,
        h("div", { style: { fontSize: "13px", opacity: 0.85, marginBottom: "10px" } },
          "语音引擎不随插件分发。不装也能正常聊天，只是不能发语音。两个包互相独立，可只装一个。"),
        err ? h("div", { className: "qbw-err" }, err) : null,
        h("div", { style: { marginTop: "14px", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
          h("div", { style: { display: "flex", gap: "16px", alignItems: "center", flexWrap: "wrap", fontSize: "13px" } },
            h("strong", null, "使用"),
            h("label", { style: { display: "flex", gap: "6px", alignItems: "center" } },
              h("input", { type: "radio", name: "voicePick", checked: pick === "voice-local", onChange: () => setPick("voice-local") }), "本地语音包"),
            h("label", { style: { display: "flex", gap: "6px", alignItems: "center" } },
              h("input", { type: "radio", name: "voicePick", checked: pick === "voice-cloud", onChange: () => setPick("voice-cloud") }), "云端语音包"),
            h(Btn, { disabled: busyId === "__switch", onClick: toggle }, busyId === "__switch" ? "处理中…" : (runningId === pick ? "停止" : "启动")),
            h("span", { style: { fontSize: "13px" } }, "语音系统：",
              runningId
                ? h("b", { style: { color: "#67c23a" } }, "● 已启动")
                : h("b", { style: { color: "#909399" } }, "○ 未启动")),
            h("span", { style: { fontSize: "13px" } }, "当前：",
              h("b", null, (runningId || pick) === "voice-cloud" ? "云端语音包" : "本地语音包"))),
          switchMsg ? h("div", { style: { fontSize: "12px", marginTop: "6px", opacity: 0.85 } }, switchMsg) : null,
          h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } }, "只能运行一个；切换会自动停掉另一个。")),
        packs.map(card),

        h("div", { style: { marginTop: "10px", padding: "10px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
          h("div", { style: { fontSize: "13px", fontWeight: 600 } }, "下载链路"),
          h("div", { style: { fontSize: "12px", opacity: 0.75, marginTop: "2px" } },
            "官方源慢或连不上时换镜像。内容都有 sha256 校验，镜像方看不到你的会话，但能看到你下了什么。"),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" } },
            ...[
              { id: "", label: "官方（GitHub）" },
              { id: "https://ghfast.top", label: "镜像 · ghfast" },
              { id: "https://gh-proxy.com", label: "镜像 · gh-proxy" },
              { id: "https://ghproxy.net", label: "镜像 · ghproxy" },
            ].map((opt) => h(Btn, {
              key: opt.id || "official",
              kind: mirror === opt.id ? "qbw-btn" : "qbw-btn2",
              onClick: () => setMirror(opt.id),
            }, (mirror === opt.id ? "● " : "") + opt.label))),
          h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } },
            mirror ? `当前：${mirror}（下载时会拼在原地址前面）` : "当前：官方源；分卷下载默认 3 路并发")),
        h("div", { style: { marginTop: "10px", padding: "10px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
          h("div", { style: { fontSize: "13px", fontWeight: 600 } }, "安装目录"),
          h("div", { style: { fontSize: "12px", opacity: 0.75, marginTop: "2px" } },
            "默认在 ~/.dsh/surfcore/state/voice-packs；磁盘紧张或用户目录只读时改到这里。改完要重启桥接，已装的包请手动移动过去。安装依赖默认走清华源（可用 SURFCORE_PIP_INDEX 覆盖）。"),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" } },
            h("input", { className: "qbw-input", value: dirInput, placeholder: packsDir || "D:/voice-packs", style: { flex: "1 1 320px" }, onChange: (e) => setDirInput(e.target.value) }),
            h(Browse, { mode: "dir", title: "选择语音包安装目录", onPick: (v) => setDirInput(v) }),
            h(Btn, { kind: "qbw-btn2", onClick: async () => {
              const next = String(dirInput || "").trim();
              if (!next) { toast("✗ 目录不能为空"); return; }
              if (!/^[A-Za-z]:/.test(next) && !next.startsWith("/")) { toast("✗ 请填绝对路径，例如 D:/voice-packs"); return; }
              try {
                await api("/config", { method: "POST", body: { qq: { voicePacks: { dir: next.split(String.fromCharCode(92)).join("/") } } } });
                toast("✓ 已保存；重启桥接后生效（已装的包请先移动到新目录）");
                await load();
              } catch (e) { toast(`✗ ${e.message}`); }
            } }, "保存路径")),
          h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } }, "当前生效：", h("code", null, packsDir || "（读不到）"))),
        h("div", { className: "qbw-hint", style: { marginTop: "10px" } },
          "⚠️ 改完语音总开关 / TTS / 发语音工具后，需要重启 DSH：工具列表在 MCP 进程启动时就固定了，不重启她还会说“没有语音入口”。"),
        h("div", { style: { marginTop: "10px", padding: "10px 12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
          h("div", { style: { fontSize: "13px", fontWeight: 600 } }, "已有安装？手动指定包目录"),
          h("div", { style: { fontSize: "12px", opacity: 0.75, marginTop: "2px" } },
            "选到 voice-local / voice-cloud 那一层（里面有 config.toml）或它的上一级都可以；识别不到时用这个最稳。"),
          h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" } },
            h("input", { className: "qbw-input", value: adoptInput, placeholder: "D:/surfcore/state/voice-packs/voice-local", style: { flex: "1 1 320px" }, onChange: (e) => setAdoptInput(e.target.value) }),
            h(Browse, { mode: "dir", title: "选择已安装的语音包目录", onPick: (v) => setAdoptInput(v) }),
            h(Btn, { kind: "qbw-btn2", onClick: async () => {
              const raw = String(adoptInput || "").trim();
              if (!raw) { if (toast) toast("✗ 先选一个目录"); return; }
              // 选到 .../voice-local 时，base 取上一级；选到 base 就原样用。
              const norm = raw.split(String.fromCharCode(92)).join("/");
              const base = /(voice-local|voice-cloud)$/i.test(norm) ? norm.replace(/[^/]+$/, "") : norm;
              try {
                await api("/config", { method: "POST", body: { qq: { voicePacks: { dir: base.split("\\").join("/") } } } });
                if (toast) toast(`✓ 已指向 ${base}，识别中…`);
                await load();
              } catch (e) { if (toast) toast(`✗ ${e.message}`); }
            } }, "用这个目录"))),



        cloud && cloud.installed ? h(CloudForm, { toast }) : null,

        rules ? h("div", { style: { marginTop: "16px", paddingTop: "12px", borderTop: "1px solid var(--dsw-alias-border-l2)" } },
          h("strong", null, "触发规则"),
          h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "8px", flexWrap: "wrap", fontSize: "13px" } },
            "允许谁触发",
            h("select", { value: rules.triggerWho, onChange: (e) => setRules({ ...rules, triggerWho: e.target.value }), style: { width: "180px" } },
              h("option", { value: "owner" }, "仅主人（推荐）"),
              h("option", { value: "anyone" }, "任何人"),
              h("option", { value: "list" }, "指定成员"))),
          h("div", { style: { display: "flex", gap: "10px", alignItems: "center", marginTop: "8px", flexWrap: "wrap", fontSize: "13px" } },
            "频率上限",
            h("input", { type: "number", min: 1, max: 60, value: rules.maxPerMinute, onChange: (e) => setRules({ ...rules, maxPerMinute: Number(e.target.value) }), style: { width: "70px" } }), "条/分钟",
            h("input", { type: "number", min: 1, max: 600, value: rules.maxPerHour, onChange: (e) => setRules({ ...rules, maxPerHour: Number(e.target.value) }), style: { width: "70px" } }), "条/小时"),
          h("label", { style: { display: "flex", gap: "6px", alignItems: "center", marginTop: "8px", fontSize: "13px" } },
            h("input", { type: "checkbox", checked: !!rules.aiEnabled, onChange: (e) => setRules({ ...rules, aiEnabled: e.target.checked }) }),
            "允许 AI 主动发语音（默认关；关着只有你手动试发才出声）"),
          h("div", { style: { marginTop: "8px" } }, h(Btn, { onClick: saveRules }, "保存触发规则")),
          h("div", { style: { fontSize: "12px", opacity: 0.7, marginTop: "6px" } },
            "仅主人可触发：群聊里最后一条消息必须是你发的（5 分钟内），且一条消息最多换一条语音。")) : null);
    }

    function MemoryTab({ qq, unified, setUnified, overview, busy, setBusy, toast, reload }) {
      const [data, setData] = useState(null);
      const [card, setCard] = useState(null);
      const [fullVersion, setFullVersion] = useState(0);
      const [err, setErr] = useState("");
      const load = useCallback(async () => {
        try { const r = await api("/memory"); setData(r); setErr(""); } catch (e) { setErr(e.message); }
      }, []);
      const loadCard = useCallback(async () => {
        try { const r = await api("/memory-card"); setCard(r); } catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); loadCard(); }, [load, loadCard]);
      const biliToQq = qq?.biliBridge?.memory?.enabled !== false && qq?.biliBridge?.enabled !== false;
      // 开关必须绑“可编辑草稿”，不能直接绑服务端快照 qq.biliBridge：
      // 旧写法点了只改 unified.__biliToQqToggle，checked 却读 qq 快照 → 点完立刻弹回（PITFALLS #16）。
      const biliToQqDraft = typeof unified?.__biliToQqToggle === "boolean" ? unified.__biliToQqToggle : biliToQq;
      const qqToBili = unified?.memory?.qqToBili ?? {};
      const setQqToBili = (key, value) => setUnified(["memory", "qqToBili", key], value);
      const syncNow = async () => {
        setBusy("sync");
        try { const r = await api("/memory", { method: "POST", body: { action: "sync" } }); toast(r.ok ? `✓ 已同步（${r.stats?.kept ?? 0} 条，脱敏 ${r.stats?.redactions ?? 0} 处）` : `✗ ${r.error ?? "失败"}`); await load(); await reload(); }
        catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const scan = async () => {
        setBusy("scan");
        try { const r = await api("/memory", { method: "POST", body: { action: "scan-align" } }); toast(`✓ 扫描完成：QQ 候选 +${r.qq?.added ?? 0}，B站候选 +${r.bili?.added ?? 0}`); await load(); await reload(); }
        catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const purge = async () => {
        if (!confirm("清空 QQ→B站 记忆和原始公开 feed？对齐表与 B站→QQ 简报不受影响。")) return;
        setBusy("purge");
        try {
          const r = await api("/memory", { method: "POST", body: { action: "purge" } });
          toast(r.ok ? "✓ 已清空 QQ→B站 记忆" : `✗ ${r.error ?? "失败"}`);
          await load();
          await reload();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const status = data?.status ?? overview?.memory ?? {};
      return h("div", null,
        h(MemoryCardPanel, { view: "summary", data: card, reload: loadCard, busy, setBusy, toast, unified, setUnified, onChanged: () => setFullVersion((v) => v + 1) }),
        h("div", { className: "qbw-group" }, "双向脱敏同步（QQ ⇄ B站）", h("small", null, "只搬运公开、脱敏后的近况；和上面的记忆卡不是一回事")),
        h("div", { className: "qbw-dangerbox" },
          h("b", null, "隐私红线（锁定，不可关）："),
          "私信/私聊永不跨平台；密码、令牌、cookie、手机号、身份证、银行卡、住址、真实姓名、精确位置、外部链接一律剔除；",
          "QQ 号/群号/B站 mid 不写进记忆正文；生成后还要过一遍 assertSafeOutput，命中就拒绝落盘。"),
        h("div", { className: "qbw-grid" },
          h("div", { className: "qbw-card" },
            h("h4", null, "B站 → QQ"),
            h("p", null, "默认开启，保持原行为。B站只读公开打分/评论/收藏/公开动态/日记公开见闻；不读任何私信。"),
            h(Row, { label: "同步 B站记忆到 QQ", hint: "关掉 = QQ 侧的她不提 B站经历" },
              h("input", { className: "qbw-switch", type: "checkbox", checked: biliToQqDraft, onChange: (e) => {
                // 保存时由 normalizedQq 落到 biliBridge.memory.enabled（见主组件）。
                setUnified(["__biliToQqToggle"], e.target.checked);
              } })),
            h("div", { className: "qbw-hint" }, `状态：${biliToQqDraft ? "开" : "关"} · 简报 ${status.biliToQq?.briefChars ?? 0} 字 · ${fmtTime(status.biliToQq?.generatedAt)}`),
            h("div", { className: "qbw-kv" }, h("span", null, "隐私复检"), h("span", null, status.biliToQq?.blocked ? "命中拦截" : "通过")),
            h("div", { className: "qbw-hint" }, "保存后需重启 QQ 桥接才生效（底部「保存并重启 QQ 桥接」）。"),
            h("div", { className: "qbw-actions" },
              h(Btn, { kind: "qbw-btn2", onClick: async () => {
                setBusy("refresh-bili");
                try { const r = await api("/memory", { method: "POST", body: { action: "refresh-bili" } }); toast(r.ok ? "✓ 已刷新" : `✗ ${r.error ?? "失败"}`); await load(); } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
              }, disabled: !!busy }, "立即刷新"))),
          h("div", { className: "qbw-card" },
            h("h4", null, "QQ → B站"),
            h("p", null, "默认关闭。只读白名单群里的公开消息；私信、命令、媒体消息不会进入。"),
            h(Row, { label: "同步 QQ 记忆到 B站", hint: "开启后 B站每次醒来会看到群里的近况（已脱敏）" },
              h("input", { className: "qbw-switch", type: "checkbox", checked: qqToBili.enabled === true, onChange: (e) => setQqToBili("enabled", e.target.checked) })),
            h("div", { className: "qbw-kv" }, h("span", null, "上次同步"), h("span", null, fmtTime(status.qqToBili?.last?.at))),
            h("div", { className: "qbw-kv" }, h("span", null, "保留条数 / 字数"), h("span", null, `${status.qqToBili?.last?.kept ?? 0} 条 / ${status.qqToBili?.chars ?? 0} 字`)),
            h("div", { className: "qbw-kv" }, h("span", null, "丢弃（隐私/命令/媒体）"), h("span", null, status.qqToBili?.last?.dropped ?? 0)),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: syncNow, disabled: !!busy || qqToBili.enabled !== true }, busy === "sync" ? "同步中…" : "立即同步"),
              h(Btn, { kind: "qbw-btn2", onClick: scan, disabled: !!busy }, "扫描身份候选"),
              h(Btn, { kind: "qbw-btn2", onClick: purge, disabled: !!busy }, busy === "purge" ? "清理中…" : "清空 QQ→B站 记忆")))),
        h(AdvancedSettings, { note: "记忆卡规则 / 最近记忆 / 全量卡 / 同步范围 / 注入预览 / 审计：展开后同样可改" },
          h(MemoryCardPanel, { view: "details", data: card, reload: loadCard, busy, setBusy, toast, unified, setUnified, onChanged: () => setFullVersion((v) => v + 1) }),
          h(FullMemoryCardPanel, { reloadKey: fullVersion, busy, toast }),
          h(Section, { title: "同步范围与隐私参数", note: "QQ → B站", collapsible: false },
            h(Row, { label: "回看天数", hint: "只读最近 N 天的公开群消息" },
              h("input", { className: "qbw-input", type: "number", min: 1, max: 90, value: qqToBili.lookbackDays ?? 7, onChange: (e) => setQqToBili("lookbackDays", Number(e.target.value)) })),
            h(Row, { label: "最多消息条数", hint: "防止一次读太多" },
              h("input", { className: "qbw-input", type: "number", min: 20, max: 5000, value: qqToBili.maxMessages ?? 300, onChange: (e) => setQqToBili("maxMessages", Number(e.target.value)) })),
            h(Row, { label: "记忆最大字符", hint: "超过会截断，保留边界说明" },
              h("input", { className: "qbw-input", type: "number", min: 1200, max: 20000, value: qqToBili.maxChars ?? 6000, onChange: (e) => setQqToBili("maxChars", Number(e.target.value)) })),
            h(Row, { label: "包含管理员消息", hint: "默认不包含：管理员消息常含指令/隐私" },
              h("input", { className: "qbw-switch", type: "checkbox", checked: qqToBili.includeOwner === true, onChange: (e) => setQqToBili("includeOwner", e.target.checked) })),
            h(Row, { label: "使用群昵称", hint: "关掉 = 只写「群友」；开 = 用群名片（不带 QQ 号）" },
              h("input", { className: "qbw-switch", type: "checkbox", checked: qqToBili.useNicknames !== false, onChange: (e) => setQqToBili("useNicknames", e.target.checked) })),
            h(Row, { label: "只同步这些群", hint: "逗号分隔群号；留空 = 跟随 allow.groups", },
              h(IdListEditor, {
                value: qqToBili.includeGroups ?? [],
                placeholder: "群号，逗号分隔：123456789，987654321",
                emptyHint: "留空 = 跟随 allow.groups",
                onChange: (list) => setQqToBili("includeGroups", list),
              }))),
          h("div", { className: "qbw-cols" },
            h("div", null,
              h("div", { className: "qbw-group" }, "QQ → B站 预览 ", h("small", null, status.qqToBili?.path ?? "")),
              h("div", { className: "qbw-scroll" }, h("pre", null, data?.qqPreview?.text || "（还没有生成；开启同步后点「立即同步」）"))),
            h("div", null,
              h("div", { className: "qbw-group" }, "B站 → QQ 简报预览 ", h("small", null, status.biliToQq?.path ?? "")),
              h("div", { className: "qbw-scroll" }, h("pre", null, data?.biliPreview || "（还没有生成；点「立即刷新」）")))),
          h(Section, { title: "同步审计（只记数量，不记内容）", note: `${data?.audit?.length ?? 0} 条`, collapsible: false },
            (data?.audit ?? []).slice().reverse().map((item, i) => h("div", { className: "qbw-item", key: i },
              h("div", null,
                h("div", { className: "qbw-label" }, `${item.direction ?? "?"} ${item.ok === false ? "失败" : "成功"}`),
                h("div", { className: "qbw-hint" }, `扫描 ${item.scanned ?? 0} · 保留 ${item.kept ?? 0} · 丢弃 ${item.dropped ?? 0} · 脱敏 ${item.redactions ?? 0} 处 · ${fmtTime(item.at)}`)))))),
        err ? h("div", { className: "qbw-err" }, err) : null);
    }

    // ── 身份对齐 ────────────────────────────────────────────────────────────
    function AlignTab({ busy, setBusy, toast, reload }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const [form, setForm] = useState({ qqId: "", qqName: "", qqGroups: "", biliId: "", biliName: "", label: "", note: "" });
      const load = useCallback(async () => {
        try { const r = await api("/align"); setData(r); setErr(""); } catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      // 旧宿主不会返回 labelsSupported：先禁用称呼输入，避免“提示成功但其实没存进去”。
      const labelsReady = data ? data.labelsSupported === true : true;
      const add = async () => {
        setBusy("align-add");
        try {
          const link = {
            identities: {
              ...(form.qqId ? { qq: { id: form.qqId, name: form.qqName, groups: form.qqGroups.split(/[,，]/).map((s) => s.trim()).filter(Boolean) } } : {}),
              ...(form.biliId ? { bili: { id: form.biliId, name: form.biliName } } : {}),
            },
            label: form.label.trim(),
            source: "manual",
            confidence: 1,
            verified: true,
            note: form.note,
          };
          await api("/align", { method: "POST", body: { action: "add", link } });
          toast(form.label.trim() ? `✓ 已添加对齐：以后只叫「${form.label.trim()}」` : "✓ 已添加对齐");
          setForm({ qqId: "", qqName: "", qqGroups: "", biliId: "", biliName: "", label: "", note: "" });
          await load(); await reload();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const act = async (action, id, extra = {}) => {
        setBusy(action + id);
        try { await api("/align", { method: "POST", body: { action, id, ...extra } }); toast("✓ 完成"); await load(); await reload(); }
        catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      // 只改称呼：简报由宿主立刻重建，下一条 QQ 消息 / B站下一次醒来就生效。
      const saveLabel = async (id, label) => {
        setBusy("align-label-" + id);
        try {
          await api("/align", { method: "POST", body: { action: "update", id, link: { label } } });
          toast(label ? `✓ 以后只叫「${label}」` : "✓ 已清掉称呼");
          await load(); await reload();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const scan = async () => {
        setBusy("align-scan");
        try { const r = await api("/align", { method: "POST", body: { action: "scan" } }); toast(`✓ 扫描完成：QQ +${r.qq?.added ?? 0}，B站 +${r.bili?.added ?? 0}`); await load(); await reload(); }
        catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const exportJson = () => {
        if (!data) return;
        const payload = { exportedAt: new Date().toISOString(), links: data.links };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `qq-bili-align-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      };
      const importFile = (file) => {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const payload = JSON.parse(String(reader.result ?? "{}"));
            setBusy("align-import");
            await api("/align", { method: "POST", body: { action: "import", payload, merge: true } });
            toast("✓ 已导入");
            await load(); await reload();
          } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
        };
        reader.readAsText(file);
      };
      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "这一层高于记忆同步开关：即使两边记忆同步都关掉，只要对齐开着，人格卡仍然认得出同一个人。",
          "给群友填一个「称呼」：以后 QQ 和 B站 都只用这个叫法，不会再叫成 QQ 群名片或 B站昵称那样尴尬。",
          "对齐只存「平台账号 ↔ 平台账号」的映射，不存对话内容；在 B 站公开场合禁止写出 QQ 号/群号。"),
        labelsReady ? null : h("div", { className: "qbw-warnbox" },
          "⚠️ 当前宿主还是旧代码：称呼暂时存不进去（保存也不会报错，但会被丢弃）。重启 DSH 后这里就能用了；其它对齐功能不受影响。"),
        h("div", { className: "qbw-card" },
          h("h4", null, "手动添加"),
          h("div", { className: "qbw-alias" },
            h("div", { className: "qbw-alias-title" },
              "以后只叫他（称呼）",
              h("span", { className: "qbw-badge" }, "优先于群名片 / B站昵称 / 人格卡称呼表")),
            h("div", { className: "qbw-hint" }, "填了称呼：QQ 和 B站 都只用它叫这个人。只有 QQ 或只有 B站 也可以填（那个人只会出现在有账号的那一侧）。留空 = 不设称呼，照旧按昵称叫。"),
            h("input", {
              className: "qbw-input", placeholder: "例如 小零",
              value: form.label,
              disabled: !labelsReady,
              onChange: (e) => setForm((s) => ({ ...s, label: e.target.value })),
            })),
          h("div", { className: "qbw-grid" },
            h("div", null,
              h("div", { className: "qbw-hint" }, "QQ 侧"),
              h("input", { className: "qbw-input", placeholder: "QQ 号", value: form.qqId, onChange: (e) => setForm((s) => ({ ...s, qqId: e.target.value })) }),
              h("input", { className: "qbw-input", placeholder: "群昵称", value: form.qqName, onChange: (e) => setForm((s) => ({ ...s, qqName: e.target.value })) }),
              h("input", { className: "qbw-input", placeholder: "所在群号（逗号分隔，可空）", value: form.qqGroups, onChange: (e) => setForm((s) => ({ ...s, qqGroups: e.target.value })) })),
            h("div", null,
              h("div", { className: "qbw-hint" }, "B站侧"),
              h("input", { className: "qbw-input", placeholder: "B站 mid", value: form.biliId, onChange: (e) => setForm((s) => ({ ...s, biliId: e.target.value })) }),
              h("input", { className: "qbw-input", placeholder: "B站昵称", value: form.biliName, onChange: (e) => setForm((s) => ({ ...s, biliName: e.target.value })) }),
              h("input", { className: "qbw-input", placeholder: "备注（可选）", value: form.note, onChange: (e) => setForm((s) => ({ ...s, note: e.target.value })) }))),
          h("div", { className: "qbw-actions" },
            h(Btn, { onClick: add, disabled: !!busy || (!form.qqId && !form.biliId) }, "添加对齐"),
            h(Btn, { kind: "qbw-btn2", onClick: scan, disabled: !!busy }, "扫描候选"),
            h(Btn, { kind: "qbw-btn2", onClick: exportJson, disabled: !!busy }, "导出"),
            h("label", { className: "qbw-btn qbw-btn2", style: { display: "inline-flex", alignItems: "center", cursor: "pointer" } },
              "导入", h("input", { type: "file", accept: ".json,application/json", style: { display: "none" }, onChange: (e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; } })))),
        h(AdvancedSettings, { note: "候选对齐 / 自动扫描结果：默认不生效，确认后才写入" },
          h(Section, { title: `候选人（${data?.candidates?.length ?? 0}）`, note: "默认需要你批准，不会自动生效", collapsible: false },
            (data?.candidates ?? []).length === 0 ? h("div", { className: "qbw-hint", style: { padding: "6px 0" } }, "（没有候选；群友在群里说「我B站是…」后点「扫描候选」）") :
              (data.candidates ?? []).map((c) => h("div", { className: "qbw-item", key: c.id },
                h("div", null,
                  h("div", { className: "qbw-label" }, `${c.platform === "qq" ? "QQ" : "B站"} ${c.identity?.name || c.identity?.id} → ${c.counterpartPlatform === "qq" ? "QQ" : "B站"} ${c.counterpart?.name || c.counterpart?.id || "（待补）"}`),
                  h("div", { className: "qbw-hint" }, `${c.source} · 置信度 ${(Number(c.confidence) || 0).toFixed(2)} · ${c.evidence || ""}`)),
                h("div", { style: { display: "flex", gap: "6px" } },
                  h(Btn, { onClick: () => act("approve", c.id), disabled: !!busy }, "确认"),
                  h(Btn, { kind: "qbw-btn2", onClick: () => act("reject", c.id), disabled: !!busy }, "否定")))))),
        h(Section, { title: `已对齐（${data?.links?.length ?? 0}）`, note: "QQ ⇄ B站 · 称呼可直接改", defaultOpen: true },
          (data?.links ?? []).length === 0 ? h("div", { className: "qbw-hint", style: { padding: "6px 0" } }, "（还没有对齐记录）") :
            h("table", { className: "qbw-table" },
              h("thead", null, h("tr", null, h("th", null, "QQ"), h("th", null, "B站"), h("th", null, "称呼（只叫这个）"), h("th", null, "来源"), h("th", null, "操作"))),
              h("tbody", null, (data.links ?? []).map((link) => h("tr", { key: link.id },
                h("td", null, `${link.identities?.qq?.name || "?"}`, h("div", { className: "qbw-hint" }, link.identities?.qq?.id ?? "")),
                h("td", null, `${link.identities?.bili?.name || "?"}`, h("div", { className: "qbw-hint" }, link.identities?.bili?.id ?? "")),
                h("td", null, h(AliasCell, { link, onSave: saveLabel, busy: !!busy, disabled: !labelsReady })),
                h("td", null, link.source || "manual"),
                h("td", null, h(Btn, { kind: "qbw-btn2", onClick: () => act("remove", link.id), disabled: !!busy }, "删除"))))))),
        err ? h("div", { className: "qbw-err" }, err) : null);
    }

    // ── 扩展与平台 ──────────────────────────────────────────────────────────
    function ExtensionsTab({ busy, setBusy, toast, reload }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const [configs, setConfigs] = useState({});
      const load = useCallback(async () => {
        try {
          const r = await api("/extensions");
          setData(r);
          const next = {};
          for (const ext of r.extensions ?? []) next[ext.id] = JSON.stringify(ext.config ?? {}, null, 2);
          setConfigs(next);
          setErr("");
        } catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const toggle = async (id, enabled) => {
        setBusy("ext-" + id);
        try { await api("/extensions", { method: "POST", body: { action: "toggle", id, enabled } }); toast(enabled ? "✓ 已启用" : "✓ 已停用"); await load(); await reload(); }
        catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const saveConfig = async (id) => {
        setBusy("extcfg-" + id);
        try {
          const parsed = JSON.parse(configs[id] || "{}");
          await api("/extensions", { method: "POST", body: { action: "config", id, config: parsed } });
          toast("✓ 扩展配置已保存");
          await load();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const reloadExt = async (id) => {
        setBusy("extreload-" + id);
        try { await api("/extensions", { method: "POST", body: { action: "reload", id } }); toast("✓ 已重载"); await load(); }
        catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const platforms = data?.platforms ?? [];
      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "后续功能从这里接：杀戮尖塔启动器、B站自主直播、贴吧，都不需要改主流程。",
          "扩展默认关闭；开启等于允许它在本机执行代码，请只打开你信得过的。"),
        h(AdvancedSettings, { note: "平台接入 / 扩展目录：内置平台和文档入口，平时不用改" },
          h("div", { className: "qbw-group" }, "平台接入 ", h("small", null, "QQ/B站内置，贴吧预留")),
          h("div", { className: "qbw-grid" }, platforms.map((p) => h("div", { className: "qbw-card", key: p.id },
            h("h4", null, p.name, h("span", { className: "qbw-badge " + (p.status === "active" ? "ok" : "warn") }, p.status === "active" ? "已接入" : "预留")),
            h("p", null, `${p.capabilities?.join(" · ") || "—"}`),
            h("div", { className: "qbw-hint" }, `${p.id} · ${p.builtin ? "内置" : "扩展"}`)))),
          h("div", { className: "qbw-hint" },
            "文档：", h("code", { className: "qbw-code" }, "plugins/surfcore/extensions/README.md"), " · ",
            h("code", { className: "qbw-code" }, "docs/EXTENSIONS.md"))),
        h("div", { className: "qbw-group" }, "功能扩展 ", h("small", null, data?.dir ?? "")),
        (data?.extensions ?? []).length === 0 ? h("div", { className: "qbw-hint" }, "（没有扩展包）") : (data.extensions ?? []).map((ext) => h("div", { className: "qbw-card", key: ext.id, style: { marginBottom: "8px" } },
          h("h4", null, ext.name, h("span", { className: "qbw-badge " + (ext.enabled ? "ok" : "") }, ext.enabled ? (ext.active ? "运行中" : "已启用") : "关闭")),
          h("p", null, ext.description || "（无描述）"),
          h("div", { className: "qbw-hint" }, `${ext.id} · v${ext.version} · ${ext.author || "local"} · 能力：${(ext.capabilities ?? []).join("、") || "—"}`),
          ext.routes?.length ? h("div", { className: "qbw-hint" }, `路由：${ext.routes.join(" · ")}`) : null,
          h("div", { className: "qbw-actions" },
            h(Btn, { kind: ext.enabled ? "qbw-btn2" : "", onClick: () => toggle(ext.id, !ext.enabled), disabled: !!busy }, ext.enabled ? "停用" : "启用"),
            h(Btn, { kind: "qbw-btn2", onClick: () => reloadExt(ext.id), disabled: !!busy || !ext.enabled }, "重载")),
          h(Section, { title: "配置 JSON（高级）", note: "保存后立即写扩展配置；不确定的字段先备份" },
            h("textarea", { className: "qbw-textarea", value: configs[ext.id] ?? "{}", onChange: (e) => setConfigs((s) => ({ ...s, [ext.id]: e.target.value })), placeholder: "扩展配置 JSON" }),
            h("div", { className: "qbw-actions" }, h(Btn, { kind: "qbw-btn2", onClick: () => saveConfig(ext.id), disabled: !!busy }, "保存配置"))))),
        err ? h("div", { className: "qbw-err" }, err) : null);
    }

    // ── 全部参数 ────────────────────────────────────────────────────────────
    function AdvancedTab({ qq, bili, unified, setQqPath, setBiliPath, setUnifiedPath, busy }) {
      const [query, setQuery] = useState("");
      const [scope, setScope] = useState("qq");
      const current = scope === "qq" ? qq : scope === "bili" ? bili : unified;
      const setter = scope === "qq" ? setQqPath : scope === "bili" ? setBiliPath : setUnifiedPath;
      const fields = useMemo(() => flattenFields(current ?? {}), [current]);
      const filtered = query.trim()
        ? fields.filter((f) => `${f.label} ${f.path.join(".")}`.toLowerCase().includes(query.trim().toLowerCase()))
        : fields;
      const groups = useMemo(() => {
        const out = new Map();
        for (const f of filtered) {
          const key = f.path.length > 2 ? `${f.path[0]} · ${f.path[1]}` : f.path[0];
          if (!out.has(key)) out.set(key, []);
          out.get(key).push(f);
        }
        return [...out.entries()];
      }, [filtered]);
      return h("div", null,
        h("div", { className: "qbw-dangerbox" },
          "这里是“真正全部”的参数树：上面标签页没列出的键也能在这里改。",
          "改完仍然要按底部「保存」；不确定的键建议先备份。"),
        h("div", { className: "qbw-search" },
          h("select", { className: "qbw-select", value: scope, onChange: (e) => setScope(e.target.value) },
            h("option", { value: "qq" }, "QQ config.json"),
            h("option", { value: "bili" }, "B站 bili.config.json"),
            h("option", { value: "unified" }, "合体 unified config")),
          h("input", { className: "qbw-input", placeholder: "搜索参数名 / 路径", value: query, onChange: (e) => setQuery(e.target.value) }),
          h("span", { className: "qbw-hint" }, `${filtered.length} 项`)),
        groups.length === 0 ? h("div", { className: "qbw-hint" }, "没有匹配项") : groups.map(([group, list]) => h(Section, { key: group, title: group, note: `${list.length} 项`, defaultOpen: Boolean(query.trim()) || groups.length < 8 },
          list.map((f) => h(Field, {
            key: f.path.join("."),
            f: { ...f, hint: f.path.join(".") },
            value: getPath(current, f.path),
            onChange: (v) => setter(f.path, v),
          })))),
        h("div", { className: "qbw-actions" },
          h(Btn, { kind: "qbw-btn2", onClick: () => { setQuery(""); }, disabled: !!busy }, "清空搜索")));
    }

    // ── 诊断 ────────────────────────────────────────────────────────────────
    function DiagnosticsTab({ busy, setBusy, toast, reload }) {
      const [diag, setDiag] = useState(null);
      const [logs, setLogs] = useState(null);
      const [err, setErr] = useState("");
      const [backups, setBackups] = useState([]);
      const [flow, setFlow] = useState(null);   // 一键安装：页面内弹窗（不依赖原生 confirm/prompt）

      const load = useCallback(async () => {
        try {
          const r = await api("/diagnostics");
          setDiag(r);
          setErr("");
        } catch (e) { setErr(e.message); }
        try {
          const c = await api("/config");
          setBackups(c.backups ?? []);
        } catch {}
      }, []);
      useEffect(() => { load(); }, [load]);

      const loadLogs = async () => {
        setBusy("logs");
        try {
          const r = await api("/logs?lines=160");
          setLogs(r);
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const openInstall = async () => {
        setFlow({ phase: "scan", owner: "", selected: [], groups: [], snow: null, steps: [], error: "" });
        try {
          const scan = await api("/diagnostics", { method: "POST", body: { action: "install-scan" } });
          const groups = scan.groups ?? [];
          setFlow({
            phase: "form",
            snow: scan.snow ?? {},
            groups,
            selected: groups.map((g) => g.id),
            owner: scan.snow?.uin || "",
            steps: [],
            error: scan.error || "",
          });
        } catch (e) {
          setFlow({ phase: "error", steps: [], groups: [], selected: [], owner: "", snow: null,
            error: /未知 action/.test(String(e.message)) ? "后端还是旧版本：关掉 DSH 再开一次" : e.message });
        }
      };
      const startInstall = async () => {
        const chosen = flow?.selected ?? [];
        setFlow((f) => ({ ...f, phase: "running", steps: [] }));
        try {
          await api("/diagnostics", { method: "POST", body: {
            action: "install-run",
            ownerQQ: String(flow?.owner ?? "").trim(),
            groups: chosen,
          } });
          for (let i = 0; i < 120; i += 1) {
            await new Promise((r) => setTimeout(r, 2500));
            const d = await api("/diagnostics").catch(() => null);
            if (!d) continue;
            setDiag(d);
            setFlow((f) => (f ? { ...f, steps: d.install?.steps ?? [], phase: d.install?.running ? "running" : "done" } : f));
            if (!d.install?.running) break;
          }
          await reload();
        } catch (e) {
          setFlow((f) => (f ? { ...f, phase: "error", error: e.message } : f));
        }
      };
      const doctorFix = async () => {
        setBusy("doctor");
        try {
          const r = await api("/diagnostics", { method: "POST", body: { action: "doctor-fix" } });
          const changed = r.changed ?? [];
          toast(changed.length
            ? `✓ 已补齐：${changed.join("、")}${r.restartRequired ? "（重启 DSH 生效）" : ""}`
            : "✓ 没有需要补的");
          await load();
        } catch (e) {
          const msg = /未知 action/.test(String(e.message))
            ? "后端还是旧版本：关掉 DSH 再开一次，让插件加载新代码"
            : e.message;
          toast(`✗ ${msg}`);
        } finally { setBusy(""); }
      };
      const backupAll = async () => {
        setBusy("backup");
        try {
          const r = await api("/diagnostics", { method: "POST", body: { action: "backup" } });
          toast(`✓ 已备份 ${r.created?.length ?? 0} 个文件`);
          await load();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const restore = async (name) => {
        if (!confirm(`确定用备份 ${name} 覆盖当前文件？会先自动备份当前文件。`)) return;
        setBusy("restore");
        try {
          const r = await api("/diagnostics", { method: "POST", body: { action: "restore", name } });
          toast(`✓ 已恢复 ${r.target}`);
          await load();
          await reload();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };

      const checkRows = (diag?.checks ?? []).map((c) => h("div", { className: "qbw-kv", key: c.name },
        h("span", null, `${c.level === "warn" ? "⚠️" : c.ok ? "✓" : "✗"} ${c.name}`),
        h("span", null, `${c.detail ?? ""}${c.fix ? ` · 怎么补：${c.fix}` : ""}`)));
      const pathRows = Object.entries(diag?.paths ?? {}).map(([k, v]) => h("div", { className: "qbw-kv", key: k },
        h("span", null, k),
        h("span", null, String(v))));
      const backupRows = backups.slice(0, 20).map((b) => h("div", { className: "qbw-item", key: b.name },
        h("div", null,
          h("div", { className: "qbw-label" }, b.name),
          h("div", { className: "qbw-hint" }, `${fmtBytes(b.bytes)} · ${fmtTime(new Date(b.mtime).toISOString())}`)),
        h(Btn, { kind: "qbw-btn2", onClick: () => restore(b.name), disabled: !!busy }, "恢复")));

      const actionBar = h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: 0, paddingTop: 0 } },
        h(Btn, { kind: "qbw-btn", onClick: openInstall }, "一键安装（全部）"),
        h(Btn, { kind: "qbw-btn2", onClick: doctorFix, disabled: !!busy }, busy === "doctor" ? "配置中…" : "只补缺失项"),
        h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, "重新体检"),
        h(Btn, { kind: "qbw-btn2", onClick: backupAll, disabled: !!busy }, "备份全部配置"));

      const installRows = (diag?.install?.steps ?? []).map((x) => h("div", { className: "qbw-kv", key: x.key + x.at },
        h("span", null, `${x.status === "ok" ? "✓" : x.status === "fail" ? "✗" : "⏳"} ${x.name}`),
        h("span", null, x.detail ?? "")));
      const installCard = (diag?.install?.steps ?? []).length
        ? h("div", { className: "qbw-card" },
            h("h4", null, "一键安装进度 ", h("span", { className: "qbw-badge " + (diag.install.running ? "" : "ok") }, diag.install.running ? "进行中" : "已结束")),
            installRows)
        : null;

      const cards = diag ? h("div", { className: "qbw-grid", style: { marginTop: "8px" } },
        h("div", { className: "qbw-card" },
          h("h4", null, "体检 ", h("span", { className: "qbw-badge " + (diag.ok ? "ok" : "bad") }, diag.ok ? "通过" : "有项不可用")),
          checkRows),
        h("div", { className: "qbw-card" },
          h("h4", null, "路径"),
          pathRows),
        installCard) : null;

      const backupSection = h(Section, { title: `备份（${backups.length}）`, note: "写文件前自动生成", collapsible: false }, backupRows);

      const logBlock = logs ? h("div", null,
        h("div", { className: "qbw-group" }, "插件日志"),
        h("div", { className: "qbw-out" }, logs.plugin || "（空）"),
        h("div", { className: "qbw-group" }, "桥接日志"),
        h("div", { className: "qbw-out" }, logs.bridge || "（空）")) : null;

      const installModal = flow ? h("div", {
        style: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" },
        onClick: (e) => { if (e.target === e.currentTarget && flow.phase !== "running") setFlow(null); },
      },
        h("div", {
          style: { width: "min(620px, 92vw)", maxHeight: "80vh", overflow: "auto", background: "var(--qbw-bg2, #1b1d21)", border: "1px solid var(--qbw-line, #333)", borderRadius: "10px", padding: "16px 18px", boxShadow: "0 12px 40px rgba(0,0,0,0.5)" },
        },
          h("h3", { style: { margin: "0 0 10px" } }, flow.phase === "done" ? "安装完成" : flow.phase === "error" ? "安装中断" : "一键安装"),

          flow.phase === "scan" ? h("div", { className: "qbw-hint" }, "正在探测 SnowLuma（端口 / token / 群列表）…") : null,
          flow.phase === "error" ? h("div", null,
            h("div", { className: "qbw-err" }, flow.error || "未知错误"),
            h("div", { className: "qbw-hint", style: { marginTop: "8px" } }, "常见原因：DSH 里跑的还是旧版本（关掉 DSH 再开一次），或 SnowLuma 没登录。")) : null,

          flow.phase === "form" ? h("div", null,
            h("div", { className: "qbw-hint", style: { marginBottom: "8px" } },
              flow.snow?.online ? `已连上 SnowLuma：${flow.snow.nickname || ""}（${flow.snow.uin || "?"}）` : `没连上 SnowLuma：${flow.error || "先启动并扫码登录"}`),
            h("div", { className: "qbw-group" }, "主人 QQ（你的号，不是机器人号）"),
            h("input", { className: "qbw-input", value: flow.owner, onChange: (e) => setFlow({ ...flow, owner: e.target.value }), style: { width: "100%" } }),
            h("div", { className: "qbw-group", style: { marginTop: "10px" } }, `把哪些群加进白名单（${flow.groups.length} 个）`),
            flow.groups.length === 0
              ? h("div", { className: "qbw-hint" }, "她还没进任何群。装好后把她拉进群，再到「QQ → 白名单」加群号。")
              : h("div", null, flow.groups.map((g) => h("label", { key: g.id, style: { display: "flex", gap: "8px", alignItems: "center", padding: "4px 0" } },
                  h("input", { type: "checkbox", checked: flow.selected.includes(g.id), onChange: (e) => setFlow({
                    ...flow,
                    selected: e.target.checked ? [...flow.selected, g.id] : flow.selected.filter((x) => x !== g.id),
                  }) }),
                  h("span", null, `${g.name}（${g.id}）`)))),
            h("div", { className: "qbw-hint", style: { marginTop: "8px" } }, "不会自动放行：只有你勾选的群会被加白。")) : null,

          flow.phase === "running" || flow.phase === "done" ? h("div", null,
            (() => {
              const steps = flow.steps ?? [];
              const done = steps.filter((x) => x.status === "ok" || x.status === "fail").length;
              const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
              const cur = steps.find((x) => x.status !== "ok" && x.status !== "fail");
              return h(ProgressBar, {
                pct,
                phase: flow.phase === "done" ? "安装完成" : `第 ${done + 1}/${steps.length || "?"} 步：${cur?.name ?? "准备中"}`,
                indeterminate: flow.phase === "running" && !cur,
              });
            })(),
            (flow.steps ?? []).map((x) => h("div", { className: "qbw-kv", key: x.key + x.at },
              h("span", null, `${x.status === "ok" ? "✓" : x.status === "fail" ? "✗" : "⏳"} ${x.name}`),
              h("span", null, x.detail ?? ""))),
            flow.phase === "running" ? h("div", { className: "qbw-hint", style: { marginTop: "10px" } }, "安装中，请别关这个窗口…") : null,
            flow.phase === "done" ? h("div", { className: "qbw-hint", style: { marginTop: "10px" } }, "如果刚注册过 DSH 组件，需要重启 DSH 才生效。") : null) : null,

          h("div", { className: "qbw-actions", style: { marginTop: "14px" } },
            flow.phase === "form" ? h(Btn, { kind: "qbw-btn", onClick: startInstall }, "开始安装") : null,
            flow.phase === "form" ? h(Btn, { kind: "qbw-btn2", onClick: () => setFlow(null) }, "取消") : null,
            flow.phase === "done" || flow.phase === "error" ? h(Btn, { kind: "qbw-btn", onClick: () => setFlow(null) }, "关闭") : null))) : null;

      return h("div", null,
        actionBar,
        cards,
        installModal,
        h(AdvancedSettings, { note: "备份恢复 / 插件与桥接日志：排障时再展开" },
          h("div", { className: "qbw-actions" }, h(Btn, { kind: "qbw-btn2", onClick: loadLogs, disabled: !!busy }, busy === "logs" ? "读取中…" : "读取日志")),
          backupSection,
          logBlock),
        err ? h("div", { className: "qbw-err" }, err) : null);
    }
    // ── 角色人格（角色包 + 人格卡 + 记忆卡 + 存档）──────────────────────────
    // 数据层在 src/character-persona.js：每个角色一个目录包，切换时整套人格/记忆/行为账本
    // 一起换；这里只做管理界面，不直接改 memory-card.json。
    function CharactersTab({ overview, busy, setBusy, toast, reload, goTab, unified, setUnified }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const [name, setName] = useState("");
      const [personaText, setPersonaText] = useState("");
      const [memoryText, setMemoryText] = useState("");
      const [fullText, setFullText] = useState("");
      const [showCreate, setShowCreate] = useState(false);
      const load = useCallback(async () => {
        try {
          const r = await api("/characters");
          setData(r);
          setErr("");
        } catch (e) { setErr(`读取角色失败：${e.message}`); }
      }, []);
      useEffect(() => { void load(); }, [load]);
      const act = async (action, extra = {}, okText = "✓ 已完成") => {
        setBusy(`character-${action}`);
        try {
          const r = await api("/characters", { method: "POST", body: { action, ...extra } });
          if (r.ok === false) throw new Error(r.error ?? "失败");
          toast(okText);
          await load();
          if (action === "load" || action === "restore" || action === "create") await reload?.();
          await new Promise((resolve) => setTimeout(resolve, 300));
          return r;
        } catch (e) { toast(`✗ ${e.message}`); return null; } finally { setBusy(""); }
      };
      const current = data?.current ?? null;
      const characters = data?.characters ?? [];
      const snapshots = data?.snapshots ?? [];
      const percent = Number(overview?.memoryCard?.percent ?? 0);
      return h("div", null,
        h("div", { className: "qbw-admin" },
          h("div", { className: "qbw-admin-head" },
            h("div", null,
              h("div", { className: "qbw-admin-title" },
                "角色人格",
                current ? h("span", { className: "qbw-badge ok" }, current.name) : h("span", { className: "qbw-badge warn" }, "还没有角色")),
              h("div", { className: "qbw-hint" },
                "一个角色 = 一份人格卡 + 一张衰减记忆卡 + 全量记忆卡 + B站 行为账本。加载别的角色会先把当前角色存档；切换时人格、记忆、当天额度/动态/看过的视频全都按角色隔离。人格卡就在本页下面直接编辑。"))),
          h("div", { className: "qbw-admin-grid" },
            h("div", { className: "qbw-admin-field" },
              h("span", null, "当前角色"),
              h("div", { className: "qbw-input", style: { display: "flex", alignItems: "center" } }, current ? `${current.name}（epoch ${current.epoch}）` : "（未加载）")),
            h("div", { className: "qbw-admin-field" },
              h("span", null, "记忆卡"),
              h("div", { className: "qbw-input", style: { display: "flex", alignItems: "center" } }, `${percent}% · ${snapshots.length} 个存档`))),
          h("div", { className: "qbw-admin-foot" },
            current ? h(Btn, { kind: "qbw-btn2", onClick: () => act("snapshot", { id: current.id, label: "手动" }, "✓ 已存一份"), disabled: !!busy }, "立即存档") : null,
            current ? h(Btn, { kind: "qbw-btn2", onClick: () => act("auto-snapshot", { id: current.id }, "✓ 自动存档已更新"), disabled: !!busy }, "更新自动存档") : null,
            current ? h(Btn, { kind: "qbw-btn2", onClick: () => goTab?.("memory") }, "管理记忆卡") : null,
            current ? h(Btn, { kind: "qbw-btn2", onClick: () => act("test", {}, "✓ 已私聊管理员一句测试"), disabled: !!busy }, "测试当前人设") : null,
            h(Btn, { onClick: () => setShowCreate((v) => !v) }, showCreate ? "收起新建" : "新建角色"))),
        err ? h("div", { className: "qbw-err" }, err) : null,
        h(PersonaEditor, { busy, setBusy, toast, unified, setUnified }),
        showCreate ? h("div", { className: "qbw-card", style: { marginTop: "10px" } },
          h("h4", null, "新建角色"),
          h("div", { className: "qbw-hint" }, "可以只填名字（空人格卡/空记忆卡），也可以把你自己预设的人格卡、记忆卡 JSON 一起导入。"),
          h("div", { className: "qbw-row" }, h("span", { className: "qbw-label" }, "角色名"), h("input", { className: "qbw-input", value: name, placeholder: "例如 小咪", onChange: (e) => setName(e.target.value) })),
          h("div", { className: "qbw-hint", style: { marginTop: "8px" } }, "人格卡（Markdown）"),
          h("input", { type: "file", accept: ".md,.txt,text/markdown,text/plain", onChange: async (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) setPersonaText(await file.text());
          } }),
          h("textarea", { className: "qbw-textarea", value: personaText, placeholder: "# 角色卡：名字\n\n你是谁、说话方式…", onChange: (e) => setPersonaText(e.target.value) }),
          h("div", { className: "qbw-hint", style: { marginTop: "8px" } }, "记忆卡 JSON（可选；需要 records 数组）"),
          h("input", { type: "file", accept: ".json,application/json", onChange: async (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) setMemoryText(await file.text());
          } }),
          h("textarea", { className: "qbw-textarea", value: memoryText, placeholder: "{\"version\":1,\"records\":[]}", onChange: (e) => setMemoryText(e.target.value) }),
          h("div", { className: "qbw-hint", style: { marginTop: "8px" } }, "全量记忆 JSONL（可选；每行一个 JSON；只存档、不加载到提示词）"),
          h("input", { type: "file", accept: ".jsonl,.json,text/plain", onChange: async (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) setFullText(await file.text());
          } }),
          h("textarea", { className: "qbw-textarea", value: fullText, placeholder: "{\"id\":\"...\"}\n{\"id\":\"...\"}", onChange: (e) => setFullText(e.target.value) }),
          h("div", { className: "qbw-actions" },
            h(Btn, { onClick: async () => {
              if (!name.trim()) { toast("✗ 先填角色名"); return; }
              let memoryCard;
              if (memoryText.trim()) { try { memoryCard = JSON.parse(memoryText); } catch { toast("✗ 记忆卡不是合法 JSON"); return; } }
              const r = await act("create", { name: name.trim(), personaText, memoryCard, fullRecords: fullText, load: true }, "✓ 角色已创建并加载");
              if (r) { setName(""); setPersonaText(""); setMemoryText(""); setFullText(""); setShowCreate(false); }
            }, disabled: !!busy }, "创建并加载"),
            h(Btn, { kind: "qbw-btn2", onClick: async () => {
              if (!name.trim()) { toast("✗ 先填角色名"); return; }
              let memoryCard;
              if (memoryText.trim()) { try { memoryCard = JSON.parse(memoryText); } catch { toast("✗ 记忆卡不是合法 JSON"); return; } }
              const r = await act("create", { name: name.trim(), personaText, memoryCard, fullRecords: fullText }, "✓ 角色已创建");
              if (r) { setName(""); setPersonaText(""); setMemoryText(""); setFullText(""); setShowCreate(false); }
            }, disabled: !!busy }, "只创建"))) : null,
        h(Section, { title: `全部角色（${characters.length}）`, note: "加载别的角色会自动保存当前角色", defaultOpen: true },
          characters.length ? characters.map((item) => h("div", { key: item.id, className: "qbw-item" },
            h("div", null,
              h("div", { className: "qbw-label" }, item.name,
                item.current ? h("span", { className: "qbw-badge ok" }, "当前") : null,
                h("span", { className: "qbw-badge" }, item.snapshots ?? 0, " 档")),
              h("div", { className: "qbw-hint" }, `人格 ${item.personaChars ?? 0} 字 · 全量记忆 ${fmtBytes(item.fullMemoryBytes)} · 更新 ${fmtTime(item.updatedAt)}`)),
            h("div", { className: "qbw-rec-actions" },
              item.current ? null : h(Btn, { onClick: () => act("load", { id: item.id }, `✓ 已加载「${item.name}」`), disabled: !!busy }, busy === `character-load` ? "切换中…" : "加载"),
              item.current ? null : h(Btn, { kind: "qbw-btn2", onClick: async () => {
                if (!confirm(`删除角色「${item.name}」？不会硬删：整个目录会移进 backups/deleted-character-*，可手动恢复。`)) return;
                await act("delete", { id: item.id }, "✓ 已归档删除");
              }, disabled: !!busy }, "删除")))) : h("div", { className: "qbw-hint" }, "还没有角色；点上方「新建角色」。")),
        h(AdvancedSettings, { note: "存档 / 回档 / 自动存档规则：低频操作，展开再用" },
          h(Section, { title: `存档（${snapshots.length}）`, note: "自动存档 12 槽 · 手动/切换前不覆盖", collapsible: false },
            snapshots.length ? snapshots.map((item) => h("div", { key: item.slot, className: "qbw-item" },
              h("div", null,
                h("div", { className: "qbw-label" }, item.slot,
                  item.slot === "before-switch" ? h("span", { className: "qbw-badge warn" }, "切换前") : null),
                h("div", { className: "qbw-hint" }, `${fmtTime(item.createdAt)} · ${item.reason || ""} · 记忆 ${fmtBytes(item.memoryBytes)}`)),
              current ? h(Btn, { kind: "qbw-btn2", onClick: async () => {
                if (!confirm(`把「${current.name}」回档到 ${item.slot}？会先给当前状态再存一份。`)) return;
                await act("restore", { id: current.id, slot: item.slot }, "✓ 已回档");
              }, disabled: !!busy }, "回档") : null)) : h("div", { className: "qbw-hint" }, "还没有存档；切换角色或点「立即存档」。")),
          h("div", { className: "qbw-hint" }, "自动存档：180 / 90 / 60 / 30 / 15 / 10 / 7 / 5 / 3 / 2 / 1 天 + 每次切换前；全量记忆是 append-only，回档不会删掉后来真正发生过的记忆。")));
    }

    // ── 每日 token 额度（2026-10-23 用户要求）─────────────────────────────
    // 一个页面管三件事：
    //   · 分项额度：QQ / B站 / 其他（黑话学习等）；
    //   · 总额度：SurfCore 所有花费的天花板；
    //   · 今日用量 + 80% 提醒（提醒由主组件统一弹，服务端保证每天只给一次）。
    //
    // 金额和 token 可以同时填：两种单位各自比较，谁先到 80% 谁触发提醒，
    // 谁先到 100% 谁拦截。快捷按钮只在本地加数，点底部「保存」才写盘。
    const CNY_CHIPS = [1, 3, 5, 10];
    const TOKEN_CHIPS = [20e6, 50e6, 100e6, 200e6];

    function parseBudgetInput(text, unit) {
      const raw = String(text ?? "").trim();
      if (!raw) return null;
      if (unit === "cny") {
        const cleaned = raw.replace(/[¥￥]/g, "").replace(/(?:人民币|元|块|CNY|cny)/gi, "").replace(/[,\s，]/g, "");
        if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return undefined;
        const n = Number(cleaned);
        return Number.isFinite(n) && n > 0 ? Math.round(n * 10000) / 10000 : null;
      }
      const cleaned = raw.replace(/(?:tokens?|个)/gi, "").replace(/[,\s，]/g, "").toLowerCase();
      const m = cleaned.match(/^(\d+(?:\.\d+)?)(k|m|b|万|亿)?$/);
      if (!m) return undefined;
      const base = Number(m[1]);
      const mult = m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : m[2] === "b" ? 1e9
        : m[2] === "万" ? 1e4 : m[2] === "亿" ? 1e8 : 1;
      const n = base * mult;
      return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }

    function formatBudgetInput(value, unit) {
      if (value == null || !Number.isFinite(Number(value)) || Number(value) <= 0) return "";
      const n = Number(value);
      if (unit === "cny") return String(Math.round(n * 10000) / 10000);
      if (n >= 1e6 && n % 1e6 === 0) return `${n / 1e6}M`;
      if (n >= 1e4 && n % 1e4 === 0) return `${n / 1e4}万`;
      return String(n);
    }

    const fmtMoney = (n) => `¥${(Number(n) || 0).toFixed(2)}`;
    const fmtTokenNum = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");
    const fmtBudgetValue = (n, unit) => (unit === "cny" ? fmtMoney(n) : `${fmtTokenNum(n)} token`);
    const budgetRatio = (used, limit) => (Number(limit) > 0 ? (Number(used) || 0) / Number(limit) : null);
    const fmtPercent = (r) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);

    function LimitField({ label, unit, value, onChange, disabled, hint }) {
      const [text, setText] = useState(() => formatBudgetInput(value, unit));
      const focused = useRef(false);
      useEffect(() => {
        if (!focused.current) setText(formatBudgetInput(value, unit));
      }, [value, unit]);
      const commit = (raw) => {
        const parsed = parseBudgetInput(raw, unit);
        if (parsed === undefined) {
          setText(formatBudgetInput(value, unit));
          return;
        }
        setText(formatBudgetInput(parsed, unit));
        onChange(parsed);
      };
      return h("label", { className: "qbw-budget-field" },
        h("span", null, label),
        h("input", {
          className: "qbw-input",
          inputMode: unit === "cny" ? "decimal" : "numeric",
          value: text,
          disabled,
          placeholder: unit === "cny" ? "¥8 / 8元 / 留空 = 不限" : "8M / 8000000 / 留空 = 不限",
          onFocus: () => { focused.current = true; },
          onChange: (e) => {
            const next = e.target.value;
            setText(next);
            const parsed = parseBudgetInput(next, unit);
            if (parsed !== undefined) onChange(parsed);
          },
          onBlur: () => { focused.current = false; commit(text); },
          onKeyDown: (e) => { if (e.key === "Enter") e.currentTarget.blur(); },
        }),
        hint ? h("small", null, hint) : null);
    }

    function BudgetChips({ unit, onAdd, disabled }) {
      const list = unit === "cny" ? CNY_CHIPS : TOKEN_CHIPS;
      return h("div", { className: "qbw-chips" }, list.map((amount) => h("button", {
        key: amount,
        type: "button",
        className: "qbw-chip",
        disabled,
        onClick: () => onAdd(amount),
      }, amount >= 1e6 ? `+${amount / 1e6}M` : `+${amount}${unit === "cny" ? "元" : " token"}`)));
    }

    function BudgetMeter({ ratio, used, limit, unit }) {
      if (limit == null) {
        return h("div", { className: "qbw-budget-meter-empty" },
          h("span", null, "未设上限"),
          h("span", null, `今日 ${fmtBudgetValue(used, unit)}`));
      }
      const r = Number(ratio) || 0;
      const cls = r >= 1 ? "bad" : r >= 0.8 ? "warn" : "";
      return h("div", { className: "qbw-budget-meter" },
        h("div", { className: "qbw-meter-head" },
          h("span", null, `今日 ${fmtBudgetValue(used, unit)} / ${fmtBudgetValue(limit, unit)}`),
          h("b", { className: r >= 1 ? "qbw-err" : r >= 0.8 ? "qbw-dirty" : "" }, fmtPercent(ratio))),
        h("div", { className: "qbw-meter " + cls }, h("i", { style: { width: `${Math.min(100, Math.max(0, r * 100))}%` } })));
    }

    function BudgetScopeCard({
      scope, title, subtitle, usage, limits, ratios, blocked, onChange, disabled, total = false, extra = null,
    }) {
      const pair = limits?.[scope] ?? { cny: null, tokens: null };
      const setUnit = (unit, value) => onChange(scope, { ...pair, [unit]: value });
      const add = (unit, amount) => setUnit(unit, Math.round(((pair[unit] ?? 0) + amount) * 10000) / 10000);
      const maxRatio = Math.max(ratios?.cny ?? 0, ratios?.tokens ?? 0);
      const unlimited = pair.cny == null && pair.tokens == null;
      const state = blocked ? "已达上限" : maxRatio >= 0.8 ? "已到 80%" : unlimited ? "不限" : "正常";
      const badge = blocked ? "bad" : maxRatio >= 0.8 ? "warn" : unlimited ? "" : "ok";
      return h("div", { className: "qbw-card qbw-budget-card" + (total ? " total" : "") },
        h("div", { className: "qbw-budget-head" },
          h("div", null,
            h("h4", null, title, h("span", { className: "qbw-badge " + badge, style: { marginLeft: "8px" } }, state)),
            h("p", null, subtitle)),
          h("div", { className: "qbw-budget-today" },
            h("b", null, fmtMoney(usage?.cost)),
            h("span", null, `${fmtTokenNum(usage?.tokens)} token`))),
        h("div", { className: "qbw-budget-lines" },
          h("div", { className: "qbw-budget-line" },
            h(LimitField, {
              label: "人民币额度",
              unit: "cny",
              value: pair.cny,
              disabled,
              onChange: (v) => setUnit("cny", v),
              hint: "支持 ¥8 / 8元；留空 = 这一单位不限",
            }),
            h(BudgetChips, { unit: "cny", onAdd: (n) => add("cny", n), disabled }),
            pair.cny != null ? h("button", { type: "button", className: "qbw-chip", onClick: () => setUnit("cny", null), disabled }, "清空") : null),
          h("div", { className: "qbw-budget-line" },
            h(LimitField, {
              label: "token 额度",
              unit: "tokens",
              value: pair.tokens,
              disabled,
              onChange: (v) => setUnit("tokens", v),
              hint: "支持 8M / 8000000 / 2万；留空 = 这一单位不限",
            }),
            h(BudgetChips, { unit: "tokens", onAdd: (n) => add("tokens", n), disabled }),
            pair.tokens != null ? h("button", { type: "button", className: "qbw-chip", onClick: () => setUnit("tokens", null), disabled }, "清空") : null)),
        h("div", { className: "qbw-budget-meters" },
          h(BudgetMeter, { ratio: ratios?.cny, used: usage?.cost, limit: pair.cny ?? null, unit: "cny" }),
          h(BudgetMeter, { ratio: ratios?.tokens, used: usage?.tokens, limit: pair.tokens ?? null, unit: "tokens" })),
        extra ? h("div", { className: "qbw-budget-extra" }, extra) : null);
    }

    function TokenTab({ budget, limits, onChange, disabled, alertedToday, onSave, busy, toast }) {
      useStyleOnce();
      if (!budget || !limits) {
        return h("div", { className: "qbw-hint" }, "正在读取额度与今日用量…");
      }
      const usage = budget.usage ?? {};
      const ratios = budget.ratios ?? {};
      const blocked = budget.blocked ?? {};
      const totalPair = limits.total ?? { cny: null, tokens: null };
      const setScope = (scope, pair) => onChange({ ...limits, [scope]: pair });
      const sum = (unit) => {
        const n = ["qq", "bili", "other"].reduce((acc, key) => acc + (Number(limits[key]?.[unit]) || 0), 0);
        return n > 0 ? Math.round(n * 10000) / 10000 : null;
      };
      const totalRatio = Math.max(ratios.total?.cny ?? 0, ratios.total?.tokens ?? 0);
      const alertedText = alertedToday?.at ? fmtTime(new Date(alertedToday.at).toISOString()) : "";
      return h("div", null,
        h("div", { className: "qbw-budget-summary" },
          h("div", null,
            h("div", { className: "qbw-kicker" }, `今日 · ${budget.day ?? "—"} · 每天 00:00 重置`),
            h("div", { className: "qbw-budget-big" },
              h("b", null, fmtMoney(usage.total?.cost)),
              h("span", null, `${fmtTokenNum(usage.total?.tokens)} token`)),
            h("div", { className: "qbw-hint" },
              "数据来源：DSH session/event 实时累计（QQ + B站 + 黑话学习等）。",
              totalPair.cny != null || totalPair.tokens != null
                ? ` 总额度已用 ${fmtPercent(totalRatio)}。`
                : " 还没设总额度。")),
          h("div", { className: "qbw-budget-status" },
            blocked.total ? h("span", { className: "qbw-badge bad" }, "总额已达上限：QQ 不再唤醒 / B站 不再叫醒") : null,
            alertedToday ? h("span", { className: "qbw-badge warn" }, `今天已提醒过${alertedText ? `（${alertedText}）` : ""}`) : null,
            h("span", { className: "qbw-badge" }, `价目表 ${budget.priceTable?.version ?? "—"}`),
            budget.source ? h("span", { className: "qbw-badge" }, budget.source) : null)),
        h("div", { className: "qbw-budget-grid" },
          h(BudgetScopeCard, {
            scope: "qq",
            title: "QQ",
            subtitle: "群聊 + 私聊 + 被 @ 唤醒；到上限后不再唤醒，消息留在未读。",
            usage: usage.qq,
            limits,
            ratios: ratios.qq,
            blocked: blocked.qq,
            onChange: setScope,
            disabled,
          }),
          h(BudgetScopeCard, {
            scope: "bili",
            title: "B站",
            subtitle: "生物钟叫醒、评论区倾听、私信、直播间、动态提醒；到上限后暂停叫醒。",
            usage: usage.bili,
            limits,
            ratios: ratios.bili,
            blocked: blocked.bili,
            onChange: setScope,
            disabled,
          }),
          h(BudgetScopeCard, {
            scope: "other",
            title: "其他花费",
            subtitle: "黑话学习 / 黑话研究等后台任务；也计入 SurfCore 总额。",
            usage: usage.other,
            limits,
            ratios: ratios.other,
            blocked: blocked.other,
            onChange: setScope,
            disabled,
          }),
          h(BudgetScopeCard, {
            scope: "total",
            title: "SurfCore 总额度",
            subtitle: "整个插件的天花板：QQ + B站 + 其他一起算；任一单位到 100% 就同时停两边。",
            usage: usage.total,
            limits,
            ratios: ratios.total,
            blocked: blocked.total,
            onChange: setScope,
            disabled,
            total: true,
            extra: h("div", null,
              h("div", { className: "qbw-budget-quick" },
                h("span", { className: "qbw-hint" }, "一键设置："),
                h("button", {
                  type: "button", className: "qbw-chip", disabled,
                  onClick: () => setScope("total", { cny: 8, tokens: null }),
                }, "设为 ¥8"),
                h("button", {
                  type: "button", className: "qbw-chip", disabled,
                  onClick: () => setScope("total", { cny: null, tokens: 8_000_000 }),
                }, "设为 8M"),
                h("button", {
                  type: "button", className: "qbw-chip", disabled,
                  onClick: () => setScope("total", { cny: sum("cny"), tokens: sum("tokens") }),
                }, "= QQ+B站+其他 之和"),
                h("button", {
                  type: "button", className: "qbw-chip" + ((totalPair.cny != null || totalPair.tokens != null) ? " on" : ""), disabled,
                  onClick: () => {
                    if (totalPair.cny == null && totalPair.tokens == null) {
                      toast?.("先给总额度填一个数，再点「只留总额度」");
                      return;
                    }
                    onChange({
                      ...limits,
                      qq: { cny: null, tokens: null },
                      bili: { cny: null, tokens: null },
                      other: { cny: null, tokens: null },
                    });
                  },
                }, "只留总额度"),
                h("button", {
                  type: "button", className: "qbw-chip", disabled,
                  onClick: () => setScope("total", { cny: null, tokens: null }),
                }, "清空总额")),
              h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
                "总限额是额外天花板：QQ / B站 的分项额度仍然各自生效，两者谁先到就按谁停。"))}),
        ),
        h("div", { className: "qbw-budget-note" },
          h("div", { className: "qbw-hint" },
            "· 金额与 token 是两套独立额度：可以只填一种，也可以两种都填；两种都填时先到的那条生效。",
            "· 80% 弹窗每天只弹第一次（分项或总额都算）；之后同一天其他项再到 80% 不再打扰，页面右上角会保留「今天已提醒过」。",
            "· 保存后立即生效：QQ 下一次唤醒、B站 下一次叫醒开始按新额度判断。"),
          h(Btn, { onClick: onSave, disabled: !!busy }, busy === "save" ? "保存中…" : "保存额度")));
    }

    // ── 桌宠页：独立栏目，默认不安装，用户自己装 ───────────────────────────
    function PetTab({ toast, unified, setUnified }) {
      const [st, setSt] = useState(null);
      const [busy, setBusy] = useState("");
      const [err, setErr] = useState("");
      const [form, setForm] = useState({ source: "", electronPath: "", appDir: "", mirror: "" });
      const chatCfg = unified?.pet?.chat && typeof unified.pet.chat === "object" ? unified.pet.chat : {};
      const setChat = (key, value) => setUnified?.(["pet", "chat", key], value);

      const read = useCallback(async () => {
        try {
          const r = await api("/pet/status");
          setSt(r);
          setForm((f) => ({
            source: (r.source && r.source.trim()) ? r.source : (r.installed ? f.source : (r.defaults?.zipUrl || f.source)),
            electronPath: (r.electronPath && r.electronPath.trim()) ? r.electronPath : (r.electronDetected || f.electronPath),
            appDir: r.appDir ?? f.appDir,
            mirror: r.mirror ?? f.mirror ?? "",
          }));
          setErr("");
        } catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { read(); }, [read]);

      const act = async (action, body, busyKey) => {
        setBusy(busyKey || action); setErr("");
        try {
          const r = await api("/pet/" + action, { method: "POST", body: body ?? {} });
          if (r.ok === false) { setErr(r.error || "操作失败"); return; }
          if (toast) toast(action === "install" ? "✓ 桌宠安装完成" : action === "start" ? "✓ 桌宠已启动" : action === "stop" ? "✓ 桌宠已停止" : action === "remove" ? "✓ 桌宠已卸载" : "✓ 已保存");
          await read();
        } catch (e) { setErr(e.message); }
        finally { setBusy(""); }
      };

      // 专注模式：写 pet/focus.json（桌宠菜单也改同一份），并推事件让桌面立刻收住。
      const actFocus = async (enabled) => {
        setBusy("focus"); setErr("");
        try {
          const r = await api("/pet/focus", { method: "POST", body: { enabled, source: "settings" } });
          if (r.ok === false) throw new Error(r.error || "设置失败");
          if (toast) toast(`✓ 专注模式已${enabled ? "开启：不再主动打扰" : "关闭"}`);
          await read();
        } catch (e) { setErr(e.message); }
        finally { setBusy(""); }
      };

      const fmt = (n) => {
        const v = Number(n) || 0;
        return v > 1024 * 1024 ? (v / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(v / 1024)) + " KB";
      };
      const kv = (k, v) => h("div", { className: "qbw-kv", key: k }, h("span", null, k), h("span", null, v));

      return h("div", null,
        h("div", { className: "qbw-infobox" },
          "桌宠是独立组件：不随 SurfCore 安装，也不影响 QQ / B站 / 记忆 / 语音。",
          "填安装包地址 → 安装 → 填 Electron 路径 → 启动。卸载只删 ~/.dsh/surfcore/pet/app，不碰你的皮肤工程。"),
        h("div", { className: "qbw-card" },
          h("h4", null, "运行状态"),
          kv("状态", st ? (st.running ? "● 运行中" : st.installed ? "○ 已安装 · 未运行" : "未安装") : "读取中…"),
          st && st.installed ? kv("版本", st.version || "—") : null,
          st && st.installed ? kv("占用", fmt(st.sizeBytes)) : null,
          st && st.installed ? kv("目录", h("code", { className: "qbw-code" }, st.dir)) : null,
          st && st.installing ? h(ProgressBar, { pct: st.installing.progress, phase: st.installing.phase, err: st.installing.error, indeterminate: /依赖|模型/.test(String(st.installing.phase || '')) && Number(st.installing.progress || 0) >= 99 }) : null,
          h("div", { className: "qbw-actions" },
            !st || !st.installed ? h(Btn, { disabled: busy === "install" || !form.source.trim(), onClick: async () => {
              const r0 = await api("/pet/install", { method: "POST", body: {} }).catch((e) => ({ ok: false, error: e.message }));
              if (r0 && r0.ok === false) { setErr(r0.error); return; }
              setBusy("install");
              for (let i = 0; i < 600; i += 1) {
                await new Promise((r) => setTimeout(r, 1200));
                const cur = await api("/pet/status").catch(() => null);
                if (!cur) continue;
                setSt(cur);
                const job = cur.installing;
                if (!job) break;
                if (job.phase === "失败") { setErr(job.error || "安装失败"); break; }
                if (job.phase === "完成") break;
              }
              setBusy("");
              if (toast) toast("✓ 安装流程结束");
              await read();
            } }, busy === "install" ? "安装中…" : "安装") : null,
            !st || !st.installed ? h("span", { style: { fontSize: "12px", opacity: 0.7 } }, form.source.trim() ? "" : "← 先在下方「安装设置」填安装包地址，按钮才可点") : null,
            err ? h("div", { className: "qbw-err", style: { width: "100%", marginTop: "6px" } }, err) : null,
            err ? h("div", { style: { display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" } },
              h(Btn, { kind: "qbw-btn2", onClick: () => setForm((f) => ({ ...f, source: st?.defaults?.zipUrl || "https://github.com/Mieksido/surfpet/releases/latest/download/pet-pack.zip" })) }, "用官方最新版"),
              h(Btn, { kind: "qbw-btn2", onClick: async () => {
                setBusy("clean"); setErr("");
                try {
                  const r = await api("/pet/clean", { method: "POST", body: {} });
                  if (r.ok === false) { setErr(r.error || "清理失败"); return; }
                  if (toast) toast("✓ 已清理安装目录，可以重新安装");
                  await read();
                } catch (e) { setErr(e.message); } finally { setBusy(""); }
              } }, busy === "clean" ? "清理中…" : "清理残留后重试")) : null,
            st && st.installed && !st.running ? h(Btn, { onClick: () => act("start"), disabled: !!busy }, "启动") : null,
            st && st.installed && st.running ? h(Btn, { kind: "qbw-btn2", onClick: () => act("stop"), disabled: !!busy }, "停止") : null,
            st && st.installed ? h(Btn, { kind: "qbw-btn2", onClick: () => act("remove"), disabled: !!busy }, "卸载") : null)),
        h("div", { className: "qbw-card", style: { marginTop: "10px" } },
          h("h4", null, "安装设置"),
          h("div", { className: "qbw-hint", style: { margin: "4px 0 8px" } }, "安装包：zip 的本地路径或 http(s) 链接；Electron：本机 electron.exe 的完整路径（安装包不带运行时）。"),
          h("div", { className: "qbw-row" }, h("span", { className: "qbw-label" }, "安装包地址"),
            h("input", { className: "qbw-input", value: form.source, placeholder: "D:/tools/pet-pack.zip 或 https://…", onChange: (e) => setForm((f) => ({ ...f, source: e.target.value })) }),
            h(Browse, { mode: "file", title: "选择安装包 zip", onPick: (v) => setForm((f) => ({ ...f, source: v })) })),
          h("div", { className: "qbw-row" }, h("span", { className: "qbw-label" }, "Electron 路径"),
            h("input", { className: "qbw-input", value: form.electronPath, placeholder: "D:/tools/electron/electron.exe", onChange: (e) => setForm((f) => ({ ...f, electronPath: e.target.value })) }),
            h(Browse, { mode: "file", title: "选择 electron.exe", onPick: (v) => setForm((f) => ({ ...f, electronPath: v })) })),
          h("div", { className: "qbw-row" }, h("span", { className: "qbw-label" }, "安装目录（可选）"),
            h("input", { className: "qbw-input", value: form.appDir, placeholder: "留空 = ~/.dsh/surfcore/pet/app", onChange: (e) => setForm((f) => ({ ...f, appDir: e.target.value })) }),
            h(Browse, { mode: "dir", title: "选择桌宠安装目录", onPick: (v) => setForm((f) => ({ ...f, appDir: v })) })),
          h("div", { className: "qbw-hint", style: { marginTop: "4px" } }, "沙箱 / 只读用户目录的环境里，把安装目录指到可写位置（例如工作区内）。"),
          h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
            `官方最新包：${st?.defaults?.zipUrl || "https://github.com/Mieksido/surfpet/releases/latest/download/pet-pack.zip"}`),
          h("div", { className: "qbw-actions" },
            h(Btn, { kind: "qbw-btn2", onClick: () => setForm((f) => ({ ...f, source: st?.defaults?.zipUrl || "https://github.com/Mieksido/surfpet/releases/latest/download/pet-pack.zip" })) }, "用官方最新版"),
            h(Btn, { kind: "qbw-btn2", disabled: busy === "electron-detect", onClick: () => act("electron-detect") }, busy === "electron-detect" ? "检测中…" : "检测 Electron"),
            h(Btn, { kind: "qbw-btn2", disabled: busy === "electron-install", onClick: () => act("electron-install", { source: "auto" }) },
              busy === "electron-install" ? "下载中…（约 125MB，2~5 分钟）" : `下载 Electron ${st?.defaults?.electronVersion || "45.0.0"}`),
            h(Btn, { kind: "qbw-btn2", disabled: busy === "electron-install-gh", onClick: () => act("electron-install", { source: "github" }, "electron-install-gh") },
              busy === "electron-install-gh" ? "从 GitHub 下载中…" : "GitHub 官方源"),
            h(Btn, { kind: "qbw-btn2", disabled: busy === "config", onClick: () => act("config", form) }, busy === "config" ? "保存中…" : "保存设置")),
          h("div", { className: "qbw-row" }, h("span", { className: "qbw-label" }, "下载链路"),
            h("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
              ...[
                { id: "", label: "官方（GitHub）" },
                { id: "https://gh-proxy.com", label: "镜像 · gh-proxy" },
                { id: "https://ghproxy.net", label: "镜像 · ghproxy" },
              ].map((opt) => h(Btn, {
                key: opt.id || "official",
                kind: (form.mirror || "") === opt.id ? "qbw-btn" : "qbw-btn2",
                onClick: () => act("config", { ...form, mirror: opt.id }),
              }, ((form.mirror || "") === opt.id ? "● " : "") + opt.label)))),
          h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
            st?.electronDetected ? `已检测到 Electron：${st.electronDetected}` : "没检测到 Electron：点「下载 Electron」自动装到 ~/.dsh/surfcore/pet/runtime（约 125MB）")),
        // ── 桌宠对话：人设 / 记忆 / 模型都来自当前角色，这里只管长短与开关 ──
        h("div", { className: "qbw-card", style: { marginTop: "10px" } },
          h("h4", null, "对话",
            h("span", { className: "qbw-badge " + (st?.proactive?.online ? "ok" : "warn") }, st?.proactive?.online ? "桌宠在线" : "桌宠离线"),
            st?.proactive?.carrier === "pet" ? h("span", { className: "qbw-badge" }, "主动搭话载体") : null),
          h("p", null, "在桌宠上右键「文本对话 / 语音对话」打开对话框；回复会用对应形式（文本或语音），气泡里始终显示文字。人设卡、记忆卡、目的状态跟 QQ / B站 共用当前角色。"),
          h("div", { className: "qbw-hint" },
            `角色：${st?.role?.name ?? "—"} · 模型：${st?.llm?.provider || "—"}/${st?.llm?.model || "—"} · 语音：${st?.voice?.enabled ? `${st.voice.route}（${st.voice.endpoint}）` : "未开启"} · 历史 ${st?.chat?.messages ?? 0} 条`),
          h(Row, { label: "专注模式（不主动打扰）", hint: "开 = 不主动搭话、不弹主动气泡（QQ / 桌宠载体都停）；你自己打开对话仍然正常。桌宠右键菜单里也能切" },
            h("input", {
              className: "qbw-switch",
              type: "checkbox",
              checked: st?.focus?.enabled === true,
              disabled: busy === "focus",
              onChange: (e) => actFocus(e.target.checked),
            })),
          h(Row, { label: "启用桌宠对话", hint: "关掉后对话框不再回话；主动搭话也不走桌宠" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: chatCfg.enabled !== false, onChange: (e) => setChat("enabled", e.target.checked) })),
          h(Row, { label: "把桌宠对话写进记忆卡", hint: "和 QQ / B站 同一张衰减记忆卡（同一套遗忘规则）；关掉就只留在聊天记录里" },
            h("input", { className: "qbw-switch", type: "checkbox", checked: chatCfg.remember !== false, onChange: (e) => setChat("remember", e.target.checked) })),
          h(Row, { label: "文本回复上限（字）", hint: "默认 300" },
            h("input", { className: "qbw-input", type: "number", min: 40, max: 800, value: chatCfg.maxReplyChars ?? 300, onChange: (e) => setChat("maxReplyChars", Number(e.target.value) || 300) })),
          h(Row, { label: "语音回复上限（字）", hint: "默认 120；太长会按句号截断" },
            h("input", { className: "qbw-input", type: "number", min: 20, max: 300, value: chatCfg.voiceMaxChars ?? 120, onChange: (e) => setChat("voiceMaxChars", Number(e.target.value) || 120) })),
          h(Row, { label: "带多少轮上下文", hint: "默认 20 轮；越大越贵" },
            h("input", { className: "qbw-input", type: "number", min: 2, max: 60, value: chatCfg.historyTurns ?? 20, onChange: (e) => setChat("historyTurns", Number(e.target.value) || 20) })),
          h(Row, { label: "思考强度", hint: "默认 low：桌宠闲聊要快；off 最省" },
            h("select", { className: "qbw-select", value: chatCfg.reasoningEffort ?? "low", onChange: (e) => setChat("reasoningEffort", e.target.value) },
              h("option", { value: "off" }, "off（不思考）"), h("option", { value: "low" }, "low（默认）"),
              h("option", { value: "high" }, "high"), h("option", { value: "max" }, "max"))),
          h("div", { className: "qbw-hint" }, "改完点底部「保存」即生效（不用重启桌宠）；用量计入 token 额度「其他」。"),
          st?.proactive?.carrier !== "pet" ? h("div", { className: "qbw-hint" },
            "「主动搭话」目前由 QQ 载体发出：在「目的」页可以把载体切成桌宠。") : null),
        st && st.skins && st.skins.length ? h("div", { className: "qbw-card", style: { marginTop: "10px" } },
          h("h4", null, "内置形象"),
          h("div", { className: "qbw-chips" }, st.skins.map((x) => h("span", { className: "qbw-chip", key: x.id }, x.name))),
          h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, "在桌宠上右键「穿什么呢」切换。")) : null,
        err ? h("div", { className: "qbw-err", style: { marginTop: "8px" } }, err) : null);
    }

    // ── 主组件 ──────────────────────────────────────────────────────────────
    const TABS = [
      ["overview", "概览"],
      ["characters", "角色"],
      ["purpose", "目的"],
      ["qq", "QQ"],
      ["voice", "语音"],
      ["pet", "桌宠"],
      ["bili", "B站"],
      ["tokens", "Token 额度"],
      ["watch", "观看历史"],
      ["memory", "记忆"],
      ["align", "对齐"],
      ["extensions", "扩展"],
      ["advanced", "全部参数"],
      ["diag", "诊断"],
    ];
    const NAMES = { nav: "SurfCore" };

    function QQBIliWhaleSection() {
      useStyleOnce();
      const [tab, setTab] = useState("overview");
      const [overview, setOverview] = useState(null);
      const [qq, setQq] = useState(null);
      const [bili, setBili] = useState(null);
      const [unified, setUnified] = useState(null);
      const [saved, setSaved] = useState("");
      const [busy, setBusy] = useState("");
      const [toast, setToast] = useState("");
      const [err, setErr] = useState("");
      // 记忆卡容量弹窗：80/90/100% 三档；页面开着时每分钟查一次（用户不一定停在「记忆」页）。
      const [memoryAlert, setMemoryAlert] = useState(null);
      const memorySnoozeRef = useRef(0);
      // 每日 token 额度：budget 是服务端快照（用量/比例/提醒），limitDraft 是本地可编辑额度。
      // 轮询只更新 budget，不覆盖用户正在改的 limitDraft；只有 draft 和上次保存值一致时才同步。
      const [budget, setBudget] = useState(null);
      const [limitDraft, setLimitDraft] = useState(null);
      const [tokenAlert, setTokenAlert] = useState(null);
      const [tokenAlerted, setTokenAlerted] = useState(null);
      const budgetRef = useRef(null);

      const notify = (message) => {
        setToast(message);
        setTimeout(() => setToast(""), 4000);
      };
      // 让深层组件（如泛用 Field 的「浏览…」）也能弹提示，而不是静默失败。
      useEffect(() => { window.__surfcoreToast = notify; return () => { delete window.__surfcoreToast; }; }, []);
      const applyBudget = (r) => {
        const previousLimits = budgetRef.current?.limits;
        budgetRef.current = r;
        setBudget(r);
        setTokenAlerted(r.alertedToday ?? null);
        if (r.alert) setTokenAlert(r.alert);
        setLimitDraft((prev) => {
          if (!prev) return r.limits;
          const dirtyNow = JSON.stringify(prev) !== JSON.stringify(previousLimits);
          return dirtyNow ? prev : r.limits;
        });
      };
      const loadBudget = useCallback(async () => {
        try { applyBudget(await api("/token-budget")); }
        catch (e) { setErr(`读取 token 额度失败：${e.message}`); }
      }, []);
      const loadOverview = useCallback(async () => {
        try { const r = await api("/overview"); setOverview(r); } catch (e) { setErr(`读取概览失败：${e.message}`); }
      }, []);
      const loadConfig = useCallback(async () => {
        setErr("");
        try {
          const r = await api("/config");
          setQq(r.qq ?? {});
          setBili(r.bili ?? {});
          setUnified(r.unified ?? {});
          setSaved(JSON.stringify({ qq: r.qq ?? {}, bili: r.bili ?? {}, unified: r.unified ?? {} }));
        } catch (e) { setErr(`读取配置失败：${e.message}`); }
      }, []);
      useEffect(() => { loadOverview(); loadConfig(); loadBudget(); }, [loadOverview, loadConfig, loadBudget]);

      // 额度页开着时每 30 秒对一次用量；80% 提醒由服务端保证「每天只给第一次」。
      useEffect(() => {
        const timer = setInterval(() => { void loadBudget(); }, 30_000);
        return () => clearInterval(timer);
      }, [loadBudget]);

      useEffect(() => {
        let stop = false;
        const check = async () => {
          try {
            const r = await api("/memory-card");
            if (stop) return;
            if (r.enabled === false) { setMemoryAlert(null); return; }
            const s = r.status ?? {};
            const level = Math.max(Number(s.level) || 0, Number(s.alertLevel) || 0);
            const acknowledged = Number(s.acknowledgedLevel) || 0;
            if (level > acknowledged && Date.now() > memorySnoozeRef.current) {
              setMemoryAlert({ ...s, level });
            } else {
              setMemoryAlert(null);
            }
          } catch {}
        };
        check();
        const timer = setInterval(check, 60_000);
        return () => { stop = true; clearInterval(timer); };
      }, []);

      const setQqPath = (path, value) => setQq((c) => { const next = clone(c ?? {}); setPath(next, path, value); return next; });
      const setBiliPath = (path, value) => setBili((c) => { const next = clone(c ?? {}); setPath(next, path, value); return next; });
      const setUnifiedPath = (path, value) => setUnified((c) => { const next = clone(c ?? {}); setPath(next, path, value); return next; });
      // 管理员卡片：QQ 和 B站 两个标签页改的是同一个 unified.admin。
      const setAdmin = (next) => setUnifiedPath(["admin"], next);
      const budgetDirty = Boolean(limitDraft && budget && JSON.stringify(limitDraft) !== JSON.stringify(budget.limits));
      const dirty = qq && bili && unified && (JSON.stringify({ qq, bili, unified }) !== saved || budgetDirty);

      // biliToQq 开关在 MemoryTab 里通过 unified.__biliToQqToggle 过渡；这里在保存前把它落到 QQ 配置。
      const normalizedQq = useMemo(() => {
        if (!qq) return qq;
        const next = clone(qq);
        const toggle = unified?.__biliToQqToggle;
        if (typeof toggle === "boolean") {
          next.biliBridge = next.biliBridge ?? {};
          next.biliBridge.enabled = true;
          next.biliBridge.memory = { ...(next.biliBridge.memory ?? {}), enabled: toggle };
        }
        return next;
      }, [qq, unified]);
      const normalizedUnified = useMemo(() => {
        if (!unified) return unified;
        const next = clone(unified);
        delete next.__biliToQqToggle;
        return next;
      }, [unified]);

      const save = async (restartBridge = false) => {
        setBusy("save"); setErr("");
        try {
          if (budgetDirty && limitDraft) {
            const b = await api("/token-budget", { method: "POST", body: { limits: limitDraft } });
            applyBudget(b);
            setLimitDraft(b.limits);
          }
          const r = await api("/config", { method: "POST", body: { qq: normalizedQq, bili, unified: normalizedUnified, restartBridge } });
          if (r.qq) setQq(r.qq);
          if (r.bili) setBili(r.bili);
          if (r.unified) setUnified(r.unified);
          const nextSaved = JSON.stringify({ qq: r.qq ?? normalizedQq, bili: r.bili ?? bili, unified: r.unified ?? normalizedUnified });
          setSaved(nextSaved);
          notify(`✓ 已保存${budgetDirty ? "（token 额度即时生效）" : ""}${r.bridge ? (r.bridge.ok ? "，桥接已重启" : "，桥接重启失败") : ""}${r.warnings?.length ? "（有提示）" : ""}`);
          if (r.warnings?.length) setErr(r.warnings.join(" "));
          await loadOverview();
        } catch (e) { setErr(`保存失败：${e.message}`); } finally { setBusy(""); }
      };
      const reload = async () => { await loadOverview(); await loadConfig(); await loadBudget(); };
      const reset = () => {
        setQq(JSON.parse(saved).qq);
        setBili(JSON.parse(saved).bili);
        setUnified(JSON.parse(saved).unified);
        if (budgetRef.current?.limits) setLimitDraft(budgetRef.current.limits);
        notify("已撤销未保存的改动");
      };

      // 容量弹窗的三个出口：立即压缩 / 2 小时后再提醒 / 本次不再提醒（确认到当前档位）。
      const compressMemoryCardNow = async () => {
        setBusy("mc-alert");
        try {
          const r = await api("/memory-card", { method: "POST", body: { action: "compact", targetRatio: 0.8 } });
          notify(`✓ 记忆卡已压缩（降级 ${r.steps ?? 0} 档）`);
          setMemoryAlert(null);
          setTab("memory");
          await loadOverview();
        } catch (e) { notify(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const dismissMemoryAlert = async (acknowledge) => {
        const level = Number(memoryAlert?.level) || 0;
        setMemoryAlert(null);
        if (!acknowledge) {
          memorySnoozeRef.current = Date.now() + 2 * 60 * 60 * 1000;
          return;
        }
        try { await api("/memory-card", { method: "POST", body: { action: "ack", level } }); } catch {}
      };

      if (!qq || !bili || !unified) {
        return h("div", { className: "qbw-app" },
          h("div", { className: "qbw-head" }, h("p", { className: "qbw-kicker" }, "DeepSeek Harness · SurfCore"), h("h3", { className: "qbw-title" }, "SurfCore"), h("p", { className: "qbw-sub" }, "正在读取配置…")),
          h("div", { className: "qbw-body" }, err ? h("div", { className: "qbw-err" }, err) : h("div", { className: "qbw-hint" }, "读取中…")),
          h("div", { className: "qbw-foot" }, h(Btn, { onClick: reload, disabled: !!busy }, "重试")));
      }

      const bridge = overview?.bridge ?? {};
      const biliStatus = overview?.bili ?? {};
      const platformStart = overview?.platformStart ?? {};
      const qqStart = platformStart.qq !== false;
      const biliStart = platformStart.bili !== false;
      const active = (id) => tab === id;
      const renderTab = () => {
        if (tab === "overview") return h(OverviewTab, { overview, reload, busy, setBusy, toast: notify, unified, setUnified: setUnifiedPath, goTab: setTab });
        if (tab === "characters") return h(CharactersTab, { overview, busy, setBusy, toast: notify, reload, goTab: setTab, unified, setUnified: setUnifiedPath });
        if (tab === "purpose") return h(PurposeTab, { qq, setQq: setQqPath, unified, setUnified: setUnifiedPath, overview, busy, setBusy, toast: notify, reload, goTab: setTab });
        if (tab === "qq") return h(QQTab, { cfg: qq, set: setQqPath, admin: unified?.admin ?? {}, setAdmin, unified, setUnified: setUnifiedPath, overview, busy, setBusy, toast: notify, reload, goTab: setTab });
        if (tab === "bili") return h(BiliTab, { cfg: bili, set: setBiliPath, qq: normalizedQq, setQqPath, admin: unified?.admin ?? {}, setAdmin, unified, setUnified: setUnifiedPath, qqPrivate: normalizedQq?.allow?.private ?? [], qqAllowAll: normalizedQq?.allowAllWhenEmpty === true, overview, busy, setBusy, toast: notify, reload });
        if (tab === "tokens") return h(TokenTab, { budget, limits: limitDraft, onChange: setLimitDraft, disabled: !!busy, alertedToday: tokenAlerted, onSave: () => save(false), busy, toast: notify });
        if (tab === "watch") return h(WatchTab, { busy, setBusy, toast: notify, goTab: setTab });
        if (tab === "voice") return h(VoiceTab, { toast });
        if (tab === "pet") return h(PetTab, { toast: notify, unified, setUnified: setUnifiedPath });
        if (tab === "memory") return h(MemoryTab, { qq: normalizedQq, unified, setUnified: setUnifiedPath, overview, busy, setBusy, toast: notify, reload });
        if (tab === "align") return h(AlignTab, { busy, setBusy, toast: notify, reload });
        if (tab === "extensions") return h(ExtensionsTab, { busy, setBusy, toast: notify, reload });
        if (tab === "advanced") return h(AdvancedTab, { qq: normalizedQq, bili, unified: normalizedUnified, setQqPath, setBiliPath, setUnifiedPath, busy });
        if (tab === "diag") return h(DiagnosticsTab, { busy, setBusy, toast: notify, reload });
        return null;
      };

      return h("div", { className: "qbw-app" },
        h("div", { className: "qbw-head" },
          h("p", { className: "qbw-kicker" }, "DeepSeek Harness · SurfCore"),
          h("h3", { className: "qbw-title" }, "SurfCore",
            h("span", { className: "qbw-badge" }, `v${overview?.version ?? "—"}`),
            h("span", { className: "qbw-dots" },
              h(StatusDot, { ok: qqStart && bridge.running && bridge.ok, warn: qqStart && bridge.running && !bridge.ok }, qqStart ? "QQ" : "QQ 关"),
              h(StatusDot, { ok: biliStart && Boolean(biliStatus.available), warn: biliStart && Boolean(biliStatus.enabled) }, biliStart ? "B站" : "B站 关"),
              h(StatusDot, { ok: biliStart && overview?.scheduler?.running }, biliStart ? "生物钟" : "生物钟关"))),
          h("p", { className: "qbw-sub" }, "SurfCore 一个窗口管两边：QQ 的桥接与参数、B站养鱼参数、记忆卡、双向脱敏记忆、身份对齐，以及后续扩展接口。")),
        h("div", { className: "qbw-tabs" }, TABS.map(([id, label]) => h("button", {
          key: id, className: "qbw-tab" + (active(id) ? " on" : ""), onClick: () => setTab(id),
        }, label))),
        h("div", { className: "qbw-body" },
          err ? h("div", { className: "qbw-err", style: { marginBottom: "8px" } }, err) : null,
          renderTab()),
        h("div", { className: "qbw-foot" },
          h(Btn, { onClick: () => save(false), disabled: !!busy || !dirty }, busy === "save" ? "保存中…" : "保存"),
          h(Btn, { kind: "qbw-btn2", onClick: () => save(true), disabled: !!busy || unified?.platforms?.start?.qq === false, title: unified?.platforms?.start?.qq === false ? "QQ 启动开关已关闭；先打开再重启" : undefined }, "保存并重启 QQ 桥接"),
          h(Btn, { kind: "qbw-btn2", onClick: reset, disabled: !!busy || !dirty }, "撤销改动"),
          h(Btn, { kind: "qbw-btn2", onClick: reload, disabled: !!busy }, "重新读取"),
          h("span", { className: "spacer" }),
          dirty ? h("span", { className: "qbw-dirty" }, "● 有改动还没保存（改了不点保存 = 没生效）") : h("span", { className: "qbw-ok" }, "已保存"),
          toast ? h("span", { style: { marginLeft: "10px", color: "var(--dsw-alias-label-secondary)" } }, toast) : null),
        tokenAlert ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setTokenAlert(null); } },
          h("div", { className: "qbw-modal" },
            h("h3", null, "⚠️ 今日 token 额度已用到 80%"),
            h("p", null, `今天是 ${tokenAlert.day ?? "—"}，下面这些额度已经到 80%：`),
            h("div", null, (tokenAlert.items ?? []).map((item, index) => h("div", { key: `${item.scope}-${item.unit}-${index}`, className: "qbw-kv" },
              h("span", null, `${item.scopeLabel ?? item.scope}（${item.unitLabel ?? item.unit}）`),
              h("span", null, `${fmtBudgetValue(item.used, item.unit)} / ${fmtBudgetValue(item.limit, item.unit)} · ${fmtPercent(item.ratio)}`)))),
            h("p", { style: { marginTop: "10px" } },
              "这是今天的第一次额度提醒，也是今天唯一一次。接下来不管 QQ、B站、其他分项还是 SurfCore 总额再到 80%，都不会再弹窗；你可以在「Token 额度」页随时看实时用量。到了 100% 才会真正停：QQ 分项到顶就停 QQ 唤醒，B站 分项到顶就停 B站 叫醒；总额到顶两边一起停。"),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: () => { setTab("tokens"); setTokenAlert(null); } }, "去调高额度"),
              h(Btn, { kind: "qbw-btn2", onClick: () => setTokenAlert(null) }, "知道了")))) : null,
        memoryAlert ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) dismissMemoryAlert(false); } },
          h("div", { className: "qbw-modal" },
            h("h3", null, "🧠 记忆卡快满了"),
            h("p", null, `记忆卡已经用到 ${memoryAlert.percent ?? 0}%（${memoryAlert.chars ?? 0}/${memoryAlert.maxChars ?? 0} 字）。`),
            h("div", { className: "qbw-meter " + ((memoryAlert.level ?? 0) >= 2 ? "bad" : "warn") },
              h("i", { style: { width: `${Math.min(100, Number(memoryAlert.percent) || 0)}%` } })),
            h("p", null, "继续增长会挤掉提示词预算。压缩只会把最不重要的旧记忆先变模糊，置顶的、和主人相关的重要记忆不会动。"),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: compressMemoryCardNow, disabled: !!busy }, busy === "mc-alert" ? "压缩中…" : "立即压缩到 80%"),
              h(Btn, { kind: "qbw-btn2", onClick: () => { setTab("memory"); setMemoryAlert(null); } }, "去记忆页看看"),
              h(Btn, { kind: "qbw-btn2", onClick: () => dismissMemoryAlert(false) }, "2 小时后再提醒"),
              h(Btn, { kind: "qbw-btn2", onClick: () => dismissMemoryAlert(true) }, "本次不再提醒")))) : null,
      );
    }

    const inject = ["slots"];
    const NS = "surfcore";

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject("settings.section", () =>
            ctx.slots.register(
              { name: "settings.section", id: NS, order: 7, label: () => NAMES.nav },
              QQBIliWhaleSection,
            ),
            "surfcore: settings section",
          ),
        "surfcore: settings section",
      );
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.QQBIliWhaleSection = QQBIliWhaleSection;
    exports.QQ_FIELDS = QQ_FIELDS;
    exports.BILI_FIELDS = BILI_FIELDS;
    exports.QQ_BILI_SHARE_FIELDS = QQ_BILI_SHARE_FIELDS;
    // 仅供 Node 契约测试验证路径归一化；浏览器运行时不使用。
    exports.__test = { pathKeys, setPath };
    return module.exports;
  },
});
