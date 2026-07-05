// Regenerates vendor/ — every third-party engine bundled locally so the app loads
// ZERO remote code at runtime (fully offline, no CDN supply-chain exposure).
// Run after `npm install`; the build scripts run it automatically.
import { build } from 'esbuild';
import { rmSync, mkdirSync, cpSync } from 'fs';
import path from 'path';

const root = process.cwd();
const V = path.join(root, 'vendor');
rmSync(V, { recursive: true, force: true });
for (const d of ['ffmpeg/core-mt', 'ffmpeg/core', 'pdfjs', 'imgly', 'tesseract/lang', 'libarchive']) mkdirSync(path.join(V, d), { recursive: true });

const common = { bundle: true, format: 'esm', platform: 'browser', minify: true,
  define: { 'process.env.NODE_ENV': '"production"' } };

// 1. bundle each library into one self-contained browser ESM file, re-exporting only
//    the symbols the app uses (node resolution picks the right entry per package).
const bundles = [
  { out: 'pdf-lib.mjs',                  src: "export { PDFDocument, degrees, rgb, StandardFonts } from 'pdf-lib';" },
  { out: 'fflate.mjs',                   src: "export { zipSync, unzipSync, strFromU8 } from 'fflate';" },
  { out: 'js-yaml.mjs',                  src: "export { dump, load } from 'js-yaml';" },
  { out: 'heic2any.mjs',                 src: "export { default } from 'heic2any';" },
  { out: 'qrcode.mjs',                   src: "export { default } from 'qrcode';" },
  { out: 'jsqr.mjs',                     src: "export { default } from 'jsqr';" },
  { out: 'ffmpeg/ffmpeg.mjs',            src: "export { FFmpeg } from '@ffmpeg/ffmpeg';" },
  { out: 'ffmpeg/util.mjs',              src: "export { toBlobURL, fetchFile } from '@ffmpeg/util';" },
  { out: 'imgly/background-removal.mjs', src: "export { removeBackground } from '@imgly/background-removal';" },
  { out: 'tesseract/tesseract.mjs',      src: "export { createWorker } from 'tesseract.js';" },
  { out: 'libarchive/libarchive.mjs',    src: "export { Archive } from 'libarchive.js';" },
];
for (const b of bundles)
  await build({ ...common, stdin: { contents: b.src, resolveDir: root, sourcefile: 'entry.mjs', loader: 'js' },
    outfile: path.join(V, b.out) });

// 2. @ffmpeg/ffmpeg spawns this as a separate module worker at runtime (new URL('./worker.js', import.meta.url)).
await build({ ...common, entryPoints: [path.join(root, 'node_modules/@ffmpeg/ffmpeg/dist/esm/worker.js')],
  outfile: path.join(V, 'ffmpeg/worker.js') });

// 3. copy prebuilt assets that ship ready-to-use (not bundled).
const cp = (from, to) => cpSync(path.join(root, from), path.join(V, to), { recursive: true });
cp('node_modules/pdfjs-dist/build/pdf.min.mjs', 'pdfjs/pdf.min.mjs');
cp('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs');
// ESM builds (not UMD): @ffmpeg/ffmpeg runs its worker as type:"module", where
// importScripts() is unavailable, so it loads the core via `import(coreURL).default`.
// The UMD core has no default export → "failed to import ffmpeg-core.js". ESM has it.
cp('node_modules/@ffmpeg/core-mt/dist/esm', 'ffmpeg/core-mt');  // ffmpeg-core.{js,wasm,worker.js}
cp('node_modules/@ffmpeg/core/dist/esm', 'ffmpeg/core');        // ffmpeg-core.{js,wasm}
cp('node_modules/@imgly/background-removal-data/dist', 'imgly/data');  // the background-removal model
// tesseract.js OCR: classic worker + the single-file wasm cores it importScripts()-loads by
// name (plain + relaxed-SIMD; the worker probes and picks) + the English language model,
// which lives in resources/tessdata so builds stay offline.
cp('node_modules/tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js');
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js'])
  cp('node_modules/tesseract.js-core/' + f, 'tesseract/' + f);
cp('resources/tessdata/eng.traineddata.gz', 'tesseract/lang/eng.traineddata.gz');
// libarchive.js: the worker bundle loads the wasm from its own directory
cp('node_modules/libarchive.js/dist/worker-bundle.js', 'libarchive/worker-bundle.js');
cp('node_modules/libarchive.js/dist/libarchive.wasm', 'libarchive/libarchive.wasm');

console.log('vendor/ rebuilt');
