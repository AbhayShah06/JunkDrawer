'use strict';

// Run with the packaged executable in ELECTRON_RUN_AS_NODE mode. This verifies the
// actual app.asar and bundled resources rather than accidentally testing source files.
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  const appRoot = process.argv[2];
  const binDir = process.argv[3];
  if (!appRoot || !binDir) throw new Error('Pass the extracted app directory and packaged bin directory');
  const { startServer } = require(path.join(appRoot, 'electron', 'server.js'));
  const { server, port } = await startServer(appRoot, binDir, null, null,
    path.join(appRoot, '.smoke-models'));
  const origin = `http://127.0.0.1:${port}`;
  try {
    const shell = await fetch(origin + '/index.html');
    assert.equal(shell.status, 200);
    assert.match(await shell.text(), /Junk Drawer/);

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
    assert.ok(catalog.providers.some(provider => provider.id === 'opencut-next'));
    process.stdout.write(`packaged smoke passed on ${origin}\n`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
