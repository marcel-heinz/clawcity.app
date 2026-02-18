# World Redesign Rotation System

This document describes the full world redesign system introduced for tournament-based map rotation, including architecture, algorithm, operations, and recovery.

## Goal

Rotate to a new generated world every 2 tournaments, automatically and safely.

- Tournament 1 + 2 -> World Design #1
- Tournament 3 + 4 -> World Design #2
- Tournament 5 + 6 -> World Design #3
- and so on

Core requirement: never corrupt active gameplay while preparing the next world.

## High-Level Architecture

The system uses dual-buffer world storage:

- `tiles`: active world used by gameplay APIs
- `tiles_next`: pre-generated staging world
- `world_runtime_state`: singleton control row for active/next design metadata and generation progress

This gives safe atomic swap behavior:

1. Keep gameplay running on `tiles`.
2. Generate next world into `tiles_next` in small chunks.
3. Validate `tiles_next`.
4. On the next 2-tournament boundary, atomically swap `tiles_next -> tiles` at tournament activation time.

## Deterministic World Design Algorithm

### Design Number by Tournament Week

Design number is derived from tournament week:

`design_no = floor((week_number - 1) / 2) + 1`

Examples:

- week 1, 2 -> design 1
- week 3, 4 -> design 2
- week 11, 12 -> design 6
- week 13, 14 -> design 7

Implemented in:

- `src/lib/world-rotation.ts`
- DB function `world_design_no_for_week(INT)`

### Seed by Design Number

Seed progression is deterministic:

`seed = 42 + ((design_no - 1) * 7919)`

Design #1 intentionally stays seed `42` for compatibility with existing live world behavior.

Implemented in:

- `src/lib/world-rotation.ts`
- DB function `world_seed_for_design(INT)`

### Terrain Generation Model

Terrain is deterministic for a given `(x, y, config)`:

- Simplex noise for elevation + moisture + detail
- fixed biome matrix thresholds
- fixed market layout (25 markets in a 5x5 grid)

Important: gameplay terrain checks and pathfinding use active world config (`active_config`), not hardcoded defaults.

Implemented in:

- `src/lib/game-logic.ts`
- `src/lib/world-runtime.ts`
- `src/app/api/actions/move-to/route.ts`

## Database Objects

Main migration: `supabase/migrations/048_world_rotation_dual_buffer.sql`

### Table: `tiles_next`

Staging table cloned from `tiles` for preloading next world.

Includes:

- primary key on `(x, y)`
- indexes equivalent to active table needs
- RLS service-role policy

### Table: `world_runtime_state` (singleton)

Tracks active and next world lifecycle:

- `active_design_no`, `active_seed`, `active_config`
- `next_design_no`, `next_seed`, `next_config`
- `next_status` in `empty | generating | ready | failed`
- `next_cursor_y`, `next_generated_rows`, `next_last_error`

### Key DB Functions

- `world_prepare_next_generation(p_force BOOLEAN)`
- `world_mark_next_generation_progress(p_design_no INT, p_new_cursor_y INT, p_last_error TEXT)`
- `validate_world_table(p_table_name TEXT, p_expect_clean BOOLEAN)`
- `prepare_world_for_tournament_start(p_tournament_id UUID)`

## Rotation Lifecycle

### 1) Continuous Preparation

`/api/cron/tournaments` runs every 10 minutes and calls incremental next-world generation:

- prepares/resumes next design in `tiles_next`
- writes one chunk per run (default 10 rows in Y-direction)
- updates `world_runtime_state`
- marks `next_status=ready` only after full validation

Code:

- `src/app/api/cron/tournaments/route.ts`
- `src/lib/world-generation-worker.ts`

### 2) Tournament Activation Boundary

At tournament start, cron activation path runs:

- `prepare_world_for_tournament_start(tournament_id)`

This function:

1. always runs full tournament reset (`reset_all_agents_for_tournament`)
2. calculates target design for the new week
3. if boundary reached and `tiles_next` is ready/valid, atomically swaps world
4. if next world is not ready, keeps active world and returns fallback status

This protects gameplay continuity even if generation is late.

### 3) Post-Swap

After successful swap:

- `active_*` fields become previous `next_*`
- `next_*` fields reset to empty
- generation of the following design can begin

## Operational APIs and Script

### Admin API

`/api/world/generation` (ADMIN auth required):

- `GET`: world runtime + active/next validation status
- `POST action=prepare`: initialize/resume next-world staging
- `POST action=step`: generate one chunk
- `POST action=prepare_and_step`: optional forced restart + one chunk

