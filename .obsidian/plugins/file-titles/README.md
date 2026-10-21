# File Titles

MyLab names notes by ID (`TSK-0042`) and keeps the readable name in the `name` property. File Titles shows that `name` wherever Obsidian would show the filename:

- the file explorer
- tab headers
- the inline note title
- rendered links in reading view
- graph nodes

It only changes what is **displayed**. Files, links and frontmatter are never modified. While you edit an inline title, it shows the real filename, so a rename always acts on the ID.

## Settings

| Setting | Default | Effect |
|---|---|---|
| Name property | `name` | The frontmatter property used as the display name |
| Excluded folders | `00 - Data/Templates`, `00 - Data/Bases`, `00 - Data/Categories` | These folders keep showing filenames |
| File explorer / Tabs / Note titles / Reading links / Graph | on | Turn each surface on or off |

A note without the property keeps its filename.

## License

MIT, see [`LICENSE`](LICENSE).
