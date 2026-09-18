#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const value = (flag, fallback = '') => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const inputDir = path.resolve(value('--input', '.transcription-work/media'));
const outputArg = value('--output');
const outputDir = outputArg ? path.resolve(outputArg) : '';
const title = value('--title', 'Combined Transcripts');
const root = path.resolve(import.meta.dirname, '..');
const exe = process.platform === 'win32' ? '.exe' : '';
const platformDir = process.platform === 'win32' ? 'win' : 'mac';
const ffmpeg = path.resolve(value('--ffmpeg', path.join(root, 'resources', 'bin', platformDir, `ffmpeg${exe}`)));
const whisper = path.resolve(value('--whisper', path.join(root, 'resources', 'bin', platformDir, 'whisper', `whisper-cli${exe}`)));
const defaultModels = process.platform === 'win32'
  ? path.join(process.env.APPDATA || '', 'junk-drawer', 'models')
  : path.join(os.homedir(), 'Library', 'Application Support', 'junk-drawer', 'models');
const model = path.resolve(value('--model', path.join(defaultModels, 'ggml-large-v3-turbo.bin')));
const language = value('--language', 'auto');
const reuse = args.includes('--reuse');

if (args.includes('--help')) {
  console.log('Usage: npm run transcribe:batch -- --input <folder> --output <folder> --title "Project" [--model <file>] [--language auto|en] [--reuse]');
  process.exit(0);
}
if (!outputDir) {
  console.error('Missing required --output folder. Choose an explicit location outside the project for private transcripts.');
  process.exit(1);
}
for (const [label, file] of [['input folder', inputDir], ['ffmpeg', ffmpeg], ['whisper-cli', whisper], ['Whisper model', model]]) {
  if (!fs.existsSync(file)) { console.error(`Missing ${label}: ${file}`); process.exit(1); }
}

const mediaExt = new Set(['.mp4', '.mov', '.m4a', '.mp3', '.wav', '.aac', '.flac', '.ogg', '.webm']);
const files = fs.readdirSync(inputDir, { withFileTypes: true })
  .filter(x => x.isFile() && mediaExt.has(path.extname(x.name).toLowerCase()))
  .map(x => x.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
if (!files.length) { console.error(`No supported recordings found in ${inputDir}`); process.exit(1); }
fs.mkdirSync(outputDir, { recursive: true });
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'junkdrawer-transcribe-'));
const sections = [];

function run(bin, binArgs, label) {
  const r = spawnSync(bin, binArgs, { stdio: 'inherit', windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${label} failed with exit code ${r.status}`);
}
function safeStem(name) {
  return path.basename(name, path.extname(name)).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'recording';
}
function srtToMarkdown(srt) {
  return srt.replace(/^\uFEFF/, '').trim().split(/\r?\n\r?\n+/).map(block => {
    const lines = block.split(/\r?\n/);
    if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
    const timing = lines.shift()?.trim() || '';
    const text = lines.join(' ').replace(/\s+/g, ' ').trim();
    const start = timing.split(/\s+-->\s+/)[0]?.replace(',', '.');
    return text ? `- [${start}] ${text}` : '';
  }).filter(Boolean).join('\n');
}

try {
  for (let i = 0; i < files.length; i++) {
    const name = files[i];
    const stem = safeStem(name);
    const input = path.join(inputDir, name);
    const wav = path.join(tempDir, `${i}.wav`);
    const prefix = path.join(outputDir, stem);
    const srtPath = `${prefix}.srt`;
    const txtPath = `${prefix}.txt`;
    if (!(reuse && fs.existsSync(srtPath) && fs.existsSync(txtPath))) {
      console.log(`\n[${i + 1}/${files.length}] Preparing ${name}`);
      run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], 'ffmpeg');
      console.log(`[${i + 1}/${files.length}] Transcribing ${name}`);
      const whisperArgs = ['-m', model, '-f', wav, '-otxt', '-osrt', '-of', prefix, '--print-progress'];
      if (language !== 'auto') whisperArgs.push('-l', language);
      run(whisper, whisperArgs, 'whisper-cli');
    } else {
      console.log(`[${i + 1}/${files.length}] Reusing existing transcript for ${name}`);
    }
    const timed = srtToMarkdown(fs.readFileSync(srtPath, 'utf8'));
    sections.push(`## ${name}\n\nSource: \`${name}\`\n\n${timed}`);
  }
  const combined = `# ${title}\n\nGenerated locally with whisper.cpp using ${path.basename(model)}. This is an automatic transcript without speaker identification; verify critical quotations against the source recordings.\n\n${sections.join('\n\n---\n\n')}\n`;
  const combinedPath = path.join(outputDir, `${title.replace(/[<>:"/\\|?*]/g, '_')}.md`);
  fs.writeFileSync(combinedPath, combined, 'utf8');
  console.log(`\nDone: ${combinedPath}`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
