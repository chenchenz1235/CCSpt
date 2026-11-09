import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './text.mjs';
import {ReviewExchange} from './review-exchange.mjs';
const PRIORITIES=['high','medium','low'],STATUSES=['confirmed','needs-confirmation','advisory','missing-evidence'];
const str=(v,n=4000)=>typeof v==='string'?v.slice(0,n):'';
const list=v=>Array.isArray(v)?v.slice(0,100).map(x=>str(x)):[];
const now=()=>new Date().toISOString();
const state=w=>w.task.skillReviews??={revision:0,runs:[],findings:[]};
// UI annotations and transport validation only; no installed skills, Python, version checks or inference.
export class ReviewWorkbench {
 constructor(workspace,{notify=()=>{}}={}){this.w=workspace;this.notify=notify;this.previews=new Map();this.exchange=new ReviewExchange(workspace,{normalize:(r,s)=>this.normalizeReport(r,s),publish:()=>this.snapshot(),notify});}
 ensureIdle(){if(this.exchange.busy)throw Error('报告正在发布，请稍后');if(!this.w.task)throw Error('请先打开工程');}
 prepare(args){return this.exchange.prepare(args);}
 async run({sessionId}){return this.exchange.manifest(await this.exchange.current(sessionId));}
 stop(args={}){return this.exchange.cancel(args);}
 async command(args){switch(args.command){case 'prepare':return this.prepare(args);case 'run':return args.sessionId?this.run(args):this.prepare(args);case 'evidence':return this.exchange.evidence(args);case 'submit':return this.exchange.submit(args);case 'complete':return this.exchange.complete(args);case 'cancel':return this.exchange.cancel(args);default:throw Error('审核传输指令支持 prepare/evidence/submit/complete/cancel');}}
 async normalizeReport(report,s){
  if(!report||typeof report.title!=='string'||!report.title.trim()||!Array.isArray(report.findings)||report.findings.length>200||JSON.stringify(report).length>400000)throw Error('审核报告格式无效或超出范围');
  if(!Array.isArray(report.checks)||!Array.isArray(report.limitations))throw Error('报告需说明实际检查与限制');
  const findings=[],ids=new Set();for(const raw of report.findings){
   if(!raw||typeof raw.id!=='string'||raw.id.length>100||!raw.id||ids.has(raw.id)||typeof raw.title!=='string'||!raw.title)throw Error('问题需要唯一编号和标题');ids.add(raw.id);for(const key of ['parameter','current','recommendation'])if(typeof raw[key]!=='string')throw Error('findings['+findings.length+'].'+key+' 必须是字符串');if(!Array.isArray(raw.evidence)||raw.evidence.some(x=>typeof x!=='string'))throw Error('findings['+findings.length+'].evidence 必须是字符串数组');if(raw.proposal&&!raw.location)throw Error('修改建议必须附带精确定位');
   for(const [field,allowed]of [['priority',PRIORITIES],['status',STATUSES]])if(!allowed.includes(raw[field]))throw Error('findings['+findings.length+'] ('+str(raw.id,100)+').'+field+'='+JSON.stringify(raw[field])+' 无效；允许值：'+allowed.join(', '));
   const f={id:s.id+':'+str(raw.id,100),ruleId:str(raw.id,100),runId:s.id,target:s.target,side:s.side,title:str(raw.title,500),priority:raw.priority,evidenceStatus:raw.status,parameter:str(raw.parameter,300),current:str(raw.current),recommendation:str(raw.recommendation),evidence:list(raw.evidence),workflow:'open',revision:0,history:[],location:null,proposal:null,created:now()};
   if(raw.location){const l=raw.location;if(l.path!==s.target)throw Error('第一版原位意见仅定位本次参数目标文件，跨文件依据请放入 evidence');if(typeof l.quote!=='string'||l.quote.length>2000)throw Error('定位片段需为 1～2000 字符的精确文本');const b=await this.w.open(s.side,l.path),q=l.quote;if(b.externalChanged||l.version!==hash(b.text)||!q||b.text.split(q).length!==2)throw Error('定位依据过期或片段不唯一，请重新读取并提供精确 quote/version');
    const offset=b.text.indexOf(q);f.location={side:s.side,path:l.path,version:hash(b.text),quote:q,line:b.text.slice(0,offset).split('\n').length};
    if(raw.proposal){const {before,after}=raw.proposal;if(typeof before!=='string'||typeof after!=='string'||before.length>2000||after.length>2000||!before||before===after||!q.includes(before)||b.text.split(before).length!==2)throw Error('建议修改必须在定位片段内唯一匹配，且前后内容不同');f.proposal={before,after};}
   }
   if(raw.relatedLocations){if(!Array.isArray(raw.relatedLocations)||raw.relatedLocations.length>50)throw Error('关联位置超出范围');f.relatedLocations=[];for(const l of raw.relatedLocations){if(l.path!==s.target||typeof l.quote!=='string'||!l.quote||l.quote.length>2000)throw Error('关联位置无效');const b=await this.w.open(s.side,l.path);if(b.externalChanged||l.version!==hash(b.text)||b.text.split(l.quote).length!==2)throw Error('关联位置过期或不唯一');f.relatedLocations.push({side:s.side,path:l.path,version:l.version,quote:l.quote,line:b.text.slice(0,b.text.indexOf(l.quote)).split('\n').length});}}
   findings.push(f);
  }
  return {title:str(report.title,500),findings,checks:list(report.checks),limitations:list(report.limitations)};
 }
 async snapshot(){if(!this.w.task)return {revision:0,runs:[],findings:[]};const value=structuredClone(state(this.w));for(const f of value.findings){f.stale=false;if(f.location){try{const b=await this.w.open(f.location.side,f.location.path);f.stale=b.externalChanged||hash(b.text)!==(f.appliedVersion||f.location.version);const q=f.appliedQuote||f.location.quote,offset=b.text.indexOf(q);f.displayLine=offset>=0&&b.text.split(q).length===2?b.text.slice(0,offset).split('\n').length:null;}catch{f.stale=true;f.displayLine=null;}}}return {...value,taskId:this.w.task.id,active:this.exchange.busy,request:this.w.task.reviewRequest||null};}
 async edit({id,revision,comment,amendment,workflow}){
  this.ensureIdle();const v=state(this.w),f=v.findings.find(f=>f.id===id);if(!f||f.revision!==revision)throw Error('审核意见已变化，请刷新');
  if(workflow&&!['open','not-applicable'].includes(workflow))throw Error('不能手动把问题标为复核通过');if(workflow==='not-applicable'&&!str(comment).trim())throw Error('标记不适用需要填写原因');
  f.history.push({at:now(),action:'edit',comment:f.userComment||'',amendment:f.amendment||'',workflow:f.workflow});f.userComment=str(comment);f.amendment=str(amendment);if(workflow){f.workflow=workflow;if(workflow==='open'){delete f.appliedVersion;delete f.appliedQuote;}}f.revision++;v.revision++;await this.w.persist();return this.snapshot();
 }

