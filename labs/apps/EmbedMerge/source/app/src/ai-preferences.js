export function installAiPreferences(){
 const ids=['maxCalls','maxChars','timeout','aiEffort'],key='embedmerge.ai.preferences.v2';let saved={};try{saved=JSON.parse(localStorage.getItem(key)||'{}')||{};}catch{}
 for(const id of ids){const n=document.getElementById(id),v=saved[id];if(v!==undefined){if(n.tagName==='SELECT'){if([...n.options].some(o=>o.value===v))n.value=v;}else if(Number.isFinite(Number(v))&&Number(v)>=Number(n.min)&&Number(v)<=Number(n.max))n.value=v;}}
 const save=()=>{try{localStorage.setItem(key,JSON.stringify(Object.fromEntries(ids.map(id=>[id,document.getElementById(id).value]))));}catch{}};
 for(const id of ids)for(const event of ['input','change'])document.getElementById(id).addEventListener(event,save);
}
