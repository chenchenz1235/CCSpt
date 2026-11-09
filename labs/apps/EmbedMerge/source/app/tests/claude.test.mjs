import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {Workspace} from '../core/workspace.mjs';
import {ClaudeBackend} from '../core/claude.mjs';

async function fixture(t,run){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'em-claude-test-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const roots={ref:path.join(root,'ref'),test:path.join(root,'test')};for(const p of Object.values(roots)){await fs.mkdir(p);await fs.writeFile(path.join(p,'params.c'),'int gain = 1;\n');}
 const w=new Workspace(path.join(root,'data'));await w.create(roots);let invocation;const events=[];
 const spawn=(exe,args,options)=>{
  invocation={exe,args,options};const child=new EventEmitter();for(const name of ['stdin','stdout','stderr'])child[name]=new PassThrough();
  let input='';child.stdin.on('data',c=>input+=c);child.kill=()=>{child.killed=true;queueMicrotask(()=>child.emit('close',null));return true;};
  child.stdin.on('finish',()=>{const config=JSON.parse(args[args.indexOf('--mcp-config')+1]).mcpServers.embedmerge;let seq=0;
   const request=async(method,params={},extra={})=>{const r=await fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json',...extra},body:JSON.stringify({jsonrpc:'2.0',id:++seq,method,params})});return {status:r.status,body:await r.json()};};
   const emit=m=>child.stdout.write(JSON.stringify(m)+'\n');
   const finish=(result='synthetic test answer',more={})=>{emit({type:'result',subtype:'success',result,...more});child.stdout.end();child.emit('close',0);};
   Promise.resolve().then(()=>run({child,request,emit,finish,input:JSON.parse(input),invocation})).catch(e=>{child.stderr.write(e.stack);child.emit('error',e);child.emit('close',1);});
  });return child;
 };
 const a=new ClaudeBackend(w,(type,p)=>events.push({type,p}),{find:async()=>({command:'fake-claude.exe',args:[]}),spawn});t.after(()=>a.close());return {a,w,events,get invocation(){return invocation;}};
}

test('Claude inherits native tools and project configuration while keeping authenticated app MCP and permission prompts',async t=>{
 const f=await fixture(t,async({request,emit,finish,input,invocation})=>{
  const args=invocation.args;assert.ok(!args.includes('--tools'));assert.ok(!args.includes('--strict-mcp-config'));assert.ok(!args.includes('--settings'));assert.ok(!args.includes('--setting-sources'));assert.ok(!args.includes('--system-prompt'));assert.ok(args.includes('--append-system-prompt'));assert.equal(args[args.indexOf('--permission-mode')+1],'default');assert.equal(args[args.indexOf('--permission-prompt-tool')+1],'mcp__embedmerge__permission_prompt');assert.ok(!args.includes('--dangerously-skip-permissions'));assert.ok(invocation.options.cwd.endsWith(path.join('work','test')));assert.equal(invocation.options.windowsHide,true);assert.equal(input.context.rel,'params.c');
  assert.equal((await request('tools/list',{}, {Authorization:'Bearer wrong'})).status,403);
  assert.equal((await request('tools/list',{}, {Origin:'https://example.com'})).status,403);
  assert.ok((await request('initialize',{protocolVersion:'2025-03-26'})).body.result.capabilities.tools);
  const tools=(await request('tools/list')).body.result.tools;assert.deepEqual(tools.map(x=>x.name),['project_files','review_command','application_settings','permission_prompt','ask_user']);
  const read=(await request('tools/call',{name:'project_files',arguments:{action:'read',side:'test',rel:'params.c'}})).body.result;
  assert.equal(read.isError,false);assert.match(read.content[0].text,/int gain = 1/);
  const denied=(await request('tools/call',{name:'project_files',arguments:{action:'replace',side:'test',rel:'params.c',before:'1',after:'2'}})).body.result;assert.equal(denied.isError,true);assert.match(denied.content[0].text,/只读/);
  emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'synthetic '}}});finish();
 });
 const r=await f.a.ask({question:'explain gain',rel:'params.c'});assert.equal(r.status,'completed');assert.equal(r.budget.write,false);assert.equal(r.budget.calls,2);assert.ok(f.events.some(x=>x.type==='ai-delta'));assert.equal(f.w.task.chat.at(-1).provider,'claude');
});

test('explicit grant changes versioned buffer only and rejects stale versions',async t=>{
 const f=await fixture(t,async({request,finish})=>{
  const read=(await request('tools/call',{name:'project_files',arguments:{action:'read',side:'test',rel:'params.c'}})).body.result;const version=JSON.parse(read.content[0].text).version;
  const args={action:'replace',side:'test',rel:'params.c',version,before:'gain = 1',after:'gain = 2'};
  assert.equal((await request('tools/call',{name:'project_files',arguments:args})).body.result.isError,false);
  assert.equal((await request('tools/call',{name:'project_files',arguments:{...args,before:'gain = 2',after:'gain = 3'}})).body.result.isError,true);finish();
 });
 await f.a.ask({question:'set gain to 2 in draft',rel:'params.c',write:true});const b=await f.w.open('test','params.c');assert.match(b.text,/gain = 2/);assert.equal(b.dirty,true);assert.match(await fs.readFile((await f.w.file('test','params.c')).p,'utf8'),/gain = 1/);
});