 async draftInfo({id,anchorIndex=0}){
  this.ensureIdle();const f=state(this.w).findings.find(x=>x.id===id);if(!f)throw Error('意见不存在');
  const anchors=[f.location,...(f.relatedLocations||[])].filter(Boolean),a=anchors[anchorIndex];if(!a)throw Error('此意见尚无精确原文位置，请在代码页手动编辑后复核');
  if(a.side!=='test'&&this.w.task.reviewProject)throw Error('原始快照只读');const b=await this.w.open(a.side,a.path);
  if(b.externalChanged||b.text.split(a.quote).length!==2)throw Error('问题块已变化，请重新定位原文');
  return {id,revision:f.revision,anchorIndex,before:a.quote,after:f.proposal&&a.quote.includes(f.proposal.before)?a.quote.replace(f.proposal.before,f.proposal.after):a.quote,version:hash(b.text)};
 }
 async setProposal({id,revision,anchorIndex=0,before,after,version}){
  const d=await this.draftInfo({id,anchorIndex});if(d.revision!==revision||d.before!==before||d.version!==version)throw Error('文件或意见已变化，请重新编辑');
  if(typeof after!=='string'||after.length>2000||!after.trim()||after===before)throw Error('请填写实际不同的拟修订内容（最多2000字符）');
  const v=state(this.w),f=v.findings.find(x=>x.id===id),a=[f.location,...(f.relatedLocations||[])].filter(Boolean)[anchorIndex];
  f.history.push({at:now(),action:'user-proposal',previous:f.proposal,previousLocation:f.location});
  const other=[f.location,...(f.relatedLocations||[])].filter(x=>x&&x!==a);f.location={...a,version};f.relatedLocations=other;f.proposal={before,after,source:'user'};f.workflow='open';delete f.appliedVersion;delete f.appliedQuote;f.revision++;v.revision++;await this.w.persist();return this.snapshot();
 }
 async acceptAdvice({id,revision}){
  this.ensureIdle();const v=state(this.w),f=v.findings.find(x=>x.id===id);if(!f||f.revision!==revision||f.workflow!=='open'||f.proposal)throw Error('意见已变化或已有参数补丁');
  f.history.push({at:now(),action:'accept-advice',note:'仅采纳核实意见，不修改参数，不等于复核通过'});f.workflow='needs-validation';f.revision++;v.revision++;await this.w.persist();return this.snapshot();
 }

