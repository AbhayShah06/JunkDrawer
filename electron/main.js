const { app, BrowserWindow, shell, Menu, dialog, Tray, globalShortcut, nativeImage, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');
const { startServer } = require('./server');
const { createUpdater } = require('./updates');
const { createInstallerCleanup } = require('./installer-cleanup');
let installerCleanup;
const {createFileInbox,selectedPaths,createDesktopIntegration}=require('./desktop-integration');
const fileInbox=createFileInbox();
const {createQuickAccess}=require('./quick-access');
let quickAccess=null;
const desktopIntegration=createDesktopIntegration({app,shell,quickAccess:()=>quickAccess});

let win, quickWin, srv, appOrigin, quitting=false, updateTimer;
let batchJobs;

// Resolve the optional updater only after the local window is ready.
const updater = createUpdater(() => require('electron-updater').autoUpdater, error => {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'update-errors.log'), `${new Date().toISOString()} ${error?.stack || error}\n`);
  } catch {}
}, info => installerCleanup?.remember(info));
// macOS uninstall — the analogue of the Windows NSIS uninstaller (Windows already has its
// own in Add/Remove Programs). Confirms, then moves the .app to the Trash, clears the app's
// saved data, and quits. User files are never touched.
async function doUninstall() {
  const pick = dialog.showMessageBoxSync(win || undefined, {
    type: 'warning', buttons: ['Uninstall', 'Cancel'], defaultId: 1, cancelId: 1,
    message: 'Uninstall Junk Drawer?',
    detail: 'This moves Junk Drawer to the Trash and clears its saved settings. Your files are not touched.',
  });
  if (pick !== 0) return;
  try { fs.rmSync(app.getPath('userData'), { recursive: true, force: true }); } catch {}
  try {
    let p = app.getPath('exe');                 // .../Junk Drawer.app/Contents/MacOS/Junk Drawer
    const i = p.indexOf('.app/');
    if (i !== -1) p = p.slice(0, i + 4);        // trim to the .app bundle
    await shell.trashItem(p);                   // macOS allows trashing a running bundle
  } catch {}
  app.quit();
}

// Only macOS gets a custom menu (for the Uninstall item). Windows keeps its default menu.
// The standard edit/view/window roles are kept so copy-paste/shortcuts still work.
function buildAppMenu() {
  if (process.platform !== 'darwin') return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [
      { role: 'about' },
      { type: 'separator' },
      // only in the installed app — in dev this would trash Electron.app
      ...(app.isPackaged ? [{ label: 'Uninstall Junk Drawer…', click: () => doUninstall() }, { type: 'separator' }] : []),
      { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' },
      { role: 'quit' },
    ]},
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]));
}

const appRoot = () => app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
// Packaged: electron-builder's per-platform extraResources copies resources/bin/<os> -> Resources/bin.
// Dev (npm start): point at the same per-platform source folder so bundled-binary lookup works locally too.
const devBinSub = process.platform === 'win32' ? 'win' : 'mac';
const binDir  = () => app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, '..', 'resources', 'bin', devBinSub);


