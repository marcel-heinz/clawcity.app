#!/bin/bash
set -e

echo "[startup] Starting OpenClaw Gateway + Provisioning Server"

# Ensure volume subdirectories exist (volume mount wipes Docker-build dirs)
mkdir -p /home/node/.openclaw/agents \
         /home/node/.openclaw/canvas \
         /home/node/.openclaw/cron \
         /home/node/.openclaw/workspace/skills

# Always sync config files from defaults into volume (ensures updates propagate)
echo "[startup] Syncing openclaw.json into volume"
cp /home/node/defaults/openclaw.json /home/node/.openclaw/openclaw.json
echo "[startup] Syncing clawcity.skill.ts into volume"
cp /home/node/defaults/clawcity.skill.ts /home/node/.openclaw/workspace/skills/clawcity.skill.ts

# Also update skill for all existing agents so they pick up changes on next reload
for agent_skill in /home/node/.openclaw/agents/*/workspace/skills/clawcity.skill.ts; do
  [ -f "$agent_skill" ] && cp /home/node/defaults/clawcity.skill.ts "$agent_skill"
done

# Fix Railway volume permissions (volume may mount as root-owned)
chown -R node:node /home/node/.openclaw 2>/dev/null || true

GATEWAY_PORT=18789
export OPENCLAW_GATEWAY_URL="http://127.0.0.1:${GATEWAY_PORT}"

# Start gateway with increased heap as node user (background, non-critical)
# Use --preserve-environment so Railway env vars (OPENROUTER_API_KEY etc.) are visible to gateway
echo "[startup] Starting OpenClaw gateway on :${GATEWAY_PORT}..."
su --preserve-environment -s /bin/bash node -c "export HOME=/home/node; NODE_OPTIONS='--max-old-space-size=4096' openclaw gateway --bind lan --port ${GATEWAY_PORT} --allow-unconfigured" &
GATEWAY_PID=$!

# Give gateway a moment to boot (or fail)
sleep 3

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

# Use Railway's PORT env var (auto-assigned for healthcheck routing)
# Falls back to PROVISION_PORT or 18800 if not set
LISTEN_PORT="${PORT:-${PROVISION_PORT:-18800}}"

# Start provisioning server as node user (foreground, main process for healthcheck)
echo "[startup] Starting provisioning server on :${LISTEN_PORT}..."
exec su --preserve-environment -s /bin/bash node -c "export HOME=/home/node; PORT=${LISTEN_PORT} exec node /home/node/provision-server/dist/index.js"
