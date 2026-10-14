# Junk Drawer 2: workspace-first product plan

## The corrected product idea

Junk Drawer is not primarily a catalog of 67 utilities. It is one local creative suite
with several familiar workspaces and a small set of quick actions. A person should be able
to think “I need the video editor” or “I need the PDF desk,” open that workspace, and then
discover the relevant actions in context.

The product has three layers:

1. **Workspaces** for jobs that feel like applications: Video Studio, Photo Desk, PDF Desk,
   Audio Desk, Download Desk, and Developer Bench.
2. **Quick actions** for one-step jobs: compress this, convert that, unlock this PDF, make
   captions, extract audio, and similar tasks.
3. **Engines** hidden behind the UI: FFmpeg, OpenCut, Whisper, PDF.js/pdf-lib, browser-native
   code, Real-ESRGAN, and future providers.

The user chooses a goal. Junk Drawer chooses the lightest dependable engine that can do it.

## Navigation model

### Persistent application bar

The Win95-style top bar gains a **Workspaces** menu next to **Tools**. The menu opens on
click and supports hover descriptions without requiring hover to operate.

The first level is intentionally short:

- **Video Studio** — edit, caption, resize, and export video.
- **Photo Desk** — crop, convert, retouch, remove backgrounds, and prepare assets.
- **PDF Desk** — read, sign, combine, split, shrink, unlock, and redact documents.
- **Audio Desk** — trim, normalize, convert, separate, transcribe, and make voiceovers.
- **Download Desk** — save permitted media from supported links.
- **Developer Bench** — JSON, CSV, YAML, QR, hashing, and developer file utilities.

Workspace rows show a short task description. They do not expose CPU, RAM, or engine-tier
labels during ordinary navigation. No gradients, glass, giant rounded cards, sparkle icons,
fake chat panels, or “AI-powered” visual language.

### Home screen

The home screen leads with six workspace launchers, not 67 tools. Under them are:

- **Quick actions**: six frequently used one-step jobs.
- **Recent work**: Studio projects and recently used tools, stored locally.
- **Open a file**: drop/pick a file; Junk Drawer recommends a workspace and two or three
  relevant quick actions.
- **All tools**: the existing drawer browser remains available as an exhaustive index.

### Workspace behavior

Every workspace has the same frame:

- top-left **Back to Junk Drawer**;
- workspace title and a one-line description;
- a left navigation rail for that medium;
- a main work surface;
- a contextual right panel only when it is useful;
- a bottom status line showing the active engine and long-job progress.

Workspaces must feel related but not identical. Video gets a timeline; PDF gets page
thumbnails; Photo gets a canvas; Audio gets a waveform/queue. Reusing the same generic
card dashboard everywhere would make the suite look generated rather than designed.

## Naming and inspiration boundaries

Use familiar comparisons in explanatory copy, not as product names or copied branding:

- “Video Studio — a local editor in the CapCut/OpenCut category.”
- “Photo Desk — the common photo-prep jobs people reach for Adobe tools to do.”
- “PDF Desk — the common document jobs people associate with Acrobat.”

The interface may copy established interaction patterns—timeline, layers, crop handles,
page thumbnails, inspector panels—but not proprietary icons, templates, assets, names, or
pixel-for-pixel layouts.

## Video routing: quick tool versus Studio

The following rule is more important than the provider brand:

| User goal | Default route | Why |
| --- | --- | --- |
| Compress one video | Native FFmpeg quick action | Lowest memory and startup cost; best control of codecs |
| Convert, trim, mute, extract audio | Native FFmpeg quick action | No timeline/project is needed |
| Auto-caption one finished video | Whisper + FFmpeg quick action | Keeps the small job direct |
| Fix variable frame rate | Native FFmpeg quick action | Deterministic technical repair |
| Arrange clips, overlays, music, text | Video Studio | Requires persistent timeline state |
| Re-edit later | Video Studio | Requires a saved project and source relinking |
| Transitions, masks, keyframes | Video Studio | Requires preview/compositor state |
| Batch/headless render | OpenCut headless when stable; FFmpeg fallback | Project-aware render if available |

Opening a video presents three prominent choices, not a modal full of every tool:

1. **Edit in Video Studio**
2. **Make it smaller**
3. **More quick actions**

## Provider decision: OpenCut Classic, OpenCut Next, or our own code

### Current decision

Do not embed OpenCut Classic as Junk Drawer's permanent editor. It is the current usable
reference, but depending on its private application state would make upgrades and recovery
fragile.

Do not pretend OpenCut Next is currently a finished embeddable editor. Its promised Editor
API/Rust core/plugin/headless design is the correct long-term boundary, but the official
desktop README still describes the desktop app as very early.

Therefore:

