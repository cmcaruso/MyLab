#!/usr/bin/env python3
"""Agent access to the Calendar plugin's event cache.
Agent-neutral: usable by Claude, Codex or any other agent working on the vault (see AGENTS.md).

The cache (99 - Agents/agents/cache/calendar-events.json) is written by the plugin on the
desktop. It holds attendee emails and invite descriptions, and anything an agent prints
reaches git through its transcript. So agents read it only through this script, which:
  - never prints an email (attendees by People link or by name; free text is scrubbed);
  - prints the description only with --description, with links shortened to their host;
  - prints full document links only in a draft, because they go into the note anyway.

Ticket 05's rules (previous occurrence, people by email, duplicates, vanished, link
candidates) are ported from the plugin's src/notes/rules.ts and pass the same fixture
(test/fixtures/notes/rules.json; see test_calendar_events.py). Drafts follow
src/notes/build.ts: the Meeting Template minus its Templater line, invite text neutralised.

  python3 "99 - Agents/agents/scripts/calendar_events.py" events [--date today|yesterday|YYYY-MM-DD] [--days N] [--query text] [--description]
  python3 "99 - Agents/agents/scripts/calendar_events.py" draft KEY [--name "YY-MM-DD Name"]
  python3 "99 - Agents/agents/scripts/calendar_events.py" link KEY [EVT-NNNN]

Nothing is written: drafts and link changes are proposals, written by the agent on OK.
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

VAULT = Path(__file__).resolve().parents[3]
SETTINGS = VAULT / ".obsidian" / "plugins" / "calendar" / "data.json"
# The plugin's defaults (src/settings/settings.ts), used when data.json is missing.
DEFAULTS = {"timezone": "Europe/Rome", "meetingsFolder": "00 - Data/Meetings",
            "meetingTemplate": "00 - Data/Templates/Meeting Template.md", "selfPerson": "",
            "cachePath": "99 - Agents/agents/cache/calendar-events.json"}
SKIP_DIRS = {".obsidian", ".git", ".trash", "node_modules"}
# The desktop rewrites an unchanged cache hourly, so an older file means it isn't running.
STALE = dt.timedelta(hours=2)

BUILT_IN_TEMPLATE = """---
type:
  - "[[Events]]"
  - "[[Meetings]]"
name:
aliases:
start:
duration: 1h
people:
related to:
cssclasses:
  - wide
  - hidden-css
---
### Decisions

