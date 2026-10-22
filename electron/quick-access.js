'use strict';
function createQuickAccess({app,Tray,Menu,globalShortcut,nativeImage,iconPath,showQuick,showMain,quit,platform=process.platform}){
  let tray=null,registered=false;
  const accelerator=platform==='darwin'?'Command+Alt+J':'Control+Alt+J';
  const shortcut=platform==='darwin'?'⌘ Option J':'Ctrl+Alt+J';
  const available=app.isPackaged&&['win32','darwin'].includes(platform);
  const status=()=>({available,tray:!!tray,shortcut,shortcutRegistered:registered,startupAvailable:available&&platform==='win32',startup:available&&platform==='win32'?app.getLoginItemSettings({args:['--background']}).openAtLogin:false});
  function menu(){if(!tray)return;tray.setContextMenu(Menu.buildFromTemplate([{label:'Quick drawer  ·  '+shortcut,click:showQuick},{label:'Open full workspace',click:showMain},{type:'separator'},...(platform==='win32'?[{label:'Start with Windows',type:'checkbox',checked:status().startup,click:item=>setStartup(item.checked)}]:[]),{label:'Quit Junk Drawer',click:quit}]));}
  function setStartup(enabled){if(!status().startupAvailable)throw Error('Start with Windows is available in the installed Windows app.');app.setLoginItemSettings({name:'JunkDrawerQuickAccess',openAtLogin:enabled,args:['--background']});menu();return status();}
  function init(){if(!available||tray)return;tray=new Tray(nativeImage.createFromPath(iconPath).resize({width:24,height:24}));tray.setToolTip('Junk Drawer · '+shortcut);tray.on('click',showQuick);registered=globalShortcut.register(accelerator,showQuick);menu();}
  function dispose(){if(registered)globalShortcut.unregister(accelerator);tray?.destroy();tray=null;registered=false;}
  return {init,status,setStartup,dispose};
}
module.exports={createQuickAccess};
