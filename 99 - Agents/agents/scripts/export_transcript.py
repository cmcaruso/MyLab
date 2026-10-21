#!/usr/bin/env python3
"""Store an agent session transcript inside the vault: raw copy + readable Markdown.

  python3 "99 - Agents/agents/scripts/export_transcript.py" <transcript.jsonl> [--update-note] [--no-privacy-check]

Supports Claude Code (~/.claude/projects/<project>/<session>.jsonl) and Codex
(~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl); the format is detected.
Writes 99 - Agents/agents/transcripts/<date>-<agent>-<id8>.jsonl (raw, git-ignored) and .md
(readable: the user's messages, answers to questions, agent replies, one line per
tool call). With --update-note, sets `transcript: [[<name>|Transcript]]` on the Session
note whose `session_id` matches. Safe to re-run: files are overwritten with the latest state.
Both vault copies are redacted (see REDACTIONS); the source transcript is left untouched.
Then nimble checks the .md for private data, locally (nimble_privacy.py), and the verdict goes
into its frontmatter: `privacy_check: clear | flagged | not run`, plus `privacy_flags` (line
ranges) when flagged. It reads `pending` while the check runs, so an interrupted check never
reads as clear.
"""
import argparse
import datetime as dt
import json
import re
from pathlib import Path

VAULT = Path(__file__).resolve().parents[3]
OUT = VAULT / "99 - Agents" / "agents" / "transcripts"
SESSIONS = VAULT / "00 - Data" / "Sessions"
NIMBLE_LOG = VAULT / "99 - Agents" / "agents" / "examples" / "nimble.jsonl"
REMINDER_RE = re.compile(r"<system-reminder>.*?</system-reminder>", re.S)
# `agent` in notes links the agent's vault note; the exact model goes in `model`.
AGENT_LINKS = {"claude-code": "[[CLAUDE|Claude Code]]", "codex": "[[CODEX|Codex]]"}
# Tool results that carry the user's own words (answers, approvals).
USER_VOICE_TOOLS = {"AskUserQuestion", "ExitPlanMode"}

# Secrets never reach the vault copies: calendar feed URLs, API keys and tokens, credentials
# in URLs, private keys, and env-style assignments. Only the value is replaced, and quotes and
# backslashes are never consumed, so a redacted JSONL still parses.
R = "[redacted]"
V = r"[^\s\"'\\<>`)]"  # one character of a secret value
ENV_SAFE = "PATH|HOME|SHELL|USER|LANG|TERM|TZ|PWD|OLDPWD|EDITOR|NODE_ENV|PYTHONPATH"
REDACTIONS = [
    # Google secret iCal, Outlook published ICS, iCloud public calendar
    (re.compile(rf"(?:https?|webcal)://(?:calendar\.google\.com/calendar/ical|outlook\.office(?:365)?\.com/owa/calendar"
                rf"|[\w-]+\.icloud\.com/published)/{V}*"), R),
    # Link-protection wrappers (Sophos, TitanHQ linklock, Microsoft Safe Links) encode the original link in the query
    (re.compile(rf"(\b(?:[\w-]+\.protection\.sophos\.com|linklock\.titanhq\.com|[\w-]+\.safelinks\.protection\.outlook\.com)"
                rf"/?[^\s?\"'\\<>`)]*\?){V}+"), rf"\1{R}"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[^\"]*?-----END [A-Z ]*PRIVATE KEY-----"), R),
    # Anthropic/OpenAI, GitHub, GitLab, Hugging Face, Google, AWS, Slack, Stripe keys; JWTs
    (re.compile(r"\b(?:sk-(?:ant-|proj-)?[\w-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_\w{40,}|glpat-[\w-]{20,}"
                r"|hf_[A-Za-z0-9]{30,}|AIza[\w-]{35}|(?:AKIA|ASIA)[0-9A-Z]{16}|xox[abposr]-[\w-]{10,}"
                r"|[rs]k_(?:live|test)_[A-Za-z0-9]{20,}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,})"), R),
    (re.compile(rf"(\bBearer\s+){V}{{20,}}"), rf"\1{R}"),
    (re.compile(rf"(\b[a-z][a-z0-9+.-]*://[^\s:/@\"'\\]+:){V}+?@"), rf"\1{R}@"),  # user:password@host
    (re.compile(r"([?&](?:key|api_?key|token|access_token|secret|sig|signature|password)=)[^\s&\"'\\<>`]+", re.I), rf"\1{R}"),
    # API_KEY=…, "access_token": "…", password: …  (the value needs a letter, so token counts survive)
    (re.compile(rf"(\b(?:(?:\w+[_-])?(?:api[_-]?key|token|secret|password|passwd|credentials?)"
                rf"|(?:\w+[_-])?(?:secret|private|access|auth|client|signing|encryption|master|license)[_-]?key)"
                rf"(?:\\?[\"'])?\s*[=:]\s*(?:\\?[\"'])?)(?=[^\s\"'\\]*[A-Za-z])(?!(?:true|false|null|none)\b){V}{{8,}}", re.I), rf"\1{R}"),
    # .env lines: UPPER_NAME=value at a line start, also at the start of a JSON string or after an escaped \n
    (re.compile(rf"((?:^|(?<=\\n)|(?<=\"))(?:export\s+)?(?!(?:{ENV_SAFE})=)[A-Z][A-Z0-9_]{{2,}}=){V}{{8,}}", re.M), rf"\1{R}"),
]


