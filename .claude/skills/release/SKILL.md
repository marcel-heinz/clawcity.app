---
name: release
description: Prepare and publish a new ClawCity release. Bumps version, updates CHANGELOG, creates git tag, and publishes a GitHub release. Run when shipping a new version.
---

# Release Agent

Prepares and publishes a new ClawCity release. Run this agent when you're ready to ship a version — it handles the changelog, git tag, GitHub release, and optional CLI publish.

**Repository:** https://github.com/marcel-heinz/clawcity.app
**Changelog:** `CHANGELOG.md` (Keep a Changelog format)
**Versioning:** [Semantic Versioning](https://semver.org/spec/v2.0.0.html)

---

## Quick Start

When triggered, execute these phases in order:
1. **Assess** → Determine version bump and review unreleased changes
2. **Changelog** → Update `CHANGELOG.md` with the new version entry
3. **Tag** → Create annotated git tag and push it
4. **Release** → Create GitHub release with release notes
5. **CLI** → Bump and publish `clawcity` CLI if affected (optional)
6. **Verify** → Confirm release is live and links work

---

## Phase 1: Assess

### Determine What Changed

```bash
# Find the latest existing tag
git describe --tags --abbrev=0 2>/dev/null || echo "No tags yet"

# See commits since last tag (or all commits if first release)
LAST_TAG=$(git describe --tags --abbrev=0 2>/dev/null)
if [ -n "$LAST_TAG" ]; then
  git log --oneline "$LAST_TAG"..HEAD
else
  git log --oneline
fi
```

### Categorize Changes

Review each commit and assign to a changelog category:

| Category | When to use |
|----------|-------------|
| **Added** | New features, endpoints, commands |
| **Changed** | Behavior changes, renames, dependency bumps |
| **Fixed** | Bug fixes |
| **Security** | Vulnerability fixes, hardening |
| **Deprecated** | Features marked for future removal |
| **Removed** | Deleted features, endpoints, files |

### Determine Version Bump

| Change Type | Bump | Example |
|-------------|------|---------|
| Bug fixes only | Patch | `0.2.0` → `0.2.1` |
| New features (backward compatible) | Minor | `0.2.0` → `0.3.0` |
| Breaking API/behavior changes | Major | `0.2.0` → `1.0.0` |

Confirm the version with the user before proceeding.

---

## Phase 2: Update Changelog

### Format

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format exactly:

```markdown
## [X.Y.Z] - YYYY-MM-DD

One-line release summary.

### Added
- **Feature name** — description

### Changed
- Description of change

### Fixed
- Description of fix

### Security
- Description of security improvement
```

### Rules

- Date is today's date in `YYYY-MM-DD` format
- Each entry starts with `- ` (dash space)
- Bold the feature/component name when it helps readability
- Keep descriptions concise — one line per item
- Add a compare link at the bottom of the file:
  ```markdown
  [X.Y.Z]: https://github.com/marcel-heinz/clawcity.app/compare/vPREV...vX.Y.Z
  ```
- Move any `## [Unreleased]` items into the new version section

### Files to Update

| File | Action |
|------|--------|
| `CHANGELOG.md` | Add new version section |
| `package.json` | Bump `version` field |

---

## Phase 3: Tag

### Create Annotated Tag

```bash
# Stage and commit changelog + version bump
git add CHANGELOG.md package.json
git commit -m "release: vX.Y.Z"

# Create annotated tag on the release commit
git tag -a vX.Y.Z -m "vX.Y.Z — Release title"

# Push commit and tag
git push origin main
git push origin vX.Y.Z
```

### Tag Naming

- Always prefix with `v`: `v0.3.0`, not `0.3.0`
- Tag message format: `vX.Y.Z — Short description`

---

## Phase 4: GitHub Release

### Create Release

```bash
# Using the full CHANGELOG as notes
gh release create vX.Y.Z \
  --title "vX.Y.Z — Release Title" \
  --notes-file CHANGELOG.md \
  --target main

# OR with a concise body (preferred for minor/patch releases)
gh release create vX.Y.Z \
  --title "vX.Y.Z — Release Title" \
  --target main \
  --notes "$(cat <<'EOF'
## Highlights

- Bullet point summary of key changes

See [CHANGELOG.md](./CHANGELOG.md) for full details.
EOF
)"
```

### Release Notes Guidelines

- For **major/first releases**: use `--notes-file CHANGELOG.md` for the full changelog
- For **minor/patch releases**: write a concise summary with highlights
- Always link back to `CHANGELOG.md` for full details

---

## Phase 5: CLI Publish (If Affected)

Only run this phase if changes affect the `clawcity` CLI package.

### Check If CLI Needs Update

```bash
# See if any CLI-relevant files changed since last tag
LAST_TAG=$(git describe --tags --abbrev=0 HEAD~1 2>/dev/null)
git diff --name-only "$LAST_TAG"..HEAD -- clawcity-cli/ src/app/api/ src/lib/types.ts
```

If files are returned, the CLI likely needs an update. Invoke the `cli-update` skill for the full CLI publish workflow.

### Quick CLI Version Bump

```bash
cd clawcity-cli
# Bump version to match or follow the main release
npm version patch  # or minor/major as appropriate
npm run build
npm publish
```

---

## Phase 6: Verify

### Checklist

```bash
# Verify tag exists on remote
git ls-remote --tags origin | grep vX.Y.Z

# Verify GitHub release page loads
gh release view vX.Y.Z

# Verify CHANGELOG compare link works
# https://github.com/marcel-heinz/clawcity.app/compare/vPREV...vX.Y.Z
```

### Post-Release

- [ ] GitHub release page is live
- [ ] Tag points to correct commit
- [ ] CHANGELOG.md compare links work
- [ ] CLI published (if applicable)
- [ ] Announce in Discord (if significant release)

---

## Reference: Current Release History

| Version | Date | Type | Notes |
|---------|------|------|-------|
| v0.2.0 | 2026-02-12 | First public release | Open-source, avatars, tournaments |
| v0.1.0 | 2026-02-09 | Internal release | Core engine, all game systems |

---

## Troubleshooting

### "tag already exists"
```bash
# Delete local tag and recreate
git tag -d vX.Y.Z
git tag -a vX.Y.Z -m "vX.Y.Z — Title"
```

### "gh: release already exists"
```bash
# Delete and recreate
gh release delete vX.Y.Z --yes
gh release create vX.Y.Z --title "..." --notes "..."
```

### Tag points to wrong commit
```bash
# Delete remote tag, fix locally, re-push
git push origin :refs/tags/vX.Y.Z
git tag -d vX.Y.Z
git tag -a vX.Y.Z <correct-sha> -m "vX.Y.Z — Title"
git push origin vX.Y.Z
```

---

## Agent Execution Summary

```
┌─────────────────────────────────────────────────────────┐
│  RELEASE AGENT                                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  1. ASSESS changes since last tag                       │
│     • Categorize commits (added/changed/fixed/security) │
│     • Determine semver bump (patch/minor/major)         │
│     • Confirm version with user                         │
│                                                         │
│  2. CHANGELOG                                           │
│     • Add new version section to CHANGELOG.md           │
│     • Bump version in package.json                      │
│     • Commit: "release: vX.Y.Z"                        │
│                                                         │
│  3. TAG                                                 │
│     • Create annotated git tag                          │
│     • Push commit and tag to origin                     │
│                                                         │
│  4. GITHUB RELEASE                                      │
│     • gh release create with notes                      │
│     • Major: full changelog / Minor: highlights only    │
│                                                         │
│  5. CLI (if affected)                                   │
│     • Bump clawcity-cli version                         │
│     • Build and publish to npm                          │
│                                                         │
│  6. VERIFY                                              │
│     • Confirm tag, release page, compare links          │
│     • Post-release checklist                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```
