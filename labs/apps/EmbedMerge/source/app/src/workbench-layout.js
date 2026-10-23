import './workbench-layout.css';

const $=s=>document.querySelector(s);
const clamp=(v,min,max)=>Math.max(min,Math.min(v,max));
const number=(v,fallback)=>Number.isFinite(v)?v:fallback;
const storageKey='embedmerge.layout.v1';

// Move the original controls, keeping their event handlers and state intact.
export function createWorkbenchLayout({onLayout=()=>{},onContext=()=>{}}={}){
  function disclosure(id,title,parent){
    const d=document.createElement('details');d.id=id;d.className='compact-menu';
    const summary=document.createElement('summary');summary.textContent=title;d.append(summary);
    const content=document.createElement('div');content.className='compact-menu-content';d.append(content);parent.append(d);return content;
  }
  const settings=disclosure('workbenchSettings','设置',$('.toolbar'));
  settings.append($('#fileScope'),$('#autoMatlab').closest('label'),$('#stopMatlab'),$('#logs'));
  const filters=disclosure('statusFilters','更多筛选',$('#filters'));
  for(const name of ['error','pending','model'])filters.append($(`[data-filter="${name}"]`));
  filters.append($('#hideMinor').closest('label'));
  const folderActions=document.createElement('div');folderActions.className='folder-actions';
  folderActions.append($('#expand'),$('#collapse'));$('#search').after(folderActions);
  $('#expand').textContent='展开';$('#collapse').textContent='折叠';

  // Block arrows live between the editors; expose additional operations on demand.
  const advanced=document.createElement('div');advanced.id='textActions';advanced.hidden=true;$('#textView').append(advanced);
  advanced.append($('#mergeRight'),$('#mergeLeft'),$('#saveRef'),$('#saveTest'),$('#fold').closest('label'));
  $('.mergebar').append($('#toggleBlocks'));
  $('#moreFile').textContent='编辑与复制 ▾';
  $('#toggleBlocks').textContent='详细差异';
  $('#diffPanel').append($('.linebar'));
  $('#lineRight').textContent='单行 → 右侧';$('#lineLeft').textContent='← 单行到左侧';
  const textDetails=document.createElement('details');textDetails.id='textDetails';
  textDetails.innerHTML='<summary>文件信息与审阅</summary>';
  textDetails.append($('.filemeta'),$('#textView .reviewbar'));$('#textView').append(textDetails);
  const modelSettings=document.createElement('details');modelSettings.id='modelSettings';
  modelSettings.innerHTML='<summary>MATLAB 路径与说明</summary>';
  modelSettings.append($('#matlabExe').closest('label'),$('#modelView .model-content > p'));
  modelSettings.append(...document.querySelectorAll('#modelView .model-content > p'));
  $('#modelView .model-content > h2').after(modelSettings);
  const modelEvidence=document.createElement('details');modelEvidence.id='modelEvidence';
  modelEvidence.innerHTML='<summary>原始比较记录</summary>';
  $('#modelOutput').before(modelEvidence);modelEvidence.append($('#modelOutput'));
  const modelReview=document.createElement('details');modelReview.id='modelReviewDetails';
  modelReview.innerHTML='<summary>审阅记录</summary>';$('#modelReview').before(modelReview);modelReview.append($('#modelReview'));
  $('.welcome .eyebrow').textContent='工程比较';$('.welcome h1').textContent='比较工程，整理差异。';
  $('#demo').textContent='试用示例';$('#welcomeNew').textContent='选择两个工程';
  $('#excludedCount').title='被过滤的文件不参与比较，也不计入读取失败';
  $('#validation').title=$('#validation').textContent;$('#validation').textContent='未编译 / 仿真';
  document.querySelectorAll('.compact-menu').forEach(d=>{
    d.addEventListener('toggle',()=>{if(d.open)document.querySelectorAll('.compact-menu[open]').forEach(other=>{if(other!==d)other.open=false;});});
    d.addEventListener('click',e=>{if(e.target.closest('button'))d.open=false;});
  });
  document.addEventListener('pointerdown',e=>document.querySelectorAll('.compact-menu[open]').forEach(d=>{if(!d.contains(e.target))d.open=false;}));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('.compact-menu[open]').forEach(d=>d.open=false);});

  let saved={};try{saved=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{}
  let mode=['docked','floating','maximized'].includes(saved.mode)?saved.mode:'docked';
  let previousMode=saved.previousMode==='docked'?'docked':'floating';
  let dockWidth=number(saved.dockWidth,440),rect={x:number(saved.rect?.x,innerWidth-700),y:number(saved.rect?.y,110),width:number(saved.rect?.width,640),height:number(saved.rect?.height,620)};
  let fontSize=clamp(number(saved.fontSize,14),12,20),gesture=null;
  const panel=$('#aiPanel'),heading=$('.ai-heading');
  heading.title='拖动标题可浮动，双击标题放大或还原';heading.querySelector('b').textContent='⠿ Codex';
  const controls=document.createElement('div');controls.className='ai-window-actions';
  controls.innerHTML='<button id="floatAI" title="浮动面板，可拖动标题及边缘" aria-label="浮动 Codex 面板">浮动</button><button id="maximizeAI" title="放大 / 还原 Codex" aria-label="放大 Codex 面板">□</button>';
  controls.append($('#closeAI'));heading.append(controls);$('#closeAI').setAttribute('aria-label','收起 Codex 面板');
  const resize=document.createElement('div');resize.id='aiDockResize';resize.role='separator';resize.tabIndex=0;
  resize.setAttribute('aria-label','调整 Codex 侧栏宽度');resize.setAttribute('aria-orientation','vertical');panel.prepend(resize);
  for(const edge of ['n','s','w','e','nw','ne','sw','se']){const handle=document.createElement('div');handle.className='ai-resize-handle';handle.dataset.edge=edge;panel.append(handle);}
  const aiOptions=disclosure('aiOptions','设置',$('.ai-actions'));
  aiOptions.append($('#loginAI'),$('.effort-control'),$('.budget'));
  const font=document.createElement('div');font.className='ai-font-controls';
  font.innerHTML='<span>聊天字号</span><button id="smallerAI" aria-label="缩小聊天文字">A−</button><span id="aiFontSize"></span><button id="largerAI" aria-label="放大聊天文字">A＋</button>';
  aiOptions.append(font);$('.ai-actions').prepend($('#aiOptions'));
  const reset=document.createElement('button');reset.id='resetAiLayout';reset.className='ai-reset-layout';reset.textContent='恢复默认面板布局';reset.title='回到右侧停靠，恢复默认宽度与聊天字号';aiOptions.append(reset);
  $('#connectAI').textContent='连接 Codex';$('#question').placeholder='输入问题，Ctrl+Enter 发送';
  $('#question').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!e.isComposing){e.preventDefault();if(!$('#sendAI').disabled)$('#sendAI').click();}});
  $('.ai-connect').append($('#aiActivity'));
  const activity=$('#aiActivity');const activityVisibility=()=>{activity.hidden=activity.textContent==='尚未开始提问';};
  new MutationObserver(activityVisibility).observe(activity,{childList:true,characterData:true,subtree:true});activityVisibility();

  function constrain(){
    dockWidth=clamp(dockWidth,320,Math.max(320,Math.min(780,innerWidth-560)));
    rect.width=clamp(rect.width,Math.min(380,innerWidth-16),innerWidth-16);
    rect.height=clamp(rect.height,Math.min(460,innerHeight-24),innerHeight-24);
    rect.x=clamp(rect.x,8,innerWidth-rect.width-8);rect.y=clamp(rect.y,8,innerHeight-rect.height-8);
  }
  function persist(){try{localStorage.setItem(storageKey,JSON.stringify({mode,previousMode,dockWidth,rect,fontSize}));}catch{}}
  function apply(){
    constrain();panel.dataset.mode=mode;panel.classList.toggle('floating',mode==='floating');panel.classList.toggle('maximized',mode==='maximized');
    panel.style.width=mode==='docked'?dockWidth+'px':mode==='floating'?rect.width+'px':'';
    panel.style.height=mode==='floating'?rect.height+'px':'';panel.style.left=mode==='floating'?rect.x+'px':'';panel.style.top=mode==='floating'?rect.y+'px':'';
    panel.style.setProperty('--chat-font-size',fontSize+'px');$('#aiFontSize').textContent=fontSize+' px';
    $('#floatAI').textContent=mode==='docked'?'浮动':'停靠';$('#floatAI').setAttribute('aria-label',mode==='docked'?'浮动 Codex 面板':'停靠 Codex 面板');
    $('#maximizeAI').textContent=mode==='maximized'?'❐':'□';$('#maximizeAI').setAttribute('aria-label',mode==='maximized'?'还原 Codex 面板':'放大 Codex 面板');
    resize.setAttribute('aria-valuenow',Math.round(dockWidth));resize.setAttribute('aria-valuemin','320');resize.setAttribute('aria-valuemax',Math.max(320,Math.min(780,innerWidth-560)));
    $('#smallerAI').disabled=fontSize<=12;$('#largerAI').disabled=fontSize>=20;requestAnimationFrame(onLayout);
  }
  function setMode(next){mode=next;apply();persist();}
  function maximize(){if(mode==='maximized')setMode(previousMode);else{previousMode=mode;setMode('maximized');}}
  $('#floatAI').onclick=()=>setMode(mode==='docked'?'floating':'docked');$('#maximizeAI').onclick=maximize;
  $('#smallerAI').onclick=()=>{fontSize=Math.max(12,fontSize-1);apply();persist();};$('#largerAI').onclick=()=>{fontSize=Math.min(20,fontSize+1);apply();persist();};
  reset.onclick=()=>{fontSize=14;dockWidth=440;rect={x:innerWidth-700,y:110,width:640,height:620};setMode('docked');$('#aiOptions').open=false;};
  heading.addEventListener('dblclick',e=>{if(!e.target.closest('button'))maximize();});
  function finish(){if(!gesture)return;gesture=null;document.body.classList.remove('layout-dragging');persist();}
  function start(e,kind,edge=''){
    if(e.button!==0||e.target.closest('button,summary,input,select,textarea'))return;
    if(kind==='move'&&mode==='maximized')return;
    const box=panel.getBoundingClientRect();gesture={kind,edge,id:e.pointerId,x:e.clientX,y:e.clientY,box:{x:box.x,y:box.y,width:box.width,height:box.height},dockWidth};
    if(kind!=='move'||mode!=='docked'){e.preventDefault();document.body.classList.add('layout-dragging');}
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  heading.addEventListener('pointerdown',e=>start(e,'move'));
  resize.addEventListener('pointerdown',e=>start(e,'dock'));
  panel.querySelectorAll('[data-edge]').forEach(handle=>handle.addEventListener('pointerdown',e=>start(e,'resize',handle.dataset.edge)));
  document.addEventListener('pointermove',e=>{
    if(!gesture||gesture.id!==e.pointerId)return;const g=gesture,dx=e.clientX-g.x,dy=e.clientY-g.y;
    if(g.kind==='dock')dockWidth=g.dockWidth-dx;
    else if(g.kind==='move'){
      if(mode==='docked'){
        if(Math.hypot(dx,dy)<7)return;mode='floating';
        rect.x=e.clientX-Math.min(rect.width-50,g.x-g.box.x);rect.y=e.clientY-20;
        g.box={...rect};g.x=e.clientX;g.y=e.clientY;document.body.classList.add('layout-dragging');
      }else{rect.x=g.box.x+dx;rect.y=g.box.y+dy;}
    }else{
      const minW=Math.min(380,innerWidth-16),minH=Math.min(460,innerHeight-24),b=g.box;
      if(g.edge.includes('e'))rect.width=clamp(b.width+dx,minW,innerWidth-b.x-8);
      if(g.edge.includes('s'))rect.height=clamp(b.height+dy,minH,innerHeight-b.y-8);
      if(g.edge.includes('w')){rect.x=clamp(b.x+dx,8,b.x+b.width-minW);rect.width=b.x+b.width-rect.x;}
      if(g.edge.includes('n')){rect.y=clamp(b.y+dy,8,b.y+b.height-minH);rect.height=b.y+b.height-rect.y;}
    }
    apply();
  });
  document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);window.addEventListener('blur',finish);
  resize.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home'].includes(e.key)){e.preventDefault();dockWidth=e.key==='Home'?440:dockWidth+(e.key==='ArrowLeft'?20:-20);apply();persist();}});
  window.addEventListener('resize',()=>{finish();apply();});
  function show(visible=true){panel.hidden=!visible;$('#toggleAI').classList.toggle('active',visible);$('#toggleAI').setAttribute('aria-expanded',String(visible));if(visible){apply();onContext();}requestAnimationFrame(onLayout);}
  $('#toggleAI').onclick=()=>show(panel.hidden);$('#closeAI').onclick=()=>show(false);
  apply();return {show,apply};
}
