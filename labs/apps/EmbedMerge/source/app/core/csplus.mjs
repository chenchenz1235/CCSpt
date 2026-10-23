import {DOMParser} from '@xmldom/xmldom';

export const isCsplusFile = rel => /\.(scfg|mtpj)$/i.test(rel);
const els = n => Array.from(n?.childNodes || []).filter(n => n.nodeType === 1);
const attr = (n,k) => n?.getAttribute(k) ?? '';
const get = (n,k) => els(n).find(x=>x.nodeName===k)?.textContent;
const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const labels = {
  ClockDivision:'计数时钟分频',CntClk:'计数时钟分频',CntClkU:'U 通道分频',CntClkV:'V 通道分频',CntClkW:'W 通道分频',
  ClrSrc:'计数清零源',ClrSrcU:'U 通道清零源',ClrSrcV:'V 通道清零源',ClrSrcW:'W 通道清零源',
  Sync:'同步计数',Synch:'同步计数',ClkEdg:'计数边沿',Mode:'计数模式',DdTm:'死区功能',
  TmrCntU:'U 通道计数',TmrCntV:'V 通道计数',TmrCntW:'W 通道计数',
  IntCMWIEnable:'比较匹配中断',IntCMWIPriority:'中断优先级',Tgia:'TGIA 中断',Tgib:'TGIB 中断',Tciv:'溢出中断',Tciv4:'MTU4 溢出中断',PrioV4:'溢出中断优先级',PrioInt1:'中断优先级',TgiU:'U 通道中断',TgiV:'V 通道中断',TgiW:'W 通道中断',
  TGRAValue:'TGRA 输入设置',TGRBValue:'TGRB 输入设置',TGRCValue:'TGRC 输入设置',TGRDValue:'TGRD 输入设置',
  Bitrate:'波特率',DataLength:'数据位',Parity:'校验位',StopBit:'停止位',TransDir:'位传输顺序',TransClock:'传输时钟',NoiseFilt:'接收噪声滤波',FiltClk:'滤波时钟分频',DutyCorrection:'占空比校正',TransDataHandle:'发送处理',RecvDataHandle:'接收处理',ERIEnable:'错误中断',ERIPriority:'错误中断优先级',TransEnd:'发送结束回调',RecvEnd:'接收结束回调',RecvError:'接收错误回调',
  GroupScanSelect:'扫描分组',StartTrigger:'启动触发',StartTriggerA:'A 组启动触发',StartTriggerB:'B 组启动触发',DataAligh:'数据对齐',Dataplacement:'数据对齐',Valuecount:'采样累加次数',S12ADIchk:'A/D 中断',GRPPriority:'分组优先处理',
  sckswitcher:'主时钟源',hococlockenable:'HOCO 时钟',mainclockenable:'主振荡器',lococlockenable:'LOCO 时钟',iwdtclockenable:'IWDT 时钟',hocofrequency:'HOCO 频率',iclk:'系统时钟 ICLK',pclkb:'外设时钟 PCLKB',pclkd:'外设时钟 PCLKD',fclk:'Flash 时钟 FCLK',vccinput:'供电电压',iclkdivider:'ICLK 分频',pclkbdivider:'PCLKB 分频',pclkddivider:'PCLKD 分频',fclkdivider:'FCLK 分频'
};
const choices={Enable:'启用',Disable:'禁用',Disabled:'禁用',Use:'使用',Unuse:'不使用',Unused:'不使用',check:'启用',uncheck:'禁用',true:'启用',false:'禁用',Software:'软件触发',GroupA:'A 组',GroupB:'B 组',Right:'右对齐',None:'无',Rise:'上升沿',Fall:'下降沿',LSB:'低位优先',MSB:'高位优先',Internal:'内部时钟',ISR:'中断处理',LowLevel:'低电平',TGRA:'TGRA 比较匹配',TGRB:'TGRB 比较匹配',Twogroup:'A / B 两组',TRG4AN:'MTU4 TRG4AN',TRGA3N:'MTU3 TRGA3N',Cmppwm2:'互补 PWM 模式 2',hoco:'HOCO',pll:'PLL',main:'主振荡器',loco:'LOCO'};
const modes={'Compare Match Timer':'比较匹配定时器','PWM Mode Timer':'PWM 模式','Complementary PWM Mode Timer':'互补 PWM 模式','Dead-time Compensation Counter':'死区补偿计数器','Normal Mode Timer':'普通定时器模式','Continuous Scan Mode S12AD':'连续扫描','Group Scan Mode S12AD':'分组扫描','SCI/SCIF Asynchronous Mode':'异步串口'};
const titles={Config_PORT:'端口配置',Config_IWDT:'独立看门狗',Config_LVD0:'LVD0 电压检测',Config_DTC:'DTC 数据传送',Config_POE:'POE 输出保护',r_bsp:'BSP 基础配置',r_flash_rx:'Flash 驱动'};
const timeSpecs=[['IntervalValue','IntervalUnit','中断间隔'],['PeriodValue','Unit','界面填写周期'],['PeriodU','UnitU','U 通道周期'],['PeriodV','UnitV','V 通道周期'],['PeriodW','UnitW','W 通道周期'],['DdTmValue','Unit1','死区时间'],['TGRAValue','TgraScale','TGRA 比较时间'],['TGRBValue','TgrbScale','TGRB 比较时间']];
function parse(text,root){
  if(Buffer.byteLength(text)>4*1024*1024)throw Error('CS+ XML 超过 4 MiB 上限');
  if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text))throw Error('不支持带 DTD / 实体声明的工程 XML');
  const errors=[];
  const doc=new DOMParser({onError:(level,msg)=>errors.push(`${level}: ${msg}`)}).parseFromString(text.replace(/^\uFEFF/,''),'text/xml');
  if(errors.length||doc.documentElement?.nodeName!==root)throw Error('无法解析 '+root+' XML：'+(errors[0]||'根节点不匹配'));
  return doc;
}
function evidence(node,file,id,raw){return {file,line:node.lineNumber,id,raw};}
function field(text,canonical,proof,enabled=true){return {text:String(text),canonical:String(canonical),evidence:proof,enabled};}
function add(map,key,v){if(map.has(key))throw Error('配置项标识重复，不能可靠对齐：'+key);map.set(key,v);}
function selectedOption(n,file,context){
  const id=attr(n,'id'),selection=attr(n,'selection');
  const item=els(n).find(x=>attr(x,'id')===selection),input=attr(item,'input');
  const stored=attr(item,'value')||attr(item,'vlaue');
  const enabled=attr(n,'enabled')!=='false';
  let text=input||((selection===id||/^(?:textinputitem|textoutputitem)$/.test(selection))?stored:'')||choices[selection]||selection||attr(n,'value')||attr(n,'values')||stored;
  if(!input&&/^(?:Devide|Divide|Div)\d+$/.test(selection))text='/'+selection.match(/\d+/)[0];
  else if(!input&&/^Level\d+$/.test(selection))text=selection.slice(5);
  else if(!input&&/^comboBox1-\d+$/.test(selection))text='/'+selection.split('-')[1];
  else if(!input&&/^\d+Bits?$/.test(selection))text=selection.match(/\d+/)[0]+' 位';
  if(id==='Bitrate'&&input)text+=' bps';
  if(context==='Clock'&&['hocofrequency','iclk','pclkb','pclkd','fclk'].includes(id)&&text)text+=' MHz';
  if(context==='Clock'&&id==='vccinput')text+=' V';
  const canonical=!enabled?'disabled':JSON.stringify([selection,input,stored,attr(n,'value'),attr(n,'values')]);
  return {id,label:labels[id]||(/^ANx0\d$/.test(id)?'AN00'+id.at(-1)+' 通道':id),mapped:!!labels[id]||/^ANx0\d$/.test(id),
    ...field(enabled?text||'未设置':'未启用',canonical,[evidence(n,file,context+'/'+id,{selection,input,stored,enabled})],enabled),selection,input,stored};
}
function optionsFor(node,file,context){
  const map=new Map();
  const singleAllocation=els(node).filter(n=>n.nodeName==='allocatable').length===1;
  for(const n of Array.from(node.getElementsByTagName('option'))){
    const o=selectedOption(n,file,context),ancestors=[];
    for(let p=n.parentNode;p&&p!==node;p=p.parentNode){if(p.parentNode===node&&p.nodeName==='allocatable'&&singleAllocation)continue;ancestors.unshift(attr(p,'id')||p.nodeName);}
    const allocation=ancestors.join('/');
    if(allocation)o.evidence[0].id=context+'/'+allocation+'/'+o.id;
    add(map,(allocation?allocation+'/':'')+o.id,o);
  }
  // Combine value + unit into the same property users see in the configurator.
  for(const prefix of new Set([...map.keys()].map(k=>k.includes('/')?k.slice(0,k.lastIndexOf('/')+1):''))){
    for(const [v,u,label]of timeSpecs){
      const a=map.get(prefix+v),b=map.get(prefix+u);if(!a||!b)continue;
      const factor={ms:1000,us:1,ns:0.001}[b.selection];const input=a.input||a.stored;
      const normal=factor!==undefined&&input!==''&&Number.isFinite(Number(input))?String(Number(input)*factor)+'us':input+' '+b.selection;
      const enabled=a.enabled&&b.enabled;
      map.set(prefix+v,{id:v,label,mapped:true,...field(enabled?input+' '+({us:'μs',ms:'ms',ns:'ns',cnt:'计数'}[b.selection]||b.selection):'未启用',enabled?normal:'disabled',[...a.evidence,...b.evidence],enabled),time:true});map.delete(prefix+u);
    }
  }
  return map;
}
function category(name,hardware){return /(?:CMT|MTU|TMR|GPT)/.test(hardware)?'定时器':/S12AD|ADC/.test(hardware)?'模数转换':/SCI/.test(hardware)?'串口通信':/PORT/.test(name)?'系统与引脚':'其他配置';}
export function parseScfg(text,file){
  const doc=parse(text,'smc'),components=[];
  const configs=Array.from(doc.getElementsByTagName('configuration')).filter(n=>n.hasAttribute('name'));
  for(const c of configs){
    const name=attr(c,'name'),allocator=els(c).find(n=>n.nodeName==='allocator'),component=els(c).find(n=>n.nodeName==='component');
    const allocations=els(c).filter(n=>n.nodeName==='allocatable').map(n=>attr(n,'id'));
    const hardware=attr(allocator,'display')||allocations.join('+')||name;
    const opts=optionsFor(c,file,name),mode=attr(component,'display')||attr(component,'id')||'未记录';
    const rawHardware=hardware.match(/MTU\d+|CMT\d+|SCI\d+|S12AD\d+/g)||[];
    components.push({name,title:titles[name]||hardware,hardware,resources:rawHardware,category:category(name,hardware),mode,modeId:attr(component,'id'),
      fields:new Map([['@mode',{label:'工作模式 / 组件类型',mapped:true,...field(modes[mode]||mode,attr(component,'id')||mode,[evidence(component||c,file,name+'/component',mode)])}],['@hardware',{label:'硬件通道',mapped:true,...field(hardware,hardware,[evidence(allocator||c,file,name+'/hardware',hardware)])}],['@enabled',{label:'组件启用状态',mapped:true,...field(attr(c,'inuse')==='false'?'禁用':'启用',attr(c,'inuse')||'true',[evidence(c,file,name+'/inuse',attr(c,'inuse'))])}],...opts])});
  }
  for(const t of els(doc.documentElement).filter(n=>n.nodeName==='tool')){
    const id=attr(t,'id');let fields;
    if(id==='Clock')fields=optionsFor(t,file,'Clock');
    else if(id==='Interrupt'||id==='Pins'){
      fields=new Map();
      const attributes=id==='Interrupt'?{usedState:'使用状态',priority:'优先级'}:{isUsedBySoftware:'软件使用',allocation:'分配引脚（文件编号）',direction:'方向'};
      for(const n of els(t)){
        const name=attr(n,'id');if(!name)continue;
        const active=id==='Interrupt'?attr(n,'usedState')==='Used':attr(n,'isUsedBySoftware')==='true';
        for(const [key,label]of Object.entries(attributes))if(n.hasAttribute(key)){
          const raw=attr(n,key),show=choices[raw]||({Used:'使用','Not Use':'不使用'}[raw])||raw;
          add(fields,name+'/'+key,{label:name+' · '+label,mapped:true,...field(show,raw,[evidence(n,file,id+'/'+name+'/'+key,raw)],active||['usedState','isUsedBySoftware'].includes(key))});
        }
      }
    }else continue;
    components.push({name:id,title:{Clock:'时钟树',Interrupt:'中断配置',Pins:'引脚分配'}[id],hardware:id,category:'系统与引脚',mode:'',modeId:'',resources:[],fields});
  }
  return {type:'scfg',device:attr(doc.getElementsByTagName('platform')[0],'id'),components};
}
const buildLabels={CompilerVersion:'编译器版本',GeneralOptionIsa:'指令集',GeneralOptionEndian:'字节序',GeneralOptionSimultaneousBuild:'并行构建',GeneralOptionOutputFolder:'输出目录',COptionLangC:'C 语言标准',COptionOptimize:'编译优化等级',COptionSpeedAndSize:'优化侧重',COptionDefine:'预定义宏',COptionUndefine:'取消宏定义',COptionInclude:'头文件包含路径',COptionDebug:'调试信息',LinkOptionOptimize:'链接优化',LinkOptionStart:'段起始地址',LinkOptionRom:'ROM → RAM 段映射',LinkOptionBinary:'链接二进制文件',LinkOptionMultiConvertFileName:'应用输出范围',LinkOrder:'链接顺序',BuildingTarget:'参与构建',IndividualCompileOption:'使用单独编译选项',PreBuildCommands:'构建前命令',PostBuildCommands:'构建后命令'};
export function parseMtpj(text,file){
  const doc=parse(text,'CubeSuiteProject'),classes=els(doc.documentElement).filter(n=>n.nodeName==='Class');
  const build=classes.find(c=>els(c).some(i=>get(i,'BuildModeCount')!==undefined));
  if(!build)throw Error('未找到构建设置，当前文件可能不是受支持的 CC-RX 工程');
  const instances=els(build),manager=instances.find(i=>get(i,'BuildModeCount')!==undefined);
  const count=Number(get(manager,'BuildModeCount'));if(!Number.isInteger(count)||count<1||count>100)throw Error('构建模式数量无效');
  const modes=Array.from({length:count},(_,i)=>Buffer.from(get(manager,'BuildMode'+i)||'','base64').toString('utf16le'));
  if(modes.some(n=>!n)||new Set(modes).size!==modes.length)throw Error('构建模式名称为空或重复');
  const tree=new Map();for(const c of classes)for(const i of els(c))if(get(i,'Name')!==undefined)tree.set(attr(i,'Guid'),i);
  function itemPath(id,seen=new Set()){
    const n=tree.get(id);if(!n)return null;if(seen.has(id))throw Error('工程树循环引用');seen.add(id);
    const rel=get(n,'RelativePath');if(rel)return rel.replaceAll('\\','/');
    return [itemPath(get(n,'ParentItem'),seen),get(n,'Name')].filter(Boolean).join('/');
  }
  const sourcePaths=new Map(els(manager).filter(n=>/^SourceItemGuid\d+$/.test(n.nodeName)).map(n=>[n.nodeName.match(/\d+$/)[0],itemPath(n.textContent)]));
  const groupNames={'9e208646-ccba-4100-a676-29b1efe6545f':'工程通用','95a63257-4aa7-40c0-a74a-7991543b099b':'C/C++ 编译','5ad1746c-d03e-4610-a91f-aaa4fb37bc10':'汇编','dbb16727-3e81-4169-956a-790355cab4a1':'链接','df74c69e-635e-42d9-845e-14128ba4d48a':'输出转换','9cb0ade0-b3cb-4e21-823c-290b5fdb5f1e':'库生成'};
  const groups=new Map(),defaults=new Map();
  for(const i of instances){if(i===manager)continue;const guid=attr(i,'Guid');
    for(const n of els(i)){
      const m=/^(.*)-(DefaultValue|\d+)$/.exec(n.nodeName);if(!m||/^TimeTag/.test(n.nodeName))continue;
      const indexed=/^SourceItem(\d+)-(.*)$/.exec(m[1]);
      const source=indexed?sourcePaths.get(indexed[1]):itemPath(guid);
      const key=indexed?indexed[2]:m[1],mode=m[2]==='DefaultValue'?'默认值':modes[Number(m[2])];if(!mode)throw Error('未知构建模式索引');
      const role=source?'文件 · '+source:groupNames[guid]||'其他构建设置';
      const groupId=(source?'file:'+source:'group:'+guid)+'/'+mode;
      const target=m[2]==='DefaultValue'?defaults:groups;
      if(!target.has(groupId))target.set(groupId,{name:groupId,title:role,hardware:role,category:source?'文件级构建设置':groupNames[guid]?'CC-RX 工程配置':'其他构建设置',mode,modeId:mode,resources:[],fields:new Map()});
      let text=n.textContent||'未设置';if(key==='CompilerVersion')text=text.split('\n')[0];
      text=({Little:'小端',Big:'大端',True:'启用',False:'禁用',Level2:'等级 2',Size:'代码体积',Speed:'速度优先',None:key==='LinkOptionOptimize'?'不优化':'无'}[text])||text;
      add(target.get(groupId).fields,key,{label:buildLabels[key]||key,mapped:!!buildLabels[key],...field(text,key==='CompilerVersion'?n.textContent.split('\n')[0]:n.textContent,[evidence(n,file,role+'/'+mode+'/'+n.nodeName,n.textContent)])});
    }
  }
  return {type:'mtpj',device:Array.from(doc.getElementsByTagName('DeviceName')).map(n=>n.textContent).find(Boolean)||'',modes,currentMode:get(manager,'CurrentBuildMode'),scfgFile:doc.getElementsByTagName('SCFGFile')[0]?.textContent||'',components:[...groups.values()],defaults:[...defaults.values()]};
}
export function parseCsplus(text,file){return /\.scfg$/i.test(file)?parseScfg(text,file):parseMtpj(text,file);}
function compareFields(a,b){
  const rows=[];
  for(const key of new Set([...(a?.fields.keys()||[]),...(b?.fields.keys()||[])])){
    const left=a?.fields.get(key)||null,right=b?.fields.get(key)||null;
    const equivalent=left&&right&&left.canonical===right.canonical&&left.text!==right.text;
    const state=!left?'added':!right?'removed':equivalent?'equivalent':left.canonical===right.canonical?'same':'changed';
    rows.push({key,label:left?.label||right?.label,ref:left,test:right,state,advanced:!(left?.mapped||right?.mapped),inactive:(!left||!left.enabled)&&(!right||!right.enabled)});
  }
  return rows.sort((a,b)=>Number(a.advanced)-Number(b.advanced));
}
export function compareCsplus(ref,test){
  if(ref&&test&&ref.type!==test.type)throw Error('不同类型的 CS+ 文件不能配对');
  const left=ref?.components||[],right=test?.components||[],used=new Set(),pairs=[];
  for(const a of left){
    let candidates=right.filter(b=>!used.has(b)&&b.name===a.name);
    if(!candidates.length&&ref?.type==='scfg')candidates=right.filter(b=>!used.has(b)&&b.hardware===a.hardware);
    let related=false;
    if(!candidates.length&&a.resources.length){candidates=right.filter(b=>!used.has(b)&&a.resources.some(k=>b.resources.includes(k)));related=candidates.length===1;}
    const b=candidates.length===1?candidates[0]:null;if(b)used.add(b);pairs.push([a,b,related]);
  }
  for(const b of right)if(!used.has(b))pairs.push([null,b,false]);
  const modules=pairs.map(([a,b,related],index)=>{
    const rows=compareFields(a,b),changed=rows.filter(r=>!r.inactive&&r.state==='changed').length;
    const modeChanged=!!a&&!!b&&a.modeId!==b.modeId;
    return {id:String(index),title:related?a.title+' ↔ '+b.title:a?.title||b.title,category:a?.category||b.category,refName:ref?.type==='mtpj'?(a?a.title+' / '+a.mode:''):a?.name||'',testName:test?.type==='mtpj'?(b?b.title+' / '+b.mode:''):b?.name||'',mode:a?.mode||b?.mode||'',
      refMode:a?.mode||'',testMode:b?.mode||'',related,modeChanged,rows,presence:[!!a,!!b],
      status:!a?'added':!b?'removed':modeChanged?'mode':rows.some(r=>!r.inactive&&['changed','added','removed'].includes(r.state))?'changed':rows.some(r=>r.state==='equivalent')?'equivalent':'same',changed};
  });
  const defaults=ref?.type==='mtpj'||test?.type==='mtpj'?compareCsplusDefaults(ref?.defaults||[],test?.defaults||[]):[];
  const categoryOrder=['定时器','模数转换','串口通信','系统与引脚','其他配置','CC-RX 工程配置','文件级构建设置','其他构建设置'];
  modules.sort((a,b)=>categoryOrder.indexOf(a.category)-categoryOrder.indexOf(b.category));
  return {type:ref?.type||test?.type,devices:[ref?.device||'',test?.device||''],deviceChanged:!!ref&&!!test&&ref.device!==test.device,modules,defaults,
    summary:{modules:modules.length,changed:modules.filter(m=>['mode','changed','added','removed'].includes(m.status)).length,equivalent:modules.filter(m=>m.status==='equivalent').length},
    modes:ref?.type==='mtpj'||test?.type==='mtpj'?{ref:ref?.modes||[],test:test?.modes||[],current:[ref?.currentMode||'',test?.currentMode||'']}:null};
}
function compareCsplusDefaults(a,b){const map=new Map(b.map(c=>[c.name,c]));return a.flatMap(c=>{const d=map.get(c.name);map.delete(c.name);return compareFields(c,d).filter(r=>r.state!=='same').map(r=>({...r,group:c.title}));}).concat([...map.values()].flatMap(c=>compareFields(null,c).map(r=>({...r,group:c.title}))));}

