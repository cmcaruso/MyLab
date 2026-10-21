@AGENTS.md

# Claude-specific wiring

The rules are in `AGENTS.md` above, shared with every agent. This file only covers how Claude Code is wired to them:

- **Settings**: `.claude/settings.json` enforces the hard limits. A PreToolUse hook (`99 - Agents/claude/hooks/guard-edits.sh`) asks before any edit outside the free-edit folders.
- **Sessions**: a SessionEnd hook (`99 - Agents/claude/hooks/session-stub.sh`) creates a stub Session note if you didn't write one. It also exports the transcript to `99 - Agents/agents/transcripts/` and sets `transcript` on the note. Your session note's `session_id` is the Claude Code session id.
- **Plans**: `plansDirectory` is `00 - Data/Plans`, so plan-mode files land in the vault. After planning, add frontmatter to the plan (`type: [[Plans]]`, `name`, `session`) and link it from the session note.
- **Memory**: `.claude/settings.local.json` (machine-local, git-ignored; create it from the README) sets `autoMemoryDirectory` to `99 - Agents/agents/memory/`, so auto-memory is shared with other agents.
- **Skills**: `/capture` is `.claude/skills/capture/SKILL.md`, a pointer to `99 - Agents/agents/skills/capture/SKILL.md`. Add new procedures under `99 - Agents/agents/skills/`, plus pointers in `.agents/skills/` (for Codex) and `.claude/skills/` (for Claude).
- **Layout**: `.claude/` keeps only what Claude Code reads there: `settings.json`, `settings.local.json` (machine-local, git-ignored) and skill pointers. Everything else Claude-specific is in `99 - Agents/claude/`.
