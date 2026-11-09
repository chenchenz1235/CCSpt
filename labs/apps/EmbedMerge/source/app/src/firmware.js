import './firmware.css';

export function installFirmware({call,api,getTask,message}){
 const button=Object.assign(document.createElement('button'),{id:'firmwareTool',textContent:'固件与电机'});document.querySelector('#logs').before(button);
 let dialog,jobId,taskId,lastHash='',lastFile='',log;
 const write=value=>{if(log){log.textContent+=JSON.stringify(value,null,2)+'\n';log.scrollTop=log.scrollHeight;}};
 api.onEvent(({type,payload})=>{
  if(type==='firmware-event'&&payload.taskId===taskId){
   write(payload);const data=payload.data;
   if(payload.event==='result'&&data?.file_sha256){lastHash=data.file_sha256;lastFile=data.file;const file=dialog?.querySelector('[name=file]');if(file)file.value=lastFile;}
   if(payload.event==='result'&&data?.selected){dialog.querySelector('[name=file]').value=data.selected;lastHash='';}
   if(payload.event==='found'){
    for(const [key,val]of Object.entries({port:data.settings.port,appBaud:data.settings.baud,appParity:data.settings.parity}))dialog.querySelector(`[name=${key}]`).value=val;
    dialog.querySelector('[name=alreadyBoot]').checked=data.mode==='boot';
    if(data.mode==='boot'){dialog.querySelector('[name=bootBaud]').value=data.settings.baud;dialog.querySelector('[name=bootParity]').value=data.settings.parity;dialog.querySelector('[name=expectedId]').value=data.device.id;}
    if(data.connected_chip)dialog.querySelector('[name=route]').value=data.connected_chip==='drive'?'direct-drive':'via-interface';
   }
  }
  if(type==='firmware-job'&&payload.taskId===taskId){jobId=payload.id;write({status:payload.status,operation:payload.operation,error:payload.error});}
 });
 button.onclick=()=>{
  const task=getTask();if(!task){message('请先加载工程',true);return;}
  if(dialog){dialog.showModal();return;}
  taskId=task.id;dialog=document.createElement('dialog');dialog.className='firmware-dialog';
  dialog.innerHTML='<h2>固件更新与电机控制</h2><p>产物来自当前 TEST 工程的 DefaultBuild/only_app。先检查文件，确认升级计划后执行。</p><div class="fw-fields"><label>MTPJ 相对路径<input name="project" placeholder="project/工程.mtpj"></label><label>MOT / EM 路径<input name="file" placeholder="project/DefaultBuild/only_app/工程.mot"></label><label>串口<input name="port" placeholder="先自动探测"></label><label>App 波特率<input name="appBaud" type="number" value="9600"></label><label>Boot 波特率<input name="bootBaud" type="number" value="9600"></label><label>App 校验<select name="appParity"><option>N</option><option>E</option><option>O</option></select></label><label>Boot 校验<select name="bootParity"><option>N</option><option>E</option><option>O</option></select></label><label>升级路径<select name="route"><option>direct-drive</option><option>direct-interface</option><option>via-interface</option></select></label><label>预期产品 ID<input name="expectedId"></label><label>转速 rpm<input name="rpm" type="number"></label><label>演示上限 rpm<input name="maxRpm" type="number"></label><label>运行秒数（最多60）<input name="seconds" type="number"></label><label><input name="alreadyBoot" type="checkbox">已在 Bootloader</label><label><input name="eraseData" type="checkbox">同时擦除数据区</label><label><input name="forward" type="checkbox">经接口芯片控制驱动</label></div><div class="fw-actions"></div><pre class="fw-log"></pre><button class="fw-close">关闭</button>';
  document.body.append(dialog);log=dialog.querySelector('.fw-log');
  const value=name=>dialog.querySelector(`[name=${name}]`).value;
  const checked=name=>dialog.querySelector(`[name=${name}]`).checked;
  const args=()=>({taskId:getTask()?.id,project:value('project'),file:value('file'),artifact:lastFile===value('file')&&lastFile.includes('artifacts'),port:value('port'),appBaud:Number(value('appBaud')),bootBaud:Number(value('bootBaud')),appParity:value('appParity'),bootParity:value('bootParity'),route:value('route'),expectedId:value('expectedId'),expectedSha256:lastHash,alreadyBoot:checked('alreadyBoot'),eraseData:checked('eraseData'),forward:checked('forward'),rpm:Number(value('rpm')),maxRpm:Number(value('maxRpm')),seconds:Number(value('seconds'))});
  const invoke=async(operation,extra={})=>{try{taskId=getTask()?.id;const job=await call('firmware',{...args(),operation,...extra});jobId=job.id;write(job);}catch(e){message(e.message,true);}};
  const actions=dialog.querySelector('.fw-actions');
  for(const [label,op,extra,confirm]of[
   ['自动探测','discover',{},false],['查找 Boot MOT','artifact',{},false],['编译计划','build',{},false],['执行 CS+ 编译','build',{execute:true},true],['检查文件','inspect',{},false],['加密 MOT','encrypt',{},false],['模拟升级','simulate',{},false],['升级计划','flash',{},false],['执行升级','flash',{execute:true},true],['设置转速','motor',{action:'speed',execute:true},true],['运行并定时停止','motor',{action:'run',execute:true},true],['停止电机','motor',{action:'stop',execute:true},false]
  ]){const b=Object.assign(document.createElement('button'),{textContent:label});b.onclick=()=>{if(confirm&&!window.confirm(label+'：请核对当前工程、文件、串口及设备状态。'))return;invoke(op,extra);};actions.append(b);}
  const stop=Object.assign(document.createElement('button'),{textContent:'取消当前任务'});stop.onclick=()=>invoke('cancel',{jobId});actions.append(stop);
  dialog.querySelector('.fw-close').onclick=()=>dialog.close();dialog.showModal();
  call('firmware',{taskId,operation:'projects'}).then(result=>{write(result);if(result.projects.length===1)dialog.querySelector('[name=project]').value=result.projects[0];}).catch(e=>message(e.message,true));
 }
}
