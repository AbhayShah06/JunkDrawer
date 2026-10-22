'use strict';
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn,spawnSync}=require('node:child_process');
const {pipeline}=require('node:stream/promises');
const {buildTwoPassArgs,calculateFitTarget}=require('./compression');
const software={h264:'libx264',hevc:'libx265',av1:'libsvtav1'},hardwareCache=new Map();
function validate(options={}){
 const mode=options.mode||'size',codec=options.codec||'h264',speed=options.speed||'efficient';
 if(!['quality','size'].includes(mode)||!Object.hasOwn(software,codec)||!['efficient','fast'].includes(speed))throw Object.assign(Error('Choose a valid compression option.'),{code:'bad-compression-options'});
 if(mode==='size'){calculateFitTarget({...options,duration:options.probeDuration?1:options.duration});if(codec!=='h264')throw Object.assign(Error('Size limits use the compatible MP4 format.'),{code:'bad-compression-options'});}
 return {...options,mode,codec,speed};
}
function available(binary){if(!binary)return {available:false,codecs:[]};const result=spawnSync(binary,['-hide_banner','-encoders'],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:4000000});return {available:result.status===0,codecs:Object.entries(software).filter(([,e])=>new RegExp('\\b'+e+'\\b').test(result.stdout||'')).map(([id])=>id)};}
function metadata(stderr){const duration=/Duration:\s*(\d+):(\d+):([\d.]+)/.exec(stderr);const video=stderr.split(/\r?\n/).find(s=>/Stream #.*Video:/.test(s))||'';const color=/(bt2020nc|bt2020c|bt709)\/(bt2020|smpte432|smpte431|bt709)\/(smpte2084|arib-std-b67)/.exec(video);return {...(color?{color:{matrix:color[1],primaries:color[2],transfer:color[3]}}:{}),duration:duration?+duration[1]*3600+(+duration[2])*60+(+duration[3]):0,hdr:/smpte2084|arib-std-b67/.test(video),tenBit:/p10|p12|p016|p010/.test(video),aac:/Stream #.*Audio: aac\b/.test(stderr),hasVideo:!!video};}
function qualityArgs({codec,encoder=software[codec],info,input='input.bin',output='output.mp4',fast=false}){
 const gpu=encoder!==software[codec];const color=info.color||{matrix:'bt2020nc',primaries:'bt2020',transfer:'smpte2084'},primaries=({bt2020:9,smpte432:12,smpte431:11,bt709:1})[color.primaries],transfer=color.transfer==='arib-std-b67'?18:16,matrix=({bt2020nc:9,bt2020c:10,bt709:1})[color.matrix];const args=['-i',input,'-map','0:v:0','-map','0:a:0?','-sn','-dn','-c:v',encoder,'-threads','4','-pix_fmt',(info.hdr||info.tenBit)&&codec!=='h264'?'yuv420p10le':'yuv420p'];
 if(!gpu){if(codec==='h264')args.push('-crf','23','-preset',fast?'fast':'slow');
 if(codec==='hevc')args.push('-crf','28','-preset',fast?'fast':'medium','-x265-params','pools=4:frame-threads=2:log-level=error'+(info.hdr?':colorprim='+primaries+':transfer='+transfer+':colormatrix='+matrix:''));if(codec==='av1')args.push('-crf','32','-preset',fast?'8':'6','-svtav1-params','lp=4'+(info.hdr?':color-primaries='+primaries+':transfer-characteristics='+transfer+':matrix-coefficients='+matrix:''));}
 else if(encoder.endsWith('_nvenc'))args.push('-rc','vbr','-cq',codec==='h264'?'23':'28','-b:v','0','-preset','p5');
 else if(encoder.endsWith('_qsv'))args.push('-global_quality',codec==='h264'?'23':'28');
 else args.push('-rc','cqp','-qp_i','26','-qp_p','28');
 if(info.hdr)args.push('-color_primaries',color.primaries,'-color_trc',color.transfer,'-colorspace',color.matrix);
 if(codec==='hevc')args.push('-tag:v','hvc1');
 args.push(...(info.aac?['-c:a','copy']:['-c:a','aac','-b:a','128k']),'-movflags','+faststart',output);return args;
}
async function handle(req,res,binary,{progress,kill,cleanup}){
 const reply=(status,error,detail)=>{if(res.destroyed||res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error,detail}));};
 let options,id;try{const params=new URL(req.url,'http://localhost').searchParams;id=params.get('id');try{options=JSON.parse(params.get('meta'));}catch{throw Object.assign(Error('Invalid request.'),{code:'bad-meta'});}if(!/^[A-Za-z0-9-]{1,64}$/.test(id||''))throw Object.assign(Error('Invalid job ID.'),{code:'bad-job-id'});options=validate(options);}catch(e){req.resume();reply(400,e.code||'bad-meta',e.message);return;}
 if(!binary){req.resume();reply(501,'ffmpeg-missing','Install the desktop app to compress videos.');return;}
 binary=path.resolve(binary);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jd-video-')),input=path.join(dir,'input.bin'),output=path.join(dir,'output.mp4');let active=null,aborted=false;
 const cancel=()=>{if(!res.writableEnded){aborted=true;if(active)kill(active);}};res.on('close',cancel);
 async function run(args,offset=0,weight=1,timeout=0){return new Promise((resolve,reject)=>{if(aborted)return reject(Error('Cancelled.'));let stderr='';const child=spawn(binary,['-nostdin','-y','-protocol_whitelist','file,pipe',...args],{cwd:dir,detached:true,windowsHide:true,stdio:['ignore','ignore','pipe']});active=child;const timer=timeout?setTimeout(()=>kill(child),timeout):null;child.stderr.on('data',b=>{stderr=(stderr+String(b)).slice(-32000);const m=/time=\s*(\d+):(\d\d):([\d.]+)/.exec(String(b));if(m&&options.duration)progress.set(id,Math.min(.99,offset+weight*(+m[1]*3600+(+m[2])*60+(+m[3]))/options.duration));});child.once('error',reject);child.once('close',code=>{clearTimeout(timer);if(active===child)active=null;resolve({code,stderr});});});}
 try{
  await pipeline(req,fs.createWriteStream(input));if(aborted)return;const original=fs.statSync(input).size;
  if(options.mode==='size'&&original<=options.targetMb*1e6){reply(409,'already-small','This file is already under the selected size limit.');return;}
  const probe=await run(['-hide_banner','-i','input.bin'],0,0,20000),info=metadata(probe.stderr);if(!info.hasVideo||!info.duration){reply(400,'unreadable-video','Could not read the video duration or picture track.');return;}options.duration=info.duration;
  if(info.hdr&&!info.color){reply(422,'hdr-format','This HDR color format is not supported by the compressor.');return;}
  if(info.hdr&&options.codec==='h264'){reply(422,'hdr-format','This video uses HDR. Choose Smaller file or Smallest file to keep its colors.');return;}
  let note='';
  if(options.mode==='size'){
   let target=options.targetMb,done=false;
   for(let attempt=0;attempt<3&&!done;attempt++){
    const plan=buildTwoPassArgs({duration:info.duration,targetMb:target});
    for(const [index,args] of [plan.pass1,plan.pass2].entries()){const result=await run(args,index*.5,.5);if(aborted)return;if(result.code!==0)throw Object.assign(Error(result.stderr),{code:'pass'+(index+1)+'-failed'});}
    const bytes=fs.statSync(output).size;done=bytes<=options.targetMb*1e6;if(!done)target*=options.targetMb*1e6/bytes*.94;
   }
   if(!done){reply(422,'target-not-met','The encoder could not meet that size limit. Try a larger limit.');return;}
   note='Size limit checked after encoding.';
  }else{
   let encoder=software[options.codec];
   if(options.speed==='fast'&&!info.hdr&&!info.tenBit){const key=binary+':'+options.codec;let selected=hardwareCache.get(key);if(selected===undefined){selected=null;for(const suffix of ['nvenc','qsv','amf']){const candidate=(options.codec==='hevc'?'hevc':options.codec)+'_'+suffix;const trial=await run(['-f','lavfi','-i','color=s=256x256:d=0.1','-frames:v','1','-c:v',candidate,'-f','null','-'],0,0,7000);if(trial.code===0){selected=candidate;break;}}hardwareCache.set(key,selected);}if(selected)encoder=selected;else note='Hardware encoding unavailable; used the CPU.';}
   let result=await run(qualityArgs({codec:options.codec,encoder,info,fast:options.speed==='fast'}));if(aborted)return;
   if(result.code!==0&&encoder!==software[options.codec]){note='Hardware encoding failed; used the CPU.';result=await run(qualityArgs({codec:options.codec,info,fast:true}));}
   if(result.code!==0)throw Object.assign(Error(result.stderr),{code:'encode-failed'});
  }
  if(aborted)return;const size=fs.statSync(output).size;if(!size)throw Error('The encoder produced an empty file.');
  if(size>=original){reply(409,'already-small','The converted copy would be larger. Keep the original, or choose another compression format.');return;}
  if(info.hdr)note+=(note?' ':'')+'HDR color signaling kept; dynamic HDR metadata is not preserved.';
  progress.set(id,1);res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':size,'X-Compression-Note':note,'X-Original-Size':original,'Access-Control-Expose-Headers':'X-Compression-Note, X-Original-Size'});await pipeline(fs.createReadStream(output),res);
 }catch(e){if(!aborted)reply(500,e.code||'compression-failed',String(e.message).slice(-2000));}
 finally{res.removeListener('close',cancel);progress.delete(id);cleanup(dir);}
}
module.exports={validate,available,metadata,qualityArgs,handle};
