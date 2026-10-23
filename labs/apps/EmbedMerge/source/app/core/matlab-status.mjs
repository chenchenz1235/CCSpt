export const isMatlabFile=rel=>/\.(m|mat|mdl|slx|sldd|mlx)$/i.test(rel);
export const isMatlabCache=rel=>/(^|\/)(slprj|\.slxc)(\/|$)/i.test(rel)||/(^|\/)[^/]+_(ert|grt)_rtw\/(?:html\/)?(?:buildInfo|codeInfo|traceInfo|rtwtypeschksum|binfo)\.mat$/i.test(rel);
const cosmetic=new Set(['Position','LabelPosition','FontName','FontSize','FontWeight','FontAngle','ForegroundColor','BackgroundColor','ZoomFactor','ScreenColor','LastModifiedDate','LastModifiedBy','Model.Modified','Model.Created','Thumbnail']);
export function summarizeMatlab(result,versions){
  if(!result)return {status:'model',note:'等待 MATLAB 自动比较',engine:'MATLAB R2024b'};
  if(!versions||JSON.stringify(result.versions)!==JSON.stringify(versions))return {status:'model',note:'工作副本已变化，MATLAB 缓存过期，等待重新比较',stale:true};
  if(result.status==='failed'||result.error){
    const error=result.error||'MATLAB 比较失败';
    const failureKind=/ProtectedContent|E-?SafeNet|受保护内容|未取得明文/i.test(error)?'protected':/800706ba|800706be|80010108|RPC 服务器不可用|RPC server is unavailable/i.test(error)?'connection':'comparison';
    return {status:'error',error,failureKind,statusLabel:{protected:'受保护 · 未取得明文',connection:'MATLAB 连接失败',comparison:'MATLAB 比较失败'}[failureKind]};
  }
  const rows=Array.isArray(result.changes)?result.changes:result.changes?[result.changes]:[];
  if(versions[0]===versions[1]&&!rows.length)return {status:'same',note:'文件字节完全相同；外部依赖、编译和仿真仍未核实',engine:result.source};
  if(rows.some(r=>!String(r.property||'').startsWith('Unverified')&&(r.kind!=='parameter'||!cosmetic.has(r.property))))return {status:'different',note:`MATLAB 已检测到 ${rows.length} 项差异${result.incomplete?'，其余范围尚未完整覆盖':''}`,engine:result.source};
  if(result.incomplete)return {status:'pending',note:'MATLAB 检查未完整覆盖，需核实',engine:result.source};
  if(result.classification)return {status:result.classification==='same'&&versions[0]!==versions[1]?'minor':result.classification,note:result.classificationNote||'MATLAB 脚本比较结果',engine:result.source};
  if(versions[0]===versions[1])return {status:'same',note:'文件字节完全相同；不等于已验证模型运行或外部依赖',engine:result.source};
  if(rows.length&&rows.every(r=>r.kind==='parameter'&&cosmetic.has(r.property)))return {status:'minor',note:'仅检测到显示/日期属性候选差异，保留原始官方证据，未作功能等价证明',engine:result.source};
  if(rows.length)return {status:'different',note:`MATLAB 检测到 ${rows.length} 项差异`,engine:result.source};
  if(result.source?.includes('MAT/Bus')&&!result.incomplete)return {status:'same',note:'已支持 MAT/Bus 字段范围内一致，外部依赖未验证',engine:result.source};
  if(result.reportNoChanges)return {status:'same',note:'官方未过滤模型比较未发现差异；容器字节不同，外部依赖及运行行为未验证',engine:result.source};
  return {status:'pending',note:'官方当前过滤结果无可见差异，但文件字节不同；请查看完整官方报告',engine:result.source};
}
