# World Designer System

Status: active MVP sandbox
Date: 2026-02-23
Owners: gameplay + platform + admin tools

## Purpose

World Designer is a private admin-only sandbox for designing and editing a 500x500 ClawCity world with terrain painting and elevation shaping, plus a live 3D preview window.

Primary goals in the current state:

- prove the world-designer UX end-to-end before production integration
- let admins start from a seeded random world and iterate visually
- validate terrain and elevation workflows without any database coupling
- keep all mutations local to the browser session unless exported as snapshot JSON

## Scope and Safety Boundary

Route and auth boundary:

- route: `/mrclhnz-dashboard/world-designer`
- linked from admin dashboard: `/mrclhnz-dashboard`
- auth gate: `/api/admin/auth` (same admin session model as other admin tools)

MVP isolation boundary:

- no world-designer writes to Supabase tables
- no gameplay runtime mutation
- no tournament, economy, or action API side effects
- no cron integration
- no production publish flow

Data lifetime in current MVP:

- world and elevation state are in-memory (`Uint8Array` refs)
- snapshots are browser-local (`localStorage`) unless manually exported/imported JSON

## User-Facing Capabilities (Current)

Editor layers:

- `terrain` layer
- `elevation` layer

Terrain tools:

- `Brush`
- `Rectangle`
- `Bucket`

Elevation tools:

- `Raise` (+1 step)
- `Lower` (-1 step)

World controls:

- regenerate seeded random world
- fill full world with selected terrain
- regenerate elevation from current seed

Navigation controls:

- `-` zoom out
- `Fit` fit full map
- `+` zoom in
- pan with right-click, middle-click, or hold `Space`

3D source controls:

- follow map center toggle
- manual source X/Y input
- pick source directly on map

Persistence controls:

- save snapshot (local)
- load snapshot (local)
- delete snapshot
- export selected snapshot as JSON
- import snapshot JSON

History:

- undo/redo with operation stack

## Core Files

- page and editor orchestration:
  - `src/app/mrclhnz-dashboard/world-designer/page.tsx`
- world-designer model and generation helpers:
  - `src/lib/world-designer.ts`
- 3D preview renderer:
  - `src/components/world-designer/WorldDesigner3DPreview.tsx`
- admin dashboard entry link:
  - `src/app/mrclhnz-dashboard/page.tsx`

## State Model

Primary world state:

- `worldRef: Uint8Array`
  - length: `WORLD_TILE_COUNT` (500x500 = 250,000)
  - each byte is terrain index into `WORLD_DESIGNER_TERRAINS`
- `elevationRef: Uint8Array`
  - length: 250,000
  - each byte is elevation level in `[0..ELEVATION_MAX_LEVEL]`
  - `ELEVATION_MAX_LEVEL = 15`

Supporting state:

- terrain counts (`countsRef` + `terrainCounts` state)
- editor mode (`editLayer`, tool selection, brush size)
- camera/view (`x`, `y`, `zoom`)
- preview source center (followed or manual)
- undo/redo stacks
- snapshot list + selected snapshot
- transient status and error messages

## Terrain Model

Supported terrain set (9):

1. plains
2. forest
3. mountain
4. market
5. water
6. rocky
7. sand
8. deep_water
9. marsh

Color palette source:

- `WORLD_DESIGNER_TERRAIN_COLORS` in `src/lib/world-designer.ts`

## Seeded World Generation

Implemented in:

- `generateSeededWorld(seed)` in `src/lib/world-designer.ts`

Pipeline:

1. Initialize 250,000-byte terrain buffer.
2. Place deterministic market tiles using a 5x5 macro-grid strategy.
3. Compute terrain noise per tile using weighted multi-scale value noise.
4. Compute moisture noise similarly.
5. Map elevation/moisture pair to biome terrain index.

Noise scales and weights:

- elevation blend:
  - scale 180, weight 0.58
  - scale 90, weight 0.29
  - scale 45, weight 0.13
- moisture blend:
  - scale 210, weight 0.60
  - scale 105, weight 0.27
  - scale 52, weight 0.13

Market placement:

- deterministic via `buildMarketSet(seed)`
- one market candidate per 100x100 macro cell in a 5x5 layout
- clamped into map bounds

## Seeded Elevation Generation

Implemented in:

- `generateSeededElevation(seed)` in `src/lib/world-designer.ts`

Pipeline:

1. Reuse elevation noise blend concept from terrain generation.
2. Shape base elevation with exponent curve: `pow(clamp(base, 0, 1), 1.1)`.
3. Convert to integer level:
   - `round(shaped * ELEVATION_MAX_LEVEL)`
