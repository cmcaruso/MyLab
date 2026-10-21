const { Plugin, PluginSettingTab, Setting, Modal, Notice, TFile, normalizePath, parseYaml, stringifyYaml } = require("obsidian");

// One place to define the values of a text property (e.g. Task priority):
// their order, their colors and how they look on Generic Kanban cards.
//
// Colors and styles apply at once through an injected stylesheet. Renaming or
// reordering values changes the vault (notes, the rank formula and kanban
// columns in a .base file, the template default) only after a preview and an
// explicit confirmation ("Review & apply").
//
// A base can also derive the property instead of reading it from notes: for
// Stories and Epics, `priority` is a formula giving the highest value among the
// items listed by another formula (e.g. their open Tasks). The plugin writes
// that formula too, so renames and reorders reach it.
//
// Card styling needs generic-kanban-view >= 0.4.3, which exposes
// data-property / data-value on each card property row.

const DEFAULT_SETTINGS = {
  schemes: [
    {
      id: "priority",
      property: "priority",
      folders: ["00 - Data/Tasks", "00 - Data/Projects"],
      templates: ["00 - Data/Templates/Tasks Template.md", "00 - Data/Templates/Project Template.md"],
      // deriveFrom: a formula listing the items (as links) whose highest value the base derives.
      bases: [
        { file: "00 - Data/Bases/Tasks.base", rankFormula: "PriorityRank", deriveFrom: "" },
        { file: "00 - Data/Bases/Projects.base", rankFormula: "PriorityRank", deriveFrom: "" },
        { file: "00 - Data/Bases/Stories.base", rankFormula: "PriorityRank", deriveFrom: "PriorityPool" },
        { file: "00 - Data/Bases/Epics.base", rankFormula: "PriorityRank", deriveFrom: "PriorityPool" }
      ],
      defaultId: "medium",
      columnOrder: "lowest-first",
      styles: { pill: true, stripe: true, tint: false },
      values: [
        { id: "urgent", name: "Urgent", color: "#e5484d" },
        { id: "high", name: "High", color: "#f76b15" },
        { id: "medium", name: "Medium", color: "#fed401" },
        { id: "low", name: "Low", color: "#00b3ff" }
      ],
      // Value names as last written to the vault, by id. Renames are detected against it.
      applied: { urgent: "Urgent", high: "High", medium: "Medium", low: "Low" }
    }
  ]
};

const BLANK_SCHEME = {
  property: "",
  folders: [],
  templates: [],
  bases: [],
  defaultId: "",
  columnOrder: "highest-first",
  styles: { pill: true, stripe: true, tint: false },
  values: [],
  applied: {}
};

