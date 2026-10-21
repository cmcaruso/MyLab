#!/bin/bash
# SessionEnd safety net: every Claude session on the vault must leave a Session note and
# its transcript in the vault. If no note in 00 - Data/Sessions carries this session_id,
# create a stub for Claude to fill next time; then export the transcript
# (99 - Agents/agents/transcripts/, readable .md + raw .jsonl) and link it from the note.

input=$(cat)
root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
dir="$root/00 - Data/Sessions"
sid=$(/usr/bin/jq -r '.session_id // empty' <<<"$input")
transcript=$(/usr/bin/jq -r '.transcript_path // empty' <<<"$input")

[[ -z "$sid" ]] && exit 0
mkdir -p "$dir"

# Skip trivial sessions: no transcript file (nothing was ever sent) or fewer than
# 2 user prompts. No note, no transcript.
[[ -f "$transcript" ]] || exit 0
prompts=$(grep -c '"type":"user"' "$transcript")
[[ "$prompts" -lt 2 ]] && exit 0

export_transcript() {
  [[ -f "$transcript" ]] || return 0
  # Detached: nimble's privacy check can outlast this hook's timeout. Until it ends, the
  # transcript reads `privacy_check: pending`.
  (nohup python3 "$root/99 - Agents/agents/scripts/export_transcript.py" "$transcript" --update-note >/dev/null 2>&1 &)
}
trap export_transcript EXIT

grep -qs "^session_id: $sid" "$dir"/*.md && exit 0

last=$(ls "$dir" 2>/dev/null | sed -n 's/^SES-\([0-9]\{4\}\)\.md$/\1/p' | sort -n | tail -1)
next=$(printf "SES-%04d" $((10#${last:-0} + 1)))
today=$(date "+%Y-%m-%d")
now=$(date "+%Y-%m-%dT%H:%M:00")

cat > "$dir/$next.md" <<EOF
---
type:
  - "[[Sessions]]"
name: "Session $today (stub)"
aliases:
  - "Session $today (stub)"
start:
end: $now
agent: "[[CLAUDE|Claude Code]]"
model:
session_id: $sid
plans:
topics:
  - stub
touched:
cssclasses:
  - wide
  - justify
archive: false
---
> [!warning] Stub created automatically at session end. Claude fills it from the transcript at the next session.
> Transcript: \`$transcript\`

## Goal

## Decisions

## Changes

## Corrections / learnings

## Open points
EOF
exit 0