4. Clamp to `[0..15]`.

Result:

- deterministic elevation map for a given seed
- compatible with terrain shading and 3D extrusion height

## 2D Rendering Pipeline (Main Map)

Rendering architecture:

- offscreen canvas stores full 500x500 world image
- visible canvas renders projected view window from offscreen source
- map viewport is square and clipped in the center panel

Relevant functions:

- `redrawOffscreenWorld()`
- `paintOffscreenTile(x, y)`
- `drawCanvas()`
- `getProjectionForState(viewState)`
- `getTileFromPointer(clientX, clientY)`

Elevation-aware color shading:

- per tile: base terrain RGB multiplied by elevation shade factor
- shade formula:
  - `elevationFactor = elevation / ELEVATION_MAX_LEVEL`
  - `shade = ELEVATION_SHADE_MIN + elevationFactor * ELEVATION_SHADE_RANGE`
  - current constants:
    - `ELEVATION_SHADE_MIN = 0.72`
    - `ELEVATION_SHADE_RANGE = 0.56`

Overlays:

- optional grid overlay when zoom is high enough (`zoom >= 2.4`)
- rectangle preview overlay while rectangle tool is dragging
- cyan dashed 3D-source window (`53x53`, derived from radius 26)
- map border stroke around visible world area

## Pointer and Coordinate Mapping

Current pointer-to-tile mapping:

- convert browser client coordinates to canvas pixel coordinates with DOM-to-canvas scale factors
- reject input outside canvas bounds
- project to world coordinates using current `src/dest` projection
- floor to tile index and clamp to `[0..499]`

This logic is centralized in:

- `getTileFromPointer()`

This is the basis for:

- brush alignment with cursor
- rectangle start/end tiles
- bucket start tile
- manual 3D source pick on map

## Zoom and Viewport Behavior

Constants:

- `MAX_ZOOM = 28`
- `MIN_ZOOM_FLOOR = 0.35`
- `ZOOM_STEP_FACTOR = 1.08`
- `ZOOM_SETTLE_EPSILON = 0.001`

Dynamic minimum zoom:

- computed from viewport size vs 500x500 world:
  - `fitZoomX = canvasWidth / WORLD_SIZE`
  - `fitZoomY = canvasHeight / WORLD_SIZE`
  - `minZoom = max(MIN_ZOOM_FLOOR, min(fitZoomX, fitZoomY))`

Behavior:

- first resize computes initial clamped view with fit semantics
- `Fit` animates to current computed minimum zoom
- `+` and `-` animate smoothly toward target zoom
- zoom pivot is canvas center in world space
- panning is clamped to map bounds

## Editing Model

### Terrain layer operations

Brush:

- circular brush footprint from selected size (`1, 3, 5, 9`)
- drag interpolation via Bresenham-style line stepping

Rectangle:

- drag start/end tile to fill axis-aligned rectangle

Bucket:

- flood fill connected component of starting terrain

### Elevation layer operations

Raise:

- increase elevation by `+1` per affected tile

Lower:

- decrease elevation by `-1` per affected tile

Elevation constraints:

- hard clamp in writer: `0..15`
- lowering below zero has no effect

### Shared operation stack

Operation model:

- begin operation -> collect changed indices and before/after values
- commit operation -> push to undo stack
- clear redo stack on new commit

Limits:

- `MAX_HISTORY = 160`

Undo/redo:

- replays stored values into terrain or elevation target layer
- terrain undo triggers count recomputation
- both terrain and elevation replay repaint changed tiles

## 3D Preview Integration

### Source extraction

Implemented in:

- `extractTileWindow(world, elevationMap, centerX, centerY, radius)`

Current source window:

- radius: `26`
- rendered tiles: `53x53` (`2*26+1`) before edge clipping
- source center can follow map center or be set manually

### 3D renderer

Implemented in:

- `WorldDesigner3DPreview` component

Per-tile geometry:

- each tile renders as a column (`BoxGeometry(1, columnHeight, 1)`)
- height basis:
  - `terrainTopY = tile.elevation * ELEVATION_UNIT_HEIGHT`
  - `ELEVATION_UNIT_HEIGHT = 0.14`
- floor baseline:
  - `TILE_FLOOR_Y = -0.24`
- water/deep_water apply negative top offset for surface depression

Material and color:

- top face uses terrain color
- side faces use darker tint (`factor 0.78`)
- bottom face uses deeper tint (`factor 0.55`)
- gives visible cliff/slope side walls for raised terrain

