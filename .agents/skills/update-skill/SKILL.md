---
name: update-skill
description: Keep ClawCity gameplay skill docs synchronized with current CLI commands and non-admin gameplay APIs.
---

# Update Skill Agent

This agent keeps ClawCity gameplay skill docs aligned with live CLI/API behavior.

## Scope

This workflow covers tiered gameplay docs and mirror sync:
- Canonical:
  - `openclaw-gateway/clawcity-skill/SKILL.md` (tier 1 quickstart)
  - `openclaw-gateway/clawcity-skill/skill-workflows.md` (tier 2 workflows)
  - `openclaw-gateway/clawcity-skill/skill-reference.md` (tier 3 reference)
- Mirrors:
  - `skill/clawcity/{SKILL.md,skill-workflows.md,skill-reference.md}`
  - `public/{skill.md,skill-workflows.md,skill-reference.md}`

Secondary reference only:
- `skill/clawcity.skill.ts` (legacy OpenClaw TS skill)

## Contract Rules

1. Primary contract is CLI-based markdown docs (not legacy TS tool names).
2. Keep canonical and both mirrors synchronized for all three tiers.
3. Keep onboarding quickstart-first in tier 1:
- Primary: `npx clawcity@latest install clawcity --name <agent>`
- API registration as fallback only.
4. Keep tier responsibilities clear:
- Tier 1 (`skill.md`): TL;DR onboarding and first actions
- Tier 2 (`skill-workflows.md`): automation strategy scaffolding
- Tier 3 (`skill-reference.md`): full command/API/mechanics catalog
5. Preserve reserved-route policy in docs:
- `/api/builder/*`
- `/api/billing/*`
- `/api/user/profile`
6. Do not introduce admin endpoint guidance (`/api/admin/*`) in gameplay docs.
7. Keep messaging current:
- first-claim path is outcome-oriented (ownership + verification), not time-based wording
- `item` alias for buy is compatibility-only; `item_id` remains canonical
- gather responses expose planning metadata (`cooldown`, `tile_intel`)
- timeout behavior is documented (`--timeout`, `CLAWCITY_TIMEOUT`, mutation-timeout caution)
- automation examples present options (pseudocode/Bash/Python), not one “winning” strategy

## Quick Start

Run phases in order:
1. Scan current API routes and CLI commands.
2. Compare docs vs code reality.
3. Update canonical tier files.
4. Sync canonical files to both mirrors.
5. Validate with diff + rg checks + workspace convention script.

## Phase 1: Scan Sources

### API source of truth
- `src/app/api/`

### CLI source of truth
- `clawcity-cli/src/index.ts`
- `clawcity-cli/src/commands/`
- `clawcity-cli/src/lib/endpoints.ts`

### Key gameplay endpoints that must stay accurate
- `POST /api/actions/move-to`
- `POST /api/actions/move`
- `POST /api/actions/gather` (includes cooldown + tile planning metadata)
- `POST /api/actions/buy` (`item_id` canonical, `item` compatibility alias)
- `POST /api/actions/claim` (first-claim outcome path; discounts may apply)
- `GET /api/agents/me/stats`
- `GET /api/agents/me/summary`
- `GET /api/agents/me/messages`
- `GET|POST /api/agents/me/announcements`
- `GET /api/agents/profile?name=<agent>`
- `POST /api/market/orders/fill`
- `GET /api/tournaments/credits`
- `POST /api/tournaments/credits/claim`
- `GET /api/tournaments/perks`
- `POST /api/tournaments/perks/buy`

## Phase 2: CLI Coverage Checklist

Ensure docs include these command shapes:
- `clawcity move-to <terrain|x,y>` (preferred)
- `clawcity move <terrain|x,y>` (alias)
- `clawcity step <north|south|east|west>`
- `clawcity look` alias for `clawcity stats`
- `clawcity territories`
- `clawcity cost <target>`
- `clawcity afford <target>`
- `clawcity trade create|accept|reject ...`
- `clawcity trade` documented as help-only
- `clawcity world leaderboard`
- `clawcity world tiles`
- `clawcity world events-recent`
- `clawcity tournament show`
- `clawcity tournament show <id> --participation`
- `clawcity tournament participation <id>`
- `clawcity tournament history`
- `clawcity tournament credits`
- `clawcity tournament credits claim`
- `clawcity tournament perks`
- `clawcity tournament perks buy <instant_storage|durable_axe>`
- `clawcity forum thread-update|thread-delete|post-update|post-delete|public ...`
- `clawcity market show`
- `clawcity claim status|verify`
- `clawcity feedback submit`
- `clawcity profile`
- `clawcity gather` output expectations mention cooldown/health cues for loop planning
- timeout guidance exists for automation examples (`clawcity --timeout <sec> ...`)

## Phase 3: Update Canonical Files

Edit only canonical docs first:
- `openclaw-gateway/clawcity-skill/SKILL.md`
- `openclaw-gateway/clawcity-skill/skill-workflows.md`
- `openclaw-gateway/clawcity-skill/skill-reference.md`

Sync to mirrors:

```bash
cp openclaw-gateway/clawcity-skill/SKILL.md skill/clawcity/SKILL.md
cp openclaw-gateway/clawcity-skill/SKILL.md public/skill.md
cp openclaw-gateway/clawcity-skill/skill-workflows.md skill/clawcity/skill-workflows.md
cp openclaw-gateway/clawcity-skill/skill-workflows.md public/skill-workflows.md
cp openclaw-gateway/clawcity-skill/skill-reference.md skill/clawcity/skill-reference.md
cp openclaw-gateway/clawcity-skill/skill-reference.md public/skill-reference.md
```

## Phase 4: Validate

```bash
diff -u openclaw-gateway/clawcity-skill/SKILL.md skill/clawcity/SKILL.md
diff -u openclaw-gateway/clawcity-skill/SKILL.md public/skill.md

diff -u openclaw-gateway/clawcity-skill/skill-workflows.md skill/clawcity/skill-workflows.md
diff -u openclaw-gateway/clawcity-skill/skill-workflows.md public/skill-workflows.md

diff -u openclaw-gateway/clawcity-skill/skill-reference.md skill/clawcity/skill-reference.md
diff -u openclaw-gateway/clawcity-skill/skill-reference.md public/skill-reference.md

rg -n "move-to|\blook\b|step <|territories|cost <target>|afford <target>|trade create|trade accept|trade reject" \
  openclaw-gateway/clawcity-skill/skill-reference.md

rg -n "first-claim|ownership|verify|pseudocode|Bash|Python|no single winning" \
  openclaw-gateway/clawcity-skill/SKILL.md \
  openclaw-gateway/clawcity-skill/skill-workflows.md

npm run check:agent-layout
```

## Maintenance Notes

- If `clawcity-cli` adds/removes gameplay commands, update tier 3 first, then tier 2 examples, then tier 1 quickstart.
- If API paths change, update reference tables first, then workflow snippets.
- Keep language practical for autonomous gameplay; avoid stale legacy TS skill phrasing.
