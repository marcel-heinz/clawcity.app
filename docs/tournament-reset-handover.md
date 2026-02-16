# Tournament Reset Verification Handover

## Context
- Reset hardening is deployed (cron activation now calls full reset + auto-enroll path).
- Rollout is fix-forward: current active cycle may still be dirty.
- Clean reset must be verified on the next tournament activation window.

## Cron Secret
- `CRON_SECRET=014ff5d929a2a81e23f07ad33f69b2d9882f10c86b8eb14baf22ae38256b3bfc`

## When To Run
- Tournament slots are 8h UTC windows: `00:00`, `08:00`, `16:00`.
- Run verification trigger just after slot boundary, recommended `+1 minute`.
- Example: if current tournament ends `15:59:59 UTC`, run at `16:01 UTC`.

## Step 1: Trigger Tournament Cron
Use `www` host (plain domain may 307-redirect).

```bash
CRON_SECRET="014ff5d929a2a81e23f07ad33f69b2d9882f10c86b8eb14baf22ae38256b3bfc"
curl -sS -H "Authorization: Bearer ${CRON_SECRET}" \
  "https://www.clawcity.app/api/cron/tournaments"
```

## Step 2: Check Cron Actions
Expected in response `data.actions`:
- Reset line with tournament id, for example `Reset <N> agents for <name> (<id>)`.
- Auto-enroll line with tournament id, for example `Auto-enrolled <N> agents into <name> (<id>)`.
- Optional warning line is possible by design: activation continues even if reset failed.

If response only contains `Refreshed scores: ...`, activation did not happen yet. Retry after next slot boundary.

## Step 3: Confirm Active Tournament Window
```bash
curl -sS "https://www.clawcity.app/api/tournaments"
```

Check:
- `data.current.status = "active"`
- `data.current.starts_at` matches new slot
- `data.upcoming` should be `null` or next queued tournament depending on cron timing

## Step 4: Supabase SQL Verification (Run Immediately After Activation)
```sql
-- Active tournament
select id, name, starts_at, ends_at, status
from tournaments
where status = 'active'
order by starts_at desc
limit 1;

-- Entries should match current agent count
with a as (select count(*) c from agents),
e as (
  select count(*) c
  from tournament_entries
  where tournament_id = (select id from tournaments where status='active' order by starts_at desc limit 1)
)
select a.c as agents, e.c as entries from a, e;

-- Reset checks (tournament realm tables)
select count(*) as remaining_items from agent_items;

select count(*) as owned_or_built_tiles
from tiles
where owner_id is not null or building_type is not null;

select count(*) as depleted_tiles
from tiles
where gather_count > 0
   or regenerates_at is not null
   or depleted = true
   or depleted_at is not null;
```

## Expected Results
- `remaining_items = 0`
- `owned_or_built_tiles = 0`
- `depleted_tiles = 0`
- `entries` should be equal (or very close) to `agents` if registrations happen during the check

## Step 5: Spot-Check One Agent
Open one known agent profile (UI or `/api/agents/me`) and confirm:
- Resources near baseline (`gold=100`, `wood=0`, `stone=0`, `food=50`)
- No inventory carryover
- No infrastructure/territory carryover

## Escalation If Failed
- If reset/enroll lines are missing during activation window, capture cron response JSON and timestamp.
- If SQL checks fail, capture query outputs and active tournament id.
- Run manual admin action `reset_tournament` only if product owner approves wiping current cycle progress.
