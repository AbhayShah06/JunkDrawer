# 🗄️ Junk Drawer

Every annoying file tool in one place. Convert, shrink, extract, clean, and package files without hunting down five sketchy websites. Nothing uploads anywhere. Every tool runs in your browser, on your machine.

Built by Abhay Shah ([LinkedIn](https://www.linkedin.com/in/abhay-shah1/), [@AbhayShahCA](https://x.com/AbhayShahCA)).

---

## Run it — two ways

### As a real Mac app (Electron)

This is now packaged as a desktop app: its own window, light/dark mode, no browser tab,
with `yt-dlp` and `ffmpeg` bundled inside so downloads work with zero setup.

```
npm install
npm run dist:mac     # builds dist-app/Junk Drawer-<version>-arm64.dmg
```

Open the `.dmg`, drag the app to Applications, launch it. Because it isn't signed with
a paid Apple certificate, the first launch shows macOS's "unidentified developer"
prompt: right-click the app → Open → Open, once. `npm start` runs it in dev without
packaging. `npm run dist:win` produces a Windows `.exe` (build that on a Windows machine).

### Auto-update for people you share it with

The app checks GitHub on launch and, if a newer release exists, shows a small bar at the
top: **"Junk Drawer X is available — Download X."** One click opens the new `.dmg`. (macOS
can't silently self-update an unsigned app, so it's a one-click re-download, not a
background install. The bar stays out of the way and can be dismissed per version.)

**To ship an update** (from this machine, where the binaries already live):

```
# bump the version first
npm version patch         # 1.0.0 -> 1.0.1 (or: minor / major)

# build the universal DMG and publish it to a GitHub Release in one step
export GH_TOKEN=$(gh auth token)     # uses your logged-in GitHub account
npm run release:mac
```

Everyone still on the old version sees the update bar the next time they open the app.
The release target is `abhayshah06/junk-drawer` (set under `build.publish` in
`package.json`).

> First-time setup: the repo must exist and you must be logged in as that GitHub account
> (`gh auth login`). The bundled `yt-dlp`/`ffmpeg` in `resources/bin/` are **not** in the
> repo — `ffmpeg` is larger than GitHub's 100 MB file limit. They live on the build
> machine and get baked into each released `.dmg`.

### As a quick local web app (no build)

Double-click `start.command`. Your browser opens to the app. It uses the Ruby that
ships with macOS, so there's nothing to install for the file tools. (Link downloads in
this mode use `yt-dlp`/`spotdl`/`ffmpeg` from your PATH instead of bundled copies.)

### Sharing with colleagues

Zip the folder and send it. The first time someone double-clicks `start.command`, macOS warns about an "unidentified developer." Every downloaded script gets that warning. They right-click `start.command`, pick Open, then Open again. macOS remembers the choice after that.

The first time you run a video or background-removal tool, it downloads its engine or model from a CDN and caches it. Stay online for that first run.

## Three ways in

1. Drop a file. A receipt tells you what it is and lists the things you probably want to do with it, and the matching drawer opens. Hover any tool to read what it's for.
2. Search the tools. Type `compress`, `mp4 to mp3`, `heic`, `remove background`, `pdf`. It matches tool names and keywords (it's plain text search, no AI, nothing leaves your machine).
3. Open a drawer and browse by category.

## What's in the drawers

About 35 tools, grouped by file type.

- **Image**: background remover, format convert, compress to a size, resize, rotate/flip, EXIF and GPS stripper, solid backdrop, favicon set, image to PDF
- **Video**: GIF maker, compress to a target size, audio extract, MP4 convert, trim, mute, grab a frame
- **Audio**: convert, normalize, trim, drop the bitrate
- **PDF**: compress, export pages as images, split, rotate, number pages, watermark, delete pages, merge
- **Data**: CSV to JSON, JSON to CSV
- **Dev**: JSON tidy, JSON and YAML both ways, Base64, URL encode, hashes, epoch time
- **Archive**: zip, unzip
- **Weird**: File Detective (reads the magic bytes to tell you what a file really is), GIF to MP4, HEIC to JPG
- **Download**: YouTube → Video (MP4), YouTube → MP3, Spotify → MP3

### Link downloads need a couple of CLI tools

The Download drawer (and pasting a YouTube/Spotify link in search) runs `yt-dlp` /
`spotdl` locally through the launcher's server. Install once:

```
brew install yt-dlp ffmpeg     # YouTube video + MP3
pip3 install spotdl            # Spotify (also needs ffmpeg)
```

If a tool is missing, that drawer item shows the exact install command instead of
failing. The other 43 tools need nothing installed.

Get the result out three ways: download it, copy it (then paste into Discord or Slack), or drag the preview thumbnail straight out.

## Design

A classic desktop-utility look: beveled gray controls, a pinstripe title bar, colored file-folder drawer tabs, balloon-help tooltips, and a status bar. Monospace for the technical bits. No purple, no neon, no glass.

## Under the hood

Everything runs client-side in WebAssembly: FFmpeg.wasm, @imgly/background-removal, pdf-lib, pdf.js, heic2any, fflate, js-yaml. The local server (`serve.rb`, or `serve.py` if you prefer Python) does one job: it sends the cross-origin-isolation headers FFmpeg needs to run multi-threaded.

Abhay Shah, 2026.
