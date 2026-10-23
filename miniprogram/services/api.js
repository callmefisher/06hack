'use strict';
const config = require('../config');
const { createConnection } = require('./connection');
let connection = null, cachedRoom = null, status = 'closed';
const listeners = new Set();
function publish() { listeners.forEach(listener => listener({ room: cachedRoom, status })); }
function request(path, data) {
  return new Promise((resolve, reject) => {
    if (!config.development && !config.apiBase.startsWith('https://')) { reject(new Error('正式环境需要 HTTPS 服务地址')); return; }
    wx.request({ url: config.apiBase + path, method: 'POST', data, timeout: 10000, header: { 'content-type': 'application/json' }, success(res) { if (res.statusCode === 200) resolve(res.data); else reject(new Error(res.data?.message || '服务暂时不可用')); }, fail() { reject(new Error('无法连接服务，请检查网络与服务地址')); } });
  });
}
async function login(name) {
  let code;
  if (!config.development) code = await new Promise((resolve, reject) => wx.login({ success: r => r.code ? resolve(r.code) : reject(new Error('微信登录失败')), fail: () => reject(new Error('微信登录失败')) }));
  const session = await request('/api/session', { name, code });
  try { wx.setStorageSync('werewolf-session', session); } catch { /* Session still works for this runtime. */ }
  return session;
}
function getSession() { try { return wx.getStorageSync('werewolf-session') || null; } catch { return null; } }
function clearSession() { connection?.close(); connection = null; cachedRoom = null; try { wx.removeStorageSync('werewolf-session'); } catch { /* Storage can be unavailable. */ } }
function connect(session = getSession()) {
  if (!session?.token) return Promise.reject(new Error('请先输入昵称进入'));
  if (connection && status === 'connected') return Promise.resolve();
  connection?.close();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; connection?.close(); reject(new Error('连接超时，请重新进入')); } }, 12000);
    connection = createConnection({ token: session.token, openSocket: () => wx.connectSocket({ url: config.apiBase.replace(/^http/, 'ws') + '/ws', complete() {} }), onState(room) { cachedRoom = room; publish(); }, onStatus(next) { status = next; if (next === 'connected' && !settled) { settled = true; clearTimeout(timer); resolve(); } if (next === 'expired') { try { wx.removeStorageSync('werewolf-session'); } catch {} if (!settled) { settled = true; clearTimeout(timer); reject(new Error('登录已失效，请重新进入')); } } publish(); }, onError(error) { if (!settled) { settled = true; clearTimeout(timer); reject(error); } wx.showToast({ title: error.message, icon: 'none' }); } });
    connection.connect();
  });
}
function subscribe(listener) { listeners.add(listener); listener({ room: cachedRoom, status }); return () => listeners.delete(listener); }
function send(command) { return connection ? connection.send(command) : Promise.reject(new Error('连接尚未建立')); }
module.exports = { login, getSession, clearSession, connect, subscribe, send };
