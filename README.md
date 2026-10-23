# Junk Drawer

Local tools for the file jobs that get in the way: convert a photo, shrink a video, sign a PDF, extract an archive, or clean up a folder of photos. No account and no file uploads.

Drop files, choose an action, and save the result. Your originals stay untouched. The home screen has six task entry points; specialized jobs are under More tools. The first choices are smaller files, JPG, PDF merge, MP4, MP3, and image resizing. Search still understands older formats such as MTS.

## Compression and local models

Video compression offers H.264 MP4, HEVC, and AV1. CPU encoding is the default. The optional faster mode tests hardware encoding and falls back to CPU. Size limits use a two-pass H.264 encode with a final byte-size check. Larger results are rejected. HDR input requires HEVC or AV1; it is not silently converted to 8-bit H.264.

The included OCR/background tools remain available offline. Optional downloads add PaddleOCR v6 multilingual OCR (32 MB), BiRefNet Lite 512 background removal (192 MB), and Qwen3-ASR 0.6B text transcription with speech detection (843 MB). Models download only when chosen or requested from Manage storage, and are checked against pinned SHA-256 hashes. Processing stays local after download. Qwen3 is text-only; Whisper remains available for timed subtitles.

The Windows build bundles speech.cpp 0.8.11. There is no Python, cloud inference service, or required GPU. Native media/transcription jobs are queued; image inference uses workers that are terminated after each job. Model downloads can be removed under Manage storage.

Burn In Subtitles accepts an SRT, VTT or ASS file, or generates timed subtitles from the video using Whisper. Generated captions can be edited and saved before burning them in. Generation defaults to the 148 MB base model on four CPU threads; the 488 MB small model is also available. Speech language is detected automatically.

Model downloads continue when you switch tools, with progress shown above the workspace. Whisper downloads can be cancelled. Failed or cancelled transfers remove their unfinished files; after an app exit or crash, known unfinished files are removed on the next launch. Downloads restart from the beginning rather than resume. Manage storage lists models by download size and states what each is used for. Retired models appear only when installed, so they can be removed.

## Quick access

Click the tray icon or press **Ctrl+Alt+J** (Mac: **Command+Option+J**) for a compact file panel. The tray also opens the full workspace. Closing the window keeps quick access ready; choose Quit from the tray menu to exit. **Start with Windows** is optional under Settings & quick access. It starts disabled, remains listed in Windows Settings → Apps → Startup, and honors changes made there.

In the Windows desktop build, select files, then right-click → **Send to → Junk Drawer** (Windows 11 may require **Show more options**). Media opens directly in conversion; other files show matching actions. Default PDF, photo, and video viewers stay the same.

The Send to shortcut is created when the packaged app first runs. Use **Settings & quick access** to remove or restore it. The Windows uninstaller removes the shortcut.

## What's inside

- **Media conversion:** individual files or a sequential batch, with a save button and status for each file. MTS/M2TS/AVCHD camera footage is recognized as video.
- **Video:** convert, compress, trim, mute, extract audio, make a GIF, or generate/review/burn subtitles.
- **Audio:** convert, trim, reduce bitrate, and transcribe speech locally.
- **Images:** convert, resize, rotate, compress, remove backgrounds, OCR, develop camera RAW, inspect/remove metadata, fix dates, rename photos, and export PDFs.
- **PDF:** sign/fill, merge, split, compress, rotate, number, watermark, delete pages, and export page images.
- **Archives and data:** create/extract ZIPs, extract supported RAR/7z/TAR archives, CSV/JSON conversion and QR codes.
- **File identification:** inspect the signature and native media streams of an unknown file.
- **Downloads:** save supported media from a URL. This feature needs the internet; file processing stays local.

There is no video editing suite, timeline, project manager, general document viewer, or file-association registration.

## Updates

The installed app checks at startup, every 15 minutes, and when you return after a minute. Use **Check for updates** at any time. Download progress, retry and Restart & install are shown in the banner. Installation requires an explicit click. A source push alone does not notify installed copies: a published release must contain the installer, blockmap and matching latest.yml.

## Conversion coverage

The app lists outputs supported by the **installed FFmpeg encoders and muxers**. Capability discovery prevents an unavailable encoder from appearing as a working option.

| Family | Output presets (when installed) |
| --- | --- |
| Video | MP4, MKV, WebM, MOV, AVI, MPEG |
| Audio | MP3, WAV, FLAC, M4A, AAC, OGG, Opus, AIFF, AC3, WMA, AU, MP2 |
| Image | PNG, JPG, WebP, TIFF, BMP, TGA, PPM, PGM, AVIF, JPEG XL |

Inputs include common formats plus older camera/video/audio/image families. Recognition of an extension is not a guarantee that every codec, damaged file, or proprietary variant can be decoded. Image conversion saves the first frame. Video output uses the first video stream and optional first audio stream; extra tracks/subtitles are not copied. Audio output uses the first audio stream. Lossless output does not restore lost source quality.

**Old `.dat` files:** use **Look Inside a File**, then **Convert Unknown Media** if it contains readable media. A WAV or MPEG stream stored as `.dat` can work. A Skype database, encrypted file, or raw SILK recording needs a dedicated exporter/decoder. Junk Drawer reports these limits instead of pretending that changing an extension converts a file.

HEIC decoding and common browser image outputs have a fallback. RAW development uses LibRaw. FFmpeg handles other supported image formats locally.

## Get it and develop

Published installers are on the [Releases page](https://github.com/AbhayShah06/JunkDrawer/releases/latest). Source changes on `main` can precede a published installer.

```sh
npm install
npm run vendor
npm start
```

Windows native engines: `npm run fetch-bins:win`. macOS: `bash scripts/fetch-bins-mac.sh` (see the script's build prerequisites). See [BUILD-WINDOWS.md](BUILD-WINDOWS.md) for Windows packaging.

```sh
npm test
npm run dist:win
# macOS build machine:
npm run dist:mac
```

Native engines and browser libraries ship inside desktop builds. Background removal uses a local model; transcription downloads the selected model once, then runs offline. Downloads, model acquisition, and update checks require a network connection. Retired voice/stem models are preserved locally and can be removed through Manage storage.

Batch transcription remains available:

```sh
npm run transcribe:batch -- --input "path/to/recordings" --output "path/to/transcripts" --title "Project name"
```

The product audit, feature decisions, validation evidence, and next release gates are in [docs/PRODUCT_RESET.md](docs/PRODUCT_RESET.md). The conversion contract is in [electron/media.js](electron/media.js).

Built by Abhay Shah. [LinkedIn](https://www.linkedin.com/in/abhay-shah1/) · [X](https://x.com/AbhayShahCA)

The logo master is [branding/mark.svg](branding/mark.svg). Rebuild the PNG and multi-size ICO using `node scripts/render-branding.mjs` with Chrome installed (or set CHROME_PATH).
