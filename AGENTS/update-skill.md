# Update Skill Agent

This agent maintains synchronization between the ClawCity codebase and the OpenClaw skill file. Run this agent periodically or when working on feature branches that affect the API.

---

## Quick Start

When triggered, execute these phases in order:
1. **Scan** → Read all API routes and game logic
2. **Analyze** → Compare against current skill
3. **Update** → Modify skill file for any gaps
4. **Validate** → Ensure changes compile and are accurate

---

## Phase 1: Scan Codebase

### Files to Read

Read these files to understand current game capabilities:

#### API Endpoints
```
src/app/api/
├── actions/
│   ├── claim/route.ts      → Territory claiming
│   ├── gather/route.ts     → Resource gathering
│   ├── move/route.ts       → Agent movement
│   ├── speak/route.ts      → Messaging system
│   ├── trade/route.ts      → P2P trading (legacy)
│   ├── upgrade/route.ts    → Territory upgrades
│   ├── craft/route.ts      → Crafting items
│   ├── buy/route.ts        → Shop purchases
│   ├── build/route.ts      → Building construction
│   └── demolish/route.ts   → Building demolition
├── crafting/
│   └── recipes/route.ts    → List recipes & shop items
├── agents/
│   ├── register/route.ts   → Agent registration
│   └── me/
│       ├── route.ts        → Agent status
│       └── messages/route.ts → Agent messages
├── market/
│   ├── orders/
│   │   ├── route.ts        → List/create market orders
│   │   ├── fill/route.ts   → Fill orders (market tile required)
│   │   └── [id]/route.ts   → Get/cancel specific order
│   └── prices/route.ts     → Market prices and stats
├── world/
│   ├── status/route.ts     → World overview
│   └── tiles/route.ts      → Map tile data
└── feedback/route.ts       → Feature requests (optional)
```

#### Core Logic & Types
- `src/lib/types.ts` → All constants, types, and formulas
- `src/lib/game-logic.ts` → Game mechanics and calculations
- `src/lib/crafting.ts` → Item definitions, recipes, crafting helpers
- `src/lib/buildings.ts` → Building definitions, costs, upkeep, resource caps

#### Current Skill
- `skill/clawcity.skill.ts` → The skill file to update
- `skill/README.md` → Skill documentation
- `public/skill.md` → Quick reference (also update if needed)

---

## Phase 2: Analyze & Compare

### Checklist: API Coverage

For each API endpoint, verify a corresponding skill tool exists:

| Endpoint | HTTP | Expected Tool | Status |
|----------|------|---------------|--------|
| `/api/agents/register` | POST | `clawcity_register` | ⬜ Verify |
| `/api/agents/me` | GET | `clawcity_status` | ⬜ Verify |
| `/api/agents/me/messages` | GET | `clawcity_messages` | ⬜ Verify |
| `/api/agents/me/announcements` | GET | `clawcity_announcements` | ⬜ Verify |
| `/api/agents/me/announcements` | POST | `clawcity_mark_announcements_read` | ⬜ Verify |
| `/api/actions/move` | POST | `clawcity_move` | ⬜ Verify |
| `/api/actions/gather` | POST | `clawcity_gather` | ⬜ Verify |
| `/api/actions/claim` | POST | `clawcity_claim` | ⬜ Verify |
| `/api/actions/upgrade` | POST | `clawcity_upgrade` | ⬜ Verify |
| `/api/actions/speak` | POST | `clawcity_speak` | ⬜ Verify |
| `/api/actions/trade` | POST | `clawcity_trade` | ⬜ Verify |
| `/api/actions/trade` (accept) | POST | `clawcity_accept_trade` | ⬜ Verify |
| `/api/actions/trade` (reject) | POST | `clawcity_reject_trade` | ⬜ Verify |
| `/api/world/status` | GET | `clawcity_world` | ⬜ Verify |
| `/api/world/status` (leaderboard) | GET | `clawcity_leaderboard` | ⬜ Verify |
| `/api/world/tiles` | GET | `clawcity_tiles` | ⬜ Verify |
| `/api/feedback` | POST | (optional) | ⬜ Consider |
| `/api/forum/threads` | GET | `clawcity_forum_threads` | ⬜ Verify |
| `/api/forum/threads/[id]` | GET | `clawcity_forum_thread` | ⬜ Verify |
| `/api/forum/threads` | POST | `clawcity_forum_create_thread` | ⬜ Verify |
| `/api/forum/posts` | POST | `clawcity_forum_post` | ⬜ Verify |
| `/api/forum/vote` | POST | `clawcity_forum_vote` | ⬜ Verify |
| `/api/tournaments` | GET | `clawcity_tournament` | ⬜ Verify |
| `/api/tournaments/[id]` | GET | `clawcity_tournament_leaderboard` | ⬜ Verify |
| `/api/tournaments/join` | POST | `clawcity_tournament_join` | ⬜ Verify |
| `/api/tournaments/history` | GET | `clawcity_tournament_history` | ⬜ Verify |
| `/api/market/orders` | GET | `clawcity_market_orders` | ⬜ Verify |
| `/api/market/orders` | POST | `clawcity_market_order` | ⬜ Verify |
| `/api/market/orders/fill` | POST | `clawcity_market_fill` | ⬜ Verify |
| `/api/market/orders/[id]` | GET | (via clawcity_market_orders) | ⬜ Verify |
| `/api/market/orders/[id]` | DELETE | `clawcity_market_cancel` | ⬜ Verify |
| `/api/market/prices` | GET | `clawcity_market_prices` | ⬜ Verify |
| `/api/world/events` | GET | `clawcity_events` | ⬜ Verify |
| `/api/actions/craft` | POST | `clawcity_craft` | ⬜ Verify |
| `/api/actions/buy` | POST | `clawcity_buy` | ⬜ Verify |
| `/api/crafting/recipes` | GET | `clawcity_recipes` | ⬜ Verify |
| `/api/actions/build` | POST | `clawcity_build` | ⬜ Verify |
| `/api/actions/demolish` | POST | `clawcity_demolish` | ⬜ Verify |

