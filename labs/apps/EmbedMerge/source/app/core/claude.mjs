import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {CodexBackend,projectFileToolSpec} from './codex.mjs';
import {applicationSettingsSpec} from './matlab-settings.mjs';
import {claudePermissionTool,claudeAskUserTool,claudePermissionRequest,claudeAskUser} from './claude-permissions.mjs';
import {reviewCommandSpec} from './review-protocol.mjs';

export async function findClaude(){
 const candidates=[];
 for(const dir of (process.env.PATH||'').split(path.delimiter)){
  candidates.push(path.join(dir,'claude.exe'));
  // npm's Windows shim is a batch file; resolve the official entry without a shell.
  candidates.push(path.join(dir,'node_modules/@anthropic-ai/claude-code/bin/claude.exe'));
  const pkg=path.join(dir,'node_modules/@anthropic-ai/claude-code/package.json');
  try{const p=JSON.parse(await fs.readFile(pkg,'utf8')),bin=typeof p.bin==='string'?p.bin:p.bin?.claude;
   if(bin){const entry=path.resolve(path.dirname(pkg),bin);if(entry.startsWith(path.dirname(pkg)+path.sep)&&/\.(js|mjs|cjs)$/.test(entry))candidates.push({command:process.execPath,args:[entry]});}
  }catch{}
 }
 candidates.push(path.join(os.homedir(),'.local/bin/claude.exe'));
 for(const item of candidates){const spec=typeof item==='string'?{command:item,args:[]}:item;try{await fs.access(spec.args[0]||spec.command);return spec;}catch{}}
 throw Error('未找到 Claude Code，请先安装官方 CLI，并在终端完成 claude 登录');
}

