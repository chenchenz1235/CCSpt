export const claudePermissionTool={name:'permission_prompt',description:'Permission callback used by the Claude Code CLI. Display the exact requested tool and input to the user, and return only their decision. Does not execute a tool or alter persistent permission rules.',inputSchema:{type:'object',properties:{tool_name:{type:'string'},input:{type:'object',additionalProperties:true},tool_use_id:{type:'string'}},required:['tool_name','input'],additionalProperties:true}};
export const claudeAskUserTool={name:'ask_user',description:'Ask the user for missing information in the EmbedMerge UI. Use when clarification is needed. Each question has id, question and optional options.',inputSchema:{type:'object',properties:{questions:{type:'array',items:{type:'object',properties:{id:{type:'string'},question:{type:'string'},options:{type:'array',items:{type:'string'}}},required:['id','question'],additionalProperties:false}}},required:['questions'],additionalProperties:false}};
export async function claudePermissionRequest(backend,args,active){
 if(backend.active!==active||active.stopped)throw Error('Claude Code 本轮已停止');
 if(typeof args.tool_name!=='string'||!args.input||typeof args.input!=='object'||Array.isArray(args.input))throw Error('无效的 Claude Code 权限请求');
 if(!backend.requestUser)throw Error('Claude Code 权限确认界面尚未连接');
 const nativeName=args.tool_name,writeTool=/^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(nativeName),toolInput=structuredClone(args.input);
 const result=await backend.requestUser({provider:'claude',requestId:args.tool_use_id||'claude-permission-'+(++backend.toolSeq),method:writeTool?'item/fileChange/requestApproval':'item/commandExecution/requestApproval',params:{threadId:active.threadId,turnId:active.turnId,tool:nativeName,input:toolInput,command:toolInput.command||null,cwd:backend.nativeCwd,reason:'Claude Code 请求使用 '+nativeName+'，请核对具体参数',availableDecisions:['accept','decline']}});
 if(backend.active!==active||active.stopped)return {behavior:'deny',message:'本轮已停止',interrupt:true};
 if(result.decision==='accept')return {behavior:'allow',updatedInput:toolInput,updatedPermissions:[]};
 return {behavior:'deny',message:'用户拒绝了本次 '+nativeName+' 请求',interrupt:result.decision==='cancel'};
}
export async function claudeAskUser(backend,args,active){
 if(backend.active!==active||active.stopped)throw Error('Claude Code 本轮已停止');
 if(!Array.isArray(args.questions)||!args.questions.length||args.questions.length>3)throw Error('每次请提出 1 至 3 个问题');
 const seen=new Set();for(const q of args.questions){if(typeof q.id!=='string'||!q.id||seen.has(q.id)||typeof q.question!=='string'||!q.question.trim())throw Error('问题需要唯一 id 和有效内容');seen.add(q.id);}
 if(!backend.requestUser)throw Error('Claude Code 用户输入界面尚未连接');
 const result=await backend.requestUser({provider:'claude',requestId:'claude-question-'+(++backend.toolSeq),method:'item/tool/requestUserInput',params:{threadId:active.threadId,turnId:active.turnId,questions:args.questions.map(q=>({...q,header:'补充信息',options:q.options?.map(label=>({label,description:''}))}))}});
 if(backend.active!==active||active.stopped)throw Error('Claude Code 本轮已停止');return result;
}
