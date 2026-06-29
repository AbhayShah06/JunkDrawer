# Credits

Junk Drawer stands on a lot of excellent open-source work. Every engine runs locally inside the app; these are the projects that make the tools possible. Thank you to their authors and maintainers.

| Project | What it does here | License |
|---|---|---|
| [FFmpeg](https://ffmpeg.org/) (bundled native + [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm)) | Video and audio conversion, compression, trimming, GIFs | LGPL-2.1+ (FFmpeg); MIT (@ffmpeg/ffmpeg, @ffmpeg/util wrappers) |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Saving video/audio from a link | The Unlicense |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | Editing, signing, merging, stamping PDFs | MIT |
| [PDF.js](https://github.com/mozilla/pdf.js) | Rendering PDF pages | Apache-2.0 |
| [@imgly/background-removal](https://github.com/imgly/background-removal-js) | Removing image backgrounds (runs an ONNX model locally) | **AGPL-3.0** |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) | Running the background-removal model | MIT |
| [qrcode](https://github.com/soldair/node-qrcode) | Generating QR codes | MIT |
| [jsQR](https://github.com/cozmo/jsQR) | Reading QR codes from images | Apache-2.0 |
| [heic2any](https://github.com/alexcorvi/heic2any) | Converting iPhone HEIC photos to JPG | MIT |
| [fflate](https://github.com/101arrowz/fflate) | Zipping and unzipping | MIT |
| [js-yaml](https://github.com/nodeca/js-yaml) | JSON ⇄ YAML conversion | MIT |
| [Electron](https://github.com/electron/electron) | The desktop app shell | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) | Packaging the app | MIT |
| [esbuild](https://github.com/evanw/esbuild) | Bundling the above into the app at build time | MIT |

> **Note on the background remover:** `@imgly/background-removal` is licensed under **AGPL-3.0**, a strong copyleft license. Bundling it into a distributed application carries AGPL obligations for the whole work. See the project root for how this is handled.

Built by Abhay Shah.
