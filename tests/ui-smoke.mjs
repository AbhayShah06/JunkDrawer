import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2];
if (!url) throw new Error('usage: node tests/ui-smoke.mjs <url>');
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const profile = await mkdtemp(join(tmpdir(), 'junkdrawer-ui-'));
const port = 9437;
const child = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'], { stdio: 'ignore' });

const wait = ms => new Promise(r => setTimeout(r, ms));
try {
  let pages;
  for (let i = 0; i < 30; i++) {
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await wait(100); }
  }
  const page = pages?.find(candidate => candidate.type === 'page' && candidate.url === 'about:blank') || pages?.find(candidate => candidate.type === 'page');
  if (!page) throw new Error('Chrome did not start');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map(); const errors = [];
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.text); };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id, timeout = setTimeout(() => { pending.delete(n); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(n, m => { clearTimeout(timeout); m.error ? reject(new Error(m.error.message)) : resolve(m.result); });
    ws.send(JSON.stringify({ id:n, method, params }));
  });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width:1280, height:800, deviceScaleFactor:1, mobile:false });
  await send('Page.navigate', { url }); await wait(1200);
  try { const home = await send('Page.captureScreenshot', { format:'png' }); await writeFile(join(profile, 'home.png'), Buffer.from(home.data, 'base64')); } catch { /* DOM checks below remain authoritative on locked-down runners. */ }
  await send('Runtime.evaluate', { expression:`(()=>{const f=new File([new Uint8Array([0,0,0,20,102,116,121,112,105,115,111,109])],'demo.mp4',{type:'video/mp4'});const d=new DataTransfer();d.items.add(f);document.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));})()` });
  await wait(500); await send('Runtime.evaluate', { expression:`[...document.querySelectorAll('button')].find(b=>b.textContent==='Edit video').click()` }); await wait(500);
  try { const desktop = await send('Page.captureScreenshot', { format:'png' }); await writeFile(join(profile, 'studio-desktop.png'), Buffer.from(desktop.data, 'base64')); } catch { }
  await send('Emulation.setDeviceMetricsOverride', { width:620, height:760, deviceScaleFactor:1, mobile:false }); await wait(300);
  try { const small = await send('Page.captureScreenshot', { format:'png' }); await writeFile(join(profile, 'studio-small.png'), Buffer.from(small.data, 'base64')); } catch { }
  const checks = await send('Runtime.evaluate', { returnByValue:true, expression:`({href:location.href,title:document.title,ready:document.readyState,home:!!document.querySelector('#drop'),studio:!!document.querySelector('.video-studio'),timeline:!!document.querySelector('.vs-timeline'),overflow:document.documentElement.scrollWidth<=document.documentElement.clientWidth})` });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ ...checks.result.value, screenshots:profile }));
  ws.close();
} finally {
  try { spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio:'ignore' }); } catch { child.kill(); }
  child.unref();
  // Keep screenshots long enough for the caller to inspect. The OS clears the temp folder later.
}
