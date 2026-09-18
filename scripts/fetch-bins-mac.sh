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
# dcraw_emu exits non-zero when run with no input (it just prints usage), so under
# `set -o pipefail` a piped check aborts the build even though the binary is fine. Capture
# its output instead and confirm the usage banner (a dylib-load failure would not print it).
draw_out="$("$OUT/libraw/dcraw_emu" 2>&1 || true)"
case "$draw_out" in *dcraw*) printf '%s\n' "$draw_out" | head -2 ;; *) echo "dcraw_emu failed to run — check dylib paths (otool -L $OUT/libraw/dcraw_emu)"; exit 1 ;; esac

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

echo "==> whisper.cpp v1.9.4 (built from source as a universal binary — needs cmake)"
command -v cmake >/dev/null || { echo "cmake not found. brew install cmake, then re-run."; exit 1; }
git clone --depth 1 --branch v1.9.4 https://github.com/ggml-org/whisper.cpp "$TMP/whisper"
cmake -S "$TMP/whisper" -B "$TMP/whisper/build" -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_OSX_ARCHITECTURES="arm64;x86_64" -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF >/dev/null
cmake --build "$TMP/whisper/build" --config Release -j --target whisper-cli >/dev/null
mkdir -p "$OUT/whisper"
cp "$TMP/whisper/build/bin/whisper-cli" "$OUT/whisper/"
chmod +x "$OUT/whisper/whisper-cli"
lipo -info "$OUT/whisper/whisper-cli" || true

echo "==> ExifTool 13.59 (perl distribution — macOS ships perl, so this just runs)"
curl -sL -o "$TMP/exiftool.tgz" "https://master.dl.sourceforge.net/project/exiftool/Image-ExifTool-13.59.tar.gz?viasf=1"
mkdir -p "$TMP/et" && tar -xzf "$TMP/exiftool.tgz" -C "$TMP/et"
rm -rf "$OUT/exiftool" && mkdir -p "$OUT/exiftool"
SRC="$(find "$TMP/et" -maxdepth 1 -type d -name 'Image-ExifTool-*' | head -1)"
cp "$SRC/exiftool" "$OUT/exiftool/exiftool"
cp -R "$SRC/lib" "$OUT/exiftool/lib"
chmod +x "$OUT/exiftool/exiftool"
"$OUT/exiftool/exiftool" -ver

echo "==> sherpa-onnx v1.13.3 (universal2 — text-to-speech + stem separation)"
curl -sL -o "$TMP/sherpa.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.3/sherpa-onnx-v1.13.3-osx-universal2-shared.tar.bz2"
mkdir -p "$TMP/sherpa" && tar -xjf "$TMP/sherpa.tar.bz2" -C "$TMP/sherpa"
rm -rf "$OUT/sherpa" && mkdir -p "$OUT/sherpa"
SBIN="$(find "$TMP/sherpa" -name sherpa-onnx-offline-tts -type f | head -1)"
cp "$SBIN" "$(dirname "$SBIN")/sherpa-onnx-offline-source-separation" "$OUT/sherpa/"
# the shared build needs its dylibs beside the exes
find "$TMP/sherpa" \( -name "*.dylib" \) -exec cp {} "$OUT/sherpa/" \;
chmod +x "$OUT/sherpa/"sherpa-onnx-offline-*
xattr -dr com.apple.quarantine "$OUT/sherpa" 2>/dev/null || true

echo "==> VTracer 0.6.4 (universal via lipo from the two official arch builds)"
curl -sL -o "$TMP/vt-arm.tar.gz" "https://github.com/visioncortex/vtracer/releases/download/0.6.4/vtracer-aarch64-apple-darwin.tar.gz"
curl -sL -o "$TMP/vt-x64.tar.gz" "https://github.com/visioncortex/vtracer/releases/download/0.6.4/vtracer-x86_64-apple-darwin.tar.gz"
mkdir -p "$TMP/vt-arm" "$TMP/vt-x64"
tar -xzf "$TMP/vt-arm.tar.gz" -C "$TMP/vt-arm"; tar -xzf "$TMP/vt-x64.tar.gz" -C "$TMP/vt-x64"
rm -rf "$OUT/vtracer" && mkdir -p "$OUT/vtracer"
lipo -create "$(find "$TMP/vt-arm" -name vtracer -type f | head -1)" "$(find "$TMP/vt-x64" -name vtracer -type f | head -1)" -output "$OUT/vtracer/vtracer"
chmod +x "$OUT/vtracer/vtracer"
xattr -dr com.apple.quarantine "$OUT/vtracer" 2>/dev/null || true

echo
echo "Done. resources/bin/mac/ now has whisper/, libraw/, esrgan/, exiftool/, sherpa/, vtracer/ alongside ffmpeg + yt-dlp."
echo "Next: npm run dist:mac"
