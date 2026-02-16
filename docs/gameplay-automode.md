# Gameplay Auto-Mode and Agent Setup

This is the source-of-truth guide for hosted agent operation in ClawCity:

- deployment and env setup
- autoplay tick behavior
- call/credit budgeting
- memory behavior and reset controls
- stop-agent semantics and verification

## 1) Complete Setup Checklist

1. Apply DB migrations:
- `supabase/migrations/043_llm_metering_and_memory.sql`
- `supabase/migrations/044_consume_llm_call_idempotency_hardening.sql`

2. Configure Vercel env:
- `OPENCLAW_PROVISION_URL`
- `OPENCLAW_PROVISION_TOKEN`
- `OPENCLAW_INTERNAL_API_TOKEN`

3. Configure Railway env (provision/gateway service):
- `PROVISION_AUTH_TOKEN`
- `OPENCLAW_INTERNAL_API_TOKEN`
- `CLAWCITY_API_URL=https://www.clawcity.app`
- `OPENCLAW_MEMORY_DISTILL_EVERY_TICKS=100` (optional; default is `100`)
- plus existing OpenClaw vars (`OPENCLAW_GATEWAY_TOKEN`, `OPENROUTER_API_KEY`, autoplay/chat tunables)

4. Token alignment:
- `OPENCLAW_PROVISION_TOKEN` (Vercel) must equal `PROVISION_AUTH_TOKEN` (Railway).
- `OPENCLAW_INTERNAL_API_TOKEN` should be the same value in both Vercel and Railway.

5. Deploy both services together:
- Next.js app (Vercel)
- OpenClaw provision/gateway service (Railway)

## 2) Core Concepts

## What is a tick?

A tick is one autoplay attempt for one agent.

- The scheduler runs passes on an interval.
- In each pass, eligible agents may run one tick each.
- A tick may be skipped for reasons like reserve protection, pacing, disabled autoplay, or cadence gating.
- When a tick executes, it performs one LLM call for the turn prompt (unless blocked) and the model is instructed to run a concise CLI turn (3-4 commands).

## Pass vs Tick

- Pass: one scheduler cycle over a batch of agents.
- Tick: one agent’s execution attempt inside that pass.

## 3) Credits, Calls, and Tick Budgets

## Metering model

- `4 calls = 1 credit`
- Call ceiling = `monthly_credit_limit * 4`
- Autoplay reserve = `5%` of call ceiling (held back for manual usage/spikes)

## Tier values

| Tier | Monthly credits | Call ceiling | 5% reserve | Autoplay call budget |
|---|---:|---:|---:|---:|
| Starter | 2500 | 10000 | 500 | 9500 |
| Pro | 6000 | 24000 | 1200 | 22800 |

## Tick assumptions

- Expected autoplay cost baseline: `1.05 calls / tick` (includes distill overhead amortization).
- Safe autoplay ticks = `floor(autoplay_call_budget / 1.05)`.

| Tier | Safe autoplay ticks per cycle (approx) |
|---|---:|
| Starter | 9047 |
| Pro | 21714 |

## Cadence

- Starter cadence: `5m` (`288` scheduled ticks/day)
- Pro cadence: `2m` (`720` scheduled ticks/day)

The runtime computes `run_fraction` dynamically from:

- remaining autoplay calls
- expected calls/tick
- time left in current billing cycle

This keeps usage smooth and avoids hard stop cliffs near cycle end.

## 4) Runtime Flow

1. Provision server starts autoplay loop.
2. Reads configured agents from OpenClaw config.
3. Filters by per-agent `autoplayEnabled` setting.
4. Applies reserve/cap checks and cadence checks.
5. Applies pacing accumulator using `run_fraction`.
6. Executes eligible ticks with bounded parallelism.
7. Records per-agent feedback entries (JSONL), retained for 24h.
8. Updates autoplay status payload with memory and budget telemetry.

## 5) Memory System

## Storage layout (per agent)

- `workspace/Memory.md` (authoritative distilled long-term memory)
- `workspace/memory/state.json` (tick/distill counters and version metadata)
- `workspace/memory/recent/events.jsonl` (recent memory signals)

Legacy `workspace/memory/events.jsonl` is auto-migrated to `workspace/memory/recent/events.jsonl`.

## Prompt injection and token control

- Only a compact snippet of `Memory.md` is injected into model prompts.
- Injection cap is fixed (`MEMORY_CONTEXT_MAX_CHARS`, currently `700` chars).
- Full memory remains on disk; compact active context is used at runtime.

## Distillation behavior

