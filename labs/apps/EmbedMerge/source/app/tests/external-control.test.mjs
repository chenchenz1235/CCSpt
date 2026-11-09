import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.mjs';
import {ExternalControl} from '../core/external-control.mjs';
import {CodexBackend} from '../core/codex.mjs';
async function fixture(t){
 const base=await fs.mkdtemp(path.join(os.tmpdir(),'em-window-link-')),roots={ref:path.join(base,'ref'),test:path.join(base,'test')};
 for(const [side,dir] of Object.entries(roots)){await fs.mkdir(path.join(dir,'src'),{recursive:true});await fs.writeFile(path.join(dir,'src/a.c'),`int a=${side==='ref'?2:1};\nsame();\nint b=${side==='ref'?4:3};\n`);}
 const w=new Workspace(path.join(base,'data'));let notify,ready=true,occupied=false;
 const c=new ExternalControl(w,{notify:(type,p)=>notify(type,p),ready:()=>ready,occupied:()=>occupied,timeout:2000});await c.start();t.after(()=>c.close());
 w.notify=(type,p)=>{if(type==='progress')c.noteProgress(p);};
 notify=async(type,p)=>{if(type!=='external-control')return;try{if(p.action==='compare'||p.action==='resume'){const method=p.action==='compare'?'createComparison':'resume';assert.ok(c.permits(method,p.requestId));assert.ok(!c.permits('save',p.requestId));const s=p.action==='compare'?await w.createComparison(p.args.paths,p.args.name,p.args.options):await w.resume(p.args.id);c.complete({requestId:p.requestId,result:{taskId:s.task.id,view:'folder',csplus:s.csplus,counts:{}}});}else c.complete({requestId:p.requestId,result:{taskId:w.task.id,view:p.action==='folder'?'folder':'text',path:p.args.path}});}catch(e){c.complete({requestId:p.requestId,error:e.message});}};
 return {w,c,roots,ready:v=>ready=v,occupied:v=>occupied=v,notify:f=>notify=f};
}
test('comparison is fulfilled by window callback and uses complete native task with independent copies',async t=>{
 const f=await fixture(t),s=await f.c.call('compare',{...f.roots});assert.equal(s.task.id,f.w.task.id);assert.equal(s.view.view,'folder');assert.equal(s.busy,false);assert.equal(f.w.task.mode,'project-copy');assert.equal(f.w.task.autoMatlab,false);
 assert.ok(f.w.inventory.some(n=>n.kind==='dir'&&n.rel==='src'));
 const d=await f.c.call('diff',{taskId:s.task.id,path:'src/a.c',limit:1});assert.equal(d.total,2);assert.equal(d.nextOffset,1);
 const opened=await f.c.call('open',{taskId:s.task.id,path:'src/a.c',hunkId:d.hunks[0].id});assert.equal(opened.opened,true);assert.equal(opened.path,'src/a.c');
 const rows=await f.c.call('differences',{taskId:s.task.id});assert.equal(rows.total,1);
 assert.equal((await f.c.call('folder',{taskId:s.task.id})).view,'folder');
 await assert.rejects(f.c.call('open',{taskId:s.task.id,path:'src/a.c',hunkId:'stale'}),/变化/);
 await assert.rejects(f.c.call('diff',{taskId:'stale',path:'src/a.c'}),/任务已切换/);
});

