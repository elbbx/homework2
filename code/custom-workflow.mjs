import {validateCustomConfig} from './custom-config.mjs';

export async function customWorkflow({task,call,emit=()=>{},initial,signal,config,checkpoint=async()=>{},parseReview}){
 const plan=validateCustomConfig(config||initial?.config);
 const state=initial?structuredClone(initial):{id:crypto.randomUUID(),task,createdAt:new Date().toISOString(),outputs:{},messages:[],timings:{},events:[],nodeStates:{}};
 Object.assign(state,{config:plan,status:'running'});state.attempts||={};state.feedback||={};state.iterations||=[];delete state.error;delete state.completedAt;
 let queue=Promise.resolve();
 const persist=()=>{const snapshot=structuredClone(state);queue=queue.then(()=>checkpoint(snapshot));return queue;};
 function event(e){state.events.push({...e,time:new Date().toISOString()});emit({...e,state:structuredClone(state)});}
 const done=id=>state.nodeStates[id]?.status==='done';
 function descendants(id,set=new Set([id])){for(const n of plan.nodes)if(n.dependsOn.includes(id)&&!set.has(n.id)){set.add(n.id);descendants(n.id,set);}return set;}
 function ancestors(id,set=new Set()){for(const p of plan.nodes.find(n=>n.id===id).dependsOn){if(!set.has(p)){set.add(p);ancestors(p,set);}}return set;}
 async function run(n,snapshot){
  signal?.throwIfAborted();state.phase=n.id;const round=(state.attempts[n.id]||0)+1;
  state.nodeStates[n.id]={status:'running',round};event({type:'start',agent:n.id,role:n.role,round});const start=Date.now();
  try{
   const upstream=Object.fromEntries([...ancestors(n.id)].filter(id=>Object.hasOwn(snapshot,id)).map(id=>[id,snapshot[id]]));
   const extra=n.type==='review'?'\n只返回JSON：{"approved":true或false,"issues":["具体问题"]}。拒绝时至少列出一个具体问题。不得声称已经执行代码。':'';
   const output=await call({id:n.id,name:n.name,role:n.role,prompt:n.prompt+extra,nodeType:n.type,custom:true},JSON.stringify({task:state.task,upstream,feedback:state.feedback,nodeId:n.id,round,config:plan}));
   signal?.throwIfAborted();if(typeof output!=='string'||!output.trim())throw Error('模型返回空内容');
   const review=n.type==='review'?parseReview(output):undefined;
   state.outputs[n.id]=output;state.attempts[n.id]=round;state.timings[n.id]=(state.timings[n.id]||0)+Date.now()-start;state.nodeStates[n.id]={status:'done',round};
   state.iterations.push({node:n.id,round,output,...(review?{review}:{})});
   state.messages.push({from:n.id,to:review&&!review.approved?n.retryTarget:plan.nodes.filter(x=>x.dependsOn.includes(n.id)).map(x=>x.id),content:output,role:n.role,round,time:new Date().toISOString()});
   event({type:'done',agent:n.id,role:n.role,round,output});await persist();return {node:n,review,round};
  }catch(error){state.nodeStates[n.id]={status:signal?.aborted?'cancelled':'failed',round,error:error.message};event({type:'node-failed',agent:n.id,error:error.message});await persist();error.agent=n.id;throw error;}
 }
 try{
  // Reapply any saved rejected decision before allowing downstream execution.
  async function applyDecision(n,review,round){
   event({type:'branch',agent:n.id,round,approved:review.approved,issues:review.issues,to:review.approved?'downstream':n.retryTarget});
   if(review.approved)return;
   if(round>=n.maxRounds){const e=Error(`节点${n.name}达到${n.maxRounds}轮审查上限仍未通过`);e.agent=n.id;throw e;}
   state.feedback[n.id]=review;const affected=descendants(n.retryTarget);
   for(const id of affected){delete state.outputs[id];state.nodeStates[id]={status:'waiting'};}
   event({type:'loop',agent:n.retryTarget,from:n.id,round:round+1,issues:review.issues});await persist();
  }
  for(const n of plan.nodes)if(n.type==='review'&&done(n.id))await applyDecision(n,parseReview(state.outputs[n.id]),state.attempts[n.id]);
  while(!plan.nodes.every(n=>done(n.id))){
   signal?.throwIfAborted();const ready=plan.nodes.filter(n=>!done(n.id)&&n.dependsOn.every(done));
   if(!ready.length)throw Error('无可执行节点，请检查依赖状态');
   const snapshot=structuredClone(state.outputs);if(ready.length>1)event({type:'parallel',phase:'start',agents:ready.map(n=>n.id)});
   const results=await Promise.allSettled(ready.map(n=>run(n,snapshot)));
   if(ready.length>1)event({type:'parallel',phase:'end',agents:ready.map(n=>n.id)});
   const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;
   for(const r of results)if(r.value.review&&done(r.value.node.id))await applyDecision(r.value.node,r.value.review,r.value.round);
  }
  state.status='completed';state.completedAt=new Date().toISOString();await persist();event({type:'completed'});return state;
 }catch(error){state.status=signal?.aborted?'cancelled':'failed';state.error=error.message;await persist();event({type:state.status,agent:error.agent||state.phase,error:error.message});return state;}
}
