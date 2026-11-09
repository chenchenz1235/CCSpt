import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {replaceVerified} from './workspace.mjs';
const exec=promisify(execFile);
export const applicationSettingsSpec={name:'application_settings',description:'List, open and fill ALL available EmbedMerge settings and path fields through the existing UI. Use list to discover valid field keys; open section then list for dynamic dialogs. fill values writes the UI only. When the user requests saving or starting, apply saves/applies the selected section; during an AI answer this is queued until the answer ends and is not yet completed. open sections home/folder/text/model/csplus/reviewResults navigates pages; path selects a current comparison-relative file and line positions its editor. MATLAB configure validates and persists its path. Never fill settings unless the user requested it. Open, inspect or configure EmbedMerge MATLAB settings. Use open when asked to show the settings page; detect searches this computer without launching MATLAB; configure saves a validated local MATLAB path only when the user explicitly requests configuration. No project files are modified. With no path, configure only selects a unique supported installation, otherwise returns needs_input. A saved path is not a MATLAB runtime/license test. open_requested means the window was asked to show the dialog.',inputSchema:{type:'object',properties:{action:{type:'string',enum:['list','status','open','detect','configure','fill','apply']},path:{type:'string'},line:{type:'integer'},section:{type:'string',description:'matlab, comparison, ai, filters, review, reviewProject, firmware, task, sharedChat, layout, settings'},values:{type:'object',additionalProperties:{type:['string','number','boolean']}}},required:['action'],additionalProperties:false}};
export class MatlabSettings {
 constructor(dataRoot,notify=()=>{},options={}){this.file=path.join(dataRoot,'matlab-settings.json');this.notify=notify;this.env=options.env||process.env;this.platform=options.platform||process.platform;this.registry=options.registry||(()=>this.registryRoots());this.candidates=options.candidates;this.queue=Promise.resolve();}
 async read(){try{const s=JSON.parse((await fs.readFile(this.file,'utf8')).replace(/^\uFEFF/,''));return {path:typeof s.path==='string'?s.path:'',updated:s.updated||null};}catch(e){if(e.code==='ENOENT')return {path:'',updated:null};throw Error('MATLAB 设置无法读取：'+e.message);}}
 async validate(input){
  if(typeof input!=='string'||!input.trim()||input.includes('\0'))throw Error('请选择 MATLAB 的 matlab.exe');
  let exe=input.trim().replace(/^"(.*)"$/,'$1');if(!path.isAbsolute(exe))throw Error('请填写完整绝对路径');
  if((await fs.stat(exe)).isDirectory())exe=path.join(exe,'bin','matlab.exe');
  if(path.basename(exe).toLowerCase()!=='matlab.exe'||!(await fs.stat(exe)).isFile())throw Error('请选择 MATLAB 的 matlab.exe');
  exe=path.resolve(exe);const root=path.dirname(path.dirname(exe));
  const identity=await matlabIdentity(exe);
  return {path:exe,...identity,validation:'installation-path',runtimeVerified:false};
 }
 async registryRoots(){
  if(this.platform!=='win32')return [];
  const results=await Promise.allSettled(['HKLM\\SOFTWARE\\MathWorks\\MATLAB','HKCU\\SOFTWARE\\MathWorks\\MATLAB','HKLM\\SOFTWARE\\WOW6432Node\\MathWorks\\MATLAB'].map(key=>exec('reg.exe',['query',key,'/s'],{windowsHide:true,timeout:4000,maxBuffer:1024*1024})));
  return results.flatMap(r=>r.status==='fulfilled'?[...r.value.stdout.matchAll(/^\s*MATLABROOT\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/gmi)].map(m=>m[1].trim()):[]);
 }
 async installationCandidates(){
  const found=[];for(const base of [path.join(this.env.ProgramFiles||'C:/Program Files','MATLAB'),this.env['ProgramFiles(x86)']?path.join(this.env['ProgramFiles(x86)'],'MATLAB'):null,'D:/App/matlab'].filter(Boolean)){try{for(const e of await fs.readdir(base,{withFileTypes:true}))if(e.isDirectory()&&!e.isSymbolicLink())found.push(path.join(base,e.name,'bin','matlab.exe'));}catch{}}
  return found;
 }
 async detect(){
  const candidates=this.candidates?await this.candidates():[
   ...await this.installationCandidates(),
   ...[this.env.MATLAB_ROOT,this.env.MATLABROOT].filter(Boolean),
   ...(this.env.PATH||'').split(path.delimiter).filter(Boolean).map(p=>path.join(p,'matlab.exe')),
   ...await this.registry()
  ];
  const found=new Map();for(const candidate of candidates){try{const v=await this.validate(candidate),key=(await fs.realpath(v.path)).toLowerCase();found.set(key,v);}catch{}}
  return {candidates:[...found.values()],runtimeVerified:false};
 }
 async status(){const saved=await this.read();if(!saved.path)return {...saved,configured:false,valid:false};try{return {...saved,...await this.validate(saved.path),configured:true,valid:true};}catch(e){return {...saved,configured:true,valid:false,error:e.message};}}
 async save(input){const work=this.queue.then(async()=>{const valid=await this.validate(input),value={path:valid.path,updated:new Date().toISOString()};await fs.mkdir(path.dirname(this.file),{recursive:true});const tmp=this.file+'.tmp';const bytes=Buffer.from(JSON.stringify(value,null,2));await fs.writeFile(tmp,bytes);await replaceVerified(tmp,this.file,bytes);const result={...value,...valid,configured:true,valid:true};this.notify('matlab-settings-changed',result);return result;});this.queue=work.catch(()=>{});return work;}
 async resolve(override){if(override)return (await this.validate(override)).path;const saved=await this.read();if(saved.path)return (await this.validate(saved.path)).path;const detected=await this.detect();if(detected.candidates.length===1)return detected.candidates[0].path;throw Error(detected.candidates.length?'找到多个 MATLAB，请打开“MATLAB 设置”选择一个':'未找到 MATLAB，请打开顶部“MATLAB 设置”选择 matlab.exe');}
 async command(args){
  if(!args||!['status','open','detect','configure'].includes(args.action))throw Error('无效的 MATLAB 设置操作');
  if(args.action==='status')return this.status();
  if(args.action==='open'){this.notify('open-matlab-settings',{});return {status:'open_requested',...await this.status()};}
  if(args.action==='detect')return this.detect();
  let selected=args.path;if(!selected){const detected=await this.detect();if(detected.candidates.length!==1){this.notify('open-matlab-settings',{});return {status:'needs_input',...detected,message:detected.candidates.length?'找到多个安装位置，请选择':'未找到 MATLAB，请浏览安装位置'};}selected=detected.candidates[0].path;}
  return {status:'configured',...await this.save(selected)};
 }
}

