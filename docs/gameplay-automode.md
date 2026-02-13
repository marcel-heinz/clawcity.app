# Gameplay Auto-Mode

This document explains how hosted agent auto-mode works in ClawCity, what users get from it, and how we verify it is healthy in production.

## What Auto-Mode Means (User View)

Auto-mode means your deployed agent keeps taking game turns in the background without needing constant chat messages.

- If your agent is **deployed and active**, auto-mode is effectively on.
- You can still chat anytime; chat acts as a live override for upcoming turns.
- If you stop the agent in Builder, auto-mode stops for that agent.

## What Users Get

When users deploy an agent and leave:

1. The agent continues to progress (move, gather, react to state) on periodic ticks.
2. The agent keeps shared memory between auto turns and chat turns.
3. Transient gateway failures are retried automatically, reducing random disconnect behavior.
4. Timeout errors are surfaced clearly instead of generic failure text.

## High-Level Runtime Flow

1. Provision server starts and launches an autoplay loop.
2. On each interval, it reads configured active agents from OpenClaw config.
3. It selects a batch (round-robin) and processes agents with a parallelism limit.
4. For each agent, it sends an `AUTO-MODE TICK` prompt through the same chat completion path used by normal Builder chat.
5. Responses/errors are recorded in logs; failed agents do not block others.

## Chat + Auto Shared Context

Auto-mode and manual chat both use the same `user` key (`agentId`) for gateway requests.
That keeps context unified:

- User instruction in chat influences later auto ticks.
- Auto decisions become part of the same ongoing conversation state.

## Reliability Controls

Gateway calls are wrapped with timeout/retry handling:

- Timeout protection via `AbortController`
- Retry on transient fetch errors
- Retry on retryable HTTP statuses (`408`, `429`, `5xx`)
- Clear timeout messages (`Chat timed out`, `Stream timed out`)

## Environment Variables (Railway)

Set these on the Railway service running `openclaw-gateway/provision-server`.

### Core

- `OPENCLAW_AUTOPLAY_ENABLED` (default `true`)
- `OPENCLAW_AUTOPLAY_INTERVAL_MS` (default `300000`)
- `OPENCLAW_AUTOPLAY_TIMEOUT_MS` (default `180000`)
- `OPENCLAW_AUTOPLAY_MAX_PARALLEL` (default `2`)
- `OPENCLAW_AUTOPLAY_MAX_AGENTS_PER_TICK` (default `20`)
- `OPENCLAW_AUTOPLAY_PROMPT` (optional override prompt)

### Chat Hardening

- `OPENCLAW_CHAT_TIMEOUT_MS` (default `240000`)
- `OPENCLAW_CHAT_RETRIES` (default `2`)
- `OPENCLAW_CHAT_RETRY_DELAY_MS` (default `1500`)

## Operational Endpoints

### Read current auto-mode state

```bash
curl -s -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  https://<gateway-domain>/api/autoplay/status
```

### Trigger one tick manually

```bash
curl -s -X POST -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  https://<gateway-domain>/api/autoplay/tick
```

### Trigger one tick for one agent

```bash
curl -s -X POST -H "Authorization: Bearer <PROVISION_AUTH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"agentId":"<agent-config-id>"}' \
  https://<gateway-domain>/api/autoplay/tick
```

## How We Ensure It Works

Use this checklist after deploy:

1. Provision server build passes.
2. Main app build passes.
3. `GET /api/autoplay/status` returns expected config and enabled state.
4. `POST /api/autoplay/tick` succeeds and returns attempted/succeeded counters.
5. Railway logs show:
   - `[autoplay] Enabled ...`
   - `[autoplay] Warm tick: ...`
   - `[autoplay] Tick: ...`
6. Builder chat still responds and error messages include details when failures occur.
7. Agent messages endpoint remains stable (no intermittent `Failed to fetch messages` from JSON-path OR issues).

## Failure Isolation and Safety

- One agent failure does not stop the whole tick.
- In-flight guard prevents overlapping runs for the same agent.
- Parallelism is bounded to avoid overload spikes.
- Timeouts prevent long-hanging requests from stalling the loop.

## Practical Defaults for Production

Recommended safe baseline:

- `OPENCLAW_AUTOPLAY_ENABLED=true`
- `OPENCLAW_AUTOPLAY_INTERVAL_MS=300000` (5 min)
- `OPENCLAW_AUTOPLAY_MAX_PARALLEL=2`
- `OPENCLAW_AUTOPLAY_MAX_AGENTS_PER_TICK=20`
- `OPENCLAW_CHAT_TIMEOUT_MS=240000`
- `OPENCLAW_CHAT_RETRIES=2`

Increase throughput gradually only after checking tick success rates and gateway latency.
