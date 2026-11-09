import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {deflateRawSync,crc32} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const sha=b=>createHash('sha256').update(b).digest('hex');
export function releasePaths(manifest){
 if(!Array.isArray(manifest.files)||!manifest.files.length)throw Error('Empty package manifest');
 const seen=new Set();
 for(const file of manifest.files){
  const name=file.path;
  if(typeof name!=='string'||name.includes('\\')||name.includes(':')||name.includes('\0')||name.split('/').some(x=>!x||x==='.'||x==='..')||/^(data|test-output|\.git|node_modules)\//i.test(name)||/^resources\/app\//i.test(name)||name==='PACKAGE_MANIFEST.json')throw Error('Unsafe release entry: '+name);
  if(seen.has(name.toLowerCase()))throw Error('Duplicate release entry: '+name);
  if(!Number.isSafeInteger(file.bytes)||file.bytes<0||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Invalid manifest entry: '+name);
  seen.add(name.toLowerCase());
 }
 if(!seen.has('embedmerge.exe')||!seen.has('resources/app.asar'))throw Error('Incomplete application manifest');
 return manifest.files;
}

// Write only verified manifest entries. Never recursively zip an installation:
// its adjacent data directory contains private tasks, buffers and auth tokens.
export async function createReleaseZip(source,output,{maxBytes=600*1024*1024}={}){
 source=path.resolve(source);output=path.resolve(output);
 const manifestBytes=await fs.readFile(path.join(source,'PACKAGE_MANIFEST.json'));
 const manifest=JSON.parse(manifestBytes.toString('utf8'));
 const entries=[...releasePaths(manifest),{path:'PACKAGE_MANIFEST.json',bytes:manifestBytes.length,sha256:sha(manifestBytes)}];
 const total=entries.reduce((n,f)=>n+f.bytes,0);
 if(total>maxBytes)throw Error('Release exceeds uncompressed size budget: '+total);
 if(output.startsWith(source+path.sep))throw Error('ZIP output must be outside the application directory');
 await fs.mkdir(path.dirname(output),{recursive:true});
 const temp=output+'.tmp-'+process.pid,handle=await fs.open(temp,'wx');
 let offset=0;const directory=[];
 const write=async b=>{let i=0;while(i<b.length){const r=await handle.write(b,i,b.length-i,null);if(!r.bytesWritten)throw Error('Short ZIP write');i+=r.bytesWritten;}offset+=b.length;};
 try{
  for(const f of entries){
   const file=path.join(source,...f.path.split('/')),real=await fs.realpath(file),base=await fs.realpath(source);
   if(!real.toLowerCase().startsWith(base.toLowerCase()+path.sep)||(await fs.lstat(file)).isSymbolicLink())throw Error('Release path escapes installation: '+f.path);
   const bytes=await fs.readFile(file);
   if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)throw Error('Package changed since build: '+f.path);
   const compressed=deflateRawSync(bytes,{level:6}),name=Buffer.from('EmbedMerge/'+f.path),crc=crc32(bytes),start=offset;
   const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(0x800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(0x21,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(bytes.length,22);local.writeUInt16LE(name.length,26);
   await write(local);await write(name);await write(compressed);
   const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(0x21,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(bytes.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(start,42);directory.push(central,name);
  }
  const directoryStart=offset;for(const b of directory)await write(b);
  const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(offset-directoryStart,12);end.writeUInt32LE(directoryStart,16);await write(end);
  await handle.close();await fs.rename(temp,output);
  const result={version:manifest.version,archive:output,entries:entries.length,uncompressedBytes:total,zipBytes:offset,excluded:['data/','unlisted installation files','resources/app/']};
  await fs.writeFile(output+'.json',JSON.stringify(result,null,2));
  return result;
 }catch(e){await handle.close().catch(()=>{});await fs.rm(temp,{force:true});throw e;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const source=process.env.EMBEDMERGE_PACKAGE_DIR||path.join(root,'release/EmbedMerge');
 const {version}=JSON.parse(await fs.readFile(path.join(source,'PACKAGE_MANIFEST.json'),'utf8'));
 const output=path.join(root,'release',`EmbedMerge-${version}-windows-x64.zip`);
 const result=await createReleaseZip(source,output);
 await fs.copyFile(output,path.join(root,'release/EmbedMerge.zip'));
 console.log(JSON.stringify(result,null,2));
}