export async function matlabIdentity(exe){
 const root=path.dirname(path.dirname(exe));let release='',version='';
 try{const xml=await fs.readFile(path.join(root,'VersionInfo.xml'),'utf8');release=xml.match(/<release>\s*(R?\d{4}[ab])\s*<\/release>/i)?.[1]?.replace(/^R/i,'')||'';version=xml.match(/<version>\s*(\d+\.\d+(?:\.[^<]*)?)\s*<\/version>/i)?.[1]||'';}catch(e){if(e.code!=='ENOENT')throw e;}
 if(!release)release=path.basename(root).match(/^R(\d{4}[ab])$/i)?.[1]||'';
 let majorMinor=version.match(/^(\d+\.\d+)/)?.[1];
 if(!majorMinor&&release){const year=Number(release.slice(0,4)),half=release.slice(4).toLowerCase();if(year>2023||year===2023&&half==='b')majorMinor=String(year-2000)+'.'+(half==='a'?'1':'2');else if(year>=2016)majorMinor='9.'+String((year-2016)*2+(half==='b'?1:0));}
 return {release:release?'R'+release:null,version:version||majorMinor||null,progId:majorMinor?'Matlab.Application.'+majorMinor:'Matlab.Application',batchAvailable:majorMinor?Number(majorMinor.split('.')[0])>9||Number(majorMinor.split('.')[0])===9&&Number(majorMinor.split('.')[1])>=6:false};
}
