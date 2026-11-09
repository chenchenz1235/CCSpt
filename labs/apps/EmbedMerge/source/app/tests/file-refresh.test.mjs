import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Workspace} from '../core/workspace.mjs';
test('selected files refresh only their pair and preserve dirty buffers',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'embedmerge-refresh-'));
 try{
  const files={ref:path.join(root,'a.c'),test:path.join(root,'b.c')};
  await fs.writeFile(files.ref,'int a=1;\n');await fs.writeFile(files.test,'int a=2;\n');await fs.writeFile(path.join(root,'unrelated.c'),'unrelated');
  const w=new Workspace(path.join(root,'data'));await w.createFiles(files);const id=w.task.id;await w.pair('a.c');
  await fs.writeFile(files.test,'int a=3;\n');const versions=await w.fileVersions(id);const result=await w.refreshFiles({taskId:id,versions});
  assert.equal(result.pair.test.text,'int a=3;\n');assert.deepEqual(result.snapshot.entries.map(x=>x.rel),['a.c']);
  await w.update({side:'test',rel:'a.c',text:'draft',revision:result.pair.test.revision});await fs.writeFile(files.test,'external');
  assert.deepEqual(await w.refreshFiles({taskId:id,versions:await w.fileVersions(id)}),{blocked:true});assert.equal((await w.pair('a.c')).test.text,'draft');assert.equal(await fs.readFile(files.test,'utf8'),'external');
  await assert.rejects(w.fileVersions('wrong'),/已切换/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('saving one file can refresh its result and ancestors without reading unrelated files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'embedmerge-target-'));
 try{
  const roots={ref:path.join(root,'ref'),test:path.join(root,'test')};for(const dir of Object.values(roots)){await fs.mkdir(path.join(dir,'nested'),{recursive:true});await fs.writeFile(path.join(dir,'nested','a.c'),'int a=1;\n');await fs.writeFile(path.join(dir,'unrelated.c'),'int z=1;\n');}
  const w=new Workspace(path.join(root,'data'));await w.create(roots,'targeted',{createCopy:false,autoMatlab:false});
  await fs.writeFile(path.join(roots.test,'nested','a.c'),'int a=2;\n');await fs.writeFile(path.join(roots.test,'unrelated.c'),'int z=2;\n');
  const originalFile=w.file.bind(w),reads=[];w.file=async(side,rel)=>{reads.push(rel);return originalFile(side,rel);};
  const s=await w.scan({rel:'nested/a.c'});assert.equal(s.entries.find(n=>n.rel==='nested/a.c').status,'different');assert.equal(s.entries.find(n=>n.rel==='nested').status,'different');assert.equal(s.entries.find(n=>n.rel==='unrelated.c').status,'same');assert.ok(reads.every(r=>r==='nested/a.c'));
  await assert.rejects(w.scan({rel:'nested'}),/已比较的文件/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
