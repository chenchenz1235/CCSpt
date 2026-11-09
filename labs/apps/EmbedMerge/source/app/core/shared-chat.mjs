import {CodexBackend} from './codex.mjs';
const allowed=new Set(['initialize','thread/read','thread/resume','thread/turns/list']);
const validate=id=>{if(typeof id!=='string'||!/^([a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}|thr_[A-Za-z\d_-]{1,100})$/i.test(id))throw Error('聊天 ID 格式无效');return id;};
const trim=(s,max=6000)=>typeof s==='string'?s.slice(0,max):'';
export function conversationMessages(turns){const messages=[];for(const t of [...turns].reverse()){for(const [index,item]of (t.items||[]).entries()){
 if(!['userMessage','agentMessage'].includes(item.type))continue;
 const text=item.type==='userMessage'?(item.content||[]).filter(c=>c.type==='text'||c.type==='input_text').map(c=>c.text||'').join('\n'):item.text;
 if(!text?.trim())continue;messages.push({id:t.id+':'+(item.id||index),turnId:t.id,role:item.type==='userMessage'?'user':'assistant',text:trim(text),truncated:text.length>6000,phase:item.phase||null,status:t.status||null});
 }}return messages;}
export class SharedChat {
 constructor(workspace,{connection,notify=()=>{}}={}){this.w=workspace;this.notify=notify;this.connection=connection||new CodexBackend(workspace);this.busy=false;this.sequence=0;
  const rpc=this.connection.rpc.bind(this.connection);this.rpc=(method,params)=>{if(!allowed.has(method))throw Error('共享同步禁止发起模型推理或修改历史');return rpc(method,params,30000);};
 }
 binding(){return this.w.task?.sharedChat||null;}
 assertTask(task){if(!task||task!==this.w.task)throw Error('工程任务已切换，共享结果未应用');}
 async exclusive(fn){if(this.busy)throw Error('共享聊天正在同步，请稍后重试');this.busy=true;try{return await fn();}finally{this.busy=false;}}
 async metadata(id){const r=await this.rpc('thread/read',{threadId:validate(id),includeTurns:false}),t=r.thread;if(t?.id!==id)throw Error('返回的聊天 ID 不一致');return {id:t.id,name:trim(t.name||'共享聊天',200),cwd:trim(t.cwd,1000),ephemeral:!!t.ephemeral,sourceStatus:t.status||null};}
 async probeMetadata(id){let result;try{const r=await this.rpc('thread/resume',{threadId:id,excludeTurns:true});if(r.thread?.id!==id)throw Error('续接返回了其他聊天');result={status:'resume-verified',resumable:true,message:'已验证可续接。为保持单写入，本窗口只同步显示，不自动发起推理。'};
  // A metadata probe must release the writer it acquired, including its process.
  await this.connection.close();await this.connection.connect();
 }catch(e){result={status:/already.*active writer/i.test(e.message)?'desktop-owned':'resume-failed',resumable:false,message:/already.*active writer/i.test(e.message)?'桌面 Codex 正在持有此聊天；本窗口只读同步，请回同一聊天继续。':'续接失败，未新建会话：'+trim(e.message,700)};}return {...result,checkedAt:new Date().toISOString(),modelTurnsStarted:0};}
 async bind({threadId}){return this.exclusive(async()=>{validate(threadId);const task=this.w.task;if(!task)throw Error('请先打开工程');await this.connection.connect();const metadata=await this.metadata(threadId),probe=await this.probeMetadata(threadId);this.assertTask(task);const binding={...metadata,...probe,mode:'shared-view',canSend:false,boundAt:new Date().toISOString()};const prior=task.sharedChat;task.sharedChat=binding;try{await this.w.persist();}catch(e){task.sharedChat=prior;throw e;}this.notify('shared-chat-changed',{taskId:task.id,binding});return {taskId:task.id,binding,modelTurnsStarted:0};});}
 async sync({cursor=null}={}){return this.exclusive(async()=>{const task=this.w.task,binding=this.binding();if(!binding)throw Error('当前工程尚未绑定共享聊天');await this.connection.connect();const metadata=await this.metadata(binding.id);const r=await this.rpc('thread/turns/list',{threadId:binding.id,limit:6,sortDirection:'desc',itemsView:'summary',...(cursor?{cursor}: {})});this.assertTask(task);if(this.binding()?.id!==binding.id)throw Error('聊天绑定已变化');return {taskId:task.id,binding:{...binding,...metadata},messages:conversationMessages(r.data||[]),nextCursor:r.nextCursor||null,modelTurnsStarted:0,syncedAt:new Date().toISOString(),note:'同步已保存的用户与助手消息；不复制工具输出、不重跑审核、不启动新推理。'};});}
 async probe(){return this.exclusive(async()=>{const task=this.w.task,binding=this.binding();if(!binding)throw Error('尚未绑定聊天');await this.connection.connect();const probe=await this.probeMetadata(binding.id);this.assertTask(task);task.sharedChat={...binding,...probe,canSend:false};await this.w.persist();this.notify('shared-chat-changed',{taskId:task.id,binding:task.sharedChat});return {taskId:task.id,binding:task.sharedChat,modelTurnsStarted:0};});}
 async unbind(){return this.exclusive(async()=>{const task=this.w.task;if(!task)throw Error('请先打开工程');const prior=task.sharedChat;delete task.sharedChat;try{await this.w.persist();}catch(e){task.sharedChat=prior;throw e;}await this.connection.close();this.notify('shared-chat-changed',{taskId:task.id,binding:null});return {taskId:task.id,binding:null};});}
 async command(args){switch(args.command||'status'){case 'status':return {taskId:this.w.task?.id,binding:this.binding(),modelTurnsStarted:0};case 'bind':return this.bind(args);case 'sync':return this.sync(args);case 'probe':return this.probe();case 'unbind':return this.unbind();default:throw Error('未知共享聊天操作');}}
 async close(){await this.connection.close();}
}
