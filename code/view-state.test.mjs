import test from 'node:test';
import assert from 'node:assert/strict';
import {executionConfig,needsBackendRestart} from './view-state.mjs';
const enhanced={parallelPlanning:true,reviewEnabled:true,maxRounds:3};
test('旧版三节点结果不能被当前增强编排伪装成五节点等待',()=>{
 const config=executionConfig({id:'old',outputs:{requirements:'r',design:'d',code:'c'}},enhanced);
 assert.equal(config.parallelPlanning,false);assert.equal(config.reviewEnabled,false);
});
test('查看运行记录始终使用实际编排，未开始时使用草稿',()=>{
 const recorded={...enhanced,maxRounds:1};assert.equal(executionConfig({id:'new',config:recorded,outputs:{}},enhanced),recorded);
 assert.equal(executionConfig({outputs:{}},enhanced),enhanced);
});
test('旧后端缺少workflow配置时必须提示重启',()=>{
 assert.equal(needsBackendRestart({providers:{}}),true);
 assert.equal(needsBackendRestart({providers:{},workflow:enhanced}),false);
});
