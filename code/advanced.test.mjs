import test from 'node:test';
import assert from 'node:assert/strict';
import {workflow} from './workflow.mjs';

const enhanced = {parallelPlanning:true,reviewEnabled:true,maxRounds:2,forceRevisionDemo:false,agentPrompts:{}};
const approved = JSON.stringify({approved:true,issues:[]});
const rejected = JSON.stringify({approved:false,issues:['缺少空输入处理']});
const config = overrides => ({...enhanced,...overrides});

test('并行规划实际重叠执行，编码读取两个完整分支', {timeout:2500}, async()=>{
 const starts=new Set();let release;
 const barrier=new Promise(resolve=>{release=resolve;});
 const state=await workflow({task:'成绩统计',config:config(),call:async(agent,input)=>{
  const data=JSON.parse(input);
  if(['design','testplan'].includes(agent.id)){
   starts.add(agent.id);if(starts.size===2)release();
   await barrier;
   assert.equal(data.upstream.requirements,'需求产物');
   assert.equal(data.upstream.design,undefined);
   assert.equal(data.upstream.testplan,undefined);
  }
  if(agent.id==='code'){
   assert.equal(data.upstream.design,'设计产物');
   assert.equal(data.upstream.testplan,'测试规划');
  }
  return ({requirements:'需求产物',design:'设计产物',testplan:'测试规划',code:'实现',review:approved})[agent.id];
 }});
 assert.equal(state.status,'completed');
 assert.deepEqual([...starts].sort(),['design','testplan']);
 assert.equal(state.outputs.code,'实现');
});

test('审查通过直接完成，不额外生成代码',async()=>{
 let codeCalls=0,reviewCalls=0;
 const events=[];
 const state=await workflow({task:'成绩统计',config:config(),emit:e=>events.push(e),call:async agent=>{
  if(agent.id==='code')codeCalls++;
  if(agent.id==='review'){reviewCalls++;return approved;}
  return agent.id+'产物';
 }});
 assert.equal(state.status,'completed');assert.equal(codeCalls,1);assert.equal(reviewCalls,1);
 assert.ok(events.some(e=>e.type==='branch'));
 assert.equal(events.at(-1).type,'completed');
});

test('审查拒绝后将问题传入下一轮，并保留修订历史',async()=>{
 let codeCalls=0,reviewCalls=0;
 const events=[];
 const state=await workflow({task:'成绩统计',config:config(),emit:e=>events.push(e),call:async(agent,input)=>{
  if(agent.id==='code'){
   codeCalls++;
   if(codeCalls===2)assert.match(input,/缺少空输入处理/);
   return '代码版本'+codeCalls;
  }
  if(agent.id==='review')return ++reviewCalls===1?rejected:approved;
  return agent.id+'产物';
 }});
 assert.equal(state.status,'completed');assert.equal(codeCalls,2);assert.equal(reviewCalls,2);
 assert.equal(state.outputs.code,'代码版本2');
 assert.equal(state.iterations.length,2);
 assert.equal(state.iterations[0].code,'代码版本1');
 assert.equal(state.iterations[0].review.approved,false);
 assert.equal(state.iterations[1].review.approved,true);
 assert.ok(events.some(e=>e.type==='loop'));
});

test('达到修订上限仍未通过时明确失败',async()=>{
 let codeCalls=0,reviewCalls=0;
 const state=await workflow({task:'成绩统计',config:config({maxRounds:2}),call:async agent=>{
  if(agent.id==='code'){codeCalls++;return '代码版本'+codeCalls;}
  if(agent.id==='review'){reviewCalls++;return rejected;}
  return agent.id+'产物';
 }});
 assert.equal(state.status,'failed');assert.equal(codeCalls,2);assert.equal(reviewCalls,2);
 assert.equal(state.iterations.length,2);assert.equal(state.iterations.at(-1).review.approved,false);
 assert.ok(state.error);
});

