const api = require('../../services/api');
const { present } = require('../../utils/presentation');
Page({
  data: { vm: null, selected: '', busy: false, error: '', status: 'connecting', recordsOpen: false, helpOpen: false },
  onLoad() { this.unsubscribe = api.subscribe(({ room, status }) => { const vm = present(room); const changed = this.data.vm?.phaseId !== vm?.phaseId; this.setData({ vm, status, ...(changed ? { selected: '', error: '' } : {}) }); }); },
  onUnload() { this.unsubscribe?.(); },
  onShareAppMessage() { return { title: '朋友到齐，猜一局。来六人好友房', path: `/pages/home/index?room=${this.data.vm?.code || ''}` }; },
  select(event) { const player = this.data.vm?.players.find(p => p.id === event.currentTarget.dataset.id); if (player?.selectable) this.setData({ selected: player.id }); },
  toggleRecords() { this.setData({ recordsOpen: !this.data.recordsOpen }); },
  toggleHelp() { this.setData({ helpOpen: !this.data.helpOpen }); },
  async command(command) {
    if (this.data.busy || this.data.status !== 'connected') return;
    this.setData({ busy: true, error: '' });
    try { await api.send(command); }
    catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  },
  ready() { return this.command({ type: 'ready', ready: !this.data.vm.ready }); },
  start() { return this.command({ type: 'start' }); },
  pass() { return this.command({ type: 'pass', phaseId: this.data.vm.phaseId }); },
  submit() { if (!this.data.selected) return; return this.command({ type: this.data.vm.actionType, targetId: this.data.selected, phaseId: this.data.vm.phaseId }); },
  abstain() { return this.command({ type: 'vote', targetId: null, phaseId: this.data.vm.phaseId }); },
  voice() {
    if (!this.data.vm.devMode) { wx.showModal({ title: '真实语音尚未接通', content: '当前版本可以查看房间。语音服务完成账号配置和权限验证后，才能在正式环境准备开局。', showCancel: false }); return; }
    wx.showModal({ title: '仅测试规则，不连接语音', content: '确认后只标记开发联调状态，不申请麦克风权限，也不传输声音。', success: result => { if (result.confirm) this.command({ type: 'voiceReady', ready: true }); } });
  },
  leave() {
    wx.showModal({ title: '离开好友房？', content: this.data.vm?.waiting ? '可以通过房间邀请再次加入。' : '对局中离开会触发重连等待，超时后整局中止。', success: async result => { if (!result.confirm) return; await this.command({ type: 'leave' }); if (!this.data.error) { api.clearSession(); wx.reLaunch({ url: '/pages/home/index' }); } } });
  },
  relogin() { api.clearSession(); wx.reLaunch({ url: '/pages/home/index' }); }
});
