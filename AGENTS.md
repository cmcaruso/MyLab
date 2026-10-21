# MyLab vault — rules for AI agents

This is the owner's MyLab vault ("the owner" is you: whoever keeps their work here). These rules apply to **every** agent working on it: Claude, Codex, local models, anything else. `CLAUDE.md` and `CODEX.md` only add tool wiring on top. They never change these rules. Claude Code loads `CLAUDE.md` by itself; **Codex: read `CODEX.md` at the start of every session.**

## Hard limits

- Never delete, rename or move notes unless explicitly asked. If a note looks obsolete or duplicated, say so and leave it alone.
- Never `git push`, `git reset --hard`, `git clean`, `git checkout -- …`, `git restore`, `git stash`, `git rebase`, or delete branches. Never edit `.git/`.
- Commit only when asked.
- Don't touch `.obsidian/`, `.base` files or `00 - Data/Templates/` unless asked.
- Don't send vault content to external services unless asked.
- Read the calendar event cache (`99 - Agents/agents/cache/calendar-events.json`) only through `99 - Agents/agents/scripts/calendar_events.py`; never open, grep or print the file. It holds attendee emails and invite text, and whatever you print reaches git through your transcript.

## Notes

- Read the Ontology, `00 - Data/Notes/NOT-0001.md`, before classifying or creating any note. It defines the note types, their properties, the classification tree and the IDs. When the owner corrects a case it doesn't cover, propose an edit to it.
- Create new notes in the matching `00 - Data/<Type>/` folder, starting from the template in `00 - Data/Templates/`. Never create notes at the vault root.
- Preserve frontmatter keys, property names and `[[wikilinks]]`. Don't reformat or restyle notes you weren't asked to change.
- Never write literal Templater tags (`<%` … `%>`) in a new note outside `00 - Data/Templates/`, `00 - Data/Plans/` and `99 - Agents/`. Templater executes them when the file is created.

## Working together

- **Propose, then write.** Show what you'll create or change; write only after the owner's OK. Captures follow `99 - Agents/agents/skills/capture/SKILL.md`.
- **nimble is a second opinion, not an authority.** Run it on every capture decision, even when you're confident. Decide first, keep your proposal when nimble disagrees, and report what it returned (the capture skill lists what to report). The owner decides, and that decision is the fine-tuning label, so record disagreements, never smooth them over.
- **Session notes.** Every working session gets a note in `00 - Data/Sessions/` (template `Session Template.md`):
  - Create it early, with the next `SES-` ID. Set `agent` (`"[[CLAUDE|Claude Code]]"` or `"[[CODEX|Codex]]"`), `model` (your exact model id) and `session_id`.
  - Keep Decisions / Changes / Corrections / Open points current as you work.
  - List in `touched` every note you deliberately created or changed; describe bulk edits in Changes instead.
  - Set `end` before finishing. If you find a stub left by an earlier session, fill it in from its transcript.
- **Transcripts.** Each session's transcript is exported to `99 - Agents/agents/transcripts/` by a SessionEnd hook; if Codex's hook didn't run, export yourself (`CODEX.md`). nimble then checks it locally for private data and writes `privacy_check` into its frontmatter. Commit a transcript only when `privacy_check: clear`; anything else waits for the owner. Never read the flagged lines yourself: whatever you read leaves the machine.
- **Plans** go in `00 - Data/Plans/`, linked from the session note under `plans`.
- **Memory.** Durable facts and feedback live in `99 - Agents/agents/memory/`, one file per fact, indexed in `MEMORY.md`. Read the index at the start of a session; update a fact rather than duplicate it.

## Where things live

All agent material is in the visible folder `99 - Agents/`: `agents/` is agent-neutral, `claude/` and `codex/` are tool-specific. The dot folders `.agents/`, `.claude/` and `.codex/` keep only what tools must find there. No symlinks: they break in cloud-synced folders (iCloud, Google Drive).

| What | Where |
|---|---|
| Ontology | `00 - Data/Notes/NOT-0001.md` |
| Sessions / Plans | `00 - Data/Sessions/`, `00 - Data/Plans/` |
| Skills | `99 - Agents/agents/skills/<name>/SKILL.md`, with pointer copies in `.claude/skills/` and `.agents/skills/` |
| Scripts | `99 - Agents/agents/scripts/` (each has `--help`) |
| Logs: captures, nimble calls | `99 - Agents/agents/examples/captures.jsonl`, `nimble.jsonl` |
| Memory / Transcripts | `99 - Agents/agents/memory/`, `99 - Agents/agents/transcripts/` |

## Local model: nimble

`nimble` (Ollama; Bespoke-Nimble-9B) is a decision model, not a chat model: it scores lettered choices, and the probabilities are its confidence. Call it only through `99 - Agents/agents/scripts/nimble_classify.py`, which reproduces its exact prompt contract. Ollama must be running (`open -a Ollama`). nimble is optional: when it isn't available, say so, go on without it, and log `"nimble_id": null`. Setup is in the README.
