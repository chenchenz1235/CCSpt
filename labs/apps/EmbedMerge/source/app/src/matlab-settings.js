import './matlab-settings.css';
const $=s=>document.querySelector(s);
export function installApplicationSettings({api,call,message,openNew,getTask,openReviewSettings,openFilters,layout,isAiActive,openPage,applySettings}){
 const dialog=document.createElement('dialog');dialog.id='matlabSettingsDialog';
 dialog.innerHTML='<h2>MATLAB 设置</h2><p>选择本机 MATLAB 的 matlab.exe。保存后对所有工程生效。</p><label>MATLAB 路径<div class="path-pick" id="matlabPathSlot"></div></label><div class="dialog-actions"><button id="detectMatlab">自动查找</button><button id="browseMatlab">浏览…</button></div><div id="matlabCandidates"></div><p id="matlabSettingsStatus" role="status"></p><p class="small">按实际函数与工具箱判断当前操作是否可用，不按年份限制。路径检查不会启动 MATLAB，也不代表许可证或模型比较验证通过。</p><div class="dialog-actions"><button id="closeMatlabSettings">关闭</button><button id="saveMatlabSettings" class="primary">保存配置</button></div>';
 document.body.append(dialog);const input=$('#matlabExe');$('#matlabPathSlot').append(input);input.placeholder='例如 D:\\MATLAB\\R2024b\\bin\\matlab.exe';
 const button=Object.assign(document.createElement('button'),{id:'matlabSettingsButton',textContent:'MATLAB 设置'});$('#toggleAI').before(button);
 const menu=Object.assign(document.createElement('button'),{id:'matlabSettingsMenu',textContent:'MATLAB 路径设置…'});$('#workbenchSettings .compact-menu-content').prepend(menu);
 const modelButton=Object.assign(document.createElement('button'),{id:'modelMatlabSettings',textContent:'设置 MATLAB 路径…'});$('#modelSettings').before(modelButton);
 const status=(text,error=false)=>{const n=$('#matlabSettingsStatus');n.textContent=text;n.classList.toggle('error-text',error);};
 const queuedActions=[];document.addEventListener('application-ai-ready',()=>{const jobs=queuedActions.splice(0);(async()=>{for(const job of jobs){try{await applySettings(job.section);}catch(e){message('设置应用未完成：'+e.message,true);}}})().catch(e=>message(e.message,true));});
 let loaded=false,dirty=false;const deferred=new Map();document.addEventListener('application-ai-idle',()=>{for(const [key,value]of deferred){const n=document.getElementById(key);if(n&&!n.disabled){n.value=value;deferred.delete(key);}}});
 input.addEventListener('input',()=>dirty=true);
 async function refresh(){const s=await call('applicationSettings',{action:'status',section:'matlab'});if(!dirty)input.value=s.path||'';status(s.valid?'已配置 '+(s.release||'MATLAB（版本待运行时确认）')+'：'+s.path:s.error||'尚未配置，可自动查找或浏览选择',!!s.error);loaded=true;return s;}
 async function openMatlab(){if(!dialog.open)dialog.showModal();if(!loaded||!dirty)await refresh();input.focus();}
 for(const b of [button,menu,modelButton])b.onclick=()=>openMatlab().catch(e=>status(e.message,true));
 $('#closeMatlabSettings').onclick=()=>dialog.close();
 $('#browseMatlab').onclick=async()=>{const p=await call('pickFile',{title:'选择 MATLAB 的 bin/matlab.exe'});if(p){input.value=p;dirty=true;status('路径已填入，点击“保存配置”生效');}};
 $('#detectMatlab').onclick=async()=>{try{status('正在查找本机安装位置…');const r=await call('applicationSettings',{action:'detect',section:'matlab'});const list=$('#matlabCandidates');list.replaceChildren();for(const candidate of r.candidates){const b=Object.assign(document.createElement('button'),{textContent:candidate.path});b.onclick=()=>{input.value=candidate.path;dirty=true;status('路径已填入，点击“保存配置”生效');};list.append(b);}if(r.candidates.length===1){input.value=r.candidates[0].path;dirty=true;}status(r.candidates.length?'找到 '+r.candidates.length+' 个位置，选择后保存':'未找到 MATLAB。已安装在自定义位置可浏览选择；尚未安装则需要先安装。');}catch(e){status(e.message,true);}};
 $('#saveMatlabSettings').onclick=async()=>{try{const r=await call('applicationSettings',{action:'configure',section:'matlab',path:input.value});dirty=false;input.value=r.path;status('已保存：'+r.path);message('MATLAB 路径已保存，所有工程使用此设置');}catch(e){status(e.message,true);}};
 const sections={matlab:openMatlab,comparison:async()=>{openNew();},ai:async()=>{$('#aiPanel').hidden=false;$('#aiOptions').open=true;},filters:openFilters,review:()=>openReviewSettings('review'),reviewProject:()=>openReviewSettings('reviewProject'),firmware:async()=>{$('#firmwareTool').click();},task:async()=>{await $('#taskBriefButton').onclick();},sharedChat:async()=>{$('#bindSharedChat').click();},layout:async()=>{$('#aiPanel').hidden=false;$('#aiOptions').open=true;},settings:async()=>{$('#workbenchSettings').open=true;}};
 const fixed=new Set(['refInput','testInput','taskName','createCopy','comparisonRef','comparisonTest','matlabExe','matlabExePath','aiProvider','aiEffort','maxCalls','maxChars','timeout','autoMatlab','hideMinor','search','fold','srProjectPath','srProjectCopy','srExecution','srTarget','srSide','srReviewScope','srDocument','srFilter','srFollowFile','briefObjective','briefConstraints','briefDecisions','sharedThreadId','sharedThreadName','extraExtensions','extraFolders']);
 function fields(){const found=new Map();for(const n of document.querySelectorAll('input,select,textarea')){
  let key=fixed.has(n.id)?n.id:null;
  if(n.closest('.firmware-dialog')&&n.name)key='firmware.'+n.name;
  if(n.closest('#fileFilterDialog'))key=n.dataset.fileFilter?'filter.'+n.dataset.fileFilter:n.id||null;
  if(n.closest('#sharedChatDialog')&&n.id)key=n.id;
  if(key&&n.type!=='password')found.set(key,n);
 }return found;}
 function describe(){return [...fields()].map(([key,n])=>({key,label:n.closest('label')?.childNodes[0]?.textContent?.trim()||n.getAttribute('aria-label')||key,type:n.type||n.tagName.toLowerCase(),value:n.type==='checkbox'?n.checked:n.value,disabled:n.disabled,...(n.tagName==='SELECT'?{options:[...n.options].map(o=>({value:o.value,label:o.textContent}))}:{}),...(n.min?{min:n.min}:{}),...(n.max?{max:n.max}:{})}));}
 async function command(a){
  if(a.action==='list')return {sections:[...Object.keys(sections),'home','folder','text','model','csplus','reviewResults'],fields:[...describe(),...layout.settingsFields()],note:'fill 只填写设置，不点击比较、保存工程、审核、编译、刷机或运行电机按钮。动态设置先 open 对应 section，再 list。MATLAB configure 会校验并保存全局路径。'};
  if(a.action==='open'&&['home','folder','text','model','csplus','reviewResults'].includes(a.section))return openPage(a.section,a.path,a.line);if(a.action==='apply'){if(a.section==='matlab')return call('applicationSettings',{action:'configure',section:'matlab',path:a.path||input.value});if(!['comparison','ai','layout','filters','task','sharedChat','review','reviewProject'].includes(a.section))throw Error('此页面没有可自动应用的设置');if(isAiActive()){queuedActions.push({section:a.section});return {status:'queued',section:a.section,note:'本轮回答结束后应用，当前尚未完成'};}return applySettings(a.section);}
  if(a.section&&!sections[a.section])throw Error('未知设置页面');if(['open','fill'].includes(a.action)&&['review','firmware','task','sharedChat'].includes(a.section)&&!getTask())throw Error('请先打开工程，再配置此项目相关设置');
  if(a.action==='open'){await sections[a.section||'settings']();return {status:'opened',section:a.section||'settings',fields:describe()};}
  if(a.action==='status')return {fields:describe()};
  if(a.action!=='fill'||!a.values||typeof a.values!=='object'||Array.isArray(a.values))throw Error('请提供要填写的设置项 values');
  if(a.section){const ids={matlab:'matlabSettingsDialog',comparison:'newDialog',filters:'fileFilterDialog',review:'skillReviewDialog',reviewProject:'reviewProjectDialog',task:'taskBriefDialog',sharedChat:'sharedChatDialog'};if(!ids[a.section]||!document.getElementById(ids[a.section])?.open)await sections[a.section]();}
  const map=fields(),changes=[],layoutValues={};
  for(const [key,value]of Object.entries(a.values)){if(key.startsWith('layout.')){layoutValues[key.slice(7)]=value;continue;}const n=map.get(key);if(!n)throw Error('当前没有此设置项：'+key+'；请先打开对应设置页');if(n.disabled&&key!=='aiProvider')throw Error('设置项当前不可编辑：'+key);if(n.type==='checkbox'){if(typeof value!=='boolean')throw Error(key+' 需要 true/false');}else if(n.tagName==='SELECT'){if(![...n.options].some(o=>o.value===value))throw Error(key+' 不是可选值');}else{if(typeof value!=='string'&&typeof value!=='number')throw Error(key+' 需要文字或数字');if(String(value).length>(n.maxLength>0?n.maxLength:8000))throw Error(key+' 内容过长');if(n.type==='number'&&(!Number.isFinite(Number(value))||(n.min&&Number(value)<Number(n.min))||(n.max&&Number(value)>Number(n.max))))throw Error(key+' 超出允许范围');}changes.push([key,n,value]);}
  if(Object.keys(layoutValues).length)layout.configure(layoutValues);
  const automatic=changes.find(([key])=>key==='autoMatlab');if(automatic)await call('settings',{autoMatlab:automatic[2],launch:false});
  for(const [key,n,value]of changes){if(n.disabled&&key==='aiProvider'){deferred.set(key,value);continue;}if(n.type==='checkbox')n.checked=value;else n.value=String(value);n.dispatchEvent(new Event('input',{bubbles:true}));if(['fold','hideMinor','srFilter','srFollowFile'].includes(key))n.onchange?.({target:n});}
  return {status:deferred.size?'queued_until_answer_finishes':'filled',saved:false,layoutSaved:layoutValues,deferred:Object.fromEntries(deferred),values:Object.fromEntries(changes.map(([k,n])=>[k,n.type==='checkbox'?n.checked:n.value])),note:'已填写到界面；需点击页面保存/应用按钮生效。没有启动比较、审核或硬件操作。'};
 }
 api.onEvent(({type,payload})=>{if(type==='open-matlab-settings')openMatlab().catch(e=>status(e.message,true));if(type==='matlab-settings-changed'){dirty=false;input.value=payload.path||'';status('已保存：'+payload.path);}if(type==='application-settings-request')command(payload.args).then(result=>call('applicationSettingsComplete',{id:payload.id,result}),e=>call('applicationSettingsComplete',{id:payload.id,error:e.message})).catch(e=>message(e.message,true));});
 refresh().catch(e=>status(e.message,true));return {command,openMatlab};
}
