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
 await snap('home');
 await evaluate(`document.querySelector('#q').value='mts';document.querySelector('#q').dispatchEvent(new Event('input',{bubbles:true}))`);
 check(await evaluate(`document.querySelector('#pal').textContent.includes('Convert Video')`),'MTS searchable');
 await evaluate(`document.querySelector('#q').value='';document.querySelector('#q').dispatchEvent(new Event('input'))`);
 // A real MTS file travels through browser File intake, local upload, conversion and save link.
 const fixture=spawnSync(resolve('resources/bin/win/ffmpeg.exe'),['-v','error','-f','lavfi','-i','color=c=blue:size=64x48:rate=10','-t','0.2','-c:v','libx264','-f','mpegts','pipe:1'],{encoding:null,windowsHide:true});assert.equal(fixture.status,0,fixture.stderr?.toString());
 const b64=fixture.stdout.toString('base64');
 const drop=`(()=>{const bytes=Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0));const d=new DataTransfer();d.items.add(new File([bytes],'camera.mts'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`;
 await evaluate(drop);await wait(500);
 await evaluate(`[...document.querySelectorAll('#receipt button')].find(b=>b.textContent.includes('Convert Video')).click()`);await wait(500);
 check(await evaluate(`!!document.querySelector('select[aria-label="Output format"] option[value="mp4"]')`),'MP4 available');
 await snap('conversion');await evaluate(`[...document.querySelectorAll('#panel button')].find(b=>b.textContent==='Convert file').click()`);
 for(let i=0;i<50;i++){if(await evaluate(`!!document.querySelector('.conversion-queue a[download]')`))break;await wait(100);}
 check(await evaluate(`!!document.querySelector('.conversion-queue a[download]')`),'MTS conversion produced a downloadable file');
 await snap('converted');
 // Mixed success/failure batch must keep the successful download and a visible error.
 await evaluate(`document.querySelector('#resetBtn').click()`);
 await evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File([Uint8Array.from(atob('${b64}'),c=>c.charCodeAt(0))],'good.mts'));d.items.add(new File(['not media'],'broken.dat'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);
 await evaluate(`[...document.querySelectorAll('#receipt button')].find(b=>b.textContent==='Convert files').click()`);await wait(250);
 await evaluate(`[...document.querySelectorAll('#panel button')].find(b=>b.textContent==='Convert 2 files').click()`);
 for(let i=0;i<50;i++){if(await evaluate(`document.querySelector('#panel .ds').textContent.includes('1 failed')`))break;await wait(100);}
 check(await evaluate(`document.querySelectorAll('.conversion-queue a[download]').length===1 && document.querySelector('#panel .ds').textContent.includes('1 failed')`),'partial failures retain completed files');
 await snap('batch');

 // Exercise retained file tools with generated, non-private fixtures.
 await evaluate(`(async()=>{const {PDFDocument}=await import('./vendor/pdf-lib.mjs');const p=await PDFDocument.create();p.addPage([200,200]);p.addPage([200,200]);const c=document.createElement('canvas');c.width=80;c.height=60;c.getContext('2d').fillRect(0,0,80,60);globalThis.smokeFiles={pdf:new File([await p.save()],'sample.pdf',{type:'application/pdf'}),image:new File([await new Promise(r=>c.toBlob(r))],'sample.png',{type:'image/png'}),data:new File(['name,value\\nhello,42'],'sample.csv',{type:'text/csv'})};})()`);
 const coreJobs=[['image','Resize Image'],['image','Rotate or Flip'],['image','Remove Hidden Info'],['image','Shrink File Size'],['image','Add a Background'],['image','Make App Icons'],['image','Image to PDF'],['pdf','PDF to Pictures'],['pdf','Split into Single Pages'],['pdf','Turn Pages'],['pdf','Add Page Numbers'],['pdf','Add a Watermark'],['pdf','Delete Pages']];
 for(const [kind,name] of coreJobs){
   await evaluate(`document.querySelector('#resetBtn').click();(()=>{const d=new DataTransfer();d.items.add(smokeFiles[${JSON.stringify(kind)}]);document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);await wait(80);
   await evaluate(`[...document.querySelectorAll('#receipt button')].find(b=>b.querySelector('.nm')?.textContent===${JSON.stringify(name)}).click()`);
   await evaluate(`document.querySelector('#panel .runrow .btn').click()`);
   for(let i=0;i<100;i++){if(await evaluate(`!!document.querySelector('#output a[download]') || !!document.querySelector('#status .guide')`))break;await wait(100);}
   const result=await evaluate(`({ok:!!document.querySelector('#output a[download]'),message:document.querySelector('#status')?.textContent})`);check(result.ok || (name==='Shrink File Size' && result.message.includes('Already small enough')),name+': '+result.message);
 }
 const textJobs=[['Tidy Up JSON','{"hello":42}'],['Switch Between JSON and YAML','{"hello":42}'],['CSV to JSON','name,value\nhello,42'],['JSON to CSV','[{"a,b":"quote"}]'],['Make a QR Code','https://example.com']];
 for(const [name,text] of textJobs){
   await evaluate(`document.querySelector('#resetBtn').click();document.querySelector('#q').value=${JSON.stringify(name)};document.querySelector('#q').dispatchEvent(new Event('input'));[...document.querySelectorAll('#pal .row')].find(b=>b.querySelector('.nm')?.textContent===${JSON.stringify(name)}).click();document.querySelector('#panel textarea').value=${JSON.stringify(text)};document.querySelector('#panel .runrow .btn').click()`);
   for(let i=0;i<100;i++){if(await evaluate(`!!document.querySelector('#output a[download]') || !!document.querySelector('#status .guide')`))break;await wait(100);}
   const result=await evaluate(`({ok:!!document.querySelector('#output a[download]'),message:document.querySelector('#status')?.textContent})`);check(result.ok || (name==='Shrink File Size' && result.message.includes('Already small enough')),name+': '+result.message);
 }


 await evaluate(`document.querySelector('#resetBtn').click();(()=>{const d=new DataTransfer();d.items.add(new File(['one'],'same.txt'));d.items.add(new File(['two'],'same.txt'));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);
 await evaluate(`document.querySelector('#q').value='Create a ZIP';document.querySelector('#q').dispatchEvent(new Event('input'));[...document.querySelectorAll('#pal .row')].find(b=>b.querySelector('.nm')?.textContent==='Create a ZIP').click();document.querySelector('#panel .runrow .btn').click()`);
 for(let i=0;i<50;i++){if(await evaluate(`!!document.querySelector('#output a[download]')`))break;await wait(100);}
 check(await evaluate(`(async()=>{const {unzipSync}=await import('./vendor/fflate.mjs');const bytes=new Uint8Array(await(await fetch(document.querySelector('#output a[download]').href)).arrayBuffer());const files=unzipSync(bytes);return Object.keys(files).length===2 && new TextDecoder().decode(files['same.txt'])==='one' && new TextDecoder().decode(files['same (2).txt'])==='two';})()`),'ZIP retains duplicate-named source files');

 await evaluate(`document.querySelector('#resetBtn').click();document.querySelector('#themeToggle').click()`);await snap('dark');
 await send('Emulation.setDeviceMetricsOverride',{width:720,height:700,deviceScaleFactor:1,mobile:false});await wait(200);await snap('small');
 check(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),'no horizontal overflow');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,screenshots:out,checks:['home catalog','search MTS','native MTS conversion','mixed batch failure','dark theme','720px layout','no runtime exceptions']}));ws.close();
}finally{spawnSync('taskkill',['/pid',String(child.pid),'/t','/f'],{stdio:'ignore',windowsHide:true});child.unref();}
