import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {FirmwareService} from '../core/firmware-service.mjs';
import {ExternalControl} from '../core/external-control.mjs';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'firmware-service-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const project=path.join(root,'test'),taskRoot=path.join(root,'task'),runtime=path.join(root,'runtime');
 await fs.mkdir(path.join(project,'DefaultBuild/only_app'),{recursive:true});
 await fs.writeFile(path.join(project,'app.mtpj'),'fixture');await fs.writeFile(path.join(project,'DefaultBuild/only_app/app.mot'),'fixture');
 for(const exe of ['Bootloader','DevMngRegister']){await fs.mkdir(path.join(runtime,exe),{recursive:true});await fs.writeFile(path.join(runtime,exe,exe+'.exe'),'fixture');}
 let child,calls=[];const launch=(binary,args,opts)=>{calls.push({binary,args,opts});child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();return child;};
 const w={task:{id:'test-task'},taskRoot,buffers:new Map(),root:()=>project};
 const service=new FirmwareService(w,{runtimeRoot:runtime,launch});
 return {service,w,root,project,calls,child:()=>child};
}
test('encryption uses authorized process, scoped only_app input, and isolated output',async t=>{
 const f=await fixture(t),job=await f.service.command({taskId:'test-task',operation:'encrypt',file:'DefaultBuild/only_app/app.mot'});
 assert.equal(job.status,'running');assert.match(f.calls[0].binary,/DevMngRegister.exe$/);assert.equal(f.calls[0].opts.shell,false);
 assert.match(f.calls[0].args.at(-1),/artifacts[\\/]firmware/);assert.equal(f.service.busy,true);
 f.child().stdout.write(JSON.stringify({event:'result',data:{file:'output.em'}})+'\n');f.child().emit('close',0);await f.service.done;
 assert.equal((await f.service.command({taskId:'test-task',operation:'job',jobId:job.id})).status,'completed');
 assert.equal(f.service.busy,false);assert.match(await fs.readFile(job.log,'utf8'),/job_finished/);
});
test('rejects full-image MOT, traversal, wrong task and unsaved changes before launch',async t=>{
 const f=await fixture(t);for(const args of [{file:'DefaultBuild/app.mot'},{file:'../escape.mot'},{file:path.join(f.root,'outside.mot')},{taskId:'wrong',file:'DefaultBuild/only_app/app.mot'}]){
  await assert.rejects(f.service.command({taskId:'test-task',operation:'inspect',...args}));
 }
 f.w.buffers.set('test:x',{dirty:true});await assert.rejects(f.service.command({taskId:'test-task',operation:'ports'}),/草稿/);assert.equal(f.calls.length,0);
});
test('serial flash plan binds hash and never gets execute implicitly',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.project,'app.em'),'fixture');
 const args={taskId:'test-task',operation:'flash',file:'app.em',port:'COM2',route:'direct-drive',expectedId:'TEST',expectedSha256:'a'.repeat(64)};
 const job=await f.service.command(args);assert.ok(!f.calls[0].args.includes('--execute'));assert.ok(f.calls[0].args.includes('9600'));
 await assert.rejects(f.service.command(args),/正在执行/);
 await f.service.command({taskId:'test-task',operation:'cancel',jobId:job.id});assert.equal(await fs.readFile(job.cancelFile,'utf8'),'cancel');
 f.child().emit('close',2);await f.service.done;assert.equal(f.service.jobs.get(job.id).status,'cancelled');
});
test('startup reservation rejects concurrent submissions and releases after validation failure',async t=>{
 const f=await fixture(t);const first=f.service.command({taskId:'test-task',operation:'encrypt',file:'DefaultBuild/only_app/app.mot'});
 await assert.rejects(f.service.command({taskId:'test-task',operation:'ports'}),/正在执行/);await first;assert.equal(f.calls.length,1);f.child().emit('close',0);await f.service.done;
 await assert.rejects(f.service.command({taskId:'test-task',operation:'motor',port:'COM2',action:'run',rpm:100,maxRpm:200,seconds:90}));assert.equal(f.service.busy,false);
});
test('stop during an active motor run requests cooperative stop on the same serial session',async t=>{
 const f=await fixture(t);const job=await f.service.command({taskId:'test-task',operation:'motor',port:'COM2',action:'run',rpm:100,maxRpm:200,seconds:1,execute:true});
 const stop=await f.service.command({taskId:'test-task',operation:'motor',action:'stop',execute:true});assert.equal(stop.id,job.id);assert.equal(f.calls.length,1);assert.equal(await fs.readFile(job.cancelFile,'utf8'),'cancel');
 f.child().emit('close',0);await f.service.done;
});
test('build-ready comparison retains binary build inputs without changing default comparisons',async()=>{
 const w={dataRoot:'unused',task:null,inventory:[],buffers:new Map()};let request;
 const c=new ExternalControl(w,{notify:(_,p)=>{request=p;queueMicrotask(()=>c.complete({requestId:p.requestId,result:{}}));}});
 await c.call('compare',{ref:'reference',test:'target',forBuild:true});assert.deepEqual(request.args.options.fileFilters,{artifacts:false});
 await c.call('compare',{ref:'reference',test:'target'});assert.equal(request.args.options.fileFilters,undefined);
 await assert.rejects(c.call('compare',{ref:'reference',test:'target',forBuild:'yes'}),/forBuild/);
});