1. Build Junk Drawer’s workspace shell and project UX against `VideoEditorAdapter`.
2. Keep simple quick actions on FFmpeg regardless of OpenCut availability.
3. Use a deterministic local adapter for early Studio UX and project persistence.
4. Integrate OpenCut Next only at a tagged/versioned API boundary with schema migrations.
5. Keep FFmpeg export as a safe fallback even after OpenCut integration.

### Adapter contract

`VideoEditorAdapter` owns:

- capability discovery;
- create/open/save/migrate project;
- import/relink/remove media;
- timeline mutations and selection;
- undo/redo transactions;
- preview lifecycle and proxy state;
- render jobs, progress, cancel, and cleanup;
- structured errors and technical details;
- disposal of workers, GPU resources, object URLs, temp files, and child processes.

The UI never imports OpenCut internals directly.

## Resource-aware behavior on Mac and Windows

### System profile

The local backend exposes a privacy-safe system profile:

- platform and CPU architecture;
- logical CPU count;
- total and currently free memory;
- native engine availability;
- whether the packaged FFmpeg exposes relevant software/hardware encoders;
- optional model readiness;
- recommended operating tier and reason.

No serial numbers, usernames, file paths, IP addresses, or hardware identifiers are
returned or stored.

### Operating tiers

16 GB RAM is the supported design baseline. Tiering accounts for OS-reported bytes and
rounded advertised GB: a marketed 16 GB machine may report about 14.9 GiB, and a marketed
24 GB machine about 22.4 GiB. These tiers describe compatibility and current resource
pressure; they never lower export quality, resolution, or frame rate:

| Tier | Suggested machine | Default behavior |
| --- | --- | --- |
| Compatibility | Below the marketed 16 GB baseline | Keep all file tools and export settings available; use resource-aware fallbacks only for demanding work |
| Standard | Marketed 16–23 GB RAM with adequate free memory | Normal previews, models, and export settings; serialize only competing heavy jobs |
| Full | Marketed 24 GB+ RAM with adequate free memory | More room for demanding local workflows and parallel preparation |
| Limited | Any machine with under 1.5 GB currently free | Report current pressure; defer or serialize demanding work until memory recovers |

The tier never disables a user’s files, hides export, reduces resolution/frame rate, or
selects a lower quality. Proxies and job serialization are reserved for genuinely heavy
workloads (such as 4K multitrack projects, stabilization/upscaling, large local models, or
parallel analysis) or measured low-free-memory pressure. The status line explains the
current recommendation only when the user enters such a demanding operation. There is no
profile banner or hardware exposition on the home screen. The application may cache the
local profile for these future warnings, but ordinary work does not surface it.

### Mac-specific rules

- Intel and Apple Silicon packages must select matching native binaries.
- Prefer native FFmpeg over ffmpeg.wasm for large media.
- Probe VideoToolbox availability but do not automatically sacrifice export quality for
  hardware speed. Hardware encoding is a named **Fast** choice, not the quality default.
- Use proxies for demanding 4K/HEVC multitrack preview when the workload or current free
  memory requires them, while exporting from the original source.
- Limit model concurrency when actual unified-memory pressure requires it.
- Do not require the OpenCut Metal desktop renderer merely to run quick actions.
- If a provider crashes or exceeds its memory allowance, preserve the project, unload the
  provider, and offer software/proxy fallback.

## Compression redesign

### What is wrong now

The old “Shrink a Video” path:

- forces every input to at most 720p;
- forces at most 30 fps;
- calculates one average bitrate from target size;
- applies that constrained bitrate in a single encode;
- always re-encodes audio;
- offers no honest explanation of the quality tradeoff.

That can visibly damage motion, text, screen recordings, 60 fps clips, and already-efficient
HEVC footage.

### New user choices

The tool starts with three understandable modes:

1. **Recommended quality** — default. H.264 CRF-based encode, preserves dimensions and
   frame rate, uses a quality-focused software preset, and reports the resulting size.
2. **Fit under a size** — exact-delivery mode. User supplies MB; native FFmpeg performs a
   two-pass video encode with a reserved audio/overhead budget. The browser fallback is
   explicitly one pass and may miss the target. Resolution/fps reduction is only an explicit
   user choice; it is never silently applied.
3. **Fast smaller copy** — optional speed mode. May use a platform hardware encoder when
   probed and available; UI explicitly says it can produce a larger/lower-quality result
   than Recommended.

Advanced settings stay collapsed:

- compatibility: H.264 MP4 (default), HEVC MP4 where supported;
- quality: High / Recommended / Smaller;
- resolution: Keep original / 1080p / 720p;
- frame rate: Keep original / 60 / 30 / 24;
- audio: Keep where compatible / AAC 192 / AAC 128 / AAC 64 / remove;
- preserve metadata toggle, default off for privacy;
- web-fast-start toggle, default on.

### Encoding policy

For **Recommended quality**:

