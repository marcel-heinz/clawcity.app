---
name: cli-update
description: Audit, update, test, and publish the clawcity npm CLI from the repo-local CLI package.
---

# CLI Update Agent

This agent maintains the `clawcity` npm package used by gameplay agents and Railway runtime.

## Canonical Paths

- CLI package root: `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/clawcity-cli/`
- API source: `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/src/app/api/`
- Gameplay skill docs:
  - `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/openclaw-gateway/clawcity-skill/SKILL.md`
  - `/Users/marcelheinz/Desktop/clawcity.app-main-fresh/public/skill.md`

## Contract Rules

1. CLI supports gameplay/public/operational non-admin routes.
2. Reserved subscription/session routes remain excluded from CLI:
- `/api/builder/*`
- `/api/billing/*`
- `/api/user/profile`
3. Endpoint registry is authoritative for generic API coverage:
- `clawcity-cli/src/lib/endpoints.ts`
4. Keep compatibility aliases stable for autoplay resilience (`move-to`, `look`).
5. Keep onboarding CLI-first:
   - `clawcity install clawcity` remains the primary registration handoff.
   - Oracle guidance output must stay clear (`clawcity oracle`).

## Quick Start

1. Audit published npm state.
2. Scan local API/CLI drift.
3. Update CLI commands and endpoint registry.
4. Build and run local smoke tests.
5. Publish and verify `@latest`.

## Phase 1: Audit npm

```bash
npm view clawcity version
npm view clawcity versions --json
npm view clawcity time --json
```

## Phase 2: Scan for Drift

```bash
cd /Users/marcelheinz/Desktop/clawcity.app-main-fresh

rg -n "export async function (GET|POST|PUT|PATCH|DELETE)" src/app/api -g"route.ts"
rg -n "move-to|look|api request|builder|billing|user/profile" clawcity-cli/src -g"*.ts"
```

## Phase 3: Update CLI

Primary files:
- `clawcity-cli/src/index.ts`
- `clawcity-cli/src/commands/*.ts`
- `clawcity-cli/src/lib/api.ts`
- `clawcity-cli/src/lib/endpoints.ts`
- `clawcity-cli/README.md`
- `clawcity-cli/package.json`

Required checks when updating:
- command help and examples are accurate
- endpoint registry includes intended non-admin routes
- restricted routes are blocked in `api request`
- text endpoints parse safely (`/api/agents/me/summary`)
- gather formatter includes planning metadata when available (`Next`, `Health`, `Est`)
- shop/buy behavior is explicit: `item_id` canonical, legacy `item` compatibility handled server-side

## Phase 4: Build + Smoke Test

```bash
cd /Users/marcelheinz/Desktop/clawcity.app-main-fresh
npm --prefix clawcity-cli install
npm --prefix clawcity-cli run build

node clawcity-cli/dist/index.js --help
node clawcity-cli/dist/index.js move-to forest --help
node clawcity-cli/dist/index.js look --help
node clawcity-cli/dist/index.js api list
```

## Phase 5: Publish

```bash
cd /Users/marcelheinz/Desktop/clawcity.app-main-fresh/clawcity-cli
npm whoami
npm publish
```

Post-publish:

```bash
npx clawcity@latest --version
npx clawcity@latest move-to forest --help
npx clawcity@latest api list
```

## Validation Checklist

- [ ] README reflects current command catalog
- [ ] `files` in `clawcity-cli/package.json` includes `README.md` so npm package shows docs
- [ ] Reserved routes exclusion is documented
- [ ] New version is semver-correct
- [ ] No stale clawhub-era migration language in active instructions
- [ ] Railway-relevant alias behavior is covered by examples
- [ ] Gather output formatting covers cooldown + tile planning hints
