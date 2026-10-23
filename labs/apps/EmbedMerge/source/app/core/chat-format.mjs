// A small text-only presentation format. HTML, images and executable links are
// never interpreted. Unknown Markdown remains ordinary text.
export function inlineParts(text){
  text=String(text??'');
  const parts=[];let end=0;
  for(const m of String(text).matchAll(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g)){
    if(m.index>end)parts.push({type:'text',text:text.slice(end,m.index)});
    const code=m[0].startsWith('`');parts.push({type:code?'code':'strong',text:m[0].slice(code?1:2,code?-1:-2)});end=m.index+m[0].length;
  }
  if(end<text.length)parts.push({type:'text',text:text.slice(end)});return parts;
}
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(s=>s.trim());
const divider=line=>line.includes('|')&&cells(line).every(c=>/^:?-{3,}:?$/.test(c));
export function chatBlocks(text){
  const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n'),out=[];let i=0;
  while(i<lines.length){
    if(!lines[i].trim()){i++;continue;}
    const fence=lines[i].match(/^\s*(`{3,}|~{3,})\s*([\w+-]*)\s*$/);
    if(fence){const content=[],marker=fence[1];i++;while(i<lines.length&&!new RegExp('^\\s*'+marker[0]+'{'+marker.length+',}\\s*$').test(lines[i]))content.push(lines[i++]);if(i<lines.length)i++;out.push({type:'code',language:fence[2],text:content.join('\n')});continue;}
    const heading=lines[i].match(/^#{1,6}\s+(.+)$/);if(heading){out.push({type:'heading',text:heading[1]});i++;continue;}
    if(i+1<lines.length&&lines[i].includes('|')&&divider(lines[i+1])){const header=cells(lines[i]),rows=[];i+=2;while(i<lines.length&&lines[i].trim()&&lines[i].includes('|'))rows.push(cells(lines[i++]));out.push({type:'table',header,rows});continue;}
    const bullet=lines[i].match(/^\s*(?:([-+*])\s+|(\d+)[.)]\s+)(.+)$/);
    if(bullet){const items=[],ordered=!!bullet[2],start=ordered?Number(bullet[2]):undefined;while(i<lines.length){const item=lines[i].match(/^\s*(?:([-+*])\s+|(\d+)[.)]\s+)(.+)$/);if(!item||!!item[2]!==ordered)break;items.push(item[3]);i++;}out.push({type:'list',ordered,start,items});continue;}
    const paragraph=[lines[i++]];while(i<lines.length&&lines[i].trim()&&!/^\s*(?:`{3,}|~{3,}|#{1,6}\s|[-+*]\s|\d+[.)]\s)/.test(lines[i])&&!(i+1<lines.length&&divider(lines[i+1])))paragraph.push(lines[i++]);out.push({type:'paragraph',text:paragraph.join('\n')});
  }
  return out;
}
