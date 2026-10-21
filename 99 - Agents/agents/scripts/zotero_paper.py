#!/usr/bin/env python3
"""Read a paper's metadata, highlights and full text from Zotero, for a Reference note (/paper skill).
Agent-neutral: usable by Claude, Codex or any other agent working on the vault (see AGENTS.md).

Talks only to Zotero's local API (http://127.0.0.1:23119, Settings → Advanced → "Allow other
applications on this computer to communicate with Zotero"). Read-only: nothing in Zotero changes.
The local API lists annotations only with `children?itemType=annotation`; plain `children` omits them.

  python3 "99 - Agents/agents/scripts/zotero_paper.py" find "words in the title"
  python3 "99 - Agents/agents/scripts/zotero_paper.py" dump ITEMKEY [--out DIR]
  python3 "99 - Agents/agents/scripts/zotero_paper.py" frontmatter ITEMKEY [--set field=value ...]

`dump` writes <DIR>/<ITEMKEY>.json (metadata, abstract, highlights, full text) and prints only a
short report, so the paper's text stays out of the terminal. `frontmatter` prints the Reference
note draft; the agent writes it on OK, with the summary and highlight bullets in the body.
"""
import argparse
import json
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

VAULT = Path(__file__).resolve().parents[3]
REFERENCES = VAULT / "00 - Data" / "References"
API = "http://127.0.0.1:23119/api/users/0"
# Annotation types that carry text worth summarising; ink and image are skipped.
TEXT_ANNOTATIONS = {"highlight", "underline", "note", "text"}
GROUP_WORDS = {"team", "group", "consortium", "collaboration", "lab", "project"}
FIELDS = ["title", "name", "authors", "year", "venue", "doi", "arxiv", "url", "zotero"]
ARXIV_ID = re.compile(r"(?:arxiv[:/ ]|abs/|pdf/)(\d{4}\.\d{4,5})", re.I)


# ---- safety ------------------------------------------------------------------

def neutralise(text):
    """A zero-width space after `<` hides a Templater opening tag and reads the same."""
    return text.replace("<%", "<​%")


# ---- Zotero local API ----------------------------------------------------------

def get(path, **params):
    params.setdefault("format", "json")
    url = "{}/{}?{}".format(API, path, urllib.parse.urlencode(params))
    try:
        with urllib.request.urlopen(url, timeout=10) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise SystemExit("zotero_paper: no Zotero item at {}".format(path))
        raise SystemExit("zotero_paper: Zotero answered {} for {}".format(e.code, path))
    except (urllib.error.URLError, OSError):
        raise SystemExit("zotero_paper: Zotero isn't running or the local API is off "
                         "(Settings → Advanced → Allow other applications on this computer to communicate with Zotero)")


def get_all(path, **params):
    items, start = [], 0
    while True:
        page = get(path, start=start, limit=100, **params)
        items.extend(page)
        if len(page) < 100:
            return items
        start += 100


def pdf_attachments(key):
    return [c["data"] for c in get_all("items/{}/children".format(key))
            if c["data"].get("itemType") == "attachment" and c["data"].get("contentType") == "application/pdf"]


def annotations(pdf_key):
    return [a["data"] for a in get_all("items/{}/children".format(pdf_key), itemType="annotation")]


def fulltext(pdf_key):
    try:
        return get("items/{}/fulltext".format(pdf_key)).get("content", "")
    except SystemExit:
        return ""


# ---- metadata ----------------------------------------------------------------

def author_label(creators):
    """First author's surname + " et al."; a group name (`P. A. N. Team`) is kept whole."""
    authors = [c for c in creators if c.get("creatorType") == "author"] or creators
    if not authors:
        return ""
    first = authors[0]
    if "name" in first:
        label = first["name"]
    elif first.get("lastName", "").lower() in GROUP_WORDS:
        given = first.get("firstName", "")
        # Initials split by the importer ("P. A. N.") are an acronym: PAN.
        if re.fullmatch(r"(?:[A-Z]\.?\s*)+", given):
            given = re.sub(r"[.\s]", "", given)
        label = "{} {}".format(given, first["lastName"]).strip()
    else:
        label = first.get("lastName") or first.get("firstName", "")
    return label + (" et al." if len(authors) > 1 else "")


def arxiv_id(d):
    for field in ("archiveID", "extra", "url", "DOI"):
        m = ARXIV_ID.search(d.get(field) or "")
        if m:
            return m.group(1)
    m = re.search(r"arXiv\.(\d{4}\.\d{4,5})", d.get("DOI") or "")
    return m.group(1) if m else ""


def year_of(d, arxiv):
    # An arXiv id dates the first version; Zotero's date is often the latest revision.
    if arxiv:
        return 2000 + int(arxiv[:2])
    m = re.search(r"\b(19|20)\d{2}\b", d.get("date") or "")
    return int(m.group(0)) if m else None


def venue_of(d):
    for field in ("publicationTitle", "proceedingsTitle", "conferenceName", "bookTitle", "repository", "websiteTitle"):
        if d.get(field):
            return d[field]
    return ""


