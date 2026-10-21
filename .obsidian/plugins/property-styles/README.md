# Property Styles

One place to define the values of a text property: their order, their colours, and how they look on Generic Kanban cards. In MyLab it drives `priority` (Urgent · High · Medium · Low) on Tasks and Projects. The same settings also cover the priorities that Stories and Epics derive from their Tasks.

## What a scheme holds

Each scheme (*Settings → Property Styles*) has:

- **property**: the frontmatter key, e.g. `priority`.
- **folders and templates**: where the property lives.
- **values**: a name and a colour for each, in order. `defaultId` is the value new notes get.
- **bases**: the `.base` files whose rank formula (`PriorityRank`) follows the order. With `deriveFrom`, the base derives the value from its children instead of storing it (Stories and Epics).
- **styles**: shown as a `pill`, a coloured `stripe`, and/or a card `tint`.

The settings tab shows a live preview of the cards.

## Renames and reorders

When you rename a value or change the order, the plugin shows a preview of every edit to notes, templates and `.base` formulas, and applies them only after you confirm.

## License

MIT, see [`LICENSE`](LICENSE).
