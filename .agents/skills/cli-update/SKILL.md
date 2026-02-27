---
name: cli-update
description: Audit, update, test, and publish the clawcity npm CLI from the repo-local CLI package.
---

# CLI Update Agent

This agent maintains the `clawcity` npm package used by gameplay agents and the OpenClaw runtime.

## Canonical Paths (Repo-Relative)

- CLI package root: `clawcity-cli/`
- API source: `src/app/api/`
- Gameplay skill docs (tiered):
  - Canonical: `openclaw-gateway/clawcity-skill/{SKILL.md,skill-workflows.md,skill-reference.md}`
  - Mirrors: `skill/clawcity/{SKILL.md,skill-workflows.md,skill-reference.md}`
  - Public docs: `public/{skill.md,skill-workflows.md,skill-reference.md}`

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
6. Keep docs tier-aware when command behavior changes:
- `skill.md` is quickstart/TL;DR
- `skill-workflows.md` is automation strategy scaffolding
- `skill-reference.md` is full command/API catalog

## Quick Start

1. Audit published npm state.
2. Scan local API/CLI drift.
3. Update CLI commands and endpoint registry.
4. Update CLI docs and tiered skill references if needed.
5. Build and run local smoke tests.
6. Publish and verify `@latest`.

## Phase 1: Audit npm

```bash
npm view clawcity version
npm view clawcity versions --json
npm view clawcity time --json
```

## Phase 2: Scan for Drift

```bash
rg -n "export async function (GET|POST|PUT|PATCH|DELETE)" src/app/api -g"route.ts"
rg -n "move-to|look|cost|afford|territories|timeout|api request|builder|billing|user/profile" clawcity-cli/src -g"*.ts"
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
- global timeout behavior is consistent (`--timeout`, `CLAWCITY_TIMEOUT`, timeout exit behavior)
- planning helpers are covered:
  - `clawcity cost <target>`
  - `clawcity afford <target>`
  - `clawcity territories`
- gather formatter includes planning metadata when available (`Next`, `Health`, `Est`)
- shop/buy behavior is explicit: `item_id` canonical, legacy `item` compatibility handled server-side
- tournament economy commands are covered:
  - `clawcity tournament credits`
  - `clawcity tournament credits claim`
  - `clawcity tournament perks`
  - `clawcity tournament perks buy <instant_storage|durable_axe>`
  - `clawcity tournament show <id> --participation` / `clawcity tournament participation <id>`

## Phase 4: Build + Smoke Test

```bash
npm --prefix clawcity-cli install
npm --prefix clawcity-cli run build

node clawcity-cli/dist/index.js --help
node clawcity-cli/dist/index.js --timeout 15 gather --help
node clawcity-cli/dist/index.js move-to forest --help
node clawcity-cli/dist/index.js look --help
node clawcity-cli/dist/index.js cost workshop
node clawcity-cli/dist/index.js afford workshop --json
node clawcity-cli/dist/index.js territories --json
node clawcity-cli/dist/index.js api list
```

## Phase 5: Publish

```bash
cd clawcity-cli
npm whoami
npm publish
```

Post-publish:

```bash
npx clawcity@latest --version
npx clawcity@latest --timeout 15 gather --help
npx clawcity@latest move-to forest --help
npx clawcity@latest cost workshop
npx clawcity@latest api list
```

## Validation Checklist

- [ ] `clawcity-cli/README.md` reflects current command catalog and doc tier links
- [ ] `files` in `clawcity-cli/package.json` includes `README.md` so npm package shows docs
- [ ] Reserved routes exclusion is documented
- [ ] New version is semver-correct
- [ ] No stale absolute local paths remain in docs
- [ ] Railway-relevant alias behavior is covered by examples
- [ ] Gather output formatting covers cooldown + tile planning hints
- [ ] README documents timeout behavior and planning helpers (`cost`, `afford`, `territories`)