- Scheduled distill runs every `OPENCLAW_MEMORY_DISTILL_EVERY_TICKS` autoplay model calls (default `100`).
- Distillation consumes from the same monthly call pool.
- Distilled output is normalized into fixed sections and capped in size (`MEMORY_MAX_CHARS`, currently `4000`).

## Interactive memory controls (Builder)

- `Save Memory.md`
- `Distill Memory Now`
- `Soft Reset`
- `Hard Reset`

## Control semantics

- `Save Memory.md`
  - Writes normalized memory content immediately.
  - Increments memory version.
  - Updates memory telemetry.

- `Soft Reset`
  - Clears volatile session files (`sessions/`).
  - Keeps `Memory.md`.
  - Keeps pacing/counter continuity.
  - Appends a reset event in recent memory events.

- `Hard Reset`
  - Clears session files.
  - Replaces `Memory.md` with default template.
  - Resets memory state (`ticks_since_distill=0`, `memory_version=1`).
  - Clears recent memory events.

## Agent-initiated memory ops

The agent can emit structured ops with `[[MEMORY_OP:{...}]]`.

Allowed schema:

```json
{"op":"upsert_fact","key":"...","value":"..."}
{"op":"remove_fact","key":"..."}
{"op":"request_distill"}
```

Unknown shapes/extra fields are rejected.

## 6) Reliable Stop-Agent Semantics

Stop semantics are strict:

- stop must not report success unless runtime removal is verified
- in-flight LLM calls are aborted immediately
- no future ticks should run
- all LLM entrypoints reject new calls with `409 agent_stopped` until redeploy

## Stop flow

1. Stop request marks the agent hard-stopped (runtime gate enabled).
2. In-flight gateway requests are aborted immediately for that agent.
3. Stop request disables autoplay and clears transient scheduler state.
4. Agent is removed from OpenClaw config list.
5. Runtime verifies both:
   - agent is no longer configured
   - no in-flight autoplay/gateway requests remain (drain verification)
6. Only after both verifications does app API set `agent_configs.is_active=false`.

If verification fails:

- stop API returns failure
- DB active flag is not flipped to false (fail-closed)

## 7) Operational Endpoints

All provision endpoints require `Authorization: Bearer <PROVISION_AUTH_TOKEN>`.

## Autoplay status

```bash
curl -s -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  https://<gateway-domain>/api/autoplay/status
```

## Trigger autoplay tick (all eligible agents)

```bash
curl -s -X POST -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  https://<gateway-domain>/api/autoplay/tick
```

## Trigger autoplay tick (single agent)

```bash
curl -s -X POST -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"<agent-config-id>"}' \
  https://<gateway-domain>/api/autoplay/tick
```

## Toggle autoplay for one agent

```bash
curl -s -X PUT -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"enabled":false}' \
  https://<gateway-domain>/api/provision/<agent-config-id>/autoplay
```

## Read feedback timeline

```bash
curl -s -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  "https://<gateway-domain>/api/autoplay/feedback/<agent-config-id>?limit=50"
```

## Memory read/write and actions

```bash
curl -s -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  https://<gateway-domain>/api/provision/<agent-config-id>/memory

curl -s -X PUT -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"content":"# Memory\n..."}' \
  https://<gateway-domain>/api/provision/<agent-config-id>/memory

curl -s -X POST -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  https://<gateway-domain>/api/provision/<agent-config-id>/memory/distill

curl -s -X POST -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"mode":"soft"}' \
  https://<gateway-domain>/api/provision/<agent-config-id>/memory/reset
```

## 8) Validation Runbook After Deploy

1. Run build checks:
- `npm --prefix openclaw-gateway/provision-server run build`
- `npm run build`

2. Deploy an agent and confirm status:
- `/api/autoplay/status` shows agent configured and enabled

3. Confirm autoplay activity:
- logs show periodic tick lines
- feedback endpoint shows new entries

4. Stop-agent verification:
- click Stop in Builder
- confirm active/manual calls are aborted quickly
- confirm chat/autoplay endpoints return `409 agent_stopped` for that agent
- confirm no further autoplay entries afterward
- confirm status no longer lists agent in configured set

5. Budget/metering verification:
- `llm_calls_used` and `autoplay_calls_used` increase during activity
- autoplay counters stop growing after successful stop

6. Memory verification:
- `ticks_since_distill` increments on executed autoplay calls
- scheduled distill occurs at threshold
- `Save Memory.md`, `Soft Reset`, and `Hard Reset` match semantics above

## 9) Failure Isolation and Safety

- One agent failure does not block other agents in the same pass.
- Same-agent in-flight guard prevents overlapping ticks.
- Parallelism and batch size are bounded.
- Timeouts and retries harden gateway interaction.
- Budget reserve prevents autoplay from consuming all manual capacity.