 async preview({id}){const f=state(this.w).findings.find(f=>f.id===id);if(!f?.location||!f.proposal||(f.evidenceStatus==='missing-evidence'&&f.proposal?.source!=='user'))throw Error('此意见没有可直接采纳的明确修改，请先补充依据');
  if(this.w.task.reviewProject&&f.location.side==='ref')throw Error('审核原始快照只读，请审核 test 修改副本');if(f.workflow!=='open')throw Error('此意见已处理，请重新审核');const b=await this.w.open(f.location.side,f.location.path);
  if(b.externalChanged||hash(b.text)!==f.location.version||b.text.split(f.proposal.before).length!==2)throw Error('文件已变化，建议已过期；请重新审核，未修改');
  const token=randomUUID();this.previews.clear();this.previews.set(token,{taskId:this.w.task.id,id:f.id,revision:f.revision,expected:hash(b.text.replace(f.proposal.before,f.proposal.after)),expires:Date.now()+120000});return {id:f.id,revision:f.revision,token,side:f.location.side,path:f.location.path,version:hash(b.text),bufferRevision:b.revision,before:f.proposal.before,after:f.proposal.after,note:'采纳只进入可撤销缓冲区；保存后写入当前工作副本，仍待复核。'};
 }
 async applied({id,revision,token}){
  this.ensureIdle();const v=state(this.w),f=v.findings.find(f=>f.id===id);if(!f||f.revision!==revision||!f.proposal||!f.location)throw Error('审核意见已变化');const b=await this.w.open(f.location.side,f.location.path);
  const p=this.previews.get(token);if(!p||p.taskId!==this.w.task.id||p.id!==id||p.revision!==revision||p.expires<Date.now()||b.externalChanged||hash(b.text)!==p.expected)throw Error('修改与预览不一致或已过期，未标记采纳');
  this.previews.delete(token);f.history.push({at:now(),action:'apply',version:p.expected});f.workflow='modified';f.appliedVersion=p.expected;f.appliedQuote=f.location.quote.replace(f.proposal.before,f.proposal.after);f.revision++;v.revision++;await this.w.persist();return this.snapshot();
 }
}
