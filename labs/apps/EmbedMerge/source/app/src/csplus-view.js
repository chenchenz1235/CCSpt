import './csplus.css';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stateNames={same:'配置项相同',equivalent:'单位换算相同',changed:'配置变化',added:'仅 test',removed:'仅 ref',mode:'模式变化',error:'读取失败'};
const rowNames={same:'相同',equivalent:'等值',changed:'不同',added:'test 特有',removed:'ref 特有'};
export function createCsplusView({call,show,onSnapshot,onText,onError,onContextChanged=()=>{}}){
  const tab=document.createElement('button');tab.id='csplusTab';tab.textContent='CS+ 配置';tab.disabled=true;document.querySelector('#fileTab').before(tab);
  const section=document.createElement('section');section.id='csplusView';section.hidden=true;document.querySelector('#comparison').append(section);
  const banner=document.createElement('div');banner.id='csplusBanner';banner.hidden=true;document.querySelector('#folderView').prepend(banner);
  let snapshot=null,selected=null,moduleId=null,result=null,request=0,layout='properties',family='scfg',mode='',showPairs=false,advanced=false,inactive=false,allChanged=false;
  const fail=e=>onError(e.message||String(e));
  const protect=fn=>async(...args)=>{try{await fn(...args);}catch(e){fail(e);}};
  const status=(state,label)=>`<span class="cs-status" data-state="${state}">${esc(label||stateNames[state]||state)}</span>`;
  function refreshBanner(){
    const pairs=snapshot?.pairs||[],pending=(snapshot?.unpaired.ref.length||0)+(snapshot?.unpaired.test.length||0);
    tab.disabled=!snapshot;tab.textContent='CS+ 配置'+(pairs.length?' · '+pairs.length:'');
    banner.hidden=!pairs.length&&!pending;
    banner.innerHTML=`<span><b>CS+ 配置</b> · ${pairs.length} 组已自动比较${pending?' · '+pending+' 个待配对文件':''}。文件树按路径排列，配置比较按配对关系执行。</span><button id="openCsplus">查看配置结果</button>`;
    banner.querySelector('button').onclick=protect(()=>open());
  }
  function pairsPanel(){
    const pairs=snapshot?.pairs||[],c=snapshot?.candidates||{ref:[],test:[]};
    return `<div class="cs-pair-panel"><h3>配置文件配对</h3><p>相同路径优先；不同名时，按唯一文件名、同目录唯一类型或两侧唯一类型自动配对。多个候选不猜测。</p><table class="cs-pair-table"><thead><tr><th>ref</th><th>test</th><th>依据 / 结果</th><th></th></tr></thead><tbody>${pairs.map((p,i)=>`<tr><td>${esc(p.ref)}</td><td>${esc(p.test)}</td><td>${esc(p.reason)}<br>${status(p.status)}${p.error?'<div class="error-text">'+esc(p.error)+'</div>':''}</td><td><button data-open-pair="${i}">查看</button>${p.manual?` <button data-remove-pair="${i}">恢复自动</button>`:''}</td></tr>`).join('')}</tbody></table>${['ref','test'].map(side=>snapshot?.unpaired[side].length?`<div class="cs-unpaired"><b>${side} 待配对</b>${snapshot.unpaired[side].map((p,i)=>`<button data-single="${side}:${i}">${esc(p)} · 单侧查看</button>`).join('')}</div>`:'').join('')}<div class="cs-pair-form"><label>ref 配置文件<select id="csPairRef"><option value="">选择文件</option>${c.ref.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select></label><label>test 配置文件<select id="csPairTest"><option value="">选择文件</option>${c.test.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join('')}</select></label><button id="csSavePair">保存配对并比较</button></div><p>手动配对随任务保存；不重命名文件。普通 C/H 等文件仍按相对路径比较。</p><div id="csPairError" class="error-text" role="alert"></div></div>`;
  }
  function modules(){return (result?.modules||[]).filter(m=>!mode||m.mode===mode).filter(m=>!allChanged||m.status!=='same'&&m.status!=='equivalent');}
  function navigation(){
    const list=modules(),chosen=list.find(m=>m.id===moduleId)||list[0];if(chosen)moduleId=chosen.id;
    return `<nav class="cs-nav" aria-label="CS+ 配置模块">${[...new Set(list.map(m=>m.category))].map(g=>`<details ${g===chosen?.category?'open':''}><summary>${esc(g)}</summary>${list.filter(m=>m.category===g).map(m=>`<button data-cs-module="${m.id}" aria-pressed="${m.id===chosen?.id}">${esc(m.title)}<small>${status(m.status)}</small></button>`).join('')}</details>`).join('')||'<p>当前筛选无模块</p>'}</nav>`;
  }
  function rowValue(m,r,side){const v=r[side];return `<td class="cs-value">${v?esc(v.text):`<span class="cs-muted">${m.presence[side==='ref'?0:1]?'— 此侧无此项':'未配置此模块'}</span>`}</td>`;}
  function detail(m){
    if(!m)return '<div class="cs-empty">当前范围没有配置项。</div>';
    const normal=m.rows.filter(r=>!r.advanced&&!r.inactive),extras=m.rows.filter(r=>r.advanced||r.inactive);
    const rows=m.rows.filter(r=>(advanced||!r.advanced)&&(inactive||!r.inactive));
    const warning=m.modeChanged?`<div class="cs-mode-warning">工作模式变化：${esc(m.refMode)} → ${esc(m.testMode)}。${m.related?'按共用硬件关联展示；':''}周期、触发等参数需结合各自模式核对，不据此推断功能等价。</div>`:'';
    return `<article class="cs-detail"><div class="cs-detail-heading"><h2>${esc(m.title)}</h2>${status(m.status)}</div><p class="cs-muted">${esc(m.refName||'ref 未配置')} → ${esc(m.testName||'test 未配置')}${m.mode?' · '+esc(m.mode):''}</p>${warning}<table class="cs-properties"><thead><tr><th>配置项</th><th>ref</th><th>test</th><th>结果</th></tr></thead><tbody>${rows.map(r=>`<tr data-state="${r.state}" class="${r.inactive?'cs-inactive':''}"><td>${esc(r.label)}${r.advanced?'<small class="cs-muted">选项名称待映射</small>':''}</td>${rowValue(m,r,'ref')}${rowValue(m,r,'test')}<td>${status(r.state,rowNames[r.state])}<button class="cs-evidence-button" data-proof="${esc(r.key)}">依据</button></td></tr>`).join('')||'<tr><td colspan="4">当前没有已映射的启用项；可展开其他选项。</td></tr>'}</tbody></table><div class="cs-options"><label><input type="checkbox" id="csAdvanced" ${advanced?'checked':''}>显示其他已选项（${extras.filter(r=>r.advanced&&!r.inactive).length}）</label><label><input type="checkbox" id="csInactive" ${inactive?'checked':''}>显示未启用项</label><span class="cs-muted">${normal.length} 个已映射项</span></div><div id="csProof" aria-live="polite"></div></article>`;
  }
  function overview(){
    const list=modules().filter(m=>m.category==='定时器');
    if(!list.length)return '<div class="cs-empty">当前文件没有定时器配置。可切换到模块属性。</div>';
    const summary=(m,s)=>!m.presence[s==='ref'?0:1]?'未配置此模块':m.rows.filter(r=>r[s]&&!r.inactive&&/分频|周期|间隔|比较时间/.test(r.label)).slice(0,3).map(r=>esc(r.label)+' '+esc(r[s].text)).join('<br>')||esc(m[s+'Mode']);
    return `<div class="cs-overview"><h2>定时器总览</h2><table class="cs-pair-table"><thead><tr><th>模块</th><th>ref</th><th>test</th><th>结果</th></tr></thead><tbody>${list.map(m=>`<tr><td><button data-cs-module="${m.id}">${esc(m.title)}</button></td><td>${summary(m,'ref')}</td><td>${summary(m,'test')}</td><td>${status(m.status)}</td></tr>`).join('')}</tbody></table>${detail(list.find(m=>m.id===moduleId)||list[0])}</div>`;
  }
  function render(){
    const pairs=snapshot?.pairs||[];
    const list=modules();if(!list.some(m=>m.id===moduleId))moduleId=list[0]?.id||null;
    section.innerHTML=`<div class="cs-top"><b>CS+ 配置比较</b><button id="csBack">‹ 文件夹</button><span class="spacer"></span><button id="csPairsToggle">配对关系 · ${pairs.length}</button>${selected?.ref===selected?.test&&selected?.ref?'<button id="csRawText">原文对比</button>':''}</div><div class="cs-file-controls"><div class="cs-family"><button data-cs-family="scfg" class="${family==='scfg'?'active':''}">单片机配置</button><button data-cs-family="mtpj" class="${family==='mtpj'?'active':''}">CC-RX 工程配置</button></div><label>文件对<select id="csPairSelect"><option value="">选择文件对</option>${pairs.map((p,i)=>`<option value="${i}" ${p.id===selected?.id?'selected':''}>${esc(p.ref)} ↔ ${esc(p.test)} · ${esc(stateNames[p.status]||'待比较')}</option>`).join('')}</select></label>${result?.modes?`<label>构建模式<select id="csMode"><option value="">全部模式</option>${[...new Set([...result.modes.ref,...result.modes.test])].map(v=>`<option ${mode===v?'selected':''}>${esc(v)}</option>`).join('')}</select></label>`:''}</div><div id="csPairs" ${showPairs?'':'hidden'}>${pairsPanel()}</div><div id="csBody">${result?`<div class="cs-result-meta"><span>ref：${esc(result.ref||'未配对')}<br>test：${esc(result.test||'未配对')}</span><span>MCU：${esc(result.devices[0]||'—')} ↔ ${esc(result.devices[1]||'—')}${result.deviceChanged?'<b class="error-text"> · 芯片型号不同</b>':''}${result.drafts.some(Boolean)?'<b> · 含未保存草稿</b>':''}</span></div><div class="cs-view-controls"><button data-layout="properties" class="${layout==='properties'?'active':''}">模块属性</button>${family==='scfg'?`<button data-layout="timers" class="${layout==='timers'?'active':''}">定时器总览</button>`:''}<label><input id="csChangedOnly" type="checkbox" ${allChanged?'checked':''}>只看变化模块</label><span class="cs-muted">已保存配置的比较；未执行编译 / 硬件验证</span></div>${layout==='timers'&&family==='scfg'?overview():`<div class="cs-layout">${navigation()}${detail(modules().find(m=>m.id===moduleId))}</div>`}${result.defaults.length?`<details class="cs-defaults"><summary>默认值差异 · ${result.defaults.length} 项（独立保存，不等同当前设置）</summary><table class="cs-pair-table"><tbody>${result.defaults.map(r=>`<tr><td>${esc(r.group)} / ${esc(r.label)}</td><td><pre>${esc(r.ref?.text||'未保存')}</pre></td><td><pre>${esc(r.test?.text||'未保存')}</pre></td></tr>`).join('')}</tbody></table></details>`:''}`:'<div class="cs-empty">选择配置文件对，或在“配对关系”中指定两侧文件。支持不同文件名。</div>'}</div>`;
    const q=s=>section.querySelector(s);
    q('#csBack').onclick=()=>document.querySelector('#folderTab').click();q('#csPairsToggle').onclick=()=>{showPairs=!showPairs;render();};
    q('#csRawText')?.addEventListener('click',protect(()=>onText(selected.ref)));
    q('#csPairSelect').onchange=protect(async e=>{const p=pairs[Number(e.target.value)];if(e.target.value!==''&&p)await load(p);});
    q('#csMode')?.addEventListener('change',e=>{mode=e.target.value;moduleId=null;render();});
    section.querySelectorAll('[data-cs-family]').forEach(b=>b.onclick=protect(async()=>{family=b.dataset.csFamily;mode='';moduleId=null;layout='properties';const p=pairs.find(p=>p.type===family);if(p)await load(p);else{selected=null;result=null;showPairs=true;render();}}));
    section.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>{layout=b.dataset.layout;render();});
    section.querySelectorAll('[data-cs-module]').forEach(b=>b.onclick=()=>{moduleId=b.dataset.csModule;render();});
    q('#csChangedOnly')?.addEventListener('change',e=>{allChanged=e.target.checked;render();});
    q('#csAdvanced')?.addEventListener('change',e=>{advanced=e.target.checked;render();});q('#csInactive')?.addEventListener('change',e=>{inactive=e.target.checked;render();});
    section.querySelectorAll('[data-proof]').forEach(b=>b.onclick=()=>{
      const m=modules().find(m=>m.id===moduleId)||modules()[0],r=m?.rows.find(r=>r.key===b.dataset.proof);if(!r)return;
      q('#csProof').innerHTML=`<div class="cs-proof"><h3>${esc(r.label)} · 文件依据</h3><div>${['ref','test'].map(side=>`<section><b>${side}</b>${r[side]?r[side].evidence.map(e=>`<p>${esc(e.file)} : ${e.line}</p><pre>${esc(e.id)}\n${esc(typeof e.raw==='object'?JSON.stringify(e.raw,null,2):e.raw)}</pre>`).join(''):'<p>未保存此项</p>'}</section>`).join('')}</div></div>`;
    });
    section.querySelectorAll('[data-open-pair]').forEach(b=>b.onclick=protect(()=>load(pairs[Number(b.dataset.openPair)])));
    section.querySelectorAll('[data-remove-pair]').forEach(b=>b.onclick=protect(async()=>{const p=pairs[Number(b.dataset.removePair)];onSnapshot(await call('csplusPair',{ref:p.ref,test:p.test,remove:true}));}));
    section.querySelectorAll('[data-single]').forEach(b=>b.onclick=protect(()=>{const [side,i]=b.dataset.single.split(':'),rel=snapshot.unpaired[side][Number(i)];return load({ref:side==='ref'?rel:null,test:side==='test'?rel:null,type:rel.toLowerCase().endsWith('.scfg')?'scfg':'mtpj',id:side+':'+rel,reason:'单侧查看'});}));
    q('#csSavePair').onclick=async()=>{try{const ref=q('#csPairRef').value,test=q('#csPairTest').value;if(!ref||!test)throw Error('请选择两侧文件');const s=await call('csplusPair',{ref,test});onSnapshot(s);showPairs=true;await load(s.csplus.pairs.find(p=>p.ref===ref&&p.test===test));}catch(e){q('#csPairError').textContent=e.message;}};
    onContextChanged();
  }
  async function load(p,preserve=false){
    if(!p)return;
    const previous=preserve?result?.modules.find(m=>m.id===moduleId):null,previousMode=mode;
    const token=++request;selected=p;family=p.type;result=null;onContextChanged();section.innerHTML='<div class="cs-empty">正在读取并比较配置…</div>';
    try{const r=await call('csplusCompare',{ref:p.ref,test:p.test});if(token!==request)return;result=r;mode=preserve&&r.modules.some(m=>m.mode===previousMode)?previousMode:'';moduleId=(previous&&r.modules.find(m=>m.refName===previous.refName&&m.testName===previous.testName))?.id||r.modules.find(m=>m.title==='CMT0'||m.title==='工程通用')?.id||null;render();}
    catch(e){if(token!==request)return;render();section.querySelector('#csBody').innerHTML=`<div class="cs-empty error-text">配置读取失败：${esc(e.message)}。请检查 EmbedMerge 授权或文件内容。</div>`;}
  }
  async function open(rel){
    if(await show()===false)return;
    const p=rel?snapshot?.pairs.find(p=>p.ref===rel||p.test===rel):snapshot?.pairs.find(p=>p.id===selected?.id)||snapshot?.pairs.find(p=>p.type===family)||snapshot?.pairs[0];
    if(p)await load(p);else{result=null;showPairs=true;render();}
  }
  tab.onclick=protect(()=>open());
  return {open,context(){return selected?{files:{ref:selected.ref||null,test:selected.test||null},moduleId, module:result?.modules.find(m=>m.id===moduleId)?.title}:null;},update(cs){if(snapshot===cs)return;snapshot=cs;refreshBanner();if(!section.hidden){if(selected?.ref||selected?.test){const p=cs?.pairs.find(p=>p.id===selected.id);if(p){if(!result||p.status==='error'||JSON.stringify(p.versions)!==JSON.stringify(result.versions))load(p,true).catch(fail);}else{request++;selected=null;result=null;showPairs=true;render();}}else render();}},setActive(active){tab.classList.toggle('active',active);}};
}