def redact(text):
    """(text with secrets replaced by [redacted], number of replacements)."""
    total = 0
    for pattern, repl in REDACTIONS:
        text, n = pattern.subn(repl, text)
        total += n
    return text, total


def local_time(ts):
    try:
        return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%d %H:%M")
    except (AttributeError, ValueError):
        return ""


def text_of(content):
    if isinstance(content, str):
        return content
    parts = []
    for block in content or []:
        if isinstance(block, dict) and block.get("type") in ("text", "input_text", "output_text"):
            parts.append(block.get("text", ""))
    return "\n".join(parts)


def tool_line(name, args):
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = {"input": args}
    args = args or {}
    hint = (args.get("description") or args.get("file_path") or args.get("command") or args.get("cmd")
            or args.get("query") or args.get("input") or "")
    hint = " ".join(str(hint).split())[:120]
    return f"- `{name}`" + (f" — {hint}" if hint else "")


def is_nimble_call(args):
    """True when a tool call ran `nimble_classify.py classify` (any agent, any shell wrapper)."""
    text = args if isinstance(args, str) else json.dumps(args or {})
    return re.search(r"nimble_classify\.py[\\\"']*\s+classify\b", text) is not None


def load_nimble_log():
    records = []
    if NIMBLE_LOG.exists():
        for line in NIMBLE_LOG.read_text(encoding="utf-8").splitlines():
            try:
                rec = json.loads(line)
                rec["_ts"] = dt.datetime.fromisoformat(rec["ts"])
                records.append(rec)
            except (ValueError, KeyError):
                continue
    return records


NIMBLE_RECORDS = None


def nimble_from_log(call_args, t_call, t_result):
    """Logged nimble records for this call: same capture text, logged between call and result.
    Works even when the agent piped or reformatted the script's output."""
    global NIMBLE_RECORDS
    if NIMBLE_RECORDS is None:
        NIMBLE_RECORDS = load_nimble_log()
    text = call_args if isinstance(call_args, str) else json.dumps(call_args or {}, ensure_ascii=False)
    lo, hi = t_call - dt.timedelta(seconds=5), t_result + dt.timedelta(seconds=5)
    hits = [r for r in NIMBLE_RECORDS if lo <= r["_ts"] <= hi and r.get("capture") and r["capture"] in text.replace('\\"', '"')]
    blocks = []
    for r in hits:
        data = {k: v for k, v in r.items() if k != "_ts"}
        data["nimble_id"] = data.get("id")
        if "fields" in data:  # v1 records
            data["fields"] = {k: {kk: vv for kk, vv in f.items() if kk != "schema"} for k, f in data["fields"].items()}
        blocks.append(nimble_block(json.dumps(data, ensure_ascii=False)))
    return [b for b in blocks if b]


def to_local(ts):
    try:
        return dt.datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
    except (AttributeError, ValueError):
        return None


def nimble_blocks(call_args, t_call, t_result, output):
    """Prefer the logged records; fall back to parsing the printed output."""
    if t_call and t_result:
        blocks = nimble_from_log(call_args, t_call, t_result)
        if blocks:
            return blocks
    block = nimble_block(output)
    return [block] if block else []


