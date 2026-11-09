import fs from 'node:fs/promises';
import {callEmbedMerge} from '../core/external-client.mjs';
try{
 const [action='status',...flags]=process.argv.slice(2),input=flags.indexOf('--input'),output=flags.indexOf('--output');
 const args=input>=0?JSON.parse((await fs.readFile(flags[input+1],'utf8')).replace(/^\uFEFF/,'')):flags[0]?.startsWith('{')?JSON.parse(flags[0]):{};
 if(flags.includes('--wait')&&!['start','job'].includes(action))throw Error('--wait 仅用于 start/job');
 let result=await callEmbedMerge(action,args);
 if(flags.includes('--wait')){
   let last='';console.error('任务编号：'+result.id);
   while(['queued','running'].includes(result.status)){
     const progress=result.progress,stage=progress?[progress.stage,progress.detail,progress.current,progress.total].join(' · '):result.status;
     if(stage!==last){console.error(stage);last=stage;}
     await new Promise(resolve=>setTimeout(resolve,500));result=await callEmbedMerge('job',{jobId:result.id});
   }
 }
 if(output>=0){await fs.writeFile(flags[output+1],JSON.stringify(result,null,2));console.log(JSON.stringify({saved:flags[output+1],jobId:result.id,status:result.status,error:result.error,taskId:result.taskId||result.task?.id||result.result?.task?.id,summary:result.summary,counts:result.counts||result.result?.counts,view:result.view||result.result?.view}));}
 else console.log(JSON.stringify(result,null,2));
 if(result.status==='failed')process.exitCode=1;
 if(result.status==='cancelled')process.exitCode=2;
}catch(e){console.error(e.message);process.exitCode=1;}
