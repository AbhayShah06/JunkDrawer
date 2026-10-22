'use strict';
// Run with the development Electron executable, not with node. No login preference is changed.
const {app,BrowserWindow,Tray,Menu,globalShortcut,nativeImage}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const startupName='JunkDrawerSmoke_'+process.pid,startupArgs=['--jd-startup-smoke',String(process.pid)];
const loginApp={isPackaged:true,getLoginItemSettings:()=>{const state=app.getLoginItemSettings({args:startupArgs});return {...state,launchItems:state.launchItems.filter(item=>item.name===startupName).map(item=>({...item,name:'JunkDrawerQuickAccess'}))};},setLoginItemSettings:settings=>app.setLoginItemSettings({...settings,name:startupName,args:startupArgs})};
const root=path.join(__dirname,'..'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'jd-native-'));
app.setPath('userData',scratch);process.env.JD_DEV='1';
app.whenReady().then(async()=>{
 let server,access,window;
 try {
   const {createQuickAccess}=require('../electron/quick-access');
   const testShortcut='Control+Alt+Shift+F12';const isolatedShortcut={register:(_key,fn)=>globalShortcut.register(testShortcut,fn),unregister:()=>globalShortcut.unregister(testShortcut)};
   access=createQuickAccess({app:process.platform==='win32'?loginApp:{isPackaged:true},Tray,Menu,globalShortcut:isolatedShortcut,nativeImage,iconPath:path.join(root,'branding','logo.png'),showQuick:()=>{},showMain:()=>{},quit:()=>{},platform:process.platform});access.init();
   if(process.platform==='win32'){assert.equal(access.status().startup,false);access.setStartup(true);assert.equal(access.status().startup,true);access.setStartup(false);assert.equal(access.status().startup,false);}
   assert.equal(access.status().tray,true);assert.equal(access.status().shortcutRegistered,true,'the temporary native-test shortcut is already occupied');
   const started=await require('../electron/server').startServer(root,path.join(root,'resources','bin',process.platform==='win32'?'win':'mac'),null,null,path.join(scratch,'models'));server=started.server;
   window=new BrowserWindow({show:false,width:560,height:420,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   await window.loadURL('http://127.0.0.1:'+started.port+'/index.html?quick=1');
   const result=await window.webContents.executeJavaScript(`({quick:document.body.classList.contains('quick-mode'),sidebarHidden:getComputedStyle(document.querySelector('.sidebar')).display==='none',hasEditor:!!document.querySelector('.video-studio'),logo:!!document.querySelector('.brand img'),search:!!document.querySelector('#q')})`);
   assert.deepEqual(result,{quick:true,sidebarHidden:true,hasEditor:false,logo:true,search:true});console.log(JSON.stringify({nativeTray:true,nativeShortcut:true,quickPanel:result}));
 }finally{access?.dispose();if(process.platform==='win32'){app.setLoginItemSettings({name:startupName,args:startupArgs,openAtLogin:false});spawnSync('reg.exe',['delete','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run','/v',startupName,'/f'],{windowsHide:true,stdio:'ignore'});}window?.destroy();if(server)await new Promise(r=>server.close(r));/* Chromium releases its profile locks on process exit; leave the temp profile for OS cleanup. */}
 app.exit(0);
}).catch(error=>{console.error(error.stack);app.exit(1);});
