import {spawn} from 'node:child_process';
import {createWorkflowServer} from './server-app.mjs';

const server=await createWorkflowServer();
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已占用。如果已有作业服务，请直接打开 http://127.0.0.1:'+(process.env.PORT||3000)+'，或关闭旧服务后重试。':error.message);process.exitCode=1;});
server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>{
 const url='http://127.0.0.1:'+server.address().port;
 console.log('Homework 2: '+url);
 if(process.env.OPEN_BROWSER==='1'&&process.platform==='win32'){
  const browser=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore'});
  browser.on('error',()=>console.log('请在浏览器地址栏打开 '+url));
  browser.unref();
 }
});
