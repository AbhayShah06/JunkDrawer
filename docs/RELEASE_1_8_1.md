Junk Drawer 1.8.1

- Burn In Subtitles now lets you use a subtitle file or generate subtitles locally from the video. Generated subtitles open for review and editing before encoding; you can also save the SRT separately.
- Subtitle generation uses Whisper base by default (148 MB), with Whisper small available (488 MB). Speech language is detected automatically. Both run on the CPU with four threads.
- Model downloads continue across tool changes. A workspace indicator shows progress, and Whisper transfers can be cancelled. Duplicate requests share one transfer. Failed/cancelled partial downloads are removed; unfinished files left after app exit are cleaned up on the next launch.
- Manage storage is one list, ordered from smallest to largest, with each model's purpose, download size, status, and controls. Retired models are hidden unless installed.
