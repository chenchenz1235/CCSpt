import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {guarded} from './workspace.mjs';
import {hash} from './text.mjs';

// Legacy reports are evidence, not a new audit. Never synthesize parameter values.
export async function importReview(w,{file,target,excludeSchematic=false}) {
 if(!w.task)throw Error('请先打开工程');
 if(!w.inventory.some(n=>n.rel===target&&n.test&&/\.c$/i.test(n.rel)))throw Error('请选择当前工程内的参数 C 文件');
 const selected=path.resolve(file);await guarded(path.dirname(selected),path.basename(selected));
 const bytes=await fs.readFile(selected);if(bytes.length>2*1024*1024)throw Error('报告超过 2 MiB');
 const raw=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
 if(!Array.isArray(raw.findings)||raw.findings.length>200||!Array.isArray(raw.checks)||!Array.isArray(raw.limitations))throw Error('报告格式不完整');
 const task=w.task,prior=task.skillReviews||{revision:0,runs:[],findings:[]},digest=hash(bytes);
 if(prior.runs.some(r=>r.importHash===digest&&r.target===target))return {duplicate:true,count:raw.findings.length};
 const b=await w.open('test',target);if(b.externalChanged)throw Error('文件有外部变化，请先重新加载');
 const runId=randomUUID(),version=hash(b.text),ids=new Set(),clip=(x,n=12000)=>String(x??'').slice(0,n);
 const findings=raw.findings.map(f=>{
  if(!f.id||ids.has(f.id)||!f.title||!['high','medium','low'].includes(f.priority))throw Error('报告问题编号、标题或优先级无效');ids.add(f.id);
  const tokens=new Set((String(f.parameter||'')+' '+String(f.current||'')+' '+JSON.stringify(f.details_table||{})+' '+JSON.stringify(f.evidence||[])).match(/[A-Za-z_]\w{3,}/g)||[]),anchors=[];
  // Anchor only exact assignment statements mentioning report parameter identifiers.
  for(const line of b.text.split('\n')){const code=line.split('//')[0];const m=code.match(/\b([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*=(?!=)/);if(!m||!tokens.has(m[1].split('.').at(-1))||line.length>2000||b.text.split(line).length!==2)continue;
   anchors.push({side:'test',path:target,quote:line,version,line:b.text.slice(0,b.text.indexOf(line)).split('\n').length});if(anchors.length===50)break;}
  // This narrowly scoped candidate changes comments only, as explicitly requested
  // by the legacy report. It is labelled historical/unvalidated, never a new pass.
  let proposal=null;
  if(f.id==='DL-META-002'){
   const on=anchors.find(a=>/\.vary_is_max_speed_on\s*=/.test(a.quote)),off=anchors.find(a=>/\.vary_is_max_speed_off\s*=/.test(a.quote));
   if(on&&off&&off.line===on.line+1){const quote=on.quote+'\n'+off.quote;
    const fix=(line,from,to)=>line.replace(/\/\*([\s\S]*?)\*\//g,(all,body)=>'/*'+body.replace(new RegExp('\\b'+from+'\\b','g'),to)+'*/');
    const after=fix(on.quote,'is_start','is_run')+'\n'+fix(off.quote,'is_run','is_start');
    if(after!==quote&&on.quote.includes('is_start')&&off.quote.includes('is_run')){anchors.splice(anchors.indexOf(off),1);anchors.splice(anchors.indexOf(on),1);anchors.unshift({...on,quote});proposal={before:quote,after,source:'historical-report',note:'依原报告生成的注释修订候选；不改运行参数。当前实现与门控条件仍需复核。'};}
   }
  }
  const excluded=excludeSchematic&&f.id==='DL-HW-001';
  return {id:runId+':'+clip(f.id,100),ruleId:clip(f.id,100),runId,target,side:'test',title:clip(f.title,500),priority:f.priority,evidenceStatus:['confirmed','needs-confirmation','advisory','missing-evidence'].includes(f.status)?f.status:'needs-confirmation',parameter:clip(f.parameter),current:clip(f.current),recommendation:clip(f.recommendation),evidence:(f.evidence||[]).slice(0,100).map(x=>clip(typeof x==='string'?x:JSON.stringify(x))),workflow:excluded?'not-applicable':'open',userComment:excluded?'本轮明确排除结合原理图审核系数；保留原报告意见备查。':'',revision:0,history:[],location:anchors[0]||null,relatedLocations:anchors.slice(1),proposal,provenance:'historical-report',needsRevalidation:true,detailsTable:f.details_table||null,created:new Date().toISOString()};
 });
 const dir=path.join(w.taskRoot,'artifacts');await fs.mkdir(dir,{recursive:true});const reportJSON=path.join(dir,'import-'+runId+'.json');await fs.writeFile(reportJSON,bytes,{flag:'wx'});
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const reportHTML=path.join(dir,'import-'+runId+'.html');await fs.writeFile(reportHTML,'<!doctype html><meta charset="utf-8"><title>导入原报告</title><h1>'+esc(raw.title)+'</h1><p>历史报告完整保留，当前工程版本待复核；无新 AI 调用。</p>'+raw.findings.map(f=>'<article><h2>'+esc(f.id)+' '+esc(f.title)+'</h2><pre style="white-space:pre-wrap">'+esc(JSON.stringify(f,null,2))+'</pre></article>').join(''));
 if(w.task!==task)throw Error('工程已切换');
 task.skillReviews={...prior,revision:prior.revision+1,runs:[...prior.runs,{id:runId,kind:'historical-report',importHash:digest,sourceReport:selected,title:raw.title,target,side:'test',skill:{id:'ccspt-code-review',version:raw.skill_version||'原报告未注明'},finished:new Date().toISOString(),checks:raw.checks.map(x=>clip(x)),limitations:[...raw.limitations,'原报告没有源文件指纹，当前版本待复核；本次仅导入，不是重新审核。'],reportJSON,reportHTML}],findings:[...prior.findings,...findings]};
 try{await w.persist();}catch(e){task.skillReviews=prior;throw e;}
 return {count:findings.length,anchored:findings.filter(f=>f.location).length,excluded:findings.filter(f=>f.workflow==='not-applicable').length};
}
