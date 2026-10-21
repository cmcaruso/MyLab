const { Plugin } = require("obsidian");

// Obsidian's Properties panel has no widget for nested YAML maps: their type is
// inferred as "unknown" and the value is printed as raw JSON. This plugin
// registers an "object" widget and makes type inference pick it for plain
// objects. Leaf values (text, number, boolean, null) are editable in place;
// adding, renaming or deleting nested keys stays in source mode.
//
// It relies on undocumented internals (app.metadataTypeManager, checked against
// Obsidian 1.14.4). If they are missing the plugin does nothing.

const WIDGET_TYPE = "object";

function isPlainObject(value) {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isScalar(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (isPlainObject(value)) {
    const copy = {};
    for (const key of Object.keys(value)) copy[key] = deepClone(value[key]);
    return copy;
  }
  return value;
}

// Returns a copy of root with the value at path (keys and array indexes) replaced.
function setAtPath(root, path, value) {
  if (path.length === 0) return value;
  const copy = deepClone(root);
  let node = copy;
  for (let i = 0; i < path.length - 1; i++) node = node[path[i]];
  node[path[path.length - 1]] = value;
  return copy;
}

// Turns edited text back into a value of the same kind as the original:
// strings stay strings, numbers stay numbers while the text is numeric,
// an emptied value becomes null.
function parseLeaf(text, original) {
  const trimmed = text.trim();
  if (trimmed === "") return typeof original === "string" ? "" : null;
  if (typeof original === "number" || original === null) {
    const n = Number(trimmed);
    if (typeof original === "number" && Number.isFinite(n)) return n;
    return text;
  }
  return text;
}

function formatLeaf(value) {
  return value === null ? "" : String(value);
}

// Shaped like Obsidian's own widget components: containerEl plus focus()/onFocus().
class ObjectComponent {
  constructor(plugin, containerEl, value, ctx) {
    this.plugin = plugin;
    this.containerEl = containerEl;
    this.ctx = ctx;
    this.type = WIDGET_TYPE;
    this.setValue(value);
  }

  focus(mode) {
    this.onFocus(mode);
  }

  onFocus() {
    const first = this.el && this.el.querySelector("input");
    if (first) first.focus();
  }

  setValue(value) {
    this.value = value;
    if (this.el) this.el.remove();
    this.el = this.containerEl.createDiv({ cls: "np-tree metadata-property-value-item" });
    this.renderMap(this.el, value, []);
  }

  commit(path, newValue) {
    this.value = setAtPath(this.value, path, newValue);
    this.ctx.onChange(this.value);
  }

  collapseKey(path) {
    return `${this.ctx.sourcePath}\u0000${this.ctx.key}\u0000${path.join("\u0000")}`;
  }

  renderMap(parentEl, value, path) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      parentEl.createSpan({ cls: "np-empty", text: "{}" });
      return;
    }
    for (const key of keys) this.renderEntry(parentEl, key, value[key], path.concat(key));
  }

  renderArray(parentEl, value, path) {
    if (value.length === 0) {
      parentEl.createSpan({ cls: "np-empty", text: "[]" });
      return;
    }
    if (value.every(isScalar)) {
      const chips = parentEl.createDiv({ cls: "np-chips" });
      for (const item of value) chips.createSpan({ cls: "np-chip", text: item === null ? "null" : String(item) });
      return;
    }
    value.forEach((item, i) => this.renderEntry(parentEl, String(i), item, path.concat(i)));
  }

  renderEntry(parentEl, label, value, path) {
    const row = parentEl.createDiv({ cls: "np-row" });
    const head = row.createDiv({ cls: "np-head" });
    const branch = isPlainObject(value) || (Array.isArray(value) && value.length > 0 && !value.every(isScalar));

    if (!branch) {
      head.createSpan({ cls: "np-key", text: label });
      const valueEl = head.createDiv({ cls: "np-value" });
      if (Array.isArray(value)) this.renderArray(valueEl, value, path);
      else if (isScalar(value)) this.renderLeaf(valueEl, value, path);
      else valueEl.createSpan({ cls: "np-empty", text: JSON.stringify(value) });
      return;
    }

    const id = this.collapseKey(path);
    const collapsed = this.plugin.collapsed.has(id);
    row.toggleClass("is-collapsed", collapsed);
    const toggle = head.createSpan({ cls: "np-key np-toggle", text: label, attr: { tabindex: 0 } });
    head.createSpan({
      cls: "np-summary",
      text: Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`
    });
    const children = row.createDiv({ cls: "np-children" });
    if (Array.isArray(value)) this.renderArray(children, value, path);
    else this.renderMap(children, value, path);

    const flip = () => {
      const now = !row.hasClass("is-collapsed");
      row.toggleClass("is-collapsed", now);
      if (now) this.plugin.collapsed.add(id);
      else this.plugin.collapsed.delete(id);
    };
    toggle.addEventListener("click", flip);
    toggle.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        flip();
      }
    });
  }

  renderLeaf(valueEl, value, path) {
    if (typeof value === "boolean") {
      const box = valueEl.createEl("input", { type: "checkbox", cls: "metadata-input-checkbox" });
      box.checked = value;
      box.addEventListener("change", () => this.commit(path, box.checked));
      return;
    }

    const input = valueEl.createEl("input", {
      type: "text",
      cls: "np-input metadata-input metadata-input-text",
      attr: { spellcheck: "false" }
    });
    input.value = formatLeaf(value);
    if (typeof value === "number") input.addClass("is-number");

    let current = value;
    const save = () => {
      if (input.value === formatLeaf(current)) return;
      current = parseLeaf(input.value, current);
      this.commit(path, current);
    };
    input.addEventListener("blur", save);
    input.addEventListener("keydown", (evt) => {
      if (evt.isComposing) return;
      evt.stopPropagation(); // keep the Properties editor's own key handling out of the input
      if (evt.key === "Enter") {
        evt.preventDefault();
        save();
        input.blur();
      } else if (evt.key === "Escape") {
        evt.preventDefault();
        input.value = formatLeaf(current);
        input.blur();
      }
    });
  }
}

module.exports = class NestedPropertiesPlugin extends Plugin {
  onload() {
    this.collapsed = new Set();
    const manager = this.app.metadataTypeManager;
    if (!manager || typeof manager.getTypeInfo !== "function" || !manager.registeredTypeWidgets) {
      console.warn("[nested-properties] metadataTypeManager not found; plugin inactive.");
      return;
    }
    this.manager = manager;

    const plugin = this;
    const widget = (this.widget = {
      type: WIDGET_TYPE,
      icon: "lucide-braces",
      name: () => "Object",
      validate: isPlainObject,
      render: (el, value, ctx) => new ObjectComponent(plugin, el, isPlainObject(value) ? value : {}, ctx)
    });
    manager.registeredTypeWidgets[WIDGET_TYPE] = widget;

    const original = (this.originalGetTypeInfo = manager.getTypeInfo);
    manager.getTypeInfo = function (key, value) {
      const info = original.call(this, key, value);
      if (isPlainObject(value) && info && info.inferred && info.inferred.type === "unknown") {
        const expected = info.expected && info.expected.type !== "unknown" ? info.expected : widget;
        return { inferred: widget, expected };
      }
      return info;
    };

    this.app.workspace.onLayoutReady(() => this.rerenderOpenEditors());
  }

  onunload() {
    if (!this.manager) return;
    this.manager.getTypeInfo = this.originalGetTypeInfo;
    if (this.manager.registeredTypeWidgets[WIDGET_TYPE] === this.widget) {
      delete this.manager.registeredTypeWidgets[WIDGET_TYPE];
    }
    this.rerenderOpenEditors();
  }

  // Properties rows only re-render when their value changes; force it so
  // loading or unloading the plugin shows up without reopening notes.
  rerenderOpenEditors() {
    this.app.workspace.iterateAllLeaves((leaf) => {
      const editor = leaf.view && leaf.view.metadataEditor;
      if (!editor || !Array.isArray(editor.rendered)) return;
      for (const row of editor.rendered) {
        if (row && row.entry && typeof row.renderProperty === "function") {
          try {
            row.renderProperty(row.entry, true);
          } catch (err) {
            console.error("[nested-properties] re-render failed", err);
          }
        }
      }
    });
  }
};

module.exports.helpers = { isPlainObject, setAtPath, parseLeaf, deepClone };
