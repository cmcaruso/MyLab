# Calendar

A read-only calendar for the vault. It does four things:

- Reads Google, Microsoft 365/Outlook, iCloud or any ICS feed.
- Draws the events in a `calendar` Bases view, together with dated vault notes (Events, Meetings, scheduled Tasks).
- Creates `EVT` meeting notes **on demand**.
- Keeps an event cache that agents can query through `99 - Agents/agents/scripts/calendar_events.py`.

> **Id clash.** The id is `calendar`, the same as Liam Cain's community *Calendar* plugin. Versions are dates (`YYYY.M.D`), so they always rank above the community release, and Obsidian never offers it as an "update". Don't install both in the same vault.

## Setup

1. *Settings → Calendar → Add feed*. Give it a label, a provider and a colour.
2. Paste the feed's secret ICS address. It is stored in this device's **Keychain** (Obsidian's secret storage), never in the vault. `data.json` keeps only labels, providers, colours and secret ids, and MyLab's `.gitignore` excludes it anyway.
3. Set **Your People note** to your own People note ID (e.g. `PER-0002`). It is added to every meeting note you create.
4. Optional, desktop only: set **Transcript folder** to where your recording app saves `YYYYMMDD_HHMM_Transcription.txt` files. Matching transcripts are linked into the meeting note.

With no feeds, the views still show the vault's own Events, Meetings and scheduled Tasks. That is how MyLab's example data appears.

## Using it

- **`03 - Calendar`** shows Week / Month / Schedule. The Daily Note embeds `Calendar.base#Today` as an agenda.
- **Click an event** to open its card: join link, documents, attendees (matched to People notes by email; emails never enter a note), related notes, and **Create note** with a preview.
- **Commands:** *Today's meetings*, *Open calendar*, *Refresh calendars* and *Attach transcript*.
- When a feed is stale, a muted line under the toolbar says so. Tap it to refresh.

## Safety

- Invite text is treated as untrusted. Templater runs `<% … %>` in any new note, so free text is neutralised, and a note that still contains `<%` is refused.
- Feed errors never copy invite data or URL fragments into notices or the cache.
- Parsing is bounded per feed and per recurring series.
- The event cache (`99 - Agents/agents/cache/`) is **plaintext private calendar data**. Keep it out of git and backups you share.

## License

MIT, see [`LICENSE`](LICENSE).
