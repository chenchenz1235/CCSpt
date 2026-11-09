// Every navigation runs through the existing view functions and is acknowledged
// only after rendering. No alternate file tree, editor, or config UI is created.
export function installExternalControl({api,call,unavailable,compare,reviewProject,resume,context,open,folder,review,onJob=()=>{}}){
  const stop=document.createElement('button');stop.id='stopExternalJob';stop.hidden=true;stop.textContent='停止外部任务';document.querySelector('footer').append(stop);
  let jobId=null;
  stop.onclick=async()=>{if(!jobId)return;stop.disabled=true;try{await call('externalCancel',{jobId});}catch(e){stop.title=e.message;stop.disabled=false;}};
  api.onEvent(({type,payload})=>{
    if(type==='external-job'){
      onJob(payload);
      if(['queued','running'].includes(payload.status)){jobId=payload.id;stop.hidden=false;stop.disabled=!!payload.cancelRequested;stop.textContent=payload.cancelRequested?'正在停止…':'停止外部任务';}
      else if(jobId===payload.id){jobId=null;stop.hidden=true;stop.disabled=false;}
      return;
    }
    if(type!=='external-control')return;
    (async()=>{
      try{
        const reason=unavailable(payload.action);if(reason)throw Error(reason);
        let result;
        if(payload.action==='compare')result=await compare(payload.args,payload.requestId);
        else if(payload.action==='review-project')result=await reviewProject(payload.args,payload.requestId);
        else if(payload.action==='resume')result=await resume(payload.args,payload.requestId);
        else if(payload.action==='context')result=await context();
        else if(payload.action==='review')result=await review(payload.args,payload.requestId);
        else if(payload.action==='open')result=await open(payload.args);
        else if(payload.action==='folder')result=await folder();
        else throw Error('未知窗口联动请求');
        if(!result)throw Error('窗口未完成请求，未报告成功');
        // Hidden/occluded windows can suspend animation frames; DOM/view work above is already complete.
        await new Promise(resolve=>setTimeout(resolve,0));
        await call('externalComplete',{requestId:payload.requestId,result});
      }catch(e){await call('externalComplete',{requestId:payload.requestId,error:e.message});}
    })();
  });
}
