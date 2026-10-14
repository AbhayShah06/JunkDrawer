# Junk Drawer Studio: product and integration plan

## Product decision

The video editor is a dedicated workspace inside the Junk Drawer desktop application.
It is not another card rendered in the normal one-tool panel and it does not reuse the
drawer-style layout while editing. Junk Drawer owns entry, file handoff, storage,
updates, privacy, and recovery; Studio owns the editing experience.

OpenCut Next is the preferred editing engine once its public Editor API is stable.
The Studio interface remains ours, so the engine can be upgraded or replaced without
redesigning the product.

## What “easy” means

1. Drop a video and immediately see it on a timeline.
2. Click a clip to see only the controls that apply to that clip.
3. Keep the six common actions permanently reachable: trim, split, delete, text,
   captions, and export.
4. Autosave continuously and show a plain “Saved” state rather than asking users to
   understand project files.
5. Let every generated or edited result flow back to Junk Drawer through “Use in
   another tool.”
6. Never require an account, upload private media, or hide a useful local feature behind
   a subscription.
7. Treat AI output as an editable suggestion grouped into one undo step.

## Entry and exit

Studio has four entry points:

- **Tools → Video Editor** starts an empty project.
- Dropping a video offers **Quick tool** or **Open in Studio**.
- Every video result exposes **Continue in Studio**.
- Recent Studio projects appear on a small project picker before the editor opens.

The top-left **Back to Junk Drawer** action saves first. Export offers **Save to
computer**, **Continue in Junk Drawer**, or both. Closing during a render asks whether
to cancel; ordinary edits never produce a save prompt because they are already saved.

## Workspace layout

The editor uses a conventional layout because familiarity is part of ease of use:

- **Top bar:** back, project name, saved state, undo/redo, canvas size, Export.
- **Left rail:** Media, Audio, Text, Captions, Transitions, Effects, Adjust.
- **Library panel:** searchable assets and controls for the selected rail item.
- **Preview:** large central canvas with play controls, guides, zoom, and fullscreen.
- **Inspector:** context-sensitive properties for the selected clip, text, caption,
  transition, or canvas. It stays hidden when nothing useful is selected.
- **Timeline:** video, overlay, text/caption, and audio tracks with a magnetic playhead,
  zoom, snapping, waveforms, thumbnails, and obvious clip handles.

The initial empty state contains one instruction: “Drop videos, photos, or audio here.”
After import, the app places the first visual clip on the main track automatically.

## Interaction rules

- Single click selects; double click opens the most relevant editor.
- Space plays/pauses. `S` splits. Delete removes. Ctrl/Cmd+Z and Shift+Ctrl/Cmd+Z
  undo/redo. Shortcuts are shown beside menu actions and are never required.
- Dragging a clip shows the exact insertion point. Nearby edges snap, with a visible
  guide; holding Alt temporarily disables snapping.
- Trimming never destroys source media. A restore handle remains available.
- Risky operations preview before applying. Long operations show progress and Cancel.
- Advanced controls live in expandable inspector sections, not a separate “pro mode.”
- Empty panels explain what to select or import instead of appearing broken.

## Feature roadmap

### Phase 0 — dependable editor

- Local import, thumbnails, metadata, waveform generation, and missing-media relink.
- One main video track plus overlay, text/caption, and audio tracks.
- Select, move, reorder, trim, split, ripple delete, duplicate, mute, and hide.
- Crop, rotate, flip, scale, position, opacity, volume, fade, and playback speed.
- Text overlays with fonts, alignment, outline, shadow, background, and simple motion.
- Local audio import, voiceover import, audio extraction, and loudness normalization.
- Undo/redo, crash recovery, autosave, project duplication, and recent projects.
- MP4 export with simple presets: Fast, Recommended, Small file, and Custom.

### Phase 1 — creator essentials

- Local Whisper captions with transcript editing, word/line timing, search/replace,
  caption templates, style-all, and burn-in or sidecar export.
- Transitions with duration preview; filters with adjustable intensity.
- Keyframes for position, scale, rotation, opacity, and volume.
- Speed curves, freeze frame, reverse, and frame extraction.
- Chroma key, masks, background removal, and image/video overlays.
- Stickers and reusable local assets without copying proprietary CapCut libraries.
- Noise reduction, silence removal, audio ducking, and beat markers.
- Portrait, square, landscape, and custom canvas presets.

### Phase 2 — fast production workflows

