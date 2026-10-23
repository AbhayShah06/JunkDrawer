import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const url=process.argv[2];if(!url)throw Error('usage: node tests/ui-smoke.mjs <url> [screenshots]');
const profile=await mkdtemp(join(tmpdir(),'jd-ui-')),out=resolve(process.argv[3]||profile);await mkdir(out,{recursive:true});
const child=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=9437',`--user-data-dir=${profile}`,'--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore',windowsHide:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
try{
 let pages;for(let i=0;i<40;i++){try{pages=await(await fetch('http://127.0.0.1:9437/json')).json();break;}catch{await wait(100);}}
 const page=pages.find(p=>p.type==='page');const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 let id=0;const pending=new Map(),errors=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
 const send=(method,params={})=>new Promise((r,j)=>{const n=++id,t=setTimeout(()=>j(Error('CDP timeout '+method)),15000);pending.set(n,m=>{clearTimeout(t);m.error?j(Error(m.error.message)):r(m.result);});ws.send(JSON.stringify({id:n,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 const snap=async name=>{const s=await send('Page.captureScreenshot',{format:'png'});await writeFile(join(out,name+'.png'),Buffer.from(s.data,'base64'));};
 const check=(v,msg)=>assert.ok(v,msg);
 await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width:1180,height:900,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url});await wait(1000);
 check(await evaluate(`document.querySelector('#starTools').children.length===6`),'common tasks load');
 check(await evaluate(`getComputedStyle(document.querySelector('.home-index')).display!=='none'`),'task surface visible');check(await evaluate(`!!document.querySelector('#integrationHome')`),'desktop integration discoverable');
 check(await evaluate(`document.querySelector('#drawerBrowser').children.length>0`),'catalog populated');
 check(await evaluate(`JSON.stringify([...document.querySelectorAll('#starTools .nm')].map(n=>n.textContent))===JSON.stringify(['Make files smaller','Convert images to JPG','Combine PDFs','Convert video to MP4','Save audio as MP3','Resize an image'])`),'everyday actions are first');
 const fixturePath=process.argv[4];if(!fixturePath)throw Error('Pass a video with speech as the fourth argument.');
 const {readFile}=await import('node:fs/promises');const b64=(await readFile(fixturePath)).toString('base64');
 const openBurn=async()=>{await evaluate(`document.querySelector('#resetBtn').click();(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0))],'speech.mp4',{type:'video/mp4'}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);
   for(let i=0;i<80;i++){if(await evaluate(`!![...document.querySelectorAll('#receipt button')].find(b=>b.querySelector('.nm')?.textContent==='Burn In Subtitles')`))break;await wait(100);}
   await evaluate(`[...document.querySelectorAll('#receipt button')].find(b=>b.querySelector('.nm')?.textContent==='Burn In Subtitles').click()`);};
 await openBurn();
 check(await evaluate(`document.querySelector('[aria-label="Subtitle source"]').value==='file' && document.querySelector('[aria-label="Subtitle file"]').checkVisibility() && !document.querySelector('[aria-label="Subtitle model"]').checkVisibility()`),'existing subtitle upload is the default');
 await evaluate(`document.querySelector('#panel .runrow .btn').click()`);check(await evaluate(`document.querySelector('#status').textContent.includes('Generate from this video')`),'missing subtitle file offers generation');
 await evaluate(`const source=document.querySelector('[aria-label="Subtitle source"]');source.value='generate';source.dispatchEvent(new Event('change'))`);
 check(await evaluate(`document.querySelector('[aria-label="Subtitle model"]').value==='base' && !document.querySelector('[aria-label="Subtitle file"]').checkVisibility()`),'generation defaults to the smaller CPU model');await snap('subtitle-source');
 await evaluate(`document.querySelector('#panel .runrow .btn').click()`);
 for(let i=0;i<240;i++){if(await evaluate(`!!document.querySelector('[aria-label="Generated subtitles"]') || !!document.querySelector('#status .guide')`))break;await wait(500);}
 const generated=await evaluate(`({text:document.querySelector('[aria-label="Generated subtitles"]')?.value,error:document.querySelector('#status').textContent})`);
 check(generated.text?.includes('-->'),'real local Whisper returned timed subtitles: '+generated.error);check(!await evaluate(`!!document.querySelector('#output a[download$=".mp4"]')`),'generation waits for review before encoding');await snap('subtitle-review');
 await evaluate(String.raw`const edit=document.querySelector('[aria-label="Generated subtitles"]');edit.value+='\n\n2\n00:00:06,000 --> 00:00:07,000\nEdited subtitle\n';edit.dispatchEvent(new Event('input'))`);
 check(await evaluate(`(async()=>{const a=document.querySelector('#output a[download$=".srt"]');return (await(await fetch(a.href)).text()).includes('Edited subtitle');})()`),'saved subtitles include user edits');
 await evaluate(`[...document.querySelectorAll('#output button')].find(b=>b.textContent==='Burn subtitles into video').click()`);
 for(let i=0;i<240;i++){if(await evaluate(`!!document.querySelector('#output a[download$=".mp4"]') || !!document.querySelector('#status .guide')`))break;await wait(250);}
 check(await evaluate(`!!document.querySelector('#output a[download$=".mp4"]')`),'reviewed captions burn into a downloadable MP4');await snap('subtitle-burned');
 const probe=await evaluate(`(async()=>{const blob=await(await fetch(document.querySelector('#output a[download$=".mp4"]').href)).blob();return (await fetch('/api/probe-media?ext=mp4',{method:'POST',body:blob})).json();})()`);check(probe.recognized,'captioned video reopens');
 await openBurn();
 await evaluate(String.raw`const d=new DataTransfer();d.items.add(new File(['1\n00:00:00,000 --> 00:00:04,000\nExisting subtitle\n'],'existing.srt',{type:'text/plain'}));document.querySelector('[aria-label="Subtitle file"]').files=d.files;document.querySelector('#panel .runrow .btn').click()`);
 for(let i=0;i<160;i++){if(await evaluate(`!!document.querySelector('#output a[download$=".mp4"]') || !!document.querySelector('#status .guide')`))break;await wait(250);}
 check(await evaluate(`!!document.querySelector('#output a[download$=".mp4"]')`),'existing SRT path still works');
 // A pending model transfer belongs to the app, while the abandoned task must stay cancelled.
 await openBurn();
 await evaluate(`globalThis.downloadMock={fetch:window.fetch.bind(window),active:false,ready:false,toolCalls:0};window.fetch=async(url,options)=>{
   if(url==='/api/fetch-model' && JSON.parse(options.body).name==='ggml-small.bin'){downloadMock.active=true;return new Promise(resolve=>{downloadMock.finish=()=>{downloadMock.active=false;downloadMock.ready=true;resolve(new Response(JSON.stringify({ok:true}),{status:200}));};});}
   if(url==='/api/models'){const body=await(await downloadMock.fetch(url,options)).json();const model=body.models.find(m=>m.name==='ggml-small.bin');Object.assign(model,{downloading:downloadMock.active,ready:downloadMock.ready,progress:downloadMock.active?.4:0});return new Response(JSON.stringify(body));}
   if(String(url).startsWith('/api/tool?'))downloadMock.toolCalls++;
   return downloadMock.fetch(url,options);};
   const source2=document.querySelector('[aria-label="Subtitle source"]');source2.value='generate';source2.dispatchEvent(new Event('change'));document.querySelector('[aria-label="Subtitle model"]').value='small';document.querySelector('#panel .runrow .btn').click()`);
 await wait(200);await evaluate(`document.querySelector('#manageStorage').click()`);await wait(1700);
 check(await evaluate(`!document.querySelector('#modelDownloads').hidden && document.querySelector('#modelDownloads').textContent.includes('40%') && document.querySelector('#panel').textContent.includes('Downloading')`),'download progress stays visible after switching tools');await snap('storage-downloading');
 await evaluate(`downloadMock.finish()`);await wait(1700);
 check(await evaluate(`document.querySelector('#modelDownloads').hidden && !document.querySelector('[aria-label="Generated subtitles"]') && downloadMock.toolCalls===0 && document.querySelector('#panel').textContent.includes('Manage storage')`),'download is retained without resuming an abandoned transcription');
 await evaluate(`window.fetch=downloadMock.fetch`);
 await evaluate(`document.querySelector('#manageStorage').click()`);await wait(400);await snap('storage');
 const storage=await evaluate(`({rows:[...document.querySelectorAll('.storage-model')].map(n=>({size:n.querySelector('.storage-size').textContent,label:n.querySelector('b').textContent,purpose:n.querySelector('.storage-description span').textContent,top:n.getBoundingClientRect().top})),cols:getComputedStyle(document.querySelector('.storage-models')).display,text:document.querySelector('#panel').textContent})`);
 check(storage.rows.length===7 && storage.cols==='block','storage is one list with no uninstalled retired tools');check(storage.rows.every((r,i)=>!i||r.top>storage.rows[i-1].top),'storage rows are vertically sequential');check(storage.rows[0].size.includes('32')&&storage.rows.at(-1).label==='Whisper turbo','storage runs from smallest to largest');check(storage.rows.every(r=>r.purpose),'every model explains its purpose');
 await send('Emulation.setDeviceMetricsOverride',{width:720,height:700,deviceScaleFactor:1,mobile:false});await snap('storage-small');check(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'storage fits a smaller window');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,screenshots:out,checks:['local Whisper generation','edit and save SRT','review before burn','real burn-in','existing subtitle upload','storage ordering']}));ws.close();
}finally{spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});child.unref();}
