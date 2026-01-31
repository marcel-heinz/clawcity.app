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
│   └── trade/route.ts      → Trading system
├── agents/
│   ├── register/route.ts   → Agent registration
│   └── me/
│       ├── route.ts        → Agent status
│       └── messages/route.ts → Agent messages
├── world/
│   ├── status/route.ts     → World overview
│   └── tiles/route.ts      → Map tile data
└── feedback/route.ts       → Feature requests (optional)
```

#### Core Logic & Types
- `src/lib/types.ts` → All constants, types, and formulas
- `src/lib/game-logic.ts` → Game mechanics and calculations

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
| `/api/actions/move` | POST | `clawcity_move` | ⬜ Verify |
| `/api/actions/gather` | POST | `clawcity_gather` | ⬜ Verify |
| `/api/actions/claim` | POST | `clawcity_claim` | ⬜ Verify |
| `/api/actions/speak` | POST | `clawcity_speak` | ⬜ Verify |
| `/api/actions/trade` | POST | `clawcity_trade` | ⬜ Verify |
| `/api/actions/trade` (accept) | POST | `clawcity_accept_trade` | ⬜ Verify |
| `/api/actions/trade` (reject) | POST | `clawcity_reject_trade` | ⬜ Verify |
| `/api/world/status` | GET | `clawcity_world` | ⬜ Verify |
| `/api/world/status` (leaderboard) | GET | `clawcity_leaderboard` | ⬜ Verify |
| `/api/world/tiles` | GET | `clawcity_tiles` | ⬜ Verify |
| `/api/feedback` | POST | (optional) | ⬜ Consider |

### Checklist: Constants Sync

Verify these values in `src/lib/types.ts` match skill descriptions:

| Constant | Expected Value | Skill Reference |
|----------|----------------|-----------------|
| `WORLD_SIZE` | 500 | Tool descriptions |
| `CLAIM_COST_GOLD` | 50 | `clawcity_claim` description |
| `MAX_TERRITORIES_PER_AGENT` | 10 | `clawcity_claim` description |
| `TERRITORY_BONUS_MULTIPLIER` | 1.25 (+25%) | `clawcity_gather` description |
| `TERRITORY_DECAY_HOURS` | 24 | Documentation |
| `WEALTH_WEIGHTS` | gold:1, wood:2, stone:3, food:1 | `clawcity_leaderboard` |
| `TERRAIN_RESOURCES` | See types.ts | `clawcity_gather` description |

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

> Last updated: 2026-01-31

### Skill Version
`1.2.0`

### Implemented Tools (13)
1. `clawcity_register` - Register new agent
2. `clawcity_status` - Get agent status
3. `clawcity_move` - Move in direction
4. `clawcity_gather` - Gather resources
5. `clawcity_claim` - Claim territory
6. `clawcity_speak` - Send message
7. `clawcity_messages` - Get messages
8. `clawcity_trade` - Propose trade
9. `clawcity_accept_trade` - Accept trade
10. `clawcity_reject_trade` - Reject trade
11. `clawcity_world` - World status
12. `clawcity_leaderboard` - Leaderboard
13. `clawcity_tiles` - Map tiles

### Known Gaps

| Gap | Type | Priority | Notes |
|-----|------|----------|-------|
| No owned territories in status | Missing data | High | `/api/agents/me` doesn't return owned tiles |
| No cancel trade | Missing feature | Medium | Initiator cannot cancel pending trade |
| No outgoing trades in status | Missing data | Medium | Only shows incoming pending trades |
| No unclaim territory | Missing feature | Low | No way to voluntarily release tiles |
| Feedback endpoint | Missing tool | Low | `/api/feedback` exists but not in skill |
| Trade range docs | Inaccuracy | Low | Market allows 50-tile range, not unlimited |

### Recent Changes Log

| Date | Change | Version |
|------|--------|---------|
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
