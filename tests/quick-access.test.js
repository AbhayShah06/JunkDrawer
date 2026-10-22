'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createQuickAccess}=require('../electron/quick-access');
function fixture({exists=false,enabled=false,platform='win32',shortcut=true}={}){
 let menu,registered,unregistered,quick=0,main=0,destroyed=false;const writes=[];
 class Tray extends EventEmitter{setToolTip(){}setContextMenu(value){menu=value;}destroy(){destroyed=true;}}
 const app={isPackaged:true,getLoginItemSettings:options=>{assert.deepEqual(options,{args:['--background']});return {openAtLogin:false,executableWillLaunchAtLogin:exists&&enabled,launchItems:exists?[{name:'JunkDrawerQuickAccess',scope:'user',enabled}]:[]};},setLoginItemSettings:settings=>{writes.push(settings);exists=settings.openAtLogin;enabled=settings.enabled;}};
 const access=createQuickAccess({app,Tray,Menu:{buildFromTemplate:v=>v},globalShortcut:{register:(key,fn)=>{registered={key,fn};return shortcut;},unregister:key=>unregistered=key},nativeImage:{createFromPath:()=>({resize:()=>({})})},iconPath:'icon.png',showQuick:()=>quick++,showMain:()=>main++,quit:()=>{},platform});
 return {access,writes,disableInWindows:()=>{enabled=false;},enableInWindows:()=>{enabled=true;},get menu(){return menu;},get registered(){return registered;},get result(){return {unregistered,quick,main,destroyed};}};
}
test('startup registers disabled so Windows can discover it; toggles retain the entry',()=>{
 const f=fixture();f.access.init();assert.equal(f.access.status().startup,false);
 assert.deepEqual(f.writes,[{name:'JunkDrawerQuickAccess',openAtLogin:true,enabled:false,args:['--background']}]);
 assert.equal(f.registered.key,'Control+Alt+J');f.registered.fn();f.menu[0].click();f.menu[1].click();
 f.access.setStartup(true);assert.equal(f.access.status().startup,true);f.access.setStartup(false);assert.equal(f.access.status().startup,false);assert.equal(f.writes.at(-1).openAtLogin,true);assert.equal(f.writes.at(-1).enabled,false);
 f.access.dispose();assert.deepEqual(f.result,{unregistered:'Control+Alt+J',quick:2,main:1,destroyed:true});
});
test('startup honors Windows disable and enable without overwriting either at launch',()=>{
 for(const enabled of [false,true]){const f=fixture({exists:true,enabled});f.access.init();assert.equal(f.writes.length,0);assert.equal(f.access.status().startup,enabled);f.disableInWindows();assert.equal(f.access.status().startup,false);f.enableInWindows();assert.equal(f.access.status().startup,true);f.access.dispose();}
});
test('shortcut conflicts are reported instead of pretending to register',()=>{const f=fixture({platform:'darwin',shortcut:false});f.access.init();assert.equal(f.access.status().tray,true);assert.equal(f.access.status().shortcutRegistered,false);assert.equal(f.writes.length,0);f.access.dispose();});
