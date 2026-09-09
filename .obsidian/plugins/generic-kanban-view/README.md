# Generic Kanban View for Obsidian Bases

Adds a reusable **Kanban** layout to Obsidian Bases.

## v0.4.2

### Cleaner native Bases toolbar integration

Kanban-specific configuration actions no longer occupy permanent space above the board. A single **… (Kanban options)** action is registered through the public `BasesView.addAction()` API, so it appears alongside the native Bases toolbar actions such as Sort, Filter, Properties, Search, and New.

Open the **…** menu to access:

- **Configure quick filters**
- **Customize columns**
- **Clear quick filters** when one or more temporary quick filters are active

Configured quick-filter chips still appear above the board because they are part of the active visualization itself, but the setup buttons stay hidden inside the native toolbar menu. If a view has no quick filters configured, no empty Kanban toolbar row is rendered.

## v0.4.0

### Per-view quick filters

Each Kanban view can expose a custom set of **quick filter properties** above the board. Use **… → Configure quick filters** to choose and order the properties for that particular view. Note properties are discovered from the current Base entries even when they are not shown on cards; `formula.*` and `file.*` property IDs are also supported.

Each configured property appears as a compact filter chip such as `Assignee · All`, `Institution · UCBM`, or `Activity · Research`. Clicking a chip opens a searchable value picker with multi-selection. Multiple selected values of the same property are combined with **OR**, while different filter properties are combined with **AND**. List-valued note properties are split into individual values, so a task assigned to `[[Alice]]` and `[[Bob]]` can be filtered by either person. Wikilink values are displayed using their note name or alias instead of the raw brackets. Empty values appear as **Unassigned**.

The set and order of exposed quick-filter properties is saved in the Kanban view configuration. The currently selected filter values are intentionally temporary view state: they filter only the rendered board and do not rewrite the Base query or the underlying notes. **Clear** resets all active quick filters.

## v0.3.0

### Formula properties as Kanban columns

The **Column property** selector now accepts both writable note properties (`note.*`) and Base formulas (`formula.*`). This makes it possible to group entries by a derived value, such as a Story status calculated from the statuses of its related Tasks.

Formula-backed Kanban boards are intentionally read-only: their column value is calculated by Bases, so dragging a card cannot directly change the formula result. Drag-and-drop, the mobile **Move to…** control, and column-specific note creation remain available when the board uses a writable note property.

Column order, colors, native card-property rendering, wikilinks, **Other**, and **Unassigned** work in both modes. Formula results are read directly from the Base query, so when related data changes and the formula recalculates, the card moves to the corresponding column on the next Bases refresh.

## v0.2.1

### Clickable wikilinks inside properties

Some frontmatter values such as `[[Alice]]` are exposed by Bases as strings or list items. In those cases the native `Value.renderTo()` renderer can preserve the surrounding value type while leaving the wikilink syntax as literal text. The Kanban view now post-processes only those literal wikilink text nodes and converts them into real Obsidian internal links.

This works for single values and lists, supports aliases such as `[[People/Alice|Alice]]`, resolves links relative to the source note, supports hover previews, and leaves native date, boolean/checkbox, tag, list, image, and formula rendering untouched. Embedded values such as `![[image.png]]` are not rewritten as links.

## v0.2.0

### Native Bases property rendering

Card properties are rendered through the public Bases `Value.renderTo()` API instead of being flattened with `toString()`. This preserves the normal rendering of links, dates, lists, tags, booleans/checkboxes, formula results, images, and other supported Bases values. If a renderer fails, the plugin safely falls back to text.

The Properties menu of the current Base still controls which properties are visible on cards and their order.

### Ordered columns

Use **… → Customize columns** in the native Bases toolbar to edit the column list visually. Add the exact values used by the selected column property, move them up/down to define board order, remove unused values, and assign colors. The same values remain available in the Base view options under `Columns (ordered)` as a portable fallback.

Example:

- Backlog
- Todo
- In Progress
- Review
- Done

Unexpected non-empty values can optionally be collected in **Other**. Notes without the column property are shown in **Unassigned**.

### Column colors

The visual column editor includes a color picker and a CSS-color text field for every column. The underlying `Column colors` option stores one portable mapping per entry using:

```text
Column value = CSS color
```

Examples:

```text
Backlog = #7f8c8d
Todo = var(--color-blue)
In Progress = rgb(230, 170, 30)
Done = green
```

Colors are tied to the column value, not to its position, so reordering columns keeps the right color assigned.

Choose **Use column colors** to control how colors are applied:

- Off
- Header only
- Subtle column background
- Stronger column background

## Installation

Copy this folder to:

```text
<Vault>/.obsidian/plugins/generic-kanban-view/
```

The folder should contain:

```text
main.js
manifest.json
styles.css
```

Reload Obsidian and enable **Generic Kanban View** in Community plugins.

## Usage

1. Open any `.base` file.
2. Add a view or change an existing view layout to **Kanban**.
3. Select either a writable note property (for example `status`) or a Base formula under **Column property**.
4. Configure **Columns (ordered)**.
5. Optionally configure **Column colors** and a color mode.
6. Use the Base Properties menu to choose which additional properties appear on cards.
7. For writable note properties, drag cards between columns on desktop or use **Move to…** on touch devices. Formula-backed boards automatically follow their calculated values and are read-only.

Dragging a card updates the selected frontmatter property in the underlying Markdown note. Formula results are never overwritten.


## 0.4.2

- Fixes a regression where registering the native Bases toolbar action in the view constructor could prevent Kanban views from rendering.
- Registers the native Kanban options action after the Bases view enters its lifecycle and retries safely on data updates.
- Adds a non-destructive fallback ellipsis button if the host cannot expose the native toolbar action.
