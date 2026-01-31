# CLI Update Agent

This agent maintains the `clawcity` npm CLI package. Run this agent when API changes are deployed, new features are added, or when preparing a release.

**Package:** https://www.npmjs.com/package/clawcity
**Path** Path: /Users/marcelheinz/Library/Mobile Documents/com~apple~CloudDocs/Cursor/clawcity/clawhub/

---

## Quick Start

When triggered, execute these phases in order:
1. **Audit** → Check current package state on npm
2. **Scan** → Read repo for recent changes affecting CLI
3. **Analyze** → Identify gaps between published CLI and current repo
4. **Update** → Modify CLI source code
5. **Test** → Verify changes work locally
6. **Publish** → Release to npm

---

## Phase 1: Audit Current Package

### Check npm Registry

Run these commands to understand current published state:

```bash
# View current published version and metadata
npm view clawcity

# See all published versions
npm view clawcity versions --json

# Check download stats (popularity indicator)
npm view clawcity --json | grep -E '"version"|"description"'
```

### Expected Output to Capture

| Field | Value | Notes |
|-------|-------|-------|
| Current version | `x.x.x` | Record this |
| Last publish date | `YYYY-MM-DD` | Check if stale |
| Description | `...` | Does it match current branding? |
| Dependencies | `[...]` | Any security issues? |

### Check for Security Issues

```bash
# Audit published package for vulnerabilities
npm audit --registry https://registry.npmjs.org clawcity
```

---

## Phase 2: Scan Repository

### Files That Affect CLI Behavior

Read these files to understand what the CLI should do:

#### API Endpoints (CLI must call these correctly)
```
src/app/api/
├── agents/register/route.ts   → Registration flow
├── agents/me/route.ts         → Status checks
├── actions/*.ts               → All game actions
└── world/*.ts                 → World data
```

#### Skill File (CLI installs this)
```
skill/
├── clawcity.skill.ts          → Main skill file
└── README.md                  → Installation docs
```

#### Documentation (CLI references these URLs)
```
public/skill.md                → Quick reference URL
README.md                      → Installation instructions
```

#### Constants & Types
```
src/lib/types.ts               → Game constants
```

### Check for Recent Changes

```bash
# See commits in last 30 days affecting API or skill
git log --oneline --since="30 days ago" -- src/app/api/ skill/

# See if any breaking changes
git log --oneline --since="30 days ago" --grep="BREAKING\|breaking"
```

---

## Phase 3: Analyze Gaps

### Checklist: URL References

| URL in CLI | Expected Value | Status |
|------------|----------------|--------|
| Base API URL | `https://www.clawcity.app` | ⬜ Verify |
| Skill download URL | `https://www.clawcity.app/skill.md` | ⬜ Verify |
| Registration URL | `/api/agents/register` | ⬜ Verify |

### Checklist: Branding

| Item | Old Value | New Value | Status |
|------|-----------|-----------|--------|
| Package name | `clawhub` | `clawcity` | ⬜ Verify all references updated |
| CLI command name | ? | `clawcity` | ⬜ Verify |
| Output messages | ? | Should say "ClawCity" | ⬜ Verify |
| npm description | ? | Should match README | ⬜ Verify |

### Checklist: Feature Parity

For each feature in the skill file, verify CLI supports it:

| Feature | Skill Has | CLI Supports | Gap? |
|---------|-----------|--------------|------|
| Install skill | ✅ | ⬜ Check | |
| Configure API key | ✅ | ⬜ Check | |
| Test connection | ✅ | ⬜ Check | |
| Show help | ✅ | ⬜ Check | |
| Version flag | ✅ | ⬜ Check | |

### Checklist: API Compatibility

| Endpoint | Request Schema | CLI Sends Correct Schema? |
|----------|----------------|---------------------------|
| POST `/api/agents/register` | `{ name: string }` | ⬜ Verify |
| GET `/api/agents/me` | Headers: `x-api-key` | ⬜ Verify |
| POST `/api/actions/move` | `{ direction: string }` | ⬜ Verify |

---

## Phase 4: Update CLI Source

### Locate CLI Source Code

> **Important:** The CLI source is likely in a separate repository or folder.
> Common locations:
> - `../clawcity-cli/` (sibling folder)
> - A separate GitHub repo
> - Inside this repo in an `cli/` or `packages/cli/` folder

### CLI Package Structure (Expected)

```
clawcity-cli/
├── package.json         → Name, version, bin config
├── src/
│   ├── index.ts         → Entry point
│   ├── commands/        → CLI commands
│   │   ├── install.ts   → Install skill
│   │   ├── config.ts    → Configure API key
│   │   └── test.ts      → Test connection
│   └── utils/
│       └── api.ts       → API client
├── README.md            → npm page content
└── tsconfig.json
```

### Version Bump Rules

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Bug fix only | Patch | `1.0.0` → `1.0.1` |
| New feature (backward compatible) | Minor | `1.0.0` → `1.1.0` |
| Breaking change | Major | `1.0.0` → `2.0.0` |
| Rename from clawhub | Major | Forces fresh install |

### Update package.json

```json
{
  "name": "clawcity",
  "version": "X.X.X",          // Bump this
  "description": "CLI for ClawCity - AI Agent MMO",
  "bin": {
    "clawcity": "./dist/index.js"
  },
  "keywords": ["clawcity", "ai", "agent", "mmo", "openclaw"],
  "repository": {
    "type": "git",
    "url": "https://github.com/YOUR_ORG/clawcity"
  },
  "homepage": "https://www.clawcity.app"
}
```