- Auto reframe with a tracked subject and manual correction.
- Scene detection and long-video-to-clips suggestions.
- Beat-synced cuts and a reviewable automatic first edit.
- Motion tracking for text, stickers, blur, and masks.
- Stabilization, color correction, LUT import, and reusable adjustment presets.
- Compound clips, grouped edits, copy/paste attributes, and proxy media.
- Templates that are ordinary local projects with replaceable media slots.
- Batch and headless export through the OpenCut runtime.

### Phase 3 — optional AI assistance

- “Remove the pauses,” “make three vertical clips,” and similar commands translate to
  visible Editor API operations, then wait for approval before applying.
- Transcript-based editing with text deletion mapped to timeline ripple deletes.
- Caption translation, title suggestions, highlight detection, and B-roll suggestions.
- Script-to-rough-cut from local media, with every choice shown in a review screen.
- Provider settings clearly distinguish local models from optional online models and
  disclose what would leave the computer before any upload.

## Engine boundary

Studio talks only to a `VideoEditorAdapter`. The adapter exposes project, media,
timeline, history, playback, selection, render, and event modules. It must support:

- contract and project-schema version negotiation;
- capability discovery rather than assumed features;
- cancellable jobs with progress events;
- one history entry for compound or AI operations;
- stable project import/export and migrations;
- structured error codes with a safe human-readable message;
- clean disposal so closing Studio cannot leave render/model processes running.

The OpenCut Next adapter maps this boundary to the public Editor API. Classic is useful
as a behavior reference and emergency prototype only; Studio must not depend on its
private React/Zustand internals.

## Other providers

OpenCut does not have to implement everything. Studio can call capability providers:

- FFmpeg for decode, encode, proxy generation, filters, and fallback rendering.
- whisper.cpp for private transcription and word timing.
- Real-ESRGAN for optional upscaling.
- Background-removal, source-separation, denoise, stabilization, and tracking engines
  selected independently behind the same provider contract.
- A local asset store for fonts, stickers, LUTs, sound effects, and user templates.

Providers may be replaced without changing the editor UI or project meaning.

## Error and recovery matrix

Every row below needs an automated fixture and a visible recovery path:

| Stage | Failures to exercise | Recovery shown to the user |
| --- | --- | --- |
| Import | unsupported codec, corrupt/truncated file, encrypted or zero-byte input | identify the file, suggest conversion when possible, keep the project open |
| Media | moved/deleted file, disconnected drive, duplicate media | relink, locate folder, or remove placeholder |
| Preview | decoder crash, unsupported effect, GPU unavailable | restart preview, disable the effect, or use software fallback |
| Model | missing/corrupt model, offline download, insufficient memory | retry, choose a smaller model, manage storage |
| Edit | invalid operation, stale selection, incompatible project version | reject without changing state and preserve undo history |
| Storage | low disk, denied path, autosave failure | choose a location, free space, retry; never claim “Saved” |
| Export | unsupported codec, encoder crash, destination locked, cancellation | retain project, partial-output cleanup, retry with Recommended preset |
| Lifecycle | app crash, forced reboot, update during a project | journaled autosave and one-click recovery on next launch |

Raw logs stay available behind **Copy technical details**, while the main message says
what happened, whether the project is safe, and what action fixes it.

## Test gates

A release cannot ship unless:

1. Every registered action has a declared input, capability, and error contract.
2. Golden project files from every previous schema version still open and migrate.
3. Fixture projects cover short/long, portrait/landscape, variable-frame-rate, silent,
   multichannel, missing-media, corrupt, unusual-codec, and caption-heavy inputs.
4. Undo/redo is verified for every mutation, including grouped AI actions.
5. Cancelling import, model download, analysis, and export leaves no orphan process or
   partial file.
6. A packaged Windows build passes import → edit → autosave → reopen → export.
7. An update preserves recent projects, local models, assets, and unfinished work.

## Build sequence

1. Keep the adapter and tests landing in Junk Drawer now.
2. Track OpenCut's versioned Editor API and project schema; do not bind to private code.
3. Build the Studio shell against a deterministic fake adapter so UX work can proceed.
4. Implement Phase 0 against OpenCut Next when the required modules are stable.
5. Add providers and Phase 1 features one workflow at a time, each with fixtures.
6. Add automation only after the manual operation it composes is dependable.

This sequence allows design to move quickly with AI assistance while keeping the media
engine, project format, and recovery behavior testable and durable.
