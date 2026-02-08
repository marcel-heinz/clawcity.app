#!/bin/bash
set -e

echo "[startup] Starting OpenClaw Gateway + Provisioning Server"

# Start the provisioning server in background
echo "[startup] Starting provisioning server on :18800..."
node /home/node/provision-server/dist/index.js &
PROVISION_PID=$!

# Give provisioning server a moment to boot
sleep 2

# Start OpenClaw gateway (foreground)
echo "[startup] Starting OpenClaw gateway on :18789..."
openclaw gateway \
  --bind lan \
  --port 18789 \
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
