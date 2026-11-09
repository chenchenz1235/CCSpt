import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.mjs';

for(const createCopy of [false,true])test(`review project createCopy=${createCopy}: save, conflict, resume`,async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-mode-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const project=path.join(dir,'project'),data=path.join(dir,'data');await fs.mkdir(project);
 const file=path.join(project,'motor.c'),original='int speed_min=300;\n';await fs.writeFile(file,original);
 const w=new Workspace(data);const s=await w.createReviewProject(project,{createCopy});
 assert.equal(s.task.reviewProject,true);assert.equal(s.task.mode,createCopy?'project-copy':'direct-project');
 assert.equal(w.root('test')===project,!createCopy);
 if(!createCopy)await assert.rejects(fs.access(path.join(w.taskRoot,'work')),/ENOENT/);
 let b=await w.open('test','motor.c');await w.update({side:'test',rel:'motor.c',text:b.text.replace('300','400'),revision:b.revision});await w.save('test','motor.c');
 assert.equal(await fs.readFile(file,'utf8'),createCopy?original:'int speed_min=400;\n');
 assert.equal(w.historyInfo().canUndo,true);
 const restored=new Workspace(data);await restored.resume(w.task.id);assert.equal(restored.root('test'),w.root('test'));assert.equal(restored.task.reviewProject,true);
 b=await restored.open('test','motor.c');await restored.update({side:'test',rel:'motor.c',text:b.text.replace('400','500'),revision:b.revision});await fs.writeFile(path.join(restored.root('test'),'motor.c'),'external change\n');await assert.rejects(restored.save('test','motor.c'),/冲突/);
 await assert.rejects(restored.update({side:'ref',rel:'motor.c',text:'bad',revision:0}),/只读/);
});
test('normal comparison still rejects identical roots',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'review-overlap-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const project=path.join(dir,'project');await fs.mkdir(project);const w=new Workspace(path.join(dir,'data'));
 await assert.rejects(w.create({ref:project,test:project},'compare',{createCopy:false}),/不能相同/);
 const s=await w.createReviewProject(project);assert.equal(s.task.mode,'direct-project');
});
