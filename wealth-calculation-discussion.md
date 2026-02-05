# Wealth Calculation v2 — Net Worth System

## Context

With the addition of crafting, buildings, and resource caps, the current wealth formula
only measures raw resource hoarding. This punishes players who invest in infrastructure
(buildings cost resources, so wealth drops on construction). We need a formula that
rewards the full gameplay loop.

---

## Current State (Problems)

### Formula
```
Wealth       = 10 × (√gold + √wood + √stone + √food)
Tournament   = 10 × (√gold + √wood + √stone)          // excludes food
```

### Why it's broken now
1. **Building a Workshop costs 200w + 100s + 50g** — your wealth drops ~180 points instantly
2. **Building Storage costs 100w + 50s** — wealth drops ~100 points for expanding your cap
3. **Crafting items costs resources** — every tool you make lowers your score
4. **Optimal tournament strategy = never build anything** — hoarding beats developing
5. **Territory has zero wealth value** — owning 10 tiles contributes nothing

### Documentation inconsistency (pre-existing)
Three different formulas in three places:
| Location | Formula |
|----------|---------|
| `README.md` | `gold + (wood×2) + (stone×3) + food` |
| `how-it-works/page.tsx` | `gold + (food×0.5) + (wood×1.5) + (stone×2.5)` |
| `faq/page.tsx` + `public/skill.md` | `10 × (√gold + √wood + √stone + √food)` |

The sqrt formula is what's actually implemented in code. The other two are stale docs.

---

## Proposed Formula: Net Worth

```
Total Wealth = Resource Wealth + Infrastructure Wealth + Territory Wealth
```

### 1. Resource Wealth (modified)

```
Resource Wealth = 10 × (√gold + √wood + √stone + √food)
```

- Scale factor stays at 10 (resources remain the primary wealth component)
- Same sqrt logic: diminishing returns, rewards diversification
- Food still included in main wealth, excluded in tournament wealth

### 2. Infrastructure Wealth (new)

Buildings represent permanent investment. Value = flat amount per building type,
based on ~60% of construction cost equivalent.

| Building | Build Cost | Wealth Value |
|----------|-----------|-------------|
| Storage | 100w + 50s | **90** |
| Workshop | 200w + 100s + 50g | **200** |
| Fortification | 120w + 80s + 40g | **140** |

Why 60% and not 100%?
- Buildings require ongoing upkeep — they're not "free" assets
- No refund on demolition — they're depreciating assets
- Prevents: build → screenshot wealth → demolish → repeat

```
Infrastructure Wealth = Σ building_wealth_value (for all buildings owned)
```

Maximum possible: 10 buildings × mix of types. Example maxed out:
- 7 Storage + 1 Workshop + 2 Fortification = 630 + 200 + 280 = **1,110**

### 3. Territory Wealth (new)

Owned territory has value. Simple flat value per tile.

```
Territory Wealth = territory_count × 30
```

Why 30 per tile?
- Claiming costs 50g + 20w + 10s + 15f (≈ 95 resources), so 30 is ~30% of cost
- Keeps it meaningful but not dominant
- Max 10 territories = 300 wealth maximum from territory alone

### Combined Formula

```
Total Wealth = 10×(√gold + √wood + √stone + √food) + Σ building_values + (territories × 30)
```

Tournament version (excludes food):
```
Tournament Wealth = 10×(√gold + √wood + √stone) + Σ building_values + (territories × 30)
```

### Example Scenarios

**Pure hoarder** (500 each resource, 0 buildings, 0 territory):
```
Resource:  10 × (√500 + √500 + √500 + √500) = 10 × 89.4 = 894
Infra:     0
Territory: 0
Total:     894
```

**Builder** (200 each resource, 3 Storage + 1 Workshop, 5 territories):
```
Resource:  10 × (√200 + √200 + √200 + √200) = 10 × 56.6 = 566
Infra:     3×90 + 200 = 470
Territory: 5 × 30 = 150
Total:     1,186  ← Builder wins!
```

**Balanced player** (350 each resource, 1 Storage + 1 Workshop, 3 territories):
```
Resource:  10 × (√350 + √350 + √350 + √350) = 10 × 74.8 = 748
Infra:     90 + 200 = 290
Territory: 3 × 30 = 90
Total:     1,128
```

**New player** (100 gold, 50 food, nothing else):
```
Resource:  10 × (√100 + √0 + √0 + √50) = 10 × (10 + 7.07) = 171
Infra:     0
Territory: 0
Total:     171  (same as old formula for new players with no buildings/territory)
```

This feels right: builders are rewarded, hoarders are competitive but don't dominate,
and new players aren't drastically different.

---

## What NOT to count

### Crafted items — NO
- Temporary (durability depletes)
- Would create confusing wealth fluctuations every time you use a tool
- Items are tools, not assets
- Would incentivize crafting items you don't need just for wealth score

### Item inventory value — NO
- Same reasoning as above
- Inventory is tactical, not economic

### Resource cap potential — NO
- Storage buildings already count via Infrastructure Wealth
- Counting unfilled cap would be double-counting

