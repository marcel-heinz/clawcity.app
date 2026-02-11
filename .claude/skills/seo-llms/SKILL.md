---
name: seo-llms
description: Audit and update SEO infrastructure (robots.txt, sitemap.xml, llms.txt, llms-full.txt) and manage Google Search Console. Run after adding pages, changing routes, or updating game mechanics.
---

# SEO & LLMs Agent

Maintains SEO infrastructure and LLM discoverability for ClawCity. Run this agent after adding new pages, changing routes, updating game mechanics, or when preparing for search engine submissions.

---

## Quick Start

When triggered, execute these phases in order:
1. **Audit** → Check all SEO files are present and current
2. **Sync** → Update sitemap, llms.txt, llms-full.txt with any changes
3. **Validate** → Build and verify all endpoints serve correct content
4. **GSC** → Check Google Search Console status (if configured)

---

## Phase 1: Audit

### Files to Check

Read these files and verify they exist and are up-to-date:

| File | Serves As | Location |
|------|-----------|----------|
| `src/app/robots.ts` | `/robots.txt` | Crawl directives |
| `src/app/sitemap.ts` | `/sitemap.xml` | Page index for search engines |
| `src/app/layout.tsx` | HTML `<head>` | Root metadata (OG, Twitter, robots) |
| `src/app/llms.txt/route.ts` | `/llms.txt` | Concise LLM entry point |
| `src/app/llms-full.txt/route.ts` | `/llms-full.txt` | Extended LLM documentation |

### Cross-Reference: Discover All Public Pages

Scan for all public (non-API, non-admin) page routes:

```
src/app/**/page.tsx  (excluding api/, mrclhnz-dashboard/, claim/)
```

Compare discovered pages against the sitemap entries in `src/app/sitemap.ts`.

**Flag any pages missing from the sitemap.**

### Cross-Reference: Discover All API Routes

Scan for all API route files:

```
src/app/api/**/route.ts
```

Compare against the API sections in both `llms.txt` and `llms-full.txt`.

**Flag any endpoints missing from the LLM files.**

---

## Phase 2: Sync

### 2a. robots.ts

Verify rules match current private routes:

```typescript
// Expected structure
disallow: ['/api/', '/claim/', '/mrclhnz-dashboard/']
sitemap: 'https://clawcity.app/sitemap.xml'
```

Check for new private routes that should be disallowed (admin panels, internal tools, etc.).

### 2b. sitemap.ts

For each public page, ensure an entry exists with appropriate priority and frequency:

| Priority | Criteria |
|----------|----------|
| 1.0 | Homepage |
| 0.9 | High-traffic interactive pages (agent-search, forum) |
| 0.85 | Tournament, token |
| 0.8 | About, developer docs |
| 0.7 | Informational pages (story, how-it-works, faq, roadmap) |
| 0.6 | Philosophy, business |
| 0.3 | Legal (privacy, terms, imprint) |

| Frequency | Criteria |
|-----------|----------|
| hourly | Pages with live data (homepage, agent-search, forum) |
| daily | Tournament |
| weekly | Token |
| monthly | Static informational pages |
| yearly | Legal pages |

When adding new pages:
1. Determine the correct priority and frequency
2. Add the entry to the sitemap array
3. Keep entries sorted by priority (descending)

### 2c. layout.tsx Metadata

Verify the root metadata object includes:

- [ ] `metadataBase: new URL('https://clawcity.app')`
- [ ] `title` with template format: `{ default: '...', template: '%s | ClawCity' }`
- [ ] `description` — accurate summary of ClawCity
- [ ] `keywords` — relevant terms (AI agents, MMO, trading, territory, etc.)
- [ ] `openGraph` — type, locale, siteName, title, description, images
- [ ] `twitter` — card type `summary_large_image`, site handle, images
- [ ] `robots` — index/follow with googleBot settings
- [ ] `alternates.canonical`
- [ ] `verification.google` — filled in once GSC is set up (may be commented out)

If the project description, name, or branding changes, update all metadata fields to match.

### 2d. llms.txt

This is the **concise** entry point for LLM crawlers. It should contain:

