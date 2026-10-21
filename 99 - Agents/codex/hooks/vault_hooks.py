#!/usr/bin/env python3
"""Codex-specific defense in depth and SessionEnd transcript safety net.

Project policy lives in AGENTS.md. This hook does not replace the sandbox or
user approval; Codex tool hooks do not cover every possible tool path.
"""

import json
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path


FORBIDDEN_GIT = re.compile(
    r"\bgit\s+(?:"
    r"push\b|clean\b|restore\b|stash\b|rebase\b|filter-branch\b|"
    r"reset\s+--hard\b|checkout\s+--\s|branch\s+-D\b"
    r")",
    re.IGNORECASE,
)


def pre_tool_use(event: dict) -> None:
    if event.get("tool_name") != "Bash":
        return
    command = event.get("tool_input", {}).get("command", "")
    if not isinstance(command, str) or not FORBIDDEN_GIT.search(command):
        return
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": "AGENTS.md forbids this Git operation in the MyLab vault.",
    }}))


def session_end(event: dict) -> None:
    root = Path(event.get("cwd") or ".").resolve()
    sessions = root / "00 - Data/Sessions"
    transcript = Path(event.get("transcript_path") or "")
    session_id = event.get("session_id")
    if not session_id or not transcript.is_file() or not sessions.is_dir():
        return

    existing = [p for p in sessions.glob("SES-*.md")
                if f"session_id: {session_id}" in p.read_text()]
    if not existing:
        numbers = [int(p.stem[4:]) for p in sessions.glob("SES-*.md")
                   if p.stem[4:].isdigit()]
        note = sessions / f"SES-{max(numbers, default=0) + 1:04d}.md"
        now = datetime.now().astimezone().isoformat(timespec="seconds")
        name = f"Session: Codex {now[:10]} (stub)"
        template = (root / "00 - Data/Templates/Session Template.md").read_text()
        # Drop the Templater ID script and placeholders; this stub is written directly.
        template = re.sub(r"(?m)^<%\*.*-%>\n", "", template)
        template = re.sub(r"(?m)^(name:|  - )\s*<%.*%>$", r"\1", template)
        template = template.replace("\naliases:\n  - \n", "\naliases:\n", 1)  # emptied aliases item
        replacements = {
            "name:": f"name: \"{name}\"",
            "aliases:": f"aliases:\n  - \"{name}\"",
            "end:": f"end: {now}",
            "agent:": "agent: \"[[CODEX|Codex]]\"",
            "model:": f"model: {event.get('model') or ''}".rstrip(),
            "session_id:": f"session_id: {session_id}",
            "topics:": "topics:\n  - stub",
        }
        for old, new in replacements.items():
            template = template.replace(f"\n{old}\n", f"\n{new}\n", 1)
        template += "\n> [!warning] Stub created by the Codex SessionEnd hook; fill it from the transcript.\n"
        note.write_text(template)

    script = root / "99 - Agents/agents/scripts/export_transcript.py"
    # Detached: nimble's privacy check can outlast the hook. Until it ends, the transcript
    # reads `privacy_check: pending`.
    subprocess.Popen([sys.executable, str(script), str(transcript), "--update-note"], cwd=root,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     start_new_session=True)


def main() -> None:
    try:
        event = json.load(sys.stdin)
        if len(sys.argv) > 1 and sys.argv[1] == "pre-tool-use":
            pre_tool_use(event)
        elif len(sys.argv) > 1 and sys.argv[1] == "session-end":
            session_end(event)
    except Exception as exc:
        print(f"MyLab Codex hook error: {exc}", file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
