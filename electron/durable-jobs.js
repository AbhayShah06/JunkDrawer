'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {pipeline}=require('node:stream/promises');
const {Transform}=require('node:stream');
const media=require('./media');

// One durable manifest per file. A completed chunk is committed before the next
// checkpoint is advertised, so a killed process only repeats unfinished work.
function createDurableJobs(root,runner){
  fs.mkdirSync(root,{recursive:true});
  const jobs=new Map(); let active=null,closed=false;
  const directory=id=>path.join(root,id);
  function save(j){const dest=path.join(directory(j.id),'job.json');fs.writeFileSync(dest+'.tmp',JSON.stringify(j));fs.renameSync(dest+'.tmp',dest);}
  for(const name of fs.readdirSync(root)){
    if(!/^[a-f0-9-]{36}$/.test(name))continue;
    try{
      if(fs.lstatSync(directory(name)).isSymbolicLink())continue;
      const j=JSON.parse(fs.readFileSync(path.join(directory(name),'job.json'),'utf8'));
      if(j.id!==name||!['convert','transcribe'].includes(j.kind))continue;
      if(['running','queued','uploading'].includes(j.state)){j.state='paused';j.phase='Interrupted — ready to resume';j.etaSeconds=null;save(j);}
      jobs.set(j.id,j);
    }catch{
      // Only remove our own interrupted staging upload, never an unknown folder.
      const dir=directory(name);
      try{if(!fs.lstatSync(dir).isSymbolicLink()&&!fs.existsSync(path.join(dir,'job.json'))&&fs.existsSync(path.join(dir,'source.part')))fs.rmSync(dir,{recursive:true,force:true});}catch{}
    }
  }
  const restored=[...jobs.values()].sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  jobs.clear();for(const j of restored)jobs.set(j.id,j);
  function publicJob(j){const {chunks,...view}=j;return {...view,completedBlocks:chunks?.filter(Boolean).length||0};}
  async function pump(){
    if(active||closed)return;
    const j=[...jobs.values()].find(j=>j.state==='queued');if(!j)return;
    const ctl=new AbortController();active={j,ctl};j.state='running';j.error='';j.phase='Preparing';j.etaSeconds=null;
    let lastSave=0;
    try{
      save(j);
      await runner(j,directory(j.id),ctl.signal,patch=>{
        if(ctl.signal.aborted)return;
        Object.assign(j,patch);
        if(patch.chunks||Date.now()-lastSave>1000){save(j);lastSave=Date.now();}
      });
      if(!ctl.signal.aborted){j.state='done';j.progress=1;j.phase='Done';j.etaSeconds=0;save(j);}
    }catch(e){if(!ctl.signal.aborted){j.state='failed';j.error=e.code==='ENOSPC'?'Not enough disk space. Free some space, then retry.':String(e.message||e).slice(-2000);j.phase='Failed';j.etaSeconds=null;try{save(j);}catch{}}}
    finally{active=null;if(!closed)setImmediate(pump);}
  }
  async function upload(req,meta){
    if(closed)throw Error('The app is shutting down.');
    if(jobs.size>=200)throw Error('Remove some finished jobs before adding more files.');
    if(!['convert','transcribe'].includes(meta.kind))throw Error('Choose a supported task.');
    const supplied=meta.options||{};
    let options;
    if(meta.kind==='convert'){
      if(!media.formats.some(f=>f.ext===supplied.format))throw Error('Choose a supported output format.');
      options={format:supplied.format};
    }else{
      const model=supplied.model||'turbo',format=supplied.format||'txt',device=supplied.device||'auto';
      if(!['base','small','medium','turbo','qwen'].includes(model)||!['txt','srt','vtt'].includes(format)||!['auto','cpu','gpu'].includes(device))throw Error('Choose supported transcription settings.');
      if(model==='qwen'&&(format!=='txt'||device==='gpu'))throw Error('Qwen3 supports CPU text transcription in this build.');
      options={model,format,device,parallel:supplied.parallel===true};
    }
    const extension=path.extname(String(meta.name||'')).slice(1).toLowerCase();
    if(!/^[a-z0-9]{1,8}$/.test(extension))throw Error('This file needs a recognizable extension.');
    const j={id:crypto.randomUUID(),name:path.basename(String(meta.name).replace(/\\/g,'/')).slice(0,220),kind:meta.kind,options,extension,state:'uploading',progress:0,chunks:[],createdAt:new Date().toISOString(),etaSeconds:null};
    const dir=directory(j.id);fs.mkdirSync(dir);
    try{
      let bytes=0;const meter=new Transform({transform(data,_enc,cb){bytes+=data.length;cb(null,data);}});
      await pipeline(req,meter,fs.createWriteStream(path.join(dir,'source.part'),{flags:'wx'}));
      if(!bytes)throw Error('The file is empty.');
      fs.renameSync(path.join(dir,'source.part'),path.join(dir,'input.'+extension));j.bytes=bytes;j.state='queued';j.phase='Waiting';save(j);jobs.set(j.id,j);setImmediate(pump);return publicJob(j);
    }catch(e){fs.rmSync(dir,{recursive:true,force:true});throw e;}
  }
  function action(id,action){
    const j=jobs.get(id);if(!j)throw Error('Job not found.');
    if(action==='remove'){
      if(active?.j===j||j.state==='queued')throw Error('Pause this job before removing it.');
      fs.rmSync(directory(id),{recursive:true,force:true});jobs.delete(id);return;
    }
    if(action==='pause'){
      if(!['running','queued'].includes(j.state))return;
      j.state='paused';j.phase='Paused';j.etaSeconds=null;j.resumeOnWake=false;if(active?.j===j)active.ctl.abort();save(j);
    }else if(action==='resume'){
      if(!['paused','failed'].includes(j.state))return;
      j.state='queued';j.phase='Waiting';j.error='';j.resumeOnWake=false;save(j);setImmediate(pump);
    }else throw Error('Unknown action.');
  }
  function suspend(){for(const j of jobs.values())if(['running','queued'].includes(j.state)){try{action(j.id,'pause');j.resumeOnWake=true;save(j);}catch{}}}
  function resume(){for(const j of jobs.values())if(j.resumeOnWake&&j.state==='paused')action(j.id,'resume');}
  function close(){closed=true;suspend();}
  function result(id){const j=jobs.get(id);if(!j||j.state!=='done'||!/^output\.[a-z0-9]+$/.test(j.output||''))throw Error('The output is not ready.');return {file:path.join(directory(id),j.output),name:j.outputName};}
  return {upload,action,suspend,resume,close,result,list:()=>[...jobs.values()].map(publicJob)};
}
module.exports={createDurableJobs};