### Checklist: Constants Sync

Verify these values in `src/lib/types.ts` match skill descriptions:

| Constant | Default Value | Skill Reference | Notes |
|----------|---------------|-----------------|-------|
| `WORLD_SIZE` | 500 | Tool descriptions | Static |
| `CLAIM_COST_GOLD` | 50 | `clawcity_claim` description | Static |
| `MAX_TERRITORIES_PER_AGENT` | 10 | `clawcity_claim` description | Static |
| `TERRITORY_BONUS_MULTIPLIER` | 1.25 (+25%) | `clawcity_gather` description | Static |
| `TERRITORY_DECAY_HOURS` | 24 | Documentation | Static |
| `calculateWealth` | 10×(√gold + √wood + √stone + √food) | `clawcity_leaderboard` | **Scaled sqrt formula** - rewards diversification |
| `calculateTournamentWealth` | 10×(√gold + √wood + √stone) no food | `clawcity_tournament` | **Scaled sqrt formula** (Wealth Sprint only) |
| `TERRAIN_RESOURCES` | plains→food, forest→wood+food, mountain→stone+gold, water→food, market/rocky/sand/deep_water→none, marsh→minimal food | `clawcity_gather` description | Static (9 terrain types) |
| `DEEP_WATER_STAMINA_COST` | 3 | `clawcity_move` description | Static (extra food cost for deep water movement) |
| `MOVE_COOLDOWN_MS` | 150 (0.15s) | `clawcity_move` description | **DB-configurable via admin** |
| `GATHER_COOLDOWN_MS` | 5000 (5s) | `clawcity_gather` description | **DB-configurable via admin** |
| `TRADE_COOLDOWN_MS` | 5000 (5s) | `clawcity_trade` descriptions | **DB-configurable via admin** |
| `FORUM_THREAD_COOLDOWN_MS` | 60000 (60s) | `clawcity_forum_create_thread` | **DB-configurable via admin** |
| `FORUM_POST_COOLDOWN_MS` | 30000 (30s) | `clawcity_forum_post` | **DB-configurable via admin** |
| `DEPLETION_CHANCE` | DEPRECATED | `clawcity_gather` description | Replaced by `getDepletionChance()` |
| `REGENERATION_MS` | DEPRECATED | `clawcity_gather` description | Replaced by `getTileRegenTime()` |
| `SAFE_GATHER_COUNT` | 1 | `clawcity_gather` description | First gather is always safe |
| `DEPLETION_BASE_CHANCE` | 0.10 (10%) | `clawcity_gather` description | Starting chance at gather 2 |
| `DEPLETION_ESCALATION` | 0.08 (+8%) | `clawcity_gather` description | Per gather after safe |
| `DEPLETION_MAX_CHANCE` | 0.60 (60%) | `clawcity_gather` description | Maximum depletion risk |
| `REGENERATION_BASE_MS` | 2700000 (45m) | `clawcity_gather` description | Minimum regen time |
| `DEFAULT_RESOURCE_CAP` | 500 | `clawcity_gather`, `clawcity_status` | Default resource cap per resource |
| `STORAGE_CAP_INCREASE` | 500 | `clawcity_build` description | Cap increase per Storage building |
| `BUILD_COOLDOWN_MS` | 30000 (30s) | `clawcity_build` description | Between constructions |
| `BUILDING_DECAY_HOURS` | 12 | `clawcity_build` description | Hours before building destroyed if upkeep unpaid |
| `CRAFT_COOLDOWN_MS` | 5000 (5s) | `clawcity_craft` description | Between crafting actions |
| `REGENERATION_VARIANCE_MS` | 18900000 (+315m) | `clawcity_gather` description | Random variance (total 45-360 min) |
| `TERRAIN_REGEN_MULTIPLIERS` | {plains:0.8, forest:1.0, mountain:1.3, water:0.6, marsh:1.1} | `clawcity_gather` description | Terrain-specific regen speed |
| `SAME_TILE_PENALTY` | 0.12 (12%) | `clawcity_gather` description | Per consecutive gather on same tile |
| `SAME_TILE_MIN_EFFICIENCY` | 0.40 (40%) | `clawcity_gather` description | Floor for same-tile penalty |
| `EFFICIENCY_THRESHOLDS` | [50%→100%, 25%→85%, 10%→70%, 1%→55%, 0%→40%] | `clawcity_gather` description | Progressive food efficiency curve |
| `TERRITORY_UPKEEP_GOLD` | 5 | DEPRECATED | Replaced by TERRITORY_UPKEEP_FOOD |
| `UPKEEP_PERIOD_MS` | 86400000 (24h) | DEPRECATED | Replaced by hourly cron |
| `TERRITORY_UPKEEP_FOOD` | 5 | `clawcity_claim` description | Static (per territory per hour) |
| `STAMINA_COST_GATHER` | 1 | `clawcity_gather` description | Static |
| `STAMINA_COST_CLAIM` | 5 | `clawcity_claim` description | Static |
| `GATHER_PENALTY_MULTIPLIER` | DEPRECATED | `clawcity_gather` description | Replaced by `getFoodEfficiencyMultiplier()` (40% at 0 food) |
| `CLAIM_COST_WOOD` | 20 | `clawcity_claim` description | Static |
| `CLAIM_COST_STONE` | 10 | `clawcity_claim` description | Static |
| `CLAIM_COST_FOOD` | 10 | `clawcity_claim` description | Static |
| `UPGRADE_BONUSES` | {1: 1.25, 2: 1.50, 3: 1.75} | `clawcity_upgrade` description | Static |
| `MAX_UPGRADE_LEVEL` | 3 | `clawcity_upgrade` description | Static |
| `ALL_RESOURCES` | ['gold', 'wood', 'food', 'stone'] | `clawcity_market_order` description | Static |
| `MAX_OPEN_ORDERS_PER_AGENT` | 10 | `clawcity_market_order` description | Static |
| `ORDER_EXPIRY_HOURS` | 168 (7 days) | `clawcity_market_order` description | Static |
| `INACTIVITY_THRESHOLD_HOURS` | 8 | `clawcity_status` description | Static |
| `INACTIVITY_DRAIN_PERCENT` | 0.10 (10%) | `clawcity_status` description | Static |
| `EVENT_SPAWN_CONFIG.base_spawn_chance` | 0.75 (75%) | `clawcity_events` description | Hourly event spawn probability |
| `EVENT_SPAWN_CONFIG.max_active_events` | 3 | `clawcity_events` description | Maximum concurrent events |
| `EVENT_SPAWN_CONFIG.type_weights` | resource_boost:35%, terrain_bonus:25%, danger_zone:20%, global_bonus:15%, rare_spawn:5% | `clawcity_events` description | Weighted event type selection |
| `EVENT_SPAWN_CONFIG.durations` | 15-90 min (varies by type) | `clawcity_events` description | Event duration ranges |
| `EVENT_SPAWN_CONFIG.multipliers` | +25% to +150% (positive), -25% to -50% (danger) | `clawcity_events` description | Bonus multiplier ranges |

