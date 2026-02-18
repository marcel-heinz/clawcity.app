#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

fail() {
  echo "ERROR: $1" >&2
  exit 1
}

[[ -f AGENTS.md ]] || fail "AGENTS.md is missing."
[[ -d .agents/skills ]] || fail ".agents/skills is missing."
[[ -f CLAUDE.md ]] || fail "CLAUDE.md bridge is missing."

grep -q "^@AGENTS\\.md$" CLAUDE.md || fail "CLAUDE.md must include @AGENTS.md."

bridge_lines="$(wc -l < CLAUDE.md | tr -d ' ')"
if [[ "${bridge_lines}" -gt 25 ]]; then
  fail "CLAUDE.md bridge is too large; keep detailed instructions in AGENTS.md."
fi

if [[ -e .claude/skills && ! -L .claude/skills ]]; then
  fail ".claude/skills must not be a real directory. Keep .agents/skills canonical."
fi

for legacy in .clod/skills .codex/skills; do
  if [[ -e "${legacy}" ]]; then
    fail "Legacy skill path '${legacy}' must not exist."
  fi
done

tracked_legacy_exists() {
  local path=""
  while IFS= read -r path; do
    if [[ -e "${path}" || -L "${path}" ]]; then
      return 0
    fi
  done < <(git ls-files "$@")
  return 1
}

if tracked_legacy_exists '.claude/skills' '.claude/skills/**'; then
  fail ".claude/skills is tracked in git; remove tracked legacy skills."
fi

if tracked_legacy_exists '.clod/skills' '.clod/skills/**' '.codex/skills' '.codex/skills/**'; then
  fail "Legacy skill directories are tracked in git."
fi

echo "Agent layout validation passed."
