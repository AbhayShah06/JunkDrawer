# Junk Drawer integration architecture

Junk Drawer is a local workbench, not a collection of copied applications. Each UI
workflow asks for a capability, while a provider adapter owns the external engine.
This keeps the simple drop-file experience even as the underlying open-source tools
change.

## OpenCut Next

OpenCut's current repository is a ground-up rewrite that promises a public Editor API,
plugin-first architecture, a shared Rust core, headless rendering, and desktop/browser
clients. Junk Drawer should integrate that public API after it is released and versioned.
It should not import private modules whose shape may change during the rewrite.

The user-facing editor is a dedicated Junk Drawer Studio workspace, not the normal
one-tool panel and not an embedded copy of OpenCut's UI. See `VIDEO_EDITOR_PLAN.md`.

The intended boundary supports:

- opening a local video or audio file in an embedded editor;
- returning an edited file to Junk Drawer's existing “Edit this” chain;
- saving and reopening an OpenCut project without uploading media;
- headless rendering for repeatable and batch workflows;
- progress, cancellation, low-disk, missing-codec, corrupt-project, and render-failure
  reporting through Junk Drawer's normal error UI.

Until the Editor API is stable, `opencut-next` remains visible to diagnostics as planned
and unavailable. This prevents a placeholder from pretending to work.

## Provider rules

Every provider declares capabilities and must check availability, input, output,
cancellation, and disk space. Providers add checks that matter to their domain, such as
model readiness, codec support, networking, encryption, or GPU support.

The first catalog includes OpenCut Next, FFmpeg, whisper.cpp, Real-ESRGAN, yt-dlp,
libarchive.js, and the PDF.js/pdf-lib pair. OpenCut is therefore one provider in the
video workflow rather than the architecture of Junk Drawer itself.

The catalog is exposed at `GET /api/integrations` and carries a contract version so a
future renderer or provider adapter can reject incompatible versions cleanly.
