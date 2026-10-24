const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createTranscriptionEngine,mergeBlocks,clock}=require('../electron/transcription-engine');
test('overlapping speech blocks merge once with corrected subtitle timing',()=>{
 const blocks=[{start:0,end:300,offset:0,transcription:[{offsets:{from:298000,to:299000},text:'before'},{offsets:{from:300000,to:301000},text:'after'}]},{start:300,end:600,offset:298,transcription:[{offsets:{from:0,to:1000},text:'before'},{offsets:{from:2000,to:3000},text:'after'}]}];
 const srt=mergeBlocks(blocks,'srt');assert.equal((srt.match(/before/g)||[]).length,1);assert.equal((srt.match(/after/g)||[]).length,1);assert.match(srt,/00:05:00,000 --> 00:05:01,000/);assert.match(mergeBlocks(blocks,'vtt'),/^WEBVTT/);assert.equal(clock(3600001),'01:00:00,001');
});
test('chunk checkpoints survive interruption, skip finished blocks, and preserve order under parallel completion',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jd-blocks-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'ggml-base.bin'),'model');let inferred=[];
 fs.writeFileSync(path.join(dir,'block-0.json'),JSON.stringify({index:0,start:0,end:10,offset:0,transcription:[{offsets:{from:0,to:1000},text:'zero'}]}));
 const run=async(_bin,args,cwd,signal,onData)=>{
   if(args.includes('--help'))return 'CPU only';
   if(args.length===4)throw Error('Duration: 00:00:25.00');
   if(args.includes('-ojf')){const prefix=args[args.indexOf('-of')+1],i=+prefix.split('-')[1];inferred.push(i);if(i===1)await new Promise(r=>setTimeout(r,30));if(signal.aborted)throw Error('Paused');fs.writeFileSync(path.join(cwd,prefix+'.json'),JSON.stringify({transcription:[{offsets:{from:2000,to:3000},text:'block '+i}]}));onData('progress = 100%','progress = 100%');}
   return '';
 };
 const engine=createTranscriptionEngine({ffmpeg:'ffmpeg',whisper:'whisper',modelsDir:dir,run,blockSeconds:10}),job={name:'x.wav',extension:'wav',kind:'transcribe',options:{model:'base',format:'srt',device:'cpu',parallel:true}};
 await engine.runner(job,dir,new AbortController().signal,p=>Object.assign(job,p));assert.deepEqual(inferred.sort(),[1,2]);const text=fs.readFileSync(path.join(dir,job.output),'utf8');assert.ok(text.indexOf('zero')<text.indexOf('block 1'));assert.ok(text.indexOf('block 1')<text.indexOf('block 2'));assert.deepEqual(job.chunks,[true,true,true]);
});
test('automatic GPU errors retry on CPU; explicit GPU errors are surfaced',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jd-fallback-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'ggml-base.bin'),'model');const devices=[];
 const run=async(bin,args,cwd)=>{if(args.includes('--help'))return 'ggml_vulkan: Found 1 Vulkan devices: Intel';if(args.length===4)throw Error('Duration: 00:00:05.00');if(args.includes('-ojf')){devices.push(bin);if(bin==='gpu')throw Error('GPU memory exhausted');fs.writeFileSync(path.join(cwd,'part-0.json'),JSON.stringify({transcription:[]}));}return '';};
 const engine=createTranscriptionEngine({ffmpeg:'ffmpeg',whisper:'cpu',gpuWhisper:'gpu',modelsDir:dir,run});const job={name:'x.wav',extension:'wav',kind:'transcribe',options:{model:'base',device:'auto'}};
 await engine.runner(job,dir,new AbortController().signal,p=>Object.assign(job,p));assert.deepEqual(devices,['gpu','cpu']);assert.equal(job.device,'CPU');assert.match(job.notice,/Continuing/);
 fs.unlinkSync(path.join(dir,'block-0.json'));job.options.device='gpu';await assert.rejects(engine.runner(job,dir,new AbortController().signal,()=>{}),/GPU memory/);
});
test('two-hour recording schedules 24 bounded blocks with no more than two workers',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jd-long-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));fs.writeFileSync(path.join(dir,'ggml-base.bin'),'model');let active=0,maximum=0,blocks=0;
 const run=async(_bin,args,cwd)=>{if(args.length===4)throw Error('Duration: 02:00:00.00');if(args.includes('-ojf')){assert.ok(+args[args.indexOf('-t')+1]<=4);active++;maximum=Math.max(maximum,active);blocks++;await new Promise(setImmediate);const prefix=args[args.indexOf('-of')+1];fs.writeFileSync(path.join(cwd,prefix+'.json'),JSON.stringify({transcription:[{offsets:{from:2000,to:3000},text:prefix}]}));active--;}return '';};
 const engine=createTranscriptionEngine({ffmpeg:'ffmpeg',whisper:'whisper',modelsDir:dir,run}),job={name:'two-hours.wav',extension:'wav',kind:'transcribe',options:{model:'base',device:'cpu',parallel:true,format:'srt'}};
 await engine.runner(job,dir,new AbortController().signal,p=>Object.assign(job,p));assert.equal(blocks,24);assert.ok(maximum<=2);assert.equal(job.totalBlocks,24);assert.match(fs.readFileSync(path.join(dir,job.output),'utf8'),/01:55:00,000/);
});
