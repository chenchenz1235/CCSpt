import {chatBlocks,inlineParts} from '../core/chat-format.mjs';
function inline(node,text){for(const p of inlineParts(text)){const child=p.type==='text'?document.createTextNode(p.text):document.createElement(p.type);if(p.type!=='text')child.textContent=p.text;node.append(child);}return node;}
export function renderChatContent(element,text,onCopy){
  element.classList.add('formatted-answer');element.replaceChildren();
  for(const b of chatBlocks(text)){
    if(b.type==='code'){
      const box=document.createElement('section');box.className='chat-code';const bar=document.createElement('div');bar.className='chat-code-bar';const language=document.createElement('span');language.textContent=b.language||'代码';const button=document.createElement('button');button.type='button';button.textContent='复制代码';button.className='copy-code';button.onclick=async()=>{try{await onCopy(b.text);button.textContent='已复制';setTimeout(()=>button.textContent='复制代码',1500);}catch{button.textContent='复制失败';}};bar.append(language,button);const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=b.text;pre.append(code);box.append(bar,pre);element.append(box);
    }else if(b.type==='table'){
      const wrap=document.createElement('div');wrap.className='chat-table-wrap';const table=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');b.header.forEach(t=>tr.append(inline(document.createElement('th'),t)));thead.append(tr);table.append(thead);const body=document.createElement('tbody');for(const row of b.rows){const r=document.createElement('tr');for(let i=0;i<b.header.length;i++)r.append(inline(document.createElement('td'),row[i]||''));body.append(r);}table.append(body);wrap.append(table);element.append(wrap);
    }else if(b.type==='list'){const list=document.createElement(b.ordered?'ol':'ul');if(b.ordered)list.start=b.start;for(const item of b.items)list.append(inline(document.createElement('li'),item));element.append(list);
    }else element.append(inline(document.createElement(b.type==='heading'?'h4':'p'),b.text));
  }
}