### Action items
"""
# Where keys the template lacks are inserted, so the order matches the ontology's.
AFTER = {"aliases": "name", "calendar_ids": "aliases", "start": "calendar_ids", "duration": "start",
         "people": "duration", "related to": "people"}


# ---- safety ------------------------------------------------------------------

def neutralise(text):
    """A zero-width space after `<` hides a Templater opening tag and reads the same."""
    return text.replace("<%", "<​%")


def assert_safe_note(content):
    if "<%" in content:
        raise SystemExit("calendar_events: the note would contain a Templater command; not drafted")


EMAIL = re.compile(r"[\w.+'-]+@[\w-]+(\.[\w-]+)+")
# Consume URL punctuation too: stopping at a closing bracket leaks the query after it.
URL = re.compile(r"\b(?:https?|webcals?|file)://[^\s<>]+", re.I)


def host(url):
    try:
        return urlparse(url).hostname or "link"
    except ValueError:
        return "link"


def scrub(text):
    """Free text fit for agent output: links become their host, emails disappear."""
    text = URL.sub(lambda m: f"<{host(m.group(0))}>", text or "")
    return EMAIL.sub("<email>", text)


# ---- frontmatter (src/notes/frontmatter.ts) ----------------------------------

FENCE = re.compile(r"^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)")
KEY_LINE = re.compile(r"^([^\s#\-][^:]*?):(?:[ \t]|$)")
EMPTY = re.compile(r"^(null|~|\"\"|''|\[\])$")


def split_note(text):
    """(frontmatter without the fences, body); frontmatter is None when there is none."""
    m = FENCE.match(text)
    if not m:
        return None, text
    return m.group(1) or "", text[m.end():]


def join_note(frontmatter, body):
    return f"---\n{frontmatter}\n---\n{body}" if frontmatter else f"---\n---\n{body}"


def blocks(frontmatter):
    out = []
    for line in re.split(r"\r?\n", frontmatter) if frontmatter else []:
        m = KEY_LINE.match(line)
        key = m.group(1).strip() if m else None
        if key is not None or not out:
            out.append([key, [line]])
        else:
            out[-1][1].append(line)
    return out


def scalar(v):
    """Plain for dates, datetimes and durations, which Obsidian types from their shape; quoted otherwise."""
    if v and re.fullmatch(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?|(\d+h)?(\d+m)?", v):
        return v
    return json.dumps(v, ensure_ascii=False)


def render(key, value):
    if value is None or (isinstance(value, list) and not value):
        return [f"{key}:"]
    if not isinstance(value, list):
        return [f"{key}: {scalar(value)}"]
    return [f"{key}:", *(f"  - {scalar(v)}" for v in value)]


def set_fields(frontmatter, values, after=None):
    """Replaces keys in place; new ones go after the key named in `after`, else at the end."""
    after = after or {}
    bs = blocks(frontmatter)
    for key, value in values.items():
        block = [key, render(key, value)]
        i = next((n for n, b in enumerate(bs) if b[0] == key), -1)
        if i >= 0:
            bs[i] = block
            continue
        anchor = next((n for n, b in enumerate(bs) if b[0] == after.get(key)), -1) if key in after else -1
        bs.insert(anchor + 1 if anchor >= 0 else len(bs), block)
    return "\n".join(line for b in bs for line in b[1])


def value_and_comment(text):
    """Splits a trailing comment off, only outside quoted strings."""
    quote, i = "", 0
    while i < len(text):
        c = text[i]
        if quote:
            if quote == '"' and c == "\\":
                i += 2
                continue
            if c == quote:
                if quote == "'" and text[i + 1:i + 2] == "'":
                    i += 1
                else:
                    quote = ""
        elif c in "\"'" and (i == 0 or re.match(r"[\s\[,]", text[i - 1])):
            quote = c
        elif c == "#" and (i == 0 or text[i - 1].isspace()):
            return text[:i].strip(), text[i:]
        i += 1
    return text.strip(), ""


def flow_items(inline):
    """Scalar flow lists, splitting commas only outside quoted strings."""
    text, items, quote, start, i = inline[1:-1], [], "", 0, 0
    while i < len(text):
        c = text[i]
        if quote:
            if quote == '"' and c == "\\":
                i += 2
                continue
            if c == quote:
                if quote == "'" and text[i + 1:i + 2] == "'":
                    i += 1
                else:
                    quote = ""
        elif c in "\"'" and not text[start:i].strip():
            quote = c
        elif c == ",":
            items.append(text[start:i].strip())
            start = i + 1
        i += 1
    if quote:
        raise ValueError("unterminated quoted frontmatter list")
    items.append(text[start:].strip())
    return [x for x in items if x]


def unquote(v):
    s = v.strip()
    if len(s) > 1 and s[0] == s[-1] == '"':
        try:
            return json.loads(s)
        except ValueError:
            return s[1:-1]
    if len(s) > 1 and s[0] == s[-1] == "'":
        return s[1:-1].replace("''", "'")
    return s


def read_list(frontmatter, key):
    """A key as a list of strings: block items, an inline [a, b] list or one scalar; empty is []."""
    block = next((b for b in blocks(frontmatter) if b[0] == key), None)
    if not block:
        return []
    first = block[1][0]
    inline = value_and_comment(first[first.index(":") + 1:])[0]
    if inline and not EMPTY.match(inline):
        if inline.startswith("[") and inline.endswith("]"):
            return [x for x in map(unquote, flow_items(inline)) if x]
        return [unquote(inline)]
    items = []
    for line in block[1][1:]:
        m = re.match(r"^\s*-\s+(.*)$", line)
        if m:
            item = unquote(value_and_comment(m.group(1))[0])
            if item:
                items.append(item)
    return items


# ---- rules (src/notes/rules.ts) ----------------------------------------------

RECURRENCE = re.compile(r"@\d{8}(T\d{6}Z)?$")


def uid_of(key):
    """The UID part of an event key: `UID@RECURRENCE-ID` loses its RECURRENCE-ID; other `@`s stay."""
    return RECURRENCE.sub("", key)


def next_id(prefix, basenames):
    """The next free ID for a prefix, as new_entity.js computes it: highest in the vault + 1."""
    pattern = re.compile(prefix + r"-(\d{4})")
    nums = [int(m.group(1)) for m in map(pattern.fullmatch, basenames) if m]
    return f"{prefix}-{max(nums, default=0) + 1:04d}"


def default_name(event):
    return f"{event['start_local'][2:10]} {event['title'].strip()}"


def start_value(event):
    """`start` as written: local wall time with no offset, or a date for all-day events."""
    return event["start_local"][:10] if event["all_day"] else event["start_local"][:19]


def duration_value(event):
    """`1h`, `1h30m`, `45m`; None for all-day events, which have no `duration`."""
    if event["all_day"] or event["duration"] <= 0:
        return None
    h, m = divmod(event["duration"], 60)
    return f"{f'{h}h' if h else ''}{f'{m}m' if m else ''}"


def notes_by_key(notes):
    """Every event key → the notes listing it; more than one is a duplicate."""
    out = {}
    for note in notes:
        for key in dict.fromkeys(note["calendar_ids"]):
            out.setdefault(key, []).append(note)
    return out


def events_of(note, events):
    return [events[k] for k in note["calendar_ids"] if k in events]


def is_vanished(note, events):
    """Every event the note lists that is still in the cache has gone from its feeds."""
    own = events_of(note, events)
    return bool(own) and all(e["vanished_at"] is not None for e in own)


def latest(notes):
    best = None
    for n in notes:
        if best is None or n["start"] > best["start"]:
            best = n
    return best


def previous_occurrence(event, notes, events):
    """The latest earlier note with the same UID, else with the same title in a shared feed."""
    start = start_value(event)
    earlier = [n for n in notes if n["start"] and n["start"] < start and event["key"] not in n["calendar_ids"]]
    same_uid = [n for n in earlier if any(uid_of(k) == event["uid"] for k in n["calendar_ids"])]
    if same_uid:
        return latest(same_uid)
    return latest([n for n in earlier if any(
        e["title"] == event["title"] and any(f in event["feeds"] for f in e["feeds"]) for e in events_of(n, events))])


def link_id(link):
    m = re.match(r"\[\[([^|\]#]+)", link)
    return m.group(1) if m else link


def sort_links(links):
    """Dedupes links by target and sorts them by ID, as the existing notes list `people`."""
    by_id = {}
    for link in links:
        by_id.setdefault(link_id(link), link)
    return [by_id[k] for k in sorted(by_id)]


def persons(event):
    return [*event["attendees"], *([event["organizer"]] if event["organizer"] else [])]


def resolve_people(event, people, self_link, previous):
    """`people` for a note, and the names of attendees with no People note (never emails)."""
    by_email = {e.lower(): p["link"] for p in people for e in p["emails"]}
    links, others, seen = [self_link] if self_link else [], [], set()
    for p in persons(event):
        email = (p.get("email") or "").lower() or None
        if email and email in seen:
            continue
        if email:
            seen.add(email)
        if email and email in by_email:
            links.append(by_email[email])
            continue
        name = (p.get("name") or "").strip()
        if name and "@" not in name and name not in others:
            others.append(name)
    if not event["attendees"] and previous:
        links.extend(previous["people"])
    return sort_links(links), others


def email_only(event, people):
    """Attendees with no People note and no name, only an email: counted, never shown."""
    known = {e.lower() for p in people for e in p["emails"]}
    return len({(p.get("email") or "").lower() for p in persons(event)
                if p.get("email") and p["email"].lower() not in known
                and (not (p.get("name") or "").strip() or "@" in p["name"])})


def link_candidates(event, notes):
    """EVT notes not linked to the event: same date first, then by distance in days; no start last."""
    day = dt.date.fromisoformat(event["start_local"][:10])

    def distance(n):
        try:
            return abs((dt.date.fromisoformat(n["start"][:10]) - day).days) if n["start"] else float("inf")
        except ValueError:
            return float("inf")
    rest = [n for n in notes if event["key"] not in n["calendar_ids"]]
    rest.sort(key=lambda n: n["id"])
    rest.sort(key=lambda n: n["start"] or "", reverse=True)
    rest.sort(key=distance)
    return rest


# ---- drafts (src/notes/build.ts) ---------------------------------------------

def prepare_template(text):
    """The template minus its `<%* … -%>` line, with any other Templater tag blanked."""
    text = re.sub(r"^[ \t]*<%\*[\s\S]*?%>[ \t]*(?:\r?\n|$)", "", text, flags=re.M)
    return re.sub(r"<%[\s\S]*?%>", "", text)


def link_text(title):
    text = re.sub(r"\s+", " ", neutralise(title)).strip()
    return re.sub(r"[\\\[\]<>`]", r"\\\g<0>", text) or "link"


URL_ESCAPES = {" ": "%20", "(": "%28", ")": "%29", "<": "%3C", ">": "%3E"}


def link_url(url):
    return re.sub(r"[\x00-\x20\x7f\\()<>]",
                  lambda m: URL_ESCAPES.get(m.group(0), "%{:02X}".format(ord(m.group(0)))), url)


def markdown_link(doc):
    return f"[{link_text(doc['title'])}]({link_url(doc['url'])})"


def top_lines(body, documents, others):
    """One bullet per document the body lacks, then `Other attendees:` (transcripts: the plugin)."""
    lines = [f"- {markdown_link(d)}" for d in documents
             if f"({link_url(d['url'])})" not in body and f"({d['url']})" not in body]
    if others and not re.search(r"^Other attendees:", body, re.M):
        names = [re.sub(r"[\\`*_{}\[\]()<>!#|]", r"\\\g<0>", re.sub(r"\s+", " ", neutralise(n)).strip()) for n in others]
        lines.append(f"Other attendees: {', '.join(names)}")
    return lines


def insert_top(body, lines):
    """Inserts lines after the links already at the top of the body."""
    if not lines:
        return body
    rows = body.split("\n")
    i = 0
    while i < len(rows) and re.match(r"^(- )?\[.*\]\(.*\)\s*$", rows[i]):
        i += 1
    rest = rows[i:]
    gap = [""] if rest and rest[0].strip() and not rest[0].startswith("Other attendees:") else []
    return "\n".join([*rows[:i], *lines, *gap, *rest])


def build_note(template, note_id, folder, name, event, people, self_link, previous):
    """The note "Create note" writes (without transcripts): path, content, people, others, related."""
    name = neutralise(name)
    frontmatter, body = split_note(prepare_template(template))
    linked, others = resolve_people(event, people, self_link, previous)
    related = previous["related"] if previous else []
    fm = set_fields(frontmatter or "", {
        "name": name, "aliases": [name], "calendar_ids": [event["key"]], "start": start_value(event),
        "duration": duration_value(event), "people": linked, "related to": related,
    }, AFTER)
    content = join_note(fm, insert_top(body, top_lines(body, event["documents"], others)))
    assert_safe_note(content)
    folder = folder.rstrip("/")
    return {"path": f"{folder}/{note_id}.md" if folder else f"{note_id}.md", "content": content,
            "people": linked, "others": others, "related": related}


# ---- vault -------------------------------------------------------------------

def settings():
    try:
        return {**DEFAULTS, **json.loads(SETTINGS.read_text(encoding="utf-8"))}
    except (OSError, ValueError):
        return dict(DEFAULTS)


def markdown_files():
    for root, dirs, files in os.walk(VAULT):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for f in files:
            if f.endswith(".md"):
                yield Path(root) / f


class Vault:
    """EVT Meeting notes and People notes, read as the plugin's NoteWriter reads them."""

    def __init__(self):
        self.files = list(markdown_files())
        self.notes, self.people, self.names = [], [], {}
        for path in self.files:
            stem = path.stem
            if not re.fullmatch(r"(EVT|PER)-\d{4}", stem):
                continue
            try:
                fm, _ = split_note(path.read_text(encoding="utf-8"))
            except (OSError, UnicodeDecodeError):
                continue
            fm = fm or ""
            name = (read_list(fm, "name") or [None])[0]
            if stem.startswith("PER"):
                self.names[stem] = name
                emails = [e.strip().lower() for e in read_list(fm, "email") if "@" in e]
                if emails:
                    self.people.append({"link": self.link(stem, name), "emails": emails})
            elif "[[Meetings]]" in read_list(fm, "type"):
                self.notes.append({
                    "path": str(path.relative_to(VAULT)), "id": stem, "name": name,
                    "calendar_ids": read_list(fm, "calendar_ids"), "start": (read_list(fm, "start") or [None])[0],
                    "duration": (read_list(fm, "duration") or [None])[0], "people": read_list(fm, "people"),
                    "related": read_list(fm, "related to")})

    @staticmethod
    def link(stem, name):
        return f"[[{stem}|{name}]]" if name else f"[[{stem}]]"

    def self_link(self, person_id):
        return self.link(person_id, self.names[person_id]) if person_id in self.names else None

    def note(self, note_id):
        return next((n for n in self.notes if n["id"] == note_id), None)


