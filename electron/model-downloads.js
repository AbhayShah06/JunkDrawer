'use strict';
const fs=require('node:fs'),path=require('node:path');
const {Readable,Transform}=require('node:stream');
const {pipeline}=require('node:stream/promises');

// One server-owned transfer per model. A renderer disconnect does not cancel it.
function createModelDownloads(dir,{catalog,fetcher=fetch,onProgress=()=>{}}){
  const jobs=new Map(),states=new Map();
  const definition=name=>Object.hasOwn(catalog,name)?catalog[name]:null;
  const ready=name=>{const m=definition(name);if(!m)return false;try{return m.ready?fs.existsSync(path.join(dir,m.ready)):fs.statSync(path.join(dir,name)).size===m.size;}catch{return false;}};
  // After a crash or app exit, discard only known unfinished model files.
  for(const name of Object.keys(catalog))try{fs.unlinkSync(path.join(dir,name+'.part'));}catch(e){if(e.code!=='ENOENT')states.set(name,{error:'An unfinished download is locked. Restart Junk Drawer to retry cleanup.'});}
  function list(){return Object.entries(catalog).map(([name,m])=>({name,ready:ready(name),sizeMB:Math.round(m.size/1e6),sizeBytes:m.size,retired:!!m.retired,downloading:jobs.has(name),...(states.get(name)||{})}));}
  function download(name){
    const m=definition(name);if(!m)return Promise.reject(Error('unknown-model'));if(m.retired)return Promise.reject(Error('retired-feature'));
    if(jobs.has(name))return jobs.get(name).promise;if(ready(name))return Promise.resolve();
    const controller=new AbortController(),dest=path.join(dir,name),partial=dest+'.part';
    states.set(name,{progress:0,receivedBytes:0,error:null});
    const promise=(async()=>{
      try{
        fs.mkdirSync(dir,{recursive:true});
        const response=await fetcher(m.url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30*60*1000)])});
        if(!response.ok)throw Error('Download failed (HTTP '+response.status+').');
        let bytes=0;
        const meter=new Transform({transform(chunk,_encoding,cb){bytes+=chunk.length;if(bytes>m.size)return cb(Error('Model exceeds its expected size.'));const progress=Math.min(.999,bytes/m.size);states.set(name,{progress,receivedBytes:bytes,error:null});onProgress(name,progress);cb(null,chunk);}});
        await pipeline(Readable.fromWeb(response.body),meter,fs.createWriteStream(partial),{signal:controller.signal});
        if(bytes!==m.size)throw Error('Incomplete model download. Try again.');
        fs.renameSync(partial,dest);states.delete(name);
      }catch(e){states.set(name,{progress:0,receivedBytes:0,error:controller.signal.aborted?'Download cancelled.':e.message});throw e;}
      finally{try{await fs.promises.unlink(partial);}catch(e){if(e.code!=='ENOENT')states.set(name,{error:'Could not remove the unfinished download. Restart Junk Drawer to retry cleanup.'});}jobs.delete(name);onProgress(name,null);}
    })();
    jobs.set(name,{controller,promise});return promise;
  }
  async function cancel(name){if(!definition(name))throw Error('unknown-model');const job=jobs.get(name);if(job){job.controller.abort();await job.promise.catch(()=>{});}}
  return {download,cancel,list,ready,isDownloading:name=>jobs.has(name)};
}
module.exports={createModelDownloads};
