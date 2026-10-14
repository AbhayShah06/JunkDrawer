const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { startServer } = require('../electron/server');

let server;
let origin;
let queuedOpen = null;
let missingServer;
let missingOrigin;
let missingBinDir;

test.before(async () => {
  const root = path.join(__dirname, '..');
  const opener = { take: () => { const value = queuedOpen; queuedOpen = null; return value; } };
  const started = await startServer(root, path.join(root, 'resources', 'bin', 'win'), null, opener);
  server = started.server;
  origin = `http://127.0.0.1:${started.port}`;

  missingBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-empty-bin-'));
  const missing = await startServer(root, missingBinDir, null, null,
    path.join(missingBinDir, 'models'));
  missingServer = missing.server;
  missingOrigin = `http://127.0.0.1:${missing.port}`;
});

test.after(async () => {
  await Promise.all([
    new Promise(resolve => server.close(resolve)),
    new Promise(resolve => missingServer.close(resolve)),
  ]);
  fs.rmSync(missingBinDir, { recursive: true, force: true });
});

test('serves the application shell', async () => {
  const response = await fetch(origin + '/index.html');
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Junk Drawer/);
});

test('rejects malformed percent encoding without crashing', async () => {
  const status = await new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = http.request({ hostname: url.hostname, port: url.port, path: '/%E0%A4%A' }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 400);

  const response = await fetch(origin + '/api/check');
  assert.equal(response.status, 200);
});

test('card polling returns a JSON array', async () => {
  const response = await fetch(origin + '/api/cards');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(Array.isArray(body.cards));
});

test('integration catalog is versioned and prepares for OpenCut Next', async () => {
  const response = await fetch(origin + '/api/integrations');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.contractVersion, 1);
  assert.ok(body.providers.length > 1, 'OpenCut must be one provider, not the whole architecture');
  const openCut = body.providers.find(provider => provider.id === 'opencut-next');
  assert.ok(openCut);
  assert.equal(openCut.stage, 'planned');
  assert.equal(openCut.available, false);
  assert.equal(openCut.blockedBy, 'upstream-editor-api');
  for (const check of ['availability', 'input', 'output', 'cancel', 'disk-space']) {
    assert.ok(openCut.checks.includes(check), `OpenCut is missing the ${check} error check`);
  }
});

test('backend features reject malformed requests with structured errors', async () => {
  const headers = { Origin: origin, 'Content-Type': 'application/json' };
  const badTool = await fetch(origin + '/api/tool?meta=%7Bbad', { method: 'POST', headers, body: '{}' });
  assert.equal(badTool.status, 400);
  assert.equal((await badTool.json()).error, 'bad-meta');

  const badModel = await fetch(origin + '/api/delete-model', {
    method: 'POST', headers, body: JSON.stringify({ name: 'not-a-real-model' }),
  });
  assert.equal(badModel.status, 400);
  assert.equal((await badModel.json()).error, 'unknown-model');

  const unavailableUpdate = await fetch(origin + '/api/update-download', {
    method: 'POST', headers, body: '{}',
  });
  assert.equal(unavailableUpdate.status, 400);
  assert.equal((await unavailableUpdate.json()).error, 'unavailable');
});

test('every native engine fails clearly when its dependency is unavailable', async () => {
  const headers = { Origin: missingOrigin, 'Content-Type': 'application/octet-stream' };
  const engines = ['whisper', 'raw', 'upscale', 'exif', 'tts', 'vtracer', 'stems'];
  for (const tool of engines) {
    const meta = encodeURIComponent(JSON.stringify({ tool, inName: 'input.bin', opts: {} }));
    const response = await fetch(`${missingOrigin}/api/tool?meta=${meta}`, {
      method: 'POST', headers, body: Buffer.from('fixture'),
    });
    assert.equal(response.status, 501, `${tool} should report a missing dependency`);
    assert.equal((await response.json()).error, 'tool-missing');
  }

  const ffMeta = encodeURIComponent(JSON.stringify({
    inName: 'input.mp4', outName: 'output.mp4', args: ['-i', 'input.mp4', 'output.mp4'],
  }));
  const ffmpeg = await fetch(`${missingOrigin}/api/ffmpeg?meta=${ffMeta}`, {
    method: 'POST', headers, body: Buffer.from('fixture'),
  });
  assert.equal(ffmpeg.status, 501);
  assert.equal((await ffmpeg.json()).error, 'ffmpeg-missing');

  for (const mode of ['video', 'audio', 'spotify']) {
    const response = await fetch(missingOrigin + '/api/download', {
      method: 'POST',
      headers: { Origin: missingOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/media', mode }),
    });
    assert.equal(response.status, 501, `${mode} download should report its missing dependency`);
    assert.ok(['ytdlp-missing', 'spotdl-missing'].includes((await response.json()).error));
  }
});

test('API route error matrix returns bounded, actionable responses', async () => {
  const jsonHeaders = { Origin: origin, 'Content-Type': 'application/json' };
  const cases = [
    ['/api/download', '{bad', 400, 'bad body'],
    ['/api/download', JSON.stringify({ url: 'not-a-url' }), 400, 'Please paste a full https:// link.'],
    ['/api/fetch-model', JSON.stringify({ name: 'unknown' }), 400, 'unknown-model'],
    ['/api/delete-model', JSON.stringify({ name: 'unknown' }), 400, 'unknown-model'],
    ['/api/import-card', JSON.stringify({ root: 'Z:\\\\definitely-not-a-card' }), 404, 'card-gone'],
  ];
  for (const [route, body, status, error] of cases) {
    const response = await fetch(origin + route, { method: 'POST', headers: jsonHeaders, body });
    assert.equal(response.status, status, route);
    assert.equal((await response.json()).error, error, route);
  }

  const badExtra = await fetch(origin + '/api/ffmpeg-extra?id=&name=../bad.srt', {
    method: 'POST', headers: { Origin: origin }, body: 'fixture',
  });
  assert.equal(badExtra.status, 400);
  assert.equal((await badExtra.json()).error, 'bad-extra');

  const models = await fetch(origin + '/api/models');
  assert.equal(models.status, 200);
  assert.ok(Array.isArray((await models.json()).models));
});

test('API rejects cross-site and traversal requests', async () => {
  const blocked = await fetch(origin + '/api/check', {
    headers: { Origin: 'https://malicious.example', 'Sec-Fetch-Site': 'cross-site' },
  });
  assert.equal(blocked.status, 403);

  const traversalStatus = await new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = http.request({ hostname: url.hostname, port: url.port, path: '/..\\package.json' }, res => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(traversalStatus, 400);
});

test('opened files stream once without base64 expansion', async () => {
  queuedOpen = path.join(__dirname, '..', 'README.md');
  const response = await fetch(origin + '/api/opened-file');
  assert.equal(response.status, 200);
  assert.equal(decodeURIComponent(response.headers.get('x-filename')), 'README.md');
  assert.match(await response.text(), /Junk Drawer/i);

  const second = await fetch(origin + '/api/opened-file');
  assert.equal(second.status, 204);
});
