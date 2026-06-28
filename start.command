#!/bin/bash
# Double-click to launch Multitool. Picks whatever runtime this Mac has.
cd "$(dirname "$0")"
PORT="${PORT:-8777}"
URL="http://127.0.0.1:$PORT/index.html"

echo "Starting Multitool..."

open_browser() { ( sleep 1; open "$URL" ) & }

# Prefer system Ruby: it's built into every Mac and (unlike the /usr/bin/python3
# stub) never triggers a "install Command Line Tools" popup.
if command -v ruby >/dev/null 2>&1; then
  open_browser; PORT="$PORT" ruby serve.rb
elif command -v python3 >/dev/null 2>&1 && python3 -c "" >/dev/null 2>&1; then
  open_browser; PORT="$PORT" python3 serve.py
elif command -v python >/dev/null 2>&1; then
  open_browser; PORT="$PORT" python serve.py
else
  echo "Couldn't find python3 or ruby. Opening the file directly —"
  echo "most tools still work, video may be a bit slower."
  open "index.html"
  read -r -p "Press Enter to close..."
fi