const extension=p=>p.toLowerCase().match(/\.(scfg|mtpj)$/)?.[1];
const parent=p=>p.replaceAll('\\','/').split('/').slice(0,-1).join('/').toLowerCase();
const basename=p=>p.replaceAll('\\','/').split('/').at(-1).toLowerCase();
export function discoverCsplusPairs(files,manual=[]){
  const sides={ref:files.ref.filter(isCsplusFile),test:files.test.filter(isCsplusFile)},used={ref:new Set(),test:new Set()},pairs=[];
  const addPair=(ref,test,reason,manual=false)=>{if((ref&&used.ref.has(ref))||(test&&used.test.has(test)))return false;if(ref)used.ref.add(ref);if(test)used.test.add(test);pairs.push({id:JSON.stringify([ref,test]),type:extension(ref||test),ref,test,reason,manual});return true;};
  for(const p of manual)if(sides.ref.includes(p.ref)&&sides.test.includes(p.test)&&extension(p.ref)===extension(p.test))addPair(p.ref,p.test,'手动指定',true);
  for(const ref of sides.ref){const matches=sides.test.filter(test=>test.toLowerCase()===ref.toLowerCase()&&!used.test.has(test));if(!used.ref.has(ref)&&matches.length===1)addPair(ref,matches[0],'相同相对路径');}
  for(const reason of ['相同文件名','同目录唯一类型','两侧唯一类型']){
    const match=(a,b)=>extension(a)===extension(b)&&(reason==='相同文件名'?basename(a)===basename(b):reason==='同目录唯一类型'?parent(a)===parent(b):true);
    for(const ref of sides.ref.filter(p=>!used.ref.has(p))){
      const candidates=sides.test.filter(test=>!used.test.has(test)&&match(ref,test));
      if(candidates.length!==1)continue;const test=candidates[0];
      if(sides.ref.filter(p=>!used.ref.has(p)&&match(p,test)).length===1)addPair(ref,test,reason);
    }
  }
  const unpaired={ref:sides.ref.filter(p=>!used.ref.has(p)),test:sides.test.filter(p=>!used.test.has(p))};
  return {pairs,unpaired,candidates:sides};
}