### Update Hardcoded URLs

Search and replace any old URLs:

```bash
# Find all URL references in CLI source
grep -r "clawhub\|clawcity" --include="*.ts" --include="*.js"

# URLs that should exist:
# - https://www.clawcity.app (base)
# - https://www.clawcity.app/api/* (API endpoints)
# - https://www.clawcity.app/skill.md (skill reference)
# - https://www.clawcity.app/claim/* (claim links)
```

---

## Phase 5: Test Locally

### Build CLI

```bash
cd path/to/clawcity-cli

# Install dependencies
npm install

# Build TypeScript
npm run build

# Link globally for testing
npm link
```

### Test Commands

```bash
# Test help
clawcity --help

# Test version
clawcity --version

# Test install command (dry run if available)
clawcity install clawcity --dry-run

# Test against live API
clawcity test
```

### Verify Output Messages

Check that all output uses correct branding:
- [ ] Says "ClawCity" not "ClawHub"
- [ ] URLs point to clawcity.app
- [ ] Error messages are helpful

---

## Phase 6: Publish to npm

### Pre-Publish Checklist

- [ ] Version bumped in `package.json`
- [ ] All tests pass
- [ ] README.md is up to date
- [ ] CHANGELOG.md updated (if exists)
- [ ] No console.log debug statements
- [ ] No hardcoded test API keys
- [ ] Git working directory is clean

### Login to npm

```bash
# Login (one-time setup)
npm login

# Verify logged in
npm whoami
```

### Publish

```bash
cd path/to/clawcity-cli

# Final build
npm run build

# Publish to npm
npm publish

# If scoped package (@org/clawcity):
npm publish --access public
```

### Verify Publication

```bash
# Check it's live
npm view clawcity

# Test fresh install
npx clawcity@latest --version
```

### Post-Publish

1. Test `npx clawcity@latest install clawcity` works
2. Update this agent's "Current State" section
3. Announce update if significant changes

---

## Current State Snapshot

> Last updated: 2026-01-31

### Published Package Info

| Field | Value |
|-------|-------|
| Package name | `clawcity` |
| Current version | `(run npm view to check)` |
| Last publish | `(run npm view to check)` |
| CLI command | `npx clawcity` or `clawcity` |

### CLI Capabilities (Expected)

| Command | Description | Status |
|---------|-------------|--------|
| `clawcity install <skill>` | Install OpenClaw skill | ⬜ Verify |
| `clawcity --help` | Show help | ⬜ Verify |
| `clawcity --version` | Show version | ⬜ Verify |

### Known Issues

| Issue | Severity | Notes |
|-------|----------|-------|
| Old "clawhub" references? | High | Check if rename complete |
| (add issues as discovered) | | |

### Update History

| Date | Version | Changes |
|------|---------|---------|
| 2026-01-XX | 1.0.0 | Initial publish as clawcity |
| (previous) | - | Was "clawhub" package |

---

## Troubleshooting

### "npm ERR! 403 Forbidden"
- Check you're logged in: `npm whoami`
- Check you own the package: `npm owner ls clawcity`
- May need 2FA code if enabled

### "npm ERR! 402 Payment Required"
- Package name may be blocked/reserved
- Try scoped name: `@yourorg/clawcity`

### "Version already exists"
- Bump version in package.json
- Cannot republish same version number

### Users report CLI broken after API change
1. Check which endpoint changed
2. Update CLI to match new schema
3. Publish patch version immediately
4. Add to Known Issues until fixed

---

## Agent Execution Summary

```
┌─────────────────────────────────────────────────────────┐
│  CLI UPDATE AGENT                                       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. AUDIT npm package:                                  │
│     • npm view clawcity                                 │
│     • Check version, description, last update           │
│                                                         │
│  2. SCAN repository:                                    │
│     • Recent commits to src/app/api/                    │
│     • Changes to skill/clawcity.skill.ts               │
│     • URL and branding changes                          │
│                                                         │
│  3. ANALYZE gaps:                                       │
│     • Compare published CLI vs current repo             │
│     • Check all URLs are correct                        │
│     • Verify feature parity                             │
│                                                         │
│  4. UPDATE CLI source:                                  │
│     • Fix any gaps found                                │
│     • Bump version number                               │
│     • Update README if needed                           │
│                                                         │
│  5. TEST locally:                                       │
│     • npm link and test all commands                    │
│     • Verify branding is correct                        │
│                                                         │
│  6. PUBLISH:                                            │
│     • npm publish                                       │
│     • Verify with npx clawcity@latest                   │
│     • Update this snapshot                              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Reference: npm Commands

```bash
# View package info
npm view clawcity

# Check current logged in user
npm whoami

# Login to npm
npm login

# Publish package
npm publish

# Publish with public access (for scoped packages)
npm publish --access public

# Deprecate old version
npm deprecate clawcity@"< 1.0.0" "Please upgrade to latest"

# Transfer ownership
npm owner add <username> clawcity

# Unpublish (within 72 hours only)
npm unpublish clawcity@1.0.0
```

---

## Notes for Agent

- Always test locally before publishing
- Never publish with debug logging enabled
- Keep backward compatibility when possible
- Update both CLI and this snapshot after publishing
- If breaking change is needed, bump major version
- Consider `npm deprecate` for old versions with security issues
