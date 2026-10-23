'use strict';
const { randomInt, randomUUID } = require('node:crypto');
const DURATIONS = Object.freeze({identity:15000,night:20000,speaking:30000,discussion:60000,vote:15000,runoff:10000,lastWords:15000});
const ROLES = ['wolf','wolf','seer','villager','villager','villager'];
function fail(message, code='INVALID_ACTION') { const e=new Error(message); e.code=code; throw e; }
function shuffled(values) { const copy=[...values]; for(let i=copy.length-1;i>0;i--){const j=randomInt(i+1);[copy[i],copy[j]]=[copy[j],copy[i]];} return copy; }
function getPlayer(g,id) { const p=g.players.find(x=>x.id===id); if(!p) fail('你不在这场对局中','NOT_MEMBER'); return p; }
function terminal(g) { return g.phase==='finished'||g.phase==='aborted'; }
function enter(g,phase,now) { g.phase=phase;g.phaseId=randomUUID();g.deadline=terminal(g)?null:now+DURATIONS[phase]; }
function createGame(players,{now=Date.now(),roles,firstSeat}={}) {
  if(players.length!==6||new Set(players.map(p=>p.id)).size!==6) fail('需要六名不同的玩家');
  const assigned=roles??shuffled(ROLES);
  if(JSON.stringify([...assigned].sort())!==JSON.stringify([...ROLES].sort())) fail('身份配置必须是两狼一预言家三村民');
  const g={id:randomUUID(),players:players.map((p,i)=>({id:p.id,name:p.name,seat:i+1,role:assigned[i],alive:true,connected:true,inspections:[]})),day:1,firstSeat:firstSeat??randomInt(1,7),phase:null,phaseId:null,deadline:null,speakers:[],speakerIndex:0,lastWordsId:null,candidates:[],ballots:{},wolfTargets:{},inspected:false,history:[],winner:null,pause:null,reconnectRemaining:30000};
  if(!Number.isInteger(g.firstSeat)||g.firstSeat<1||g.firstSeat>6) fail('发言起点无效');
  enter(g,'identity',now);return g;
}
function checkWinner(g,now) {
  const wolves=g.players.filter(p=>p.alive&&p.role==='wolf').length;
  const good=g.players.filter(p=>p.alive&&p.role!=='wolf').length;
  if(wolves===0||wolves>=good){g.winner=wolves===0?'villagers':'wolves';g.pause=null;enter(g,'finished',now);return true;}return false;
}
function eliminate(g,id,cause) { getPlayer(g,id).alive=false;g.history.push({type:'elimination',day:g.day,playerId:id,cause}); }
function startNight(g,now) { g.day+=1;g.wolfTargets={};g.inspected=false;enter(g,'night',now); }
function startDay(g,now) {
  const start=(g.firstSeat-1+g.day-1)%6;
  g.speakers=Array.from({length:6},(_,i)=>g.players[(start+i)%6]).filter(p=>p.alive).map(p=>p.id);
  g.speakerIndex=0;enter(g,'speaking',now);
}
function finishVote(g,now) {
  const counts={};const ballots={};for(const p of g.players.filter(x=>x.alive)){const target=g.ballots[p.id]??null;ballots[p.id]=target;if(target)counts[target]=(counts[target]??0)+1;}
  g.history.push({type:'votes',day:g.day,runoff:g.phase==='runoff',ballots});
  const high=Math.max(0,...Object.values(counts));const tied=g.players.filter(p=>p.alive&&counts[p.id]===high).map(p=>p.id);
  if(high===0){startNight(g,now);return;}
  if(tied.length>1){if(g.phase==='vote'){g.candidates=tied;g.ballots={};enter(g,'runoff',now);}else startNight(g,now);return;}
  eliminate(g,tied[0],'vote');if(checkWinner(g,now))return;
  g.lastWordsId=tied[0];enter(g,'lastWords',now);
}
function advance(g,now) {
  switch(g.phase){
    case 'identity':g.wolfTargets={};g.inspected=false;enter(g,'night',now);break;
    case 'night':{
      if(g.day>1){const wolves=g.players.filter(p=>p.alive&&p.role==='wolf');const targets=wolves.map(p=>g.wolfTargets[p.id]);if(targets[0]&&targets.every(id=>id===targets[0])) eliminate(g,targets[0],'night');}
      if(!checkWinner(g,now))startDay(g,now);break;
    }
    case 'speaking':g.speakerIndex+=1;enter(g,g.speakerIndex<g.speakers.length?'speaking':'discussion',now);break;
    case 'discussion':g.ballots={};g.candidates=[];enter(g,'vote',now);break;
    case 'vote':case 'runoff':finishVote(g,now);break;
    case 'lastWords':g.lastWordsId=null;startNight(g,now);break;
    default:break;
  }
}
function tick(g,now) {
  if(terminal(g))return false;
  if(g.pause){if(now-g.pause.startedAt>=g.reconnectRemaining){g.reconnectRemaining=0;g.pause=null;g.winner=null;enter(g,'aborted',now);return true;}return false;}
  let changed=false;let steps=0;
  while(!terminal(g)&&now>=g.deadline&&steps++<1000){const at=g.deadline;advance(g,at);changed=true;}
  return changed;
}
function act(g,id,command,now=Date.now()) {
  tick(g,now);const p=getPlayer(g,id);
  if(g.pause)fail('正在等待重连，暂时不能操作','PAUSED');
  if(terminal(g)||command.phaseId!==g.phaseId)fail('阶段已变化，请按最新画面操作','STALE_PHASE');
  if(!p.connected)fail('连接尚未恢复','DISCONNECTED');
  if(command.type==='pass'){
    if((g.phase==='speaking'&&g.speakers[g.speakerIndex]===id)||(g.phase==='lastWords'&&g.lastWordsId===id)){advance(g,now);return;}
    fail('现在不是你的发言时间');
  }
  if(!p.alive)fail('你已出局，只能旁观');
  const targetId=command.targetId;
  if(command.type==='vote'){
    if(!['vote','runoff'].includes(g.phase))fail('当前不能投票');
    if(targetId!==null){const target=getPlayer(g,targetId);if(!target.alive||id===targetId)fail('不能投给自己或出局玩家');if(g.phase==='runoff'&&!g.candidates.includes(targetId))fail('只能投给平票候选人');}
    g.ballots[id]=targetId;return;
  }
  if(g.phase!=='night')fail('当前不是夜间行动阶段');
  const target=getPlayer(g,targetId);if(!target.alive||id===targetId)fail('目标无效');
  if(command.type==='inspect'){
    if(p.role!=='seer')fail('只有预言家能查验');if(g.inspected)fail('本夜已完成查验');
    p.inspections.push({day:g.day,targetId,team:target.role==='wolf'?'wolves':'villagers'});g.inspected=true;return;
  }
  if(command.type==='kill'){
    if(p.role!=='wolf')fail('只有狼人能选择袭击目标');if(g.day===1)fail('首夜不袭击');if(target.role==='wolf')fail('不能袭击狼人');g.wolfTargets[id]=targetId;return;
  }
  fail('未知操作');
}
function setConnected(g,id,connected,now=Date.now()) {
  tick(g,now);const p=getPlayer(g,id);p.connected=connected;
  if(terminal(g)||!p.alive)return;
  if(!connected&&!g.pause)g.pause={startedAt:now,remainingPhaseMs:Math.max(0,g.deadline-now)};
  if(g.pause&&g.players.filter(x=>x.alive).every(x=>x.connected)){
    g.reconnectRemaining=Math.max(0,g.reconnectRemaining-(now-g.pause.startedAt));g.deadline=now+g.pause.remainingPhaseMs;g.pause=null;
  }
}
function voicePolicy(g,id) {
  const p=getPlayer(g,id);
  if(terminal(g))return {channel:'public',canPublish:p.connected,canListen:true};
  if(g.phase==='night')return p.alive&&p.role==='wolf'?{channel:`wolves:${g.phaseId}`,canPublish:p.connected,canListen:p.connected}:{channel:null,canPublish:false,canListen:false};
  const canPublish=p.connected&&((g.phase==='speaking'&&g.speakers[g.speakerIndex]===id)||(g.phase==='discussion'&&p.alive)||(g.phase==='lastWords'&&g.lastWordsId===id));
  return {channel:'public',canPublish,canListen:true};
}
function snapshot(g,id,now=Date.now()) {
  const p=getPlayer(g,id),reveal=terminal(g);
  const me={id:p.id,role:p.role,alive:p.alive,inspections:p.inspections.map(x=>({...x})),teammates:p.role==='wolf'?g.players.filter(x=>x.role==='wolf'&&x.id!==id).map(x=>x.id):[],vote:['vote','runoff'].includes(g.phase)?g.ballots[id]??null:null,hasVoted:Object.hasOwn(g.ballots,id),inspected:g.phase==='night'&&p.role==='seer'&&g.inspected};
  if(g.phase==='night'&&p.role==='wolf'&&p.alive)me.wolfTargets={...g.wolfTargets};
  return {id:g.id,phase:g.phase,phaseId:g.phaseId,day:g.day,deadline:g.deadline,serverNow:now,winner:g.winner,players:g.players.map(x=>({id:x.id,name:x.name,seat:x.seat,alive:x.alive,connected:x.connected,...(reveal?{role:x.role}:{})})),me,speakerId:g.phase==='speaking'?g.speakers[g.speakerIndex]:g.phase==='lastWords'?g.lastWordsId:null,candidates:g.phase==='runoff'?[...g.candidates]:[],history:structuredClone(g.history),pause:g.pause?{remainingMs:Math.max(0,g.reconnectRemaining-(now-g.pause.startedAt)),remainingPhaseMs:g.pause.remainingPhaseMs}:null,voice:voicePolicy(g,id)};
}
module.exports={createGame,act,tick,setConnected,snapshot,voicePolicy,terminal};
