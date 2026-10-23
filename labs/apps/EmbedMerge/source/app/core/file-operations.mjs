import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from './text.mjs';
import {guarded,replaceVerified} from './workspace.mjs';
import {excludedReason} from './file-filters.mjs';

const sides=['ref','test'],limit=128*1024*1024;
const same=(a,b)=>a.kind===b.kind&&a.version===b.version;
const empty=()=>({kind:'missing',version:null});
const depth=r=>r.split('/').length;
async function state(w,side,rel,withBytes=false){
  const p=await w.operationPath(side,rel);let stat;
  try{stat=await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return empty();throw e;}
  if(stat.isSymbolicLink())throw Error('拒绝操作符号链接或目录联接');
  if(stat.isDirectory())return {kind:'dir',version:null};
  if(!stat.isFile()||stat.size>limit)throw Error('仅支持普通文件，单文件不能超过 128 MiB');
  const bytes=await fs.readFile(p);return {kind:'file',version:hash(bytes),size:bytes.length,...(withBytes?{bytes}:{})};
}
async function snapshot(w,id,side,rel,value,phase){
  if(value.kind!=='file')return value;
  const p=phase==='before'?path.join(w.taskRoot,'backups',side,rel,new Date().toISOString().replace(/[:.]/g,'-')+'-'+id+'.bak'):path.join(w.taskRoot,'history',id,'after',side,rel);
  await fs.mkdir(path.dirname(p),{recursive:true});await fs.writeFile(p,value.bytes,{flag:'wx'});
  if(hash(await fs.readFile(p))!==value.version)throw Error('操作备份验证失败，未修改文件');
  return {kind:'file',version:value.version,size:value.size,snapshot:path.relative(w.taskRoot,p).replaceAll('\\','/')};
}
async function snapshotBytes(w,value){
  const p=await guarded(w.taskRoot,value.snapshot),bytes=await fs.readFile(p);
  if(hash(bytes)!==value.version)throw Error('历史备份校验失败，未修改文件');return bytes;
}
function checkDrafts(w,changes){
  for(const c of changes){const b=w.buffers.get(c.side+':'+c.rel);if(b?.dirty)throw Error(c.side+'/'+c.rel+' 有未保存草稿，请先保存或重新加载');}
}
async function validate(w,changes,from,to){
  for(const c of changes){if(!same(await state(w,c.side,c.rel),c[from]))throw Error('外部变化冲突，未覆盖：'+c.side+'/'+c.rel);if(c[to].kind==='file')await snapshotBytes(w,c[to]);}
  // Refuse to remove a directory containing new files that are absent from this transaction.
  const known=new Set(changes.map(c=>c.side+':'+c.rel));
  for(const c of changes.filter(c=>c[from].kind==='dir'&&c[to].kind==='missing')){
    const children=await fs.readdir(await w.operationPath(c.side,c.rel));
    if(children.some(n=>!known.has(c.side+':'+c.rel+'/'+n)))throw Error('目录内有操作后新增的内容，不能撤回或删除：'+c.rel);
  }
}
async function applyOne(w,c,from,to){
  const p=await w.operationPath(c.side,c.rel);
  if(!same(await state(w,c.side,c.rel),c[from]))throw Error('写入期间外部变化冲突：'+c.rel);
  const target=c[to];
  if(target.kind==='missing'){
    if(c[from].kind==='file')await fs.unlink(p);else if(c[from].kind==='dir')await fs.rmdir(p);
    return 'removed';
  }
  if(target.kind==='dir'){await fs.mkdir(p,{recursive:false});return 'created-directory';}
  const bytes=await snapshotBytes(w,target),tmp=p+'.embedmerge-'+randomUUID()+'.tmp'+path.extname(p);
  try{await fs.writeFile(tmp,bytes,{flag:'wx'});if(hash(await fs.readFile(tmp))!==target.version)throw Error('临时文件验证失败');
    if(!same(await state(w,c.side,c.rel),c[from]))throw Error('写入期间外部变化冲突：'+c.rel);
    const mode=await replaceVerified(tmp,p,bytes,c[from].version);
    if(!same(await state(w,c.side,c.rel),target))throw Error('写后字节验证失败，请检查备份');return mode;
  }finally{await fs.rm(tmp,{force:true});}
}
function ordered(changes,to){return [...changes].sort((a,b)=>{
  const rank=c=>c[to].kind==='dir'?0:c[to].kind==='file'?1:2;
  return rank(a)-rank(b)||(rank(a)===2?depth(b.rel)-depth(a.rel):depth(a.rel)-depth(b.rel));
});}
async function applyAll(w,changes,from,to){
  await validate(w,changes,from,to);const applied=[];let mode;
  try{for(const c of ordered(changes,to)){applied.push(c);mode=await applyOne(w,c,from,to);}return mode;}
  catch(e){
    try{for(const c of applied.reverse()){const current=await state(w,c.side,c.rel);if(same(current,c[from]))continue;if(!same(current,c[to]))throw Error('文件状态无法安全回滚：'+c.rel);await applyOne(w,c,to,from);}w.task.pendingOperation=null;await w.persist();}
    catch(rollback){throw Error(e.message+'；部分操作待恢复，请点击撤回。恢复失败：'+rollback.message);}
    throw e;
  }
}

