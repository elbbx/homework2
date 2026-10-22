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
 assert.equal(Object.hasOwn(payload,'enable_thinking'),provider==='qwen');
 assert.equal(events[0].usage.total_tokens,12);
});
test('鉴权失败不会重复请求，也不会泄漏密钥',async(t)=>{
 let count=0;t.mock.method(globalThis,'fetch',async()=>{count++;return new Response('unauthorized',{status:401});});
 await assert.rejects(callModel(agents[0],'input',{key:'secret-test',provider:'deepseek',base:'https://api.deepseek.com',model:'deepseek-chat'}),e=>e.message.includes('DeepSeek接口 HTTP 401')&&!e.message.includes('secret-test'));
 assert.equal(count,1);
});
