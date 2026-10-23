'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{Readable,Transform}=require('node:stream'),{pipeline}=require('node:stream/promises');
const definitions=require('./model-packs.json');
function createModelPacks(dir,{catalog=definitions,fetcher=fetch,cleanupStale=false}={}){
 const jobs=new Map(),progress=new Map();
 if(cleanupStale)for(const p of catalog)for(const f of p.files)try{fs.unlinkSync(path.join(dir,f.filename+'.part'));}catch{/* A locked cache file must not prevent the app from starting. */}
 const pack=id=>catalog.find(p=>p.id===id);
 const asset=name=>catalog.flatMap(p=>p.files).find(f=>f.filename===name);
 function ready(file){try{const stat=fs.statSync(path.join(dir,file.filename)),receipt=JSON.parse(fs.readFileSync(path.join(dir,file.filename+'.verified.json')));return stat.isFile()&&stat.size===file.size&&receipt.sha256===file.sha256&&receipt.mtimeMs===stat.mtimeMs;}catch{return false;}}
 async function download(id){const p=pack(id);if(!p)throw Error('Unknown model pack.');if(jobs.has(id))return jobs.get(id);
  const task=(async()=>{fs.mkdirSync(dir,{recursive:true});let completed=0;const total=p.files.reduce((n,f)=>n+f.size,0);try{for(const file of p.files){if(ready(file)){completed+=file.size;continue;}const dest=path.join(dir,file.filename),partial=dest+'.part',hash=crypto.createHash('sha256');let bytes=0;const response=await fetcher(file.url,{signal:AbortSignal.timeout(30*60*1000)});if(!response.ok)throw Error('Model download failed ('+response.status+').');const check=new Transform({transform(chunk,_enc,cb){bytes+=chunk.length;if(bytes>file.size)return cb(Error('Model exceeds its expected size.'));hash.update(chunk);progress.set(id,Math.min(.99,(completed+bytes)/total));cb(null,chunk);}});
    try{await pipeline(Readable.fromWeb(response.body),check,fs.createWriteStream(partial));if(bytes!==file.size||hash.digest('hex')!==file.sha256)throw Error('Model checksum did not match.');fs.renameSync(partial,dest);fs.writeFileSync(dest+'.verified.json',JSON.stringify({sha256:file.sha256,mtimeMs:fs.statSync(dest).mtimeMs}));completed+=bytes;}finally{try{fs.unlinkSync(partial);}catch{}}}
  }finally{progress.delete(id);}})();jobs.set(id,task);try{await task;}finally{jobs.delete(id);}}
 function list(){return catalog.map(p=>({id:p.id,label:p.label,sizeBytes:p.files.reduce((n,f)=>n+f.size,0),sizeMB:Math.ceil(p.files.reduce((n,f)=>n+f.size,0)/1e6),ready:p.files.every(ready),downloading:jobs.has(p.id),progress:progress.get(p.id)||0}));}
 function remove(id){const p=pack(id);if(!p)throw Error('Unknown model pack.');if(jobs.has(id))throw Error('Wait for the download to finish.');for(const f of p.files)for(const suffix of ['', '.verified.json'])try{fs.unlinkSync(path.join(dir,f.filename+suffix));}catch(e){if(e.code!=='ENOENT')throw e;}}
 function file(name){const f=asset(name);return f&&ready(f)?path.join(dir,f.filename):null;}
 async function route(req,res){const url=new URL(req.url,'http://localhost'),reply=(status,body)=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));}};
  if(url.pathname==='/api/model-packs'&&req.method==='GET'){reply(200,{packs:list()});return true;}
  if(url.pathname==='/api/model-pack-file'&&req.method==='GET'){const dest=file(url.searchParams.get('name'));if(!dest){reply(404,{error:'model-not-installed'});return true;}res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':fs.statSync(dest).size,'Cache-Control':'no-cache'});const stream=fs.createReadStream(dest);res.on('close',()=>stream.destroy());stream.on('error',()=>res.destroy());stream.pipe(res);return true;}
  if(['/api/download-model-pack','/api/delete-model-pack'].includes(url.pathname)&&req.method==='POST'){try{let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)throw Error('Invalid request.');}const {id}=JSON.parse(body);if(url.pathname==='/api/download-model-pack')await download(id);else remove(id);reply(200,{ok:true,packs:list()});}catch(e){reply(400,{error:'model-pack-failed',detail:e.message});}return true;}
  return false;
 }
 return {download,list,remove,file,route};
}
module.exports={createModelPacks};
