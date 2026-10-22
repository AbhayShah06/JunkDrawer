// Render the vector master into PNG and a multi-resolution Windows ICO. Needs Chrome.
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),svg=await readFile(join(root,'branding','mark.svg'),'utf8');
const profile=await mkdtemp(join(tmpdir(),'jd-icon-'));
const browser=spawn(process.env.CHROME_PATH||'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',['--headless=new','--remote-debugging-port=9439',`--user-data-dir=${profile}`,'--no-first-run','about:blank'],{windowsHide:true,stdio:'ignore'});
try{
 let pages;for(let i=0;i<40;i++){try{pages=await(await fetch('http://127.0.0.1:9439/json')).json();break;}catch{await new Promise(r=>setTimeout(r,100));}}
 const ws=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});let id=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);pending.get(m.id)?.(m);pending.delete(m.id);};
 const send=(method,params)=>new Promise((r,j)=>{const n=++id;pending.set(n,m=>m.error?j(Error(m.error.message)):r(m.result));ws.send(JSON.stringify({id:n,method,params}));});
 const result=await send('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{const image=new Image();image.src='data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';await image.decode();return [16,24,32,48,64,128,256,1024].map(size=>{const c=document.createElement('canvas');c.width=c.height=size;c.getContext('2d').drawImage(image,0,0,size,size);return {size,png:c.toDataURL('image/png').split(',')[1]};});})()`});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);
 const images=result.result.value.map(v=>({...v,data:Buffer.from(v.png,'base64')}));await writeFile(join(root,'branding','logo.png'),images.at(-1).data);
 const entries=images.slice(0,-1),header=Buffer.alloc(6+entries.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(entries.length,4);let offset=header.length;entries.forEach((v,i)=>{const n=6+i*16;header[n]=header[n+1]=v.size===256?0:v.size;header.writeUInt16LE(1,n+4);header.writeUInt16LE(32,n+6);header.writeUInt32LE(v.data.length,n+8);header.writeUInt32LE(offset,n+12);offset+=v.data.length;});
 const ico=Buffer.concat([header,...entries.map(v=>v.data)]);await writeFile(join(root,'icon.ico'),ico);await writeFile(join(root,'branding','icon.ico'),ico);ws.close();console.log('Rendered vector master to PNG and 7-size ICO');
}finally{spawnSync('taskkill',['/pid',String(browser.pid),'/t','/f'],{windowsHide:true,stdio:'ignore'});browser.unref();}