def load_cache(conf):
    path = VAULT / conf["cachePath"]
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"calendar_events: no cache at {conf['cachePath']} (the plugin writes it on the desktop)")


def parse_time(iso):
    return dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))


def last_day(cache, feed):
    """The vault date of the feed's last published event; `last` itself is UTC."""
    last = parse_time(feed["last"])
    local = next((e["start_local"] for e in cache["events"]
                  if feed["label"] in e["feeds"] and parse_time(e["start"]) == last), None)
    return dt.date.fromisoformat((local or feed["last"])[:10])


def limited_feeds(conf):
    """Labels of feeds whose provider publishes only a window ahead (the plugin's
    `limitedWindow`; on by default for Microsoft 365, src/settings/settings.ts)."""
    return {f.get("label") for f in conf.get("feeds", [])
            if f.get("limitedWindow", f.get("provider") == "m365")}


def feed_flags(cache, now, end=None, limited=()):
    """Ticket 18's rule, as on the plugin's surfaces: a feed is STALE when its last good fetch
    is over 2 h old (with the error, if the last attempt failed). With the requested days'
    exclusive `end`, also flags limited-window feeds that publish nothing after a day before it."""
    lines = []
    for f in cache["feeds"]:
        error = f" (last fetch failed: {scrub(f.get('error') or '')})" if not f["ok"] else ""
        if not f["fetched_at"]:
            lines.append(f"STALE: {f['label']} has never been fetched{error}.")
            continue
        age = now - parse_time(f["fetched_at"])
        if age > STALE:
            lines.append(f"STALE: {f['label']} last fetched {int(age.total_seconds() // 3600)} h ago{error}; its events may be out of date.")
        if end and f["last"] and f["label"] in limited:
            day = last_day(cache, f)
            if end - dt.timedelta(days=1) > day:
                lines.append(f"{f['label']}: nothing published after {day}.")
    return lines


