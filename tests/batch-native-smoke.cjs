// Explicit local integration test: real FFmpeg + Whisper, non-private speech fixture.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {createTranscriptionEngine,execute}=require('../electron/transcription-engine');
const {startServer}=require('../electron/server');
const [work,fixture,processor='cpu']=process.argv.slice(2);if(!work||!fixture)throw Error('Usage: node tests/batch-native-smoke.cjs <QA folder containing models> <speech.wav> [cpu|gpu]');
const root=path.resolve(__dirname,'..'),bin=path.join(root,'resources','bin','win'),ffmpeg=path.join(bin,'ffmpeg.exe');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check){for(let i=0;i<600;i++){const result=await check();if(result)return result;await sleep(200);}throw Error('Timed out waiting for the native job.');}
(async()=>{
 fs.mkdirSync(work,{recursive:true});
 const dir=fs.mkdtempSync(path.join(work,'checkpoints-'));
 const fixtureResult=spawnSync(ffmpeg,['-y','-stream_loop','3','-i',fixture,'-t','28','-ac','1','-ar','16000',path.join(dir,'input.wav')],{windowsHide:true});assert.equal(fixtureResult.status,0,fixtureResult.stderr?.toString());
 const engine=createTranscriptionEngine({ffmpeg,whisper:path.join(bin,'whisper','whisper-cli.exe'),gpuWhisper:processor==='gpu'?path.join(bin,'whisper-gpu','whisper-cli.exe'):null,modelsDir:path.join(work,'models'),blockSeconds:10,run:async(...args)=>{const result=await execute(...args);if(processor==='gpu'&&args[1].includes('-ojf')){fs.writeFileSync(path.join(dir,'gpu-inference.log'),result);assert.match(result,/using Vulkan\d* backend/i);}return result;}});
 console.log('Hardware:',JSON.stringify(await engine.hardware()));
 const ctl=new AbortController();const job={name:'speech.wav',extension:'wav',kind:'transcribe',options:{model:'base',format:'srt',device:processor,parallel:true}};let progress=false;
 await assert.rejects(engine.runner(job,dir,ctl.signal,p=>{Object.assign(job,p);if(p.progress>0&&p.progress<1)progress=true;if(p.chunks?.filter(Boolean).length===1)ctl.abort();}),/Paused/);
 assert.ok(fs.existsSync(path.join(dir,'block-0.json'))||fs.existsSync(path.join(dir,'block-1.json')));const before=fs.readdirSync(dir).filter(n=>/^block-\d+\.json$/.test(n)).map(n=>[n,fs.statSync(path.join(dir,n)).mtimeMs]);
 await engine.runner(job,dir,new AbortController().signal,p=>Object.assign(job,p));for(const [name,mtime]of before)assert.equal(fs.statSync(path.join(dir,name)).mtimeMs,mtime,'completed checkpoint must be reused');
 const srt=fs.readFileSync(path.join(dir,job.output),'utf8');assert.match(srt,/-->/);assert.ok(progress);assert.ok(job.chunks.every(Boolean));
 const cues=[...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d{3}) -->/g)].map(m=>+m[1]*3600+(+m[2])*60+(+m[3])+(+m[4])/1000);assert.deepEqual(cues,[...cues].sort((a,b)=>a-b));assert.ok(cues.at(-1)>10);console.log('Real transcription checkpoint resume: passed');
 let started=await startServer(root,bin,null,null,path.join(work,'models')),origin='http://127.0.0.1:'+started.port;
 const submit=async name=>{const meta=encodeURIComponent(JSON.stringify({name,kind:'convert',options:{format:'mp3'}}));const response=await fetch(origin+'/api/batch-upload?meta='+meta,{method:'POST',headers:{Origin:origin},body:name==='bad.wav'?Buffer.from('bad'):fs.readFileSync(fixture)});assert.equal(response.status,201);return response.json();};
 const good=await submit('good.wav'),bad=await submit('bad.wav');
 await until(async()=>{const {jobs}=await(await fetch(origin+'/api/batch-jobs')).json();return jobs.find(j=>j.id===good.id)?.state==='done'&&jobs.find(j=>j.id===bad.id)?.state==='failed';});
 let result=await fetch(origin+'/api/batch-result?id='+good.id);assert.equal(result.status,200);assert.ok((await result.arrayBuffer()).byteLength>1000);
 const cross=await fetch(origin+'/api/batch-action?id='+good.id+'&action=remove',{method:'POST',headers:{Origin:'https://example.com'}});assert.equal(cross.status,403);
 await new Promise(r=>started.server.close(r));started=await startServer(root,bin,null,null,path.join(work,'models'));origin='http://127.0.0.1:'+started.port;
 result=await fetch(origin+'/api/batch-result?id='+good.id);assert.equal(result.status,200);await result.arrayBuffer();
 for(const id of [good.id,bad.id]){const r=await fetch(origin+'/api/batch-action?id='+id+'&action=remove',{method:'POST',headers:{Origin:origin}});assert.equal(r.status,200);}
 await new Promise(r=>started.server.close(r));console.log('Real conversion batch, mixed failure, restart download, cross-site guard: passed');
})().catch(e=>{console.error(e);process.exit(1);});