1. **Header** — Project name and one-line description
2. **Links** — Website, API base, GitHub
3. **Live Stats** — Fetched from Supabase (total agents, active agents, trades, territories)
4. **Top Agents** — Top 5 by wealth (using `calculateWealth()` from `@/lib/types`)
5. **Key Pages** — All public pages with full URLs
6. **API Overview** — Every public API endpoint (method + path + brief description)
7. **Link to llms-full.txt** — For extended documentation

#### Data Sources

```typescript
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateWealth } from '@/lib/types';
```

- Always guard with `isSupabaseConfigured` — gracefully degrade if DB unavailable
- Use `revalidate = 3600` for 1-hour ISR cache
- Return `Content-Type: text/plain; charset=utf-8`

When API endpoints change, update the API Overview section.

### 2e. llms-full.txt

This is the **extended** guide. It should contain everything from llms.txt plus:

1. **World Design** — Grid size, terrain types table (symbol, resources, notes)
2. **Economy & Wealth** — Full wealth formula with constants, resource descriptions
3. **Territory** — Claim costs, max per agent, decay timer, upgrade levels
4. **Buildings** — Full table generated from `BUILDING_DEFINITIONS` in `@/lib/buildings`
5. **Crafting & Items** — Full table generated from `ITEM_DEFINITIONS` in `@/lib/crafting`
6. **Anti-Exploit Mechanics** — Depletion, diminishing returns, inactivity drain, stamina
7. **Micro-Events** — Event types, frequencies, durations, multiplier ranges
8. **Complete API Reference** — All endpoints grouped by category with methods and parameters
9. **Top 10 Agents** — By wealth with reputation
10. **Forum Stats** — Thread and post counts
11. **FAQ** — Common questions and answers
12. **Technical Stack** — Framework, frontend, backend, database, deployment
13. **Last Updated** — ISO timestamp

#### Data Sources

```typescript
import { createServerClient, isSupabaseConfigured } from '@/lib/supabase';
import { calculateWealth, WORLD_SIZE, WEALTH_SCALE_FACTOR, ... } from '@/lib/types';
import { BUILDING_DEFINITIONS, BUILDING_DECAY_HOURS } from '@/lib/buildings';
import { ITEM_DEFINITIONS } from '@/lib/crafting';
```

When game mechanics change (new buildings, items, terrain types, constants), the tables in llms-full.txt auto-update because they're generated from source code. But verify:

- New API endpoints are added to the Complete API Reference
- New game systems get their own section
- FAQ is updated for new features
- Constants imported from types.ts are still accurate

---

## Phase 3: Validate

### Build Check

```bash
npm run build
```

Verify no TypeScript or build errors. Check the build output for:
- `/robots.txt` — listed as static route
- `/sitemap.xml` — listed as static route
- `/llms.txt` — listed with ISR revalidation
- `/llms-full.txt` — listed with ISR revalidation

### Content Verification

After a successful build, verify content correctness by reading the source:

1. **robots.txt** — Has `User-agent: *`, `Allow: /`, correct `Disallow` entries, sitemap URL
2. **sitemap.xml** — All public pages present, valid priorities, base URL is `https://clawcity.app`
3. **llms.txt** — Markdown format, all key pages listed, API overview complete, link to llms-full.txt
4. **llms-full.txt** — All sections present, building/item tables populated, constants match source
5. **Layout metadata** — OpenGraph and Twitter tags present in page source

### Local Testing (if dev server available)

```bash
curl -s http://localhost:3000/robots.txt | head -10
curl -s http://localhost:3000/sitemap.xml | head -20
curl -s http://localhost:3000/llms.txt | head -30
curl -s http://localhost:3000/llms-full.txt | wc -l
```

---

## Phase 4: Google Search Console

### Initial Setup (one-time)

1. Go to https://search.google.com/search-console
2. Add property: `https://clawcity.app`
3. Choose **HTML meta tag** verification method
4. Copy the verification code
5. Update `src/app/layout.tsx`:
   ```typescript
   verification: { google: 'YOUR_CODE_HERE' }
   ```
6. Deploy and verify in GSC

### Ongoing Maintenance

After deploying changes to sitemap or adding new pages:

1. Open GSC → Sitemaps
2. Verify `https://clawcity.app/sitemap.xml` is submitted
3. Check for any crawl errors
4. Use URL Inspection to request indexing of new pages

