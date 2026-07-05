#!/usr/bin/env node
// Downloads the Windows CLI binaries (yt-dlp.exe + a static ffmpeg.exe) that the
// packaged app bundles, into resources/bin/win/. No external npm deps — uses the
// built-in `https` module, and Windows' built-in `tar` (bsdtar) to unzip ffmpeg.
//
// Run on Windows (or any OS) with:  npm run fetch-bins:win
//
// Sources (both are stable, well-known "latest" download URLs):
//   yt-dlp.exe : https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe
//   ffmpeg.exe : BtbN static win64 GPL build, ffmpeg-master-latest-win64-gpl.zip
//                (single self-contained exe; the "-shared" variant needs DLLs — avoid it)
//
// If `tar` is unavailable on your machine, the script prints the manual steps:
// download the zip, open it, and copy bin/ffmpeg.exe into resources/bin/win/.
//
// NOTE: the macOS binaries in resources/bin/mac/ were obtained analogously —
// `yt-dlp` from the yt-dlp releases (the suffix-less universal macOS build) and a
// universal `ffmpeg` static build — and committed (gitignored) onto the Mac build
// machine. This script is the Windows-side equivalent of that manual step.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'resources', 'bin', 'win');

const YTDLP_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
const FFMPEG_ZIP_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

// Download a URL to a local file, following redirects (GitHub release assets 302 to S3).
function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 8) return reject(new Error('too many redirects'));
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers: { 'User-Agent': 'JunkDrawer-fetch-bins' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(); fs.rmSync(dest, { force: true });
        const next = new URL(res.headers.location, url).toString();
        return resolve(download(next, dest, redirects + 1));
      }
      if (res.statusCode !== 200) {
        file.close(); fs.rmSync(dest, { force: true });
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let got = 0, lastPct = -1;
      res.on('data', c => {
        got += c.length;
        if (total) {
          const pct = Math.floor((got / total) * 100);
          if (pct !== lastPct && pct % 10 === 0) { lastPct = pct; process.stdout.write(`  ${pct}%\r`); }
        }
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => { process.stdout.write('       \r'); resolve(); }));
    });
    req.on('error', err => { file.close(); fs.rmSync(dest, { force: true }); reject(err); });
  });
}

