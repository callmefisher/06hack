'use strict';
const {randomBytes,createHash}=require('node:crypto');
function error(message,code='AUTH_FAILED'){const e=new Error(message);e.code=code;return e;}
function nickname(value){if(typeof value!=='string'||!value.trim()||[...value.trim()].length>24||/[\p{Cc}\p{Cf}]/u.test(value))throw error('昵称需为 1–24 个可见字符','INVALID_NAME');return value.trim();}
class AuthService {
  constructor({appId,appSecret,fetch:fetcher=globalThis.fetch,devMode=false,now=Date.now}={}){this.appId=appId;this.appSecret=appSecret;this.fetch=fetcher;this.devMode=devMode;this.now=now;this.sessions=new Map();}
  async login(body){const name=nickname(body.name);let id;
    if(this.devMode){id=randomBytes(16).toString('hex');}
    else {
      if(typeof body.code!=='string'||!body.code||body.code.length>256)throw error('请先完成微信登录');
      if(!this.appId||!this.appSecret)throw error('微信登录尚未配置','NOT_CONFIGURED');
      try {const query=new URLSearchParams({appid:this.appId,secret:this.appSecret,js_code:body.code,grant_type:'authorization_code'});const response=await this.fetch(`https://api.weixin.qq.com/sns/jscode2session?${query}`,{signal:AbortSignal.timeout(8000)});if(!response.ok)throw error('微信登录服务暂不可用');const data=await response.json();if(data.errcode||typeof data.openid!=='string'||!data.openid)throw error('微信登录失败，请重新进入');id=createHash('sha256').update(`${this.appId}:${data.openid}`).digest('hex');}
      catch(e){if(e.code==='AUTH_FAILED')throw e;throw error('微信登录暂不可用，请稍后重试');}
    }
    const now=this.now();for(const [token,s] of this.sessions){if(s.expiresAt<=now)this.sessions.delete(token);}
    if(this.sessions.size>=5000)throw error('登录繁忙，请稍后重试','CAPACITY');
    const token=randomBytes(32).toString('hex');const user={id,name};this.sessions.set(token,{user,expiresAt:now+86400000});return {token,user,devMode:this.devMode};
  }
  authenticate(token){if(typeof token!=='string')throw error('登录已失效，请重新登录');const s=this.sessions.get(token);if(!s||s.expiresAt<=this.now()){this.sessions.delete(token);throw error('登录已失效，请重新登录','SESSION_EXPIRED');}return s.user;}
}
module.exports={AuthService,nickname};
