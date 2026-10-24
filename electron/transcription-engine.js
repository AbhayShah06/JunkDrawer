'use strict';
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawn}=require('node:child_process');
const media=require('./media');
const {createModelPacks}=require('./model-packs');
const MODEL_FILES={base:'ggml-base.bin',small:'ggml-small.bin',medium:'ggml-medium.bin',turbo:'ggml-large-v3-turbo.bin'};
function execute(bin,args,cwd,signal,onData=()=>{},stdoutOnly=false){
  return new Promise((resolve,reject)=>{
    if(signal.aborted)return reject(Error('Paused'));
    let log='',out='',spawnError;
    const child=spawn(bin,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,SPEECH_NO_UPDATE_CHECK:'1',HF_HUB_OFFLINE:'1'}});
    const cancel=()=>child.kill();signal.addEventListener('abort',cancel,{once:true});
    const read=data=>{const s=String(data);log=(log+s).slice(-16000);onData(s,log);};
    child.stdout.on('data',data=>{if(stdoutOnly)out+=String(data);read(data);});child.stderr.on('data',read);
    child.once('error',e=>{spawnError=e;});
    child.once('close',code=>{signal.removeEventListener('abort',cancel);if(signal.aborted)return reject(Error('Paused'));if(spawnError)return reject(spawnError);if(code!==0)return reject(Error(log.slice(-2500)||'The engine stopped unexpectedly.'));resolve(stdoutOnly?out:log);});
  });
}
function clock(ms,separator=','){ms=Math.round(Math.max(0,ms));return String(Math.floor(ms/3600000)).padStart(2,'0')+':'+String(Math.floor(ms/60000)%60).padStart(2,'0')+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+separator+String(ms%1000).padStart(3,'0');}
function mergeBlocks(blocks,format){
  const cues=[];
  for(const block of blocks){
    for(const item of block.transcription||[]){
      if(Array.isArray(item.tokens)&&item.tokens.length){
        const tokens=item.tokens.filter(t=>{
          const from=Number(t.offsets?.from),to=Number(t.offsets?.to),mid=(from+to)/2+block.offset*1000;
          return (t.id==null||t.id<50257)&&Number.isFinite(from)&&Number.isFinite(to)&&from>=0&&to>=from&&mid>=block.start*1000&&mid<block.end*1000;
        });
        const text=tokens.map(t=>t.text).join('').trim();
        if(text){const start=Math.max(block.start*1000,tokens[0].offsets.from+block.offset*1000),end=Math.min(block.end*1000,tokens.at(-1).offsets.to+block.offset*1000);if(end>start)cues.push({start,end,text});}
        continue;
      }
      const from=Number(item.offsets?.from),to=Number(item.offsets?.to);
      if(!Number.isFinite(from)||!Number.isFinite(to)||to<=from)continue;
      const start=from+block.offset*1000,end=to+block.offset*1000;
      // Overlap supplies context. Ownership by cue midpoint avoids duplicated
      // boundary phrases without deleting repeated words inside actual speech.
      const mid=(start+end)/2;
      if(mid<block.start*1000||mid>=block.end*1000)continue;
      const text=String(item.text||'').trim();if(text)cues.push({start:Math.max(block.start*1000,start),end:Math.min(block.end*1000,end),text});
    }
  }
  cues.sort((a,b)=>a.start-b.start);
  if(format==='txt')return cues.map(c=>c.text).join('\n')+'\n';
  return (format==='vtt'?'WEBVTT\n\n':'')+cues.map((c,i)=>(format==='vtt'?'':(i+1)+'\n')+clock(c.start,format==='vtt'?'.':',')+' --> '+clock(c.end,format==='vtt'?'.':',')+'\n'+c.text).join('\n\n')+'\n';
}
function createTranscriptionEngine({ffmpeg,whisper,gpuWhisper,speech,modelsDir,run=execute,blockSeconds=300}){
  let checked=null,checking=null;
  async function hardware(){
    if(checked)return checked;if(checking)return checking;
    checking=(async()=>{
      let gpu=false,name='';
      // Actual inference is also smoke-tested with the selected model per job.
      const candidate=gpuWhisper||((process.platform==='darwin')?whisper:null);
      if(candidate)try{const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),10000);try{const log=await run(candidate,['--help'],path.dirname(candidate),ctl.signal);gpu=/Vulkan\s*:\s*\d|Metal|ggml_vulkan:.*(?:devices|Intel|AMD|NVIDIA)/i.test(log);name=log.split(/\r?\n/).find(l=>/ggml_vulkan:.*(?:Intel|AMD|NVIDIA)|Metal.*device/i.test(l))||'';}finally{clearTimeout(timer);}}catch{}
      name=name.replace(/^ggml_vulkan:.*?=\s*/,'').split(' |')[0];
      checked={cpu:!!whisper,gpu,gpuName:name.trim(),npu:false,npuNote:'NPU transcription is not supported by the bundled engine.',parallelWorkers:os.freemem()>7*1024**3&&os.cpus().length>=4?2:1};return checked;
    })();try{return await checking;}finally{checking=null;}
  }
  async function runner(j,dir,signal,update){
    if(!ffmpeg)throw Error('The media engine is missing. Reinstall the desktop app.');
    const input='input.'+j.extension;
    const probe=await run(ffmpeg,['-hide_banner','-nostdin','-i',input],dir,signal).catch(e=>{if(signal.aborted)throw e;return e.message;});
    const dm=/Duration:\s*(\d+):(\d+):([\d.]+)/.exec(probe);
    const duration=dm?(+dm[1]*3600+(+dm[2])*60+(+dm[3])):0;
    const started=Date.now();let baseline=0;
    const report=(fraction,phase)=>{const p=Math.max(0,Math.min(.99,fraction)),elapsed=(Date.now()-started)/1000,delta=p-baseline;
      update({progress:p,phase,etaSeconds:elapsed>=5&&delta>=.01?Math.round(elapsed/delta*(1-p)):null});};
    if(j.kind==='convert'){
      const format=media.formats.find(f=>f.ext===j.options.format);if(!format)throw Error('Choose a supported output format.');
      const output='output.'+format.ext;
      // FFmpeg machine-readable progress spans arbitrary stream boundaries.
      await run(ffmpeg,['-nostdin','-y','-protocol_whitelist','file,pipe','-progress','pipe:1','-nostats',...media.plan(format.ext,input,output)],dir,signal,(_s,log)=>{const all=[...log.matchAll(/out_time_us=(\d+)/g)];if(duration&&all.length)report(+all.at(-1)[1]/1e6/duration,'Converting');});
      if(!fs.statSync(path.join(dir,output)).size)throw Error('The converted file is empty.');
      update({output,outputName:path.parse(j.name).name+'-converted.'+format.ext});return;
    }
    const qwen=j.options.model==='qwen',packs=qwen?createModelPacks(modelsDir):null;
    const model=qwen?'qwen3-asr-0.6b-q8.gguf':MODEL_FILES[j.options.model||'turbo'];if(!model)throw Error('Choose a supported speech model.');
    const modelPath=qwen?packs.file(model):path.join(modelsDir,model),vad=qwen?packs.file('silero-vad.gguf'):null;
    if(!modelPath||!fs.existsSync(modelPath)||(qwen&&!vad))throw Error('Download the selected speech model in Manage storage, then retry.');
    if(qwen?!speech:!whisper)throw Error('The transcription engine is missing.');
    if(!duration)throw Error('Could not read the audio duration. Try converting this recording to WAV first.');
    const format=['txt','srt','vtt'].includes(j.options.format)?j.options.format:'txt';
    if(qwen&&format!=='txt')throw Error('Qwen3 outputs text. Use Whisper for subtitle timing.');
    const hw=await hardware();let bin=whisper,gpu=false;
    if(!qwen&&j.options.device!=='cpu'&&hw.gpu){bin=gpuWhisper||whisper;gpu=true;}
    if(j.options.device==='gpu'&&!gpu)throw Error('A compatible GPU engine was not detected. Select Auto or CPU.');
    const count=Math.ceil(duration/blockSeconds),chunks=Array(count).fill(null);
    for(let i=0;i<count;i++){
      try{const saved=JSON.parse(fs.readFileSync(path.join(dir,'block-'+i+'.json'),'utf8'));if(saved.index===i&&Array.isArray(saved.transcription))chunks[i]=saved;}catch{}
    }
    const weights=chunks.map((_,i)=>Math.min(blockSeconds,duration-i*blockSeconds));
    const fractions=chunks.map(c=>c?1:0);
    baseline=weights.reduce((n,w,i)=>n+w*fractions[i],0)/duration;
    const publish=()=>{update({chunks:chunks.map(c=>!!c),totalBlocks:count,device:gpu?'GPU':'CPU'});report(weights.reduce((n,w,i)=>n+w*fractions[i],0)/duration,'Transcribing · '+chunks.filter(Boolean).length+' / '+count+' blocks');};
    publish();
    let next=0;const enoughMemory=os.freemem()>fs.statSync(modelPath).size*4+2*1024**3;
    const workers=j.options.parallel&&!gpu&&enoughMemory?hw.parallelWorkers:1;
    if(j.options.parallel&&workers===1)update({notice:gpu?'GPU processing uses one model instance to limit graphics memory.':'Using one worker to keep memory use within this computer’s limits.'});
    const local=new AbortController();const stop=()=>local.abort();signal.addEventListener('abort',stop,{once:true});
    async function worker(){
      while(!local.signal.aborted){const i=next++;if(i>=count)return;if(chunks[i])continue;
        const start=i*blockSeconds,end=Math.min(duration,start+blockSeconds),offset=qwen?start:Math.max(0,start-2),length=(qwen?end:Math.min(duration,end+2))-offset;
        const wav='block-'+i+'.wav',prefix='part-'+i;
        await run(ffmpeg,['-nostdin','-y','-protocol_whitelist','file,pipe','-ss',String(offset),'-i',input,'-t',String(length),'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le',wav],dir,local.signal);
        const args=['-m',modelPath,'-f',wav,'-ojf','-of',prefix,'-t',String(workers===1?4:Math.max(1,Math.min(4,Math.floor(os.cpus().length/workers)))),'-l','auto','--print-progress',...(format==='txt'?[]:['-ml','60','-sow'])];
        async function infer(useGpu){let activated=false;await run(useGpu?bin:whisper,[...args,...(useGpu?[]:['-ng'])],dir,local.signal,(_s,log)=>{if(/using (?:Vulkan\d*|Metal) backend/i.test(log))activated=true;const matches=[...log.matchAll(/progress\s*=\s*(\d+)%/g)];if(matches.length){fractions[i]=Math.min(.99,+matches.at(-1)[1]/100);report(weights.reduce((n,w,k)=>n+w*fractions[k],0)/duration,'Transcribing · '+chunks.filter(Boolean).length+' / '+count+' blocks');}});if(useGpu&&!activated)throw Error('The GPU backend did not activate for this model.');}
        let data;
        if(qwen){
          // Text is stdout, diagnostics are stderr. Never mix engine logs into a transcript.
          const text=await run(speech,['asr',modelPath,'--vad',vad,'--max-speech-duration-s','20','--device','cpu','--threads','4','--format','text',wav],dir,local.signal,()=>{},true);
          data={transcription:[{offsets:{from:0,to:(end-start)*1000},text:text.trim()}]};
        }else{
          try{await infer(gpu);}catch(e){if(!gpu||j.options.device==='gpu'||local.signal.aborted)throw e;gpu=false;update({device:'CPU',notice:'GPU could not run this model. Continuing on CPU.'});await infer(false);}
          data=JSON.parse(fs.readFileSync(path.join(dir,prefix+'.json'),'utf8'));
        }
        if(!Array.isArray(data.transcription))throw Error('The speech engine returned an invalid transcript.');
        const completed={index:i,start,end,offset,transcription:data.transcription};
        fs.writeFileSync(path.join(dir,'block-'+i+'.json.tmp'),JSON.stringify(completed));fs.renameSync(path.join(dir,'block-'+i+'.json.tmp'),path.join(dir,'block-'+i+'.json'));chunks[i]=completed;fractions[i]=1;publish();
        for(const filename of [wav,prefix+'.json'])try{fs.unlinkSync(path.join(dir,filename));}catch{}
      }
    }
    const tasks=Array.from({length:workers},()=>worker().catch(e=>{local.abort();throw e;}));
    try{const results=await Promise.allSettled(tasks);const failure=results.find(r=>r.status==='rejected');if(failure)throw failure.reason;if(signal.aborted)throw Error('Paused');}
    finally{signal.removeEventListener('abort',stop);}
    const output='output.'+format;fs.writeFileSync(path.join(dir,output+'.tmp'),mergeBlocks(chunks,format));fs.renameSync(path.join(dir,output+'.tmp'),path.join(dir,output));
    update({output,outputName:path.parse(j.name).name+'.'+format});
  }
  return {runner,hardware};
}
module.exports={createTranscriptionEngine,execute,mergeBlocks,clock};
