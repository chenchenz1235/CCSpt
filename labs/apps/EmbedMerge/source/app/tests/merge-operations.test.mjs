import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.mjs';
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'em-merge-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const roots={ref:path.join(dir,'ref'),test:path.join(dir,'test')};for(const d of Object.values(roots))await fs.mkdir(d);const w=new Workspace(path.join(dir,'data'));return {dir,roots,w};}
const op=async(w,args)=>w.operateFiles(await w.operationInfo(args));
const write=async(w,side,rel,text)=>{const b=await w.open(side,rel);await w.update({...b,text});return w.save(side,rel);};

test('unified creation detects folders and files, defaults to originals, copy checkbox preserves originals',async t=>{
  const {w,roots}=await setup(t);for(const d of Object.values(roots))await fs.writeFile(path.join(d,'motor.c'),'old');
  let s=await w.createComparison(roots);assert.equal(s.task.mode,'direct-project');assert.equal(w.root('test'),roots.test);
  await write(w,'test','motor.c','direct');assert.equal(await fs.readFile(path.join(roots.test,'motor.c'),'utf8'),'direct');
  await w.undoFileOperation();assert.equal(await fs.readFile(path.join(roots.test,'motor.c'),'utf8'),'old');
  s=await w.createComparison(roots,'copies',{createCopy:true});assert.equal(s.task.mode,'project-copy');
  await write(w,'test','motor.c','copy');assert.equal(await fs.readFile(path.join(roots.test,'motor.c'),'utf8'),'old');
  const files={ref:path.join(roots.ref,'motor.c'),test:path.join(roots.test,'renamed.h')};await fs.writeFile(files.test,'right');
  s=await w.createComparison(files);assert.equal(s.task.mode,'direct-files');assert.equal(s.entries.length,1);
  s=await w.createComparison(files,'copies',{createCopy:true});assert.equal(s.task.mode,'project-copy');assert.equal(s.entries.length,1);
  await write(w,'test','motor.c','copied file');assert.equal(await fs.readFile(files.test,'utf8'),'right');
  await assert.rejects(w.createComparison({ref:files.ref,test:roots.test}),/同为/);
  await assert.rejects(w.createComparison({ref:roots.ref,test:roots.ref}),/相同|包含/);
});

test('single-side deletion, creation and overwrites undo and redo byte-for-byte and survive restart',async t=>{
  const {w,roots}=await setup(t);await fs.writeFile(path.join(roots.test,'only.c'),'right only');await fs.writeFile(path.join(roots.ref,'replace.c'),'new');await fs.writeFile(path.join(roots.test,'replace.c'),'old');
  await w.createComparison(roots);
  await op(w,{action:'delete',rel:'only.c',side:'test'});await assert.rejects(fs.access(path.join(roots.test,'only.c')));
  await w.undoFileOperation();assert.equal(await fs.readFile(path.join(roots.test,'only.c'),'utf8'),'right only');
  await w.undoFileOperation(true);await assert.rejects(fs.access(path.join(roots.test,'only.c')));
  await op(w,{action:'copy',rel:'replace.c',source:'ref'});assert.equal(await fs.readFile(path.join(roots.test,'replace.c'),'utf8'),'new');
  const resumed=new Workspace(w.dataRoot);await resumed.resume(w.task.id);await resumed.undoFileOperation();assert.equal(await fs.readFile(path.join(roots.test,'replace.c'),'utf8'),'old');
  await resumed.undoFileOperation(true);assert.equal(await fs.readFile(path.join(roots.test,'replace.c'),'utf8'),'new');
  await op(resumed,{action:'copy',rel:'replace.c',source:'test'}); // identical creates no history
  await op(resumed,{action:'copy',rel:'replace.c',source:'ref'});assert.equal(resumed.task.operationHistory.length,2);
  await fs.mkdir(path.join(roots.ref,'nested'));await fs.writeFile(path.join(roots.ref,'nested','created.c'),'created');
  await op(resumed,{action:'copy',rel:'nested/created.c',source:'ref'});await resumed.undoFileOperation();await assert.rejects(fs.access(path.join(roots.test,'nested')));
});

test('folder copy merges, filters hidden files, deletion backs up all children including filtered ones and supports undo',async t=>{
  const {w,roots}=await setup(t);for(const d of Object.values(roots))await fs.mkdir(path.join(d,'src'));
  await fs.writeFile(path.join(roots.ref,'src','code.c'),'new');await fs.writeFile(path.join(roots.ref,'src','image.png'),'filtered');await fs.writeFile(path.join(roots.test,'src','extra.c'),'keep');
  await w.createComparison(roots);await op(w,{action:'copy',rel:'src',source:'ref'});
  assert.equal(await fs.readFile(path.join(roots.test,'src','extra.c'),'utf8'),'keep');await assert.rejects(fs.access(path.join(roots.test,'src','image.png')));
  await fs.writeFile(path.join(roots.test,'src','hidden.png'),Buffer.from([0,1,2,255]));
  await op(w,{action:'delete',rel:'src',side:'test'});await assert.rejects(fs.access(path.join(roots.test,'src')));
  await w.undoFileOperation();assert.deepEqual(await fs.readFile(path.join(roots.test,'src','hidden.png')),Buffer.from([0,1,2,255]));
  assert.equal(await fs.readFile(path.join(roots.test,'src','code.c'),'utf8'),'new');
  await w.undoFileOperation();await assert.rejects(fs.access(path.join(roots.test,'src','code.c')));assert.equal(await fs.readFile(path.join(roots.test,'src','extra.c'),'utf8'),'keep');
});