const COLOR = /^#[0-9a-fA-F]{3,8}$/;

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A quoted string for CSS attribute selectors.
function cssString(text) {
  return '"' + String(text).replace(/["\\]/g, "\\$&") + '"';
}

// A YAML scalar: plain when it is safe, JSON-quoted otherwise.
function yamlScalar(text) {
  const plain = /^[A-Za-z][A-Za-z0-9 _-]*$/.test(text) && !/^(true|false|null|yes|no|on|off)$/i.test(text);
  return plain ? text : JSON.stringify(text);
}

// The property as a Bases formula expression.
function formulaProperty(property) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(property) ? property : `note[${JSON.stringify(property)}]`;
}

// if(priority == "Urgent", 0, if(priority == "High", 1, ... , N)): unknown values rank last.
// source is the expression holding the value: the note property or a derived formula.
function rankFormula(scheme, source) {
  let expr = String(scheme.values.length);
  for (let i = scheme.values.length - 1; i >= 0; i--) {
    expr = `if(${source} == ${JSON.stringify(scheme.values[i].name)}, ${i}, ${expr})`;
  }
  return expr;
}

// The highest value among the items listed by formula.<pool>, or "" when none has one.
function derivedFormula(scheme, pool) {
  const prop = scheme.property.trim();
  const itemValue = /^[A-Za-z_][A-Za-z0-9_]*$/.test(prop) ? `value.asFile().properties.${prop}` : `value.asFile().properties[${JSON.stringify(prop)}]`;
  let expr = '""';
  for (let i = scheme.values.length - 1; i >= 0; i--) {
    const name = JSON.stringify(scheme.values[i].name);
    expr = `if(formula.${pool}.filter(${itemValue} == ${name}).length > 0, ${name}, ${expr})`;
  }
  return expr;
}

function lines(list) {
  return (list || []).map((item) => String(item).trim()).filter(Boolean);
}

function buildCss(schemes) {
  const out = [];
  schemes.forEach((scheme, index) => {
    const prop = scheme.property.trim();
    const values = scheme.values.filter((value) => value.name.trim() && COLOR.test(value.color));
    if (!prop || !values.length) return;

    const color = `--property-styles-${index}`;
    const ids = [`note.${prop}`, `formula.${prop}`, prop];
    const row = `.generic-kanban-card-property:is(${ids.map((id) => `[data-property=${cssString(id)}]`).join(", ")})`;
    const known = `:is(${values.map((value) => `[data-value=${cssString(value.name)}]`).join(", ")})`;
    const card = (valueSelector) => `.generic-kanban-card:has(> .generic-kanban-card-meta > ${row}${valueSelector})`;

    for (const value of values) {
      out.push(`${card(`[data-value=${cssString(value.name)}]`)} { ${color}: ${value.color}; }`);
    }
    if (scheme.styles.stripe) {
      out.push(`${card(known)} { border-left: 4px solid var(${color}); }`);
    }
    if (scheme.styles.tint) {
      out.push(`${card(known)} { background: color-mix(in srgb, var(${color}) 12%, var(--background-primary)); }`);
    }
    if (scheme.styles.pill) {
      out.push(
        `${row}${known} .generic-kanban-card-property-value {
  display: inline-block;
  justify-self: start;
  padding: 0 var(--size-4-2);
  border: 1px solid color-mix(in srgb, var(${color}) 55%, var(--background-modifier-border));
  border-radius: var(--radius-l);
  background: color-mix(in srgb, var(${color}) 20%, var(--background-primary));
  color: var(--text-normal);
  font-weight: var(--font-semibold);
}`
      );
    }
  });
  return out.join("\n");
}

module.exports = class PropertyStylesPlugin extends Plugin {
  async onload() {
    await this.loadSettings();
    this.styleEl = document.head.createEl("style", { attr: { id: "property-styles" } });
    this.updateCss();

    this.addSettingTab(new PropertyStylesSettingTab(this.app, this));
    this.addCommand({
      id: "review-and-apply",
      name: "Review & apply changes to the vault",
      callback: () => this.reviewAll()
    });
  }

  onunload() {
    this.styleEl?.remove();
  }

  async loadSettings() {
    const data = await this.loadData();
    const schemes = data && Array.isArray(data.schemes) ? data.schemes : clone(DEFAULT_SETTINGS).schemes;
    this.settings = {
      schemes: schemes.map((scheme) => {
        const merged = Object.assign(clone(BLANK_SCHEME), scheme);
        merged.id = merged.id || newId();
        merged.styles = Object.assign(clone(BLANK_SCHEME.styles), scheme.styles);
        // 0.1.0 kept one folder, base and template per scheme.
        if (scheme.folder && !scheme.folders) merged.folders = [scheme.folder];
        if (scheme.template && !scheme.templates) merged.templates = [scheme.template];
        if (scheme.baseFile && !scheme.bases) merged.bases = [{ file: scheme.baseFile, rankFormula: scheme.rankFormula || "", deriveFrom: "" }];
        for (const key of ["folder", "template", "baseFile", "rankFormula"]) delete merged[key];
        merged.folders = lines(merged.folders);
        merged.templates = lines(merged.templates);
        merged.bases = (merged.bases || []).map((base) => ({ file: base.file || "", rankFormula: base.rankFormula || "", deriveFrom: base.deriveFrom || "" }));
        merged.values = (merged.values || []).map((value) => ({
          id: value.id || newId(),
          name: String(value.name ?? ""),
          color: COLOR.test(value.color) ? value.color : "#888888"
        }));
        return merged;
      })
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.updateCss();
  }

  updateCss() {
    if (this.styleEl) this.styleEl.textContent = buildCss(this.settings.schemes);
  }

  // Problems that block applying a scheme to the vault.
  validate(scheme) {
    const errors = [];
    if (!scheme.property.trim()) errors.push("The property name is empty.");
    const names = scheme.values.map((value) => value.name.trim());
    if (names.some((name) => !name)) errors.push("A value has an empty name.");
    const duplicates = names.filter((name, i) => name && names.indexOf(name) !== i);
    if (duplicates.length) errors.push(`Duplicate values: ${[...new Set(duplicates)].join(", ")}.`);
    return errors;
  }

  notesWith(scheme, value) {
    const prop = scheme.property.trim();
    const folders = lines(scheme.folders).map((folder) => folder.replace(/\/$/, "") + "/");
    return this.app.vault.getMarkdownFiles().filter((file) => {
      if (folders.length && !folders.some((folder) => file.path.startsWith(folder))) return false;
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      return frontmatter && frontmatter[prop] === value;
    });
  }

  // Everything that would change in the vault to match the scheme, without writing.
  async computeChanges(scheme) {
    const changes = { scheme, renames: [], orphans: [], bases: [], templates: [], warnings: [] };
    const prop = scheme.property.trim();

    for (const value of scheme.values) {
      const old = scheme.applied[value.id];
      if (old !== undefined && old !== value.name) {
        const files = this.notesWith(scheme, old);
        changes.renames.push({ from: old, to: value.name, files });
      }
    }
    const current = new Set(scheme.values.map((value) => value.id));
    for (const [id, name] of Object.entries(scheme.applied)) {
      if (current.has(id)) continue;
      const files = this.notesWith(scheme, name);
      if (files.length) changes.orphans.push({ name, files });
    }

    for (const base of scheme.bases) {
      const file = this.fileAt(base.file);
      if (!file) continue;
      const text = await this.app.vault.read(file);
      const data = parseYaml(text) || {};
      const before = JSON.stringify(data);
      const details = [];
      const derived = base.deriveFrom.trim();
      data.formulas = data.formulas || {};
      if (derived && !(derived in data.formulas)) {
        changes.warnings.push(`${file.basename} has no formula "${derived}" to derive from.`);
      }
      if (derived) {
        const formula = derivedFormula(scheme, derived);
        if (data.formulas[prop] !== formula) details.push(`formula ${prop}`);
        data.formulas[prop] = formula;
      }
      if (base.rankFormula.trim()) {
        const formula = rankFormula(scheme, derived ? `formula.${prop}` : formulaProperty(prop));
        if (data.formulas[base.rankFormula] !== formula) details.push(`formula ${base.rankFormula}`);
        data.formulas[base.rankFormula] = formula;
      }
      if (!Object.keys(data.formulas).length) delete data.formulas;
      for (const view of data.views || []) {
        if (view.columnProperty !== (derived ? `formula.${prop}` : `note.${prop}`)) continue;
        const ordered = scheme.columnOrder === "lowest-first" ? [...scheme.values].reverse() : scheme.values;
        const columns = ordered.map((value) => value.name);
        const colors = ordered.map((value) => `${value.name} = ${value.color}`);
        if (JSON.stringify(view.columns) !== JSON.stringify(columns) || JSON.stringify(view.columnColors) !== JSON.stringify(colors)) {
          details.push(`columns and colors of view "${view.name}"`);
        }
        view.columns = columns;
        view.columnColors = colors;
      }
      if (JSON.stringify(data) !== before) changes.bases.push({ file, text: stringifyYaml(data), details });
    }

    const defaultValue = scheme.values.find((value) => value.id === scheme.defaultId);
    for (const path of scheme.templates) {
      const file = this.fileAt(path);
      if (!file || !defaultValue) continue;
      const text = await this.app.vault.read(file);
      const line = new RegExp(`^${escapeRegExp(prop)}:.*$`, "m");
      const wanted = `${prop}: ${yamlScalar(defaultValue.name)}`;
      const match = text.match(line);
      if (match && match[0] !== wanted) {
        changes.templates.push({ file, text: text.replace(line, wanted), from: match[0], to: wanted });
      }
    }

    changes.count = changes.renames.reduce((n, rename) => n + rename.files.length, 0) + changes.bases.length + changes.templates.length;
    return changes;
  }

  async applyChanges(changes) {
    const { scheme } = changes;
    const prop = scheme.property.trim();
    for (const rename of changes.renames) {
      for (const file of rename.files) {
        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          if (frontmatter[prop] === rename.from) frontmatter[prop] = rename.to;
        });
      }
    }
    for (const base of changes.bases) await this.app.vault.modify(base.file, base.text);
    for (const template of changes.templates) await this.app.vault.modify(template.file, template.text);

    scheme.applied = Object.fromEntries(scheme.values.map((value) => [value.id, value.name]));
    await this.saveSettings();
    new Notice(`Property Styles: applied ${changes.count} change(s) for "${prop}".`);
  }

  async review(scheme, onDone) {
    const errors = this.validate(scheme);
    if (errors.length) {
      new Notice(`Property Styles: fix these first.\n${errors.join("\n")}`);
      return;
    }
    const changes = await this.computeChanges(scheme);
    if (!changes.count && !changes.orphans.length && !changes.warnings.length) {
      scheme.applied = Object.fromEntries(scheme.values.map((value) => [value.id, value.name]));
      await this.saveSettings();
      new Notice(`Property Styles: the vault already matches "${scheme.property}".`);
      onDone?.();
      return;
    }
    new ReviewModal(this.app, this, changes, onDone).open();
  }

  async reviewAll() {
    for (const scheme of this.settings.schemes) await this.review(scheme);
  }

  fileAt(path) {
    if (!path || !path.trim()) return null;
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path.trim()));
    return file instanceof TFile ? file : null;
  }
};

