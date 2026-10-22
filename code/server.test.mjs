import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {once} from 'node:events';
import {createWorkflowServer} from './server-app.mjs';

const simple={parallelPlanning:false,reviewEnabled:false,maxRounds:1,forceRevisionDemo:false,agentPrompts:{}};
async function fixture(t,options={}){
 const folder=await mkdtemp(join(tmpdir(),'homework2-tests-'));
 const storage=pathToFileURL(folder+'/');const servers=[];
 async function start(extra={}){const server=await createWorkflowServer({storage,env:{},demoDelay:2,...options,...extra});servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');return {server,url:`http://127.0.0.1:${server.address().port}`};}
 t.after(async()=>{for(const server of servers)if(server.listening)await new Promise(r=>server.close(r));const rel=relative(resolve(tmpdir()),resolve(folder));assert.ok(!rel.startsWith('..')&&rel.startsWith('homework2-tests-'));await rm(folder,{recursive:true,force:true});});
 return {folder,storage,start};
}
async function request(url,path,data){return fetch(url+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
async function events(response){assert.equal(response.status,200);return (await response.text()).trim().split('\n').filter(Boolean).map(JSON.parse);}

test('HTTP: 两家服务商均跑通高级离线编排并保存配置、日志和历史',async(t)=>{
 const {start}=await fixture(t);const {url}=await start();
 const config=await(await fetch(url+'/api/config')).json();assert.equal(config.workflow.parallelPlanning,true);assert.ok(config.providers.deepseek);
 const view=await fetch(url+'/code/view-state.mjs');assert.equal(view.status,200);assert.match(view.headers.get('content-type'),/javascript/);
 assert.equal(config.customWorkflow,true);assert.equal((await fetch(url+'/code/custom-config.mjs')).status,200);
 const custom={kind:'custom',nodes:[{id:'analyze',name:'分析',role:'分析Agent',prompt:'分析输入',type:'agent',dependsOn:[]},{id:'document',name:'文档',role:'文档Agent',prompt:'输出说明',type:'agent',dependsOn:['analyze']}]};
 const customTrace=await events(await request(url,'/api/run',{task:'自定义流程',demo:true,workflow:custom}));assert.equal(customTrace.at(-1).state.status,'completed');assert.ok(customTrace.at(-1).state.outputs.document);assert.equal(customTrace.at(-1).state.config.kind,'custom');
 for(const provider of ['qwen','deepseek']){
  const trace=await events(await request(url,'/api/run',{provider,task:'完整演示',demo:true,workflow:{...config.workflow,forceRevisionDemo:true,maxRounds:2}}));
  const state=trace.at(-1).state;assert.equal(state.status,'completed');assert.equal(state.provider,provider);assert.ok(state.outputs.testplan);assert.ok(state.outputs.review);
  assert.ok(trace.some(e=>e.type==='loop'));assert.ok(trace.some(e=>e.type==='branch'));assert.ok(state.events.length);
  const history=await(await fetch(url+'/api/history')).json();assert.equal(history[0].id,state.id);assert.equal(history[0].status,'completed');assert.equal(history[0].config.reviewEnabled,true);
 }
});
test('HTTP: 节点完成即落盘，重启识别中断并跳过已完成需求节点',async(t)=>{
 let release;const gate=new Promise(r=>release=r);let entered;const waiting=new Promise(r=>entered=r);
 const f=await fixture(t,{env:{DASHSCOPE_API_KEY:'private-key-for-test'},modelCall:async(agent)=>{if(agent.id==='design'){entered();await gate;throw Error('模拟中断');}return '已完成的需求';}});
 const first=await f.start();
 const pending=request(first.url,'/api/run',{task:'恢复测试',workflow:simple});await waiting;
 const stored=JSON.parse(await readFile(join(f.folder,'history.json'),'utf8'));assert.equal(stored[0].outputs.requirements,'已完成的需求');assert.equal(stored[0].status,'running');assert.ok(!JSON.stringify(stored).includes('private-key-for-test'));
 await request(first.url,'/api/cancel',{});release();await events(await pending);
 await new Promise(r=>first.server.close(r));
 // Restore the actual in-flight checkpoint, as if the process exited abruptly.
 await writeFile(join(f.folder,'history.json'),JSON.stringify(stored));
 const called=[];const second=await f.start({modelCall:async(agent)=>{called.push(agent.id);return '恢复后的产物';}});
 const list=await(await fetch(second.url+'/api/history')).json();assert.equal(list[0].status,'interrupted');
 const trace=await events(await request(second.url,'/api/run',{task:'恢复测试',workflow:simple,resume:true,resumeId:list[0].id}));
 assert.equal(trace.at(-1).state.status,'completed');assert.deepEqual(called,['design','code']);
});
test('HTTP: 无效编排、跨站和并发请求均被拒绝',async(t)=>{
 const {start}=await fixture(t,{demoDelay:30});const {url}=await start();
 assert.equal((await request(url,'/api/run',{task:'test',demo:true,workflow:{maxRounds:99}})).status,400);
 assert.equal((await fetch(url+'/api/history',{headers:{Origin:'https://example.com'}})).status,403);
 const first=await request(url,'/api/run',{task:'test',demo:true,workflow:simple});
 assert.equal((await request(url,'/api/run',{task:'other',demo:true})).status,409);await events(first);
});
