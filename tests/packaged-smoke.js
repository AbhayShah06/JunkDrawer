'use strict';

// Run with the packaged executable in ELECTRON_RUN_AS_NODE mode. This verifies the
// actual app.asar and bundled resources rather than accidentally testing source files.
const path = require('node:path');
const assert = require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const {spawnSync}=require('node:child_process');

async function main() {
  const appRoot = process.argv[2];
  const binDir = process.argv[3];
  if (!appRoot || !binDir) throw new Error('Pass the extracted app directory and packaged bin directory');
  const { startServer } = require(path.join(appRoot, 'electron', 'server.js'));
  const models=fs.mkdtempSync(path.join(os.tmpdir(),'jd-package-smoke-'));
  const { server, port } = await startServer(appRoot, binDir, null, null,
    models);
  const origin = `http://127.0.0.1:${port}`;
  try {
    const shell = await fetch(origin + '/index.html');
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /Junk Drawer/);

    assert.equal((await fetch(origin+'/app.css')).status,200);
    assert.equal((await fetch(origin+'/electron/media.js')).status,200);
    assert.equal((await fetch(origin+'/api/opened-file')).status,404);
    for(const retired of ['esrgan','sherpa','vtracer'])assert.equal(fs.existsSync(path.join(binDir,retired)),false);
    const presets=await(await fetch(origin+'/api/media-capabilities')).json();assert.ok(presets.formats.some(f=>f.ext==='mp4'));
    const native=path.join(binDir,process.platform==='win32'?'ffmpeg.exe':'ffmpeg');
    const fixture=spawnSync(native,['-v','error','-f','lavfi','-i','color=c=blue:size=64x48:rate=10','-t','0.2','-c:v','libx264','-f','mpegts','pipe:1'],{windowsHide:true});assert.equal(fixture.status,0);
    const media=require(path.join(appRoot,'electron','media.js'));
    const meta=encodeURIComponent(JSON.stringify({inName:'in.mts',outName:'out.mp4',args:media.plan('mp4','in.mts','out.mp4')}));
    const converted=await fetch(origin+'/api/ffmpeg?meta='+meta,{method:'POST',headers:{Origin:origin},body:fixture.stdout});assert.equal(converted.status,200);assert.ok((await converted.arrayBuffer()).byteLength>0);
    const check = await fetch(origin + '/api/check');
    assert.equal(check.status, 200);
    const capabilities = await check.json();
    assert.equal(capabilities.ffmpeg, true);
    assert.equal(capabilities.ytdlp, true);
    assert.equal(capabilities.whisper, true);

    const integrations = await fetch(origin + '/api/integrations');
    assert.equal(integrations.status, 200);
    const catalog = await integrations.json();
    assert.equal(catalog.contractVersion, 1);
    assert.ok(!catalog.providers.some(provider => provider.role === 'video-editor'));
    process.stdout.write(`packaged smoke passed on ${origin}\n`);
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(models,{recursive:true,force:true});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
