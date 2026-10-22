// Runs the actual frontend logic against a lightweight in-memory DOM, not a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as viewState from './view-state.mjs';
import * as customTools from './custom-config.mjs';
import {workflow,demo} from './workflow.mjs';
import {defaultWorkflowConfig} from './workflow-config.mjs';
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.value='';this.checked=false;this.disabled=false;this.textContent='';const classes=new Set();this.classList={toggle:(key,on)=>{if(on??!classes.has(key))classes.add(key);else classes.delete(key);}};}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=[...items];}
 add(item){this.children.push(item);}
 querySelectorAll(selector){const tags=selector.split(',');return this.children.flatMap(c=>c instanceof Element?[...(tags.includes(c.tagName)?[c]:[]),...c.querySelectorAll(selector)]:[]);}
 click(){return this.onclick?.();}
}
async function page(){
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8'),source=await readFile(new URL('./app.js',import.meta.url),'utf8');
 const ids=new Map();for(const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)){const e=new Element(match[1]);e.value=match[2].match(/\bvalue="([^"]*)"/)?.[1]||'';e.checked=/\bchecked\b/.test(match[2]);ids.set(match[3],e);}
 const storage=new Map(),requests=[];
 const document={getElementById:id=>{if(!ids.has(id))throw Error('Missing DOM id '+id);return ids.get(id);},createElement:t=>new Element(t),createTextNode:t=>({textContent:t})};
 const fetch=async(url,options)=>{
  if(url==='/api/config')return Response.json({customWorkflow:true,workflow:defaultWorkflowConfig,provider:'qwen',providers:{qwen:{name:'千问',model:'qwen-plus',hasKey:false},deepseek:{name:'DeepSeek',model:'deepseek-chat',hasKey:false}}});
  if(url==='/api/history')return Response.json([]);
  if(url==='/api/run'){const data=JSON.parse(options.body);requests.push(data);const events=[];await workflow({task:data.task,config:data.workflow,call:async(a,input)=>demo(a,input),emit:e=>events.push(e)});return new Response(events.map(e=>JSON.stringify(e)).join('\n')+'\n');}
  throw Error('Unexpected request '+url);
 };
 const context=vm.createContext({document,fetch,Response,TextDecoder,structuredClone,console,URL,Blob,setTimeout,Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},location:{protocol:'http:'},navigator:{clipboard:{writeText:async()=>{}}},alert:message=>{throw Error(message);},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},__load:async path=>path.includes('view-state')?viewState:customTools});
 const script=source.replace(/await import\(([^)]+)\)/g,'await __load($1)');
 const api=await vm.runInContext('(async()=>{'+script+'\nreturn {readConfig,run,getState:()=>state};})()',context);
 await new Promise(setImmediate);return {ids,storage,requests,api};
}
test('自定义编辑器添加、编辑、删除和保存配置，不保存API Key',async()=>{
 const p=await page();p.ids.get('workflow-kind').value='custom';p.ids.get('workflow-kind').onchange();assert.equal(p.api.readConfig().nodes.length,3);
 p.ids.get('add-node').click();assert.equal(p.api.readConfig().nodes.length,4);
 const cards=p.ids.get('custom-nodes').children.filter(e=>e.className==='custom-card');const fields=cards.at(-1).querySelectorAll('input');fields[0].value='总结节点';fields[0].oninput();assert.equal(p.api.readConfig().nodes.at(-1).name,'总结节点');
 const selected=fields.find(e=>e.type==='checkbox'&&e.checked);selected.checked=false;selected.onchange();assert.equal(p.api.readConfig().nodes.at(-1).dependsOn.length,0);
 p.ids.get('key').value='private-ui-key';p.ids.get('save-config').click();assert.ok(![...p.storage.values()].join().includes('private-ui-key'));
 cards.at(-1).querySelectorAll('button')[0].click();assert.equal(p.api.readConfig().nodes.length,3);
});
test('前端将编辑后的自定义配置提交执行，画布结果包含新增节点',async()=>{
 const p=await page();p.ids.get('workflow-kind').value='custom';p.ids.get('workflow-kind').onchange();p.ids.get('add-node').click();p.ids.get('task').value='验证自定义流程';p.ids.get('demo').checked=true;p.ids.get('demo').onchange();
 await p.api.run();assert.equal(p.requests[0].workflow.kind,'custom');assert.equal(p.requests[0].workflow.nodes.length,4);assert.equal(p.api.getState().status,'completed');assert.ok(p.api.getState().outputs.step1);
});
