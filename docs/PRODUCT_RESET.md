# Junk Drawer product reset — 2026-10-22

## Product contract

A local drawer of useful file tools. People bring files, choose a concrete job, and save a copy. The interface uses explicit controls, familiar terms, visible output choices, and progressive detail. It has no chat, prompt box, persona setup, creative-suite shell, or file-viewer takeover.

## Ordered implementation and release process

1. Define the core jobs and their success criteria before choosing a visual style: convert, compress, extract, tidy metadata, manipulate PDFs, and inspect unknown files. A job succeeds only when its output opens or its limitation is clear.
2. Inventory the actual UI registrations, native routes, build configuration, libraries, and tests. Separate implemented behavior from plans and placeholders. Record dependencies and evidence for each family.
3. Make explicit keep/merge/remove decisions. Remove obsolete navigation, engine integrations, downloads, and OS associations along with their tiles. Preserve user files and existing models during migration.
4. Stabilize shared execution contracts: runtime capabilities, input/output routing, progress, cancellation, per-file outcomes, and cleanup. Add real media fixtures before widening format claims.
5. Design the main journeys: drop files → choose action/output → run → save; search by action or extension; browse the entire catalog without guessing a menu. Keep advanced details out of the primary path.
6. Implement the new shell on the retained engines. Test representative real operations through the browser, not just registered names or screenshots.
7. Audit again after the cuts. Look for hidden tools, dead links, unsupported presets, swallowed batch errors, duplicate-name collisions, and file limits that contradict the native architecture.
8. Test OS handoff and shortcut lifecycle, then package and smoke-test the actual Windows artifact; verify its CSS, media contract, native engines, and absence of retired resources. Review the diff and push the source changes. Public installer publication is a separate release step.
9. Before broad release, run the Mac package and a real-world fixture pack, observe a handful of people completing common jobs without coaching, fix failures, then publish installers. Repeat on future engine upgrades.

## First audit: findings and decisions

- The previous product plan called this a creative suite. The Video Studio UI included empty transition/effect/project concepts and redirected basic operations into separate tools. Removed the studio, routing, workspace menus, adapter plan, and planned OpenCut provider.
- The home catalog existed but its `.home-index` was hidden. This made a large tool set hard to discover. Six common task entry points are visible; the specialized catalog is explicitly labelled More tools.
- Generic PDF/Markdown/text viewing was coupled to OS file associations. Removed registration, event queuing, viewer code, and the opened-file API route. PDF signing/rendering remains purpose-specific functionality.
- A blanket 500 MB renderer check rejected native jobs before disk streaming. Removed it from native execution; retained a browser fallback guard. Output blobs still consume browser memory.
- Format choices and file recognition were inconsistent. MTS was absent; image outputs could advertise unavailable encoders. Added shared media contracts and runtime output capability discovery.
- Unknown-file inspection knew only a few signatures. Added media stream inspection, SQLite/SILK identification, and explicit unsupported-data guidance. No universal .dat or Skype recovery claim.
- Removed generation/creative extras: voiceovers, song separation, BPM detection, AI provenance checker, upscaling, Caption Studio, and binary/Morse/number-base toys. OCR, background removal, and transcription stay because they finish concrete file jobs; they are not the interaction model.
- Consolidated duplicate conversion entry points into image/video/audio conversion. GIF→video now uses Convert Video; HEIC→JPG uses Change Image Type.

### Complete registered-tool disposition

Baseline: 67 registered tools. Current: 44 registered tools (1.7.1). This is a source inventory, not a claim that every operation has been manually verified on every OS.

| Previous tool | Decision | Family |
| --- | --- | --- |
| Remove Background | Keep | image |
| Change Image Type | Keep / rebuild | image |
| Batch Convert Images | Keep | image |
| Shrink File Size | Keep | image |
| Resize Image | Keep | image |
| Rotate or Flip | Keep | image |
| Remove Hidden Info | Keep | image |
| Strip Location Only | Keep | image |
| Fix Photo Dates | Keep | image |
| Rename Photos by Date Taken | Keep | image |
| Picture to SVG | Remove in 1.7.1 | image |
| Camera RAW to JPG | Keep | image |
| Upscale an Image (4×) | Remove | image |
| Grab Text from a Picture | Keep | image |
| AI Image Checker | Remove | image |
| Open Any Archive | Merge into Extract an Archive | arc |
| See Hidden Info | Keep | image |
| Add a Background | Remove in 1.7.1 | image |
| Make App Icons | Remove in 1.7.1 | image |
| Image to PDF | Keep | image |
| Video to GIF | Keep | video |
| Shrink a Video | Keep | video |
| Save the Audio as MP3 | Keep | video |
| Make It an MP4 | Merge into Convert Video | video |
| Trim a Video | Keep | video |
| Fix Phone Video for Editing | Remove in 1.7.1 | video |
| Burn In Subtitles | Keep | video |
| Mute a Video | Keep | video |
| Save a Photo from a Video | Remove in 1.7.1 | video |
| Convert Audio | Keep / rebuild | audio |
| Even Out Volume | Remove in 1.7.1 | audio |
| Split a Song into Vocals & Instrumental | Remove | audio |
| Find the BPM | Remove | audio |
| Make a Voiceover | Remove | audio |
| Transcribe to Text or Subtitles | Keep | audio |
| Caption Studio | Remove | video |
| Podcast Loudness Fix | Remove in 1.7.1 | audio |
| Cut Out Silence | Remove in 1.7.1 | audio |
| Trim Audio | Keep | audio |
| Shrink Audio File | Keep | audio |
| Sign & Fill PDF | Keep | pdf |
| Shrink a PDF | Keep | pdf |
| PDF to Pictures | Keep | pdf |
| Split into Single Pages | Keep | pdf |
| Turn Pages | Keep | pdf |
| Add Page Numbers | Keep | pdf |
| Add a Watermark | Keep | pdf |
| Delete Pages | Keep | pdf |
| Combine PDFs | Keep | pdf |
| CSV to JSON | Keep | data |
| JSON to CSV | Keep | data |
| Tidy Up JSON | Remove in 1.7.1 | dev |
| Switch Between JSON and YAML | Remove in 1.7.1 | dev |
| Scramble Text to Base64 | Remove | dev |
| Make Text Safe for a Web Link | Remove | dev |
| Make a Text Fingerprint | Remove | dev |
| Read a Computer Timestamp | Remove | dev |
| Make a QR Code | Keep | dev |
| Read a QR Code | Keep | dev |
| Number Base Converter | Remove | dev |
| Text ↔ Binary | Remove | dev |
| Morse Code | Remove | dev |
| Look Inside a File | Keep / rebuild | weird |
| GIF to Video | Merge into Convert Video | weird |
| iPhone Photo to JPG | Merge into Change Image Type | weird |
| YouTube to Video | Keep | web |
| YouTube to MP3 | Keep | web |

