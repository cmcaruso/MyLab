// Templater user script: give a new note its ID filename (NOT-0001 §4).
// Called from the first line of each entity template:
//   <%* const name = await tp.user.new_entity(tp, "TSK") -%>
// The title you typed becomes `name`/`aliases`; the file is renamed to the next
// <PREFIX>-NNNN (highest existing in the vault + 1, as in migrate_ids.py).

const ID_RE = /^[A-Z]{3}-\d{4}$/;
const UNTITLED_RE = /^Untitled( \d+)?$/;

function nextId(prefix) {
  const re = new RegExp(`^${prefix}-(\\d{4})$`);
  let max = 0;
  for (const f of app.vault.getMarkdownFiles()) {
    const m = f.basename.match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

async function new_entity(tp, prefix) {
  const title = tp.file.title;

  if (ID_RE.test(title)) {
    // Written by an agent or synced from another device: leave it as it is.
    // Throwing is the only way to stop Templater from merging the template in.
    const text = await app.vault.read(tp.config.target_file);
    const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
    if (/^name:[ \t]*\S/m.test(fm)) throw new Error(`${title} already has a name: left untouched.`);
    // An ID typed on purpose: keep it, ask for the name.
    const name = await tp.system.prompt("Name");
    if (!name) throw new Error("No name given.");
    return name.trim();
  }

  let name = title;
  if (UNTITLED_RE.test(title)) {
    name = await tp.system.prompt("Name");
    if (!name) throw new Error("No name given: the note stays Untitled.");
  }
  await tp.file.rename(nextId(prefix));
  return name.trim();
}

module.exports = new_entity;