export const operationMethods={
  async operationPath(side,rel){
    if(!sides.includes(side))throw Error('侧必须是 ref/test');
    if(this.task.files){if(rel!==this.task.fileRel)throw Error('只允许访问本次选择的两个文件');if(this.task.mode==='direct-files')return guarded(path.dirname(this.task.files[side]),path.basename(this.task.files[side]));}
    return guarded(this.root(side),rel);
  },
  async operationState(side,rel,withBytes=false){return state(this,side,rel,withBytes);},
  historyInfo(){
    const h=this.task.operationHistory||[],cursor=this.task.operationCursor??h.length;
    return {canUndo:!!this.task.pendingOperation||cursor>0,canRedo:!this.task.pendingOperation&&cursor<h.length,undoLabel:this.task.pendingOperation?'恢复未完成操作':h[cursor-1]?.label,redoLabel:h[cursor]?.label,pending:!!this.task.pendingOperation};
  },
  invalidateOperations(changes){for(const c of changes){this.buffers.delete(c.side+':'+c.rel);delete this.task.modelResults[c.rel];this.task.copyErrors=this.task.copyErrors.filter(e=>e.side!==c.side||e.rel!==c.rel);}},
  async parentChanges(side,rel){
    if(this.task.files)return [];
    const parts=rel.split('/'),result=[];
    for(let i=1;i<parts.length;i++){const r=parts.slice(0,i).join('/'),s=await state(this,side,r);if(s.kind==='file')throw Error('目标父路径是文件：'+r);if(s.kind==='missing')result.push({side,rel:r,before:s,after:{kind:'dir',version:null}});}
    return result;
  },
  async commitOperation(label,changes){
    if(this.task.pendingOperation)throw Error('请先撤回恢复未完成的文件操作');
    const id=randomUUID(),prepared=[];
    for(const c of changes){
      const before=await state(this,c.side,c.rel,true);if(!same(before,c.before))throw Error('备份前外部变化冲突：'+c.rel);
      let after=c.after;
      if(after.kind==='file'&&c.source){after=await state(this,c.source,c.rel,true);if(after.version!==c.after.version)throw Error('来源发生变化，未复制：'+c.rel);}
      else if(after.kind==='file'&&!after.bytes)after={...after,bytes:await snapshotBytes(this,after)};
      prepared.push({side:c.side,rel:c.rel,before:await snapshot(this,id,c.side,c.rel,before,'before'),after:await snapshot(this,id,c.side,c.rel,after,'after')});
    }
    const record={id,label,created:new Date().toISOString(),changes:prepared};
    for(const c of changes)if(c.source&&(await state(this,c.source,c.rel)).version!==c.after.version)throw Error('备份期间来源发生变化，未复制：'+c.rel);
    this.task.pendingOperation={record,direction:'forward'};await this.persist();
    let writeMode;
    try{writeMode=await applyAll(this,prepared,'before','after');}
    catch(e){if(this.task.pendingOperation&&!e.message.includes('部分操作')){this.task.pendingOperation=null;await this.persist();}throw e;}
    const h=this.task.operationHistory||[],cursor=this.task.operationCursor??h.length;
    this.task.operationHistory=[...h.slice(0,cursor),record].slice(-50);this.task.operationCursor=this.task.operationHistory.length;this.task.pendingOperation=null;await this.persist();
    return {record,writeMode};
  },
  async operationPlan({action,rel,source,side}){
    if(!['copy','delete'].includes(action)||!sides.includes(action==='copy'?source:side))throw Error('无效文件操作');
    const owner=action==='copy'?source:side,target=action==='copy'?(source==='ref'?'test':'ref'):side,entries=[];
    const walk=async r=>{
      const s=await state(this,owner,r);if(s.kind==='missing')throw Error('来源已不存在：'+r);
      if(entries.length>=20000)throw Error('操作超过 20000 项，请缩小范围');entries.push({rel:r,state:s});
      if(s.kind==='dir')for(const name of (await fs.readdir(await this.operationPath(owner,r))).sort()){
        if(action==='copy'&&['.git','.svn','node_modules','.npm-cache'].includes(name))continue;
        const child=r+'/'+name,childState=await state(this,owner,child);
        if(action==='copy'&&excludedReason(child,childState.kind==='dir',this.task.fileFilters))continue;
        await walk(child);
      }
    };
    if(action==='copy'&&excludedReason(rel,false,this.task.fileFilters))throw Error('该文件已过滤，不参与复制');
    await walk(rel);const changes=action==='copy'?await this.parentChanges(target,rel):[],signature=[];
    for(const entry of entries){
      const before=await state(this,target,entry.rel),after=action==='copy'?entry.state:empty();
      if(action==='copy'&&before.kind!=='missing'&&before.kind!==after.kind)throw Error('文件与文件夹类型冲突，请先删除目标：'+entry.rel);
      checkDrafts(this,[{side:owner,rel:entry.rel},{side:target,rel:entry.rel}]);
      for(const s of new Set([owner,target])){const b=this.buffers.get(s+':'+entry.rel);if(b&&b.baseHash!==(await state(this,s,entry.rel)).version)throw Error('存在外部变化，请先重新加载：'+entry.rel);}
      signature.push({rel:entry.rel,source:entry.state,target:before});
      if(!same(before,after))changes.push({side:target,rel:entry.rel,before,after,source:action==='copy'?source:undefined});
    }
    return {action,rel,source,side:target,kind:entries[0].state.kind,count:entries.filter(e=>e.state.kind==='file').length,changes,fingerprint:hash(JSON.stringify({signature,changes})),label:(action==='copy'?'复制到 ':'删除 ')+target+' / '+rel};
  },
  async operationInfo(args){const plan=await this.operationPlan(args);return {...args,side:plan.side,kind:plan.kind,count:plan.count,changeCount:plan.changes.length,fingerprint:plan.fingerprint,label:plan.label};},
  async operateFiles(args){return this.exclusive(async()=>{
    const plan=await this.operationPlan(args);if(plan.fingerprint!==args.fingerprint)throw Error('文件在确认后发生变化，未操作，请重新比较');
    if(!plan.changes.length)return {status:'identical',label:plan.label};
    const result=await this.commitOperation(plan.label,plan.changes);this.invalidateOperations(plan.changes);await this.persist();
    return {status:'applied',label:plan.label,backup:result.record.changes.find(c=>c.before.snapshot)?.before.snapshot};
  });},
  async undoFileOperation(redo=false){return this.exclusive(async()=>{
    const h=this.task.operationHistory||[],cursor=this.task.operationCursor??h.length,pending=this.task.pendingOperation;
    if(pending){
      if(redo)throw Error('请先撤回恢复未完成操作');
      const desired=pending.direction==='undo'?'after':'before',other=desired==='after'?'before':'after',repairs=[];
      checkDrafts(this,pending.record.changes);
      for(const c of pending.record.changes){const current=await state(this,c.side,c.rel);if(same(current,c[desired]))continue;if(!same(current,c[other]))throw Error('中断后文件被外部修改，未恢复：'+c.rel);repairs.push({...c,before:current,after:c[desired]});}
      await applyAll(this,repairs,'before','after');this.invalidateOperations(pending.record.changes);this.task.pendingOperation=null;await this.persist();return {label:'已恢复未完成操作'};
    }
    const record=redo?h[cursor]:h[cursor-1];if(!record)throw Error(redo?'没有可重做操作':'没有可撤回操作');
    checkDrafts(this,record.changes);this.task.pendingOperation={record,direction:redo?'redo':'undo'};await this.persist();
    try{await applyAll(this,record.changes,redo?'before':'after',redo?'after':'before');}
    catch(e){if(this.task.pendingOperation&&!e.message.includes('部分操作')){this.task.pendingOperation=null;await this.persist();}throw e;}
    this.task.operationCursor=cursor+(redo?1:-1);this.task.pendingOperation=null;this.invalidateOperations(record.changes);await this.persist();return {label:(redo?'已重做：':'已撤回：')+record.label};
  });}
};
