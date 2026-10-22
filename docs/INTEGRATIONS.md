# Utility engine boundaries

Junk Drawer processes files locally. A workflow should produce a concrete file or useful inspection result, with a visible failure when its engine cannot handle the input.

- `electron/media.js` shares input families, output presets, signature identification, and FFmpeg argument construction between browser and server tests.
- `GET /api/media-capabilities` checks the installed FFmpeg encoder and muxer lists and returns available presets. Results are cached for the process lifetime. Native hardware/software decoder support and corrupt input are still checked when the job executes.
- `POST /api/probe-media?ext=mts` streams a user-selected file into an isolated temporary directory and identifies streams with native FFmpeg. The optional suffix is restricted to alphanumeric characters. Filenames are never treated as proof of format. Probe processes have a timeout and are killed on disconnect; temporary files are removed.
- `POST /api/ffmpeg` runs local conversions. The renderer's output choices use the shared preset contract. The existing endpoint retains its argument validation for the other media utilities, restricts native input protocols to local files/pipes, and streams input/output through temporary disk storage.
- `POST /api/video-compress` retains the existing two-pass size-target pipeline.
- `/api/tool` supports Whisper transcription, LibRaw development, ExifTool metadata operations. Retired tracing, voice, song separation, and upscaling execution routes are removed.
- PDF.js/pdf-lib, fflate/libarchive, QR, OCR, background removal, and text libraries remain local, lazily loaded browser engines.

There is no planned or active editor integration. No OpenCut or CapCut project/API dependency is part of the app.

The integration catalog at `/api/integrations` describes installed utility engines. It is a contract/availability summary, not proof that every input/output combination has been exercised. Downloaded legacy voice/stem models remain manageable in storage but cannot be downloaded again through a retired workflow.

Native conversion avoids the old 500 MB renderer rejection. Browser fallback remains bounded, and final browser download blobs still consume memory: native streaming is not a promise of unlimited-size files.

## Explorer handoff

`electron/desktop-integration.js` creates a Windows SendTo shortcut for the packaged executable with `--process-files`. No extension associations are registered. Explicit selections are queued in the main process; `/api/inbox-files` returns names and opaque tokens and `/api/inbox-file` consumes a token once. Tokens expire after 15 minutes. The renderer cannot submit arbitrary filesystem paths. `/api/desktop-integration` exposes the shortcut setting; opt-out survives restarts. The NSIS uninstall hook removes the shortcut.
