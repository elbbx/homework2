import {validateWorkflowConfig} from './workflow-config.mjs';

export const agents = [
  {id:'requirements', name:'需求 Agent', prompt:'你是需求分析Agent。将用户需求整理为明确的功能需求、输入输出、边界条件和可验证的验收标准。用中文Markdown输出，不虚构用户背景。'},
  {id:'design', name:'设计 Agent', prompt:'你是软件设计Agent。读取需求Agent的产物，设计最小可运行方案，说明模块、数据结构、接口、流程和测试方案。优先使用Python标准库，输出中文Markdown。'},
  {id:'code', name:'编码 Agent', prompt:'你是编码Agent。依据共享状态中的需求和设计实现完整可运行代码，默认Python标准库。输出文件名、完整代码块、运行方式和验收示例。不要只给伪代码。不要声称已运行或测试生成的代码。'}
];
export function parseReview(output){
 const text=output.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
 let review;
 try{review=JSON.parse(text);}catch{throw Error('审查Agent必须返回有效JSON：{"approved":true或false,"issues":[]}');}
 if(!review||typeof review.approved!=='boolean'||!Array.isArray(review.issues)||review.issues.some(x=>typeof x!=='string'))throw Error('审查JSON格式错误：approved应为布尔值，issues应为字符串数组');
 if(!review.approved&&!review.issues.some(x=>x.trim()))throw Error('审查拒绝时必须说明至少一个问题');
 return {approved:review.approved,issues:review.issues};
}

