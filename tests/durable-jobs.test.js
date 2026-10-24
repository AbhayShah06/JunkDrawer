const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{Readable}=require('node:stream');
const {createDurableJobs}=require('../electron/durable-jobs');
const tick=()=>new Promise(r=>setTimeout(r,10));
async function until(check){for(let i=0;i<150;i++){if(check())return;await tick();}throw Error('Job did not reach the expected state.');}
test('queued work is durable, pauses on sleep, resumes only interrupted jobs and keeps completed output',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jd-durable-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let finish;const run=async(j,dir,signal,update)=>{update({chunks:[true],progress:.5});await new Promise(resolve=>{finish=resolve;signal.addEventListener('abort',resolve,{once:true});});if(signal.aborted)throw Error('Paused');fs.writeFileSync(path.join(dir,'output.mp3'),'converted');update({output:'output.mp3',outputName:'clip.mp3'});};
 const jobs=createDurableJobs(root,run),first=await jobs.upload(Readable.from(['audio']),{kind:'convert',name:'clip.wav',options:{format:'mp3'}});await until(()=>jobs.list()[0].state==='running');
 const second=await jobs.upload(Readable.from(['audio']),{kind:'convert',name:'second.wav',options:{format:'mp3'}});jobs.action(second.id,'pause');jobs.suspend();assert.equal(jobs.list()[0].state,'paused');assert.equal(jobs.list()[0].completedBlocks,1);
 jobs.resume();await until(()=>jobs.list()[0].state==='running');assert.equal(jobs.list()[1].state,'paused');finish();await until(()=>jobs.list()[0].state==='done');assert.equal(fs.readFileSync(jobs.result(first.id).file,'utf8'),'converted');jobs.close();
 const reopened=createDurableJobs(root,run);assert.equal(reopened.list()[0].state,'done');assert.equal(reopened.list()[1].state,'paused');assert.throws(()=>reopened.action('../outside','remove'),/not found/);reopened.action(first.id,'remove');assert.equal(reopened.list().length,1);reopened.close();
});
test('restart recovers unfinished job without rerunning successful work; one failed file does not block the next',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jd-recover-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));let active;
 const first=createDurableJobs(root,async(j,dir,signal,update)=>{update({chunks:[true],progress:.25});await new Promise(r=>{active=r;signal.addEventListener('abort',r,{once:true});});});
 await first.upload(Readable.from(['data']),{kind:'transcribe',name:'first.wav'});await until(()=>!!active);first.close();await tick();
 let calls=0;const resumed=createDurableJobs(root,async(j,_dir,_signal,update)=>{calls++;assert.deepEqual(j.chunks,[true]);if(calls===1)throw Error('Bad audio');update({progress:1});});
 assert.equal(resumed.list()[0].state,'paused');resumed.action(resumed.list()[0].id,'resume');await until(()=>resumed.list()[0].state==='failed');resumed.action(resumed.list()[0].id,'resume');await until(()=>resumed.list()[0].state==='done');assert.equal(calls,2);resumed.close();
});
test('empty and interrupted uploads never become runnable jobs',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jd-upload-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const jobs=createDurableJobs(root,async()=>assert.fail('must not run'));
 await assert.rejects(jobs.upload(Readable.from([]),{kind:'convert',name:'x.wav',options:{format:'mp3'}}),/empty/);
 await assert.rejects(jobs.upload(Readable.from(['x']),{kind:'bad',name:'x.wav'}),/supported/);
 assert.equal(jobs.list().length,0);assert.deepEqual(fs.readdirSync(root),[]);jobs.close();
});

