#!/usr/bin/env python3
"""Rename vault entity notes to ID filenames (TSK-0042) and rewrite every link to them.

  python3 "99 - Agents/agents/scripts/migrate_ids.py"            # dry run: writes 99 - Agents/agents/migration/mapping.csv + dry-run.md
  python3 "99 - Agents/agents/scripts/migrate_ids.py" --apply    # applies mapping.csv (edit its `name` column first if you like)

Apply refuses to run on a dirty git tree: commit first, so `git` is the undo button.
Rules: 00 - Data/Notes/NOT-0001.md ("Vault Ontology") section 4.
"""
import argparse
import csv
import difflib
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

VAULT = Path(__file__).resolve().parents[3]
DATA = VAULT / "00 - Data"
OUT = VAULT / "99 - Agents" / "agents" / "migration"
MAPPING = OUT / "mapping.csv"

PREFIXES = {
    "Missions": "MIS", "Responsibilities": "RES", "Projects": "PRJ", "Epics": "EPC",
    "Stories": "STR", "Tasks": "TSK", "Issues": "ISS", "Meetings": "EVT", "Events": "EVT",
    "Sprints": "SPR", "References": "REF", "People": "PER", "Organizations": "ORG",
    "Notes": "NOT", "Sessions": "SES",
}
ID_RE = re.compile(r"^[A-Z]{3}-\d{4}$")
LINK_RE = re.compile(r"(!?)\[\[([^\]|#]+?)(#[^\]|]*)?(\\?\|[^\]]*)?\]\]")
BASE_LINK_RE = re.compile(r'link\("([^"]+)"\)')
DATE_PREFIX_RE = re.compile(r"^\d\d(-\d\d)?( ?- ?\d\d(-\d\d)?)?\s+")
# Project tokens used as name prefixes, beyond the Projects/ filenames themselves.
EXTRA_TOKENS = []  # e.g. ["CARDIO-FM", "PhD Marco"]


def git_added_time(path):
    out = subprocess.run(["git", "log", "--diff-filter=A", "--format=%at", "--", str(path.relative_to(VAULT))],
                         cwd=VAULT, capture_output=True, text=True).stdout.split()
    return int(out[-1]) if out else int(path.stat().st_mtime)


def propose_name(folder, stem, tokens):
    """Drop date and project prefixes that IDs make redundant; the CSV is for review."""
    if folder == "Sprints":
        return re.sub(r"\s*-\s*Current$", "", stem)
    if folder not in ("Epics", "Stories", "Tasks"):
        return stem
    rest = DATE_PREFIX_RE.sub("", stem)
    for token in tokens:
        if rest.lower().startswith(token.lower()) and (len(rest) == len(token) or rest[len(token)] in " -"):
            rest = rest[len(token):]
            break
    rest = re.sub(r"^[\s-]+", "", rest).strip()
    return rest or stem


def collect():
    tokens = sorted({p.stem for p in (DATA / "Projects").glob("*.md")} | set(EXTRA_TOKENS), key=len, reverse=True)
    rows, warnings = [], []
    used = defaultdict(int)
    candidates = []
    for folder, prefix in PREFIXES.items():
        d = DATA / folder
        if not d.is_dir():
            continue
        for sub in d.rglob("*.md"):
            if sub.parent != d:
                warnings.append(f"Skipped note in subfolder: {sub.relative_to(VAULT)}")
        for path in d.glob("*.md"):
            if ID_RE.match(path.stem):
                used[prefix] = max(used[prefix], int(path.stem[4:]))
            else:
                candidates.append((git_added_time(path), folder, path))
    for _, folder, path in sorted(candidates, key=lambda c: (list(PREFIXES).index(c[1]), c[0], c[2].stem)):
        prefix = PREFIXES[folder]
        used[prefix] += 1
        new_id = f"{prefix}-{used[prefix]:04d}"
        name = propose_name(folder, path.stem, tokens)
        rows.append({"folder": folder, "old": path.stem, "id": new_id, "name": name,
                     "name_changed": "yes" if name != path.stem else ""})
    dupes = [k for k, n in Counter(r["old"].lower() for r in rows).items() if n > 1]
    if dupes:
        warnings.append(f"Duplicate note names across folders (links are ambiguous): {dupes}")
    return rows, warnings


def yaml_str(value):
    return json.dumps(value, ensure_ascii=False)


def add_name(text, name):
    """Insert `name` after the type block and add it to `aliases`; leave everything else intact."""
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---" or "---" not in [l.strip() for l in lines[1:]]:
        return "---\nname: {0}\naliases:\n  - {0}\n---\n".format(yaml_str(name)) + text
    end = 1 + [l.strip() for l in lines[1:]].index("---")
    fm = lines[1:end]
    if any(l.startswith("name:") for l in fm):
        return text
    insert_at = 0
    for i, l in enumerate(fm):
        if l.startswith("type:"):
            insert_at = i + 1
            while insert_at < len(fm) and fm[insert_at].startswith("  "):
                insert_at += 1
            break
    new_fm = fm[:insert_at] + [f"name: {yaml_str(name)}"] + fm[insert_at:]
    alias_idx = next((i for i, l in enumerate(new_fm) if l.startswith("aliases:")), None)
    if alias_idx is None:
        new_fm.insert(insert_at + 1, "aliases:")
        new_fm.insert(insert_at + 2, f"  - {yaml_str(name)}")
    else:
        j = alias_idx + 1
        existing = []
        while j < len(new_fm) and new_fm[j].startswith("  "):
            existing.append(new_fm[j].strip()[2:].strip().strip('"'))
            j += 1
        if new_fm[alias_idx].strip() != "aliases:":  # inline scalar alias -> list
            existing.append(new_fm[alias_idx].split(":", 1)[1].strip().strip('"'))
            new_fm[alias_idx] = "aliases:"
            new_fm.insert(alias_idx + 1, f"  - {yaml_str(existing[-1])}")
            j += 1
        if name not in existing:
            new_fm.insert(j, f"  - {yaml_str(name)}")
    return "\n".join([lines[0]] + new_fm + lines[end:])


