#!/bin/bash
set -euo pipefail

echo "[startup] Starting OpenClaw Gateway + Provisioning Server"

# Normalize internal gateway auth for non-tech Railway setups.
# If no explicit gateway token is set, derive it from provision token or generate one.
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
  if [ -n "${PROVISION_AUTH_TOKEN:-}" ]; then
    export OPENCLAW_GATEWAY_TOKEN="${PROVISION_AUTH_TOKEN}"
    echo "[startup] OPENCLAW_GATEWAY_TOKEN not set; reusing PROVISION_AUTH_TOKEN for internal gateway auth"
  else
    export OPENCLAW_GATEWAY_TOKEN="$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")"
    echo "[startup] OPENCLAW_GATEWAY_TOKEN not set; generated ephemeral token for this runtime"
  fi
fi

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  echo "[startup] WARNING: OPENROUTER_API_KEY is not set; chat and auto-mode ticks will fail"
fi

# Update clawcity CLI to latest (ensures we always have the newest version
# regardless of Docker layer cache)
echo "[startup] Updating clawcity CLI..."
if npm install -g clawcity@latest >/tmp/clawcity-update.log 2>&1; then
  tail -n 1 /tmp/clawcity-update.log || true
else
  echo "[startup] WARNING: clawcity CLI update failed; continuing with bundled version"
  tail -n 3 /tmp/clawcity-update.log || true
fi
rm -f /tmp/clawcity-update.log

# Ensure volume subdirectories exist (volume mount wipes Docker-build dirs)
mkdir -p /home/node/.openclaw/agents \
         /home/node/.openclaw/canvas \
         /home/node/.openclaw/cron \
         /home/node/.openclaw/workspace/skills

# Always sync config files from defaults into volume (ensures updates propagate)
echo "[startup] Syncing openclaw.json into volume"
cp /home/node/defaults/openclaw.json /home/node/.openclaw/openclaw.json

# Sync clawcity skill directory into global workspace (SKILL.md format for auto-discovery)
echo "[startup] Syncing clawcity skill into workspace"
mkdir -p /home/node/.openclaw/workspace/skills/clawcity
cp -r /home/node/defaults/clawcity-skill/* /home/node/.openclaw/workspace/skills/clawcity/

# Copy heartbeat checklist into global workspace
cp /home/node/defaults/HEARTBEAT.md /home/node/.openclaw/workspace/HEARTBEAT.md

# Also update skill and heartbeat for all existing agents
for agent_workspace in /home/node/.openclaw/agents/*/workspace; do
  if [ -d "$agent_workspace" ]; then
    mkdir -p "$agent_workspace/skills/clawcity"
    cp -r /home/node/defaults/clawcity-skill/* "$agent_workspace/skills/clawcity/"
    cp /home/node/defaults/HEARTBEAT.md "$agent_workspace/HEARTBEAT.md"
  fi
done

# Clean up stale .skill.ts files from previous format (replaced by SKILL.md directories)
find /home/node/.openclaw -name "clawcity.skill.ts" -delete 2>/dev/null || true

# Clean up stale session lock files from previous runs (prevents "session file locked" errors)
find /home/node/.openclaw/agents -name "*.lock" -delete 2>/dev/null || true
# Clean up stale session files so agents start fresh and discover updated tools
find /home/node/.openclaw/agents -path "*/sessions/*.jsonl" -delete 2>/dev/null || true

# Fix Railway volume permissions (volume may mount as root-owned)
chown -R node:node /home/node/.openclaw 2>/dev/null || true

# Set default env vars for global skill discovery (per-agent .env overrides these)
export CLAWCITY_URL="https://www.clawcity.app"

# Diagnostic: check skill discovery (no install needed — OpenClaw auto-discovers SKILL.md files)
echo "[startup] Checking skill discovery:"
su --preserve-environment -s /bin/bash node -c "export HOME=/home/node; openclaw skills check" 2>&1 || echo "[startup] WARNING: could not check skills"

GATEWAY_PORT=18789
export OPENCLAW_GATEWAY_URL="http://127.0.0.1:${GATEWAY_PORT}"

# Start gateway with increased heap as node user (background, non-critical)
# Use --preserve-environment so Railway env vars (OPENROUTER_API_KEY etc.) are visible to gateway
echo "[startup] Starting OpenClaw gateway on :${GATEWAY_PORT}..."
su --preserve-environment -s /bin/bash node -c "export HOME=/home/node; NODE_OPTIONS='--max-old-space-size=4096' openclaw gateway --bind lan --port ${GATEWAY_PORT} --allow-unconfigured" &
GATEWAY_PID=$!

wait_for_gateway_ready() {
  local max_attempts=30
  local attempt=1
  while [ "$attempt" -le "$max_attempts" ]; do
    local status
    status="$(curl -sS -o /dev/null -w "%{http_code}" --connect-timeout 1 --max-time 2 \
      -H "Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}" \
      "http://127.0.0.1:${GATEWAY_PORT}/v1/models" || true)"
    if [ "$status" = "200" ] || [ "$status" = "401" ] || [ "$status" = "403" ] || [ "$status" = "404" ]; then
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
  done
  return 1
}

# Give gateway time to boot and start accepting HTTP requests.
sleep 2

# Check if gateway is still running
if kill -0 $GATEWAY_PID 2>/dev/null; then
  if wait_for_gateway_ready; then
    echo "[startup] OpenClaw gateway running and reachable (pid=$GATEWAY_PID)"
  else
    echo "[startup] WARNING: OpenClaw gateway process is running but HTTP endpoint is not ready"
  fi
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
