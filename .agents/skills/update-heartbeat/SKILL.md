---
name: update-heartbeat
description: Keep ClawCity heartbeat checklists aligned with current CLI commands, gameplay thresholds, and synced heartbeat files.
---

# Update Heartbeat Agent

This agent maintains the heartbeat checklists used for periodic agent monitoring.

## Scope

Primary files:
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/openclaw-gateway/HEARTBEAT.md`
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/heartbeat.md`

Related references:
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/src/lib/types.ts`
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/clawcity-cli/src/commands`
- `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/openclaw-gateway/clawcity-skill/SKILL.md`

## Contract Rules

1. Heartbeat checks must be written with **CLI commands** (not legacy `.skill.ts` tool names).
2. `openclaw-gateway/HEARTBEAT.md` and `public/heartbeat.md` must stay functionally in sync.
3. Monitoring assumptions must match current constants and APIs.
4. Current runtime expectation is 24/7 operation; do not reintroduce stale limited active-hours guidance.

## Quick Start

1. Read heartbeat files and constants.
2. Verify command availability in `clawcity-cli`.
3. Update both heartbeat files for any drift.
4. Validate diff and threshold references.

## Command-Centric Checklist

Validate these checks use real CLI commands:
- `clawcity announcements`
- `clawcity stats`
- `clawcity tournament`
- `clawcity market list`
- `clawcity market prices`
- `clawcity messages`

Optional deeper checks when needed:
- `clawcity summary`
- `clawcity world leaderboard`
- `clawcity world events-recent`

## Threshold Alignment

Verify heartbeat guidance stays aligned with:
- `INACTIVITY_THRESHOLD_HOURS`
- `INACTIVITY_DRAIN_PERCENT`
- `TERRITORY_UPKEEP_FOOD`
- territory cap and upkeep expectations from `src/lib/types.ts`

## Validation Commands

```bash
diff -u /Users/marcelheinz/Desktop/clawcity.app-main-fresh/openclaw-gateway/HEARTBEAT.md /Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/heartbeat.md

rg -n "clawcity_status|clawcity_messages|clawcity_market_orders|tool names" \
  /Users/marcelheinz/Desktop/clawcity.app-main-fresh/openclaw-gateway/HEARTBEAT.md \
  /Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/heartbeat.md \
  /Users/marcelheinz/Desktop/clawcity.app-main-fresh/.agents/skills/update-heartbeat/SKILL.md

rg -n "activeHours|06:00|23:00" \
  /Users/marcelheinz/Desktop/clawcity.app-main-fresh/.agents/skills/update-heartbeat/SKILL.md
```

## Update Policy

- Keep heartbeat output protocol explicit (`HEARTBEAT_OK` vs concise alert sections).
- Keep checks short and operationally useful for autonomous agent play.
- Prefer actionable alerts over verbose narratives.
- Include timeout-safe command examples for automation (`clawcity --timeout 30 ...`) when adding new heartbeat scripts.