def nimble_block(output):
    """Render nimble's classify output (JSON somewhere in a tool result) as a callout, or None."""
    text = output if isinstance(output, str) else text_of(output)
    start, end = text.find("{"), text.rfind("}")
    try:
        data = json.loads(text[start:end + 1])
    except ValueError:
        return None
    if isinstance(data, dict) and "steps" in data and "type" in data:
        return nimble_block_v2(data)
    if not isinstance(data, dict) or "fields" not in data:
        return None
    lines = [f"> [!info] nimble · `{data.get('nimble_id', 'not logged')}`"]
    for field, res in data["fields"].items():
        probs = list(res.get("probabilities", {}).items())
        top = f"**{res.get('prediction')}** {probs[0][1]:.2f}" if probs else f"**{res.get('prediction')}**"
        alts = ", ".join(f"{k} {v:.2f}" for k, v in probs[1:3])
        lines.append(f"> - {field}: {top}" + (f" (alt: {alts})" if alts else ""))
    agree = data.get("agent_choice_probability") or {}
    if agree:
        lines.append("> - agent's choice backed at: " + ", ".join(f"{k} {v:.2f}" for k, v in agree.items()))
    if data.get("warning"):
        lines.append(f"> - warning: {data['warning']}")
    return "\n".join(lines)


def nimble_block_v2(data):
    """Structured decisions (type tree + parent walk) as a callout."""
    fmt = lambda d, n=2: ", ".join(f"{k} {v:.2f}" for k, v in list(d.items())[:n])
    t, par = data["type"], data["parent"]
    alts = dict(list(t["distribution"].items())[1:3])
    lines = [f"> [!info] nimble · `{data.get('nimble_id', 'not logged')}`",
             f"> - type: **{t['prediction']}** {t['p']:.2f}" + (f" (alt: {fmt(alts)})" if alts else "")]
    if par.get("path"):
        lines.append(f"> - parent: **{par['name']}** ({par['prediction']}) via {' → '.join(par['path'])} · {par['p']:.2f}")
    if par.get("new"):
        under = f" under {par['new']['under']}" if par["new"].get("under") else ""
        lines.append(f"> - none of the existing {par['new']['level'].lower()} fits → new one needed{under}")
    if "blocking" in data:
        b = data["blocking"]
        lines.append(f"> - blocking: **{b['prediction']}** {b['p']:.2f}")
    agree = data.get("agent_choice") or {}
    if agree:
        lines.append("> - agent's choice backed at: " + ", ".join(f"{k} {v['choice']} {v['p']:.2f}" for k, v in agree.items()))
    path = [s for s in data["steps"] if not s.get("agent_check")]
    lines.append("> - steps: " + " → ".join(f"{s['field']} {s['prediction']} {s['p']:.2f}" + (" (only option)" if s.get("only_option") else "") for s in path))
    return "\n".join(lines)


def parse_claude(rows):
    meta = {"agent": "claude-code", "session_id": None, "cwd": None, "model": None}
    tool_names, tool_inputs, tool_times, turns = {}, {}, {}, []
    for r in rows:
        meta["session_id"] = meta["session_id"] or r.get("sessionId")
        meta["cwd"] = meta["cwd"] or r.get("cwd")
        if r.get("type") not in ("user", "assistant") or r.get("isMeta") or r.get("isSidechain"):
            continue
        msg, ts = r.get("message", {}), local_time(r.get("timestamp"))
        content = msg.get("content")
        if r["type"] == "assistant":
            meta["model"] = msg.get("model") or meta["model"]
            for block in content if isinstance(content, list) else [{"type": "text", "text": content}]:
                if block.get("type") == "text" and block.get("text", "").strip():
                    turns.append(("agent", ts, block["text"].strip()))
                elif block.get("type") == "tool_use":
                    tool_names[block.get("id")] = block.get("name")
                    tool_inputs[block.get("id")] = block.get("input")
                    tool_times[block.get("id")] = to_local(r.get("timestamp"))
                    turns.append(("tool", ts, tool_line(block.get("name"), block.get("input"))))
        else:
            if isinstance(content, list) and any(b.get("type") == "tool_result" for b in content if isinstance(b, dict)):
                for block in content:
                    tid = block.get("tool_use_id")
                    if block.get("type") == "tool_result" and is_nimble_call(tool_inputs.get(tid)):
                        for rendered in nimble_blocks(tool_inputs.get(tid), tool_times.get(tid), to_local(r.get("timestamp")), block.get("content")):
                            turns.append(("nimble", ts, rendered))
                    if block.get("type") == "tool_result" and tool_names.get(block.get("tool_use_id")) in USER_VOICE_TOOLS:
                        answer = REMINDER_RE.sub("", text_of(block.get("content"))).strip()
                        if answer:
                            turns.append(("answer", ts, answer))
                continue
            text = REMINDER_RE.sub("", text_of(content)).strip()
            if text and not text.startswith("<local-command") and not text.startswith("<command-"):
                turns.append(("user", ts, text))
    return meta, turns


