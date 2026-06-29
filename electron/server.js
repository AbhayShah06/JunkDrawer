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
  // bundled: prefer the per-architecture folder (resources/bin/arm64|x64), then the flat dir.
  // On Windows the bundled binaries carry a .exe suffix (yt-dlp.exe, ffmpeg.exe); on macOS
  // they're suffix-less (or the legacy `_macos` suffix).
  const win = process.platform === 'win32';
  const cands = win ? [name+'.exe', name] : [name, name+'_macos'];
  const dirs = [path.join(binDir||'', process.arch), binDir||''];
  for (const d of dirs) {
    for (const c of cands) {
      const f = path.join(d, c);
      try { if (fs.existsSync(f)) return f; } catch {}
    }
  }
  // PATH fallback: `where` on Windows resolves yt-dlp.exe from the bare name already.
  const w = spawnSync(win ? 'where' : 'which', [name], { encoding: 'utf8' });
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
  let chunks = [], size = 0, aborted = false;
  req.on('data', c => { size += c.length; if (size > 1e6) { aborted = true; req.destroy(); return; } chunks.push(c); });
  req.on('end', () => {
    if (aborted) return;
    let j; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return sendJSON(res, { error: 'bad body' }, 400); }
    const url = (j.url || '').trim(), mode = j.mode || 'video';
    if (!/^https?:\/\//i.test(url)) return sendJSON(res, { error: 'Please paste a full https:// link.' }, 400);

    const ffmpeg = findBin('ffmpeg', binDir), ffmpegOk = !!ffmpeg;
    let bin, args;
    if (mode === 'spotify') {
      bin = findBin('spotdl', binDir); if (!bin) return sendJSON(res, { error: 'spotdl-missing' }, 501);
      args = ['download', url];
    } else {
      bin = findBin('yt-dlp', binDir); if (!bin) return sendJSON(res, { error: 'ytdlp-missing' }, 501);
      // Hardening: --no-config ignores any yt-dlp.conf; --restrict-filenames strips path
      // separators/unicode from the (remote-controlled) media title so it can't traverse;
      // the trailing `--` stops option parsing so a URL can never be read as a flag.
      const base = ['--no-config','--restrict-filenames','--no-playlist','-o','%(title)s.%(ext)s'];
      if (mode === 'audio') {
        // MP3 needs ffmpeg to transcode the source stream. Without it, yt-dlp would just
        // save the raw webm/m4a audio — not an MP3. Fail clearly rather than mislabel.
        if (!ffmpegOk) return sendJSON(res, { error: 'ffmpeg-missing' }, 501);
        args = [...base,'-x','--audio-format','mp3','--',url];
      } else
        args = ffmpegOk ? [...base,'-f','bestvideo*+bestaudio/best','--merge-output-format','mp4','--',url]
                        : [...base,'-f','best[ext=mp4]/best','--',url];
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
      const safeName = (name || 'download').replace(/[^\w.\- ]+/g, '_').slice(0, 200) || 'download';
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(name)}`);
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
      // Cap the response body so a tampered/MITM'd endpoint can't exhaust memory.
      let data = ''; gr.on('data', d => { data += d; if (data.length > 512 * 1024) { gr.destroy(); finish({}); } });
      gr.on('end', () => {
        if (gr.statusCode !== 200) return finish({});
        let j; try { j = JSON.parse(data); } catch { return finish({}); }
        const latest = (j.tag_name || '').replace(/^v/, '');
        // Only trust asset URLs that live on github.com/githubusercontent.com — these flow
        // to the renderer and get opened externally, so don't relay an arbitrary URL.
        const safeUrl = u => /^https:\/\/([a-z0-9-]+\.)*github(usercontent)?\.com\//i.test(u || '') ? u : '';
        const dmg = (j.assets || []).find(a => /\.dmg$/i.test(a.name || ''));
        const exe = (j.assets || []).find(a => /\.exe$/i.test(a.name || ''));
        const dmgUrl = safeUrl(dmg && dmg.browser_download_url);
        const exeUrl = safeUrl(exe && exe.browser_download_url);
        // pick the asset that matches the OS this app is running on
        const installerUrl = process.platform === 'win32' ? exeUrl : dmgUrl;
        finish({ latest, hasUpdate: !!latest && cmpVer(latest, current) > 0,
          htmlUrl: safeUrl(j.html_url),
          dmgUrl, dmgName: dmg ? dmg.name : '',
          exeUrl, exeName: exe ? exe.name : '',
          installerUrl });
      });
    });
  req.setTimeout(6000, () => { req.destroy(); finish({}); });
  req.on('error', () => finish({}));
}

// Only the app's own loopback page may reach the /api/* backend. Blocks a malicious
// website from driving the local server (CSRF) and DNS-rebinding attacks that point a
// hostile hostname at 127.0.0.1.
function localOnly(req, expectedHost) {
  // Host must be EXACTLY our bound loopback authority (127.0.0.1:<port>). A rebound
  // attacker hostname can never produce this value, and the random port can't be
  // forged into the Host header cross-site — this alone defeats DNS-rebinding.
  if (expectedHost && req.headers.host !== expectedHost) return false;
  // Sec-Fetch-Site is set by Chromium (our renderer) and cannot be forged by a
  // cross-site page; reject anything that isn't same-origin or a direct address-bar hit.
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (origin) {
    let h; try { h = new URL(origin).hostname; } catch { return false; }
    if (h !== '127.0.0.1' && h !== 'localhost') return false;
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    // Our renderer always sends Origin on state-changing /api fetches (JSON POST is not
    // a CORS-simple request). A missing Origin on a write is therefore hostile — fail closed.
    return false;
  }
  return true;
}

function startServer(appRoot, binDir) {
  return new Promise(resolve => {
    let expectedHost = null;  // set once the ephemeral port is known (below)
    const rootResolved = path.resolve(appRoot);
    const server = http.createServer((req, res) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
      res.setHeader('Cache-Control', 'no-store');
      // No remote code: script-src has no http(s) origin, so only our own bundled,
      // inline, wasm and blob scripts run. Everything is vendored locally.
      res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:; " +
        "worker-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob: https:; font-src 'self' data:; " +
        "connect-src 'self' https: data: blob:; media-src 'self' blob: data:");
      const url = decodeURIComponent(req.url.split('?')[0]);
      if (url.startsWith('/api/') && !localOnly(req, expectedHost)) { res.statusCode = 403; return res.end('forbidden'); }
      if (url === '/api/check')
        return sendJSON(res, { ytdlp: have('yt-dlp', binDir), spotdl: have('spotdl', binDir), ffmpeg: have('ffmpeg', binDir) });
      if (url === '/api/update-check')
        return handleUpdateCheck(res);
      if (url === '/api/download' && req.method === 'POST') return handleDownload(req, res, binDir);
      // Static files, confined to appRoot. Reject backslashes/NUL (Windows traversal),
      // then require the resolved path to sit on a separator boundary inside the root
      // (so a sibling like app.asar.unpacked can't satisfy a loose prefix match).
      const reqPath = url === '/' ? '/index.html' : url;
      if (reqPath.includes('\\') || reqPath.includes('\0')) { res.statusCode = 400; return res.end('bad request'); }
      const p = path.resolve(rootResolved, '.' + reqPath);
      if (p !== rootResolved && !p.startsWith(rootResolved + path.sep)) { res.statusCode = 403; return res.end('forbidden'); }
      fs.readFile(p, (e, data) => {
        if (e) { res.statusCode = 404; return res.end('not found'); }
        res.setHeader('Content-Type', MIME[path.extname(p)] || 'application/octet-stream');
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      expectedHost = '127.0.0.1:' + port;
      resolve({ port, server });
    });
  });
}

module.exports = { startServer, findBin, have };

// allow `node electron/server.js [appRoot] [binDir]` for standalone testing
if (require.main === module) {
  const root = process.argv[2] || path.join(__dirname, '..');
  const bin = process.argv[3] || path.join(__dirname, '..', 'resources', 'bin');
  startServer(root, bin).then(({ port }) => console.log('test server on http://127.0.0.1:' + port));
}
