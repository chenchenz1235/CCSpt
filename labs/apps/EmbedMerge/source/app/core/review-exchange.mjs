import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './text.mjs';
import {reportSchema,protocolVersion} from './review-protocol.mjs';
const now=()=>new Date().toISOString();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export class ReviewExchange {
 constructor(workspace,{normalize,publish,notify=()=>{}}){this.w=workspace;this.normalize=normalize;this.publish=publish;this.notify=notify;this.sessions=new Map();this.busy=false;}
 async current(id){
  const s=this.sessions.get(id);if(!s||s.taskId!==this.w.task?.id)throw Error('审核请求不存在或任务已切换，请重新创建请求');
  if(Date.now()>s.expires)throw Error('审核请求已过期，请重新创建请求');if(s.status!=='awaiting-ai')throw Error('审核请求已结束或取消');
  const b=await this.w.open(s.side,s.target);if(b.externalChanged||hash(b.text)!==s.sourceVersion)throw Error('审核期间目标文件已变化，未发布报告，请重新创建请求');
  for(const [key,version]of s.observed){const [side,...rel]=key.split(':');const b=await this.w.open(side,rel.join(':'));if(b.externalChanged||hash(b.text)!==version)throw Error('审核引用文件已变化，未发布报告');}return s;
 }
 manifest(s){return {protocol:protocolVersion,status:s.status,sessionId:s.id,taskId:s.taskId,target:s.target,side:s.side,sourceVersion:s.sourceVersion,scope:s.scope,reference:s.reference,execution:'external-ai',reportSchema,readBudget:{...s.budget},submitBudget:{maxAttempts:5,maxReportChars:400000},expires:new Date(s.expires).toISOString(),message:'审核请求已就绪，等待当前 AI 使用其自身技能执行并提交报告；EmbedMerge 未运行技能或启动审核推理。'};}
 async prepare({target,side='test',scope='basic',requirementsPath=''}={}){
  if(!this.w.task)throw Error('请先打开工程');if(!['basic','full'].includes(scope))throw Error('审核范围必须是 basic/full');
  if(!['ref','test'].includes(side)||!this.w.inventory?.some(n=>n.kind==='file'&&n.rel===target&&n[side])||!/\.c$/i.test(target))throw Error('请选择当前工程内的参数 C 文件');
  if(typeof requirementsPath!=='string'||requirementsPath.length>4096)throw Error('可选参考路径无效');
  const task=this.w.task,b=await this.w.open(side,target);if(this.w.task!==task||b.externalChanged)throw Error('任务或文件已变化');
  const s={id:randomUUID(),taskId:task.id,target,side,scope,sourceVersion:hash(b.text),reference:{provided:!!requirementsPath.trim(),path:requirementsPath.trim()||null,status:requirementsPath.trim()?'ai-owned-reference':'not-provided'},status:'awaiting-ai',created:now(),expires:Date.now()+120*60*1000,budget:{calls:0,chars:0,maxCalls:400,maxChars:4000000,write:false},observed:new Map(),attempts:0,candidate:null};
  this.sessions.clear();this.sessions.set(s.id,s);const manifest=this.manifest(s),prior=task.reviewRequest;task.reviewRequest=manifest;
  try{await this.w.persist();}catch(e){task.reviewRequest=prior;this.sessions.delete(s.id);throw e;}
  this.notify('review-progress',{stage:'等待当前 AI 执行审核',taskId:task.id,sessionId:s.id,execution:'external-ai',active:false});return manifest;
 }
 async evidence({sessionId,action='read',rel,start,count,query}={}){
  const s=await this.current(sessionId);if(!['read','search'].includes(action))throw Error('审核证据接口只允许 read/search，不允许修改或执行工程');
  const args={action,side:s.side,rel:rel||s.target,start,count,query};const value=await this.w.evidence(args,s.budget);await this.current(sessionId);
  const capture=v=>{if(v?.path&&v.version)s.observed.set(s.side+':'+v.path,v.version);};if(action==='read')capture(value);else for(const m of value.matches||[])capture(m);
  return {...value,readBudget:{...s.budget}};
 }
 executor(value){
  if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>100)throw Error('executor.name 必须说明执行审核的 AI');
  const skill=value.skill;if(skill!=null&&(typeof skill.id!=='string'||!skill.id||skill.id.length>150||typeof skill.version!=='string'||!skill.version||skill.version.length>100))throw Error('executor.skill 需提供 AI 实际使用的 id/version，未使用技能时传 null');
  return {name:value.name,skill:skill?{id:skill.id,version:skill.version}:null,verification:'declared-by-ai',execution:'external-ai'};
 }
 async submit({sessionId,report,executor}={}){
  const s=await this.current(sessionId);if(++s.attempts>5)throw Error('报告最多允许 5 次提交校验，请重新创建请求');
  s.candidate=null;s.rawReport=null;s.executor=null;
  const identity=this.executor(executor),candidate=await this.normalize(report,s);await this.current(sessionId);
  s.candidate=candidate;s.rawReport=structuredClone(report);s.executor=identity;
  return {accepted:true,status:'candidate',sessionId,findings:candidate.findings.length,note:'报告候选已校验，complete 后才发布；未修改源文件。'};
 }
 async complete({sessionId}={}){
  if(this.busy)throw Error('报告正在发布');this.busy=true;
  try{const s=await this.current(sessionId);if(!s.candidate)throw Error('尚未提交有效结构化报告，不能标记审核完成');
   // Revalidate every quote/version at commit; evidence and finalization budgets are independent.
   const candidate=await this.normalize(s.rawReport,s);await this.current(sessionId);
   const task=this.w.task,prior=task.skillReviews,value=structuredClone(prior||{revision:0,runs:[],findings:[]}),previous=structuredClone(value),dir=path.join(this.w.taskRoot,'artifacts');await fs.mkdir(dir,{recursive:true});
   const limitations=[...candidate.limitations,...(s.scope==='basic'?['用户选择基础参数范围；检查及未检查内容以 AI 报告声明为准。']:[])];
   const run={id:s.id,created:s.created,finished:now(),target:s.target,side:s.side,sourceVersion:s.sourceVersion,scope:s.scope,execution:'external-ai',executor:s.executor,skill:s.executor.skill||{id:'未声明技能',version:''},requirements:s.reference,checks:candidate.checks,limitations,title:candidate.title,status:'completed',reportJSON:path.join(dir,'review-report-'+s.id+'.json'),reportHTML:path.join(dir,'review-report-'+s.id+'.html')};
   const raw={...s.rawReport,limitations,executor:s.executor,sourceVersion:s.sourceVersion,project:task.name,scope:[s.side+'/'+s.target]};
   await fs.writeFile(run.reportJSON,JSON.stringify(raw,null,2));
   const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escape(raw.title)+'</title><style>body{font:16px system-ui;max-width:960px;margin:36px auto;padding:0 20px}details{padding:14px;border:1px solid #ccc;margin:12px 0}pre{white-space:pre-wrap}summary{cursor:pointer}small{color:#555}</style><h1>'+escape(raw.title)+'</h1><small>执行方：'+escape(s.executor.name)+'；技能信息由 AI 声明，宿主不读取技能。未执行编译或硬件验证。</small>'+candidate.findings.map(f=>'<details><summary>'+escape(f.priority+' · '+f.title)+'</summary><pre>'+escape(JSON.stringify({parameter:f.parameter,current:f.current,status:f.evidenceStatus,evidence:f.evidence,recommendation:f.recommendation,location:f.location},null,2))+'</pre></details>').join('')+'<h2>实际检查</h2><ul>'+candidate.checks.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul><h2>限制</h2><ul>'+limitations.map(x=>'<li>'+escape(x)+'</li>').join('')+'</ul>';
   await fs.writeFile(run.reportHTML,html);await fs.writeFile(path.join(dir,'review-'+s.id+'.json'),JSON.stringify({run,report:candidate,previous},null,2));await this.current(sessionId);
   value.runs.push(run);value.runs=value.runs.slice(-20);value.findings=[...value.findings.filter(f=>f.provenance==='historical-report'||f.target!==s.target||f.side!==s.side),...candidate.findings];value.revision++;
   const priorRequest=task.reviewRequest;task.skillReviews=value;task.reviewRequest={...this.manifest(s),status:'completed'};
   try{await this.w.persist();}catch(e){task.skillReviews=prior;task.reviewRequest=priorRequest;throw e;}
   s.status='completed';this.notify('review-progress',{stage:'外部 AI 报告已发布',taskId:task.id,active:false});this.notify('review-changed',{taskId:task.id});return this.publish();
  }finally{this.busy=false;}
 }
 async cancel({sessionId}={}){const s=this.sessions.get(sessionId||this.w.task?.reviewRequest?.sessionId);if(!s||s.taskId!==this.w.task?.id)throw Error('没有当前任务的待处理审核请求');if(s.status!=='awaiting-ai')throw Error('审核请求已结束');s.status='cancelled';s.candidate=null;this.w.task.reviewRequest={...this.manifest(s),status:'cancelled'};await this.w.persist();this.notify('review-progress',{stage:'审核请求已取消，未发布候选报告',active:false});return {status:'cancelled',sessionId:s.id};}
}
