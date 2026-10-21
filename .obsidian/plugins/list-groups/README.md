# List Groups

In a native Bases **Cards** or **Table** view grouped by a list-valued property, core Obsidian puts a note with `org: [A, B]` into one combined group, "A, B". List Groups puts it under **A** and under **B** instead.

In MyLab, *People → Cards* is grouped by `org`, so someone with two affiliations appears under both organizations.

- **Display only.** It never writes notes or `.base` files.
- **Toggle per view.** Table and Cards views get a "Split list groups" option. It is on by default; set it off for core grouping.
- **`groupOrder`.** Listed groups show in the given order, one row per value, e.g. `People.base`'s `groupOrder`.
- **Requires Obsidian 1.14.4 or newer.** The plugin patches Bases internals. At load it checks that they are where it expects. If they have moved, it turns itself off with one notice, and Bases keeps working as usual.
- **Mobile-safe.**

The plugin's id is `list-groups`. The ids `split-groups` and `native-split-groups` belong to unrelated community plugins. Versions are dates (`YYYY.M.D`).

## License

MIT, see [`LICENSE`](LICENSE).