### GSC Health Checks

| Check | What to Look For |
|-------|------------------|
| Coverage | All sitemap URLs should be "Valid" or "Excluded by robots.txt" |
| Sitemaps | Last read date should be recent, status "Success" |
| Enhancements | No structured data errors |
| Core Web Vitals | LCP < 2.5s, FID < 100ms, CLS < 0.1 |

---

## Current State Snapshot

> Last updated: 2026-02-07

### Files Status

| File | Status | Notes |
|------|--------|-------|
| `src/app/robots.ts` | Active | Allow /, disallow /api/ /claim/ /mrclhnz-dashboard/ |
| `src/app/sitemap.ts` | Active | 16 pages indexed |
| `src/app/layout.tsx` | Active | Full metadata (OG, Twitter, robots, canonical) |
| `src/app/llms.txt/route.ts` | Active | Live stats, top 5 agents, API overview |
| `src/app/llms-full.txt/route.ts` | Active | Full docs, building/item tables, anti-exploit, FAQ |

### Sitemap Pages (16)

| Page | Priority | Frequency |
|------|----------|-----------|
| `/` | 1.0 | hourly |
| `/agent-search` | 0.9 | hourly |
| `/forum` | 0.9 | hourly |
| `/tournament` | 0.85 | daily |
| `/token` | 0.8 | weekly |
| `/about` | 0.8 | monthly |
| `/about/for-developers` | 0.8 | monthly |
| `/about/story` | 0.7 | monthly |
| `/how-it-works` | 0.7 | monthly |
| `/faq` | 0.7 | monthly |
| `/roadmap` | 0.7 | monthly |
| `/about/philosophy` | 0.6 | monthly |
| `/business` | 0.6 | monthly |
| `/privacy` | 0.3 | yearly |
| `/terms` | 0.3 | yearly |
| `/imprint` | 0.3 | yearly |

### Google Search Console

| Item | Status |
|------|--------|
| Property added | Pending |
| Verification method | HTML meta tag (placeholder in layout.tsx) |
| Sitemap submitted | Pending deployment |
| Key pages indexed | Pending |

### Recent Changes Log

| Date | Change |
|------|--------|
| 2026-02-07 | Initial setup: robots.ts, sitemap.ts, llms.txt, llms-full.txt, layout.tsx metadata enhancement |

---

## Agent Execution Summary

```
┌─────────────────────────────────────────────────────────┐
│  SEO & LLMs AGENT                                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. AUDIT:                                              │
│     • Read all 5 SEO files                              │
│     • Scan src/app/**/page.tsx for public pages         │
│     • Scan src/app/api/**/route.ts for API endpoints    │
│     • Compare against sitemap + llms.txt + llms-full    │
│                                                         │
│  2. SYNC:                                               │
│     • Add missing pages to sitemap.ts                   │
│     • Add missing endpoints to llms.txt/llms-full.txt   │
│     • Update constants if game mechanics changed        │
│     • Update layout.tsx metadata if branding changed    │
│     • Update robots.ts if new private routes added      │
│                                                         │
│  3. VALIDATE:                                           │
│     • npm run build — no errors                         │
│     • robots.txt — valid directives                     │
│     • sitemap.xml — all public URLs present             │
│     • llms.txt — markdown with live stats               │
│     • llms-full.txt — complete game documentation       │
│                                                         │
│  4. GSC:                                                │
│     • Check verification status                         │
│     • Submit sitemap if not submitted                   │
│     • Request indexing of new pages                     │
│     • Report any crawl errors                           │
│                                                         │
│  5. UPDATE this snapshot with changes made              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Notes for Agent

- Always guard Supabase calls with `isSupabaseConfigured` — the app should work without a DB
- Use ISR (`revalidate = 3600`) for llms routes — no need for real-time data
- Return `text/plain` content type for llms routes, not JSON
- Building and item tables are auto-generated from source code definitions
- When importing from `@/lib/types`, cast item definitions if needed to satisfy TypeScript strict mode
- The `verification.google` field in layout.tsx is commented out until GSC setup is complete
- Always update the "Current State Snapshot" section after making changes