def header(cache, end=None, now=None, limited=()):
    """Cache age and feed health. The cache is STALE when desktop hasn't rewritten it for 2 h
    (it does so at least hourly); each feed is STALE by its own last good fetch."""
    now = now or dt.datetime.now(dt.timezone.utc)
    age = now - parse_time(cache["generated_at"])
    minutes = int(age.total_seconds() // 60)
    feeds = " · ".join(
        f"{f['label']} {'ok' if f['ok'] else 'FAILED: ' + scrub(f.get('error') or '')} {f['count']}"
        f" (span {(f['first'] or '?')[:10]} … {(f['last'] or '?')[:10]})" for f in cache["feeds"])
    lines = [f"cache: generated {minutes // 60} h {minutes % 60} min ago · {feeds}"]
    if age > STALE:
        lines.append("STALE: the desktop plugin hasn't rewritten the cache for over 2 h; events may be out of date.")
    return "\n".join(lines + feed_flags(cache, now, end, limited))


def when(event):
    if event["all_day"]:
        days = max(1, event["duration"] // 1440)
        return f"{event['start_local'][:10]} all day" + (f" ({days} days)" if days > 1 else "")
    return f"{event['start_local'][:10]} {event['start_local'][11:16]} ({duration_value(event) or '0m'})"


def describe(event, vault, events, by_key, self_link, description=False):
    lines = [f"{when(event)}  {scrub(event['title'])}  [{', '.join(event['feeds'])}]",
             f"  key: {event['key']}"]
    flags = [x for x in (event["status"] if event["status"] not in (None, "CONFIRMED") else None,
                         f"VANISHED {event['vanished_at'][:10]}" if event["vanished_at"] else None) if x]
    if flags:
        lines.append(f"  status: {', '.join(flags)}")
    notes = by_key.get(event["key"], [])
    if notes:
        lines.append(("  DUPLICATE notes: " if len(notes) > 1 else "  note: ")
                     + ", ".join(vault.link(n["id"], n["name"]) for n in notes))
        previous = None
    else:
        previous = previous_occurrence(event, vault.notes, events)
        lines.append("  note: none" + (f" · previous occurrence: {vault.link(previous['id'], previous['name'])}" if previous else ""))
    people, others = resolve_people(event, vault.people, self_link, previous)
    source = "attendees" if event["attendees"] else "previous occurrence" if previous else "no attendees"
    lines.append(f"  people ({source}): {', '.join(people) or '—'}")
    hidden = email_only(event, vault.people)
    if others or hidden:
        lines.append("  no People note: " + ", ".join([*map(scrub, others), *([f"{hidden} by email only"] if hidden else [])]))
    if event["location"]:
        lines.append(f"  location: {scrub(event['location'])}")
    if event["join"]:
        lines.append(f"  join: {host(event['join'])}")
    if event["documents"]:
        lines.append("  documents: " + "; ".join(f"{scrub(d['title'])} <{host(d['url'])}>" for d in event["documents"]))
    if description and event["description"].strip():
        lines.append("  description: " + scrub(event["description"]).strip().replace("\n", "\n    "))
    return "\n".join(lines)


def day_arg(text):
    """Relative names use the computer's date, which is the vault timezone's on the owner's computer."""
    today = dt.date.today()
    named = {"today": 0, "yesterday": -1, "tomorrow": 1}
    if text in named:
        return today + dt.timedelta(days=named[text])
    return dt.date.fromisoformat(text)


def overlaps(event, first, end):
    start = dt.datetime.fromisoformat(event["start_local"][:19] if not event["all_day"] else event["start_local"][:10])
    stop = start + dt.timedelta(minutes=event["duration"])
    lo, hi = dt.datetime.combine(first, dt.time()), dt.datetime.combine(end, dt.time())
    return start < hi and (stop > lo or start >= lo)


def matches(event, query):
    q = query.casefold()
    fields = [event["key"], event["title"], event["location"] or "", event["description"],
              *(p.get("name") or "" for p in persons(event) if "@" not in (p.get("name") or ""))]
    return any(q in f.casefold() for f in fields)


# ---- commands ----------------------------------------------------------------

def context():
    conf = settings()
    cache = load_cache(conf)
    vault = Vault()
    events = {e["key"]: e for e in cache["events"]}
    return conf, cache, vault, events, vault.self_link(conf["selfPerson"].strip())


def cmd_events(args):
    conf, cache, vault, events, self_link = context()
    first = day_arg(args.date)
    end = first + dt.timedelta(days=max(1, args.days))
    found = [e for e in cache["events"] if overlaps(e, first, end) and (not args.query or matches(e, args.query))]
    by_key = notes_by_key(vault.notes)
    print(header(cache, end, limited=limited_feeds(conf)))
    span = f"{first}" + (f" … {end - dt.timedelta(days=1)}" if args.days > 1 else "")
    print(f"{len(found)} event(s) on {span}" + (f" matching {args.query!r}" if args.query else "") + "\n")
    for e in found:
        print(describe(e, vault, events, by_key, self_link, args.description) + "\n")


def event_arg(events, key):
    if key not in events:
        raise SystemExit(f"calendar_events: no event with key {key!r} in the cache (try `events --query`)")
    return events[key]


def cmd_draft(args):
    conf, cache, vault, events, self_link = context()
    event = event_arg(events, args.key)
    if "<%" in event["key"]:
        raise SystemExit("calendar_events: the event key contains a Templater tag; refusing to draft")
    existing = notes_by_key(vault.notes).get(event["key"], [])
    if existing:
        raise SystemExit("calendar_events: the event already has "
                         + ", ".join(vault.link(n["id"], n["name"]) for n in existing)
                         + "; propose linking or updating that note instead (`link`)")
    try:
        template = (VAULT / conf["meetingTemplate"]).read_text(encoding="utf-8")
    except OSError:
        template = BUILT_IN_TEMPLATE
    previous = previous_occurrence(event, vault.notes, events)
    note_id = next_id("EVT", (p.stem for p in vault.files))
    draft = build_note(template, note_id, conf["meetingsFolder"], (args.name or "").strip() or default_name(event),
                       event, vault.people, self_link, previous)
    print(header(cache) + "\n")
    print(f"event: {when(event)}  {scrub(event['title'])}  [{', '.join(event['feeds'])}]")
    print("previous occurrence: " + (f"{vault.link(previous['id'], previous['name'])} (related to"
                                      + (" and people" if not event["attendees"] else "") + " copied)" if previous else "none"))
    hidden = email_only(event, vault.people)
    if hidden:
        print(f"{hidden} attendee(s) by email only: no name to write; \"+ PER\" in the plugin's modal can add them")
    print(f"path: {draft['path']}")
    print("Draft only, nothing written. Transcripts: \"Attach transcript\" in the plugin afterwards.")
    print("-----8<-----")
    print(draft["content"], end="")
    print("-----8<-----")


def cmd_link(args):
    conf, cache, vault, events, self_link = context()
    event = event_arg(events, args.key)
    print(header(cache) + "\n")
    print(f"event: {when(event)}  {scrub(event['title'])}  [{', '.join(event['feeds'])}]")
    linked = notes_by_key(vault.notes).get(event["key"], [])
    if linked:
        print("already linked: " + ", ".join(vault.link(n["id"], n["name"]) for n in linked)
              + (" (DUPLICATE)" if len(linked) > 1 else ""))
    if not args.note:
        print("candidates (same date first):")
        for n in link_candidates(event, vault.notes)[:8]:
            print(f"  {vault.link(n['id'], n['name'])}  start {n['start'] or '—'}")
        return
    note = vault.note(args.note)
    if not note:
        raise SystemExit(f"calendar_events: {args.note} is not an EVT Meeting note")
    text = (VAULT / note["path"]).read_text(encoding="utf-8")
    fm, body = split_note(text)
    fm = fm or ""
    print(f"note: {vault.link(note['id'], note['name'])} ({note['path']})")
    print("Proposed edits (Link note…: only empty fields are filled; nothing else changes):")
    ids = read_list(fm, "calendar_ids")
    print(f"  calendar_ids: {'already lists the key' if event['key'] in ids else 'append ' + json.dumps(event['key'])}")
    for key, value in (("start", start_value(event)), ("duration", duration_value(event))):
        current = read_list(fm, key)
        print(f"  {key}: " + (f"keep {current[0]}" if current else f"set {value}" if value else "leave empty"))
    others = []
    if read_list(fm, "people"):
        print("  people: keep as written")
    else:
        previous = previous_occurrence(event, vault.notes, events)
        people, others = resolve_people(event, vault.people, self_link, previous)
        print(f"  people: set {', '.join(people)}" if people else "  people: leave empty")
    lines = top_lines(body, event["documents"], others)
    if lines:
        print("  body: insert at the top, after any links already there:")
        for line in lines:
            assert_safe_note(line)
            print(f"    {line}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("events", help="events on a date, with matched People and linked EVT notes")
    e.add_argument("--date", default="today", help="today, yesterday, tomorrow or YYYY-MM-DD (vault timezone)")
    e.add_argument("--days", type=int, default=1)
    e.add_argument("--query", help="case-insensitive text in the title, location, names, key or description")
    e.add_argument("--description", action="store_true", help="also print the description (scrubbed)")
    d = sub.add_parser("draft", help="the EVT note the plugin's Create note would write, for a proposal")
    d.add_argument("key")
    d.add_argument("--name", help="the note's name; default `YY-MM-DD <title>`")
    k = sub.add_parser("link", help="link candidates for an event, or the edits linking it to a note")
    k.add_argument("key")
    k.add_argument("note", nargs="?", help="EVT-NNNN")
    args = ap.parse_args()
    {"events": cmd_events, "draft": cmd_draft, "link": cmd_link}[args.cmd](args)


if __name__ == "__main__":
    main()
