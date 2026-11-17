'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const PERSONA_FIELDS = ['name','ownerName','age','job','appearance','personality','background','privateMaxChars','groupMaxChars','historyTurns','groupHistoryTurns','emoji','proactive','opinions','masterRoast'];
const PROMPT_FIELDS = ['role','style','private','group','boundaries'];
function atomic(file, data) {
  fs.mkdirSync(path.dirname(file), {recursive:true, mode:0o700});
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  try { fs.writeFileSync(temp, JSON.stringify(data,null,2)+'\n',{mode:0o600}); fs.renameSync(temp,file); }
  finally { try { fs.unlinkSync(temp); } catch {} }
}
function text(value, max=24000) { if (typeof value !== 'string') throw new Error('字段必须是文本'); if(value.length>max) throw new Error('文本超过允许长度'); return value; }
function prompts(value={}) { const out={}; for(const k of PROMPT_FIELDS) out[k]=text(value[k]??''); return out; }
function persona(value={}) {
  const out={};
  for(const k of PERSONA_FIELDS) {
    if(value[k]===undefined) continue;
    if(['proactive','opinions','masterRoast'].includes(k)) { if(typeof value[k]!=='boolean') throw new Error('开关值不正确'); out[k]=value[k]; }
    else if(['age','privateMaxChars','groupMaxChars','historyTurns','groupHistoryTurns'].includes(k)) {
      const ranges={age:[1,120],privateMaxChars:[40,800],groupMaxChars:[20,300],historyTurns:[4,120],groupHistoryTurns:[2,100]};
      const n=Number(value[k]),[min,max]=ranges[k]; if(!Number.isInteger(n)||n<min||n>max)throw new Error(k+' 超出范围');out[k]=n;
    } else out[k]=text(value[k],k==='name'||k==='ownerName'?40:5000);
  }
  if('name' in out&&!out.name.trim())throw new Error('角色名称不能为空');
  return out;
}
function profile(value) {
  if(!value||typeof value!=='object')throw new Error('模型配置无效');
  const id=text(value.id||crypto.randomUUID(),80); if(!/^[\w-]+$/.test(id))throw new Error('模型标识无效');
  const url=new URL(text(value.baseUrl,500));
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('请使用不含凭据或查询参数的 HTTP(S) API 地址');
  if(url.protocol==='http:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('远程 API 必须使用 HTTPS，本机模型可以使用 HTTP');
  const model=text(value.model,120).trim();if(!model)throw new Error('请填写模型名称');
  const proxyMode=['direct','system','manual'].includes(value.proxyMode)?value.proxyMode:'direct';
  const proxyUrl=text(value.proxyUrl||'http://127.0.0.1:7897',300);
  if(proxyMode==='manual'){const p=new URL(proxyUrl);if(p.protocol!=='http:'||p.username||p.password||p.pathname!=='/'||p.search||p.hash)throw new Error('代理请填写 HTTP 地址，例如 http://127.0.0.1:7897');}
  const timeout=Number(value.timeout||120);if(!Number.isInteger(timeout)||timeout<10||timeout>600)throw new Error('超时请设为 10–600 秒');
  const temperature=Number(value.temperature??0.8);if(!Number.isFinite(temperature)||temperature<0||temperature>2)throw new Error('温度请设为 0–2');
  return {id,name:text(value.name||model,80),provider:['deepseek','custom','ollama'].includes(value.provider)?value.provider:'custom',baseUrl:url.href.replace(/\/$/,''),model,proxyMode,proxyUrl,timeout,temperature,thinking:value.thinking===true};
}
function defaults(){return {schemaVersion:1,activeProfile:'deepseek',profiles:[
  {id:'deepseek',name:'DeepSeek',provider:'deepseek',baseUrl:'https://api.deepseek.com',model:'deepseek-flash',proxyMode:'direct',proxyUrl:'http://127.0.0.1:7897',timeout:120,temperature:0.8,thinking:false},
  {id:'openai',name:'OpenAI',provider:'custom',baseUrl:'https://api.openai.com/v1',model:'gpt-5-mini',proxyMode:'manual',proxyUrl:'http://127.0.0.1:7897',timeout:180,temperature:1,thinking:false}
],prompts:{role:'',style:'',private:'',group:'',boundaries:''},presets:[],sessionId:crypto.randomUUID()};}
class State {
 constructor(file){this.file=file;this.data=defaults();if(fs.existsSync(file)){let saved;try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new Error('本机配置损坏，请先备份并修复，应用没有覆盖原文件');}if(saved.schemaVersion!==1)throw new Error('不支持此版本配置');this.data={...this.data,...saved,profiles:saved.profiles.map(profile),prompts:prompts(saved.prompts)};} }
 save(){atomic(this.file,this.data);}
 get active(){return this.data.profiles.find(p=>p.id===this.data.activeProfile)||this.data.profiles[0];}
}
function composePrompt(p,mode){const labels={role:'角色设定',style:'表达风格',private:'私聊规则',group:'群聊规则',boundaries:'行为边界'};return ['role','style',mode==='group'?'group':'private','boundaries'].filter(k=>p[k]?.trim()).map(k=>'【'+labels[k]+'】\n'+p[k].trim()).join('\n\n');}
function preset(input){if(!input||input.schemaVersion!==1||input.kind!=='whale-isle-persona')throw new Error('请选择鲸屿导出的预设 JSON');return {id:crypto.randomUUID(),name:text(input.name||'导入的预设',80),persona:persona(input.persona),prompts:prompts(input.prompts)};}
module.exports={State,atomic,profile,persona,prompts,preset,composePrompt,defaults};
