#!/usr/bin/env python3
"""Ask nimble, locally, whether text holds private data, without printing the text.

  python3 "99 - Agents/agents/scripts/nimble_privacy.py" FILE [FILE ...]   # per file: verdict and flagged lines
  python3 "99 - Agents/agents/scripts/nimble_privacy.py" --selftest        # made-up fixtures: is nimble usable?

The text is cut into blocks of whole lines (about CHUNK_CHARS each). nimble answers one
yes/no question per block through nimble_classify.score(), on the local Ollama only. The
output is line ranges and probabilities, never the text: an agent that read the text to check
it would send it to its own provider, which is the leak the check is for.

export_transcript.py runs check_text() on every readable transcript and writes the verdict
into its frontmatter (`privacy_check`, `privacy_flags`). Scores are cached by block hash in
99 - Agents/agents/cache/ (git-ignored), so a re-export only scores new blocks.
"""
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nimble_classify  # noqa: E402

VAULT = Path(__file__).resolve().parents[3]
CACHE = VAULT / "99 - Agents" / "agents" / "cache" / "privacy-scores.json"
CHUNK_CHARS = 2500
FLAG_AT = 0.5
# Bump when the question changes, so cached scores of the old question are not reused.
QUESTION_VERSION = 1

FIELD = {
    "type": "boolean",
    "description": (
        "Does this excerpt of an AI coding-session transcript contain private data that must not be "
        "stored in a git repository? Private data is: an email address or phone number of a real person; "
        "a calendar feed URL or any other URL carrying a secret token or key; a password, API key or "
        "access token; the text of a private email, meeting invite or calendar event description. "
        "Not private: source code, file paths, note IDs and names, plugin and library names, public "
        "web pages, and the user's own vault notes discussed as work."
    ),
    "choice_descriptions": {
        "true": "Yes, the excerpt contains at least one piece of private data as defined.",
        "false": "No, nothing in the excerpt is private data as defined.",
    },
}


class Unavailable(Exception):
    """nimble could not be reached: nothing was checked."""


def p_private(text):
    """nimble's probability that `text` holds private data."""
    try:
        step = nimble_classify.score(text, "contains_private_data", FIELD)
    except OSError as error:  # URLError, connection refused, timeout
        raise Unavailable(str(error))
    return step["probabilities"].get("true", 0.0)


def blocks(lines):
    """(first line, last line, text) blocks of whole lines, about CHUNK_CHARS each; lines count from 1."""
    start, buf, size = 1, [], 0
    for n, line in enumerate(lines, 1):
        buf.append(line)
        size += len(line) + 1
        if size >= CHUNK_CHARS:
            yield start, n, "\n".join(buf)
            start, buf, size = n + 1, [], 0
    if buf:
        yield start, len(lines), "\n".join(buf)


def load_cache():
    try:
        return json.loads(CACHE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_cache(cache):
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(cache, separators=(",", ":")), encoding="utf-8")


def check_text(text):
    """{"verdict": "clear"|"flagged", "blocks", "max_p", "flagged": [{"first", "last", "p"}]}.
    Raises Unavailable when nimble can't be reached."""
    cache = load_cache()
    results = []
    try:
        for first, last, block in blocks(text.splitlines()):
            key = "%d:%s" % (QUESTION_VERSION, hashlib.sha256(block.encode("utf-8")).hexdigest())
            if key not in cache:
                cache[key] = round(p_private(block), 3)
            results.append((first, last, cache[key]))
    finally:
        save_cache(cache)
    flagged = [{"first": a, "last": b, "p": p} for a, b, p in results if p >= FLAG_AT]
    return {"verdict": "flagged" if flagged else "clear", "blocks": len(results),
            "max_p": max((p for _, _, p in results), default=0.0), "flagged": flagged}


# Made-up fixtures: no real person, address or token.
SELFTEST = [
    (True, "Assistant: I added the feed. URL: https://calendar.example.com/ical/feeds/7f3a9c2e1b8d4f60a5e2c9b7/private-91d2e4f8a6c3b5d7e9f1a2c4b6d8e0f2/basic.ics"),
    (True, "Tool result: attendees: mario.verdi@ospedale-esempio.it, giulia.bianchi@uni-esempio.it; phone +39 333 123 4567"),
    (True, "Bash output: export OPENAI_API_KEY=sk-proj-4f9Qx7LmT2vB8nK3wR6yH1cZ5dJ0aE9sU4pG7iO2"),
    (True, "Invite description: Hi all, as discussed privately, Dr. Verdi's contract will not be renewed; please keep this confidential until the board meets on Friday."),
    (False, "Assistant: I edited src/patch.ts: the getter now falls back to core's groups when the view is not table or cards. 47 tests pass."),
    (False, "Tool result: 00 - Data/Bases/People.base groupOrder has 18 entries; removed Greenvale + Nordhaven and Nordhaven + Greenvale."),
    (False, "User: commit the earlier sessions too. Assistant: committed 1a2b3c4, SES-0003..0004 and their transcripts."),
    (False, "Assistant: the feature description mentions webcal:// and https:// as accepted schemes for calendar feeds."),
]


def selftest():
    rows = [{"expected": expected, "p_private": round(p_private(text), 3)} for expected, text in SELFTEST]
    right = sum((r["p_private"] >= FLAG_AT) == r["expected"] for r in rows)
    return {"correct": "%d/%d" % (right, len(rows)), "rows": rows}


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return
    try:
        if args == ["--selftest"]:
            out = selftest()
        else:
            out = [dict(file=str(p), **check_text(Path(p).read_text(encoding="utf-8"))) for p in args]
    except Unavailable as error:
        out = {"verdict": "not run", "error": "nimble unreachable: %s" % error}
    print(json.dumps(out, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
