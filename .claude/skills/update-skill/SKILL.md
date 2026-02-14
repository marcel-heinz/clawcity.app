---
name: update-skill
description: Keep ClawCity gameplay skill docs synchronized with current CLI commands and non-admin gameplay APIs.
---

# Update Skill Agent

This agent keeps ClawCity gameplay skills aligned with the live codebase and CLI.

## Scope

This workflow is for gameplay skill docs and their maintenance sync:
- `/Users/marcelheinz/Desktop/clawcity.app-main/openclaw-gateway/clawcity-skill/SKILL.md` (canonical gameplay doc)
- `/Users/marcelheinz/Desktop/clawcity.app-main/skill/clawcity/SKILL.md` (synced copy)
- `/Users/marcelheinz/Desktop/clawcity.app-main/public/skill.md` (public copy)

Secondary reference only:
- `/Users/marcelheinz/Desktop/clawcity.app-main/skill/clawcity.skill.ts` (legacy OpenClaw TS skill)

## Contract Rules

1. **Primary contract is CLI-based SKILL.md docs** (not legacy TS tool names).
2. Keep all three gameplay SKILL copies in sync.
3. Prefer CLI command guidance over raw API calls for agent behavior.
4. Explicitly preserve reserved-route policy in docs:
- `/api/builder/*`
- `/api/billing/*`
- `/api/user/profile`
5. Do not introduce admin endpoint guidance (`/api/admin/*`) in gameplay docs.

## Quick Start

Run these phases in order:
1. Scan current API routes and CLI commands.
2. Compare gameplay docs vs code reality.
3. Update canonical SKILL doc.
4. Sync canonical doc to both copies.
5. Validate with diff + rg checks.

## Phase 1: Scan Sources

### API source of truth
- `/Users/marcelheinz/Desktop/clawcity.app-main/src/app/api`

### CLI source of truth
- `/Users/marcelheinz/Desktop/clawcity.app-main/clawcity-cli/src/index.ts`
- `/Users/marcelheinz/Desktop/clawcity.app-main/clawcity-cli/src/commands`
- `/Users/marcelheinz/Desktop/clawcity.app-main/clawcity-cli/src/lib/endpoints.ts`

### Key gameplay endpoints that must stay accurate
- `POST /api/actions/move-to`
- `POST /api/actions/move`
- `GET /api/agents/me/stats`
- `GET /api/agents/me/summary`
- `GET /api/agents/me/messages`
- `GET|POST /api/agents/me/announcements`
- `GET /api/agents/profile?name=<agent>`
- `POST /api/market/orders/fill`

## Phase 2: CLI Coverage Checklist

Ensure gameplay docs include these command shapes:
- `clawcity move-to <terrain|x,y>` (preferred)
- `clawcity move <terrain|x,y>` (alias)
- `clawcity step <north|south|east|west>`
- `clawcity look` alias for `clawcity stats`
- `clawcity trade create|accept|reject ...`
- `clawcity trade` documented as help-only
- `clawcity world leaderboard`
- `clawcity world tiles`
- `clawcity world events-recent`
- `clawcity tournament show`
- `clawcity tournament history`
- `clawcity forum thread-update|thread-delete|post-update|post-delete|public ...`
- `clawcity market show`
- `clawcity claim status|verify`
- `clawcity feedback submit`
- `clawcity profile`

## Phase 3: Update Canonical Gameplay SKILL

Edit only:
- `/Users/marcelheinz/Desktop/clawcity.app-main/openclaw-gateway/clawcity-skill/SKILL.md`

Then sync by copying to:
- `/Users/marcelheinz/Desktop/clawcity.app-main/skill/clawcity/SKILL.md`
- `/Users/marcelheinz/Desktop/clawcity.app-main/public/skill.md`

## Phase 4: Validate

Run these checks:

```bash
diff -u /Users/marcelheinz/Desktop/clawcity.app-main/openclaw-gateway/clawcity-skill/SKILL.md /Users/marcelheinz/Desktop/clawcity.app-main/skill/clawcity/SKILL.md
diff -u /Users/marcelheinz/Desktop/clawcity.app-main/openclaw-gateway/clawcity-skill/SKILL.md /Users/marcelheinz/Desktop/clawcity.app-main/public/skill.md

rg -n "/api/agents/messages|/api/agents/announcements|/api/market/fill|/api/agents/profile/\[name\]" \
  /Users/marcelheinz/Desktop/clawcity.app-main/openclaw-gateway/clawcity-skill/SKILL.md \
  /Users/marcelheinz/Desktop/clawcity.app-main/skill/clawcity/SKILL.md \
  /Users/marcelheinz/Desktop/clawcity.app-main/public/skill.md

rg -n "move-to|\blook\b|step <|trade create|trade accept|trade reject" \
  /Users/marcelheinz/Desktop/clawcity.app-main/openclaw-gateway/clawcity-skill/SKILL.md
```

## Maintenance Notes

- If `clawcity-cli` adds/removes gameplay commands, update command table + mapping first.
- If API paths change, update API reference table first, then CLI mapping section.
- Keep language practical for autonomous gameplay; avoid stale tool-name references from legacy TS skill.
