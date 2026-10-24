import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const url=process.argv[2];if(!url)throw Error('usage: node tests/ui-smoke.mjs <url> [screenshots]');
const profile=await mkdtemp(join(tmpdir(),'jd-ui-')),out=resolve(process.argv[3]||profile);await mkdir(out,{recursive:true});
const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=9437',`--user-data-dir=${profile}`,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore',windowsHide:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let pages;for(let i=0;i<150;i++){try{pages=await(await fetch('http://127.0.0.1:9437/json')).json();break;}catch{await wait(100);}}
 const page=pages.find(p=>p.type==='page');const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
 const send=(method,params={})=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),15000);pending.set(n,m=>{clearTimeout(t);m.error?j(Error(m.error.message)):r(m.result);});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const snap=async name=>{const s=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(out,name+'.png'),Buffer.from(s.data,'base64'));};
 const check=(v,msg)=>assert.ok(v,msg);

 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1180,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url});await wait(1200);
 const baseline=await evaluate(`(async()=>{const j=await(await fetch('/api/batch-jobs')).json();return j.jobs.map(j=>j.id);})()`);
 const fixture=process.argv[4];if(!fixture)throw Error('Pass a speech WAV fixture.');
 const bytes=(await readFile(fixture)).toString('base64');
 await evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob('${bytes}'),c=>c.charCodeAt(0))],'voice.wav',{type:'audio/wav'}));d.items.add(new File(['bad'],'bad-voice.wav',{type:'audio/wav'}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);await wait(300);
 await evaluate(`[...document.querySelectorAll('#receipt button')].find(b=>b.textContent==='Transcribe recordings').click()`);
 for(let i=0;i<80;i++){if(await evaluate(`document.querySelector('[aria-label="Transcription processor"]')?.options[2].disabled===false`))break;await wait(100);}
 check(await evaluate(`!document.querySelector('[aria-label="Transcription processor"]').options[2].disabled`),'Vulkan GPU is available in processor choices');
 await evaluate(`document.querySelector('[aria-label="Speech model"]').value='base';document.querySelector('[aria-label="Transcription processor"]').value='gpu';document.querySelector('[aria-label="Transcript format"]').value='srt'`);await snap('transcription-options');
 await evaluate(`document.querySelector('#panel .runrow button').click()`);
 for(let i=0;i<100;i++){if(await evaluate(`!![...document.querySelectorAll('.batch-job')].find(n=>n.querySelector('strong')?.textContent==='voice.wav')`))break;await wait(100);}
 check(await evaluate(`!![...document.querySelectorAll('.batch-job')].find(n=>n.querySelector('strong')?.textContent==='voice.wav')?.querySelector('progress')`),'transcription has an accessible progress bar');
 for(let i=0;i<600;i++){if(await evaluate(`(()=>{const rows=[...document.querySelectorAll('.batch-job')];return rows.find(n=>n.querySelector('strong')?.textContent==='voice.wav')?.textContent.includes('Done')&&rows.find(n=>n.querySelector('strong')?.textContent==='bad-voice.wav')?.textContent.includes('Could not finish');})()`))break;await wait(200);}
 check(await evaluate(`(()=>{const row=[...document.querySelectorAll('.batch-job')].find(n=>n.querySelector('strong')?.textContent==='voice.wav');return row?.querySelector('a[download$=".srt"]')&&row.querySelector('progress').value===100;})()`),'real GPU speech batch produced subtitles');
 check(await evaluate(`!![...document.querySelectorAll('.batch-job')].find(n=>n.querySelector('strong')?.textContent==='bad-voice.wav')?.querySelector('button')`),'failed speech file offers retry');await snap('transcription-batch');
 await send('Page.reload');await wait(1300);
 check(await evaluate(`!![...document.querySelectorAll('.batch-job')].find(n=>n.querySelector('strong')?.textContent==='voice.wav')?.querySelector('a[download]')`),'reloading UI keeps completed transcript download');
 await send('Emulation.setDeviceMetricsOverride',{width:720,height:900,deviceScaleFactor:1,mobile:false});await snap('transcription-narrow');
 check(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'batch UI fits narrow desktop');
 check(errors.length===0,'No browser runtime exceptions: '+errors.join('\n'));
 await evaluate(`(async()=>{const {jobs}=await(await fetch('/api/batch-jobs')).json();for(const j of jobs)if(!${JSON.stringify(baseline)}.includes(j.id))await fetch('/api/batch-action?id='+j.id+'&action=remove',{method:'POST'});})()`);
 console.log(JSON.stringify({passed:true,checks:['GPU option detection','real speech batch','bad-file retry','persistent downloads','narrow desktop','no runtime exceptions'],screenshots:out}));ws.close();
}finally{child.kill();}

