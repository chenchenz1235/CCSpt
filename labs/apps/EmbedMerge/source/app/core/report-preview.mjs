import fs from 'node:fs/promises';
import path from 'node:path';
import {guarded} from './workspace.mjs';
import {decode} from './text.mjs';

// Reports run in a scriptless iframe. Bundle only local raster images from the
// report directory; never expose arbitrary file URLs to the renderer.
export async function reportPreview(artifactsRoot,file){
  const safe=await guarded(artifactsRoot,path.relative(artifactsRoot,file));
  if(path.extname(safe).toLowerCase()!=='.html')throw Error('仅允许查看任务内的官方 HTML 报告');
  if((await fs.stat(safe)).size>16*1024*1024)throw Error('报告超过 16 MiB，请使用外部打开');
  let html;
  try{html=decode(await fs.readFile(safe)).text;}
  catch(e){throw Error('官方报告未取得可读文本：'+e.message+'。请核对 EmbedMerge 的公司读取授权，或使用“外部打开”。');}
  const sources=[...html.matchAll(/\bsrc\s*=\s*(["'])(.*?)\1/gi)];
  let total=Buffer.byteLength(html);
  for(const match of sources){
    const source=match[2];
    if(/^(?:data:|[a-z]+:|\/|#)/i.test(source))continue;
    let image;
    try{
      const relative=decodeURIComponent(source.split(/[?#]/)[0]);
      const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'}[path.extname(relative).toLowerCase()];
      if(!mime)continue;
      const imagePath=await guarded(path.dirname(safe),relative.replaceAll('\\','/'));
      const size=(await fs.stat(imagePath)).size;
      if(size>4*1024*1024||total+size>24*1024*1024)continue;
      const bytes=await fs.readFile(imagePath);total+=bytes.length;
      image=`data:${mime};base64,${bytes.toString('base64')}`;
    }catch{continue;}
    html=html.replace(match[0],`src="${image}"`);
  }
  const policy="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-src 'none'";
  return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>body{font:14px/1.6 'Segoe UI','Microsoft YaHei',sans-serif;margin:18px}img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body>${html}</body></html>`;
}
