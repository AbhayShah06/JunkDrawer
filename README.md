# Junk Drawer

Local tools for the file jobs that get in the way: convert an old recording, shrink a video, sign a PDF, extract an archive, or clean up a folder of photos. No account and no file uploads.

Drop files, choose an action, and save the result. Your originals stay untouched. The home screen has six task entry points; specialized jobs are under More tools. Search understands format names such as MTS.

## Quick access

Click the tray icon or press **Ctrl+Alt+J** (Mac: **Command+Option+J**) for a compact file panel. The tray also opens the full workspace. Closing the window keeps quick access ready; choose Quit from the tray menu to exit. **Start with Windows** is optional under Desktop integration.

In the Windows desktop build, select files, then right-click → **Send to → Junk Drawer** (Windows 11 may require **Show more options**). Media opens directly in conversion; other files show matching actions. Default PDF, photo, and video viewers stay the same.

The Send to shortcut is created when the packaged app first runs. Use **Desktop integration** to remove or restore it. The Windows uninstaller removes the shortcut.

## What's inside

- **Media conversion:** individual files or a sequential batch, with a save button and status for each file. MTS/M2TS/AVCHD camera footage is recognized as video.
- **Video:** convert, compress, trim, mute, extract audio, save a frame, make a GIF, burn existing subtitles, or fix variable frame rate.
- **Audio:** convert, trim, reduce bitrate, normalize loudness, remove silence, and transcribe speech locally.
- **Images:** convert, resize, rotate, compress, remove backgrounds, OCR, develop camera RAW, inspect/remove metadata, fix dates, rename photos, create icons, trace to SVG, and export PDFs.
- **PDF:** sign/fill, merge, split, compress, rotate, number, watermark, delete pages, and export page images.
- **Archives and data:** create/extract ZIPs, extract supported RAR/7z/TAR archives, CSV/JSON/YAML conversion, QR codes, and structured data cleanup.
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
