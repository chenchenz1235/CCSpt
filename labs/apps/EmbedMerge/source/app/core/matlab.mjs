import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {guarded,replaceVerified} from './workspace.mjs';
import {decode,encode,hash} from './text.mjs';
import iconv from 'iconv-lite';
import {isMatlabFile,isMatlabCache} from './matlab-status.mjs';
import {supplementModelResult} from './model-report.mjs';
import {MatlabViewerSession} from './matlab-viewer.mjs';
export const quoteM=s=>"'"+String(s).replaceAll("'","''")+"'";
const ENGINE_VERSION=4;
export class MatlabBackend {
  constructor(workspace,notify,appRoot,options={}){this.workspace=workspace;this.notify=notify;this.appRoot=appRoot;this.spawn=options.spawn||spawn;this.generation=0;}
  async executable(configured){if(configured){if(path.basename(configured).toLowerCase()!=='matlab.exe')throw Error('请选择 MATLAB 的 matlab.exe');await fs.access(configured);return configured;}for(const p of ['D:/App/matlab/R2024b/bin/matlab.exe','C:/Program Files/MATLAB/R2024b/bin/matlab.exe']){try{await fs.access(p);return p;}catch{}}throw Error('未找到 MATLAB R2024b，请填写 matlab.exe 路径');}
  async run(code,options={}){
    if(this.running)throw Error('MATLAB 正在运行另一个任务');if(!this.workspace.task)throw Error('请先打开任务');
    this.running=true;const generation=++this.generation;
    try{return await this.runJob(code,options,generation);}finally{this.running=false;}
  }
  async runJob(code,{exe,showUI=false,timeoutMs=300000,onPartial}={},generation){
    exe=await this.executable(exe);const job=path.join(this.workspace.taskRoot,'artifacts','matlab-'+randomUUID());await fs.mkdir(job,{recursive:true});
    const output=path.join(job,'result.json'),script=path.join(job,'job.m');
    const transcript=path.join(job,'matlab-output.log');let logQueue=Promise.resolve();const appendLog=text=>{logQueue=logQueue.then(()=>fs.appendFile(transcript,text,'utf8')).catch(()=>{});};
    const source=`try\naddpath(${quoteM(path.join(this.appRoot,'matlab'))});\nassert(strcmp(version('-release'),'2024b'),'This adapter requires MATLAB R2024b');\n${code}\nr.release=version('-release');r.compile='not_run';r.simulation='not_run';\ncatch err\nr=struct('status','failed','error',getReport(err,'extended','hyperlinks','off'));\nend\nfid=fopen(${quoteM(output)},'w','n','UTF-8');assert(fid>0);fprintf(fid,'%s',jsonencode(r));fclose(fid);\n`;
    await fs.writeFile(script,source,'utf8');
    const args=showUI?['-nosplash','-sd',job,'-r',`run(${quoteM(script)});`]:['-wait','-nosplash','-sd',job,'-batch',`run(${quoteM(script)});`];
    const prefdir=path.join(job,'prefs-R2024b');await fs.mkdir(prefdir,{recursive:true});
    if(generation!==this.generation)throw Error('MATLAB 启动已取消');
    const child=this.spawn(exe,args,{windowsHide:!showUI,env:{...process.env,MATLAB_PREFDIR:prefdir},stdio:['ignore','pipe','pipe']});this.child=child;
    let finished=false,timer,poll,partialTimer,childExited=false,partialQueue=Promise.resolve();const delivered=new Set();
    const partial=async()=>{if(!onPartial||finished)return;for(const name of await fs.readdir(job)){if(!/^item-\d+\.json$/.test(name)||delivered.has(name))continue;let value;try{value=JSON.parse((await fs.readFile(path.join(job,name),'utf8')).replace(/^\uFEFF/,''));}catch{continue;}if(finished)return;await onPartial(value,{evidence:path.join(job,name),job});delivered.add(name);}};
    const readPartials=()=>{partialQueue=partialQueue.then(partial);return partialQueue;};
    this.notify('matlab-state',{stage:showUI?'启动 MATLAB 官方比较':'启动 MATLAB 计算任务',current:0,total:0,active:true});
    const done=new Promise((resolve,reject)=>{
      const finish=(err,result)=>{if(finished)return;finished=true;clearTimeout(timer);clearInterval(poll);clearInterval(partialTimer);this.reject=null;this.kill=null;if(this.child===child)this.child=null;this.notify('matlab-finished',{error:err?.message});err?reject(err):resolve({...result,evidence:output,job});};
      const stdout=iconv.getDecoder(process.platform==='win32'?'gb18030':'utf8'),stderr=iconv.getDecoder(process.platform==='win32'?'gb18030':'utf8');
      let progressBuffer='';child.stdout.on('data',b=>{const text=stdout.write(b);appendLog(text);if(finished)return;this.notify('matlab-progress',text.slice(-4000));progressBuffer+=text;let e;while((e=progressBuffer.indexOf('\n'))>=0){const line=progressBuffer.slice(0,e);progressBuffer=progressBuffer.slice(e+1);const m=line.match(/EM_FILE (\d+)\/(\d+) (.*)/);if(m)this.notify('matlab-state',{stage:'正在比较 '+m[3],current:Number(m[1]),total:Number(m[2]),active:true});}});child.stderr.on('data',b=>{const text=stderr.write(b);appendLog(text);if(!finished)this.notify('matlab-progress',text.slice(-4000));});
      const readResult=async()=>{const text=await fs.readFile(output,'utf8');return JSON.parse(text.replace(/^\uFEFF/,''));};
      child.on('error',e=>finish(e));child.on('exit',async code=>{childExited=true;appendLog(`\nLauncher exit: ${code}; interactive=${showUI}\n`);if(finished)return;try{await readPartials();finish(null,await readResult());}catch(e){if(showUI&&code===0){this.notify('matlab-state',{stage:'MATLAB 启动器已返回，等待官方比较结果',current:0,total:1,active:true});return;}await logQueue;finish(Error(`MATLAB 退出码 ${code}；结果读取失败：${e.code||e.message}。日志 ${transcript}；任务 ${job}`));}});
      // Interactive MATLAB stays open after reporting; don't mistake spawn for success.
      if(showUI)poll=setInterval(async()=>{try{finish(null,await readResult());}catch{}},600);
      if(onPartial)partialTimer=setInterval(()=>readPartials().catch(e=>{const kill=this.kill;finish(e);kill?.();}),400);
      this.reject=()=>finish(Error('MATLAB 任务已停止；已完成结果保留，其余未用于判断'));
      this.kill=()=>{if(childExited)return;if(process.platform==='win32'&&child.pid)spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on('error',()=>child.kill());else child.kill();};
      timer=setTimeout(()=>{const kill=this.kill;finish(Error(`MATLAB 任务超过 ${Math.round(timeoutMs/1000)} 秒；已完成结果保留，其余未核实。日志 ${transcript}`));kill();},timeoutMs);
    });return done;
  }
  async versions(rel){const versions=[];for(const side of ['ref','test']){const b=this.workspace.buffers.get(side+':'+rel),f=await this.workspace.file(side,rel);if(b?.externalChanged||b&&f.version!==b.baseHash)throw Error(`${side}/${rel} 存在外部变化，请先重新加载`);versions.push(b?.dirty?'draft:'+hash(encode(b.text,b.meta)):f.version);}return versions;}
  async prepare(rel){const versions=await this.versions(rel),files=[];for(const side of ['ref','test']){const b=this.workspace.buffers.get(side+':'+rel),f=await this.workspace.file(side,rel);if(f.bytes===null)throw Error(`${side}/${rel} 文件缺失，不能进行双侧比较`);if(b?.dirty){if(!/\.m$/i.test(rel))throw Error('模型缓冲区状态异常');const dir=path.join(this.workspace.taskRoot,'artifacts','script-drafts',randomUUID(),side);await fs.mkdir(dir,{recursive:true});const target=path.join(dir,path.basename(rel));await fs.writeFile(target,encode(b.text,b.meta));files.push(target);}else files.push(f.p);}return {rel,files,versions};}
  cached(rel,versions){const r=this.workspace.task.modelResults[rel];return r&&!r.error&&r.status!=='failed'&&r.engineVersion===ENGINE_VERSION&&JSON.stringify(r.versions)===JSON.stringify(versions)?r:null;}
  source(rel){return /\.mat$/i.test(rel)?'自定义 MATLAB MAT/Bus 字段遍历':/\.m$/i.test(rel)?'MATLAB visdiff + 保守脚本分类':'MATLAB official slxmlcomp/visdiff';}
  async compare({rel,showUI=false,exe}){
    if(!/\.(m|mdl|slx|mat)$/i.test(rel))throw Error('此适配器支持 m/mdl/slx/mat；SLDD/MLX 后台结构暂待接入');
    if(this.running)throw Error('MATLAB 后台比较正在运行；可先停止，再打开单文件比较');this.running=true;const generation=++this.generation;
    try{const task=this.workspace.task,before=await this.versions(rel),cached=this.cached(rel,before);if(!showUI&&cached)return {...cached,cacheHit:true};const {files:[ref,test]}=await this.prepare(rel);if(generation!==this.generation)throw Error('MATLAB 比较启动已取消');
    const code=showUI?`visdiff(${quoteM(ref)},${quoteM(test)});r=struct('status','viewer_requested','note','Official visdiff request returned. MATLAB may show a no-differences message instead of a comparison tree; window presence is not verified.');`: /\.mat$/i.test(rel)?`r=em_compare_mat(${quoteM(ref)},${quoteM(test)});`:/\.m$/i.test(rel)?`r=em_compare_script(${quoteM(ref)},${quoteM(test)},pwd);`:`r=acw_compare(${quoteM(ref)},${quoteM(test)},false);`;
    let raw;if(showUI){this.viewer??=new MatlabViewerSession(this.notify);raw=await this.viewer.open({left:ref,right:test,helpers:path.join(this.appRoot,'matlab'),taskRoot:this.workspace.taskRoot,expectedExe:await this.executable(exe),isCancelled:()=>generation!==this.generation});}else raw=await this.runJob(code,{exe},generation);
    const result=await supplementModelResult(raw);if(this.workspace.task!==task)throw Error('任务已切换，旧 MATLAB 结果未应用');const after=await this.versions(rel);if(JSON.stringify(before)!==JSON.stringify(after))throw Error('MATLAB 比较期间工作副本发生变化，结果已过期');
    const evidence={...result,engineVersion:ENGINE_VERSION,versions:before,source:showUI?'MATLAB visdiff':this.source(rel),scope:rel,limitations:'0 个可见差异不代表功能等价；官方树路径不是画布路径。未执行编译或仿真。'};if(!showUI){this.workspace.task.modelResults[rel]=evidence;await this.workspace.persist();}return evidence;
    }finally{this.running=false;}
  }
  async compareAll(){
    if(this.running)throw Error('MATLAB 正在执行另一个任务');const w=this.workspace,task=w.task;if(!task)return;const generation=this.generation,candidates=(w.inventory||[]).filter(n=>n.kind==='file'&&n.matlab&&n.ref&&n.test&&isMatlabFile(n.rel)&&(!isMatlabCache(n.rel)||task.fileFilters?.caches===false));if(!candidates.length)return;
    const items=[];for(const n of candidates){if(generation!==this.generation)throw Error('MATLAB 比较准备已取消');if(/\.m$/i.test(n.rel))continue;const versions=await this.versions(n.rel);if(this.cached(n.rel,versions))continue;if(versions[0]===versions[1]){task.modelResults[n.rel]={status:'compared',changes:[],engineVersion:ENGINE_VERSION,versions,source:'本地文件字节核对',release:'2024b',compile:'not_run',simulation:'not_run'};continue;}items.push(await this.prepare(n.rel));}
    await w.persist();if(generation!==this.generation)throw Error('MATLAB 比较准备已取消');if(!items.length){this.notify('matlab-state',{stage:'MATLAB 版本缓存有效 / 文件字节一致',current:0,total:0,active:false});return [];}
    this.notify('matlab-state',{stage:'启动 MATLAB R2024b 批量比较',current:0,total:items.length,active:true});
    const commands=items.map((it,i)=>`fprintf('EM_FILE %d/%d %s\\n',${i+1},${items.length},${quoteM(it.rel)});\ntry\na=${quoteM(it.files[0])};b=${quoteM(it.files[1])};\n${/\.mat$/i.test(it.rel)?'v=em_compare_mat(a,b);':/\.m$/i.test(it.rel)?`v=em_compare_script(a,b,fullfile(pwd,'report-${i}'));`:/\.(mdl|slx)$/i.test(it.rel)?'v=acw_compare(a,b,false);':"v=struct('status','failed','error','后台结构接口尚未接入，请使用官方窗口');"}\ncatch err,v=struct('status','failed','error',getReport(err,'extended','hyperlinks','off'));end\nv.scope=${quoteM(it.rel)};v.release=version('-release');items{end+1}=v;\nfid=fopen(fullfile(pwd,'item-${i}.json'),'w','n','UTF-8');if fid>0,fprintf(fid,'%s',jsonencode(v));fclose(fid);end`).join('\n');
    const completed=new Set(),apply=async(result,metadata)=>{if(w.task!==task)throw Error('任务已切换，未应用旧 MATLAB 结果');const it=items.find(it=>it.rel===result.scope);if(!it||completed.has(it.rel))return;const now=await this.versions(it.rel);if(JSON.stringify(now)!==JSON.stringify(it.versions)){completed.add(it.rel);return;}const enriched=await supplementModelResult(result);task.modelResults[it.rel]={...enriched,engineVersion:ENGINE_VERSION,versions:it.versions,source:this.source(it.rel),evidence:metadata.evidence,release:result.release||'2024b',compile:'not_run',simulation:'not_run'};await w.persist();completed.add(it.rel);this.notify('matlab-file-result',{rel:it.rel,completed:completed.size,total:items.length});};
    const raw=await this.run(`items={};\n${commands}\nr=struct('status','compared','items',{items});`,{onPartial:apply,timeoutMs:Math.min(1800000,Math.max(300000,items.length*60000))});
    const results=Array.isArray(raw.items)?raw.items:raw.items?[raw.items]:[];for(const [i,it]of items.entries())await apply(results[i]||{scope:it.rel,status:'failed',error:raw.error||'MATLAB 未返回该文件结果'},{evidence:raw.evidence});
    this.notify('matlab-state',{stage:'MATLAB 独立比较完成',current:items.length,total:items.length,active:false});return results;
  }
  async read({side,rel,exe,authorized}){
    if(this.workspace.task?.mode?.startsWith('direct-'))throw Error('直接文件模式不支持 MATLAB 副本导入');
    if(!authorized)throw Error('需明确确认公司已授权 MATLAB 读取此文件');if(!/\.(c|h|cpp|hpp|m|txt|json|xml|mk|ini|cfg)$/i.test(rel))throw Error('原生读取仅用于支持的文本文件');
    const w=this.workspace,b= w.buffers.get(side+':'+rel);if(b?.dirty)throw Error('有未保存内容，请先处理');
    const original=await guarded(w.task.roots[side],rel),fingerprint=hash(await fs.readFile(original));const cacheDir=path.join(w.taskRoot,'cache','matlab-'+randomUUID());await fs.mkdir(cacheDir,{recursive:true});const cacheFile=path.join(cacheDir,'content.bin');
    const r=await this.run(`r=em_read_native(${quoteM(original)},${quoteM(cacheFile)});`,{exe});if(r.status!=='read')throw Error(r.error||'MATLAB 未取得授权文本');
    if(hash(await fs.readFile(original))!==fingerprint)throw Error('原件读取期间发生变化');const bytes=await fs.readFile(cacheFile);decode(bytes);const current=await w.file(side,rel);const tmp=current.p+'.authorized-'+randomUUID()+path.extname(rel);await fs.mkdir(path.dirname(current.p),{recursive:true});await fs.writeFile(tmp,bytes);await replaceVerified(tmp,current.p,bytes,current.version);
    w.task.readSources??={};w.task.readSources[side+':'+rel]={source:'matlab-native-authorized',readAt:new Date().toISOString(),originalFingerprint:fingerprint,cacheFile,cacheState:'verified',hash:hash(bytes)};w.task.copyErrors=w.task.copyErrors.filter(e=>!(e.side===side&&e.rel===rel));await w.reload(side,rel);await w.persist();return {status:'已授权读取并写入独立工作副本',...w.task.readSources[side+':'+rel]};
  }
  stop(){this.generation++;this.kill?.();this.reject?.();const viewing=this.viewer?.active;if(viewing)this.viewer.cancel();const stage=viewing?'已停止等待官方窗口；MATLAB 可能仍在完成请求，保持会话避免重复启动':'已请求停止 MATLAB 后台任务；已完成结果保留';this.notify('matlab-state',{stage,current:0,total:0,active:false});return {status:stage};}
  close(){this.stop();this.viewer?.close();}
}