test('budget and task boundary are enforced by the same evidence broker',async t=>{
 const f=await fixture(t,async({request,finish})=>{
  const call=arguments_=>request('tools/call',{name:'project_files',arguments:arguments_});
  assert.equal((await call({action:'read',side:'test',rel:'params.c'})).body.result.isError,false);
  const limited=(await call({action:'read',side:'test',rel:'params.c'})).body.result;assert.equal(limited.isError,true);assert.match(limited.content[0].text,/预算/);finish();
 });await f.a.ask({question:'read',rel:'params.c',maxCalls:1});
});

test('stop interrupts Claude and clears busy state; no completed response is fabricated',async t=>{
 let started;const ready=new Promise(r=>started=r);const f=await fixture(t,async()=>started());
 const pending=f.a.ask({question:'keep working',rel:'params.c'});await ready;await f.a.stop();const r=await pending;assert.equal(r.status,'interrupted');assert.equal(f.a.active,null);assert.equal(f.a.starting,false);
});

test('shared chat rejects independent Claude turns without spawning',async t=>{
 const f=await fixture(t,async()=>{throw Error('must not spawn');});f.w.task.sharedChat={threadId:'desktop'};await assert.rejects(f.a.ask({question:'review'}),/共享聊天/);assert.equal(f.invocation,undefined);
});

test('CLI error results stay failed and retain error details',async t=>{
 const f=await fixture(t,async({finish})=>finish('authentication failed',{is_error:true,subtype:'error_during_execution',errors:['synthetic authentication failure']}));const r=await f.a.ask({question:'hello'});assert.equal(r.status,'failed');assert.match(r.error,/authentication/);
});

test('a CLI that exits zero without a terminal result is a visible failure',async t=>{
 const f=await fixture(t,async({child})=>child.emit('close',0));const r=await f.a.ask({question:'hello'});assert.equal(r.status,'failed');assert.match(r.error,/未返回完整结果/);assert.match(r.error,/终端验证/);assert.equal(r.text,'');assert.equal(f.a.active,null);
});

test('Claude application_settings tool reaches the shared bounded settings broker',async t=>{
 const calls=[];const f=await fixture(t,async({request,finish})=>{
  const r=(await request('tools/call',{name:'application_settings',arguments:{action:'fill',section:'comparison',values:{comparisonTest:'D:/customer/new.c'}}})).body.result;
  assert.equal(r.isError,false);assert.match(r.content[0].text,/filled/);finish('设置已填入，未开始比较');
 });f.a.applicationSettings=async args=>{calls.push(args);return {status:'filled',saved:false};};
 const r=await f.a.ask({question:'填入右侧路径 D:/customer/new.c'});assert.equal(r.status,'completed');assert.equal(calls.length,1);assert.equal(calls[0].values.comparisonTest,'D:/customer/new.c');assert.equal(r.budget.write,false);
});

test('Claude native permissions use the real user response and preserve exact requested input',async t=>{
 const seen=[];const f=await fixture(t,async({request,finish})=>{
  const input={command:'echo simulated',description:'No real command runs in this unit fixture'};
  const r=(await request('tools/call',{name:'permission_prompt',arguments:{tool_name:'Bash',input,tool_use_id:'native-1'}})).body.result;
  const decision=JSON.parse(r.content[0].text);assert.equal(decision.behavior,'allow');assert.deepEqual(decision.updatedInput,input);assert.deepEqual(decision.updatedPermissions,[]);finish();
 });f.a.requestUser=async r=>{seen.push(r);return {decision:'accept'};};await f.a.ask({question:'请执行模拟命令'});assert.equal(seen[0].provider,'claude');assert.equal(seen[0].params.tool,'Bash');assert.deepEqual(seen[0].params.availableDecisions,['accept','decline']);
});
test('Claude native permission denial and user clarification are returned through the authenticated bridge',async t=>{
 const f=await fixture(t,async({request,finish})=>{
  const r=(await request('tools/call',{name:'permission_prompt',arguments:{tool_name:'Write',input:{file_path:'do-not-write.txt',content:'test'}}})).body.result;assert.equal(JSON.parse(r.content[0].text).behavior,'deny');
  const q=(await request('tools/call',{name:'ask_user',arguments:{questions:[{id:'scope',question:'选择范围',options:['当前工程','其他']} ]}})).body.result;assert.deepEqual(JSON.parse(q.content[0].text).answers.scope.answers,['当前工程']);finish();
 });f.a.requestUser=async r=>r.method.includes('requestUserInput')?{answers:{scope:{answers:['当前工程']}}}:{decision:'decline'};await f.a.ask({question:'验证拒绝和补充信息'});
});
test('stopping Claude while permission is pending cannot turn a late approval into permission to execute',async t=>{
 const f=await fixture(t,async({finish})=>finish());let accept;const permission=new Promise(r=>accept=r),active={threadId:'thread',taskId:f.w.task.id,turnId:'turn',budget:{}};f.a.active=active;f.a.requestUser=()=>permission;const pending=f.a.tool('permission_prompt',{tool_name:'Bash',input:{command:'never-run'}},active);active.stopped=true;accept({decision:'accept'});const r=JSON.parse((await pending).content[0].text);assert.equal(r.behavior,'deny');assert.equal(r.interrupt,true);f.a.active=null;
});
