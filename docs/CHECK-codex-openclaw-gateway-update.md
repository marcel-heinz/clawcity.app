# CHECK codex/openclaw-gateway-update

## Purpose
This document captures the OpenClaw Railway hardening work so we can reliably spin it up again for non-technical users.

## Scope
Branch: `codex/openclaw-gateway-update`

Hardening touches:
- `openclaw-gateway/startup.sh`
- `openclaw-gateway/Dockerfile`
- `openclaw-gateway/provision-server/src/index.ts`
- `openclaw-gateway/provision-server/dist/index.js`
- `src/lib/openclaw.ts`
- `src/app/api/builder/auto-mode/status/route.ts`
- `src/app/builder/page.tsx`

## What Was Hardened

### 1) Railway startup resilience
- Added strict startup mode (`set -euo pipefail`).
- If `OPENCLAW_GATEWAY_TOKEN` is missing:
  - reuse `PROVISION_AUTH_TOKEN` when present, else
  - generate an ephemeral runtime token.
- Added explicit warning when `OPENROUTER_API_KEY` is missing.
- Made runtime `clawcity@latest` update non-fatal with warning fallback.
- Added readiness probe for local gateway endpoint before declaring it healthy.

### 2) Gateway health and runtime checks
- `/health` now reports:
  - `status` (`ok` or `degraded`)
  - `gateway.ready`
  - `gateway.status_code`
  - `gateway.error`
  - autoplay metadata
- `/health` returns HTTP `503` while degraded.

### 3) Call safety before budget consumption
For chat and streaming chat:
- verify gateway reachability first
- only then consume billing budget
- return clear errors for:
  - gateway down (`503`)
  - gateway auth mismatch (`502`, token wiring hint)
  - billing/internal service unavailable (`502`)

### 4) Auto-mode tick reliability
- Auto-mode now checks gateway health before trying ticks.
- If gateway is down, tick records `gateway_unavailable` feedback.
- If billing service is unavailable, tick records `billing_unavailable` feedback.
- Avoids silent failures and protects usage accounting consistency.

### 5) Memory distillation safety
- Distillation now verifies gateway health before consuming distill budget.
- Returns explicit unavailable status when runtime is not reachable.

### 6) Prompt/snapshot alignment with latest CLI + onboarding direction
Autoplay command snapshot now includes:
- `clawcity oracle --help`
- `clawcity buy --help`
- `clawcity craft --help`
- `clawcity market --help`
- `clawcity market fill --help`

Prompt guidance now nudges:
- Oracle-first fallback when intent is unclear
- safer market/economy command usage

### 7) Builder UX diagnostics
Builder scheduler status now includes gateway health and surfaces:
- gateway unavailable warning banner
- clearer error reasons:
  - `gateway_unavailable`
  - `gateway_auth`
  - `billing_unavailable`

## Default Environment Expectations (Railway)
Required:
- `OPENROUTER_API_KEY`

Recommended:
- `PROVISION_AUTH_TOKEN`
- `OPENCLAW_GATEWAY_TOKEN` (optional now; startup can derive it)
- `OPENCLAW_INTERNAL_API_TOKEN` (for budget/memory telemetry calls)

Operational defaults:
- gateway port: `18789` (internal)
- provision server: `$PORT` (Railway public)

## Fast Verification Checklist
After deploy, verify in order:

1. Health
- `GET /health` returns `200`
- `gateway.ready` is `true`

2. Provision + chat
- provision a test agent
- send `POST /api/chat`
- confirm no auth mismatch and no runtime unavailable errors

3. Auto-mode
- check `GET /api/autoplay/status`
- ensure scheduler includes gateway block with `ready: true`
- confirm tick feedback does not repeatedly show gateway/billing unavailable

4. Builder UI
- chat tab shows no gateway warning
- auto-mode status updates and last tick metadata are visible

## Failure Signatures and Direct Fixes

### `Gateway authentication failed`
- Cause: token mismatch between provision server and openclaw gateway
- Fix: align `OPENCLAW_GATEWAY_TOKEN` and restart

### `OpenClaw gateway unavailable`
- Cause: runtime not healthy/reachable
- Fix: inspect Railway logs, verify `OPENROUTER_API_KEY`, restart service

### `Billing service unavailable`
- Cause: internal API auth or connectivity issue
- Fix: verify `OPENCLAW_INTERNAL_API_TOKEN` and app URL routing

## Re-run / Spin-up Procedure
1. Deploy this branch (or cherry-pick these files).
2. Ensure env vars above are present.
3. Confirm `/health` -> `gateway.ready: true`.
4. Run one manual chat.
5. Enable auto-mode and verify one successful tick.

## Rollback
If needed, rollback to the commit before this branch hardening set and re-deploy Railway service.
