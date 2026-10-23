const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('workbench',{
  call:(method,args)=>ipcRenderer.invoke('call',method,args),
  onEvent:callback=>{const listener=(_,event)=>callback(event);ipcRenderer.on('event',listener);return()=>ipcRenderer.removeListener('event',listener);}
});
