# Saved batches · 1.9.0

- Unit/native suite: 106 passing checks, including queue recovery, sleep/wake state, cancelled upload handling, GPU failure → CPU fallback, ordered chunk merging, a simulated two-hour/24-block schedule, and isolation of failed files.
- Real FFmpeg + Whisper base: speech split into short test blocks, interrupted during inference, resumed without rewriting completed checkpoints. Output subtitle timestamps checked across block boundaries.
- Real Vulkan inference: Intel Arc 140V, base and large-v3-turbo. Logs explicitly confirmed `using Vulkan0 backend`; GPU detection alone was not treated as an inference test.
- Real HTTP batch: valid WAV → MP3 plus invalid audio; successful output survives server restart, failed file stays retryable, cross-site mutation rejected.
- Browser regression: native MTS conversion, mixed conversion failures, retained file tools, narrow/dark layouts, subtitle generation/edit/save/burn-in and storage controls passed. The additional GPU-transcription browser run could not finish: Chrome automation became unavailable, the attempted harness adjustment was blocked by automatic approval review, and the supported in-app browser timed out. Native GPU transcription passed independently.
- Sleep/wake handlers are simulated in tests; physical lid closure was not performed. A restarted app asks the user to resume saved unfinished jobs. An interrupted conversion restarts that file; transcription reuses completed blocks. Uploads must finish before a file is recoverable.
- NPU acceleration is unavailable. Other GPU vendors, macOS Metal, and Windows ARM devices were not physically tested. Missing/incompatible GPU backends retain CPU operation. Existing subtitle burn-in generation keeps its CPU default.

Working audio copies and outputs stay in the app's local `batch-jobs` folder until the user removes each job. Private audio/transcripts, downloaded models and native binaries are excluded from source control.
