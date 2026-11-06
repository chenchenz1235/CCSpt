import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';import {chromium} from 'playwright-core';
import {connect,validateConfig,collectFrames,root} from '../scripts/common.mjs';import {query} from '../scripts/query.mjs';
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port;}
async function child(script,args,env,input){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[script,...args],{env:{...process.env,...env},stdio:['pipe','pipe','pipe'],windowsHide:true});let stdout='',stderr='';p.stdout.on('data',c=>stdout+=c);p.stderr.on('data',c=>stderr+=c);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));p.stdin.end(input||'');});}
test('Edge CDP, synthetic optional login and list query',{timeout:90000},async(t)=>{
 let loggedIn=false,receivedPassword='';
 const server=http.createServer((req,res)=>{
  res.setHeader('Content-Type','text/html; charset=utf-8');const u=new URL(req.url,'http://local.invalid');
  if(u.pathname==='/fixture-login'){let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{const fields=new URLSearchParams(raw);receivedPassword=fields.get('password');loggedIn=fields.get('username')==='fixture-user'&&receivedPassword==='fixture-secret-not-real';res.end('ok');});return;}
  if(u.pathname==='/list'){const kind=u.searchParams.get('method');res.end(`<body><ul class="common_search_condition"><span id="example_dropdown_text">条件</span></ul><a>标题</a><input id="title"><a class="seary-bar-btn">筛选</a><table><tr><td abbr="subject">报告示例</td><td abbr="state">${kind==='listSent'?'已发':'草稿'}</td></tr></table><div>共1条记录</div></body>`);return;}
  if(loggedIn&&u.searchParams.get('method')==='main'){res.end(`<body><div onclick="document.querySelector('#nav').hidden=false">协同工作</div><div id="nav" hidden><div onclick="document.querySelector('iframe').src='/list?method=listWaitSend'">待发事项</div><div onclick="document.querySelector('iframe').src='/list?method=listSent'">已发事项</div></div><iframe name="mainIframe"></iframe></body>`);return;}
  res.end(`<body><input id="login_username"><input id="login_password" type="password"><button id="login_button" onclick="fetch('/fixture-login',{method:'POST',body:new URLSearchParams({username:document.querySelector('#login_username').value,password:document.querySelector('#login_password').value})}).then(()=>location.href='/seeyon/main.do?method=main')">登录</button></body>`);
 });
 const port=await listen(server),reserve=http.createServer(),cdpPort=await listen(reserve);await new Promise(r=>reserve.close(r));
 const temp=await fs.mkdtemp(path.join(root,'.test-'));let owner,attached;
 try{
  try{owner=await chromium.launch({channel:'msedge',headless:true,args:[`--remote-debugging-port=${cdpPort}`,'--remote-debugging-address=127.0.0.1']});}catch(e){if(process.env.OA_REQUIRE_EDGE_TEST==='1')throw e;t.skip('Microsoft Edge unavailable; set OA_REQUIRE_EDGE_TEST=1 to require integration.');return;}
  const config=validateConfig({oaUrl:`http://127.0.0.1:${port}/seeyon/main.do?method=index`,cdpEndpoint:`http://127.0.0.1:${cdpPort}`,outputDir:path.join(temp,'state')});
  const configPath=path.join(temp,'config.json');await fs.writeFile(configPath,JSON.stringify(config));
  const page=await owner.newPage();await page.goto(config.oaUrl);
  const env={OA_CONFIG_PATH:configPath};
  const denied=await child(path.join(root,'scripts/optional-login.mjs'),[],env,'');assert.notEqual(denied.code,0);assert.equal(loggedIn,false);
  const result=await child(path.join(root,'scripts/optional-login.mjs'),['--confirmed'],env,JSON.stringify({username:'fixture-user',password:'fixture-secret-not-real'}));
  assert.equal(result.code,0,result.stderr);assert.match(result.stdout,/login succeeded/);assert.equal(receivedPassword,'fixture-secret-not-real');assert.equal((result.stdout+result.stderr).includes('fixture-secret-not-real'),false);
  attached=await connect(config);const waiting=await query(attached,config,'waiting');assert.equal(waiting.rows[0].state,'草稿');
  const sent=await query(attached,config,'sent','报告示例');assert.equal(sent.rows.length,1);assert.equal(sent.rows[0].state,'已发');
  const captured=await collectFrames(page);assert.ok(captured.some(f=>f.text.includes('报告示例')));
  const status=await child(path.join(root,'scripts/oa.mjs'),['status'],env,'');assert.equal(status.code,0);assert.equal(JSON.parse(status.stdout).tabs[0].signedInNavigation,true);
 }finally{if(attached)await attached.close();if(owner)await owner.close();await new Promise(r=>server.close(r));if(path.dirname(path.resolve(temp))!==path.resolve(root)||!path.basename(temp).startsWith('.test-'))throw Error('Unexpected cleanup target');await fs.rm(temp,{recursive:true,force:true});}
});

