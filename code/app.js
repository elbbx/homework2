let viewState;
try{viewState=await import('./view-state.mjs');}
catch(error){
 document.getElementById('status').textContent='后端版本过旧或资源未加载，请重启启动.cmd';
 document.getElementById('connection').textContent='请关闭所有旧启动窗口，重新运行启动.cmd并刷新网页。';
 document.getElementById('run').disabled=true;
 document.getElementById('resume').disabled=true;
 throw error;
}
const {executionConfig,needsBackendRestart}=viewState;
const $=id=>document.getElementById(id);
const names={requirements:'需求分析',design:'架构设计',testplan:'测试规划',code:'编码实现',review:'审查决策'};
const roles={requirements:'需求 Agent',design:'设计 Agent',testplan:'设计 Agent · 并行任务',code:'编码 Agent',review:'设计 Agent · 审查任务'};
const defaultConfig={parallelPlanning:true,reviewEnabled:true,maxRounds:2,forceRevisionDemo:false,agentPrompts:{}};
const configIds=['parallel-planning','review-enabled','max-rounds','force-revision','prompt-requirements','prompt-design','prompt-code','save-config','export-config','import-config','reset-config','simple-config'];
const storageKey='se-flow-workflow-config-v1';
let state={outputs:{},messages:[],events:[]},tab='requirements',running=false,histories=[],liveStatuses={},usageEvents={},serverDefaults=structuredClone(defaultConfig),backendCompatible=false;
let providerSettings={qwen:{name:'千问',model:'qwen-plus',hasKey:false},deepseek:{name:'DeepSeek',model:'deepseek-chat',hasKey:false}};
const templates={todo:'用 Python 标准库实现一个命令行待办清单，支持添加、查看和完成任务，JSON文件持久化，拒绝空标题，处理不存在的编号。代码不超过150行。',grade:'用 Python 实现学生成绩统计，支持输入姓名和0到100的成绩，计算平均分、最高分、最低分，处理空数据及非法成绩。代码不超过100行。',expense:'用 Python 实现命令行记账工具，支持添加金额和分类，按分类统计支出，保存到JSON文件，校验金额为正数。代码不超过120行。'};
function cleanConfig(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('编排必须是JSON对象');
 const maxRounds=Number(value.maxRounds??2);if(!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>3)throw Error('编码轮数必须是1至3的整数');
 for(const key of ['parallelPlanning','reviewEnabled','forceRevisionDemo'])if(value[key]!==undefined&&typeof value[key]!=='boolean')throw Error(key+'必须为布尔值');
 const prompts={};for(const role of ['requirements','design','code']){const text=value.agentPrompts?.[role]??'';if(typeof text!=='string'||text.length>4000)throw Error('Agent指令必须是4000字以内的文本');if(text.trim())prompts[role]=text.trim();}
 return {parallelPlanning:value.parallelPlanning??true,reviewEnabled:value.reviewEnabled??true,maxRounds,forceRevisionDemo:value.forceRevisionDemo??false,agentPrompts:prompts};
}
function readConfig(){return cleanConfig({parallelPlanning:$('parallel-planning').checked,reviewEnabled:$('review-enabled').checked,maxRounds:Number($('max-rounds').value),forceRevisionDemo:$('force-revision').checked,agentPrompts:{requirements:$('prompt-requirements').value,design:$('prompt-design').value,code:$('prompt-code').value}});}
function writeConfig(value){const c=cleanConfig(value);$('parallel-planning').checked=c.parallelPlanning;$('review-enabled').checked=c.reviewEnabled;$('max-rounds').value=c.maxRounds;$('force-revision').checked=c.forceRevisionDemo;for(const role of ['requirements','design','code'])$('prompt-'+role).value=c.agentPrompts[role]||'';syncMode();renderGraph();}
function activeConfig(){return executionConfig(state,readConfig());}
function nodeIds(config){return ['requirements','design',...(config.parallelPlanning?['testplan']:[]),'code',...(config.reviewEnabled?['review']:[])];}
function syncMode(){if(!$('demo').checked)$('force-revision').checked=false;$('force-revision').disabled=running||!$('demo').checked||!$('review-enabled').checked;$('max-rounds').disabled=running||!$('review-enabled').checked;const c=readConfig();const first=3+(c.parallelPlanning?1:0)+(c.reviewEnabled?1:0),maximum=first+(c.reviewEnabled?(c.maxRounds-1)*2:0);$('calls-hint').textContent=$('demo').checked?'当前离线模式不会调用模型。':`真实模式预计 ${first}${maximum>first?' 至 '+maximum:''} 次模型调用，接口重试可能额外消耗额度。`;}
function updateProvider(){const c=providerSettings[$('provider').value];if(!c)return;$('model').value=c.model;$('key').value='';$('key').placeholder=`填入${c.name} API Key，或使用服务端配置`;$('connection').textContent=c.hasKey?`${c.name}：服务端已配置对应Key，可直接运行。`:`${c.name}：请填写该服务商的API Key。`;}
function lock(value){running=value;for(const id of ['run','task','provider','model','key','demo','template','history',...configIds])$(id).disabled=value;$('run').disabled=value||!backendCompatible;$('stop').disabled=!value;$('resume').disabled=value||!backendCompatible||!['failed','cancelled','interrupted'].includes(state.status);if(!backendCompatible)$('connection').textContent='后端未连接或版本过旧，请关闭旧服务并重新运行启动.cmd。';syncMode();}
function make(tag,text,className){const element=document.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element;}
function nodeStatus(id){const entry=state.nodeStates?.[id];return liveStatuses[id]||(typeof entry==='string'?entry:entry?.status)||((state.outputs||{})[id]?'done':'waiting');}
function nodeButton(id){const button=make('button',undefined,'node '+nodeStatus(id)+(tab===id?' selected':''));button.id='node-'+id;button.type='button';button.append(make('span',roles[id],'number'),make('strong',names[id]),make('span',({running:'正在执行…',done:'已完成，产物已交接',completed:'已完成，产物已交接',failed:'失败，可恢复',cancelled:'已停止，可恢复',interrupted:'已中断，可恢复',waiting:'等待执行'})[nodeStatus(id)]||nodeStatus(id)));button.onclick=()=>{tab=id;show();};return button;}
function renderGraph(){
 let config;try{config=activeConfig();}catch{return;}
 $('graph-context').textContent=state.id||Object.keys(state.outputs||{}).length?(state.config?'画布显示本次运行的实际编排；上方修改仅在新建运行时生效。':'此记录来自旧版顺序流程，仅包含需求、设计、编码三个节点。'):'画布预览当前编排，点击运行后按此配置执行。';
 const graph=$('flow');graph.replaceChildren();graph.append(nodeButton('requirements'),make('div','→','arrow'));
 const lane=make('div',undefined,'lane');lane.append(nodeButton('design'));if(config.parallelPlanning)lane.append(nodeButton('testplan'));graph.append(lane,make('div','→','arrow'),nodeButton('code'));
 if(config.reviewEnabled){const row=make('div',undefined,'review-row');row.append(nodeButton('review'));const condition=make('div',undefined,'condition');condition.append(make('b','条件分支与循环'),make('div','审查通过 → 完成'),make('div',`审查不通过 → 修复编码 → 再次审查（最多 ${config.maxRounds} 轮）`));row.append(condition);graph.append(row);}
 const tabs=$('output-tabs');tabs.replaceChildren();for(const id of [...nodeIds(config),'state','trace']){const b=make('button',names[id]||({state:'共享状态',trace:'事件追踪'})[id],tab===id?'active':'');b.dataset.tab=id;b.onclick=()=>{tab=id;show();};tabs.append(b);}
}
function show(){
 const trace=tab==='trace';$('text').classList.toggle('visually-hidden',trace);$('trace-table').classList.toggle('visually-hidden',!trace);
 $('text').textContent=tab==='state'?JSON.stringify(state,null,2):state.outputs?.[tab]||'此节点尚未生成产物。';
 if(trace){$('trace-body').replaceChildren();for(const e of state.events||[]){const tr=make('tr');tr.append(make('td',e.time?new Date(e.time).toLocaleTimeString():''),make('td',e.type||''),make('td',[names[e.agent]||e.agent||'',e.round?'第'+e.round+'轮':'',e.error||e.reason||e.decision||''].filter(Boolean).join(' · ')));$('trace-body').append(tr);}}
 const usage=Object.keys(state.usage||{}).length?state.usage:usageEvents;
 const total=Object.values(usage).reduce((sum,item)=>sum+(item.total_tokens||0),0);
 const seconds=Object.values(state.timings||{}).reduce((sum,value)=>sum+(typeof value==='number'?value:0),0)/1000;
 const config=activeConfig(),ids=nodeIds(config),completed=ids.filter(id=>state.outputs?.[id]).length;
 const round=typeof state.iterations==='number'?state.iterations:(state.iterations?.length||state.round||1);
 $('metrics').textContent=`${completed}/${ids.length} 节点已有产物 · ${seconds.toFixed(1)} 秒（节点累计，含并行） · ${total} Tokens${state.config?.reviewEnabled?' · 编码轮数 '+round:''}${state.demo?' · 离线示例':''}`;
 $('export').disabled=$('report').disabled=!Object.keys(state.outputs||{}).length;$('copy').disabled=$('download').disabled=!state.outputs?.code;renderGraph();
}
function log(text){const line=make('div',new Date().toLocaleTimeString()+'  '+text);$('log').append(line);$('log').scrollTop=$('log').scrollHeight;}
function configMessage(text){$('config-message').textContent=text;}
function download(content,name,type){const anchor=document.createElement('a');anchor.href=URL.createObjectURL(new Blob([content],{type}));anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(anchor.href),1000);}
async function history(){const response=await fetch('/api/history');if(!response.ok)throw Error('读取历史失败');histories=await response.json();$('history').replaceChildren(new Option('选择最近运行记录…',''));for(const h of histories)$('history').add(new Option(`${h.demo?'[离线]':'['+(h.provider==='deepseek'?'DeepSeek':'千问')+']'} ${new Date(h.createdAt).toLocaleString()} · ${h.status} · ${h.task.slice(0,20)}`,h.id));}
function appendEvent(event){if(event.state){state=event.state;return;}state.events||=[];state.events.push({...event,time:event.time||new Date().toISOString()});}
function receive(event){
 appendEvent(event);const label=names[event.agent]||event.agent||'工作流',round=event.round?'（第'+event.round+'轮）':'';
 if(event.state?.nodeStates){for(const [id,entry] of Object.entries(event.state.nodeStates)){const status=typeof entry==='string'?entry:entry?.status;if(status)liveStatuses[id]=status;}}
 if(event.type==='start'){liveStatuses[event.agent]='running';tab=event.agent;log(label+round+' 开始，读取共享状态');}
 if(event.type==='done'){liveStatuses[event.agent]='done';log(label+round+' 完成并交接产物');}
 if(event.type==='skipped'){liveStatuses[event.agent]='done';log(label+'已有完成记录，跳过');}
 if(event.type==='node-failed'){const entry=state.nodeStates?.[event.agent];liveStatuses[event.agent]=(typeof entry==='string'?entry:entry?.status)||'failed';log(label+round+' 节点退出：'+(event.error||'执行失败'));}
 if(event.type==='usage'){usageEvents[event.agent]=event.usage;}
 if(event.type==='retry')log(label+' 接口重试 '+event.attempt);
 if(event.type==='continuation')log(label+' 输出较长，正在自动续写（'+event.attempt+'/2）');
 if(event.type==='parallel')log('并行任务：'+(event.message||event.phase||'架构设计与测试规划共同执行'));
 if(event.type==='branch')log('条件分支：'+(event.decision||event.reason||event.message||(event.approved?'审查通过':'需要修复')));
 if(event.type==='loop')log('修复循环：'+(event.message||'进入下一轮编码与审查'));
 if(['failed','cancelled','interrupted'].includes(event.type)){if(event.agent)liveStatuses[event.agent]=event.type;$('status').textContent=({failed:'执行失败：',cancelled:'已停止：',interrupted:'已中断：'})[event.type]+(event.error||'可从未完成节点恢复');log(event.error||'流程已中断');}
 if(event.type==='error')throw Error(event.error);
 if(event.type==='completed'){$('status').textContent='全部完成'+(state.demo?' · 离线示例':' · '+($('provider').value==='deepseek'?'DeepSeek':'千问')+'生成');log('工作流完成，检查点和历史已保存');}
 show();
}
async function run(resume=false){
 if(running)return;if(location.protocol==='file:'){alert('请通过 http://127.0.0.1:3000 打开工作台后运行。');return;}if(!backendCompatible){alert('当前后端为旧版本或未连接。请关闭所有旧启动窗口，重新运行启动.cmd后刷新网页。');return;}if(!$('task').value.trim()){alert('请先输入需求');return;}
 let config;try{config=readConfig();}catch(e){configMessage(e.message);return;}
 if(!resume){state={task:$('task').value,outputs:{},messages:[],events:[],demo:$('demo').checked,config};liveStatuses={};usageEvents={};$('log').textContent='';show();}
 lock(true);$('status').textContent=$('demo').checked?'离线工作流运行中':'模型工作流运行中';
 try{
  const response=await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({task:$('task').value,key:$('key').value,provider:$('provider').value,model:$('model').value,demo:$('demo').checked,resume,resumeId:state.id,workflow:config})});
  if(!response.ok)throw Error((await response.json()).error);
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',terminal=false;
  function consume(line){const event=JSON.parse(line);if(['failed','cancelled','interrupted','completed'].includes(event.type))terminal=true;receive(event);}
  while(true){const {value,done}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=pending.split('\n');pending=lines.pop();for(const line of lines)if(line.trim())consume(line);if(done)break;}
  if(pending.trim())consume(pending);if(!terminal)throw Error('连接中断，请载入历史检查点后恢复');
 }catch(e){$('status').textContent='运行异常';log(e.message);for(const id of nodeIds(config))if(liveStatuses[id]==='running')liveStatuses[id]='interrupted';}
 finally{lock(false);show();try{await history();}catch(e){log(e.message);}}
}
$('provider').onchange=updateProvider;$('demo').onchange=()=>{syncMode();renderGraph();};
$('template').onchange=()=>{if(templates[$('template').value])$('task').value=templates[$('template').value];};
for(const id of ['parallel-planning','review-enabled','max-rounds','force-revision'])$(id).onchange=()=>{syncMode();renderGraph();configMessage('编排已修改，下一次运行将按当前画布执行。');};
$('save-config').onclick=()=>{try{localStorage.setItem(storageKey,JSON.stringify(readConfig()));configMessage('编排已保存到本机浏览器，不包含API Key。');}catch(e){configMessage('保存失败：'+e.message);}};
$('export-config').onclick=()=>{try{download(JSON.stringify(readConfig(),null,2),'workflow-config.json','application/json');}catch(e){configMessage(e.message);}};
$('import-config').onclick=()=>$('config-file').click();$('config-file').onchange=async()=>{const file=$('config-file').files?.[0];if(!file)return;try{if(file.size>30000)throw Error('编排文件过大');writeConfig(JSON.parse(await file.text()));configMessage('编排已导入，下一次运行使用当前画布。');}catch(e){configMessage('导入失败：'+e.message);}finally{$('config-file').value='';}};
$('reset-config').onclick=()=>{writeConfig(serverDefaults);configMessage('已恢复增强流程。');};$('simple-config').onclick=()=>{writeConfig({parallelPlanning:false,reviewEnabled:false,maxRounds:1,forceRevisionDemo:false,agentPrompts:{}});configMessage('已切换为需求、设计、编码顺序执行。');};
$('history').onchange=()=>{const h=histories.find(item=>item.id===$('history').value);if(!h)return;state=structuredClone(h);liveStatuses={};usageEvents={};$('task').value=h.task;$('demo').checked=!!h.demo;$('provider').value=h.provider||'qwen';updateProvider();$('model').value=h.model;writeConfig(h.config||{parallelPlanning:false,reviewEnabled:false,maxRounds:1,forceRevisionDemo:false,agentPrompts:{}});$('status').textContent='历史记录 · '+h.status;$('log').textContent='';for(const event of h.events||[])log((names[event.agent]||event.agent||'工作流')+' '+event.type+(event.error?'：'+event.error:''));lock(false);show();};
$('run').onclick=()=>run();$('resume').onclick=()=>run(true);$('stop').onclick=async()=>{try{const response=await fetch('/api/cancel',{method:'POST'});if(!response.ok)throw Error('停止失败');log('已请求停止，等待运行中的节点退出');}catch(e){log(e.message);}};
$('export').onclick=()=>download(JSON.stringify(state,null,2),'workflow-result.json','application/json');
$('report').onclick=()=>{const config=state.config||readConfig(),ids=nodeIds(config);const lines=['# Mini SE 工作流实验报告','',`运行ID：${state.id}`,`模式：${state.demo?'离线固定示例':'真实模型调用'}`,`模型：${state.model}`,`状态：${state.status}`,'','## 用户需求',state.task,'','## 编排配置','```json',JSON.stringify(config,null,2),'```','',...ids.flatMap(id=>['## '+names[id],state.outputs?.[id]||'未完成','']),'## 运行统计',$('metrics').textContent,'','## 交接与事件',`消息 ${state.messages?.length||0} 条，事件 ${state.events?.length||0} 条。完整细节见JSON结果。`,'','## 验证说明','本报告记录Agent产物。生成的业务代码尚需独立执行验收。'];download(lines.join('\n'),'实验报告.md','text/markdown');};
function blocks(){return [...(state.outputs?.code||'').matchAll(/```([^\n]*)\n([\s\S]*?)```/g)].map(match=>({lang:match[1].trim().toLowerCase(),content:match[2]}));}
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(state.outputs.code);log('编码产物已复制');}catch{log('复制失败，请手动选择文本复制');}};
$('download').onclick=()=>{const list=blocks().filter(block=>/^(python|py|javascript|js|typescript|ts|html|css|json|bash|sh|sql)$/.test(block.lang));if(!list.length){log('未找到可下载代码块，请导出完整报告');return;}const extensions={python:'py',javascript:'js',typescript:'ts',bash:'sh'};list.forEach((block,index)=>download(block.content,`generated-${index+1}.${extensions[block.lang]||block.lang}`,'text/plain'));log(`已请求下载 ${list.length} 个代码块，请按报告说明命名运行`);};
(async()=>{try{if(location.protocol==='file:'){$('connection').textContent='静态预览：运行启动.cmd后访问 http://127.0.0.1:3000';}else{const response=await fetch('/api/config');if(!response.ok)throw Error('无法读取服务配置');const config=await response.json();backendCompatible=!needsBackendRestart(config);providerSettings=config.providers||providerSettings;$('provider').value=config.provider||'qwen';serverDefaults=cleanConfig(config.workflow||defaultConfig);updateProvider();await history();if(!backendCompatible)$('status').textContent='后端版本过旧，请重启启动.cmd';}let saved;try{saved=JSON.parse(localStorage.getItem(storageKey)||'null');}catch{}writeConfig(saved||serverDefaults);if(saved)configMessage('已载入本机保存的编排。');lock(false);}catch(e){log('初始化失败：'+e.message);writeConfig(defaultConfig);lock(false);}})();
