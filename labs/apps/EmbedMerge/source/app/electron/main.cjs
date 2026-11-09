const {app,BrowserWindow,ipcMain,dialog,shell,Menu,clipboard}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
let win,workspace,agent,matlab,reviewWorkbench,sharedChat,reviewPreparing=false,reviewRunning=false,agentReady,matlabReady,matlabRefresh,closing=false,closeReady,frontendReady=false,rendererFailed=false,closeInProgress=false,autoJob,externalControl;
let matlabSettings,agentWorkspace;const settingsReplies=new Map(),nativeReplies=new Map();
function cancelNativeRequest(method){return method.includes('requestUserInput')?{answers:{}}:method.includes('permissions/')?{permissions:{},scope:'turn'}:method.includes('elicitation')?{action:'cancel',content:null}:{decision:'cancel'};}
function requestNativeInput(request){const id=require('node:crypto').randomUUID();return new Promise(resolve=>{nativeReplies.set(id,{resolve,method:request.method});notify('ai-user-request',{...request,id});});}
async function applicationSettings(args){
 if((!args.section||args.section==='matlab')&&['status','detect','configure'].includes(args.action))return matlabSettings.command(args);
 const id=require('node:crypto').randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{settingsReplies.delete(id);reject(Error('设置界面响应超时'));},15000);settingsReplies.set(id,{resolve,reject,timer});notify('application-settings-request',{id,args});});
}
const appRoot=path.resolve(__dirname,'..');
const dataRoot=process.env.EMBEDMERGE_DATA||path.join(app.isPackaged?path.dirname(process.execPath):appRoot,'data');
const fixtures=app.isPackaged?path.join(appRoot,'fixtures'):path.resolve(appRoot,'../new-project-kit/fixtures');
const helperRoot=app.isPackaged?path.join(process.resourcesPath,'helpers'):appRoot;
const logFile=path.join(dataRoot,'logs','embedmerge.log');
function log(e){try{fs.mkdirSync(path.dirname(logFile),{recursive:true});fs.appendFileSync(logFile,new Date().toISOString()+' '+String(e?.stack||e)+'\n');}catch{}}
function notify(type,payload){if(type==='ai-cancel-requests'){for(const r of nativeReplies.values())r.resolve(cancelNativeRequest(r.method));nativeReplies.clear();}if(type==='progress')externalControl?.noteProgress(payload);if(type==='review-progress'||type==='ai-phase')externalControl?.noteProgress({stage:payload.stage,detail:payload.detail||'',current:0,total:0});if(win&&!win.isDestroyed())win.webContents.send('event',{type,payload});if(type==='matlab-file-result'){const task=workspace.task;clearTimeout(matlabRefresh);matlabRefresh=setTimeout(async()=>{try{if(workspace.task===task)notify('matlab-results',await workspace.scan());}catch(e){log(e);}},150);}}
process.on('uncaughtException',e=>{log(e);dialog.showErrorBox('EmbedMerge 错误',e.message+'\n日志：'+logFile);});
process.on('unhandledRejection',log);
app.setName('EmbedMerge');
fs.mkdirSync(path.join(dataRoot,'runtime'),{recursive:true});app.setPath('userData',path.join(dataRoot,'runtime'));
if(!app.requestSingleInstanceLock())app.exit(0);
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
let agentProvider='codex',agentSwitch=Promise.resolve();
function getAgent(provider=agentProvider){
 const next=agentSwitch.then(async()=>{
  if(!['codex','claude'].includes(provider))throw Error('不支持的 AI 提供方');
  if(provider!==agentProvider){
   if(agent?.active||agent?.starting||reviewAgent?.busy||reviewPreparing||reviewRunning)throw Error('请先停止当前 AI 任务再切换提供方');
   await agent?.close();agent=undefined;agentReady=undefined;agentProvider=provider;
  }
  agentReady??=import(pathToFileURL(path.join(appRoot,provider==='claude'?'core/claude.mjs':'core/codex.mjs'))).then(module=>{
   const Backend=provider==='claude'?module.ClaudeBackend:module.CodexBackend;
   return agent=new Backend(agentWorkspace,(type,payload)=>{notify(type,payload);if(type==='ai-phase'||type==='ai-metrics')log(JSON.stringify({type,...payload}));},{applicationSettings,requestUser:requestNativeInput});
  }).catch(e=>{agentReady=undefined;throw e;});
  return agentReady;
 });agentSwitch=next.catch(()=>{});return next;
}
async function getShared(){sharedChat??=import(pathToFileURL(path.join(appRoot,'core/shared-chat.mjs'))).then(({SharedChat})=>new SharedChat(workspace,{notify}));return sharedChat;}
async function getReview(){reviewWorkbench??=import(pathToFileURL(path.join(appRoot,'core/review-workbench.mjs'))).then(({ReviewWorkbench})=>new ReviewWorkbench(workspace,{notify}));return reviewWorkbench;}
let reviewAgent;async function getReviewAgent(){const r=await getReview();const {ReviewAgent}=await import(pathToFileURL(path.join(appRoot,'core/review-agent.mjs')));return reviewAgent??=new ReviewAgent(workspace,r.exchange,notify,{requestUser:requestNativeInput});}
let originalPublisher;
let firmwareService;
async function getPublisher(){originalPublisher??=import(pathToFileURL(path.join(appRoot,'core/original-publisher.mjs'))).then(({OriginalPublisher})=>new OriginalPublisher(workspace));return originalPublisher;}
async function getMatlab(){matlabReady??=import(pathToFileURL(path.join(appRoot,'core/matlab.mjs'))).then(({MatlabBackend})=>matlab=new MatlabBackend(workspace,notify,helperRoot,{settings:matlabSettings}));return matlabReady;}
function autoMatlab(){
 if(!workspace.task||workspace.task.autoMatlab===false||autoJob||!workspace.inventory?.some(n=>n.matlab&&!n.nativeScript&&n.ref&&n.test))return;const id=workspace.task.id;
 autoJob=(async()=>{const results=await(await getMatlab()).compareAll();if(workspace.task?.id===id){notify('matlab-results',await workspace.scan());notify('matlab-state',{stage:results?.length?'MATLAB 独立比较完成':'MATLAB 版本缓存有效 / 无待比较文件',current:results?.length||0,total:results?.length||0,active:false});}})().catch(async e=>{log(e);try{if(workspace.task?.id===id)notify('matlab-results',await workspace.scan());}catch(err){log(err);}if(/已停止|已取消/.test(e.message))notify('matlab-state',{stage:e.message,current:0,total:0,active:false});else notify('matlab-batch-error',{message:e.message});}).finally(()=>{autoJob=null;notify('matlab-finished',{});});
}
async function taskResult(promise){const result=await promise;setTimeout(autoMatlab,100);return result;}
async function shutdown(){await reviewAgent?.close();await firmwareService?.stopAndWait();await externalControl?.close();await workspace?.persist();await Promise.race([agent?.close()||Promise.resolve(),new Promise(r=>setTimeout(r,1500))]);matlab?.close();if(sharedChat)await (await getShared()).close();closing=true;if(win&&!win.isDestroyed())win.destroy();app.quit();}
app.whenReady().then(async()=>{
  try{
    const {Workspace}=await import(pathToFileURL(path.join(appRoot,'core/workspace.mjs')));workspace=new Workspace(dataRoot,notify);
    const {MatlabSettings}=await import(pathToFileURL(path.join(appRoot,'core/matlab-settings.mjs')));matlabSettings=new MatlabSettings(dataRoot,notify);
    const {applicationAgentWorkspace}=await import(pathToFileURL(path.join(appRoot,'core/application-agent-workspace.mjs')));agentWorkspace=await applicationAgentWorkspace(workspace);
    const {ExternalControl}=await import(pathToFileURL(path.join(appRoot,'core/external-control.mjs')));
    const {FirmwareService}=await import(pathToFileURL(path.join(appRoot,'core/firmware-service.mjs')));
    firmwareService=new FirmwareService(workspace,{notify,runtimeRoot:process.env.EMBEDMERGE_FIRMWARE_RUNTIME||(app.isPackaged?path.join(process.resourcesPath,'helpers','firmware'):path.join(appRoot,'firmware-runtime'))});
    externalControl=new ExternalControl(workspace,{version:app.getVersion(),sharedChat:async args=>(await getShared()).command(args),notify:(type,payload)=>{if(type==='external-control'&&payload.action!=='context'&&win&&!win.isDestroyed()){if(win.isMinimized())win.restore();win.show();win.focus();}notify(type,payload);},ready:()=>frontendReady&&!rendererFailed&&!closing,
      firmware:firmwareService,occupied:()=>!!(agent?.active||agent?.starting||matlab?.running||autoJob||reviewPreparing||reviewRunning||reviewAgent?.busy||firmwareService?.busy)});
    ipcMain.handle('call',async(event,method,args={})=>{
      if(event.sender!==win.webContents)throw Error('无效窗口');
      try{
        if(firmwareService.busy&&!['firmware','externalStatus','externalComplete','rendererError','closeReady','frontendReady'].includes(method))throw Error('固件或电机任务执行中，请先等待完成或取消');
        const controlMutations=['create','createComparison','createFiles','fixture','resume','scan','refreshFiles','fileFilters','operateFiles','undoFileOperation','copyFile','update','save','reload','review','restore','csplusPair','settings','agentAsk','model','matlabRead','createReviewProject','skillReviewPrepare','skillReviewRun','skillReviewStart','skillReviewEdit','skillReviewPreview','skillReviewApplied','reviewExchange','skillReviewImport','skillReviewProposal','skillReviewDraft','skillReviewAdvice','originalPreview','originalCommit','sharedChat'];
        if(externalControl.blocksMutations&&controlMutations.includes(method)&&!externalControl.permits(method,args.controlRequestId))throw Error('Codex 外部调用正在操作当前窗口，请稍后重试');
        if(['create','createComparison','createFiles','fixture','resume','fileFilters','createReviewProject','skillReviewPrepare','skillReviewRun','skillReviewStart'].includes(method)&&(agent?.active||agent?.starting||matlab?.running||autoJob))throw Error('请先停止正在进行的 AI / MATLAB 任务，再切换任务或比较范围');
        if((reviewPreparing||reviewRunning||reviewAgent?.busy)&&['create','createComparison','createFiles','fixture','resume','fileFilters','createReviewProject','skillReviewPrepare','skillReviewRun','agentAsk'].includes(method))throw Error('参数审核正在准备或执行，请先停止或等待完成');
        switch(method){
          case 'aiRespond':{if(event.senderFrame!==win.webContents.mainFrame)throw Error('无效交互来源');const r=nativeReplies.get(args.id);if(!r)return false;nativeReplies.delete(args.id);r.resolve(args.result);return true;}
          case 'openAiUrl':{const url=new URL(args.url);if(!['https:','http:'].includes(url.protocol))throw Error('仅支持 HTTP/HTTPS 页面');await shell.openExternal(url.href);return true;}
          case 'applicationSettings':return applicationSettings(args);
          case 'applicationSettingsComplete':{if(event.senderFrame!==win.webContents.mainFrame)throw Error('无效设置来源');const p=settingsReplies.get(args.id);if(!p)return false;settingsReplies.delete(args.id);clearTimeout(p.timer);args.error?p.reject(Error(args.error)):p.resolve(args.result);return true;}
          case 'firmware':return externalControl.call('firmware',args);
          case 'createReviewProject':{externalControl.checkCancellation(args.controlRequestId);return workspace.createReviewProject(args.root,{createCopy:args.createCopy===true});}
          case 'skillReviewTargets':return {targets:(workspace.inventory||[]).filter(n=>n.kind==='file'&&/\.c$/i.test(n.rel)).map(n=>n.rel).sort((a,b)=>Number(!/matlab_variable\.c$/i.test(a))-Number(!/matlab_variable\.c$/i.test(b))||a.localeCompare(b))};
          case 'skillReviewReport':{const r=(await (await getReview()).snapshot()).runs.at(-1);if(!r?.reportHTML)throw Error('当前没有可打开的离线报告');const {guarded}=await import(pathToFileURL(path.join(appRoot,'core/workspace.mjs')));const root=path.join(workspace.taskRoot,'artifacts'),file=await guarded(root,path.relative(root,r.reportHTML));if(path.extname(file)!=='.html')throw Error('报告类型无效');const error=await shell.openPath(file);if(error)throw Error(error);return true;}
          case 'originalPreview':return (await getPublisher()).preview(args);
          case 'originalCommit':if(reviewAgent?.busy)throw Error('AI 审核正在执行，请先停止或等待完成');if(event.senderFrame!==win.webContents.mainFrame)throw Error('无效保存来源');if(agent?.active||agent?.starting||reviewRunning||reviewPreparing)throw Error('请先停止当前 AI / 审核任务');return (await getPublisher()).commit(args);
          case 'skillReviewImport':{const r=await getReview();r.ensureIdle();const {importReview}=await import(pathToFileURL(path.join(appRoot,'core/review-import.mjs')));await importReview(workspace,args);return r.snapshot();}
          case 'skillReviewDraft':return (await getReview()).draftInfo(args);
          case 'skillReviewProposal':return (await getReview()).setProposal(args);
          case 'skillReviewAdvice':return (await getReview()).acceptAdvice(args);
          case 'skillReviewSnapshot':return (await getReview()).snapshot();
          case 'skillReviewPrepare':externalControl.checkCancellation(args.controlRequestId);reviewPreparing=true;try{return await (await getReview()).prepare(args);}finally{reviewPreparing=false;}
          case 'skillReviewRun':return (await getReview()).run(args);
          case 'skillReviewStart':externalControl.checkCancellation(args.controlRequestId);return (await getReviewAgent()).start(args);
          case 'skillReviewStop':{if(reviewAgent?.busy)await reviewAgent.cancel();return (await getReview()).stop(args);}
          case 'reviewExchange':externalControl.checkCancellation(args.controlRequestId);return (await getReview()).command(args);
          case 'skillReviewEdit':return (await getReview()).edit(args);
          case 'skillReviewPreview':return (await getReview()).preview(args);
          case 'skillReviewApplied':return (await getReview()).applied(args);
          case 'sharedChat':if(agent?.active||agent?.starting)throw Error('请先停止软件内独立 AI 任务，再绑定或同步共享聊天');return (await getShared()).command(args);
          case 'frontendReady':frontendReady=true;rendererFailed=false;log('frontend ready');return true;
          case 'externalComplete':if(event.senderFrame!==win.webContents.mainFrame)throw Error('无效联动回执');return externalControl.complete(args);
          case 'externalStatus':return {...externalControl.status(),dataRoot};
          case 'externalCancel':return externalControl.call('cancel',args);
          case 'taskBrief':return externalControl.call('brief',args);
          case 'rendererError':log('renderer: '+String(args.message).slice(0,4000));return true;
          case 'closeReady':closeReady?.();return true;
          case 'init':return {tasks:await workspace.tasks(),fixtures,logFile,dataRoot,version:app.getVersion()};
          case 'pick':{const r=await dialog.showOpenDialog(win,{title:args.title||'选择工程目录',properties:['openDirectory']});return r.canceled?null:r.filePaths[0];}
          case 'browsePaths':{
            const requested=typeof args.path==='string'&&args.path.trim()?path.resolve(args.path):app.getPath('documents');
            const selected=fs.existsSync(requested)&&fs.lstatSync(requested).isFile()?requested:null;const current=selected?path.dirname(requested):requested;
            const entries=fs.readdirSync(current,{withFileTypes:true}).filter(d=>!d.isSymbolicLink()).map(d=>({name:d.name,kind:d.isDirectory()?'dir':'file'})).sort((a,b)=>(a.kind===b.kind?0:a.kind==='dir'?-1:1)||a.name.localeCompare(b.name,'zh-CN'));
            const locations=[app.getPath('documents'),...Array.from({length:26},(_,i)=>String.fromCharCode(65+i)+':\\').filter(p=>fs.existsSync(p))];
            return {current,parent:path.dirname(current),entries,locations,selected};
          }
          case 'createComparison':externalControl.checkCancellation(args.controlRequestId);return taskResult(workspace.createComparison(args.paths,args.name,args.options||{}));
          case 'operationInfo':return workspace.operationInfo(args);
          case 'operateFiles':case 'undoFileOperation':if(agent?.active||agent?.starting||matlab?.running||autoJob)throw Error('请先停止 AI / MATLAB 任务，再操作文件');return method==='operateFiles'?workspace.operateFiles(args):workspace.undoFileOperation(args.redo===true);
          case 'pickFile':{const r=await dialog.showOpenDialog(win,{title:args.title||'选择文件',properties:['openFile']});return r.canceled?null:r.filePaths[0];}
          case 'createFiles':return workspace.createFiles(args.files,args.name);
          case 'fixture':return taskResult(workspace.create({ref:path.join(fixtures,'ref'),test:path.join(fixtures,'test')},'示例 · 通讯协议与产品参数'));
          case 'create':return taskResult(workspace.create(args.roots,args.name||'电机工程比较',args.options||{}));
          case 'resume':{externalControl.checkCancellation(args.controlRequestId);const s=await workspace.resume(args.id);if(args.autoMatlab===false){workspace.task.autoMatlab=false;await workspace.persist();s.task.autoMatlab=false;}return taskResult(Promise.resolve(s));}
          case 'fileVersions':return workspace.fileVersions(args.taskId,args.rel);
          case 'refreshFiles':return workspace.refreshFiles(args);
          case 'scan':{const result=await workspace.scan({rel:args.rel});if(args.withMatlab&&!args.rel)setTimeout(autoMatlab,50);return result;}
          case 'settings':if(workspace.task?.mode==='direct-files')throw Error('文件直接比较不启用自动 MATLAB');workspace.task.autoMatlab=args.autoMatlab!==false;await workspace.persist();if(workspace.task.autoMatlab&&args.launch!==false)autoMatlab();return true;
          case 'fileFilters':return taskResult(workspace.setFileFilters(args.filters));
          case 'cancelScan':workspace.cancelled=true;return true;
          case 'pair':return workspace.pair(args.rel);
          case 'fileCopyInfo':return workspace.fileCopyInfo(args.rel,args.source);
          case 'copyFile':if(agent?.active||agent?.starting||matlab?.running||autoJob)throw Error('请先停止 AI / MATLAB 任务，再复制整个文件');return workspace.copyFile(args);
          case 'clipboardRead':{const text=clipboard.readText();if(Buffer.byteLength(text)>4*1024*1024)throw Error('剪贴板文本超过 4 MiB 上限');return text;}
          case 'clipboardWrite':if(typeof args.text!=='string'||Buffer.byteLength(args.text)>4*1024*1024)throw Error('剪贴板文本无效或过大');clipboard.writeText(args.text);return true;
          case 'csplusCompare':return workspace.csplusCompare(args);
          case 'csplusPair':return workspace.setCsplusPair(args);
          case 'update':return workspace.update(args);
          case 'save':return workspace.save(args.side,args.rel);
          case 'reload':return workspace.reload(args.side,args.rel);
          case 'review':return workspace.review(args);
          case 'backups':return workspace.backups(args.side,args.rel);
          case 'restore':return workspace.restore(args.side,args.rel,args.name);
          case 'revealWork':{if(!workspace.task)throw Error('请先创建任务');const folder=workspace.root(args.side),error=await shell.openPath(folder);if(error)throw Error('无法打开文件夹：'+folder+'；'+error);return {opened:true,path:folder};}
          case 'revealBackups':if(!workspace.task)throw Error('请先打开比较');{const dir=path.join(workspace.taskRoot,'backups');fs.mkdirSync(dir,{recursive:true});return shell.openPath(dir);}
          case 'log':return shell.openPath(path.dirname(logFile));
          case 'agentStatus':return (await getAgent(args.provider)).status();
          case 'agentLogin':{const backend=await getAgent(args.provider);const r=await backend.login();if(agentProvider==='claude')return r;const u=new URL(r.authUrl);if(u.protocol!=='https:'||!/(^|\.)(openai|chatgpt)\.com$/.test(u.hostname))throw Error('登录地址不是官方 HTTPS 域名');await shell.openExternal(u.href);return {status:'已打开官方登录页面'};}
          case 'agentAsk':return (await getAgent(args.provider)).ask(args);
          case 'agentStop':return agent?.stop();
          case 'model':return (await getMatlab()).compare(args);
          case 'matlabReportContent':{const r=workspace.task?.modelResults[args.rel],file=r?.unfilteredReport||r?.report;if(!file)throw Error('此文件尚无官方 HTML 报告');const {reportPreview}=await import(pathToFileURL(path.join(appRoot,'core/report-preview.mjs')));return reportPreview(path.join(workspace.taskRoot,'artifacts'),file);}
          case 'matlabReport':{const r=workspace.task?.modelResults[args.rel],file=r?.unfilteredReport||r?.report;if(!file)throw Error('此文件尚无可打开的官方 HTML 报告');const {guarded}=await import(pathToFileURL(path.join(appRoot,'core/workspace.mjs')));const root=path.join(workspace.taskRoot,'artifacts'),safe=await guarded(root,path.relative(root,file));if(path.extname(safe).toLowerCase()!=='.html')throw Error('仅允许打开任务内的官方 HTML 报告');const error=await shell.openPath(safe);if(error)throw Error(error);return true;}
          case 'matlabRead':return (await getMatlab()).read(args);
          case 'matlabStop':return (await getMatlab()).stop();
          default:throw Error('未知操作');
        }
      }catch(e){log(e);throw Error(e.message);}
    });
    win=new BrowserWindow({width:1560,height:980,minWidth:1080,minHeight:700,show:false,backgroundColor:'#eef1f5',title:'EmbedMerge',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.setMenuBarVisibility(false);
    Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'文件',submenu:[{label:'退出',accelerator:'Alt+F4',click:()=>win.close()},{label:'退出无响应界面（保留已有草稿）',click:()=>shutdown()}]}]));
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(e,url)=>{if(url!==win.webContents.getURL())e.preventDefault();});
    win.webContents.on('did-start-navigation',(_e,_url,_inPlace,isMain)=>{if(isMain)frontendReady=false;});
    win.webContents.on('did-fail-load',(_e,code,desc,url,isMain)=>{log(`load-failed ${code} ${desc} ${url}`);if(isMain&&code!==-3)rendererFailed=true;});
    win.webContents.on('console-message',(_e,d)=>{if(d.level==='error'||d.level===3)log('console '+d.message);});
    win.webContents.on('render-process-gone',(_,details)=>{rendererFailed=true;log('renderer-gone '+JSON.stringify(details));});
    win.on('unresponsive',()=>{rendererFailed=true;log('window unresponsive');});win.on('responsive',()=>{rendererFailed=false;});
    win.on('close',async e=>{
      if(closing)return;e.preventDefault();if(closeInProgress)return;closeInProgress=true;
      try{
      if(frontendReady&&!rendererFailed){try{await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{closeReady=null;reject(Error('界面没有响应草稿同步请求'));},1800);closeReady=()=>{clearTimeout(timeout);closeReady=null;resolve();};notify('prepare-close',{});});}catch(err){log(err);const r=await dialog.showMessageBox(win,{type:'warning',buttons:['保留已有草稿并退出','返回等待'],defaultId:0,cancelId:1,message:'界面没有响应，可以退出此窗口',detail:'已收到的草稿和磁盘任务会保留，尚未传回的最后编辑可能无法恢复。此次退出不会保存文件。'});if(r.response!==0)return;}}
      if(agent?.active||agent?.starting){const r=await dialog.showMessageBox(win,{type:'question',buttons:['停止并关闭','取消'],defaultId:0,cancelId:1,message:'AI 正在处理，关闭会停止本轮。'});if(r.response!==0)return;await agent.stop();}
      const dirty=[...workspace.buffers.values()].filter(b=>b.dirty);
      if(dirty.length&&frontendReady&&!rendererFailed){const r=await dialog.showMessageBox(win,{type:'question',buttons:['保留草稿并退出','全部保存后退出','取消'],defaultId:0,cancelId:2,message:`有 ${dirty.length} 个未保存工作缓冲区`,detail:workspace.task.mode?.startsWith('direct-')?'全部保存会先备份，再写回选中的原文件。保留草稿仅保存编辑内容。':'保留草稿后可在启动页恢复任务。保存只写工作副本。'});if(r.response===2)return;if(r.response===1){try{for(const b of dirty)await workspace.save(b.side,b.rel);}catch(err){dialog.showErrorBox('保存失败',err.message);return;}}}
      await shutdown();
      }catch(err){log(err);const r=await dialog.showMessageBox(win,{type:'error',buttons:['退出','取消'],defaultId:0,message:'关闭过程中出错',detail:err.message+'\n已有任务保留在 '+dataRoot});if(r.response===0){closing=true;win.destroy();app.quit();}}finally{closeInProgress=false;}
    });
    log('startup '+app.getVersion());await win.loadFile(path.join(appRoot,'dist/index.html'));win.show();log('window shown');
    await externalControl.start();log('external control ready');
    setTimeout(()=>{if(!frontendReady&&win&&!win.isDestroyed()){rendererFailed=true;log('frontend startup timed out');win.webContents.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent('<html lang="zh"><body style="font:16px Segoe UI;padding:50px"><h2>EmbedMerge 界面未能完成启动</h2><p>可以直接关闭窗口，已有任务会保留。</p><p>日志：'+logFile+'</p></body></html>')).catch(log);}},20000).unref();
  }catch(e){log(e);dialog.showErrorBox('EmbedMerge 启动失败',e.message+'\n日志：'+logFile);app.quit();}
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',()=>{externalControl?.close().catch(log);});
