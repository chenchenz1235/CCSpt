import {_electron as electron} from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'test-output','claude-ui-'+Date.now());
const shim=path.join(out,'fake-bin'),pkg=path.join(shim,'node_modules/@anthropic-ai/claude-code');await fs.mkdir(pkg,{recursive:true});
await fs.writeFile(path.join(pkg,'package.json'),JSON.stringify({name:'synthetic-claude-test-only',bin:{claude:'cli.cjs'}}));
await fs.writeFile(path.join(pkg,'cli.cjs'),String.raw`
if(process.argv.includes('--version')){console.log('synthetic-claude-test-only');process.exit(0);}
let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',async()=>{
 const question=JSON.parse(input).question;
 const emit=m=>console.log(JSON.stringify(m));
 if(question.includes('WAIT')){emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'SYNTHETIC_CLAUDE_WAIT'}}});setInterval(()=>{},1000);return;}
 const config=JSON.parse(process.argv[process.argv.indexOf('--mcp-config')+1]).mcpServers.embedmerge;
 const response=await fetch(config.url,{method:'POST',headers:{...config.headers,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'project_files',arguments:{action:'read',side:'test',rel:'src/protocol.c',count:3}}})});
 const r=await response.json();if(r.result.isError)throw Error(r.result.content[0].text);
 emit({type:'result',subtype:'success',result:'SYNTHETIC_CLAUDE_REPLY '+r.result.content[0].text});
});
`);
const env={...process.env,ELECTRON_RUN_AS_NODE:undefined,EMBEDMERGE_DATA:path.join(out,'data')};for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env.Path=shim+path.delimiter+process.env.PATH;
const app=await electron.launch({...(process.env.EMBEDMERGE_EXE?{executablePath:process.env.EMBEDMERGE_EXE,args:[]}:{args:[root]}),cwd:root,env});
const page=await app.firstWindow();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.locator('#demo').click();await page.locator('.tree-row[data-path="src"]').waitFor();await page.locator('#toggleAI').click();await page.locator('#aiProvider').selectOption('claude');
 await page.locator('#connectAI').click();await page.waitForFunction(()=>document.querySelector('#statusText').textContent.includes('synthetic-claude-test-only'));
 await page.locator('#question').fill('READ synthetic fixture');await page.locator('#sendAI').click();await page.waitForFunction(()=>document.querySelector('#chat').textContent.includes('SYNTHETIC_CLAUDE_REPLY')&&!document.querySelector('#sendAI').disabled);
 assert.match(await page.locator('#chat').textContent(),/Claude Code/);assert.match(await page.locator('#tools').textContent(),/project_files/);await page.screenshot({path:path.join(out,'claude-reply.png')});
 // Reproduce the existing regression: opening the review workbench must not
 // redirect ordinary AI cancellation to the review exchange's cancel method.
 await page.evaluate(()=>window.workbench.call('skillReviewSnapshot'));
 await page.locator('#question').fill('WAIT synthetic cancellation');await page.locator('#sendAI').click();await page.waitForFunction(()=>document.querySelector('#chat').textContent.includes('SYNTHETIC_CLAUDE_WAIT'));
 assert.equal(await page.locator('#aiProvider').isDisabled(),true);
 const switchError=await page.evaluate(async()=>{try{await window.workbench.call('agentStatus',{provider:'codex'});return '';}catch(e){return e.message;}});assert.match(switchError,/停止当前 AI/);
 await page.locator('#stopAI').click();await page.waitForFunction(()=>!document.querySelector('#sendAI').disabled);assert.match(await page.locator('#aiActivity').textContent(),/已停止/);assert.equal(await page.locator('#aiProvider').isDisabled(),false);assert.match(await page.locator('#question').inputValue(),/WAIT/);
 await page.locator('#aiProvider').selectOption('codex');assert.equal(await page.locator('#loginAI').textContent(),'个人账号登录');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'passed',checks:['provider selector','CLI entry discovery','MCP reads current task','provider-labelled history','stop after opening review','reject switch while busy','cancel restores question'],screenshots:out}));
}catch(e){await page.screenshot({path:path.join(out,'failure.png')});throw e;}finally{await app.evaluate(({app})=>app.exit());}
