import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';

const str=(value,label)=>{if(typeof value!=='string'||!value||value.length>4096||value.includes('\0'))throw Error(label+' 无效');return value;};
const inside=(root,file)=>{const rel=path.relative(root,file);return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
const clone=x=>structuredClone(x);

export class FirmwareService {
 constructor(workspace,{runtimeRoot,notify=()=>{},launch=spawn}={}){
  this.workspace=workspace;this.runtimeRoot=runtimeRoot;this.notify=notify;this.launch=launch;this.jobs=new Map();this.active=null;
 }
 get busy(){return !!this.active||!!this.starting;}
 async safe(file,{artifact=false}={}){
  const w=this.workspace,root=artifact?path.join(w.taskRoot,'artifacts','firmware'):w.root('test');
  const absolute=path.resolve(root,str(file,'文件路径'));if(!inside(root,absolute))throw Error('文件不在当前任务范围内');
  let cursor=absolute;
  while(inside(root,cursor)){
   try{const stat=await fs.lstat(cursor);if(stat.isSymbolicLink())throw Error('固件路径不能经过符号链接或目录联接');}catch(e){if(e.code!=='ENOENT')throw e;}
   if(cursor===root)break;cursor=path.dirname(cursor);
  }
  return absolute;
 }
 view(job){if(!job)throw Error('固件任务不存在');return clone(job);}
 async command(a){
  if(!this.workspace.task||a.taskId!==this.workspace.task.id)throw Error('任务已切换，请读取当前 taskId');
  const op=a.operation||'status';
  if(op==='projects')return {projects:(this.workspace.inventory||[]).filter(n=>n.kind==='file'&&/\.mtpj$/i.test(n.rel)&&n.test).map(n=>n.rel)};
  if(op==='status')return {busy:this.busy,active:this.active?.id||null,jobs:[...this.jobs.values()].map(j=>this.view(j)),runtimeRoot:this.runtimeRoot};
  if(op==='job'){const j=this.jobs.get(a.jobId);if(j?.taskId!==a.taskId)throw Error('任务编号不属于当前工程');return this.view(j);}
  if(op==='cancel'){
   const j=this.jobs.get(a.jobId);if(j?.taskId!==a.taskId)throw Error('任务编号不属于当前工程');
   if(this.active?.id===j.id){j.cancelRequested=true;await fs.writeFile(j.cancelFile,'cancel');this.notify('firmware-job',this.view(j));}
   return this.view(j);
  }
  if(op==='motor'&&a.action==='stop'&&a.execute===true&&this.active?.operation==='motor'){
   this.active.cancelRequested=true;await fs.writeFile(this.active.cancelFile,'cancel');return this.view(this.active);
  }
  if(!['ports','discover','artifact','inspect','encrypt','simulate','build','flash','motor'].includes(op))throw Error('不支持的固件操作');
  if(this.busy||this.workspace.locked)throw Error('固件任务正在执行');
  if([...this.workspace.buffers.values()].some(b=>b.dirty))throw Error('请先保存当前草稿');
  this.starting=true;
  try {
  const args=[],w=this.workspace;
  let exe='Bootloader',file;
  if(op==='artifact'||op==='build'){
   const project=await this.safe(a.project);if(path.extname(project).toLowerCase()!=='.mtpj')throw Error('请选择当前 test 工程中的 mtpj');
   args.push('--project',project);
   if(op==='build'&&a.execute===true)args.push('--execute');
  }
  if(['inspect','simulate','encrypt','flash'].includes(op)){
   file=await this.safe(a.file,{artifact:a.artifact===true});
   const ext=path.extname(file).toLowerCase();if(!['.mot','.em'].includes(ext))throw Error('仅支持 MOT / EM');
   if(ext==='.mot'&&!/[/\\]DefaultBuild[/\\]only_app[/\\]/i.test(file))throw Error('Boot MOT 必须来自 DefaultBuild/only_app');
   args.push('--file',file);if(ext==='.mot'||op==='encrypt')exe='DevMngRegister';
   if(op==='encrypt'){
    if(ext!=='.mot')throw Error('加密输入必须是 MOT');
    const output=await this.safe(path.basename(file,'.mot')+'-'+randomUUID()+'.em',{artifact:true});args.push('--out',output);
   }
  }
  const serial=()=>{
   args.push('--port',str(a.port,'串口'),'--app-baud',String(a.appBaud??9600),'--app-parity',a.appParity??'N');
  };
  if(op==='flash'){
   if(path.extname(file).toLowerCase()!=='.em')throw Error('升级输入必须是 EM');
   const hash=str(a.expectedSha256,'固件哈希');if(!/^[a-f0-9]{64}$/i.test(hash))throw Error('请先检查文件并取得哈希');
   serial();args.push('--boot-baud',String(a.bootBaud??9600),'--boot-parity',a.bootParity??'N','--route',str(a.route,'升级路径'),'--expected-id',str(a.expectedId,'产品ID'),'--expected-sha256',hash);
   if(a.alreadyBoot===true)args.push('--already-boot');if(a.eraseData===true)args.push('--erase-data');if(a.execute===true)args.push('--execute');
  }
  if(op==='motor'){
   serial();if(!['stop','speed','run'].includes(a.action))throw Error('电机动作无效');args.push('--action',a.action);
   if(a.forward===true)args.push('--forward');
   if(a.action!=='stop'){
    if(!Number.isFinite(a.rpm)||!Number.isFinite(a.maxRpm)||a.rpm<0||a.maxRpm<=0||a.rpm>a.maxRpm)throw Error('请提供确定的转速和上限');
    args.push('--rpm',String(a.rpm),'--max-rpm',String(a.maxRpm));
   }
   if(a.action==='run'){
    if(!Number.isFinite(a.seconds)||a.seconds<=0||a.seconds>60)throw Error('演示运行时间需为 0–60 秒');args.push('--seconds',String(a.seconds));
   }
   if(a.execute===true)args.push('--execute');
  }
  if(op==='discover'&&a.port)args.push('--port',str(a.port,'串口'));
  const binary=path.join(this.runtimeRoot,exe,exe+'.exe');await fs.access(binary);
  const dir=path.join(w.taskRoot,'artifacts','firmware');await fs.mkdir(dir,{recursive:true});
  const id=randomUUID(),job={id,taskId:w.task.id,operation:op,status:'running',started:new Date().toISOString(),finished:null,events:[],result:null,error:null,cancelRequested:false,cancelFile:path.join(dir,id+'.cancel'),log:path.join(dir,id+'.jsonl')};
  this.jobs.set(id,job);this.active=job;while(this.jobs.size>30){const old=[...this.jobs.values()].find(j=>j.id!==id);this.jobs.delete(old.id);}
  if(op==='build')args.push('--log',path.join(dir,id+'-csplus.log'));
  this.notify('firmware-job',this.view(job));
  let resolveDone;job.done=null;
  this.done=new Promise(r=>resolveDone=r);
  // Native helpers retain their company-authorized process names; never invoke python.exe here.
  let child;try{child=this.launch(binary,[op,...args],{shell:false,windowsHide:true,cwd:w.root('test'),env:{...process.env,PYTHONIOENCODING:'utf-8',CCSPT_CANCEL_FILE:job.cancelFile},stdio:['ignore','pipe','pipe']});}catch(e){job.status='failed';job.error=e.message;this.active=null;resolveDone();return this.view(job);}
  let pending='',stderr='',writes=Promise.resolve(),settled=false;
  const line=raw=>{
   let event;try{event=JSON.parse(raw);}catch{event={event:'output',data:{text:raw.slice(0,3000)}};}
   if(event.event==='result')job.result=event.data;if(event.event==='error')job.error=event.data?.message||raw;
   job.events.push(event);if(job.events.length>150)job.events.shift();this.notify('firmware-event',{jobId:id,taskId:job.taskId,...event});
   writes=writes.then(()=>fs.appendFile(job.log,JSON.stringify(event)+'\n')).catch(e=>{job.error='日志写入失败: '+e.message;});
  };
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{pending+=chunk;if(pending.length>1024*1024){line(pending.slice(0,3000));pending='';}const rows=pending.split(/\r?\n/);pending=rows.pop();for(const row of rows)if(row.trim())line(row);});
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-6000);});
  const finish=async(code,error)=>{
   if(settled)return;settled=true;if(pending.trim())line(pending);
   job.status=error||code!==0?'failed':'completed';if(code===2)job.status='cancelled';job.error=error?.message||job.error||(code!==0?stderr||'进程返回 '+code:null);job.finished=new Date().toISOString();
   await writes;
   try{await fs.appendFile(job.log,JSON.stringify({event:'job_finished',data:{status:job.status,error:job.error,result:job.result}})+'\n');}catch(e){job.error='日志写入失败: '+e.message;job.status='failed';}
   this.active=null;this.notify('firmware-job',this.view(job));resolveDone();
  };
  child.on('error',e=>finish(null,e));child.on('close',code=>finish(code));
  return this.view(job);
  } finally {this.starting=false;}
 }
 async stopAndWait(){if(this.active){await fs.writeFile(this.active.cancelFile,'cancel');await this.done;}}
}
