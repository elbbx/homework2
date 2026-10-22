export const agents = [
  {id:'requirements', name:'需求 Agent', prompt:'你是需求分析Agent。将用户需求整理为明确的功能需求、输入输出、边界条件和可验证的验收标准。用中文Markdown输出，不虚构用户背景。'},
  {id:'design', name:'设计 Agent', prompt:'你是软件设计Agent。读取需求Agent的产物，设计最小可运行方案，说明模块、数据结构、接口、流程和测试方案。优先使用Python标准库，输出中文Markdown。'},
  {id:'code', name:'编码 Agent', prompt:'你是编码Agent。依据共享状态中的需求和设计实现完整可运行代码，默认Python标准库。输出文件名、完整代码块、运行方式和验收示例。不要只给伪代码。不要声称已运行或测试生成的代码。'}
];
export async function workflow({task, call, emit=()=>{}, initial, signal}) {
  const state=initial ? structuredClone(initial) : {id:crypto.randomUUID(),createdAt:new Date().toISOString(),task, outputs:{}, messages:[], timings:{},status:'running'};
  state.timings ||= {};
  state.status='running';
  for(const agent of agents){
    if(state.outputs[agent.id]) {emit({type:'skipped',agent:agent.id});continue;}
    const started=Date.now();
    emit({type:'start',agent:agent.id});
    const input=JSON.stringify({task:state.task,upstream:state.outputs});
    try {
      signal?.throwIfAborted();
      const output=await call(agent,input);
      signal?.throwIfAborted();
      if(typeof output!=='string'||!output.trim())throw new Error('模型返回空内容');
      state.outputs[agent.id]=output;
      state.timings[agent.id]=Date.now()-started;
      state.messages.push({from:agent.id,to:agents[agents.indexOf(agent)+1]?.id||'user',content:output,time:new Date().toISOString()});
      emit({type:'done',agent:agent.id,output,state:structuredClone(state)});
    }catch(error){state.status=signal?.aborted?'cancelled':'failed';state.error=error.message;emit({type:state.status==='cancelled'?'cancelled':'failed',agent:agent.id,error:error.message,state});return state;}
  }
  state.status='completed';delete state.error;state.completedAt=new Date().toISOString();emit({type:'completed',state});return state;
}
export async function qwen(agent,input,{key,model,base,emit=()=>{},signal}){
  for(let attempt=0;attempt<3;attempt++){
    try{
      const response=await fetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model,messages:[{role:'system',content:agent.prompt},{role:'user',content:input}],temperature:0.3,max_tokens:5000,enable_thinking:false}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000)});
      if(!response.ok){const error=new Error(`千问接口 HTTP ${response.status}。请检查 Key、地域、工作空间及模型权限。`);error.retry=response.status===429||response.status>=500;throw error;}
      const data=await response.json();
      if(data.choices?.[0]?.finish_reason==='length')throw new Error('输出达到长度上限，请缩小需求后重试');
      if(data.usage)emit({type:'usage',agent:agent.id,usage:data.usage});
      return data.choices?.[0]?.message?.content;
    }catch(error){if(signal?.aborted||attempt===2||error.retry===false||(!error.retry&&error.name!=='TimeoutError'&&error.name!=='TypeError'))throw error;emit({type:'retry',agent:agent.id,attempt:attempt+1});await new Promise(r=>setTimeout(r,1000*2**attempt));}
  }
}
export function demo(agent,input){
 const task=JSON.parse(input).task;
 const outputs={requirements:`# 需求分析（离线示例）\n原始需求：${task}\n\n以下固定示例演示待办清单流程，不代表模型对当前需求的真实分析。\n\n- 添加、查看、完成待办事项\n- 空标题拒绝添加\n- 验收：添加一项后可列出，完成后状态改变。`,design:'# 系统设计（离线示例）\n使用Python标准库。Todo类维护任务列表，add校验标题，complete根据编号修改状态，list返回列表。验收覆盖空标题与未知编号。',code:'# 编码结果（离线示例，未执行）\n```python\nclass Todo:\n    def __init__(self):\n        self.tasks = []\n\n    def add(self, title):\n        if not title.strip():\n            raise ValueError("标题不能为空")\n        item = {"id": len(self.tasks)+1, "title": title.strip(), "done": False}\n        self.tasks.append(item)\n        return item.copy()\n\n    def complete(self, task_id):\n        for item in self.tasks:\n            if item["id"] == task_id:\n                item["done"] = True\n                return\n        raise ValueError("任务不存在")\n\n    def list(self):\n        return [item.copy() for item in self.tasks]\n\nif __name__ == "__main__":\n    todo = Todo()\n    todo.add("完成软件工程作业")\n    todo.complete(1)\n    print(todo.list())\n```\n保存为todo.py，使用 python todo.py 运行。'};
 return outputs[agent.id];
}
