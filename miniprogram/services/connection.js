(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WerewolfConnection = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function createConnection({ openSocket, token, onState = () => {}, onStatus = () => {}, onError = () => {}, retryMs = 1000, requestTimeout = 8000 }) {
    let socket = null, authenticated = false, stopped = false, reconnect = null, seq = 0;
    const pending = new Map();
    function rejectPending() { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('连接已中断，请重新操作')); } pending.clear(); }
    function connect() {
      stopped = false; clearTimeout(reconnect); authenticated = false; onStatus('connecting');
      const current = openSocket(); socket = current;
      current.onOpen(() => { if (socket === current && !stopped) current.send({ data: JSON.stringify({ type: 'authenticate', token }) }); });
      current.onMessage(event => {
        if (socket !== current || stopped) return;
        let message; try { message = JSON.parse(event.data); } catch { onError(new Error('收到无效响应')); return; }
        if (message.type === 'authenticated') { authenticated = true; onStatus('connected'); return; }
        if (message.type === 'state') { onState(message.room); return; }
        const entry = pending.get(message.requestId);
        if (entry) { clearTimeout(entry.timer); pending.delete(message.requestId); }
        if (message.type === 'ack') { entry?.resolve(message); return; }
        if (message.type === 'error') {
          const error = new Error(message.message || '操作失败'); error.code = message.code;
          if (entry) entry.reject(error); else onError(error);
          if (['AUTH_FAILED', 'SESSION_EXPIRED', 'CONNECTION_REPLACED'].includes(message.code)) { stopped = true; authenticated = false; onStatus('expired'); current.close(); }
        }
      });
      current.onError(() => { if (socket === current && !stopped) onStatus('reconnecting'); });
      current.onClose(event => {
        if (socket !== current) return;
        authenticated = false; rejectPending();
        if (stopped) return;
        if ([4001,4009].includes(event?.code)) { stopped = true; onStatus('expired'); return; }
        onStatus('reconnecting'); reconnect = setTimeout(connect, retryMs);
      });
    }
    function send(command) {
      if (!authenticated || !socket || stopped) return Promise.reject(new Error('连接尚未就绪，请稍后重试'));
      const requestId = `c${Date.now().toString(36)}_${++seq}`;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('操作超时，请确认状态后重试')); }, requestTimeout);
        pending.set(requestId, { resolve, reject, timer });
        try { socket.send({ data: JSON.stringify({ ...command, requestId }) }); }
        catch { clearTimeout(timer); pending.delete(requestId); reject(new Error('连接发送失败，请重连')); }
      });
    }
    function close() { stopped = true; authenticated = false; clearTimeout(reconnect); rejectPending(); socket?.close(); socket = null; onStatus('closed'); }
    return { connect, send, close };
  }
  return { createConnection };
});
