(function(root){
  'use strict';
  const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
  const button=(text,handler)=>{const n=node('button',text);n.className='btn ghost';n.onclick=handler;return n;};
  const time=seconds=>seconds==null?'Estimating…':seconds<60?'About '+Math.max(1,Math.ceil(seconds/5)*5)+' sec left':'About '+Math.ceil(seconds/60)+' min left';
  let host,list,summary,uploading=false,polling=false;
  const rows=new Map();
  async function request(url,options){const r=await fetch(url,options),j=await r.json();if(!r.ok)throw Error(j.detail||j.error||'Could not update the queue.');return j;}
  function upload(file,meta,onProgress){return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();xhr.open('POST','/api/batch-upload?meta='+encodeURIComponent(JSON.stringify(meta)));xhr.responseType='json';
    xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress(e.loaded/e.total);};
    xhr.onload=()=>xhr.status===201?resolve(xhr.response):reject(Error(xhr.response?.detail||'Could not save this file.'));
    xhr.onerror=()=>reject(Error('File copying stopped. Reopen Junk Drawer and add any files that did not reach the queue.'));
    xhr.onabort=()=>reject(Error('File copying was cancelled.'));xhr.send(file);
  });}
  async function action(id,action){try{await request('/api/batch-action?id='+encodeURIComponent(id)+'&action='+action,{method:'POST'});await refresh();}catch(e){summary.textContent=e.message;}}
  async function refresh(){
    if(!host||polling)return;polling=true;
    try{
      const {jobs}=await request('/api/batch-jobs');host.hidden=!jobs.length&&!uploading;
      const ids=new Set(jobs.map(j=>j.id));for(const [id,row]of rows)if(!ids.has(id)){row.remove();rows.delete(id);}
      const done=jobs.filter(j=>j.state==='done').length,failed=jobs.filter(j=>j.state==='failed').length,active=jobs.filter(j=>['running','queued'].includes(j.state));
      if(!uploading){const progress=jobs.length?Math.round(jobs.reduce((s,j)=>s+(['done','failed'].includes(j.state)?1:j.progress||0),0)/jobs.length*100):0;summary.textContent=done+' / '+jobs.length+' complete'+(failed?' · '+failed+' failed':'')+' · '+progress+'%'+(active.length?' · '+(active.length>1?'Estimating batch time…':time(active[0].etaSeconds)):'');}
      for(const j of jobs){
        let row=rows.get(j.id);if(!row){row=node('article');row.className='batch-job';rows.set(j.id,row);list.append(row);}
        const key=JSON.stringify(j);if(row.dataset.value===key)continue;row.dataset.value=key;
        // Keep keyboard focus on the corresponding action across progress polls.
        const focus=row.contains(document.activeElement)?document.activeElement?.textContent:null;
        row.replaceChildren(node('strong',j.name));
        const p=node('progress');p.max=100;p.value=Math.round((j.progress||0)*100);p.setAttribute('aria-label',j.name+' progress');row.append(p);
        const friendlyError=/invalid data|error opening input|could not find codec|end of file/i.test(j.error||'')?'This file could not be read as media. Try Look Inside a File.':(j.error||'').length>250?'The engine could not finish this file. See technical details.':j.error;
        const status=node('p',j.state==='done'?'Done':j.state==='failed'?'Could not finish: '+friendlyError:j.state==='paused'?'Paused · saved progress':(j.phase||j.state)+' · '+Math.floor((j.progress||0)*100)+'%'+(j.state==='running'?' · '+time(j.etaSeconds):''));status.className='note';row.append(status);
        if(j.state==='failed'){const detail=node('details');detail.append(node('summary','Technical details'),node('pre',j.error));row.append(detail);}
        if(j.notice)row.append(node('p',j.notice));
        const actions=node('div');actions.className='runrow';
        if(j.state==='done'){const a=node('a','Save file');a.className='btn';a.href='/api/batch-result?id='+j.id;a.download=j.outputName;actions.append(a);}
        if(['running','queued'].includes(j.state))actions.append(button('Pause',()=>action(j.id,'pause')));
        if(['paused','failed'].includes(j.state))actions.append(button(j.state==='failed'?'Retry':'Resume',()=>action(j.id,'resume')));
        if(!['running','queued'].includes(j.state))actions.append(button('Remove',()=>{if(confirm('Remove this job and its saved working copies? Files you saved elsewhere stay untouched.'))void action(j.id,'remove');}));
        row.append(actions);if(focus)[...actions.children].find(n=>n.textContent===focus)?.focus();
      }
    }catch{}finally{polling=false;}
  }
  async function submit(files,kind,options){
    if(uploading)throw Error('Wait for the current files to finish copying.');
    uploading=true;host.hidden=false;let added=0;
    try{
      for(const file of files){const label='Saving '+(added+1)+' / '+files.length+' · '+file.name;summary.textContent=label;await upload(file,{name:file.name,kind,options},p=>summary.textContent=label+' · '+Math.round(p*100)+'%');added++;await refresh();}
    }catch(e){throw Error(added+' files queued. '+e.message);}finally{uploading=false;await refresh();}
    host.scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  function attach(container){
    host=node('details');host.open=true;host.hidden=true;host.className='batch-panel';const heading=node('summary','File queue');host.append(heading);
    summary=node('p');summary.setAttribute('role','status');host.append(summary,node('p','Files become resumable once copying finishes. Sleep pauses work; reopen Junk Drawer to resume after a restart. Working copies use disk space until you remove the job.'));
    const controls=node('div');controls.className='runrow';controls.append(button('Pause all',async()=>{const {jobs}=await request('/api/batch-jobs');for(const j of jobs)if(['running','queued'].includes(j.state))await action(j.id,'pause');}),button('Resume paused',async()=>{const {jobs}=await request('/api/batch-jobs');for(const j of jobs)if(j.state==='paused')await action(j.id,'resume');}));host.append(controls);list=node('div');host.append(list);container.append(host);void refresh();setInterval(refresh,1000);
  }
  root.JDBatch={attach,submit,refresh,hardware:()=>request('/api/batch-hardware')};
})(globalThis);
