const { Plugin, PluginSettingTab, Setting, TFile } = require("obsidian");

// Files are named by ID (e.g. TSK-0042); the human name lives in a frontmatter
// property. This plugin only changes what is *displayed*: files, links and
// frontmatter are never modified. Editable titles show the real filename while
// focused, so renaming always acts on the ID.

const DEFAULT_SETTINGS = {
  nameProperty: "name",
  excludedFolders: ["00 - Data/Templates", "00 - Data/Bases", "00 - Data/Categories"],
  fileExplorer: true,
  tabs: true,
  noteTitles: true,
  readingLinks: true,
  graph: true
};

const GRAPH_VIEWS = ["graph", "localgraph"];

const ORIGINAL = "fileTitlesOriginal"; // dataset key holding the text we replaced

module.exports = class FileTitlesPlugin extends Plugin {
  async onload() {
    this.refreshTimer = null;
    this.observers = [];
    await this.loadSettings();

    this.addSettingTab(new FileTitlesSettingTab(this.app, this));

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.scheduleRefresh()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.scheduleRefresh()));
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleRefresh()));
    this.registerEvent(this.app.vault.on("create", () => this.scheduleRefresh()));

    this.registerMarkdownPostProcessor((el, ctx) => {
      if (this.settings.readingLinks) this.renameLinks(el, ctx.sourcePath);
    });

    this.app.workspace.onLayoutReady(() => {
      this.observeExplorer();
      this.scheduleRefresh(0);
    });
  }

  onunload() {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    for (const observer of this.observers) observer.disconnect();
    this.observers = [];
    this.restoreAll();
    this.unpatchGraph();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!Array.isArray(this.settings.excludedFolders)) {
      this.settings.excludedFolders = [...DEFAULT_SETTINGS.excludedFolders];
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.restoreAll();
    this.scheduleRefresh(0);
  }

  scheduleRefresh(delay = 100) {
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshAll();
    }, delay);
  }

  // ---- name lookup -------------------------------------------------------

  displayName(file) {
    if (!(file instanceof TFile) || file.extension !== "md") return null;
    const excluded = this.settings.excludedFolders.some(
      (folder) => folder && (file.path === folder || file.path.startsWith(folder.replace(/\/$/, "") + "/"))
    );
    if (excluded) return null;
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
    let value = frontmatter?.[this.settings.nameProperty.trim() || "name"];
    if (Array.isArray(value)) value = value[0];
    if (value === null || value === undefined) return null;
    value = String(value).trim();
    return value && value !== file.basename ? value : null;
  }

  // Set text while remembering the original, so it can be restored.
  setText(el, text) {
    if (!el) return;
    if (el.dataset[ORIGINAL] === undefined) el.dataset[ORIGINAL] = el.textContent;
    if (el.textContent !== text) el.textContent = text;
  }

  restoreText(el) {
    if (!el || el.dataset[ORIGINAL] === undefined) return;
    el.textContent = el.dataset[ORIGINAL];
    delete el.dataset[ORIGINAL];
  }

  // ---- refresh -----------------------------------------------------------

  refreshAll() {
    if (this.settings.fileExplorer) this.refreshExplorer();
    if (this.settings.graph) this.refreshGraphs();
    else this.unpatchGraph();
    this.app.workspace.iterateAllLeaves((leaf) => {
      const file = leaf.view?.file;
      const name = this.displayName(file);
      if (this.settings.tabs) this.refreshTab(leaf, file, name);
      if (this.settings.noteTitles) this.refreshNoteTitles(leaf.view, file, name);
    });
  }

  refreshExplorer() {
    for (const titleEl of document.querySelectorAll(".nav-file-title[data-path]")) {
      const contentEl = titleEl.querySelector(".nav-file-title-content");
      const file = this.app.vault.getAbstractFileByPath(titleEl.getAttribute("data-path"));
      const name = this.displayName(file);
      if (name) {
        this.setText(contentEl, name);
        titleEl.setAttribute("aria-label", file.basename);
      } else {
        this.restoreText(contentEl);
      }
    }
  }

  // The explorer re-renders items on sort/expand/rename: catch those too.
  observeExplorer() {
    for (const leaf of this.app.workspace.getLeavesOfType("file-explorer")) {
      const observer = new MutationObserver(() => {
        if (this.settings.fileExplorer) this.scheduleRefresh(50);
      });
      observer.observe(leaf.view.containerEl, { childList: true, subtree: true });
      this.observers.push(observer);
    }
  }

  refreshTab(leaf, file, name) {
    const el = leaf.tabHeaderInnerTitleEl;
    if (!el) return;
    if (name) this.setText(el, name);
    else this.restoreText(el);
  }

  refreshNoteTitles(view, file, name) {
    if (!view?.containerEl || !(file instanceof TFile)) return;
    const els = [view.titleEl, view.inlineTitleEl || view.containerEl.querySelector(".inline-title")];
    for (const el of els) {
      if (!el) continue;
      this.bindEditable(el, view);
      if (el === document.activeElement) continue; // user is editing: leave the real filename
      if (name) this.setText(el, name);
      else if (el.dataset[ORIGINAL] !== undefined) {
        delete el.dataset[ORIGINAL];
        el.textContent = file.basename;
      }
    }
  }

  // Editable titles rename the file: show the real filename while focused.
  bindEditable(el, view) {
    if (el.dataset.fileTitlesBound) return;
    el.dataset.fileTitlesBound = "true";
    this.registerDomEvent(el, "focus", () => {
      if (view.file && el.dataset[ORIGINAL] !== undefined) {
        el.textContent = view.file.basename;
        delete el.dataset[ORIGINAL];
      }
    });
    this.registerDomEvent(el, "blur", () => this.scheduleRefresh(150));
  }

  // ---- graph -------------------------------------------------------------
  // Graph labels are drawn on a canvas from node.getDisplayText(), which returns
  // the file basename. The node class isn't exported, so it is reached through a
  // live node and its getDisplayText is wrapped (and restored on unload).

  graphRenderers() {
    const renderers = [];
    for (const type of GRAPH_VIEWS) {
      for (const leaf of this.app.workspace.getLeavesOfType(type)) {
        const renderer = leaf.view?.renderer;
        if (renderer?.nodes) renderers.push(renderer);
      }
    }
    return renderers;
  }

  patchGraph(node) {
    if (this.graphPatch || !node) return;
    const proto = Object.getPrototypeOf(node);
    const original = proto?.getDisplayText;
    if (typeof original !== "function") return;
    const plugin = this;
    proto.getDisplayText = function () {
      const file = plugin.app.vault.getAbstractFileByPath(this.id);
      return plugin.displayName(file) ?? original.call(this);
    };
    this.graphPatch = { proto, original };
  }

  unpatchGraph() {
    if (!this.graphPatch) return;
    this.graphPatch.proto.getDisplayText = this.graphPatch.original;
    this.graphPatch = null;
    this.relabelGraphs();
  }

  refreshGraphs() {
    const renderers = this.graphRenderers();
    for (const renderer of renderers) {
      if (renderer.nodes.length) this.patchGraph(renderer.nodes[0]);
    }
    // A just-opened graph fills its nodes asynchronously: retry briefly until patched.
    const waiting = !this.graphPatch && renderers.length > 0;
    this.graphRetries = waiting ? (this.graphRetries || 0) + 1 : 0;
    if (waiting && this.graphRetries <= 20) this.scheduleRefresh(250);
    this.relabelGraphs();
  }

  // Labels are created once in initGraphics; dropping a stale node's graphics makes
  // the renderer rebuild it on the next frame with the (patched) display text.
  relabelGraphs() {
    for (const renderer of this.graphRenderers()) {
      let changed = false;
      for (const node of renderer.nodes) {
        if (node.text && node.text.text !== node.getDisplayText() && typeof node.clearGraphics === "function") {
          node.clearGraphics();
          changed = true;
        }
      }
      if (changed) renderer.changed?.();
    }
  }

  // Reading view: unpiped [[ID]] links show the name; piped links are left alone.
  renameLinks(el, sourcePath) {
    for (const a of el.querySelectorAll("a.internal-link")) {
      const href = a.getAttribute("data-href") || a.getAttribute("href");
      if (!href || a.textContent !== href) continue;
      const file = this.app.metadataCache.getFirstLinkpathDest(href.split("#")[0], sourcePath);
      const name = this.displayName(file);
      if (name) a.textContent = href.includes("#") ? `${name} > ${href.split("#").slice(1).join(" > ")}` : name;
    }
  }

  restoreAll() {
    for (const el of document.querySelectorAll(`[data-file-titles-original]`)) this.restoreText(el);
  }
};

class FileTitlesSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h1", { text: "File Titles" });
    containerEl.createEl("p", {
      text: "Show a frontmatter display name instead of ID filenames. Nothing in your files is changed; editable titles show the real filename while you edit them."
    });

    new Setting(containerEl)
      .setName("Name property")
      .setDesc("Frontmatter property holding the display name.")
      .addText((text) =>
        text
          .setPlaceholder("name")
          .setValue(this.plugin.settings.nameProperty)
          .onChange(async (value) => {
            this.plugin.settings.nameProperty = value.trim() || "name";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Excluded folders")
      .setDesc("Files in these folders always show their filename. One folder per line.")
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 4;
        textArea
          .setValue(this.plugin.settings.excludedFolders.join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.excludedFolders = value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
            await this.plugin.saveSettings();
          });
      });

    const toggles = [
      ["fileExplorer", "File explorer", "Show names in the file explorer."],
      ["tabs", "Tabs", "Show names in tab headers."],
      ["noteTitles", "Note titles", "Show names in the inline title and view header."],
      ["readingLinks", "Links in reading view", "Show names for unpiped [[ID]] links in reading view."],
      ["graph", "Graph view", "Show names as node labels in the global and local graph."]
    ];
    for (const [key, name, desc] of toggles) {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((toggle) =>
          toggle.setValue(this.plugin.settings[key]).onChange(async (value) => {
            this.plugin.settings[key] = value;
            await this.plugin.saveSettings();
          })
        );
    }
  }
}