def rewrite_links(text, mapping):
    """mapping: lowercase old stem -> (id, name). Returns (new_text, count, unresolved set)."""
    count = 0
    out_lines = []
    for line in text.split("\n"):
        in_table = line.lstrip().startswith("|")

        def repl(m):
            nonlocal count
            bang, target, heading, alias = m.group(1), m.group(2), m.group(3) or "", m.group(4)
            key = target.strip()
            key = key[:-3] if key.lower().endswith(".md") else key
            key = key.rsplit("/", 1)[-1].lower()
            if key not in mapping:
                return m.group(0)
            new_id, name = mapping[key]
            count += 1
            if bang:
                return f"![[{new_id}{heading}{alias or ''}]]"
            if alias:
                return f"[[{new_id}{heading}{alias}]]"
            sep = "\\|" if in_table else "|"
            return f"[[{new_id}{heading}{sep}{name}]]"

        line = LINK_RE.sub(repl, line)

        def base_repl(m):
            nonlocal count
            key = m.group(1).lower()
            if key in mapping:
                count += 1
                return f'link("{mapping[key][0]}")'
            return m.group(0)

        line = BASE_LINK_RE.sub(base_repl, line)
        out_lines.append(line)
    return "\n".join(out_lines), count


def vault_files():
    for path in VAULT.rglob("*"):
        rel = path.relative_to(VAULT).parts
        if path.is_file() and path.suffix in (".md", ".base") and rel[0] not in (".git", ".obsidian", ".claude", ".agents", "99 - Agents", ".trash"):
            yield path


def plan(rows):
    mapping = {r["old"].lower(): (r["id"], r["name"]) for r in rows}
    renames = {DATA / r["folder"] / f"{r['old']}.md": DATA / r["folder"] / f"{r['id']}.md" for r in rows}
    names = {DATA / r["folder"] / f"{r['old']}.md": r["name"] for r in rows}
    edits = {}
    for path in vault_files():
        text = path.read_text(encoding="utf-8")
        new, n = rewrite_links(text, mapping)
        if path in names:
            new = add_name(new, names[path])
        if new != text:
            edits[path] = (text, new, n)
    return renames, edits


def dry_run():
    rows, warnings = collect()
    if not rows:
        # Keep the record of the last migration instead of overwriting it with an empty one.
        print("Nothing to migrate: every entity note already has an ID filename.", *warnings, sep="\n")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    with MAPPING.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["folder", "old", "id", "name", "name_changed"])
        w.writeheader()
        w.writerows(rows)
    renames, edits = plan(rows)
    per_folder = Counter(r["folder"] for r in rows)
    total_links = sum(n for _, _, n in edits.values())
    report = ["# Migration dry run", "",
              f"- Notes to rename: **{len(renames)}** ({', '.join(f'{k} {v}' for k, v in per_folder.items())})",
              f"- Files edited: **{len(edits)}**, links rewritten: **{total_links}**",
              f"- Names shortened (review `name` column): **{sum(1 for r in rows if r['name_changed'])}**",
              f"- Mapping: `{MAPPING.relative_to(VAULT)}`", ""]
    if warnings:
        report += ["## Warnings", *[f"- {w}" for w in warnings], ""]
    report += ["## Shortened names", "", "| old | id | name |", "|---|---|---|"]
    report += [f"| {r['old']} | {r['id']} | {r['name']} |" for r in rows if r["name_changed"]]
    report += ["", "## Sample diffs", ""]
    samples = sorted(edits.items(), key=lambda kv: -kv[1][2])[:3]
    for path, (old, new, n) in samples:
        d = "\n".join(difflib.unified_diff(old.split("\n"), new.split("\n"), str(path.relative_to(VAULT)), "after", lineterm="", n=0))
        report += [f"### {path.relative_to(VAULT)} ({n} links)", "```diff", d[:3000], "```", ""]
    (OUT / "dry-run.md").write_text("\n".join(report), encoding="utf-8")
    print("\n".join(report[:8 + len(warnings) + (2 if warnings else 0)]))
    print(f"Full report: {(OUT / 'dry-run.md').relative_to(VAULT)}")


def apply(force):
    dirty = subprocess.run(["git", "status", "--porcelain", "--", "00 - Data", "Home.md"], cwd=VAULT,
                           capture_output=True, text=True).stdout.strip()
    if dirty and not force:
        sys.exit("Refusing to apply: uncommitted changes under '00 - Data'. Commit a checkpoint first.")
    with MAPPING.open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    renames, edits = plan(rows)
    for path, (_, new, _) in edits.items():
        path.write_text(new, encoding="utf-8")
    for old, new in renames.items():
        if new.exists():
            sys.exit(f"Target exists, stopping: {new}")
        old.rename(new)
    print(f"Renamed {len(renames)} notes, edited {len(edits)} files.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--force", action="store_true", help="apply even with a dirty tree")
    args = ap.parse_args()
    apply(args.force) if args.apply else dry_run()
