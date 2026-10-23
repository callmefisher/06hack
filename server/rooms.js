'use strict';
const {randomInt}=require('node:crypto');
const game=require('./game');
function fail(message,code='INVALID_ACTION'){const e=new Error(message);e.code=code;throw e;}
class RoomService {
  constructor({now=Date.now,devMode=false}={}){this.now=now;this.devMode=devMode;this.rooms=new Map();this.membership=new Map();this.connections=new Map();}
  active(room){return room.game&&!game.terminal(room.game);}
  roomFor(id){const room=this.rooms.get(this.membership.get(id));if(!room)fail('你还没有进入房间','NO_ROOM');return room;}
  add(room,user){const player={id:user.id,name:user.name,seat:room.players.length+1,ready:false,voiceReady:false,connected:this.connections.has(user.id),disconnectedAt:this.connections.has(user.id)?null:this.now()};room.players.push(player);this.membership.set(user.id,room.code);room.updatedAt=this.now();}
  create(user){if(this.membership.has(user.id))return this.view(user.id);if(this.rooms.size>=200)fail('房间繁忙，请稍后再试','CAPACITY');let code;do{code=String(randomInt(100000,1000000));}while(this.rooms.has(code));const room={code,hostId:user.id,players:[],game:null,updatedAt:this.now()};this.rooms.set(code,room);this.add(room,user);return this.view(user.id);}
  join(code,user){if(typeof code!=='string'||!/^\d{6}$/.test(code))fail('请输入六位房间号');const room=this.rooms.get(code);if(!room)fail('房间不存在或已经关闭','ROOM_NOT_FOUND');const current=this.membership.get(user.id);if(current===code)return this.view(user.id);if(current)fail('请先离开当前房间');if(this.active(room))fail('游戏正在进行，暂时不能加入');if(room.players.length>=6)fail('房间已满');this.add(room,user);return this.view(user.id);}
  attach(id,connectionId){this.connections.set(id,connectionId);const room=this.rooms.get(this.membership.get(id));if(!room)return;const p=room.players.find(x=>x.id===id);p.connected=true;p.disconnectedAt=null;if(room.game)game.setConnected(room.game,id,true,this.now());}
  detach(id,connectionId){if(this.connections.get(id)!==connectionId)return;this.connections.delete(id);const room=this.rooms.get(this.membership.get(id));if(!room)return;const p=room.players.find(x=>x.id===id);p.connected=false;p.ready=false;p.voiceReady=false;p.disconnectedAt=this.now();if(room.game)game.setConnected(room.game,id,false,this.now());}
  remove(room,id){this.membership.delete(id);room.players=room.players.filter(p=>p.id!==id);room.players.forEach((p,i)=>p.seat=i+1);if(room.hostId===id)room.hostId=room.players.find(p=>p.connected)?.id??room.players[0]?.id??null;if(!room.players.length)this.rooms.delete(room.code);}
  command(id,cmd){const room=this.roomFor(id);const p=room.players.find(x=>x.id===id);const now=this.now();if(room.game)game.tick(room.game,now);room.updatedAt=now;
    if(cmd.type==='leave'){if(this.active(room)){this.detach(id,this.connections.get(id));return;}this.remove(room,id);return;}
    if(cmd.type==='ready'||cmd.type==='voiceReady'){
      if(this.active(room))fail('对局中不能修改准备状态');if(typeof cmd.ready!=='boolean')fail('准备状态无效');
      if(cmd.type==='voiceReady'){if(!this.devMode&&cmd.ready)fail('真实语音尚未接通，不能确认就绪','VOICE_UNAVAILABLE');p.voiceReady=cmd.ready;if(!cmd.ready)p.ready=false;return;}
      if(cmd.ready&&(!p.voiceReady||!p.connected))fail('请先完成语音连接并保持在线','VOICE_REQUIRED');p.ready=cmd.ready;return;
    }
    if(cmd.type==='start'){
      if(room.hostId!==id)fail('只有房主可以开始');if(this.active(room))fail('对局已经开始');if(room.players.length!==6||!room.players.every(x=>x.ready&&x.connected&&x.voiceReady))fail('需要六人到齐并全部准备');
      room.game=game.createGame(room.players,{now});room.players.forEach(x=>x.ready=false);return;
    }
    if(!room.game)fail('游戏尚未开始');game.act(room.game,id,cmd,now);
  }
  view(id){const room=this.roomFor(id);const now=this.now();if(room.game)game.tick(room.game,now);return {code:room.code,hostId:room.hostId,meId:id,devMode:this.devMode,voiceAvailable:false,serverNow:now,players:room.players.map(p=>({id:p.id,name:p.name,seat:p.seat,ready:p.ready,voiceReady:p.voiceReady,connected:p.connected})),game:room.game?game.snapshot(room.game,id,now):null};}
  tick(){const now=this.now();for(const room of this.rooms.values()){const wasActive=this.active(room);if(room.game)game.tick(room.game,now);if(wasActive&&!this.active(room)){for(const p of room.players){p.ready=false;if(!p.connected)p.disconnectedAt=now;}}if(!this.active(room)){for(const p of [...room.players]){if(!p.connected&&p.disconnectedAt!==null&&now-p.disconnectedAt>=30000)this.remove(room,p.id);}}}}
}
module.exports={RoomService};
