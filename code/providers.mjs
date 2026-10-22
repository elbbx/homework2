export const providers = {
 qwen:{name:'千问',base:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus'},
 deepseek:{name:'DeepSeek',base:'https://api.deepseek.com',model:'deepseek-chat'}
};
export function providerConfig(provider,env=process.env){
 if(!Object.hasOwn(providers,provider))throw Error('请选择千问或DeepSeek');
 const defaults=providers[provider];
 return {provider,name:defaults.name,base:(provider==='qwen'?env.QWEN_BASE_URL:env.DEEPSEEK_BASE_URL)||defaults.base,model:(provider==='qwen'?env.QWEN_MODEL:env.DEEPSEEK_MODEL)||defaults.model,key:(provider==='qwen'?env.DASHSCOPE_API_KEY:env.DEEPSEEK_API_KEY)||''};
}
export function resolveConfig(data,env=process.env){
 const config=providerConfig(data.provider||env.LLM_PROVIDER||'qwen',env);
 config.base=config.base.replace(/\/+$/,'');
 const url=new URL(config.base);
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw Error('服务端API地址必须是无账号、查询参数的HTTPS地址');
 config.key=data.key?.trim()||config.key;
 config.model=data.model?.trim()||config.model;
 if(typeof config.model!=='string'||config.model.length>100)throw Error('模型名称无效');
 if(!data.demo&&!config.key)throw Error(`请填写${config.name} API Key，或配置对应环境变量`);
 return config;
}
