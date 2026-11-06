# 可选参考：Windows 本机加密登录

**不是默认或推荐方式。** 默认先人工登录，再用脚本连接 Edge。只有使用者明确需要“不在电脑旁也能确认登录”时，才考虑本方法；是否启用、适用环境和安全风险由使用者自行评估。

## 方法

在 Windows 下把 PSCredential 用 Export-Clixml 保存，密码由 DPAPI 加密并绑定当前 Windows 用户与电脑。首次自行配置一次：

```powershell
powershell.exe -NoProfile -File scripts/optional-login.ps1 -Mode Setup
```

账号与密码在本机输入，密码隐藏显示；保存到本技能目录 `.private/oa-credential.xml`，不放到聊天和仓库。
后续每次先在聊天中确认允许本次登录，然后执行：

```powershell
powershell.exe -NoProfile -File scripts/optional-login.ps1 -Mode Login -Confirmed
```

脚本连接/启动配置中的 Edge，通过私有 stdin 管道把凭据交给登录脚本，只向配置站点填写；不把密码放命令参数或日志。确认参数是操作约定，不是身份验证或访问控制。登录失败不自动重试，额外验证码/身份验证仍需处理。

## 使用前需理解的边界

DPAPI 保护的是凭据文件在磁盘上的密码，不隔离同一 Windows 账号下的进程，也不保护解密后进程内存。用户名可能以可读字段保存在 XML 中；它不是一个完整加密保险库。
CDP 端口是浏览器控制入口，只绑定本机，仍可被能访问本机端口的进程使用。专用浏览器资料可能保留 Cookie 和登录状态。
OA 是否使用 HTTPS、电脑是否被其他程序控制、AI 能执行哪些脚本，由使用者结合自己的环境决定；这些不是加密文件能解决的问题。不以“密码文件已加密”宣称整体安全。

## 验证范围

本机既有版本已实测加密保存及自动登录，并核对登录后页面；本公开版本去除了个人地址/路径，配置和基本控件测试使用本地模拟页面，不是另一套 OA 的生产验证。
不要上传 .private、.edge-profile、config.local.json 或 .state。忽略规则只能减少误提交，不是数据访问控制。

官方参考：[Export-Clixml 与 Windows 凭据加密](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/export-clixml?view=powershell-7.5)、[DPAPI 的账号与电脑保护边界](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)、[浏览器调试端口与 Cookie 窃取风险的公开说明](https://developer.chrome.com/blog/remote-debugging-port)。后者说明 Chrome 的攻击案例，不代表已证明某个 Edge/OA 版本存在特定漏洞。
