import './comparison-paths.css';
export function createComparisonPaths({pickPath,protect,message,isBusy,getTask,compare,refresh,stageView,openNew}){
 const $=s=>document.querySelector(s);let staged=null;
 const bar=document.createElement('div');bar.className='comparison-path-controls';
 bar.innerHTML='<label>左侧 ref<input id="comparisonRef" aria-label="左侧比较路径"><button id="browseComparisonRef">浏览…</button></label><label>右侧 test<input id="comparisonTest" aria-label="右侧比较路径"><button id="browseComparisonTest">浏览…</button></label><button id="comparePaths" class="primary">比较</button><span id="pathCompareState" role="status"></span>';
 $('.paths').after(bar);
 const empty=document.createElement('div');empty.id='comparisonPending';empty.hidden=true;empty.textContent='路径已加载。可修改任意一侧，然后点击“比较”。';bar.after(empty);
 const paths=()=>({ref:$('#comparisonRef').value.trim(),test:$('#comparisonTest').value.trim()});
 function changed(){const t=getTask(),p=paths();return !!staged||!t||p.ref!==(t.files?.ref||t.roots.ref)||p.test!==(t.files?.test||t.roots.test);}
 function update(){const dirty=changed();$('#pathCompareState').textContent=dirty?(staged?'路径已加载，等待比较':'路径待比较；下方保留上次结果'):getTask()?.mode==='direct-files'?'外部文件更新后自动比较':'';$('#comparePaths').textContent=dirty?'开始比较':'重新比较';$('#refresh').textContent=dirty?'▶ 开始比较':'⟳ 重新比较';$('#refresh').classList.toggle('primary',dirty);}
 for(const side of ['Ref','Test']){
  $('#comparison'+side).addEventListener('input',update);
  $('#comparison'+side).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();$('#comparePaths').click();}});
  $('#browseComparison'+side).onclick=protect(async()=>{if(isBusy())return;const input=$('#comparison'+side),p=await pickPath(input.value);if(p){input.value=p;update();}});
 }
 async function execute(){
  if(isBusy())return;if(!staged&&!$('#welcome').hidden){openNew();return;}if(!changed())return refresh();
  const p=paths();if(!p.ref||!p.test)throw Error('请选择两侧文件或文件夹');
  const t=getTask(),options=staged?.options||{createCopy:!t?.mode?.startsWith('direct-'),fileFilters:t?.fileFilters,autoMatlab:t?.autoMatlab};
  $('#comparePaths').disabled=true;
  try{await compare(p,staged?.name||t?.name||'合并比较',options);}finally{$('#comparePaths').disabled=false;}
 }
 $('#comparePaths').onclick=protect(execute);
 return {
  compare:execute,pending:()=>changed(),
  stage(p,name,options){stageView();staged={name,options};document.body.dataset.reviewProject='false';$('#comparisonRef').value=p.ref;$('#comparisonTest').value=p.test;$('#welcome').hidden=true;$('#comparison').hidden=false;for(const view of document.querySelectorAll('#comparison > section'))view.hidden=true;empty.hidden=false;$('.paths').hidden=true;$('#fileTab').disabled=true;$('#folderTab').disabled=true;$('#projectTitle').textContent=name+' · 待比较';update();message('路径已加载，点击“比较”开始');},
  sync(task){staged=null;empty.hidden=true;$('.paths').hidden=false;$('#folderTab').disabled=false;for(const side of ['ref','test'])$('#comparison'+(side==='ref'?'Ref':'Test')).value=task.files?.[side]||task.roots[side];bar.hidden=!!task.reviewProject;update();}
 };
}

