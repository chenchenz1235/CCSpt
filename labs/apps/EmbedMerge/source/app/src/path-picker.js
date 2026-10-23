export function createPathPicker(call){
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return async function pick(initial=''){
    const dialog=document.createElement('dialog');dialog.id='pathPicker';
    dialog.innerHTML='<h2>选择文件或文件夹</h2><div class="picker-location"><select aria-label="位置"></select><button class="up">上一级</button></div><div class="picker-address"><input aria-label="当前路径" placeholder="输入路径后按 Enter"><button class="go">转到</button></div><div class="picker-list" role="listbox" aria-label="文件和文件夹"></div><p class="picker-status">单击选择；双击文件夹进入；双击文件直接选定。</p><p class="picker-error error-text"></p><div class="dialog-actions"><button class="cancel">取消</button><button class="choose primary">选择当前文件夹</button></div>';
    document.body.append(dialog);let current,parent,selected=null,loading=false;
    const $=s=>dialog.querySelector(s),finish=value=>{dialog.returnValue=value||'';dialog.close();};
    async function load(p){
      loading=true;$('.choose').disabled=true;$('.picker-error').textContent='';
      try{const result=await call('browsePaths',{path:p});current=result.current;parent=result.parent;selected=null;
        $('.picker-address input').value=current;$('.picker-location select').innerHTML=result.locations.map(p=>`<option value="${esc(p)}">${esc(p)}</option>`).join('');$('.picker-location select').value=result.locations.find(p=>current.toLowerCase().startsWith(p.toLowerCase()))||result.locations[0];
        $('.picker-list').innerHTML=result.entries.map((e,i)=>`<button type="button" role="option" aria-selected="false" data-index="${i}" data-kind="${e.kind}"><span>${e.kind==='dir'?'▰':'▪'}</span>${esc(e.name)}</button>`).join('');
        $('.choose').textContent='选择当前文件夹';$('.picker-status').textContent='单击选择；双击文件夹进入；双击文件直接选定。';
        $('.picker-list').onclick=e=>{const b=e.target.closest('[data-index]');if(!b)return;const item=result.entries[Number(b.dataset.index)];selected={path:current.replace(/[\\/]$/,'')+'\\'+item.name,kind:item.kind};$('.picker-list').querySelectorAll('button').forEach(n=>n.setAttribute('aria-selected',String(n===b)));$('.choose').textContent=item.kind==='dir'?'选择此文件夹':'选择此文件';$('.picker-status').textContent=selected.path;};
        $('.picker-list').ondblclick=e=>{const b=e.target.closest('[data-index]');if(!b||!selected)return;if(selected.kind==='dir')load(selected.path);else finish(selected.path);};
      }catch(e){$('.picker-error').textContent=e.message;}
      finally{loading=false;$('.choose').disabled=!current;}
    }
    $('.go').onclick=()=>load($('.picker-address input').value.trim());$('.picker-address input').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();$('.go').click();}};
    $('.picker-location select').onchange=e=>load(e.target.value);$('.up').onclick=()=>parent&&load(parent);$('.cancel').onclick=()=>finish(null);
    $('.choose').onclick=()=>{if(!loading&&current)finish(selected?.path||current);};
    const result=new Promise(resolve=>dialog.addEventListener('close',()=>{resolve(dialog.returnValue||null);dialog.remove();},{once:true}));
    dialog.showModal();await load(initial);return result;
  };
}