function showWindow(window){if(window.isMinimized())window.restore();window.show();window.focus();}
function makeWindow(quick=false){
  const target=new BrowserWindow({width:quick?560:1240,height:quick?420:900,minWidth:quick?400:720,minHeight:quick?360:560,title:quick?'Junk Drawer · Quick actions':'Junk Drawer',backgroundColor:'#f5f6f8',show:false,skipTaskbar:quick,autoHideMenuBar:true,icon:path.join(appRoot(),'icon.ico'),webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,experimentalFeatures:false}});
  target.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  const block=(event,url)=>{if(!url.startsWith(appOrigin+'/'))event.preventDefault();};
  target.webContents.on('will-navigate',block);target.webContents.on('will-redirect',block);
  target.webContents.setWindowOpenHandler(({url})=>{try{const parsed=new URL(url);if(['http:','https:'].includes(parsed.protocol))void shell.openExternal(url);}catch{}return {action:'deny'};});
  target.on('close',event=>{if(!quitting&&quickAccess?.status().tray){event.preventDefault();target.hide();}});
  if(quick)target.webContents.on('before-input-event',(event,input)=>{if(input.key==='Escape'){event.preventDefault();target.hide();}});
  target.once('ready-to-show',()=>showWindow(target));
  void target.loadURL(appOrigin+'/index.html'+(quick?'?quick=1':''));return target;
}
function showMain(){if(!appOrigin)return;if(!win||win.isDestroyed())win=makeWindow();else showWindow(win);}
function showQuick(){if(!appOrigin)return;if(!quickWin||quickWin.isDestroyed()){quickWin=makeWindow(true);}else showWindow(quickWin);const cursor=screen.getCursorScreenPoint(),area=screen.getDisplayNearestPoint(cursor).workArea,[width,height]=quickWin.getSize();quickWin.setPosition(Math.max(area.x,Math.min(cursor.x-width/2,area.x+area.width-width))|0,Math.max(area.y,Math.min(cursor.y+16,area.y+area.height-height))|0);}
async function create(){
  if(app.isPackaged&&process.platform==='win32'){
    installerCleanup=createInstallerCleanup({cacheDir:path.join(process.env.LOCALAPPDATA||path.join(app.getPath('home'),'AppData','Local'),'junk-drawer-updater'),receiptPath:path.join(app.getPath('userData'),'installed-update.json'),currentVersion:app.getVersion()});
    installerCleanup.cleanup();
    setTimeout(()=>installerCleanup.cleanup(),15000).unref();
  }
  if(process.platform==='darwin'&&app.isPackaged&&!app.isInApplicationsFolder()){
    const choice=dialog.showMessageBoxSync({type:'question',buttons:['Move to Applications','Not Now'],defaultId:0,cancelId:1,message:'Move Junk Drawer to Applications?',detail:'Keeps quick access available after you eject the disk image.'});
    if(choice===0){try{if(app.moveToApplicationsFolder())return;}catch{}}
  }
  buildAppMenu();desktopIntegration.init();fileInbox.queue(selectedPaths(process.argv));
  process.env.JD_DEV=app.isPackaged?'':'1';updater.init(app.isPackaged&&process.platform==='win32');
  const started=await startServer(appRoot(),binDir(),updater,fileInbox,path.join(app.getPath('userData'),'models'),desktopIntegration);
  srv=started.server;appOrigin='http://127.0.0.1:'+started.port;
  batchJobs=started.batchJobs;
  powerMonitor.on('suspend',()=>batchJobs.suspend());
  powerMonitor.on('resume',()=>batchJobs.resume());
  quickAccess=createQuickAccess({app,Tray,Menu,globalShortcut,nativeImage,iconPath:path.join(appRoot(),'branding','logo.png'),showQuick,showMain,quit:()=>app.quit()});quickAccess.init();
  if(selectedPaths(process.argv).length)showQuick();else if(!process.argv.includes('--background'))showMain();
  if(updater.enabled){void updater.check();updateTimer=setInterval(()=>updater.check(),15*60*1000);}
}
app.on('web-contents-created',(_event,contents)=>contents.on('will-attach-webview',event=>event.preventDefault()));
if(!app.requestSingleInstanceLock())app.quit();else{
  app.on('second-instance',(_event,argv)=>{const files=selectedPaths(argv);if(files.length){fileInbox.queue(files);showQuick();}else showMain();});
  app.whenReady().then(create).catch(error=>{try{fs.appendFileSync(path.join(app.getPath('userData'),'startup-errors.log'),String(error?.stack||error)+'\n');}catch{}dialog.showErrorBox('Junk Drawer could not start',String(error?.message||error));app.quit();});
  app.on('activate',showMain);
}
app.on('before-quit',()=>{quitting=true;batchJobs?.close();quickAccess?.dispose();if(updateTimer)clearInterval(updateTimer);});
app.on('window-all-closed',()=>{if(!quickAccess?.status().tray&&process.platform!=='darwin')app.quit();});
app.on('quit',()=>{try{srv?.close();}catch{}});
