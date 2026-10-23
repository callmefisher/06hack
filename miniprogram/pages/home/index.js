const api = require('../../services/api');
const config = require('../../config');
Page({
  data: { name: '', code: '', busy: false, error: '', development: config.development, rulesOpen: false },
  onLoad(options) { const session = api.getSession(); this.setData({ name: session?.user?.name || '', code: /^\d{6}$/.test(options.room || '') ? options.room : '' }); },
  nameInput(event) { this.setData({ name: event.detail.value }); },
  codeInput(event) { this.setData({ code: event.detail.value.replace(/\D/g, '').slice(0, 6) }); },
  toggleRules() { this.setData({ rulesOpen: !this.data.rulesOpen }); },
  async enter(event) {
    if (this.data.busy) return;
    const join = event.currentTarget.dataset.mode === 'join';
    if (!this.data.name.trim()) { this.setData({ error: '先告诉朋友你叫什么。' }); return; }
    if (join && !/^\d{6}$/.test(this.data.code)) { this.setData({ error: '请输入六位房间号。' }); return; }
    this.setData({ busy: true, error: '' });
    try {
      let session = api.getSession();
      if (!session || session.user.name !== this.data.name.trim()) { api.clearSession(); session = await api.login(this.data.name.trim()); }
      await api.connect(session);
      await api.send(join ? { type: 'join', code: this.data.code } : { type: 'create' });
      wx.navigateTo({ url: '/pages/room/index' });
    } catch (error) { this.setData({ error: error.message }); }
    finally { this.setData({ busy: false }); }
  }
});
