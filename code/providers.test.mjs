import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveConfig,providerConfig} from './providers.mjs';
import {callModel,agents} from './workflow.mjs';

test('两家服务商各自选择模型、地址和密钥',()=>{
 const env={DASHSCOPE_API_KEY:'qwen-test',DEEPSEEK_API_KEY:'deepseek-test'};
 assert.equal(resolveConfig({provider:'qwen'},env).key,'qwen-test');
 const d=resolveConfig({provider:'deepseek'},env);
 assert.equal(d.key,'deepseek-test');assert.equal(d.model,'deepseek-chat');assert.equal(d.base,'https://api.deepseek.com');
 assert.equal(resolveConfig({provider:'deepseek',key:' override ',model:'custom-model'},env).key,'override');
 assert.equal(providerConfig('qwen',{}).model,'qwen-plus');
 assert.equal(providerConfig('qwen',{}).maxTokens,undefined);
 assert.equal(providerConfig('qwen',{MAX_OUTPUT_TOKENS:'  '}).maxTokens,undefined);
 assert.equal(providerConfig('deepseek',{MAX_OUTPUT_TOKENS:'12000'}).maxTokens,12000);
 assert.throws(()=>providerConfig('qwen',{MAX_OUTPUT_TOKENS:'invalid'}),/MAX_OUTPUT_TOKENS/);
});
test('DeepSeek缺少密钥时不会回退使用千问密钥，非法配置被拒绝',()=>{
 const env={DASHSCOPE_API_KEY:'qwen-only'};
 assert.throws(()=>resolveConfig({provider:'deepseek'},env),/DeepSeek API Key/);
 assert.throws(()=>resolveConfig({provider:'other'},env),/请选择/);
 assert.throws(()=>resolveConfig({provider:'qwen'},{...env,QWEN_BASE_URL:'https://test.invalid/?key=secret'}),/HTTPS地址/);
 assert.equal(resolveConfig({provider:'deepseek',demo:true},env).key,'');
});
for(const provider of ['qwen','deepseek'])test(`${provider} 请求协议与产物交接`,async(t)=>{
 const config=resolveConfig({provider,key:'test-key'},{});
 let request;
 t.mock.method(globalThis,'fetch',async(url,options)=>{request={url,...options};return new Response(JSON.stringify({choices:[{message:{content:'模拟产物'},finish_reason:'stop'}],usage:{total_tokens:12}}),{status:200});});
 const events=[];const output=await callModel(agents[0],'上游输入',{...config,emit:e=>events.push(e)});
 assert.equal(output,'模拟产物');assert.equal(request.url,config.base+'/chat/completions');
 const payload=JSON.parse(request.body);assert.equal(payload.model,config.model);assert.equal(payload.messages[1].content,'上游输入');
 assert.equal(request.headers.Authorization,'Bearer test-key');
 assert.equal(Object.hasOwn(payload,'max_tokens'),false);
 assert.equal(Object.hasOwn(payload,'enable_thinking'),provider==='qwen');
 assert.equal(events[0].usage.total_tokens,12);
});
test('鉴权失败不会重复请求，也不会泄漏密钥',async(t)=>{
 let count=0;t.mock.method(globalThis,'fetch',async()=>{count++;return new Response('unauthorized',{status:401});});
 await assert.rejects(callModel(agents[0],'input',{key:'secret-test',provider:'deepseek',base:'https://api.deepseek.com',model:'deepseek-chat'}),e=>e.message.includes('DeepSeek接口 HTTP 401')&&!e.message.includes('secret-test'));
 assert.equal(count,1);
});
test('长输出自动续写后才返回完整产物，保留上下文并累计各段用量',async(t)=>{
 const bodies=[],events=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{bodies.push(JSON.parse(options.body));return new Response(JSON.stringify({choices:[{message:{content:bodies.length===1?'```python\nprint(':'1)\n```'},finish_reason:bodies.length===1?'length':'stop'}],usage:{total_tokens:10}}),{status:200});});
 const result=await callModel(agents[2],'input',{key:'test',model:'test',base:'https://test.invalid',emit:e=>events.push(e)});
 assert.equal(result,'```python\nprint(1)\n```');assert.equal(bodies.length,2);
 assert.equal(Object.hasOwn(bodies[0],'max_tokens'),false);assert.equal(Object.hasOwn(bodies[1],'max_tokens'),false);assert.equal(bodies[1].messages[2].content,'```python\nprint(');
 assert.equal(events.filter(e=>e.type==='continuation').length,1);
 assert.equal(events.filter(e=>e.type==='usage').reduce((n,e)=>n+e.usage.total_tokens,0),20);
});
test('连续截断最多续写两次，不能把不完整代码当成成功',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'partial'},finish_reason:'length'}]}),{status:200});});
 await assert.rejects(callModel(agents[2],'input',{key:'test',model:'test',base:'https://test.invalid'}),/两次自动续写后仍未完成/);assert.equal(calls,3);
});
test('截断的审查JSON直接失败，不拼接出伪批准',async(t)=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify({choices:[{message:{content:'{"approved":'},finish_reason:'length'}]}),{status:200});});
 await assert.rejects(callModel({...agents[1],id:'review'},'input',{key:'test',model:'test',base:'https://test.invalid'}),/审查JSON达到输出上限/);assert.equal(calls,1);
});
test('只有显式设置时才发送max_tokens，且不附加程序硬编码上限',async(t)=>{
 let payload;t.mock.method(globalThis,'fetch',async(url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:'ok'},finish_reason:'stop'}]}),{status:200});});
 await callModel(agents[0],'input',{key:'test',model:'test',base:'https://test.invalid',maxTokens:65536});
 assert.equal(payload.max_tokens,65536);
 await assert.rejects(callModel(agents[0],'input',{key:'test',model:'test',base:'https://test.invalid',maxTokens:0}),/正整数/);
});
