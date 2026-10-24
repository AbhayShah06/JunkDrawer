'use strict';
const fs=require('node:fs');
function createBatchApi(jobs,hardware){
  const reply=(res,status,body)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  return function handle(req,res){
    const url=new URL(req.url,'http://localhost');
    if(!url.pathname.startsWith('/api/batch-'))return false;
    void(async()=>{
      if(req.method==='GET'&&url.pathname==='/api/batch-jobs')return reply(res,200,{jobs:jobs.list()});
      if(req.method==='GET'&&url.pathname==='/api/batch-hardware')return reply(res,200,await hardware());
      if(req.method==='POST'&&url.pathname==='/api/batch-upload'){
        const raw=url.searchParams.get('meta')||'';if(raw.length>4096)throw Error('Job settings are too large.');
        return reply(res,201,await jobs.upload(req,JSON.parse(raw)));
      }
      if(req.method==='POST'&&url.pathname==='/api/batch-action'){
        jobs.action(url.searchParams.get('id'),url.searchParams.get('action'));return reply(res,200,{ok:true});
      }
      if(req.method==='GET'&&url.pathname==='/api/batch-result'){
        const result=jobs.result(url.searchParams.get('id')),stat=fs.statSync(result.file);
        res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stat.size,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(result.name)});
        const stream=fs.createReadStream(result.file);stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());return stream.pipe(res);
      }
      reply(res,405,{error:'method-not-allowed'});
    })().catch(e=>{req.resume();reply(res,400,{error:'batch-error',detail:e.message});});
    return true;
  };
}
module.exports={createBatchApi};
