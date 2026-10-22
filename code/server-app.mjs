import http from 'node:http';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {workflow,callModel,demo} from './workflow.mjs';
import {providers,providerConfig,resolveConfig} from './providers.mjs';
import {defaultWorkflowConfig,validateWorkflowConfig} from './workflow-config.mjs';

function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>512000)throw Error('请求过大');}return JSON.parse(text);}

export async function createWorkflowServer({storage=new URL('./data/',import.meta.url),env=process.env,modelCall=callModel,demoDelay=500}={}){
 await mkdir(storage,{recursive:true});
 const historyFile=new URL('history.json',storage),temporaryFile=new URL('history.tmp',storage);
 let history=[];
 try{history=JSON.parse(await readFile(historyFile,'utf8'));if(!Array.isArray(history))throw Error('历史记录格式错误');}
 catch(e){if(e.code!=='ENOENT')throw Error('历史记录无法读取，请备份并检查code/data/history.json');}
 history=history.map(s=>s.status==='running'?{...s,status:'interrupted',error:'上次服务退出，选择历史记录可恢复'}:s);
 let busy=false,last=history[0]||null,controller,saveQueue=Promise.resolve();
 const save=state=>{
  const snapshot=structuredClone(state);
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
   history=[snapshot,...history.filter(x=>x.id!==snapshot.id)].slice(0,30);
   await writeFile(temporaryFile,JSON.stringify(history,null,2));await rename(temporaryFile,historyFile);
  });
  return saveQueue;
 };
 const server=http.createServer(async(req,res)=>{
  if(!/^((127\.0\.0\.1|localhost)(:\d+)?)$/.test(req.headers.host||'')){json(res,403,{error:'仅允许本机访问'});return;}
  if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){json(res,403,{error:'不允许跨站请求'});return;}
  try{
   if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(new URL('../index.html',import.meta.url)));return;}
   if(req.method==='GET'&&(req.url==='/app.js'||req.url==='/code/app.js')){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(await readFile(new URL('./app.js',import.meta.url)));return;}
   if(req.method==='GET'&&req.url==='/code/view-state.mjs'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(await readFile(new URL('./view-state.mjs',import.meta.url)));return;}
   if(req.method==='GET'&&req.url==='/code/custom-config.mjs'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(await readFile(new URL('./custom-config.mjs',import.meta.url)));return;}
   if(req.method==='GET'&&req.url==='/code/graph-canvas.mjs'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(await readFile(new URL('./graph-canvas.mjs',import.meta.url)));return;}
   if(req.method==='GET'&&req.url==='/api/config'){json(res,200,{provider:env.LLM_PROVIDER||'qwen',workflow:defaultWorkflowConfig,customWorkflow:true,providers:Object.fromEntries(Object.keys(providers).map(id=>{const c=providerConfig(id,env);return [id,{name:c.name,model:c.model,hasKey:!!c.key}];})),busy});return;}
   if(req.method==='GET'&&req.url==='/api/history'){json(res,200,history);return;}
   if(req.method==='POST'&&req.url==='/api/cancel'){controller?.abort(new Error('用户停止执行'));json(res,200,{ok:true});return;}
   if(req.method!=='POST'||req.url!=='/api/run'){json(res,404,{error:'未找到接口'});return;}
   if(busy){json(res,409,{error:'已有流程正在运行'});return;}
   busy=true;
   try{
    const data=await body(req);
    if(typeof data.task!=='string'||!data.task.trim()||data.task.length>8000)throw Error('请输入1至8000字需求');
    const {key,model,base,provider,maxTokens}=resolveConfig(data,env);
    const initial=data.resume?history.find(x=>x.id===data.resumeId)||last:null;
    if(data.resume&&(!initial||initial.task!==data.task||!['failed','cancelled','interrupted'].includes(initial.status)||initial.demo!==!!data.demo||initial.model!==model||(initial.provider||'qwen')!==provider))throw Error('请选择相同需求、模式、服务商和模型的未完成记录进行恢复');
    const legacy={parallelPlanning:false,reviewEnabled:false,maxRounds:1,forceRevisionDemo:false,agentPrompts:{}};
    const config=validateWorkflowConfig(data.workflow||initial?.config||(initial?legacy:defaultWorkflowConfig));
    if(initial&&JSON.stringify(config)!==JSON.stringify(validateWorkflowConfig(initial.config||legacy)))throw Error('恢复时流程编排必须与原记录一致，请恢复原配置或新建运行');
    if(config.forceRevisionDemo&&!data.demo)throw Error('强制修订仅用于离线演示，请关闭该选项');
    controller=new AbortController();const signal=controller.signal;
    res.on('close',()=>{if(!res.writableEnded)controller?.abort(new Error('客户端连接已断开'));});
    res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'});
    const usage=structuredClone(initial?.usage||{});
    const decorate=state=>Object.assign(state,{demo:!!data.demo,model,provider,usage:structuredClone(usage)});
    const emit=e=>{
     if(e.type==='usage'){
      const previous=usage[e.agent]||{};
      usage[e.agent]={prompt_tokens:(previous.prompt_tokens||0)+(e.usage.prompt_tokens||0),completion_tokens:(previous.completion_tokens||0)+(e.usage.completion_tokens||0),total_tokens:(previous.total_tokens||0)+(e.usage.total_tokens||0),calls:(previous.calls||0)+1};
     }
     if(e.state)decorate(e.state);
     if(!res.destroyed)res.write(JSON.stringify(e)+'\n');
    };
    last=await workflow({task:data.task,initial,config,signal,emit,checkpoint:async state=>{decorate(state);await save(state);},call:async(a,input)=>{
     if(data.demo){await delay(demoDelay,undefined,{signal});return demo(a,input);}
     return modelCall(a,input,{key,model,base,provider,maxTokens,emit,signal});
    }});
    decorate(last);await save(last);res.end();
   }catch(e){if(!res.headersSent)json(res,400,{error:e.message});else if(!res.destroyed)res.end(JSON.stringify({type:'error',error:e.message})+'\n');}
   finally{busy=false;controller=null;}
  }catch(e){if(!res.headersSent)json(res,500,{error:e.message});else res.end();}
 });
 return server;
}
