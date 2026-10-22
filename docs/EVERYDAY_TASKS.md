# Everyday-task prioritization and reference review

## What the evidence can say

[Convert.Online's October 2026 report](https://convert.online/reports/file-conversions-2026) covers 319,681 requests on that service, not all file utility users or successful conversions. It reports 64.3% image inputs and highlights HEIC to JPG/JPEG, WebP to JPG/JPEG, and M4A to MP3. The sample also has unusually strong AMV demand, illustrating audience bias. We use the compatibility pattern rather than copying its rankings. Junk Drawer has no usage telemetry.

[Adobe's online tools](https://www.adobe.com/acrobat/online.html) prominently offer compression, merge, and image/PDF conversion. This corroborates task vocabulary, not a measured popularity ranking.

The product judgment: expose compression, image-to-JPG, PDF merge, video-to-MP4, audio-to-MP3, and image resizing first. Keep PDF split/sign, archives, metadata privacy, OCR, RAW conversion, and transcription available. Preserve unusual media input support without advertising it as the default output goal. MTS is primarily a supported input; Junk Drawer does not offer an MTS output preset.

## Lessons from the supplied projects

Reviewed the user-supplied text and public repository READMEs. These are product references, not validated claims about every advertised implementation.

- [Toolkit Tiles](https://github.com/WSTxda/Toolkit-Tiles): quick access through an existing system surface; tasks should be reachable without the full workspace. Applied: everyday action buttons in Junk Drawer's tray/keyboard panel. Android sensors, coin flips, breathing, and phone settings do not belong in a Windows file utility.
- [PDF Toolkit](https://github.com/yashdhanani/pdf-toolkit-app): clear organize/convert/sign tasks, page thumbnails, direct manipulation, undo, keyboard access. Applied now: PDF merge high in the task hierarchy and clearer separation from specialist tools. Next worthwhile PDF work: thumbnail-based reorder/extract with undo, and multi-image-to-PDF. Those require dedicated implementation and roundtrip tests, rather than adding empty buttons. Its README advertises Gemini OCR alongside a local-processing claim, so do not inherit a blanket privacy promise from it.
- [Toolkit for Android](https://github.com/Shriyans737/Toolkit-For-android): image size, compression, metadata removal, PDF merge/split and QR are useful overlapping jobs. Skip AI image generation, memes, an editor, and unrelated text gadgets. The public repository currently exposes a README and installation artifacts rather than an inspectable application source tree, so treat it as a product reference.

No source code or visual assets were copied from these projects.

## Pruning rule

A task earns a place if it solves sharing/upload compatibility, file size, document preparation, metadata privacy, or extracting useful content. Creator/editor and developer utilities that duplicate other apps lose their dedicated entries. Narrow media output formats remain available on request, because accepting legacy files is part of the utility's purpose.

1.7.1 removes 11 entries, taking the catalog from 55 to 44. The complete disposition is in PRODUCT_RESET.md. It removes vector tracing from the native endpoint and packaging too; other deleted tools used shared engines that retained tasks still need.

## Windows startup behavior

[Microsoft](https://support.microsoft.com/en-us/windows/configure-startup-applications-in-windows-115a420a-0bff-4a6f-90e0-1934c844e473) documents Startup apps in Settings and Task Manager. [Electron's login-item API](https://www.electronjs.org/docs/latest/api/app#appgetloginitemsettingsoptions-macos-windows) distinguishes registration from Windows approval. Register a disabled current-user Run item on first use, toggle its enabled state rather than removing it, and read the named launch item's effective state. Never re-enable an existing Windows-disabled entry on launch. There is no machine-wide task, service, or scheduled startup job.

In-app Settings refreshes on focus after a Windows Settings change. The tray menu refreshes when opened. Uninstall removes the Run and StartupApproved values; updates preserve user choice.
