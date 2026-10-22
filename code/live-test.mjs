// Explicitly invoked real API test; prints no credentials.
import {workflow,callModel} from './workflow.mjs';
import {resolveConfig} from './providers.mjs';
import {validateWorkflowConfig} from './workflow-config.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const config=resolveConfig({});
const advanced=process.argv.includes('--advanced');
const plan=advanced?validateWorkflowConfig({agentPrompts:{requirements:'请简洁输出，控制在200字以内。',design:'架构与测试计划简洁输出，审查时严格只返回要求的JSON。',code:'代码使用标准库，尽量简洁，提供必要的测试。'}}):undefined;
const usage={};
const state=await workflow({config:plan,task:'请实现一个Python标准库函数 summarize(scores)，输入0至100之间的成绩列表，返回平均值、最大值、最小值。空列表与非法值抛出ValueError。需求与设计每份不超过200字，编码不超过60行，提供unittest测试。',emit:e=>{if(e.type==='usage')usage[e.agent]=e.usage;if(['start','done','branch','loop','failed','completed'].includes(e.type))console.log(e.type,e.agent||'',e.round||'',e.error||'');},call:(agent,input)=>callModel(agent,input,{...config,emit:e=>{if(e.type==='usage'){const prior=usage[e.agent]?.total_tokens||0;usage[e.agent]={...e.usage,total_tokens:prior+e.usage.total_tokens};}}})});
state.usage=usage;state.model=config.model;state.provider=config.provider;state.demo=false;
await mkdir(new URL('./test-results/',import.meta.url),{recursive:true});
await writeFile(new URL(advanced?'./test-results/advanced-live-result.json':'./test-results/live-result.json',import.meta.url),JSON.stringify(state,null,2));
console.log(JSON.stringify({status:state.status,messages:state.messages.length,timings:state.timings,usage}));
if(state.status!=='completed')process.exitCode=1;
