// Explicitly invoked real API test; prints no credentials.
import {workflow,qwen} from './workflow.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
if(!process.env.DASHSCOPE_API_KEY)throw Error('请先在code/.env中配置Key');
const usage={};
const state=await workflow({task:'请实现一个Python标准库函数 summarize(scores)，输入0至100之间的成绩列表，返回平均值、最大值、最小值。空列表与非法值抛出ValueError。需求与设计每份不超过200字，编码不超过60行，提供unittest测试。',emit:e=>{if(e.type==='usage')usage[e.agent]=e.usage;if(['start','done','failed','completed'].includes(e.type))console.log(e.type,e.agent||'',e.error||'');},call:(agent,input)=>qwen(agent,input,{key:process.env.DASHSCOPE_API_KEY,model:process.env.QWEN_MODEL||'qwen-plus',base:process.env.QWEN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1',emit:e=>{if(e.type==='usage')usage[e.agent]=e.usage;}})});
state.usage=usage;state.model=process.env.QWEN_MODEL||'qwen-plus';state.demo=false;
await mkdir(new URL('./test-results/',import.meta.url),{recursive:true});
await writeFile(new URL('./test-results/live-result.json',import.meta.url),JSON.stringify(state,null,2));
console.log(JSON.stringify({status:state.status,messages:state.messages.length,timings:state.timings,usage}));
if(state.status!=='completed')process.exitCode=1;