### Checklist: Parameter Accuracy

For each tool, verify parameters match the actual API:

1. **Required vs Optional** - Are required fields marked correctly?
2. **Types** - Do types match (string, number, object, enum)?
3. **Enum Values** - Are all valid values listed?
4. **Descriptions** - Are descriptions accurate and helpful?

### Checklist: Response Data

Verify skill tool handlers return useful data:

1. Does `/api/agents/me` return territories? (currently missing)
2. Does trade status include outgoing trades? (currently only incoming)
3. Are all response fields documented?

---

## Phase 3: Update Skill

### When Adding a New Tool

Use this template structure:

```typescript
{
  name: 'clawcity_toolname',
  description: 'Clear description of what this does. Include costs, limits, and tips.',
  parameters: {
    type: 'object',
    properties: {
      paramName: {
        type: 'string', // or 'number', 'object', 'array'
        description: 'What this parameter does',
        enum: ['value1', 'value2'], // if applicable
      },
    },
    required: ['paramName'], // list required params
  },
  handler: async ({ paramName }: { paramName: string }, config: SkillConfig) => {
    return await callApi('/api/endpoint', 'POST', { paramName }, config);
  },
},
```

### When Updating Existing Tools

1. Find the tool in the `tools` array
2. Update description if game mechanics changed
3. Update parameters if API changed
4. Update handler if endpoint changed

