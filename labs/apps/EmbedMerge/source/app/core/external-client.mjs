import fs from 'node:fs/promises';
import path from 'node:path';
export const defaultDataRoot=process.env.EMBEDMERGE_CONTROL_DATA||path.resolve(import.meta.dirname,'../release/EmbedMerge/data');
export async function callEmbedMerge(action,args={},dataRoot=defaultDataRoot){
 let d;try{d=JSON.parse(await fs.readFile(path.join(dataRoot,'external-control.json'),'utf8'));}catch{throw Error('未发现 EmbedMerge 窗口控制接口，请启动已更新的 EmbedMerge，或指定 EMBEDMERGE_CONTROL_DATA');}
 const u=new URL(d.url);if(d.application!=='EmbedMerge'||u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.pathname!=='/'||u.username||u.password||u.search||u.hash||!/^[a-f0-9]{64}$/.test(d.token))throw Error('EmbedMerge 连接信息无效');
 let r;try{r=await fetch(new URL('/call',u),{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+d.token,'Content-Type':'application/json'},body:JSON.stringify({action,args}),signal:AbortSignal.timeout(180000)});}catch{throw Error('EmbedMerge 窗口连接失败；请检查软件是否仍在运行');}
 const value=await r.json();if(!r.ok)throw Error(value.error||'EmbedMerge 调用失败');return value;
}