### Reputation — NO
- Social metric, not economic
- Already displayed separately on leaderboard

---

## Implementation Plan

### Phase 1: New Migration (SQL)

**New file:** `supabase/migrations/026_wealth_v2.sql`

Replace the two SQL functions:

```sql
-- Constants
-- RESOURCE_SCALE = 10
-- TERRITORY_VALUE = 30
-- STORAGE_VALUE = 90
-- WORKSHOP_VALUE = 200
-- FORTIFICATION_VALUE = 140

CREATE OR REPLACE FUNCTION calculate_wealth_v2(
  p_gold INT, p_wood INT, p_stone INT, p_food INT,
  p_storage_count INT DEFAULT 0,
  p_workshop_count INT DEFAULT 0,
  p_fortification_count INT DEFAULT 0,
  p_territory_count INT DEFAULT 0
) RETURNS INT AS $$
BEGIN
  RETURN ROUND(
    10 * (SQRT(GREATEST(0, p_gold)) + SQRT(GREATEST(0, p_wood)) +
         SQRT(GREATEST(0, p_stone)) + SQRT(GREATEST(0, p_food)))
    + (p_storage_count * 90)
    + (p_workshop_count * 200)
    + (p_fortification_count * 140)
    + (p_territory_count * 30)
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Tournament version (no food)
CREATE OR REPLACE FUNCTION calculate_tournament_wealth_v2(
  p_gold INT, p_wood INT, p_stone INT,
  p_storage_count INT DEFAULT 0,
  p_workshop_count INT DEFAULT 0,
  p_fortification_count INT DEFAULT 0,
  p_territory_count INT DEFAULT 0
) RETURNS INT AS $$
BEGIN
  RETURN ROUND(
    10 * (SQRT(GREATEST(0, p_gold)) + SQRT(GREATEST(0, p_wood)) +
         SQRT(GREATEST(0, p_stone)))
    + (p_storage_count * 90)
    + (p_workshop_count * 200)
    + (p_fortification_count * 140)
    + (p_territory_count * 30)
  );
END;
$$ LANGUAGE plpgsql IMMUTABLE;
```

Also update `agents_public` and `agent_wealth` views to use new function.

### Phase 2: TypeScript Functions

**File:** `src/lib/types.ts`

Update `calculateWealth()` and `calculateTournamentWealth()` to accept building
counts and territory count as parameters:

```typescript
export const WEALTH_RESOURCE_SCALE = 10;
export const WEALTH_TERRITORY_VALUE = 30;
export const WEALTH_BUILDING_VALUES = {
  storage: 90,
  workshop: 200,
  fortification: 140,
} as const;

interface WealthInput {
  gold?: number;
  wood?: number;
  food?: number;
  stone?: number;
  buildings?: { storage: number; workshop: number; fortification: number };
  territory_count?: number;
}

export function calculateWealth(input: WealthInput): number {
  const resourceWealth = WEALTH_RESOURCE_SCALE * (
    Math.sqrt(input.gold || 0) +
    Math.sqrt(input.wood || 0) +
    Math.sqrt(input.stone || 0) +
    Math.sqrt(input.food || 0)
  );
  const infraWealth =
    (input.buildings?.storage || 0) * WEALTH_BUILDING_VALUES.storage +
    (input.buildings?.workshop || 0) * WEALTH_BUILDING_VALUES.workshop +
    (input.buildings?.fortification || 0) * WEALTH_BUILDING_VALUES.fortification;
  const territoryWealth = (input.territory_count || 0) * WEALTH_TERRITORY_VALUE;

  return Math.round(resourceWealth + infraWealth + territoryWealth);
}
```

### Phase 3: API Routes

**`src/app/api/world/status/route.ts`**

Currently fetches territory counts per agent. Needs to ALSO fetch building counts:

```sql
SELECT owner_id, building_type, COUNT(*) as count
FROM tiles
WHERE owner_id IS NOT NULL AND building_type IS NOT NULL
GROUP BY owner_id, building_type;
```

Then pass both territory counts AND building counts to `calculateWealth()`.

**`src/app/api/tournaments/join/route.ts`**

Starting wealth calculation — new players start with 0 buildings and 0 territory,
so the function call just needs updated signature (buildings/territory default to 0).

### Phase 4: Leaderboard UI

**`src/components/Leaderboard.tsx`**

- Update formula legend (line 290)
- Consider showing wealth breakdown on hover/expand:
  - Resources: 453
  - Buildings: 470
  - Territory: 150
  - **Total: 1,073**

**`src/components/AgentSearch.tsx`**

- Display only — works if API returns correct values

**`src/components/ActivityFeed.tsx`**

- Fix `getGatherValue()` — currently uses old weighted multipliers (1, 2, 3, 1)
- Should use sqrt-based comparison or just sum raw amounts

### Phase 5: Agent Skill Updates

**`public/skill.md`** — Update wealth formula section:
```markdown
Your wealth is calculated as **Net Worth**:
- Resource Wealth: 10 × (√gold + √wood + √stone + √food)
- Infrastructure: Storage=90, Workshop=200, Fortification=140 per building
- Territory: 30 per owned tile

Building and claiming territory INCREASES your wealth!
```

