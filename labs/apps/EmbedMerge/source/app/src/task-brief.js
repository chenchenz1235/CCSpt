import './task-brief.css';
export function createTaskBrief({api,call,getTask,onChanged,onError}){
  const button=document.createElement('button');button.id='taskBriefButton';button.textContent='任务要点';button.disabled=true;document.querySelector('#toggleAI').before(button);
  const dialog=document.createElement('dialog');dialog.id='taskBriefDialog';
  dialog.innerHTML='<h2>当前任务要点</h2><p>记录目标、约束和已确认决定，供后续对话继续使用。不会授权保存或修改工程文件。</p><label>任务目标<textarea id="briefObjective" maxlength="2000" rows="3"></textarea></label><label>约束（每行一条）<textarea id="briefConstraints" rows="4"></textarea></label><label>已确认决定（每行一条）<textarea id="briefDecisions" rows="4"></textarea></label><p id="briefError" class="error-text"></p><div class="dialog-actions"><button id="briefClose">关闭</button><button id="briefSave" class="primary">保存要点</button></div>';
  document.body.append(dialog);let current=null,jobActive=false;
  const q=s=>dialog.querySelector(s),lines=s=>s.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  button.onclick=async()=>{try{
    const task=getTask();if(!task)throw Error('请先打开比较任务');const r=await call('taskBrief',{taskId:task.id});current=r;
    q('#briefObjective').value=r.brief.objective;q('#briefConstraints').value=r.brief.constraints.join('\n');q('#briefDecisions').value=r.brief.decisions.join('\n');q('#briefError').textContent='';dialog.showModal();
  }catch(e){onError(e.message);}};
  q('#briefClose').onclick=()=>dialog.close();
  q('#briefSave').onclick=async()=>{const save=q('#briefSave');save.disabled=true;try{
    if(getTask()?.id!==current?.taskId)throw Error('任务已切换，请重新打开要点');
    const r=await call('taskBrief',{taskId:current.taskId,expectedRevision:current.brief.revision,patch:{objective:q('#briefObjective').value,constraints:lines(q('#briefConstraints').value),decisions:lines(q('#briefDecisions').value)}});
    onChanged(r);dialog.close();
  }catch(e){q('#briefError').textContent=e.message;}finally{save.disabled=false;}};
  api.onEvent(({type,payload})=>{if(type==='task-brief-changed'){onChanged(payload);refresh();}if(type==='external-job'){jobActive=['queued','running'].includes(payload.status);refresh();}});
  function refresh(){const task=getTask();button.disabled=!task||jobActive;button.title=task?.externalBrief?.objective||'保存本任务的目标、约束和决定';}
  refresh();return {refresh};
}