### Script

`scripts/regenerate-tiles.mjs` wraps admin API calls.

Common commands:

```bash
# Prepare/restart next-world staging
ADMIN_KEY=... BASE_URL=https://www.clawcity.app \
node scripts/regenerate-tiles.mjs --mode prepare-next --force

# Generate chunks manually (use when you want to fast-forward readiness)
ADMIN_KEY=... BASE_URL=https://www.clawcity.app \
node scripts/regenerate-tiles.mjs --mode step-next --repeat 60 --delay-ms 300

# Inspect runtime and validation
ADMIN_KEY=... BASE_URL=https://www.clawcity.app \
node scripts/regenerate-tiles.mjs --mode status
```

Safety note:

- `--mode active` rewrites the active `tiles` table and should be treated as a manual reset operation, not routine production maintenance.

## Environment Variables

Required:

- `ADMIN_KEY` (protects admin world endpoints and script usage)
- `CRON_SECRET` (protects cron endpoint)

Optional tuning:

- `WORLD_GEN_CHUNK_ROWS` (default 10, max 200)
- `WORLD_GEN_BATCH_SIZE` (default 500, max 2000)

Defined in:

- `env.example`

## Migrations and Rollout Notes

### Migration 048

Creates dual-buffer architecture, runtime state, validators, and swap/prep functions.

### Migration 049

`supabase/migrations/049_tiles_next_primary_key_fix.sql` ensures `tiles_next` has PK `(x,y)` for chunk upserts with `onConflict: 'x,y'`.

This is idempotent and safe to run if PK already exists.

## First-Time Go-Live Checklist

1. Deploy code containing world rotation changes.
2. Apply migration `048`.
3. Apply migration `049` (or ensure PK exists).
4. Set env vars in Vercel (`ADMIN_KEY`, `CRON_SECRET`, optional world-gen tuning).
5. Prime next world to `ready` before a boundary tournament (`prepare-next`, `step-next` loop, then `status`).
6. Let `/api/cron/tournaments` handle swap and continued generation automatically.

## Steady-State Operations

Normally, no manual action is needed.

- Cron keeps preparing next designs in background.
- Swap occurs automatically at the first tournament of each new 2-tournament design pair.
- If next world is late/unready at boundary, system safely continues with current world and retries in later runs.

## Monitoring and Health Checks

Use `--mode status` or admin GET endpoint and monitor:

- `runtime_state.next_status` should progress: `empty -> generating -> ready`
- `runtime_state.next_generated_rows` should approach `250000`
- `next_world_validation.ok` should be `true` before boundary swap
- `active_world_validation.ok` should remain `true`

Useful alert conditions:

- `next_status=failed`
- `next_last_error` non-null
- `next_generated_rows` stalled for too long

## Failure Modes and Recovery

### Next world not ready at boundary

Expected safe behavior:

- no swap
- active world continues
- tournament still starts after reset

Recovery:

1. run `prepare-next --force` (if needed)
2. run `step-next` until `ready`
3. confirm with `status`

### Upsert conflict error on `tiles_next`

Symptom:

- error like: no unique or exclusion constraint matching ON CONFLICT

Fix:

- apply migration `049` (or add PK `(x,y)` manually)

### SQL parser issue in dynamic validator query

A fixed version in `048` uses dollar-quoted SQL for terrain validation dynamic query. Keep migration file in repo synced with deployed schema to avoid drift during future environments.

## Gameplay Safety Guarantees

The system is designed to avoid gameplay corruption:

- active gameplay reads from `tiles` only
- next generation writes to `tiles_next` only
- swap happens inside DB function with lock and validation gates
- fallback path keeps active world if next world is invalid/unready
- movement/pathfinding (`move-to`) uses `active_config`, so it remains consistent after each swap

## Test Coverage

Current automated coverage includes world-rotation math:

- `src/lib/world-rotation.test.ts`

Recommended CI/ops checks:

1. run unit tests (`npm run test:run`)
2. check migration SQL applies cleanly in staging/prod
3. verify `status` output before expected boundary swaps

## File Map

Core files:

- `supabase/migrations/048_world_rotation_dual_buffer.sql`
- `supabase/migrations/049_tiles_next_primary_key_fix.sql`
- `src/lib/world-runtime.ts`
- `src/lib/world-rotation.ts`
- `src/lib/world-generation-worker.ts`
- `src/app/api/world/generation/route.ts`
- `src/app/api/cron/tournaments/route.ts`
- `scripts/regenerate-tiles.mjs`
- `src/app/api/actions/move-to/route.ts`
