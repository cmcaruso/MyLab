---
name: capture
description: File a quick free-text capture (a todo, problem, idea, meeting, link) into the MyLab vault as the right note type (Epic, Story, Task, Issue, Event, Reference, Note, Project), with correct frontmatter and parent links, a nimble confidence score, and a logged example. Use when the owner jots something to add to the vault or asks to capture it.
---

# Capture → vault note

Agent-neutral procedure, used by Claude, Codex and any other agent (see `AGENTS.md`). The capture is in the arguments, or in the owner's last message. Never write before the owner approves.

## 1. Understand
- Read `00 - Data/Notes/NOT-0001.md` (Vault Ontology), sections 2–6, if it isn't already in context this session.
- Run `python3 "99 - Agents/agents/scripts/nimble_classify.py" candidates` to get the active Projects, Epics and Stories (`id`, `name`, `parents`). Open a candidate note when its body matters for the decision.
- For a meeting, call or lesson, find its calendar event: `python3 "99 - Agents/agents/scripts/calendar_events.py" events --date <today|yesterday|YYYY-MM-DD> [--query <words>]`. It shows each event's key, time, people (as People links; never emails) and its EVT note, if it has one. Read the calendar cache only through this script.

## 2. Decide (you first)
Follow the decision tree in Ontology §3 and settle:
- **type**
- **parent**: an existing candidate id, or a proposed new parent (then the parent is a proposed note too)
- **name**: short; the project context comes from links, not from the name
- **language**: match the project's
- **properties**, per the template in `00 - Data/Templates/`
- for a **Story**: the derived Tasks (concrete, partial steps; usually 2–6)
- for an **Issue**: `blocking`
- for an **Event** that implies work: the work item too
- for an **Event** found in the calendar:
  - no note yet: the note to propose is `calendar_events.py draft <key> [--name "YY-MM-DD Name"]`, as the plugin's "Create note" would write it. Add the chosen parent to `related to` if it isn't there.
  - it already has a note: propose linking or updating that note instead (`calendar_events.py link <key> [EVT-NNNN]` lists candidates and the edits).
  - not in the calendar: the Meeting Template, as usual.

A capture may yield several notes, e.g. a Story + Tasks, or a Meeting + Tasks from its action items.

## 3. Second opinion (nimble)
```
python3 "99 - Agents/agents/scripts/nimble_classify.py" classify "<capture>" --agent-type <Type> --agent-parent <parent id> --agent <your model id>
```
nimble answers small successive questions, not one big choice:
- **Type**: `kind` (work to do / problem / dated happening / material to consult / unplanned idea / new endeavour), then, for work, `size` (Epic / Story / Task).
- **Parent**: a walk Project → Epic → Story, as deep as the type needs. At each level it first answers "does one of the existing ones fit?" (`fits_existing_<level>`). Only if yes does it choose among the children of the parent chosen so far. A "no" stops the walk: `parent.new` says what should be created and under what.

Report to the owner, from the output:
- the type and the parent path, with their probabilities (`type.prediction`/`type.p`, `parent.path`/`parent.p`);
- whether a new parent is needed, and at which level (`parent.new`); if you agree, propose that parent note too;
- the main alternative (`type.distribution`), and the step where you and nimble diverge (`steps`);
- how strongly it backs your choice (`agent_choice.type.p`, `agent_choice.parent.p`): ≥0.7 high, 0.4–0.7 medium, <0.4 low;
- `blocking`, for Issues;
- the `nimble_id` (logged automatically; keep it for step 6).

Keep your own proposal when nimble disagrees: show its alternative next to yours and say which way you lean and why. Ask for guidance when confidence is low. The owner's decision settles it.

## 4. Propose
Show a compact proposal:

```
Type: Story (nimble 0.52 · medium; alt: Event 0.16)
Parent: [[EPC-0002|Data pipeline]] (nimble 0.61)
File: 00 - Data/Stories/STR-0012.md
---
<full frontmatter>
---
Derived Tasks:
  TSK-0031 <name> — assignees, status Backlog, priority Medium
  ...
Event: <calendar key> · <time> <title>   (Events only; or "not in the calendar")
Questions: <only what you genuinely can't decide>
```

## 5. Write on OK
- IDs: next = the highest `<PREFIX>-NNNN` in the target folder + 1. The prefix table is in Ontology §4.
- Start from the template. Drop its first line (the Templater call `<%* … -%>`) and write real values in place of the `<% … %>` placeholders. Fill `name`, `aliases: [name]` and link properties as `"[[ID|Name]]"`. Always write `name`: Templater leaves notes that already have a name untouched.
- Task `status` defaults to `Backlog` and `priority` to the default in `.obsidian/plugins/property-styles/data.json` (the scheme for `priority`: `values` in rank order, `defaultId`); pick another value only when the capture states urgency or importance. A new Project gets the same default `priority`. Never write `status` or `priority` on Stories/Epics, and never write `sprints` on Tasks.
- Leave an unused list property bare (`epics:`). Never write an empty `- ` item: Bases shows it as `null`.
- A calendar draft: write its content exactly as printed, plus the parent in `related to`. A link: apply only the listed edits, with targeted edits. Transcripts are attached afterwards in Obsidian ("Attach transcript").
- Apply the owner's corrections before writing, then confirm the files written.

## 6. Log
Always log, even when rejected:
```
python3 "99 - Agents/agents/scripts/nimble_classify.py" log '<json>'
```
with:
```json
{"agent": "claude-opus-5-5 | codex-<model> | <local model>", "capture": "...", "session": "SES-00NN", "nimble_id": "<from step 3>", "event": "<calendar key> | null",
 "proposal": {"type": "...", "parent": "...", "name": "...", "props": {}, "derived": ["..."]},
 "nimble": {"type": "...", "type_p": 0.0, "parent_path": ["..."], "parent_p": 0.0, "new": null, "agent_choice": {...}},
 "disagreement": {"type": true, "parent": false},
 "user": {"decision": "accepted|corrected|rejected", "correction": "what changed and why, in the owner's words"},
 "label": {"type": "...", "parent": "...", "new_parent": null},
 "final": {"files": ["00 - Data/Stories/STR-0012.md"]}}
```
- `event`: the matched calendar event key, or null. Never emails or the description.
- `disagreement`: whether you and nimble disagreed, for each decision.
- `label`: The owner's final answer, the ground truth for fine-tuning. Fill it even when the owner just accepts: it then equals your proposal.
  - Record the owner's verdict **as stated**. If the owner gives only a type or a constraint (e.g. "its parent must be a Story"), the label is that constraint; don't pad it with your guesses or nimble's.
  - When the owner says an agent was right, that proposal is the label as it stands. Don't ask follow-up questions to make it more specific.
- Record the capture in the current Session note (`touched`, Changes).
- If the correction reveals a missing or wrong rule, propose an edit to the Ontology note.
