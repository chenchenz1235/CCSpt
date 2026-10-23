import './merge-gutter.css';
// Two-way block actions attached to the live, scrolled Monaco diff geometry.
export function createMergeGutter(host,editor,onCopy){
  const gutter=document.createElement('div');gutter.id='mergeGutter';gutter.setAttribute('aria-label','差异块双向复制');host.append(gutter);
  const left=editor.getOriginalEditor(),right=editor.getModifiedEditor();
  let blocks=[],current=0,frame=0;
  const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(draw);};
  function position(ed,index){
    const model=ed.getModel();if(!model)return null;
    const count=model.getLineCount(),line=Math.min(count,Math.max(1,index+1));
    const node=ed.getDomNode();if(!node)return null;
    const height=ed.getScrolledVisiblePosition({lineNumber:line,column:1})?.height||23;
    return node.getBoundingClientRect().top-host.getBoundingClientRect().top+ed.getTopForLineNumber(line,true)-ed.getScrollTop()+(index>=count?height:0);
  }
  function draw(){
    if(!host.isConnected||!left.getModel()||!right.getModel()||host.clientHeight===0){gutter.replaceChildren();return;}
    const a=left.getDomNode().getBoundingClientRect(),b=right.getDomNode().getBoundingClientRect(),box=host.getBoundingClientRect();
    gutter.style.left=((a.right+b.left)/2-box.left-27)+'px';
    const height=host.clientHeight,items=[];
    for(let i=0;i<blocks.length;i++){
      const h=blocks[i],leftTop=h.a1>h.a0?position(left,h.a0):null,rightTop=h.b1>h.b0?position(right,h.b0):null;
      const starts=[leftTop,rightTop].filter(v=>v!==null);if(!starts.length)continue;
      const top=Math.min(...starts);
      const ends=[h.a1>h.a0?position(left,h.a1):null,h.b1>h.b0?position(right,h.b1):null].filter(v=>v!==null);
      const end=Math.max(top+24,...ends);if(end<0||top>height)continue;
      const kind=h.a1===h.a0?'added':h.b1===h.b0?'removed':'changed';
      const item=document.createElement('div');item.className='gutter-hunk'+(i===current?' current':'');item.dataset.kind=kind;item.dataset.gutterBlock=String(i);
      item.style.top=Math.max(0,top)+'px';item.style.height=Math.max(26,Math.min(height,end)-Math.max(0,top))+'px';
      const controls=document.createElement('div');controls.className='gutter-controls';
      for(const [direction,arrow,label]of [['left','←','复制本差异块 test → ref'],['right','→','复制本差异块 ref → test']]){
        const button=document.createElement('button');button.type='button';button.textContent=arrow;button.dataset.gutterCopy=String(i);button.dataset.dir=direction;button.title=label+'（工作缓冲区，可撤销）';button.setAttribute('aria-label',label);
        button.onclick=e=>{e.stopPropagation();onCopy(i,direction);};controls.append(button);
      }
      item.append(controls);items.push(item);
    }
    gutter.replaceChildren(...items);
  }
  for(const ed of [left,right]){ed.onDidScrollChange(schedule);ed.onDidLayoutChange(schedule);}
  editor.onDidUpdateDiff(schedule);
  const resize=new ResizeObserver(schedule);resize.observe(host);
  return {render(next,index){blocks=next;current=index;schedule();},dispose(){resize.disconnect();cancelAnimationFrame(frame);gutter.remove();}};
}
