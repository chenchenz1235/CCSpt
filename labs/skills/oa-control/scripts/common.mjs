import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright-core';
export const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export function validateConfig(input){
 const target=new URL(input.oaUrl);
 if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('oaUrl must be an HTTP(S) URL without embedded credentials.');
 if(target.hostname==='oa.example.com')throw Error('Configure your own OA URL in config.local.json first.');
 const endpoint=new URL(input.cdpEndpoint||'http://127.0.0.1:9222');
 if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname)||endpoint.username||endpoint.password)throw Error('CDP endpoint must use loopback without embedded credentials.');
 return {...input,oaUrl:target.href,origin:target.origin,mainPath:target.pathname,cdpEndpoint:endpoint.href.replace(/\/$/,''),profileDir:path.resolve(root,input.profileDir||'.edge-profile'),outputDir:path.resolve(root,input.outputDir||'.state')};
}
export async function loadConfig(){let text;try{text=await fs.readFile(process.env.OA_CONFIG_PATH?path.resolve(process.env.OA_CONFIG_PATH):path.join(root,'config.local.json'),'utf8');}catch{throw Error('Copy config.example.json to config.local.json and set oaUrl first.');}return validateConfig(JSON.parse(text.replace(/^\uFEFF/,'')));}
export async function connect(config){return chromium.connectOverCDP(config.cdpEndpoint,{timeout:5000});}
export function oaPages(browser,config){return browser.contexts().flatMap(c=>c.pages()).filter(p=>{try{return new URL(p.url()).origin===config.origin;}catch{return false;}});}
export function choosePage(pages,hint){const matches=hint?pages.filter(p=>p.url().includes(hint)):pages;if(matches.length!==1)throw Error('Select exactly one OA page using --url URL_SUBSTRING; run tabs first.');return matches[0];}
export function isMainUrl(url,config){try{const u=new URL(url);return u.origin===config.origin&&u.pathname===config.mainPath;}catch{return false;}}
export async function start(config){
 try{const r=await fetch(config.cdpEndpoint+'/json/version',{signal:AbortSignal.timeout(1200)});if(r.ok)return 'CDP is already running; reuse it.';}catch{}
 if(process.platform!=='win32')throw Error('Automatic Edge launch is Windows-only; launch your own loopback CDP Edge otherwise.');
 const candidates=[config.edgePath,path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft/Edge/Application/msedge.exe'),path.join(process.env.PROGRAMFILES||'C:/Program Files','Microsoft/Edge/Application/msedge.exe')].filter(Boolean);
 let exe;for(const file of candidates){try{await fs.access(file);exe=file;break;}catch{}}
 if(!exe)throw Error('Set edgePath to the installed Microsoft Edge executable.');
 const endpoint=new URL(config.cdpEndpoint),port=endpoint.port||'9222';
 const child=spawn(exe,['--remote-debugging-address=127.0.0.1',`--remote-debugging-port=${port}`,`--user-data-dir=${config.profileDir}`,'--no-first-run',config.oaUrl],{detached:true,stdio:'ignore',windowsHide:true});
 await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return 'Dedicated Edge opened. Sign in manually unless you deliberately enabled optional login.';
}
export async function collectFrames(page){const frames=[];for(const f of page.frames()){try{if(new URL(f.url()).origin!==new URL(page.url()).origin)continue;}catch{continue;}frames.push({name:f.name(),url:f.url(),text:await f.locator('body').innerText({timeout:5000}).catch(()=>'' )});}return frames;}

