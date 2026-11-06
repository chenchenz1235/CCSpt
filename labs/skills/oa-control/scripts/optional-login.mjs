import {loadConfig,start,connect,oaPages,isMainUrl} from './common.mjs';
let browser;
async function main(){
 if(!process.argv.includes('--confirmed'))throw Error('Not confirmed');
 const config=await loadConfig();let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16384)throw Error('Invalid credential input');}
 let credential=JSON.parse(raw);raw='';if(typeof credential.username!=='string'||typeof credential.password!=='string'||!credential.username||!credential.password)throw Error('Missing credential');
 await start(config);for(let n=0;n<15;n++){try{browser=await connect(config);break;}catch{await new Promise(r=>setTimeout(r,500));}}
 if(!browser)throw Error('Not connected');let page;for(let n=0;n<20;n++){const candidates=oaPages(browser,config).filter(p=>isMainUrl(p.url(),config));if(candidates.length>1)throw Error('Ambiguous login page');page=candidates[0];if(page)break;await new Promise(r=>setTimeout(r,500));}
 if(!page)throw Error('No login page');await page.waitForLoadState('domcontentloaded');
 if(await page.getByText('协同工作',{exact:true}).isVisible()){console.log('OA is already signed in.');return;}
 await page.locator('#login_button').waitFor({timeout:15000});
 if(!isMainUrl(page.url(),config))throw Error('Unexpected login destination');
 // Never print errors from fill(): call logs may contain credential values.
 await page.locator('#login_username').fill(credential.username);await page.locator('#login_password').fill(credential.password);credential=null;
 await page.locator('#login_button').click();
 await page.waitForURL(u=>u.origin===config.origin&&u.searchParams.get('method')==='main',{timeout:20000});
 await page.getByText('协同工作',{exact:true}).waitFor({state:'visible',timeout:20000});console.log('OA login succeeded.');
}
try{await main();}catch{console.error('Login not completed. Inspect OA or configuration. No automatic password retry.');process.exitCode=1;}finally{if(browser)await browser.close().catch(()=>{});}