class ReviewModal extends Modal {
  constructor(app, plugin, changes, onDone) {
    super(app);
    this.plugin = plugin;
    this.changes = changes;
    this.onDone = onDone;
  }

  onOpen() {
    const { contentEl } = this;
    const { changes } = this;
    contentEl.empty();
    this.titleEl.setText(`Apply "${changes.scheme.property}" to the vault`);

    const list = contentEl.createEl("ul");
    for (const rename of changes.renames) {
      const item = list.createEl("li", { text: `Rename "${rename.from}" → "${rename.to}" in ${rename.files.length} note(s)` });
      if (rename.files.length) {
        const files = item.createEl("ul");
        for (const file of rename.files) files.createEl("li", { text: file.basename });
      }
    }
    for (const base of changes.bases) {
      list.createEl("li", { text: `Rewrite ${base.file.path}: ${base.details.join("; ") || "normalize"}` });
    }
    for (const template of changes.templates) {
      list.createEl("li", { text: `Template ${template.file.path}: ${template.from} → ${template.to}` });
    }
    for (const warning of changes.warnings) list.createEl("li", { text: warning, cls: "mod-warning" });
    for (const orphan of changes.orphans) {
      list.createEl("li", {
        text: `"${orphan.name}" is no longer a value: ${orphan.files.length} note(s) keep it and will sort last (${orphan.files.map((f) => f.basename).join(", ")}).`,
        cls: "mod-warning"
      });
    }

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((button) =>
        button
          .setButtonText("Apply")
          .setCta()
          .onClick(async () => {
            button.setDisabled(true);
            await this.plugin.applyChanges(changes);
            this.close();
            this.onDone?.();
          })
      );
  }