export class ClaudeBackend extends CodexBackend {
 constructor(workspace,notify=()=>{},options={}){super(workspace,notify,options);this.label='Claude Code';this.provider='claude';this.find=options.find||findClaude;this.toolReplies=new Map();this.toolSeq=0;}
 async connect(){this.executable??=await this.find();}
 async capture(args){
  await this.connect();const spec=this.executable;
  return new Promise((resolve,reject)=>{
   const child=this.spawn(spec.command,[...(spec.args||[]),...args],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:spec.args?.length?'1':undefined}});
   let out='',err='';const timer=setTimeout(()=>{child.kill();reject(Error('Claude Code 状态查询超时'));},15000);
   child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',s=>{out+=s;if(out.length>128*1024){child.kill();reject(Error('Claude Code 状态输出过大'));}});child.stderr.on('data',s=>{err=(err+s).slice(-4000);});
   child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});child.stdin.on('error',()=>{});child.stdin.end();
  });
 }
 async status(){const r=await this.capture(['--version']);if(r.code!==0)throw Error(r.err||r.out||'无法启动 Claude Code');return {provider:'claude',version:r.out.trim(),model:'Claude Code 当前配置',account:{type:'Claude Code CLI'},notice:'沿用本机 Claude Code 工具、技能和配置；需要权限时在软件内确认'};}
 async login(){return {status:'请在终端运行 claude 完成登录，再点击连接检查；沿用现有服务配置'};}
 async thread(task){return 'claude-'+task.id;}
 send(message){const reply=this.toolReplies.get(message.id);if(reply){this.toolReplies.delete(message.id);message.error?reply.reject(Error(message.error.message)):reply.resolve(message.result);}}
 async tool(name,args,active){
  if(this.active!==active||active.stopped||this.workspace.task?.id!==active.taskId)throw Error('本轮已停止或任务已切换');
  if(name==='permission_prompt'||name==='ask_user'){const value=name==='permission_prompt'?await claudePermissionRequest(this,args,active):await claudeAskUser(this,args,active);return {content:[{type:'text',text:JSON.stringify(value)}],isError:false};}
  const id='claude-tool-'+(++this.toolSeq);
  const done=new Promise((resolve,reject)=>this.toolReplies.set(id,{resolve,reject}));
  this.handleRequest({id,method:'item/tool/call',params:{threadId:active.threadId,tool:name,arguments:args}}).catch(e=>{this.toolReplies.get(id)?.reject(e);this.toolReplies.delete(id);});
  const r=await done;return {content:r.contentItems.map(c=>({type:'text',text:c.text})),isError:!r.success};
 }
 async bridge(active){
  const token=randomBytes(32).toString('hex');let queue=Promise.resolve();
  const server=http.createServer(async(req,res)=>{
   const respond=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(value===undefined?'':JSON.stringify(value));};
   if(req.headers.origin||req.headers.authorization!=='Bearer '+token||req.url!=='/mcp')return respond(403,{error:'Forbidden'});
   if(req.method!=='POST')return respond(405,{error:'POST required'});
   let body='';try{
    for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8*1024*1024)throw Error('MCP request too large');}
    const m=JSON.parse(body);if(m.id===undefined)return respond(202);
    let result;
    if(m.method==='initialize')result={protocolVersion:m.params?.protocolVersion||'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'embedmerge',version:'1.0.0'}};
    else if(m.method==='ping')result={};
    else if(m.method==='tools/list')result={tools:[projectFileToolSpec,reviewCommandSpec,applicationSettingsSpec,claudePermissionTool,claudeAskUserTool]};
    else if(m.method==='tools/call'){
     // Serialize writes and budget checks, including parallel model tool calls.
     if(['permission_prompt','ask_user'].includes(m.params?.name))result=await this.tool(m.params.name,m.params.arguments||{},active);else{const work=queue.then(()=>this.tool(m.params?.name,m.params?.arguments||{},active));queue=work.catch(()=>{});result=await work;}
    }else return respond(200,{jsonrpc:'2.0',id:m.id,error:{code:-32601,message:'Unknown method'}});
    respond(200,{jsonrpc:'2.0',id:m.id,result});
   }catch(e){respond(400,{error:e.message});}
  });
  server.requestTimeout=15000;server.headersTimeout=10000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}/mcp`,token};
 }
 async rpc(method,params){
  if(method==='turn/interrupt'){this.child?.kill();return {};}
  if(method!=='turn/start')throw Error('Claude Code 不支持此 App Server 方法：'+method);
  const active=this.active,id=randomUUID();active.turnId=id;
  const bridge=await this.bridge(active),task=this.workspace.task,cwd=task.mode==='direct-project'?task.roots.test:task.mode==='direct-files'?path.dirname(task.files.test):task.mode==='project-copy'?this.workspace.root('test'):this.workspace.taskRoot;this.nativeCwd=cwd;
  const config={mcpServers:{embedmerge:{type:'http',url:bridge.url,headers:{Authorization:'Bearer '+bridge.token}}}};
  const args=['-p','--output-format','stream-json','--verbose','--include-partial-messages','--no-session-persistence','--mcp-config',JSON.stringify(config),'--allowedTools','mcp__embedmerge__project_files,mcp__embedmerge__review_command,mcp__embedmerge__application_settings,mcp__embedmerge__permission_prompt,mcp__embedmerge__ask_user','--permission-mode','default','--permission-prompt-tool','mcp__embedmerge__permission_prompt','--append-system-prompt','你在 EmbedMerge 中协助用户，使用本机 Claude Code 原生工具、技能和已配置 MCP，在正常权限规则及用户确认下完成请求。不要读取或输出凭据。application_settings 可打开页面、填写路径和应用设置；先 list 获取当前可用项。fill 仅填写，configure/apply 才保存或启动；queued 表示等待当前问答结束，不能声称已完成。需要用户补充信息时使用 mcp__embedmerge__ask_user。project_files 优先读取实时编辑缓冲区；原生文件操作前核对当前原件/副本、工作目录和未保存草稿。按当前用户任务工作，如实说明完成项和未验证项。'];
  if(['low','medium','high','xhigh','max'].includes(params.effort))args.push('--effort',params.effort);
  const spec=this.executable;let child;
  const cleanup=async()=>{bridge.server.closeAllConnections();await new Promise(r=>bridge.server.close(r));};
  try{child=this.spawn(spec.command,[...(spec.args||[]),...args],{cwd,stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:spec.args?.length?'1':undefined}});}catch(e){await cleanup();throw e;}
  this.child=child;let buffer='',stderr='',text='',resultSeen=false;const nativeTools=new Map();
  const complete=(status,error)=>{if(resultSeen)return;resultSeen=true;active.resolve({status,text,error});};
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stderr.on('data',s=>{stderr=(stderr+s).slice(-4000);});
  child.stdout.on('data',s=>{
   if(this.active!==active||active.stopped)return;
   buffer+=s;if(buffer.length>4*1024*1024){child.kill();complete('failed','Claude Code 消息超过 4 MiB 限制');return;}
   let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(!line.trim())continue;
    let m;try{m=JSON.parse(line);}catch{child.kill();complete('failed','Claude Code 输出不是有效 JSON');return;}
    if(m.type==='assistant')for(const item of m.message?.content||[]){if(item.type==='tool_use'&&!String(item.name).startsWith('mcp__embedmerge__')){nativeTools.set(item.id,item);this.notify('tool',{phase:'native-start',provider:'claude',tool:item.name,args:item.input});}}
    if(m.type==='user')for(const item of m.message?.content||[]){const tool=item.type==='tool_result'&&nativeTools.get(item.tool_use_id);if(tool&&!item.is_error){if(/^(Write|Edit|MultiEdit|NotebookEdit)$/i.test(tool.name))this.notify('ai-native-files',{changes:[{path:tool.input?.file_path||tool.input?.notebook_path||''}]});if(/^(Bash|PowerShell|REPL)$/i.test(tool.name))this.notify('ai-native-command',{});}}
    if(m.type==='result'&&m.permission_denials?.length)this.notify('tool',{phase:'permission-denied',provider:'claude',denials:m.permission_denials});
    if(m.type==='stream_event'&&m.event?.type==='content_block_delta'&&m.event.delta?.type==='text_delta'){
     const delta=m.event.delta.text;if(!text){this.timing.firstTextMs=Date.now()-this.timing.started;this.phase('Claude Code 正在输出');}text+=delta;this.notify('ai-delta',delta);
     if(text.length>200000){child.kill();complete('failed','Claude Code 回答超过长度限制');}
    }
    if(m.type==='result'){text=m.result||text;complete(m.is_error||m.subtype!=='success'?'failed':'completed',m.is_error?(m.errors||[m.result||'Claude Code 执行失败']).join('\n'):undefined);}
   }
  });
  child.stdin.on('error',e=>{if(!active.stopped)complete('failed',e.message);});
  child.on('error',e=>complete('failed',e.message));
  child.on('close',code=>{if(!resultSeen&&!active.stopped)complete('failed',stderr||'Claude Code 未返回完整结果，退出码 '+code+'；请先在终端验证 claude -p 能正常回答，再重新连接');if(this.child===child)this.child=null;cleanup().catch(()=>{});});
  child.stdin.end(params.input[0].text);if(active.stopped)child.kill();
  this.phase('Claude Code 已启动，等待模型响应');return {turn:{id}};
 }
 async close(){await this.stop();this.child?.kill();for(const p of this.toolReplies.values())p.reject(Error('Claude Code 连接已关闭'));this.toolReplies.clear();this.threads.clear();}
}
