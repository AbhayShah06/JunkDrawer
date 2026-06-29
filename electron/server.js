// Internal HTTP server for the Electron app.
// Serves the UI with cross-origin-isolation headers (so multi-threaded
// ffmpeg.wasm works) and runs the yt-dlp / spotdl download backend.
// No Electron imports here so it can be unit-tested with plain Node.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const https = require('https');
let PKG = {}; try { PKG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')); } catch {}

const MIME = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript',
  '.css':'text/css', '.json':'application/json', '.png':'image/png', '.svg':'image/svg+xml',
  '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };

function findBin(name, binDir) {
  // bundled: prefer the per-architecture folder (resources/bin/arm64|x64), then the flat dir
  const dirs = [path.join(binDir||'', process.arch), binDir||''];
  for (const d of dirs) {
    for (const c of [path.join(d, name), path.join(d, name+'_macos')]) {
      try { if (fs.existsSync(c)) return c; } catch {}
    }
  }
  const w = spawnSync(process.platform === 'win32' ? 'where' : 'which', [name], { encoding: 'utf8' });
  if (w.status === 0) { const p = (w.stdout||'').split('\n')[0].trim(); if (p) return p; }
  return null;
}
const have = (n, b) => !!findBin(n, b);

function sendJSON(res, obj, code=200) {
  const b = Buffer.from(JSON.stringify(obj));
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', b.length);
  res.end(b);
}

function handleDownload(req, res, binDir) {
  let body = '';
  req.on('data', c => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let j; try { j = JSON.parse(body || '{}'); } catch { return sendJSON(res, { error: 'bad body' }, 400); }
    const url = (j.url || '').trim(), mode = j.mode || 'video';
    if (!/^https?:\/\//i.test(url)) return sendJSON(res, { error: 'Please paste a full https:// link.' }, 400);

    const ffmpeg = findBin('ffmpeg', binDir), ffmpegOk = !!ffmpeg;
    let bin, args;
    if (mode === 'spotify') {
      bin = findBin('spotdl', binDir); if (!bin) return sendJSON(res, { error: 'spotdl-missing' }, 501);
      args = ['download', url];
    } else {
      bin = findBin('yt-dlp', binDir); if (!bin) return sendJSON(res, { error: 'ytdlp-missing' }, 501);
      if (mode === 'audio')
        args = ffmpegOk ? ['-x','--audio-format','mp3','--no-playlist','-o','%(title)s.%(ext)s',url]
                        : ['-f','bestaudio','--no-playlist','-o','%(title)s.%(ext)s',url];
      else
        args = ffmpegOk ? ['-f','bestvideo*+bestaudio/best','--merge-output-format','mp4','--no-playlist','-o','%(title)s.%(ext)s',url]
                        : ['-f','best[ext=mp4]/best','--no-playlist','-o','%(title)s.%(ext)s',url];
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-'));
    const env = Object.assign({}, process.env);
    if (ffmpeg) env.PATH = path.dirname(ffmpeg) + path.delimiter + (env.PATH || ''); // bundled ffmpeg findable by yt-dlp
    const child = spawn(bin, args, { cwd: tmp, env });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { cleanup(tmp); sendJSON(res, { error: 'tool-failed', detail: String(e) }, 500); });
    child.on('close', code => {
      if (code !== 0) { const d = err.slice(-2500); cleanup(tmp); return sendJSON(res, { error: 'tool-failed', detail: d }, 500); }
      let files = [];
      try { files = fs.readdirSync(tmp).map(f => path.join(tmp, f)).filter(f => fs.statSync(f).isFile()); } catch {}
      if (!files.length) { cleanup(tmp); return sendJSON(res, { error: 'no-output', detail: 'The tool produced no file.' }, 500); }
      let out, name;
      if (files.length > 1) {
        const zip = path.join(tmp, '_bundle.zip');
        const z = spawnSync('zip', ['-j', '-q', zip, ...files]);
        if (z.status === 0 && fs.existsSync(zip)) { out = zip; name = 'downloads.zip'; }
        else { out = files.sort((a,b) => fs.statSync(b).size - fs.statSync(a).size)[0]; name = path.basename(out); }
      } else { out = files[0]; name = path.basename(out); }
      const data = fs.readFileSync(out);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', data.length);
      res.setHeader('Content-Disposition', `attachment; filename="${name.replace(/"/g,'')}"`);
      res.setHeader('X-Filename', encodeURIComponent(name));
      res.setHeader('Access-Control-Expose-Headers', 'X-Filename');
      res.end(data);
      cleanup(tmp);
    });
  });
}
function cleanup(d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch {} }

// ---- update notifier: compare the local version to the latest GitHub release ----
function ghRepo() {
  const pub = (PKG.build && PKG.build.publish) || [];
  const g = (Array.isArray(pub) ? pub : [pub]).find(p => p && p.provider === 'github');
  return g ? { owner: g.owner, repo: g.repo } : null;
}
function cmpVer(a, b) { // > 0 when a is newer than b
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
function handleUpdateCheck(res) {
  const current = PKG.version || '0.0.0';
  let done = false;
  const finish = o => { if (done) return; done = true; sendJSON(res, Object.assign({ current, hasUpdate: false }, o)); };
  if (process.env.JD_DEV) return finish({});  // dev build never nags about updates
  const r = ghRepo();
  if (!r) return finish({});
  const req = https.get(`https://api.github.com/repos/${r.owner}/${r.repo}/releases/latest`,
    { headers: { 'User-Agent': 'JunkDrawer', 'Accept': 'application/vnd.github+json' } }, gr => {
      let data = ''; gr.on('data', d => data += d);
      gr.on('end', () => {
        if (gr.statusCode !== 200) return finish({});
        let j; try { j = JSON.parse(data); } catch { return finish({}); }
        const latest = (j.tag_name || '').replace(/^v/, '');
        const dmg = (j.assets || []).find(a => /\.dmg$/i.test(a.name || ''));
        finish({ latest, hasUpdate: !!latest && cmpVer(latest, current) > 0,
          htmlUrl: j.html_url || '', dmgUrl: dmg ? dmg.browser_download_url : '', dmgName: dmg ? dmg.name : '' });
      });
    });
  req.setTimeout(6000, () => { req.destroy(); finish({}); });
  req.on('error', () => finish({}));
}

// Only the app's own loopback page may reach the /api/* backend. Blocks a malicious
// website from driving the local server (CSRF) and DNS-rebinding attacks that point a
// hostile hostname at 127.0.0.1.
function localOnly(req) {
  const host = (req.headers.host || '').split(':')[0];
  if (host && host !== '127.0.0.1' && host !== 'localhost') return false;
  const origin = req.headers.origin;
  if (origin) {
    let h; try { h = new URL(origin).hostname; } catch { return false; }
    if (h !== '127.0.0.1' && h !== 'localhost') return false;
  }
  return true;
}

function startServer(appRoot, binDir) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Cache-Control', 'no-store');
      // No remote code: script-src has no http(s) origin, so only our own bundled,
      // inline, wasm and blob scripts run. Everything is vendored locally.
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: data:; " +
        "worker-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https:; font-src 'self' data:; " +
        "connect-src 'self' https: data: blob:; media-src 'self' blob: data:");
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url.startsWith('/api/') && !localOnly(req)) { res.statusCode = 403; return res.end('forbidden'); }
      if (url === '/api/check')
        return sendJSON(res, { ytdlp: have('yt-dlp', binDir), spotdl: have('spotdl', binDir), ffmpeg: have('ffmpeg', binDir) });
      if (url === '/api/update-check')
        return handleUpdateCheck(res);
      if (url === '/api/download' && req.method === 'POST') return handleDownload(req, res, binDir);
      let p = path.normalize(path.join(appRoot, url === '/' ? '/index.html' : url));
      if (!p.startsWith(appRoot)) { res.statusCode = 403; return res.end('forbidden'); }
      fs.readFile(p, (e, data) => {
        if (e) { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, server }));
  });
}

module.exports = { startServer, findBin, have };

// allow `node electron/server.js [appRoot] [binDir]` for standalone testing
if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, '..');
  const bin = process.argv[3] || path.join(__dirname, '..', 'resources', 'bin');
  startServer(root, bin).then(({ port }) => console.log('test server on http://127.0.0.1:' + port));
}
