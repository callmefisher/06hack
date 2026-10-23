'use strict';
const http=require('node:http');const fs=require('node:fs/promises');const path=require('node:path');const {randomUUID}=require('node:crypto');const {WebSocketServer,WebSocket}=require('ws');
const {AuthService}=require('./auth');const {RoomService}=require('./rooms');
const KNOWN=new Set(['create','join','leave','ready','voiceReady','start','pass','vote','inspect','kill']);
function problem(message,code='BAD_REQUEST'){const e=new Error(message);e.code=code;return e;}
function createServer({devMode=false,appId,appSecret,now=Date.now,fetch:fetcher,allowedOrigins=[]}={}){
  if(!devMode&&(!appId||!appSecret))throw new Error('生产模式需要配置 WX_APP_ID 与 WX_APP_SECRET');
  const rooms=new RoomService({now,devMode}),auth=new AuthService({devMode,appId,appSecret,fetch:fetcher,now});const sockets=new Map(),rates=new Map();
  const rate=(key,limit,windowMs)=>{const time=Date.now();let bucket=rates.get(key);if(!bucket||time>=bucket.until){bucket={count:0,until:time+windowMs};rates.set(key,bucket);}return ++bucket.count<=limit;};
  const originAllowed=req=>{const origin=req.headers.origin;if(!origin)return true;try{const url=new URL(origin);return url.host===req.headers.host||allowedOrigins.includes(origin);}catch{return false;}};
  const reply=(res,status,data)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(data));};
  const send=(ws,data)=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>1024*1024){ws.terminate();return;}ws.send(JSON.stringify(data));}};
  const publicError=e=>({code:typeof e.code==='string'?e.code:'INTERNAL_ERROR',message:typeof e.code==='string'?e.message:'服务暂不可用，请稍后重试'});
  const broadcast=()=>{rooms.tick();for(const [id,entry] of sockets){let room=null;try{room=rooms.view(id);}catch(e){if(e.code!=='NO_ROOM')continue;}send(entry.ws,{type:'state',room});}};
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost');if(!originAllowed(req)){reply(res,403,{message:'请求来源不允许'});return;}
      if(url.pathname==='/health'&&req.method==='GET'){reply(res,200,{ok:true,mode:devMode?'development':'production',voiceAvailable:false});return;}
      if(url.pathname==='/api/session'&&req.method==='POST'){
        if(!rate(`login:${req.socket.remoteAddress}`,30,60000)){reply(res,429,{message:'登录过于频繁，请稍后重试'});return;}
        if(!(req.headers['content-type']??'').startsWith('application/json')){reply(res,415,{message:'请发送 JSON'});return;}
        let text='';let length=0;for await(const chunk of req){length+=chunk.length;if(length>4096){reply(res,413,{message:'请求过大'});return;}text+=chunk;}
        let body;try{body=JSON.parse(text);}catch{throw problem('请求格式无效');}if(!body||typeof body!=='object'||Array.isArray(body))throw problem('请求格式无效');
        reply(res,200,await auth.login(body));return;
      }
      const files={'/':'dev/index.html','/client.js':'dev/client.js','/style.css':'dev/style.css','/presentation.js':'shared/presentation.js','/connection.js':'miniprogram/services/connection.js'};
      if(devMode&&req.method==='GET'&&files[url.pathname]){
        try{const file=files[url.pathname];const content=await fs.readFile(path.resolve(__dirname,'..',file));res.writeHead(200,{'content-type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'application/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"});res.end(content);}catch{reply(res,404,{message:'页面不存在'});}return;
      }
      reply(res,404,{message:'页面不存在'});
    }catch(e){if(!res.headersSent)reply(res,400,publicError(e));else res.end();}
  });
  const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/ws'||!originAllowed(req)||!rate(`connect:${req.socket.remoteAddress}`,60,60000)){socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  });
  wss.on('connection',ws=>{
    let user=null,token=null,alive=true;const connectionId=randomUUID(),requests=new Set();let count=0,windowStart=Date.now();
    const timeout=setTimeout(()=>{if(!user)ws.close(4001,'Authentication required');},5000);timeout.unref();
    ws.on('error',()=>{});ws.on('pong',()=>{alive=true;});
    ws.on('message',(raw,isBinary)=>{
      let requestId;
      try {
        if(Date.now()-windowStart>=10000){windowStart=Date.now();count=0;}if(++count>60){ws.close(4008,'Rate limited');return;}
        if(isBinary)throw problem('只接受 JSON 命令');let msg;try{msg=JSON.parse(raw.toString());}catch{throw problem('请求格式无效');}if(!msg||typeof msg!=='object'||Array.isArray(msg))throw problem('请求格式无效');requestId=typeof msg.requestId==='string'?msg.requestId:undefined;
        if(!user){if(msg.type!=='authenticate')throw problem('请先登录','AUTH_REQUIRED');user=auth.authenticate(msg.token);token=msg.token;clearTimeout(timeout);const prior=sockets.get(user.id);sockets.set(user.id,{ws,connectionId});rooms.attach(user.id,connectionId);if(prior)prior.ws.close(4009,'Connected elsewhere');send(ws,{type:'authenticated',user,devMode});broadcast();return;}
        auth.authenticate(token);if(sockets.get(user.id)?.connectionId!==connectionId)throw problem('连接已被替换','CONNECTION_REPLACED');
        if(!requestId||!/^[a-zA-Z0-9_-]{1,80}$/.test(requestId))throw problem('命令缺少有效请求编号');if(requests.has(requestId))throw problem('请勿重复提交同一请求','DUPLICATE_REQUEST');requests.add(requestId);if(requests.size>500)requests.delete(requests.values().next().value);
        if(!KNOWN.has(msg.type))throw problem('未知命令');
        if(msg.type==='create')rooms.create(user);else if(msg.type==='join')rooms.join(msg.code,user);else rooms.command(user.id,{type:msg.type,ready:msg.ready,targetId:msg.targetId,phaseId:msg.phaseId});
        send(ws,{type:'ack',requestId});broadcast();
      } catch(e){send(ws,{type:'error',requestId,...publicError(e)});if(['SESSION_EXPIRED','CONNECTION_REPLACED'].includes(e.code))ws.close(4001,'Session expired');}
    });
    ws.on('close',()=>{clearTimeout(timeout);if(user&&sockets.get(user.id)?.connectionId===connectionId){sockets.delete(user.id);rooms.detach(user.id,connectionId);broadcast();}});
    ws.isResponsive=()=>alive;ws.markPing=()=>{alive=false;ws.ping();};
  });
  const timer=setInterval(broadcast,250);timer.unref();
  const heartbeat=setInterval(()=>{for(const ws of wss.clients){if(!ws.isResponsive())ws.terminate();else ws.markPing();}const time=Date.now();for(const [key,bucket] of rates){if(bucket.until<=time)rates.delete(key);}},10000);heartbeat.unref();
  const close=async()=>{clearInterval(timer);clearInterval(heartbeat);for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>wss.close(resolve));if(server.listening)await new Promise(resolve=>server.close(resolve));};
  return {server,rooms,close};
}
if(require.main===module){const devMode=process.argv.includes('--dev');const port=Number(process.env.PORT??8787);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 必须为有效端口');const app=createServer({devMode,appId:process.env.WX_APP_ID,appSecret:process.env.WX_APP_SECRET,allowedOrigins:(process.env.ALLOWED_ORIGINS??'').split(',').filter(Boolean)});app.server.listen(port,devMode?'127.0.0.1':process.env.HOST??'127.0.0.1',()=>console.log(`六人好友局 ${devMode?'开发联调（无真实语音）':'服务'}: http://127.0.0.1:${port}`));for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>app.close().then(()=>process.exit(0)));}
module.exports={createServer};
