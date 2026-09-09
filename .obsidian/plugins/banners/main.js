const {
  Plugin,
  PluginSettingTab,
  Setting,
  Modal,
  TFile,
  normalizePath
} = require("obsidian");

const DEFAULT_SETTINGS = {
  // Frontmatter property names
  bannerProperty: "banner",
  logoProperty: "logo",
  personImageProperty: "image",

  // Optional per-note position override property names (0–100 percent)
  bannerXProperty: "banner_x",
  bannerYProperty: "banner_y",
  personImageXProperty: "image_x",
  personImageYProperty: "image_y",

  hideVisualProperties: true,
  hiddenProperties: [
    "banner",
    "logo",
    "image",
    "banner_x",
    "banner_y",
    "image_x",
    "image_y"
  ],

  // Banner — desktop
  bannerHeightDesktop: 350,
  bannerContentStartDesktop: 355,
  bannerHorizontalInsetDesktop: 12,
  bannerRadiusDesktop: 17,

  // Banner — shared positioning/fade
  bannerPositionX: 50,
  bannerPositionY: 60,
  bannerFadeLength: 40,

  // Banner — mobile/iPhone
  bannerHeightMobile: 350,
  organizationContentStartMobile: 295,
  otherContentStartMobile: 360,
  bannerHorizontalInsetMobile: 0,
  bannerRadiusMobile: 17,

  // Organization
  logoSizeDesktop: 60,
  logoSizeMobile: 60,
  logoGapDesktop: 14,
  logoGapMobile: 12,
  logoRadiusDesktop: 6,
  logoRadiusMobile: 7,
  organizationHeaderBottomGapDesktop: 22,
  organizationHeaderBottomGapMobile: 22,

  // Person
  personImageSizeDesktop: 210,
  personImageSizeMobile: 170,
  personImageGapDesktop: 14,
  personImageGapMobile: 12,
  personImageRadius: 50,
  personHeaderBottomGapDesktop: 24,
  personHeaderBottomGapMobile: 20,
  personImagePositionX: 50,
  personImagePositionY: 0,
  openPersonImageFullscreen: true
};

const V04_DEFAULT_HIDDEN_PROPERTIES = [
  "banner",
  "logo",
  "image",
  "cssclasses",
  "type"
];