def parse_codex(rows):
    meta = {"agent": "codex", "session_id": None, "cwd": None, "model": None}
    turns, nimble_calls = [], {}
    for r in rows:
        p, ts = r.get("payload") or {}, local_time(r.get("timestamp"))
        if r.get("type") == "session_meta":
            meta["session_id"] = meta["session_id"] or p.get("id")
            meta["cwd"] = meta["cwd"] or p.get("cwd")
        elif r.get("type") == "turn_context":
            meta["cwd"] = meta["cwd"] or p.get("cwd")
            meta["model"] = p.get("model") or meta["model"]
        elif r.get("type") == "response_item":
            kind = p.get("type")
            if kind == "message" and p.get("role") in ("user", "assistant"):
                text = text_of(p.get("content")).strip()
                if not text or (p["role"] == "user" and (text.startswith("<") or text.startswith("# AGENTS.md"))):
                    continue
                turns.append(("user" if p["role"] == "user" else "agent", ts, text))
            elif kind in ("function_call", "custom_tool_call"):
                args = p.get("arguments") or p.get("input")
                turns.append(("tool", ts, tool_line(p.get("name"), args)))
                if is_nimble_call(args):
                    nimble_calls[p.get("call_id")] = (args, to_local(r.get("timestamp")))
            elif kind in ("function_call_output", "custom_tool_call_output") and p.get("call_id") in nimble_calls:
                args, t_call = nimble_calls[p.get("call_id")]
                for rendered in nimble_blocks(args, t_call, to_local(r.get("timestamp")), p.get("output")):
                    turns.append(("nimble", ts, rendered))
    return meta, turns


def session_note(session_id):
    """(path, name) of the Session note whose session_id matches, or (None, None)."""
    for note in sorted(SESSIONS.glob("*.md")):
        text = note.read_text(encoding="utf-8")
        if re.search(rf"(?m)^session_id: {re.escape(session_id)}\s*$", text):
            m = re.search(r'(?m)^name: "?(.*?)"?\s*$', text)
            return note, (m.group(1) if m else note.stem)
    return None, None


def iso(ts):
    return ts.replace(" ", "T") + ":00" if ts else ""


def render(meta, turns, source):
    times = [t for _, t, _ in turns if t]
    start, end = (times[0], times[-1]) if times else ("", "")
    who = {"user": "User", "answer": "User (answer)", "agent": meta["agent"]}
    note, note_name = session_note(meta["session_id"])
    title = f"Transcript: {note_name}" if note_name else f"Transcript: {meta['agent']} {meta['session_id'][:8]}"
    q = lambda v: json.dumps(v, ensure_ascii=False)
    lines = ["---", "type:", f"  - {q('[[Session Transcripts]]')}", f"name: {q(title)}", "aliases:", f"  - {q(title)}",
             f"agent: {q(AGENT_LINKS.get(meta['agent'], meta['agent']))}", f"model: {meta['model'] or 'unknown'}"]
    if note:
        lines.append(f"session: {q(f'[[{note.stem}|{note_name}]]')}")
    lines += [f"session_id: {meta['session_id']}", f"start: {iso(start)}", f"end: {iso(end)}",
              f"cwd: {q(meta['cwd'] or '')}", f"source: {q(str(source))}",
              "cssclasses:", "  - wide", "---"]
    last = None
    for kind, ts, text in turns:
        if kind == "tool":
            if last != "tool":
                lines.append("")
            lines.append(text)
        elif kind == "nimble":
            lines += ["", text, ""]
        else:
            lines += ["", f"### {who[kind]} · {ts}", "", text]
        last = kind
    return "\n".join(lines).rstrip() + "\n", start


