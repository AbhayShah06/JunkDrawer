const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const media=require('../electron/media');
const service=require('../electron/media-service');
const {startServer,findBin}=require('../electron/server');
const root=path.join(__dirname,'..'),bin=path.join(root,'resources','bin',process.platform==='win32'?'win':'mac');
const ffmpeg=findBin('ffmpeg',bin);
let server,origin,dir;
test.before(async()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'jd-media-test-'));const s=await startServer(root,bin);server=s.server;origin='http://127.0.0.1:'+s.port;});
test.after(async()=>{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
const encode=args=>{const r=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{cwd:dir,encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(r.status,0,r.stderr||r.error?.message);};
async function convert(buffer,from,to){const inName='in.'+from,outName='out.'+to;const meta=encodeURIComponent(JSON.stringify({inName,outName,args:media.plan(to,inName,outName)}));const r=await fetch(origin+'/api/ffmpeg?meta='+meta,{method:'POST',headers:{Origin:origin},body:buffer});assert.equal(r.status,200,await (r.status===200?Promise.resolve(''):r.text()));return Buffer.from(await r.arrayBuffer());}
async function probe(buffer,extension='bin'){const r=await fetch(origin+'/api/probe-media?ext='+extension,{method:'POST',headers:{Origin:origin},body:buffer});assert.equal(r.status,200);return r.json();}
test('format contract rejects invented formats and escaping filenames',()=>{assert.throws(()=>media.plan('exe'));assert.throws(()=>media.plan('mp4','../secret'));assert.deepEqual(service.capabilities(null),{available:false,formats:[]});assert.equal(media.available(['libx264'],['mp4']).length,0);});
test('identification distinguishes Skype SILK, SQLite, transport streams and unknown data',()=>{const b=s=>Buffer.from(s,'latin1');assert.match(media.identify(b('\x02#!SILK_V3')).label,/SILK/);assert.match(media.identify(b('SQLite format 3\0')).label,/SQLite/);assert.equal(media.identify(Buffer.from([137,80,78,71])).label,'PNG image');assert.equal(media.identify(b('random bytes')).label,'Unknown signature');assert.ok(media.inputs.video.includes('mts'));assert.ok(media.inputs.video.includes('m2ts'));});
test('capability endpoint only advertises encoders and muxers installed locally',{skip:!ffmpeg},async()=>{const r=await fetch(origin+'/api/media-capabilities');assert.equal(r.status,200);const j=await r.json();assert.ok(j.available);assert.ok(j.formats.some(f=>f.ext==='mp4'));assert.ok(j.formats.some(f=>f.ext==='wav'));assert.equal(j.formats.length,service.capabilities(ffmpeg).formats.length);});
test('MTS/M2TS, unknown .dat and every advertised output convert and re-open',{skip:!ffmpeg,timeout:180000},async(t)=>{
  encode(['-f','lavfi','-i','testsrc2=size=64x48:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-f','mpegts','camera.mts']);
  const source=fs.readFileSync(path.join(dir,'camera.mts'));
  assert.ok((await probe(source)).recognized);
  encode(['-i','camera.mts','-c','copy','-mpegts_m2ts_mode','1','-f','mpegts','camera.m2ts']);
  for(const from of ['mts','m2ts','dat'])await t.test(from+' to MP4',async()=>{const out=await convert(from==='m2ts'?fs.readFileSync(path.join(dir,'camera.m2ts')):source,from,'mp4');assert.ok(out.length>0);assert.ok((await probe(out)).recognized);});
  encode(['-f','lavfi','-i','color=c=red:size=64x48','-frames:v','1','-update','1','still.png']);
  const image=fs.readFileSync(path.join(dir,'still.png'));
  for(const format of service.capabilities(ffmpeg).formats)await t.test('output '+format.ext,async()=>{
    const output=await convert(format.kind==='image'?image:source,format.kind==='image'?'png':'mts',format.ext);
    assert.ok(output.length>0);const inspected=await probe(output,format.ext);assert.ok(inspected.recognized,JSON.stringify(inspected));
    // Read each generated format as input and return it to a common format.
    const roundtrip=await convert(output,format.ext,format.kind==='image'?'png':format.kind==='audio'?'wav':'mp4');assert.ok(roundtrip.length>0);
  });
});
test('proprietary and corrupt data are reported without claiming conversion support',{skip:!ffmpeg},async()=>{for(const [bytes,word] of [['SQLite format 3\0database','database'],['#!SILK_V3recording','SILK'],['not media','could not identify']]){const result=await probe(Buffer.from(bytes));assert.equal(result.recognized,false);assert.match(result.reason,new RegExp(word,'i'));}});
test('new media routes reject cross-origin callers',async()=>{for(const route of ['/api/media-capabilities','/api/probe-media']){const r=await fetch(origin+route,{method:route.includes('probe')?'POST':'GET',headers:{Origin:'https://example.com'}});assert.equal(r.status,403);}});
