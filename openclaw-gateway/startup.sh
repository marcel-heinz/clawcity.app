#!/bin/bash
set -e

echo "[startup] Starting OpenClaw Gateway + Provisioning Server"

# Railway provides PORT env var — provisioning server binds to it for healthcheck
# Gateway runs on internal port only (proxied through provisioning server)
GATEWAY_PORT=18789
export OPENCLAW_GATEWAY_URL="http://127.0.0.1:${GATEWAY_PORT}"

# Give the gateway more heap space (default V8 limit is too low for OpenClaw)
export NODE_OPTIONS="--max-old-space-size=4096"

# Start the OpenClaw gateway in background (non-critical — may fail if API keys missing)
echo "[startup] Starting OpenClaw gateway on :${GATEWAY_PORT}..."
openclaw gateway \
  --bind lan \
  --port ${GATEWAY_PORT} \
  --allow-unconfigured &
GATEWAY_PID=$!

# Give gateway a moment to boot (or fail)
sleep 2

# Check if gateway is still running
if kill -0 $GATEWAY_PID 2>/dev/null; then
  echo "[startup] OpenClaw gateway running (pid=$GATEWAY_PID)"
else
  echo "[startup] WARNING: OpenClaw gateway failed to start — provisioning server will still run"
  echo "[startup] Check that OPENROUTER_API_KEY and other env vars are set"
  GATEWAY_PID=""
fi

# Handle shutdown
cleanup() {
  echo "[startup] Shutting down..."
  [ -n "$GATEWAY_PID" ] && kill $GATEWAY_PID 2>/dev/null
  wait 2>/dev/null
  echo "[startup] Clean exit"
}

trap cleanup SIGTERM SIGINT

# Start provisioning server in foreground (this is the main process for Railway healthcheck)
echo "[startup] Starting provisioning server on :${PORT:-18800}..."
exec node /home/node/provision-server/dist/index.js
