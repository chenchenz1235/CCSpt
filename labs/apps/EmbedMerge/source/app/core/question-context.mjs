import {hash} from './text.mjs';
export const isStructuredFile=rel=>/\.(mdl|slx|mat|sldd|mlx)$/i.test(rel);
const rowsOf=r=>Array.isArray(r?.changes)?r.changes:r?.changes?[r.changes]:[];
export async function modelEvidence(workspace,rel){
  const n=workspace.inventory?.find(n=>n.rel===rel);
  if(!n?.matlab||!isStructuredFile(rel))throw Error('所选模型/数据不在当前比较范围');
  const versions=await Promise.all(['ref','test'].map(async side=>(await workspace.file(side,rel)).version));
  const r=n.matlabResult,valid=!!r&&!r.error&&r.status!=='failed'&&JSON.stringify(r.versions)===JSON.stringify(versions);
  const changes=valid?rowsOf(r).slice(0,60):[];
  const result={path:rel,status:valid?n.status:'pending',versions,source:r?.source,cacheValid:valid,evidence:r?.evidence,compile:'not_run',simulation:'not_run',totalChanges:rowsOf(r).length,changes,changesTruncated:valid&&rowsOf(r).length>changes.length,error:r?.error?.slice(0,6000),note:valid?'已缓存且版本匹配的模型/数据比较依据；未执行编译仿真':'尚无版本匹配的成功比较结果；不得据此推断一致或功能等价'};
  while(Buffer.byteLength(JSON.stringify(result))>38000&&changes.length){changes.pop();result.changesTruncated=true;}
  return result;
}
export async function questionFileContext(workspace,args={}){
  const n=args.rel?workspace.inventory?.find(n=>n.rel===args.rel):null;
  if(args.rel&&!n)throw Error('所选文件不在当前比较范围');
  let files=args.files;
  if(!files&&/\.(scfg|mtpj)$/i.test(args.rel||'')){
    const cs=await workspace.csplusSnapshot(),pair=cs.pairs.find(p=>p.ref===args.rel||p.test===args.rel);
    files=pair?{ref:pair.ref,test:pair.test}:{ref:n.ref?args.rel:null,test:n.test?args.rel:null};
  }
  if(files){
    const r=await workspace.csplusCompare({ref:files.ref,test:files.test});
    const module=r.modules.find(m=>m.id===args.moduleId),chosen=module?[module]:r.modules;
    const modules=chosen.slice(0,20).map(m=>({id:m.id,title:m.title,category:m.category,status:m.status,refMode:m.refMode,testMode:m.testMode,modeChanged:m.modeChanged,rows:m.rows.slice(0,60).map(row=>({key:row.key,label:row.label,state:row.state,ref:row.ref?.text,test:row.test?.text,evidence:{ref:row.ref?.evidence,test:row.test?.evidence}}))}));
    const comparison={files:{ref:files.ref||null,test:files.test||null},versions:r.versions,devices:r.devices,moduleId:module?.id,module:module?.title,totalModules:r.modules.length,modules,truncated:chosen.length>modules.length,compile:'not_run',simulation:'not_run'};
    while(Buffer.byteLength(JSON.stringify(comparison))>38000&&modules.length){const last=modules.at(-1);if(last.rows.length)last.rows.pop();else modules.pop();comparison.truncated=true;}
    return {kind:'csplus',files:comparison.files,rel:null,configurationComparison:comparison};
  }
  if(!args.rel)return {kind:'project',rel:null};
  if(n.kind==='dir')return {kind:'directory',rel:args.rel,directory:{path:args.rel,counts:n.counts,files:workspace.inventory.filter(v=>v.kind==='file'&&v.rel.startsWith(args.rel+'/')).slice(0,100).map(v=>({path:v.rel,ref:!!v.ref,test:!!v.test,status:v.status})),note:'目录上下文，按需读取相关文件'}};
  if(isStructuredFile(args.rel))return {kind:'model',rel:args.rel,modelComparison:await modelEvidence(workspace,args.rel)};
  const p=await workspace.pair(args.rel);
  return {kind:'text',rel:args.rel,files:{ref:p.ref.missing?null:args.rel,test:p.test.missing?null:args.rel},versions:Object.fromEntries(['ref','test'].map(side=>[side,{hash:hash(p[side].text),revision:p[side].revision,dirty:p[side].dirty}]))};
}