export async function workflow({task,call,emit=()=>{},initial,signal,config,checkpoint=async()=>{}}){
 // Calls without an explicit configuration retain the original sequential API.
 const legacy=config===undefined&&!initial?.config;
 const plan=legacy?validateWorkflowConfig({parallelPlanning:false,reviewEnabled:false,maxRounds:1}):validateWorkflowConfig(config??initial.config);
 const state=initial?structuredClone(initial):{id:crypto.randomUUID(),createdAt:new Date().toISOString(),task,outputs:{},messages:[],timings:{},status:'running'};
 state.outputs||={};state.messages||=[];state.timings||={};state.events||=[];state.iterations||=[];state.nodeStates||={};
 state.config=plan;state.round||=1;state.status='running';delete state.error;delete state.completedAt;
 // Upgrade old three-node checkpoints without rerunning completed work.
 for(const id of Object.keys(state.outputs))if(!state.nodeStates[id])state.nodeStates[id]={status:'done',round:['code','review'].includes(id)?state.round:undefined};
 if(state.outputs.code&&!state.iterations.length)state.iterations.push({round:state.round,code:state.outputs.code});
 let persistence=Promise.resolve();
 const persist=()=>{const snapshot=structuredClone(state);persistence=persistence.then(()=>checkpoint(snapshot));return persistence;};
 function event(detail,includeState=true){
  const log={...detail,time:new Date().toISOString()};delete log.state;delete log.output;
  state.events.push(log);
  emit({...detail,...(includeState?{state:structuredClone(state)}:{})});
 }
 const isDone=(id,round)=>state.nodeStates[id]?.status==='done'&&(round===undefined||state.nodeStates[id].round===round);
 function roleAgent(nodeId,role,extra=''){
  const base=agents.find(x=>x.id===role);
  return {...base,id:nodeId,role,prompt:base.prompt+(plan.agentPrompts[role]?'\n\n用户附加指令：\n'+plan.agentPrompts[role]:'')+(extra?'\n\n'+extra:'')};
 }
 async function runNode(id,role,{round,to='user',extra='',upstream,parse,commit}={}){
  if(isDone(id,round)){event({type:'skipped',agent:id,role,round});return state.outputs[id];}
  signal?.throwIfAborted();
  state.nodeStates[id]={status:'running',...(round===undefined?{}:{round})};state.phase=id;
  event({type:'start',agent:id,role,round});
  const started=Date.now();
  const input=JSON.stringify({task:state.task,upstream:upstream??structuredClone(state.outputs),config:plan,round:round||1,nodeId:id});
  try{
   const output=await call(roleAgent(id,role,extra),input);
   signal?.throwIfAborted();
   if(typeof output!=='string'||!output.trim())throw Error('模型返回空内容');
   const parsed=parse?parse(output):undefined;
   state.outputs[id]=output;
   state.timings[id]=(state.timings[id]||0)+Date.now()-started;
   state.nodeStates[id]={status:'done',...(round===undefined?{}:{round})};
   if(commit)commit(output,parsed);
   state.messages.push({from:id,to:typeof to==='function'?to(parsed):to,role,round,content:output,time:new Date().toISOString()});
   event({type:'done',agent:id,role,round,output});
   await persist();
   return output;
  }catch(error){
   state.nodeStates[id]={status:signal?.aborted?'cancelled':'failed',error:error.message,...(round===undefined?{}:{round})};
   event({type:'node-failed',agent:id,role,round,error:error.message});
   await persist();
   error.agent||=id;throw error;
  }
 }
 try{
  await runNode('requirements','requirements',{to:plan.parallelPlanning?['design','testplan']:'design'});
  if(plan.parallelPlanning){
   const snapshot=structuredClone(state.outputs);
   event({type:'parallel',phase:'start',agents:['design','testplan']});
   const outcomes=await Promise.allSettled([
    runNode('design','design',{to:'code',upstream:snapshot}),
    runNode('testplan','design',{to:'code',upstream:snapshot,extra:'本节点负责测试计划。只输出验收测试清单、边界输入、预期结果和测试代码设计，不重复架构设计。'})
   ]);
   event({type:'parallel',phase:'end',agents:['design','testplan']});
   const failed=outcomes.find(x=>x.status==='rejected');if(failed)throw failed.reason;
  }else await runNode('design','design',{to:'code'});
  while(true){
   const round=state.round;
   let iteration=state.iterations.find(x=>x.round===round);
   if(!iteration){iteration={round};state.iterations.push(iteration);}
   await runNode('code','code',{round,to:plan.reviewEnabled?'review':'user',extra:round>1?'这是修复迭代。必须根据上一次审查issues修复已有代码，保留完整可运行代码。':'',commit:output=>{iteration.code=output;}});
   if(!plan.reviewEnabled)break;
   await runNode('review','design',{
    round,to:review=>review.approved?'user':'code',parse:parseReview,
    extra:'本节点审查编码Agent产物与需求、设计、测试计划的一致性。不得声称已运行代码。只返回JSON对象，不要Markdown：{"approved":true或false,"issues":["具体问题"]}。存在未满足的需求或明显Bug时approved为false并列出问题，符合要求时approved为true且issues为空数组。',
    commit:(output,review)=>{iteration.review=review;iteration.reviewOutput=output;}
   });
   const review=iteration.review||parseReview(state.outputs.review);
   event({type:'branch',agent:'review',round,approved:review.approved,issues:review.issues,to:review.approved?'completed':'code'});
   if(review.approved)break;
   if(round>=plan.maxRounds){const error=Error(`达到最大编码轮数${plan.maxRounds}，审查仍未通过：${review.issues.join('；')}`);error.agent='review';throw error;}
   state.round=round+1;
   event({type:'loop',agent:'code',from:'review',round:state.round,issues:review.issues});
   await persist();
  }
  signal?.throwIfAborted();state.status='completed';state.phase='completed';delete state.error;state.completedAt=new Date().toISOString();
  await persist();event({type:'completed'});return state;
 }catch(error){
  state.status=signal?.aborted?'cancelled':'failed';state.error=error.message;
  await persist();event({type:state.status==='cancelled'?'cancelled':'failed',agent:error.agent||state.phase,error:error.message});return state;
 }
}
async function requestModel(agent,messages,{key,model,base,provider,emit,signal,maxTokens}){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const payload={model,messages,temperature:0.3,max_tokens:maxTokens};
      if(provider==='qwen')payload.enable_thinking=false;
      const response=await fetch(base.replace(/\/+$/,'')+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify(payload),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
      if(!response.ok){const error=new Error(`${provider==='deepseek'?'DeepSeek':'千问'}接口 HTTP ${response.status}。请检查对应服务商的Key、额度及模型权限。`);error.retry=response.status===429||response.status>=500;throw error;}
      const data=await response.json();
      if(data.usage)emit({type:'usage',agent:agent.id,usage:data.usage});
      return data.choices?.[0];
    }catch(error){if(signal?.aborted||attempt===2||error.retry===false||(!error.retry&&error.name!=='TimeoutError'&&error.name!=='TypeError'))throw error;emit({type:'retry',agent:agent.id,attempt:attempt+1});await new Promise(r=>setTimeout(r,1000*2**attempt));}
  }
}
export async function callModel(agent,input,{key,model,base,provider='qwen',emit=()=>{},signal,maxTokens=8192}){
 if(!Number.isInteger(maxTokens)||maxTokens<512||maxTokens>32768)throw Error('单次输出Token预算无效');
 const messages=[{role:'system',content:agent.prompt+'\n\n请简洁交付，避免重复解释或重复代码。编码节点必须优先输出完整源码和必要测试。'},{role:'user',content:input}];
 let output='';
 for(let chunk=0;chunk<3;chunk++){
  signal?.throwIfAborted();
  const choice=await requestModel(agent,messages,{key,model,base,provider,emit,signal,maxTokens});
  const content=choice?.message?.content;
  if(typeof content!=='string'||!content.trim())throw Error(choice?.finish_reason==='length'?'模型已耗尽输出预算但未返回正文，请选择非推理模型或调整MAX_OUTPUT_TOKENS后恢复。':'模型返回空内容');
  output+=content;
  if(choice.finish_reason!=='length')return output;
  // Review is a strict JSON decision. Never glue partial JSON into an approval.
  if(agent.id==='review')throw Error('审查JSON达到输出上限，未采纳不完整决策。请使用简洁的审查指令或调整MAX_OUTPUT_TOKENS后恢复。');
  if(chunk===2)throw Error('输出在两次自动续写后仍未完成，未采纳截断产物。请在附加指令中要求精简输出，或按模型能力调整MAX_OUTPUT_TOKENS后恢复。');
  emit({type:'continuation',agent:agent.id,attempt:chunk+1,maxTokens});
  // Keep the exact partial answer so continuation can complete a line or code fence.
  if(messages.at(-1).role==='user'&&messages.length>2)messages.splice(-2,2);
  messages.push({role:'assistant',content:output},{role:'user',content:'上一条回答因长度限制被截断。请只从中断位置继续剩余内容，不要重复已输出的文字，不要重新开始已有代码块，不要重写文件。补全剩余代码、测试和运行说明后结束。'});
 }
}
// Backward compatible named export for existing callers.
export const qwen=callModel;
export function demo(agent,input){
 const context=JSON.parse(input),task=context.task;
 if(agent.id==='testplan')return '# 测试计划（离线固定示例）\n- 空标题应抛出ValueError\n- 添加任务后可查询完整列表\n- 已存在编号可标记完成\n- 不存在编号应抛出ValueError\n此示例未执行代码，真实模式需独立验收。';
 if(agent.id==='review')return JSON.stringify(context.config?.forceRevisionDemo&&context.round===1?{approved:false,issues:['离线审查模拟：请补充空标题与不存在编号的边界处理说明。']}:{approved:true,issues:[]});
 const outputs={requirements:`# 需求分析（离线示例）\n原始需求：${task}\n\n以下固定示例演示待办清单流程，不代表模型对当前需求的真实分析。\n\n- 添加、查看、完成待办事项\n- 空标题拒绝添加\n- 验收：添加一项后可列出，完成后状态改变。`,design:'# 系统设计（离线示例）\n使用Python标准库。Todo类维护任务列表，add校验标题，complete根据编号修改状态，list返回列表。验收覆盖空标题与未知编号。',code:'# 编码结果（离线示例，未执行）\n```python\nclass Todo:\n    def __init__(self):\n        self.tasks = []\n\n    def add(self, title):\n        if not title.strip():\n            raise ValueError("标题不能为空")\n        item = {"id": len(self.tasks)+1, "title": title.strip(), "done": False}\n        self.tasks.append(item)\n        return item.copy()\n\n    def complete(self, task_id):\n        for item in self.tasks:\n            if item["id"] == task_id:\n                item["done"] = True\n                return\n        raise ValueError("任务不存在")\n\n    def list(self):\n        return [item.copy() for item in self.tasks]\n\nif __name__ == "__main__":\n    todo = Todo()\n    todo.add("完成软件工程作业")\n    todo.complete(1)\n    print(todo.list())\n```\n保存为todo.py，使用 python todo.py 运行。'};
 return agent.id==='code'&&context.round>1?'# 修复轮次（离线固定示例）\n已补充边界说明：空标题与不存在的编号均抛出ValueError。\n\n'+outputs[agent.id]:outputs[agent.id];
}
