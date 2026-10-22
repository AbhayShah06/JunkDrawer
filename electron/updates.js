// Updates are optional; no network or installer error may prevent file tools from opening.
function createUpdater(load, report = () => {}, downloaded = () => {}) {
  let engine = null, checking = null, downloading = null;
  let state = {status:'idle', version:'', percent:0, error:''};
  const fail = error => {state={...state,status:'error',error:String(error?.message||error)};report(error);};
  const updater = {
    enabled:false,
    state:()=>({...state}),
    init(enabled) {
      if(!enabled||engine)return;
      try {
        const candidate=load();candidate.autoDownload=false;candidate.autoInstallOnAppQuit=false;
        candidate.on('error',fail);
        candidate.on('update-available',info=>{if(!['downloading','ready'].includes(state.status))state={status:'available',version:info.version,percent:0,error:''};});
        candidate.on('update-not-available',()=>{if(!['downloading','ready'].includes(state.status))state={status:'none',version:'',percent:0,error:''};});
        candidate.on('download-progress',info=>{state={...state,status:'downloading',percent:Math.min(100,Math.max(0,Number(info.percent)||0)),error:''};});
        candidate.on('update-downloaded',info=>{state={status:'ready',version:info.version,percent:100,error:''};try{downloaded(info);}catch(error){report(error);}});
        engine=candidate;updater.enabled=true;
      }catch(error){fail(error);}
    },
    async check() {
      if(!engine||['downloading','ready'].includes(state.status))return updater.state();
      if(checking)return checking;
      state={...state,status:'checking',error:''};
      checking=Promise.resolve().then(()=>engine.checkForUpdates()).catch(fail).finally(()=>{checking=null;}).then(()=>updater.state());
      return checking;
    },
    async download() {
      if(!engine||state.status==='ready')return;
      if(downloading)return downloading;
      downloading=Promise.resolve().then(async()=>{
        try {
          if(state.status!=='available')await updater.check();
          if(state.status!=='available')return;
          state={...state,status:'downloading',percent:0,error:''};
          await engine.downloadUpdate();
        }catch(error){fail(error);}finally{downloading=null;}
      }).finally(()=>{downloading=null;});
      return downloading;
    },
    apply() {
      if(!engine||state.status!=='ready')return;
      state={...state,status:'installing'};
      setImmediate(()=>{try{engine.quitAndInstall();}catch(error){fail(error);}});
    },
  };
  return updater;
}
module.exports={createUpdater};
