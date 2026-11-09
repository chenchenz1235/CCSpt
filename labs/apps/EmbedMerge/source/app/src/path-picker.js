export function createPathPicker(call){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 return async function pick(initial=''){
  const dialog=document.createElement('dialog');dialog.id='pathPicker';
  dialog.innerHTML='<h2>选择文件或文件夹</h2><div class="picker-location"><select aria-label="位置"></select><button class="up">上一级</button></div><div class="picker-address"><input aria-label="当前路径" placeholder="输入路径后按 Enter"><button class="go">转到</button></div><div class="picker-list" role="listbox" aria-label="文件和文件夹"></div><p class="picker-status">单击选择；双击文件夹进入；双击文件直接选定。</p><p class="picker-error error-text"></p><div class="dialog-actions"><button class="system-dir">系统选择文件夹…</button><button class="system-file">系统选择文件…</button><button class="cancel">取消</button><button class="choose primary">选择当前文件夹</button></div>';
  document.body.append(dialog);let current,parent,selected=null,loading=false,valid=false,request=0,entries=[];
  const $=s=>dialog.querySelector(s),finish=value=>{request++;dialog.returnValue=value||'';dialog.close();};
  const itemPath=item=>current.replace(/[\\/]$/,'')+'\\'+item.name;
  async function load(p){
   const token=++request;loading=true;valid=false;selected=null;$('.choose').disabled=true;$('.picker-error').textContent='';$('.picker-list').setAttribute('aria-busy','true');
   try{const r=await call('browsePaths',{path:p});if(token!==request||!dialog.open)return;current=r.current;parent=r.parent;entries=r.entries;selected=r.selected?{path:r.selected,kind:'file'}:null;
    $('.picker-address input').value=current;$('.picker-location select').innerHTML=r.locations.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');$('.picker-location select').value=r.locations.find(p=>current.toLowerCase().startsWith(p.toLowerCase()))||r.locations[0];
    $('.picker-list').innerHTML=entries.map((e,i)=>`<button type="button" role="option" aria-selected="${!!selected&&itemPath(e)===selected.path}" data-index="${i}" data-kind="${e.kind}"><span>${e.kind==='dir'?'▰':'▪'}</span>${esc(e.name)}</button>`).join('');
    $('.choose').textContent=selected?'选择此文件':'选择当前文件夹';$('.picker-status').textContent=selected?.path||'单击选择；双击文件夹进入；双击文件直接选定。';valid=true;
   }catch(e){if(token===request)$('.picker-error').textContent=e.message+'；可修改路径、返回上一级或使用系统选择器。';}
   finally{if(token===request){loading=false;$('.choose').disabled=!valid;$('.picker-list').setAttribute('aria-busy','false');}}
  }
  $('.picker-list').onclick=e=>{if(loading||!valid)return;const b=e.target.closest('[data-index]');if(!b)return;const item=entries[Number(b.dataset.index)];selected={path:itemPath(item),kind:item.kind};$('.picker-list').querySelectorAll('button').forEach(n=>n.setAttribute('aria-selected',String(n===b)));$('.choose').textContent=item.kind==='dir'?'选择此文件夹':'选择此文件';$('.picker-status').textContent=selected.path;};
  function activate(e){if(loading||!valid)return;const b=e.target.closest('[data-index]');if(!b)return;const item=entries[Number(b.dataset.index)],p=itemPath(item);if(item.kind==='dir')load(p);else finish(p);}
  $('.picker-list').ondblclick=activate;$('.picker-list').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();activate(e);}};
  $('.go').onclick=()=>load($('.picker-address input').value.trim());$('.picker-address input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('.go').click();}};
  $('.picker-location select').onchange=e=>load(e.target.value);$('.up').onclick=()=>parent&&load(parent);$('.cancel').onclick=()=>finish(null);
  for(const [selector,method,title]of [['.system-dir','pick','选择文件夹'],['.system-file','pickFile','选择文件']])$(selector).onclick=async()=>{try{const p=await call(method,{title});if(p)finish(p);}catch(e){$('.picker-error').textContent=e.message;}};
  $('.choose').onclick=()=>{if(!loading&&valid&&current)finish(selected?.path||current);};
  const result=new Promise(resolve=>dialog.addEventListener('close',()=>{request++;resolve(dialog.returnValue||null);dialog.remove();},{once:true}));dialog.showModal();await load(initial);return result;
 };
}