test('并行分支失败保留成功分支，恢复只补齐缺失节点',async()=>{
 const failed=await workflow({task:'成绩统计',config:config(),call:async agent=>{
  if(agent.id==='testplan')throw Error('测试规划临时失败');
  return agent.id==='review'?approved:agent.id+'产物';
 }});
 assert.equal(failed.status,'failed');assert.equal(failed.outputs.design,'design产物');
 assert.equal(failed.outputs.testplan,undefined);assert.equal(failed.outputs.code,undefined);
 const calls=[];
 const restored=await workflow({initial:failed,config:config(),call:async agent=>{
  calls.push(agent.id);return agent.id==='review'?approved:agent.id+'恢复产物';
 }});
 assert.equal(restored.status,'completed');
 assert.ok(!calls.includes('requirements'));assert.ok(!calls.includes('design'));
 assert.ok(calls.includes('testplan'));assert.ok(calls.includes('code'));assert.ok(calls.includes('review'));
});

test('第二轮审查失败后恢复当前轮，不沿用旧审查结论',async()=>{
 let codeCalls=0,reviewCalls=0;
 const failed=await workflow({task:'成绩统计',config:config(),call:async agent=>{
  if(agent.id==='code')return '代码版本'+(++codeCalls);
  if(agent.id==='review'){
   if(++reviewCalls===1)return rejected;
   throw Error('审查服务暂时不可用');
  }
  return agent.id+'产物';
 }});
 assert.equal(failed.status,'failed');assert.equal(codeCalls,2);assert.equal(failed.outputs.code,'代码版本2');
 const calls=[];
 const restored=await workflow({initial:failed,config:config(),call:async(agent,input)=>{
  calls.push(agent.id);assert.equal(agent.id,'review');
  assert.match(input,/代码版本2/);return approved;
 }});
 assert.equal(restored.status,'completed');assert.deepEqual(calls,['review']);
 assert.equal(restored.outputs.code,'代码版本2');
 assert.equal(restored.iterations.at(-1).review.approved,true);
});

test('节点检查点保留已完成产物，不提交失败节点的部分结果',async()=>{
 const checkpoints=[];
 const state=await workflow({task:'成绩统计',config:config(),checkpoint:async value=>checkpoints.push(structuredClone(value)),call:async agent=>{
  if(agent.id==='code')throw Error('编码失败');
  return agent.id+'产物';
 }});
 assert.equal(state.status,'failed');
 assert.ok(checkpoints.some(s=>s.outputs.requirements));
 assert.ok(checkpoints.some(s=>s.outputs.design&&s.outputs.testplan));
 assert.ok(checkpoints.every(s=>!s.outputs.code));
 assert.equal(checkpoints.at(-1).status,'failed');
});

test('不合规的审查响应不能被当作通过',async()=>{
 const state=await workflow({task:'成绩统计',config:config(),call:async agent=>agent.id==='review'?'看起来差不多，没有结构化结论':agent.id+'产物'});
 assert.equal(state.status,'failed');
 assert.ok(state.error);
});

test('可视化配置中的角色提示词传入实际Agent调用',async()=>{
 const markers={requirements:'CUSTOM_REQUIREMENTS',design:'CUSTOM_DESIGN',code:'CUSTOM_CODE'};
 const prompts=[];
 const state=await workflow({task:'成绩统计',config:config({agentPrompts:markers}),call:async agent=>{
  prompts.push(agent.prompt);
  const role=agent.role||agent.id;
  assert.match(agent.prompt,new RegExp(markers[role]));
  return agent.id==='review'?approved:agent.id+'产物';
 }});
 assert.equal(state.status,'completed');assert.equal(prompts.length,5);
});

test('并行阶段取消后不提交中断产物，可从已完成需求恢复',async()=>{
 const controller=new AbortController();
 const stopped=await workflow({task:'成绩统计',config:config(),signal:controller.signal,call:async agent=>{
  if(agent.id==='design')controller.abort(new Error('用户停止'));
  return agent.id+'产物';
 }});
 assert.equal(stopped.status,'cancelled');
 assert.deepEqual(Object.keys(stopped.outputs),['requirements']);
 const calls=[];
 const restored=await workflow({initial:stopped,config:config(),call:async agent=>{
  calls.push(agent.id);return agent.id==='review'?approved:agent.id+'产物';
 }});
 assert.equal(restored.status,'completed');
 assert.ok(!calls.includes('requirements'));
 assert.ok(calls.includes('design'));assert.ok(calls.includes('testplan'));
});