def paper(key):
    d = get("items/{}".format(key))["data"]
    if d.get("itemType") in ("attachment", "note", "annotation"):
        raise SystemExit("zotero_paper: {} is a {}; pass the paper's item key".format(key, d["itemType"]))
    arxiv = arxiv_id(d)
    title = re.sub(r"\s+", " ", d.get("title", "")).strip()
    out = {
        "key": key,
        "title": title,
        # The filename is the REF id, so the name keeps the title as is.
        "name": title,
        "authors": author_label(d.get("creators", [])),
        "year": year_of(d, arxiv),
        "venue": venue_of(d),
        "doi": d.get("DOI", ""),
        "arxiv": arxiv,
        "url": d.get("url") or ("https://arxiv.org/abs/" + arxiv if arxiv else ""),
        "zotero": "zotero://select/library/items/" + key,
        "zotero_tags": [t["tag"] for t in d.get("tags", []) if not t["tag"].startswith("/")],
        "abstract": d.get("abstractNote", ""),
    }
    out["missing"] = [f for f in FIELDS if not out.get(f)]
    return out


def highlights(pdf_key):
    notes = []
    for a in annotations(pdf_key):
        if a.get("annotationType") not in TEXT_ANNOTATIONS:
            continue
        notes.append({"page": a.get("annotationPageLabel", ""), "color": a.get("annotationColor", ""),
                      "type": a["annotationType"], "text": (a.get("annotationText") or "").strip(),
                      "comment": (a.get("annotationComment") or "").strip(),
                      "sort": a.get("annotationSortIndex", "")})
    notes.sort(key=lambda n: n["sort"])
    for n in notes:
        del n["sort"]
    return notes


# ---- commands ----------------------------------------------------------------

def cmd_find(args):
    items = get_all("items/top", q=args.query)
    if not items:
        print("no matching items")
    for it in items:
        d = it["data"]
        pdfs = pdf_attachments(d["key"])
        count = sum(len(annotations(p["key"])) for p in pdfs)
        print("{}  {:<15} {}  ({}; {} PDF, {} annotations)".format(
            d["key"], d.get("itemType", ""), d.get("title", ""), d.get("date") or "no date", len(pdfs), count))


def cmd_dump(args):
    out = paper(args.key)
    pdfs = pdf_attachments(args.key)
    out["pdfs"] = [p["key"] for p in pdfs]
    out["highlights"] = [h for p in pdfs for h in highlights(p["key"])]
    out["fulltext"] = "\n\n".join(fulltext(p["key"]) for p in pdfs)
    folder = Path(args.out) if args.out else Path(tempfile.mkdtemp(prefix="zotero_paper_"))
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "{}.json".format(args.key)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    colors = {}
    for h in out["highlights"]:
        colors[h["color"]] = colors.get(h["color"], 0) + 1
    print("wrote {}".format(path))
    print("title: {}".format(out["title"]))
    print("filled: {}".format(", ".join(f for f in FIELDS if f not in out["missing"])))
    print("missing: {}".format(", ".join(out["missing"]) or "none"))
    print("highlights: {} (by color: {}; with comments: {})".format(
        len(out["highlights"]), colors, sum(1 for h in out["highlights"] if h["comment"])))
    print("abstract: {} chars; full text: {} chars".format(len(out["abstract"]), len(out["fulltext"])))


def next_ref_id():
    nums = [int(m.group(1)) for p in REFERENCES.glob("REF-*.md") for m in [re.match(r"REF-(\d{4})\.md$", p.name)] if m]
    return "REF-{:04d}".format(max(nums, default=0) + 1)


def yaml_value(value):
    if value in ("", None):
        return ""
    if isinstance(value, int):
        return " {}".format(value)
    return " " + json.dumps(neutralise(str(value)), ensure_ascii=False)


def cmd_frontmatter(args):
    p = paper(args.key)
    for pair in args.set or []:
        field, _, value = pair.partition("=")
        if field not in FIELDS:
            raise SystemExit("zotero_paper: --set takes one of {}".format(", ".join(FIELDS)))
        p[field] = int(value) if field == "year" and value.isdigit() else value
    names = [p["name"]] + ([p["title"]] if p["title"] != p["name"] else [])  # differ only with --set name=
    lines = ["---", "type:", '  - "[[References]]"', '  - "[[Papers]]"',
             "name:" + yaml_value(p["name"]), "aliases:"]
    lines += ["  -" + yaml_value(n) for n in names]
    for field in ("authors", "year", "venue", "doi", "arxiv", "url", "zotero"):
        lines.append("{}:{}".format(field, yaml_value(p[field])))
    lines += ["cssclasses:", "  - wide", "  - justify", "  - hidden-css", "---",
              "# " + neutralise(p["title"]), "", "## Summary", "", "## My highlights", ""]
    note = "\n".join(lines)
    if "<%" in note:
        raise SystemExit("zotero_paper: the note would contain a Templater command; not drafted")
    print("File: 00 - Data/References/{}.md".format(next_ref_id()))
    print(note)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    f = sub.add_parser("find", help="top-level Zotero items matching words in the title, creators or year")
    f.add_argument("query")
    d = sub.add_parser("dump", help="write metadata, highlights and full text to <out>/<key>.json")
    d.add_argument("key")
    d.add_argument("--out", help="folder for the JSON; default a new temp folder")
    m = sub.add_parser("frontmatter", help="the Reference note draft for a paper")
    m.add_argument("key")
    m.add_argument("--set", action="append", metavar="FIELD=VALUE", help="fill or override a field, e.g. year=2024")
    args = ap.parse_args()
    {"find": cmd_find, "dump": cmd_dump, "frontmatter": cmd_frontmatter}[args.cmd](args)


if __name__ == "__main__":
    main()