// Find a named file anywhere under a directory tree (depth-first).
function findFile(dir, name) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { const hit = findFile(full, name); if (hit) return hit; }
    else if (entry.name.toLowerCase() === name.toLowerCase()) return full;
  }
  return null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1) yt-dlp.exe — a single self-contained exe, no extraction needed.
  console.log('Downloading yt-dlp.exe ...');
  await download(YTDLP_URL, path.join(OUT_DIR, 'yt-dlp.exe'));
  console.log('  -> resources/bin/win/yt-dlp.exe');

  // 2) ffmpeg.exe — comes inside a zip; extract with `tar` (bsdtar ships with Win10+).
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-ffmpeg-'));
  const zipPath = path.join(tmp, 'ffmpeg.zip');
  console.log('Downloading ffmpeg (win64 gpl static) ...');
  await download(FFMPEG_ZIP_URL, zipPath);

  const tarCheck = spawnSync('tar', ['--version'], { encoding: 'utf8' });
  if (tarCheck.status !== 0) {
    console.error('\n`tar` is not available, so the ffmpeg zip was not extracted automatically.');
    console.error('Manual step:');
    console.error(`  1. Download: ${FFMPEG_ZIP_URL}`);
    console.error('  2. Open the zip and find bin\\ffmpeg.exe inside it.');
    console.error(`  3. Copy that ffmpeg.exe into: ${OUT_DIR}`);
    console.error(`\n(yt-dlp.exe was downloaded successfully to ${OUT_DIR}.)`);
    process.exit(1);
  }

  console.log('Extracting ffmpeg.exe ...');
  const ex = spawnSync('tar', ['-xf', zipPath, '-C', tmp], { encoding: 'utf8' });
  if (ex.status !== 0) { console.error('tar failed to extract:', ex.stderr || ex.error); process.exit(1); }

  const found = findFile(tmp, 'ffmpeg.exe');
  if (!found) { console.error('Could not find ffmpeg.exe inside the extracted zip.'); process.exit(1); }
  fs.copyFileSync(found, path.join(OUT_DIR, 'ffmpeg.exe'));
  console.log('  -> resources/bin/win/ffmpeg.exe');

  fs.rmSync(tmp, { recursive: true, force: true });

  // 3) the native helper engines: whisper.cpp (speech→text), LibRaw (camera RAW),
  //    Real-ESRGAN ncnn-vulkan (upscaling). Each lives in its own subfolder of bin/.
  const zipGrab = async (label, url, picks) => {
    // picks: [zipEntrySuffix, destRelPath][] — extract the whole zip, copy what we need.
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-bins-'));
    const zp = path.join(t, 'a.zip');
    console.log(`Downloading ${label} ...`);
    await download(url, zp);
    const x = spawnSync('tar', ['-xf', zp, '-C', t], { encoding: 'utf8' });
    if (x.status !== 0) { console.error(`tar failed on ${label}:`, x.stderr || x.error); process.exit(1); }
    for (const [suffix, rel] of picks) {
      const hit = findFile(t, path.basename(suffix));
      if (!hit || !hit.replace(/\\/g, '/').endsWith(suffix)) { console.error(`missing ${suffix} in ${label}`); process.exit(1); }
      const dest = path.join(OUT_DIR, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(hit, dest);
    }
    fs.rmSync(t, { recursive: true, force: true });
    console.log(`  -> resources/bin/win/${picks[0][1].split(/[\\/]/)[0]}/`);
  };

  // whisper.cpp: the CLI + every dll beside it (they're all required)
  {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'jd-bins-'));
    const zp = path.join(t, 'w.zip');
    console.log('Downloading whisper.cpp (win x64) ...');
    await download('https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip', zp);
    const x = spawnSync('tar', ['-xf', zp, '-C', t], { encoding: 'utf8' });
    if (x.status !== 0) { console.error('tar failed on whisper:', x.stderr || x.error); process.exit(1); }
    const rel = path.join(t, 'Release');
    fs.mkdirSync(path.join(OUT_DIR, 'whisper'), { recursive: true });
    for (const f of fs.readdirSync(rel))
      if (f === 'whisper-cli.exe' || f.endsWith('.dll'))
        fs.copyFileSync(path.join(rel, f), path.join(OUT_DIR, 'whisper', f));
    fs.rmSync(t, { recursive: true, force: true });
    console.log('  -> resources/bin/win/whisper/');
  }

  await zipGrab('LibRaw 0.22.1 (win64)', 'https://www.libraw.org/data/LibRaw-0.22.1-Win64.zip', [
    ['bin/dcraw_emu.exe', 'libraw/dcraw_emu.exe'],
    ['bin/libraw.dll',    'libraw/libraw.dll'],
  ]);

  await zipGrab('Real-ESRGAN ncnn-vulkan (windows)',
    'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip', [
    ['realesrgan-ncnn-vulkan.exe',        'esrgan/realesrgan-ncnn-vulkan.exe'],
    ['vcomp140.dll',                      'esrgan/vcomp140.dll'],
    ['models/realesrgan-x4plus.bin',      'esrgan/models/realesrgan-x4plus.bin'],
    ['models/realesrgan-x4plus.param',    'esrgan/models/realesrgan-x4plus.param'],
    ['models/realesrgan-x4plus-anime.bin',   'esrgan/models/realesrgan-x4plus-anime.bin'],
    ['models/realesrgan-x4plus-anime.param', 'esrgan/models/realesrgan-x4plus-anime.param'],
  ]);

  console.log('\nDone. resources/bin/win/ now has yt-dlp, ffmpeg, whisper/, libraw/, esrgan/.');
  console.log('Next: npm run dist:win');
}

main().catch(err => { console.error('\nfetch-bins:win failed:', err.message); process.exit(1); });