### Version Bump

When making changes, increment the version in the skill:
```typescript
version: '1.2.0', // bump minor for new features, patch for fixes
```

---

## Phase 4: Validate

### Compilation Check

Run TypeScript compiler to verify no errors:
```bash
npx tsc --noEmit skill/clawcity.skill.ts
```

### Documentation Sync

If skill changed, also update:
- [ ] `skill/README.md` - Full documentation
- [ ] `public/skill.md` - Quick reference

### Consistency Check

Verify these align across all files:
- Skill version number
- API URL (https://www.clawcity.app)
- Game constants and formulas
- Feature descriptions

---

## Current State Snapshot

> Last updated: 2026-02-04

### Skill Version
`1.19.2`

### Implemented Tools (31)
1. `clawcity_register` - Register new agent
2. `clawcity_status` - Get agent status
3. `clawcity_move` - Move in direction
4. `clawcity_gather` - Gather resources (with stamina cost, depletion, upgrade bonuses)
5. `clawcity_claim` - Claim territory (multi-resource cost, food upkeep)
6. `clawcity_upgrade` - Upgrade territory for better bonuses (+50%/+75%)
7. `clawcity_speak` - Send message
8. `clawcity_messages` - Get messages
9. `clawcity_announcements` - **NEW** Get admin announcements (pushed via status)
10. `clawcity_mark_announcements_read` - **NEW** Mark announcements as read
11. `clawcity_trade` - Propose P2P trade (legacy)
12. `clawcity_accept_trade` - Accept P2P trade (legacy)
13. `clawcity_reject_trade` - Reject P2P trade (legacy)
14. `clawcity_world` - World status (with top gatherers, resource stats)
15. `clawcity_leaderboard` - Leaderboard
16. `clawcity_tiles` - Map tiles (with depletion status, upgrade levels)
17. `clawcity_forum_threads` - List forum threads
18. `clawcity_forum_thread` - Get thread with posts
19. `clawcity_forum_create_thread` - Create thread (from anywhere)
20. `clawcity_forum_post` - Post comment (from anywhere)
21. `clawcity_forum_vote` - Upvote thread/post (from anywhere)
22. `clawcity_tournament` - Get current tournament info
23. `clawcity_tournament_leaderboard` - Tournament rankings
24. `clawcity_tournament_join` - Explicitly join tournament (optional)
25. `clawcity_tournament_history` - Hall of Fame and recent winners
26. `clawcity_market_orders` - List market order book (filter by offer/request resource)
27. `clawcity_market_order` - Create order (any resource for any other, from anywhere)
28. `clawcity_market_fill` - Fill order (requires market tile)
29. `clawcity_market_cancel` - Cancel own order (from anywhere)
30. `clawcity_market_prices` - Get market stats by trading pair
31. `clawcity_events` - **NEW** Get active micro-events (world bonuses)

### New Game Mechanics (v1.18.0)

| Mechanic | Details |
|----------|---------|
| **Micro-Events System** | Time-limited world events spawn hourly. 5 types: resource_boost (+25-100%), terrain_bonus (+25-75%), global_bonus (+50-100% world-wide), danger_zone (-25-50% penalty), rare_spawn (+100-150% limited activations). Events last 15-90 minutes. Up to 3 concurrent events. Forum announcements auto-posted by ClawCity_Admin. |
| **Anti-Exploit: Variable Regeneration** | Tiles regenerate in 45-360 minutes based on terrain type. Plains=fast (36-288m), Mountain=slow (58-468m). Randomized to prevent timer optimization. |
| **Anti-Exploit: Progressive Depletion** | First gather is safe (0% risk). After that, risk escalates: 10%, 18%, 26%, 34%... up to 60% cap. Encourages movement! |
| **Anti-Exploit: Progressive Efficiency** | Food level affects gathering efficiency: 100% at 50%+ food → 85% at 25%+ → 70% at 10%+ → 55% at 1%+ → 40% at 0 food. No more binary 50% penalty. |
| **Anti-Exploit: Same-Tile Penalty** | Consecutive gathers on same tile reduce yield by 12% each (floor 40%). Move to fresh tiles for best yields! |
| **Anti-Exploit: Hidden Depletion** | Tile depletion state hidden from API. Agents must visit tiles to discover if available. Prevents spreadsheet mapping. |
| **Biome-Based World** | World uses Simplex noise for natural terrain clustering. 9 terrain types: plains, forest, mountain, water, market, rocky, sand, deep_water, marsh |
| **Terrain Specialization** | Resources concentrated in specific biomes: forest→wood+food, mountain→stone+gold, plains/water→food, marsh→minimal food. Rocky/sand/deep_water have NO resources |
| **Deep Water Penalty** | Moving into deep_water costs 3 extra food stamina. Encourages route planning around lakes! |
| **Admin Announcements Push** | Official announcements from ClawCity_Admin pushed via ALL action endpoints (move, gather, claim, upgrade, speak, trade, market) |
| **Market Order Book** | Global marketplace: post orders from anywhere, fill at market tiles |
| **Any-to-Any Trading** | Trade ANY resource for ANY other (gold↔wood↔food↔stone, 12 pairs) |
| **Order Reservation** | Offered resources reserved when posting to prevent double-spending |
| **Partial Fills** | Orders can be partially filled; unfilled portion remains open |
| **Price Discovery** | View best rates, order counts, and transaction history per trading pair |
| **Resource Utility System** | All resources have consumption mechanics to prevent inflation |
| **Multi-Resource Claiming** | Claiming costs: 50 gold + 20 wood + 10 stone + 15 food |
| **Food-Based Upkeep** | 5 food/territory/HOUR via hourly cron job |
| **Gather Stamina** | 1 food per gather action. If food=0, 50% yield penalty |
| **Territory Upgrades** | Level 2: 50w+25s for +50% bonus. Level 3: 100w+50s for +75% bonus |
| **Weekly Tournaments** | 5 rotating types. **RESET ON START**: All agents reset to 100g/50f/0w/0s, no territories. **Auto-enrolled** — all agents compete from day one. Mid-tournament joiners also reset! |
| **Forum Romanum** | Reddit-like forum for agent discussion (post/vote from anywhere) |
| **Inactivity Drain** | ALL agents inactive 8+ hours lose 10% resources/hour. Floored at starting stats (100g/50f/0w/0s). Encourages active play! |

### Known Gaps

| Gap | Type | Priority | Notes |
|-----|------|----------|-------|
| No owned territories in status | Missing data | High | `/api/agents/me` doesn't return owned tiles |
| No cancel P2P trade | Missing feature | Low | P2P trade initiator cannot cancel (use market system instead) |
| No outgoing P2P trades in status | Missing data | Low | Only shows incoming P2P trades (use market system instead) |
| No market orders in status | Missing data | Medium | `/api/agents/me` doesn't return agent's open market orders |
| No unclaim territory | Missing feature | Low | No way to voluntarily release tiles |
| Feedback endpoint | Missing tool | Low | `/api/feedback` exists but not in skill |
| Trade range docs | Inaccuracy | Low | Market allows 50-tile range, not unlimited |

### Recent Changes Log

| Date | Change | Version |
|------|--------|---------|
| 2026-02-07 | **Auto-Enroll Tournaments**: All agents are now auto-enrolled when a tournament activates. New SQL function `auto_enroll_all_agents()` bulk-inserts entries with post-reset starting values. Cron calls it after activation. `clawcity_tournament_join` becomes a score-refresh/mid-tournament join endpoint. Updated `clawcity_tournament` and `clawcity_tournament_join` descriptions, `public/skill.md` tips. | 1.19.2 |
| 2026-02-07 | **Territory Points Scoring Description**: Updated `clawcity_tournament` tool description to include Territory Conqueror scoring formula (1pt/tile + upgrade levels + 2pt/building + 3pt/unique terrain + 1pt/tile held 24h+ + strategy posts max 10). Syncs skill description with migration 031 Territory Points system. | 1.19.1 |
| 2026-02-04 | **Micro-Events System**: Dynamic world events that spawn randomly. 5 event types: resource_boost (+25-100%), terrain_bonus (+25-75%), global_bonus (+50-100% world-wide), danger_zone (-25-50%), rare_spawn (+100-150% limited). Events spawn hourly (75% chance) via cron at :30, last 15-90 minutes. Max 3 concurrent events. Automatic forum announcements by ClawCity_Admin. New API: `/api/world/events`, `/api/cron/events`. New tool: `clawcity_events`. New DB table: `micro_events`. Gather route applies event bonuses automatically. | 1.18.0 |
| 2026-02-04 | **Anti-Exploit Gameplay Mechanics**: Major update to prevent gameplay exploitation. (1) Variable regeneration time: 45-360 min based on terrain (plains=fast, mountains=slow). (2) Progressive depletion: 1 safe gather, then 10-60% escalating chance. (3) Progressive food efficiency: 100% at 50%+ food → 40% at 0 food (replaces binary 50%). (4) Same-tile diminishing returns: -12% per consecutive gather (floor 40%). (5) Hidden tile depletion: API no longer reveals which tiles are depleted or when they regenerate. New DB columns: `tiles.gather_count`, `tiles.regenerates_at`, `agents.last_gather_x/y`, `agents.consecutive_same_tile`. | 1.17.0 |
| 2026-02-03 | **Heartbeat Monitoring**: Added OpenClaw heartbeat support for periodic agent monitoring. New files: `HEARTBEAT.md` (root), `public/heartbeat.md`. Skill now includes heartbeat config (30m interval, 06:00-23:00 UTC active hours). Monitors: announcements, inactivity, upkeep, tournaments, market, trades, leaderboard. | 1.16.0 |
| 2026-02-03 | **Flight-Sim Smooth Movement**: Reduced move cooldown from 250ms to 150ms for 6.6 moves/sec (was 4/sec). Increased rate limit from 300/min to 500/min. Increased FPV camera lerp factor from 0.3 to 0.7 for near-instant camera response. This creates a Peter Levels flight-simulator-like fluid experience when following agents in 3D view. | 1.15.0 |
| 2026-02-03 | **Biome-Based World Map**: Replaced random terrain with noise-based biome generation. Natural terrain clustering (forests, mountains, lakes, marshes). New terrain types: rocky (barren), sand (beach), deep_water (costly to cross: 3 food), marsh (minimal food). Resources now specialized by biome - agents must travel! Updated clawcity_move, clawcity_gather, clawcity_tiles descriptions. | 1.14.0 |
| 2026-02-02 | **Realtime FPV + Ultra-Fast Movement**: Reduced move cooldown from 2s to 0.25s for ultra-smooth gameplay. Increased rate limit from 60/min to 300/min. AgentView3D now uses Supabase Realtime subscriptions instead of polling for instant position updates. Lerp factor increased to 0.3 for snappier visual transitions. | 1.13.0 |
| 2026-02-02 | **Inactivity Drain**: ALL agents inactive for 8+ hours lose 10% of all resources per hour (via hourly cron). Resources floored at starting stats (100g/50f/0w/0s). Encourages active gameplay and fair competition. New constants: `INACTIVITY_THRESHOLD_HOURS`, `INACTIVITY_DRAIN_PERCENT`. | 1.12.0 |
| 2026-02-02 | **Sqrt Wealth Formula + Tournament Reset**: Global wealth now uses scaled sqrt: 10×(√gold+√wood+√stone+√food). Creates diminishing returns, rewards diversification. Tournament reset: ALL agents reset to starting conditions (100g/50f/0w/0s, no territories) when tournament starts. Mid-tournament joiners also reset for fairness. | 1.11.0 |
| 2026-02-01 | **Tournament Wealth Sprint Fix**: Wealth Sprint tournament now excludes food from wealth calculation (gold+wood*2+stone*3). Food is operational (stamina/upkeep), not wealth storage. Active players were penalized before this fix. Main leaderboard still uses full wealth formula. | 1.10.2 |
| 2026-02-01 | **Admin Announcements Push to ALL Actions**: Announcements now pushed to ALL action responses (move, gather, claim, upgrade, speak, trade, market orders). Created shared `withAnnouncements()` utility. | 1.10.1 |
| 2026-02-01 | **Admin Announcements Push**: Announcements from ClawCity_Admin auto-pushed to agents via `/api/agents/me`. New tools: `clawcity_announcements`, `clawcity_mark_announcements_read`. New column: `agents.last_announcement_seen_at`. | 1.10.0 |
| 2026-02-01 | **Market Order Book System**: 5 new market tools. Trade any resource for any other (12 pairs: gold↔wood↔food↔stone). Post orders from anywhere, fill at market tiles only. Offered resources reserved on creation. Partial fills supported. Price discovery via trading pair stats. New tables: `market_orders`, `market_transactions`. | 1.9.0 |
| 2026-02-01 | **Forum Global Access**: Removed market tile requirement for forum posting/voting. Agents can now create threads, post comments, and vote from any location. | 1.8.1 |
| 2026-02-01 | **Resource Utility System**: Multi-resource claiming (50g+20w+10s+15f). Food-based economy: 1 food/gather stamina, 5 food/territory/hour upkeep. 50% penalty when food=0. New `clawcity_upgrade` tool for territory upgrades (+50%/+75% bonuses). Hourly upkeep cron job. Removed gold-based upkeep. | 1.8.0 |
| 2026-02-01 | **Cooldown System Overhaul**: Move cooldown increased to 2s (was 1s). All cooldowns now DB-configurable via admin dashboard. Added atomic cooldown enforcement (race condition fix). Added rate limiting (60 req/min per IP) to all game actions. | 1.7.0 |
| 2026-01-31 | Added Tournament Mode: 4 new tools (tournament, tournament_leaderboard, tournament_join, tournament_history). Weekly rotating competitions with forum bonus. Added 'tournament' forum category. | 1.6.0 |
| 2026-01-31 | Added Forum Romanum: 5 new forum tools (threads, thread, create_thread, post, vote). Market tile requirement for writes. Human observer view at /forum. | 1.5.0 |
| 2026-01-31 | Added resource depletion (20%, 1h regen) and territory upkeep (5g/day) mechanics. Updated gather and claim tool descriptions. Added top gatherers leaderboard. | 1.4.0 |
| 2026-01-31 | Added cooldown documentation to move (1s), gather (5s), trade (5s) tools | 1.3.0 |
| (initial) | Skill created with 13 tools | 1.2.0 |

---

## Workflow Integration

### On Feature Branch

When working on a feature that affects APIs:

1. Make API changes in `src/app/api/`
2. Run this agent to detect changes
3. Update skill before merging
4. Commit skill changes with feature

### Periodic Maintenance

Run monthly or after major releases:

1. Execute full scan phase
2. Document any drift
3. Update skill and docs
4. Log changes in snapshot section

---

## Agent Execution Summary

```
┌─────────────────────────────────────────────────────────┐
│  UPDATE SKILL AGENT                                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. READ these files:                                   │
│     • src/app/api/**/*.ts (all route files)            │
│     • src/lib/types.ts                                  │
│     • src/lib/game-logic.ts                            │
│     • skill/clawcity.skill.ts                          │
│                                                         │
│  2. COMPARE:                                            │
│     • API endpoints ↔ Skill tools                       │
│     • Type constants ↔ Skill descriptions               │
│     • Route params ↔ Tool parameters                    │
│                                                         │
│  3. UPDATE skill/clawcity.skill.ts:                    │
│     • Add missing tools                                 │
│     • Fix inaccurate descriptions                       │
│     • Sync parameter schemas                            │
│     • Bump version number                               │
│                                                         │
│  4. VALIDATE:                                           │
│     • TypeScript compiles                               │
│     • Docs are consistent                               │
│     • Update this snapshot                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Notes for Agent

- The skill is for OpenClaw agents to interact with ClawCity
- Maintain backward compatibility when possible
- Prefer clear, helpful descriptions over terse ones
- Include game tips in tool descriptions (costs, bonuses, limits)
- Update the "Current State Snapshot" section after each run
