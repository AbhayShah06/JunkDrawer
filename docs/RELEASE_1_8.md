# Junk Drawer 1.8.0

- Video compression now offers compatible H.264 MP4, HEVC, and AV1. CPU encoding is the default; optional hardware encoding is tested at runtime and falls back to CPU.
- File-size limits use two-pass H.264 encoding, verify the finished size, and retry if necessary. Outputs larger than the original are rejected.
- HEVC and AV1 keep 10-bit output and standard PQ/HLG color signaling; dynamic HDR metadata is not preserved. HDR input is rejected for the compatible H.264 mode rather than silently losing color information.
- Optional local model downloads add PaddleOCR v6 (32 MB), BiRefNet Lite 512 (192 MB), and Qwen3-ASR 0.6B with speech detection (843 MB). Included tools and Whisper subtitles remain available.
- Optional downloads use pinned revisions and SHA-256 checks. Models can be removed from Manage storage. Images and recordings are processed locally.
- Native media and transcription jobs run one at a time. CPU image workers exit after their job. No required GPU or Python installation.
- Fixed a version mismatch between the included background-removal library and model data.
- Tooltips and other descriptions now use direct instructions. The old slogans are removed.

Windows x64 release. Qwen3 currently outputs text; use Whisper for timed subtitles. HEVC/AV1 playback depends on the receiving application. Model quality improvements vary by input; the optional models are not automatically substituted for the included tools.
