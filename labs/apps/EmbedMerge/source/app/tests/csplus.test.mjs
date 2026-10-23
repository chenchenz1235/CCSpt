import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseScfg,parseMtpj,compareCsplus,discoverCsplusPairs} from '../core/csplus.mjs';
import {Workspace} from '../core/workspace.mjs';
const fixtures=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../test-fixtures/csplus');
const scfg=(unit='ms',value='2',divider='Devide8',extra='')=>`<smc><general><platform id="RX"/></general><tool id="SWComponent"><configuration name="Timer" inuse="true"><allocatable id="CMT0"><option id="ClockDivision" enabled="true" selection="${divider}"><item id="${divider}" input="" vlaue="0"/></option><option id="IntervalValue" enabled="true" selection="IntervalValue"><item id="IntervalValue" input="${value}" vlaue="7999"/></option><option id="IntervalUnit" enabled="true" selection="${unit}"><item id="${unit}" input="" vlaue="0"/></option>${extra}</allocatable><component display="Compare Match Timer" id="cmt"/><allocator display="CMT0"/></configuration></tool></smc>`;
test('SCFG values use selected choices, combine units, and retain raw evidence',()=>{
  const result=compareCsplus(parseScfg(scfg(),'left.scfg'),parseScfg(scfg('us','2000'),'right.scfg'));
  const m=result.modules[0];assert.equal(m.status,'equivalent');
  assert.equal(m.rows.find(r=>r.label==='计数时钟分频').ref.text,'/8');
  const interval=m.rows.find(r=>r.label==='中断间隔');assert.equal(interval.state,'equivalent');assert.equal(interval.ref.text,'2 ms');assert.equal(interval.test.text,'2000 μs');assert.equal(interval.ref.evidence[0].raw.stored,'7999');
  const changed=compareCsplus(parseScfg(scfg(),'a.scfg'),parseScfg(scfg('us','2001'),'b.scfg'));assert.equal(changed.modules[0].status,'changed');
});
test('unselected choices and disabled saved values cannot create active changes',()=>{
  const a=scfg('ms','2','Devide8','<option id="Unused" enabled="false" selection="A"><item id="A" input="1"/></option>');
  const b=scfg('ms','2','Devide8','<option id="Unused" enabled="false" selection="B"><item id="B" input="9"/></option>');
  assert.equal(compareCsplus(parseScfg(a,'a.scfg'),parseScfg(b,'b.scfg')).modules[0].status,'same');
  assert.equal(compareCsplus(parseScfg(a,'a.scfg'),parseScfg(a.replace('vlaue="7999"','vlaue="7999"/><item id="unselected" input="999"'),'b.scfg')).modules[0].status,'same');
});
test('malformed XML, entities and ambiguous field keys fail visibly',()=>{
  assert.throws(()=>parseScfg('<smc><broken></smc>','a.scfg'));
  assert.throws(()=>parseScfg('<!DOCTYPE smc [<!ENTITY x "x">]><smc/>','a.scfg'),/DTD/);
  assert.throws(()=>parseScfg(scfg('ms','2','Devide8','<option id="ClockDivision" selection="x"/>'),'a.scfg'),/重复/);
});
test('directory discovery pairs different CS+ names, preserves ambiguity and supports overrides',()=>{
  let p=discoverCsplusPairs({ref:['old/a.mtpj','old/a.scfg','code.c'],test:['new/b.mtpj','new/b.scfg','renamed.c']});assert.equal(p.pairs.length,2);assert.equal(p.unpaired.ref.length,0);assert.ok(p.pairs.every(p=>p.reason==='两侧唯一类型'));
  p=discoverCsplusPairs({ref:['a.scfg','b.scfg'],test:['c.scfg','d.scfg']});assert.equal(p.pairs.length,0);assert.equal(p.unpaired.ref.length,2);
  p=discoverCsplusPairs({ref:['a.scfg','b.scfg'],test:['c.scfg','d.scfg']},[{ref:'a.scfg',test:'d.scfg'}]);assert.equal(p.pairs.find(p=>p.ref==='a.scfg').test,'d.scfg');assert.equal(p.pairs.length,2);
  p=discoverCsplusPairs({ref:['same/a.scfg','other/b.scfg'],test:['same/a.scfg','else/c.scfg']});assert.equal(p.pairs[0].reason,'相同相对路径');
});
test('real fixtures preserve nested ports, ADC modes, PWM relationships, and build scopes',{skip:!existsSync(fixtures)&&'Private project fixtures are not included in the public source distribution'},async()=>{
  const load=async(side,ext)=>{const n=(await fs.readdir(path.join(fixtures,side))).find(n=>n.endsWith('.'+ext));return {n,text:await fs.readFile(path.join(fixtures,side,n),'utf8')};};
  const [a,b]=await Promise.all(['ref','test'].map(s=>load(s,'scfg')));
  const x=compareCsplus(parseScfg(a.text,a.n),parseScfg(b.text,b.n));
  const cmt=x.modules.find(m=>m.title==='CMT0');assert.equal(cmt.status,'equivalent');
  const pwm=x.modules.find(m=>m.related);assert.equal(pwm.modeChanged,true);
  assert.deepEqual([pwm.rows.find(r=>r.label==='计数时钟分频').ref.text,pwm.rows.find(r=>r.label==='计数时钟分频').test.text],['/256','/1']);
  const adc=x.modules.find(m=>m.title==='S12AD0');assert.equal(adc.modeChanged,true);assert.ok(adc.rows.find(r=>r.label==='AN001 通道').test);
  const [c,d]=await Promise.all(['ref','test'].map(s=>load(s,'mtpj')));
  const build=compareCsplus(parseMtpj(c.text,c.n),parseMtpj(d.text,d.n));
  const link=build.modules.find(m=>m.title==='链接');assert.equal(link.rows.find(r=>r.key==='LinkOptionOptimize').test.text,'速度优先');assert.ok(link.rows.find(r=>r.key==='LinkOptionStart').test.text.includes('FFFFE800'));
  assert.ok(build.modules.some(m=>m.category==='文件级构建设置'));assert.ok(build.defaults.length);
});
test('workspace auto comparison, manual pairing, reload, filter, drafts and external conflicts',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'em-csplus-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const roots={ref:path.join(root,'ref'),test:path.join(root,'test')};for(const s of Object.values(roots))await fs.mkdir(s);
  await fs.writeFile(path.join(roots.ref,'old.scfg'),scfg());await fs.writeFile(path.join(roots.test,'new.scfg'),scfg('us','2000'));
  const w=new Workspace(path.join(root,'data'));let s=await w.create(roots,'CS+ test',{autoMatlab:false});
  assert.equal(s.csplus.pairs.length,1);assert.equal(s.csplus.pairs[0].status,'equivalent');
  const before=await fs.readFile(path.join(roots.test,'new.scfg'),'utf8');
  s=await w.setCsplusPair({ref:'old.scfg',test:'new.scfg'});assert.equal(s.csplus.pairs[0].manual,true);
  const restored=new Workspace(w.dataRoot);assert.equal((await restored.resume(w.task.id)).csplus.pairs[0].manual,true);
  const b=await w.open('test','new.scfg');await w.update({side:'test',rel:'new.scfg',text:b.text.replace('input="2000"','input="2500"'),revision:b.revision});
  assert.equal((await w.csplusCompare({ref:'old.scfg',test:'new.scfg'})).drafts[1],true);
  assert.equal((await w.scan()).csplus.pairs[0].status,'changed');
  await fs.writeFile(path.join(w.root('test'),'new.scfg'),scfg('us','3000'));
  assert.equal((await w.scan()).csplus.pairs[0].status,'error');
  assert.equal(await fs.readFile(path.join(roots.test,'new.scfg'),'utf8'),before);
  await assert.rejects(w.setCsplusPair({ref:'../escape.scfg',test:'new.scfg'}));
  await assert.rejects(w.setCsplusPair({ref:'old.scfg',test:'new.mtpj'}),/相同类型/);
});
