# Banners v0.6.1

A configurable Obsidian plugin for note banners, organization logos, and person images.

## Automatic note type detection

Banners does not require `cssclasses`. By default:

- `banner` = optional wide background banner
- `logo` = organization layout
- `image` = person layout

All property names can be changed in **Settings → Community plugins → Banners**. If both the organization-logo and person-image properties contain valid images, the organization layout takes precedence.

## Organization

```yaml
---
banner: "https://example.com/banner.jpg"
logo: "https://example.com/logo.png"
---
```

The logo is shown to the left of the note title.

## Person

```yaml
---
banner: "https://example.com/banner.jpg"
image: "https://example.com/person.jpg"
---
```

The image is shown above the note title/name and is circular by default.

## Per-note image positioning

Global banner and portrait focal positions are configured in the Banners settings page. A specific note can override them with four optional properties:

```yaml
---
banner: "[[Attachments/banner.jpg]]"
banner_x: 35
banner_y: 20

image: "[[People/Photos/person.jpg]]"
image_x: 55
image_y: 10
---
```

Values are percentages from `0` to `100`:

- X: `0` = left, `50` = center, `100` = right
- Y: `0` = top, `50` = center, `100` = bottom

A `%` suffix is also accepted (for example `banner_y: "25%"`). Values outside 0–100 are clamped. Invalid or missing values simply fall back to the global setting.

The default override-property names are `banner_x`, `banner_y`, `image_x`, and `image_y`, and each name can itself be changed in Settings. These properties affect only the note in which they appear.

## Banner only

```yaml
---
banner: "https://example.com/banner.jpg"
banner_x: 50
banner_y: 35
---
```

## Local images

The image properties support web URLs, Obsidian links, and vault-relative image paths:

```yaml
logo: "[[Attachments/company-logo.png]]"
image: "[[People/Photos/person.jpg]]"
banner: "[[Attachments/banner.jpg]]"
```


## Fullscreen person images

When **Open image fullscreen on click** is enabled (the default), clicking a person's portrait opens the original uncropped image in an edge-to-edge lightbox. Press **Escape**, click the backdrop, or click the full-size image to close it. The portrait is also keyboard-accessible with **Enter** or **Space**.

On iPhone/iPad, Banners consumes the portrait's touch/click interaction so Obsidian's mobile image handling cannot open a second viewer for the same tap. Banners also enforces a single active person-image lightbox at a time.

## Settings

Banners includes a complete settings page. You can configure:

### Properties

- banner property name
- organization logo property name
- person image property name
- `banner_x`, `banner_y`, `image_x`, and `image_y` override-property names
- whether selected properties are hidden from the Properties panel
- an editable list of hidden properties
- hidden properties are only suppressed when they contain a value

### Banner

- desktop and mobile height
- desktop content start
- separate mobile content start for organization vs person/banner-only notes
- desktop/mobile horizontal inset
- desktop/mobile corner radius
- global horizontal and vertical focal position
- fade length

### Organization

- desktop/mobile logo size
- desktop/mobile gap between logo and title
- desktop/mobile logo corner radius
- desktop/mobile spacing below the organization header

### Person

- desktop/mobile portrait size
- desktop/mobile gap between portrait and name
- portrait roundness
- global horizontal and vertical portrait focal position
- desktop/mobile spacing below the person header

A **Restore defaults** button returns all values to the defaults shipped with this version.

## Position precedence

For banners and person portraits, Banners resolves positioning in this order:

1. note-specific frontmatter override (`banner_x`, `banner_y`, `image_x`, `image_y`)
2. corresponding global setting
3. plugin default

This means adjusting one note never changes the crop or focal point of other notes.

## Upgrading from v0.4.0

The plugin ID remains `banners`, so the existing plugin files can be replaced directly. Existing notes continue to work. The old global portrait alignment (`Top`, `Center`, `Bottom`) is migrated to numeric Y positions (`0`, `50`, `100`).

If the hidden-properties list was still exactly the v0.4.0 default, Banners automatically adds the four new positioning properties to that list. Customized hidden-property lists are preserved unchanged.

The standalone `cover-banner-images.css` snippet is not needed.
