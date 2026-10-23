const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createModelDownloads}=require('../electron/model-downloads');
const catalog={'test.bin':{url:'https://example.invalid/model',size:6}};
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jd-model-transfer-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('model transfers are shared by callers and finish without an attached renderer',async t=>{
  const dir=temp(t);let finish,calls=0;const manager=createModelDownloads(dir,{catalog,fetcher:async()=>{calls++;return new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('abc'));finish=()=>{c.enqueue(Buffer.from('def'));c.close();};}}));}});
  const first=manager.download('test.bin'),second=manager.download('test.bin');assert.equal(first,second);
  await new Promise(r=>setTimeout(r,20));assert.equal(manager.list()[0].downloading,true);assert.equal(manager.list()[0].receivedBytes,3);finish();await first;
  assert.equal(calls,1);assert.equal(manager.ready('test.bin'),true);assert.equal(fs.existsSync(path.join(dir,'test.bin.part')),false);assert.equal(manager.list()[0].downloading,false);
});
test('failed, truncated and oversized downloads leave no partial or installed model',async t=>{
  for(const bytes of ['abc','abcdefghi']){const dir=temp(t);const m=createModelDownloads(dir,{catalog,fetcher:async()=>new Response(bytes)});await assert.rejects(m.download('test.bin'));assert.deepEqual(fs.readdirSync(dir),[]);assert.equal(m.ready('test.bin'),false);assert.ok(m.list()[0].error);}
});
test('cancel removes unfinished bytes and allows a clean retry',async t=>{
  const dir=temp(t);let calls=0;const manager=createModelDownloads(dir,{catalog,fetcher:async()=>++calls===1?new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('abc'));}})):new Response('abcdef')});
  const active=manager.download('test.bin');const caught=active.catch(()=>{});await new Promise(r=>setTimeout(r,20));await manager.cancel('test.bin');await caught;assert.deepEqual(fs.readdirSync(dir),[]);assert.equal(manager.list()[0].downloading,false);await manager.download('test.bin');assert.equal(manager.ready('test.bin'),true);
});
test('startup cleans only known partial models, preserving finished and unrelated files',t=>{
  const dir=temp(t);for(const [name,data]of [['test.bin','abcdef'],['test.bin.part','abc'],['personal.txt','keep'],['unknown.part','keep']])fs.writeFileSync(path.join(dir,name),data);
  const manager=createModelDownloads(dir,{catalog});assert.equal(manager.ready('test.bin'),true);assert.deepEqual(fs.readdirSync(dir).sort(),['personal.txt','test.bin','unknown.part']);assert.rejects(manager.download('unknown'));
});
