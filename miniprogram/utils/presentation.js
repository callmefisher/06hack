(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WerewolfUI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const roles = { wolf: '狼人', seer: '预言家', villager: '村民' };
  const phases = { identity: '查看身份', night: '夜晚行动', speaking: '依次发言', discussion: '自由讨论', vote: '投票', runoff: '平票加投', lastWords: '最后遗言', finished: '身份揭晓', aborted: '本局未完成' };
  const goals = { wolf: '和队友配合，隐藏身份；存活狼人数达到好人数时获胜。', seer: '每夜查验一人的阵营，和村民一起找出两名狼人。', villager: '倾听、追问和投票；两名狼人全部出局时获胜。' };
  function present(room) {
    if (!room) return null;
    const g = room.game;
    const ended = g && ['finished', 'aborted'].includes(g.phase);
    const waiting = !g || ended;
    const self = room.players.find(p => p.id === room.meId);
    const name = id => { const p = room.players.find(x => x.id === id); return p ? `${p.seat} 号 ${p.name}` : '已离房玩家'; };
    let actionType = null;
    if (g && !waiting && !g.pause && g.me.alive) {
      if (['vote', 'runoff'].includes(g.phase)) actionType = 'vote';
      if (g.phase === 'night' && g.me.role === 'seer' && !g.me.inspected) actionType = 'inspect';
      if (g.phase === 'night' && g.day > 1 && g.me.role === 'wolf') actionType = 'kill';
    }
    const roster = Array.from({ length: 6 }, (_, i) => {
      const p = room.players[i];
      if (!p) return { id: `empty-${i}`, seat: i + 1, name: '等待朋友', empty: true, status: '邀请加入', selectable: false };
      const gp = g ? g.players.find(x => x.id === p.id) : null;
      let selectable = !!actionType && !!gp?.alive && p.id !== room.meId;
      if (actionType === 'kill' && g.me.teammates.includes(p.id)) selectable = false;
      if (actionType === 'vote' && g.phase === 'runoff' && !g.candidates.includes(p.id)) selectable = false;
      return { ...p, empty: false, isMe: p.id === room.meId, alive: gp ? gp.alive : true, role: gp?.role ? roles[gp.role] : '', speaking: !waiting && g?.speakerId === p.id, selectable, status: !p.connected ? '暂时离线' : waiting ? p.ready ? '已准备' : '未准备' : !gp?.alive ? '已出局' : '在场 · 身份未知' };
    });
    const history = g ? g.history.map((event, i) => ({ id: `${g.id}-${i}`, text: event.type === 'votes' ? `第 ${event.day} 天${event.runoff ? '加投' : '投票'}：${Object.entries(event.ballots).map(([id, target]) => `${name(id)} → ${target ? name(target) : '弃票'}`).join('；')}` : `第 ${event.day} ${event.cause === 'night' ? '夜' : '天'}：${name(event.playerId)}${event.cause === 'night' ? '遇袭出局' : '被投票放逐'}` })) : [];
    const privateNotes = [];
    if (g) {
      if (g.me.role === 'wolf') privateNotes.push(`狼人队友：${g.me.teammates.map(name).join('、')}`);
      g.me.inspections.forEach(x => privateNotes.push(`第 ${x.day} 夜查验 ${name(x.targetId)}：${x.team === 'wolves' ? '狼人' : '好人'}`));
      if (g.me.wolfTargets) Object.entries(g.me.wolfTargets).forEach(([id, target]) => privateNotes.push(`${name(id)} 标记了 ${name(target)}`));
    }
    let instruction = '先和朋友打个招呼，准备好后确认。';
    if (g && !waiting) {
      instruction = { identity: '身份只对你可见。看清目标，稍后自动进入准备夜。', night: g.day === 1 ? '首夜不袭击。预言家查验，狼人认识队友，其余人等待天亮。' : '完成你的夜间行动，系统将在统一截止时结算。', speaking: g.speakerId === room.meId ? '轮到你了：怀疑谁、依据是什么、想追问什么？也可以提前结束。' : `正在听 ${name(g.speakerId)} 发言。`, discussion: '现在可以自由追问与回应。让每个人都有表达机会。', vote: '独立选择；截止前可改票，截止后统一公开票型。', runoff: '仅对并列最高票玩家加投。再次平票，本轮无人出局。', lastWords: g.speakerId === room.meId ? '留下最后的判断。身份仍不公开，可以提前结束。' : `请听 ${name(g.speakerId)} 的最后遗言。` }[g.phase] || '阶段未知，暂时停止操作。';
      if (!g.me.alive && g.phase !== 'lastWords') instruction = '你已出局，留房旁观。身份会在结算时统一揭晓。';
    }
    if (g?.phase === 'finished') instruction = g.winner === 'wolves' ? '狼人阵营获胜。聊聊刚才的判断，准备下一局。' : '好人阵营获胜。聊聊刚才的判断，准备下一局。';
    if (g?.phase === 'aborted') instruction = '重连等待已用完，本局中止，不计阵营输赢。';
    return { code: room.code, meId: room.meId, hostId: room.hostId, devMode: room.devMode, waiting, ended: !!ended, players: roster, phaseTitle: g ? phases[g.phase] || '未知阶段' : '朋友先聊，等大家到齐', phase: g?.phase || 'lobby', phaseId: g?.phaseId || '', day: g?.day || 0, instruction, identity: g ? roles[g.me.role] : '', goal: g ? goals[g.me.role] : '', seconds: g?.deadline ? Math.max(0, Math.ceil((g.pause ? g.pause.remainingPhaseMs : g.deadline - g.serverNow) / 1000)) : 0, pauseSeconds: g?.pause ? Math.max(0, Math.ceil(g.pause.remainingMs / 1000)) : 0, paused: !!g?.pause, actionType, actionText: { vote: '确认投票', inspect: '确认查验', kill: '标记袭击目标' }[actionType] || '', canAbstain: actionType === 'vote', allowPass: !waiting && !g?.pause && g?.speakerId === room.meId && ['speaking', 'lastWords'].includes(g.phase), canReady: !!waiting && !!self?.connected && !!self?.voiceReady, ready: !!self?.ready, voiceReady: !!self?.voiceReady, canStart: !!waiting && room.hostId === room.meId && room.players.length === 6 && room.players.every(p => p.connected && p.ready && p.voiceReady), voiceText: room.devMode ? '开发联调 · 不传输语音' : '真实语音未接通，暂不能准备开局', voicePermission: g?.voice?.canPublish ? '本阶段允许你发言' : g?.voice?.canListen ? '本阶段只收听' : '本阶段无公共语音', count: room.players.length, readyCount: room.players.filter(p => p.ready).length, privateNotes, history, myVote: g?.me?.hasVoted ? `你的当前选择：${g.me.vote ? name(g.me.vote) : '弃票'}` : '' };
  }
  return { present, roles, phases };
});
