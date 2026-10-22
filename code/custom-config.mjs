export function validateCustomConfig(value){
 if(!value||value.kind!=='custom'||!Array.isArray(value.nodes)||value.nodes.length<2||value.nodes.length>12)throw Error('自定义工作流需包含2至12个节点');
 const ids=new Set();
 const nodes=value.nodes.map(n=>{
  if(!n||typeof n.id!=='string'||!/^[a-z][a-z0-9_-]{0,31}$/.test(n.id)||['constructor','prototype'].includes(n.id)||ids.has(n.id))throw Error('节点ID需唯一，使用小写字母、数字或下划线');
  ids.add(n.id);
  if(typeof n.name!=='string'||!n.name.trim()||n.name.length>80)throw Error('节点名称需为1至80字');
  if(typeof n.prompt!=='string'||!n.prompt.trim()||n.prompt.length>6000)throw Error('每个节点需填写1至6000字提示词');
  if(typeof n.role!=='string'||!n.role.trim()||n.role.length>80)throw Error('请填写节点角色');
  if(!['agent','review'].includes(n.type)||!Array.isArray(n.dependsOn)||n.dependsOn.some(x=>typeof x!=='string'))throw Error('节点类型或依赖格式错误');
  const node={id:n.id,name:n.name.trim(),role:n.role.trim(),type:n.type,prompt:n.prompt.trim(),dependsOn:[...new Set(n.dependsOn)]};
  if(n.position!==undefined){if(!n.position||!Number.isFinite(n.position.x)||!Number.isFinite(n.position.y)||n.position.x<0||n.position.y<0||n.position.x>4000||n.position.y>3000)throw Error('节点位置坐标无效');node.position={x:n.position.x,y:n.position.y};}
  if(n.type==='review'){
   if(typeof n.retryTarget!=='string'||!n.retryTarget)throw Error('审查节点必须选择返工目标');
   const maxRounds=Number(n.maxRounds??3);if(!Number.isInteger(maxRounds)||maxRounds<1||maxRounds>5)throw Error('审查轮数必须为1至5');
   Object.assign(node,{retryTarget:n.retryTarget,maxRounds});
  }
  return node;
 });
 for(const n of nodes)if(n.dependsOn.some(id=>!ids.has(id)||id===n.id))throw Error('依赖必须指向其他已存在节点');
 const visited=new Set(),visiting=new Set();
 function visit(id){if(visiting.has(id))throw Error('普通连线不可形成循环，请使用审查节点的返工目标');if(visited.has(id))return;visiting.add(id);for(const parent of nodes.find(n=>n.id===id).dependsOn)visit(parent);visiting.delete(id);visited.add(id);}
 for(const n of nodes)visit(n.id);
 function ancestors(id,set=new Set()){for(const p of nodes.find(n=>n.id===id).dependsOn){set.add(p);ancestors(p,set);}return set;}
 for(const n of nodes)if(n.type==='review'&&(!ids.has(n.retryTarget)||!ancestors(n.id).has(n.retryTarget)))throw Error('返工目标必须是该审查节点的上游节点');
 if(value.forceRevisionDemo!==undefined&&typeof value.forceRevisionDemo!=='boolean')throw Error('演示修订开关格式错误');
 return {kind:'custom',nodes,forceRevisionDemo:value.forceRevisionDemo??false};
}
export function customTemplate(){return {kind:'custom',forceRevisionDemo:false,nodes:[
 {id:'requirements',name:'需求分析',role:'需求 Agent',type:'agent',prompt:'分析用户需求，明确功能、输入输出、边界条件和验收标准。',dependsOn:[]},
 {id:'design',name:'架构设计',role:'设计 Agent',type:'agent',prompt:'根据需求设计可运行的软件架构、接口和数据结构。',dependsOn:['requirements']},
 {id:'code',name:'编码实现',role:'编码 Agent',type:'agent',prompt:'根据上游需求与设计输出完整源码、测试与运行说明。不得声称已经执行代码。',dependsOn:['design']}
 ]};}
