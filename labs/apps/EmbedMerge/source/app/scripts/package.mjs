import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const asar=require('@electron/asar');
const {Pickle}=require(path.join(path.dirname(require.resolve('@electron/asar')),'pickle.js'));
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const dest=process.env.EMBEDMERGE_PACKAGE_DIR?path.resolve(process.env.EMBEDMERGE_PACKAGE_DIR):path.join(root,'release','EmbedMerge');
if(!dest.toLowerCase().startsWith(path.join(root,'release').toLowerCase()+path.sep))throw Error('Package output must stay inside app/release');
const digest=b=>createHash('sha256').update(b).digest('hex');
const manifest=[];
// Copy actual buffers and verify them: filesystem stat sizes can include company
// encryption headers. Build ASAR offsets from readFile lengths, never stat.
async function copy(src,dst){
  if(path.basename(src)==='default_app.asar')return;
  const stat=await fs.lstat(src);if(stat.isSymbolicLink())throw Error('Packaging refuses symlinks: '+src);
  if(stat.isDirectory()){await fs.mkdir(dst,{recursive:true});for(const name of await fs.readdir(src))await copy(path.join(src,name),path.join(dst,name));}
  else{
    const bytes=await fs.readFile(src);await fs.mkdir(path.dirname(dst),{recursive:true});
    let identical=false;try{identical=digest(await fs.readFile(dst))===digest(bytes);}catch(e){if(e.code!=='ENOENT')throw e;}
    // Keep the already-authorized runtime binary untouched when its bytes match.
    if(!identical)await fs.writeFile(dst,bytes);
    if(digest(await fs.readFile(dst))!==digest(bytes))throw Error('Package write verification failed: '+dst);
    manifest.push({path:path.relative(dest,dst).replaceAll('\\','/'),bytes:bytes.length,sha256:digest(bytes)});
  }
}
await fs.mkdir(dest,{recursive:true});
const runtime=path.join(root,'node_modules/electron/dist');
for(const name of await fs.readdir(runtime))await copy(path.join(runtime,name),path.join(dest,name==='electron.exe'?'EmbedMerge.exe':name));
// Stock Electron's default_app takes precedence over the unpacked app directory.
await fs.rm(path.join(dest,'resources/default_app.asar'),{force:true});
const appDir=path.join(dest,'resources/app');
// Only replace our generated code staging folder, after verifying its resolved
// target. Persistent user tasks live in dest/data and are never removed.
try{const actual=await fs.realpath(appDir);if(actual.toLowerCase()!==path.resolve(appDir).toLowerCase()||!actual.toLowerCase().startsWith(path.resolve(dest).toLowerCase()+path.sep))throw Error('Unsafe package staging path');await fs.rm(appDir,{recursive:true,force:true});}catch(e){if(e.code!=='ENOENT')throw e;}
for(const name of ['core','electron','dist','matlab'])await copy(path.join(root,name),path.join(appDir,name));
for(const name of ['diff','iconv-lite','safer-buffer','@xmldom/xmldom'])await copy(path.join(root,'node_modules',name),path.join(appDir,'node_modules',name));
await fs.writeFile(path.join(appDir,'package.json'),JSON.stringify({name:'embedmerge',version,type:'module',main:'electron/main.cjs'},null,2));
// Synthetic UI fixtures are application assets. Keep them in the archive so a
// fresh stable executable can demonstrate the UI before company authorization.
await copy(path.resolve(root,'../new-project-kit/fixtures'),path.join(appDir,'fixtures'));
const names=[];async function walk(dir){for(const d of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,d.name);if(d.isDirectory())await walk(p);else if(d.isFile())names.push(path.relative(appDir,p));else throw Error('Unexpected package entry');}}await walk(appDir);names.sort();
const header={files:{}},chunks=[],checks=[];let offset=0;
for(const name of names){const bytes=await fs.readFile(path.join(appDir,name)),parts=name.split(/[\\/]/);let node=header;for(const p of parts.slice(0,-1))node=node.files[p]??={files:{}};const blocks=[];for(let i=0;i<bytes.length;i+=4194304)blocks.push(digest(bytes.subarray(i,i+4194304)));node.files[parts.at(-1)]={size:bytes.length,offset:String(offset),integrity:{algorithm:'SHA256',hash:digest(bytes),blockSize:4194304,blocks}};chunks.push(bytes);checks.push({name,hash:digest(bytes)});offset+=bytes.length;}
const hp=Pickle.createEmpty();hp.writeString(JSON.stringify(header));const hb=hp.toBuffer(),sp=Pickle.createEmpty();sp.writeUInt32(hb.length);const archive=path.join(dest,'resources/app.asar'),archiveBytes=Buffer.concat([sp.toBuffer(),hb,...chunks]);await fs.writeFile(archive,archiveBytes);asar.uncacheAll();for(const c of checks)if(digest(asar.extractFile(archive,c.name))!==c.hash)throw Error('ASAR integrity mismatch: '+c.name);
manifest.push({path:'resources/app.asar',bytes:archiveBytes.length,sha256:digest(archiveBytes),verifiedEntries:checks.length});
await copy(path.join(root,'matlab'),path.join(dest,'resources/helpers/matlab'));
for(const file of ['LICENSE','ThirdPartyNotices.txt'])await copy(path.join(root,'node_modules/monaco-editor',file),path.join(dest,'resources/licenses/monaco-editor',file));
await copy(path.resolve(root,'../new-project-kit/fixtures'),path.join(dest,'resources/fixtures'));
for(const name of ['使用说明.txt','THIRD_PARTY_NOTICES.txt','验收记录.txt']){try{await copy(path.join(root,name),path.join(dest,name));}catch(e){if(e.code!=='ENOENT')throw e;}}
await fs.writeFile(path.join(dest,'PACKAGE_MANIFEST.json'),JSON.stringify({version,builtAt:new Date().toISOString(),runtime:JSON.parse(await fs.readFile(path.join(root,'node_modules/electron/package.json'),'utf8')).version,files:manifest},null,2));
console.log('Verified package: '+path.join(dest,'EmbedMerge.exe')+' ('+manifest.length+' files)');
