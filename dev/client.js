'use strict';
(() => {
  const el = id => document.getElementById(id);
  let connection = null, room = null, view = null, selected = '', status = 'closed', busy = false;
  function store(key, value) { try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); } catch {} }
  function read(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } }
  function message(text) { el('message').textContent = text; el('message').hidden = !text; }
  function text(id, value) { el(id).textContent = value || ''; }
  function button(label, handler, primary = false, disabled = false) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = primary ? 'primary' : ''; b.disabled = disabled || busy || status !== 'connected'; b.addEventListener('click', handler); return b; }
  function render() {
    el('entry').hidden = !!room; el('game-screen').hidden = !room;
    el('create-room').disabled = busy; el('join-room').disabled = busy;
    text('connection-status', { connecting: '正在连接', connected: '已连接房间服务', reconnecting: '正在重连，暂不能操作', expired: '登录失效或已在其他页面连接', closed: '尚未连接' }[status]);
    if (!view) return;
    text('code-display', view.code); text('phase-title', view.phaseTitle); text('instruction', view.instruction); text('timer', view.waiting ? '' : `${view.seconds} 秒`);
    el('pause').hidden = !view.paused; text('pause', `等待朋友重连，本局剩余等待 ${view.pauseSeconds} 秒。阶段计时与操作已暂停。`);
    el('seats').replaceChildren();
    for (const p of view.players) {
      const tile = document.createElement('button'); tile.type = 'button'; tile.className = `seat${p.empty ? ' empty' : ''}${p.selectable ? ' selectable' : ''}${selected === p.id ? ' selected' : ''}${p.speaking ? ' speaking' : ''}${!p.alive && !p.empty ? ' out' : ''}`; tile.disabled = !p.selectable || status !== 'connected' || busy;
      const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = p.empty ? '+' : String(p.seat);
      const name = document.createElement('strong'); name.textContent = p.name + (p.isMe ? ' · 你' : '');
      const state = document.createElement('small'); state.textContent = p.speaking ? '正在发言' : p.role || p.status;
      tile.append(avatar, name, state); tile.addEventListener('click', () => { selected = p.id; render(); }); el('seats').append(tile);
    }
    text('room-count', view.waiting ? `${view.count} / 6 人已到 · ${view.readyCount} 人已准备` : `第 ${view.day} 天 · ${view.players.filter(p => !p.empty && p.alive).length} 人在场`);
    text('voice-text', view.voiceText); text('voice-permission', view.voicePermission); text('my-vote', view.myVote);
    el('identity-panel').hidden = !view.identity; text('identity', `你是${view.identity}`); text('goal', view.goal);
    el('private-notes').replaceChildren(); for (const note of view.privateNotes) { const p = document.createElement('div'); p.className = 'private-note'; p.textContent = note; el('private-notes').append(p); }
    el('actions').replaceChildren();
    if (view.waiting) {
      if (!view.voiceReady) el('actions').append(button('确认仅做规则联调', () => command({ type: 'voiceReady', ready: true })));
      el('actions').append(button(view.ready ? '取消准备' : view.ended ? '准备下一局' : '我准备好了', () => command({ type: 'ready', ready: !view.ready }), true, !view.canReady));
      if (view.hostId === view.meId) el('actions').append(button(view.canStart ? '全员就绪，开始' : '等待六人全部准备', () => command({ type: 'start' }), true, !view.canStart));
    }
    if (view.actionType) {
      el('actions').append(button(selected ? `${view.actionText} · ${view.players.find(p => p.id === selected)?.seat} 号` : '先点击席位选择目标', () => command({ type: view.actionType, targetId: selected, phaseId: view.phaseId }), true, !selected));
      if (view.canAbstain) el('actions').append(button('本轮弃票', () => command({ type: 'vote', targetId: null, phaseId: view.phaseId })));
    }
    if (view.allowPass) el('actions').append(button('我说完了，结束发言', () => command({ type: 'pass', phaseId: view.phaseId }), true));
    el('history').replaceChildren(); if (!view.history.length) { const p = document.createElement('p'); p.className = 'helper'; p.textContent = '还没有公开事件。'; el('history').append(p); }
    for (const entry of view.history) { const row = document.createElement('div'); row.className = 'history-row'; row.textContent = entry.text; el('history').append(row); }
  }
  async function command(body) { if (busy || !connection) return; busy = true; message(''); render(); try { await connection.send(body); } catch (error) { message(error.message); } finally { busy = false; render(); } }
  function openSocket() {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    return { onOpen: f => socket.addEventListener('open', f), onMessage: f => socket.addEventListener('message', f), onClose: f => socket.addEventListener('close', f), onError: f => socket.addEventListener('error', f), send: ({ data }) => socket.send(data), close: () => socket.close() };
  }
  async function establish(session) {
    connection?.close();
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; connection?.close(); reject(new Error('连接超时，请刷新重试')); } }, 12000);
      connection = WerewolfConnection.createConnection({ token: session.token, openSocket, onState(next) { const vm = WerewolfUI.present(next); if (view?.phaseId !== vm?.phaseId || !vm?.actionType) selected = ''; room = next; view = vm; render(); }, onStatus(next) { status = next; render(); if (next === 'connected' && !settled) { settled = true; clearTimeout(timer); resolve(); } if (next === 'expired') { store('session', null); message('登录已失效或连接被替换，请刷新重新进入。'); if (!settled) { settled = true; clearTimeout(timer); reject(new Error('登录已失效')); } } }, onError(error) { message(error.message); if (!settled) { settled = true; clearTimeout(timer); reject(error); } } }); connection.connect();
    });
  }
  async function enter(join) {
    if (busy) return;
    const name = el('nickname').value.trim(), code = el('room-code').value.trim();
    if (!name) { message('请先输入昵称。'); return; } if (join && !/^\d{6}$/.test(code)) { message('请输入六位房间号。'); return; }
    busy = true; message(''); render();
    try { let session = read('session'); if (!session || session.user.name !== name) { const response = await fetch('/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) }); session = await response.json(); if (!response.ok) throw new Error(session.message || '登录失败'); store('session', session); } await establish(session); await connection.send(join ? { type: 'join', code } : { type: 'create' }); }
    catch (error) { message(error.message); } finally { busy = false; render(); }
  }
  el('entry-form').addEventListener('submit', event => { event.preventDefault(); enter(false); });
  el('join-room').addEventListener('click', () => enter(true));
  el('room-code').addEventListener('input', event => { event.target.value = event.target.value.replace(/\D/g, '').slice(0, 6); });
  el('copy-invite').addEventListener('click', async () => { if (!room) return; const invite = `${location.origin}/?room=${room.code}`; try { await navigator.clipboard.writeText(invite); message('邀请链接已复制。'); } catch { message(`请复制邀请链接：${invite}`); } });
  el('new-player').addEventListener('click', () => { if (room) window.open(`/?room=${room.code}&fresh=1`, '_blank', 'noopener'); });
  el('leave-room').addEventListener('click', async () => { if (!room) return; if (!window.confirm(view.waiting ? '离开房间？' : '离开将触发重连等待，超时后整局中止。确定离开？')) return; await command({ type: 'leave' }); connection?.close(); room = null; view = null; store('session', null); render(); });
  const params = new URLSearchParams(location.search); if (params.get('fresh') === '1') store('session', null);
  el('room-code').value = /^\d{6}$/.test(params.get('room') || '') ? params.get('room') : '';
  const session = read('session'); if (session) { el('nickname').value = session.user.name; establish(session).catch(error => message(error.message)); }
  render();
})();
