'use strict';
function createQuickAccess({app,Tray,Menu,globalShortcut,nativeImage,iconPath,showQuick,showMain,quit,platform=process.platform}){
  let tray=null,registered=false;
  const accelerator=platform==='darwin'?'Command+Alt+J':'Control+Alt+J';
  const shortcut=platform==='darwin'?'⌘ Option J':'Ctrl+Alt+J';
  const available=app.isPackaged&&['win32','darwin'].includes(platform);
  const startupName='JunkDrawerQuickAccess';
  const loginSettings=()=>app.getLoginItemSettings({args:['--background']});
  function startupEnabled(){
    if(!available||platform!=='win32')return false;
    const settings=loginSettings();
    // Windows can disable a Run entry while leaving openAtLogin true.
    const entry=settings.launchItems?.find(item=>item.name===startupName&&item.scope==='user');
    return entry?!!entry.enabled:!!(settings.executableWillLaunchAtLogin??settings.openAtLogin);
  }
  const status=()=>({available,tray:!!tray,shortcut,shortcutRegistered:registered,startupAvailable:available&&platform==='win32',startup:startupEnabled()});
  function menu(){if(!tray)return;tray.setContextMenu(Menu.buildFromTemplate([{label:'Quick drawer  ·  '+shortcut,click:showQuick},{label:'Open full workspace',click:showMain},{type:'separator'},...(platform==='win32'?[{label:'Start with Windows',type:'checkbox',checked:status().startup,click:item=>setStartup(item.checked)}]:[]),{label:'Quit Junk Drawer',click:quit}]));}
  function setStartup(enabled){if(!status().startupAvailable)throw Error('Start with Windows is available in the installed Windows app.');app.setLoginItemSettings({name:startupName,openAtLogin:true,enabled:!!enabled,args:['--background']});menu();return status();}
  function init(){if(!available||tray)return;
    // Keep a disabled entry visible in Windows Startup apps, without opting in.
    if(platform==='win32'){const settings=loginSettings();if(!settings.openAtLogin&&!settings.launchItems?.some(item=>item.name===startupName&&item.scope==='user'))app.setLoginItemSettings({name:startupName,openAtLogin:true,enabled:false,args:['--background']});}
    tray=new Tray(nativeImage.createFromPath(iconPath).resize({width:24,height:24}));tray.setToolTip('Junk Drawer · '+shortcut);tray.on('click',showQuick);tray.on('right-click',menu);registered=globalShortcut.register(accelerator,showQuick);menu();}
  function dispose(){if(registered)globalShortcut.unregister(accelerator);tray?.destroy();tray=null;registered=false;}
  return {init,status,setStartup,dispose};
}
module.exports={createQuickAccess};
