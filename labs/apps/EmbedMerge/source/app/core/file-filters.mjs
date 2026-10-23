export const FILTER_GROUPS=[
 {id:'documents',title:'文档和资料',detail:'PDF、Office、SmartManual Docs',extensions:['pdf','doc','docx','xls','xlsx','ppt','pptx','rtf','chm'],folders:['smartmanualdocs']},
 {id:'web',title:'网页和生成报告',detail:'HTML、网页资源；保留工程 XML/JSON',extensions:['html','htm','mhtml','mht','css','map'],folders:[]},
 {id:'images',title:'图片和音视频',detail:'PNG/JPG/SVG、音视频',extensions:['png','jpg','jpeg','gif','bmp','ico','svg','webp','tif','tiff','mp4','avi','mov','mp3','wav'],folders:[]},
 {id:'artifacts',title:'编译中间文件及二进制产物',detail:'OBJ/O、EXE/DLL、OUT/ELF、日志和临时文件；保留生成的 C/H',extensions:['o','obj','d','dep','pdb','ilk','pch','exe','dll','lib','a','out','elf','hex','bin','srec','s19','log','tmp','bak','slxc','mexw64','mexw32','exp','idb'],folders:[]},
 {id:'caches',title:'工具和模型生成缓存',detail:'slprj、__pycache__、MATLAB buildInfo/codeInfo/traceInfo',extensions:[],folders:['slprj','__pycache__','.cache','.pytestcache'],cacheFiles:true}
];
export const defaultFileFilters=()=>Object.fromEntries([...FILTER_GROUPS.map(g=>[g.id,true]),['extraExtensions',[]],['extraFolders',[]]]);
export function normalizeFileFilters(value={}){
 const result=defaultFileFilters();for(const g of FILTER_GROUPS)if(value[g.id]===false)result[g.id]=false;
 result.extraExtensions=(value.extraExtensions||[]).map(s=>String(s).trim().replace(/^\*?\./,'').toLowerCase()).filter(Boolean);
 result.extraFolders=(value.extraFolders||[]).map(s=>String(s).trim().replaceAll('\\','/').replace(/^\/+|\/+$/g,'').toLowerCase()).filter(Boolean);
 if(result.extraExtensions.length>100||result.extraExtensions.some(s=>!/^[a-z0-9_-]{1,20}$/.test(s)))throw Error('自定义扩展名仅支持最多 100 个简单扩展名，例如 pdf、obj');
 if(result.extraFolders.length>100||result.extraFolders.some(s=>s.split('/').some(p=>!p||p==='.'||p==='..'||/[<>:"|?*\x00-\x1f]/.test(p))))throw Error('自定义目录请填写目录名称或相对路径，不支持通配符及越界路径');
 return result;
}
const compact=s=>s.replace(/[\s_-]/g,'').toLowerCase();
export function excludedReason(rel,isDirectory=false,config=defaultFileFilters()){
 const normal=rel.replaceAll('\\','/').toLowerCase(),parts=normal.split('/'),folders=isDirectory?parts:parts.slice(0,-1),name=parts.at(-1),extension=name.includes('.')?name.split('.').at(-1):'';
 for(const group of FILTER_GROUPS){if(config[group.id]===false)continue;if(group.folders.some(f=>folders.some(p=>compact(p)===compact(f)))||!isDirectory&&group.extensions.includes(extension)||group.cacheFiles&&!isDirectory&&/(^|\/)[^/]+_(ert|grt)_rtw\/(?:html\/)?(?:buildinfo|codeinfo|traceinfo|rtwtypeschksum|binfo)\.mat$/.test(normal))return group.title;}
 if(!isDirectory&&(config.extraExtensions||[]).includes(extension))return '自定义扩展名';
 if((config.extraFolders||[]).some(f=>folders.includes(f)||normal===f||normal.startsWith(f+'/')))return '自定义目录';
 return null;
}
