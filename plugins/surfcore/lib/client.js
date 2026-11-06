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

  async function browseNative(mode = "dir", title = "", filter = "") {
    // filter 只接受宿主认识的枚举（如 snowluma），不把原始 filter 串传给宿主。
    const q = `mode=${mode === "file" ? "file" : "dir"}&title=${encodeURIComponent(title)}${filter ? `&filter=${encodeURIComponent(filter)}` : ""}`;
    const res = await fetch(`${API}/browse?${q}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(180000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` };
    return data;
  }
    const CSS_TAG = "surfcore/console.css";

    const CSS = `
/* 主题语义层：只用 DSH 提供的 light/dark token，组件里不再写死颜色。
   on-brand 用 bg-base：浅色主题是浅字压深品牌色，深色主题是深字压浅品牌色。 */
:root{
  --qbw-surface: var(--dsw-alias-bg-overlay, var(--dsw-alias-bg-layer-1, #ffffff));
  --qbw-surface-2: var(--dsw-alias-bg-layer-2, #f2f4f7);
  --qbw-text: var(--dsw-alias-label-primary, #1f2328);
  --qbw-muted: var(--dsw-alias-label-secondary, #5b6472);
  --qbw-line: var(--dsw-alias-border-l2, #d0d5dd);
  --qbw-line-soft: var(--dsw-alias-border-l1, #e3e6ee);
  --qbw-brand: var(--dsw-alias-brand-primary, #2f6fed);
  --qbw-on-brand: var(--dsw-alias-bg-base, #ffffff);
  --qbw-hover: rgba(127,127,127,.12);
  --qbw-ok: var(--dsw-alias-state-success-primary, #2fbf71);
  --qbw-warn: var(--dsw-alias-state-warn-primary, #b97800);
  --qbw-err: var(--dsw-alias-state-error-primary, #e5484d);
  --qbw-ok-text: var(--qbw-ok);
  --qbw-warn-text: var(--qbw-warn);
  --qbw-err-text: var(--qbw-err);
}
@supports (color: color-mix(in srgb, #000 50%, #fff)){
  :root{
    --qbw-ok-text: color-mix(in srgb, var(--qbw-ok) 70%, var(--qbw-text));
    --qbw-warn-text: color-mix(in srgb, var(--qbw-warn) 55%, var(--qbw-text));
    --qbw-err-text: color-mix(in srgb, var(--qbw-err) 85%, var(--qbw-text));
  }
}
.qbw-app{max-width:1020px;margin:0 auto;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:rgba(127,127,127,.04);box-shadow:0 10px 30px rgba(0,0,0,.12);overflow:hidden;display:flex;flex-direction:column;max-height:calc(100vh - 24px)}
.qbw-head{padding:18px 20px 14px;border-bottom:1px solid var(--dsw-alias-border-l2);background:linear-gradient(135deg,rgba(31,111,235,.10),rgba(255,122,162,.08));flex:0 0 auto}
.qbw-tabs{flex:0 0 auto}
.qbw-body{flex:1 1 auto;min-height:0;padding:16px 20px 8px;overflow:auto;max-height:none}
.qbw-kicker{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--qbw-muted);margin:0 0 4px}
.qbw-title{margin:0;font-size:19px;font-weight:600;line-height:28px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-sub{margin:4px 0 0;color:var(--qbw-muted);font-size:12px}
.qbw-dots{display:inline-flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.qbw-dot{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.10);padding:2px 8px;border-radius:999px}
.qbw-dot i{width:7px;height:7px;border-radius:50%;background:var(--qbw-muted);display:inline-block}
.qbw-dot.ok i{background:var(--qbw-ok)}.qbw-dot.warn i{background:var(--qbw-warn)}.qbw-dot.bad i{background:var(--qbw-err)}
.qbw-tabs{display:flex;gap:2px;padding:8px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l2);overflow-x:auto;background:rgba(127,127,127,.025)}
.qbw-tab{border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12.5px;padding:8px 10px 9px;border-bottom:2px solid transparent;cursor:pointer;white-space:nowrap;border-radius:6px 6px 0 0}
.qbw-tab:hover{background:rgba(127,127,127,.08);color:var(--dsw-alias-label-primary)}
.qbw-tab.on{color:var(--dsw-alias-label-primary);border-bottom-color:var(--dsw-alias-brand-primary);font-weight:600}
.qbw-body{padding:16px 20px 8px;overflow:auto}
.qbw-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}
.qbw-card{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 13px;background:rgba(127,127,127,.03)}
.qbw-area-btn{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:12px 13px;margin:0 0 8px;background:rgba(127,127,127,.03);cursor:pointer;color:inherit;text-align:left;font:inherit}
.qbw-area-btn:hover{border-color:var(--qbw-brand);background:var(--qbw-hover)}
.qbw-area-title{font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;margin-bottom:2px}
.qbw-area-arrow{font-size:20px;opacity:.45;line-height:1}
.qbw-category{margin:10px 0 4px}
.qbw-category-title{margin:0 0 6px;font-size:12px;font-weight:600;opacity:.85;letter-spacing:.02em}
.qbw-row[data-tip]{position:relative}
.qbw-row[data-tip]:hover::after{content:attr(data-tip);position:absolute;left:0;top:100%;z-index:80;max-width:520px;margin-top:4px;padding:7px 9px;border-radius:8px;background:var(--qbw-surface);color:var(--qbw-text);border:1px solid var(--qbw-line);font-size:11.5px;line-height:16px;box-shadow:0 8px 24px rgba(0,0,0,.28);white-space:normal;pointer-events:none}
.qbw-area-btn{position:relative}



.qbw-card h4{margin:0 0 6px;font-size:13px;font-weight:600}
.qbw-card p{margin:0;color:var(--qbw-muted);font-size:11.5px;line-height:17px}
.qbw-kv{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);font-size:12px}
.qbw-kv:last-child{border-bottom:none}
.qbw-kv span:first-child{color:var(--qbw-muted)}
.qbw-kv span:last-child{text-align:right;word-break:break-all}
.qbw-group{margin:16px 0 8px;font-size:13px;font-weight:650;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-group small{font-weight:400;color:var(--qbw-muted);font-size:11px}
.qbw-rows{display:flex;flex-direction:column}
.qbw-row{display:flex;justify-content:space-between;align-items:flex-start;gap:12px 20px;padding:9px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}
.qbw-row:last-child{border-bottom:none}
.qbw-row>div:first-child{flex:1;min-width:190px}
.qbw-label{font-size:12.5px;line-height:19px}
.qbw-hint{color:var(--qbw-muted);margin-top:2px;font-size:11px;line-height:17px}
.qbw-input,.qbw-select,.qbw-textarea{box-sizing:border-box;background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;min-height:28px;padding:3px 8px;min-width:180px;outline:none;font-family:inherit}
.qbw-input:focus-visible,.qbw-select:focus-visible,.qbw-textarea:focus-visible{border-color:var(--dsw-alias-brand-primary)}
.qbw-input.wide,.qbw-textarea.wide{min-width:320px}
.qbw-textarea{width:100%;min-height:90px;resize:vertical;line-height:18px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.qbw-textarea.card{min-height:360px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.qbw-btn{background:var(--qbw-brand);color:var(--qbw-on-brand);border:none;border-radius:6px;font-size:12.5px;font-weight:600;min-height:29px;padding:0 12px;cursor:pointer;white-space:nowrap}
.qbw-progress{height:6px;background:var(--qbw-hover);border-radius:99px;overflow:hidden}
.qbw-progress>i{display:block;height:100%;background:var(--qbw-brand);border-radius:99px;transition:width .35s ease}
.qbw-progress.indet>i{width:35%!important;animation:qbw-indet 1.1s ease-in-out infinite}
@keyframes qbw-indet{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}
.qbw-btn:disabled,.qbw-btn2:disabled,.qbw-btn3:disabled{opacity:.68;cursor:not-allowed;border-color:var(--qbw-line)}
.qbw-btn:hover:not(:disabled){filter:brightness(1.07)}
.qbw-btn2{background:var(--qbw-surface-2);border:1px solid var(--qbw-line);color:var(--qbw-text)}
.qbw-btn3{background:transparent;border:1px dashed var(--qbw-line);color:var(--qbw-muted)}
.qbw-btn.danger{background:var(--qbw-err);color:var(--qbw-on-brand)}
.qbw-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:10px;border-top:.5px solid var(--qbw-line-soft)}
.qbw-foot{position:sticky;bottom:0;z-index:20;background:var(--qbw-surface-2);border-top:1px solid var(--qbw-line);padding:10px 20px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 -6px 16px rgba(0,0,0,.06)}
.qbw-foot .spacer{flex:1}
.qbw-foot .qbw-btn2{background:var(--qbw-surface)}
.qbw-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10001;max-width:min(680px,calc(100vw - 32px));padding:10px 16px;border-radius:10px;background:var(--qbw-surface);color:var(--qbw-text);border:1px solid var(--qbw-brand);box-shadow:0 10px 30px rgba(0,0,0,.28);font-size:12.5px;line-height:18px;pointer-events:none;text-align:center}
.qbw-dirty{color:var(--qbw-warn-text);font-size:12px}
.qbw-ok{color:var(--qbw-ok-text);font-size:12px}
.qbw-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}
.qbw-out{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:280px;overflow:auto;margin-top:10px}
.qbw-badge{display:inline-block;font-size:10.5px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px}
.qbw-badge.ok{background:color-mix(in srgb, var(--qbw-ok) 16%, transparent);color:var(--qbw-ok-text)}
.qbw-badge.warn{background:color-mix(in srgb, var(--qbw-warn) 16%, transparent);color:var(--qbw-warn-text)}
.qbw-badge.bad{background:color-mix(in srgb, var(--qbw-err) 14%, transparent);color:var(--qbw-err-text)}
.qbw-list{display:flex;flex-direction:column;gap:6px}
.qbw-item{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 10px;display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.qbw-item>div:first-child{flex:1;min-width:220px}
.qbw-table{width:100%;border-collapse:collapse;font-size:12px}
.qbw-table th,.qbw-table td{text-align:left;padding:6px 6px;border-bottom:.5px solid var(--dsw-alias-border-l2);vertical-align:top}
.qbw-table th{color:var(--qbw-muted);font-weight:500;font-size:11px}
.qbw-pill{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 9px;font-size:11px;color:var(--dsw-alias-label-secondary)}
.qbw-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.qbw-chip{cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:3px 10px;font-size:11.5px;line-height:18px;background:transparent;color:var(--dsw-alias-label-secondary)}
.qbw-chip:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary)}
.qbw-chip.on{border-color:var(--qbw-brand);background:color-mix(in srgb, var(--qbw-brand) 14%, transparent);color:var(--qbw-text)}
.qbw-warnbox{border:1px solid color-mix(in srgb, var(--qbw-warn) 40%, transparent);background:color-mix(in srgb, var(--qbw-warn) 10%, transparent);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:18px}
.qbw-infobox{border:1px solid color-mix(in srgb, var(--qbw-brand) 32%, transparent);background:color-mix(in srgb, var(--qbw-brand) 8%, transparent);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:18px}
.qbw-dangerbox{border:1px solid color-mix(in srgb, var(--qbw-err) 34%, transparent);background:color-mix(in srgb, var(--qbw-err) 8%, transparent);border-radius:10px;padding:10px 12px;margin:10px 0;font-size:12px;line-height:18px}
.qbw-admin{border:1px solid rgba(31,111,235,.45);border-radius:12px;padding:12px 14px;margin:0 0 12px;background:linear-gradient(135deg,rgba(31,111,235,.10),rgba(255,122,162,.07))}
.qbw-admin-head{display:flex;justify-content:space-between;gap:10px;align-items:flex-start;flex-wrap:wrap}
.qbw-admin-title{font-size:14px;font-weight:700;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-admin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin-top:10px}
.qbw-admin-field{display:flex;flex-direction:column;gap:4px;font-size:12px}
.qbw-admin-field small{color:var(--qbw-muted);font-size:10.5px;line-height:15px}
.qbw-admin-field .qbw-input{min-width:0;width:100%;max-width:240px}
.qbw-admin-field .qbw-select{min-width:0;width:100%;max-width:240px}
.qbw-admin-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding-top:9px;border-top:.5px dashed var(--dsw-alias-border-l2)}
.qbw-admin-check{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;cursor:pointer}
.qbw-alias{border:1px solid rgba(255,122,162,.45);background:rgba(255,122,162,.07);border-radius:10px;padding:10px 12px;margin:0 0 10px}
.qbw-alias .qbw-input{width:100%;min-width:0;margin-top:6px}
.qbw-alias-title{font-size:13px;font-weight:650;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.qbw-switch{width:16px;height:16px;accent-color:var(--qbw-brand);margin-top:2px}
.qbw-search{display:flex;gap:8px;align-items:center;margin:4px 0 10px;flex-wrap:wrap}
.qbw-search .qbw-input{flex:1;min-width:220px}
.qbw-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:760px){.qbw-cols{grid-template-columns:1fr}.qbw-body{padding:12px}.qbw-foot{padding:8px 12px}.qbw-app{border-radius:0;border-left:none;border-right:none}}
.qbw-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;background:rgba(127,127,127,.10);border-radius:4px;padding:1px 5px}
.qbw-scroll{max-height:260px;overflow:auto;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;background:rgba(127,127,127,.03)}
.qbw-scroll pre{margin:0;white-space:pre-wrap;font-size:11.5px;line-height:17px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.qbw-meter{height:9px;border-radius:999px;background:rgba(127,127,127,.18);overflow:hidden;margin:8px 0 6px}
.qbw-meter>i{display:block;height:100%;border-radius:inherit;background:var(--qbw-ok);transition:width .3s ease}
.qbw-meter.indet>i{width:35%!important;background:var(--qbw-brand);animation:qbw-meter-slide 1.1s ease-in-out infinite}
@keyframes qbw-meter-slide{0%{margin-left:-35%}100%{margin-left:100%}}
.qbw-meter.warn>i{background:var(--qbw-warn)}
.qbw-meter.bad>i{background:var(--qbw-err)}
.qbw-meter-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;font-size:12px}
.qbw-meter-head b{font-size:15px}
.qbw-rec{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px;margin:6px 0;display:flex;gap:10px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}
.qbw-rec>div:first-child{flex:1;min-width:260px}
.qbw-rec-title{font-size:12.5px;font-weight:600;line-height:18px}
.qbw-rec-text{font-size:11.5px;color:var(--dsw-alias-label-secondary);line-height:17px;margin-top:2px;word-break:break-word}
.qbw-rec-actions{display:flex;gap:6px;flex-wrap:wrap}
.qbw-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:1px 7px;font-size:10.5px;color:var(--dsw-alias-label-secondary);margin-right:5px}
.qbw-chip.on{background:color-mix(in srgb, var(--qbw-ok) 14%, transparent);border-color:var(--qbw-ok);color:var(--qbw-ok-text)}
.qbw-chip.warn{background:color-mix(in srgb, var(--qbw-warn) 14%, transparent);border-color:var(--qbw-warn);color:var(--qbw-warn-text)}
.qbw-chip.bad{background:color-mix(in srgb, var(--qbw-err) 12%, transparent);border-color:var(--qbw-err);color:var(--qbw-err-text)}
.qbw-modal-backdrop{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.38);display:flex;align-items:center;justify-content:center;padding:18px}
.qbw-modal{width:100%;max-width:470px;background:var(--qbw-surface);color:var(--qbw-text);border:1px solid var(--qbw-line);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.5);padding:18px 18px 14px}
.qbw-modal h3{margin:0 0 8px;font-size:16px;line-height:24px;display:flex;align-items:center;gap:8px}
.qbw-modal p{margin:0 0 10px;font-size:12.5px;line-height:19px;color:var(--qbw-text)}
.qbw-modal .qbw-hint{color:var(--qbw-muted)}
.qbw-modal .qbw-chip{background:var(--qbw-hover);color:var(--qbw-text)}
.qbw-modal .qbw-actions{margin-top:14px}
.qbw-settings-modal{display:flex;flex-direction:column;overflow:hidden}
.qbw-settings-body{min-height:0;overflow:auto;padding-right:2px;margin-top:8px}
.qbw-settings-foot{flex:0 0 auto;margin-top:10px;background:var(--qbw-surface);position:sticky;bottom:0;z-index:2}
/* 弹窗跟随主题：不要再强制浅色，否则浅色主题下浅字压浅底 */
.qbw-modal h3,.qbw-modal p,.qbw-modal label,.qbw-modal div,.qbw-modal span,.qbw-modal strong,.qbw-modal li{color:inherit}
.qbw-modal .qbw-hint{color:var(--qbw-muted)}
.qbw-modal input.qbw-input{background:var(--qbw-surface-2);color:var(--qbw-text);border:1px solid var(--qbw-line)}
.qbw-modal input[type=checkbox]{accent-color:var(--qbw-brand)}
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
.qbw-budget-head p{margin:0;color:var(--qbw-muted);font-size:11px;line-height:16px;max-width:440px}
.qbw-budget-today{display:flex;flex-direction:column;align-items:flex-end;gap:1px;font-size:11px;color:var(--qbw-muted)}
.qbw-budget-today b{font-size:17px;line-height:22px;color:var(--dsw-alias-label-primary)}
.qbw-budget-lines{display:flex;flex-direction:column;gap:7px}
.qbw-budget-line{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;padding:7px 0;border-top:.5px solid var(--dsw-alias-border-l2)}
.qbw-budget-field{display:flex;flex-direction:column;gap:3px;font-size:11.5px;min-width:170px;flex:1}
.qbw-budget-field>span{color:var(--qbw-muted);font-size:11px}
.qbw-budget-field .qbw-input{min-width:150px;width:100%}
.qbw-budget-field small{color:var(--qbw-muted);font-size:10.5px;line-height:15px}
.qbw-budget-meters{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:7px}
.qbw-budget-meter-empty{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:var(--qbw-muted);padding:5px 0}
.qbw-budget-meter .qbw-meter-head{font-size:11px}
.qbw-budget-meter .qbw-meter-head b{font-size:12px}
.qbw-budget-extra{margin-top:9px;padding-top:8px;border-top:.5px dashed var(--dsw-alias-border-l2)}
.qbw-budget-quick{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.qbw-budget-note{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}
.qbw-budget-note .qbw-hint{max-width:760px;line-height:18px}
.qbw-budget-note .qbw-btn{flex:0 0 auto}
@media(max-width:860px){.qbw-budget-grid{grid-template-columns:1fr}.qbw-budget-meters{grid-template-columns:1fr}}
/* 状态可见性：hover / focus-visible / disabled 都必须能看出来，且不靠写死颜色 */
.qbw-btn2:hover:not(:disabled),.qbw-btn3:hover:not(:disabled){background:var(--qbw-hover)}
.qbw-btn:active:not(:disabled){filter:brightness(.94)}
.qbw-btn:focus-visible,.qbw-btn2:focus-visible,.qbw-btn3:focus-visible,.qbw-tab:focus-visible,.qbw-chip:focus-visible,.qbw-area-btn:focus-visible{outline:2px solid var(--qbw-brand);outline-offset:2px}
select.qbw-select option{background:var(--qbw-surface);color:var(--qbw-text)}
.qbw-modal .qbw-btn2{color:var(--qbw-text)}
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
        error.code = data?.code || '';
        error.hint = data?.hint || '';
        error.missing = Array.isArray(data?.missing) ? data.missing : [];
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
      const common = { className: "qbw-input" + (f.wide ? " wide" : ""), title: f.hint || f.label };
      let control;
      if (f.kind === "switch") {
        control = h("input", { className: "qbw-switch", type: "checkbox", checked: !!value, disabled: readOnly, title: (f.hint || f.label) + "（勾选/取消后保存生效）", onChange: (e) => onChange(e.target.checked) });
      } else if (f.kind === "number") {
        control = h("input", { ...common, type: "number", step: f.step ?? "any", min: f.min, max: f.max, value: value ?? "", readOnly, onChange: (e) => onChange(e.target.value === "" ? undefined : Number(e.target.value)) });
      } else if (f.kind === "select") {
        control = h("select", { className: "qbw-select", value: value ?? "", disabled: readOnly, title: (f.hint || f.label) + "（选择后保存生效）", onChange: (e) => onChange(e.target.value) },
          (f.options ?? []).map((opt) => {
            const [v, l] = Array.isArray(opt) ? opt : [opt, opt];
            return h("option", { key: v, value: v, title: l + "（选择后保存生效）" }, l);
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
        control = h("textarea", { className: "qbw-textarea" + (f.wide ? " wide" : ""), value: value ?? "", readOnly, title: f.hint || f.label, style: f.rows ? { minHeight: `${f.rows * 18}px` } : undefined, onChange: (e) => onChange(e.target.value) });
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
    function FieldGroups({ groups, cfg, set, readOnly, groupExtra, onSave, categories, extras = [] }) {
      const [openGroup, setOpenGroup] = useState(null);
      const [search, setSearch] = useState("");
      const active = groups.find((g) => g.group === openGroup) || null;
      const cats = Array.isArray(categories) && categories.length
        ? categories
        : [{ title: "设置", members: null }];
      const categoryOf = (groupName) => {
        const hit = cats.find((c) => !c.members || c.members.includes(groupName));
        return hit ? hit.title : (cats[cats.length - 1]?.title ?? "其他");
      };
      const byCat = new Map(cats.map((c) => [c.title, { groups: [], extras: [] }]));
      for (const g of groups) {
        const title = categoryOf(g.group);
        if (!byCat.has(title)) byCat.set(title, { groups: [], extras: [] });
        byCat.get(title).groups.push(g);
      }
      for (const e of extras) {
        const title = e.category && byCat.has(e.category) ? e.category : (cats[cats.length - 1]?.title ?? "其他");
        if (!byCat.has(title)) byCat.set(title, { groups: [], extras: [] });
        byCat.get(title).extras.push(e.node);
      }
      const needle = search.trim().toLowerCase();
      const results = needle ? groups.flatMap((g) => {
        const out = [];
        if (g.group.toLowerCase().includes(needle)) out.push({ group: g, label: g.group, path: g.group });
        for (const f of g.fields) {
          const hay = `${f.label} ${f.hint || ""} ${f.path.join(".")}`.toLowerCase();
          if (hay.includes(needle)) out.push({ group: g, label: f.label, path: `${g.group} > ${f.label}` });
        }
        return out;
      }).slice(0, 40) : [];
      return h("div", null,
        h("div", { className: "qbw-search", style: { marginBottom: "8px" } },
          h("input", {
            className: "qbw-input",
            placeholder: "搜索设置：如 token防爆破、开启防爆破、唤醒",
            value: search,
            onChange: (e) => setSearch(e.target.value),
          })),
        needle ? h("div", { className: "qbw-list" },
          results.length ? results.map((r, i) => h("button", {
            type: "button", key: `${r.group.group}-${r.label}-${i}`, className: "qbw-area-btn",
            onClick: () => setOpenGroup(r.group.group),
            title: `打开 ${r.group.group}`,
          },
            h("div", { style: { minWidth: 0, textAlign: "left" } },
              h("div", { className: "qbw-area-title" }, r.path),
              h("div", { className: "qbw-hint" }, `点击打开「${r.group.group}」`)),
            h("span", { className: "qbw-area-arrow" }, "›")))
            : h("div", { className: "qbw-hint" }, "没有匹配的设置。"))
          : [...byCat.entries()].map(([title, bucket]) => {
            if (!bucket.groups.length && !bucket.extras.length) return null;
            return h("div", { key: title, className: "qbw-category" },
              h("h5", { className: "qbw-category-title" }, title),
              ...bucket.extras,
              bucket.groups.map((g) => h(AreaButton, {
                key: g.group,
                title: g.group,
                note: g.note || `${g.fields.length} 项设置`,
                badge: g.fields.length,
                onClick: () => setOpenGroup(g.group),
              })));
          }),
        active ? h(SettingsModal, {
          title: active.group,
          note: active.note,
          onClose: () => setOpenGroup(null),
          onSave,
        },
          typeof groupExtra === "function" ? groupExtra(active) : null,
          active.fields.map((f) => h(Field, {
            key: f.path.join("."),
            f,
            value: getPath(cfg, f.path),
            readOnly: typeof readOnly === "function" ? readOnly(f) : readOnly,
            onChange: (v) => set(f.path, v),
          }))) : null);
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

    // ── 设置区域按钮 + 弹窗：高级设置里的每组参数收成一个按钮 ─────────────
    function DshRepairCard({ busy, setBusy, toast }) {
      const [profile, setProfile] = useState("");
      const [out, setOut] = useState("");
      const repair = async () => {
        setBusy("dsh-repair");
        try {
          const r = await api("/dsh/repair", { method: "POST", body: { profile } });
          if (!r.ok) throw new Error(r.error || "修复失败");
          setOut(String(r.output || ""));
          toast("✓ 已写回 DSH 注册；请完全退出并重开 DSH（不是刷新页面）");
        } catch (e) {
          setOut(String(e.output || ""));
          toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally { setBusy(""); }
      };
      return h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
        h("h4", null, "DSH 注册（MCP / bundle）"),
        h("p", null, "DSH 升级后如果 QQ 会话没有 qq_* 工具（只能收不能发），点这里重写 profile 的 MCP 与 bundle。"),
        h("p", { className: "qbw-hint" }, "只在 DSH 升级/注册丢失时用；脚本不会重启 DSH，点完要完全退出并重开。"),
        h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "4px", paddingTop: "0" } },
          h("input", {
            className: "qbw-input", placeholder: "profile（留空=自动检测，如 desktop）",
            value: profile, onChange: (e) => setProfile(e.target.value),
          }),
          h(Btn, { onClick: repair, disabled: !!busy }, busy === "dsh-repair" ? "修复中…" : "修复 DSH 注册"),
          h(Btn, { kind: "qbw-btn2", disabled: !out, onClick: () => navigator.clipboard.writeText(out).then(() => toast("✓ 输出已复制")) }, "复制输出")),
        out ? h("pre", { className: "qbw-code", style: { whiteSpace: "pre-wrap", maxHeight: "220px", overflow: "auto", marginTop: "6px" } }, out) : null);
    }

    function AreaButton({ title, note, badge, onClick }) {
      return h("button", { type: "button", className: "qbw-area-btn", title: note || title, "data-tip": note || title, onClick },
        h("div", { style: { minWidth: 0, textAlign: "left" } },
          h("div", { className: "qbw-area-title" }, title, badge ? h("span", { className: "qbw-badge" }, badge) : null),
          note ? h("div", { className: "qbw-hint" }, note) : null),
        h("span", { className: "qbw-area-arrow" }, "›"));
    }

    function AreaModalCard({ title, note, onSave, busy, children, badge }) {
      const [open, setOpen] = useState(false);
      return h("div", null,
        h(AreaButton, { title, note, badge, onClick: () => setOpen(true) }),
        open ? h(SettingsModal, { title, note, onClose: () => setOpen(false), onSave, busy }, children) : null);
    }

    function SettingsModal({ title, note, onClose, onSave, busy, children }) {
      const [saving, setSaving] = useState(false);
      const save = async () => {
        if (!onSave) { onClose?.(); return; }
        setSaving(true);
        try { await onSave(); onClose?.(); }
        finally { setSaving(false); }
      };
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h("div", { className: "qbw-modal qbw-settings-modal", style: { maxWidth: "760px", maxHeight: "84vh" } },
          h("h3", null, title),
          note ? h("p", { className: "qbw-hint" }, note) : null,
          h("div", { className: "qbw-settings-body" }, children),
          h("div", { className: "qbw-actions qbw-settings-foot" },
            onSave ? h(Btn, { onClick: save, disabled: saving || !!busy }, saving || busy === "save" ? "保存中…" : "保存") : null,
            h(Btn, { kind: "qbw-btn2", onClick: onClose, disabled: saving }, "取消"))));
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
    // 主人特权操作审计：只读桥接写好的 state/owner-audit.jsonl。
    function AuditModal({ onClose, toast }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const [busy, setBusy] = useState(false);
      const load = async () => {
        try { setData(await api("/owner-audit?limit=50")); setErr(""); }
        catch (e) { setErr(e.message); }
      };
      useEffect(() => { load(); }, []);
      const mask = (id) => String(id ?? "").replace(/^(\d{3})\d+(\d{2})$/, "$1***$2");
      const openFolder = async () => {
        setBusy(true);
        try {
          const r = await api("/owner-audit/open", { method: "POST", body: { action: "open" } });
          toast?.(r.ok ? "✓ 已打开所在文件夹" : `✗ ${r.error || "打不开文件夹"}`);
        } catch (e) { toast?.(`✗ ${e.message}`); }
        finally { setBusy(false); }
      };
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h("div", { className: "qbw-modal", style: { maxWidth: "760px", maxHeight: "82vh", overflow: "auto" } },
          h("h3", null, "管理操作记录",
            h("span", { style: { fontSize: "11px", opacity: 0.6, marginLeft: "8px" } }, "最近 50 条 · 只读")),
          err ? h("p", { style: { color: "var(--qbw-err-text)" } }, err) : null,
          data?.health && data.health.writable === false
            ? h("p", { style: { color: "var(--qbw-warn-text)" } }, `⚠️ 审计写入异常：${data.health.lastError || "未知错误"}`)
            : null,
          entries.length
            ? h("div", { style: { fontSize: "12px", lineHeight: "18px" } },
              entries.slice().reverse().map((e, i) => h("div", { key: i, style: { borderBottom: "1px solid rgba(127,127,127,.18)", padding: "5px 0" } },
                h("div", null, h("b", null, e.event || "?"), " · ", new Date(e.at).toLocaleString("zh-CN", { hour12: false })),
                h("div", { style: { opacity: 0.8 } },
                  `操作者：${e.actor?.isOwner ? "主人" : "群友"} ${mask(e.actor?.id)} · 授权：${e.auth?.rule || "—"}/${e.auth?.decision || "—"} · 结果：${e.result?.ok ? "成功" : (e.result?.errorCode || "失败")}`),
                e.ref?.session ? h("div", { style: { opacity: 0.55 } }, `关联：${e.ref.session}${e.ref.role ? " · " + e.ref.role : ""}`) : null)))
            : h("p", { className: "qbw-hint" }, "还没有记录。"),
          h("div", { className: "qbw-actions" },
            h(Btn, { kind: "qbw-btn2", onClick: load, disabled: busy }, "刷新"),
            h(Btn, { kind: "qbw-btn2", onClick: openFolder, disabled: busy }, "打开所在文件夹"),
            h(Btn, { kind: "qbw-btn2", onClick: onClose }, "关闭"))));
    }

    function AdminGentleEnableModal({ onConfirm, onClose }) {
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h("div", { className: "qbw-modal", style: { maxWidth: "680px", maxHeight: "84vh", overflow: "auto" } },
          h("h3", null, "⚠️ 开启“温柔 / 绝不回嘴”前请确认"),
          h("p", null, "开启后 QQ 和 B站 都会对管理员使用这套规则。这不是普通语气开关，会改变她的行为边界："),
          h("ul", { style: { paddingLeft: "20px", lineHeight: "20px" } },
            h("li", null, "对管理员更温柔、先接情绪；"),
            h("li", null, "“绝不回嘴”：不反驳、不顶撞、不阴阳、不冷嘲、不抬杠；"),
            h("li", null, "可能减少诚实纠错和边界提醒，甚至迎合不合理要求；"),
            h("li", null, "可能与人格卡、安全规则冲突；模型行为只能引导，无法硬保证；"),
            h("li", null, "每次唤醒会多占一点上下文 token；"),
            h("li", null, "已存在的旧会话可能继续受历史温柔规则影响；彻底清掉需要重置会话；"),
            h("li", null, "管理员权限、审批、白名单不受影响。")),
          h("p", { className: "qbw-hint" }, "确认理解并接受以上行为变化后再开启。确认后仍需点页面底部保存。"),
          h("div", { className: "qbw-actions", style: { marginTop: "12px" } },
            h(Btn, { onClick: onConfirm }, "确认开启"),
            h(Btn, { kind: "qbw-btn2", onClick: onClose }, "取消"))));
    }

    function AdminGentleDisableModal({ onKeep, onDiscard, onClose }) {
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h("div", { className: "qbw-modal", style: { maxWidth: "700px", maxHeight: "84vh", overflow: "auto" } },
          h("h3", null, "关闭温柔模式"),
          h("p", null, "关闭后，当前提示词不再注入管理员专属的语气/身份标记；管理员权限、审批、白名单不变。"),
          h("p", null, "但旧会话历史里已经写进去的“温柔 / 绝不回嘴”不会自动消失，模型仍可能按旧规则说话。你可以选择："),
          h("ul", { style: { paddingLeft: "20px", lineHeight: "20px" } },
            h("li", null, h("b", null, "只关闭，保留上下文："), "不丢聊天记忆；但旧语气可能残留，直到历史自然滚出或会话重置。"),
            h("li", null, h("b", null, "关闭并丢弃上下文："), "清空相关会话上下文，旧规则不再存在；但当前聊天记忆会丢失，且无法恢复。")),
          h("p", { className: "qbw-hint" }, "不确定就选“保留上下文”；之后仍可在设置里重置会话。选择后仍需点页面底部保存；丢弃上下文的选项会自动重启桥接。"),
          h("div", { className: "qbw-actions", style: { marginTop: "12px" } },
            h(Btn, { kind: "qbw-btn2", onClick: onKeep }, "只关闭，保留上下文"),
            h(Btn, { onClick: onDiscard }, "关闭并丢弃上下文"),
            h(Btn, { kind: "qbw-btn2", onClick: onClose }, "取消"))));
    }

    function AdminCard({ admin, onChange, qqPrivate = [], qqAllowAll = false, toast, onDiscardContext, onSave, busy, canSave = true }) {
      const [auditOpen, setAuditOpen] = useState(false);
      const [gentlePrompt, setGentlePrompt] = useState(null); // enable | disable
      const [uidCheck, setUidCheck] = useState(null); // {ok, match, actualName, error, hint}
      const [uidChecking, setUidChecking] = useState(false);
      const value = admin && typeof admin === "object" ? admin : {};
      const set = (key, next) => onChange({ ...value, [key]: next });
      const configured = Boolean(value.qq || value.biliMid || value.biliName);
      const aligned = Boolean(value.qq && value.biliMid);
      const privateList = (Array.isArray(qqPrivate) ? qqPrivate : []).map(String);
      const blockedPrivate = Boolean(value.qq) && !qqAllowAll && !privateList.includes(String(value.qq));
      const badge = aligned ? "ok" : configured ? "warn" : "bad";
      const badgeText = aligned ? "同一个人 ✓" : configured ? "只填了一边" : "未设置";
      const digits = (next) => String(next ?? "").replace(/[^\d]/g, "");
      // 核查 UID 与昵称是否同一个人：查 B站 公开名片，把真实昵称带回来比对。
      const checkUid = async () => {
        const mid = String(value.biliMid ?? "").trim();
        if (!/^\d{4,20}$/.test(mid)) {
          setUidCheck({ ok: false, error: "B站 UID 必须是 4~20 位数字", hint: "个人空间地址 space.bilibili.com/<数字> 里的那串数字" });
          return;
        }
        setUidChecking(true); setUidCheck(null);
        try {
          const r = await api("/bili/verify-user", { method: "POST", body: { mid, name: String(value.biliName ?? "").trim() } });
          setUidCheck(r);
          if (r.ok && r.match) toast(`✓ UID 与昵称一致：${r.actualName}（${r.mid}）`);
          else if (r.ok && !r.match) toast(`✗ 昵称对不上：B站 是「${r.actualName}」`);
          else toast(`✗ ${r.error || "核查失败"}`);
        } catch (e) {
          setUidCheck({ ok: false, error: e.message, hint: "检查网络能否访问 api.bilibili.com；稍后重试" });
          toast(`✗ 核查失败：${e.message}`);
        } finally { setUidChecking(false); }
      };
      return h("div", { className: "qbw-admin" },
        h("div", { className: "qbw-admin-head" },
          h("div", null,
            h("div", { className: "qbw-admin-title" },
              "管理员（QQ ⇄ B站 · 同一个人）",
              h("span", { className: "qbw-badge " + badge }, badgeText),
              h("span", { className: "qbw-pill" }, value.gentle === true ? "温柔 · 不回嘴" : "普通模式 · 只按人格卡")),
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
            h("small", null, "B站 评论区 / 私信 / 直播间认主用这个 mid（4~20 位数字）"),
            h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" } },
              h(Btn, { kind: "qbw-btn2", onClick: checkUid, disabled: uidChecking || !String(value.biliMid ?? "").trim() },
                uidChecking ? "核查中…" : "核查 UID 与昵称"),
              uidCheck
                ? h("span", { className: "qbw-hint", style: { color: uidCheck.ok ? (uidCheck.match ? "var(--qbw-ok-text)" : "var(--qbw-warn-text)") : "var(--qbw-err-text)" } },
                  uidCheck.ok
                    ? (uidCheck.match
                      ? `✓ 同一个人：${uidCheck.actualName}（${uidCheck.mid}）`
                      : `⚠ B站 上的昵称是「${uidCheck.actualName}」`)
                    : `✗ ${uidCheck.error || "核查失败"}`)
                : null),
            uidCheck && uidCheck.ok && !uidCheck.match
              ? h(Btn, { kind: "qbw-btn2", onClick: () => { set("biliName", uidCheck.actualName || ""); setUidCheck({ ...uidCheck, match: true, inputName: uidCheck.actualName }); } }, "用 B站 昵称填上")
              : null,
            uidCheck && !uidCheck.ok && uidCheck.hint
              ? h("small", null, `建议：${uidCheck.hint}`)
              : null),
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
              checked: value.gentle === true,
              onChange: (e) => setGentlePrompt(e.target.checked ? "enable" : "disable"),
            }),
            h("span", null, "对管理员更温柔、绝不回嘴")),
          h("span", { className: "qbw-hint" },
            value.gentle === true
              ? "QQ 消息和 B站 回复都适用；关闭前会解释旧上下文的影响。"
              : "默认关闭；开启前会弹窗列出全部行为风险，管理员权限不受影响。")),
        blockedPrivate
          ? h("div", { className: "qbw-warnbox" }, "⚠️ 管理员 QQ 不在私聊白名单 allow.private 里：私聊会被拦截（白名单为空时也没人放行）。去下面的「QQ 白名单」把 TA 加进去。")
          : null,
        configured && !aligned
          ? h("div", { className: "qbw-warnbox" }, "⚠️ 只填了一边：QQ 和 B站 要分别是同一个人的两个号，两边才都认得出。")
          : null,
        h("div", { className: "qbw-actions", style: { marginTop: "8px" } },
          h(Btn, { kind: "qbw-btn3", onClick: () => setAuditOpen(true) }, "管理操作记录（最近 50 条）"),
          onSave ? h(Btn, { onClick: onSave, disabled: !!busy || !canSave }, busy ? "保存中…" : "保存管理员并重启桥接") : null,
          onSave ? h("span", { className: "qbw-hint" }, "QQ 侧改完必须重启桥接才生效；这里只保存一次。") : null),
        gentlePrompt === "enable"
          ? h(AdminGentleEnableModal, {
            onClose: () => setGentlePrompt(null),
            onConfirm: () => {
              set("gentle", true);
              onDiscardContext?.(false);
              setGentlePrompt(null);
            },
          })
          : null,
        gentlePrompt === "disable"
          ? h(AdminGentleDisableModal, {
            onClose: () => setGentlePrompt(null),
            onKeep: () => {
              set("gentle", false);
              onDiscardContext?.(false);
              setGentlePrompt(null);
            },
            onDiscard: () => {
              set("gentle", false);
              onDiscardContext?.(true);
              setGentlePrompt(null);
            },
          })
          : null,
        auditOpen ? h(AuditModal, { onClose: () => setAuditOpen(false), toast }) : null);
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
    // 成本标签 + 重启标记（2026-11-06 用户第 6、13 条）：
    // 每个会影响 token 花费的设置项，在界面上直接标出来（💰 数量=影响档位），
    // 需要重启 DSH 才生效的，badge 里写成"改完需重启 DSH"。
    const FIELD_META = {
      "socialV2.engine.mode": { cost: 3, why: "机器模式最省" },
      "socialV2.cost.peakOffload": { cost: 1 },
      "socialV2.wait.mode": { cost: 2 },
      "socialV2.context.wakeMaxChars": { cost: 3 },
      "socialV2.context.wakeMessageLimit": { cost: 2 },
      "socialV2.context.wakeRecentLimit": { cost: 1 },
      "socialV2.context.rolloverTokens": { cost: 3 },
      "socialV2.context.rolloverTurns": { cost: 2 },
      "socialV2.wake.batchWindowMs": { cost: 2 },
      "socialV2.wake.batchWindowPrivateMs": { cost: 2 },
      "socialV2.wake.batchWindowDirectMs": { cost: 1 },
      "socialV2.wake.localFilterEnabled": { cost: 1, why: "省 token" },
      "socialV2.wake.localFilterRateMax": { cost: 1 },
      "socialV2.wake.recommendedProbability": { cost: 3 },
      "socialV2.proactive.enabled": { cost: 3 },
      "socialV2.proactive.probability": { cost: 3 },
      "socialV2.sticker.includeInPrompt": { cost: 2 },
      "socialV2.sticker.promptMaxStickers": { cost: 2 },
      "socialV2.sticker.matchEveryNWakes": { cost: 2 },
      "socialV2.vision.imageInput": { cost: 3, restart: true },
      "socialV2.voice.enabled": { cost: 1, restart: true },
      "tokenGuard.maxWakesPerDay": { cost: 3 },
      "tokenGuard.perGroupDailyCostCNY": { cost: 3 },
      "slang.enabled": { cost: 2 },
      "purpose.gapMinMs": { cost: 3 },
      "purpose.dailyMax": { cost: 3 },
      "biliBridge.dynamics.enabled": { cost: 2 },
      "biliBridge.share.enabled": { cost: 2 },
      "biliBridge.share.times": { cost: 2 },
    };
    const costBadgeOf = (pathStr, extra) => {
      if (extra && extra.badge) return extra.badge;
      let meta = FIELD_META[pathStr];
      if (!meta && /^socialV2\.tools\./.test(pathStr)) meta = { cost: 2, restart: true };
      if (!meta) return undefined;
      const coins = meta.cost ? "💰".repeat(meta.cost) : "";
      const tail = meta.restart ? "改完需重启 DSH" : (meta.why ?? "");
      return [coins, tail].filter(Boolean).join(" · ") || undefined;
    };
    const F = (path, label, hint, kind = "text", extra = {}) => {
      const key = Array.isArray(path) ? path.join(".") : String(path);
      const badge = costBadgeOf(key, extra);
      return { path: p(path), label, hint, kind, ...extra, ...(badge ? { badge } : {}) };
    };
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
        F("dsh.authToken", "DSH token", "通常留空，由桥接自动发现", "password"),
        F("dsh.allowRemote", "允许远程 DSH", "默认关；关掉只连本机", "switch"),
        F("dsh.followDefaultModel", "跟随 DSH 默认模型", "默认开；QQ 聊天/黑话学习跟随 Web GUI 的默认模型，关掉则用上面的 provider/model", "switch"),
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
        F("snowluma.webuiPort", "控制台端口（可选）", "留空自动读 config/runtime.json；读不到才回退 5100", "number", { min: 1, max: 65535 }),
        F("snowluma.webuiUrl", "控制台地址（可选）", "例如 http://127.0.0.1:5099；填了优先于端口", "text", { wide: true }),
        F("snowluma.launchMode", "启动方式", "detached=隐藏并脱离 DSH 进程树（推荐）；legacy=旧窗口，DSH 退出会一起结束", "select", { options: [["detached", "隐藏 + 脱离 DSH（推荐）"], ["legacy", "旧方式（可见窗口）"]] }),
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
        F("socialV2.ignoreSpamCommands", "忽略 # 刷屏指令", "默认开；非主人发的 #sl 这类短指令不唤醒/不回复；@/引用/主人不受影响", "switch"),
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
        F("socialV2.tokenGuard.perGroupEnabled", "每会话额度（按群/按私聊）", "默认关；开启后每个群或私聊单独计当日花费，防止一个大群把额度吃光", "switch"),
        F("socialV2.tokenGuard.perGroupDailyCostCNY", "每会话每日上限（元）", "默认 0=不限；例如 1.5 = 单个群/私聊每天最多花 ¥1.5，超了就只保留 @/私聊/引用等硬触发", "number", { min: 0 }),
        F("socialV2.tokenGuard.privateMaxWakesPerDay", "私聊每天最多醒", "默认 10；私聊爆破先卡这里", "number", { min: 0, max: 200 }),
        F("socialV2.tokenGuard.replyCheckFree", "回复后回访不占次数", "默认开；回完话的「他回没回」回访不算一次对话，不再吃掉每日次数（仍受 2 分钟间隔/小时限频/额度约束）", "switch"),
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
        F("socialV2.wake.batchWindowMs", "群聊合并窗口（ms）", "默认 6000；触发后先等这么久，把连发的几条收进同一个包只醒一次", "number", { min: 1000 }),
        F("socialV2.wake.batchWindowPrivateMs", "私聊合并窗口（ms）", "默认 4000；私聊节奏快，太长会显得迟钝", "number", { min: 1000 }),
        F("socialV2.wake.batchWindowDirectMs", "@/叫名字/拍一拍窗口（ms）", "默认 3000；被点名要立刻应，别干等", "number", { min: 1000 }),
        F("socialV2.wake.localFilterEnabled", "本地唤醒判断（免费漏斗）", "默认关。开启后先用 dry-run 统计，看看会拦掉多少条再切真拦；@/名字/拍一拍/私聊永不拦", "switch"),
        F("socialV2.wake.localFilterDryRun", "只统计不拦（dry-run）", "默认开；关掉才会真的拦下这些唤醒", "switch"),
        F("socialV2.wake.localFilterJunk", "拦垃圾消息", "纯表情/纯「6」「草」/纯标点不唤醒（消息留在未读里）", "switch"),
        F("socialV2.wake.localFilterRecentReplyMs", "刚回过就不插话（ms）", "0 = 关闭；例如 120000 = 两分钟内已经回过这个群，普通触发先不唤醒", "number", { min: 0 }),
        F("socialV2.wake.localFilterRateWindowMs", "唤醒频率窗口（ms）", "0 = 关闭；配合下一项，例如 600000（10 分钟）", "number", { min: 0 }),
        F("socialV2.wake.localFilterRateMax", "窗口内最多唤醒几次", "0 = 关闭；例如 3 = 10 分钟内已醒 3 次后普通触发不再唤醒", "number", { min: 0 }),
        F("socialV2.wake.maxWakePerMinute", "每分钟最多唤醒", "", "number", { min: 0 }),
        F("socialV2.wake.maxWakePerHour", "每小时最多唤醒", "", "number", { min: 0 }),
        F("socialV2.wake.noActionLimit", "无动作上限", "", "number", { min: 0 }),
        F("socialV2.wake.backlogMaxSessions", "启动补唤醒最多会话数", "backlog 冷启动最贵；默认 3，避免重启后一次叫醒太多会话", "number", { min: 1, max: 20 }),
        F("socialV2.wake.maxWakeConfigReminders", "唤醒配置提醒上限", "", "number", { min: 0 }),
        F("socialV2.wake.recommendedHint", "推荐提示词", "给模型的推荐说明", "textarea", { rows: 4 }),
      ]},
      { group: "二代 · 回合形态与成本", note: "机器模式=一次唤醒一次请求（文本自动转发、不做工具循环）；峰时顺延=价格 ×2 的时段只做硬触发，后台任务推到谷时", fields: [
        F("socialV2.engine.mode", "回合形态", "human=现在这样（常驻 agent、有工具、有主动性）；machine=AstrBot 式：一次唤醒一次请求，文本由桥接自动转发，后台任务全停", "select", { options: [["human", "人类模式（agent）"], ["machine", "机器模式（一问一答）"]] }),
        F("socialV2.cost.peakOffload", "峰时顺延后台任务", "默认开：9-12、14-18 点（价格 ×2）不跑背景任务，也不概率唤醒", "switch"),
        F("socialV2.wait.mode", "等待方式", "model=模型在回合里调 qq_wait_for_messages 等；bridge=模型说完就结束回合，有新消息由桥接再叫醒（更省）", "select", { options: [["model", "模型等（现状）"], ["bridge", "桥接等（省 token）"]] }),
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
        F("socialV2.wait.maxBatchMessages", "单次最多返回消息", "默认 20；群聊积压时只交付最近/最相关的一批，其余折叠", "number", { min: 1, max: 50 }),
        F("socialV2.wait.maxBatchChars", "单次最多正文字符", "默认 4000；超出时折叠较旧消息", "number", { min: 500, max: 20000 }),
        F("socialV2.context.recentLimit", "最近消息上限", "", "number"),
        F("socialV2.context.unreadLimit", "未读上限", "", "number"),
        F("socialV2.context.contextWindow", "上下文窗口", "", "number"),
        F("socialV2.context.inlineWakeMessages", "唤醒时内联消息", "", "switch"),
        F("socialV2.context.wakeFoldOld", "唤醒只带最近一窗（更早的未读折叠）", "开 = 从最近往回看；关 = 从最早未读开始塞（旧行为，积压时会先回老消息）", "switch"),
        F("socialV2.context.wakeMessageLimit", "唤醒消息上限", "", "number"),
        F("socialV2.context.wakeRecentLimit", "唤醒最近消息上限", "", "number"),
        F("socialV2.context.wakeMaxChars", "唤醒上下文最大字符", "", "number"),
        F("socialV2.context.rolloverEnabled", "会话太长自动换新会话", "默认开。一条会话聊太久，每次请求都要重发整段历史（实测 19.5 小时能到 43.5 万 token/步）", "switch"),
        F("socialV2.context.rolloverTokens", "换会话阈值（token）", "默认 80000；这条会话累计用到这么多就换。0 = 不按 token 判断", "number", { min: 0 }),
        F("socialV2.context.rolloverTurns", "换会话阈值（唤醒次数）", "默认 0 = 不按次数；两个阈值谁先到都算", "number", { min: 0 }),
        F("socialV2.context.rolloverSummary", "换会话时留交接", "默认开。记忆卡每轮都注入，所以只补一句「刚才聊到哪」，不额外花模型调用", "switch"),
        F("socialV2.context.rolloverKeepRecent", "交接里带最近几句", "默认 24", "number", { min: 4, max: 200 }),
        F("socialV2.context.rolloverSummaryMaxChars", "交接块字数上限", "默认 700", "number", { min: 120, max: 4000 }),
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
        F("webSearch.apiSearchURL", "直连搜索端点", "默认 https://api.deepseek.com/v1/tools；账号凭据只能发官方域名"),
        F("webSearch.model", "搜索模型", ""),
        F("webSearch.maxUses", "单次最多搜索", "", "number", { min: 1 }),
        F("webSearch.maxTokens", "最大 token", "", "number", { min: 1 }),
        F("webSearch.maxResults", "返回条数", "", "number", { min: 1 }),
        F("webSearch.timeoutMs", "超时（ms）", "", "number"),
      ]},
    ];

    const TOOL_LABELS = {
      getPrompt: "读取提示词", getSnapshot: "上下文快照", getUnread: "读未读", getRecent: "读最近", socialState: "社交状态",
      sendGroup: "发群消息", sendPrivate: "发私聊", reply: "引用回复", sendBurst: "分条发送",
      sendMessage: "统一发送", waitMessages: "等消息", feedback: "反馈", getMyRecent: "看我最近",
      getMessageDetail: "消息详情", getActiveMembers: "活跃成员", setWakeConfig: "设置唤醒",
      markRead: "标记已读", closeConversation: "对话收尾", memory: "轻量记忆", slangQuery: "查黑话", slangSubmit: "提交黑话",      getImages: "看图", getForwardMsg: "看合并转发", sendPoke: "拍一拍", listStickers: "表情列表",
      getStickerImage: "表情图片", sendSticker: "发表情", setStickerRemark: "改表情备注",
      stickerNote: "表情笔记", collectSticker: "收藏表情", getSelfImage: "看自己形象", sendVoice: "发语音",
    };

    const QQ_ADV_CATEGORIES = [
      { title: "接入与身份", members: ["连接与身份", "SnowLuma", "控制台", "安全通知"] },
      { title: "人格与提示", members: ["人格与注入", "一代仿真（reserved）", "二代仿真（reserved2）"] },
      { title: "群与安全", members: ["群管理", "鱼群判定关键词（QQ）", "鱼群保护（QQ）", "Token 防爆破"] },
      { title: "唤醒与收尾", members: ["唤醒与潜水", "二代 · 唤醒与潜水", "对话收尾", "二代 · 对话收尾判断", "二代 · 上线补历史消息"] },
      { title: "发送与上下文", members: ["二代 · 发送与节奏", "二代 · 等待与上下文", "二代 · 主动与反馈"] },
      { title: "群聊与学习", members: ["群聊（chat 模式）", "黑话学习", "联网搜索"] },
      { title: "工具与媒体", members: ["工具面", "二代 · 工具开关", "表情包", "图片能力", "语音"] },
      { title: "其他", members: null },
    ];

    const BILI_ADV_CATEGORIES = [
      { title: "身份与权限", members: ["她自己（只读）", "B站 会话权限"] },
      { title: "内容与口味", members: ["口味（文本）", "四类动态", "鱼群判定关键词（B站）", "鱼群保护（B站）"] },
      { title: "作息与分享", members: ["作息", "分享", "倾听（别人找她）", "日记与推送"] },
      { title: "额度与工具", members: ["额度（代码闸门）", "B站 视频缓存", "工具链"] },
      { title: "其他", members: null },
    ];

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
      { group: "互动与静默", note: "只看不说：关掉后不再评论/回复/搭话/发动态/分享/私信；仍会浏览、评分、写日记。额度里的 0 是“不限量”，不是关闭。", fields: [
        F("interact.enabled", "沉默逛 B 站（只看不说）", "开 = 正常互动；关 = 只浏览、评分、写日记，不对外发言", "switch"),
        F("interact.maxCommentAgeDays", "只回复多少天内的评论", "默认 14；0 = 不限（容易挖坟，不推荐）", "number", { min: 0, max: 365 }),
      ]},
      { group: "额度（代码闸门）", note: "四本账的硬上限；0 = 不限量（不是关闭）。要沉默逛请用上面的「互动与静默」。保存后下一轮生效，不用重启 DSH。", fields: [
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
        F("notify.type", "推送方式", "不推送 / 桌面通知 / QQ 私聊 / Webhook / 自定义命令", "select", { options: [["none", "不推送"], ["desktop", "桌面通知"], ["qq", "QQ 私聊管理员"], ["webhook", "Webhook"], ["command", "自定义命令"]] }),
        F("notify.url", "Webhook 地址", "飞书/钉钉/企业微信/QQ机器人", "text", { wide: true }),
        F("notify.template", "模板", "纯文本 / markdown", "select", { options: [["text", "纯文本"], ["markdown", "markdown"]] }),
        F("notify.cmd", "自定义命令", "可执行文件；消息自动作为最后一个参数", "text", { wide: true }),
        F("notify.args", "命令参数", "JSON 数组", "json"),
      ]},
      { group: "B站 视频缓存", note: "watch-video / debrief / subtitles 共用的 shots 目录；默认保留 7 天。原片默认抽完即删，需要重抽时用 --keep-mp4。", fields: [
        F("shots.dir", "缓存目录", "留空 = <DSH_HOME>/shots；也可以填绝对路径", "text", { wide: true, browse: "dir" }),
        F("shots.retentionDays", "保留天数", "默认 7；0 = 不按天清理", "number", { min: 0 }),
        F("shots.maxMB", "总大小上限（MB）", "0 = 不限；超出后从最旧文件开始清", "number", { min: 0 }),
      ]},
      { group: "工具链", fields: [
F("toolsPath", "bili.mjs 路径", "留空 = 用合体插件自带的 tools/", "text", { wide: true, browse: "file" }),
      ]},
    ];

    // ── 作息窗口编辑器 ──────────────────────────────────────────────────────
    const NUMS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];
    function WindowsEditor({ value, onChange }) {
      const list = Array.isArray(value) ? value : [];
      const normalizeTime = (raw) => String(raw ?? "").trim()
        .replace(/：/g, ":")
        .replace(/[０-９]/g, (ch) => String("０１２３４５６７８９".indexOf(ch)));
      const upd = (i, patch) => onChange(list.map((w, j) => (j === i ? { ...w, ...patch } : w)));
      const del = (i) => onChange(list.filter((_, j) => j !== i));
      const add = () => onChange([...list, { start: "20:00", end: "22:00", wakes: 1 }]);
      return h("div", null,
        list.length === 0 ? h("div", { className: "qbw-warnbox" }, "没有窗口 = 永远不醒；至少加一个。") : null,
        h("div", { className: "qbw-list" }, list.map((w, i) => h("div", { className: "qbw-item", key: i },
          h("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } },
            h("span", { className: "qbw-hint", style: { minWidth: "18px" } }, NUMS[i] ?? String(i + 1)),
            h("input", { className: "qbw-input", style: { width: "90px", minWidth: "90px" }, value: w.start ?? "", onChange: (e) => upd(i, { start: e.target.value }), onBlur: (e) => upd(i, { start: normalizeTime(e.target.value) }) }),
            h("span", { className: "qbw-hint" }, "–"),
            h("input", { className: "qbw-input", style: { width: "90px", minWidth: "90px" }, value: w.end ?? "", onChange: (e) => upd(i, { end: e.target.value }), onBlur: (e) => upd(i, { end: normalizeTime(e.target.value) }) }),
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
    function UpdatesModal({ status, onClose, onDone, onStaged, toast }) {
      const pending = Array.isArray(status?.pending) ? status.pending : [];
      // 远端只拿到提交号时显示「提交 abc1234」而不是 "vabc1234"（否则用户以为是乱码）
      const fmtV = (v) => {
        const t = String(v ?? "").trim();
        if (!t) return "?";
        return /^[0-9a-f]{7,40}$/i.test(t) ? `提交 ${t.slice(0, 7)}` : `v${t}`;
      };
      const [selected, setSelected] = useState(() => new Set(pending.map((item) => item.id)));
      const [never, setNever] = useState(false);
      const [working, setWorking] = useState(false);
      // 下载进度：应用期间轮询 /updates，显示已下载/总量/速度/百分比（2026-10-31 用户要求）
      const [dl, setDl] = useState(null);
      const sizeText = (n) => (Number(n) > 0 ? `${(Number(n) / 1024 / 1024).toFixed(1)} MB` : "0 MB");
      const speedText = (n) => {
        const v = Number(n) || 0;
        if (v <= 0) return "";
        return v >= 1024 * 1024 ? `${(v / 1024 / 1024).toFixed(1)} MB/s` : `${Math.round(v / 1024)} KB/s`;
      };
      const phaseText = (d) => {
        if (!d) return "正在准备更新…";
        const label = d.phase === "extract"
          ? "下载完成，正在解压"
          : d.phase === "verify"
            ? "下载完成，正在校验"
            : d.phase === "backup"
              ? "下载完成，正在备份"
              : d.phase === "install"
                ? "下载完成，正在安装"
                : d.phase === "stage"
                  ? "下载完成，正在排队"
                  : d.phase === "pending"
                  ? "下载完成，等待重启"
                  : d.phase === "failed"
                    ? "更新失败"
                    : "下载中";
        const stats = `${sizeText(d.bytes)}${d.total ? ` / ${sizeText(d.total)}` : " / 总大小未知（GitHub 归档）"}${d.speedBps ? ` · ${speedText(d.speedBps)}` : ""}${d.percent != null ? ` · ${d.percent}%` : ""}`;
        return `${label} ${stats}`;
      };
      const toggle = (id) => setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      const applySelected = async (opts = {}) => {
        const overwriteModified = opts?.overwriteModified === true;
        const firstInstall = opts?.firstInstall === true;
        const ids = [...selected];
        if (!ids.length) return;
        setWorking(true);
        setDl(null);
        const readProgress = async () => {
          try {
            const st = await api("/updates");
            if (st?.download) setDl(st.download);
          } catch {}
        };
        void readProgress();
        const poll = setInterval(readProgress, 500);
        try {
          const r = await api("/updates", { method: "POST", body: { action: "apply", ids, overwriteModified, firstInstall } });
          await readProgress();
          const failed = (r.results ?? []).filter((x) => !x.ok);
          const staged = (r.results ?? []).filter((x) => x.ok && x.staged);
          if (r.ok && staged.length) {
            // 延后应用：文件已下载到 staging，宿主退出后才覆盖（避免覆盖正在使用的模块导致崩溃）
            toast(`⏳ 已下载 ${staged.length} 个组件，退出并重新打开 DSH 后应用（尚未更新）`);
            onStaged?.(staged.length);
          } else if (r.ok) toast(`✓ 已更新 ${r.updated} 个组件${r.restartRequired ? "，请重启对应服务" : ""}`);
          else {
            // 2026-11-06：服务端有时只回顶层 error（例如 "正在更新中，请稍候"），
            // 以前只看 results[0] → 显示"原因不明"。这里把顶层也纳入兜底。
            const f = failed[0] ?? { code: r.code, reason: r.reason, error: r.error, hint: r.hint };
            toast(`✗ 更新失败${f.code ? `（${f.code}）` : ""}：${f.reason ?? f.error ?? "原因不明"}${f.hint ? `；建议：${f.hint}` : ""}`);
          }
          if (r.code === "apply.busy") {
            // 忙锁不是失败结束：保留弹窗，让用户能看到原因并在锁释放后重试。
          } else onDone?.(r);
        } catch (e) { toast(`✗ 更新失败：${e.message}`); }
        finally { clearInterval(poll); setWorking(false); }
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
        h("div", { className: "qbw-modal", style: { maxWidth: "600px", maxHeight: "82vh", display: "flex", flexDirection: "column" } },
          h("h3", { style: { flexShrink: 0 } }, pending.length > 1 ? `发现 ${pending.length} 个可用更新` : "发现可用更新"),
          h("div", { style: { flex: "1 1 auto", minHeight: 0, overflow: "auto", paddingRight: "2px" } },
          h("p", null, (() => {
            // 让用户一眼看到"这次更新到什么版本"（以前只有提交列表，用户不知道是哪个版本）
            const withVer = pending.filter((x) => x.latestVersion);
            if (!withVer.length) return "git 安装做快进（--ff-only）；zip 安装会下载新包覆盖代码。两种都不会动 config.json 与记忆卡。";
            const parts = withVer.map((x) => `${x.name} v${x.installedVersion || "?"} → ${fmtV(x.latestVersion)}`);
            return `${parts.join("　")}；更新不会动 config.json 与记忆卡。`;
          })()),
          h("p", { style: { fontSize: "12px", color: "var(--qbw-warn-text)", marginTop: "2px" } },
            "⚠️ 下载/更新完成后需要完全退出 DSH 再打开才会生效；只刷新设置页不会应用。"),
          (() => {
            // 更新通道：正式用户 stable（默认）；测试机才切 dev（只跟 -dev.N 预发布）
            const ch = status?.channel === "dev" ? "dev" : "stable";
            const switchChannel = async (next) => {
              if (next === ch) return;
              setWorking(true);
              try {
                const r = await api("/updates", { method: "POST", body: { action: "set-channel", channel: next } });
                if (!r.ok) throw new Error(r.error || "切换通道失败");
                toast(`✓ 已切到${next === "dev" ? "测试" : "稳定"}通道；正在重新检查…`);
                onDone?.();
              } catch (e) { toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`); }
              finally { setWorking(false); }
            };
            return h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" } },
              h("span", { className: "qbw-label", style: { margin: 0 } }, "更新通道"),
              h("select", { className: "qbw-select", value: ch, disabled: working, onChange: (e) => switchChannel(e.target.value) },
                h("option", { value: "stable" }, "stable（正式版，默认）"),
                h("option", { value: "dev" }, "dev（测试版，只给测试机）")),
              h("span", { className: "qbw-hint" }, ch === "dev"
                ? "只安装 vX.Y.Z-dev.N 的 Pre-release；正式用户不要开。"
                : "只安装正式 Release；Pre-release 不会打扰你。"));
          })(),
          pending.length ? pending.map((item) => h("div", { key: item.id, style: { border: "1px solid rgba(127,127,127,.24)", borderRadius: "10px", padding: "10px 12px", margin: "0 0 8px" } },
            h("label", { style: { display: "flex", gap: "8px", alignItems: "center", fontWeight: 600 } },
              h("input", { type: "checkbox", checked: selected.has(item.id), onChange: () => toggle(item.id), disabled: working }),
              item.name,
              h("span", { className: "qbw-chip", style: { marginLeft: "auto" } },
                item.channel === "version" || item.channel === "dev"
                  ? `v${item.installedVersion} → ${fmtV(item.latestVersion)}${item.channel === "dev" ? "（测试通道）" : ""}`
                  : item.channel === "release"
                    ? `${item.installedVersion ? `v${item.installedVersion}` : "未安装"} → ${fmtV(item.latestVersion)}`
                    : (item.latestVersion
                      ? `v${item.installedVersion || "?"} → ${fmtV(item.latestVersion)}（${item.behind} 个提交）`
                      : `${item.behind} 个提交（到 ${String(item.remote || "").slice(0, 7)}）`))),
            h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
              `${item.dir} · ${item.branch ?? ""}${item.dirty ? ` · ⚠️ 本地有 ${item.dirty} 处改动` : ""}${item.ahead ? ` · ⚠️ 本地领先 ${item.ahead}` : ""}${Number(item.asset?.size) > 0 ? ` · 安装包 ${sizeText(item.asset.size)}` : (item.channel === "dev" || item.channel === "version" ? " · 包大小未知（GitHub 归档）" : "")} · ${item.channel === "release" ? "版本清单" : item.channel === "version" ? "版本追踪" : item.channel === "dev" ? "测试通道（Pre-release）" : "git 仓库"}`),
            item.blocked ? h("div", { className: "qbw-hint", style: { color: "var(--qbw-err-text)" } }, `不能自动更新：${item.blocked}`) : null,
            item.blocked ? h("div", { className: "qbw-hint" }, "处理办法：本仓库有未提交改动时，先 commit/stash 再更新；或者直接用新版本的 zip 覆盖安装。") : null,
            (item.changelog ?? []).length ? h("ul", { style: { margin: "6px 0 0 18px", padding: 0, fontSize: "11.5px", lineHeight: "18px", opacity: 0.82 } },
              item.changelog.slice(0, 8).map((line, index) => h("li", { key: index }, line))) : null,
            (item.changelog ?? []).length > 8 ? h("div", { className: "qbw-hint" }, `…另有 ${item.changelog.length - 8} 条`) : null)) : h("p", null, "当前没有可用更新。"),
          h("label", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "4px" } },
            h("input", { type: "checkbox", checked: never, onChange: (e) => setNever(e.target.checked), disabled: working }),
            h("span", { className: "qbw-hint" }, "不再提示本次更新（只对这次的远端版本生效；有更新提交时会重新提醒）")),
            (() => {
            const la = status?.lastApply;
            if (!la || la.status !== "failed") return null;
            return h("div", {
              className: "qbw-err",
              style: { marginTop: "6px", padding: "8px 10px", borderRadius: "8px", background: "rgba(192,57,43,.12)" },
            },
            h("div", { style: { fontWeight: 600 } }, `更新被阻止（${la.code || "failed"}）`),
            (la.mismatchCount || la.missingCount)
              ? h("div", { className: "qbw-hint", style: { marginTop: "2px" } },
                `清单不符 ${la.mismatchCount ?? 0} 个 / 缺失 ${la.missingCount ?? 0} 个`)
              : null,
            h("div", { className: "qbw-hint", style: { marginTop: "2px" } }, la.reason || "原因不明"),
            la.hint ? h("div", { className: "qbw-hint", style: { marginTop: "2px" } }, `建议：${la.hint}`) : null,
            h("div", { style: { display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" } },
              h(Btn, { kind: "qbw-btn2", onClick: async () => {
                try {
                  await navigator.clipboard.writeText(JSON.stringify({ at: la.at, code: la.code, reason: la.reason, hint: la.hint, version: la.version ?? "" }, null, 2));
                  toast("✓ 诊断信息已复制");
                } catch (e) { toast(`✗ 复制失败：${e.message}`); }
              } }, "复制诊断"),
              la.code === "local-modifications" ? h(Btn, {
                onClick: async () => {
                  const n = Number(la.modifiedCount) || 0;
                  if (!window.confirm(`将先备份 ${n ? n + " 个" : "这些"}被本地改过的文件，再覆盖为最新版。\n\n备份在 state/backups，可随时恢复。继续？`)) return;
                  await applySelected({ overwriteModified: true });
                },
              }, `备份并覆盖${la.modifiedCount ? `（${la.modifiedCount} 个）` : ""}`) : null,
              la.code === "evidence-insufficient" ? h(Btn, {
                onClick: async () => {
                  if (!window.confirm("这是首次 zip 安装更新，目录里还没有安装记录。\n\n会先把当前文件备份到 state/backups，再覆盖为最新版；只对官方 zip 解压安装使用。\n\n继续？")) return;
                  await applySelected({ firstInstall: true });
                },
              }, "首次更新（先备份）") : null,
              h(Btn, { kind: "qbw-btn2", onClick: () => window.open("https://github.com/Mieksido/surfcore/releases/latest", "_blank", "noopener") }, "去下载新版")));
          })(),
          working ? h(ProgressBar, {
            pct: dl?.percent ?? 0,
            phase: phaseText(dl),
            // 有真实百分比就一直显示百分比；只有完全拿不到 total 时才用跑马灯。
            indeterminate: !dl || dl.percent == null,
          }) : null),
          h("div", { className: "qbw-actions", style: { flexShrink: 0, paddingTop: "10px" } },
            h(Btn, { kind: "qbw-btn2", onClick: () => (never ? dismissThis() : onClose?.()), disabled: working },
              never ? "不再提示本次" : "稍后"),
            h(Btn, {
              onClick: applySelected,
              disabled: working || !selected.size || status?.lastApply?.deterministic === true,
            },
              status?.lastApply?.deterministic === true
                ? "此版本无法自动更新（请手动下载）"
                : (working ? "更新中…" : `立即更新（${selected.size}）`)))));
    }

    // 插件冲突体检报告：只读结果；明确写出“未覆盖项”，避免把“没查到”当“兼容”。
    function CompatModal({ report, error, onClose, onRetry, busy, toast }) {
      const issues = Array.isArray(report?.issues) ? report.issues : [];
      const sevLabel = { blocker: "阻断", high: "高风险", warn: "警告", info: "信息" };
      const confLabel = { confirmed: "已确认", inferred: "按已知规则推断", unknown: "未覆盖/未知" };
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(JSON.stringify(report ?? error, null, 2));
          toast?.("✓ 报告已复制");
        } catch (e) {
          toast?.(`✗ 复制失败：${e.message}；请截图报告`);
        }
      };
      const issueRows = issues.map((it, i) => h("div", {
        key: `${it.code}-${i}`,
        style: { border: "1px solid rgba(127,127,127,.25)", borderRadius: "8px", padding: "9px 10px", marginTop: "8px" },
      },
        h("div", { style: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
          h("b", null, it.title || it.code),
          h("span", { className: "qbw-badge " + (it.severity === "blocker" || it.severity === "high" ? "bad" : "warn") },
            `${sevLabel[it.severity] ?? it.severity} · ${confLabel[it.confidence] ?? it.confidence}`),
          h("span", { className: "qbw-hint" }, it.code)),
        h("div", { className: "qbw-hint", style: { marginTop: "3px" } }, `影响：${it.impact || "未说明"}`),
        h("div", { className: "qbw-hint", style: { marginTop: "2px" } }, `建议：${it.recommendation || "未说明"}`),
        it.evidence ? h("details", { style: { marginTop: "4px" } },
          h("summary", { className: "qbw-hint" }, "证据"),
          h("pre", { className: "qbw-out", style: { maxHeight: "150px", overflow: "auto", marginTop: "3px", whiteSpace: "pre-wrap", wordBreak: "break-all" } },
            JSON.stringify(it.evidence, null, 2))) : null));
      const unknown = report?.coverage?.unknownBundles ?? [];
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget && !busy) onClose?.(); } },
        h("div", { className: "qbw-modal", style: { width: "min(720px, 94vw)", maxHeight: "86vh", overflow: "auto" } },
          h("h3", null, error ? "插件体检失败" : "插件冲突体检"),
          error ? h("div", null,
            h("div", { className: "qbw-err" }, `${error.code ? `（${error.code}）` : ""}${error.message}`),
            h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, error.hint || "确认 DSH 已安装、profile 可读后重试。"))
            : h("div", null,
              h("div", { className: "qbw-hint" },
                report?.ok
                  ? "未发现已知冲突。注意：这不等于“兼容”，未覆盖项见下。"
                  : "发现需要处理的风险；报告只读，不会自动改配置。"),
              h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
                `profile：${report?.profile?.name ?? "未知"} · SurfCore ${report?.versions?.surfcore ?? "?"} · DSH ${report?.versions?.dsh ?? "未知"} · ${report?.scannedAt ?? ""}`),
              h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
                `已看：${report?.coverage?.packages ?? 0} 个包 / ${report?.coverage?.bundles?.length ?? 0} 个 bundle；已知工具 ${report?.coverage?.toolsKnown?.length ?? 0} 个`),
              unknown.length ? h("div", { className: "qbw-hint", style: { color: "var(--qbw-warn-text)", marginTop: "4px" } },
                `未枚举工具的插件 ${unknown.length} 个：${unknown.map((x) => x.name).join("、")}`) : null,
              (report?.coverage?.unchecked ?? []).length
                ? h("div", { className: "qbw-hint", style: { marginTop: "2px" } }, `未检查：${report.coverage.unchecked.join("、")}`)
                : null,
              h("div", { style: { marginTop: "8px" } }, issues.length ? issueRows : h("div", { className: "qbw-hint" }, "没有已知问题。"))),
          h("div", { className: "qbw-actions", style: { marginTop: "12px" } },
            h(Btn, { kind: "qbw-btn2", onClick: copy, disabled: !report && !error }, "复制报告"),
            h(Btn, { kind: "qbw-btn2", onClick: onRetry, disabled: !!busy }, busy === "compat" ? "体检中…" : "重新体检"),
            h(Btn, { onClick: onClose, disabled: !!busy }, "关闭"))));
    }

    // 闸门 L2/L3 弹窗：必须说明“哪个门、挡了什么、影响、下一步”，不能只弹“已拒绝”。
    function GateAlertModal({ event, onClose, onAck }) {
      if (!event) return null;
      const urgent = event.level === "L3";
      const canRepairDsh = event.gate === "dsh" && event.event === "dsh-profile-mcp-missing";
      const [repairing, setRepairing] = useState(false);
      const [repairMsg, setRepairMsg] = useState("");
      const repairDsh = async () => {
        setRepairing(true);
        setRepairMsg("");
        try {
          const r = await api("/dsh/repair", { method: "POST", body: {} });
          if (!r.ok) throw new Error(r.error || "修复失败");
          setRepairMsg(r.hint || "已写回；请完全退出并重开 DSH。");
        } catch (e) {
          setRepairMsg(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally { setRepairing(false); }
      };
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h("div", { className: "qbw-modal", style: { width: "min(620px, 94vw)", maxHeight: "86vh", overflow: "auto" } },
          h("h3", null, urgent ? "安全/成本警报（L3）" : "需要处理的安全提醒（L2）"),
          h("div", { className: "qbw-hint" }, `${event.level} · ${event.gate} · ${event.event}`),
          h("p", { style: { marginTop: "8px" } }, event.impact || event.reason?.message || "闸门触发了拦截。"),
          event.reason?.message ? h("div", { className: "qbw-hint" }, `原因：${event.reason.message}`) : null,
          // 具体是哪个工具/哪个会话：turn-guard 的事件只给泛化文案，用户看不懂"哪个工具在循环"。
          event.evidence?.tool ? h("div", { className: "qbw-hint", style: { marginTop: "4px" } }, `工具：${event.evidence.tool}${event.evidence.count ? `（${event.evidence.count} 次）` : ""}`) : null,
          event.evidence?.fingerprint ? h("div", { className: "qbw-hint", style: { marginTop: "2px", opacity: 0.75, wordBreak: "break-all" } }, `错误：${String(event.evidence.fingerprint).slice(Math.max(0, String(event.evidence.fingerprint).indexOf(":") + 1), 220)}`) : null,
          event.subject?.key ? h("div", { className: "qbw-hint", style: { marginTop: "2px" } }, `会话：${event.subject.key}`) : null,
          event.recommendation ? h("div", { className: "qbw-hint", style: { marginTop: "4px" } }, `建议：${event.recommendation}`) : null,
          h("div", { className: "qbw-hint", style: { marginTop: "4px" } }, "这条记录会保留；确认后不再自动弹同一事件。"),
          repairMsg ? h("div", { className: "qbw-hint", style: { marginTop: "6px", color: "var(--qbw-warn-text)" } }, repairMsg) : null,
          h("div", { className: "qbw-actions", style: { marginTop: "12px" } },
            canRepairDsh ? h(Btn, { onClick: repairDsh, disabled: repairing || !!repairMsg }, repairing ? "修复中…" : "修复 DSH 注册（MCP / bundle）") : null,
            h(Btn, { onClick: () => onAck?.(event.id) }, urgent ? "确认并关闭" : "确认"),
            h(Btn, { kind: "qbw-btn2", onClick: onClose }, "稍后"))));
    }

    // 通用错误报告弹窗（AGENTS 1.7）：失败必须可见 + 给下一步。
    // 只在"用户必须知道并做个选择"的失败上用；普通提示仍用 toast。
    function LimitReportCard({ events = [], goTab, onAck, onMute }) {
      if (!events.length) return null;
      return h("div", { className: "qbw-card", style: { borderColor: "rgba(214,137,16,.45)", marginTop: "10px" } },
        h("h4", null, "错误报告 / 限制提醒 ", h("span", { className: "qbw-badge warn" }, `${events.filter((ev) => !ev.ack).length} 条未确认`)),
        h("p", { className: "qbw-hint" }, "这些不是“随便失败了”：是某个设置上限或超时把动作挡住了。这里不弹窗；你可以去改设置，或确认这是你有意设的限制。"),
        events.slice(0, 8).map((ev) => h("div", { key: ev.id, className: "qbw-item", style: { marginTop: "6px" } },
          h("div", null,
            h("div", { className: "qbw-label" }, ev.reason?.message || ev.event, h("span", { className: "qbw-badge" }, ev.ack ? "已确认" : "未确认")),
            h("div", { className: "qbw-hint" }, ev.recommendation || ev.impact || ""),
            ev.evidence?.path ? h("div", { className: "qbw-hint" }, "设置位置：" + ev.evidence.path) : null,
            ev.evidence?.setting ? h("div", { className: "qbw-hint" }, `配置项：${ev.evidence.setting} · 当前 ${ev.evidence.current ?? "?"} / 上限 ${ev.evidence.limit ?? "?"}`) : null),
          h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "2px", paddingTop: "0" } },
            h(Btn, { kind: "qbw-btn2", onClick: () => goTab?.(ev.evidence?.tab || "qq") }, "去改设置"),
            ev.ack ? null : h(Btn, { kind: "qbw-btn2", onClick: () => onAck?.(ev.id) }, "知道了（本限制提醒）"),
            ev.ack ? null : h(Btn, { kind: "qbw-btn2", onClick: () => onMute?.(ev) }, "永久不再显示")))));
    }

    function ErrorModal({ title, message, hint, tried, actions = [], disabled, onClose }) {
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h("div", { className: "qbw-modal" },
          h("h3", null, "⚠️ " + (title || "操作失败")),
          message ? h("p", null, message) : null,
          hint ? h("p", { className: "qbw-hint" }, hint) : null,
          (tried || []).length
            ? h("details", { style: { marginTop: "4px" } },
              h("summary", { style: { cursor: "pointer", fontSize: "12px", opacity: 0.8 } }, `试过 ${tried.length} 个位置（点开看）`),
              h("ul", { style: { margin: "6px 0 0", paddingLeft: "18px", fontSize: "11.5px", lineHeight: "17px", wordBreak: "break-all" } },
                tried.map((p, i) => h("li", { key: i }, p))))
            : null,
          h("div", { className: "qbw-actions" },
            ...(actions || []).map((a) => h(Btn, {
              key: a.label, ...(a.kind ? { kind: a.kind } : {}), disabled: disabled || a.disabled, onClick: a.onClick,
            }, a.label)),
            h(Btn, { kind: "qbw-btn2", onClick: onClose }, "关闭"))));
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
      // ── 一键启动 / 停止（QQ+B站+桌宠+语音）────────────────────────────
      const launch = overview?.launch ?? {};
      const voiceKnown = launch.voice?.ok !== false;
      const [launchSel, setLaunchSel] = useState({ qq: true, bili: true, pet: false, voice: false, vector: false });
      const [hideConsoles, setHideConsoles] = useState(unified?.platforms?.hideConsoles !== false);
      const [voiceBranch, setVoiceBranch] = useState("voice-local");
      const [vectorPack, setVectorPack] = useState("");
      const [snowAccountOpen, setSnowAccountOpen] = useState(false);
      const [snowAccountData, setSnowAccountData] = useState(null);
      const [snowAccountErr, setSnowAccountErr] = useState(null);
      const [snowAccountBusy, setSnowAccountBusy] = useState("");
      const [snowWebuiPass, setSnowWebuiPass] = useState("");
      useEffect(() => {
        if (vectorPack) return;
        const v = launch?.vector;
        if (!v) return;
        const next = v.provider === "cloud" && v.cloudActive
          ? `cloud:${v.cloudActive}`
          : (v.selected ? `local:${v.selected}` : ((v.models ?? []).find((m) => m.valid) ? `local:${(v.models ?? []).find((m) => m.valid).id}` : ""));
        if (next) setVectorPack(next);
      }, [launch?.vector?.provider, launch?.vector?.cloudActive, launch?.vector?.selected, launch?.vector?.models, vectorPack]);
      const [launchResult, setLaunchResult] = useState(null);
      const [launchErr, setLaunchErr] = useState(null);
      // ── 组件更新（2026-10-26）──────────────────────────────────────────
      // 检查在插件里做（git fetch，只读）；界面只负责展示与确认。
      const updates = overview?.updates ?? {};
      const [updateOpen, setUpdateOpen] = useState(false);
      const [compat, setCompat] = useState(null);
      const [compatError, setCompatError] = useState(null);
      const [gateData, setGateData] = useState(null);
      const [gateAlert, setGateAlert] = useState(null);
      const dismissedGates = useRef(new Set());
      // 更新后必须重启 DSH：检查到更新、以及下载完成后都主动提示（只刷新页面不会应用）
      const [restartHint, setRestartHint] = useState(null);
      const [tokenDraft, setTokenDraft] = useState("");
      const saveGithubToken = async (clear = false) => {
        setBusy("token");
        try {
          const r = await api("/updates", { method: "POST", body: clear ? { action: "clear-token" } : { action: "set-token", token: tokenDraft.trim() } });
          if (!r.ok) throw new Error(r.error ?? "保存失败");
          toast(clear ? "✓ 已清除令牌（回到匿名 60 次/小时）" : "✓ 令牌已保存（检查更新改用账号额度 5000 次/小时）");
          setTokenDraft("");
          await reload();
        } catch (e) {
          toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally { setBusy(""); }
      };
      const [snowError, setSnowError] = useState(null);
      // 手动导入 SnowLuma：先说明"导入的是什么"，再开选择框
      const [snowImport, setSnowImport] = useState(false);
      const [autoPrompted, setAutoPrompted] = useState(false);
      // 更新弹窗只在「这个版本还没提醒过」时自动弹一次（2026-10-31 用户反馈：
      // 每次打开设置页都弹，服务都还没启动就先被拦一下）。
      // 记在 localStorage：同一批版本只自动弹一次；「稍后」也不会第二天重弹；换新版本会再提醒。
      const UPDATE_PROMPT_SEEN_KEY = "surfcore.updatePromptSeen";
      const updatePromptSignature = (results) => (Array.isArray(results) ? results : [])
        .filter((x) => x && x.updateAvailable)
        .map((x) => `${x.id ?? x.name ?? ""}@${x.latestVersion ?? x.latestSha ?? ""}`)
        .sort().join("|");
      useEffect(() => {
        if (autoPrompted || !updates?.showPrompt) return;
        const sig = updatePromptSignature(updates.results);
        if (!sig) return;
        let seen = "";
        try { seen = localStorage.getItem(UPDATE_PROMPT_SEEN_KEY) || ""; } catch {}
        setAutoPrompted(true);
        if (seen === sig) return; // 这个版本提醒过：只保留卡片入口，不再自动弹
        try { localStorage.setItem(UPDATE_PROMPT_SEEN_KEY, sig); } catch {}
        setUpdateOpen(true);
      }, [updates?.showPrompt, updates?.results, autoPrompted]);
      const checkUpdates = async ({ openOnHit = true } = {}) => {
        setBusy("updates");
        try {
          const r = await api("/updates", { method: "POST", body: { action: "check" } });
          const n = r.pendingCount ?? 0;
          const unknown = r.unknownCount ?? 0;
          const pendingRestart = r.lastApply?.status === "pending_restart";
          toast(n
            ? `发现 ${n} 个组件有更新（安装后需重启 DSH）`
            : pendingRestart
              ? "✓ 更新已下载，请重启 DSH 生效"
              : unknown
                ? `无法判定 ${unknown} 个组件是否有更新（见详情）`
                : "已是最新");
          if (n) setRestartHint({ staged: false, count: n });
          else if (pendingRestart) setRestartHint({ staged: true, count: 1 });
          if (n && openOnHit) setUpdateOpen(true);
          await reload();
          return r;
        } catch (e) {
          toast(`✗ 检查更新失败：${e.message}`);
          return null;
        } finally { setBusy(""); }
      };
      // 更新通道：main/stable 只跟正式 Release；dev 只跟 -dev.N 的 Pre-release（测试机才用）
      const switchUpdateChannel = async (channel) => {
        if ((updates?.channel ?? "stable") === channel) return;
        setBusy("channel");
        try {
          const r = await api("/updates", { method: "POST", body: { action: "set-channel", channel } });
          if (!r.ok) throw new Error(r.error || "切换通道失败");
          toast(channel === "dev"
            ? "✓ 已切到 dev 测试通道（只装 -dev.N 构建）；正检查更新…"
            : "✓ 已切回 main 稳定通道（只装正式 Release）");
          await checkUpdates();
        } catch (e) {
          toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally { setBusy(""); }
      };
      // 插件冲突体检：只读扫描；结果必须带“未覆盖项”，不能把“没查到”说成“兼容”。
      const runCompat = async () => {
        setBusy("compat");
        try {
          const r = await api("/compat/scan");
          setCompat(r);
          setCompatError(null);
        } catch (e) {
          setCompat(null);
          setCompatError({
            message: String(e.message || e),
            code: e.code || "",
            hint: e.hint || "确认 DSH 已安装、DSH_HOME/profiles 可读；必要时重启 DSH 后重试。",
          });
        } finally { setBusy(""); }
      };
      // 闸门事件：L2/L3 才弹；L0/L1 只留在通知列表，不打断。
      const gateOverviewRef = useRef(overview);
      useEffect(() => { gateOverviewRef.current = overview; }, [overview]);
      const loadGateEvents = useCallback(async () => {
        try {
          const r = await api("/gate-events?limit=30&includeAcked=0");
          let events = r.events ?? [];
          // 已经连上 SnowLuma 时，旧的「send-channel-down」不该再弹（用户明明连着）。
          // 顺手自动确认掉，避免每次打开设置页都弹同一个 L2。
          const sl = gateOverviewRef.current?.bridge?.snowluma ?? {};
          // 已连接 → 旧的“断线”告警是历史；从没连过 → SnowLuma 根本还没启动，也不该弹。
          const connected = sl.connected === true;
          const neverStarted = sl.everConnected === false;
          if (connected || neverStarted) {
            const stale = events.filter((e) => e.dedupeKey === "snowluma:send-channel-down");
            if (stale.length) {
              api("/gate-events", { method: "POST", body: { ids: stale.map((e) => e.id) } }).catch(() => {});
              events = events.filter((e) => !stale.includes(e));
            }
          }
          setGateData({ ...r, events });
          // 概览还没加载时先不弹：否则无法判断“现在是否其实连着”，会误弹一次旧告警。
          if (!gateOverviewRef.current) return;
          const top = events.find((x) => (x.level === "L3" || x.level === "L2") && !dismissedGates.current.has(x.id));
          if (top) setGateAlert(top);
          else setGateAlert(null);
        } catch {}
      }, []);
      useEffect(() => {
        loadGateEvents();
        const timer = setInterval(loadGateEvents, 15000);
        return () => clearInterval(timer);
      }, [loadGateEvents]);
      const ackGate = async (id) => {
        try {
          await api("/gate-events", { method: "POST", body: id ? { ids: [id] } : { all: true } });
          setGateAlert(null);
          await loadGateEvents();
        } catch (e) { toast(`✗ 确认失败：${e.message}`); }
      };
      // pickedPath 为空 = 在常见位置里猜；点了「浏览…」就把用户选的路径传进去验证并保存。
      const detectSnowLuma = async (pickedPath = "") => {
        setBusy("detect-snowluma");
        try {
          const body = { action: "detect-snowluma", ...(pickedPath ? { path: pickedPath } : {}) };
          const result = await api("/bridge", { method: "POST", body });
          if (result.ok) {
            toast(`✓ ${result.message}`);
            await reload();
          } else {
            // 失败必须弹出来（不能只 toast 一下就没）；弹窗里直接给「浏览…」和下载页两个下一步。
            setSnowError({
              title: result.title || "没找到 SnowLuma",
              message: result.error || "没找到 SnowLuma",
              hint: result.hint || "点「浏览…」选 SnowLuma2 解压出来的根目录（里面有 app）。",
              tried: Array.isArray(result.tried) ? result.tried : [],
            });
          }
        } catch (error) {
          setSnowError({
            title: "检测失败",
            message: String(error?.message || error),
            hint: "确认 DSH 插件正常（必要时重启 DSH）后重试；还不行就点「浏览…」直接选目录。",
          });
        } finally {
          setBusy("");
        }
      };
      // 手动导入：只接受 SnowLuma 的启动文件（SnowLuma.exe / launcher.bat）。
      // 选完让后端验证并保存安装目录；失败会弹窗说明"这个文件为什么不行"。
      const pickSnowLumaFile = async () => {
        setSnowImport(false);
        try {
          const r = await browseNative("file", "选择 SnowLuma 的启动文件（SnowLuma.exe 或 app\launcher.bat）", "snowluma");
          if (r.ok && r.path) await detectSnowLuma(String(r.path));
          else if (!r.cancelled) toast(`✗ ${r.error || "打不开选择框"}`);
        } catch (e) { toast(`✗ ${e.message}`); }
      };
      // 弹窗里的「浏览…」：选完直接重试检测。
      const pickSnowLuma = async () => {
        try {
          const r = await browseNative("dir", "选择 SnowLuma2 解压出来的根目录（里面有 app）");
          if (r.ok && r.path) await detectSnowLuma(String(r.path));
          else if (!r.cancelled) toast(`✗ ${r.error || "打不开选择框"}`);
        } catch (e) { toast(`✗ ${e.message}`); }
      };
      const act = async (action) => {
        setBusy(action);
        try {
          const res = await api("/bridge", { method: "POST", body: { action } });
          toast(res.ok ? `✓ ${res.message ?? "完成"}` : `✗ ${res.error ?? "失败"}`);
          await reload();
        } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      };
      const loadSnowAccounts = async (password = snowWebuiPass) => {
        setSnowAccountBusy("read");
        try {
          const r = await api("/snowluma/accounts", { method: "POST", body: { password } });
          setSnowAccountData(r);
          if (r.ok === false) setSnowAccountErr({ code: r.code, message: r.error || "读取 SnowLuma 账号失败", hint: r.hint });
          else setSnowAccountErr(null);
        } catch (e) {
          setSnowAccountErr({ code: e.code, message: e.message, hint: e.hint });
        } finally { setSnowAccountBusy(""); }
      };
      const openSnowAccounts = () => {
        setSnowAccountOpen(true);
        void loadSnowAccounts();
      };
      const loadSnowAccount = async (pid) => {
        setSnowAccountBusy(`load:${pid}`);
        try {
          const r = await api("/snowluma/load", { method: "POST", body: { pid, password: snowWebuiPass } });
          if (r.ok === false) {
            setSnowAccountErr({ code: r.code, message: r.error || "加载 QQ 失败", hint: r.hint });
            toast(`✗ ${r.error || "加载 QQ 失败"}${r.hint ? `；${r.hint}` : ""}`);
          } else {
            setSnowAccountErr(null);
            toast("✓ 已提交加载，正在等 SnowLuma 登录…");
            await loadSnowAccounts();
            setTimeout(() => { void loadSnowAccounts(); }, 2500);
          }
        } catch (e) {
          setSnowAccountErr({ code: e.code, message: e.message, hint: e.hint });
          toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally { setSnowAccountBusy(""); }
      };
      const runLaunch = async (mode) => {
        const ids = mode === "stop"
          ? ["qq", "bili", "pet", "voice", "vector"]
          : Object.entries(launchSel).filter(([, on]) => on).map(([id]) => id);
        if (!ids.length) { toast("✗ 至少勾选一项"); return; }
        setBusy(mode === "stop" ? "launch-stop" : "launch-start");
        setLaunchErr(null);
        try {
          const res = await api("/bridge", { method: "POST", body: {
            action: mode === "stop" ? "stop-selected" : "start-selected",
            components: ids,
            voicePack: voiceBranch,
            vectorPack: launchSel.vector ? vectorPack : "",
            hideConsoles: hideConsoles === true,
          } });
          setLaunchResult({ ...res, _mode: mode });
          const bad = (res.items ?? []).filter((x) => !x.ok);
          toast(bad.length
            ? `✗ ${bad.length} 项失败：${bad.map((x) => x.label).join("、")}`
            : `✓ ${mode === "stop" ? "已停止" : "已启动"}：${(res.items ?? []).map((x) => x.label).join("、")}`);
          await reload();
          const qqItem = (res.items ?? []).find((item) => item.id === "qq");
          if (mode === "start" && qqItem?.needsAccount === true) openSnowAccounts();
        } catch (e) {
          setLaunchErr({ message: e.message, code: e.code, hint: e.hint });
          toast(`✗ ${mode === "stop" ? "停止" : "启动"}失败：${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally { setBusy(""); }
      };
      const muteLimit = async (ev) => {
        try {
          const code = ev.reason?.code || ev.event;
          if (ev.gate === "timeout") {
            await api("/timeout-mute", { method: "POST", body: { code } });
          }
          await api("/limit-mute", { method: "POST", body: { code, setting: ev.evidence?.setting || "" } });
          toast(ev.gate === "timeout" ? "✓ 以后不再提示这个超时" : "✓ 以后不再显示这个限制提醒");
          await loadGateEvents();
        } catch (e) { toast("✗ " + e.message); }
      };
      const limitEvents = (gateData?.events ?? []).filter((ev) => ev.gate === "limit" || ev.gate === "timeout" || ev.evidence?.setting);
      return h("div", null,
        snowAccountOpen ? (() => {
          const rows = Array.isArray(snowAccountData?.processes) ? snowAccountData.processes : [];
          const accounts = Array.isArray(snowAccountData?.accounts) ? snowAccountData.accounts : [];
          const needPass = ["SNOWLUMA_WEBUI_PASSWORD_MISSING", "SNOWLUMA_WEBUI_LOGIN_FAILED", "SNOWLUMA_WEBUI_AUTH"].includes(String(snowAccountErr?.code || ""));
          return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget && !snowAccountBusy) setSnowAccountOpen(false); } },
            h("div", { className: "qbw-modal", style: { maxWidth: "720px", maxHeight: "82vh", overflow: "auto" } },
              h("h3", null, "加载 QQ 账号"),
              h("p", { className: "qbw-hint" },
                // 2026-11-06：这句以前写死「SnowLuma 已启动」，控制台没起来时用户会以为是 QQ 没启动。
                String(snowAccountErr?.code || "").startsWith("SNOWLUMA_WEBUI")
                  ? `读不到 SnowLuma 控制台${snowAccountErr?.hint ? `（${snowAccountErr.hint}）` : ""}。先确认 SnowLuma 在运行、控制台端口正确，再点「刷新」。`
                  : "SnowLuma 已启动，但还没加载 QQ。下面是从 SnowLuma 检测到的进程；选一个点「加载」，加载后桥接会自动连上，不用再去 SnowLuma 控制台。"),
              snowAccountErr ? h("div", { className: "qbw-err", style: { margin: "6px 0", padding: "8px 10px", borderRadius: "8px", background: "rgba(192,57,43,.12)" } },
                `${snowAccountErr.code ? `（${snowAccountErr.code}）` : ""}${snowAccountErr.message || "读取失败"}`,
                snowAccountErr.hint ? h("div", { className: "qbw-hint" }, `建议：${snowAccountErr.hint}`) : null) : null,
              snowAccountBusy === "read" ? h("div", { className: "qbw-hint" }, "正在读取 SnowLuma 账号…") : null,
              rows.length ? h("div", { style: { display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" } },
                rows.map((p) => h("div", { className: "qbw-row", key: `snow-proc-${p.pid}`, style: { alignItems: "center", border: "1px solid rgba(127,127,127,.24)", borderRadius: "10px", padding: "8px 10px" } },
                  h("div", { style: { flex: "1 1 auto", minWidth: 0 } },
                    h("b", null, p.nickname || (p.uin ? `QQ ${p.uin}` : "QQ 进程")),
                    h("div", { className: "qbw-hint" },
                      `${p.uin ? `QQ ${p.uin} · ` : ""}PID ${p.pid ?? "—"} · ${p.loggedIn ? "已加载" : (p.status || "可加载")}${p.injected ? " · 已注入" : ""}`),
                    p.error ? h("div", { className: "qbw-hint", style: { color: "var(--qbw-err-text)" } }, p.error) : null),
                  h(Btn, {
                    kind: "qbw-btn2",
                    disabled: !!snowAccountBusy || p.loggedIn || !p.pid,
                    onClick: () => loadSnowAccount(p.pid),
                  }, p.loggedIn ? "已加载" : (snowAccountBusy === `load:${p.pid}` ? "加载中…" : "加载"))))) : null,
              !rows.length && !snowAccountBusy ? h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
                // 控制台读不到时进程列表必然是空的；这时叫用户「去启动 QQ」是错的建议。
                String(snowAccountErr?.code || "").startsWith("SNOWLUMA_WEBUI")
                  ? "进程列表读不到：上面那条错误解决之前，这里永远是空的（和 QQ 有没有启动无关）。"
                  : "没检测到可加载的 QQ 进程。先启动 QQ 客户端（不是 SnowLuma 设置页），再点「刷新」；某些 SnowLuma 版本要求先在它的控制台里登录一次。") : null,
              accounts.length ? h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
                `已连接账号：${accounts.map((a) => `${a.nickname || a.uin}（${a.uin}）`).join(" · ")}`) : null,
              needPass ? h("div", { style: { marginTop: "10px", display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" } },
                h("input", { type: "password", className: "qbw-input", value: snowWebuiPass, placeholder: "SnowLuma WebUI 访问密码", onChange: (e) => setSnowWebuiPass(e.target.value) }),
                h(Btn, { kind: "qbw-btn2", disabled: !!snowAccountBusy || !snowWebuiPass.trim(), onClick: () => loadSnowAccounts(snowWebuiPass) }, "用这个密码读取")) : null,
              h("div", { className: "qbw-actions", style: { marginTop: "10px" } },
                h(Btn, { kind: "qbw-btn2", disabled: !!snowAccountBusy, onClick: () => loadSnowAccounts() }, snowAccountBusy === "read" ? "刷新中…" : "刷新"),
                h(Btn, { kind: "qbw-btn2", onClick: () => setSnowAccountOpen(false), disabled: !!snowAccountBusy }, "关闭")),
              snowAccountData?.webui ? h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, `SnowLuma 控制台：${snowAccountData.webui}`) : null));
        })() : null,
        h(LimitReportCard, { events: limitEvents, goTab, onAck: ackGate, onMute: muteLimit }),
        // 今日唤醒额度用完 = 它不回消息的最常见原因；以前只在 state/bridge.log 里写一行。
        (() => {
          const guard = bridge?.wakeGuard;
          const blockedRows = Array.isArray(guard?.conversations) ? guard.conversations.filter((row) => row?.blocked) : [];
          if (!blockedRows.length) return null;
          const label = (key) => (String(key).startsWith("private:") ? `私聊 ${String(key).slice(8)}` : `群 ${String(key).slice(6)}`);
          return h("div", { className: "qbw-warnbox" },
            h("b", null, "⚠️ 今天叫不醒它：唤醒额度已用完"),
            h("div", null, blockedRows.map((row) => `${label(row.key)} ${row.dayCount}/${row.maxDay}`).join("、"),
              " —— 额度内不会再回消息，消息会留在未读（不会丢）。"),
            h("div", null, "去「QQ → 高级 → Token 防爆破」调高「私聊每天最多醒」，或等次日 00:00 自动重置。"),
            h("div", { className: "qbw-actions", style: { borderTop: "none", marginTop: "6px", paddingTop: "0" } },
              h(Btn, { kind: "qbw-btn2", onClick: () => goTab?.("qq") }, "去调高额度")));
        })(),
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
          h("div", { className: "qbw-card", style: { order: -1, gridColumn: "1 / -1" } },
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
            h("div", { className: "qbw-group", style: { marginTop: "8px" } }, "一键启动 SurfCore"),
            h("div", { className: "qbw-actions", style: { marginTop: "4px" } },
              h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px", marginRight: "10px" } },
                h("input", { type: "checkbox", checked: launchSel.qq, onChange: (e) => setLaunchSel((v) => ({ ...v, qq: e.target.checked })) }),
                h("span", null, `QQ（含 SnowLuma）${launch.qq?.running ? " · 运行中" : " · 未运行"}`)),
              h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px", marginRight: "10px" } },
                h("input", { type: "checkbox", checked: launchSel.bili, onChange: (e) => setLaunchSel((v) => ({ ...v, bili: e.target.checked })) }),
                h("span", null, `B站${launch.bili?.running ? " · 运行中" : " · 未运行"}`)),
              h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px", marginRight: "10px" } },
                h("input", { type: "checkbox", checked: launchSel.pet, onChange: (e) => setLaunchSel((v) => ({ ...v, pet: e.target.checked })) }),
                h("span", null, `桌宠${launch.pet?.running ? " · 运行中" : (launch.pet?.installed ? " · 未运行" : " · 未安装")}`)),
              h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px" } },
                h("input", { type: "checkbox", checked: launchSel.voice, onChange: (e) => setLaunchSel((v) => ({ ...v, voice: e.target.checked })) }),
                h("span", null, `语音${launch.voice?.running ? " · 运行中" : " · 未运行"}`)),
              h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px" } },
                h("input", { type: "checkbox", checked: launchSel.vector, onChange: (e) => setLaunchSel((v) => ({ ...v, vector: e.target.checked })) }),
                h("span", null, `向量记忆${launch.vector?.running ? " · 运行中" : " · 未运行"}`))),
            h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px", marginTop: "4px" } },
              h("input", {
                type: "checkbox", checked: hideConsoles,
                onChange: (e) => { setHideConsoles(e.target.checked); setUnified?.(["platforms", "hideConsoles"], e.target.checked); },
              }),
              h("span", null, "隐藏启动后的命令行黑框"),
              h("span", { className: "qbw-hint" }, "勾选后一键启动不再弹 cmd / SnowLuma 控制台窗口")),
            launchSel.voice ? h("div", { className: "qbw-actions", style: { marginTop: "2px", paddingTop: 0 } },
              h("span", { className: "qbw-hint" }, "语音分支："),
              h("label", { className: "qbw-row", style: { alignItems: "center", gap: "4px" } },
                h("input", { type: "radio", name: "voiceBranch", checked: voiceBranch === "voice-local", onChange: () => setVoiceBranch("voice-local") }),
                h("span", null, `本地模型${voiceKnown ? ((launch.voice?.installed ?? []).includes("voice-local") ? "" : "（未安装）") : "（状态未知：QQ 桥接未运行）"}`)),
              h("label", { className: "qbw-row", style: { alignItems: "center", gap: "4px" } },
                h("input", { type: "radio", name: "voiceBranch", checked: voiceBranch === "voice-cloud", onChange: () => setVoiceBranch("voice-cloud") }),
                h("span", null, `云端模型${voiceKnown ? ((launch.voice?.installed ?? []).includes("voice-cloud") ? "" : "（未安装）") : "（状态未知：QQ 桥接未运行）"}`))) : null,
            launchSel.vector ? (() => {
              const models = (launch.vector?.models ?? []).filter((m) => m.valid);
              const providers = (launch.vector?.providers ?? []).filter((p) => p.hasKey);
              const total = models.length + providers.length;
              return h("div", { className: "qbw-actions", style: { marginTop: "2px", paddingTop: 0, flexWrap: "wrap" } },
                h("span", { className: "qbw-hint" }, "向量模型（勾选后会把记忆方式切到向量）："),
                h("select", {
                  className: "qbw-select", value: vectorPack, disabled: !!busy || !total,
                  onChange: (e) => setVectorPack(e.target.value),
                },
                  models.map((m) => h("option", { key: `local:${m.id}`, value: `local:${m.id}` }, `本地 · ${m.name}`)),
                  providers.map((p) => h("option", { key: `cloud:${p.id}`, value: `cloud:${p.id}` }, `云端 · ${CLOUD_PROVIDER_BY_ID[p.id]?.name ?? p.id}`))),
                total ? null : h("span", { className: "qbw-hint" }, launch.vector?.ok === false && launch.vector?.lastError ? `状态读取失败：${launch.vector.lastError}` : "还没有已安装的本地模型或已保存 Key 的云端服务商"));
            })() : null,
            h("div", { className: "qbw-actions", style: { marginTop: "6px" } },
              h(Btn, { onClick: () => runLaunch("start"), disabled: !!busy }, busy === "launch-start" ? "启动中…" : "一键启动 SurfCore"),
              h(Btn, { kind: "qbw-btn2", onClick: () => runLaunch("stop"), disabled: !!busy }, busy === "launch-stop" ? "停止中…" : "一键停止（全部）"),
              h(Btn, { kind: "qbw-btn2", onClick: openSnowAccounts, disabled: !!busy }, "加载 QQ 账号"),
              h(Btn, { kind: "qbw-btn3", onClick: () => goTab?.("qq"), disabled: !!busy }, "去 QQ 页改启动开关"),
              h(Btn, { kind: "qbw-btn3", onClick: () => goTab?.("bili"), disabled: !!busy }, "去 B站 页改启动开关")),
            [["qq", "QQ"], ["bili", "B站"], ["pet", "桌宠"], ["voice", "语音"], ["vector", "向量记忆"]].map(([id, label]) =>
              launch[id]?.lastError && (id !== "vector" || launchSel.vector) ? h("div", { className: "qbw-hint", key: `launch-err-${id}`, style: { color: "var(--qbw-err-text)", marginTop: "2px" } },
                `${label}：${launch[id].lastError}`) : null),
            launchErr ? h("div", { className: "qbw-err", style: { marginTop: "6px" } },
              `${launchErr.code ? `（${launchErr.code}）` : ""}${launchErr.message}`,
              launchErr.hint ? h("div", { className: "qbw-hint" }, `建议：${launchErr.hint}`) : null) : null,
            (launchResult?.items ?? []).length ? h("div", { style: { marginTop: "6px" } },
              ...(launchResult.items).map((it) => h("div", { className: "qbw-kv", key: it.id },
                h("span", null, `${it.ok ? "✓" : "✗"} ${it.label}`),
                h("span", null, it.ok ? (it.message || (launchResult?._mode === "stop" ? "已停止" : "已启动")) : `${it.error || "失败"}${it.hint ? `；${it.hint}` : ""}`)))) : null,
            h("label", { className: "qbw-row", style: { alignItems: "center" } },
              h("span", { className: "qbw-label" }, "一键启动成功后弹窗提示"),
              h("input", {
                type: "checkbox",
                checked: unified?.bridge?.startupNotify !== false,
                onChange: (e) => setUnified(["bridge", "startupNotify"], e.target.checked),
              })),
            h("div", { className: "qbw-hint" }, "一键启动会按勾选项启动，已在跑的不重复启动；QQ 会按需打开已安装的 SnowLuma，并弹出「加载 QQ 账号」窗口自动检测进程（QQ 本身未登录时仍需扫码）。勾选「向量记忆」会启动 Embedding runtime 并把记忆方式切到向量（自检不过不会切）；一键停止会把记忆方式切回叙事。不会关闭 SnowLuma 本体。人格卡在「角色」页维护。")),
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
            (() => {
              // 上次更新的结果必须能看见（成功/失败/待重启/未验证），不能只靠 toast 一闪而过
              const la = updates.lastApply;
              if (!la) return null;
              const color = la.status === "failed" ? "var(--qbw-err-text)" : (la.status === "applied_unverified" ? "var(--qbw-warn-text)" : undefined);
              const text = la.status === "failed"
                ? `失败：${la.reason || "原因不明"}${la.hint ? `（${la.hint}）` : ""}`
                : la.status === "pending_restart"
                  ? "已排队，等待退出 DSH 后应用（尚未更新）"
                  : la.status === "applied_unverified"
                    ? `${la.reason || "已应用，尚未验证"}${la.hint ? `（${la.hint}）` : ""}`
                    : `${la.reason || "结果未知"}${la.hint ? `（${la.hint}）` : ""}`;
              return h("div", { className: "qbw-kv" }, h("span", null, "上次更新"), h("span", { style: { color } },
                text,
                la.status === "failed"
                  ? h(Btn, {
                    kind: "qbw-btn2", disabled: !!busy,
                    onClick: async () => {
                      setBusy("rollback");
                      try {
                        const r = await api("/updates", { method: "POST", body: { action: "rollback", id: la.component || "surfcore" } });
                        if (r.ok) toast(`✓ ${r.message ?? "已回滚"}（请重启 DSH）`);
                        else toast(`✗ 回滚失败：${r.reason ?? r.error ?? "原因不明"}${r.hint ? `；${r.hint}` : ""}`);
                        await reload();
                      } catch (e) { toast(`✗ 回滚失败：${e.message}`); } finally { setBusy(""); }
                    },
                  }, busy === "rollback" ? "回滚中…" : "回滚到更新前")
                  : null));
            })(),
            h("div", { className: "qbw-kv" }, h("span", null, "组件"), h("span", null,
              (updates.results ?? []).length
                ? updates.results.map((item) => {
                  // 三种结果必须说清（AGENTS 1.7）：有更新 / 已是最新 / 查不到（附原因）。
                  // 不允许把"查不到/失败"显示成"最新"（2026-10-29 事故）。
                  const ver = item.latestVersion
                    ? (item.ahead
                      ? ` 本地 v${item.installedVersion} 领先发布 v${item.latestVersion}`
                      : ` v${item.installedVersion ?? "?"}→v${item.latestVersion}`)
                      + (item.versionStale ? "（缓存）" : "")
                    : "";
                  const st = item.status ?? "";
                  if (st === "update") return `${item.name}（有更新${ver}）`;
                  if (st === "latest") return `${item.name}（已是最新${ver}）`;
                  if (st === "blocked") return `${item.name}（更新被阻止：${item.blocked || item.reason || "原因不明"}）`;
                  if (st === "failed") return `${item.name}（检查失败：${item.reason || "原因不明"}）`;
                  if (st === "unknown") return `${item.name}（查不到：${item.reason || "原因不明"}）`;
                  if (item.available) return `${item.name}${item.updateAvailable ? `（有更新${ver}）` : `（已是最新${ver}）`}`;
                  return `${item.name}（查不到：${item.reason || "原因不明"}）`;
                }).join(" · ")
                : "还没检查")),
            (() => {
              // 查不到/失败：原因 + 建议，常驻显示（不能只留一句"不可查"）
              const bad = (updates.results ?? []).filter((x) => x.status === "unknown" || x.status === "failed" || x.status === "blocked");
              if (!bad.length) return null;
              return h("div", { className: "qbw-hint", style: { color: "var(--qbw-err-text)", marginTop: "4px" } },
                bad.map((x) => `${x.name}：${x.reason || "原因不明"}${x.hint ? `（${x.hint}）` : ""}`).join("；"));
            })(),
            (updates.results ?? []).filter((item) => item.available && item.blocked && item.updateAvailable).length
              ? h("div", { className: "qbw-hint", style: { color: "var(--qbw-err-text)" } },
                "有组件因本地改动/未推送提交被拒，详情点「查看详情」。")
              : null,
            (updates.pending ?? []).length
              ? h("div", { className: "qbw-hint", style: { marginTop: "2px" } },
                "下载完成 ≠ 已更新：需要完全退出 DSH 再打开才会应用（只刷新页面不会生效）。")
              : null,
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: () => checkUpdates(), disabled: !!busy }, busy === "updates" ? "检查中…" : "检查更新"),
              h(Btn, { kind: "qbw-btn2", onClick: runCompat, disabled: !!busy }, busy === "compat" ? "体检中…" : "插件体检"),
              (updates.results ?? []).some((x) => x.status === "unknown" || x.status === "failed")
                ? h(Btn, {
                  kind: "qbw-btn2",
                  onClick: async () => {
                    const payload = {
                      at: new Date().toISOString(),
                      version: updates.results?.find((x) => x.id === "surfcore")?.installedVersion ?? "",
                      results: (updates.results ?? []).map((x) => ({
                        id: x.id, status: x.status, code: x.code, reason: x.reason, hint: x.hint,
                        installedVersion: x.installedVersion, latestVersion: x.latestVersion, channel: x.channel,
                      })),
                    };
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                      toast("✓ 诊断信息已复制，可直接贴给开发者");
                    } catch (e) {
                      toast(`✗ 复制失败（${e.message}）：请截图更新卡片`);
                    }
                  },
                }, "复制诊断")
                : null,
              (updates.results ?? []).some((x) => x.updateAvailable && x.downloadUrl)
                ? h(Btn, { kind: "qbw-btn2", onClick: () => window.open((updates.results ?? []).find((x) => x.updateAvailable && x.downloadUrl).downloadUrl, "_blank", "noopener") }, "去下载新版")
                : null,
              (updates.pending ?? []).length
                ? h(Btn, {
                  onClick: async () => {
                    setBusy("apply-update");
                    try {
                      const ids = (updates.pending ?? []).map((x) => x.id);
                      const r = await api("/updates", { method: "POST", body: { action: "apply", ids } });
                      const staged = (r.results ?? []).filter((x) => x.ok && x.staged);
                      const failed = (r.results ?? []).filter((x) => !x.ok);
                      if (r.ok && staged.length) {
                        toast(`⏳ 已下载 ${staged.length} 个组件，退出并重新打开 DSH 后应用（尚未更新）`);
                        setRestartHint({ staged: true, count: staged.length });
                      }
                      else if (r.ok) toast(`✓ 已更新 ${r.updated} 个组件${r.restartRequired ? "，请重启对应服务" : ""}`);
                      else {
                        const f = failed[0] ?? { code: r.code, reason: r.reason, error: r.error, hint: r.hint };
                        toast(`✗ 更新失败${f.code ? `（${f.code}）` : ""}：${f.reason ?? f.error ?? "原因不明"}${f.hint ? `；建议：${f.hint}` : ""}`);
                      }
                      await reload();
                    } catch (e) { toast(`✗ 更新失败：${e.message}`); } finally { setBusy(""); }
                  },
                }, busy === "apply-update" ? "更新中…" : `立即更新（${(updates.pending ?? []).length}）`)
                  : (updates.lastApply?.deterministic
                    ? h(Btn, { onClick: () => window.open("https://github.com/Mieksido/surfcore/releases/latest", "_blank", "noopener") },
                      "此版本无法自动更新：手动下载")
                    : null),
              h(Btn, { kind: "qbw-btn2", onClick: () => setUpdateOpen(true), disabled: !(updates.results ?? []).length }, "查看详情"))),
          h("div", { style: { display: "flex", gap: "14px", alignItems: "center", marginTop: "8px", flexWrap: "wrap" } },
            h("span", { className: "qbw-label", style: { margin: 0 } }, "更新通道"),
            ...[["stable", "main（正式版，默认）"], ["dev", "dev（测试版，只给测试机）"]].map(([value, label]) =>
              h("label", { key: value, style: { display: "inline-flex", gap: "5px", alignItems: "center", cursor: busy ? "default" : "pointer", fontSize: "12.5px" } },
                h("input", {
                  type: "radio", name: "update-channel", value,
                  checked: (updates.channel ?? "stable") === value,
                  disabled: !!busy,
                  onChange: () => switchUpdateChannel(value),
                }), label)),
            h("span", { className: "qbw-hint" }, (updates.channel ?? "stable") === "dev"
              ? "只安装 vX.Y.Z-dev.N 的 Pre-release；正式用户不要选。"
              : "只安装正式 Release；Pre-release 不会打扰你。")),
          h("div", { style: { marginTop: "8px", paddingTop: "8px", borderTop: "1px solid rgba(127,127,127,.18)" } },
            h("div", { className: "qbw-hint" },
              updates.githubTokenConfigured
                ? "GitHub 令牌：已配置（检查更新走账号额度 5000 次/小时）"
                : "GitHub 令牌：未配置（匿名 60 次/小时，共享 IP 时可能遇到“查不到：限流”）"),
            h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" } },
              h("input", {
                type: "password",
                value: tokenDraft,
                placeholder: updates.githubTokenConfigured ? "已配置；要更换请粘贴新令牌" : "粘贴只读 token（可留空）",
                onChange: (e) => setTokenDraft(e.target.value),
                style: { width: "280px" },
              }),
              h(Btn, { kind: "qbw-btn2", disabled: !!busy || !tokenDraft.trim(), onClick: () => saveGithubToken(false) },
                busy === "token" ? "保存中…" : "保存令牌"),
              updates.githubTokenConfigured
                ? h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: () => saveGithubToken(true) }, "清除")
                : null),
            h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
              "只需要“读公开仓库”的权限；令牌只存在本机 config.json，不会上传，也不会出现在诊断信息里。")),
          (gateData?.events ?? []).length
            ? h("div", { className: "qbw-card" },
              h("h4", null, "安全提醒 ", h("span", { className: "qbw-badge " + ((gateData?.counts?.L3 ?? 0) > 0 ? "bad" : "warn") },
                `未确认 ${gateData?.counts?.unacked ?? 0} 条`)),
              (gateData.events ?? []).slice(0, 6).map((ev) => h("div", { className: "qbw-kv", key: ev.id },
                h("span", null, `${ev.level} · ${ev.gate}`),
                h("span", null, `${ev.impact || ev.reason?.message || ev.event}${ev.ack ? "" : "（未确认）"}`))),
              h("div", { className: "qbw-hint" }, "L0 静默、L1 仅记录；L2/L3 才弹窗。"),
              h("div", { className: "qbw-actions", style: { marginTop: "6px" } },
                h(Btn, { kind: "qbw-btn2", onClick: () => ackGate(null), disabled: !(gateData?.counts?.unacked > 0) }, "全部确认"),
                h(Btn, { kind: "qbw-btn2", onClick: loadGateEvents }, "刷新")))
            : null,
          h(AdvancedSettings, { note: "SnowLuma 安装 / 扩展与平台：装好后很少改" },
            h("div", { className: "qbw-card" },
              h("h4", null, "SnowLuma 安装"),
              (bridge.running && snow.everConnected === true && snow.diagnosis?.state && snow.diagnosis.state !== "ok")
                ? h("div", { className: "qbw-err", style: { margin: "6px 0" } },
                  `SnowLuma 连接异常（${snow.diagnosis.state}）：${snow.diagnosis.hint || "请检查 SnowLuma 是否运行并已登录"}`)
                : null,
              h("p", null, "第一次使用：下载官方 SnowLuma2 → 解压 → 点「检测已安装的 SnowLuma」→ 启动 QQ 并扫码。"),
              h("div", { className: "qbw-kv" }, h("span", null, "当前安装目录"), h("span", null, snow.launcherPath || "未设置")),
              h("div", { className: "qbw-actions" },
                h(Btn, { kind: "qbw-btn2", onClick: () => window.open(snow.downloadUrl || "https://github.com/SnowLuma/SnowLuma/releases/latest", "_blank", "noopener") }, "打开官方下载页"),
                h(Btn, { onClick: () => detectSnowLuma(), disabled: !!busy }, "检测已安装的 SnowLuma"),
                h(Btn, { kind: "qbw-btn2", onClick: () => setSnowImport(true), disabled: !!busy }, "手动选择已安装的 SnowLuma"),
                h(Browse, { mode: "dir", title: "选择 SnowLuma2 解压出来的根目录（里面有 app）", onPick: (picked) => detectSnowLuma(picked) }),
                h(Btn, { kind: "qbw-btn2", onClick: () => act("start-snowluma"), disabled: !!busy }, "只打开 SnowLuma"),
                h(Btn, { kind: "qbw-btn3", onClick: () => act("stop-snowluma"), disabled: !!busy }, "关闭 SnowLuma")),
              h("div", { className: "qbw-hint" }, "检测只会在常见位置里猜。装在别处（例如 D:\软件\SnowLuma2）就点「手动选择已安装的 SnowLuma」，选 SnowLuma.exe 或 app\launcher.bat（也可以直接选解压根目录）。"),
              h("div", { className: "qbw-hint" }, "「手动选择」只是告诉插件你装好的 SnowLuma 在哪：不下载、不安装、不移动、不删除任何文件。"),
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
        snowImport ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setSnowImport(false); } },
          h("div", { className: "qbw-modal" },
            h("h3", null, "导入 SnowLuma 的安装位置"),
            h("p", null, "这里导入的是**你已经装好的 SnowLuma 的启动文件**，不是安装包；SurfCore 不会下载、不会安装、不会移动或删除任何文件。"),
            h("p", { className: "qbw-hint" }, "请选择下面任意一个："),
            h("ul", { style: { margin: "4px 0 8px", paddingLeft: "18px", fontSize: "12px", lineHeight: "19px" } },
              h("li", null, "SnowLuma.exe —— SnowLuma2 目录里的主程序"),
              h("li", null, "app\launcher.bat —— 标准布局里的启动脚本"),
              h("li", null, "解压出来的 SnowLuma2 根目录（点「改为选择目录」）")),
            h("p", { className: "qbw-hint" }, "选完只会做两件事：验证这个位置确实是 SnowLuma、把安装目录记进配置。不复制、不改名、不卸载。"),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: pickSnowLumaFile, disabled: !!busy }, "选择文件…"),
              h(Btn, { kind: "qbw-btn2", onClick: async () => { setSnowImport(false); await pickSnowLuma(); } }, "改为选择目录"),
              h(Btn, { kind: "qbw-btn2", onClick: () => setSnowImport(false) }, "取消")))) : null,
        snowError ? h(ErrorModal, {
          title: snowError.title,
          message: snowError.message,
          hint: snowError.hint,
          tried: snowError.tried,
          disabled: !!busy,
          actions: [
            { label: "浏览…选择目录", onClick: async () => { setSnowError(null); await pickSnowLuma(); } },
            { label: "打开官方下载页", kind: "qbw-btn2", onClick: () => window.open(snow.downloadUrl || "https://github.com/SnowLuma/SnowLuma/releases/latest", "_blank", "noopener") },
          ],
          onClose: () => setSnowError(null),
        }) : null,
        restartHint ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setRestartHint(null); } },
          h("div", { className: "qbw-modal" },
            h("h3", null, restartHint.staged ? "更新已下载：重启 DSH 后生效" : "有可用更新：安装后需要重启 DSH"),
            h("p", null, restartHint.staged
              ? "文件已经下载并排队，退出 DSH 后会自动替换（尚未更新）。只刷新页面不会应用。"
              : "这里只是发现了新版本；点「立即更新」下载后，需要完全退出 DSH 再打开，新版本才会生效。"),
            h("ol", { style: { margin: "6px 0 8px", paddingLeft: "20px", fontSize: "12px", lineHeight: "20px" } },
              h("li", null, "完全退出 DSH（包括托盘图标 / 任务栏里的窗口，不能只关设置页）"),
              h("li", null, "重新打开 DSH"),
              h("li", null, "回到这里点「检查更新」确认版本已变")),
            h("p", { className: "qbw-hint" },
              "为什么必须重启：更新助手要等 DSH 退出后才替换文件；插件本身跑在 DSH 进程里，没法热更新自己。"),
            h("div", { className: "qbw-actions" },
              restartHint.staged
                ? h(Btn, { onClick: () => setRestartHint(null) }, "我知道了")
                : h(Btn, { onClick: () => { setRestartHint(null); setUpdateOpen(true); } }, "去更新"),
              h(Btn, { kind: "qbw-btn2", onClick: () => setRestartHint(null) }, "稍后")))
          ) : null,
        updateOpen ? h(UpdatesModal, {
          status: updates,
          toast,
          onClose: () => setUpdateOpen(false),
          onDone: async () => { setUpdateOpen(false); await reload(); },
          onStaged: (count) => setRestartHint({ staged: true, count }),
        }) : null,
        (compat || compatError) ? h(CompatModal, {
          report: compat,
          error: compatError,
          busy,
          toast,
          onClose: () => { setCompat(null); setCompatError(null); },
          onRetry: runCompat,
        }) : null,
        gateAlert ? h(GateAlertModal, {
          event: gateAlert,
          onClose: () => { if (gateAlert) dismissedGates.current.add(gateAlert.id); setGateAlert(null); },
          onAck: ackGate,
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
        style: { flex: "1 1 92px", minWidth: "92px", padding: "7px 9px", border: "1px solid var(--qbw-line)", borderRadius: "8px", background: "var(--qbw-surface-2)" },
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
            h("div", { style: { flex: 1, height: "7px", borderRadius: "4px", background: "var(--qbw-surface-2)", overflow: "hidden" } },
              h("div", { style: { width: `${pct}%`, height: "100%", borderRadius: "4px", background: "var(--qbw-brand)" } })),
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
        status?.focus ? h("div", { className: "qbw-hint", style: { marginTop: "4px", color: "var(--qbw-warn-text)" } },
          "专注模式开着：自动主动搭话已暂停（QQ / 桌宠都不发）；手动「立即试一次」仍可用。去「桌宠」页或右键菜单关闭。") : null,
        status ? h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
          `今天 ${st.countToday ?? 0}/${dailyMax || "不限"} · 上次：${outcomeText}${st.lastRunAt ? `（${at(st.lastRunAt)}）` : ""} · 下次：${at(st.nextFireAt)}`,
          st.lastPurpose ? h("div", null, `上次的目的：${st.lastPurpose}`) : null,
          st.lastSkip?.reason ? h("div", null, `最近一次没出发：${st.lastSkip.reason}${st.lastSkip.at ? `（${at(st.lastSkip.at)}）` : ""}`) : null,
          st.pending?.length ? h("div", null, `心里还惦记着：${st.pending.slice(-3).map((p) => p.text).join("；")}`) : null) : h("div", { className: "qbw-hint" }, status?.ok === false ? "这个载体暂时读不到状态" : "读取中…"),

        h("details", { open: true, style: { marginTop: "10px", borderTop: "1px dashed var(--qbw-line-soft)", paddingTop: "8px" } },
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
      const seg = (options, value, onChange) => h("div", { style: { display: "inline-flex", gap: "4px", padding: "2px", borderRadius: "999px", background: "var(--qbw-surface)", border: "1px solid var(--qbw-line)" } },
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
            background: value === val ? "var(--qbw-brand)" : "transparent",
            color: value === val ? "var(--qbw-on-brand)" : "var(--qbw-muted)",
          },
        }, label)));
      const cardStyle = (active) => ({
        flex: "1 1 240px",
        minWidth: "220px",
        padding: "10px 12px",
        borderRadius: "10px",
        border: `1px solid ${active ? "var(--qbw-brand)" : "var(--qbw-line)"}`,
        background: active ? "var(--qbw-hover)" : "var(--qbw-surface-2)",
        cursor: "pointer",
        boxShadow: active ? "0 0 0 2px var(--qbw-hover)" : "none",
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
        h("details", { open: true, style: { marginTop: "10px", borderTop: "1px dashed var(--qbw-line-soft)", paddingTop: "8px" } },
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
    // ── 群分层：小群保留积极唤醒，大群/高活跃群收紧 ───────────────────────
    function ToolProfileArea({ cfg, set, onSave, busy }) {
      return h(AreaModalCard, { title: "工具面", note: "full / balanced / compact；切 balanced 才会隐藏旧读工具，改用快照", onSave, busy },
        h(Row, { label: "工具面模式", hint: "默认 balanced；切换后需重启 DSH" },
          h("select", { className: "qbw-select", value: cfg?.socialV2?.toolProfile || "balanced", onChange: (e) => set?.(["socialV2", "toolProfile"], e.target.value) },
            h("option", { value: "full" }, "full（全量，兼容）"),
            h("option", { value: "balanced" }, "balanced（推荐，快照入口）"),
            h("option", { value: "compact" }, "compact（最省 schema）"))));
    }

    function GroupPolicyArea({ busy, setBusy, toast }) {
      const saveRef = useRef(null);
      return h(AreaModalCard, {
        title: "群管理",
        note: "小群/大群分层、人数/活跃阈值、手动覆盖；保存后生效",
        badge: "阈值",
        busy,
        onSave: async () => { await saveRef.current?.(); },
      }, h(GroupPolicyPanel, {
        busy, setBusy, toast,
        onSaveReady: (fn) => { saveRef.current = fn; },
      }));
    }

    function GroupPolicyPanel({ busy, setBusy, toast, onSaveReady }) {
      const [data, setData] = useState(null);
      const [policy, setPolicy] = useState(null);
      const [err, setErr] = useState("");
      const saveRef = useRef(null);
      const load = useCallback(async () => {
        try {
          const r = await api("/group-policy");
          setData(r);
          setPolicy(r.policy ?? {});
          setErr("");
        } catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { void load(); }, [load]);
      const persist = async (next) => {
        setBusy("group-policy-save");
        try {
          const body = {
            largeThreshold: Number(next.largeThreshold) || 200,
            activeMessageThreshold: Number(next.activeMessageThreshold) || 60,
            overrides: next.overrides ?? {},
          };
          const r = await api("/group-policy", { method: "POST", body });
          setData((d) => ({ ...(d ?? {}), policy: r.policy }));
          setPolicy(r.policy ?? body);
          toast("✓ 群分层已保存");
        } catch (e) { toast("✗ " + e.message); } finally { setBusy(""); }
      };
      const save = () => persist(policy ?? {});
      saveRef.current = save;
      useEffect(() => {
        onSaveReady?.(() => saveRef.current?.());
      }, [onSaveReady]);
      const setOverride = (key, value) => {
        const next = { ...(policy ?? {}), overrides: { ...(policy?.overrides ?? {}), [key]: value } };
        setPolicy(next);
        // 选择即保存：避免“点保存没反应/弹窗里找不到保存”。
        void persist(next);
      };
      if (!data && !err) return h("div", { className: "qbw-card" }, h("div", { className: "qbw-hint" }, "群分层读取中…"));
      return h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
        h("h4", null, "群分层（小群积极 / 大群收紧）"),
        h("p", { className: "qbw-hint" },
          "小群保留关键词/提问/概率等积极唤醒；大群或高活跃群只保留 @、叫名字、拍一拍、引用等真正点名。未知群先按小群处理，不误伤朋友群。"),
        err ? h("div", { className: "qbw-err" }, err) : null,
        h("div", { className: "qbw-actions", style: { marginTop: "4px" } },
          h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px" } },
            "大群人数阈值",
            h("input", { className: "qbw-input", type: "number", min: 20, max: 5000, value: policy?.largeThreshold ?? 200, onChange: (e) => setPolicy((p) => ({ ...(p ?? {}), largeThreshold: Number(e.target.value) })) })),
          h("label", { className: "qbw-row", style: { alignItems: "center", gap: "6px" } },
            "高活跃阈值（近 10 分钟消息）",
            h("input", { className: "qbw-input", type: "number", min: 5, max: 5000, value: policy?.activeMessageThreshold ?? 60, onChange: (e) => setPolicy((p) => ({ ...(p ?? {}), activeMessageThreshold: Number(e.target.value) })) }))),
        h("div", { className: "qbw-warnbox", style: { marginTop: "6px" } },
          "⚠️ 人数过多或过于活跃的群将大大加快您的 Token 消耗速度，请谨慎设置大群/高活跃阈值，避免把朋友群误判成大群。"),
        h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
          "自动判定：成员数 ≥ 阈值，或近 10 分钟非自己消息 ≥ 阈值 → 大群；手动覆盖永远优先。"),
        h("div", { className: "qbw-list", style: { marginTop: "6px" } },
          ...(data?.groups ?? []).slice(0, 30).map((g) => h("div", { key: g.key, className: "qbw-item" },
            h("div", null,
              h("div", { className: "qbw-label" }, g.name || g.key, h("span", { className: "qbw-badge" }, g.tier === "large" ? "大群" : "小群")),
              h("div", { className: "qbw-hint" }, g.key + " · 人数 " + (g.memberCount || "未知") + " · 近10分钟 " + (g.activityCount ?? 0) + " 条 · 判定 " + g.source)),
            h("select", { className: "qbw-select", value: policy?.overrides?.[g.key] || g.override || "auto", onChange: (e) => setOverride(g.key, e.target.value) },
              h("option", { value: "auto" }, "自动"),
              h("option", { value: "small" }, "强制小群"),
              h("option", { value: "large" }, "强制大群"))))
        ),
        h("div", { className: "qbw-actions", style: { marginTop: "6px" } },
          h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, "刷新群列表"),
          h("span", { className: "qbw-hint" }, "改完点弹窗底部「保存」；保存后桥接下一条消息生效，群成员数由 OneBot 缓存 10 分钟。")));
    }

    // ── 模型与思考强度：从 DSH 模型目录动态生成，不硬编码模型名 ────────────────
    function ModelSettingsCard({ busy, toast, reload }) {
      const [info, setInfo] = useState(null);
      const [provider, setProvider] = useState("");
      const [model, setModel] = useState("");
      const [effort, setEffort] = useState("");
      const [saving, setSaving] = useState(false);
      const [err, setErr] = useState("");
      const [follow, setFollow] = useState(true);
      const [followSaving, setFollowSaving] = useState(false);
      const [followMsg, setFollowMsg] = useState("");
      const load = useCallback(async () => {
        try {
          const r = await api("/dsh/model");
          setInfo(r);
          setFollow(r.followDefault !== false);
          setProvider(r.provider ?? "");
          setModel(r.model ?? "");
          const allowed = (Array.isArray(r.options) ? r.options : []).filter((x) => ["low", "high", "max"].includes(x));
          const desired = r.reasoningEffort ?? r.default ?? "max";
          setEffort(allowed.includes(desired) ? desired : (allowed[0] ?? "max"));
          setErr("");
        } catch (e) {
          setErr(e.message);
          setInfo({
            provider: "", model: "", options: ["low", "high", "max"], reasoningEffort: "max", default: "max",
            models: [], providers: [], catalogSource: "fallback", globalSideEffect: true,
            followDefault: true, modelSource: "config", defaultModelError: `读取 DSH 模型目录失败：${e.message}`,
          });
          setEffort("max");
        }
      }, []);
      useEffect(() => { void load(); }, [load]);
      useEffect(() => {
        if (!info?.pending) return undefined;
        const timer = setInterval(() => { void load(); }, 10_000);
        return () => clearInterval(timer);
      }, [info?.pending, load]);
      const models = Array.isArray(info?.models) ? info.models : [];
      const current = models.find((m) => m.provider === provider && m.model === model) ?? null;
      const effortRows = (() => {
        const own = Array.isArray(current?.efforts) ? current.efforts.filter((x) => ["low", "high", "max"].includes(x)) : [];
        const fallback = Array.isArray(info?.options) ? info.options.filter((x) => ["low", "high", "max"].includes(x)) : [];
        const def = current?.defaultEffort && ["low", "high", "max"].includes(current.defaultEffort) ? [current.defaultEffort] : [];
        const ids = [...new Set((own.length ? own : fallback).concat(def))];
        return ids.length ? ids : ["low", "high", "max"];
      })();
      const effortLabel = (id) => {
        const custom = current?.effortLabels?.[id]?.name || info?.labels?.[id]?.name;
        const desc = current?.effortLabels?.[id]?.description || info?.labels?.[id]?.description;
        const base = id === "low" ? "low（最省，日常聊天）" : id === "high" ? "high（平衡）" : id === "max" ? "max（最烧，复杂任务）" : id;
        return custom ? `${base} · ${custom}${desc ? `：${desc}` : ""}` : base;
      };
      const imageText = current?.imageInput === true ? "支持图片" : current?.imageInput === false ? "仅文本（图片走文字兜底）" : "图片能力未知";
      const priceText = current?.price?.label ? `${current.price.label}` : "价目表未登记";
      const fallbackOnly = !models.length;
      const lastApply = info?.lastApply ?? null;
      const lastUsed = info?.lastUsed ?? null;
      const statusPending = info?.pending === true;
      const appliedModel = lastApply?.selected?.model || "";
      const applyMismatch = Boolean(lastApply?.ok && appliedModel && (appliedModel !== model || String(lastApply.selected?.provider || "") !== provider));
      const fmtProofTime = (value) => {
        try { return new Date(value).toLocaleString(); } catch { return ""; }
      };
      const proof = (() => {
        if (statusPending) {
          return { kind: "warn", text: "已保存配置；还没有 DSH 的应用回执。下一条消息会调用 selectModel，成功后才算“已加载”。" };
        }
        if (info?.lastApplyStale) {
          return { kind: "warn", text: "上次应用记录在当前桥接启动前，不能证明本次进程已加载；下一条消息会重新确认。" };
        }
        if (lastApply && lastApply.ok) {
          const s = lastApply.selected ?? {};
          const used = lastUsed && lastUsed.model
            ? `；最近一次 model/selection：${lastUsed.provider ? `${lastUsed.provider}/` : ""}${lastUsed.model}（${fmtProofTime(lastUsed.at)}）`
            : "；还没有 model/selection 事件，暂时只能证明 DSH 已接受。";
          return {
            kind: applyMismatch ? "warn" : "ok",
            text: `${applyMismatch ? "DSH 返回的模型与请求不一致：" : "DSH 已接受："}${s.provider ?? ""}/${s.model ?? ""} · ${s.reasoningEffort ?? "默认"}（${fmtProofTime(lastApply.at)}${lastApply.sessionId ? `，会话 ${lastApply.sessionId}` : ""}）${used}`,
          };
        }
        if (lastApply && !lastApply.ok) {
          return { kind: "bad", text: `应用失败：${lastApply.error || "DSH 拒绝模型选择"}（${fmtProofTime(lastApply.at)}）` };
        }
        return { kind: "hint", text: "还没有应用回执。保存后需要下一条消息触发 DSH selectModel，才能证明真的加载。" };
      })();
      const followOn = info?.followDefault !== false;
      const followingDefault = followOn && info?.modelSource === "dsh-default";
      const followFallback = followOn && info?.modelSource === "config";
      const missingDefaultReason = info?.defaultModelError || "DSH 没有返回默认模型";
      const followNote = !info
        ? ""
        : !followOn
          ? "已关闭跟随：QQ 聊天 / QQ 黑话学习使用 config.json 里写死的 dsh.provider / dsh.model。"
          : followingDefault
            ? "正在跟随 DSH 默认模型：在 DSH 的「默认模型」里改一次，QQ 下一条消息就换；这里的模型/强度选择先不用改。"
            : followFallback
              ? `想跟随 DSH 默认模型，但没读到：${missingDefaultReason}。当前用 ${info.provider || "空 provider"}/${info.model || "空 model"} 的 config 兜底值。`
              : "正在读取 DSH 默认模型…";
      const changeFollow = async (next) => {
        setFollowSaving(true);
        setFollowMsg("");
        try {
          const r = await api("/dsh/follow-default", { method: "POST", body: { follow: next } });
          setFollow(r.followDefaultModel !== false);
          setFollowMsg(r.followDefaultModel ? "✅ 已开启跟随，下一条消息生效" : "✅ 已关闭跟随，下一条消息生效");
          toast(r.followDefaultModel ? "✓ 已开启跟随 DSH 默认模型" : "✓ 已关闭跟随 DSH 默认模型");
          await load();
          await reload?.();
        } catch (e) {
          setFollow(!next); // 失败时把勾弹回去，界面状态不能和真实配置不一致
          const message = e?.hint ? `${e.message}（${e.hint}）` : e.message;
          setFollowMsg(`✗ ${message}`);
          toast(`✗ ${message}`);
        } finally { setFollowSaving(false); }
      };
      const chooseModel = (value) => {
        let next;
        try { next = JSON.parse(value); } catch { return; }
        setProvider(String(next.provider ?? ""));
        setModel(String(next.model ?? ""));
        const picked = models.find((m) => m.provider === String(next.provider ?? "") && m.model === String(next.model ?? ""));
        const allowed = Array.isArray(picked?.efforts) ? picked.efforts.filter((x) => ["low", "high", "max"].includes(x)) : [];
        if (!allowed.includes(effort)) setEffort(picked?.defaultEffort && allowed.includes(picked.defaultEffort) ? picked.defaultEffort : (allowed[0] ?? "max"));
      };
      const save = async () => {
        if (followingDefault) {
          toast("⚠️ 正在跟随 DSH 默认模型；要改 QQ 侧模型，先关闭「跟随 DSH 默认模型」");
          return;
        }
        setSaving(true);
        setErr("");
        try {
          if (fallbackOnly) {
            const r = await api("/dsh/effort", { method: "POST", body: { reasoningEffort: effort } });
            toast(`✓ 已保存 ${r.reasoningEffort}；等待下一条消息由 DSH 确认`);
          } else {
            const r = await api("/dsh/model", { method: "POST", body: { provider, model, reasoningEffort: effort } });
            toast(`✓ 已保存 ${r.provider}/${r.model} · ${r.reasoningEffort}；等待下一条消息由 DSH 确认`);
            for (const warning of r.warnings ?? []) toast(`⚠️ ${warning}`);
          }
          await load();
          await reload?.();
        } catch (e) {
          let message = e?.hint ? `${e.message}（${e.hint}）` : e.message;
          if (String(e?.message || "").includes("未知接口")) {
            message += "（宿主插件还是旧代码：重启 DSH 或升级 SurfCore 后 /dsh/model 才会注册）";
          }
          setErr(message);
          toast(`✗ ${message}`);
        } finally { setSaving(false); }
      };
      if (!info && !err) return h("div", { className: "qbw-card" }, h("div", { className: "qbw-hint" }, "读取 DSH 模型目录中…"));
      const byProvider = new Map();
      for (const item of models) {
        if (!byProvider.has(item.provider)) byProvider.set(item.provider, []);
        byProvider.get(item.provider).push(item);
      }
      return h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
        h("h4", null, "模型与思考强度", h("span", { className: "qbw-badge" }, info?.catalogSource === "dsh" ? "来自 DSH 目录" : "降级")),
        h("p", { className: "qbw-hint" },
          "默认 max；觉得烧就选 low（更省），high 是折中。改完下一条消息生效，不需要重启 DSH。"),
        h("div", { className: "qbw-row", style: { alignItems: "center", marginTop: "6px" } },
          h("label", { style: { display: "flex", gap: "6px", alignItems: "center", fontSize: "12.5px" } },
            h("input", {
              type: "checkbox",
              checked: followOn,
              disabled: followSaving || !!busy,
              onChange: (e) => void changeFollow(e.target.checked),
            }),
            "跟随 DSH 默认模型（QQ 聊天 / QQ 黑话学习）"),
          followSaving ? h("span", { className: "qbw-hint" }, "保存中…") : null),
        h("div", { className: followFallback ? "qbw-warnbox" : "qbw-hint", style: { marginTop: "4px" } }, followNote),
        followMsg ? h("div", { className: followMsg.startsWith("✅") || followMsg.startsWith("✓") ? "qbw-hint" : "qbw-err", style: { marginTop: "2px" } }, followMsg) : null,
        err ? h("div", { className: "qbw-err" }, err) : null,
        fallbackOnly ? h("div", { className: "qbw-warnbox" }, "DSH 模型目录读取失败：现在只能调思考强度；刷新后再换模型。") : null,
        h("div", {
          className: proof.kind === "ok" ? "qbw-infobox" : proof.kind === "bad" ? "qbw-err" : proof.kind === "warn" ? "qbw-warnbox" : "qbw-hint",
          style: { marginTop: "6px" },
        }, proof.text),
        h("div", { className: "qbw-admin-grid" },
          h("label", { className: "qbw-admin-field" },
            h("span", null, "模型"),
            h("select", {
              className: "qbw-select", id: "dshModelSelect",
              value: JSON.stringify({ provider: provider, model: model }),
              disabled: fallbackOnly || followingDefault || !!busy || saving,
              onChange: (e) => chooseModel(e.target.value),
            },
              models.length
                ? [...byProvider.entries()].map(([p, rows]) => h("optgroup", { key: p, label: p },
                  rows.map((m) => h("option", {
                    key: `${m.provider}/${m.model}`,
                    value: JSON.stringify({ provider: m.provider, model: m.model }),
                  }, `${m.name} · ${m.model}${m.imageInput === true ? " · 支持图片" : m.imageInput === false ? " · 仅文本" : ""}${m.price?.label ? ` · ${m.price.label}` : ""}`))))
                : h("option", { value: JSON.stringify({ provider, model }) }, `${model}（当前）`)),
            h("small", null, `图片：${imageText} ｜ 价格：${priceText}`)),
          h("label", { className: "qbw-admin-field" },
            h("span", null, "思考强度"),
            h("select", {
              className: "qbw-select", id: "dshEffortSelect",
              value: effort,
              disabled: followingDefault || !!busy || saving,
              onChange: (e) => setEffort(e.target.value),
            }, effortRows.map((id) => h("option", { key: id, value: id }, effortLabel(id)))),
            h("small", null, "low 最省；max 最烧。选 low 后日常闲聊够用，复杂工具任务可能变笨。"))),
        h("div", { className: "qbw-actions", style: { marginTop: "8px" } },
          h(Btn, { onClick: save, disabled: followingDefault || !!busy || saving || (!fallbackOnly && !model) }, saving ? "保存中…" : fallbackOnly ? "保存思考强度" : "保存模型与思考强度"),
          h(Btn, { kind: "qbw-btn2", onClick: load, disabled: saving }, "刷新状态"),
          h("span", { className: "qbw-hint" }, followingDefault
            ? "⚠️ 正在跟随 DSH 默认模型：下方模型/强度先不用改；要写死 QQ 侧模型，先关闭上方跟随。"
            : "⚠️ 会同时修改 DSH 全局默认模型（Web GUI 新会话也会用这个）；保存只代表配置写入，应用回执由 selectModel 返回。")),
        info?.globalSideEffect ? h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
          "这是 DSH 的 selectModel 行为，不是桥接额外改的；介意全局默认的话，改完可回 DSH 设置里单独调整。") : null);
    }

    // ── 花费与会话（2026-11-04）──────────────────────────────────────────
    // 想回答两个问题："今天谁在烧钱" + "这条会话是不是该换了"。
    // 数据全部来自桥接的 token 账本（按会话 key 聚合），换会话走 /api/session/reset。
    // ── 省钱清单（2026-11-06 修正交付位置）────────────────────────────────
    // 用户第 13 条原话：要在「Token 额度页最上方」看到「如何省 token」按钮，点开**弹窗**列出
    // 所有能省 token 的设置。之前做在 QQ 页卡片里属于位置错误；这里抽成共享组件：
    // Token 额度页最上方 + QQ 页花费卡片都用它。
    const SAVE_TOKEN_TIPS = [
      ["会话太长自动换新会话", "默认 8 万 token 换一次；阈值调小更省，但交接更频繁", "QQ 页 · 二代 · 等待与上下文"],
      ["唤醒合并窗口", "被 @/叫名字 3 秒、私聊 4 秒、群聊 6 秒；调大更省，但回应更慢", "QQ 页 · 唤醒与收尾"],
      ["唤醒上下文最大字符", "默认 6000；调小只带更少的未读", "QQ 页 · 等待与上下文"],
      ["工具面开关", "关掉用不到的工具：每关一个，每次请求都少付一段说明", "QQ 页 · 二代 · 工具开关"],
      ["回合形态", "机器模式=一次唤醒一次请求、不做工具循环，最省", "QQ 页 · 回合形态与成本"],
      ["峰时顺延", "价格 ×2 的时段不跑后台任务", "QQ 页 · 回合形态与成本"],
      ["本地唤醒判断", "免费漏斗：垃圾消息/刚回过/醒太勤不唤醒", "QQ 页 · 唤醒与收尾"],
      ["主动搭话 / 目的机制", "频率和每日上限直接决定钱包；不需要就关", "目的页"],
      ["黑话学习", "后台会定期跑模型；关掉或拉长冷却更省", "QQ 页 · 黑话学习"],
      ["B站四类动态 / 定时分享", "每次发布都是一次完整回合", "B站 页"],
      ["表情包注入条数", "每轮都随提示词发一遍", "QQ 页 · 表情包"],
      ["人格卡拆分注入", "整卡完整但费 token；拆分省 token，但人格可能不完整", "角色页 · 人格注入方式"],
    ];

    const SAVE_TOKEN_PRESETS = {
      省钱: [
        ["socialV2.context.rolloverTokens", 60000],
        ["socialV2.context.wakeMaxChars", 3000],
        ["socialV2.wake.batchWindowMs", 12000],
        ["socialV2.wake.batchWindowPrivateMs", 6000],
        ["socialV2.wake.batchWindowDirectMs", 3000],
        ["socialV2.sticker.promptMaxStickers", 4],
        ["socialV2.proactive.enabled", false],
        ["socialV2.cost.peakOffload", true],
        ["persona.mode", "split"],
      ],
      均衡: [
        ["socialV2.context.rolloverTokens", 80000],
        ["socialV2.context.wakeMaxChars", 6000],
        ["socialV2.wake.batchWindowMs", 6000],
        ["socialV2.wake.batchWindowPrivateMs", 4000],
        ["socialV2.wake.batchWindowDirectMs", 3000],
        ["socialV2.sticker.promptMaxStickers", 8],
        ["socialV2.proactive.enabled", true],
        ["socialV2.cost.peakOffload", true],
        ["persona.mode", "split"],
      ],
      活跃: [
        ["socialV2.context.rolloverTokens", 150000],
        ["socialV2.context.wakeMaxChars", 8000],
        ["socialV2.wake.batchWindowMs", 4000],
        ["socialV2.wake.batchWindowPrivateMs", 3000],
        ["socialV2.wake.batchWindowDirectMs", 2000],
        ["socialV2.sticker.promptMaxStickers", 12],
        ["socialV2.proactive.enabled", true],
        ["socialV2.cost.peakOffload", false],
        ["persona.mode", "full"],
      ],
    };

    const SAVE_TOKEN_FIELDS = [
      { path: "socialV2.context.rolloverTokens", label: "会话滚动阈值", type: "number", min: 20000, max: 300000, step: 10000, unit: "token", hint: "到阈值就换新会话；调小更省，但交接更频繁", where: "QQ 页 · 等待与上下文" },
      { path: "socialV2.context.wakeMaxChars", label: "唤醒上下文最大字符", type: "number", min: 1000, max: 16000, step: 500, unit: "字", hint: "每次唤醒最多带多少未读", where: "QQ 页 · 等待与上下文" },
      { path: "socialV2.wake.batchWindowMs", label: "群聊合并窗口", type: "number", min: 1000, max: 30000, step: 1000, unit: "ms", hint: "多条消息合并成一次唤醒", where: "QQ 页 · 唤醒与收尾" },
      { path: "socialV2.wake.batchWindowPrivateMs", label: "私聊合并窗口", type: "number", min: 1000, max: 30000, step: 1000, unit: "ms", hint: "私聊连续消息合并", where: "QQ 页 · 唤醒与收尾" },
      { path: "socialV2.wake.batchWindowDirectMs", label: "点名合并窗口", type: "number", min: 1000, max: 30000, step: 1000, unit: "ms", hint: "@/叫名字/拍一拍后等多久", where: "QQ 页 · 唤醒与收尾" },
      { path: "socialV2.sticker.promptMaxStickers", label: "表情包注入条数", type: "number", min: 0, max: 30, step: 1, unit: "条", hint: "每轮随提示词带几条；0 = 不带", where: "QQ 页 · 表情包" },
      { path: "socialV2.proactive.enabled", label: "主动搭话", type: "bool", hint: "她主动找话题的次数；关掉最省", where: "目的页" },
      { path: "socialV2.cost.peakOffload", label: "峰时顺延", type: "bool", hint: "价格 ×2 的时段不跑后台任务", where: "QQ 页 · 回合形态与成本" },
      { path: "persona.mode", label: "人格注入方式", type: "select", options: [["full", "整卡（完整，费 token）"], ["split", "拆分（省 token，可能不完整）"]], hint: "拆分用核心/语气/场景/日常；整卡用整份人格卡", where: "角色页 · 人格注入方式" },
    ];

    /** 省钱清单弹窗：额度页最上方；三档预设先把目标值填进可编辑表，再统一写入。 */
    function SaveTokenTipsModal({ set, setUnified, qq, unified, onClose, toast }) {
      const currentOf = (path) => path.startsWith("persona.")
        ? getPath(unified, path.split("."))
        : getPath(qq, path.split("."));
      const write = (path, value) => {
        if (path.startsWith("persona.")) setUnified?.(path.split("."), value);
        else set?.(path.split("."), value);
      };
      const [draft, setDraft] = useState(() => Object.fromEntries(SAVE_TOKEN_FIELDS.map((field) => [field.path, currentOf(field.path)])));
      const [presetName, setPresetName] = useState("");
      const [applied, setApplied] = useState("");
      const choosePreset = (name) => {
        const patch = SAVE_TOKEN_PRESETS[name];
        if (!patch) return;
        setDraft((prev) => ({ ...prev, ...Object.fromEntries(patch) }));
        setPresetName(name);
        setApplied("");
      };
      const changed = SAVE_TOKEN_FIELDS.filter((field) => String(draft[field.path] ?? "") !== String(currentOf(field.path) ?? ""));
      const format = (field, value) => {
        if (field.type === "bool") return value === true ? "开" : "关";
        if (field.type === "select") return (field.options ?? []).find(([id]) => id === value)?.[1] ?? String(value ?? "—");
        return value == null || value === "" ? "—" : `${value}${field.unit ? ` ${field.unit}` : ""}`;
      };
      const editor = (field) => {
        if (field.type === "bool") {
          return h("input", {
            type: "checkbox", className: "qbw-switch",
            checked: draft[field.path] === true,
            onChange: (e) => { setDraft((prev) => ({ ...prev, [field.path]: e.target.checked })); setApplied(""); },
          });
        }
        if (field.type === "select") {
          return h("select", {
            className: "qbw-input",
            value: String(draft[field.path] ?? ""),
            onChange: (e) => { setDraft((prev) => ({ ...prev, [field.path]: e.target.value })); setApplied(""); },
          }, (field.options ?? []).map(([id, label]) => h("option", { key: id, value: id }, label)));
        }
        return h("input", {
          type: "number", className: "qbw-input", style: { width: "130px" },
          min: field.min, max: field.max, step: field.step,
          value: draft[field.path] ?? "",
          onChange: (e) => { setDraft((prev) => ({ ...prev, [field.path]: Number(e.target.value) })); setApplied(""); },
        });
      };
      const apply = () => {
        if (!changed.length) { toast?.("没有需要应用的改动"); return; }
        for (const field of changed) write(field.path, draft[field.path]);
        setApplied(`已写入 ${changed.length} 项；请点页面底部「保存」生效`);
        toast?.(`✓ 已写入 ${changed.length} 项，点底部「保存」生效`);
      };
      const reset = () => {
        setDraft(Object.fromEntries(SAVE_TOKEN_FIELDS.map((field) => [field.path, currentOf(field.path)])));
        setPresetName("");
        setApplied("");
      };
      return h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) onClose?.(); } },
        h("div", { className: "qbw-modal", style: { maxWidth: "920px", maxHeight: "88vh", overflow: "auto" } },
          h("h3", null, "怎么省 token"),
          h("p", { className: "qbw-hint" },
            "点三档预设会把目标值填进下面的表，表里直接改；点「应用改动」只写表单，最后点页面底部「保存」生效。"),
          h("div", { style: { display: "flex", gap: "8px", margin: "8px 0 10px", flexWrap: "wrap", alignItems: "center" } },
            h(Btn, { kind: "qbw-btn2", onClick: () => choosePreset("省钱") }, "套用「省钱」"),
            h(Btn, { kind: "qbw-btn2", onClick: () => choosePreset("均衡") }, "套用「均衡」"),
            h(Btn, { kind: "qbw-btn2", onClick: () => choosePreset("活跃") }, "套用「活跃」"),
            h("span", { className: "qbw-hint" }, presetName ? `当前预览：${presetName}` : "先选一个预设，或直接改下面的值")),
          h("div", { className: "qbw-hint", style: { marginBottom: "6px" } },
            changed.length ? `将改动 ${changed.length} 项；标了「将改」的行就是会变的设置。` : "没有改动；选预设或改数值后，这里会列出差异。"),
          changed.length ? h("table", { className: "qbw-table" },
            h("thead", null, h("tr", null, h("th", null, "设置"), h("th", null, "当前"), h("th", null, "改成"))),
            h("tbody", null, changed.map((field) => h("tr", { key: field.path, style: { background: "color-mix(in srgb, var(--qbw-warn) 7%, transparent)" } },
              h("td", null,
                h("b", null, field.label),
                h("span", { className: "qbw-chip on", style: { marginLeft: "6px" } }, "将改"),
                h("div", { className: "qbw-hint" }, field.hint || ""),
                h("div", { className: "qbw-hint" }, field.where || "")),
              h("td", null, format(field, currentOf(field.path))),
              h("td", null,
                h("div", { className: "qbw-actions", style: { marginTop: 0, paddingTop: 0, borderTop: "none" } }, editor(field)),
                h("div", { className: "qbw-hint" }, format(field, draft[field.path]))))))) : null,
          applied ? h("div", { className: "qbw-hint", style: { color: "var(--qbw-ok-text)", marginTop: "8px" } }, applied) : null,
          h("div", { className: "qbw-actions", style: { marginTop: "10px" } },
            h(Btn, { kind: "qbw-btn2", onClick: reset }, "恢复当前值"),
            h(Btn, { onClick: apply, disabled: !changed.length }, "应用改动"),
            h(Btn, { kind: "qbw-btn2", onClick: () => onClose?.() }, "关闭")),
          h("div", { style: { marginTop: "12px" } },
            h("div", { className: "qbw-label" }, "所有影响花费的设置（参考）"),
            h("table", { className: "qbw-table" },
              h("thead", null, h("tr", null, h("th", null, "设置"), h("th", null, "怎么影响花费"), h("th", null, "在哪一页"))),
              h("tbody", null, SAVE_TOKEN_TIPS.map(([name, why, where]) => h("tr", { key: name },
                h("td", null, name), h("td", null, why), h("td", null, where))))))));
    }

    /** 「怎么省 token」入口条：额度页最上方 + QQ 页花费卡片共用。 */
    function SaveTokenEntry({ set, setUnified, qq, unified, toast, compact }) {
      const [open, setOpen] = useState(false);
      return h("div", { className: compact ? "" : "qbw-card" },
        h("div", { className: "qbw-row", style: { borderBottom: "none", paddingBottom: 0 } },
          h("div", null,
            h("div", { className: "qbw-kicker" }, "怎么省 token"),
            h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
              "一次弹窗列全：哪些设置影响花费、在哪改、有三档预设。")),
          h(Btn, { onClick: () => setOpen(true) }, "打开省钱清单")),
        open ? h(SaveTokenTipsModal, { set, setUnified, qq, unified, toast, onClose: () => setOpen(false) }) : null);
    }

    function CostCard({ toast, set }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const [msg, setMsg] = useState("");
      const [busyKey, setBusyKey] = useState("");
      const [lf, setLf] = useState(null);

      const load = async () => {
        try {
          const r = await api("/bridge", { method: "POST", body: { action: "token-summary" } });
          setData(r);
          setErr("");
          try {
            const l = await api("/bridge", { method: "POST", body: { action: "local-filter" } });
            setLf(l);
          } catch { setLf(null); }
        } catch (e) { setErr(`${e.message}${e.hint ? `（${e.hint}）` : ""}`); }
      };
      useEffect(() => { void load(); }, []);

      const tok = (n) => {
        const v = Number(n) || 0;
        if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
        if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
        return String(Math.round(v));
      };
      const money = (n) => (Number(n) || 0).toFixed(2);

      const list = Array.isArray(data?.conversations) ? data.conversations : [];
      const totals = data?.totals ?? {};
      const todayTotal = Number(totals.todayCost) || 0;

      const resetSession = async (key, label) => {
        if (!window.confirm(`给「${label}」换一条新会话？\n\n换完她会带一段交接接着聊；旧会话仍归档在 DSH 里，不会丢。`)) return;
        setBusyKey(key); setMsg("");
        try {
          await api("/bridge", { method: "POST", body: { action: "session-reset", key } });
          setMsg(`✓ 已给「${label}」换新会话`);
          await load();
        } catch (e) { setMsg(`✗ ${e.message}${e.hint ? `（${e.hint}）` : ""}`); } finally { setBusyKey(""); }
      };

      const labelOf = (c) => {
        const k = String(c.key ?? "");
        if (k.startsWith("group:")) return `群 ${k.slice(6)}`;
        if (k.startsWith("private:")) return `私聊 ${k.slice(8)}`;
        return k;
      };

      return h("div", { className: "qbw-card" },
        h("div", { className: "qbw-row", style: { borderBottom: "none", paddingBottom: 0 } },
          h("div", null,
            h("div", { className: "qbw-kicker" }, "花费与会话"),
            h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
              `今日 ¥${money(todayTotal)} · ${tok(totals.todayTokens)} token · ${list.length} 条会话在册`
              + (Number(totals.unattributedCost) > 0 ? ` · 另有 ¥${money(totals.unattributedCost)} 无法归到具体会话` : "")
              + (lf?.totals?.blocked ? ` · 本地判断${lf.config?.dryRun ? '（dry-run）' : ''}累计会拦 ${lf.totals.blocked} 条` : "")
              + (Number(data?.totals?.external?.todayCost) > 0 ? ` · 外部渠道 ¥${money(data.totals.external.todayCost)}` : ""))),
          h(Btn, { kind: "qbw-btn2", onClick: () => void load() }, "刷新")),
        err ? h("div", { className: "qbw-err", style: { marginTop: "8px" } }, err) : null,
        msg ? h("div", { className: "qbw-hint", style: { marginTop: "8px" } }, msg) : null,
        !list.length && !err ? h("div", { className: "qbw-hint", style: { marginTop: "10px" } },
          "还没有会话用量记录：桥接刚启动或还没人说话时是正常的。") : null,
        list.length ? h("table", { className: "qbw-table", style: { marginTop: "10px" } },
          h("thead", null, h("tr", null,
            h("th", null, "会话"), h("th", null, "今日 token"), h("th", null, "今日 ¥"), h("th", null, "占比"), h("th", null, ""))),
          h("tbody", null, list.slice(0, 20).map((c) => {
            const share = todayTotal > 0 ? (Number(c.todayCost) / todayTotal) * 100 : 0;
            return h("tr", { key: c.key },
              h("td", null, labelOf(c)),
              h("td", null, tok(c.todayTokens)),
              h("td", null, `¥${money(c.todayCost)}`),
              h("td", null, share > 0 ? `${share.toFixed(1)}%` : "—"),
              h("td", null, h(Btn, {
                kind: "qbw-btn2",
                disabled: !!busyKey,
                onClick: () => void resetSession(c.key, labelOf(c)),
              }, busyKey === c.key ? "换会话中…" : "换个新会话")));
          }))) : null,
        h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
          "「换会话」只是换一段干净的对话上下文（省钱），记忆卡不会丢；旧会话仍然归档在 DSH 里。"),
      );
    }

    function QQTab({ cfg, set, admin, setAdmin, unified, setUnified, overview, busy, setBusy, toast, reload, goTab, onSave, onAdminDiscardContext, dirty }) {
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
        F("socialV2.sticker.matchEveryNWakes", "每几次唤醒才带表情推荐", "默认 1=每次都带；调大=隔几次才带一次，省表情匹配与判断的 token（消息本身照常处理）", "number", { min: 1 }),
        F("socialV2.sticker.collect.enabled", "允许收藏表情", "", "switch"),
        F("socialV2.sticker.collect.maxPerMinute", "每分钟最多收藏", "", "number", { min: 0 }),
        F("socialV2.sticker.collect.maxPerHour", "每小时最多收藏", "", "number", { min: 0 }),
        F("socialV2.sticker.collect.maxRemarkChars", "备注最大字符", "", "number", { min: 0 }),
      ]});
      groups.push({ group: "图片能力", note: "auto=查 DSH 模型目录；目录里找不到的第三方模型默认按“不支持”走文字兜底，避免 ACP 直接拒绝图片块。若你确认该模型支持图片，可强制选「支持」。", fields: [
        F("socialV2.vision.imageInput", "模型图片输入", "auto / 支持 / 不支持；改完重启 DSH", "select", { options: [["auto", "自动识别"], ["true", "支持图片输入"], ["false", "不支持（文字兜底）"]] }),
      ]});
      groups.push({ group: "语音", note: "语音需要两个开关同时开：这里的「启用语音发送」总闸 + 工具面的「发语音」；改完必须重启 DSH（工具列表在 MCP 启动时固定）。text 模式不需要语音库；旧会话仍可能保留旧提示/旧记忆，必要时新建会话。", fields: [
        F("socialV2.voice.enabled", "启用语音发送", "总闸；还要在「工具面」打开「发语音」；改完重启 DSH", "switch"),
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
      const restartBridgeButton = h(Btn, { kind: "qbw-btn2", onClick: async () => {
        setBusy("restart");
        try { const r = await api("/bridge", { method: "POST", body: { action: "restart" } }); toast(r.ok ? "✓ 桥接已重启" : `✗ ${r.error ?? r.message ?? "失败"}`); await reload(); } catch (e) { toast(`✗ ${e.message}`); } finally { setBusy(""); }
      }, disabled: !!busy || unified?.platforms?.start?.qq === false, title: unified?.platforms?.start?.qq === false ? "先在顶部打开「启动 QQ」" : undefined }, "重启 QQ 桥接");

      return h("div", null,
        h(PlatformStartCard, {
          platform: "qq",
          hint: "开 = DSH 启动时自动拉起 QQ 桥接，并纳入「一键启动」；关 = 不自动启动、也不参与一键启动（保存后会停掉当前桥接）。",
          enabled: unified?.platforms?.start?.qq !== false,
          onChange: (value) => setUnified(["platforms", "start", "qq"], value),
          running: Boolean(overview?.bridge?.running || overview?.bridge?.ok),
          overview,
        }),
        h(ModelSettingsCard, { busy, toast, reload }),
        h(CostCard, { toast, set }),
        h(AdminCard, { admin, onChange: setAdmin, qqPrivate: cfg?.allow?.private ?? [], qqAllowAll: cfg?.allowAllWhenEmpty === true, toast, onDiscardContext: onAdminDiscardContext, onSave: () => onSave?.(true), busy, canSave: dirty }),
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
          h("div", { className: "qbw-actions" }, restartBridgeButton),
          h(FieldGroups, {
            groups: filtered,
            cfg,
            set,
            readOnly: (f) => f.readOnly || (f.path.join(".") === "self.mid") || (f.path.join(".") === "self.name"),
            onSave,
            categories: QQ_ADV_CATEGORIES,
            groupExtra: (g) => g.group === "连接与身份" ? h(Row, { label: "运行模式", hint: "chat=普通安全聊天；reserved=一代仿真；reserved2=二代工具仿真；closed-agent=仅主人私聊全工具。只运行当前模式，其他模式配置不生效" },
              h("select", { className: "qbw-select", value: overview?.mode?.effective ?? "reserved2", onChange: async (e) => {
                try { await api("/mode", { method: "POST", body: { mode: e.target.value } }); toast(`✓ 模式已切到 ${e.target.value}`); await reload(); } catch (err) { toast(`✗ ${err.message}`); }
              } },
                [["chat", "chat（一代普通）"], ["reserved", "reserved（一代仿真）"], ["reserved2", "reserved2（二代仿真）"], ["closed-agent", "closed-agent（封闭）"], ["simulation", "simulation（=reserved2）"]].map(([v, l]) => h("option", { key: v, value: v }, l)))) : null,
          })),
          h(GroupPolicyArea, { busy, setBusy, toast }),
          h(DshRepairCard, { busy, setBusy, toast }),
          h(ToolProfileArea, { cfg, set, onSave, busy }),
          h(AreaModalCard, { title: "鱼群保护", note: "鱼群密度、冷却与放行规则", onSave, busy },
            h(QqFishGuardStatusCard, { busy })),
          h(AreaModalCard, { title: "对话收尾", note: "收尾判断、冷却与结束点", onSave, busy },
            h(ClosureCard, { cfg, set, overview, busy, reload })),
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
        );
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
                h("td", { style: { whiteSpace: "nowrap", color: "var(--qbw-muted)" } }, timeText(item)),
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
              setState({ phase: "confirmed", account: result.account || {} });
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
              style: { width: "220px", height: "220px", imageRendering: "pixelated", display: "block", margin: "12px auto", background: "#ffffff", /* 二维码必须白底才可扫：这是唯一保留的固定白 */ padding: "10px", borderRadius: "10px" },
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
          state.phase === "confirmed" ? h("div", null,
            h("p", { style: { textAlign: "center", fontSize: "15px", color: "var(--qbw-ok-text)", fontWeight: 600 } }, "✅ 登录成功"),
            h("p", { style: { textAlign: "center" } },
              `${state.account?.name || "（未取到昵称）"}（${state.account?.mid || "?"}）`),
            h("p", { className: "qbw-hint", style: { textAlign: "center" } },
              "已写入凭据。可以在「B站 登录账号」卡片点「核查登录」再确认一次；如果 B站 上改了名，核查会显示最新昵称。"),
            state.account?.savedAt ? h("p", { className: "qbw-hint", style: { textAlign: "center" } }, `保存时间：${new Date(state.account.savedAt).toLocaleString("zh-CN", { hour12: false })}`) : null) : null,
          state.phase === "expired" ? h("div", null,
            h("p", { className: "qbw-err" }, "二维码已过期。"),
            h("p", { className: "qbw-hint" }, "建议：点下面「重新生成」；如果一直过期，确认手机 B站 App 能正常扫码。")) : null,
          state.phase === "wrong" ? h("div", null,
            h("p", { className: "qbw-err" }, `✗ ${state.error || "扫错账号"}`),
            h("p", { className: "qbw-hint" }, "扫错号不会保存。要点：① 想用主人同一个号 → 勾下方「我只有一个 B站 号」再扫；② 想换到别的号 → 点下面「换号（清除旧凭据）」再扫。"),
            h("p", { className: "qbw-hint" }, state.hint || "")) : null,
          state.phase === "error" ? h("div", null,
            h("p", { className: "qbw-err" }, `✗ ${state.error || "扫码失败"}`),
            h("p", { className: "qbw-hint" }, state.hint || "建议：点「重新生成」再试；仍失败请重启 DSH（旧代码可能没有扫码接口）。")) : null,
          notice ? h("p", { className: "qbw-hint", style: { textAlign: "center" } }, notice) : null,
          h("div", { className: "qbw-actions", style: { justifyContent: "center" } },
            state.phase === "confirmed" ? h(Btn, { onClick: close }, "完成") : null,
            live || state.phase === "confirmed" ? null : h(Btn, { onClick: start }, "重新生成"),
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

    function BiliTab({ cfg, set, qq, setQqPath, admin, setAdmin, unified, setUnified, qqPrivate, qqAllowAll, overview, busy, setBusy, toast, reload, onSave, onAdminDiscardContext, dirty }) {
      const [query, setQuery] = useState("");
      const [cookie, setCookie] = useState({ sessdata: "", bili_jct: "", buvid3: "" });
      const [cookieMsg, setCookieMsg] = useState("");
      const [qrFish, setQrFish] = useState(false);
      const [accounts, setAccounts] = useState(null);
      const [accountCheck, setAccountCheck] = useState({});
      const loadAccounts = useCallback(async () => {
        try { setAccounts(await api("/bili/accounts")); } catch { setAccounts(null); }
      }, []);
      useEffect(() => { loadAccounts(); }, [loadAccounts]);
      const verifyAccount = async (target) => {
        setAccountCheck((s) => ({ ...s, [target]: { busy: true } }));
        try {
          const r = await api("/bili/account/verify", { method: "POST", body: { target } });
          setAccountCheck((s) => ({ ...s, [target]: r }));
          if (r.ok) toast(`✓ ${target === "owner" ? "主人" : "小肥鱼"} 登录有效：${r.account?.name}（${r.account?.mid}）`);
          else toast(`✗ 核查失败：${r.error || "原因不明"}`);
          await loadAccounts();
        } catch (e) {
          setAccountCheck((s) => ({ ...s, [target]: { ok: false, error: e.message } }));
        }
      };
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

      const accountCard = h("div", { className: "qbw-card", style: { marginTop: "10px" } },
        h("h4", null, "B站 登录账号"),
        h("div", { className: "qbw-hint", style: { marginTop: "2px" } },
          "显示扫码登录的账号；「核查」会读凭据文件再问一次 B站，确认登录还有效、mid 没串。"),
        [["fish", "小肥鱼"], ["owner", "主人"]].map(([target, label]) => {
          const acc = target === "owner" ? accounts?.owner : accounts?.fish;
          const chk = accountCheck[target] || {};
          return h("div", { key: target, style: { marginTop: "8px", padding: "8px 10px", border: "1px solid rgba(127,127,127,.2)", borderRadius: "8px" } },
            h("div", { style: { fontWeight: 600 } },
              `${label}：`,
              acc?.configured ? `${acc.name || "（未取到昵称）"}（${acc.mid}）` : "未登录",
              chk.busy ? h("span", { className: "qbw-hint" }, " 核查中…") : null),
            acc?.savedAt ? h("div", { className: "qbw-hint" }, `保存时间：${new Date(acc.savedAt).toLocaleString("zh-CN", { hour12: false })}`) : null,
            h("div", { style: { display: "flex", gap: "8px", marginTop: "6px", flexWrap: "wrap" } },
              h(Btn, { kind: "qbw-btn2", onClick: () => verifyAccount(target), disabled: !!chk.busy || !acc?.configured }, "核查登录"),
              target === "fish" ? h(Btn, { kind: "qbw-btn2", onClick: () => setQrFish(true) }, acc?.configured ? "重新扫码" : "扫码登录") : null),
            chk.ok === true ? h("div", { className: "qbw-hint", style: { color: "var(--qbw-ok-text)", marginTop: "4px" } },
              `✓ 登录有效：${chk.account?.name || "（未取到昵称）"}（${chk.account?.mid}）`) : null,
            chk.ok === false ? h("div", { className: "qbw-err", style: { marginTop: "4px" } },
              `✗ ${chk.error || "核查失败"}${chk.hint ? `（建议：${chk.hint}）` : ""}`) : null);
        }));

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
        h(AdminCard, { admin, onChange: setAdmin, qqPrivate, qqAllowAll, toast, onDiscardContext: onAdminDiscardContext, onSave: () => onSave?.(true), busy, canSave: dirty }),
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
          h(FieldGroups, { groups, cfg, set, onSave, categories: BILI_ADV_CATEGORIES }),
          h(FishGuardStatusCard, { busy, toast }),
          h(AutomationCard, { data: automation, onRefresh: loadAutomation, busy }),
          h("div", { className: "qbw-search" },
            h("input", { className: "qbw-input", placeholder: "搜索 B站 参数", value: query, onChange: (e) => setQuery(e.target.value) }),
            h(Btn, { kind: "qbw-btn2", onClick: runDeps, disabled: !!busy }, busy === "deps" ? "体检中…" : "依赖体检"),
            h(Btn, { kind: "qbw-btn2", onClick: testNotify, disabled: !!busy }, "发条通知测试")),
          h("div", { className: "qbw-infobox" },
            "B站参数写入 ", h("code", { className: "qbw-code" }, overview?.paths?.biliConfig || "当前实际配置文件（见概览→路径）"), "；",
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
          accountCard,
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
          deps ? h("div", { className: "qbw-out" }, deps) : null),
        qrFish ? h(BiliQrModal, {
          target: "fish",
          onClose: () => setQrFish(false),
          onConfirmed: async (account) => {
            setCookieMsg(`✓ 已绑定 ${account.name || account.mid}（${account.mid}）`);
            await loadAccounts();
            await verifyAccount("fish");
            await reload();
          },
        }) : null);
    }

    // ── 人格卡编辑器（嵌在「角色」页里，不再单开「人设」标签）──────────────
    // 用户反馈「人设 / 角色」两个栏目重复：角色包和人格卡本来就是同一件事的两面。
    // 现在只有一个「角色」页：上面切角色，下面直接编辑当前角色的人格卡。
    function PersonaEditor({ busy, setBusy, toast, unified, setUnified }) {
      const [data, setData] = useState(null);
      const [draft, setDraft] = useState({ full: "", core: "", tone: "", daily: "", scenes: {} });
      const [tab, setTab] = useState("full");
      const [split, setSplit] = useState(null);
      const [scene, setScene] = useState("qq-group");
      const [err, setErr] = useState("");
      const sceneLabels = data?.sceneLabels ?? { "qq-group": "QQ 群聊", "qq-private": "QQ 私聊", bili: "B站", pet: "桌宠" };
      const layerPath = (key) => key === "scene"
        ? data?.layers?.scenes?.[scene]?.path
        : data?.layers?.[key]?.path;
      const load = useCallback(async () => {
        try {
          const r = await api("/persona");
          const layers = r.layers ?? {};
          setData(r);
          setDraft({
            full: layers.full?.text ?? r.text ?? "",
            core: layers.core?.text ?? r.text ?? "",
            tone: layers.tone?.text ?? "",
            daily: layers.daily?.text ?? "",
            scenes: layers.scenes ?? {},
          });
          setSplit(null);
          setErr("");
        } catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      const sceneText = draft.scenes?.[scene]?.text ?? "";
      const setLayer = (key, value) => setDraft((prev) => key === "scene"
        ? { ...prev, scenes: { ...prev.scenes, [scene]: { ...(prev.scenes?.[scene] ?? {}), text: value } } }
        : { ...prev, [key]: value });
      const saveAll = async () => {
        setBusy("persona-save");
        setErr("");
        const failures = [];
        // 只写「有内容」或「原本有内容、被用户清空」的层：
        // 以前 tone 永远为空也会发，服务端又没 tone 分支 → 被写进 persona.md，
        // 点一次「保存全部」就把人格核心覆盖掉（2026-10-31 用户反馈）。
        const origTone = data?.layers?.tone?.text ?? "";
        const origDaily = data?.layers?.daily?.text ?? "";
        const origScene = data?.layers?.scenes?.[scene]?.text ?? "";
        const jobs = [["core", "core", draft.core]];
        if (String(draft.tone || "").trim() || String(origTone).trim()) jobs.push(["tone", "tone", draft.tone]);
        if (String(draft.daily || "").trim() || String(origDaily).trim()) jobs.push(["daily", "daily", draft.daily]);
        if (String(sceneText || "").trim() || String(origScene).trim()) jobs.push(["scene", "scene", sceneText]);
        for (const [layer, label, text] of jobs) {
          try {
            await api("/persona", { method: "POST", body: { layer, scene: layer === "scene" ? scene : "", text } });
          } catch (e) {
            failures.push(`${label}：${e.message}${e.hint ? "（" + e.hint + "）" : ""}`);
          }
        }
        try {
          if (failures.length) toast("✗ 保存失败：" + failures.join("；"));
          else toast("✓ 四层已保存");
          await load();
        } finally { setBusy(""); }
      };
      const saveFull = async () => {
        if (String(draft.full || "").trim().length < 50) {
          toast("✗ 整卡至少写 50 字；内容太少会被拒绝保存");
          return;
        }
        setBusy("persona-save-full");
        setErr("");
        try {
          await api("/persona", { method: "POST", body: { layer: "full", text: draft.full } });
          toast("✓ 整卡已保存；它只在「整卡注入」通道里生效");
          await load();
        } catch (e) {
          const message = `✗ 整卡保存失败：${e.message}${e.hint ? `（${e.hint}）` : ""}`;
          setErr(message);
          toast(message);
        } finally { setBusy(""); }
      };
      const mode = unified?.persona?.mode === "split" ? "split" : "full";
      const setMode = (next) => setUnified(["persona", "mode"], next);
      const classify = async () => {
        setBusy("persona-classify");
        setErr("");
        const source = [
          draft.core,
          draft.tone,
          draft.daily,
          ...Object.values(draft.scenes ?? {}).map((scene) => scene?.text),
        ].map((part) => String(part ?? "").trim()).filter(Boolean).join("\n\n");
        if (!source) {
          const message = "✗ 先写一点人格内容（核心/语气/日常/场景）再拆分";
          setErr(message);
          toast(message);
          setBusy("");
          return;
        }
        try {
          const r = await api("/persona/classify", { method: "POST", body: { text: source } });
          setSplit(r.drafts ?? null);
          toast("✓ 已生成拆分草稿；还没有保存，请检查后再应用");
        } catch (e) {
          const message = "✗ " + e.message + (e.hint ? "；" + e.hint : "");
          setErr(message);
          toast(message);
        } finally { setBusy(""); }
      };
      const applySplit = () => {
        if (!split) return;
        setDraft((prev) => {
          const nextScenes = { ...(prev.scenes ?? {}) };
          for (const [k, v] of Object.entries(split.scenes ?? {})) {
            if (!String(v || "").trim()) continue;
            nextScenes[k] = { ...(nextScenes[k] ?? {}), text: String(v) };
          }
          return {
            core: split.core || prev.core,
            tone: split.tone || prev.tone,
            daily: split.daily || prev.daily,
            scenes: nextScenes,
          };
        });
        setSplit(null);
        toast("✓ 草稿已填入编辑区；还没有保存，点「保存全部」");
      };
      const restore = async (name) => {
        setBusy("persona-restore");
        try { await api("/persona", { method: "POST", body: { action: "restore", name } }); toast("✓ 已从备份恢复"); await load(); }
        catch (e) { toast("✗ " + e.message + (e.hint ? "；" + e.hint : "")); } finally { setBusy(""); }
      };
      const box = (key, label, hint) => h("div", { className: "qbw-card", style: { marginBottom: "8px" } },
        h("div", { className: "qbw-label" }, label, h("span", { className: "qbw-hint", style: { marginLeft: "8px" } }, ` · ${layerPath(key) || "未创建"} · ${(key === "scene" ? sceneText : draft[key] || "").length} 字`)),
        h("div", { className: "qbw-hint", style: { marginBottom: "4px" } }, hint),
        h("textarea", {
          className: "qbw-textarea card",
          value: key === "scene" ? sceneText : (draft[key] ?? ""),
          onChange: (e) => setLayer(key, e.target.value),
          spellCheck: false,
          placeholder: hint,
        }));
      const renderFullTab = () => h("div", null,
        h("div", { className: "qbw-card", style: { marginTop: "8px" } },
          h("div", { className: "qbw-label" }, "整个人格卡（整卡注入）"),
          h("div", { className: "qbw-hint" }, "这份内容只在「整卡注入」通道生效；它和拆分核心是两份独立内容，互不同步。"),
          h("textarea", {
            className: "qbw-textarea card",
            style: { minHeight: "420px" },
            value: draft.full ?? "",
            onChange: (e) => setLayer("full", e.target.value),
            spellCheck: false,
            placeholder: "写完整人格卡：身份、价值观、说话方式、场景差异都可以放在这里。",
          })),
        h("div", { className: "qbw-actions" },
          h(Btn, { onClick: saveFull, disabled: !!busy }, busy === "persona-save-full" ? "保存中…" : "保存整卡"),
          h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, "重新读取"),
          h("span", { className: "qbw-hint" }, String((draft.full || "").length) + " 字")));

      const renderSplitTab = () => h("div", null,
        h("div", { className: "qbw-hint" }, "拆分模式：核心 + 语气 + 日常 + 场景，按平台只注入需要的层；省 token，但人格可能不如整卡完整。"),
        h("div", { className: "qbw-hint", style: { margin: "6px 0" } },
          "写法：", h("b", null, "核心"), " 写“我是谁/价值观/底线”；", h("b", null, "语气"), " 只写口癖、句子长短、称呼、标点；", h("b", null, "日常"), " 写近期心情/习惯；", h("b", null, "场景"), " 写平台差异。"),
        h("div", { className: "qbw-actions", style: { marginBottom: "6px" } },
          h(Btn, { onClick: saveAll, disabled: !!busy }, busy === "persona-save" ? "保存中…" : "保存全部"),
          h(Btn, { kind: "qbw-btn2", onClick: classify, disabled: !!busy }, busy === "persona-classify" ? "拆分中…" : "智能拆分当前人格"),
          h(Btn, { kind: "qbw-btn2", onClick: load, disabled: !!busy }, "重新读取"),
          h("span", { className: "qbw-hint" }, "拆分不会写盘；先检查草稿。")),
        box("core", "人格核心", "身份、价值观、底线。不是每次群聊都加载；但身份底座会单独带。"),
        box("tone", "人格语气", "口癖、句子长短、称呼、标点、语气词。拆分模式日常群聊默认只加载语气层。"),
        box("daily", "人格日常", "近期状态、习惯、心情。保存时自动写入「你是谁、主人是谁」；拆分也会多留一份在日层层。"),
        h("div", { className: "qbw-group", style: { marginTop: "6px" } }, "场景人格", h("small", null, "平台差异；没有就留空")),
        h("div", { className: "qbw-actions", style: { marginTop: "2px", paddingTop: "2px" } },
          ...Object.entries(sceneLabels).map(([id, label]) => h(Btn, {
            key: id, kind: scene === id ? undefined : "qbw-btn3", onClick: () => setScene(id), disabled: !!busy,
          }, label))),
        h("div", { className: "qbw-warnbox", style: { margin: "6px 0" } },
          "场景说明包含 QQ 群聊、QQ 私聊、B站、桌宠等其他平台。不同平台之间不保证隐私完全隔离，请谨慎填写；出了事不负责。"),
        box("scene", "场景补充：" + (sceneLabels[scene] || scene), "只写这个平台的差异；不知道就留空，不会清空别的层。"),
        split ? h("div", { className: "qbw-card", style: { marginTop: "8px", borderColor: "var(--qbw-warn)" } },
          h("h4", null, "拆分草稿（尚未保存）"),
          h("div", { className: "qbw-hint" }, "空白的建议表示“模型没有建议”，会保留你原来的内容；不会清空。"),
          ["core", "tone", "daily"].map((key) => h("div", { key, style: { marginTop: "6px" } },
            h("div", { className: "qbw-label" }, key === "core" ? "核心" : key === "tone" ? "语气" : "日常"),
            h("div", { className: "qbw-hint" }, "当前 " + String((draft[key] || "").length) + " 字 → 建议 " + String((split[key] || "").length) + " 字"),
            h("pre", { className: "qbw-code", style: { whiteSpace: "pre-wrap", maxHeight: "180px", overflow: "auto" } }, split[key] || "（未建议，保留原文）"))),
          Object.entries(split.scenes ?? {}).filter(([, v]) => String(v || "").trim()).map(([k, v]) => h("div", { key: k, style: { marginTop: "6px" } },
            h("div", { className: "qbw-label" }, "场景：" + (sceneLabels[k] || k)),
            h("pre", { className: "qbw-code", style: { whiteSpace: "pre-wrap", maxHeight: "120px", overflow: "auto" } }, v))),
          h("div", { className: "qbw-actions", style: { marginTop: "8px" } },
            h(Btn, { onClick: applySplit, disabled: !!busy }, "应用到编辑区（不保存）"),
            h(Btn, { kind: "qbw-btn2", onClick: () => setSplit(null), disabled: !!busy }, "丢弃草稿"))) : null);

      return h("div", null,
        h("div", { className: "qbw-infobox", style: { borderColor: "var(--qbw-warn)", background: "color-mix(in srgb, var(--qbw-warn) 10%, transparent)" } },
          h("div", { style: { fontWeight: 700, marginBottom: "4px" } }, "人格卡：整卡 / 拆分，两个通道"),
          "整卡 = 完整注入，费 token；拆分 = 分层注入，省 token 但可能不完整。两个 Tab 各自保存，互不覆盖；注入用哪一份由下面的「注入方式」决定。",
          h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
            h("b", null, "身份底座自动带："), "无论哪种通道，系统都会先带一行「你是谁、主人是谁」；身份不需要只写在核心里。")),
        h("div", { className: "qbw-card", style: { margin: "8px 0" } },
          h("div", { className: "qbw-label" }, "人格注入方式"),
          h("div", { className: "qbw-actions", style: { marginTop: "4px" } },
            h(Btn, { kind: mode === "full" ? undefined : "qbw-btn2", onClick: () => setMode("full"), disabled: !!busy }, "整卡注入"),
            h(Btn, { kind: mode === "split" ? undefined : "qbw-btn2", onClick: () => setMode("split"), disabled: !!busy }, "拆分注入")),
          h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
            mode === "full"
              ? "当前：整卡注入（完整、费 token）。选完记得点页面底部「保存并生效」。"
              : "当前：拆分注入（省 token，可能不完整）。选完记得点页面底部「保存并生效」。")),
        h("div", { className: "qbw-tabs", style: { marginTop: "8px" } },
          h("button", { className: "qbw-tab" + (tab === "full" ? " on" : ""), onClick: () => setTab("full") }, "整个人格卡注入"),
          h("button", { className: "qbw-tab" + (tab === "split" ? " on" : ""), onClick: () => setTab("split") }, "拆分人格卡（省 token）")),
        tab === "full" ? renderFullTab() : renderSplitTab(),
        err ? h("div", { className: "qbw-err", style: { margin: "6px 0" } }, err) : null,
        data?.path ? h(Row, {
          label: "旧人格卡文件（仅兼容）",
          hint: "角色系统启用时以角色包内的 persona.md 为准；这一栏只给没有角色的旧布局用。",
        }, h("input", {
          className: "qbw-input wide",
          value: unified?.persona?.file ?? "",
          onChange: (e) => setUnified(["persona", "file"], e.target.value),
          placeholder: "roles/你的角色.md",
        })) : null,
        data?.backups?.length ? h(Section, { title: "人格卡历史备份", note: `${data.backups.length} 份` },
          data.backups.slice(0, 8).map((b) => h("div", { key: b.name, className: "qbw-item" },
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
      const memoryMode = unified?.memory?.mode === "vector" ? "vector" : "narrative";
      const percent = Math.max(0, Math.min(100, Number(status.percent) || 0));
      const meterClass = "qbw-meter" + (level >= 2 ? " bad" : level >= 1 ? " warn" : "");
      const needsAttention = level > 0 && level > (Number(status.acknowledgedLevel) || 0);
      const selectedRecords = (data.records ?? []).filter((record) => selected.includes(record.id));
      const selectedHasNonOwner = selectedRecords.some((record) => !record.tags?.includes('owner'));
      const act = async (action, extra = {}) => {
        setBusy(`mc-${action}`);
        let result = null;
        let failure = null;
        let reloadFailure = null;
        try {
          result = await api("/memory-card", { method: "POST", body: { action, ...extra } });
        } catch (e) {
          failure = e;
        }
        // 先把服务端结果刷新回界面；reload 失败不能假装成功，否则用户会以为没生效。
        try { await reload(); } catch (e) { reloadFailure = e; }
        try { onChanged?.(); } catch {}
        try {
          if (failure) {
            toast(`✗ ${failure.message}${failure.hint ? `；${failure.hint}` : ""}`);
          } else if (reloadFailure) {
            toast(`⚠️ 服务端已保存，但界面刷新失败：${reloadFailure.message}；请手动刷新后再确认`);
          } else {
            const r = result ?? {};
            toast(action === "maintain" ? `✓ 已整理：新增 QQ ${r.addedQq ?? 0} / 桌宠 ${r.addedPet ?? 0} / B站 ${r.addedBili ?? 0} / 全量归档 ${r.addedFull ?? 0} 条`
              : action === "compact" ? `✓ 已压缩（降级 ${r.steps ?? 0} 档）`
                : action === "merge-memories" ? `✓ 已合并 ${r.merged ?? 0} 条为一个事件`
                  : action === "set-first-meet" ? `✓ 已设为初次相遇（${r.merged ?? 1} 条）`
                    : "✓ 已更新");
          }
        } catch {}
        setBusy("");
      };
      const pin = (record) => act("pin", { id: record.id, pinned: !record.pinned });
      const forget = (record) => {
        const extra = record.firstMet
          ? "\n这是初次相遇记录；删除后会自动选下一条最早的主人互动。全量卡仍保留副本。"
          : "";
        if (!confirm(`确定忘掉「${record.title || record.text.slice(0, 20)}」？这是不可逆的（会先备份整张卡）。${extra}`)) return;
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
      const sharing = config.sharing && typeof config.sharing === "object" ? config.sharing : {};
      const circles = Array.isArray(sharing.circles) ? sharing.circles : [];
      const knownGroups = [];
      const knownGroupIds = new Set();
      for (const record of data.records ?? []) {
        const gid = String(record.groupId || "").trim();
        if (!/^\d+$/.test(gid) || knownGroupIds.has(gid)) continue;
        knownGroupIds.add(gid);
        knownGroups.push({ id: gid, name: record.groupName || "" });
      }
      const setSharing = (key, value) => setUnified(["memoryCard", "sharing", key], value);
      const setCircles = (next) => setUnified(["memoryCard", "sharing", "circles"], next);
      const updateCircle = (index, patch) => setCircles(circles.map((circle, i) => i === index ? { ...circle, ...patch } : circle));
      const addCircle = () => setCircles([...circles, { id: `circle-${Date.now()}`, name: `互通圈 ${circles.length + 1}`, groups: [] }]);
      const removeCircle = (index) => setCircles(circles.filter((_, i) => i !== index));
      const parseGroupIds = (text) => [...new Set(String(text ?? "").split(/[\s,，]+/).map((x) => x.replace(/^group:/i, "")).filter((x) => /^\d+$/.test(x)))];
      const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString("sv-SE"); } catch { return ""; } };
      const clarityLabel = { vivid: "清晰", clear: "清楚", fuzzy: "模糊", trace: "只剩印象", forgotten: "已遗忘" };
      const platformLabel = { qq: "QQ", bili: "B站", shared: "共享" };
      const summary = h("div", null,
        h("div", { className: "qbw-infobox" },
          h("b", null, "当前提示词加载："),
          memoryMode === "vector" ? "向量记忆（按当前消息检索）" : (status.loadedLabel || "衰减记忆卡（日常加载）"),
          memoryMode === "vector"
            ? "。叙事记忆仍在继续写入，但本轮不注入；要改回叙事记忆在上面的「记忆方式」里切换。"
            : "。全量记忆卡（所有记忆保持清晰、永不遗忘）只存档，不会自动注入；在下方「全量记忆卡」里查看 / 搜索。",
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
        h(Section, { title: "记忆互通圈", note: "默认隔离；同圈至少两个群；私聊记忆永不进群", collapsible: false },
          h(Row, { label: "主人私聊可读群记忆", hint: "只对主人私聊生效（需要先配好管理员 QQ）；群聊仍然只看自己 + 同圈；私聊记录永远不会进群。开启后，主人私聊会多一个「群里的近况」小节。" },
            h("input", {
              className: "qbw-switch", type: "checkbox",
              checked: sharing.privateReadsGroups === true,
              onChange: (e) => setSharing("privateReadsGroups", e.target.checked),
            })),
          sharing.privateReadsGroups === true ? h("div", { className: "qbw-row", style: { marginTop: "6px" } },
            h("span", { className: "qbw-label" }, "可读群号"),
            h("input", {
              className: "qbw-input",
              value: (sharing.privateGroupIds || []).join(", "),
              placeholder: "留空 = 所有 QQ 白名单群；也可以只填 2~3 个，逗号/空格分隔",
              onChange: (e) => setSharing("privateGroupIds", parseGroupIds(e.target.value)),
              style: { flex: "1 1 320px" },
            }),
            h("span", { className: "qbw-hint" }, "留空 = 跟随 QQ 白名单；不会读黑名单群")) : null,
          sharing.privateReadsGroups === true ? h("div", { className: "qbw-row", style: { marginTop: "6px" } },
            h("span", { className: "qbw-label" }, "最多显示群记忆"),
            h("input", {
              className: "qbw-input", type: "number", min: 1, max: 30,
              value: sharing.privateGroupLimit ?? 8,
              onChange: (e) => setSharing("privateGroupLimit", Number(e.target.value) || 8),
              style: { width: "100px", minWidth: "100px" },
            }),
            h("span", { className: "qbw-hint" }, "条；防止群记忆挤掉私聊自己的记忆")) : null,
          sharing.privateReadsGroups === true ? h("div", { className: "qbw-row", style: { marginTop: "6px" } },
            h("span", { className: "qbw-label" }, "群记忆字数"),
            h("input", {
              className: "qbw-input", type: "number", min: 200, max: 2000, step: 100,
              value: sharing.privateGroupChars ?? 700,
              onChange: (e) => setSharing("privateGroupChars", Number(e.target.value) || 700),
              style: { width: "110px", minWidth: "110px" },
            }),
            h("span", { className: "qbw-hint" }, "字；单独预算，不占私聊自己的记忆")) : null,
          h("div", { className: "qbw-hint", style: { marginBottom: "6px", marginTop: "8px" } },
            knownGroups.length
              ? `已知群：${knownGroups.map((g) => `${g.name || "未命名"}（${g.id}）`).join(" · ")}`
              : "还没有带群来源的记忆；可以先填群号。"),
          circles.map((circle, index) => h("div", { className: "qbw-card", key: circle.id || index, style: { marginTop: "6px" } },
            h("div", { className: "qbw-row" },
              h("input", {
                className: "qbw-input", value: circle.name || "", placeholder: "互通圈名称",
                onChange: (e) => updateCircle(index, { name: e.target.value }), style: { flex: "1 1 180px" },
              }),
              h(Btn, { kind: "qbw-btn2", onClick: () => removeCircle(index), disabled: !!busy }, "删除")),
            h("div", { className: "qbw-row", style: { marginTop: "6px" } },
              h("span", { className: "qbw-label" }, "群号"),
              h("input", {
                className: "qbw-input", value: (circle.groups || []).join(", "),
                placeholder: "712144923, 733...（逗号/空格分隔）",
                onChange: (e) => updateCircle(index, { groups: parseGroupIds(e.target.value) }),
                style: { flex: "1 1 260px" },
              }))),
          ),
          h("div", { className: "qbw-actions" },
            h(Btn, { kind: "qbw-btn2", onClick: addCircle, disabled: !!busy }, "新增互通圈"))),
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
                record.groupId ? h("span", { className: "qbw-chip" }, `群 ${record.groupName || record.groupId}`) : (record.private ? h("span", { className: "qbw-chip" }, "私聊") : null),
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
              h(Btn, { kind: "qbw-btn2", onClick: () => forget(record), disabled: !!busy }, "忘记"))))),
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
              record.groupId ? h("span", { className: "qbw-chip" }, `群 ${record.groupName || record.groupId}`) : (record.private ? h("span", { className: "qbw-chip" }, "私聊") : null),
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
        err ? h("div", { style: { fontSize: "12px", color: "var(--qbw-err-text)" } }, err) : null,
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
        let saved = false;
        try {
          await api("/voice/packs/cloud-config", { method: "POST", body: { id: "voice-cloud", ...form } });
          saved = true;
          setMsg("已保存");
          try { await read(); } catch {}
          // 通知是界面层的事：失败也不能把"保存成功"改写成失败（2026-10-30 用户反馈）
          try { toast("✓ 云端密钥已保存"); } catch {}
        } catch (e) {
          setMsg(saved ? "已保存（界面提示失败）" : "保存失败：" + e.message);
        } finally { setBusy(false); }
      };
      const test = async () => {
        setBusy(true); setMsg("测试中…");
        try { const r = await api("/voice/packs/test", { method: "POST", body: { id: "voice-cloud" } }); setMsg("✅ 连接成功，" + r.ms + "ms"); }
        catch (e) { setMsg("❌ " + e.message); }
        finally { setBusy(false); }
      };

      const downloadSample = async () => {
        setBusy(true); setMsg("下载参考音频…");
        try {
          const res = await fetch(`${API}/voice/packs/sample?id=voice-cloud`, { headers: { accept: "audio/wav" } });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const disp = res.headers.get("content-disposition") || "";
          const m = /filename\*=UTF-8''([^;]+)/i.exec(disp);
          const name = m ? decodeURIComponent(m[1]) : "小语-参考音频19秒.wav";
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          setMsg(`✓ 已开始下载：${name}`);
        } catch (e) {
          setMsg(`下载失败：${e.message}；可点「打开所在目录」手动复制`);
        } finally { setBusy(false); }
      };

      const openSampleFolder = async () => {
        setBusy(true); setMsg("打开目录…");
        try {
          const r = await api("/voice/packs/sample-open", { method: "POST", body: { id: "voice-cloud" } });
          if (!r.ok) throw new Error(r.error || "打开目录失败");
          setMsg(`✓ 已打开：${r.path || r.dir || ""}`);
        } catch (e) {
          setMsg(`打开目录失败：${e.message}`);
        } finally { setBusy(false); }
      };

      const row = (label, node) => h("div", { style: { display: "flex", gap: "8px", alignItems: "center", marginTop: "6px", flexWrap: "wrap" } },
        h("span", { style: { width: "96px", fontSize: "13px" } }, label), node);

      return h("div", { id: "surfcore-cloud-voice-form", style: { marginTop: "14px", padding: "12px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "10px" } },
        h(CloudStats, null),
        h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px", marginTop: "12px" } },
          h("strong", null, "云端包：密钥与音色"),
          h("span", { style: { fontSize: "12px", opacity: 0.75 } }, cfg && cfg.configured ? "已配置（可随时修改）" : "未配置 —— 填完才能用")),
        h("ol", { style: { fontSize: "12px", margin: "8px 0", paddingLeft: "20px", lineHeight: "1.7", opacity: 0.8 } },
          h("li", null,
            h(Btn, { kind: "qbw-btn2", disabled: busy, onClick: downloadSample }, "下载参考音频"),
            "（19 秒，包里自带，不用自己录） ",
            h(Btn, { kind: "qbw-btn2", disabled: busy, onClick: openSampleFolder }, "打开所在目录")),
          h("li", null, h("a", { href: "https://console.volcengine.com/speech/service/8", target: "_blank", rel: "noreferrer" }, "打开火山引擎控制台 ↗"), " → 语音技术 → 声音复刻 → 上传 wav → 训练，拿到 S_xxxxxxxx"),
          h("li", null, "把下面三项填进来，点「保存」，再点「测试连接」")),
        row("AppID", h("input", { type: "text", value: form.appId, placeholder: "控制台「语音技术」页里的 AppID", onChange: (e) => setForm({ ...form, appId: e.target.value }), style: { width: "240px" } })),
        row("Access Key", h("input", { type: "password", value: form.accessKey, placeholder: cfg && cfg.hasAccessKey ? "已保存：" + cfg.accessKeyMasked + "（留空则不修改）" : "控制台里的 Access Key", onChange: (e) => setForm({ ...form, accessKey: e.target.value }), style: { width: "240px" } })),
        row("音色 ID", h("input", { type: "text", value: form.speaker, placeholder: "S_xxxxxxxx", onChange: (e) => setForm({ ...form, speaker: e.target.value }), style: { width: "240px" } })),
        h("div", { style: { display: "flex", gap: "8px", marginTop: "10px", alignItems: "center", flexWrap: "wrap" } },
          h(Btn, { disabled: busy, onClick: save }, busy ? "保存中…" : "保存"),
          h(Btn, { kind: "qbw-btn2", disabled: busy, onClick: test }, "测试连接"),
          msg ? h("span", { style: { fontSize: "12px", opacity: 0.85 } }, msg) : null),
        h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } },
          "密钥只写在本机包内的 config.toml，不上传任何服务器。安装包不预置任何密钥，AppID 和 Access Key 都要自己填（别人的填进去会花别人的额度）。"));
    }

    function VoiceTab({ toast, qq, setQq, onSave, busy, onResource }) {
      const [packs, setPacks] = useState([]);
      const [packsDir, setPacksDir] = useState("");
      const [dirInput, setDirInput] = useState("");
      const [mirror, setMirror] = useState("");
      // 语音自检：三步（服务/合成/发送前置）各给结论，避免"语音坏了"只能靠猜。
      const [ttsCheck, setTtsCheck] = useState(null);
      const [ttsChecking, setTtsChecking] = useState(false);
      const [rules, setRules] = useState(null);
      const [err, setErr] = useState("");
      const [busyId, setBusyId] = useState("");
      const [pick, setPick] = useState("voice-local");
      const [switchMsg, setSwitchMsg] = useState("");
      const [msg, setMsg] = useState({});
      const [importPick, setImportPick] = useState(null);
      const [importErr, setImportErr] = useState(null);
      const [importDone, setImportDone] = useState(null);

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
      // 页面刷新/切回来时，导入仍在后台跑：自动轮询，不能只靠发起导入的那个调用栈。
      useEffect(() => {
        const active = (packs || []).some((p) => p.import && p.import.phase !== "完成" && p.import.phase !== "失败");
        if (!active) return undefined;
        const t = setInterval(() => { load(); }, 1500);
        return () => clearInterval(t);
      }, [packs, load]);

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

      const waitImport = async (id) => {
        for (let i = 0; i < 900; i += 1) {
          await new Promise((r) => setTimeout(r, 1000));
          let r;
          try { r = await api("/voice/packs"); } catch { continue; }
          setPacks(r.packs || []);
          const p = (r.packs || []).find((x) => x.id === id);
          const im = p?.import;
          if (!im) continue;
          if (im.phase === "失败") {
            if (im.code === "IMPORT_CANCELLED") {
              if (toast) toast("已取消导入（旧包未动）");
            } else {
              setImportErr({ id, ...im });
            }
            await load();
            return;
          }
          if (im.phase === "完成") {
            setImportDone({ id, ...(im.result || {}) });
            await load();
            return;
          }
        }
        setImportErr({ id, error: "导入进度长时间没有更新", hint: "检查桥接是否还在运行；如果文件仍在复制，稍等后刷新设置页。", code: "IMPORT_TIMEOUT" });
      };

      const startImportFlow = async (id) => {
        setImportErr(null);
        setImportDone(null);
        let picked;
        try {
          picked = await browseNative("dir", `选择解压后的 ${id === "voice-local" ? "voice-local" : "voice-cloud"} 文件夹`);
        } catch (e) {
          setImportErr({ id, error: `选择框打不开：${e.message || e}`, hint: "可以手动把包放到设置页显示的安装目录后重启桥接；或检查是否在本机桌面运行。" });
          return;
        }
        if (!picked?.ok) {
          if (!picked?.cancelled) {
            setImportErr({ id, error: picked?.error || "没有选到目录", hint: "重新点「导入离线包…」，选择解压出来的 voice-local / voice-cloud 文件夹。" });
          }
          return;
        }
        setBusyId("__import");
        try {
          const info = await api("/voice/packs/import-inspect", { method: "POST", body: { id, sourceDir: picked.path } });
          setImportPick({ id, info });
        } catch (e) {
          setImportErr({ id, sourceDir: picked.path, error: e.message, code: e.code, hint: e.hint, missing: e.missing });
        } finally {
          setBusyId("");
        }
      };

      const submitImport = async (allowUnverified = false) => {
        const job = importPick;
        if (!job) return;
        setImportPick(null);
        setBusyId("__import");
        try {
          await api("/voice/packs/import", { method: "POST", body: { id: job.id, sourceDir: job.info.sourceDir, allowUnverified } });
          await waitImport(job.id);
        } catch (e) {
          if (e.code === "IMPORT_UNVERIFIED" && !allowUnverified) {
            setImportPick({ ...job, unverified: true });
          } else {
            setImportErr({ id: job.id, sourceDir: job.info.sourceDir, error: e.message, code: e.code, hint: e.hint, missing: e.missing });
          }
        } finally {
          setBusyId("");
        }
      };

      const removeImportedSource = async (id, sourceDir) => {
        if (!sourceDir) return;
        if (!window.confirm(`删除导入用的源文件夹？\n\n${sourceDir}\n\n删除不影响 SurfCore 使用；zip 和父目录不会动。`)) return;
        try {
          const r = await api("/voice/packs/import-delete-source", { method: "POST", body: { id, sourceDir } });
          setImportDone((d) => (d ? { ...d, sourceDir: null } : d));
          if (toast) toast(`✓ 已删除源文件夹（释放 ${fmt(r.freedBytes || 0)}）`);
          await load();
        } catch (e) {
          setImportErr({ id, error: e.message, code: e.code, hint: e.hint, missing: e.missing });
        }
      };

      const removeImportBackup = async (id, backupDir) => {
        if (!backupDir) return;
        if (!window.confirm(`删除旧包备份？\n\n${backupDir}\n\n只有确认新包能正常启动/自检后才建议删除。`)) return;
        try {
          await api("/voice/packs/import-delete-backup", { method: "POST", body: { id, backupDir } });
          setImportDone((d) => (d ? { ...d, backupDir: null } : d));
          if (toast) toast("✓ 已删除旧包备份");
          await load();
        } catch (e) {
          setImportErr({ id, error: e.message, code: e.code, hint: e.hint, missing: e.missing });
        }
      };

      const runningId = ((packs.filter((p) => p.running)[0]) || {}).id || "";
      const toggle = async () => {
        setBusyId("__switch"); setSwitchMsg("");
        try {
          if (runningId === pick) {
            await api("/voice/packs/stop", { method: "POST", body: { id: pick } });
            setSwitchMsg("已停止");
          } else {
            const r = await api("/voice/packs/activate", { method: "POST", body: { id: pick } });
            setSwitchMsg(r.ok ? "已启动：" + (pick === "voice-cloud" ? "云端" : "本地") : ("启动失败：" + (r.error || "") + (r.hint ? ` — ${r.hint}` : "")));
          }
          await load();
        } catch (e) { setSwitchMsg("失败：" + e.message); }
        finally { setBusyId(""); }
      };

      // 网盘入口统一在设置页顶部「获取网盘资源」，这里不再保留旧的打开/复制按钮。

      const runTtsCheck = async () => {
        setTtsChecking(true); setTtsCheck(null);
        try {
          const r = await api("/voice/tts-check", { method: "POST", body: {} });
          setTtsCheck(r);
          if (toast) toast(r.ok ? "✓ 语音自检通过" : `✗ 自检发现问题：${(r.stages || []).find((x) => !x.ok)?.name || "未知"}`);
        } catch (e) {
          setTtsCheck({ ok: false, error: e.message, stages: [] });
          if (toast) toast(`✗ 自检失败：${e.message}`);
        } finally { setTtsChecking(false); }
      };

      const stageRow = (st) => h("div", {
        key: st.name,
        style: { marginTop: "6px", padding: "6px 8px", borderRadius: "6px", background: st.ok ? "rgba(103,194,58,.10)" : "rgba(192,57,43,.12)" },
      },
        h("div", { style: { fontWeight: 600 } },
          `${st.ok ? "✅" : "❌"} ${st.name === "service" ? "服务" : st.name === "synth" ? "合成" : "发送前置"}`,
          st.ms ? h("span", { style: { fontWeight: 400, opacity: 0.7, marginLeft: "6px" } }, `${st.ms}ms`) : null),
        st.detail ? h("div", { className: "qbw-hint", style: { marginTop: "2px" } }, st.detail) : null,
        st.hint ? h("div", { className: "qbw-hint", style: { marginTop: "2px" } }, `建议：${st.hint}`) : null);

      const act = async (id, action, body) => {
        setBusyId(id);
        setMsg((m) => ({ ...m, [id]: action === "install" ? "开始安装…" : "处理中…" }));
        try {
          await api("/voice/packs/" + action, { method: "POST", body: { id, ...(action === "install" ? { mirror } : {}), ...(body || {}) } });
          if (action === "install") {
            const done = await poll(id);
            setMsg((m) => ({
              ...m,
              [id]: done === "ok"
                ? (id === "voice-cloud"
                  ? "✓ 安装完成 — 下一步：在下方「云端包：密钥与音色」填 AppID / Access Key / 音色 ID，否则启动不了"
                  : "✓ 安装完成")
                : done === "failed" ? "✗ 安装失败：见上方进度条下方的原因"
                  : "⏳ 还在安装（依赖阶段可能要几十分钟）；卡住可以点「取消安装」再来",
            }));
          }
          else setMsg((m) => ({ ...m, [id]: "" }));
          await load();
          if (action === "install" && id === "voice-cloud") {
            // 装完直接滚到密钥表单：新装不预置任何凭据，这一步不做云端包就是死的。
            setTimeout(() => {
              try { document.getElementById("surfcore-cloud-voice-form")?.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
            }, 300);
          }
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
              ? p.install.phase + (p.install.transferPct != null ? ` · 下载 ${p.install.transferPct}%` : "") + ` · 总进度 ${p.install.progress}%`
              : p.running
                ? ((p.external ? "● 运行中（外部目录）" : "● 运行中")
                  + (p.enginePort && p.engineUp === false ? " · ⚠️ 音色引擎未起" : ""))
                : p.installed ? (p.needsCloudConfig ? "○ 已安装 · 待填云端密钥" : "○ 已安装 · 未运行") : "未安装"))),
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
                // 阶段名里已经带百分比时不再拼日志尾，避免出现"下载中 93%…下载中 93%"
                const showTail = tail && !/%/.test(phase);
                return `${phase} · 已 ${mins} 分钟${showTail ? ` · ${tail.slice(-60)}` : ""}`;
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
        p.import && p.import.phase !== "完成" && p.import.phase !== "失败"
          ? h("div", { style: { marginTop: "8px" } },
            h(ProgressBar, { pct: p.import.progress, phase: p.import.phase, indeterminate: p.import.progress < 5 }),
            h("div", { style: { marginTop: "6px" } },
              h(Btn, { kind: "qbw-btn2", onClick: async () => {
                try { await api("/voice/packs/import-cancel", { method: "POST", body: { id: p.id } }); if (toast) toast("正在取消导入…"); await load(); }
                catch (e) { if (toast) toast(`✗ ${e.message}`); }
              } }, "取消导入")))
          : null,
        p.import && p.import.phase === "失败" && p.import.error
          ? h("div", { className: "qbw-err", style: { marginTop: "6px" } }, `导入失败：${p.import.error}`, p.import.hint ? ` — ${p.import.hint}` : "")
          : null,
        p.installed && p.dir ? h("div", { style: { fontSize: "12px", marginTop: "4px", opacity: 0.7 } }, "路径：", h("code", null, p.dir)) : null,
        p.id === "voice-cloud" && p.needsCloudConfig
          ? h("div", { style: { fontSize: "12px", marginTop: "4px", opacity: 0.9, color: "var(--qbw-warn-text)" } },
            "还没有密钥：安装包不预置任何凭据，请到本页下方「云端包：密钥与音色」填 AppID / Access Key / 音色 ID，否则云端语音启动不了。")
          : null,
        p.enginePort && p.running && p.engineUp === false
          ? h("div", { style: { fontSize: "12px", marginTop: "4px", opacity: 0.85 } },
            `本地音色引擎（GPT-SoVITS ${p.enginePort}）还没起来：点「启动」会自动拉起，约 40 秒后再试；期间发语音会失败。`)
          : null,
        h("div", { style: { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap", alignItems: "center" } },
          !p.installed ? h(Btn, { disabled: busyId === p.id, onClick: () => act(p.id, "install") }, "安装（" + fmt(p.sizeBytes) + "）") : null,
          p.install?.phase === "失败" ? h(Btn, { disabled: busyId === p.id, onClick: () => act(p.id, "install", { force: true }) }, "继续下载 / 重试安装") : null,
          h(Btn, { kind: "qbw-btn2", disabled: busyId === "__import" || (p.import && p.import.phase !== "完成" && p.import.phase !== "失败"), onClick: () => startImportFlow(p.id) },
            p.installed ? "重新导入离线包…" : "导入离线包…"),
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
      const voiceCfg = qq?.socialV2?.voice ?? {};
      const voiceTools = qq?.socialV2?.tools ?? {};
      const masterOn = voiceCfg.enabled === true;
      const toolOn = voiceTools.sendVoice === true;
      const setVoiceFlag = (key, value) => {
        if (typeof setQq !== "function") return;
        setQq("socialV2.voice.enabled", value);
      };
      const setVoiceTool = (value) => {
        if (typeof setQq !== "function") return;
        setQq("socialV2.tools.sendVoice", value);
      };
      return h("div", null,
        h("div", { style: { marginTop: "0", marginBottom: "10px", padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(230,162,60,.45)", background: "rgba(230,162,60,.08)" } },
          h("div", { style: { fontSize: "13px", fontWeight: 600 } }, "网络不稳定装不上？用网盘下载离线包（本地包 / 云端包都适用）"),
          h("div", { style: { fontSize: "12px", opacity: 0.85, marginTop: "2px" } },
            "网盘里是完整的离线包。下载解压后，点对应卡片的「导入离线包…」，选择解压出来的 voice-local 或 voice-cloud 文件夹；导入会校验文件、保留旧包备份，失败会告诉你缺什么。"),
          h("div", { style: { fontSize: "12px", opacity: 0.8, marginTop: "2px" } },
            "语音包不参与 SurfCore 的「检查更新」：它是离线运行时/模型/vendor 包，不是代码 zip。需要新版本时用「重新导入离线包…」，导入会保留 config.toml、.venv、models、vendor。"),
          h("div", { style: { marginTop: "8px" } },
            h(Btn, { kind: "qbw-btn2", onClick: onResource }, "获取网盘资源（语音、向量记忆模型）"))),
        h("div", { className: "qbw-card", style: { marginBottom: "10px" } },
          h("h4", null, "语音开关"),
          h("div", { className: "qbw-hint" },
            "两个都要开：总闸控制 AI 能不能发语音，「发语音」工具控制 qq_send_voice 是否出现在工具面。"),
          h("div", { className: "qbw-admin-grid", style: { marginTop: "8px" } },
            h("label", { className: "qbw-admin-field" },
              h("span", null, "启用语音发送（总闸）"),
              h("input", {
                type: "checkbox",
                checked: masterOn,
                disabled: !!busy,
                onChange: (e) => setVoiceFlag("enabled", e.target.checked),
              }),
              h("small", null, masterOn ? "已开" : "已关；不开则 AI 不能发语音")),
            h("label", { className: "qbw-admin-field" },
              h("span", null, "「发语音」工具"),
              h("input", {
                type: "checkbox",
                checked: toolOn,
                disabled: !!busy,
                onChange: (e) => setVoiceTool(e.target.checked),
              }),
              h("small", null, toolOn ? "已开" : "已关；不开则工具面没有 qq_send_voice"))),
          h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
            "⚠️ 两个都开并保存后，必须完全退出 DSH 再打开：MCP 工具列表在进程启动时固定，只刷新页面不会重新注册工具。"),
          h("div", { className: "qbw-actions", style: { marginTop: "8px" } },
            h(Btn, { onClick: () => onSave?.(false), disabled: !!busy }, "保存语音开关"))),
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
                ? h("b", { style: { color: "var(--qbw-ok-text)" } }, "● 已启动")
                : h("b", { style: { color: "var(--qbw-muted)" } }, "○ 未启动")),
            h("span", { style: { fontSize: "13px" } }, "当前：",
              h("b", null, (runningId || pick) === "voice-cloud" ? "云端语音包" : "本地语音包"))),
          switchMsg ? h("div", { style: { fontSize: "12px", marginTop: "6px", opacity: 0.85 } }, switchMsg) : null,
          h("div", { style: { fontSize: "12px", opacity: 0.65, marginTop: "6px" } }, "只能运行一个；切换会自动停掉另一个。")),
        packs.map(card),
        h("div", { className: "qbw-card", style: { marginTop: "10px" } },
          h("h4", null, "语音自检"),
          h("div", { className: "qbw-hint", style: { marginTop: "2px" } },
            "三步分开看：服务是否在跑 → 能不能合成 → 能不能发（不真的发消息）。出问题时把结果发给开发者。"),
          h("div", { className: "qbw-actions", style: { marginTop: "8px" } },
            h(Btn, { onClick: runTtsCheck, disabled: ttsChecking }, ttsChecking ? "检测中…（合成可能要几秒）" : "开始自检")),
          ttsCheck ? h("div", { style: { marginTop: "8px" } },
            (ttsCheck.stages || []).map(stageRow),
            ttsCheck.ok ? null : h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, `route=${ttsCheck.route || "?"} · ${ttsCheck.error || ""}`)
          ) : null),

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

        cloud && cloud.installed ? h(CloudForm, { toast }) : null,

        importPick ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setImportPick(null); } },
          h("div", { className: "qbw-modal" },
            h("h3", null, "确认导入离线包"),
            h("div", { style: { fontSize: "13px", lineHeight: "1.8" } },
              h("div", null, "类型：", h("b", null, importPick.id === "voice-local" ? "本地语音包（voice-local）" : "云端语音包（voice-cloud）")),
              h("div", null, "来源：", h("code", null, importPick.info.sourceDir)),
              h("div", null, "目标：", h("code", null, importPick.info.targetDir || "标准安装目录")),
              h("div", null, "大小：", fmt(importPick.info.sizeBytes)),
              h("div", null, "版本：", importPick.info.version || "—"),
              h("div", null, "完整性：", importPick.info.verified ? "manifest 已校验" : "未验证（没有 manifest 或未声明哈希）")),
            (importPick.info.warnings || []).length
              ? h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
                (importPick.info.warnings || []).map((w, i) => h("div", { key: i }, "⚠️ ", w.message, w.hint ? ` ${w.hint}` : "")))
              : null,
            h("div", { className: "qbw-actions" },
              h(Btn, { kind: "qbw-btn2", onClick: () => setImportPick(null) }, "取消"),
              h(Btn, { onClick: () => submitImport(!importPick.info.verified) },
                importPick.info.verified ? "开始导入" : "仍要导入（未验证）")))
        ) : null,

        importErr ? h(ErrorModal, {
          title: "离线包导入失败",
          message: [
            importErr.code ? `错误代码：${importErr.code}` : "",
            importErr.error || "导入失败",
            (importErr.missing || []).length ? `缺失：${importErr.missing.join("、")}` : "",
          ].filter(Boolean).join("；"),
          hint: importErr.hint || "重新选择目录；如果包不完整，重新下载后再导入。",
          actions: [
            importErr.id ? {
              label: "重新选择目录",
              onClick: () => { const id = importErr.id; setImportErr(null); startImportFlow(id); },
            } : null,
            importErr.id && importErr.code === "IMPORT_TARGET_RUNNING" ? {
              label: "先停止语音包",
              onClick: async () => {
                try {
                  await api("/voice/packs/stop", { method: "POST", body: { id: importErr.id } });
                  const id = importErr.id; setImportErr(null); startImportFlow(id);
                } catch (e) { if (toast) toast(`✗ ${e.message}`); }
              },
            } : null,
          ].filter(Boolean),
          onClose: () => setImportErr(null),
        }) : null,

        importDone ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setImportDone(null); } },
          h("div", { className: "qbw-modal" },
            h("h3", null, "已导入，尚未验证运行"),
            h("div", { style: { fontSize: "13px", lineHeight: "1.8" } },
              h("div", null, "目标：", h("code", null, importDone.targetDir || "")),
              importDone.sourceDir ? h("div", null, "源文件夹仍保留：", h("code", null, importDone.sourceDir)) : null,
              importDone.backupDir ? h("div", null, "旧包备份：", h("code", null, importDone.backupDir)) : null,
              h("div", null, "完整性：", importDone.verified ? "manifest 已校验" : "未验证")),
            h("div", { className: "qbw-hint", style: { marginTop: "8px" } },
              "文件已导入；语音服务能否正常出声还没有验证。请点「启动语音包」后再试一条语音；有旧包备份时，确认新包可用前不要删除。"),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: async () => { setImportDone(null); await act(importDone.id, "start"); } }, "启动语音包"),
              importDone.sourceDir && !importDone.alreadyInPlace
                ? h(Btn, { kind: "qbw-btn2", onClick: () => removeImportedSource(importDone.id, importDone.sourceDir) }, "删除源文件夹")
                : null,
              importDone.backupDir
                ? h(Btn, { kind: "qbw-btn2", onClick: () => removeImportBackup(importDone.id, importDone.backupDir) }, "删除旧备份")
                : null,
              h(Btn, { kind: "qbw-btn2", onClick: () => setImportDone(null) }, "关闭")))
        ) : null,

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

    // ── Embedding 可选安装包（模型 / 运行时 / 云端）────────────────────────
    const CLOUD_PROVIDERS = [
      {
        id: "siliconflow", name: "硅基流动",
        endpoint: "https://api.siliconflow.cn/v1/embeddings",
        model: "BAAI/bge-m3", modelSpace: "bge-m3@1024-cloud-v1", dimension: 1024,
        keyOnce: false,
        vpn: "不需要梯子", price: "bge-m3 价格页显示免费（以官方为准）",
        steps: ["打开 siliconflow.cn 注册/登录。", "控制台 → API 密钥 → 新建，复制 key。", "下面对应字段填入 Endpoint / 模型名 / 模型空间，粘贴 key。", "保存这个服务商 → 顶部单选启用 → 一键启动 runtime + 云端 → 测试服务。"],
        note: "和你本地 bge-m3 是同一个模型；记忆正文会发给硅基流动。",
      },
      {
        id: "zhipu", name: "智谱",
        endpoint: "https://open.bigmodel.cn/api/paas/v4/embeddings",
        model: "embedding-3", modelSpace: "embedding-3@2048-cloud-v1", dimension: 2048,
        keyOnce: true,
        vpn: "不需要梯子", price: "0.5 元 / 百万 tokens",
        steps: ["打开 bigmodel.cn 注册/登录。", "控制台 → API Keys → 创建，复制 key。", "模型空间用 2048 维：embedding-3@2048-cloud-v1。", "保存这个服务商 → 顶部单选启用 → 一键启动 runtime + 云端 → 测试服务。"],
        note: "默认 2048 维；页面不主动传 dimensions，所以不要写 1024。",
      },
      {
        id: "alibaba", name: "阿里云百炼",
        endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings",
        model: "text-embedding-v3", modelSpace: "text-embedding-v3@1024-cloud-v1", dimension: 1024,
        keyOnce: true,
        vpn: "不需要梯子", price: "约 $0.07 / 百万 tokens，有免费额度",
        steps: ["打开 bailian.console.aliyun.com 开通百炼。", "API-KEY 管理 → 创建，复制 key。", "简单用法填上面的旧域名；有业务空间 ID 可换官方新域名。", "如果模型广场只显示 Qwen-Embedding：Endpoint 换 https://maas.qianwenaiapi.com/compatible-mode/v1/embeddings，模型名填 qwen3.7-text-embedding-flash。", "保存这个服务商 → 顶部单选启用 → 一键启动 runtime + 云端 → 测试服务。"],
        note: "v3/v4 默认都是 1024 维；Qwen-Embedding 维度由自检自动识别，模型空间写成 qwen3.7-text-embedding-flash@cloud-v1 即可（不要手写未确认的维度）。",
      },
      {
        id: "openai", name: "OpenAI",
        endpoint: "https://api.openai.com/v1/embeddings",
        model: "text-embedding-3-small", modelSpace: "text-embedding-3-small@1536-cloud-v1", dimension: 1536,
        keyOnce: true,
        vpn: "需要梯子", price: "按量付费，需要海外支付",
        steps: ["打开 platform.openai.com/api-keys。", "创建 API Key，确认账户有余额。", "大陆一般需要梯子才能访问 api.openai.com。", "保存这个服务商 → 顶部单选启用 → 一键启动 runtime + 云端 → 测试服务。"],
        note: "1536 维；记忆正文会出境，普通用户不优先推荐。",
      },
    ];
    const CLOUD_PROVIDER_BY_ID = Object.fromEntries(CLOUD_PROVIDERS.map((item) => [item.id, item]));

    function EmbeddingPackPanel({ unified, setUnified, toast, busy, setBusy }) {
      const [data, setData] = useState(null);
      const [err, setErr] = useState("");
      const [job, setJob] = useState(null);
      const [pathInput, setPathInput] = useState("");
      const [urlInput, setUrlInput] = useState("");
      const [cloud, setCloud] = useState({ endpoint: "https://api.siliconflow.cn/v1/embeddings", model: "BAAI/bge-m3", modelSpace: "bge-m3@1024-cloud-v1", apiKey: "", allowRemote: true });
      const [packTab, setPackTab] = useState("local");
      const [localChoice, setLocalChoice] = useState("");
      const [lastTest, setLastTest] = useState(null);
      const [cloudProvider, setCloudProvider] = useState("siliconflow");
      const [cloudProfiles, setCloudProfiles] = useState({});
      const [cloudActive, setCloudActive] = useState("");
      const cloudLoaded = useRef(false);
      const load = useCallback(async () => {
        try { const r = await api("/embedding-packs"); setData(r); setErr(""); }
        catch (e) { setErr(e.message); }
      }, []);
      useEffect(() => { load(); }, [load]);
      useEffect(() => {
        if (!data?.cloudConfig || cloudLoaded.current) return;
        cloudLoaded.current = true;
        const cfg = data.cloudConfig;
        const profiles = cfg.providers ?? {};
        setCloudProfiles(profiles);
        setCloudActive(cfg.active ?? "");
        const active = cfg.active && profiles[cfg.active] ? profiles[cfg.active] : cfg;
        const matched = CLOUD_PROVIDERS.find((item) => item.endpoint === active.endpoint || item.model === active.model) || CLOUD_PROVIDER_BY_ID.siliconflow;
        setCloudProvider(matched.id);
        setCloud((current) => ({ ...current, ...active, apiKey: "", hasKey: active.hasKey === true, keyMasked: active.keyMasked ?? "" }));
      }, [data]);
      useEffect(() => {
        if (!job || job.state !== "running") return;
        let stopped = false;
        const tick = async () => {
          try {
            const r = await api(`/embedding-packs?job=${encodeURIComponent(job.id)}`);
            if (stopped) return;
            setJob(r.job);
            if (r.job.state !== "running") {
              await load();
              toast(r.job.state === "done" ? `✓ 已安装：${r.job.packId ?? r.job.id}` : `✗ 安装失败：${r.job.error ?? "未知错误"}`);
            }
          } catch (e) {
            if (!stopped) toast(`✗ 安装任务读取失败：${e.message}`);
          }
        };
        const timer = setInterval(tick, 1000);
        tick();
        return () => { stopped = true; clearInterval(timer); };
      }, [job?.id, job?.state, load, toast]);
      const act = async (action, body = {}, doneText = "已更新") => {
        setBusy(`pack-${action}`);
        try {
          const r = await api("/embedding-packs", { method: "POST", body: { action, ...body } });
          if (!r.ok) { toast(`✗ ${r.error ?? r.code ?? "操作失败"}${r.hint ? `；${r.hint}` : ""}`); return; }
          if (action === "install") {
            setJob(r.job);
            toast("开始安装；下载/校验进度会显示在下方");
            return;
          }
          if (action === "test") {
            setLastTest(r.selfTest ? r : null);
            await load();
            toast(r.ok
              ? `✓ 服务可用 · ${r.model ?? ""} · ${r.dimension ?? 0} 维 · ${r.latencyMs ?? 0}ms`
              : `✗ ${r.error ?? "自检失败"}${r.hint ? `；${r.hint}` : ""}`);
            return;
          }
          if (action === "start") {
            const verification = r.verification;
            setLastTest(verification?.selfTest ? verification : null);
            await load();
            toast(r.verified
              ? `✓ runtime 已启动并自检通过 · ${verification?.model ?? ""} · ${verification?.dimension ?? 0} 维 · ${verification?.latencyMs ?? 0}ms`
              : `⚠️ runtime 进程已启动，但自检失败：${verification?.error ?? "未知错误"}`);
            return;
          }
          await load();
          toast(r.needsIndex
            ? `✓ 已选择；该模型还没有索引，请到「向量记忆」点「重建索引」`
            : `✓ ${doneText}`);
        } catch (e) {
          toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally {
          setBusy("");
        }
      };
      const selected = data?.selected ?? "";
      const packs = data?.packs ?? [];
      const runtime = packs.find((pack) => pack.valid && pack.kind === "runtime");
      const models = packs.filter((pack) => pack.valid && pack.kind === "model");
      const installPath = () => {
        if (!pathInput.trim()) { toast("✗ 先填 zip 路径或已解压目录"); return; }
        act("install", { path: pathInput.trim() }, "安装完成");
      };
      const installUrl = () => {
        if (!/^https?:\/\//i.test(urlInput.trim())) { toast("✗ 填 http(s) 下载地址"); return; }
        act("install", { url: urlInput.trim() }, "安装完成");
      };
      const localModels = [
        { id: "bge-small-zh-v1.5", name: "bge-small-zh-v1.5（低配）", file: "bge-small-zh-v1.5.zip", size: "48 MB", dim: 512 },
        { id: "qwen3-embedding-0.6b", name: "Qwen3-Embedding-0.6B", file: "qwen3-embedding-0.6b.zip", size: "639 MB", dim: 1024 },
        { id: "bge-m3", name: "bge-m3", file: "bge-m3.zip", size: "1.2 GB", dim: 1024 },
      ];
      const selectedCloudProvider = CLOUD_PROVIDER_BY_ID[cloudProvider] || CLOUD_PROVIDER_BY_ID.siliconflow;
      const chooseCloudProvider = (id) => {
        const provider = CLOUD_PROVIDER_BY_ID[id];
        if (!provider || id === cloudProvider) return;
        const saved = cloudProfiles[id];
        setCloudProvider(id);
        setCloud((current) => ({
          ...current,
          ...(saved
            ? { ...saved, apiKey: "", hasKey: saved.hasKey === true, keyMasked: saved.keyMasked ?? "" }
            : { endpoint: provider.endpoint, model: provider.model, modelSpace: provider.modelSpace, allowRemote: true, apiKey: "", hasKey: false, keyMasked: "" }),
        }));
      };
      const saveCloudProfile = async () => {
        setBusy("pack-save-cloud");
        try {
          const r = await api("/embedding-packs", { method: "POST", body: { action: "save-cloud", ...cloud, provider: cloudProvider, activate: false } });
          if (!r.ok) { toast(`✗ ${r.error ?? "保存失败"}${r.hint ? `；${r.hint}` : ""}`); return; }
          const profiles = r.config?.providers ?? {};
          setCloudProfiles(profiles);
          setCloudActive(r.config?.active ?? "");
          const saved = profiles[cloudProvider] || {};
          setCloud((current) => ({ ...current, ...saved, apiKey: "", hasKey: saved.hasKey === true, keyMasked: saved.keyMasked ?? "" }));
          toast(`✓ ${selectedCloudProvider.name} 配置已保存；在上方单选里启用它`);
        } catch (e) {
          toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally {
          setBusy("");
        }
      };
      const enableCloudProvider = async (id) => {
        const saved = cloudProfiles[id];
        if (!saved?.hasKey) { toast("✗ 先填 API Key 并点「保存这个服务商」"); return; }
        setBusy("pack-activate-cloud");
        try {
          const r = await api("/embedding-packs", { method: "POST", body: { action: "activate-cloud", provider: id } });
          if (!r.ok) { toast(`✗ ${r.error ?? "启用失败"}${r.hint ? `；${r.hint}` : ""}`); return; }
          setCloudActive(id);
          setCloudProvider(id);
          setCloud((current) => ({ ...current, ...saved, apiKey: "", hasKey: saved.hasKey === true, keyMasked: saved.keyMasked ?? "" }));
          toast(`✓ 已启用 ${CLOUD_PROVIDER_BY_ID[id]?.name ?? id}；点「一键启动 runtime + 云端」生效`);
        } catch (e) {
          toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally {
          setBusy("");
        }
      };
      const shareDir = String(unified?.vectorMemory?.packShareDir ?? "embedding").trim() || "embedding";
      useEffect(() => {
        if (!data) return;
        const ids = localModels.map((model) => model.id);
        setLocalChoice((current) => current || (ids.includes(data.selected) ? data.selected : (data.models?.[0]?.id || "")));
      }, [data]);
      const oneClickLocal = async () => {
        if (!runtime) { toast("✗ 先导入运行时（runtime）"); return; }
        if (!localChoice) { toast("✗ 先选一个本地模型"); return; }
        if (!packs.find((pack) => pack.id === localChoice && pack.valid)) { toast("✗ 这个模型还没导入"); return; }
        setBusy("pack-oneclick");
        try {
          const selected = await api("/embedding-packs", { method: "POST", body: { action: "select", id: localChoice } });
          if (!selected.ok) { toast(`✗ ${selected.error ?? "选择模型失败"}${selected.hint ? `；${selected.hint}` : ""}`); return; }
          const started = await api("/embedding-packs", { method: "POST", body: { action: "start" } });
          if (!started.ok) { toast(`✗ ${started.error ?? "runtime 启动失败"}${started.hint ? `；${started.hint}` : ""}`); return; }
          const verification = started.verification;
          setLastTest(verification?.selfTest ? verification : null);
          await load();
          toast(!started.verified
            ? `⚠️ runtime 已启动，但自检失败：${verification?.error ?? "未知错误"}`
            : selected.needsIndex
              ? `✓ 已启动 runtime + ${localChoice}（自检 ${verification.dimension} 维 ${verification.latencyMs}ms）；该模型还没有索引，请到「向量记忆」点重建索引`
              : `✓ 已启动 runtime + ${localChoice}（自检 ${verification.dimension} 维 ${verification.latencyMs}ms）`);
        } catch (e) {
          toast(`✗ ${e.message}`);
        } finally {
          setBusy("");
        }
      };
      const oneClickCloud = async () => {
        if (!runtime) { toast("✗ 先导入运行时（runtime）"); return; }
        if (!cloud.endpoint.trim() || !cloud.model.trim() || !cloud.modelSpace.trim()) {
          toast("✗ 先填云端 endpoint / 模型名 / 模型空间");
          return;
        }
        if (!cloud.apiKey.trim() && !cloud.hasKey) { toast("✗ 先填云端 API Key"); return; }
        setBusy("pack-oneclick");
        try {
          const saved = await api("/embedding-packs", { method: "POST", body: { action: "save-cloud", ...cloud, provider: cloudProvider, activate: true } });
          if (!saved.ok) { toast(`✗ ${saved.error ?? "云端配置保存失败"}${saved.hint ? `；${saved.hint}` : ""}`); return; }
          setCloudProfiles(saved.config?.providers ?? {});
          setCloudActive(saved.config?.active ?? cloudProvider);
          // cloud endpoint/key 是启动时注入 runtime 的环境变量，已运行的服务必须重启才会换 provider。
          if (data?.service?.ok) {
            const stopped = await api("/embedding-packs", { method: "POST", body: { action: "stop" } });
            if (!stopped.ok) { toast(`✗ ${stopped.error ?? "停止旧 runtime 失败"}${stopped.hint ? `；${stopped.hint}` : ""}`); return; }
          }
          const started = await api("/embedding-packs", { method: "POST", body: { action: "start" } });
          if (!started.ok) { toast(`✗ ${started.error ?? "runtime 启动失败"}${started.hint ? `；${started.hint}` : ""}`); return; }
          const verification = started.verification;
          setLastTest(verification?.selfTest ? verification : null);
          await load();
          toast(!started.verified
            ? `⚠️ runtime 已启动，但云端自检失败：${verification?.error ?? "未知错误"}`
            : `✓ 已启动 runtime + 云端（自检 ${verification.dimension} 维 ${verification.latencyMs}ms）`);
        } catch (e) {
          toast(`✗ ${e.message}`);
        } finally {
          setBusy("");
        }
      };
      const importPackFile = async (file, label) => {
        if (job?.state === "running") { toast("已有安装任务在进行，等它完成再导入"); return; }
        const picked = await browseNative("file", `选择 ${file}`, "embedding-pack");
        if (!picked?.ok) {
          if (!picked?.cancelled) toast(`✗ ${picked?.error ?? "没有选择文件"}`);
          return;
        }
        if (!/\.zip$/i.test(picked.path)) {
          toast(`✗ 请选择 ${file}（zip），不要选已解压目录或其他文件`);
          return;
        }
        if (!confirm(`导入 ${label}？\n\n请选择文件：${file}\n安装前会校验 SHA256；同名包已存在时默认拒绝覆盖。`)) return;
        act("install", { path: picked.path }, "安装完成");
      };
      const packLine = ({ key, title, sub, installed, status, radio, onUse, onStart, onStop }) => h("div", {
        key,
        style: { display: "flex", alignItems: "center", gap: "12px", padding: "10px 0", borderTop: "1px solid var(--dsw-alias-border-l1)" },
      },
        radio || null,
        h("div", { style: { flex: "1 1 auto", minWidth: 0 } },
          h("b", null, title),
          h("div", { className: "qbw-hint" }, sub)),
        h("span", { className: "qbw-chip " + (installed ? "on" : "") }, status),
        h("div", { className: "qbw-actions", style: { marginLeft: "auto", flex: "0 0 auto" } },
          installed && onStart ? h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: onStart }, "启动") : null,
          installed && onStop ? h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: onStop }, "停止") : null,
          installed && onUse ? h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: onUse }, "使用") : null,
          h(Btn, { kind: "qbw-btn2", disabled: !!busy || job?.state === "running", onClick: () => importPackFile(key === "runtime" ? "surfcore-embedding-runtime.zip" : `${key}.zip`, title) }, "导入")));

      return h(Section, { title: "Embedding 功能（可选安装）", note: "模型/运行时不进 SurfCore，按需安装", defaultOpen: true },
        err ? h("div", { className: "qbw-warnbox" }, `安装包状态读取失败：${err}`) : null,
        !data && !err ? h("div", { className: "qbw-hint" }, "安装包状态读取中…") : null,
        data ? h("div", null,
          h("div", { className: "qbw-card" },
            h("div", { className: "qbw-meter-head" },
              h("b", null, "Embedding 总览"),
              h("span", { className: "qbw-chip " + (data.installed ? "on" : "") }, data.installed ? "已安装" : "未安装")),
            h("div", { className: "qbw-hint" }, `服务：${data.service?.ok ? "就绪" : (data.service?.code || "未启动")} · 安装目录：${data.root || "—"}${lastTest ? ` · 最近自检：${lastTest.model ?? ""} ${lastTest.dimension ?? 0} 维 ${lastTest.latencyMs ?? 0}ms` : ""}`),
            h("div", { className: "qbw-actions" },
              h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: () => act("test", {}, "服务可用") }, "测试服务"),
              runtime && data.service?.ok ? h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: () => act("stop", {}, "运行时已停止") }, "停止运行时") : null)),
          !data.installed ? h("div", { className: "qbw-warnbox" },
            "还没有安装 Embedding 包。按顺序导入 runtime + 至少一个模型；不装不影响叙事记忆。") : null,
          !runtime && models.length > 0 ? h("div", { className: "qbw-warnbox" },
            "有模型包但没有运行时包：模型不会启动。先安装 runtime。") : null,
          data.hint ? h("div", { className: "qbw-hint" }, data.hint) : null,
          h("div", { className: "qbw-card", style: { marginTop: "8px" } },
            h("div", { className: "qbw-meter-head" },
              h("b", null, "运行时（runtime）"),
              h("span", { className: "qbw-hint" }, "本地 / 云端共用，先装它")),
            packLine({
              key: "runtime",
              title: "运行时（runtime）",
              sub: runtime ? `已安装 · ${fmtBytes(runtime.sizeBytes || 0)}` : "导入文件：surfcore-embedding-runtime.zip",
              installed: !!runtime,
              status: runtime ? (data.service?.ok ? "运行中" : "已安装") : "未安装",
              onStart: runtime && !data.service?.ok ? () => act("start", {}, "运行时启动中") : null,
              onStop: runtime && data.service?.ok ? () => act("stop", {}, "运行时已停止") : null,
            })),
          job ? (() => {
            const pct = job.phase === "downloading" && job.totalBytes > 0
              ? Math.min(100, Math.round((Number(job.downloadedBytes) || 0) / Number(job.totalBytes) * 100))
              : (Number.isFinite(Number(job.progress)) ? Math.max(0, Math.min(100, Number(job.progress))) : null);
            const phase = job.phase === "downloading" ? "下载中"
              : job.phase === "extracting" ? "解压中"
                : job.phase === "verifying" ? "校验/安装中"
                  : job.phase === "done" ? "安装完成" : (job.phase || "处理中");
            return h("div", { className: "qbw-card", style: { marginTop: "8px" } },
              h("div", { className: "qbw-meter-head" },
                h("b", null, `安装任务${job.state === "running" ? " · 进行中" : job.state === "done" ? " · 完成" : " · 失败"}`),
                h("span", null, pct == null ? "…" : `${pct}%`)),
              h("div", { className: "qbw-meter" + (pct == null ? " indet" : "") },
                h("i", { style: { width: pct == null ? "35%" : `${pct}%` } })),
              h("div", { className: "qbw-hint" },
                `${phase}${job.phase === "downloading" && job.totalBytes > 0 ? ` · ${fmtBytes(job.downloadedBytes)} / ${fmtBytes(job.totalBytes)}` : (job.totalBytes > 0 ? ` · 包大小 ${fmtBytes(job.totalBytes)}` : "")}${job.error ? ` · ${job.error}` : ""}`),
              job.state === "running" ? h("div", { className: "qbw-hint" }, "安装期间请勿重复点「导入」；完成后会自动刷新。") : null);
          })() : null,
          h("div", { className: "qbw-tabs", style: { marginTop: "8px" } },
            h("button", { className: "qbw-tab" + (packTab === "local" ? " on" : ""), onClick: () => setPackTab("local") }, "本地模型"),
            h("button", { className: "qbw-tab" + (packTab === "cloud" ? " on" : ""), onClick: () => setPackTab("cloud") }, "云端模型")),
          packTab === "local" ? h("div", null,
            h("div", { className: "qbw-actions", style: { marginTop: "8px" } },
              h(Btn, { kind: "qbw-btn2", disabled: !!busy || !localChoice, onClick: oneClickLocal }, "一键启动 runtime + 选中模型"),
              h("span", { className: "qbw-hint" }, localChoice ? `已选：${localChoice}` : "先选一个模型")),
          h("div", { className: "qbw-card", style: { marginTop: "10px" } },
            h("div", { className: "qbw-meter-head" },
              h("b", null, "包清单"),
              h("span", { className: "qbw-hint" }, `网盘目录：${shareDir}`)),
            localModels.map((model) => {
              const pack = packs.find((item) => item.id === model.id && item.valid);
              return packLine({
                key: model.id,
                title: model.name,
                sub: `导入文件：${model.file} · ${model.dim} 维 · ${model.size}${pack?.indexReady ? ` · 索引 ${pack.indexed ?? 0} 条` : " · 索引未建"}`,
                installed: !!pack,
                status: selected === model.id ? "使用中" : (pack ? "已安装" : "未安装"),
                radio: h("input", {
                  type: "radio",
                  name: "embedding-local-model",
                  checked: localChoice === model.id,
                  disabled: !pack || !!busy,
                  onChange: () => setLocalChoice(model.id),
                  title: pack ? `选择 ${model.name}` : "先导入这个模型",
                }),
              });
            }),
            h("div", { className: "qbw-hint", style: { marginTop: "6px" } }, "运行时在上方单独导入；这里只导入模型 zip；不要解压到 SurfCore 安装目录。")),
          ) : h("div", null,
            h("div", { className: "qbw-actions", style: { marginTop: "8px" } },
              h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: oneClickCloud }, "一键启动 runtime + 云端"),
              h("span", { className: "qbw-hint" }, "先填下面的 provider 配置")),
            h("div", { className: "qbw-card", style: { marginTop: "10px" } },
              h("b", null, "云端模型"),
              h("div", { className: "qbw-warnbox" }, "云端会把记忆正文发给服务商，并按量计费；不想出机就继续用本地模型。"),
              h("div", { className: "qbw-group", style: { marginTop: "8px" } }, "启用哪个服务商"),
              h("div", { className: "qbw-actions", style: { flexWrap: "wrap", marginTop: "2px" } },
                CLOUD_PROVIDERS.map((provider) => h("label", { key: provider.id, className: "qbw-row", style: { alignItems: "center", gap: "4px", marginRight: "12px" } },
                  h("input", {
                    type: "radio", name: "cloud-provider",
                    checked: cloudActive === provider.id,
                    disabled: !cloudProfiles[provider.id]?.hasKey,
                    onChange: () => enableCloudProvider(provider.id),
                  }),
                  h("span", null, provider.name)))),
              h("div", { className: "qbw-tabs", style: { marginTop: "6px" } },
                CLOUD_PROVIDERS.map((provider) => h("button", {
                  key: provider.id,
                  className: "qbw-tab" + (cloudProvider === provider.id ? " on" : ""),
                  onClick: () => chooseCloudProvider(provider.id),
                }, provider.name))),
              h("div", { className: "qbw-hint" },
                `${selectedCloudProvider.vpn} · ${selectedCloudProvider.price} · ${selectedCloudProvider.dimension} 维`),
              selectedCloudProvider.keyOnce ? h("div", { className: "qbw-warnbox" },
                "提醒：这个服务商的 API Key 通常只在创建时显示一次；页面一关就看不到，只能重新创建。创建后先粘贴到这里并点「保存这个服务商」，再关控制台。") : null,
              h(Row, { label: "Endpoint", hint: "服务商文档里的完整 embeddings 地址，通常以 /v1/embeddings 结尾" },
                h("input", { className: "qbw-input", style: { width: "460px" }, value: cloud.endpoint, onChange: (e) => setCloud({ ...cloud, endpoint: e.target.value }), placeholder: "https://api.example.com/v1/embeddings" })),
              h(Row, { label: "云端模型名", hint: "服务商文档里的 embedding 模型 ID，不同服务商不一样" },
                h("input", { className: "qbw-input", style: { width: "360px" }, value: cloud.model, onChange: (e) => setCloud({ ...cloud, model: e.target.value }) })),
              h(Row, { label: "云端模型空间", hint: "给云端索引起独立名字，不能和本地共用；换服务商或维度要改" },
                h("input", { className: "qbw-input", style: { width: "360px" }, value: cloud.modelSpace, onChange: (e) => setCloud({ ...cloud, modelSpace: e.target.value }) })),
              h(Row, { label: "API Key", hint: "只存本机；留空 = 保留已保存的 key，不会回显" },
                h("input", { className: "qbw-input", type: "password", style: { width: "360px" }, value: cloud.apiKey, onChange: (e) => setCloud({ ...cloud, apiKey: e.target.value }), placeholder: cloud.hasKey ? `已保存 ${cloud.keyMasked}` : "sk-…" })),
              h(Row, { label: "允许远程 provider", hint: "云端通常必须打开；只有本机代理才可关" },
                h("input", { className: "qbw-switch", type: "checkbox", checked: cloud.allowRemote === true, onChange: (e) => setCloud({ ...cloud, allowRemote: e.target.checked }) })),
              h("details", { className: "qbw-card", style: { marginTop: "8px" } },
                h("summary", null, `${selectedCloudProvider.name} 配置步骤`),
                h("div", { className: "qbw-hint", style: { lineHeight: 1.7 } },
                  h("ol", { style: { margin: "6px 0 0 18px" } }, selectedCloudProvider.steps.map((step, index) => h("li", { key: index }, step))),
                  h("p", null, selectedCloudProvider.note),
                  h("p", null, "通用：先「保存这个服务商」→ 顶部单选启用 → 一键启动 → 测试服务；自检通过后，去「向量记忆」点单模型「重建索引」。云端索引不要和本地共用 modelSpace。"))),
              h("div", { className: "qbw-actions" },
                h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: saveCloudProfile }, "保存这个服务商"),
                h(Btn, { kind: "qbw-btn2", disabled: !!busy || !cloudProfiles[cloudProvider]?.hasKey, onClick: () => enableCloudProvider(cloudProvider) }, "启用这个服务商"),
                h("span", { className: "qbw-hint" }, cloudActive ? `当前启用：${CLOUD_PROVIDER_BY_ID[cloudActive]?.name ?? cloudActive}` : "尚未启用云端服务商")))),
          h("details", { className: "qbw-card", style: { marginTop: "10px" } },
            h("summary", null, "高级：网盘链接 / 手动安装"),
            h(Row, { label: "网盘链接", hint: "支持带提取码的分享链接；顶部按钮用它打开默认浏览器" },
              h("input", {
                className: "qbw-input", style: { width: "520px" },
                value: String(unified?.vectorMemory?.packShareUrl ?? ""),
                placeholder: "https://pan.quark.cn/s/…?pwd=…",
                onChange: (e) => setUnified?.(["vectorMemory", "packShareUrl"], e.target.value),
              })),
            h(Row, { label: "提取码", hint: "只用于显示；链接里带 pwd 时可留空" },
              h("input", {
                className: "qbw-input", style: { width: "140px" },
                value: String(unified?.vectorMemory?.packSharePassword ?? ""),
                placeholder: "例如 4AGf",
                onChange: (e) => setUnified?.(["vectorMemory", "packSharePassword"], e.target.value),
              })),
            h(Row, { label: "网盘目录名", hint: "只影响界面提示" },
              h("input", {
                className: "qbw-input", style: { width: "180px" },
                value: String(unified?.vectorMemory?.packShareDir ?? "embedding"),
                placeholder: "embedding",
                onChange: (e) => setUnified?.(["vectorMemory", "packShareDir"], e.target.value),
              })),
            h(Row, { label: "手动安装 zip/目录", hint: "高级入口；普通用户用每行右侧「导入」" },
              h("div", { className: "qbw-actions" },
                h("input", { className: "qbw-input", style: { width: "420px" }, value: pathInput, onChange: (e) => setPathInput(e.target.value), placeholder: "D:\\packs\\bge-small.zip" }),
                h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: installPath }, "安装"))),
            h(Row, { label: "下载地址", hint: "只接受 http(s)；安装前校验 SHA256" },
              h("div", { className: "qbw-actions" },
                h("input", { className: "qbw-input", style: { width: "420px" }, value: urlInput, onChange: (e) => setUrlInput(e.target.value), placeholder: "https://…/bge-small.zip" }),
                h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: installUrl }, "下载并安装"))),
            h(Row, { label: "Embedding 发现文件", hint: "留空 = %USERPROFILE%\\.dsh\\surfcore\\embedding-service.json；外部服务才需要改" },
              h("input", {
                className: "qbw-input", style: { width: "420px" },
                value: String(unified?.vectorMemory?.discoveryFile ?? ""),
                placeholder: "%USERPROFILE%\\.dsh\\surfcore\\embedding-service.json",
                onChange: (e) => setUnified?.(["vectorMemory", "discoveryFile"], e.target.value),
              })),
            h("div", { className: "qbw-actions" },
              h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: () => act("refresh", {}, "已刷新") }, "刷新"))))
        : null);

    }

    function MemoryTab({ qq, unified, setUnified, overview, busy, setBusy, toast, reload, onResource }) {
      const [data, setData] = useState(null);
      const [card, setCard] = useState(null);
      const [vectorData, setVectorData] = useState(null);
      const [vectorErr, setVectorErr] = useState("");
      const [library, setLibrary] = useState(null);
      const [libraryQuery, setLibraryQuery] = useState("");
      const [libraryBusy, setLibraryBusy] = useState("");
      const [libraryErr, setLibraryErr] = useState("");
      const [indexPickerOpen, setIndexPickerOpen] = useState(false);
      const [indexCandidates, setIndexCandidates] = useState([]);
      const [indexSelected, setIndexSelected] = useState([]);
      const [indexBuildErr, setIndexBuildErr] = useState("");
      const [fullVersion, setFullVersion] = useState(0);
      const [err, setErr] = useState("");
      const [pane, setPane] = useState(() => (unified?.memory?.mode === "vector" ? "vector" : "narrative"));
      const [usageOpen, setUsageOpen] = useState(false);
      const [usageTab, setUsageTab] = useState("local");
      const [usageCloudProvider, setUsageCloudProvider] = useState("siliconflow");
      const load = useCallback(async () => {
        try { const r = await api("/memory"); setData(r); setErr(""); } catch (e) { setErr(e.message); }
      }, []);
      const loadCard = useCallback(async () => {
        try { const r = await api("/memory-card"); setCard(r); } catch (e) { setErr(e.message); }
      }, []);
      const loadVector = useCallback(async () => {
        try { const r = await api("/vector-memory"); setVectorData(r); setVectorErr(""); } catch (e) { setVectorErr(e.message); }
      }, []);
      useEffect(() => { load(); loadCard(); loadVector(); }, [load, loadCard, loadVector]);
      const actVector = async (action) => {
        setBusy(`vector-${action}`);
        try {
          const r = await api("/vector-memory", { method: "POST", body: { action } });
          toast(r.ok ? (action === "rebuild" ? `✓ ${r.rebuilt ? "重建完成" : "已重建一批"}：已编码 ${r.embedded ?? 0} 条，待编码 ${r.status?.pending ?? 0} 条` : `✓ 已整理：新增 ${r.added ?? 0}，编码 ${r.embedded ?? 0}，待编码 ${r.status?.pending ?? 0}`)
            : `✗ ${r.code ?? "整理失败"}：${r.error ?? ""}${r.hint ? `；${r.hint}` : ""}`);
          await loadVector();
          await reload();
        } catch (e) {
          toast(`✗ ${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally {
          setBusy("");
        }
      };
      const openIndexPicker = async () => {
        setBusy("vector-index-picker");
        setIndexBuildErr("");
        try {
          const status = await api("/embedding-packs");
          const localDefs = [
            { id: "bge-small-zh-v1.5", name: "bge-small-zh-v1.5（低配）" },
            { id: "qwen3-embedding-0.6b", name: "Qwen3-Embedding-0.6B" },
            { id: "bge-m3", name: "bge-m3" },
          ];
          const localItems = localDefs.map((def) => {
            const pack = (status.models ?? []).find((item) => item.id === def.id && item.valid);
            return {
              key: `local:${def.id}`, kind: "local", id: def.id, name: def.name,
              available: Boolean(pack), indexReady: pack?.indexReady === true, indexed: pack?.indexed ?? 0,
              detail: pack ? `本地 · ${pack.modelSpace}` : "本地 · 未安装",
            };
          });
          const cloudItems = CLOUD_PROVIDERS.map((provider) => {
            const profile = status.cloudConfig?.providers?.[provider.id];
            return {
              key: `cloud:${provider.id}`, kind: "cloud", id: provider.id, name: provider.name,
              available: Boolean(profile?.hasKey && profile?.endpoint && profile?.model),
              indexReady: profile?.indexReady === true, indexed: profile?.indexed ?? 0,
              detail: profile?.modelSpace ? `云端 · ${profile.modelSpace}` : "云端 · 未配置",
            };
          });
          const candidates = [...localItems, ...cloudItems];
          setIndexCandidates(candidates);
          setIndexSelected(candidates.filter((item) => item.available && !item.indexReady).map((item) => item.key));
          setIndexPickerOpen(true);
        } catch (e) {
          toast(`✗ 读取模型状态失败：${e.message}`);
        } finally {
          setBusy("");
        }
      };
      const toggleIndexCandidate = (key) => {
        setIndexSelected((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
      };
      const buildSelectedIndexes = async () => {
        if (!indexSelected.length) { setIndexBuildErr("至少勾选一个模型"); return; }
        setBusy("vector-build-selected");
        setIndexBuildErr("");
        try {
          const r = await api("/vector-memory", { method: "POST", body: { action: "rebuild-selected", models: indexSelected } });
          const done = (r.results ?? []).filter((item) => item.ok).map((item) => item.model || item.id);
          const failed = (r.results ?? []).filter((item) => !item.ok);
          if (failed.length) {
            setIndexBuildErr(`部分失败：${failed.map((item) => `${item.model || item.id}（${item.error || "失败"}）`).join("；")}`);
          } else {
            setIndexPickerOpen(false);
            toast(`✓ 已重建：${done.join("、") || "完成"}`);
          }
          await loadVector();
          await reload();
        } catch (e) {
          setIndexBuildErr(`${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally {
          setBusy("");
        }
      };
      const loadLibrary = async () => {
        setLibraryBusy("list");
        setLibraryErr("");
        try {
          const r = await api("/vector-memory", { method: "POST", body: { action: "library-list", limit: 30 } });
          setLibrary({ ...r, mode: "list" });
        } catch (e) {
          setLibraryErr(`${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally {
          setLibraryBusy("");
        }
      };
      const searchLibrary = async () => {
        const query = libraryQuery.trim();
        if (!query) { setLibraryErr("先输入一句话再搜"); return; }
        setLibraryBusy("search");
        setLibraryErr("");
        try {
          const r = await api("/vector-memory", { method: "POST", body: { action: "library-search", query, limit: 20 } });
          setLibrary({ ...r, items: r.hits ?? [], mode: "search" });
        } catch (e) {
          setLibraryErr(`${e.message}${e.hint ? `；${e.hint}` : ""}`);
        } finally {
          setLibraryBusy("");
        }
      };
      const memoryMode = unified?.memory?.mode === "vector" ? "vector" : "narrative";
      const vector = vectorData ?? overview?.vectorMemory ?? {};
      // 服务端配置异步加载完成后，让 tab 跟随当前“记忆方式”；用户手动切 tab 不会被覆盖。
      useEffect(() => { setPane(memoryMode); }, [memoryMode]);
      const vectorConfig = unified?.vectorMemory ?? {};
      const vectorServiceOk = vector?.service?.ok !== false;
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
      const memoryPanes = [["narrative", "叙事记忆"], ["vector", "向量记忆"]];
      const usageProvider = CLOUD_PROVIDER_BY_ID[usageCloudProvider] || CLOUD_PROVIDER_BY_ID.siliconflow;
      return h("div", null,
        h(Section, { title: "记忆方式", note: "读取哪一套；两套存储都继续写入" },
          h(Row, { label: "当前使用", hint: "切换只影响读取/注入；不会停止任何一边的存储" },
            h("select", {
              className: "qbw-input",
              value: memoryMode,
              onChange: (e) => {
                const next = e.target.value === "vector" ? "vector" : "narrative";
                setUnified(["memory", "mode"], next);
                setPane(next);
              },
            },
            h("option", { value: "narrative" }, "叙事记忆（衰减卡 + 全量卡）"),
            h("option", { value: "vector" }, "向量记忆（按当前消息检索）"))),
          h("div", { className: "qbw-hint" }, "叙事记忆与向量记忆是两套独立存储；切换只改读取/注入，不会停止任何一边的写入。")),
        h("div", { className: "qbw-tabs", style: { marginTop: "8px" } },
          memoryPanes.map(([id, label]) => h("button", {
            key: id,
            className: "qbw-tab" + (pane === id ? " on" : ""),
            onClick: () => setPane(id),
          }, label))),
        pane === "vector"
          ? h("div", null,
        h("div", { className: "qbw-actions", style: { marginBottom: "8px" } },
          h(Btn, { kind: "qbw-btn2", onClick: () => setUsageOpen(true) }, "使用说明"),
          h(Btn, { kind: "qbw-btn2", onClick: onResource }, "获取网盘资源（语音、向量记忆模型）")),
        h(Section, { title: "向量记忆", note: "状态 / 存储 / 维护" },
          h(Row, { label: "启用向量存储", hint: "关掉 = 不再摄取/编码；两套存储独立，不影响叙事记忆" },
            h("input", {
              className: "qbw-switch", type: "checkbox",
              checked: vectorConfig.enabled !== false,
              onChange: (e) => setUnified(["vectorMemory", "enabled"], e.target.checked),
            })),
          memoryMode !== "vector" ? h("div", { className: "qbw-warnbox" },
            "当前记忆方式是叙事记忆：向量索引会继续维护，但唤醒时不会读取。把上方「当前使用」切到「向量记忆」后才会注入旧事。") : null,
          h("div", { className: "qbw-hint" }, "两套存储独立：叙事记忆继续写记忆卡/全量卡；向量记忆继续写自己的 vector-memory.jsonl 与索引。"),
          h("div", { className: "qbw-kv" }, h("span", null, "向量存储"), h("span", null,
            vector.enabled === false ? "已关闭（设置里可开）" : `${vector.records ?? 0} 条 · 已索引 ${vector.indexed ?? 0} · 待编码 ${vector.pending ?? 0}`)),
          h("div", { className: "qbw-kv" }, h("span", null, "Embedding 服务"), h("span", null,
            vectorServiceOk ? `${vector.provider === "cloud" ? "云端" : "本地"} · ${vector.model ?? "—"} · ${vector.modelSpace ?? ""}` : `不可用 · ${vector.service?.error ?? "未配置"}`)),
          vector.pending > 0 ? h("div", { className: "qbw-hint" }, `还有 ${vector.pending} 条待编码；后台会自动续跑（有积压约 30 秒一轮），不用手动。`) : null,
          !vectorServiceOk ? h("div", { className: "qbw-warnbox" }, "向量记忆暂不可用：到下方「Embedding 功能」启动 runtime，或检查模型/发现文件设置。") : null,
          h("div", { className: "qbw-actions" },
            h(Btn, { kind: "qbw-btn2", onClick: () => actVector("maintain"), disabled: !!busy }, busy === "vector-maintain" ? "整理中…" : "立即整理"),
            h(Btn, { kind: "qbw-btn2", onClick: () => actVector("rebuild"), disabled: !!busy }, busy === "vector-rebuild" ? "重建中…" : "重建索引"),
            h(Btn, { kind: "qbw-btn2", onClick: openIndexPicker, disabled: !!busy }, busy === "vector-index-picker" ? "读取中…" : busy === "vector-build-selected" ? "建索引中…" : "为多个模型重建索引")),
          h("details", { className: "qbw-card", style: { marginTop: "10px" },
            onToggle: (e) => { if (e.currentTarget.open && !library && !libraryBusy) loadLibrary(); } },
            h("summary", null, `记忆库（${vector.records ?? 0} 条）`),
            h("div", { className: "qbw-hint" }, "只读预览；默认不展示敏感记录。"),
            h("div", { className: "qbw-actions", style: { marginTop: "6px" } },
              h("input", {
                className: "qbw-input", style: { width: "360px" },
                value: libraryQuery,
                placeholder: "输入一句话，找最像的旧事…",
                onChange: (e) => setLibraryQuery(e.target.value),
                onKeyDown: (e) => { if (e.key === "Enter") searchLibrary(); },
              }),
              h(Btn, { kind: "qbw-btn2", disabled: !!libraryBusy, onClick: searchLibrary }, libraryBusy === "search" ? "搜索中…" : "语义搜索"),
              h(Btn, { kind: "qbw-btn2", disabled: !!libraryBusy, onClick: loadLibrary }, libraryBusy === "list" ? "读取中…" : "最近记录")),
            libraryErr ? h("div", { className: "qbw-warnbox", style: { marginTop: "6px" } }, libraryErr) : null,
            library ? h("div", null,
              h("div", { className: "qbw-hint", style: { marginTop: "6px" } },
                library.mode === "search"
                  ? `「${library.query}」命中 ${library.items?.length ?? 0} 条；当前索引 ${library.total ?? 0} 条`
                  : `共 ${library.total ?? 0} 条；显示最近 ${library.items?.length ?? 0} 条${Number(library.total) > Number(library.visible) ? `；已隐藏 ${Number(library.total) - Number(library.visible)} 条敏感记录` : ""}`),
              (library.items ?? []).map((item) => h("div", { key: item.id, className: "qbw-card", style: { marginTop: "6px", padding: "8px 10px" } },
                h("div", { className: "qbw-kv" },
                  h("span", null, `${fmtTime(item.createdAt)} · ${item.platform === "bili" ? "B站" : item.platform === "pet" ? "桌宠" : item.platform === "qq" ? "QQ" : (item.platform || "未知")}${item.source ? ` · ${item.source}` : ""}`),
                  library.mode === "search" ? h("span", null, `相似度 ${Math.round((Number(item.score) || 0) * 100)}%`) : null),
                h("div", { style: { whiteSpace: "pre-wrap", lineHeight: 1.55, marginTop: "2px" } }, item.text))),
              !(library.items ?? []).length ? h("div", { className: "qbw-hint" }, "没有可显示的记录。") : null,
              library.mode === "search" && (library.items ?? []).length ? h("div", { className: "qbw-hint" }, "相似度是语义相近程度，不是事实确认；点「最近记录」可回到时间线。") : null)
              : null),
          vectorErr ? h("div", { className: "qbw-warnbox" }, `向量状态读取失败：${vectorErr}`) : null),
                      h(EmbeddingPackPanel, { unified, setUnified, toast, busy, setBusy }),)
          : h("div", null,
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
            ),
        indexPickerOpen ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setIndexPickerOpen(false); } },
          h("div", { className: "qbw-modal", style: { maxWidth: "680px", maxHeight: "86vh", overflowY: "auto" } },
            h("h3", null, "为多个模型重建索引"),
            h("p", { className: "qbw-hint" }, "可多选本地模型和云端服务商；已有索引会标注「（已有索引）」，默认不勾选。"),
            ["local", "cloud"].map((kind) => {
              const items = indexCandidates.filter((item) => item.kind === kind);
              const rows = items.map((item) => h("label", { key: item.key, className: "qbw-card", style: { display: "flex", gap: "8px", alignItems: "flex-start", marginTop: "6px", padding: "8px 10px", cursor: item.available ? "pointer" : "not-allowed" } },
                h("input", {
                  type: "checkbox", checked: indexSelected.includes(item.key), disabled: !item.available || !!busy,
                  onChange: () => toggleIndexCandidate(item.key),
                  style: { marginTop: "3px" },
                }),
                h("div", { style: { flex: "1 1 auto" } },
                  h("div", null, `${item.name}${item.indexReady ? `（已有索引${item.indexed ? ` ${item.indexed} 条` : ""}）` : (item.available ? "（未建索引）" : (kind === "local" ? "（未安装）" : "（未配置）"))}`),
                  h("div", { className: "qbw-hint" }, item.detail))));
              return h("div", { key: kind, style: { marginTop: "10px" } },
                h("b", null, kind === "local" ? "本地模型" : "云端服务商"),
                rows);
            }),
            indexBuildErr ? h("div", { className: "qbw-warnbox", style: { marginTop: "8px" } }, indexBuildErr) : null,
            h("div", { className: "qbw-actions", style: { marginTop: "10px" } },
              h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: () => setIndexPickerOpen(false) }, "取消"),
              h(Btn, { kind: "qbw-btn2", disabled: !!busy, onClick: () => setIndexSelected(indexCandidates.filter((item) => item.available && !item.indexReady).map((item) => item.key)) }, "只选未建索引"),
              h(Btn, { disabled: !!busy || !indexSelected.length, onClick: buildSelectedIndexes }, busy === "vector-build-selected" ? "重建中…" : "开始重建")))) : null,
        usageOpen ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setUsageOpen(false); } },
          h("div", { className: "qbw-modal", style: { maxWidth: "720px", maxHeight: "86vh", overflowY: "auto" } },
            h("h3", null, "向量记忆使用说明（人话版）"),
            h("p", { className: "qbw-hint" }, "按这个顺序做，不需要懂向量或 Embedding。"),
            h("div", { className: "qbw-card", style: { marginTop: "8px", lineHeight: 1.7 } },
              h("b", null, "向量记忆是什么"),
              h("p", null, "把每条记忆按“意思”存成一组坐标；以后用一句话去找，不要求关键词和原文完全一样。"),
              h("b", null, "和叙事记忆相比"),
              h("ul", { style: { margin: "4px 0 0 18px" } },
                h("li", null, "叙事记忆像整理好的日记摘要：稳定、好读，适合看最近发生了什么、关系怎么变。"),
                h("li", null, "向量记忆像按意思翻旧账：记忆很多时也能捞出语义相近的细节，适合“我记得你说过类似的话”。")),
              h("p", { className: "qbw-hint" }, "优点：不用背关键词、记忆多了也能找、和叙事记忆同时保存互不冲突。"),
              h("p", { className: "qbw-hint" }, "注意：相似不等于事实，命中后仍要判断；敏感记录不会显示，也不会被注入。")),
            h("div", { className: "qbw-tabs" },
              h("button", { className: "qbw-tab" + (usageTab === "local" ? " on" : ""), onClick: () => setUsageTab("local") }, "本地模型"),
              h("button", { className: "qbw-tab" + (usageTab === "cloud" ? " on" : ""), onClick: () => setUsageTab("cloud") }, "云端模型")),
            usageTab === "local" ? h("div", null,
              h("div", { className: "qbw-card", style: { marginTop: "8px", lineHeight: 1.65 } },
                h("b", null, "索引是什么"),
                h("p", null, "每条记忆先被模型算成一串“语义坐标”，存在索引里；搜索时先查坐标，不逐条翻原文。没有索引就只能看条数，不能找相似旧事。"),
                h("b", null, "新记忆：全自动，不用手点"),
                h("p", null, "新记忆先标成“待编码”，后台会自动补索引：有积压时约 30 秒一轮，没积压时 10 分钟检查一次。只要 runtime 在跑，就不需要你手动整理。"),
                h("b", null, "「立即整理」和「重建索引」的区别"),
                h("p", null, "「立即整理」只编码还没索引的新记忆，便宜；「重建索引」把当前模型下全部记忆重算一遍，很慢，只在换到还没有索引的模型、索引损坏或索引丢失时用。"),
                h("b", null, "本地和云端模型"),
                h("p", null, "每个模型有自己的一套索引；「为多个模型重建索引」会弹窗让你多选本地/云端模型。已有索引的会标注「（已有索引）」并默认不勾选；勾了就会重建，没勾的跳过。这个操作耗时很长，只在你确实需要多个模型时点。")),
              h("ol", { style: { lineHeight: 1.7, margin: "8px 0 0 18px" } },
                h("li", null, "下载：先拿 surfcore-embedding-runtime.zip，再拿至少一个模型 zip（bge-m3 稳，bge-small 省资源）。"),
                h("li", null, "打开 设置 → 记忆 → 向量记忆 →「Embedding 功能」→「本地模型」。"),
                h("li", null, "先点 runtime 那行的「导入」，选 runtime zip；再点模型那行的「导入」，选模型 zip。"),
                h("li", null, "选中一个模型，点「一键启动 runtime + 选中模型」，等到提示自检维度 / 延迟。"),
                h("li", null, "回到「向量记忆」：如果当前模型还没有索引（或刚导入模型），点一次「重建索引」；runtime 在跑时，新记忆会自动补，不用每次重建。"),
                h("li", null, "最上方「记忆方式」选「向量记忆」，再点底部「保存并生效」。"),
                h("li", null, "验证：展开「记忆库」看最近记录 / 语义搜索；QQ 或 B站聊一句，看会不会出现旧事。"),
                h("li", null, "失败：先看红字提示；runtime 没启动就先启动，没有索引就先重建；还不行把提示原文发开发者。")))
              : h("div", null,
                h("div", { className: "qbw-card", style: { marginTop: "8px", lineHeight: 1.65 } },
                  h("b", null, "云端模型适合谁"),
                  h("p", null, "不想下载几十 MB～1GB 本地模型，或者机器跑不动本地模型的人。需要一个支持 embeddings 的服务商账号和 API Key；按量计费，记忆正文会发给服务商。"),
                  h("b", null, "四个服务商怎么选"),
                  h("p", null, "硅基流动最省事、不要梯子；智谱便宜稳定；阿里云百炼是大厂且有免费额度；OpenAI 需要梯子和海外支付，普通用户不优先。")),
                h("div", { className: "qbw-tabs", style: { marginTop: "8px" } },
                  CLOUD_PROVIDERS.map((provider) => h("button", {
                    key: provider.id,
                    className: "qbw-tab" + (usageCloudProvider === provider.id ? " on" : ""),
                    onClick: () => setUsageCloudProvider(provider.id),
                  }, provider.name))),
                h("div", { className: "qbw-card", style: { marginTop: "8px", lineHeight: 1.7 } },
                  h("b", null, `${usageProvider.name} · ${usageProvider.vpn}`),
                  h("p", { className: "qbw-hint" }, `${usageProvider.price} · 默认 ${usageProvider.dimension} 维`),
                  h("ol", { style: { margin: "6px 0 0 18px" } }, usageProvider.steps.map((step, index) => h("li", { key: index }, step))),
                  h("p", null, usageProvider.note),
                  usageProvider.keyOnce ? h("div", { className: "qbw-warnbox" },
                    "这个服务商的 Key 通常只显示一次：创建后立刻粘贴到「云端模型」并保存，关掉控制台就看不到了，只能重新创建。") : null,
                  h("div", { className: "qbw-kv" }, h("span", null, "Endpoint"), h("span", null, usageProvider.endpoint)),
                  h("div", { className: "qbw-kv" }, h("span", null, "模型名"), h("span", null, usageProvider.model)),
                  h("div", { className: "qbw-kv" }, h("span", null, "模型空间"), h("span", null, usageProvider.modelSpace)),
                  h("p", { className: "qbw-hint" }, "云端索引可以点「为多个模型重建索引」，在弹出的列表里勾选对应云端服务商；也可以选中云端后单独用「重建索引」。"))),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: () => setUsageOpen(false) }, "知道了")))) : null,
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
          style: { width: "min(620px, 92vw)", maxHeight: "80vh", overflow: "auto", background: "var(--qbw-surface)", color: "var(--qbw-text)", border: "1px solid var(--qbw-line)", borderRadius: "10px", padding: "16px 18px", boxShadow: "0 24px 70px rgba(0,0,0,.35)" },
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

    function TokenTab({ budget, limits, onChange, disabled, alertedToday, onSave, busy, toast, set, setUnified, qq, unified }) {
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
        h(SaveTokenEntry, { set, setUnified, qq, unified, toast }),
        h(CostCard, { toast, set }),
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
              const r0 = await api("/pet/install", {
                method: "POST",
                body: {
                  source: form.source.trim(),
                  appDir: form.appDir.trim(),
                  electronPath: form.electronPath.trim(),
                },
              }).catch((e) => ({ ok: false, error: e.message }));
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
            st && st.installed && !st.running ? h(Btn, {
              onClick: () => act("start", { electronPath: form.electronPath.trim() }),
              disabled: !!busy,
            }, "启动") : null,
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
          h("div", { className: "qbw-hint", style: { marginTop: "4px" } },
            "Windows 请填**带盘符**的完整路径（例如 D:\dshwork\pet）；只写 /dshwork/pet 会被装到当前盘。"),
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
          h(Row, { label: "把桌宠对话写进记忆", hint: "同时写入叙事记忆与向量记忆（两套存储各自继续）；关掉就只留在聊天记录里" },
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
      // 加载时的配置版本戳：保存时回传，防止把别人刚改的配置整份覆盖（2026-10-29）
      const [configStamps, setConfigStamps] = useState(null);
      const [bili, setBili] = useState(null);
      const [unified, setUnified] = useState(null);
      const [saved, setSaved] = useState("");
      const [busy, setBusy] = useState("");
      // 关闭温柔模式时用户选择“同时丢弃上下文”：保存时一并重置 QQ 会话，并自动重启桥接。
      const [adminDiscardContext, setAdminDiscardContext] = useState(false);
      // 浮层文案（字符串）。真正的通知函数叫 notify —— 两者别同名，否则会被误当函数传（2026-10-30）。
      const [toastText, setToastText] = useState("");
      const [err, setErr] = useState("");
      const [resourceOpen, setResourceOpen] = useState(false);
      const [warnings, setWarnings] = useState([]);
      const [notes, setNotes] = useState([]);
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
        setToastText(message);
        setTimeout(() => setToastText(""), 4000);
      };
      // 让深层组件（如泛用 Field 的「浏览…」）也能弹提示，而不是静默失败。
      useEffect(() => { window.__surfcoreToast = notify; return () => { delete window.__surfcoreToast; }; }, []);
      // 网盘资源入口：语音包 + 向量记忆模型。百度和 UC 待补链。
      const RESOURCE_LINKS = {
        quark: "https://pan.quark.cn/s/2f49b5496874?pwd=jXqr",
        uc: "",
        xunlei: "https://pan.xunlei.com/s/VP5iWnY5xJ1D8KpL-gFpAsj9A1?pwd=tqi7",
        baidu: "",
      };
      const openResource = (kind) => {
        const url = RESOURCE_LINKS[kind];
        if (!url) { notify("这个网盘的链接还没配置，等管理员补上"); return; }
        window.open(url, "_blank", "noopener");
      };
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
          setConfigStamps(r.stamps ?? null);
          setWarnings([]);
          setNotes([]);
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
        setBusy("save"); setErr(""); setWarnings([]); setNotes([]);
        const resetSessions = adminDiscardContext;
        const shouldRestart = restartBridge || resetSessions;
        try {
          if (budgetDirty && limitDraft) {
            const b = await api("/token-budget", { method: "POST", body: { limits: limitDraft } });
            applyBudget(b);
            setLimitDraft(b.limits);
          }
          let r;
          try {
            r = await api("/config", { method: "POST", body: { qq: normalizedQq, bili, unified: normalizedUnified, restartBridge: shouldRestart, resetSessions, baseStamp: configStamps } });
          } catch (e) {
            // 409：配置在加载后被别处改过。不要盲目覆盖 —— 提示重新读取。
            if (/CONFIG_STALE|已被别处修改/.test(String(e.message))) {
              // 不要把 409 里的 stamps 直接套到当前 draft 上：那会让“再点一次保存”
              // 覆盖掉别人刚写的配置。必须显式「重新读取」后再改。
              setErr(`保存被拒绝：${e.message}。请点「重新读取」后再改。`);
              notify(`⚠️ ${e.message}`);
              return;
            }
            throw e;
          }
          if (r.qq) setQq(r.qq);
          if (r.bili) setBili(r.bili);
          if (r.unified) setUnified(r.unified);
          // 保存成功后同步版本戳；否则下一次保存会拿旧戳，被自己的第一次写盘判成 CONFIG_STALE。
          if (r.stamps) setConfigStamps(r.stamps);
          const nextSaved = JSON.stringify({ qq: r.qq ?? normalizedQq, bili: r.bili ?? bili, unified: r.unified ?? normalizedUnified });
          setSaved(nextSaved);
          if (resetSessions) setAdminDiscardContext(false);
          const resetDone = r.sessionsReset === true || r.biliSessionsReset === true;
          const nextWarnings = Array.isArray(r.warnings) ? r.warnings : [];
          const nextNotes = Array.isArray(r.notes) ? r.notes : [];
          setWarnings(nextWarnings);
          setNotes(nextNotes);
          notify(`✓ 已保存${budgetDirty ? "（token 额度即时生效）" : ""}${resetSessions ? (resetDone ? "，已重置相关会话上下文" : "，没有可重置的在线会话") : ""}${r.bridge ? (r.bridge.ok ? "，桥接已重启" : "，桥接重启失败") : ""}${nextWarnings.length ? "（有提示）" : ""}`);
          await loadOverview();
        } catch (e) { setErr(`保存失败：${e.message}`); setWarnings([]); setNotes([]); } finally { setBusy(""); }
      };
      const reload = async () => { await loadOverview(); await loadConfig(); await loadBudget(); };
      const reset = () => {
        setQq(JSON.parse(saved).qq);
        setBili(JSON.parse(saved).bili);
        setUnified(JSON.parse(saved).unified);
        setAdminDiscardContext(false);
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
        if (tab === "qq") return h(QQTab, { cfg: qq, set: setQqPath, admin: unified?.admin ?? {}, setAdmin, unified, setUnified: setUnifiedPath, overview, busy, setBusy, toast: notify, reload, goTab: setTab, onSave: save, onAdminDiscardContext: setAdminDiscardContext, dirty });
        if (tab === "bili") return h(BiliTab, { cfg: bili, set: setBiliPath, qq: normalizedQq, setQqPath, admin: unified?.admin ?? {}, setAdmin, unified, setUnified: setUnifiedPath, qqPrivate: normalizedQq?.allow?.private ?? [], qqAllowAll: normalizedQq?.allowAllWhenEmpty === true, overview, busy, setBusy, toast: notify, reload, onSave: save, onAdminDiscardContext: setAdminDiscardContext, dirty });
        if (tab === "tokens") return h(TokenTab, { budget, limits: limitDraft, onChange: setLimitDraft, disabled: !!busy, alertedToday: tokenAlerted, onSave: () => save(false), busy, toast: notify, set: setQqPath, setUnified: setUnifiedPath, qq: normalizedQq, unified });
        if (tab === "watch") return h(WatchTab, { busy, setBusy, toast: notify, goTab: setTab });
        if (tab === "voice") return h(VoiceTab, { toast: notify, qq: normalizedQq, setQq: setQqPath, onSave: save, busy, onResource: () => setResourceOpen(true) });
        if (tab === "pet") return h(PetTab, { toast: notify, unified, setUnified: setUnifiedPath });
        if (tab === "memory") return h(MemoryTab, { qq: normalizedQq, unified, setUnified: setUnifiedPath, overview, busy, setBusy, toast: notify, reload, onResource: () => setResourceOpen(true) });
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
          h("p", { className: "qbw-sub" }, "SurfCore 一个窗口管两边：QQ 的桥接与参数、B站养鱼参数、记忆卡、双向脱敏记忆、身份对齐，以及后续扩展接口。"),
          h("div", { className: "qbw-actions", style: { marginTop: "10px" } },
            h(Btn, { kind: "qbw-btn2", onClick: () => setResourceOpen(true) }, "获取网盘资源（语音、向量记忆模型）"))),
        h("div", { className: "qbw-tabs" }, TABS.map(([id, label]) => h("button", {
          key: id, className: "qbw-tab" + (active(id) ? " on" : ""), onClick: () => setTab(id),
        }, label))),
        h("div", { className: "qbw-body" },
          err ? h("div", { className: "qbw-err", style: { marginBottom: "8px" } }, err) : null,
          warnings.length ? h("div", { className: "qbw-warnbox", style: { marginBottom: "8px" } },
            h("div", { style: { fontWeight: 700, marginBottom: "4px" } }, "⚠️ 已保存，但有以下提示："),
            warnings.map((warning, index) => h("div", { key: index }, warning))) : null,
          notes.length ? h("div", { className: "qbw-hint", style: { marginBottom: "8px" } },
            notes.join(" ")) : null,
          renderTab()),
        h("div", { className: "qbw-foot" },
          h(Btn, { onClick: () => save(true), disabled: !!busy || !dirty || unified?.platforms?.start?.qq === false, title: unified?.platforms?.start?.qq === false ? "QQ 启动开关已关闭；先打开再重启" : "保存配置并重启 QQ 桥接，让 QQ 侧设置立即生效" }, busy === "save" ? "保存中…" : "保存并生效"),
          h(Btn, { kind: "qbw-btn2", onClick: () => save(false), disabled: !!busy || !dirty, title: "只写配置文件；QQ 侧要下次重启桥接才生效" }, "仅保存（不重启）"),
          h(Btn, { kind: "qbw-btn2", onClick: reset, disabled: !!busy || !dirty }, "撤销改动"),
          h(Btn, { kind: "qbw-btn2", onClick: reload, disabled: !!busy }, "重新读取"),
          h("span", { className: "spacer" }),
          dirty ? h("span", { className: "qbw-dirty" }, "● 有改动还没保存（改了不点保存 = 没生效）") : h("span", { className: "qbw-ok" }, "已保存")),
        toastText ? h("div", { className: "qbw-toast", role: "status" }, toastText) : null,
        resourceOpen ? h("div", { className: "qbw-modal-backdrop", onClick: (e) => { if (e.target === e.currentTarget) setResourceOpen(false); } },
          h("div", { className: "qbw-modal", style: { maxWidth: "520px" } },
            h("h3", null, "获取网盘资源"),
            h("p", { className: "qbw-hint" }, "语音包、向量记忆模型（runtime + 三个模型）都在网盘；选择你常用的网盘打开。"),
            h("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "10px" } },
              [["quark", "夸克网盘"], ["uc", "UC网盘"], ["xunlei", "迅雷网盘"], ["baidu", "百度网盘"]]
                .map(([key, label]) => h(Btn, {
                  key,
                  kind: "qbw-btn2",
                  disabled: !RESOURCE_LINKS[key],
                  title: RESOURCE_LINKS[key] ? `用默认浏览器打开${label}` : "链接待补",
                }, RESOURCE_LINKS[key] ? label : `${label}（待补链）`))),
            h("p", { className: "qbw-hint", style: { marginTop: "8px" } }, "夸克 / 迅雷已可用；百度 / UC 待补链。"),
            h("div", { className: "qbw-actions" },
              h(Btn, { onClick: () => setResourceOpen(false) }, "关闭")))) : null,
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
