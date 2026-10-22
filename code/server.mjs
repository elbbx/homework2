import http from 'node:http';
import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {workflow,callModel,demo} from './workflow.mjs';
import {providers,providerConfig,resolveConfig} from './providers.mjs';
const storage=new URL('./data/',import.meta.url);
await mkdir(storage,{recursive:true});
let history=[];
try{history=JSON.parse(await readFile(new URL('history.json',storage),'utf8'));}catch(e){if(e.code!=='ENOENT')console.warn('历史记录无法读取，使用空列表');}
let busy=false,last=history[0]||null,controller;
async function save(state){history=[state,...history.filter(x=>x.id!==state.id)].slice(0,30);await writeFile(new URL('history.tmp',storage),JSON.stringify(history,null,2));await rename(new URL('history.tmp',storage),new URL('history.json',storage));}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function body(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>50000)throw Error('请求过大');}return JSON.parse(text);}
const server=http.createServer(async(req,res)=>{
 if(!/^((127\.0\.0\.1|localhost)(:\d+)?)$/.test(req.headers.host||'')){json(res,403,{error:'仅允许本机访问'});return;}
 if(req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`){json(res,403,{error:'不允许跨站请求'});return;}
 if(req.method==='GET'&&(req.url==='/'||req.url==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(await readFile(new URL('../index.html',import.meta.url)));return;}
 if(req.method==='GET'&&(req.url==='/app.js'||req.url==='/code/app.js')){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8'});res.end(await readFile(new URL('./app.js',import.meta.url)));return;}
 if(req.method==='GET'&&req.url==='/api/config'){json(res,200,{provider:process.env.LLM_PROVIDER||'qwen',providers:Object.fromEntries(Object.keys(providers).map(id=>{const c=providerConfig(id);return [id,{name:c.name,model:c.model,hasKey:!!c.key}];})),busy});return;}
 if(req.method==='GET'&&req.url==='/api/history'){json(res,200,history);return;}
 if(req.method==='POST'&&req.url==='/api/cancel'){controller?.abort(new Error('用户停止执行'));json(res,200,{ok:true});return;}
 if(req.method!=='POST'||req.url!=='/api/run'){json(res,404,{error:'未找到接口'});return;}
 if(busy){json(res,409,{error:'已有流程正在运行'});return;}
 // Reserve before reading body, so concurrent requests cannot both start.
 busy=true;
 try{
  const data=await body(req);
  if(typeof data.task!=='string'||!data.task.trim()||data.task.length>8000)throw Error('请输入1至8000字需求');
  const {key,model,base,provider}=resolveConfig(data);
  const initial=data.resume?history.find(x=>x.id===data.resumeId)||last:null;
  if(data.resume&&(!initial||initial.task!==data.task||!['failed','cancelled'].includes(initial.status)||initial.demo!==!!data.demo||initial.model!==model||(initial.provider||'qwen')!==provider))throw Error('请选择相同需求、模式、服务商和模型的未完成记录进行恢复');
  controller=new AbortController();const signal=controller.signal;
  res.on('close',()=>{if(!res.writableEnded)controller?.abort(new Error('客户端连接已断开'));});
  res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8','Cache-Control':'no-store'});
  const usage=structuredClone(initial?.usage||{});
  const emit=e=>{
   if(e.type==='usage')usage[e.agent]=e.usage;
   if(e.state){e.state.demo=!!data.demo;e.state.model=model;e.state.provider=provider;e.state.usage=structuredClone(usage);}
   if(!res.destroyed)res.write(JSON.stringify(e)+'\n');
  };
  last=await workflow({task:data.task,initial,signal,emit,call:async(a,input)=>data.demo?(await new Promise(r=>setTimeout(r,700)),demo(a,input)):callModel(a,input,{key,model,base,provider,emit,signal})});
  last.demo=!!data.demo;last.model=model;last.provider=provider;last.usage=usage;
  await save(last);res.end();
 }catch(e){if(!res.headersSent)json(res,400,{error:e.message});else if(!res.destroyed)res.end(JSON.stringify({type:'error',error:e.message})+'\n');}finally{busy=false;controller=null;}
});
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已占用。如果已有作业服务，请直接打开 http://127.0.0.1:'+(process.env.PORT||3000)+'，或关闭旧服务后重试。':error.message);process.exitCode=1;});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>{
 const url='http://127.0.0.1:'+server.address().port;
 console.log('Homework 2: '+url);
 if(process.env.OPEN_BROWSER==='1'&&process.platform==='win32'){
  const browser=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});
  browser.on('error',()=>console.log('请在浏览器地址栏打开 '+url));
  browser.unref();
 }
});

