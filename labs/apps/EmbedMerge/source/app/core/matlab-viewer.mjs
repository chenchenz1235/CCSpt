import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
// A single controller retains the official, version-specific shared COM server.
// No scripts are passed through a shell, and model paths are MATLAB-quoted.
const bridge=String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$matlab=$null
$launchPending=$false
$connection=[guid]::NewGuid().ToString()
$requests=0
function Quote-Matlab([string]$value){return "'"+$value.Replace("'","''")+"'"}
function Is-SessionFailure($exception){
 while($null -ne $exception){
  $code=([long]$exception.HResult -band 4294967295).ToString('X8')
  if($code -in @('800706BA','800706BE','80010108') -or $exception.Message -match '0x800706BA|0x800706BE|0x80010108'){return $true}
  $exception=$exception.InnerException
 }
 return $false
}
while($null -ne ($line=[Console]::ReadLine())){
 $request=$null
 try{
  $request=ConvertFrom-Json -InputObject $line
  if($request.action -eq 'close'){break}
  if($request.action -ne 'compare'){throw 'Unknown MATLAB viewer action'}
  $reused=$true
  $reconnected=$false
  # Probe the retained handle before dispatch. Reconnect only before executing
  # the comparison; an interrupted Execute is never replayed automatically.
  if($null -ne $matlab){
   try{$null=$matlab.Execute("builtin('fprintf','');")}
   catch{
    if(!(Is-SessionFailure $_.Exception)){throw}
    try{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($matlab)}catch{}
    $matlab=$null
    $reconnected=$true
   }
  }
  if($null -eq $matlab){
   try{$matlab=[Runtime.InteropServices.Marshal]::GetActiveObject('Matlab.Application.24.2');$null=$matlab.Execute("builtin('fprintf','');")}
   catch{
    if($launchPending){throw 'MATLAB was already started but is not yet available; check its desktop before retrying. No additional MATLAB was launched.'}
    $reused=$false
    $start=New-Object Diagnostics.ProcessStartInfo
    $start.FileName=$request.exe
    $start.Arguments='-nosplash -desktop -automation'
    $start.WorkingDirectory=[IO.Path]::GetDirectoryName($request.output)
    $start.UseShellExecute=$false
    $launchPending=$true
    try{[void][Diagnostics.Process]::Start($start)}catch{$launchPending=$false;throw}
    $deadline=[DateTime]::UtcNow.AddSeconds(280)
    while($null -eq $matlab){
     if([DateTime]::UtcNow -gt $deadline){throw 'MATLAB AutomationServer startup timed out; check MATLAB desktop, no second instance was started'}
     Start-Sleep -Milliseconds 400
     try{$matlab=[Runtime.InteropServices.Marshal]::GetActiveObject('Matlab.Application.24.2')}catch{}
    }
    $launchPending=$false
   }
  }
  $launchPending=$false
  $matlab.Visible=1
  $code='addpath('+ (Quote-Matlab $request.helpers) +');em_view_compare('+ (Quote-Matlab $request.left) +','+ (Quote-Matlab $request.right) +','+ (Quote-Matlab $request.output) +');'
  $console=$matlab.Execute($code)
  $requests++
  $reply=@{id=$request.id;ok=$true;connection=$connection;reused=$reused;reconnected=$reconnected;requests=$requests;console=[string]$console}
 }catch{$reply=@{id=$request.id;ok=$false;error=$_.Exception.Message;sessionFailure=(Is-SessionFailure $_.Exception);connection=$connection};$matlab=$null}
 [Console]::WriteLine((ConvertTo-Json -InputObject $reply -Compress -Depth 8))
}
if($null -ne $matlab){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($matlab)}
`;
export {bridge as matlabViewerBridge};
export function viewerError(reply){
 const disconnected=reply.sessionFailure||/800706ba|800706be|80010108|RPC 服务器不可用|RPC server is unavailable/i.test(reply.error||'');
 const error=Error(disconnected?'MATLAB 会话连接已断开（RPC/COM），本次官方窗口请求未确认完成；文件比较结论未改变。请确认 MATLAB R2024b 已就绪，再点“显示官方比较窗口”重新连接。原始错误：'+reply.error:'MATLAB 共享比较会话错误：'+reply.error);
 error.code=disconnected?'MATLAB_SESSION_DISCONNECTED':'MATLAB_VIEWER_ERROR';return error;
}
export class MatlabViewerSession{
 constructor(notify=()=>{},options={}){this.notify=notify;this.spawn=options.spawn||spawn;this.timeoutMs=options.timeoutMs||300000;this.pending=new Map();this.sequence=0;}
 ensure(){
  if(this.child)return;const exe=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');this.buffer='';this.stderr='';
  const child=this.spawn(exe,['-NoLogo','-NoProfile','-NonInteractive','-Sta','-EncodedCommand',Buffer.from(bridge,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','pipe']});this.child=child;
  const disconnected=e=>{if(this.child===child){this.child=null;this.inFlight=null;this.started=false;this.fail(e);}};
  child.stdout.setEncoding('utf8');child.stdout.on('data',s=>{if(this.child===child)this.receive(s);});child.stderr.on('data',b=>this.stderr=(this.stderr||'').slice(-2000)+b.toString());child.stdin.on('error',e=>disconnected(e));child.on('error',e=>disconnected(e));child.on('exit',code=>disconnected(Error(`MATLAB 会话控制器退出 ${code}：${this.stderr||''}`)));
 }
 receive(s){this.buffer+=s;if(this.buffer.length>4*1024*1024){this.fail(Error('MATLAB 控制消息超过限制'));return;}let at;while((at=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,at).trim();this.buffer=this.buffer.slice(at+1);if(!line)continue;let r;try{r=JSON.parse(line);}catch{this.fail(Error('MATLAB 会话控制器返回无效消息'));continue;}if(this.inFlight===r.id)this.inFlight=null;const pending=this.pending.get(r.id);if(!pending)continue;this.pending.delete(r.id);clearTimeout(pending.timer);if(r.ok)pending.resolve(r);else{if(r.sessionFailure)this.started=false;pending.reject(viewerError(r));}}}
 fail(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e);}this.pending.clear();}
 async open({left,right,helpers,taskRoot,expectedExe,isCancelled=()=>false}){
  if(this.active||this.inFlight)throw Error('MATLAB 仍在处理上一个官方比较，请等待完成；不会重复启动');this.active=true;this.cancelled=false;
  try{const job=path.join(taskRoot,'artifacts','matlab-viewer-'+randomUUID());await fs.mkdir(job,{recursive:true});if(this.cancelled||isCancelled())throw Error('MATLAB 官方比较启动已取消');this.ensure();const output=path.join(job,'result.json'),id=++this.sequence;this.notify('matlab-state',{stage:this.started?'复用 MATLAB R2024b 官方比较会话':'连接 MATLAB R2024b 共享比较会话',current:0,total:0,active:true});
   const response=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('MATLAB 官方比较请求超时；未重开 MATLAB，请检查已打开的窗口'));},this.timeoutMs);this.inFlight=id;this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,action:'compare',left,right,helpers,output,exe:expectedExe})+'\n');});
   await fs.writeFile(path.join(job,'controller.json'),JSON.stringify(response,null,2));let result;try{result=JSON.parse((await fs.readFile(output,'utf8')).replace(/^\uFEFF/,''));}catch{throw Error('MATLAB 未返回完整官方比较结果。控制日志：'+path.join(job,'controller.json')+'；'+response.console.slice(-1500));}
   if(expectedExe&&path.resolve(expectedExe).toLowerCase()!==path.resolve(result.matlabRoot,'bin','matlab.exe').toLowerCase())throw Error('注册的 R2024b COM 服务器与所选 MATLAB 路径不同，请核实安装注册');
   this.started=true;return {...result,reused:response.reused,reconnected:response.reconnected,connection:response.connection,evidence:output,job};
  }finally{this.active=false;this.notify('matlab-finished',{});}
 }
 cancel(){this.cancelled=true;this.fail(Error('已停止等待 MATLAB 官方比较；MATLAB 可能仍在完成该请求，不会重复启动'));}
 close(){this.cancel();const child=this.child;this.child=null;this.inFlight=null;if(child){try{child.stdin.end(JSON.stringify({action:'close'})+'\n');}catch{}const timer=setTimeout(()=>child.kill(),3000);timer.unref();child.once('exit',()=>clearTimeout(timer));child.unref();}}
}
