// Runs the actual frontend logic against a lightweight in-memory DOM, not a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as viewState from './view-state.mjs';
import * as customTools from './custom-config.mjs';
import * as canvasTools from './graph-canvas.mjs';
import {workflow,demo} from './workflow.mjs';
import {defaultWorkflowConfig} from './workflow-config.mjs';
class Element{
 constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.value='';this.checked=false;this.disabled=false;this.textContent='';const classes=new Set();this.classList={toggle:(key,on)=>{if(on??!classes.has(key))classes.add(key);else classes.delete(key);}};}
 setAttribute(key,value){this[key]=value;}
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
 const document={getElementById:id=>ids.get(id)||null,head:new Element('head'),createElement:t=>{const e=new Element(t);e.ownerDocument=document;return e;},createTextNode:t=>({textContent:t})};document.createElementNS=(ns,t)=>document.createElement(t);for(const e of ids.values())e.ownerDocument=document;
 const fetch=async(url,options)=>{
  if(url==='/api/config')return Response.json({customWorkflow:true,workflow:defaultWorkflowConfig,provider:'qwen',providers:{qwen:{name:'千问',model:'qwen-plus',hasKey:false},deepseek:{name:'DeepSeek',model:'deepseek-chat',hasKey:false}}});
  if(url==='/api/history')return Response.json([]);
  if(url==='/api/run'){const data=JSON.parse(options.body);requests.push(data);const events=[];await workflow({task:data.task,config:data.workflow,call:async(a,input)=>demo(a,input),emit:e=>events.push(e)});return new Response(events.map(e=>JSON.stringify(e)).join('\n')+'\n');}
  throw Error('Unexpected request '+url);
 };
 const context=vm.createContext({document,fetch,Response,TextDecoder,structuredClone,console,URL,Blob,setTimeout,Option:class extends Element{constructor(text,value){super('option');this.textContent=text;this.value=value;}},location:{protocol:'http:'},navigator:{clipboard:{writeText:async()=>{}}},alert:message=>{throw Error(message);},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},__load:async path=>path.includes('view-state')?viewState:path.includes('graph-canvas')?canvasTools:customTools});
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
test('画布拖动保存位置，点击端口建立实际依赖并拒绝成环',async()=>{
 const p=await page();p.ids.get('workflow-kind').value='custom';p.ids.get('workflow-kind').onchange();
 let viewport=p.ids.get('flow').querySelectorAll('div').find(e=>e.className==='graph-viewport');
 let card=p.ids.get('flow').querySelectorAll('div').find(e=>e.dataset.node==='requirements');
 card.children[0].onpointerdown({clientX:0,clientY:0,pointerId:1,preventDefault(){}});viewport.onpointermove({clientX:70,clientY:50});viewport.onpointerup({});
 assert.equal(p.api.readConfig().nodes[0].position.x,125);assert.equal(p.api.readConfig().nodes[0].position.y,115);
 viewport=p.ids.get('flow').querySelectorAll('div').find(e=>e.className==='graph-viewport');viewport.getBoundingClientRect=()=>({left:0,top:0});viewport.scrollLeft=0;viewport.scrollTop=0;
 card=p.ids.get('flow').querySelectorAll('div').find(e=>e.dataset.node==='requirements');card.children[3].onpointerdown({pointerId:2,preventDefault(){},stopPropagation(){}});viewport.onpointerup({clientX:635,clientY:120});assert.ok(p.api.readConfig().nodes[2].dependsOn.includes('requirements'));
 const cfg=customTools.customTemplate();const connected=canvasTools.connectNodes(cfg,'requirements','code');assert.ok(connected.nodes[2].dependsOn.includes('requirements'));assert.throws(()=>canvasTools.connectNodes(cfg,'code','requirements'),/循环/);
});
test('画布解除连线与坐标可通过配置导入导出保留',()=>{
 const c=canvasTools.autoLayout(customTools.customTemplate());const d=canvasTools.disconnectNodes(c,'design','code');assert.equal(d.nodes[2].dependsOn.length,0);
 assert.deepEqual(customTools.validateCustomConfig(JSON.parse(JSON.stringify(d))).nodes[0].position,c.nodes[0].position);
});
