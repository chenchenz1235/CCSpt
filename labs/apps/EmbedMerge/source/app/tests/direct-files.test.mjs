import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';
import {Workspace} from '../core/workspace.mjs';

async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'em-direct-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const files={ref:path.join(dir,'left.c'),test:path.join(dir,'right.h')};
  const original=iconv.encode('// 电机\r\nint power=3500;\r\n','gb18030');
  await fs.writeFile(files.ref,'// 参考\nint power=2000;\n');await fs.writeFile(files.test,original);
  const w=new Workspace(path.join(dir,'data'));await w.createFiles(files);
  return {dir,files,original,w,rel:w.task.fileRel};
}
async function change(w,rel,side,text){const b=await w.open(side,rel);return w.update({side,rel,text,revision:b.revision});}

test('direct files with different names stay scoped, save original bytes with verified backup and preserve encoding',async t=>{
  const {w,files,original,dir,rel}=await fixture(t);
  await fs.writeFile(path.join(dir,'unrelated.c'),'unrelated');
  const s=await w.scan();assert.equal(s.task.mode,'direct-files');assert.equal(s.entries.length,1);
  assert.equal(s.entries[0].names.test,'right.h');assert.equal(s.task.files.test,files.test);
  await assert.rejects(fs.access(path.join(w.taskRoot,'work')));
  const before=await fs.readFile(files.ref);
  const b=await w.open('test',rel);await change(w,rel,'test',b.text.replace('3500','2000'));
  assert.deepEqual(await fs.readFile(files.test),original); // drafts never write originals
  await w.save('test',rel);
  assert.deepEqual(await fs.readFile(files.test),iconv.encode('// 电机\r\nint power=2000;\r\n','gb18030'));
  assert.deepEqual(await fs.readFile(files.ref),before);
  const backups=await w.backups('test',rel);assert.equal(backups.length,1);
  assert.deepEqual(await fs.readFile(path.join(s.task.backupRoot,'test',rel,backups[0])),original);
  await w.save('test',rel);assert.equal((await w.backups('test',rel)).length,1);
  await assert.rejects(w.file('test','unrelated.c'),/所选|选择/);
  await assert.rejects(w.file('test','../left.c'),/所选|选择/);
  assert.equal((await w.fileCopyInfo(rel,'ref')).target,'test');
  await assert.rejects(w.setFileFilters({}),/过滤/);
});

test('backup restore remains a draft, next save backs up current original; both sides can save',async t=>{
  const {w,files,original,rel}=await fixture(t);
  await change(w,rel,'test','int modified;\n');await w.save('test',rel);
  const current=await fs.readFile(files.test),name=(await w.backups('test',rel))[0];
  await w.restore('test',rel,name);assert.deepEqual(await fs.readFile(files.test),current);
  await w.save('test',rel);assert.deepEqual(await fs.readFile(files.test),original);
  assert.equal((await w.backups('test',rel)).length,2);
  await change(w,rel,'ref','int left_updated;\n');await w.save('ref',rel);
  assert.equal(await fs.readFile(files.ref,'utf8'),'int left_updated;\n');assert.equal((await w.backups('ref',rel)).length,1);
});

test('external edits, deletion and backup creation failure prevent original overwrite',async t=>{
  const {w,files,rel}=await fixture(t);
  await change(w,rel,'test','int unsaved;\n');await fs.writeFile(files.test,'external edit');
  await assert.rejects(w.save('test',rel),/冲突/);assert.equal(await fs.readFile(files.test,'utf8'),'external edit');
  await w.reload('test',rel);await change(w,rel,'test','int retry;\n');
  await fs.writeFile(path.join(w.taskRoot,'backups'),'block backup directory');
  await assert.rejects(w.save('test',rel));assert.equal(await fs.readFile(files.test,'utf8'),'external edit');
  assert.equal((await w.open('test',rel)).dirty,true);
  await fs.unlink(files.test);await assert.rejects(w.save('test',rel));await assert.rejects(fs.access(files.test));
});

test('direct file task and unsaved drafts survive resume, external change after restart is rejected',async t=>{
  const {w,files,original,rel}=await fixture(t);
  await change(w,rel,'test','int draft;\n');
  const resumed=new Workspace(w.dataRoot),s=await resumed.resume(w.task.id);
  assert.equal(s.task.mode,'direct-files');assert.equal((await resumed.open('test',rel)).text,'int draft;\n');
  assert.deepEqual(await fs.readFile(files.test),original);
  await fs.writeFile(files.test,'changed while closed');await assert.rejects(resumed.save('test',rel),/冲突/);
});

test('same file, directory junctions and invalid binary input are refused without replacing current task',async t=>{
  const {w,files,dir,rel}=await fixture(t);const id=w.task.id;
  await assert.rejects(w.createFiles({ref:files.ref,test:files.ref}),/同一个/);
  const link=path.join(dir,'linked');await fs.symlink(dir,link,'junction');
  await assert.rejects(w.createFiles({ref:files.ref,test:path.join(link,'right.h')}),/联接/);
  const binary=path.join(dir,'binary.c');await fs.writeFile(binary,Buffer.from([0,1,2]));
  await assert.rejects(w.createFiles({ref:files.ref,test:binary}));assert.equal(w.task.id,id);
  await assert.rejects(w.createFiles({ref:files.ref,test:path.join(dir,'missing.c')}));
  await assert.rejects(w.file('other',rel));
});

test('two paths to the same hard link are refused when supported by the filesystem',async t=>{
  const {w,files,dir}=await fixture(t),hard=path.join(dir,'hard.c');
  try{await fs.link(files.ref,hard);}catch(e){if(['EISDIR','EPERM','ENOTSUP'].includes(e.code)){t.skip('Filesystem filter does not support hard links: '+e.code);return;}throw e;}
  await assert.rejects(w.createFiles({ref:files.ref,test:hard}),/硬链接/);
});

test('junction replacing a selected parent after opening is refused before save',async t=>{
  const {w,files,dir,rel}=await fixture(t);
  const selectedDir=path.join(dir,'selected'),outside=path.join(dir,'outside'),moved=path.join(dir,'moved');
  await fs.mkdir(selectedDir);await fs.mkdir(outside);
  const selected=path.join(selectedDir,'target.c');await fs.writeFile(selected,'int original;\n');await fs.writeFile(path.join(outside,'target.c'),'int outside;\n');
  await w.createFiles({ref:files.ref,test:selected});await change(w,rel,'test','int draft;\n');
  await fs.rename(selectedDir,moved);await fs.symlink(outside,selectedDir,'junction');
  await assert.rejects(w.save('test',rel),/联接/);assert.equal(await fs.readFile(path.join(outside,'target.c'),'utf8'),'int outside;\n');
});
