// Run explicitly with: node tests/transcription-one-file-ui.mjs
// Exercises the real browser flow from one dropped audio file to the Run button.
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';

const require=createRequire(import.meta.url);
const {startServer}=require('../electron/server.js');
const dir=await mkdtemp(join(tmpdir(),'jd-one-audio-'));
const {server,port}=await startServer(resolve('.'),resolve('resources/bin/win'),null,null,join(dir,'models'));
const chrome=spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',[
  '--headless=new','--remote-debugging-port=9438',`--user-data-dir=${join(dir,'chrome')}`,
  '--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore',windowsHide:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
let ws;
try{
  let pages;
  for(let i=0;i<100;i++){try{pages=await(await fetch('http://127.0.0.1:9438/json')).json();break;}catch{await wait(100);}}
  assert.ok(pages,'Chrome debugging endpoint started');
  ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,m=>m.error?reject(Error(m.error.message)):resolve(m.result));ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  await send('Runtime.enable');await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`(()=>{const originalFetch=window.fetch.bind(window);window.fetch=(url,options)=>url==='/api/check'?Promise.resolve({ok:true,json:async()=>({whisper:true,whisperTurbo:true})}):originalFetch(url,options)})()`});
  await send('Page.navigate',{url:`http://127.0.0.1:${port}/index.html`});await wait(800);
  await evaluate(`(()=>{const d=new DataTransfer();d.items.add(new File(['fixture'],'one-song.wav',{type:'audio/wav'}));document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()`);
  for(let i=0;i<30;i++){if(await evaluate(`!![...document.querySelectorAll('#receipt .tool .nm')].find(n=>n.textContent==='Transcribe to Text or Subtitles')`))break;await wait(100);}
  await evaluate(`(()=>{globalThis.filePickerOpens=0;const file=document.querySelector('#file');file.click=()=>{filePickerOpens++};[...document.querySelectorAll('#receipt .tool')].find(n=>n.querySelector('.nm')?.textContent==='Transcribe to Text or Subtitles').click();})()`);
  assert.equal(await evaluate(`filePickerOpens`),0,'selected audio must not be requested again');
  assert.match(await evaluate(`document.querySelector('#panel .filechip').textContent`),/one-song\.wav/,'panel must show the selected file');
  await evaluate(`(()=>{globalThis.transcriptionRun=null;JDBatch.submit=async(files,kind,options)=>{transcriptionRun={names:files.map(f=>f.name),kind,format:options.format}};document.querySelector('[aria-label="Transcript format"]').value='srt';document.querySelector('#panel .runrow button').click();})()`);
  for(let i=0;i<20;i++){if(await evaluate(`!!transcriptionRun`))break;await wait(50);}
  const result=await evaluate(`transcriptionRun`);
  if(!result)console.log('Run status:',await evaluate(`document.querySelector('#status').textContent`));
  assert.deepEqual(result,{names:['one-song.wav'],kind:'transcribe',format:'srt'},'one-file SRT Run must reach transcription handler');
  assert.equal(await evaluate(`document.querySelector('#status').textContent.includes('Pick two or more')`),false);
  console.log('PASS: one audio file stays selected and SRT Run reaches transcription handler');
}finally{ws?.close();chrome.kill();await new Promise(resolve=>server.close(resolve));}