New or newly named entries: Create a ZIP, Extract an Archive, Convert Video, Convert Unknown Media. Batch conversion now uses the standard conversion panel; its duplicate catalog entry was removed in 1.7.1.

## Integration and scope refinement

The app should be reachable where the user already has a file. The Windows desktop build creates Send to → Junk Drawer on first run, remembers an explicit opt-out, and removes the shortcut on uninstall. The command-line handoff accepts only the explicit --process-files intent, keeps selected paths in the Electron main process, and gives the renderer expiring single-use tokens. Existing default viewers are unaffected.

The six primary entry points are Convert files, Make files smaller, PDF tools, Image tools, Archives, and Identify a file. Specialist jobs are secondary; developer encodings/hashes/timestamps were removed after this scope review. There are still specialized operations inside each family; this is six task entry points, not a claim of only six operations.

## Second audit: corrections made

- Added Create a ZIP: the README promised ZIP creation but the old registry only exposed extraction.
- Generated ZIPs now disambiguate duplicate entry names instead of silently losing a file.
- Batch conversion reports each failure and keeps successful save links; technical logs are collapsed behind details.
- Every matching file action is reachable after dropping a file; primary conversion appears first.
- Common image conversion now uses the native decoder for legacy image families, rather than relying on Chromium for formats it cannot display.
- Native probing accepts a sanitized extension hint because header-poor formats such as TGA cannot always be identified from a generic .bin name. Recognition still requires actual decoded stream information.
- Fixed CSV output header escaping for field names containing commas or quotes.
- Tool tiles are actual keyboard-focusable buttons, dropdown expansion is exposed, and the compact layout has no horizontal overflow at the desktop minimum width.
- Removed retired engine downloads and execution routes. Packaging excludes already-downloaded retired engines without deleting anything from the user's disk. Existing voice/stem models remain removable in storage.

## Conversion scope and evidence

The shared contract has 28 output presets: six video, twelve audio, ten image. This Windows FFmpeg exposes 26; WebM and AVIF are hidden here because their required encoders are absent. Input lists identify candidate families; decoder, encryption, damage, and variant compatibility are checked at execution time.

Native integration tests generate AVCHD-like MPEG-TS/MTS and 192-byte M2TS fixtures, convert each to MP4, and test readable MPEG media with a .dat extension. Every advertised output is encoded, probed, then converted back to a common format. Separate checks cover corrupt bytes, SQLite, SILK, missing/unsupported capabilities, and cross-origin rejection.

Browser smoke tests exercise: visible catalog, MTS search and conversion/save, mixed-success batch retention, 13 image/PDF operations, five text/data/QR operations, dark mode, minimum-width layout, and runtime exceptions. Image compression's already-small guard is tested with the small fixture; this does not establish output quality on large photographs.

Existing tests continue covering two-pass compression contracts, native missing-engine errors, local request restrictions, update failures, and integration declarations.

Validation also covers command-line intent parsing, file-token expiry and single use, shortcut creation/removal and opt-out persistence, renderer handoff, and cross-origin rejection. The shell-menu behavior itself needs a real Explorer interaction on an installed build.

## Remaining release gates and intentional limits

- Real old Skype recordings/databases: need representative files and a validated dedicated SILK or database export adapter. Current behavior identifies/rejects them honestly. A media converter cannot infer arbitrary proprietary data.
- macOS: requires a Mac build and equivalent codec/fixture runs. Windows test success is not evidence for macOS binaries.
- Field coverage: HEIC variants, camera RAW variants, HDR/interlacing/multichannel audio, large multi-GB inputs, metadata preservation, and damaged archives need a curated fixture library. No all-formats guarantee.
- Optional/network tools: OCR/background-removal quality, transcription accuracy/model download, real link downloads, device/card import, signature placement/export and accessibility with assistive technology need dedicated acceptance passes before a broad installer release. The source contract tests do not prove their quality.
- Large jobs still use temporary disk and browser blobs. A later native save-to-disk job service should eliminate the final in-memory blob and support resumable queues. Current cancellation does not make browser-canvas work interruptible.
- Pixel-level imitation of the supplied X post was not attempted: its contents could not be retrieved (403). The design follows the local utility's jobs and existing platform conventions.
