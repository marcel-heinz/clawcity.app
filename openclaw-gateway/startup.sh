#!/bin/bash
set -e

echo "[startup] Starting OpenClaw Gateway + Provisioning Server"

# Railway provides PORT env var — provisioning server binds to it for healthcheck
# Gateway runs on internal port only (proxied through provisioning server)
GATEWAY_PORT=18789
export OPENCLAW_GATEWAY_URL="http://127.0.0.1:${GATEWAY_PORT}"

# Start the provisioning server in background (uses PORT from Railway)
echo "[startup] Starting provisioning server on :${PORT:-18800}..."
node /home/node/provision-server/dist/index.js &
PROVISION_PID=$!

# Give provisioning server a moment to boot
sleep 2

# Start OpenClaw gateway (internal only)
echo "[startup] Starting OpenClaw gateway on :${GATEWAY_PORT}..."
openclaw gateway \
  --bind lan \
  --port ${GATEWAY_PORT} \
  --allow-unconfigured &
GATEWAY_PID=$!

echo "[startup] Both processes running (gateway=$GATEWAY_PID, provision=$PROVISION_PID)"

# Handle shutdown
cleanup() {
  echo "[startup] Shutting down..."
  kill $GATEWAY_PID $PROVISION_PID 2>/dev/null
  wait $GATEWAY_PID $PROVISION_PID 2>/dev/null
  echo "[startup] Clean exit"
}

trap cleanup SIGTERM SIGINT

# Wait for either process to exit
wait -n $GATEWAY_PID $PROVISION_PID
EXIT_CODE=$?
echo "[startup] Process exited with code $EXIT_CODE, shutting down..."
cleanup
exit $EXIT_CODE
