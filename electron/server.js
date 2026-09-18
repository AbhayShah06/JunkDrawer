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

// Kill a spawned child and everything it started. POSIX: children are spawned
// detached so they lead their own process group — signal the group via -pid.
// Windows: Node can't signal process groups, so taskkill /t walks the tree;
// process.kill(-pid) there just throws and only the parent would die,
// orphaning yt-dlp/ffmpeg helpers.
function killTree(child) {
  if (!child || child.pid == null) return;
  if (process.platform === 'win32') {
    const r = spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    if (r.error || r.status !== 0) { try { child.kill('SIGKILL'); } catch {} }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }
}

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
        // Prefer already-mp4 video + m4a audio so the merge is a fast remux (no re-encode).
        // Falling back to bestvideo+bestaudio (often VP9/AV1 + opus) forces a slow re-encode,
        // which is why plain "best" MP4s felt so slow. Cap at 1080p for a sane size/speed.
        args = ffmpegOk ? [...base,'-f','bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b','--merge-output-format','mp4','--',url]
                        : [...base,'-f','best[ext=mp4]/best','--',url];
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-'));
    const env = Object.assign({}, process.env);
    if (ffmpeg) env.PATH = path.dirname(ffmpeg) + path.delimiter + (env.PATH || ''); // bundled ffmpeg findable by yt-dlp
    // detached → the child leads its own process group, so we can kill yt-dlp AND the helper
    // processes it spawns (fragment downloaders, ffmpeg) in one shot. Killing just the parent
    // leaves those orphaned and running.
    const child = spawn(bin, args, { cwd: tmp, env, detached: true });
    let err = '';   // reuse the outer `aborted` (declared at the top of handleDownload)
    // If the client goes away mid-download (e.g. the user switches from MP3 to MP4), kill the
    // whole download tree and clean up — otherwise it keeps running, orphaned, and piles up.
    res.on('close', () => { if (!res.writableEnded && !aborted) { aborted = true; killTree(child); cleanup(tmp); } });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { if (aborted) return; cleanup(tmp); sendJSON(res, { error: 'tool-failed', detail: String(e) }, 500); });
    child.on('close', code => {
      if (aborted) return;
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

// Live encode progress (0..1) keyed by a per-request job id, scraped from ffmpeg's stderr
// and polled by the renderer via /api/ffmpeg-progress so the bar moves during long encodes.
const ffProgress = new Map();

// Small companion files for an ffmpeg job (e.g. the .srt for subtitle burn-in). The renderer
// uploads them here first, keyed by the job id, and handleFFmpeg copies them into the job's
// temp dir. Same name rules as the main file; capped small since these are text-sized.
const ffExtras = new Map(); // id -> {path, name}
const okJobName = n => typeof n === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(n) && !n.includes('..');
function handleFFmpegExtra(req, res) {
  const sp = new URLSearchParams(req.url.split('?')[1] || '');
  const id = (sp.get('id') || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  const name = sp.get('name') || '';
  if (!id || !okJobName(name)) { try { req.resume(); } catch {} return sendJSON(res, { error: 'bad-extra' }, 400); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-extra-'));
  const p = path.join(dir, name);
  const ws = fs.createWriteStream(p);
  let size = 0, dead = false;
  const die = (obj, code) => { if (dead) return; dead = true; try { req.destroy(); } catch {} try { ws.destroy(); } catch {} cleanup(dir); sendJSON(res, obj, code); };
  req.on('data', c => { size += c.length; if (size > 20 * 1048576) die({ error: 'too-big' }, 413); });
  req.on('error', () => die({ error: 'upload-failed' }, 400));
  ws.on('error', () => die({ error: 'write-failed' }, 500));
  req.pipe(ws);
  ws.on('finish', () => {
    if (dead) return;
    const old = ffExtras.get(id); if (old) cleanup(path.dirname(old.path));
    ffExtras.set(id, { path: p, name });
    const t = setTimeout(() => { const e = ffExtras.get(id); if (e && e.path === p) { ffExtras.delete(id); cleanup(dir); } }, 10 * 60 * 1000);
    if (t.unref) t.unref();
    sendJSON(res, { ok: true });
  });
}

// Run the bundled NATIVE ffmpeg on a user file (≈10× faster than the in-browser
// wasm core). The renderer streams the raw file as the body and passes the ffmpeg
// argv + the in/out filenames as a JSON `meta` query param. We rebuild nothing from
// a shell — `spawn` takes the argv array directly, so there's no shell-injection
// surface. Defense in depth: this is behind `localOnly` (only our own renderer can
// reach it), filenames must be plain basenames, and no argv token may be an absolute
// path / UNC / drive-letter / contain `..` — so ffmpeg can't read or write outside
// the throwaway temp dir we run it in.
function handleFFmpeg(req, res, binDir) {
  // Drain the (possibly still-streaming) request body before replying to a rejected
  // request — otherwise ending the response mid-upload resets the socket.
  const reject = (obj, code) => { try { req.resume(); } catch {} return sendJSON(res, obj, code); };
  req.on('error', () => {});
  let ffmpeg = findBin('ffmpeg', binDir);
  if (!ffmpeg) return reject({ error: 'ffmpeg-missing' }, 501);
  ffmpeg = path.resolve(ffmpeg);  // we spawn with cwd:tmp, so a relative bin path would ENOENT
  let meta;
  try { meta = JSON.parse(new URLSearchParams(req.url.split('?')[1] || '').get('meta') || ''); }
  catch { return reject({ error: 'bad-meta' }, 400); }
  const { inName, outName, args } = meta || {};
  const id = (new URLSearchParams(req.url.split('?')[1] || '').get('id') || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  const okName = n => typeof n === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(n) && !n.includes('..');
  if (!okName(inName) || !okName(outName)) return reject({ error: 'bad-names' }, 400);
  if (!Array.isArray(args) || args.length < 2 || args.length > 64) return reject({ error: 'bad-args' }, 400);
  for (const a of args) {
    // backslashes are legal *inside* a filtergraph (e.g. scale=...min(720\,ih)), so we
    // don't ban them outright — we ban path-escape shapes: NUL, `..`, and any token that
    // STARTS like an absolute path, UNC share, or drive letter.
    // Also block ROOTED paths anywhere in a token (not just at the start) and the file-reading
    // filters we never use — otherwise `-vf movie=/etc/passwd` / `subtitles=/abs/path` read files
    // outside the temp dir. A `/` after a delimiter (or `:/`, `C:/`) is path-like; `iw/2` (division,
    // slash between alnums) stays allowed.
    if (typeof a !== 'string' || a.length > 2000 || a.includes('\0') || a.includes('..') || /^([A-Za-z]:|\\\\|\/)/.test(a)
        || /(^|[=:,;'"\s])[/\\]/.test(a) || /\ba?movie\s*=/i.test(a))
      return reject({ error: 'bad-args', detail: 'unsafe argument' }, 400);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-ff-'));
  const inPath = path.join(tmp, inName), outPath = path.join(tmp, outName);
  const ws = fs.createWriteStream(inPath);
  let size = 0, aborted = false;
  const die = (obj, code) => { if (aborted) return; aborted = true; try { req.destroy(); } catch {} try { ws.destroy(); } catch {} cleanup(tmp); sendJSON(res, obj, code); };
  req.on('data', c => { size += c.length; if (size > 500 * 1048576) die({ error: 'too-big' }, 413); });
  req.on('error', () => die({ error: 'upload-failed' }, 400));
  ws.on('error', () => die({ error: 'write-failed' }, 500));
  req.pipe(ws);
  ws.on('finish', () => {
    if (aborted) return;
    // pull in any companion file uploaded for this job (e.g. subtitles for burn-in)
    if (meta.extraName && okJobName(meta.extraName)) {
      const e = ffExtras.get(id);
      if (e && e.name === meta.extraName) {
        try { fs.copyFileSync(e.path, path.join(tmp, e.name)); } catch {}
        ffExtras.delete(id); cleanup(path.dirname(e.path));
      }
    }
    // detached → child leads its own process group, so we can kill ffmpeg (and any children) as a tree
    const child = spawn(ffmpeg, args, { cwd: tmp, detached: true });
    let err = '', durSec = 0;
    // If the client goes away mid-job (tool switch / reset), kill the tree so ffmpeg isn't left orphaned.
    res.on('close', () => { if (!res.writableEnded && !aborted) { aborted = true; killTree(child); if (id) ffProgress.delete(id); cleanup(tmp); } });
    const hms = s => { const m = /(\d+):(\d\d):(\d\d(?:\.\d+)?)/.exec(s); return m ? (+m[1] * 3600 + +m[2] * 60 + +m[3]) : 0; };
    child.stderr.on('data', d => {
      const s = String(d); err += s; if (err.length > 20000) err = err.slice(-20000);
      // ffmpeg prints "Duration: HH:MM:SS.ss" once, then "time=HH:MM:SS.ss" as it encodes.
      if (!durSec) { const dm = /Duration:\s*(\d+:\d\d:\d\d(?:\.\d+)?)/.exec(s); if (dm) durSec = hms(dm[1]); }
      const tm = /time=\s*(\d+:\d\d:\d\d(?:\.\d+)?)/.exec(s);
      if (id && durSec && tm) ffProgress.set(id, Math.min(0.999, hms(tm[1]) / durSec));
    });
    child.on('error', e => { if (aborted) return; if (id) ffProgress.delete(id); cleanup(tmp); sendJSON(res, { error: 'tool-failed', detail: String(e) }, 500); });
    child.on('close', code => {
      if (aborted) return;
      if (code !== 0 || !fs.existsSync(outPath)) { if (id) ffProgress.delete(id); const d = err.slice(-2500); cleanup(tmp); return sendJSON(res, { error: 'tool-failed', detail: d || ('ffmpeg exit ' + code) }, 500); }
      let stat; try { stat = fs.statSync(outPath); } catch { if (id) ffProgress.delete(id); cleanup(tmp); return sendJSON(res, { error: 'read-failed' }, 500); }
      // Stream the result straight off disk instead of buffering the whole file in memory.
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      const rs = fs.createReadStream(outPath);
      rs.on('error', () => { try { res.destroy(); } catch {} if (id) ffProgress.delete(id); cleanup(tmp); });
      rs.on('close', () => { if (id) ffProgress.delete(id); cleanup(tmp); });
      rs.pipe(res);
    });
  });
}

// ---- update notifier: compare the local version to the latest GitHub release ----
function ghRepo() {
  // Dev (`npm start`) reads coordinates straight from package.json's build.publish.
  const pub = (PKG.build && PKG.build.publish) || [];
  const g = (Array.isArray(pub) ? pub : [pub]).find(p => p && p.provider === 'github');
  if (g && g.owner && g.repo) return { owner: g.owner, repo: g.repo };
  // Packaged: electron-builder strips the entire `build` block from the bundled
  // package.json, so PKG.build.publish is gone — but it writes the same GitHub
  // coordinates to app-update.yml under resourcesPath. Read them from there.
  try {
    const base = process.resourcesPath || path.join(__dirname, '..');
    const yml = fs.readFileSync(path.join(base, 'app-update.yml'), 'utf8');
    const field = k => ((yml.match(new RegExp('^' + k + ':\\s*(.+)$', 'm')) || [])[1] || '').trim();
    const owner = field('owner'), repo = field('repo'), provider = field('provider');
    if (owner && repo && provider === 'github') return { owner, repo };
  } catch {}
  return null;
}
function cmpVer(a, b) { // > 0 when a is newer than b
  const pa = String(a).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
function handleUpdateCheck(res, updater) {
  const current = PKG.version || '0.0.0';
  const canAutoUpdate = !!(updater && updater.enabled);
  let done = false;
  const finish = o => { if (done) return; done = true; sendJSON(res, Object.assign({ current, hasUpdate: false, canAutoUpdate }, o)); };
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

/* ---- native helper tools: whisper (speech→text), LibRaw (camera RAW), Real-ESRGAN (upscale).
   Unlike /api/ffmpeg (free-form argv), these build their argv entirely server-side from a
   tiny whitelisted option set — the renderer only names a tool and picks simple options.
   Same containment: throwaway temp cwd, basename-only filenames. */
// The OS bsdtar, by absolute path — a GNU tar earlier in PATH (e.g. Git Bash) can't write zip
function bsdtar() {
  return process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    : '/usr/bin/tar';
}
function toolBin(binDir, sub, name) {
  const f = path.join(binDir || '', sub, process.platform === 'win32' ? name + '.exe' : name);
  try { if (fs.existsSync(f)) return f; } catch {}
  return null;
}
const MODELS = { // downloadable-on-first-use models, pinned by URL + expected download size.
  // `archive` entries are .tar.bz2 bundles extracted into modelsDir; `ready` is the file
  // whose presence proves the extraction completed.
  'ggml-base.bin': { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin', size: 147951465 },
  'ggml-small.bin': { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', size: 487601967 },
  'ggml-medium.bin': { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin', size: 1533763059 },
  'ggml-large-v3-turbo.bin': { url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin', size: 1624555275 },
  'UVR-MDX-NET-Voc_FT.onnx': { url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/UVR-MDX-NET-Voc_FT.onnx', size: 66762795 },
  'vits-piper-en_US-amy-medium': { url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-medium.tar.bz2', size: 67223746,
    archive: true, ready: path.join('vits-piper-en_US-amy-medium', 'en_US-amy-medium.onnx') },
};
function modelPath(modelsDir, name) { return path.join(modelsDir, name); }
function modelReady(modelsDir, name) {
  if (!Object.hasOwn(MODELS, name)) return false;   // own-key only — inherited proto keys aren't models
  const m = MODELS[name];
  try {
    if (m.ready) return fs.existsSync(path.join(modelsDir, m.ready));
    return fs.statSync(modelPath(modelsDir, name)).size === m.size;
  } catch { return false; }
}
function fetchWithRedirects(url, depth, cb) {
  if (depth > 5) return cb(new Error('too many redirects'));
  https.get(url, r => {
    if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) { r.resume(); return fetchWithRedirects(r.headers.location, depth + 1, cb); }
    if (r.statusCode !== 200) { r.resume(); return cb(new Error('http ' + r.statusCode)); }
    cb(null, r);
  }).on('error', cb);
}
function handleFetchModel(req, res, modelsDir) {
  let chunks = [];
  req.on('data', c => { chunks.push(c); if (Buffer.concat(chunks).length > 4096) req.destroy(); });
  req.on('end', () => {
    let j; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return sendJSON(res, { error: 'bad body' }, 400); }
    const name = j.name;
    if (!Object.hasOwn(MODELS, name)) return sendJSON(res, { error: 'unknown-model' }, 400);
    const m = MODELS[name];
    if (modelReady(modelsDir, name)) return sendJSON(res, { ok: true, ready: true });
    try { fs.mkdirSync(modelsDir, { recursive: true }); } catch {}
    const dest = modelPath(modelsDir, name), part = dest + '.part';
    fetchWithRedirects(m.url, 0, (err, r) => {
      if (err) return sendJSON(res, { error: 'download-failed', detail: String(err.message || err) }, 502);
      const ws = fs.createWriteStream(part);
      let got = 0; const total = +r.headers['content-length'] || m.size;
      r.on('data', c => { got += c.length; ffProgress.set('model-' + name, Math.min(0.999, got / total)); });
      r.pipe(ws);
      ws.on('finish', () => {
        ffProgress.delete('model-' + name);
        let ok = false; try { ok = fs.statSync(part).size === m.size; } catch {}
        if (!ok) { try { fs.rmSync(part); } catch {} return sendJSON(res, { error: 'download-corrupt' }, 502); }
        if (m.archive) { // .tar.bz2 bundle — extract into modelsDir with the OS tar (bsdtar)
          const x = spawn(bsdtar(), ['-xjf', part, '-C', modelsDir]);
          x.on('error', () => { try { fs.rmSync(part); } catch {} sendJSON(res, { error: 'extract-failed' }, 500); });
          x.on('close', code => {
            try { fs.rmSync(part); } catch {}
            if (code !== 0 || !modelReady(modelsDir, name)) return sendJSON(res, { error: 'extract-failed' }, 500);
            sendJSON(res, { ok: true });
          });
          return;
        }
        try { fs.renameSync(part, dest); } catch { return sendJSON(res, { error: 'write-failed' }, 500); }
        sendJSON(res, { ok: true });
      });
      ws.on('error', () => { ffProgress.delete('model-' + name); try { fs.rmSync(part); } catch {} sendJSON(res, { error: 'write-failed' }, 500); });
      r.on('error', () => { ffProgress.delete('model-' + name); try { ws.destroy(); fs.rmSync(part); } catch {} try { sendJSON(res, { error: 'download-failed' }, 502); } catch {} });
    });
  });
}
function handleModels(res, modelsDir) { // list installed/downloadable models for the "Manage storage" panel
  const out = Object.keys(MODELS).map(name => ({
    name, ready: modelReady(modelsDir, name),
    sizeMB: Math.round(MODELS[name].size / 1e6),
  }));  // note: no absolute path returned — it leaks the OS username to any local reader
  return sendJSON(res, { models: out });
}
function handleDeleteModel(req, res, modelsDir) { // remove a model file (+ .part, + extracted dir) to reclaim disk
  let chunks = [];
  req.on('error', () => {});
  req.on('data', c => { chunks.push(c); if (Buffer.concat(chunks).length > 4096) req.destroy(); });
  req.on('end', () => {
    let j; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return sendJSON(res, { error: 'bad body' }, 400); }
    const name = j.name;
    if (!Object.hasOwn(MODELS, name)) return sendJSON(res, { error: 'unknown-model' }, 400);
    const m = MODELS[name];
    const dest = modelPath(modelsDir, name);
    try { fs.rmSync(dest + '.part', { force: true }); } catch {}
    if (m.archive) { // archive models extract into a directory alongside the .tar.bz2 bundle
      const dir = m.ready ? path.join(modelsDir, path.dirname(m.ready)) : dest;
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      try { fs.rmSync(dest, { force: true }); } catch {}
    } else {
      try { fs.rmSync(dest, { force: true }); } catch {}
    }
    return sendJSON(res, { ok: true });
  });
}
function handleTool(req, res, binDir, modelsDir) {
  const reject = (obj, code) => { try { req.resume(); } catch {} return sendJSON(res, obj, code); };
  req.on('error', () => {});
  let meta;
  try { meta = JSON.parse(new URLSearchParams(req.url.split('?')[1] || '').get('meta') || ''); }
  catch { return reject({ error: 'bad-meta' }, 400); }
  const id = (new URLSearchParams(req.url.split('?')[1] || '').get('id') || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  const { tool, inName } = meta || {}; const opts = (meta && meta.opts) || {};
  if (!okJobName(inName)) return reject({ error: 'bad-names' }, 400);

  // resolve the plan for the requested tool: steps of {bin, args, prog, stdout}. Args are
  // fixed server-side; `late` marks argv slots filled after the upload lands (TTS text).
  // `stdout` streams the step's stdout into that file (exiftool JSON). Everything runs in
  // the throwaway temp dir.
  let plan = null, outName = null, late = null;
  const pct = s => { const m = /(\d+(?:\.\d+)?)%/.exec(s); return m ? +m[1] / 100 : null; };
  if (tool === 'whisper') {
    const bin = toolBin(binDir, 'whisper', 'whisper-cli');
    if (!bin) return reject({ error: 'tool-missing' }, 501);
    // Bigger models miss far fewer lines (esp. over music), at the cost of speed. The renderer
    // picks; default stays 'base' so existing callers are unchanged.
    const modelFile = { base: 'ggml-base.bin', small: 'ggml-small.bin', medium: 'ggml-medium.bin',
      turbo: 'ggml-large-v3-turbo.bin' }[opts.model] || 'ggml-base.bin';
    if (!modelReady(modelsDir, modelFile)) return reject({ error: 'model-missing', model: modelFile }, 409);
    const fmt = opts.fmt === 'txt' ? 'txt' : opts.fmt === 'vtt' ? 'vtt' : 'srt';
    outName = 'out.' + fmt;
    // For subtitles, cap segment length and split on word boundaries so cues stay short and
    // don't merge across pauses/speaker turns (plain text wants whole paragraphs, so skip there).
    const seg = fmt === 'txt' ? [] : ['-ml', '60', '-sow'];
    plan = [{ bin, args: ['-m', modelPath(modelsDir, modelFile), '-f', inName, '-o' + fmt, '-of', 'out', ...seg, '--print-progress'],
      prog: s => { const m = /progress\s*=\s*(\d+)%/.exec(s); return m ? +m[1] / 100 : null; } }];
  } else if (tool === 'raw') {
    const dcraw = toolBin(binDir, 'libraw', 'dcraw_emu'), ffmpeg = findBin('ffmpeg', binDir);
    if (!dcraw || !ffmpeg) return reject({ error: 'tool-missing' }, 501);
    const png = opts.to === 'png';
    outName = png ? 'out.png' : 'out.jpg';
    plan = [
      { bin: dcraw, args: ['-w', '-q', '3', '-T', '-Z', 'mid.tiff', inName], prog: () => 0.45 },
      { bin: path.resolve(ffmpeg), args: ['-hide_banner', '-y', '-i', 'mid.tiff', '-frames:v', '1', '-update', '1',
        ...(png ? [] : ['-c:v', 'mjpeg', '-q:v', '2', '-pix_fmt', 'yuvj444p']), outName], prog: () => 0.9 },
    ];
  } else if (tool === 'upscale') {
    const bin = toolBin(binDir, 'esrgan', 'realesrgan-ncnn-vulkan');
    if (!bin) return reject({ error: 'tool-missing' }, 501);
    outName = 'out.png';
    plan = [{ bin, args: ['-i', inName, '-o', outName, '-n', opts.model === 'anime' ? 'realesrgan-x4plus-anime' : 'realesrgan-x4plus'], prog: pct }];
  } else if (tool === 'exif') {
    const bin = toolBin(binDir, 'exiftool', 'exiftool');
    if (!bin) return reject({ error: 'tool-missing' }, 501);
    const inExt = (inName.split('.').pop() || 'jpg').toLowerCase();
    if (opts.op === 'strip-gps') {
      outName = 'out.' + inExt;
      plan = [{ bin, args: ['-gps:all=', '-o', outName, inName] }];
    } else if (opts.op === 'set-date') {
      if (!/^\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2}$/.test(opts.date || '')) return reject({ error: 'bad-date' }, 400);
      outName = 'out.' + inExt;
      plan = [{ bin, args: ['-AllDates=' + opts.date, '-o', outName, inName] }];
    } else if (opts.op === 'read-dates') {
      outName = 'out.json';
      plan = [{ bin, args: ['-j', '-DateTimeOriginal', '-CreateDate', '-Model', inName], stdout: outName }];
    } else return reject({ error: 'unknown-op' }, 400);
  } else if (tool === 'tts') {
    const bin = toolBin(binDir, 'sherpa', 'sherpa-onnx-offline-tts');
    if (!bin) return reject({ error: 'tool-missing' }, 501);
    if (!modelReady(modelsDir, 'vits-piper-en_US-amy-medium')) return reject({ error: 'model-missing' }, 409);
    const v = path.join(modelsDir, 'vits-piper-en_US-amy-medium');
    outName = 'out.wav';
    plan = [{ bin, args: ['--vits-model=' + path.join(v, 'en_US-amy-medium.onnx'), '--vits-tokens=' + path.join(v, 'tokens.txt'),
      '--vits-data-dir=' + path.join(v, 'espeak-ng-data'), '--output-filename=' + outName, '@TEXT@'],
      prog: s => { const m = /progress=([0-9.]+)/.exec(s); return m ? +m[1] : null; } }];
    late = inPath => { // the uploaded file IS the text to speak
      let t = ''; try { t = fs.readFileSync(inPath, 'utf8').slice(0, 5000).trim(); } catch {}
      if (!t) return 'empty-text';
      plan[0].args = plan[0].args.map(a => a === '@TEXT@' ? t : a);
    };
  } else if (tool === 'vtracer') {
    const bin = toolBin(binDir, 'vtracer', 'vtracer');
    if (!bin) return reject({ error: 'tool-missing' }, 501);
    outName = 'out.svg';
    plan = [{ bin, args: ['--input', inName, '--output', outName] }];
  } else if (tool === 'stems') {
    const bin = toolBin(binDir, 'sherpa', 'sherpa-onnx-offline-source-separation');
    if (!bin) return reject({ error: 'tool-missing' }, 501);
    if (!modelReady(modelsDir, 'UVR-MDX-NET-Voc_FT.onnx')) return reject({ error: 'model-missing' }, 409);
    outName = 'out.zip';
    plan = [
      { bin, args: ['--uvr-model=' + modelPath(modelsDir, 'UVR-MDX-NET-Voc_FT.onnx'), '--num-threads=4',
        '--input-wav=' + inName, '--output-vocals-wav=vocals.wav', '--output-accompaniment-wav=instrumental.wav'], prog: () => 0.6 },
      // bsdtar (ships with Win10+ and macOS) infers zip format from the extension
      { bin: bsdtar(), args: ['-a', '-cf', outName, 'vocals.wav', 'instrumental.wav'], prog: () => 0.95 },
    ];
  } else return reject({ error: 'unknown-tool' }, 400);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-tool-'));
  const inPath = path.join(tmp, inName), outPath = path.join(tmp, outName);
  const ws = fs.createWriteStream(inPath);
  let size = 0, aborted = false;
  const die = (obj, code) => { if (aborted) return; aborted = true; try { req.destroy(); } catch {} try { ws.destroy(); } catch {} cleanup(tmp); sendJSON(res, obj, code); };
  req.on('data', c => { size += c.length; if (size > 500 * 1048576) die({ error: 'too-big' }, 413); });
  req.on('error', () => die({ error: 'upload-failed' }, 400));
  ws.on('error', () => die({ error: 'write-failed' }, 500));
  req.pipe(ws);
  ws.on('finish', () => {
    if (aborted) return;
    if (late) { const bad = late(inPath); if (bad) { cleanup(tmp); return sendJSON(res, { error: bad }, 400); } }
    let err = '', curChild = null;
    // If the client goes away mid-job (tool switch / reset), kill the running step so whisper/tts/stems/upscale/raw aren't left orphaned.
    res.on('close', () => { if (!res.writableEnded && !aborted) { aborted = true; killTree(curChild); if (id) ffProgress.delete(id); cleanup(tmp); } });
    const runStep = k => {
      if (aborted) return;
      if (k >= plan.length) {
        if (id) ffProgress.delete(id);
        let stat; try { stat = fs.statSync(outPath); } catch { cleanup(tmp); return sendJSON(res, { error: 'tool-failed', detail: err.slice(-2500) }, 500); }
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        const rs = fs.createReadStream(outPath);
        rs.on('error', () => { try { res.destroy(); } catch {} cleanup(tmp); });
        rs.on('close', () => cleanup(tmp));
        return rs.pipe(res);
      }
      const { bin, args, prog, stdout } = plan[k];
      // detached → child leads its own process group, so a cancelled job can be killed as a tree
      const child = spawn(bin, args, { cwd: tmp, detached: true });
      curChild = child;
      if (stdout) child.stdout.pipe(fs.createWriteStream(path.join(tmp, stdout)));
      child.stderr.on('data', d => { const s = String(d); err += s; if (err.length > 20000) err = err.slice(-20000);
        if (id && prog) { const p = prog(s); if (p != null) ffProgress.set(id, Math.min(0.999, (k + Math.max(0, p)) / plan.length)); } });
      child.on('error', e => { if (aborted) return; if (id) ffProgress.delete(id); cleanup(tmp); sendJSON(res, { error: 'tool-failed', detail: String(e) }, 500); });
      child.on('close', code => {
        if (aborted) return;
        if (code !== 0) { if (id) ffProgress.delete(id); const d = err.slice(-2500); cleanup(tmp); return sendJSON(res, { error: 'tool-failed', detail: d || (path.basename(bin) + ' exit ' + code) }, 500); }
        runStep(k + 1);
      });
    };
    runStep(0);
  });
}

/* ---- memory-card detection: any mounted volume with a DCIM folder (card readers,
   cameras in mass-storage mode). Import copies photos/videos into ~/Pictures. ---- */
const CARD_MEDIA = /\.(jpe?g|png|heic|heif|webp|gif|tiff?|bmp|cr2|cr3|nef|arw|raf|dng|orf|rw2|pef|srw|mp4|mov|avi|mts|m2ts|3gp|wav|mp3)$/i;
function listCards() {
  const out = [];
  if (process.platform === 'win32') {
    for (let i = 68; i <= 90; i++) { // D..Z
      const root = String.fromCharCode(i) + ':\\';
      try { if (fs.existsSync(path.join(root, 'DCIM'))) out.push({ root, label: String.fromCharCode(i) + ':' }); } catch {}
    }
  } else {
    try { for (const v of fs.readdirSync('/Volumes')) {
      const root = path.join('/Volumes', v);
      try { if (fs.existsSync(path.join(root, 'DCIM'))) out.push({ root, label: v }); } catch {}
    } } catch {}
  }
  return out;
}
function walkDcim(dir, acc) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDcim(p, acc);
    else if (e.isFile() && CARD_MEDIA.test(e.name)) acc.push(p);
  }
}
function handleImportCard(req, res) {
  let chunks = [];
  req.on('data', c => { chunks.push(c); if (Buffer.concat(chunks).length > 4096) req.destroy(); });
  req.on('end', () => {
    let j; try { j = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return sendJSON(res, { error: 'bad body' }, 400); }
    // only roots we ourselves detect are importable — the client can't name arbitrary paths
    const card = listCards().find(c => c.root === j.root);
    if (!card) return sendJSON(res, { error: 'card-gone' }, 404);
    const files = []; walkDcim(path.join(card.root, 'DCIM'), files);
    if (!files.length) return sendJSON(res, { error: 'empty' }, 404);
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    const dest = path.join(os.homedir(), 'Pictures', 'Junk Drawer Import ' + stamp);
    try { fs.mkdirSync(dest, { recursive: true }); } catch { return sendJSON(res, { error: 'write-failed' }, 500); }
    let done = 0, copied = 0, failed = 0;
    for (const f of files) {
      let name = path.basename(f), target = path.join(dest, name), n = 1;
      while (fs.existsSync(target)) target = path.join(dest, path.basename(name, path.extname(name)) + '-' + (n++) + path.extname(name));
      try { fs.copyFileSync(f, target); copied++; } catch { failed++; }
      done++; ffProgress.set('card-import', Math.min(0.999, done / files.length));
    }
    ffProgress.delete('card-import');
    // pop the folder open so the user sees exactly where everything went
    try { spawn(process.platform === 'win32' ? 'explorer' : 'open', [dest], { detached: true, stdio: 'ignore' }).unref(); } catch {}
    sendJSON(res, { ok: true, copied, failed, dest });
  });
}

function startServer(appRoot, binDir, updater, opener, modelsDir) {
  // absolute: tool subprocesses run from throwaway temp cwds, so a relative path would break
  modelsDir = path.resolve(modelsDir || path.join(os.homedir(), '.junkdrawer', 'models'));
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
        return sendJSON(res, { ytdlp: have('yt-dlp', binDir), spotdl: have('spotdl', binDir), ffmpeg: have('ffmpeg', binDir),
          whisper: !!toolBin(binDir, 'whisper', 'whisper-cli'), whisperModel: modelReady(modelsDir, 'ggml-base.bin'),
          whisperSmall: modelReady(modelsDir, 'ggml-small.bin'), whisperMedium: modelReady(modelsDir, 'ggml-medium.bin'),
          whisperTurbo: modelReady(modelsDir, 'ggml-large-v3-turbo.bin'),
          raw: !!toolBin(binDir, 'libraw', 'dcraw_emu'), upscale: !!toolBin(binDir, 'esrgan', 'realesrgan-ncnn-vulkan'),
          exif: !!toolBin(binDir, 'exiftool', 'exiftool'), vtracer: !!toolBin(binDir, 'vtracer', 'vtracer'),
          tts: !!toolBin(binDir, 'sherpa', 'sherpa-onnx-offline-tts'), ttsModel: modelReady(modelsDir, 'vits-piper-en_US-amy-medium'),
          stems: !!toolBin(binDir, 'sherpa', 'sherpa-onnx-offline-source-separation'), stemsModel: modelReady(modelsDir, 'UVR-MDX-NET-Voc_FT.onnx') });
      if (url === '/api/update-check')
        return handleUpdateCheck(res, updater);
      if (url === '/api/update-state')
        return sendJSON(res, Object.assign({ enabled: !!(updater && updater.enabled) }, (updater && updater.state && updater.state()) || {}));
      if (url === '/api/update-download' && req.method === 'POST') {
        if (updater && updater.enabled) { updater.download(); return sendJSON(res, { ok: true }); }
        return sendJSON(res, { error: 'unavailable' }, 400);
      }
      if (url === '/api/update-apply' && req.method === 'POST') {
        if (updater && updater.enabled) { updater.apply(); return sendJSON(res, { ok: true }); }
        return sendJSON(res, { error: 'unavailable' }, 400);
      }
      if (url === '/api/download' && req.method === 'POST') return handleDownload(req, res, binDir);
      if (url === '/api/ffmpeg-progress')
        return sendJSON(res, { percent: ffProgress.get(new URLSearchParams(req.url.split('?')[1] || '').get('id') || '') || 0 });
      if (url === '/api/ffmpeg' && req.method === 'POST') return handleFFmpeg(req, res, binDir);
      if (url === '/api/ffmpeg-extra' && req.method === 'POST') return handleFFmpegExtra(req, res);
      if (url === '/api/tool' && req.method === 'POST') return handleTool(req, res, binDir, modelsDir);
      if (url === '/api/fetch-model' && req.method === 'POST') return handleFetchModel(req, res, modelsDir);
      if (url === '/api/models') return handleModels(res, modelsDir);
      if (url === '/api/delete-model' && req.method === 'POST') return handleDeleteModel(req, res, modelsDir);
      if (url === '/api/cards') return sendJSON(res, { cards: listCards() });
      if (url === '/api/import-card' && req.method === 'POST') return handleImportCard(req, res);
      // A file the user opened from the OS ("Open with → Junk Drawer"). main.js queues its
      // absolute path; we read it once and hand the renderer the bytes for the viewer. The
      // path is set only by main.js from OS open events — never from client input.
      if (url === '/api/opened-file') {
        const p = opener && opener.take && opener.take();
        if (!p) return sendJSON(res, { none: true });
        try { return sendJSON(res, { name: path.basename(p), b64: fs.readFileSync(p).toString('base64') }); }
        catch { return sendJSON(res, { none: true }); }
      }
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
