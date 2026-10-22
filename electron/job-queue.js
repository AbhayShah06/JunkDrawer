'use strict';
function createJobQueue(limit=4){let active=null;const pending=[];
 function pump(){if(active||!pending.length)return;active=pending.shift();const job=active;const fail=e=>{if(job.res.destroyed||job.res.writableEnded)return;job.res.writeHead(500,{'Content-Type':'application/json'});job.res.end(JSON.stringify({error:'job-failed',detail:e.message}));};try{const result=job.start();if(result?.catch)result.catch(fail);}catch(e){fail(e);}}
 function enqueue(req,res,start){req.on?.('error',()=>{});if(pending.length>=limit){req.resume();res.writeHead(429,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'queue-full',detail:'Several jobs are waiting. Wait for one to finish.'}));return;}
 const job={req,res,start};let done=false;const finish=()=>{if(done)return;done=true;res.removeListener('close',finish);res.removeListener('finish',finish);if(active===job)active=null;else{const at=pending.indexOf(job);if(at>=0)pending.splice(at,1);}setImmediate(pump);};res.once('finish',finish);res.once('close',finish);pending.push(job);pump();}
 return {enqueue};}
module.exports={createJobQueue};
