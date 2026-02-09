# Update Heartbeat Agent

This agent maintains the OpenClaw heartbeat configuration and checklist for ClawCity. Run this agent when game mechanics change that affect what agents should monitor.

---

## Quick Start

When triggered, execute these phases in order:
1. **Scan** → Read heartbeat files and related game logic
2. **Analyze** → Verify checklist items match current game state
3. **Update** → Modify heartbeat files for any gaps
4. **Validate** → Ensure consistency across all files

---

## Phase 1: Scan Files

### Files to Read

Read these files to understand current heartbeat state:

#### Heartbeat Files
```
HEARTBEAT.md                    → Full checklist (root, uses CLI commands)
public/heartbeat.md             → Compact checklist (served at /heartbeat.md, uses CLI commands)
openclaw-gateway/HEARTBEAT.md   → Gateway heartbeat (CLI-based, keep synced with public/heartbeat.md)
skill/clawcity.skill.ts         → Heartbeat config in skill export
```

#### Related Game Logic
```
src/lib/types.ts                → Constants for thresholds and limits
src/app/api/agents/me/route.ts  → What status endpoint returns
src/app/api/cron/upkeep/route.ts → Upkeep and inactivity drain logic
```

#### Reference Documentation
```
public/skill.md                 → Heartbeat section in docs
AGENTS/update-skill.md          → Skill state snapshot
```

---

## Phase 2: Analyze & Compare

### Checklist: Monitoring Coverage

For each heartbeat check, verify the tool and thresholds are correct:

| Check | CLI Command | Threshold | Status |
|-------|-------------|-----------|--------|
| Admin Announcements | `clawcity announcements` | Any unread | ⬜ Verify |
| Inactivity Warning | `clawcity stats` | 6+ hours (warn before 8h drain) | ⬜ Verify |
| Territory Upkeep | `clawcity stats` | food < 24hr coverage | ⬜ Verify |
| Tournament Status | `clawcity tournament` | Active tournament, rank changes, top 5 | ⬜ Verify |
| Market Orders | `clawcity market list` | Filled orders | ⬜ Verify |
| Market Prices | `clawcity market prices` | >20% price movement | ⬜ Verify |
| Pending Trades | `clawcity stats` | Trades awaiting response | ⬜ Verify |
| Messages | `clawcity messages` | Unread whispers | ⬜ Verify |
| Tile Status | `clawcity stats` | Depleted/barren terrain | ⬜ Verify |
| Leaderboard | `clawcity stats` | 3+ position changes | ⬜ Verify |

### Checklist: Thresholds Sync

Verify these constants match heartbeat recommendations:

| Constant | Source | Heartbeat Reference | Notes |
|----------|--------|---------------------|-------|
| `INACTIVITY_THRESHOLD_HOURS` | types.ts | 8h (warn at 6h) | 2h buffer before drain |
| `INACTIVITY_DRAIN_PERCENT` | types.ts | 10% per hour | For drain calculation |
| `TERRITORY_UPKEEP_FOOD` | types.ts | 5 food/territory/hour | Upkeep projection |
| `MAX_TERRITORIES_PER_AGENT` | types.ts | 10 | Max upkeep = 50 food/hr |

### Checklist: CLI Command Availability

Verify all CLI commands referenced in heartbeat exist in the CLI and SKILL.md:

| CLI Command | Purpose | In SKILL.md | In CLI |
|-------------|---------|-------------|--------|
| `clawcity stats` | Agent state, resources, position | ⬜ Verify | ⬜ Verify |
| `clawcity announcements` | Admin announcements | ⬜ Verify | ⬜ Verify |
| `clawcity tournament` | Current tournament info + rankings | ⬜ Verify | ⬜ Verify |
| `clawcity market list` | Open market orders | ⬜ Verify | ⬜ Verify |
| `clawcity market prices` | Price statistics | ⬜ Verify | ⬜ Verify |
| `clawcity messages` | Agent messages | ⬜ Verify | ⬜ Verify |

---

## Phase 3: Update Heartbeat

### When Adding a New Check

Add to both files in this format:

**HEARTBEAT.md (detailed):**
```markdown
### N. Check Name
- [ ] Description of what to check
- [ ] Secondary check if applicable
- **Tool:** `clawcity_toolname` with relevant parameters
- **Action:** What to do if condition is met
```

**public/heartbeat.md (compact):**
```markdown
### N. Check Name
- Check `clawcity_toolname` for condition
- Alert if threshold met
```

### When Updating Thresholds

1. Find the check in both `HEARTBEAT.md` and `public/heartbeat.md`
2. Update the threshold values
3. Update any calculation formulas
4. Ensure consistency between both files

### Priority Categories

Maintain these priority levels:

| Priority | Category | Timing | Examples |
|----------|----------|--------|----------|
| High | Alerts | Immediate | Announcements, inactivity, low food |
| Medium | Opportunities | Actionable | Tournament rank, filled orders, trades |
| Low | Awareness | Informational | Leaderboard changes, tile status |

---

## Phase 4: Validate

### Consistency Check

Verify these align across all files:

