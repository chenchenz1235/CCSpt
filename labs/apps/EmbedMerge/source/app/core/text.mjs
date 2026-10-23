import {createHash} from 'node:crypto';
import iconv from 'iconv-lite';
import {diffArrays} from 'diff';

export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const normalize = text => text.replace(/\r\n|\r/g,'\n');
export function decode(bytes) {
  if (/e-?safenet/i.test(bytes.subarray(0,512).toString('latin1'))) throw Error('受保护内容：普通进程未取得明文，请按公司授权流程读取');
  let encoding='utf8',bom=false,text;
  if(bytes[0]===255 && bytes[1]===254) { encoding='utf16-le';bom=true; }
  else if(bytes[0]===254 && bytes[1]===255) { encoding='utf16-be';bom=true; }
  else {
    if(bytes.includes(0)) throw Error('包含 NUL，二进制或受保护内容，不能作为文本比较');
    bom=bytes.subarray(0,3).equals(Buffer.from([239,187,191]));
    try { new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { encoding='gb18030'; }
  }
  text=iconv.decode(bytes,encoding);
  if(!iconv.encode(text,encoding,{addBOM:bom}).equals(bytes)) throw Error('编码不能无损往返，请核实编码或授权读取来源');
  if(/[\x00-\x08\x0E-\x1F]/.test(text)) throw Error('不可识别控制字符，疑似二进制或读取失败');
  const crlf=(text.match(/\r\n/g)||[]).length, lf=(text.match(/(?<!\r)\n/g)||[]).length, cr=(text.match(/\r(?!\n)/g)||[]).length;
  const mixed=[crlf,lf,cr].filter(Boolean).length>1;
  return {text:normalize(text),encoding,bom,eol:crlf?'CRLF':cr?'CR':'LF',mixed,rawText:text,hash:hash(bytes)};
}
export function encode(text,meta) {
  if(meta.mixed && normalize(meta.rawText)!==text) throw Error('文件含混合换行。请先明确选择统一 LF 或 CRLF 后保存');
  const raw=meta.mixed?meta.rawText:normalize(text).replace(/\n/g,meta.eol==='CRLF'?'\r\n':meta.eol==='CR'?'\r':'\n');
  const bytes=iconv.encode(raw,meta.encoding,{addBOM:meta.bom});
  if(iconv.decode(bytes,meta.encoding)!==raw) throw Error('目标编码无法无损表示当前内容，保存已阻止');
  return bytes;
}
// Tokenize C-family text without losing string literals, preprocessor boundaries,
// token boundaries or tool directives. A "minor" result is a display heuristic.
export function tokens(text) {
  return normalize(text).match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\n]*|\/\*[\s\S]*?\*\/|^[ \t]*#[^\n]*|[A-Za-z_$][\w$]*|(?:\d+(?:\.\d*)?)(?:[A-Za-z_][\w]*)?|>>=|<<=|->|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|\+=|-=|\*=|\/=|[^\s]/gm)?.filter(t=>{
    if(t.startsWith('//')||t.startsWith('/*')) return /(?:#|@|%|pragma|lint|polyspace|codegen|MISRA|NOLINT|fall.?through|noinspection|\$)/i.test(t);
    return true;
  }).join('\u0000')||'';
}
export function classify(a,b,ext='') {
  if(a===b) return 'same';
  if(/\.(?:c|h|cpp|hpp|cc|cxx)$/i.test(ext) && tokens(a)===tokens(b)) return 'minor';
  if(normalize(a)===normalize(b)) return 'minor';
  return 'different';
}
export function hunks(a,b) {
  const A=normalize(a).split('\n'),B=normalize(b).split('\n');let x=0,y=0;const out=[];
  for(const p of diffArrays(A,B)) {
    if(!p.added&&!p.removed){x+=p.count;y+=p.count;continue;}
    const h={a0:x,a1:x+(p.removed?p.count:0),b0:y,b1:y+(p.added?p.count:0)};
    x=h.a1;y=h.b1;
    const prev=out.at(-1);
    if(prev && prev.a1===h.a0 && prev.b1===h.b0){prev.a1=h.a1;prev.b1=h.b1;}else out.push(h);
  }
  return out.map(h=>({...h,id:hash(JSON.stringify([h,A.slice(h.a0,h.a1),B.slice(h.b0,h.b1)])).slice(0,16)}));
}
export function mergeHunk(a,b,h,direction) {
  const A=normalize(a).split('\n'),B=normalize(b).split('\n');
  if(direction==='right'){B.splice(h.b0,h.b1-h.b0,...A.slice(h.a0,h.a1));return B.join('\n');}
  A.splice(h.a0,h.a1-h.a0,...B.slice(h.b0,h.b1));return A.join('\n');
}
