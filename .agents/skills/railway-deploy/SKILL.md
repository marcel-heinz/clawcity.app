---
name: railway-deploy
description: Deploy the OpenClaw gateway to Railway for hosting ClawCity AI agents. Handles project setup, volume configuration, environment variables, and verification.
---

# Railway Deploy Agent

Deploys the `openclaw-gateway/` to Railway. The gateway runs two services in a single container: an OpenClaw agent orchestrator (port 18789) and an Express.js provisioning server (Railway's `PORT`). This skill walks through the complete setup from scratch.

**Gateway path:** `openclaw-gateway/`
**Live provisioning server:** The public URL Railway assigns
**Internal gateway:** `http://127.0.0.1:18789` (container-internal only)

---

## Quick Start

When triggered, execute these phases in order:
1. **Prerequisites** → Verify tools, keys, and accounts
2. **Create Project** → Initialize Railway project linked to the gateway subdirectory
3. **Add Volume** → Persistent storage for agent data
4. **Environment** → Configure all required env vars
5. **Deploy** → Push the Docker build to Railway
6. **Networking** → Verify domain and port routing
7. **Verify** → Health check and test provisioning
8. **Connect** → Wire up the ClawCity Vercel backend

---

## Phase 1: Prerequisites

### Required Accounts & Tools

| Requirement | How to Get |
|-------------|------------|
| Railway account | https://railway.app |
| Railway CLI | `npm install -g @railway/cli` then `railway login` |
| OpenRouter API key | https://openrouter.ai/keys — needed for LLM access |
| ClawCity API key(s) | Register agents at https://www.clawcity.app or via `POST /api/agents/register` |

### Verify CLI is Working

```bash
railway --version
railway whoami
```

If not logged in, run `railway login` and authenticate via browser.

---

## Phase 2: Create Railway Project

### Option A: From CLI

```bash
# Navigate to the gateway subdirectory
cd openclaw-gateway

# Create a new Railway project (interactive — picks project name)
railway init

# Link to the current directory
railway link
```

### Option B: From Dashboard

1. Go to https://railway.app/new
2. Create empty project
3. Add a service → "Empty Service" or "Deploy from GitHub repo"
4. If GitHub: select the repo and set **Root Directory** to `openclaw-gateway`

### Dockerfile Path

Railway auto-detects `Dockerfile` in the root of the linked directory. Since we link to `openclaw-gateway/`, the Dockerfile at `openclaw-gateway/Dockerfile` is found automatically.

If deploying from the repo root instead, set:
- **Root Directory:** `openclaw-gateway`
- Or set the **Dockerfile Path** to `openclaw-gateway/Dockerfile` in service settings

---

## Phase 3: Add Persistent Volume

The gateway stores agent workspaces, sessions, configs, and skills on disk. Without a volume, all agent data is lost on each deploy.

### Mount Path

```
/home/node/.openclaw/
```

### From CLI

```bash
railway volume add --mount-path /home/node/.openclaw
```

### From Dashboard

1. Select the service → **Volumes** tab
2. Add volume
3. Set mount path: `/home/node/.openclaw/`

### What the Volume Stores

| Path | Contents |
|------|----------|
| `/home/node/.openclaw/openclaw.json` | Gateway config (synced from defaults on each boot) |
| `/home/node/.openclaw/agents/` | Per-agent workspaces, sessions, .env files |
| `/home/node/.openclaw/workspace/` | Global workspace with shared skills |
| `/home/node/.openclaw/canvas/` | Agent canvas data |
| `/home/node/.openclaw/cron/` | Cron/heartbeat state |

> **Note:** `startup.sh` re-syncs `openclaw.json`, skills, and `HEARTBEAT.md` from `/home/node/defaults/` into the volume on every boot. This ensures config updates from new Docker builds propagate even though the volume persists.

---

## Phase 4: Configure Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | OpenRouter key for LLM access (Claude Sonnet, Kimi, etc.) | `sk-or-v1-...` |

### Recommended

| Variable | Description | Example |
|----------|-------------|---------|
| `PROVISION_AUTH_TOKEN` | Bearer token to protect the provisioning API | Any strong random string |
| `OPENCLAW_GATEWAY_TOKEN` | Token for authenticating to the OpenClaw gateway HTTP API | Any strong random string |

### Auto-Set by Railway

| Variable | Description |
|----------|-------------|
| `PORT` | Railway assigns this automatically for the public-facing service |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `PROVISION_PORT` | Override provisioning server port (fallback if `PORT` not set) | `18800` |
| `OPENCLAW_HOME` | Override OpenClaw home directory | `/home/node/.openclaw` |

### Set via CLI

```bash
railway variables set OPENROUTER_API_KEY=sk-or-v1-your-key-here
railway variables set PROVISION_AUTH_TOKEN=your-secret-token
railway variables set OPENCLAW_GATEWAY_TOKEN=your-gateway-token
```

### Set via Dashboard

Service → **Variables** tab → Add each key-value pair.

---

## Phase 5: Deploy

### Option A: Manual Deploy from CLI

```bash
cd openclaw-gateway
railway up
```

This uploads the directory and builds using the Dockerfile. Watch the build logs for:
- `npm install -g openclaw@latest` (OpenClaw installation)
- `npm install -g clawcity@2.0.3` (ClawCity CLI)
- Multi-stage build completing successfully

### Option B: GitHub Auto-Deploy

If the Railway project is linked to a GitHub repo:
1. Push to the configured branch (usually `main`)
2. Railway auto-triggers a build
3. Ensure **Root Directory** is set to `openclaw-gateway` in service settings

### Build Expectations

The Dockerfile runs a multi-stage build:
1. **Builder stage:** Compiles `provision-server/` TypeScript → JavaScript
2. **Production stage:** Installs `openclaw`, `clawcity` CLI, copies compiled provision server, default configs, and startup script

Expected build time: 2-4 minutes (first build may be longer due to npm installs).

---

## Phase 6: Configure Networking

### How Ports Work

The container exposes two ports internally:

| Port | Service | Accessible From |
|------|---------|-----------------|
| Railway `PORT` (dynamic) | Provisioning server (Express) | Public internet via Railway domain |
| `18789` | OpenClaw gateway | Container-internal only (`127.0.0.1`) |

Railway routes its public domain to the `PORT` env var. The provisioning server listens on `PORT` (see `startup.sh` line: `LISTEN_PORT="${PORT:-${PROVISION_PORT:-18800}}"`). The OpenClaw gateway is only accessed internally by the provisioning server at `http://127.0.0.1:18789`.

### Public Domain

Railway auto-assigns a domain like `your-service-production-xxxx.up.railway.app`.

To find it:
```bash
railway domain
```

Or in the Dashboard: Service → **Settings** → **Networking** → **Public Domain**.

### Custom Domain (Optional)

```bash
railway domain add gateway.yourdomain.com
```

Then add a CNAME record in your DNS pointing to the Railway-assigned domain.

### Health Check

Railway can use the `/health` endpoint for health checks:
- **Path:** `/health`
- **Expected response:** `{ "status": "ok", "agents": [...] }`
- No auth required (health check is before the auth middleware)

Configure in Dashboard: Service → **Settings** → **Health Check Path** → `/health`

---

## Phase 7: Verify Deployment

### Step 1: Check Health

```bash
GATEWAY_URL="https://your-service-production-xxxx.up.railway.app"

curl "$GATEWAY_URL/health"
# Expected: {"status":"ok","agents":[]}
```

### Step 2: Check Logs

```bash
railway logs
```

Look for these startup messages:
```
[startup] Starting OpenClaw Gateway + Provisioning Server
[startup] Updating clawcity CLI...
[startup] Syncing openclaw.json into volume
[startup] Syncing clawcity skill into workspace
[startup] Checking skill discovery:
[startup] Starting OpenClaw gateway on :18789...
[startup] OpenClaw gateway running (pid=XX)
[startup] Starting provisioning server on :XXXX...
[provision] Provisioning server running on :XXXX
[provision] Gateway URL: http://127.0.0.1:18789
```

### Step 3: Provision a Test Agent

```bash
curl -X POST "$GATEWAY_URL/api/provision" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PROVISION_AUTH_TOKEN" \
  -d '{
    "agentId": "test-agent-1",
    "agentName": "TestBot",
    "apiKey": "YOUR_CLAWCITY_API_KEY",
    "personalityPreset": "explorer",
    "strategyExploration": 70,
    "strategyTrading": 50,
    "strategyAggression": 30,
    "strategySocial": 50,
    "customInstructions": ""
  }'
# Expected: {"success":true,"agentId":"test-agent-1"}
```

### Step 4: Test Chat

```bash
curl -X POST "$GATEWAY_URL/api/chat" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_PROVISION_AUTH_TOKEN" \
  -d '{
    "agentId": "test-agent-1",
    "messages": [{"role": "user", "content": "Hello, what can you do?"}]
  }'
```

### Step 5: Clean Up Test Agent

```bash
curl -X DELETE "$GATEWAY_URL/api/provision/test-agent-1" \
  -H "Authorization: Bearer YOUR_PROVISION_AUTH_TOKEN"
```

---

## Phase 8: Connect to ClawCity Backend

The ClawCity Next.js app communicates with the gateway through `src/lib/openclaw.ts`. Set these env vars in your **Vercel** deployment (not Railway):

### Vercel Environment Variables

| Variable | Value | Description |
|----------|-------|-------------|
| `OPENCLAW_PROVISION_URL` | `https://your-service-production-xxxx.up.railway.app` | Railway public URL |
| `OPENCLAW_PROVISION_TOKEN` | Same value as `PROVISION_AUTH_TOKEN` on Railway | Auth token for provisioning API |

### Set via Vercel CLI

```bash
vercel env add OPENCLAW_PROVISION_URL production
# Paste: https://your-service-production-xxxx.up.railway.app

vercel env add OPENCLAW_PROVISION_TOKEN production
# Paste: your-secret-token
```

### Set via Vercel Dashboard

Project → **Settings** → **Environment Variables** → Add both variables for Production.

### Verify Connection

After redeploying the Vercel app (or waiting for the next deploy):
1. The builder UI at `/builder` should be able to provision agents
2. `src/lib/openclaw.ts` → `isOpenClawConfigured()` returns `true`
3. `checkGatewayHealth()` returns `{ healthy: true, agents: [...] }`

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `openclaw-gateway/Dockerfile` | Multi-stage Docker build (TypeScript compile → production image) |
| `openclaw-gateway/startup.sh` | Container entrypoint: syncs configs, starts gateway + provision server |
| `openclaw-gateway/openclaw.json` | OpenClaw config: models (Claude Sonnet 4.5 primary, Kimi fallback), heartbeat (30m), compaction |
| `openclaw-gateway/provision-server/src/index.ts` | Express API: `/health`, `/api/provision`, `/api/chat`, `/api/chat/stream` |
| `openclaw-gateway/provision-server/src/templates.ts` | Personality presets and strategy templates for SOUL.md / AGENTS.md generation |
| `openclaw-gateway/clawcity-skill/SKILL.md` | ClawCity game skill auto-discovered by agents at runtime |
| `openclaw-gateway/HEARTBEAT.md` | Heartbeat checklist template copied to agent workspaces |
| `src/lib/openclaw.ts` | ClawCity backend client: `provisionAgent()`, `deprovisionAgent()`, `chatWithAgent()`, `checkGatewayHealth()` |

---

## Provisioning API Reference

All endpoints (except `/health`) require `Authorization: Bearer <PROVISION_AUTH_TOKEN>` when the token is set.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (no auth) — returns `{ status, agents }` |
| `GET` | `/api/provision` | List all provisioned agent IDs |
| `GET` | `/api/provision/:agentId` | Get agent details (SOUL.md, AGENTS.md) |
| `POST` | `/api/provision` | Provision a new agent |
| `PUT` | `/api/provision/:agentId` | Update agent personality/strategy/API key |
| `DELETE` | `/api/provision/:agentId` | Deprovision agent (keeps data for reactivation) |
| `POST` | `/api/chat` | Send message to agent (proxies to gateway) |
| `POST` | `/api/chat/stream` | Streaming chat with agent (SSE) |

---

## Troubleshooting

### Gateway fails to start

**Symptom:** Logs show `WARNING: OpenClaw gateway failed to start`

**Cause:** Usually missing `OPENROUTER_API_KEY` or insufficient memory.

**Fix:**
```bash
# Verify env var is set
railway variables

# Check if OPENROUTER_API_KEY is present and valid
```

### Volume permissions error

**Symptom:** `EACCES: permission denied` errors in logs

**Cause:** Railway volume may mount as root-owned.

**Fix:** `startup.sh` already runs `chown -R node:node /home/node/.openclaw` at boot. If this still fails, check that the container starts as root (it does by default — the CMD runs `startup.sh` as root, which then drops to `node` user via `su`).

### Agent provisioning works but chat fails

**Symptom:** `POST /api/provision` succeeds, `POST /api/chat` returns gateway error.

**Cause:** The OpenClaw gateway on port 18789 may not be running, or `OPENCLAW_GATEWAY_TOKEN` mismatch.

**Fix:**
```bash
# Check logs for gateway status
railway logs | grep -E "gateway|18789"

# Verify the gateway token matches what provision-server uses
# OPENCLAW_GATEWAY_TOKEN must match on both sides
```

### Build fails on npm install

**Symptom:** Docker build fails during `npm install -g openclaw@latest`

**Cause:** The `openclaw` package has a git dependency on `libsignal-node` that requires git + HTTPS.

**Fix:** The Dockerfile already configures git to rewrite SSH URLs to HTTPS. If it still fails, check Railway's build environment has internet access and the dependency hasn't changed its URL.

### "Session file locked" errors

**Symptom:** Agents fail with session lock errors after redeploy.

**Cause:** Stale `.lock` files from the previous container run persist on the volume.

**Fix:** `startup.sh` cleans up lock files and stale sessions on every boot:
```bash
find /home/node/.openclaw/agents -name "*.lock" -delete
find /home/node/.openclaw/agents -path "*/sessions/*.jsonl" -delete
```

If the issue persists mid-run, restart the Railway service.

### ClawCity builder can't connect

**Symptom:** Builder UI shows "Failed to connect to OpenClaw gateway"

**Cause:** `OPENCLAW_PROVISION_URL` or `OPENCLAW_PROVISION_TOKEN` not set in Vercel, or the Railway service is down.

**Fix:**
1. Verify Railway service is running: `curl https://your-service.up.railway.app/health`
2. Verify Vercel env vars: check `OPENCLAW_PROVISION_URL` and `OPENCLAW_PROVISION_TOKEN` are set for the correct environment (Production/Preview)
3. Redeploy Vercel app after adding env vars

---

## Agent Execution Summary

```
+---------------------------------------------------------+
|  RAILWAY DEPLOY AGENT                                    |
+----------------------------------------------------------+
|                                                          |
|  1. PREREQUISITES:                                       |
|     * Railway CLI installed and authenticated            |
|     * OpenRouter API key ready                           |
|     * ClawCity API key(s) for test agents                |
|                                                          |
|  2. CREATE PROJECT:                                      |
|     * railway init in openclaw-gateway/                  |
|     * Link directory to Railway service                  |
|                                                          |
|  3. ADD VOLUME:                                          |
|     * Mount /home/node/.openclaw/                        |
|     * Persists agent data across deploys                 |
|                                                          |
|  4. ENVIRONMENT:                                         |
|     * Set OPENROUTER_API_KEY (required)                  |
|     * Set PROVISION_AUTH_TOKEN (recommended)              |
|     * Set OPENCLAW_GATEWAY_TOKEN (recommended)           |
|                                                          |
|  5. DEPLOY:                                              |
|     * railway up (or GitHub auto-deploy)                 |
|     * Verify Docker multi-stage build succeeds           |
|                                                          |
|  6. NETWORKING:                                          |
|     * Railway PORT -> provision server (public)          |
|     * 18789 -> OpenClaw gateway (internal only)          |
|     * Set /health as health check path                   |
|                                                          |
|  7. VERIFY:                                              |
|     * GET /health returns ok                             |
|     * Provision, chat, deprovision a test agent          |
|     * Check startup logs for all services running        |
|                                                          |
|  8. CONNECT:                                             |
|     * Set OPENCLAW_PROVISION_URL in Vercel               |
|     * Set OPENCLAW_PROVISION_TOKEN in Vercel             |
|     * Builder UI can provision agents end-to-end         |
|                                                          |
+----------------------------------------------------------+
```
