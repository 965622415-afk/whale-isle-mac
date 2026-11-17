'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {State,atomic,profile,persona,prompts,preset,composePrompt}=require('./state');
const {createRuntime}=require('../src/app');
const {DEFAULT_CONFIG}=require('../src/infra/config');
const personaStore=require('../src/persona/store');
const {debugPrompt,debugSessions}=require('../src/services/debug');
const {describeError,errorMessage}=require('../src/infra/errors');
const backup=require('../src/memory/backup');
const {makePost}=require('./transport');
class Host{
 constructor({root,source,electron,emit=()=>{}}){this.root=root;this.e=electron;this.emit=emit;this.controller=null;this.probing=false;this.lastProbe=null;
  fs.mkdirSync(root,{recursive:true,mode:0o700});this.state=new State(path.join(root,'isle.json'));
  const configFile=path.join(root,'data','config.json');
  if(!fs.existsSync(configFile)){
   const c=structuredClone(DEFAULT_CONFIG);c.env={autoDetect:false,timezone:'Asia/Shanghai',location:''};c.log={...c.log,traceRaw:false};c.persona={...c.persona,name:'小屿',ownerName:'你',personality:'温和、坦诚、有自己的判断，表达自然清楚。',job:'AI 助手',appearance:'',background:'住在鲸屿的 AI 伙伴。',aliases:['小屿'],proactive:false,opinions:true};
   c.links.enabled=false;c.diary={...c.diary,enabled:false};c.moments={...c.moments,enabled:false,autoRead:false};c.group={...c.group,freeChat:false};c.gateway={};c.features={...c.features,envContext:false,webSearch:false,javascriptPlugins:false};c.plugins={...c.plugins,enabled:false};
   c.admin={...c.admin,spell:crypto.randomBytes(24).toString('hex')};
   atomic(configFile,c);
  }
  if(!fs.existsSync(path.join(root,'assets')))fs.cpSync(path.join(source,'assets'),path.join(root,'assets'),{recursive:true});
  this.runtime=createRuntime({root,env:{},loggerLevel:'warn'});
  // Mac 本机试聊不加载插件、微信网关、位置探测或自动发送任务。
  this.runtime.scheduler.stopAll();this.runtime.diary.stop();this.runtime.moments.stopAutoRead();this.runtime.stopLocationProbe?.();this.runtime.stopConfigWatch?.();
  this.runtime.bot.javascriptPlugins.start=()=>{};
  this.runtime.llm.switchFallback=()=>null;
  this.vaultFile=path.join(root,'keys.enc.json');this.vault=fs.existsSync(this.vaultFile)?JSON.parse(fs.readFileSync(this.vaultFile,'utf8')):{};
  this.network=this.e.session.fromPartition('isle-models');
 }
 async ready(){await this.configure();}
 idle(){if(this.controller||this.probing)throw new Error('请先停止或等待当前模型请求完成');}
 async secret(id){const b=this.vault[id];if(!b)return '';try{return (await this.e.safeStorage.decryptStringAsync(Buffer.from(b,'base64'))).result;}catch{throw new Error('密钥无法解密，请在模型设置中重新填写');}}
 async configure(){
  const p=this.state.active;const key=await this.secret(p.id);const cfg=this.runtime.config;
  cfg.provider=p.provider;cfg.llm={provider:p.provider,apiKey:key,baseUrl:p.baseUrl,model:p.model};cfg.deepseek={...cfg.deepseek,provider:p.provider,baseUrl:p.baseUrl,model:p.model,apiKey:key,mock:false,temperature:p.temperature,timeoutMs:p.timeout*1000,thinking:p.thinking};
  this.runtime.llm.reload();this.runtime.llm._post=makePost(this.e.net,()=>this.network,()=>this.state.active.timeout*1000);
  await this.network.setProxy(p.proxyMode==='manual'?{mode:'fixed_servers',proxyRules:p.proxyUrl,proxyBypassRules:'<local>'}:{mode:p.proxyMode==='system'?'system':'direct'});
  await this.network.closeAllConnections();
 }
 view(){const d=this.state.data;return {version:require('./package.json').version,activeProfile:d.activeProfile,profiles:d.profiles.map(p=>({...p,hasKey:Boolean(this.vault[p.id])})),persona:personaStore.summary(this.runtime.config),prompts:d.prompts,presets:d.presets.map(p=>({id:p.id,name:p.name})),sessionId:d.sessionId,busy:Boolean(this.controller||this.probing),lastProbe:this.lastProbe,hasKey:Boolean(this.vault[this.state.active.id]),mock:this.runtime.llm.isMock,memory:this.runtime.store.summary(),dataDir:this.root,platform:process.platform,arch:process.arch};}
 async modelSave(input){this.idle();const p=profile(input);const old=this.state.data.profiles.find(x=>x.id===p.id);
  // 不允许把某服务的旧密钥静默发送到另一个 API 地址。
  if(old&&old.baseUrl!==p.baseUrl&&this.vault[p.id]&&!input.apiKey&&!input.clearKey)throw new Error('API 地址已改变，请重新填写密钥，或先清除旧密钥');
  const v={...this.vault};
  if(input.apiKey){if(typeof input.apiKey!=='string'||input.apiKey.length>4096)throw new Error('密钥格式无效');if(!await this.e.safeStorage.isAsyncEncryptionAvailable())throw new Error('系统密钥加密不可用，未保存密钥');v[p.id]=(await this.e.safeStorage.encryptStringAsync(input.apiKey.trim())).toString('base64');}
  if(input.clearKey)delete v[p.id];
  atomic(this.vaultFile,v);this.vault=v;
  this.state.data.profiles=this.state.data.profiles.filter(x=>x.id!==p.id).concat(p);this.state.data.activeProfile=p.id;this.state.save();await this.configure();this.lastProbe=null;return this.view();
 }
 async invoke(action,input={}){
  switch(action){
   case 'state':return this.view();
   case 'model-save':return this.modelSave(input);
   case 'model-select':this.idle();if(!this.state.data.profiles.some(p=>p.id===input.id))throw new Error('模型不存在');this.state.data.activeProfile=input.id;this.state.save();await this.configure();this.lastProbe=null;return this.view();
   case 'key-clear':this.idle();delete this.vault[input.id];atomic(this.vaultFile,this.vault);await this.configure();return this.view();
   case 'model-delete':this.idle();if(this.state.data.profiles.length<2)throw new Error('至少保留一个模型配置');this.state.data.profiles=this.state.data.profiles.filter(p=>p.id!==input.id);delete this.vault[input.id];atomic(this.vaultFile,this.vault);if(!this.state.data.profiles.some(p=>p.id===this.state.data.activeProfile))this.state.data.activeProfile=this.state.data.profiles[0].id;this.state.save();await this.configure();return this.view();
   case 'probe':{
    this.idle();if(this.runtime.llm.isMock)throw new Error('请先填写 API 密钥；本机 Ollama 模型无需密钥');this.probing=true;const at=Date.now();
    try{const result=await this.runtime.llm.probe();this.lastProbe={ok:result.ok,elapsed:Date.now()-at,at:new Date().toISOString(),message:result.ok?'真实模型调用成功':String(result.message||'调用失败'),detail:result.ok?'':String(result.detail||'').slice(0,300)};return this.lastProbe;}
    finally{this.probing=false;}
   }
   case 'persona-save':this.idle();personaStore.save(this.runtime.config,{...persona(input),sourcePreset:''});return this.view();
   case 'prompts-save':this.idle();this.state.data.prompts=prompts(input);this.state.save();return this.view();
   case 'prompt-preview':{const cfg=this.runtime.config,old=cfg.persona.customPrompt;cfg.persona.customPrompt=composePrompt(this.state.data.prompts,input.mode);try{return await debugPrompt(this.runtime,{chatType:input.mode,text:input.text||'你好',senderName:cfg.persona.ownerName});}finally{cfg.persona.customPrompt=old;}}
   case 'preset-save':{this.idle();const p=preset({schemaVersion:1,kind:'whale-isle-persona',name:input.name,persona:personaStore.summary(this.runtime.config),prompts:this.state.data.prompts});this.state.data.presets.push(p);this.state.save();return this.view();}
   case 'preset-apply':{this.idle();const p=this.state.data.presets.find(p=>p.id===input.id);if(!p)throw new Error('预设不存在');personaStore.save(this.runtime.config,{...p.persona,sourcePreset:'',customPrompt:''});this.state.data.prompts=prompts(p.prompts);this.state.save();return this.view();}
   case 'preset-delete':this.idle();this.state.data.presets=this.state.data.presets.filter(p=>p.id!==input.id);this.state.save();return this.view();
   case 'preset-import':{this.idle();const r=await this.e.dialog.showOpenDialog({title:'导入鲸屿预设',filters:[{name:'鲸屿预设',extensions:['json']}],properties:['openFile']});if(r.canceled)return this.view();const file=r.filePaths[0];if(fs.statSync(file).size>200000)throw new Error('预设文件过大');const p=preset(JSON.parse(fs.readFileSync(file,'utf8')));this.state.data.presets.push(p);this.state.save();return this.view();}
   case 'preset-export':{const p={schemaVersion:1,kind:'whale-isle-persona',name:this.runtime.config.persona.name,persona:persona(personaStore.summary(this.runtime.config)),prompts:this.state.data.prompts};const r=await this.e.dialog.showSaveDialog({title:'导出人设与提示词（不含密钥）',defaultPath:'whale-isle-preset.json',filters:[{name:'JSON',extensions:['json']}]});if(!r.canceled)atomic(r.filePath,p);return {ok:!r.canceled};}
   case 'chat':return this.chat(input);
   case 'chat-stop':this.controller?.abort();return {ok:true};
   case 'chat-new':this.idle();this.state.data.sessionId=crypto.randomUUID();this.state.save();return this.view();
   case 'memory-list':return debugSessions(this.runtime).map(c=>({...c,title:(c.chatType==='group'?'群聊模拟':'私聊模拟')+(c.key.endsWith(':demo')?' · 演示':' · 模型对话')}));
   case 'chat-history':{const mode=input.mode==='group'?'group':'private';const key=this.chatKey(mode,input.demo===true);return this.runtime.store.chatStore.chats.has(key)?this.runtime.store.messages(key,150).map(m=>({role:m.role,text:m.text,error:m.error===true,meta:(input.demo?'本地演示 · ':'')+new Date(m.ts).toLocaleTimeString('zh-CN')})):[];}
   case 'memory-backup':{this.idle();const r=await this.e.dialog.showSaveDialog({title:'备份本机试聊与记忆',defaultPath:'whale-isle-memory.json',filters:[{name:'JSON',extensions:['json']}]});if(!r.canceled)backup.exportTo(this.root,r.filePath,{withSecrets:false});return {ok:!r.canceled};}
   case 'memory-clear':{this.idle();const key=String(input.key||'');if(!this.runtime.store.chatStore.chats.has(key))throw new Error('会话不存在');const r=await this.e.dialog.showMessageBox({type:'warning',buttons:['取消','备份并清空'],defaultId:0,cancelId:0,message:'清空这个会话的本机记忆？',detail:'清空前会在应用数据目录中保存备份，其他会话不受影响。'});if(r.response===1){backup.writeSnapshot(this.root,'before-clear');this.runtime.store.resetSession(key);}return debugSessions(this.runtime);}
   case 'logs':{const f=path.join(this.root,'data','whale.log');return fs.existsSync(f)?require('../src/infra/redact').redactSecrets(fs.readFileSync(f,'utf8').slice(-20000)).split('\n').slice(-100).join('\n'):'暂时没有诊断日志';}
   case 'open-data':await this.e.shell.openPath(this.root);return {ok:true};
   case 'about':return {name:'鲸屿 · AI 配置中心',upstream:'https://github.com/Banan1cee/whale_girl',repository:'https://github.com/965622415-afk/whale-isle-mac',license:'AGPL-3.0-only',wechat:false};
   default:throw new Error('不支持此操作');
  }
 }
 chatKey(mode,demo){return 'web:'+(mode==='group'?'g':'u')+':isle-'+this.state.data.sessionId+':'+mode+(demo?':demo':'');}
 async chat(input){
  this.idle();const text=String(input.text||'').trim();if(!text||text.length>2000)throw new Error('消息请填写 1–2000 字符');
  const demo=input.demo===true;if(!demo&&this.runtime.llm.isMock)throw new Error('尚未配置模型密钥。可先选择“演示模式”检查本机对话流程。');
  const controller=new AbortController();this.controller=controller;const cfg=this.runtime.config;const old=cfg.persona.customPrompt;const oldMock=this.runtime.llm.mock;const mode=input.mode==='group'?'group':'private';
  cfg.persona.customPrompt=composePrompt(this.state.data.prompts,mode);if(demo)this.runtime.llm.mock=true;
  const start=Date.now();let decision;
  try{
   const msg={platform:'web',chatId:'isle-'+this.state.data.sessionId+':'+mode+(demo?':demo':''),chatType:mode,senderId:'isle-local-user',senderName:cfg.persona.ownerName||'你',chatTitle:mode==='group'?'本机模拟群聊':'',text,atMe:true,msgId:crypto.randomUUID()};
   decision=await this.runtime.bot.decide(msg);
   if(decision.action==='ignore')return {text:'本轮未回复：'+decision.reason,skipped:true};
   this.emit({type:'prompt',system:decision.system||'',turns:decision.turns||[]});
   let full=decision.canned||decision.text||'';
   if(!full)for await(const piece of this.runtime.bot.generate(decision,{signal:controller.signal})){if(controller.signal.aborted)throw new Error('请求已停止');full+=piece;this.emit({type:'delta',text:piece});}
   if(controller.signal.aborted)throw new Error('请求已停止');
   const bubbles=this.runtime.bot.finalize(decision,full);const reply=decision.finalText||bubbles?.join('\n')||full;
   return {text:reply,demo,elapsed:Date.now()-start,usage:this.runtime.llm.lastUsage||null};
  }catch(err){if(decision)this.runtime.bot.finalize(decision,'',{error:true});if(controller.signal.aborted)throw new Error('请求已停止');this.runtime.logger.warn('本机试聊失败：'+describeError(err));throw new Error(errorMessage(err)+' '+describeError(err));}
  finally{cfg.persona.customPrompt=old;this.runtime.llm.mock=oldMock;this.controller=null;}
 }
 async close(){this.controller?.abort();this.runtime.scheduler.stopAll();this.runtime.diary.stop();this.runtime.moments.stopAutoRead();this.runtime.stopConfigWatch?.();this.runtime.stopLocationProbe?.();await this.runtime.bot.javascriptPlugins.stop();this.runtime.store.close();this.runtime.logger.close();this.runtime.loopProbe?.stop();}
}
module.exports={Host};
