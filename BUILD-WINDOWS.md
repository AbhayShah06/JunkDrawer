# Building the Windows `.exe`

Junk Drawer ships a macOS `.dmg` and a Windows `.exe`. This file covers the **Windows**
build only — the Mac build is unchanged (`npm run dist:mac`, documented in `README.md`).
Both platforms coexist: Mac users download the `.dmg`, Windows users download the `.exe`.

The app is **intentionally unsigned** (no paid code-signing certificate). That's fine — it
just means Windows shows a one-time SmartScreen prompt (see below), the exact analogue of
the macOS Gatekeeper "unidentified developer" right-click → Open dance.

> You must run these steps **on a Windows machine**. electron-builder produces a Windows
> NSIS installer only when run on Windows. macOS cannot build the `.exe`.

---

## Build steps (on Windows)

1. **Install Node.js** (LTS, v18+). Get it from <https://nodejs.org> and run the installer.
   Open a fresh PowerShell or Command Prompt afterwards so `node` and `npm` are on PATH.
   Verify:
   ```
   node --version
   npm --version
   ```

2. **Get the code.** Clone the repo (or copy the project folder onto the Windows machine):
   ```
   git clone https://github.com/AbhayShah06/JunkDrawer.git
   cd JunkDrawer
   ```

3. **Install dependencies:**
   ```
   npm install
   ```

4. **Fetch the Windows binaries.** This downloads `yt-dlp.exe` and a static `ffmpeg.exe`
   into `resources\bin\win\` (these are gitignored — too big for GitHub, so they're not in
   the repo and must be fetched on the build machine):
   ```
   npm run fetch-bins:win
   ```
   - `yt-dlp.exe` comes from the yt-dlp GitHub releases (`.../releases/latest/download/yt-dlp.exe`).
   - `ffmpeg.exe` is extracted from BtbN's static win64 GPL build
     (`ffmpeg-master-latest-win64-gpl.zip`). The script unzips it using Windows' built-in
     `tar` (present on Windows 10 1803+ and Windows 11).
   - **If the script can't unzip** (no `tar`), it prints manual instructions: download
     <https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip>,
     open it, and copy `bin\ffmpeg.exe` into `resources\bin\win\`.
   - When done, `resources\bin\win\` should contain exactly `yt-dlp.exe` and `ffmpeg.exe`.

5. **Build the installer:**
   ```
   npm run dist:win
   ```

6. **Find the output.** The NSIS installer lands in:
   ```
   dist-app\Junk Drawer Setup <version>.exe
   ```
   (alongside a `latest.yml` and a `.blockmap` that electron-builder uses for updates).
   Double-click the `Setup .exe` to install, then launch Junk Drawer from the Start menu.

---

## SmartScreen on first launch (expected — the app is unsigned)

Because the installer isn't signed, Windows Defender SmartScreen shows a blue dialog the
first time someone runs it:

> **"Windows protected your PC"** — Microsoft Defender SmartScreen prevented an
> unrecognized app from starting.

To run it: click **"More info"**, then click the **"Run anyway"** button that appears.
Windows remembers the choice. This is the Windows equivalent of the macOS "right-click →
Open → Open" workaround for unsigned apps. Nothing is wrong with the build — it just hasn't
been through paid code signing.

---

## Publishing a Windows release (so the in-app updater serves the `.exe`)

The app checks GitHub on launch and shows an "update available" bar. The updater now returns
a platform-appropriate `installerUrl` — the `.dmg` asset on macOS, the `.exe` asset on
Windows — so Windows users get the Windows installer, not the Mac DMG.

To publish a Windows build to the GitHub release (target: `AbhayShah06/JunkDrawer`):

```
# bump the version first if needed:  npm version patch

# point electron-builder at your GitHub account, then build + publish in one step
set GH_TOKEN=<your github token>           # PowerShell:  $env:GH_TOKEN = "<token>"
npx electron-builder --win nsis --publish always
```

This uploads the `Setup .exe` (plus `latest.yml`/`.blockmap`) as assets on the GitHub
release. The next time a Windows user opens Junk Drawer, `/api/update-check` finds the
asset whose name ends in `.exe`, and the update bar's Download button points at it.

> Mac and Windows assets can live on the **same** GitHub release. The updater picks the
> right one per OS: it looks for a `.dmg` asset on macOS and an `.exe` asset on Windows.
> Publish the Mac DMG with `npm run release:mac` (from the Mac build machine) and the
> Windows `.exe` with the command above (from the Windows build machine).

---

## How this stays separate from the Mac build

- `package.json` uses **per-platform** `extraResources`: `mac.extraResources` bundles
  `resources/bin/mac/` and `win.extraResources` bundles `resources/bin/win/`. Each OS's
  installer therefore contains only its own binaries (the Mac build no longer drags along
  Windows exes, and vice-versa). Both copy into the app as `Resources/bin/`.
- `electron/server.js` `findBin()` is `.exe`-aware: on Windows it looks for `yt-dlp.exe` /
  `ffmpeg.exe` (bundled dir first, then PATH via `where`); on macOS it's unchanged.
- The Mac build still requires its bundled binaries to be in `resources/bin/mac/` — move
  the existing universal `yt-dlp` / `ffmpeg` there (they used to sit flat in
  `resources/bin/`). The `x64ArchFiles: "**/bin/*"` glob still matches the packaged path.
