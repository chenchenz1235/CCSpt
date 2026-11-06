import fs from 'node:fs/promises';import path from 'node:path';
import {loadConfig,connect,oaPages,choosePage,start,collectFrames,isMainUrl} from './common.mjs';
const [command='help',...args]=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
let browser;
try{
 if(command==='help'){console.log('OA Edge/CDP: start | status | tabs | capture [--url MATCH] | find TEXT [--url MATCH] | query waiting|sent [TITLE]');}
 else{
  if(!['start','status','tabs','capture','find','query'].includes(command))throw Error('Unknown command. Run help.');
  const config=await loadConfig();
  if(command==='start'){console.log(await start(config));}
  else{
   browser=await connect(config);const pages=oaPages(browser,config);
   if(['status','tabs'].includes(command)){
    console.log(JSON.stringify({connected:true,tabs:await Promise.all(pages.map(async p=>({url:p.url(),title:await p.title(),loginFormVisible:await p.locator('#login_button').isVisible(),signedInNavigation:await p.getByText('协同工作',{exact:true}).isVisible()})))},null,2));
   }else if(command==='query'){
    const {query}=await import('./query.mjs');console.log(JSON.stringify(await query(browser,config,args[0],args[1]||''),null,2));
   }else{
    const p=choosePage(pages,option('--url'));const frames=await collectFrames(p);
    if(command==='find'){
     if(!args[0]||args[0].startsWith('--'))throw Error('Provide text to find in the already loaded page.');
     console.log(JSON.stringify({query:args[0],hits:frames.flatMap(f=>f.text.split('\n').filter(t=>t.includes(args[0])).map(text=>({frame:f.url,text})))},null,2));
    }else{
     const out=path.join(config.outputDir,new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(out,{recursive:true});
     await fs.writeFile(path.join(out,'page.json'),JSON.stringify({time:new Date().toISOString(),url:p.url(),title:await p.title(),frames},null,2));
     console.log('Text saved to '+out);
     try{await p.screenshot({path:path.join(out,'page.png'),fullPage:true,timeout:15000});}catch{console.log('Screenshot unavailable; saved text remains valid.');}
    }
   }
  }
 }
}catch(e){console.error(e.message);process.exitCode=1;}finally{if(browser)await browser.close().catch(()=>{});}
