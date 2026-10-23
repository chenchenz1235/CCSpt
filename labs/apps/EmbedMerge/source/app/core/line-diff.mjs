import {diffArrays} from 'diff';
const lines=text=>text.replace(/\r\n|\r/g,'\n').split('\n');
export function differenceBlocks(left,right){
  const parts=diffArrays(lines(left),lines(right),{timeout:1500});if(!parts)throw Error('差异块计算超时，请缩小文件范围');
  let a=0,b=0;const result=[];
  for(const p of parts){if(!p.added&&!p.removed){a+=p.count;b+=p.count;continue;}const h={a0:a,a1:a+(p.removed?p.count:0),b0:b,b1:b+(p.added?p.count:0)};a=h.a1;b=h.b1;const prev=result.at(-1);if(prev&&prev.a1===h.a0&&prev.b1===h.b0){prev.a1=h.a1;prev.b1=h.b1;}else result.push(h);}
  return result;
}
export function blockRows(left,right,h){const A=lines(left),B=lines(right);return Array.from({length:Math.max(h.a1-h.a0,h.b1-h.b0)},(_,i)=>({row:i,a:h.a0+i<h.a1?h.a0+i:null,b:h.b0+i<h.b1?h.b0+i:null,left:h.a0+i<h.a1?A[h.a0+i]:null,right:h.b0+i<h.b1?B[h.b0+i]:null}));}
export function copyBlock(left,right,h,direction){const A=lines(left),B=lines(right);if(direction==='right'){B.splice(h.b0,h.b1-h.b0,...A.slice(h.a0,h.a1));return B.join('\n');}A.splice(h.a0,h.a1-h.a0,...B.slice(h.b0,h.b1));return A.join('\n');}
export function copyRow(left,right,h,row,direction){
  const rows=blockRows(left,right,h),r=rows[row];if(!r)throw Error('所选对应行已过期，请重新选择');const target=lines(direction==='right'?right:left),source=direction==='right'?r.left:r.right,index=direction==='right'?r.b:r.a;
  const anchor=direction==='right'?Math.min(h.b0+row,h.b1):Math.min(h.a0+row,h.a1);target.splice(index??anchor,index===null?0:1,...(source===null?[]:[source]));return target.join('\n');
}
