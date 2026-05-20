#!/bin/bash
set -e

# Clean up any stale X locks from previous runs
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true

echo "[start.sh] Launching virtual display..."
# Do NOT use +extension GLX — it crashes Xvfb inside Docker (no GPU)
Xvfb :99 -screen 0 1280x900x24 -ac -noreset &
XVFB_PID=$!
export DISPLAY=:99

# Wait for Xvfb socket to appear (reliable check, no xdpyinfo needed)
echo "[start.sh] Waiting for Xvfb socket..."
for i in $(seq 1 20); do
  if [ -S /tmp/.X11-unix/X99 ]; then
    echo "[start.sh] Xvfb ready after ${i}s (pid=$XVFB_PID)"
    break
  fi
  sleep 1
done

if [ ! -S /tmp/.X11-unix/X99 ]; then
  echo "[start.sh] ERROR: Xvfb did not start in time"
  exit 1
fi

echo "[start.sh] Starting x11vnc..."
# -noxdamage: X DAMAGE often breaks VNC refresh with Chromium on Xvfb (screen stays black)
x11vnc -display :99 -nopw -listen 0.0.0.0 -rfbport 5900 -forever -shared -noxdamage -bg -o /tmp/x11vnc.log
sleep 1

# Verify x11vnc is actually listening on 5900
if ! cat /proc/net/tcp 2>/dev/null | grep -q "170F"; then
  echo "[start.sh] WARNING: x11vnc may not be listening on 5900, check /tmp/x11vnc.log"
fi

echo "[start.sh] Starting noVNC websockify on port 6080..."
NOVNC_DIR=""
for d in /usr/share/novnc /usr/share/noVNC /opt/novnc; do
  if [ -d "$d" ]; then
    NOVNC_DIR="$d"
    break
  fi
done

if [ -z "$NOVNC_DIR" ]; then
  echo "[start.sh] ERROR: noVNC web dir not found"
  exit 1
fi

python -m websockify --web="$NOVNC_DIR" 6080 localhost:5900 &
echo "[start.sh] noVNC available at http://localhost:6080/vnc.html"
sleep 1

echo "[start.sh] Starting FastAPI (--reload mode, watches /app for changes)..."
exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app