- H.264 `libx264`, `-crf 20` as the starting default;
- `-preset slow` on native FFmpeg; the quality preset is independent of the resource tier;
- `yuv420p` for broad compatibility;
- keep original dimensions and frame rate;
- AAC 160–192 kbps unless source audio can safely be copied;
- `+faststart` for MP4;
- refuse accidental upscaling;
- preserve rotation/orientation correctly.

For **Fit under a size**:

- validate duration and target before starting;
- reserve 3–5% container headroom rather than the old blanket assumptions;
- select audio bitrate based on content/available budget;
- derive the video bitrate from the remainder;
- perform two-pass x264 in the same isolated temp directory;
- clean pass logs and partial output on cancel/error;
- warn before encoding if the target implies an unacceptable bitrate;
- suggest 1080p, then 720p, then 540p only when needed;
- show estimated quality before the user commits.

### Compression result

The result screen compares:

- original and output file size;
- percentage saved;
- original/output resolution and frame rate;
- codec and quality mode;
- a short warning if the chosen hard limit required material quality loss;
- **Save**, **Try a different balance**, and **Open in Video Studio**.

## Initial implementation slice

The first executable slice should be valuable without claiming the whole editor exists:

1. Add the persistent **Workspaces** menu with hover/focus descriptions and keyboard access.
2. Replace the home hierarchy with workspace launchers, quick actions, recent work placeholder,
   file drop, and the existing all-tools drawer.
3. Implement a real **Video Studio landing workspace** that explains Quick versus Project
   workflows, exposes existing video tools in context, and leaves the timeline button clearly
   marked as the next phase rather than opening a fake editor.
4. Add `/api/system-profile` as a lazy internal guardrail. Keep ordinary hardware details
   hidden; surface a plain warning only when an actually demanding job meets real pressure.
5. Replace the current compressor UI/command with Recommended quality and Fit-under-size
   modes. Preserve resolution/fps by default.
6. Add structured compression validation/errors and tests for the generated FFmpeg arguments.
7. Retain the old exhaustive drawer browser and every existing feature.

## Later Studio phases

### Phase A: project foundation

- project picker, autosave journal, recent projects;
- source import/relink, metadata, thumbnails, waveform, proxies;
- deterministic fake adapter and golden project fixtures;
- one visual track plus audio/text/caption tracks;
- select, move, trim, split, delete, duplicate, mute, volume, and export.

### Phase B: creator baseline

- multi-track overlays;
- canvas presets, crop/scale/position/rotation/opacity;
- text and caption styling;
- transitions, speed, freeze, reverse;
- local Whisper captions and transcript editing;
- undo/redo coverage for every mutation.

### Phase C: OpenCut Next integration

- versioned Editor API adapter;
- schema negotiation and migration fixtures;
- headless render integration;
- plugin capability prompts;
- FFmpeg fallback and project-preserving provider failure recovery.

### Phase D: advanced local providers

- background removal, tracking, stabilization, denoise, separation, upscaling;
- model manager with memory estimates and smaller-model fallback;
- templates as ordinary replaceable-media projects;
- transcript editing and reviewable automation.

## Test and release gates

### Navigation

- mouse, keyboard, and touch-equivalent access to every workspace;
- hover descriptions never contain an action that keyboard users cannot reach;
- back/reset leaves no hidden worker, object URL, poller, or process;
- all 67 existing actions remain discoverable through All tools/search.

### Resource routing

- deterministic tests for 8/16/24+ GB profiles and low-current-memory conditions;
- missing FFmpeg/OpenCut/model paths choose a safe fallback;
- user override persists locally and can be reset;
- the profile endpoint never leaks identifying information.

### Compression

- 4K60, 1080p, portrait, VFR phone, screen recording, silent, multichannel, tiny,
  already-compressed, corrupt, zero-byte, and unsupported-codec fixtures;
- Recommended never changes resolution/fps without an explicit choice;
- fit-to-size stays within tolerance or clearly reports why it cannot;
- cancellation removes pass logs and partial output;
- duration/bitrate calculations reject NaN, zero, overflow, and absurd targets;
- compare objective metrics (VMAF/SSIM where available) and manual visual samples against
  the old output before shipping.

### Packaged builds

- Windows packaged smoke test;
- Intel Mac and Apple Silicon DMG smoke tests;
- memory-pressure test while a local transcription model is loaded;
- update preserves models, projects, recent history, provider settings, and unfinished work.

## Definition of honest completion

- The workspace launcher is complete when it changes how users enter and understand the
  product, not merely when six decorative cards exist.
- Compression is complete when quality is demonstrably better on representative footage
  and hard-size mode is accurate, cancellable, and recoverable.
- Video Studio is not called complete until import → timeline edit → autosave → reopen →
  export passes in packaged Windows and Mac builds.
- OpenCut integration is not called complete until Junk Drawer runs against a versioned
  public Editor API and survives provider unavailability without losing the project.
