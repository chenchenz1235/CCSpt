import fs from 'node:fs/promises';import path from 'node:path';import {oaPages,isMainUrl} from './common.mjs';
export async function query(browser,config,kind,keyword=''){
 if(!['waiting','sent'].includes(kind))throw Error('query accepts waiting (待发) or sent (已发).');
 const matches=oaPages(browser,config).filter(p=>isMainUrl(p.url(),config));if(matches.length!==1)throw Error('Keep exactly one OA main page open.');
 const p=matches[0],label=kind==='waiting'?'待发事项':'已发事项';
 if(!await p.getByText(label,{exact:true}).isVisible())await p.getByText('协同工作',{exact:true}).click({timeout:5000});
 await p.getByText(label,{exact:true}).click({timeout:5000});
 const f=p.frame('mainIframe');if(!f)throw Error('mainIframe not found; inspect this OA version.');
 await f.waitForURL(u=>u.searchParams.get('method')===(kind==='waiting'?'listWaitSend':'listSent'),{timeout:15000});
 await f.locator('body').waitFor();
 if(keyword){
  await f.locator('ul.common_search_condition [id$="_dropdown_text"]').first().click();
  await f.locator('a:visible').filter({hasText:/^标题$/}).click();await f.locator('#title').fill(keyword);await f.locator('a.seary-bar-btn').click();
  await f.waitForFunction(k=>{const cells=[...document.querySelectorAll('td[abbr="subject"]')];return cells.length>0&&cells.every(e=>e.innerText.includes(k));},keyword,{timeout:15000});
 }
 const rows=await f.locator('tr').evaluateAll(es=>es.filter(e=>e.querySelector('td[abbr="subject"]')).map(e=>Object.fromEntries([...e.querySelectorAll('td[abbr]')].filter(c=>c.getAttribute('abbr')!=='null').map(c=>[c.getAttribute('abbr'),c.innerText.replace(/\s+/g,' ').trim()]))));
 const result={time:new Date().toISOString(),kind,keyword,url:f.url(),scope:'Current page only. Verify total count and pagination. Empty keyword results may require manual inspection.',rows};
 await fs.mkdir(config.outputDir,{recursive:true});await fs.writeFile(path.join(config.outputDir,'last-query.json'),JSON.stringify(result,null,2));return result;
}
