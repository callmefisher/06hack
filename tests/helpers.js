'use strict';
const { createGame, act, tick } = require('../server/game');
const players = Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `朋友${i + 1}`, seat: i + 1 }));
const roles = ['wolf', 'wolf', 'seer', 'villager', 'villager', 'villager'];
function fixture() { return createGame(players, { now: 0, roles, firstSeat: 1 }); }
function next(g) { tick(g, g.deadline); return g; }
function action(g, id, type, targetId, now = g.deadline - 1) { act(g, id, { type, targetId, phaseId: g.phaseId }, now); }
function toVote(g) { while (g.phase !== 'vote' && g.phase !== 'finished') next(g); return g; }
function votes(g, targets) { targets.forEach((target, i) => { if (g.players[i].alive) action(g, `p${i + 1}`, 'vote', target); }); next(g); }
module.exports = { players, roles, fixture, next, action, toVote, votes };