  onClose() {
    this.contentEl.empty();
  }
}

class PropertyStylesSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.statusTimers = {};
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h1", { text: "Property Styles" });
    containerEl.createEl("p", {
      text: "Values of a text property, in rank order (top = first), with the color and style they get on Generic Kanban cards. Colors and styles apply at once. Renames, reorders and the default reach notes, the base and the template only through Review & apply."
    });

    for (const scheme of this.plugin.settings.schemes) this.displayScheme(containerEl, scheme);

    new Setting(containerEl).addButton((button) =>
      button.setButtonText("Add property").onClick(async () => {
        this.plugin.settings.schemes.push(Object.assign(clone(BLANK_SCHEME), { id: newId() }));
        await this.plugin.saveSettings();
        this.display();
      })
    );
  }

  displayScheme(containerEl, scheme) {
    const save = async () => {
      await this.plugin.saveSettings();
      this.renderPreview(scheme);
      this.refreshStatus(scheme);
    };
    const redraw = async () => {
      await this.plugin.saveSettings();
      this.display();
    };

    containerEl.createEl("h2", { text: `Property: ${scheme.property || "(new)"}` });

    // Sync status with the vault
    const status = new Setting(containerEl).setName("Vault").setDesc("Checking…");
    status.addButton((button) =>
      button
        .setButtonText("Review & apply…")
        .setCta()
        .onClick(() => this.plugin.review(scheme, () => this.display()))
    );
    this.statusSettings = this.statusSettings || {};
    this.statusSettings[scheme.id] = status;
    this.refreshStatus(scheme, 0);

    // Values
    containerEl.createEl("h3", { text: "Values (top = highest rank)" });
    scheme.values.forEach((value, index) => {
      const row = new Setting(containerEl).setName(`${index + 1}.`);
      row.addText((text) =>
        text
          .setPlaceholder("Value")
          .setValue(value.name)
          .onChange(async (name) => {
            value.name = name.trim();
            await save();
          })
      );
      row.addColorPicker((picker) =>
        picker.setValue(value.color).onChange(async (color) => {
          value.color = color;
          await save();
        })
      );
      row.addExtraButton((button) =>
        button
          .setIcon("arrow-up")
          .setTooltip("Move up")
          .setDisabled(index === 0)
          .onClick(async () => {
            if (index === 0) return;
            [scheme.values[index - 1], scheme.values[index]] = [scheme.values[index], scheme.values[index - 1]];
            await redraw();
          })
      );
      row.addExtraButton((button) =>
        button
          .setIcon("arrow-down")
          .setTooltip("Move down")
          .setDisabled(index === scheme.values.length - 1)
          .onClick(async () => {
            if (index === scheme.values.length - 1) return;
            [scheme.values[index + 1], scheme.values[index]] = [scheme.values[index], scheme.values[index + 1]];
            await redraw();
          })
      );
      row.addExtraButton((button) =>
        button
          .setIcon("trash")
          .setTooltip("Remove value")
          .onClick(async () => {
            scheme.values.splice(index, 1);
            if (scheme.defaultId === value.id) scheme.defaultId = "";
            await redraw();
          })
      );
    });
    new Setting(containerEl).addButton((button) =>
      button.setButtonText("Add value").onClick(async () => {
        scheme.values.push({ id: newId(), name: "", color: "#888888" });
        await redraw();
      })
    );

    new Setting(containerEl)
      .setName("Default value")
      .setDesc("Written into the templates for new notes.")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "(none)");
        for (const value of scheme.values) dropdown.addOption(value.id, value.name || "(empty)");
        dropdown.setValue(scheme.defaultId).onChange(async (id) => {
          scheme.defaultId = id;
          await save();
        });
      });

    new Setting(containerEl)
      .setName("Kanban column order")
      .setDesc("Column order of the base's kanban views grouped by this property.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("highest-first", "Highest rank first")
          .addOption("lowest-first", "Lowest rank first")
          .setValue(scheme.columnOrder)
          .onChange(async (order) => {
            scheme.columnOrder = order;
            await save();
          })
      );

    // Appearance
    containerEl.createEl("h3", { text: "On kanban cards" });
    const toggles = [
      ["pill", "Pill", "Color the value itself as a pill."],
      ["stripe", "Card stripe", "Color the card's left edge."],
      ["tint", "Card tint", "Tint the whole card background."]
    ];
    for (const [key, name, desc] of toggles) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((toggle) =>
          toggle.setValue(scheme.styles[key]).onChange(async (on) => {
            scheme.styles[key] = on;
            await save();
          })
        );
    }
    this.previewEls = this.previewEls || {};
    this.previewEls[scheme.id] = containerEl.createDiv({ cls: "property-styles-preview" });
    this.renderPreview(scheme);

    // Where the scheme applies
    containerEl.createEl("h3", { text: "Where it applies" });
    new Setting(containerEl)
      .setName("Property")
      .setDesc("Frontmatter property, e.g. priority. Changing it does not rename the property in notes.")
      .addText((text) =>
        text.setValue(scheme.property).onChange(async (input) => {
          scheme.property = input.trim();
          await save();
        })
      );
    const listFields = [
      ["folders", "Notes folders", "Renames touch only notes in these folders, one per line. Empty = whole vault."],
      ["templates", "Templates", "Their property line gets the default value, one per line."]
    ];
    for (const [key, name, desc] of listFields) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addTextArea((textArea) => {
          textArea.inputEl.rows = 3;
          textArea.setValue(scheme[key].join("\n")).onChange(async (input) => {
            scheme[key] = lines(input.split("\n"));
            await save();
          });
        });
    }

    containerEl.createEl("h4", { text: "Bases" });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Per base: the rank formula used for sorting (unknown values rank last), and optionally Derive from, a formula listing the items (e.g. open Tasks) whose highest value becomes the base's own `" + (scheme.property || "property") + "` formula. Kanban views grouped by the property get its columns and colors."
    });
    scheme.bases.forEach((base, index) => {
      const row = new Setting(containerEl).setName(base.file.split("/").pop() || "(new base)");
      row.addText((text) =>
        text.setPlaceholder("Base file").setValue(base.file).onChange(async (input) => {
          base.file = input.trim();
          await save();
        })
      );
      row.addText((text) =>
        text.setPlaceholder("Rank formula").setValue(base.rankFormula).onChange(async (input) => {
          base.rankFormula = input.trim();
          await save();
        })
      );
      row.addText((text) =>
        text.setPlaceholder("Derive from (optional)").setValue(base.deriveFrom).onChange(async (input) => {
          base.deriveFrom = input.trim();
          await save();
        })
      );
      row.addExtraButton((button) =>
        button
          .setIcon("trash")
          .setTooltip("Remove base")
          .onClick(async () => {
            scheme.bases.splice(index, 1);
            await redraw();
          })
      );
    });
    new Setting(containerEl).addButton((button) =>
      button.setButtonText("Add base").onClick(async () => {
        scheme.bases.push({ file: "", rankFormula: "", deriveFrom: "" });
        await redraw();
      })
    );

    new Setting(containerEl).addButton((button) =>
      button
        .setButtonText("Remove this property")
        .setWarning()
        .onClick(async () => {
          this.plugin.settings.schemes = this.plugin.settings.schemes.filter((s) => s !== scheme);
          await redraw();
        })
    );
  }

  // Mock kanban cards styled by the same injected CSS.
  renderPreview(scheme) {
    const el = this.previewEls?.[scheme.id];
    if (!el) return;
    el.empty();
    const prop = scheme.property.trim();
    for (const value of scheme.values) {
      const card = el.createDiv({ cls: "generic-kanban-card is-readonly" });
      card.createDiv({ cls: "generic-kanban-card-title", text: `Example ${value.name || "(empty)"}` });
      const meta = card.createDiv({ cls: "generic-kanban-card-meta" });
      const row = meta.createDiv({ cls: "generic-kanban-card-property" });
      row.dataset.property = `note.${prop}`;
      row.dataset.value = value.name;
      row.createSpan({ cls: "generic-kanban-card-property-name", text: prop });
      row.createDiv({ cls: "generic-kanban-card-property-value", text: value.name });
    }
  }

  refreshStatus(scheme, delay = 400) {
    window.clearTimeout(this.statusTimers[scheme.id]);
    this.statusTimers[scheme.id] = window.setTimeout(async () => {
      const status = this.statusSettings?.[scheme.id];
      if (!status) return;
      const errors = this.plugin.validate(scheme);
      if (errors.length) {
        status.setDesc(errors.join(" "));
        return;
      }
      const changes = await this.plugin.computeChanges(scheme);
      const pending = [];
      for (const rename of changes.renames) pending.push(`rename "${rename.from}" → "${rename.to}" (${rename.files.length} notes)`);
      for (const base of changes.bases) pending.push(`update ${base.file.basename}`);
      for (const template of changes.templates) pending.push(`update ${template.file.basename}`);
      pending.push(...changes.warnings);
      if (changes.orphans.length) pending.push(`${changes.orphans.length} removed value(s) still used`);
      status.setDesc(pending.length ? `Pending: ${pending.join("; ")}.` : "In sync with the vault.");
    }, delay);
  }
}