Decorative feature meshes (deterministic by tile seed):

- mountain: cone stacks
- forest: trees
- market: structure
- rocky: clustered stones
- sand: dune
- marsh: reeds

Camera behavior:

- drag to orbit (azimuth/polar)
- wheel zoom for preview camera distance
- camera target Y follows average elevation of current window

### Important 3D scope note

3D preview is intentionally local-window, not full-map render:

- always uses extracted tile window around chosen source center
- does not attempt to render all 500x500 tiles in 3D

## Snapshot System

Local persistence:

- key: `clawcity-world-designer-snapshots-v1`
- max: 10 snapshots

Snapshot schema:

- `id`
- `name`
- `createdAt`
- `seed`
- `worldBase64`
- optional `elevationBase64`

Backward compatibility:

- if imported/loaded snapshot lacks `elevationBase64`, elevation is regenerated from `seed`

Validation:

- import validates JSON shape
- validates world payload decodes to expected 250,000 length
- validates optional elevation payload decode if provided

## Keyboard and Input Shortcuts

Keyboard:

- `1..9`: select terrain palette slot
- `Ctrl/Cmd + Z`: undo
- `Ctrl/Cmd + Shift + Z` or `Ctrl/Cmd + Y`: redo
- hold `Space`: temporary pan mode with pointer

Pointer:

- left drag: paint/rectangle depending on tool
- middle/right drag: pan
- context menu suppressed on canvas

## UI Layout (Current)

Left panel:

- layer switch (terrain/elevation)
- tool buttons for active layer
- terrain palette
- brush size and grid toggle
- history controls
- world actions

Center panel:

- live map canvas
- layer/tool/terrain/elevation summary
- map center and 3D source coordinates
- zoom controls (`-`, `Fit`, `+`)

Right panel:

- 3D source reference controls
- 3D preview
- terrain breakdown counts
- snapshot management

## Current Non-Goals and Known Limits

- no DB save/publish pipeline yet
- no live game integration yet
- no multiplayer collaboration inside designer
- no symmetry painting mode
- no replace or eyedropper tool
- no elevation smooth/flatten tools
- no mini map surface (main map is primary editing surface)
- 3D preview window still uses wheel zoom (map has dedicated buttons)

## Recent Implementation Timeline

Relevant commits in this sequence:

1. `78674d3` add admin world designer MVP with 2D editor and 3D preview
2. `46380e8` cursor alignment and preview sync fixes
3. `b51bc63` cursor mapping and zoom controls improvements
4. `1563737` cursor projection and preview source controls
5. `14db565` zoom smoothness and preview sync improvements
6. `be0957c` map centering and 3D source behavior clarifications
7. `a539f55` tool simplification and initial map fit rendering fixes
8. `7bf2dcd` canvas sizing and first paint stabilization
9. `4a78fef` first-load render-after-auth fix
10. `95fca66` default status banner removal
11. `99591f9` elevation layer tools + 3D height integration
12. `75c51a5` elevation tool simplification and 3D side color rendering

## Testing and Verification

### Automated checks run for this implementation

Lint pass on touched world-designer files:

- command:
  - `npx eslint src/app/mrclhnz-dashboard/world-designer/page.tsx src/lib/world-designer.ts src/components/world-designer/WorldDesigner3DPreview.tsx`
- result:
  - pass (no lint errors)

Repository test suite run:

- command:
  - `npm run test:run -- --reporter=dot`
- result:
  - `Test Files 10 passed (10)`
  - `Tests 37 passed (37)`

### World-designer-specific test coverage status

Current state:

- no dedicated unit test file exists yet for world designer modules/components
- no dedicated integration/e2e automation exists yet for world-designer interactions

Validated currently by:

- lint checks
- regression checks from repository Vitest suite
- manual interactive verification during implementation (brush, zoom, source selection, elevation painting, snapshot behavior)

## Operational Guidance for Current MVP

Recommended usage flow:

1. Open admin dashboard and enter World Designer.
2. Start from generated seed or regenerate.
3. Paint terrain and/or elevation in separate layers.
4. Use `Fit` whenever viewport changes.
5. Adjust 3D source to inspect specific areas.
6. Save snapshots locally during experiments.
7. Export JSON for sharing or backup if needed.

Promotion criteria before production coupling:

1. define persistence contract for terrain + elevation writes
2. add validation and safety rules for production map updates
3. add dedicated automated tests for map editing and serialization
4. add explicit rollout and rollback plan
