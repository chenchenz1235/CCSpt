export function createQuestionDraft(textarea,status){
  let taskId=null,timer=null;const key=id=>'embedmerge.question.'+id;
  const value=()=>textarea.value.slice(0,12000);
  function write(id,text){if(!id)return false;try{if(text)localStorage.setItem(key(id),JSON.stringify({text,at:Date.now()}));else localStorage.removeItem(key(id));return true;}catch{return false;}}
  function read(id){if(!id)return '';try{const d=JSON.parse(localStorage.getItem(key(id))||'null');return typeof d?.text==='string'?d.text.slice(0,12000):'';}catch{return '';}}
  function update(saved=false){status.textContent=`${value().length.toLocaleString()} / 12,000${taskId&&value()?(saved?' · 草稿已保存在本机':' · 本机草稿'):''}`;}
  function save(){clearTimeout(timer);update(write(taskId,value()));}
  textarea.maxLength=12000;textarea.addEventListener('input',()=>{update();clearTimeout(timer);timer=setTimeout(save,250);});window.addEventListener('beforeunload',save);
  return {save,setTask(id){if(taskId===id)return;save();taskId=id;textarea.value=read(id);update(!!textarea.value);},clear(){textarea.value='';save();},restore(id,text){if(!id||!text)return;if(id===taskId){if(!textarea.value){textarea.value=text;save();}}else if(!read(id))write(id,text);},current:()=>taskId};
}
