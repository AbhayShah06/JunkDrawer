#!/bin/bash
# Fetches/builds the macOS CLI engines the packaged app bundles, into resources/bin/mac/.
# Counterpart of fetch-bins-win.mjs. Run on the Mac build machine:  bash scripts/fetch-bins-mac.sh
#
# Layout produced (matching what electron/server.js expects):
#   resources/bin/mac/whisper/whisper-cli        — built from source (universal), needs cmake + Xcode CLT
#   resources/bin/mac/libraw/dcraw_emu (+ dylib) — official LibRaw macOS binaries (arm64+x86_64)
#   resources/bin/mac/esrgan/realesrgan-ncnn-vulkan + models/ — official release build
#
# ffmpeg + yt-dlp are assumed to already be in resources/bin/mac/ (they were fetched manually;
# see the note in fetch-bins-win.mjs).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="resources/bin/mac"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$OUT"

echo "==> LibRaw 0.22.1 (official macOS universal binaries)"
curl -sL -o "$TMP/libraw.zip" "https://www.libraw.org/data/LibRaw-0.22.1-macOS.zip"
unzip -q "$TMP/libraw.zip" -d "$TMP/libraw"
mkdir -p "$OUT/libraw"
# dcraw_emu + whatever dylibs sit beside it / in lib — copy both, the exe finds them via rpath
find "$TMP/libraw" -name dcraw_emu -type f -exec cp {} "$OUT/libraw/" \;
find "$TMP/libraw" -name "*.dylib" -type f -exec cp {} "$OUT/libraw/" \;
chmod +x "$OUT/libraw/dcraw_emu"
"$OUT/libraw/dcraw_emu" 2>&1 | head -2 || { echo "dcraw_emu failed to run — check dylib paths (otool -L $OUT/libraw/dcraw_emu)"; exit 1; }

echo "==> Real-ESRGAN ncnn-vulkan (official macOS build)"
curl -sL -o "$TMP/esrgan.zip" "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip"
unzip -q "$TMP/esrgan.zip" -d "$TMP/esrgan"
mkdir -p "$OUT/esrgan/models"
cp "$(find "$TMP/esrgan" -name realesrgan-ncnn-vulkan -type f | head -1)" "$OUT/esrgan/"
for m in realesrgan-x4plus realesrgan-x4plus-anime; do
  cp "$(find "$TMP/esrgan" -name "$m.bin"   | head -1)" "$OUT/esrgan/models/"
  cp "$(find "$TMP/esrgan" -name "$m.param" | head -1)" "$OUT/esrgan/models/"
done
chmod +x "$OUT/esrgan/realesrgan-ncnn-vulkan"
xattr -dr com.apple.quarantine "$OUT/esrgan" 2>/dev/null || true

echo "==> whisper.cpp v1.9.1 (built from source as a universal binary — needs cmake)"
command -v cmake >/dev/null || { echo "cmake not found. brew install cmake, then re-run."; exit 1; }
git clone --depth 1 --branch v1.9.1 https://github.com/ggml-org/whisper.cpp "$TMP/whisper"
cmake -S "$TMP/whisper" -B "$TMP/whisper/build" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF >/dev/null
cmake --build "$TMP/whisper/build" --config Release -j --target whisper-cli >/dev/null
mkdir -p "$OUT/whisper"
cp "$TMP/whisper/build/bin/whisper-cli" "$OUT/whisper/"
chmod +x "$OUT/whisper/whisper-cli"
lipo -info "$OUT/whisper/whisper-cli" || true

echo
echo "Done. resources/bin/mac/ now has whisper/, libraw/, esrgan/ alongside ffmpeg + yt-dlp."
echo "Next: npm run dist:mac"
