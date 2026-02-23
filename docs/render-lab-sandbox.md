# Render Lab Sandbox

Status: active baseline
Date: 2026-02-23
Owners: gameplay + platform + admin tools

## Purpose

Render Lab is the private admin sandbox for testing visual world direction before any gameplay integration.

It is used to evaluate:

- terrain realism (shape, relief, mountain readability)
- style variants (asset packs and A/B compare)
- prototype open-world visuals (roads, settlements, structure silhouettes)
- render performance tradeoffs (FPS, draw calls, triangles, memory)

## Safety Boundary

Render Lab is intentionally isolated from live gameplay systems.

- Route is admin-only: `/mrclhnz-dashboard/render-lab`.
- Auth is through existing admin auth endpoint: `/api/admin/auth`.
- Live data reads come from `/api/world/tiles` only.
- No Render Lab flow mutates game actions, tournaments, or world runtime.
- No database schema changes are required for Render Lab operation.

Production gameplay routes (`/`, `/tournament`, `/api/actions/*`) are unchanged by sandbox usage.

## Sandbox Surfaces

### Data Source Modes

1. Live tiles
2. Snapshot replay

Live mode samples tiles from world API using:

- `centerX`
- `centerY`
- `radius`
- `sample`

Snapshot mode supports:

- save current tile set
- select and replay snapshots
- export/import JSON
- local browser persistence (max 5 snapshots)

## Rendering Architecture (Current)

Core viewport implementation:

- `src/components/render-lab/RenderLabViewport.tsx`

### Terrain Mesh

Render Lab no longer uses one flat ground plane per tile. It builds chunk terrain meshes with a procedural height map.

High-level pipeline:

1. Build `tileByKey` lookup from input tiles.
2. Compute per-tile height from terrain profile + deterministic noise.
3. Add mountain/rocky neighborhood influence.
4. Smooth heights with two neighborhood passes.
5. Build chunk geometry (`CHUNK_SIZE=12`) with shared vertices.
6. Compute vertex colors by blending nearby tile ground colors.

### Terrain Profiles

Each asset pack provides:

- `terrainProfile` (base heights + macro/micro/ridge noise + water level)
- `roadStyle` (base/line/shoulder road colors)

Current pack IDs:

- `current`
- `wildlands`
- `citadel`
- `frontier` (new open-world realism sandbox pack)

Asset pack definitions:

- `src/lib/render-lab/asset-packs.ts`

### Features, Roads, and Settlements

Feature placement remains deterministic per tile seed and now includes sandbox-only layout synthesis:

- road network generation between hubs and settlements
- settlement prototype placement by terrain suitability and density controls
- optional road overlay rendering (base + shoulder + center line)

These roads and settlements are visual-only prototypes and do not create gameplay buildings or pathing rules.

### Horizon and Distance Behavior

To improve world-scale perception and performance:

- optional horizon mountain ring
- far-detail fallback meshes for distant tiles
- chunk visibility culling based on camera target and `renderDistance`

## Prototype Structures

Prototype building types in sandbox:

- existing: `watchtower`, `windmill`, `greenhouse`, `foundry`
- added: `cottage`, `townhouse`, `barn`, `hall`

These are Render Lab-only prototypes for art/readability tests.

## Lab Controls

Control surface in:

- `src/app/mrclhnz-dashboard/render-lab/page.tsx`

Key controls:

- A/B compare toggle
- camera preset
- asset pack selectors (left/right)
- feature density
- prototype density
- terrain relief
- mountain boost
- road density
- settlement density
- render distance
- road overlay toggle
- settlement overlay toggle
- horizon mountains toggle
- grid helper
- lighting, fog, exposure controls

## Performance Instrumentation

Performance panel tracks both A/B variants:

- FPS
- frame time (ms)
- draw calls
- triangles
- geometries
- textures

Metrics are sampled from Three.js renderer info and updated continuously.

## Non-Goals (Current)

- No gameplay write-path integration.
- No production world generation changes.
- No tournament logic or economy impact.
- No persistence of roads/settlements to game state.
- No client-facing release guarantees for sandbox visuals.

## Recommended Workflow

1. Load live tiles for a representative area.
2. Save snapshots before major control changes.
3. Use A/B compare to evaluate pack and control deltas.
4. Watch performance panel while increasing realism controls.
5. Export snapshot JSON for repeatable team review.

## Promotion Rule

Visual ideas validated in Render Lab should only move into gameplay after:

1. explicit design approval
2. performance budget validation on target devices
3. implementation plan that preserves gameplay stability
4. separate production integration PR/commit stream
