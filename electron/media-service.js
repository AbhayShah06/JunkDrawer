'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const media = require('./media');
const cache = new Map();
function capabilities(binary) {
  if (!binary) return { available:false, formats:[] };
  if (cache.has(binary)) return cache.get(binary);
  const list = flag => {
    const result=spawnSync(binary,['-hide_banner',flag],{encoding:'utf8',timeout:10000,windowsHide:true,maxBuffer:4*1024*1024});
    if(result.error||result.status!==0)return [];
    return result.stdout.split(/\r?\n/).flatMap(line=>{
      const match=/^\s*[A-Z.]{1,6}\s+([a-zA-Z0-9_,]+)\s/.exec(line);
      return match?match[1].split(','):[];
    });
  };
  const encoders=list('-encoders'),muxers=list('-muxers');
  const result={available:encoders.length>0,formats:media.available(encoders,muxers).map(({ext,kind,label})=>({ext,kind,label}))};
  if(result.available)cache.set(binary,result);
  return result;
}
async function probe(req,res,binary) {
  const reply=(status,body)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  if(!binary){req.resume();reply(501,{error:'ffmpeg-missing'});return;}
  const hint=new URL(req.url,'http://localhost').searchParams.get('ext')||'bin';
  const suffix=/^[a-z0-9]{1,8}$/.test(hint)?hint:'bin';
  const filename='input.'+suffix;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jd-probe-')),input=path.join(dir,filename);
  let child,aborted=false;
  const cancel=()=>{if(!res.writableEnded){aborted=true;child?.kill();}};
  res.on('close',cancel);
  try {
    await pipeline(req,fs.createWriteStream(input));
    if(aborted)return;
    const fd=fs.openSync(input,'r'),head=Buffer.alloc(512);let count;
    try{count=fs.readSync(fd,head,0,512,0);}finally{fs.closeSync(fd);}
    const signature=media.identify(head.subarray(0,count));
    if(/SQLite|SILK/.test(signature.label)){reply(200,{recognized:false,reason:signature.note});return;}
    const data=await new Promise((resolve,reject)=>{
      let stderr='',timedOut=false;
      child=spawn(binary,['-hide_banner','-nostdin','-protocol_whitelist','file,pipe','-probesize','10000000','-analyzeduration','5000000','-i',filename],{cwd:dir,windowsHide:true,stdio:['ignore','ignore','pipe']});
      const timer=setTimeout(()=>{timedOut=true;child.kill();},20000);
      child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-50000);});
      child.once('error',e=>{clearTimeout(timer);reject(e);});
      child.once('close',()=>{clearTimeout(timer);resolve({stderr,timedOut});});
    });
    if(aborted)return;
    const streams=data.stderr.split(/\r?\n/).filter(l=>/^\s*Stream #.*(?:Audio|Video):/.test(l)).map(l=>l.trim());
    reply(200,{recognized:streams.length>0,summary:streams.join('\n'),reason:data.timedOut?'Media inspection timed out. The file may need a dedicated application.':streams.length?null:'The engine could not identify playable media. This may be proprietary data, a database, encrypted, incomplete, or unsupported.'});
  }catch(e){if(!aborted)reply(500,{error:'probe-failed',detail:e.code==='ENOSPC'?'Not enough temporary disk space.':'Could not inspect this file.'});}
  finally{res.removeListener('close',cancel);try{fs.rmSync(dir,{recursive:true,force:true,maxRetries:4,retryDelay:100});}catch{}}
}
module.exports={capabilities,probe};
