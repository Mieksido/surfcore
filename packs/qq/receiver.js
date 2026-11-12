/**
 * QQ 接收器：OneBot v11 WebSocket 客户端
 * ============================================================================
 * 这是个"可注入"的接收器：真跑时用全局 WebSocket；测试时注入假的。
 * 它负责四件事：
 *   ① 连上（令牌走 query，因为 WebSocket 握手带不了自定义头）
 *   ② 收到消息 → 交给 onEvent（**不解析业务，只转交**）
 *   ③ 心跳：太久没收到 meta_event → 判定掉线并重连
 *   ④ 断线重连：指数退避，有上限
 *
 * 它不认识内核、不认识记忆、不发消息（发送在 onebot.js 的 createClient）。
 */

export const DEFAULT_RECONNECT = Object.freeze({ baseMs: 1000, maxMs: 30000, factor: 2 });

/**
 * @param {object} opts
 *   { url, accessToken, WebSocketImpl, onEvent, onLog, reconnect, heartbeatTimeoutMs, now }
 * @returns {{ start:Function, stop:Function, status:Function, handleMessage:Function }}
 */
export function createReceiver({
  url = 'ws://127.0.0.1:3001',
  accessToken = '',
  WebSocketImpl = globalThis.WebSocket,
  onEvent = () => {},
  onLog = () => {},
  onOpen = () => {},
  reconnect = DEFAULT_RECONNECT,
  heartbeatTimeoutMs = 60000,
  now = () => Date.now(),
} = {}) {
  const cfg = { ...DEFAULT_RECONNECT, ...reconnect };
  const state = { connected: false, attempts: 0, lastBeatAt: 0, lastUpstream: null, lastError: null, stopped: true };
  let ws = null;
  let retryTimer = null;

  const withToken = () => {
    if (!accessToken) return url;
    if (/[?&]access_token=/.test(url)) return url;   // 已经带了就别拼第二个
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}access_token=${encodeURIComponent(accessToken)}`;
  };

  function scheduleReconnect() {
    if (state.stopped) return;
    const delay = Math.min(cfg.maxMs, cfg.baseMs * (cfg.factor ** state.attempts));
    state.attempts += 1;
    onLog('warn', `QQ 接收器：${Math.round(delay)}ms 后重连（第 ${state.attempts} 次）`);
    retryTimer = setTimeout(connect, delay);
    if (typeof retryTimer?.unref === 'function') retryTimer.unref();   // 别拦着进程退出
  }

  function connect() {
    if (state.stopped) return;
    if (typeof WebSocketImpl !== 'function') {
      state.lastError = 'no-websocket'; onLog('error', '环境没有 WebSocket：接收功能不可用'); return;
    }
    try {
      ws = new WebSocketImpl(withToken());
    } catch (error) {
      state.lastError = String(error?.message ?? error);
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      state.connected = true; state.attempts = 0; state.lastBeatAt = now();
      onLog('info', 'QQ 接收器：已连接');
      try { onOpen(); } catch (error) { onLog('warn', `QQ 接收器：onOpen 失败 ${String(error?.message ?? error)}`); }
    };
    ws.onmessage = (msg) => handleMessage(msg?.data ?? msg);
    ws.onerror = (error) => { state.lastError = String(error?.message ?? 'socket error'); };
    ws.onclose = () => {
      state.connected = false;
      onLog('warn', 'QQ 接收器：连接断开');
      scheduleReconnect();
    };
  }

  /** 处理一条原始帧（字符串或 Buffer），公开出来便于单测 */
  function handleMessage(raw) {
    let data;
    try { data = JSON.parse(typeof raw === 'string' ? raw : String(raw)); }
    catch { onLog('warn', 'QQ 接收器：收到非 JSON 帧，已忽略'); return null; }

    if (data?.post_type === 'meta_event') {
      state.lastBeatAt = now();
      // 心跳带上游健康度：**不新增通道**，只存进状态，由 pack.health() 读出去
      if (data.meta_event_type === 'heartbeat' && data.status) {
        state.lastUpstream = {
          online: data.status.online ?? null,
          good: data.status.good ?? null,
          at: now(),
        };
      }
      return null;
    }

    // 自发回声：不是"外面发生的事"，不入库（否则她会把自己的话当用户输入）
    if (data?.post_type === 'message_sent') {
      onLog('info', 'QQ 接收器：忽略自发回声（message_sent）');
      return null;
    }

    // 通知类（拍一拍等）：**走同一条 onEvent 通道**，由 normalizeEvent 统一成事件
    if (data?.post_type === 'notice') {
      onEvent(data);
      return data;
    }

    if (data?.post_type === 'message') {
      // 入场守卫：网关半死时会吐畸形帧，不许把 private:undefined 这类垃圾送进内核
      const kind = data.message_type;
      const cid = kind === 'group' ? data.group_id : kind === 'private' ? data.user_id : undefined;
      if ((kind !== 'group' && kind !== 'private') || cid === undefined || cid === null) {
        onLog('warn', 'QQ 接收器：畸形消息帧已丢弃（message_type/会话 id 不合法）');
        return null;
      }
      onEvent(data);       // 只转交：业务判断在内核
      return data;
    }
    return null;           // 其它事件（request 等）暂不处理，前向兼容
  }

  return {
    start() {
      state.stopped = false; state.attempts = 0;
      connect();
      return state;
    },
    stop() {
      state.stopped = true; state.connected = false;
      if (retryTimer) clearTimeout(retryTimer);
      try { ws?.close?.(); } catch {}
      ws = null;
    },
    /** 心跳看门狗：超时没动静 → 判定掉线并重连（外部定时器调用） */
    checkHeartbeat() {
      if (state.stopped || !state.connected) return { ok: false, reason: 'not-connected' };
      if (state.lastBeatAt && now() - state.lastBeatAt > heartbeatTimeoutMs) {
        state.connected = false;
        onLog('warn', 'QQ 接收器：心跳超时，判定掉线');
        try { ws?.close?.(); } catch {}
        scheduleReconnect();
        return { ok: false, reason: 'heartbeat-timeout' };
      }
      return { ok: true };
    },
    handleMessage,
    status() {
      // 令牌一律打码：状态对象会被日志/诊断打印，绝不能带明文令牌
      return { ...state, url: withToken().replace(/access_token=[^&]+/, 'access_token=***') };
    },  };
}
