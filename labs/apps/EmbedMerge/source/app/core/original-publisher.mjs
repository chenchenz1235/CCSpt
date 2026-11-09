import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {guarded,replaceVerified} from './workspace.mjs';
import {hash,encode,decode,hunks} from './text.mjs';

export class OriginalPublisher {
 constructor(w){this.w=w;this.tokens=new Map();}
 async current(rel){const w=this.w;if(!w.task?.reviewProject||w.task.mode!=='project-copy')throw Error('仅适用于工程审核副本');
  if(!w.inventory.some(n=>n.rel===rel&&n.test&&n.kind==='file'))throw Error('文件不在当前工程');
  const b=await w.open('test',rel);if(b.externalChanged||b.missing)throw Error('工作副本有外部变化或缺失，请重新加载');
  const file=await guarded(w.task.roots.test,rel),s=await fs.lstat(file);if(!s.isFile()||s.nlink>1)throw Error('原文件必须是普通文件，拒绝硬链接');
  const original=await fs.readFile(file);if(original.length>4*1024*1024)throw Error('超过文本大小上限');decode(original);
  const expected=w.task.originals?.['test:'+rel]?.hash;if(!expected||hash(original)!==expected)throw Error('原文件自打开工程后已在外部改变，未覆盖；请先核对原文件与审核副本');
  return {b,file,original,bytes:encode(b.text,b.meta)};
 }
 async preview({rel}){const {b,file,original,bytes}=await this.current(rel),token=randomUUID(),originalVersion=hash(original),resultVersion=hash(bytes);
  this.tokens.clear();this.tokens.set(token,{taskId:this.w.task.id,rel,revision:b.revision,originalVersion,resultVersion,expires:Date.now()+120000});
  const before=decode(original).text,after=b.text,A=before.split('\n'),B=after.split('\n'),changes=hunks(before,after);
  return {token,rel,file,changed:originalVersion!==resultVersion,changeCount:changes.length,encoding:b.meta.encoding,eol:b.meta.eol,changes:changes.slice(0,100).map(h=>({line:h.a0+1,before:A.slice(Math.max(0,h.a0-2),h.a1+2).join('\n'),after:B.slice(Math.max(0,h.b0-2),h.b1+2).join('\n')})),truncated:changes.length>100};
 }
 async commit({token}){const w=this.w,p=this.tokens.get(token);this.tokens.delete(token);if(!p||p.expires<Date.now()||p.taskId!==w.task?.id)throw Error('保存预览已过期，请重新预览');
  let c=await this.current(p.rel);if(c.b.revision!==p.revision||hash(c.original)!==p.originalVersion||hash(c.bytes)!==p.resultVersion)throw Error('预览后文件已变化，未写回');
  await w.save('test',p.rel);
  return w.exclusive(async()=>{c=await this.current(p.rel);if(hash(c.original)!==p.originalVersion||hash(c.bytes)!==p.resultVersion)throw Error('副本已保存，但原文件版本冲突，未写回');
   if(p.originalVersion===p.resultVersion)return {file:c.file,unchanged:true};
   const id=randomUUID(),dir=path.join(w.taskRoot,'backups','original');await fs.mkdir(dir,{recursive:true});const backup=await guarded(dir,id+'.bak');await fs.writeFile(backup,c.original,{flag:'wx'});if(hash(await fs.readFile(backup))!==p.originalVersion)throw Error('原文件备份校验失败，未写回');
   const record={id,rel:p.rel,file:c.file,backup,before:p.originalVersion,after:p.resultVersion,at:new Date().toISOString(),status:'prepared'};
   (w.task.originalWrites??=[]).push(record);await w.persist();
   const tmp=await guarded(w.task.roots.test,p.rel+'.embedmerge-'+id+'.tmp');
   try{await fs.writeFile(tmp,c.bytes,{flag:'wx'});if(hash(await fs.readFile(tmp))!==p.resultVersion)throw Error('暂存校验失败');
    await guarded(w.task.roots.test,p.rel);const latest=await fs.lstat(c.file);if(latest.nlink>1||hash(await fs.readFile(c.file))!==p.originalVersion)throw Error('原文件在保存前变化，未写回');
    record.writeMode=await replaceVerified(tmp,c.file,c.bytes,p.originalVersion);
    if(hash(await fs.readFile(c.file))!==p.resultVersion)throw Error('原文件写后校验失败，请使用备份恢复：'+backup);
    record.status='written';w.task.originals['test:'+p.rel]={...w.task.originals['test:'+p.rel],hash:p.resultVersion,size:c.bytes.length,readAt:new Date().toISOString()};
    try{await w.persist();}catch{return {file:c.file,backup,warning:'原文件已写回且备份有效，但任务记录保存失败，请保留备份路径。'};}
    return {file:c.file,backup};
   }finally{await fs.rm(tmp,{force:true}).catch(()=>{});}
  });
 }
}