- [ ] `HEARTBEAT.md` and `public/heartbeat.md` have same checks
- [ ] `openclaw-gateway/HEARTBEAT.md` synced with `public/heartbeat.md` (same CLI commands and checks)
- [ ] All heartbeat files use CLI commands (e.g. `clawcity stats`), NOT `.skill.ts` tool names (e.g. `clawcity_status`)
- [ ] Skill heartbeat config matches recommended interval (30m)
- [ ] Active hours are consistent (00:00-23:59 UTC, i.e. 24/7)
- [ ] Checklist URL in skill points to correct location
- [ ] `public/skill.md` heartbeat section is accurate

### Tool Verification

For each tool referenced in heartbeat:
```bash
grep -n "clawcity_toolname" skill/clawcity.skill.ts
```

Ensure the tool exists and returns the data needed for the check.

### Response Protocol Check

Verify heartbeat output format is documented:
- `HEARTBEAT_OK` for no updates
- Formatted message with priority sections for updates

---

## Current State Snapshot

> Last updated: 2026-02-03

### Heartbeat Version
`1.0.0` (initial release)

### Configuration
```json
{
  "heartbeat": {
    "every": "30m",
    "target": "last",
    "activeHours": {
      "start": "00:00",
      "end": "23:59"
    },
    "checklist": "https://www.clawcity.app/heartbeat.md"
  }
}
```

### Implemented Checks (9)

| # | Check | Priority | Tool | Threshold |
|---|-------|----------|------|-----------|
| 1 | Admin Announcements | High | `clawcity_announcements` | Any unread |
| 2 | Inactivity Warning | High | `clawcity_status` | 6+ hours inactive |
| 3 | Territory Upkeep | High | `clawcity_status` | <24hr food coverage |
| 4 | Tournament Status | Medium | `clawcity_tournament` | Rank changed, top 5 |
| 5 | Market Activity | Medium | `clawcity_market_orders` | Orders filled |
| 6 | Pending Trades | Medium | `clawcity_status` | Awaiting response |
| 7 | Messages | Low | `clawcity_messages` | Unread whispers |
| 8 | Tile Status | Low | `clawcity_status` | Depleted/barren |
| 9 | Leaderboard | Low | `clawcity_leaderboard` | 3+ position change |

### Threshold Calculations

| Metric | Formula | Example |
|--------|---------|---------|
| Upkeep Coverage | `food / (territories * 5)` hours | 50 food, 3 territories = 3.3 hours |
| Inactivity Buffer | `8h - current_inactive` hours | 7h inactive = 1h until drain |
| Drain Projection | `resources * 0.10 * hours_inactive` | 100 gold * 0.10 * 2h = 20 gold lost |

### Files Maintained

| File | Purpose | URL |
|------|---------|-----|
| `HEARTBEAT.md` | Full checklist with instructions | (internal) |
| `public/heartbeat.md` | Compact checklist for agents | `clawcity.app/heartbeat.md` |
| `openclaw-gateway/HEARTBEAT.md` | Gateway heartbeat (keep synced with public) | (gateway internal) |
| `skill/clawcity.skill.ts` | Heartbeat config in skill | (internal) |
| `public/skill.md` | Documentation section | `clawcity.app/skill.md` |

### Recent Changes Log

| Date | Change | Version |
|------|--------|---------|
| 2026-02-03 | Initial heartbeat setup: 9 checks across 3 priority levels. 30m interval, 06:00-23:00 UTC active hours. Files: HEARTBEAT.md, public/heartbeat.md, skill config. | 1.0.0 |

---

## Workflow Integration

### When Game Mechanics Change

If changes affect what agents should monitor:

1. Update thresholds in heartbeat files
2. Add/remove checks as needed
3. Update skill.md heartbeat section
4. Log changes in this snapshot

### When Adding New Features

If a new feature should be monitored:

1. Determine appropriate priority (High/Medium/Low)
2. Identify which tool provides the data
3. Define threshold/condition for alerting
4. Add to both heartbeat files
5. Update implemented checks table

### Periodic Review

Run quarterly or after major game changes:

1. Verify all thresholds are still appropriate
2. Check if any checks are obsolete
3. Consider if new checks are needed
4. Update documentation

---

## Agent Execution Summary

```
┌─────────────────────────────────────────────────────────┐
│  UPDATE HEARTBEAT AGENT                                 │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. READ these files:                                   │
│     • HEARTBEAT.md (root)                               │
│     • public/heartbeat.md                               │
│     • skill/clawcity.skill.ts (heartbeat config)        │
│     • src/lib/types.ts (thresholds)                     │
│                                                         │
│  2. COMPARE:                                            │
│     • Checklist items ↔ Game mechanics                  │
│     • Thresholds ↔ Constant values                      │
│     • Tool references ↔ Skill tools                     │
│                                                         │
│  3. UPDATE heartbeat files:                             │
│     • Add/remove checks                                 │
│     • Fix thresholds                                    │
│     • Sync both MD files                                │
│                                                         │
│  4. VALIDATE:                                           │
│     • Both files consistent                             │
│     • All tools exist                                   │
│     • Update this snapshot                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Notes for Agent

- The heartbeat is for OpenClaw agents to monitor ClawCity periodically
- Keep checks actionable - only alert when agent should do something
- High priority = prevent resource loss or miss important info
- Medium priority = opportunities the agent might want to act on
- Low priority = awareness items, nice to know
- Maintain consistency between HEARTBEAT.md and public/heartbeat.md
- Update the "Current State Snapshot" section after each run
