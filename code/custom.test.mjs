import test from 'node:test';
import assert from 'node:assert/strict';
import {workflow} from './workflow.mjs';
import {validateWorkflowConfig} from './workflow-config.mjs';
import {customTemplate,validateCustomConfig} from './custom-config.mjs';
const node=(id,dependsOn=[],extra={})=>({id,name:id,role:'自定义角色',prompt:'完成'+id+'职责',type:'agent',dependsOn,...extra});
const graph=()=>({kind:'custom',nodes:[node('brief'),node('plan',['brief']),node('tests',['brief']),node('build',['plan','tests']),node('audit',['build'],{type:'review',retryTarget:'build',maxRounds:3})]});
const approval=JSON.stringify({approved:true,issues:[]});
test('自定义配置校验拒绝重名、缺失依赖、循环和非法返工目标',()=>{
 assert.equal(validateWorkflowConfig(customTemplate()).kind,'custom');
 for(const nodes of [[node('a'),node('a')],[node('a',['missing']),node('b')],[node('a',['b']),node('b',['a'])],[node('a'),node('b',['a'],{type:'review',retryTarget:'b',maxRounds:2})]])assert.throws(()=>validateCustomConfig({kind:'custom',nodes}));
});
test('自定义节点按依赖实际并行，自定义角色与提示词进入调用',async()=>{
 let release;const gate=new Promise(r=>release=r),started=new Set();
 const state=await workflow({task:'自定义',config:graph(),call:async(agent,input)=>{
  const data=JSON.parse(input);assert.equal(agent.role,'自定义角色');assert.match(agent.prompt,new RegExp('完成'+agent.id));
  if(['plan','tests'].includes(agent.id)){started.add(agent.id);if(started.size===2)release();await gate;assert.deepEqual(Object.keys(data.upstream),['brief']);}
  if(agent.id==='build')assert.deepEqual(Object.keys(data.upstream).sort(),['brief','plan','tests']);
  return agent.id==='audit'?approval:agent.id+'产物';
 }});assert.equal(state.status,'completed');assert.equal(state.messages.length,5);assert.deepEqual([...started].sort(),['plan','tests']);
});
test('自定义审查返工仅重跑目标及后继，反馈交给修订节点',async()=>{
 const config=graph();config.nodes.push(node('publish',['audit']));const calls={};
 const state=await workflow({task:'修订',config,call:async(agent,input)=>{calls[agent.id]=(calls[agent.id]||0)+1;const data=JSON.parse(input);if(agent.id==='audit')return JSON.stringify({approved:calls.audit>1,issues:calls.audit>1?[]:['补充边界']});if(agent.id==='build'&&calls.build===2)assert.equal(data.feedback.audit.issues[0],'补充边界');return agent.id+'版本'+calls[agent.id];}});
 assert.equal(state.status,'completed');assert.equal(calls.build,2);assert.equal(calls.audit,2);assert.equal(calls.plan,1);assert.equal(calls.publish,1);assert.ok(state.events.some(e=>e.type==='loop'));assert.equal(state.outputs.build,'build版本2');
});
test('自定义审查超过上限明确失败，后继不执行',async()=>{
 const config=graph();config.nodes.at(-1).maxRounds=2;config.nodes.push(node('publish',['audit']));let builds=0,published=false;
 const s=await workflow({task:'上限',config,call:async a=>{if(a.id==='build')builds++;if(a.id==='publish')published=true;return a.id==='audit'?JSON.stringify({approved:false,issues:['未通过']}):'产物';}});
 assert.equal(s.status,'failed');assert.equal(builds,2);assert.equal(published,false);
});
test('自定义并行分支失败保存成功兄弟节点，恢复不重复调用',async()=>{
 const first=await workflow({task:'恢复',config:graph(),call:async a=>{if(a.id==='plan')throw Error('临时错误');return a.id==='audit'?approval:'产物';}});
 assert.equal(first.status,'failed');assert.equal(first.nodeStates.tests.status,'done');const calls=[];
 const resumed=await workflow({initial:first,call:async a=>{calls.push(a.id);return a.id==='audit'?approval:'恢复产物';}});
 assert.equal(resumed.status,'completed');assert.deepEqual(calls,['plan','build','audit']);
});
test('自定义审查不接受非JSON，未提交无效审查产物',async()=>{
 const state=await workflow({task:'格式',config:graph(),call:async a=>a.id==='audit'?'看起来通过':'产物'});
 assert.equal(state.status,'failed');assert.equal(state.outputs.audit,undefined);
});
test('自定义节点完成后产生可恢复检查点和命名产物',async()=>{
 const checkpoints=[];const state=await workflow({task:'文档',config:{kind:'custom',nodes:[node('analyze'),node('write',['analyze'])]},checkpoint:async s=>checkpoints.push(s),call:async a=>a.id+'内容'});
 assert.equal(state.status,'completed');assert.equal(checkpoints[0].outputs.analyze,'analyze内容');assert.equal(checkpoints[0].outputs.write,undefined);assert.equal(state.outputs.write,'write内容');
});
