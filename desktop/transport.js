'use strict';
// 只替换传输层，沿用上游的模型参数兼容、SSE 解析与错误分类。
const {LlmError}=require('../src/llm/client');
function makePost(net,getSession,getTimeout){
 return function post(url,{body,headers,signal}){
  return new Promise((resolve,reject)=>{
   let req,res,settled=false;
   const finish=(err)=>{if(!settled){settled=true;reject(err);} if(res&&!res.destroyed)res.destroy(err);req?.abort();};
   const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
   const abort=()=>{cleanup();finish(new LlmError('请求已停止',{code:'aborted'}));};
   const timer=setTimeout(()=>{cleanup();finish(new LlmError('请求超时，请检查代理或提高超时时间',{code:'timeout',detail:'desktop total request deadline'}));},getTimeout());
   if(signal?.aborted){abort();return;}
   signal?.addEventListener('abort',abort,{once:true});
   try{
    req=net.request({method:'POST',url:url.href,session:getSession(),redirect:'error',useSessionCookies:false});
    for(const [k,v] of Object.entries(headers))if(k.toLowerCase()!=='content-length')req.setHeader(k,v);
    req.on('response',response=>{res=response;settled=true;res.once('end',cleanup);res.once('close',cleanup);resolve({req:{destroy:()=>{cleanup();req.abort();}},res});});
    req.on('error',()=>{cleanup();finish(new LlmError('连接失败，请检查 API 地址、网络和代理',{code:'network',detail:'desktop network request failed'}));});
    req.on('login',(_info,callback)=>{callback();});
    req.end(body);
   }catch(err){cleanup();finish(err);}
  });
 };
}
module.exports={makePost};
