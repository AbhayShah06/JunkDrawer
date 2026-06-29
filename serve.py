#!/usr/bin/env python3
"""Local server for Junk Drawer.

Two jobs:
  1. Serve the static app with cross-origin-isolation headers so the
     multi-threaded ffmpeg.wasm build works (everything else is client-side).
  2. A tiny backend for the link-download tools, which shell out to yt-dlp /
     spotdl on this machine. These run locally; nothing routes through a
     third-party server. yt-dlp, spotdl, and ffmpeg must be installed for
     those tools to work.
"""
import http.server
import socketserver
import webbrowser
import subprocess
import tempfile
import shutil
import json
import os
import re
import sys
import urllib.parse

PORT = int(os.environ.get("PORT", "8777"))
DIRECTORY = os.path.dirname(os.path.abspath(__file__))
ALLOWED_ORIGINS = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}


BIN = os.path.join(DIRECTORY, "resources", "bin")  # bundled yt-dlp / ffmpeg, if present

def find(cmd):
    # bins live in a per-OS subfolder (resources/bin/mac | win); fall back to the legacy
    # flat layout, then PATH. On Windows the bundled binaries carry a .exe suffix.
    sub = "win" if os.name == "nt" else "mac"
    names = [cmd + ".exe", cmd] if os.name == "nt" else [cmd]
    for d in (os.path.join(BIN, sub), BIN):
        for n in names:
            p = os.path.join(d, n)
            if os.path.exists(p):
                return p
    return shutil.which(cmd)

def have(cmd):
    return find(cmd) is not None


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "credentialless")
        self.send_header("Cache-Control", "no-store")
        # No remote code: script-src has no http(s) origin, so only our own bundled,
        # inline, wasm and blob scripts run. Everything is vendored locally.
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:; "
            "worker-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob: https:; font-src 'self' data:; "
            "connect-src 'self' https: data: blob:; media-src 'self' blob: data:")
        super().end_headers()

    def log_message(self, *args):
        pass

    # ---- helpers ----
    def _json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _same_origin(self):
        # DNS-rebinding defense: the Host must be a loopback name (missing Host is hostile too).
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost"):
            return False
        # CSRF defense: this is a state-changing POST, so our renderer always sends an Origin
        # (a JSON fetch is not CORS-simple). Require it to be present AND one of ours — fail
        # closed on a missing Origin rather than trusting it.
        return self.headers.get("Origin") in ALLOWED_ORIGINS

    # ---- routes ----
    def do_GET(self):
        if self.path.split("?")[0] == "/api/check":
            return self._json({"ytdlp": have("yt-dlp"), "spotdl": have("spotdl"), "ffmpeg": have("ffmpeg")})
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/download":
            return self._json({"error": "unknown endpoint"}, 404)
        if not self._same_origin():
            return self._json({"error": "blocked cross-site request"}, 403)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
        except Exception:
            return self._json({"error": "bad request body"}, 400)

        url = (body.get("url") or "").strip()
        mode = body.get("mode", "video")
        if not re.match(r"^https?://", url):
            return self._json({"error": "Please paste a full https:// link."}, 400)

        ffmpeg_ok = have("ffmpeg")
        # Hardening for every yt-dlp call: --no-config ignores any yt-dlp.conf;
        # --restrict-filenames strips path separators/unicode from the remote-controlled
        # media title (no traversal); a trailing "--" stops option parsing so the URL can
        # never be read as a flag.
        ytdlp_base = ["yt-dlp", "--no-config", "--restrict-filenames", "--no-playlist", "-o", "%(title)s.%(ext)s"]
        if mode == "spotify":
            if not have("spotdl"):
                return self._json({"error": "spotdl-missing"}, 501)
            cmd = ["spotdl", "download", "--", url]
        elif mode == "audio":
            if not have("yt-dlp"):
                return self._json({"error": "ytdlp-missing"}, 501)
            # MP3 needs ffmpeg to transcode; without it yt-dlp would save the raw
            # webm/m4a stream, not an MP3. Fail clearly rather than mislabel.
            if not ffmpeg_ok:
                return self._json({"error": "ffmpeg-missing"}, 501)
            cmd = ytdlp_base + ["-x", "--audio-format", "mp3", "--", url]
        else:
            if not have("yt-dlp"):
                return self._json({"error": "ytdlp-missing"}, 501)
            if ffmpeg_ok:  # merge best video+audio into one HD mp4
                cmd = ytdlp_base + ["-f", "bestvideo*+bestaudio/best", "--merge-output-format", "mp4", "--", url]
            else:  # no ffmpeg: take a single already-muxed file (one clean mp4, lower res)
                cmd = ytdlp_base + ["-f", "best[ext=mp4]/best", "--", url]

        tmp = tempfile.mkdtemp(prefix="jd-")
        try:
            try:
                env = dict(os.environ)
                # let yt-dlp find the bundled ffmpeg (now under the per-OS subfolder) so MP3 works
                bin_os = os.path.join(BIN, "win" if os.name == "nt" else "mac")
                env["PATH"] = bin_os + os.pathsep + BIN + os.pathsep + env.get("PATH", "")
                proc = subprocess.run(cmd, cwd=tmp, capture_output=True, text=True, timeout=900, env=env)
            except subprocess.TimeoutExpired:
                return self._json({"error": "tool-failed", "detail": "Timed out after 15 minutes."}, 500)
            if proc.returncode != 0:
                return self._json({"error": "tool-failed", "detail": (proc.stderr or proc.stdout)[-2500:]}, 500)

            files = [os.path.join(tmp, f) for f in os.listdir(tmp)]
            files = [f for f in files if os.path.isfile(f)]
            if not files:
                return self._json({"error": "no-output", "detail": "The tool finished but produced no file."}, 500)

            if len(files) > 1:  # e.g. a Spotify playlist -> zip them up
                import zipfile
                zpath = os.path.join(tmp, "_bundle.zip")
                with zipfile.ZipFile(zpath, "w", zipfile.ZIP_STORED) as z:
                    for f in files:
                        z.write(f, os.path.basename(f))
                out, out_name = zpath, "spotify-downloads.zip"
            else:
                out = files[0]
                out_name = os.path.basename(out)

            size = os.path.getsize(out)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", 'attachment; filename="%s"' % out_name.replace('"', ""))
            self.send_header("X-Filename", urllib.parse.quote(out_name))
            self.send_header("Access-Control-Expose-Headers", "X-Filename")
            self.end_headers()
            with open(out, "rb") as fh:
                shutil.copyfileobj(fh, self.wfile)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)


def main():
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
        url = f"http://127.0.0.1:{PORT}/index.html"
        print("\n  🗄️  Junk Drawer is running")
        print(f"  →  {url}")
        print(f"  link-downloads: yt-dlp {'✓' if have('yt-dlp') else '✗ (not installed)'}  "
              f"spotdl {'✓' if have('spotdl') else '✗'}  ffmpeg {'✓' if have('ffmpeg') else '✗'}")
        print("\n  Leave this window open. Close it (or press Ctrl+C) to stop.\n")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n  Stopped. Bye!\n")
            sys.exit(0)


if __name__ == "__main__":
    main()