test('stale previews, dirty drafts, external changes and corrupted history block mutation',async t=>{
  const {w,roots}=await setup(t);await fs.writeFile(path.join(roots.ref,'a.c'),'source');await fs.writeFile(path.join(roots.test,'a.c'),'target');await w.createComparison(roots);
  let preview=await w.operationInfo({action:'delete',rel:'a.c',side:'test'});await fs.writeFile(path.join(roots.test,'a.c'),'external');await assert.rejects(w.operateFiles(preview),/发生变化/);
  const b=await w.open('test','a.c');await w.update({...b,text:'draft'});await assert.rejects(w.operationInfo({action:'delete',rel:'a.c',side:'test'}),/未保存/);await w.reload('test','a.c');
  await op(w,{action:'copy',rel:'a.c',source:'ref'});await fs.writeFile(path.join(roots.test,'a.c'),'external after copy');await assert.rejects(w.undoFileOperation(),/冲突/);assert.equal(await fs.readFile(path.join(roots.test,'a.c'),'utf8'),'external after copy');
  await fs.writeFile(path.join(roots.test,'a.c'),'source');const record=w.task.operationHistory.at(-1);await fs.writeFile(path.join(w.taskRoot,record.changes[0].before.snapshot),'corrupt');
  await assert.rejects(w.undoFileOperation(),/校验失败/);assert.equal(await fs.readFile(path.join(roots.test,'a.c'),'utf8'),'source');
});

test('undo refuses new contents inside created folder and direct filtering never recopies originals',async t=>{
  const {w,roots}=await setup(t);await fs.mkdir(path.join(roots.ref,'folder'));await fs.writeFile(path.join(roots.ref,'folder','a.c'),'a');await w.createComparison(roots);
  await op(w,{action:'copy',rel:'folder',source:'ref'});await fs.writeFile(path.join(roots.test,'folder','external.c'),'external');
  await assert.rejects(w.undoFileOperation(),/新增/);assert.equal(await fs.readFile(path.join(roots.test,'folder','a.c'),'utf8'),'a');
  await fs.writeFile(path.join(roots.test,'folder','a.c'),'changed original');await w.setFileFilters({documents:false});assert.equal(await fs.readFile(path.join(roots.test,'folder','a.c'),'utf8'),'changed original');
});

test('file operation history retains 50 steps, supports redo, and discards redo on a new operation',async t=>{
  const {w,roots}=await setup(t);await fs.writeFile(path.join(roots.test,'a.c'),'0');await w.createComparison(roots);
  for(let i=1;i<=51;i++)await write(w,'test','a.c',String(i));assert.equal(w.task.operationHistory.length,50);assert.equal(w.task.operationCursor,50);
  await w.undoFileOperation();assert.equal(await fs.readFile(path.join(roots.test,'a.c'),'utf8'),'50');await w.undoFileOperation(true);assert.equal(await fs.readFile(path.join(roots.test,'a.c'),'utf8'),'51');
  await w.undoFileOperation();await write(w,'test','a.c','branch');assert.equal(w.historyInfo().canRedo,false);
});

test('partial directory write failure rolls completed changes back and leaves originals intact',async t=>{
  const {w,roots}=await setup(t);for(const d of Object.values(roots)){await fs.mkdir(path.join(d,'src'));await fs.writeFile(path.join(d,'src','a.c'),d===roots.ref?'new-a':'old-a');await fs.writeFile(path.join(d,'src','b.c'),d===roots.ref?'new-b':'old-b');}
  await w.createComparison(roots);const preview=await w.operationInfo({action:'copy',rel:'src',source:'ref'}),originalWrite=fs.writeFile;
  fs.writeFile=async function(p,...args){if(String(p).startsWith(path.join(roots.test,'src','b.c')+'.embedmerge-'))throw Error('simulated disk failure');return originalWrite.call(this,p,...args);};
  try{await assert.rejects(w.operateFiles(preview),/simulated/);}finally{fs.writeFile=originalWrite;}
  assert.equal(await fs.readFile(path.join(roots.test,'src','a.c'),'utf8'),'old-a');assert.equal(await fs.readFile(path.join(roots.test,'src','b.c'),'utf8'),'old-b');assert.equal(w.task.pendingOperation,null);
});

test('persisted interrupted operation can be recovered after restarting without overwriting external updates',async t=>{
  const {w,roots}=await setup(t);await fs.writeFile(path.join(roots.ref,'a.c'),'new');await fs.writeFile(path.join(roots.test,'a.c'),'old');await w.createComparison(roots);
  await op(w,{action:'copy',rel:'a.c',source:'ref'});const record=w.task.operationHistory[0];await w.undoFileOperation();
  w.task.operationHistory=[];w.task.operationCursor=0;w.task.pendingOperation={record,direction:'forward'};await w.persist();
  await fs.writeFile(path.join(roots.test,'a.c'),'new');
  const resumed=new Workspace(w.dataRoot);await resumed.resume(w.task.id);assert.equal(resumed.historyInfo().pending,true);
  await resumed.undoFileOperation();assert.equal(await fs.readFile(path.join(roots.test,'a.c'),'utf8'),'old');assert.equal(resumed.task.pendingOperation,null);
  resumed.task.pendingOperation={record,direction:'forward'};await resumed.persist();await fs.writeFile(path.join(roots.test,'a.c'),'external');
  await assert.rejects(resumed.undoFileOperation(),/外部修改/);assert.equal(await fs.readFile(path.join(roots.test,'a.c'),'utf8'),'external');
});
