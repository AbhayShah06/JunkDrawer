# Junk Drawer 1.7 — file tools, within reach

A modern workspace and a smaller quick panel for everyday file tasks. The old Video Studio and general document viewer are removed. Basic video utilities—convert, compress, trim, mute, frames and audio extraction—remain.

- New vector drawer logo, app icon, light/dark shell, sidebar and persistent search.
- Tray quick panel with Ctrl+Alt+J on Windows and Command+Option+J on Mac. Explorer Send to selections go to the compact panel. The full workspace remains available.
- Closing a packaged app window keeps quick access available; Quit is in the tray menu. Starting with Windows is optional.
- Update checks run at startup, periodically and when returning to the app. A visible Check for updates control, error/retry states, download progress and explicit Restart & install replace the startup-only banner.
- Update downloads are deduplicated; a downloaded update stays ready across subsequent checks. No automatic installation on quit.
- MTS/M2TS conversion, capability-based formats and individual batch results from the product reset are included.

The previous public Windows release was 1.5.1. The 1.6 reset was source-only; it was not delivered to installed copies. This release supplies the Windows installer, blockmap and matching latest.yml metadata needed by those copies.

Validation: 76 automated tests, browser checks of the core tools, real MTS conversion and mixed-failure batches, visible update-banner states, compact-panel layout, and packaged Windows smoke tests. The release assets are checked against the SHA-512 in latest.yml before publication.

Windows x64 installer only in this release. macOS source is retained, but no Mac binary was built or tested here. Proprietary Skype/SILK recordings and databases still require dedicated decoders/exporters. The wheel shown by Turnstone is a reference interaction, not a copied interface or bundled dependency.
