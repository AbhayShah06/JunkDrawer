'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
// Only OS command-line selections enter this inbox. Renderer requests use opaque tokens.
function createFileInbox(now=Date.now){
  const files=new Map();let pending=[];
  const expire=()=>{for(const [id,f]of files)if(now()-f.created>15*60*1000)files.delete(id);};
  return {
    queue(paths){expire();for(const p of paths.slice(0,200)){try{const absolute=path.resolve(p),stat=fs.statSync(absolute);if(!stat.isFile())continue;const token=randomUUID();files.set(token,{path:absolute,created:now()});pending.push({token,name:path.basename(absolute),size:stat.size});}catch{}}},
    take(){expire();const result=pending.filter(f=>files.has(f.token));pending=[];return result;},
    resolve(token){expire();const f=files.get(token);if(!f)return null;files.delete(token);return f.path;},
  };
}
function selectedPaths(argv){const at=argv.indexOf('--process-files');return at<0?[]:argv.slice(at+1).filter(p=>p&&!p.startsWith('--'));}
function createDesktopIntegration({app,shell,platform=process.platform,quickAccess=()=>null}){
  const link=path.join(app.getPath('appData'),'Microsoft','Windows','SendTo','Junk Drawer.lnk');
  const settings=path.join(app.getPath('userData'),'desktop-integration.json');
  const available=platform==='win32'&&app.isPackaged;
  const status=()=>({quickAccess:quickAccess()?.status()||null,available,enabled:available&&fs.existsSync(link),label:'Send to → Junk Drawer',note:available?'Right-click files in Explorer, then choose Send to → Junk Drawer.':'Available in the packaged Windows desktop app.'});
  function setEnabled(enabled){
    if(!available)throw new Error('This integration needs the packaged Windows app.');
    if(enabled){fs.mkdirSync(path.dirname(link),{recursive:true});const ok=shell.writeShortcutLink(link,'create',{target:app.getPath('exe'),args:'--process-files',description:'Convert, compress, or process selected files locally',icon:app.getPath('exe'),iconIndex:0});if(!ok)throw new Error('Could not create the Send to shortcut.');}
    else if(fs.existsSync(link))fs.unlinkSync(link);
    fs.mkdirSync(path.dirname(settings),{recursive:true});fs.writeFileSync(settings,JSON.stringify({enabled}));return status();
  }
  function init(){if(!available)return;let enabled=true;try{enabled=JSON.parse(fs.readFileSync(settings,'utf8')).enabled!==false;}catch{}try{setEnabled(enabled);}catch{}}
  function openStartupSettings(){if(!available)throw Error('Windows Settings is available in the installed Windows app.');return shell.openExternal('ms-settings:startupapps');}
  return {status,setEnabled,init,setStartup:value=>quickAccess()?.setStartup(value),openStartupSettings};
}
module.exports={createFileInbox,selectedPaths,createDesktopIntegration};