const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
async function finished(c,id){for(let i=0;i<200;i++){const j=await c.call('job',{jobId:id});if(!['queued','running'].includes(j.status))return j;await tick();}throw Error('Job did not finish');}
test('async requests are acknowledged before window work; request keys deduplicate and progress is observable',async t=>{
 const f=await fixture(t),args={...f.roots};
 const j=await f.c.call('start',{operation:'compare',args,requestKey:'compare-one'});assert.equal(j.status,'queued');assert.ok(j.id);
 const same=await f.c.call('start',{requestKey:'compare-one',args:{test:args.test,ref:args.ref},operation:'compare'});assert.equal(same.id,j.id);
 await assert.rejects(f.c.call('start',{operation:'compare',args:{...args,name:'different'},requestKey:'compare-one'}),/不同请求/);
 await assert.rejects(f.c.call('compare',args),/其他任务/);
 const done=await finished(f.c,j.id);assert.equal(done.status,'completed');assert.equal(done.result.task.id,f.w.task.id);assert.ok(done.progress.stage);assert.equal((await f.w.tasks()).length,1);
 assert.equal((await f.c.call('status')).operation,null);
});
test('queued cancellation prevents execution; running cancellation preserves the previous task and reports completion races honestly',async t=>{
 const f=await fixture(t);await f.c.call('compare',f.roots);const task=f.w.task;
 const queued=await f.c.call('start',{operation:'compare',args:f.roots});const stopped=await f.c.call('cancel',{jobId:queued.id});assert.equal(stopped.status,'cancelled');await tick();assert.equal(f.w.task,task);
 let request;f.notify((type,p)=>{if(type==='external-control')request=p;});
 const running=await f.c.call('start',{operation:'compare',args:f.roots});while(!request)await tick();
 f.w.progress('复制项目','src/a.c',2,10);const progress=await f.c.call('job',{jobId:running.id});assert.equal(progress.progress.current,2);
 await f.c.call('cancel',{jobId:running.id});assert.throws(()=>f.w.progress('复制项目','src/a.c',3,10),/停止/);
 f.c.complete({requestId:request.requestId,error:'操作已停止'});assert.equal((await finished(f.c,running.id)).status,'cancelled');assert.equal(f.w.task,task);
 f.w.cancelled=false;request=null;const race=await f.c.call('start',{operation:'folder',args:{taskId:task.id}});while(!request)await tick();
 await f.c.call('cancel',{jobId:race.id});f.c.complete({requestId:request.requestId,result:{taskId:task.id,view:'folder'}});
 const done=await finished(f.c,race.id);assert.equal(done.status,'completed');assert.equal(done.cancellation,'completed_before_stop');
});
test('task brief is versioned, bounded and persisted with drafts; context can read drafts and resume restores the same task',async t=>{
 const f=await fixture(t);await f.c.call('compare',f.roots);const id=f.w.task.id;
 const initial=await f.c.call('brief',{taskId:id});assert.equal(initial.brief.revision,0);
 const b=await f.w.open('test','src/a.c');await f.w.update({side:'test',rel:b.rel,text:b.text+'// draft',revision:b.revision});
 const saved=await f.c.call('brief',{taskId:id,expectedRevision:0,patch:{objective:'检查 PWM 差异',constraints:['先比较'],decisions:['保留产品参数']}});assert.equal(saved.brief.revision,1);
 assert.equal((await f.c.call('context')).taskId,id);assert.ok(f.w.buffers.get('test:src/a.c').dirty);
 await assert.rejects(f.c.call('brief',{taskId:id,expectedRevision:0,patch:{objective:'stale'}}),/已更新/);
 await assert.rejects(f.c.call('brief',{taskId:id,expectedRevision:1,patch:{grant:'write'}}),/字段无效/);
 await assert.rejects(f.c.call('brief',{taskId:id,expectedRevision:1,patch:{decisions:['x'.repeat(501)]}}),/短文本/);
 const restored=new Workspace(f.w.dataRoot);const snap=await restored.resume(id);assert.equal(snap.task.externalBrief.objective,'检查 PWM 差异');assert.ok(restored.buffers.get('test:src/a.c').dirty);
 await f.w.reload('test','src/a.c');const resumed=await f.c.call('resume',{taskId:id});assert.equal(resumed.task.id,id);assert.equal(resumed.task.brief.revision,1);
});
test('readiness, concurrent jobs, drafts and cancelled window commands are reported without discarding state',async t=>{
 const f=await fixture(t);f.ready(false);await assert.rejects(f.c.call('compare',f.roots),/尚未就绪/);f.ready(true);
 f.occupied(true);await assert.rejects(f.c.call('compare',f.roots),/其他任务/);f.occupied(false);
 await f.c.call('compare',f.roots);const task=f.w.task;
 const b=await f.w.open('test','src/a.c');await f.w.update({side:'test',rel:b.rel,text:b.text+'// draft',revision:b.revision});
 await assert.rejects(f.c.call('compare',f.roots),/未保存草稿/);assert.equal(f.w.task,task);assert.ok(f.w.buffers.get('test:src/a.c').dirty);
 await f.w.reload('test','src/a.c');f.notify((_,p)=>f.c.complete({requestId:p.requestId,error:'窗口拒绝切换'}));
 await assert.rejects(f.c.call('compare',f.roots),/窗口拒绝/);assert.equal(f.w.task,task);
 f.c.timeout=30;f.notify(()=>{});await assert.rejects(f.c.call('compare',f.roots),/未完成响应/);assert.equal(f.c.active,false);assert.equal(f.c.complete({requestId:'stale'}),false);
});
test('local service rejects unauthenticated/browser requests and exposes only explicit operations',async t=>{
 const f=await fixture(t),post=(headers={},body={action:'status'})=>fetch(f.c.url+'/call',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
 assert.equal((await post()).status,403);assert.equal((await post({Authorization:'Bearer '+f.c.token,Origin:'https://example.com'})).status,403);
 const r=await post({Authorization:'Bearer '+f.c.token});assert.equal(r.status,200);assert.equal((await r.json()).application,'EmbedMerge');
 assert.equal((await post({Authorization:'Bearer '+f.c.token},{action:'save'})).status,400);
});

test('embedded Codex receives current task brief on each turn without changing write grants',async t=>{
 const f=await fixture(t);await f.c.call('compare',f.roots);const taskId=f.w.task.id;
 await f.c.call('brief',{taskId,expectedRevision:0,patch:{objective:'核对配置',constraints:['保留产品参数'],decisions:['历史决定不能代替本轮授权']}});
 const c=new CodexBackend(f.w);c.connect=async()=>{};c.thread=async task=>{c.threads.set(task.id,'brief-stub-thread');return 'brief-stub-thread';};const prompts=[];
 c.rpc=async(method,params)=>{assert.equal(method,'turn/start');prompts.push(JSON.parse(params.input[0].text));queueMicrotask(()=>c.active.resolve({status:'completed',text:'mock only'}));return {turn:{id:'brief-stub-turn'}};};
 const first=await c.ask({question:'这里有什么变化？'});assert.equal(prompts[0].context.taskBrief.objective,'核对配置');assert.match(prompts[0].context.grant,/只读/);assert.equal(first.budget.write,false);
 await f.c.call('brief',{taskId,expectedRevision:1,patch:{objective:'继续核对定时器'}});
 const second=await c.ask({question:'继续'});assert.equal(prompts[1].context.taskBrief.objective,'继续核对定时器');assert.equal(second.metrics.reused,true);assert.equal(second.budget.write,false);
});

test('AI project review uses native single-page entry and preserves original root',async t=>{
 const f=await fixture(t);f.notify(async(type,p)=>{if(type!=='external-control')return;try{
  assert.equal(p.action,'review-project');assert.equal(f.c.permits('createReviewProject',p.requestId),true);assert.equal(f.c.permits('save',p.requestId),false);
  const s=await f.w.create({ref:p.args.root,test:p.args.root},'参数审核',{createCopy:true,autoMatlab:false});f.w.task.reviewProject=true;await f.w.persist();
  f.c.complete({requestId:p.requestId,result:{taskId:s.task.id,view:'text',path:p.args.target,singlePage:true,originalRoot:p.args.root}});
 }catch(e){f.c.complete({requestId:p.requestId,error:e.message});}});
 const result=await f.c.call('review-project',{root:f.roots.test,target:'src/a.c'});assert.equal(result.view.singlePage,true);assert.equal(f.w.task.reviewProject,true);assert.equal(result.view.originalRoot,f.roots.test);
 const left=await f.w.open('ref','src/a.c');await assert.rejects(f.w.update({...left,text:left.text+'// edit',revision:left.revision}),/快照只读/);
});