module.exports = class BannersPlugin extends Plugin {
  async onload() {
    this.refreshTimer = null;
    this.personImageModal = null;
    await this.loadSettings();

    this.addSettingTab(new BannersSettingTab(this.app, this));

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.scheduleRefresh())
    );

    this.registerEvent(
      this.app.workspace.on("layout-change", () => this.scheduleRefresh())
    );

    this.registerEvent(
      this.app.metadataCache.on("changed", () => this.scheduleRefresh())
    );

    this.app.workspace.onLayoutReady(() => this.scheduleRefresh(0));
  }

  onunload() {
    if (this.personImageModal) {
      this.personImageModal.close();
      this.personImageModal = null;
    }

    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      this.cleanupView(leaf.view);
    }
  }

  async loadSettings() {
    const saved = await this.loadData();
    this.settings = this.createDefaultSettings();
    Object.assign(this.settings, saved || {});

    // Hidden-property migration. Preserve customized lists exactly, but if the
    // user still had the untouched v0.4.0 defaults, include the new per-note
    // positioning properties automatically.
    if (!Array.isArray(saved?.hiddenProperties)) {
      this.settings.hiddenProperties = [...DEFAULT_SETTINGS.hiddenProperties];
    } else {
      const normalizedHidden = this.normalizePropertyList(saved.hiddenProperties);
      const v04DefaultsUnchanged =
        normalizedHidden.length === V04_DEFAULT_HIDDEN_PROPERTIES.length &&
        V04_DEFAULT_HIDDEN_PROPERTIES.every((key) => normalizedHidden.includes(key));

      this.settings.hiddenProperties = v04DefaultsUnchanged
        ? [...DEFAULT_SETTINGS.hiddenProperties]
        : normalizedHidden;
    }

    // v0.5.0 migration: the old portrait setting was top/center/bottom. It is
    // now a numeric 0–100 position so it can match per-note image_y overrides.
    if (!Number.isFinite(Number(saved?.personImagePositionX))) {
      this.settings.personImagePositionX = DEFAULT_SETTINGS.personImagePositionX;
    }

    if (!Number.isFinite(Number(saved?.personImagePositionY))) {
      const legacyY = { top: 0, center: 50, bottom: 100 };
      this.settings.personImagePositionY =
        legacyY[saved?.personImageVerticalPosition] ?? DEFAULT_SETTINGS.personImagePositionY;
    }

    this.settings.bannerPositionX = this.clampPercent(this.settings.bannerPositionX, 50);
    this.settings.bannerPositionY = this.clampPercent(this.settings.bannerPositionY, 60);
    this.settings.personImagePositionX = this.clampPercent(this.settings.personImagePositionX, 50);
    this.settings.personImagePositionY = this.clampPercent(this.settings.personImagePositionY, 0);
  }

  createDefaultSettings() {
    return {
      ...DEFAULT_SETTINGS,
      hiddenProperties: [...DEFAULT_SETTINGS.hiddenProperties]
    };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.scheduleRefresh(0);
  }

  scheduleRefresh(delay = 100) {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }

    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refreshAllViews();
    }, delay);
  }

  refreshAllViews() {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      this.refreshView(leaf.view);
    }
  }

  refreshView(view) {
    if (!view?.containerEl) return;

    this.cleanupView(view);

    const file = view.file;
    if (!(file instanceof TFile)) return;

    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter ?? {};

    const bannerProperty = this.normalizedPropertyName(this.settings.bannerProperty, "banner");
    const logoProperty = this.normalizedPropertyName(this.settings.logoProperty, "logo");
    const personImageProperty = this.normalizedPropertyName(
      this.settings.personImageProperty,
      "image"
    );
    const bannerXProperty = this.normalizedPropertyName(
      this.settings.bannerXProperty,
      "banner_x"
    );
    const bannerYProperty = this.normalizedPropertyName(
      this.settings.bannerYProperty,
      "banner_y"
    );
    const personImageXProperty = this.normalizedPropertyName(
      this.settings.personImageXProperty,
      "image_x"
    );
    const personImageYProperty = this.normalizedPropertyName(
      this.settings.personImageYProperty,
      "image_y"
    );

    const bannerValue = frontmatter[bannerProperty];
    const logoValue = frontmatter[logoProperty];
    const personImageValue = frontmatter[personImageProperty];

    const bannerUrl = this.resolveImage(bannerValue, file.path);
    const logoUrl = this.resolveImage(logoValue, file.path);
    const personImageUrl = this.resolveImage(personImageValue, file.path);

    const viewContent =
      view.contentEl ||
      view.containerEl.querySelector(".view-content") ||
      view.containerEl;

    this.hideConfiguredPropertyRows(view.containerEl, frontmatter);

    if (!bannerUrl && !logoUrl && !personImageUrl) return;

    this.applySettingsVariables(viewContent);
    this.applyNotePositionOverrides(viewContent, frontmatter, {
      bannerXProperty,
      bannerYProperty,
      personImageXProperty,
      personImageYProperty
    });

    /*
     * Note type is inferred entirely from the configured image properties:
     *   logo property         -> organization
     *   person image property -> person
     *
     * If both resolve to images, organization wins so two incompatible title
     * layouts are never applied at the same time.
     */
    const noteType = logoUrl
      ? "organization"
      : personImageUrl
        ? "person"
        : null;

    if (logoUrl && personImageUrl) {
      console.warn(
        `Banners: both "${logoProperty}" and "${personImageProperty}" are set in ${file.path}; using organization layout.`
      );
    }

    const displayImageUrl = noteType === "organization" ? logoUrl : personImageUrl;

    viewContent.classList.add("banners-view-content");

    if (noteType === "organization") {
      viewContent.classList.add("banners-organization");
    } else if (noteType === "person") {
      viewContent.classList.add("banners-person");
    }

    const titles = Array.from(view.containerEl.querySelectorAll(".inline-title"));

    for (const title of titles) {
      if (!(title instanceof HTMLElement)) continue;

      const sizer =
        title.closest(".cm-sizer, .markdown-preview-sizer") ||
        title.parentElement;

      if (!sizer) continue;

      try {
        if (bannerUrl) {
          this.ensureBackgroundBanner(sizer, bannerUrl);
          sizer.classList.add("banners-banner-sizer");
          viewContent.classList.add("banners-has-banner");
        }

        if (noteType) {
          this.wrapTitle(title, displayImageUrl, noteType);
        }
      } catch (error) {
        console.error("Banners: failed to render note images", error);
      }
    }
  }

  applySettingsVariables(viewContent) {
    if (!(viewContent instanceof HTMLElement)) return;

    const vars = {
      "--banners-banner-height-desktop": `${this.settings.bannerHeightDesktop}px`,
      "--banners-content-start-desktop": `${this.settings.bannerContentStartDesktop}px`,
      "--banners-banner-gap-desktop": `${this.settings.bannerHorizontalInsetDesktop}px`,
      "--banners-banner-radius-desktop": `${this.settings.bannerRadiusDesktop}px`,
      "--banners-banner-x": `${this.settings.bannerPositionX}%`,
      "--banners-banner-y": `${this.settings.bannerPositionY}%`,
      "--banners-banner-fade": `-${this.settings.bannerFadeLength}%`,

      "--banners-banner-height-mobile": `${this.settings.bannerHeightMobile}px`,
      "--banners-org-content-start-mobile": `${this.settings.organizationContentStartMobile}px`,
      "--banners-other-content-start-mobile": `${this.settings.otherContentStartMobile}px`,
      "--banners-banner-gap-mobile": `${this.settings.bannerHorizontalInsetMobile}px`,
      "--banners-banner-radius-mobile": `${this.settings.bannerRadiusMobile}px`,

      "--banners-org-logo-size-desktop": `${this.settings.logoSizeDesktop}px`,
      "--banners-org-logo-size-mobile": `${this.settings.logoSizeMobile}px`,
      "--banners-org-logo-gap-desktop": `${this.settings.logoGapDesktop}px`,
      "--banners-org-logo-gap-mobile": `${this.settings.logoGapMobile}px`,
      "--banners-org-logo-radius-desktop": `${this.settings.logoRadiusDesktop}px`,
      "--banners-org-logo-radius-mobile": `${this.settings.logoRadiusMobile}px`,
      "--banners-org-bottom-gap-desktop": `${this.settings.organizationHeaderBottomGapDesktop}px`,
      "--banners-org-bottom-gap-mobile": `${this.settings.organizationHeaderBottomGapMobile}px`,

      "--banners-person-image-size-desktop": `${this.settings.personImageSizeDesktop}px`,
      "--banners-person-image-size-mobile": `${this.settings.personImageSizeMobile}px`,
      "--banners-person-image-gap-desktop": `${this.settings.personImageGapDesktop}px`,
      "--banners-person-image-gap-mobile": `${this.settings.personImageGapMobile}px`,
      "--banners-person-image-radius": `${this.settings.personImageRadius}%`,
      "--banners-person-bottom-gap-desktop": `${this.settings.personHeaderBottomGapDesktop}px`,
      "--banners-person-bottom-gap-mobile": `${this.settings.personHeaderBottomGapMobile}px`,
      "--banners-person-image-x": `${this.settings.personImagePositionX}%`,
      "--banners-person-image-y": `${this.settings.personImagePositionY}%`
    };

    for (const [name, value] of Object.entries(vars)) {
      viewContent.style.setProperty(name, value);
    }
  }

  applyNotePositionOverrides(viewContent, frontmatter, propertyNames) {
    if (!(viewContent instanceof HTMLElement)) return;

    const overrides = [
      ["--banners-banner-x", propertyNames.bannerXProperty],
      ["--banners-banner-y", propertyNames.bannerYProperty],
      ["--banners-person-image-x", propertyNames.personImageXProperty],
      ["--banners-person-image-y", propertyNames.personImageYProperty]
    ];

    for (const [cssVariable, propertyName] of overrides) {
      const value = this.readPercentOverride(frontmatter[propertyName]);
      if (value !== null) {
        viewContent.style.setProperty(cssVariable, `${value}%`);
      }
    }
  }

  readPercentOverride(value) {
    const candidate = Array.isArray(value) ? value[0] : value;
    if (candidate === null || candidate === undefined || candidate === "") return null;

    const normalized = typeof candidate === "string"
      ? candidate.trim().replace(/%$/, "").trim()
      : candidate;

    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;

    return Math.min(100, Math.max(0, parsed));
  }

  clampPercent(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(100, Math.max(0, parsed));
  }

  hideConfiguredPropertyRows(containerEl, frontmatter) {
    if (!this.settings.hideVisualProperties) return;

    const hiddenPropertyKeys = new Set(
      this.normalizePropertyList(this.settings.hiddenProperties)
        .filter((propertyName) => this.hasFrontmatterValue(frontmatter[propertyName]))
    );

    if (hiddenPropertyKeys.size === 0) return;

    for (const row of containerEl.querySelectorAll(".metadata-property")) {
      const key = row.dataset?.propertyKey;
      if (key && hiddenPropertyKeys.has(key)) {
        row.classList.add("banners-hidden-property");
      }
    }
  }

  normalizePropertyList(value) {
    const values = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[\n,]+/)
        : [];

    return [...new Set(
      values
        .map((item) => typeof item === "string" ? item.trim() : "")
        .filter(Boolean)
    )];
  }

  updateHiddenPropertyName(previousName, nextName) {
    const oldName = this.normalizedPropertyName(previousName, "");
    const newName = this.normalizedPropertyName(nextName, "");
    if (!oldName || !newName || oldName === newName) return;

    const hidden = this.normalizePropertyList(this.settings.hiddenProperties);
    const index = hidden.indexOf(oldName);
    if (index === -1) return;

    hidden[index] = newName;
    this.settings.hiddenProperties = [...new Set(hidden)];
  }

  hasFrontmatterValue(value) {
    if (Array.isArray(value)) {
      return value.some((item) => this.hasFrontmatterValue(item));
    }

    if (typeof value === "string") return value.trim().length > 0;
    return value !== null && value !== undefined && value !== false;
  }

  normalizedPropertyName(value, fallback) {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
  }

  ensureBackgroundBanner(sizer, bannerUrl) {
    let banner = sizer.querySelector(
      ':scope > [data-banners-role="background-banner"]'
    );

    if (!banner) {
      banner = document.createElement("div");
      banner.className = "banners-background-banner";
      banner.dataset.bannersManaged = "true";
      banner.dataset.bannersRole = "background-banner";

      sizer.insertBefore(banner, sizer.firstChild);
    }

    banner.style.backgroundImage =
      `url("${bannerUrl.replace(/"/g, '\\"')}")`;
  }

  wrapTitle(title, imageUrl, noteType) {
    const parent = title.parentElement;
    if (!parent) return;

    const header = document.createElement("div");
    header.className = "banners-header";
    header.dataset.bannersManaged = "true";
    header.dataset.bannersRole = "header";

    if (noteType === "organization") {
      header.classList.add("banners-organization-header");
    } else if (noteType === "person") {
      header.classList.add("banners-person-header");
    }

    parent.insertBefore(header, title);

    if (imageUrl) {
      const image = document.createElement("img");
      image.className = "banners-profile-image";
      image.dataset.bannersManaged = "true";
      image.dataset.bannersRole = noteType === "organization" ? "logo" : "person-image";
      image.src = imageUrl;
      image.draggable = false;

      if (noteType === "person" && this.settings.openPersonImageFullscreen) {
        image.classList.add("banners-clickable-person-image");
        image.alt = "Person portrait";
        image.setAttribute("role", "button");
        image.setAttribute("tabindex", "0");
        image.setAttribute("aria-label", "Open person image fullscreen");

        const stopMobileImageEvent = (event) => {
          // Obsidian mobile can attach image/touch handlers higher in the DOM.
          // Keep the portrait interaction owned by Banners so one tap cannot
          // also trigger a second, native mobile image viewer.
          event.stopPropagation();
        };

        const openFullscreenImage = (event) => {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
            if (typeof event.stopImmediatePropagation === "function") {
              event.stopImmediatePropagation();
            }
          }

          this.openPersonImageModal(
            imageUrl,
            title.textContent?.trim() || "Person image"
          );
        };

        // Stop touch/pointer events from bubbling to Obsidian's mobile view.
        // We deliberately do not prevent their default behavior here, so a
        // finger can still begin a normal scroll on top of the portrait.
        for (const eventName of ["touchstart", "touchend", "pointerdown", "pointerup"]) {
          image.addEventListener(eventName, stopMobileImageEvent);
        }

        image.addEventListener("click", openFullscreenImage);
        image.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            openFullscreenImage(event);
          }
        });
      } else {
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
      }

      header.appendChild(image);
    }

    header.appendChild(title);
  }

  openPersonImageModal(imageUrl, title) {
    // A single portrait interaction must never create stacked modals. This is
    // especially important on iOS, where a tap can produce more than one
    // compatibility event depending on the WebView/Obsidian gesture path.
    if (this.personImageModal) return;

    let modal = null;
    modal = new PersonImageModal(this.app, imageUrl, title, () => {
      if (this.personImageModal === modal) {
        this.personImageModal = null;
      }
    });

    this.personImageModal = modal;

    try {
      modal.open();
    } catch (error) {
      this.personImageModal = null;
      throw error;
    }
  }

  cleanupView(view) {
    if (!view?.containerEl) return;

    const headers = Array.from(
      view.containerEl.querySelectorAll(
        '[data-banners-managed="true"][data-banners-role="header"]'
      )
    );

    for (const header of headers) {
      const title = header.querySelector(".inline-title");

      if (title && header.parentElement) {
        header.parentElement.insertBefore(title, header);
      }

      header.remove();
    }

    view.containerEl
      .querySelectorAll(
        '[data-banners-managed="true"][data-banners-role="background-banner"]'
      )
      .forEach((element) => element.remove());

    view.containerEl
      .querySelectorAll(".banners-banner-sizer")
      .forEach((element) => element.classList.remove("banners-banner-sizer"));

    view.containerEl
      .querySelectorAll(".banners-view-content")
      .forEach((element) => {
        element.classList.remove(
          "banners-view-content",
          "banners-has-banner",
          "banners-organization",
          "banners-person"
        );

        for (const name of Array.from(element.style)) {
          if (name.startsWith("--banners-")) {
            element.style.removeProperty(name);
          }
        }
      });

    view.containerEl
      .querySelectorAll(".banners-hidden-property")
      .forEach((element) => element.classList.remove("banners-hidden-property"));

    view.containerEl
      .querySelectorAll('[data-banners-managed="true"]')
      .forEach((element) => element.remove());
  }

  resolveImage(value, sourcePath) {
    const candidates = Array.isArray(value) ? value : [value];

    for (const candidate of candidates) {
      const linkPath = this.extractLinkPath(candidate);
      if (!linkPath) continue;

      if (/^https?:\/\//i.test(linkPath)) return linkPath;
      if (/^(data:|app:)/i.test(linkPath)) return linkPath;

      const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
        linkPath,
        sourcePath
      );

      if (linkedFile instanceof TFile && this.isImageFile(linkedFile)) {
        return this.app.vault.getResourcePath(linkedFile);
      }

      const exactFile = this.app.vault.getAbstractFileByPath(
        normalizePath(linkPath)
      );

      if (exactFile instanceof TFile && this.isImageFile(exactFile)) {
        return this.app.vault.getResourcePath(exactFile);
      }
    }

    return null;
  }

  extractLinkPath(value) {
    if (typeof value !== "string") return null;

    const text = value.trim();
    if (!text) return null;

    const wikiMatch = text.match(/^!?\[\[([^|\]#]+)(?:[|#][^\]]*)?\]\]$/);
    if (wikiMatch) return wikiMatch[1].trim();

    const markdownMatch = text.match(/^!?\[[^\]]*\]\(([^)]+)\)$/);
    if (markdownMatch) return this.decodePath(markdownMatch[1].trim());

    return this.decodePath(text);
  }

  decodePath(path) {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  }

  isImageFile(file) {
    return [
      "png",
      "jpg",
      "jpeg",
      "gif",
      "webp",
      "svg",
      "bmp",
      "avif"
    ].includes(file.extension.toLowerCase());
  }
};

class PersonImageModal extends Modal {
  constructor(app, imageUrl, title, onClosed) {
    super(app);
    this.imageUrl = imageUrl;
    this.imageTitle = title;
    this.onClosed = onClosed;
  }

  onOpen() {
    this.modalEl.addClass("banners-image-modal");
    this.contentEl.addClass("banners-image-modal-content");
    this.contentEl.empty();

    const image = this.contentEl.createEl("img", {
      cls: "banners-fullscreen-person-image",
      attr: {
        src: this.imageUrl,
        alt: this.imageTitle || "Person image",
        draggable: "false"
      }
    });

    // Clicking the full-size image itself also closes the lightbox, while
    // Obsidian retains its normal Escape/backdrop close behavior.
    image.addEventListener("click", () => this.close());
  }

  onClose() {
    this.contentEl.empty();

    if (typeof this.onClosed === "function") {
      this.onClosed();
    }
  }
}

class BannersSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h1", { text: "Banners" });
    containerEl.createEl("p", {
      text: "Customize which frontmatter properties Banners uses and how banners, organization logos, and person images are displayed. Changes are applied immediately to open notes."
    });

    this.addHeading(containerEl, "Properties");

    this.addPropertyNameSetting(
      containerEl,
      "Banner property",
      "Frontmatter property containing the wide banner image.",
      "bannerProperty",
      "banner"
    );

    this.addPropertyNameSetting(
      containerEl,
      "Organization logo property",
      "If this property contains an image, the note uses the organization layout.",
      "logoProperty",
      "logo"
    );

    this.addPropertyNameSetting(
      containerEl,
      "Person image property",
      "If this property contains an image and no organization logo is present, the note uses the person layout.",
      "personImageProperty",
      "image"
    );

    new Setting(containerEl)
      .setName("Hide selected properties")
      .setDesc("Hide the populated properties listed below from Obsidian's Properties panel.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.hideVisualProperties)
          .onChange(async (value) => {
            this.plugin.settings.hideVisualProperties = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Hidden properties")
      .setDesc("Properties to hide when they contain a value. Enter one property per line (commas are also accepted).")
      .addTextArea((textArea) => {
        textArea.inputEl.rows = 6;
        textArea.inputEl.addClass("banners-properties-textarea");
        textArea
          .setPlaceholder("banner\nlogo\nimage\nbanner_x\nbanner_y\nimage_x\nimage_y\ncssclasses\ntype")
          .setValue(this.plugin.normalizePropertyList(this.plugin.settings.hiddenProperties).join("\n"))
          .onChange(async (value) => {
            this.plugin.settings.hiddenProperties = this.plugin.normalizePropertyList(value);
            await this.plugin.saveSettings();
          });
      });


    this.addHeading(containerEl, "Per-note position overrides");

    containerEl.createEl("p", {
      text: "These optional frontmatter properties override the global image position only for the current note. Values range from 0 to 100; 50 is centered."
    });

    this.addPropertyNameSetting(
      containerEl,
      "Banner X property",
      "Property used to override the banner's horizontal focal position for one note.",
      "bannerXProperty",
      "banner_x"
    );

    this.addPropertyNameSetting(
      containerEl,
      "Banner Y property",
      "Property used to override the banner's vertical focal position for one note.",
      "bannerYProperty",
      "banner_y"
    );

    this.addPropertyNameSetting(
      containerEl,
      "Person image X property",
      "Property used to override a portrait's horizontal crop position for one note.",
      "personImageXProperty",
      "image_x"
    );

    this.addPropertyNameSetting(
      containerEl,
      "Person image Y property",
      "Property used to override a portrait's vertical crop position for one note.",
      "personImageYProperty",
      "image_y"
    );

    this.addHeading(containerEl, "Banner");

    this.addNumberSetting(containerEl, "Height — desktop", "Banner height on desktop, in pixels.", "bannerHeightDesktop", 100, 1000, 10);
    this.addNumberSetting(containerEl, "Content start — desktop", "Distance from the top of the note to the title/content on desktop, in pixels.", "bannerContentStartDesktop", 0, 1200, 5);
    this.addNumberSetting(containerEl, "Horizontal inset — desktop", "Space between the banner and the left/right edges of the note, in pixels.", "bannerHorizontalInsetDesktop", 0, 200, 1);
    this.addNumberSetting(containerEl, "Corner radius — desktop", "Banner corner radius on desktop, in pixels.", "bannerRadiusDesktop", 0, 100, 1);

    this.addNumberSetting(containerEl, "Height — mobile", "Banner height on iPhone/mobile, in pixels.", "bannerHeightMobile", 100, 1000, 10);
    this.addNumberSetting(containerEl, "Organization content start — mobile", "Where the logo/title begins on mobile organization notes, in pixels from the top.", "organizationContentStartMobile", 0, 1200, 5);
    this.addNumberSetting(containerEl, "Other content start — mobile", "Where content begins on mobile person and banner-only notes, in pixels from the top.", "otherContentStartMobile", 0, 1200, 5);
    this.addNumberSetting(containerEl, "Horizontal inset — mobile", "Space between the banner and screen edges on mobile, in pixels.", "bannerHorizontalInsetMobile", 0, 200, 1);
    this.addNumberSetting(containerEl, "Bottom corner radius — mobile", "Radius of the banner's lower corners on mobile, in pixels.", "bannerRadiusMobile", 0, 100, 1);

    this.addNumberSetting(containerEl, "Horizontal image position", "Global banner focal point from left to right: 0 = left, 50 = center, 100 = right. A note-specific banner_x overrides this value.", "bannerPositionX", 0, 100, 1, "%");
    this.addNumberSetting(containerEl, "Vertical image position", "Global banner focal point from top to bottom: 0 = top, 50 = center, 100 = bottom. A note-specific banner_y overrides this value.", "bannerPositionY", 0, 100, 1, "%");
    this.addNumberSetting(containerEl, "Fade length", "Percentage of banner height used by the fade at the bottom. 0 disables the fade region; 40 matches the original design.", "bannerFadeLength", 0, 100, 1, "%");

    this.addHeading(containerEl, "Organizations");

    this.addNumberSetting(containerEl, "Logo size — desktop", "Width and height of organization logos on desktop, in pixels.", "logoSizeDesktop", 20, 400, 1);
    this.addNumberSetting(containerEl, "Logo size — mobile", "Width and height of organization logos on mobile, in pixels.", "logoSizeMobile", 20, 400, 1);
    this.addNumberSetting(containerEl, "Logo/title gap — desktop", "Space between the logo and title on desktop, in pixels.", "logoGapDesktop", 0, 100, 1);
    this.addNumberSetting(containerEl, "Logo/title gap — mobile", "Space between the logo and title on mobile, in pixels.", "logoGapMobile", 0, 100, 1);
    this.addNumberSetting(containerEl, "Logo corner radius — desktop", "Logo corner radius on desktop, in pixels.", "logoRadiusDesktop", 0, 100, 1);
    this.addNumberSetting(containerEl, "Logo corner radius — mobile", "Logo corner radius on mobile, in pixels.", "logoRadiusMobile", 0, 100, 1);
    this.addNumberSetting(containerEl, "Header bottom spacing — desktop", "Space below the organization logo/title row, in pixels.", "organizationHeaderBottomGapDesktop", 0, 200, 1);
    this.addNumberSetting(containerEl, "Header bottom spacing — mobile", "Space below the organization logo/title row on mobile, in pixels.", "organizationHeaderBottomGapMobile", 0, 200, 1);

    this.addHeading(containerEl, "People");

    new Setting(containerEl)
      .setName("Open image fullscreen on click")
      .setDesc("Open a person's original image in a fullscreen lightbox when the portrait is clicked. Escape, the backdrop, or the full-size image closes it.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.openPersonImageFullscreen)
          .onChange(async (value) => {
            this.plugin.settings.openPersonImageFullscreen = value;
            await this.plugin.saveSettings();
          })
      );

    this.addNumberSetting(containerEl, "Image size — desktop", "Width and height of the person's portrait on desktop, in pixels.", "personImageSizeDesktop", 40, 600, 1);
    this.addNumberSetting(containerEl, "Image size — mobile", "Width and height of the person's portrait on mobile, in pixels.", "personImageSizeMobile", 40, 600, 1);
    this.addNumberSetting(containerEl, "Image/name gap — desktop", "Space between the portrait and name on desktop, in pixels.", "personImageGapDesktop", 0, 100, 1);
    this.addNumberSetting(containerEl, "Image/name gap — mobile", "Space between the portrait and name on mobile, in pixels.", "personImageGapMobile", 0, 100, 1);
    this.addNumberSetting(containerEl, "Image roundness", "0 = square, 10–20 = rounded rectangle, 50 = circle (for square portraits).", "personImageRadius", 0, 50, 1, "%");
    this.addNumberSetting(containerEl, "Header bottom spacing — desktop", "Space below the person's name before Properties/content, in pixels.", "personHeaderBottomGapDesktop", 0, 200, 1);
    this.addNumberSetting(containerEl, "Header bottom spacing — mobile", "Space below the person's name on mobile, in pixels.", "personHeaderBottomGapMobile", 0, 200, 1);
    this.addNumberSetting(containerEl, "Horizontal image position", "Global portrait focal point from left to right: 0 = left, 50 = center, 100 = right. A note-specific image_x overrides this value.", "personImagePositionX", 0, 100, 1, "%");
    this.addNumberSetting(containerEl, "Vertical image position", "Global portrait focal point from top to bottom: 0 = top, 50 = center, 100 = bottom. A note-specific image_y overrides this value.", "personImagePositionY", 0, 100, 1, "%");

    this.addHeading(containerEl, "Reset");

    new Setting(containerEl)
      .setName("Restore defaults")
      .setDesc("Reset all Banners options to the defaults shipped with this version.")
      .addButton((button) =>
        button
          .setButtonText("Restore defaults")
          .setWarning()
          .onClick(async () => {
            this.plugin.settings = this.plugin.createDefaultSettings();
            await this.plugin.saveSettings();
            this.display();
          })
      );
  }

  addHeading(containerEl, text) {
    const heading = containerEl.createEl("h2", { text });
    heading.addClass("banners-settings-heading");
  }

  addPropertyNameSetting(containerEl, name, desc, key, placeholder) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text
          .setPlaceholder(placeholder)
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            const trimmed = value.trim();
            if (!trimmed) return;

            const previous = this.plugin.settings[key];
            this.plugin.settings[key] = trimmed;
            this.plugin.updateHiddenPropertyName(previous, trimmed);
            await this.plugin.saveSettings();
          })
      );
  }

  addNumberSetting(containerEl, name, desc, key, min, max, step = 1, suffix = "px") {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = String(min);
        text.inputEl.max = String(max);
        text.inputEl.step = String(step);
        text.inputEl.addClass("banners-number-input");

        text
          .setValue(String(this.plugin.settings[key]))
          .onChange(async (value) => {
            const parsed = Number(value);
            if (!Number.isFinite(parsed)) return;
            const clamped = Math.min(max, Math.max(min, parsed));
            this.plugin.settings[key] = clamped;
            await this.plugin.saveSettings();
          });

        if (suffix) {
          text.inputEl.setAttr("aria-label", `${name} (${suffix})`);
        }
      });
  }
}
