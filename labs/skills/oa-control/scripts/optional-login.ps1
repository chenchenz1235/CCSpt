param([ValidateSet('Setup','Login')][string]$Mode='Login',[switch]$Confirmed)
$ErrorActionPreference='Stop'
$taskRoot=Split-Path -Parent $PSScriptRoot
$taskSecretDir=Join-Path $taskRoot '.private'
$taskSecretFile=Join-Path $taskSecretDir 'oa-credential.xml'
try{
 if($Mode -eq 'Setup'){
  $taskUser=Read-Host 'OA username'
  if([string]::IsNullOrWhiteSpace($taskUser)){throw 'Missing username'}
  $taskPassword=Read-Host 'OA password (hidden)' -AsSecureString
  if($taskPassword.Length -eq 0){throw 'Missing password'}
  $taskCredential=[System.Management.Automation.PSCredential]::new($taskUser,$taskPassword)
  New-Item -ItemType Directory -Force -Path $taskSecretDir | Out-Null
  $taskCredential | Export-Clixml -LiteralPath $taskSecretFile
  Write-Output 'Optional credential saved for this Windows user and computer. No login submitted.'
  exit 0
 }
 if(-not $Confirmed){Write-Output 'Confirm login with the user first; then pass -Confirmed.';exit 2}
 if(-not(Test-Path -LiteralPath $taskSecretFile)){Write-Output 'Optional setup has not been performed. No login submitted.';exit 3}
 $taskCredential=Import-Clixml -LiteralPath $taskSecretFile
 if($taskCredential -isnot [System.Management.Automation.PSCredential]){throw 'Invalid credential'}
 $taskInfo=[System.Diagnostics.ProcessStartInfo]::new()
 $taskInfo.FileName=(Get-Command node.exe -ErrorAction Stop).Source
 $taskInfo.Arguments='"'+(Join-Path $PSScriptRoot 'optional-login.mjs')+'" --confirmed'
 $taskInfo.UseShellExecute=$false
 $taskInfo.CreateNoWindow=$true
 $taskInfo.RedirectStandardInput=$true
 $taskProcess=[System.Diagnostics.Process]::new()
 $taskProcess.StartInfo=$taskInfo
 [void]$taskProcess.Start()
 try{
  $taskPayload=@{username=$taskCredential.UserName;password=$taskCredential.GetNetworkCredential().Password}|ConvertTo-Json -Compress
  $taskProcess.StandardInput.Write($taskPayload)
  $taskProcess.StandardInput.Close()
  $taskPayload=$null;$taskCredential=$null
  $taskProcess.WaitForExit();$taskExitCode=$taskProcess.ExitCode
 }finally{$taskProcess.Dispose()}
 exit $taskExitCode
}catch{Write-Output 'Optional credential operation failed. No credentials are printed.';exit 1}