def with_privacy(md, verdict, flagged=()):
    """`md` with `privacy_check` (and `privacy_flags`) as its last frontmatter keys. Flag line
    ranges are counted in `md` as given and shifted past the inserted lines."""
    lines = md.split("\n")
    end = lines.index("---", 1)
    extra = [f"privacy_check: {verdict}"]
    if flagged:
        extra.append("privacy_flags:")
        shift = len(extra) + len(flagged)
        moved = lambda n: n + shift if n > end else n  # 1-based lines below the closing `---` move down
        for f in flagged:
            extra.append(f'  - "lines {moved(f["first"])}-{moved(f["last"])} · p {f["p"]:.2f}"')
    return "\n".join(lines[:end] + extra + lines[end:])


def check_privacy(md):
    """(md with the verdict, summary). Never `clear` unless nimble scored every block."""
    try:
        import nimble_privacy  # same folder; loads nimble_classify
        result = nimble_privacy.check_text(md)
    except Exception as error:  # Ollama down, model missing, import error: say so
        return with_privacy(md, "not run"), {"verdict": "not run", "error": type(error).__name__}
    return with_privacy(md, result["verdict"], result["flagged"]), result


def update_note(session_id, name, model=None):
    for note in SESSIONS.glob("*.md"):
        text = note.read_text(encoding="utf-8")
        if not re.search(rf"(?m)^session_id: {re.escape(session_id)}\s*$", text):
            continue
        line = f'transcript: "[[{name}|Transcript]]"'
        if re.search(r"(?m)^transcript:.*$", text):
            text = re.sub(r"(?m)^transcript:.*$", line, text, count=1)
        else:
            text = re.sub(rf"(?m)^(session_id: {re.escape(session_id)})\s*$", rf"\1\n{line}", text, count=1)
        # Fill `model` only when empty or missing: what the agent wrote wins.
        if model:
            if re.search(r"(?m)^model:[ \t]*$", text):
                text = re.sub(r"(?m)^model:[ \t]*$", lambda _: f"model: {model}", text, count=1)
            elif not re.search(r"(?m)^model:", text):
                text = re.sub(r"(?m)^(agent:.*)$", lambda m: f"{m.group(1)}\nmodel: {model}", text, count=1)
        note.write_text(text, encoding="utf-8")
        return note.relative_to(VAULT)
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("transcript")
    ap.add_argument("--update-note", action="store_true")
    ap.add_argument("--no-privacy-check", action="store_true", help="skip nimble's check; the .md then carries no verdict")
    args = ap.parse_args()
    src = Path(args.transcript).expanduser()
    rows = [json.loads(l) for l in src.read_text(encoding="utf-8").splitlines() if l.strip()]
    meta, turns = (parse_codex if any("payload" in r for r in rows[:5]) else parse_claude)(rows)
    meta["session_id"] = meta["session_id"] or src.stem
    md, start = render(meta, turns, src)
    date = start[:10] or dt.date.today().isoformat()
    name = f"{date}-{meta['agent']}-{meta['session_id'][:8]}"
    OUT.mkdir(parents=True, exist_ok=True)
    raw, n_raw = redact(src.read_text(encoding="utf-8"))
    md, n_md = redact(md)
    (OUT / f"{name}.jsonl").write_text(raw, encoding="utf-8")
    (OUT / f"{name}.md").write_text(md if args.no_privacy_check else with_privacy(md, "pending"), encoding="utf-8")
    rel_md = f"99 - Agents/agents/transcripts/{name}.md"
    note = update_note(meta["session_id"], name, meta["model"]) if args.update_note else None
    privacy = None
    if not args.no_privacy_check:
        checked, privacy = check_privacy(md)
        (OUT / f"{name}.md").write_text(checked, encoding="utf-8")
    print(json.dumps({"md": rel_md, "raw": f"99 - Agents/agents/transcripts/{name}.jsonl",
                      "turns": len(turns), "redacted": {"md": n_md, "raw": n_raw},
                      "session_note": str(note) if note else None, "privacy": privacy}))


if __name__ == "__main__":
    main()
