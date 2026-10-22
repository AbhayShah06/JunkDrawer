/* A persistent update UI; manual checks, startup checks and state polling share one path. */
(function(root){
  function createUpdateBanner({document,fetch,storage,onTimer=setInterval,offTimer=clearInterval}){
    const bar=document.querySelector('#updateBar'),text=bar.querySelector('.ub-txt'),action=bar.querySelector('.ub-get'),dismiss=bar.querySelector('.ub-x');
    let release=null,timer=null,busy=false,lastCheck=0;
    const stored=key=>{try{return storage.getItem(key);}catch{return null;}};
    const show=(message,label,click)=>{text.textContent=message;action.textContent=label;action.hidden=!label;action.disabled=false;action.onclick=click;bar.hidden=false;};
    const request=async(url,options)=>{const r=await fetch(url,options);if(!r.ok)throw Error('Update service unavailable ('+r.status+')');return r.json();};
    const stop=()=>{if(timer){offTimer(timer);timer=null;}};
    const post=async route=>{action.disabled=true;try{await request(route,{method:'POST'});if(!timer)timer=onTimer(poll,800);await poll();}catch{show('The update could not start. Your file tools are still available.','Retry',()=>post(route));}};
    async function poll(){
      try {
        const s=await request('/api/update-state');
        if(s.status==='ready'){stop();show('Junk Drawer '+s.version+' is ready. Restart when your work is saved.','Restart & install',()=>post('/api/update-apply'));}
        else if(s.status==='downloading'){show('Downloading Junk Drawer '+(s.version||release?.latest||'')+' · '+Math.round(s.percent||0)+'%','Downloading…',null);action.disabled=true;}
        else if(s.status==='installing'){show('Restarting to install your update…','',null);}
        else if(s.status==='error'){stop();show('Update failed. You can retry without interrupting your file tools.','Retry download',()=>post('/api/update-download'));}
      }catch{stop();show('Lost contact with the updater. Your files are unaffected.','Retry',()=>check(true));}
    }
    async function check(manual=false){
      if(busy)return;busy=true;lastCheck=Date.now();
      if(manual)show('Checking for updates…','',null);
      try {
        const j=await request('/api/update-check'+(manual?'?manual=1':''));release=j;
        const s=await request('/api/update-state');
        if(['ready','downloading','installing'].includes(s.status)){if(!timer)timer=onTimer(poll,800);await poll();return;}
        if(j.checkError){show('Could not check for updates. Check your connection and try again.','Retry',()=>check(true));return;}
        if(!j.hasUpdate){if(manual)show(j.development?'Development build · updates are checked in the installed app.':'You’re up to date · Junk Drawer '+j.current,'',null);return;}
        if(!manual&&stored('jd-skip-update')===j.latest)return;
        if(j.canAutoUpdate)show('Junk Drawer '+j.latest+' is available. You have '+j.current+'.','Download update',()=>post('/api/update-download'));
        else {const url=j.installerUrl||j.htmlUrl;show('Junk Drawer '+j.latest+' is available.','Download installer',()=>{if(/^https:\/\/(?:[a-z0-9-]+\.)?github\.com\//i.test(url||''))root.open(url,'_blank','noopener');});}
      }catch{show('Could not check for updates. Check your connection and try again.','Retry',()=>check(true));}
      finally{busy=false;}
    }
    dismiss.onclick=()=>{try{if(release?.latest)storage.setItem('jd-skip-update',release.latest);}catch{}bar.hidden=true;};
    return {check,poll,focus:()=>{if(Date.now()-lastCheck>60000)void check();},dispose:stop};
  }
  if(typeof module==='object'&&module.exports)module.exports={createUpdateBanner};else root.JDUpdates={createUpdateBanner};
})(typeof globalThis!=='undefined'?globalThis:this);
