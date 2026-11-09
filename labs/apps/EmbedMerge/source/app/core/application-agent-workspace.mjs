import fs from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
// A settings conversation can exist before any customer project is opened.
export async function applicationAgentWorkspace(workspace){
 const taskRoot=path.join(workspace.dataRoot,'settings-assistant');await fs.mkdir(taskRoot,{recursive:true});
 const task={id:randomUUID(),name:'EmbedMerge 软件设置',mode:'application-settings',chat:[],records:{}};
 const buffers=new Map();return new Proxy(workspace,{get(target,key){
  if(target.task){const v=target[key];return typeof v==='function'?v.bind(target):v;}
  if(key==='task')return task;if(key==='taskRoot')return taskRoot;if(key==='inventory')return [];if(key==='buffers')return buffers;
  if(key==='persist')return async()=>{await fs.writeFile(path.join(taskRoot,'chat.json'),JSON.stringify(task.chat.slice(-40),null,2));};
  if(['evidence','open','file','pair','csplusSnapshot','csplusCompare'].includes(key))return async()=>{throw Error('尚未打开工程；当前只可使用 application_settings 配置软件');};
  const v=target[key];return typeof v==='function'?v.bind(target):v;
 }});
}
