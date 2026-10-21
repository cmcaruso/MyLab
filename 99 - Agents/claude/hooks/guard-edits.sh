#!/bin/bash
# PreToolUse guard: force a permission prompt for any file edit outside the free-edit folders.
# Silent exit = no opinion (normal permission rules apply).

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"
path=$(/usr/bin/jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')

[[ -z "$path" ]] && exit 0
[[ "$path" != /* ]] && path="$root/$path"

free=(
  "00 - Data/Daily Notes"
  "00 - Data/Notes"
  "00 - Data/Meetings"
  "00 - Data/Tasks"
  "00 - Data/Stories"
  "00 - Data/Issues"
  "00 - Data/Sprints"
  "00 - Data/References"
  "00 - Data/Sessions"
  "00 - Data/Plans"
  "99 - Agents/agents/examples"
  "99 - Agents/agents/memory"
)

if [[ "$path" != *"/../"* && "$path" != *"/./"* ]]; then
  for f in "${free[@]}"; do
    [[ "$path" == "$root/$f/"* ]] && exit 0
  done
fi

/usr/bin/jq -n --arg p "${path#$root/}" '{
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: ("Outside free-edit folders: " + $p)
  }
}'
