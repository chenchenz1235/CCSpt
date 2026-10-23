import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';
import {decode,encode,classify,hunks,mergeHunk,hash} from '../core/text.mjs';
import {Workspace,guarded} from '../core/workspace.mjs';

test('encoding, BOM and EOL round trip for Chinese / GB18030 / UTF16',()=>{
  for(const encoding of ['utf8','gb18030','utf16-le','utf16-be'])for(const bom of [false,true])for(const eol of ['\n','\r\n','\r']){
    if((encoding.startsWith('utf16')&&!bom)||(encoding==='gb18030'&&bom))continue;
    const bytes=iconv.encode('电机协议𠀀'+eol+'参数=3500;'+eol,encoding,{addBOM:bom});
    const d=decode(bytes);assert.deepEqual(encode(d.text,d),bytes);assert.equal(d.text,'电机协议𠀀\n参数=3500;\n');
  }
});
test('protected/invalid text fails; mixed EOL requires explicit normalization',()=>{
  assert.throws(()=>decode(Buffer.from('ESAFENET-protected')),/受保护/);assert.throws(()=>decode(Buffer.from([0,1,4,20])),/NUL/);
  const d=decode(Buffer.from('a\r\nb\nc'));assert.equal(d.mixed,true);assert.throws(()=>encode(d.text+'d',d),/混合换行/);
  assert.equal(encode(d.text+'d',{...d,mixed:false,eol:'CRLF'}).toString(),'a\r\nb\r\ncd');
});
test('C token classification preserves directives, strings, token and line boundaries',()=>{
  assert.equal(classify('int x=1; // 日期 2024','int x = 1; // 日期 2026','f.c'),'minor');
  for(const [a,b]of [['char*x="a b";','char*x="ab";'],['a + +b;','a++b;'],['a b;','ab;'],['#define A 1\n#define B 2','#define A 1 #define B 2'],['// NOLINT\na();','// MISRA\na();']])assert.equal(classify(a,b,'f.c'),'different');
});
test('bidirectional hunk merge insertion/deletion/start/end and empty files',()=>{
  for(const [a,b]of [['a\nb\nc\n','a\nx\nc\n'],['x\na','a'],['a','x\na'],['a\nx','a'],['','hello\n'],['x\n',''],['a\n','a']]){
    let right=b;for(let i=0;i<20&&hunks(a,right).length;i++)right=mergeHunk(a,right,hunks(a,right)[0],'right');assert.equal(right,a);
    let left=a;for(let i=0;i<20&&hunks(left,b).length;i++)left=mergeHunk(left,b,hunks(left,b)[0],'left');assert.equal(left,b);
  }
});
async function setup(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'embedmerge-test-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const roots={ref:path.join(dir,'original-ref'),test:path.join(dir,'original-test')};for(const p of Object.values(roots))await fs.mkdir(p);const w=new Workspace(path.join(dir,'data'));return {dir,roots,w};}
test('fixtures pairing, directory aggregates and model data independent of C',async t=>{
  const {w}=await setup(t);const root=path.resolve('../new-project-kit/fixtures');const s=await w.create({ref:path.join(root,'ref'),test:path.join(root,'test')});
  const rows=Object.fromEntries(s.entries.map(n=>[n.rel,n]));assert.equal(rows['src/protocol.c'].status,'different');assert.equal(rows['src/comment_only.c'].status,'minor');assert.equal(rows['src/ref_only.c'].status,'leftOnly');assert.equal(rows['src/test_only.c'].status,'rightOnly');assert.ok(rows.src.counts.different);
  await fs.writeFile(path.join(w.root('ref'),'motor.mat'),Buffer.from([0,1,2]));const next=await w.scan();assert.equal(next.entries.find(n=>n.rel==='motor.mat').status,'leftOnly');assert.equal(next.entries.find(n=>n.rel==='motor.mat').matlab,true);
});
test('save, originals immutable, backup and hash conflict prevention',async t=>{
  const {roots,w}=await setup(t);const original=iconv.encode('// 电机\r\nint power=3500;\r\n','gb18030');for(const p of Object.values(roots))await fs.writeFile(path.join(p,'motor.c'),original);
  await w.create(roots);const b=await w.open('test','motor.c');await w.update({side:'test',rel:'motor.c',text:b.text.replace('3500','2000'),revision:b.revision});await w.save('test','motor.c');
  assert.deepEqual(await fs.readFile(path.join(roots.test,'motor.c')),original);const bytes=await fs.readFile(path.join(w.root('test'),'motor.c'));assert.equal(iconv.decode(bytes,'gb18030'),'// 电机\r\nint power=2000;\r\n');assert.equal((await w.backups('test','motor.c')).length,1);
  let current=await w.open('test','motor.c');await w.update({side:'test',rel:'motor.c',text:current.text+'x',revision:current.revision});await fs.writeFile(path.join(w.root('test'),'motor.c'),'external edit');await assert.rejects(w.save('test','motor.c'),/冲突/);assert.equal((await fs.readFile(path.join(w.root('test'),'motor.c'))).toString(),'external edit');
});
test('dirty drafts survive resume, stale revisions rejected and reviews versioned',async t=>{
  const {roots,w}=await setup(t);for(const p of Object.values(roots))await fs.writeFile(path.join(p,'a.c'),'int a;\n');await w.create(roots);let b=await w.open('ref','a.c');await w.review({rel:'a.c',state:'keep',note:'保留参数'});await w.update({side:'ref',rel:'a.c',text:'int b;\n',revision:b.revision});await assert.rejects(w.update({side:'ref',rel:'a.c',text:'old',revision:b.revision}),/版本冲突/);
  const other=new Workspace(w.dataRoot);const s=await other.resume(w.task.id);b=await other.open('ref','a.c');assert.equal(b.text,'int b;\n');assert.equal(b.dirty,true);assert.equal(s.entries.find(n=>n.rel==='a.c').reviewStale,true);assert.equal(await fs.readFile(path.join(other.root('ref'),'a.c'),'utf8'),'int a;\n');
});
test('path traversal and directory links refused',async t=>{
  const {dir,roots,w}=await setup(t);await w.create(roots);for(const p of ['../evil','C:/Windows/x','a/../../evil','a:stream','a//x'])await assert.rejects(guarded(w.root('test'),p));
  await fs.symlink(roots.ref,path.join(w.root('test'),'link'),'junction');await assert.rejects(guarded(w.root('test'),'link/evil'),/链接/);assert.ok(dir);
});
test('AI reads current draft, precise writes require explicit grant and current hash',async t=>{
  const {roots,w}=await setup(t);for(const p of Object.values(roots))await fs.writeFile(path.join(p,'a.c'),'int a;\n');await w.create(roots);const budget={calls:0,chars:0,maxCalls:10,maxChars:10000,write:false};const b=await w.open('ref','a.c');await w.update({side:'ref',rel:'a.c',text:'int unsaved;\n',revision:b.revision});const r=await w.evidence({action:'read',side:'ref',rel:'a.c'},budget);assert.equal(r.lines[0].text,'int unsaved;');
  const args={action:'replace',side:'test',rel:'a.c',before:'a;',after:'b;',version:hash('int a;\n')};await assert.rejects(w.evidence(args,budget),/只读/);budget.write=true;await assert.rejects(w.evidence({...args,version:'stale'},budget),/过期/);const changed=await w.evidence(args,budget);assert.equal(changed.status,'已修改工作缓冲区，尚未保存');assert.equal(await fs.readFile(path.join(w.root('test'),'a.c'),'utf8'),'int a;\n');
  await w.evidence({...args,before:'b;',after:'c;',version:hash('int b;\n')},budget);assert.equal((await w.open('test','a.c')).text,'int c;\n');
  const manual=await w.open('test','a.c');await w.update({side:'test',rel:'a.c',text:'int manual;\n',revision:manual.revision});await assert.rejects(w.evidence({...args,before:'manual;',after:'d;',version:hash('int manual;\n')},budget),/用户/);
  budget.cancelled=true;await assert.rejects(w.evidence({action:'read',side:'test',rel:'a.c'},budget),/停止/);
});
test('model review uses file versions and survives resume without decoding binary data',async t=>{const {w,roots}=await setup(t);for(const p of Object.values(roots))await fs.writeFile(path.join(p,'motor.mat'),Buffer.from([0,1,2,3]));await w.create(roots);await w.review({rel:'motor.mat',state:'keep',note:'独立检查 Bus'});let s=await w.scan();assert.equal(s.entries[0].review,'keep');assert.equal(s.entries[0].reviewStale,false);await fs.writeFile(path.join(w.root('test'),'motor.mat'),Buffer.from([0,4]));s=await w.scan();assert.equal(s.entries[0].reviewStale,true);const restored=new Workspace(w.dataRoot);assert.equal((await restored.resume(w.task.id)).task.records['motor.mat'].note,'独立检查 Bus');});
test('failed resume retains current task and dirty drafts',async t=>{const {w,roots}=await setup(t);for(const p of Object.values(roots))await fs.writeFile(path.join(p,'a.c'),'int a;');await w.create(roots);const b=await w.open('test','a.c');await w.update({...b,text:'int unsaved;'});const id=w.task.id;await assert.rejects(w.resume('00000000-0000-0000-0000-000000000000'));assert.equal(w.task.id,id);assert.equal((await w.open('test','a.c')).text,'int unsaved;');});
test('AI cancellation between file read and buffer commit prevents edits',async t=>{const {w,roots}=await setup(t);for(const p of Object.values(roots))await fs.writeFile(path.join(p,'a.c'),'int a;');await w.create(roots);const budget={calls:0,chars:0,maxCalls:10,maxChars:10000,write:true},originalUpdate=w.update.bind(w);w.update=async(...args)=>{budget.cancelled=true;return originalUpdate(...args);};await assert.rejects(w.evidence({action:'replace',side:'test',rel:'a.c',before:'a;',after:'b;',version:hash('int a;')},budget),/已停止/);assert.equal((await w.open('test','a.c')).text,'int a;');});
test('AI search reports skipped stale evidence rather than returning old matches',async t=>{const {w,roots}=await setup(t);for(const p of Object.values(roots))await fs.writeFile(path.join(p,'a.c'),'old_macro');await w.create(roots);await w.open('test','a.c');await fs.writeFile(path.join(w.root('test'),'a.c'),'new_macro');const r=await w.evidence({action:'search',side:'test',query:'old_macro'},{calls:0,chars:0,maxCalls:10,maxChars:10000,write:false});assert.equal(r.matches.length,0);assert.equal(r.partial,true);assert.match(r.skipped[0].error,/外部变化/);});
