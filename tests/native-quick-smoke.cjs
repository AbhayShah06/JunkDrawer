'use strict';
// Run with the development Electron executable, not with node. No login preference is changed.
const {app,BrowserWindow,Tray,Menu,globalShortcut,nativeImage}=require('electron');
const path=require('node:path'),fs=require('node:fs'),os=require('node:os'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'jd-native-'));
app.setPath('userData',scratch);process.env.JD_DEV='1';
app.whenReady().then(async()=>{
 let server,access,window;
 try {
   const {createQuickAccess}=require('../electron/quick-access');
   access=createQuickAccess({app:{isPackaged:true,getLoginItemSettings:()=>({openAtLogin:false}),setLoginItemSettings:()=>assert.fail('startup must remain unchanged')},Tray,Menu,globalShortcut,nativeImage,iconPath:path.join(root,'branding','logo.png'),showQuick:()=>{},showMain:()=>{},quit:()=>{},platform:process.platform});access.init();
   assert.equal(access.status().tray,true);assert.equal(access.status().shortcutRegistered,true,'the default quick-access shortcut is already occupied');
   const started=await require('../electron/server').startServer(root,path.join(root,'resources','bin',process.platform==='win32'?'win':'mac'),null,null,path.join(scratch,'models'));server=started.server;
   window=new BrowserWindow({show:false,width:560,height:420,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   await window.loadURL('http://127.0.0.1:'+started.port+'/index.html?quick=1');
   const result=await window.webContents.executeJavaScript(`({quick:document.body.classList.contains('quick-mode'),sidebarHidden:getComputedStyle(document.querySelector('.sidebar')).display==='none',hasEditor:!!document.querySelector('.video-studio'),logo:!!document.querySelector('.brand img'),search:!!document.querySelector('#q')})`);
   assert.deepEqual(result,{quick:true,sidebarHidden:true,hasEditor:false,logo:true,search:true});console.log(JSON.stringify({nativeTray:true,nativeShortcut:true,quickPanel:result}));
 }finally{access?.dispose();window?.destroy();if(server)await new Promise(r=>server.close(r));/* Chromium releases its profile locks on process exit; leave the temp profile for OS cleanup. */}
 app.exit(0);
}).catch(error=>{console.error(error.stack);app.exit(1);});
