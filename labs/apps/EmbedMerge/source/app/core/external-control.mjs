import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,randomUUID,timingSafeEqual,createHash} from 'node:crypto';

const text=(x,label,max=2048)=>{if(typeof x!=='string'||!x||x.length>max)throw Error(label+' 无效');return x;};
const page=(a,key,fallback,max)=>{const n=a[key]??fallback;if(!Number.isInteger(n)||n<0||n>max||(key==='limit'&&n===0))throw Error(key+' 无效');return n;};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const defaultBrief=()=>({objective:'',constraints:[],decisions:[],revision:0,updated:null});
export class ExternalControl {
  constructor(workspace,{notify,ready=()=>true,occupied=()=>false,sharedChat,firmware,timeout=120000,version='unknown'}={}){
    this.firmware=firmware;
    this.sharedChat=sharedChat;this.workspace=workspace;this.notify=notify;this.ready=ready;this.occupied=occupied;this.timeout=timeout;
    this.token=randomBytes(32).toString('hex');this.active=false;
    this.jobs=new Map();this.progress=null;this.version=version;
    this.descriptor=path.join(workspace.dataRoot,'external-control.json');
  }
  permits(method,id){return !!this.pending&&id===this.pending.id&&((this.pending.action==='compare'&&method==='createComparison')||(this.pending.action==='review-project'&&method==='createReviewProject')||(this.pending.action==='resume'&&method==='resume')||(this.pending.action==='review'&&['skillReviewPrepare','skillReviewRun','skillReviewStart','skillReviewStop','reviewExchange'].includes(method)));}
  get runningJob(){return [...this.jobs.values()].find(j=>['queued','running'].includes(j.status));}
  get blocksMutations(){return !!this.runningJob||(this.active&&!['context','brief'].includes(this.operation));}
  jobView(j){if(!j)throw Error('外部任务不存在或已过期');return structuredClone(j);}
  publishJob(j){this.notify('external-job',this.jobView(j));}
  checkCancellation(requestId){if(this.pending?.id===requestId&&this.jobs.get(this.currentJobId)?.cancelRequested)throw Error('外部任务已取消');}
  noteProgress(p){
    if(!this.active)return;
    this.progress={stage:String(p.stage||'').slice(0,200),detail:String(p.detail||'').slice(0,500),current:Number.isFinite(p.current)?p.current:0,total:Number.isFinite(p.total)?p.total:0,at:new Date().toISOString()};
    const job=this.jobs.get(this.currentJobId);if(job?.status==='running')job.progress=this.progress;
  }
  async startJob(a){
    const operation=text(a.operation,'operation',30);if(!['compare','review-project','resume','open','folder','review'].includes(operation))throw Error('该操作不支持后台任务');
    const args=a.args??{};if(!args||typeof args!=='object'||Array.isArray(args))throw Error('args 必须是对象');
    const requestKey=a.requestKey===undefined?null:text(a.requestKey,'requestKey',100),fingerprint=createHash('sha256').update(JSON.stringify(canonical({operation,args}))).digest('hex');
    if(requestKey){const old=[...this.jobs.values()].find(j=>j.requestKey===requestKey);if(old){if(old.fingerprint!==fingerprint)throw Error('requestKey 已用于不同请求');return this.jobView(old);}}
    this.ensureAvailable(false);
    const job={id:randomUUID(),operation,args:structuredClone(args),requestKey,fingerprint,status:'queued',created:new Date().toISOString(),started:null,finished:null,cancelRequested:false,progress:{stage:'已接受请求',detail:'等待窗口执行',current:0,total:0},result:null,error:null};
    this.jobs.set(job.id,job);while(this.jobs.size>32){const first=[...this.jobs.values()].find(j=>!['queued','running'].includes(j.status));if(!first)break;this.jobs.delete(first.id);}
    this.publishJob(job);
    setImmediate(async()=>{
      if(job.status!=='queued')return;job.status='running';job.started=new Date().toISOString();this.currentJobId=job.id;this.publishJob(job);
      try{job.result=await this.call(operation,args,job.id);job.status='completed';if(job.cancelRequested)job.cancellation='completed_before_stop';}
      catch(e){job.error=e.message;job.status=job.cancelRequested&&/停止|取消/.test(e.message)?'cancelled':'failed';}
      finally{job.finished=new Date().toISOString();this.currentJobId=null;this.publishJob(job);}
    });return this.jobView(job);
  }
  cancelJob(a){
    const j=this.jobs.get(text(a.jobId,'jobId',100));if(!j)throw Error('外部任务不存在或已过期');
    if(['queued','running'].includes(j.status)){j.cancelRequested=true;if(j.status==='queued'){j.status='cancelled';j.finished=new Date().toISOString();}else if(this.currentJobId===j.id)this.workspace.cancelled=true;if(j.operation==='review')this.notify('external-review-stop',{jobId:j.id});this.publishJob(j);}
    return this.jobView(j);
  }
  ensureAvailable(allowDrafts=false,owner=null){
    if(!this.ready())throw Error('EmbedMerge 界面尚未就绪');
    if(this.active||this.occupied()||this.workspace.locked||(this.runningJob&&this.runningJob.id!==owner))throw Error('EmbedMerge 正在处理其他任务，请稍后重试');
    if(!allowDrafts&&[...this.workspace.buffers.values()].some(b=>b.dirty))throw Error('当前任务有未保存草稿，请先保存或处理；外部请求未切换任务');
  }
  briefValue(){return {...defaultBrief(),...this.workspace.task?.externalBrief};}
  async taskBrief(a){
    this.requireTask(a);const before=this.briefValue();if(a.patch===undefined)return {taskId:this.workspace.task.id,brief:before};
    if(!a.patch||typeof a.patch!=='object'||Array.isArray(a.patch)||Object.keys(a.patch).some(k=>!['objective','constraints','decisions'].includes(k)))throw Error('任务要点字段无效');
    if(a.expectedRevision!==before.revision)throw Error('任务要点已更新，请重新读取');
    const next={...before};
    if('objective'in a.patch){if(typeof a.patch.objective!=='string'||a.patch.objective.length>2000)throw Error('任务目标过长');next.objective=a.patch.objective;}
    for(const key of ['constraints','decisions'])if(key in a.patch){const rows=a.patch[key];if(!Array.isArray(rows)||rows.length>20||rows.some(s=>typeof s!=='string'||!s.trim()||s.length>500))throw Error(key+' 必须是最多 20 条非空短文本');next[key]=[...rows];}
    if(JSON.stringify(next).length>12000)throw Error('任务要点总长度过大');
    next.revision++;next.updated=new Date().toISOString();const task=this.workspace.task,prior=task.externalBrief;task.externalBrief=next;
    try{await this.workspace.persist();}catch(e){task.externalBrief=prior;throw e;}
    this.workspace.notify('task-brief-changed',{taskId:task.id,brief:next});return {taskId:task.id,brief:next};
  }
  complete({requestId,result,error}){
    if(this.pending?.id!==requestId)return false;const p=this.pending;this.pending=null;clearTimeout(p.timer);
    if(error)p.reject(Error(String(error).slice(0,2000)));else p.resolve(result);return true;
  }
  status(){const w=this.workspace,t=w.task,j=this.runningJob;return {application:'EmbedMerge',version:this.version,protocol:2,connected:true,ready:this.ready(),busy:this.active||!!j||this.occupied()||w.locked,
    task:t?{id:t.id,name:t.name,roots:t.roots,mode:t.mode,files:(w.locked||(this.pending&&['compare','resume'].includes(this.pending.action)))?null:(w.inventory?.filter(n=>n.kind==='file').length||0),brief:this.briefValue(),reviewRequest:t.reviewRequest?{sessionId:t.reviewRequest.sessionId,status:t.reviewRequest.status,runner:t.reviewRequest.runner||null}:null}:null,progress:this.active?this.progress:null,operation:j?{jobId:j.id,operation:j.operation,status:j.status,cancelRequested:j.cancelRequested,progress:j.progress}:null,lastAcknowledgedView:this.view||null};}
  requireTask(a){if(!this.workspace.task||this.workspace.task.id!==text(a.taskId,'taskId',100))throw Error('任务已切换，请重新读取 status');}
  async request(action,args){
    const id=randomUUID();return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{if(this.pending?.id===id)this.pending=null;reject(Error('界面未完成响应；请检查窗口和 status 后再试'));},action==='review'?Math.max(this.timeout,650000):this.timeout);
      this.pending={id,action,resolve,reject,timer};this.notify('external-control',{requestId:id,action,args});
    });
  }
  async call(action,a={},owner=null){
    if(!a||typeof a!=='object'||Array.isArray(a))throw Error('参数必须是对象');
    if(action==='status')return this.status();
    if(action==='firmware'){
      this.requireTask(a);if(!this.firmware)throw Error('固件服务尚未配置');
      if(!['status','job','cancel'].includes(a.operation))this.ensureAvailable(false);
      return this.firmware.command(a);
    }
    if(action==='review'&&a.command==='cancel'){
      this.requireTask(a);if(this.active||this.pending)throw Error('窗口正在处理另一个控制请求，请稍后取消');this.active=true;this.operation='review';try{return await this.request('review',{...a,command:'cancel'});}finally{this.active=false;this.operation=null;}
    }
    if(action==='start')return this.startJob(a);
    if(action==='job')return this.jobView(this.jobs.get(text(a.jobId,'jobId',100)));
    if(action==='cancel')return this.cancelJob(a);
    if(!['compare','review-project','resume','context','brief','differences','configuration','diff','open','folder','review','chat'].includes(action))throw Error('不支持的外部操作');
    const w=this.workspace;
    this.ensureAvailable(['context','brief','chat'].includes(action)||(action==='review'&&['findings','targets'].includes(a.command)),owner);
    this.active=true;this.operation=action;this.progress=null;
    try{
      if(action==='context'){
        if(a.taskId!==undefined)this.requireTask(a);
        const result=await this.request('context',{});
        if((result.taskId||null)!==(w.task?.id||null))throw Error('读取期间任务已变化，请重新读取上下文');
        return {...result,brief:this.briefValue(),capturedAt:new Date().toISOString(),note:'当前窗口选区和草稿是待分析数据，不代表已保存或验证。'};
      }
      if(action==='brief')return await this.taskBrief(a);
      if(action==='review-project'){
        if(a.createCopy!==undefined&&typeof a.createCopy!=='boolean')throw Error('createCopy 必须为布尔值');const args={root:text(a.root,'root'),createCopy:a.createCopy===true};if(a.target!==undefined)args.target=text(a.target,'target');
        const result=await this.request('review-project',args);this.view=result;
        return {...this.status(),busy:false,operation:null,view:result};
      }
      if(action==='resume'){
        const id=text(a.taskId,'taskId',100),result=await this.request('resume',{id,autoMatlab:false});
        this.view=result;return {...this.status(),busy:false,operation:null,view:result,csplus:result.csplus,counts:result.counts};
      }
      if(action==='compare'){
        const paths={ref:text(a.ref,'ref'),test:text(a.test,'test')},name=a.name===undefined?'Codex 发起的工程比较':text(a.name,'name',200);
        if(a.forBuild!==undefined&&typeof a.forBuild!=='boolean')throw Error('forBuild 必须是布尔值');
        // Keep the complete native tree/config/code workflow; never replace it with a filtered prototype.
        const result=await this.request('compare',{paths,name,options:{createCopy:true,autoMatlab:false,...(a.forBuild?{fileFilters:{artifacts:false}}:{}),...(a.scopePaths?{scopePaths:a.scopePaths}:{})}});
        this.view=result;return {...this.status(),busy:false,operation:null,view:result,csplus:result.csplus,counts:result.counts};
      }
      this.requireTask(a);
      if(action==='chat'){if(!this.sharedChat)throw Error('共享聊天模块不可用');return await this.sharedChat(a);}
      if(action==='review'){
        const command=text(a.command||'findings','command',30);if(!['prepare','run','start','evidence','submit','complete','cancel','findings','open','targets'].includes(command))throw Error('审核指令不支持该操作');
        const args={...a,command};const result=await this.request('review',args);return {taskId:w.task.id,...result};
      }
      if(action==='differences'){
        const offset=page(a,'offset',0,100000),limit=page(a,'limit',50,100),contains=typeof a.pathContains==='string'?a.pathContains.toLowerCase():'';
        const rows=(w.inventory||[]).filter(n=>n.kind==='file'&&n.status!=='same'&&n.rel.toLowerCase().includes(contains));
        return {taskId:w.task.id,total:rows.length,files:rows.slice(offset,offset+limit),nextOffset:offset+limit<rows.length?offset+limit:null};
      }
      if(action==='configuration'){
        const ref=a.ref===null?null:text(a.ref,'ref'),test=a.test===null?null:text(a.test,'test');
        return {taskId:w.task.id,ref,test,...await w.csplusCompare({ref,test})};
      }
      if(action==='diff'){
        const rel=text(a.path,'path'),offset=page(a,'offset',0,100000),limit=page(a,'limit',30,100),p=await w.pair(rel);
        const A=p.ref.text.split('\n'),B=p.test.text.split('\n'),rows=p.hunks.slice(offset,offset+limit).map(h=>({...h,refLine:h.a0+1,testLine:h.b0+1,reference:A.slice(h.a0,h.a1).join('\n'),target:B.slice(h.b0,h.b1).join('\n')}));
        if(Buffer.byteLength(JSON.stringify(rows))>400000)throw Error('差异内容过大，请减小 limit 或在窗口查看');
        return {taskId:w.task.id,path:rel,total:p.hunks.length,hunks:rows,nextOffset:offset+limit<p.hunks.length?offset+limit:null};
      }
      if(action==='open'){
        const args={taskId:w.task.id,path:text(a.path,'path'),raw:a.raw===true};
        if(!w.inventory?.some(n=>n.kind==='file'&&n.rel===args.path))throw Error('文件不在当前任务');
        if(a.hunkId){const p=await w.pair(args.path),h=p.hunks.find(h=>h.id===a.hunkId);if(!h)throw Error('差异已变化，请重新读取 diff');Object.assign(args,{raw:true,hunkId:h.id,a0:h.a0,b0:h.b0});}
        for(const key of ['ref','test','moduleId','fieldKey'])if(a[key]!==undefined)args[key]=text(a[key],key);
        if(a.versions!==undefined){if(!Array.isArray(a.versions)||a.versions.length!==2||a.versions.some(v=>v!==null&&typeof v!=='string'))throw Error('versions 无效');args.versions=a.versions;}
        const result=await this.request('open',args);this.view=result;return {opened:true,...result};
      }
      const result=await this.request('folder',{});this.view=result;return {opened:true,...result};
    }finally{this.active=false;this.operation=null;}
  }
  async start(){
    this.server=http.createServer((req,res)=>this.handle(req,res).catch(e=>{if(!res.headersSent)res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}));
    this.server.requestTimeout=15000;this.server.headersTimeout=10000;
    await new Promise((resolve,reject)=>{this.server.once('error',reject);this.server.listen(0,'127.0.0.1',resolve);});
    this.url=`http://127.0.0.1:${this.server.address().port}`;await fs.mkdir(this.workspace.dataRoot,{recursive:true});
    await fs.writeFile(this.descriptor,JSON.stringify({application:'EmbedMerge',version:1,url:this.url,token:this.token,pid:process.pid}),{mode:0o600});
  }
  async handle(req,res){
    const expected=Buffer.from('Bearer '+this.token),actual=Buffer.from(req.headers.authorization||'');
    if(req.headers.origin||req.headers.host!==new URL(this.url).host||actual.length!==expected.length||!timingSafeEqual(expected,actual)){res.writeHead(403);res.end();return;}
    if(req.method!=='POST'||req.url!=='/call'){res.writeHead(404);res.end();return;}
    const parts=[];let size=0;for await(const p of req){size+=p.length;if(size>256000){res.writeHead(413);res.end();return;}parts.push(p);}
    const {action,args}=JSON.parse(Buffer.concat(parts).toString('utf8')),value=await this.call(action,args);
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value));
  }
  async close(){
    const job=this.runningJob;if(job){job.cancelRequested=true;this.workspace.cancelled=true;if(job.status==='queued'){job.status='cancelled';job.finished=new Date().toISOString();}}
    if(this.pending)this.complete({requestId:this.pending.id,error:'EmbedMerge 已关闭，外部任务已取消'});
    if(this.server){this.server.closeAllConnections();await new Promise(resolve=>this.server.close(resolve));}
    try{const d=JSON.parse(await fs.readFile(this.descriptor,'utf8'));if(d.token===this.token)await fs.unlink(this.descriptor);}catch{}
  }
}
