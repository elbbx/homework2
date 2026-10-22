const $=id=>document.getElementById(id);
let state={outputs:{},messages:[]},tab='requirements',running=false,histories=[];
let providerSettings={qwen:{name:'千问',model:'qwen-plus',hasKey:false},deepseek:{name:'DeepSeek',model:'deepseek-chat',hasKey:false}};
function updateProvider(){const c=providerSettings[$('provider').value];$('model').value=c.model;$('key').value='';$('key').placeholder=`填入${c.name} API Key，或使用服务端配置`;$('connection').textContent=c.hasKey?`${c.name}：服务端已配置对应Key，可直接运行。`:`${c.name}：请填写该服务商的API Key。`;}
$('provider').onchange=updateProvider;
const templates={todo:'用 Python 标准库实现一个命令行待办清单，支持添加、查看和完成任务，JSON文件持久化，拒绝空标题，处理不存在的编号。代码不超过150行。',grade:'用 Python 实现学生成绩统计，支持输入姓名和0到100的成绩，计算平均分、最高分、最低分，处理空数据及非法成绩。代码不超过100行。',expense:'用 Python 实现命令行记账工具，支持添加金额和分类，按分类统计支出，保存到JSON文件，校验金额为正数。代码不超过120行。'};
function lock(value){running=value;for(const id of ['run','task','provider','model','key','demo','template','history'])$(id).disabled=value;$('stop').disabled=!value;$('resume').disabled=value||!['failed','cancelled'].includes(state.status);}
function show(){
 $('text').textContent=tab==='state'?JSON.stringify(state,null,2):state.outputs[tab]||'此节点尚未生成产物。';
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 const total=Object.values(state.usage||{}).reduce((n,u)=>n+(u.total_tokens||0),0);
 const seconds=Object.values(state.timings||{}).reduce((n,t)=>n+t,0)/1000;
 $('metrics').textContent=`${Object.keys(state.outputs).length}/3 节点完成　·　${seconds.toFixed(1)} 秒（已完成节点）　·　${total} Tokens${state.demo?' · 离线示例':''}`;
 $('export').disabled=$('report').disabled=!Object.keys(state.outputs).length;
 $('copy').disabled=$('download').disabled=!state.outputs.code;
}
function node(id,status){$(id).className='node '+status;$(id).querySelector('span').textContent=({running:'正在推理与生成…',done:'已完成 · 产物已交接',failed:'执行失败 · 可恢复',cancelled:'已停止 · 可恢复'})[status]||'等待';}
function log(text){const line=document.createElement('div');line.textContent=new Date().toLocaleTimeString()+'  '+text;$('log').append(line);$('log').scrollTop=$('log').scrollHeight;}
function download(content,name,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
async function history(){const r=await fetch('/api/history');if(!r.ok)throw Error('读取历史失败');histories=await r.json();$('history').replaceChildren(new Option('选择最近运行记录…',''));for(const h of histories)$('history').add(new Option(`${h.demo?'[离线]':'['+(h.provider==='deepseek'?'DeepSeek':'千问')+']'} ${new Date(h.createdAt).toLocaleString()} · ${h.status} · ${h.task.slice(0,20)}`,h.id));}
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;show();});
$('template').onchange=()=>{if(templates[$('template').value])$('task').value=templates[$('template').value];};
$('history').onchange=()=>{const h=histories.find(h=>h.id===$('history').value);if(!h)return;state=structuredClone(h);$('task').value=h.task;$('demo').checked=!!h.demo;$('provider').value=h.provider||'qwen';updateProvider();$('model').value=h.model;for(const id of ['requirements','design','code'])node(id,h.outputs[id]?'done':'');$('status').textContent='历史记录 · '+h.status;$('log').textContent='';log('已载入历史记录');lock(false);show();};
async function run(resume=false){
 if(running)return;
 if(location.protocol==='file:'){alert('当前打开的是磁盘文件，无法调用本地服务。请在浏览器地址栏输入 http://127.0.0.1:3000 后再运行。');return;}
 if(!$('task').value.trim()){alert('请先输入需求');return;}
 lock(true);
 if(!resume){state={task:$('task').value,outputs:{},messages:[],demo:$('demo').checked};for(const id of ['requirements','design','code'])node(id,'');$('log').textContent='';show();}
 $('status').textContent=$('demo').checked?'离线演示运行中':'模型工作流运行中';
 try{
  const response=await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:$('task').value,key:$('key').value,provider:$('provider').value,model:$('model').value,demo:$('demo').checked,resume,resumeId:state.id})});
  if(!response.ok)throw Error((await response.json()).error);
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',terminal=false;
  function event(e){
   if(e.state)state=e.state;
   if(e.type==='start'){node(e.agent,'running');tab=e.agent;log(e.agent+' 开始，读取共享状态');}
   if(e.type==='done'){node(e.agent,'done');log(e.agent+' 完成，发送产物，用时 '+(state.timings[e.agent]/1000).toFixed(1)+' 秒');}
   if(e.type==='skipped'){node(e.agent,'done');log(e.agent+' 已完成，跳过');}
   if(e.type==='usage'){state.usage||={};state.usage[e.agent]=e.usage;}
   if(e.type==='retry')log(e.agent+' 接口重试 '+e.attempt);
   if(['failed','cancelled'].includes(e.type)){terminal=true;node(e.agent,e.type);$('status').textContent=(e.type==='cancelled'?'已停止：':'失败：')+e.error;log(e.error);}
   if(e.type==='error')throw Error(e.error);
   if(e.type==='completed'){terminal=true;$('status').textContent='全部完成'+(state.demo?' · 离线示例':' · '+($('provider').value==='deepseek'?'DeepSeek':'千问')+'生成');log('工作流完成，结果将保存到本地历史');}
   show();
  }
  while(true){const {value,done}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=pending.split('\n');pending=lines.pop();for(const line of lines)if(line.trim())event(JSON.parse(line));if(done)break;}
  if(pending.trim())event(JSON.parse(pending));if(!terminal)throw Error('连接中断，请重新运行');
 }catch(e){$('status').textContent='运行异常';log(e.message);for(const id of ['requirements','design','code'])if($(id).classList.contains('running'))node(id,'failed');}
 finally{lock(false);show();try{await history();}catch(e){log(e.message);}}
}
$('run').onclick=()=>run();$('resume').onclick=()=>run(true);
$('stop').onclick=async()=>{try{const r=await fetch('/api/cancel',{method:'POST'});if(!r.ok)throw Error('停止失败');log('已请求停止，等待当前节点退出');}catch(e){log(e.message);}};
$('export').onclick=()=>download(JSON.stringify(state,null,2),'workflow-result.json','application/json');
$('report').onclick=()=>download(`# Mini SE 工作流实验报告\n\n运行ID：${state.id}\n\n模式：${state.demo?'离线固定示例':'真实模型调用'}\n\n模型：${state.model}\n\n状态：${state.status}\n\n## 用户需求\n${state.task}\n\n## 工作流\n需求 Agent → 设计 Agent → 编码 Agent\n\n${['requirements','design','code'].map((id,i)=>`## ${i+1}. ${id}\n\n${state.outputs[id]||'未完成'}\n`).join('\n')}\n## 运行统计\n\n${$('metrics').textContent}\n\n## 验证说明\n本报告记录Agent生成结果，生成的业务代码尚需独立执行验收。\n`,'实验报告.md','text/markdown');
function blocks(){return [...(state.outputs.code||'').matchAll(/```([^\n]*)\n([\s\S]*?)```/g)].map(m=>({lang:m[1].trim().toLowerCase(),content:m[2]}));}
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(state.outputs.code);log('编码产物已复制');}catch{log('复制失败，请手动选择文本复制');}};
$('download').onclick=()=>{const list=blocks().filter(b=>/^(python|py|javascript|js|typescript|ts|html|css|json|bash|sh|sql)$/.test(b.lang));if(!list.length){log('未找到可下载的代码块，请导出完整报告');return;}const extensions={python:'py',javascript:'js',typescript:'ts',bash:'sh'};list.forEach((b,i)=>download(b.content,`generated-${i+1}.${extensions[b.lang]||b.lang}`,'text/plain'));log(`已请求下载 ${list.length} 个代码块，请按报告说明命名和运行`);};
(async()=>{if(location.protocol==='file:'){$('connection').textContent='静态预览模式：双击启动.cmd，随后访问本地网页。';return;}try{const config=await(await fetch('/api/config')).json();providerSettings=config.providers;$('provider').value=config.provider;updateProvider();await history();}catch(e){log('服务连接失败：'+e.message);}})();


