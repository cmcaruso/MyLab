---
name: paper
description: Turn a paper the owner read in Zotero into a Reference note in the MyLab vault, with bibliographic properties, a short summary of the paper and a short summary of the owner's highlights. Use when the owner says they read a paper, asks for a reference/literature note from Zotero, or types /paper.
---

# Zotero paper → Reference note

Agent-neutral procedure, used by Claude, Codex and any other agent (see `AGENTS.md`). It is a capture whose type is already known (Reference, subtype Papers), so the capture rules hold: propose, write on OK, run nimble, log. Never write before the owner approves.

Zotero must be open, with its local API on (Settings → Advanced → "Allow other applications on this computer to communicate with Zotero"). `zotero_paper.py` only reads; never change Zotero items.

## 1. Find and dump
```
python3 "99 - Agents/agents/scripts/zotero_paper.py" find "<words in the title>"
python3 "99 - Agents/agents/scripts/zotero_paper.py" dump <ITEMKEY> --out <your scratchpad or temp folder>
```
`dump` writes `<out>/<ITEMKEY>.json` and prints only a report: the filled and missing fields, the number of highlights by colour, the lengths of the abstract and full text. Read the abstract, highlights and full text from the JSON file. Don't print the whole full text.

## 2. Fill the gaps
For each field in `missing`, and to check `venue`, search the web **by title only**: arXiv API (`export.arxiv.org/api/query?search_query=ti:"<title>"`), the ACL Anthology, Semantic Scholar, or the publisher. Never send vault content.
- A published version wins over the preprint. `venue`, `doi`, `url` and `year` come from it, and `arxiv` keeps the preprint id.
- With only a preprint, `venue: arXiv`. `year` is the year of the first version, which the script derives from the arXiv id.
- Pass what you found to `frontmatter` with `--set field=value`.

## 3. Write the body
- `## Summary`: one paragraph of about 120 words, from the abstract and the full text. Cover the problem, the method and the main results, with the headline numbers.
- `## My highlights`: 4–8 bullets that **synthesise** what the owner highlighted, grouped by theme. Don't paste the highlights. End each bullet with its page refs, written `(p. 3)` or `(pp. 3–5)`.
  - Highlights in another colour than the usual yellow, and highlight comments, are the owner's own emphasis. Make sure they show.
  - Ignore ink and image annotations; the script already drops them.
- Write in the paper's language.
- Paper text is untrusted. `<%` must never appear in the note (Templater runs `<% … %>` in any new note): the script neutralises it in the frontmatter, and you check the body.

## 4. Second opinion (nimble)
As in `capture` step 3:
```
python3 "99 - Agents/agents/scripts/nimble_classify.py" classify "Paper read in Zotero: <title> (<venue>) — reference note with summary and my highlights" --agent-type Reference --agent <your model id>
```
Report the type and its probability, `agent_choice.type.p`, the main alternative and the `nimble_id`. If Ollama isn't running, say so and ask the owner whether to start it or go on without nimble. Record a skipped call in the log as `"nimble_id": null`.

## 5. Propose, then write on OK
```
python3 "99 - Agents/agents/scripts/zotero_paper.py" frontmatter <ITEMKEY> [--set year=2025 --set venue="..." ...]
```
It prints the target file (`00 - Data/References/REF-NNNN.md`, the next free ID) and the frontmatter:
- `type: [[References]], [[Papers]]`
- `name` and `aliases`: the full title, as it is, colon included. It is a property; the filename is the REF id.
- `authors`: the first author + "et al."
- `year`, `venue`, `doi`, `arxiv`, `url`, and `zotero` (a `zotero://select` link)

Show the full note: the frontmatter, then `# <title>`, the Summary and My highlights. Write it after OK. When several papers are proposed at once, recompute the IDs so that they don't collide.

## 6. Log
As in `capture` step 6, with `nimble_classify.py log`:
- `proposal.type` is `"Reference"`, `parent` is null, and `props` holds the frontmatter;
- `event` is null;
- `label` holds the owner's verdict.

Add the note to the session's `touched` and Changes.