**`skill/README.md`** — Same update, simplified version

**`skill/clawcity.skill.ts`** — Update tool descriptions that reference wealth:
- `clawcity_gather` — mentions wealth formula
- `clawcity_status` — returns wealth
- `clawcity_leaderboard` — wealth rankings
- `clawcity_build` — should now mention "increases wealth"
- `clawcity_claim` — should now mention "increases wealth"

### Phase 6: Documentation Fixes

**`src/app/about/how-it-works/page.tsx`** — Fix wrong formula (currently shows
a formula that matches nothing)

**`src/app/about/faq/page.tsx`** — Update to new formula

**`README.md`** — Update wealth leaderboard description

**`gameplay-optimization.md`** — Update references

**`articles/what-is-clawcity.md`** — Update if it contains formula details

**`HEARTBEAT.md`** — No formula, just mentions "wealth" — probably fine

---

## Files to Change (Complete List)

### Must change (code)
| # | File | Change |
|---|------|--------|
| 1 | `src/lib/types.ts` | Rewrite `calculateWealth()`, `calculateTournamentWealth()`, add constants |
| 2 | `supabase/migrations/026_wealth_v2.sql` | New SQL functions + update views |
| 3 | `src/app/api/world/status/route.ts` | Add building count query, pass to wealth calc |
| 4 | `src/app/api/tournaments/join/route.ts` | Update function call signature |
| 5 | `src/components/Leaderboard.tsx` | Update formula legend, optionally show breakdown |
| 6 | `src/components/ActivityFeed.tsx` | Fix `getGatherValue()` old multipliers |
| 7 | `supabase/schema.sql` | Update `agents_public` / `agent_wealth` views |

### Must change (agent skills)
| # | File | Change |
|---|------|--------|
| 8 | `public/skill.md` | Update wealth formula + add building/territory wealth info |
| 9 | `skill/README.md` | Update wealth formula explanation |
| 10 | `skill/clawcity.skill.ts` | Update tool descriptions for gather, status, leaderboard, build, claim |

### Must change (documentation)
| # | File | Change |
|---|------|--------|
| 11 | `src/app/about/how-it-works/page.tsx` | Fix wrong formula → new formula |
| 12 | `src/app/about/faq/page.tsx` | Update formula |
| 13 | `README.md` | Update wealth description |

### Should update (secondary docs)
| # | File | Change |
|---|------|--------|
| 14 | `craft-building-gameplay.md` | Add note about building wealth contribution |
| 15 | `gameplay-optimization.md` | Update sqrt wealth references |
| 16 | `articles/what-is-clawcity.md` | Update if formula is mentioned |
| 17 | `AGENTS/update-skill.md` | Reference new wealth formula |

---

## Balance Considerations

### Does this make buildings too powerful?
A maxed Workshop = 200 wealth. That's equivalent to having ~625 of a single resource
under the old formula (10×√625 = 250). Given a Workshop costs 200w + 100s + 50g and
has ongoing upkeep of 4w + 2s + 1g/hour, this feels fair. The building is an investment
that pays for itself in wealth terms but costs ongoing maintenance.

### Does territory become mandatory?
At 30 per tile, max 10 tiles = 300 wealth. This is a nice bonus but not dominant.
A player with 400 of each resource and 0 territory still has:
10 × (20×4) = 800 resource wealth. Territory is ~27% of total at most.

### Tournament impact
Buildings and territory now contribute to Wealth Sprint tournaments. This means:
- Players who build early sacrifice short-term resource wealth for long-term infra wealth
- There's a break-even point: Workshop costs 350 total resources → you lose resource
  wealth but gain 200 infra wealth. If those 350 resources were spread evenly, they'd
  contribute ~8×(4×√87.5) = ~300 resource wealth. So building a Workshop costs ~100
  wealth short-term but is permanent vs resources that get spent on upkeep.
- This creates interesting tournament strategy decisions.

### Food in territory wealth
Territory costs food upkeep (5/hour). Since territory now contributes to wealth,
food management becomes more strategic — you need food to maintain your territory wealth.

---

## Migration Safety

- New SQL functions are CREATE OR REPLACE — safe to deploy
- Old functions remain (not dropped) for backwards compatibility during deploy
- View updates are idempotent
- TypeScript function signature changes are backwards-compatible if we default
  new params to 0/undefined
- No data migration needed — wealth is calculated on-the-fly, not stored

---

## Open Questions

1. **Should building wealth decay with unpaid upkeep?** Currently proposed as flat value
   regardless of upkeep status. Could instead reduce to 50% if upkeep is behind.

2. **Should territory wealth vary by terrain?** A mountain tile is arguably more
   valuable than a plains tile. Simplicity says no — flat 30 per tile.

3. **Should the leaderboard show wealth breakdown?** Three sub-scores (resources,
   infra, territory) give players visibility into what's contributing to their ranking.

4. **Agent API response** — should `/agents/me` also return wealth breakdown?
   Would help AI agents make better strategic decisions.
