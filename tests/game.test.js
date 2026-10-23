'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, snapshot, voicePolicy, setConnected, act, tick } = require('../server/game');
const { players, fixture, next, action, toVote, votes } = require('./helpers');

test('assigns exactly two wolves, one seer, three villagers without exposing others', () => {
  const g = createGame(players, { now: 0 });
  assert.deepEqual(g.players.map(p => p.role).sort(), ['seer','villager','villager','villager','wolf','wolf']);
  for (const p of players) {
    const view = snapshot(g, p.id, 0);
    assert.equal(view.players.filter(x => x.role).length, 0);
    assert.equal(view.me.id, p.id);
    assert.ok(view.me.role);
    assert.equal(view.deadline, 15000);
    assert.equal(view.players.some(x => 'inspections' in x), false);
  }
});
test('rejects incomplete/invalid game creation and outsiders', () => {
  assert.throws(() => createGame([], {now:0}));
  assert.throws(() => createGame([...players.slice(0,5),players[0]], {now:0}));
  assert.throws(() => createGame(players, {now:0, roles:['wolf']}));
  assert.throws(() => snapshot(fixture(), 'stranger', 0));
});
test('first night permits private seer results and wolf recognition, but no kill', () => {
  const g = fixture(); next(g);
  assert.equal(g.phase, 'night'); assert.equal(g.deadline, 35000);
  action(g, 'p3', 'inspect', 'p1');
  assert.deepEqual(snapshot(g,'p3',34000).me.inspections, [{day:1,targetId:'p1',team:'wolves'}]);
  assert.deepEqual(snapshot(g,'p4',34000).me.inspections, []);
  assert.deepEqual(snapshot(g,'p1',34000).me.teammates, ['p2']);
  assert.deepEqual(snapshot(g,'p3',34000).me.teammates, []);
  assert.throws(() => action(g,'p1','kill','p4'), /首夜/);
  assert.throws(() => action(g,'p4','inspect','p1'));
  assert.throws(() => action(g,'p3','inspect','p2'), /查验/);
  next(g); assert.equal(g.players.filter(p=>p.alive).length,6);
  assert.equal(g.phase,'speaking'); assert.equal(snapshot(g,'p5',35000).speakerId,'p1');
});
test('speaker can pass, everyone gets one turn, discussion lasts sixty seconds', () => {
  const g=fixture();next(g);next(g);
  assert.throws(()=>action(g,'p2','pass'));
  for(let i=1;i<=6;i++) action(g,`p${i}`,'pass',undefined,35000+i);
  assert.equal(g.phase,'discussion');
  const start = g.deadline-60000;
  assert.equal(voicePolicy(g,'p4').canPublish,true);
  tick(g,start+59999);assert.equal(g.phase,'discussion');
  next(g);assert.equal(g.phase,'vote');
  assert.equal(voicePolicy(g,'p4').canPublish,false);
});
test('votes stay private, are changeable until deadline, then publicly recorded', () => {
  const g=toVote(fixture());
  action(g,'p1','vote','p4');action(g,'p1','vote','p3');
  assert.throws(()=>action(g,'p2','vote','p2'));
  assert.equal(snapshot(g,'p2',g.deadline-1).history.some(e=>e.type==='votes'),false);
  assert.equal(snapshot(g,'p2',g.deadline-1).players.some(p=>'vote' in p),false);
  votes(g,['p4','p4','p4','p1','p4',null]);
  const view=snapshot(g,'p1',g.deadline-1);
  assert.equal(g.phase,'lastWords');assert.equal(view.players.find(p=>p.id==='p4').role,undefined);
  assert.deepEqual(view.history.find(e=>e.type==='votes').ballots,{p1:'p4',p2:'p4',p3:'p4',p4:'p1',p5:'p4',p6:null});
  assert.equal(voicePolicy(g,'p4').canPublish,true);
  next(g);assert.equal(g.phase,'night');assert.equal(voicePolicy(g,'p4').canPublish,false);
  assert.equal(voicePolicy(g,'p4').channel,null);
});
test('highest tied candidates get one runoff, second tie ends day without elimination', () => {
  const g=toVote(fixture());votes(g,['p4','p4','p5','p5','p4','p5']);
  assert.equal(g.phase,'runoff');assert.deepEqual(snapshot(g,'p1',g.deadline-1).candidates,['p4','p5']);
  assert.throws(()=>action(g,'p1','vote','p3'));
  votes(g,['p4','p4','p5','p5','p4','p5']);
  assert.equal(g.phase,'night');assert.equal(g.players.every(p=>p.alive),true);
  assert.equal(g.history.filter(e=>e.type==='votes').length,2);
});
test('all abstain skips runoff; highest unique plurality does not require majority', () => {
  const g=toVote(fixture());votes(g,[null,null,null,null,null,null]);assert.equal(g.phase,'night');
  const h=toVote(fixture());votes(h,['p4','p4',null,null,null,null]);
  assert.equal(h.players.find(p=>p.id==='p4').alive,false);
});
test('night consensus kills, seer action survives own death, parity ends game', () => {
  const g=toVote(fixture());votes(g,['p4','p4','p4','p1','p4',null]);next(g);
  action(g,'p3','inspect','p2');action(g,'p1','kill','p3');action(g,'p2','kill','p3');
  assert.equal(snapshot(g,'p5',g.deadline-1).me.wolfTargets,undefined);
  assert.equal(snapshot(g,'p1',g.deadline-1).me.wolfTargets.p2,'p3');
  next(g);assert.equal(g.phase,'finished');assert.equal(g.winner,'wolves');
  assert.equal(g.players.find(p=>p.id==='p3').alive,false);
  assert.equal(snapshot(g,'p3',g.deadline).me.inspections[0].team,'wolves');
  assert.equal(snapshot(g,'p4',g.deadline).players.filter(p=>p.role).length,6);
  assert.equal(snapshot(g,'p4',g.deadline).me.inspections.length,0);
});
test('disagreeing wolves do not kill; dead wolves do not hear private night', () => {
  const g=toVote(fixture());votes(g,[null,null,null,null,null,null]);
  action(g,'p1','kill','p4');action(g,'p2','kill','p5');next(g);
  assert.equal(g.players.filter(p=>p.alive).length,6);
  toVote(g);votes(g,['p2','p1','p1','p1','p1','p1']);next(g);
  assert.equal(voicePolicy(g,'p1').channel,null);
  assert.equal(snapshot(g,'p1',g.deadline-1).me.wolfTargets,undefined);
  assert.throws(()=>action(g,'p1','kill','p3'));
  action(g,'p2','kill','p4');next(g);assert.equal(g.players.find(p=>p.id==='p4').alive,false);
  assert.equal(g.phase,'speaking');
});
test('last wolf voted out finishes immediately without last words', () => {
  const g=toVote(fixture());votes(g,['p2','p1','p1','p1','p1','p1']);next(g);next(g);toVote(g);
  votes(g,[null,'p3','p2','p2','p2','p2']);assert.equal(g.phase,'finished');assert.equal(g.winner,'villagers');
});
test('deadline is authoritative and previous-phase actions cannot enter next phase', () => {
  const g=toVote(fixture());const old=g.phaseId;
  assert.throws(()=>act(g,'p1',{type:'vote',targetId:'p4',phaseId:old},g.deadline),/阶段/);
  assert.equal(g.phase,'night');
  assert.throws(()=>act(g,'p3',{type:'inspect',targetId:'p1',phaseId:old},g.deadline-1),/阶段/);
});
test('disconnect pauses remaining time and spends shared thirty-second budget only once', () => {
  const g=fixture();setConnected(g,'p1',false,5000);setConnected(g,'p2',false,8000);
  assert.equal(snapshot(g,'p3',9000).pause.remainingMs,26000);
  assert.throws(()=>action(g,'p3','pass',undefined,9000),/重连/);
  setConnected(g,'p1',true,12000);setConnected(g,'p2',true,15000);
  assert.equal(g.deadline,25000);assert.equal(g.reconnectRemaining,20000);
  tick(g,24999);assert.equal(g.phase,'identity');tick(g,25000);assert.equal(g.phase,'night');
  setConnected(g,'p4',false,26000);tick(g,45999);assert.equal(g.phase,'night');
  tick(g,46000);assert.equal(g.phase,'aborted');assert.equal(g.winner,null);
});
test('spectator disconnect does not pause, active player voice permissions fail closed', () => {
  const g=toVote(fixture());votes(g,['p4','p4','p4','p1','p4',null]);next(g);
  setConnected(g,'p4',false,g.deadline-10000);assert.equal(g.pause,null);
  assert.equal(voicePolicy(g,'p4').canPublish,false);
  assert.equal(voicePolicy(g,'p3').channel,null);
  assert.equal(voicePolicy(g,'p1').canPublish,true);
  assert.equal(voicePolicy(g,'p2').channel,voicePolicy(g,'p1').channel);
});
