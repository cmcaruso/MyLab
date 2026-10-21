# Codex-specific wiring

The rules are in `AGENTS.md`, shared with every agent; Codex reads that file directly. This note is Codex's counterpart of `CLAUDE.md`: Session notes and transcripts written by Codex link here in `agent`, and record the exact model in `model`. It only covers how Codex is wired to the rules:

- **Settings**: `.codex/config.toml` scopes the sandbox to the free-edit folders (plus transcript exports), turns local networking off, and sets `approval_policy = "on-request"`. Other local writes need sandbox escalation and the owner's approval. Permission profiles are beta and a launcher's `sandbox_mode` can override them, so check the active permissions when a session starts.
- **Hooks**: `99 - Agents/codex/hooks/vault_hooks.py`. A PreToolUse hook blocks the Git operations forbidden by `AGENTS.md`. A SessionEnd hook creates a stub Session note if you didn't write one and exports the transcript. Review and trust the hooks via `/hooks` before they run. They are defense in depth: hosted web tools and some specialized tools bypass them, and the rules still apply.
- **Transcripts**: Codex's are in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`. If the hook didn't run, export yourself before finishing: `python3 "99 - Agents/agents/scripts/export_transcript.py" <rollout.jsonl> --update-note`.
- **Skills**: `.agents/skills/` holds pointers to `99 - Agents/agents/skills/`. Keep nothing else in `.agents/`.
