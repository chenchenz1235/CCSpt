import fs from 'node:fs/promises';

// Deliberately accept only the known R2024b HTML export shape. Unknown rows
// retain the report and prevent a cosmetic classification.
const plain=s=>s.replace(/<[^>]*>/g,'').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').trim();
export function parseModelReport(html){
  const tables=[...html.matchAll(/<table\b[^>]*class="DiffTable"[^>]*>([\s\S]*?)<\/table>/g)],changes=[];
  const noChanges=tables.length===0&&html.includes('class="FileInfoTable"')&&html.includes('class="EnvironmentInfoTable"')&&/<p class="ReportSectionHeading">\s*<span class="ReportSectionHeading">(?:比较结果|Comparison [Rr]esults)<\/span>\s*<\/p>\s*<div>\s*<\/div>/.test(html);
  let complete=html.includes('</html>')&&(tables.length>0||noChanges);
  for(const [,table]of tables){
    const rows=[...table.matchAll(/<tr\b[^>]*class="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)];
    if(rows.length!==([...table.matchAll(/<tr\b/g)]).length)complete=false;
    let location='',node='',parameters=0;
    for(const [,kind,row]of rows){
      const cells=[...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map(m=>m[1]);
      if(cells.length!==2){complete=false;continue;}
      if(['nodes','node_paths','subsystem_node_path'].includes(kind)){
        if(kind==='nodes')node=plain(cells[0])||plain(cells[1]);
        else location=plain(cells[0])||plain(cells[1]);
        continue;
      }
      if(kind!=='parameters'){complete=false;continue;}
      parameters++;
      const sides=cells.map(c=>[...c.matchAll(/<span\b[^>]*class="Parameters"[^>]*>([\s\S]*?)<\/span>/g)].map(m=>plain(m[1])));
      if(!sides[0].length&&!sides[1].length){
        if(node==='Thumbnail'&&location==='/Thumbnail'&&!cells.some(c=>plain(c)))changes.push({kind:'parameter',property:'Thumbnail',path:location,left:'official report image',right:'official report image',evidence:'unfiltered HTML'});
        else complete=false;
        continue;
      }
      const parsed=sides.map(side=>side.map(text=>{const at=text.indexOf(' : ');return at<0?null:{key:text.slice(0,at),value:text.slice(at+3)};}));
      if(parsed.flat().some(v=>!v)){complete=false;continue;}
      const maps=parsed.map(side=>new Map(side.map(v=>[v.key,v.value])));
      if(maps.some((m,i)=>m.size!==parsed[i].length))complete=false;
      for(const key of new Set([...maps[0].keys(),...maps[1].keys()])){
        const a=maps[0].get(key),b=maps[1].get(key);
        if(a===undefined||b===undefined){complete=false;continue;}
        if(a!==b)changes.push({kind:'parameter',property:['模型属性','Model Properties','Model properties'].includes(node)&&['Modified','Created'].includes(key)?'Model.'+key:key,path:location||node,left:a,right:b,evidence:'unfiltered HTML'});
      }
    }
    if(!parameters)complete=false;
  }
  return {complete,changes,tableCount:tables.length,noChanges};
}
export async function supplementModelResult(result){
  if(!result.unfilteredReport)return result;
  try{
    const report=parseModelReport(await fs.readFile(result.unfilteredReport,'utf8'));
    return {...result,changes:[...(Array.isArray(result.changes)?result.changes:result.changes?[result.changes]:[]),...report.changes],reportNoChanges:report.noChanges&&result.reportFilter==='unfiltered',reportCoverage:report.complete?'recognized R2024b export':'unknown export rows',incomplete:!report.complete||report.noChanges&&result.reportFilter!=='unfiltered'};
  }catch(e){return {...result,incomplete:true,reportReadError:e.message};}
}
