import {validateCustomConfig} from './custom-config.mjs';
export const defaultWorkflowConfig = Object.freeze({
 parallelPlanning:true,
 reviewEnabled:true,
 maxRounds:2,
 forceRevisionDemo:false,
 agentPrompts:Object.freeze({})
});

export function validateWorkflowConfig(value){
 if(value?.kind==='custom')return validateCustomConfig(value);
 if(value===undefined||value===null)value={};
 if(typeof value!=='object'||Array.isArray(value))throw Error('工作流配置必须是对象');
 const known=['parallelPlanning','reviewEnabled','maxRounds','forceRevisionDemo','agentPrompts'];
 if(Object.keys(value).some(key=>!known.includes(key)))throw Error('工作流配置包含未知字段');
 const config={...defaultWorkflowConfig,...value};
 for(const key of ['parallelPlanning','reviewEnabled','forceRevisionDemo'])if(typeof config[key]!=='boolean')throw Error(`${key}必须是布尔值`);
 if(!Number.isInteger(config.maxRounds)||config.maxRounds<1||config.maxRounds>3)throw Error('最大编码轮数必须为1至3');
 if(!config.agentPrompts||typeof config.agentPrompts!=='object'||Array.isArray(config.agentPrompts))throw Error('Agent提示词配置必须是对象');
 const prompts={};
 for(const [role,prompt] of Object.entries(config.agentPrompts)){
  if(!['requirements','design','code'].includes(role))throw Error('未知Agent角色');
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>6000)throw Error('自定义提示词必须为1至6000字');
  prompts[role]=prompt.trim();
 }
 return {...config,agentPrompts:prompts};
}
