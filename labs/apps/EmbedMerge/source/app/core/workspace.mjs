import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {decode,encode,hash,classify,hunks,mergeHunk} from './text.mjs';
import {isMatlabFile,isMatlabCache,summarizeMatlab} from './matlab-status.mjs';
import {normalizeFileFilters,excludedReason} from './file-filters.mjs';
import {isCsplusFile,parseCsplus,compareCsplus,discoverCsplusPairs} from './csplus.mjs';
import {isStructuredFile,modelEvidence} from './question-context.mjs';
import {operationMethods} from './file-operations.mjs';

const MAX_TEXT=4*1024*1024, MAX_FILES=20000;
const skip=new Set(['.git','.svn','node_modules','.npm-cache']);
const models=/\.(slx|mdl|mat|sldd)$/i;
export const inside=(root,target)=>{const r=path.relative(root,target);return !path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep);};
export async function guarded(root,rel) {
  if(typeof rel!=='string'||!rel||rel.includes('\0')||path.isAbsolute(rel)||rel.split(/[\\/]/).some(x=>!x||x==='.'||x==='..'||x.includes(':')))throw Error('无效的任务内相对路径');
  const rootStat=await fs.lstat(root);if(rootStat.isSymbolicLink())throw Error('工作副本根不能为符号链接或目录联接');
  const base=await fs.realpath(root),target=path.resolve(base,rel);
  const canonical=p=>path.normalize(p).replace(/^\\\\\?\\/,'').toLowerCase();if(canonical(base)!==canonical(path.resolve(root)))throw Error('路径祖先含目录联接，拒绝写入/读取此工作目录');
  if(!inside(base,target))throw Error('路径超出工作副本');
  let cursor=base;
  for(const part of rel.split(/[\\/]/)){cursor=path.join(cursor,part);try{const s=await fs.lstat(cursor);if(s.isSymbolicLink())throw Error('拒绝访问符号链接或目录联接');}catch(e){if(e.code!=='ENOENT')throw e;}}
  return target;
}
async function exists(p){try{return await fs.readFile(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
// Some company filesystem filters return EXDEV even within the same directory.
// Keep a verified recovery copy before falling back to an in-place native write.
export async function replaceVerified(tmp,file,bytes,expected){
  try{await fs.rename(tmp,file);return 'atomic-rename';}catch(e){if(e.code!=='EXDEV')throw e;}
  const prior=await exists(file);
  if(expected!==undefined&&(prior===null?null:hash(prior))!==expected)throw Error('保存前版本冲突');
  if(prior!==null){const recovery=file+'.recovery';await fs.writeFile(recovery,prior);if(hash(await fs.readFile(recovery))!==hash(prior))throw Error('恢复副本校验失败');}
  const handle=await fs.open(file,'w');try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  if(hash(await fs.readFile(file))!==hash(bytes))throw Error('直接写入核验失败，请使用备份恢复');
  await fs.rm(tmp,{force:true});return 'verified-in-place';
}
async function atomicJSON(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.'+randomUUID()+'.tmp.json',bytes=Buffer.from(JSON.stringify(value,null,2),'utf8');await fs.writeFile(tmp,bytes);await replaceVerified(tmp,file,bytes);}

export class Workspace {
  constructor(dataRoot,notify=()=>{}){this.dataRoot=dataRoot;this.notify=notify;this.buffers=new Map();this.cancelled=false;this.locked=false;}
  async exclusive(fn){if(this.locked)throw Error('另一个文件操作进行中，请稍后重试');this.locked=true;try{return await fn();}finally{this.locked=false;}}
  progress(stage,detail,current=0,total=0){this.notify('progress',{stage,detail,current,total});if(this.cancelled)throw Error('操作已停止');}
  async tasks(){await fs.mkdir(path.join(this.dataRoot,'tasks'),{recursive:true});const list=[];for(const id of await fs.readdir(path.join(this.dataRoot,'tasks'))){try{const t=JSON.parse(await fs.readFile(path.join(this.dataRoot,'tasks',id,'task.json'),'utf8'));list.push({id:t.id,name:t.name,created:t.created,roots:t.roots,mode:t.mode,files:t.files});}catch{}}return list.sort((a,b)=>b.created.localeCompare(a.created));}
  async createComparison(paths,name='合并比较',options={}){
    const a=await fs.lstat(paths.ref),b=await fs.lstat(paths.test);
    if(a.isSymbolicLink()||b.isSymbolicLink())throw Error('不能选择符号链接或目录联接');
    if(a.isFile()&&b.isFile())return this.createFiles(paths,name,options);
    if(a.isDirectory()&&b.isDirectory())return this.create(paths,name,{...options,createCopy:options.createCopy===true});
    throw Error('两侧需要同为文件或同为文件夹');
  }
  async directPath(side,rel){
    if(!['ref','test'].includes(side)||rel!==this.task.fileRel)throw Error('只允许访问本次选择的两个文件');
    const selected=this.task.files?.[side];if(typeof selected!=='string'||!path.isAbsolute(selected))throw Error('文件任务路径无效');
    const p=await guarded(path.dirname(selected),path.basename(selected));
    try{const stat=await fs.lstat(p);if(!stat.isFile())throw Error('所选路径不是普通文件');if(stat.size>128*1024*1024)throw Error('超过单文件 128 MiB 上限');}catch(e){if(e.code!=='ENOENT')throw e;}
    return p;
  }
  async createFiles(files,name='文件比较',options={}){
    return this.exclusive(async()=>{
      const selected={};
      for(const side of ['ref','test']){
        if(typeof files?.[side]!=='string'||!path.isAbsolute(files[side]))throw Error('请选择两个完整文件路径');
        const p=path.resolve(files[side]);await guarded(path.dirname(p),path.basename(p));
        const s=await fs.lstat(p);if(!s.isFile())throw Error('请选择普通文件');
        if(inside(this.dataRoot,p))throw Error('不能直接编辑应用任务数据中的文件');
        selected[side]=p;
      }
      const a=await fs.stat(selected.ref),b=await fs.stat(selected.test);
      if(selected.ref.toLowerCase()===selected.test.toLowerCase()||a.dev===b.dev&&a.ino===b.ino)throw Error('两侧不能选择同一个文件或其硬链接');
      if((isStructuredFile(selected.ref)||isStructuredFile(selected.test))&&path.extname(selected.ref).toLowerCase()!==path.extname(selected.test).toLowerCase())throw Error('模型和 MAT 需要选择相同类型的两个文件');
      const previous={task:this.task,taskRoot:this.taskRoot,buffers:this.buffers,inventory:this.inventory};
      this.cancelled=false;
      this.task={id:randomUUID(),name,mode:options.createCopy===true?'project-copy':'direct-files',files:selected,fileRel:path.basename(selected.ref),created:new Date().toISOString(),roots:Object.fromEntries(Object.entries(selected).map(([s,p])=>[s,path.dirname(p)])),fileFilters:normalizeFileFilters({documents:false,web:false,images:false,artifacts:false,caches:false}),autoMatlab:false,originals:{},copyErrors:[],records:{},chat:[],modelResults:{},drafts:{},validation:{compile:'未执行',simulation:'未执行'}};
      this.taskRoot=path.join(this.dataRoot,'tasks',this.task.id);this.buffers=new Map();
      try{
        for(const side of ['ref','test']){const bytes=await fs.readFile(selected[side]);if(!isStructuredFile(selected[side])){if(bytes.length>MAX_TEXT)throw Error('超过文本 4 MiB 上限');decode(bytes);}if(bytes.length>128*1024*1024)throw Error('超过单文件 128 MiB 上限');if(this.task.mode==='project-copy'){const work=this.root(side);await fs.mkdir(work,{recursive:true});const p=await guarded(work,this.task.fileRel);await fs.writeFile(p,bytes,{flag:'wx'});if(hash(await fs.readFile(p))!==hash(bytes))throw Error('副本验证失败');}}
        const result=await this.scan();await this.persist();return result;
      }catch(e){Object.assign(this,previous);throw e;}
    });
  }
  async create(roots,name='工程比较',options={}) {
    return this.exclusive(async()=>{
      this.cancelled=false;
      const direct=options.createCopy===false;
      if(direct)for(const p of Object.values(roots))await guarded(path.resolve(p),'__embedmerge_path_check__');
      const real={ref:await fs.realpath(roots.ref),test:await fs.realpath(roots.test)};
      if(direct&&(inside(real.ref,real.test)||inside(real.test,real.ref)))throw Error('直接修改模式中，两侧工程不能相同或互相包含');
      for(const root of Object.values(real)){if(!(await fs.stat(root)).isDirectory())throw Error('请选择目录');if(inside(root,this.dataRoot)||inside(this.dataRoot,root))throw Error('原始工程与应用任务数据目录不能包含彼此');}
      const previous=this.task;const previousBuffers=this.buffers;
      const scopePaths=options.scopePaths?.map(p=>String(p).replaceAll('\\','/'));if(scopePaths?.some(p=>!p||path.isAbsolute(p)||p.split('/').some(s=>!s||s==='.'||s==='..'||s.includes(':'))))throw Error('无效的样本范围');
      this.task={id:randomUUID(),name,mode:direct?'direct-project':'project-copy',created:new Date().toISOString(),roots:real,fileFilters:normalizeFileFilters(options.fileFilters),scopePaths,autoMatlab:options.autoMatlab!==false,originals:{},copyErrors:[],directories:[],records:{},chat:[],modelResults:{},drafts:{},validation:{compile:'未执行',simulation:'未执行'}};
      this.taskRoot=path.join(this.dataRoot,'tasks',this.task.id);this.buffers=new Map();
      try {
        if(!direct)await this.copyOriginals();
        await this.persist();return await this.scan();
      }catch(e){this.task=previous;this.buffers=previousBuffers;if(previous)this.taskRoot=path.join(this.dataRoot,'tasks',previous.id);throw e;}
    });
  }
  async copyOriginals(){
    let count=0;const filtered={total:0,reasons:{}};
    for(const side of ['ref','test']){const work=this.root(side);await fs.mkdir(work,{recursive:true});
      const walk=async(dir,parent='')=>{let entries;try{entries=await fs.readdir(dir,{withFileTypes:true});}catch(e){this.task.copyErrors.push({side,rel:parent||'(root)',error:e.message});return;}
        for(const ent of entries){if(skip.has(ent.name))continue;const rel=parent?parent+'/'+ent.name:ent.name;
          if(this.task.scopePaths&&!this.task.scopePaths.some(p=>p===rel||p.startsWith(rel+'/')))continue;
          const reason=excludedReason(rel,ent.isDirectory(),this.task.fileFilters);if(reason){filtered.total++;filtered.reasons[reason]=(filtered.reasons[reason]||0)+1;continue;}
          this.progress('创建/补齐工作副本',side+' / '+rel,++count);if(count>MAX_FILES)throw Error('超过 20000 个目录项上限，请缩小比较范围');
          try{const src=path.join(dir,ent.name),stat=await fs.lstat(src);if(stat.isSymbolicLink())throw Error('符号链接/目录联接已拒绝');const dst=await guarded(work,rel);
            if(ent.isDirectory()){await fs.mkdir(dst,{recursive:true});await walk(src,rel);}
            else if(ent.isFile()){try{await fs.access(dst);continue;}catch(e){if(e.code!=='ENOENT')throw e;}if(stat.size>128*1024*1024)throw Error('超过单文件 128 MiB 副本上限');const bytes=await fs.readFile(src),after=await fs.stat(src);if(stat.mtimeMs!==after.mtimeMs||stat.size!==after.size)throw Error('读取过程中原件发生变化');await fs.mkdir(path.dirname(dst),{recursive:true});await fs.writeFile(dst,bytes,{flag:'wx'});if(hash(await fs.readFile(dst))!==hash(bytes))throw Error('副本写后校验失败');this.task.originals[side+':'+rel]={hash:hash(bytes),size:bytes.length,mtime:stat.mtime.toISOString(),readAt:new Date().toISOString(),source:'native-fs'};this.task.copyErrors=this.task.copyErrors.filter(e=>e.side!==side||e.rel!==rel);}
          }catch(e){this.task.copyErrors.push({side,rel,error:e.message});}
        }};await walk(this.task.roots[side]);}
    this.task.filtered=filtered;
  }
  async setFileFilters(value){if(this.task?.mode==='direct-files')throw Error('文件直接比较不使用目录过滤');return this.exclusive(async()=>{const next=normalizeFileFilters(value);for(const b of this.buffers.values())if(b.dirty&&excludedReason(b.rel,false,next))throw Error('规则会隐藏未保存内容：'+b.side+'/'+b.rel+'；请先保存或处理草稿');const previous=this.task.fileFilters;this.task.fileFilters=next;try{if(this.task.mode!=='direct-project')await this.copyOriginals();await this.persist();return await this.scan();}catch(e){this.task.fileFilters=previous;throw e;}});}
  async resume(id){
    if(this.locked)throw Error('文件保存/创建操作进行中，请稍后切换任务');
    if(!/^[\da-f-]{36}$/.test(id))throw Error('无效任务');
    const previous={taskRoot:this.taskRoot,task:this.task,buffers:this.buffers,inventory:this.inventory};
    try{const root=path.join(this.dataRoot,'tasks',id),task=JSON.parse((await fs.readFile(path.join(root,'task.json'),'utf8')).replace(/^\uFEFF/,''));if(task.id!==id||!task.roots)throw Error('任务数据不完整');task.modelResults??={};task.records??={};task.copyErrors??=[];task.fileFilters=normalizeFileFilters(task.fileFilters);
      this.taskRoot=root;this.task=task;this.buffers=new Map(Object.entries(task.drafts||{}));return await this.scan();
    }catch(e){Object.assign(this,previous);throw e;}
  }
  root(side){if(!this.task||!['ref','test'].includes(side))throw Error('任务或侧无效');return this.task.mode==='direct-files'?path.dirname(this.task.files[side]):this.task.mode==='direct-project'?this.task.roots[side]:path.join(this.taskRoot,'work',side);}
  async persist(){if(!this.task)return;this.task.drafts=Object.fromEntries([...this.buffers].filter(([,b])=>b.dirty));const file=path.join(this.taskRoot,'task.json'),value=structuredClone(this.task);this.persistQueue=(this.persistQueue||Promise.resolve()).catch(()=>{}).then(()=>atomicJSON(file,value));return this.persistQueue;}
  async file(side,rel){const p=this.task?.mode==='direct-files'?await this.directPath(side,rel):await guarded(this.root(side),rel),bytes=await exists(p);return {p,bytes,version:bytes===null?null:hash(bytes)};}
  async scan(){
    if(!this.task)throw Error('尚未创建任务');const scanTask=this.task;this.cancelled=false;const entries=new Map(),scanFiltered={total:0,reasons:{}};
    const entry=rel=>{if(!entries.has(rel))entries.set(rel,{rel,kind:'file',ref:null,test:null,status:'pending'});return entries.get(rel);};
    for(const side of ['ref','test']){
      if(this.task.files){
        const n=entry(this.task.fileRel);n.names=Object.fromEntries(Object.entries(this.task.files).map(([s,p])=>[s,path.basename(p)]));
        try{const f=await this.file(side,this.task.fileRel);if(f.bytes!==null){const st=await fs.stat(f.p);n[side]={kind:'file',size:f.bytes.length,mtime:st.mtime.toISOString()};}}catch(e){n.status='error';n.error=side+': '+e.message;}
        continue;
      }
      const walk=async(dir,rel='')=>{
        let children;try{children=await fs.readdir(dir,{withFileTypes:true});}catch(e){const n=entry(rel||'(root)');n.status='error';n.error=e.message;return;}
        for(const d of children){const r=rel?rel+'/'+d.name:d.name;if(skip.has(d.name))continue;const reason=excludedReason(r,d.isDirectory(),this.task.fileFilters);if(reason){scanFiltered.total++;scanFiltered.reasons[reason]=(scanFiltered.reasons[reason]||0)+1;continue;}const n=entry(r);this.progress('读取与比较',r,entries.size);if(entries.size>MAX_FILES)throw Error('扫描超过 20000 项上限');
          try{const p=await guarded(this.root(side),r);const s=await fs.lstat(p);if(s.isSymbolicLink())throw Error('拒绝链接');if(d.isDirectory()){if(n[side==='ref'?'test':'ref']?.kind==='file')throw Error('一侧是目录，另一侧是文件');n.kind='dir';n[side]={kind:'dir'};await walk(p,r);}else if(d.isFile()){n[side]={kind:'file',size:s.size,mtime:s.mtime.toISOString()};if(n.kind==='dir')throw Error('一侧是目录，另一侧是文件');}}
          catch(e){n.status='error';n.error=e.message;}
        }
      };await walk(this.root(side));
    }
    for(const e of this.task.copyErrors){if(excludedReason(e.rel,false,this.task.fileFilters))continue;const n=entry(e.rel);n.status='error';n.error=`${e.side}: ${e.error}`;}
    for(const n of entries.values()){
      if(n.status==='error'||n.kind==='dir')continue;
      if(/\.m$/i.test(n.rel)){n.matlab=true;n.nativeScript=true;}
      try{
        if(isMatlabFile(n.rel)&&!/\.m$/i.test(n.rel)){
          n.matlab=true;n.generatedCache=isMatlabCache(n.rel);
          const versions=[];for(const side of ['ref','test']){const f=await this.file(side,n.rel);const b=this.buffers.get(side+':'+n.rel);versions.push(b?.dirty?'draft:'+hash(encode(b.text,b.meta)):f.version);if(n[side])n[side].size=f.bytes?.length||0;}
          n.versions=versions;n.signature=hash(JSON.stringify(versions));n.dirty=['ref','test'].some(s=>this.buffers.get(s+':'+n.rel)?.dirty);n.review=this.task.records[n.rel]?.state;n.reviewStale=!!n.review&&this.task.records[n.rel].signature!==n.signature;
          n.matlabResult=this.task.modelResults[n.rel]||null;
          if(!n.ref||!n.test){n.status=n.ref?'leftOnly':'rightOnly';n.note='MATLAB 文件单侧存在';continue;}
          Object.assign(n,summarizeMatlab(n.matlabResult,versions));if(n.generatedCache&&!n.matlabResult)n.note='已识别的 MATLAB 生成缓存；默认跳过后台比较，可右键单独检查';continue;
        }
        const pair={};for(const side of ['ref','test']){const f=await this.file(side,n.rel);if(f.bytes&&f.bytes.length>MAX_TEXT)throw Error('超过文本 4 MiB 上限，请缩小文件');const b=this.buffers.get(side+':'+n.rel);if(b&&b.baseHash!==f.version)n.externalChanged=true;if(f.bytes!==null){const d=decode(f.bytes);pair[side]=b?.dirty?b.text:d.text;n[side].diskSize=n[side].size;n[side].size=f.bytes.length;n[side].encoding=d.encoding;n[side].source=this.task.readSources?.[side+':'+n.rel]?.source||'native-fs';n[side].hash=b?.dirty?hash(encode(b.text,b.meta)):f.version;}else if(b?.dirty){pair[side]=b.text;n[side]={kind:'file',size:Buffer.byteLength(b.text),mtime:new Date().toISOString(),draftOnly:true};}}
        n.status=!n.ref?'rightOnly':!n.test?'leftOnly':classify(pair.ref,pair.test,n.rel);
        if(n.status==='same'&&n.ref?.hash!==n.test?.hash)n.status='minor';
        if(/\.m$/i.test(n.rel)){
          n.matlab=true;n.nativeScript=true;n.engine='EmbedMerge 脚本文本比较';
          n.note='由 EmbedMerge 读取并比较脚本文本；未执行脚本，未验证运行行为';
          n.versions=['ref','test'].map(side=>{const b=this.buffers.get(side+':'+n.rel);return b?.dirty?'draft:'+hash(encode(b.text,b.meta)):n[side]?.hash??null;});
          n.matlabResult={status:'compared',source:n.engine,versions:n.versions,classification:n.status,classificationNote:n.note,changes:[],compile:'not_run',simulation:'not_run'};
        }
        n.dirty=['ref','test'].some(s=>this.buffers.get(s+':'+n.rel)?.dirty);
        n.review=this.task.records[n.rel]?.state;
        const sig=hash(JSON.stringify([pair.ref??null,pair.test??null]));n.reviewStale=this.task.records[n.rel]?.signature!==sig;n.signature=sig;
      }catch(e){n.status='error';n.error=e.message;if(/受保护|未取得明文/.test(e.message)){n.failureKind='protected';n.statusLabel='受保护 · 未取得明文';}}
    }
    const priority={same:0,minor:1,model:2,pending:3,leftOnly:4,rightOnly:4,different:5,error:6};
    for(const n of [...entries.values()].filter(n=>n.kind==='dir').sort((a,b)=>b.rel.length-a.rel.length)){
      const children=[...entries.values()].filter(c=>c.rel.startsWith(n.rel+'/')&& !c.rel.slice(n.rel.length+1).includes('/'));
      n.counts={};for(const c of children){for(const[k,v]of Object.entries(c.counts||{[c.status]:1}))n.counts[k]=(n.counts[k]||0)+v;}
      if(n.status!=='error')n.status=children.reduce((s,c)=>(priority[c.status]>priority[s]?c.status:s),'same');
    }
    if(this.task!==scanTask)throw Error('任务已切换，旧扫描结果已丢弃');this.inventory=[...entries.values()].sort((a,b)=>a.rel.localeCompare(b.rel,'en'));
    const csplus=await this.csplusSnapshot();
    if(this.task!==scanTask)throw Error('任务已切换，旧扫描结果已丢弃');
    return {task:{id:this.task.id,name:this.task.name,mode:this.task.mode||'project-copy',files:this.task.files,fileRel:this.task.fileRel,history:this.historyInfo(),backupRoot:path.join(this.taskRoot,'backups'),roots:this.task.roots,created:this.task.created,work:{ref:this.root('ref'),test:this.root('test')},chat:this.task.chat,records:this.task.records,fileFilters:this.task.fileFilters,filtered:this.task.filtered||scanFiltered,scopePaths:this.task.scopePaths,validation:this.task.validation,autoMatlab:this.task.autoMatlab!==false,modelResults:this.task.modelResults},entries:this.inventory,csplus};
  }
  async csplusInput(side,rel){
    if(!rel)return null;
    if(!isCsplusFile(rel)||excludedReason(rel,false,this.task.fileFilters))throw Error('配置文件不在当前比较范围');
    const f=await this.file(side,rel);if(f.bytes===null)throw Error('配置文件不存在：'+side+'/'+rel);
    const b=this.buffers.get(side+':'+rel);
    if(b?.dirty&&b.baseHash!==f.version)throw Error('配置草稿与磁盘存在外部冲突，请先处理：'+rel);
    const text=b?.dirty?b.text:decode(f.bytes).text,key=rel+':'+hash(text);
    this.csplusParsed??=new Map();
    if(!this.csplusParsed.has(key)){if(this.csplusParsed.size>=64)this.csplusParsed.clear();this.csplusParsed.set(key,parseCsplus(text,rel));}
    return {parsed:this.csplusParsed.get(key),version:b?.dirty?'draft:'+hash(text):f.version,dirty:!!b?.dirty};
  }
  async csplusCompare({ref=null,test=null}={}){
    if(!this.task)throw Error('尚未创建任务');
    if(!ref&&!test)throw Error('请选择至少一侧配置文件');
    const task=this.task;
    const a=await this.csplusInput('ref',ref),b=await this.csplusInput('test',test);
    if(this.task!==task)throw Error('任务已切换');
    return {...compareCsplus(a?.parsed,b?.parsed),ref,test,versions:[a?.version||null,b?.version||null],drafts:[!!a?.dirty,!!b?.dirty]};
  }
  async csplusSnapshot(){
    const files={ref:[],test:[]};for(const n of this.inventory||[])if(n.kind==='file'&&isCsplusFile(n.rel))for(const s of ['ref','test'])if(n[s])files[s].push(n.rel);
    const result=discoverCsplusPairs(files,this.task.csplusPairs||[]);
    for(const p of result.pairs){try{const c=await this.csplusCompare(p);p.status=c.summary.changed?'changed':c.summary.equivalent?'equivalent':'same';p.summary=c.summary;p.devices=c.devices;p.versions=c.versions;}catch(e){p.status='error';p.error=e.message;}}
    return result;
  }
  async setCsplusPair({ref,test,remove=false}){return this.exclusive(async()=>{
    if(!this.task)throw Error('尚未创建任务');
    const old=this.task.csplusPairs||[];
    if(remove){this.task.csplusPairs=old.filter(p=>p.ref!==ref||p.test!==test);}
    else{
      if(!isCsplusFile(ref)||!isCsplusFile(test)||path.extname(ref).toLowerCase()!==path.extname(test).toLowerCase())throw Error('请选择相同类型的 .scfg 或 .mtpj');
      for(const [side,rel]of [['ref',ref],['test',test]]){if(excludedReason(rel,false,this.task.fileFilters)||!(await this.file(side,rel)).bytes)throw Error('文件不存在或已被过滤：'+rel);}
      this.task.csplusPairs=[...old.filter(p=>p.ref!==ref&&p.test!==test),{ref,test}];
    }
    try{await this.persist();return await this.scan();}catch(e){this.task.csplusPairs=old;throw e;}
  });}
  async open(side,rel){
    if(excludedReason(rel,false,this.task.fileFilters))throw Error('该文件已被比较范围过滤，请先调整常见文件过滤器');
    const key=side+':'+rel;if(this.buffers.has(key)){const b=this.buffers.get(key),f=await this.file(side,rel);return {...b,externalChanged:f.version!==b.baseHash};}
    if(models.test(rel))throw Error('模型与 MAT 请使用 MATLAB 独立比较');
    const f=await this.file(side,rel);if(f.bytes&&f.bytes.length>MAX_TEXT)throw Error('超过文本大小上限');
    let meta=f.bytes===null?null:decode(f.bytes);
    if(!meta){const other=await this.file(side==='ref'?'test':'ref',rel);meta=other.bytes?decode(other.bytes):{encoding:'utf8',bom:false,eol:'LF',mixed:false,rawText:''};}
    const text=f.bytes===null?'':meta.text;
    const readSource=this.task.readSources?.[key];
    const b={side,rel,text,baseText:text,baseHash:f.version,meta,baseMeta:{...meta},revision:0,dirty:false,missing:f.bytes===null,source:readSource?.source||'native-fs',cached:!!readSource,readAt:readSource?.readAt||new Date().toISOString()};
    this.buffers.set(key,b);return structuredClone(b);
  }
  async pair(rel){const ref=await this.open('ref',rel),test=await this.open('test',rel);return {ref,test,hunks:hunks(ref.text,test.text),records:this.task.records};}
  async fileCopyInfo(rel,source){
    if(!['ref','test'].includes(source))throw Error('复制来源必须是 ref/test');
    if(excludedReason(rel,false,this.task.fileFilters))throw Error('该文件已过滤，不参与复制');
    const target=source==='ref'?'test':'ref',a=await this.file(source,rel),b=await this.file(target,rel);
    if(a.bytes===null)throw Error('来源文件不存在');if(a.bytes.length>128*1024*1024)throw Error('文件超过 128 MiB 复制上限');
    for(const [side,f]of [[source,a],[target,b]]){const draft=this.buffers.get(side+':'+rel);if(draft?.dirty)throw Error(`${side}/${rel} 有未保存内容，请先保存或处理草稿，再复制整个文件`);if(draft&&draft.baseHash!==f.version)throw Error(`${side}/${rel} 存在外部变化，请先重新加载`);}
    return {rel,source,target,sourceVersion:a.version,targetVersion:b.version,sourceSize:a.bytes.length,targetSize:b.bytes?.length??null,identical:a.version===b.version};
  }
  async copyFile({rel,source,sourceVersion,targetVersion}){
    const info=await this.fileCopyInfo(rel,source);
    if(info.sourceVersion!==sourceVersion||info.targetVersion!==targetVersion)throw Error('文件在确认复制后发生变化，未覆盖；请重新比较');
    if(info.identical)return {...info,status:'identical'};
    const preview=await this.operationInfo({action:'copy',rel,source});const result=await this.operateFiles(preview);
    return {...info,...result,status:'copied',backup:result.backup?path.join(this.taskRoot,result.backup):null};
  }
  async update({side,rel,text,revision,eol},aiOwner=null,authorize=()=>true){
    if(this.locked)throw Error('保存/创建操作进行中，编辑仍在界面保留，请稍后保存');
    if(typeof text!=='string'||Buffer.byteLength(text)>MAX_TEXT)throw Error('缓冲区超过大小上限');
    const b=await this.open(side,rel);if(!authorize())throw Error('本轮已停止，未修改');if(b.revision!==revision)throw Error('缓冲区版本冲突，请重新加载');
    const next={...b,text,aiOwner,revision:b.revision+1};if(eol){if(!['LF','CRLF'].includes(eol))throw Error('无效换行');next.meta={...next.meta,mixed:false,eol};}
    next.dirty=text!==next.baseText || ['encoding','bom','eol','mixed'].some(k=>next.meta[k]!==(b.baseMeta||b.meta)[k]);
    if(next.missing&&text!=='')next.dirty=true;
    this.buffers.set(side+':'+rel,next);await this.persist();return next;
  }
  async save(side,rel){return this.exclusive(async()=>{
    const b=await this.open(side,rel),f=await this.file(side,rel);if(f.version!==b.baseHash)throw Error('外部变化冲突：磁盘版本已改变，未覆盖。请先备份/重新加载');
    if(!b.dirty)return b;
    const bytes=encode(b.text,b.meta),before=await this.operationState(side,rel,true);
    const changes=[...await this.parentChanges(side,rel),{side,rel,before,after:{kind:'file',version:hash(bytes),size:bytes.length,bytes}}];
    const {writeMode}=await this.commitOperation('保存 '+side+' / '+rel,changes);
    const meta=decode(bytes),next={...b,baseHash:hash(bytes),baseText:b.text,meta,baseMeta:{...meta},writeMode,dirty:false,missing:false,revision:b.revision+1,externalChanged:false,readAt:new Date().toISOString()};
    this.buffers.set(side+':'+rel,next);await this.persist();return next;
  });}

  async reload(side,rel){this.buffers.delete(side+':'+rel);const b=await this.open(side,rel);await this.persist();return b;}
  async backups(side,rel){const dir=await guarded(path.join(this.taskRoot,'backups',side),rel).catch(async e=>{if(e.code==='ENOENT')return '';throw e;});if(!dir)return [];try{return (await fs.readdir(dir)).filter(x=>x.endsWith('.bak')).sort().reverse();}catch(e){if(e.code==='ENOENT')return [];throw e;}}
  async restore(side,rel,name){
    if(!/^[\w.-]+\.bak$/.test(name))throw Error('无效备份名');
    const root=path.join(this.taskRoot,'backups',side),p=await guarded(root,rel+'/'+name);
    const d=decode(await fs.readFile(p)),b=await this.open(side,rel);
    const next=await this.update({side,rel,text:d.text,revision:b.revision});
    next.meta=d;next.dirty=next.text!==next.baseText||['encoding','bom','eol','mixed'].some(k=>d[k]!==(next.baseMeta||b.meta)[k]);
    this.buffers.set(side+':'+rel,next);await this.persist();return structuredClone(next);
  }
  async review({rel,hunkId,state,note=''}){if(!['pending','keep','ignore','done'].includes(state))throw Error('无效审阅状态');let signature;if(isMatlabFile(rel)&&!/\.m$/i.test(rel)){const versions=[];for(const side of ['ref','test']){const f=await this.file(side,rel),b=this.buffers.get(side+':'+rel);versions.push(b?.dirty?'draft:'+hash(encode(b.text,b.meta)):f.version);}signature=hash(JSON.stringify(versions));}else{const p=await this.pair(rel);signature=hash(JSON.stringify([p.ref.missing?null:p.ref.text,p.test.missing?null:p.test.text]));}const key=hunkId?rel+'#'+hunkId:rel;this.task.records[key]={state,note:String(note).slice(0,2000),signature,at:new Date().toISOString()};await this.persist();return this.task.records;}
  async evidence(args,budget){
    if(budget.cancelled)throw Error('本轮已停止');
    if(++budget.calls>budget.maxCalls)throw Error('文件工具调用预算已耗尽');
    const {action,side,rel,query}=args;if(!['ref','test'].includes(side))throw Error('侧必须是 ref/test');
    let result;
    if(action==='list'){result=this.inventory.filter(n=>n[side]).map(n=>({path:n.rel,kind:n.kind,status:n.status})).slice(0,1000);}
    else if(action==='read'&&isStructuredFile(rel)){const n=this.inventory.find(n=>n.rel===rel);if(!n?.[side])throw Error('此侧模型/数据不存在');result={side,path:rel,kind:'model-comparison',comparison:await modelEvidence(this,rel),note:'返回结构比较依据，不将模型/MAT 二进制作为文本解析；可继续查找关联生成代码'};}
    else if(action==='read'){const b=await this.open(side,rel);if(b.externalChanged)throw Error('磁盘内容已外部变更，请用户先重新加载，禁止使用过期依据');const start=Math.max(1,Number(args.start)||1),count=Math.min(300,Math.max(1,Number(args.count)||120));result={side,path:rel,version:hash(b.text),revision:b.revision,dirty:b.dirty,source:b.source,cached:true,start,lines:b.text.split('\n').slice(start-1,start-1+count).map((text,i)=>({line:start+i,text}))};}
    else if(action==='search'){
      if(typeof query!=='string'||!query||query.length>200)throw Error('请提供 1-200 字符的字面搜索词');result=[];
      const candidates=this.inventory.filter(n=>n.kind==='file'&&n[side]&&!models.test(n.rel)),skipped=[];let scanned=0;
      for(const n of candidates.slice(0,2000)){
        try{const b=await this.open(side,n.rel);if(b.externalChanged)throw Error('外部变化，禁止搜索过期缓冲区');scanned++;for(const [i,line]of b.text.split('\n').entries()){if(line.includes(query))result.push({side,path:n.rel,line:i+1,text:line.slice(0,1000),version:hash(b.text)});if(result.length>=60)break;}}catch(e){if(skipped.length<20)skipped.push({path:n.rel,error:e.message});}if(result.length>=60)break;
      }
      result={matches:result,skipped,scanned,partial:skipped.length>0||scanned<candidates.length};
    }else if(action==='replace'){
      if(!budget.write)throw Error('本轮只读，不允许修改');if(typeof args.before!=='string'||!args.before||typeof args.after!=='string')throw Error('修改必须提供非空精确 before 与 after');
      budget.writeId??=randomUUID();const b=await this.open(side,rel);if(b.externalChanged)throw Error('工作副本存在外部冲突，请用户先处理');if(b.dirty&&b.aiOwner!==budget.writeId)throw Error('目标有用户/之前轮次未保存内容，请用户先保存或处理');if(args.version!==hash(b.text))throw Error('修改依据版本已过期，请重新读取');if(b.text.split(args.before).length!==2)throw Error('before 必须唯一匹配');
      if(budget.chars+args.before.length+args.after.length+1000>budget.maxChars)throw Error('修改超过本轮剩余工具预算');
      if(budget.cancelled||!budget.write)throw Error('本轮已停止，未修改');const next=await this.update({side,rel,text:b.text.replace(args.before,args.after),revision:b.revision},budget.writeId,()=>!budget.cancelled&&budget.write);result={path:rel,side,revision:next.revision,version:hash(next.text),status:'已修改工作缓冲区，尚未保存',hunks:hunks(b.text,next.text)};this.notify('ai-change',result);
    }else throw Error('不支持的文件工具操作');
    const serialized=JSON.stringify(result);budget.chars+=serialized.length;if(budget.chars>budget.maxChars)throw Error('读取字符预算已耗尽');return result;
  }
}

Object.assign(Workspace.prototype,operationMethods);
