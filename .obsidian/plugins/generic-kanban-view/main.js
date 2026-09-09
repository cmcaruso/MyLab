const { BasesView, Plugin, Notice, Keymap, RenderContext, Modal, Menu, setIcon, NullValue } = require('obsidian');

const VIEW_TYPE = 'generic-kanban';
const OTHER_COLUMN = '__OTHER__';

class ColumnConfigModal extends Modal {
  constructor(app, columns, colorRules, colorMode, onSave) {
    super(app);
    this.rows = columns.map(value => ({ value, color: colorRules.get(value) || '' }));
    this.colorMode = colorMode || 'none';
    this.onSaveConfig = onSave;
  }

  onOpen() {
    this.setTitle('Configure Kanban columns');
    this.modalEl.addClass('generic-kanban-column-modal');
    this.renderModal();
  }

  onClose() {
    this.contentEl.empty();
  }

  renderModal() {
    this.contentEl.empty();

    this.contentEl.createDiv({
      cls: 'generic-kanban-column-modal-help',
      text: 'Columns use the exact values stored in the selected property. Reorder them here and optionally assign a color to each one.'
    });

    const rowsEl = this.contentEl.createDiv({ cls: 'generic-kanban-column-config-list' });
    this.rows.forEach((row, index) => this.renderRow(rowsEl, row, index));

    const add = this.contentEl.createEl('button', {
      cls: 'mod-cta generic-kanban-column-add-row',
      text: 'Add column',
      attr: { type: 'button' }
    });
    add.addEventListener('click', () => {
      this.rows.push({ value: '', color: '' });
      this.renderModal();
      const inputs = this.contentEl.querySelectorAll('.generic-kanban-column-value-input');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    });

    const modeRow = this.contentEl.createDiv({ cls: 'generic-kanban-column-mode-row' });
    modeRow.createSpan({ text: 'Use column colors' });
    const mode = modeRow.createEl('select', { cls: 'dropdown' });
    const modes = [
      ['none', 'Off'],
      ['header', 'Header only'],
      ['subtle', 'Subtle column background'],
      ['full', 'Stronger column background']
    ];
    for (const [value, label] of modes) {
      const option = mode.createEl('option', { value, text: label });
      option.selected = this.colorMode === value;
    }
    mode.addEventListener('change', () => { this.colorMode = mode.value; });

    const actions = this.contentEl.createDiv({ cls: 'generic-kanban-column-modal-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());

    const save = actions.createEl('button', { cls: 'mod-cta', text: 'Save', attr: { type: 'button' } });
    save.addEventListener('click', () => this.save());
  }

  renderRow(container, row, index) {
    const rowEl = container.createDiv({ cls: 'generic-kanban-column-config-row' });

    const order = rowEl.createDiv({ cls: 'generic-kanban-column-order-controls' });
    const up = order.createEl('button', {
      cls: 'clickable-icon',
      attr: { type: 'button', 'aria-label': 'Move column up', title: 'Move up' }
    });
    setIcon(up, 'chevron-up');
    up.disabled = index === 0;
    up.addEventListener('click', () => this.moveRow(index, -1));

    const down = order.createEl('button', {
      cls: 'clickable-icon',
      attr: { type: 'button', 'aria-label': 'Move column down', title: 'Move down' }
    });
    setIcon(down, 'chevron-down');
    down.disabled = index === this.rows.length - 1;
    down.addEventListener('click', () => this.moveRow(index, 1));

    const valueWrap = rowEl.createDiv({ cls: 'generic-kanban-column-value-wrap' });
    valueWrap.createSpan({ cls: 'generic-kanban-column-config-label', text: 'Value' });
    const valueInput = valueWrap.createEl('input', {
      cls: 'generic-kanban-column-value-input',
      attr: { type: 'text', placeholder: 'e.g. In Progress' }
    });
    valueInput.value = row.value;
    valueInput.addEventListener('input', () => { row.value = valueInput.value; });

    const colorWrap = rowEl.createDiv({ cls: 'generic-kanban-column-color-wrap' });
    colorWrap.createSpan({ cls: 'generic-kanban-column-config-label', text: 'Color' });
    const colorText = colorWrap.createEl('input', {
      cls: 'generic-kanban-column-color-text',
      attr: { type: 'text', placeholder: '#5b8def or var(--color-blue)' }
    });
    colorText.value = row.color;
    colorText.addEventListener('input', () => {
      row.color = colorText.value;
      this.syncColorPicker(colorPicker, row.color);
    });

    const colorPicker = colorWrap.createEl('input', {
      cls: 'generic-kanban-column-color-picker',
      attr: { type: 'color', 'aria-label': `Pick color for ${row.value || 'column'}` }
    });
    this.syncColorPicker(colorPicker, row.color);
    colorPicker.addEventListener('input', () => {
      row.color = colorPicker.value;
      colorText.value = row.color;
    });

    const clear = colorWrap.createEl('button', {
      cls: 'clickable-icon',
      attr: { type: 'button', 'aria-label': 'Clear column color', title: 'Clear color' }
    });
    setIcon(clear, 'x');
    clear.addEventListener('click', () => {
      row.color = '';
      colorText.value = '';
    });

    const remove = rowEl.createEl('button', {
      cls: 'clickable-icon generic-kanban-column-remove',
      attr: { type: 'button', 'aria-label': `Remove ${row.value || 'column'}`, title: 'Remove column' }
    });
    setIcon(remove, 'trash-2');
    remove.addEventListener('click', () => {
      this.rows.splice(index, 1);
      this.renderModal();
    });
  }

  moveRow(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= this.rows.length) return;
    const [row] = this.rows.splice(index, 1);
    this.rows.splice(target, 0, row);
    this.renderModal();
  }

  syncColorPicker(picker, color) {
    const value = String(color || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) picker.value = value;
  }

  save() {
    const seen = new Set();
    const columns = [];
    const colors = [];

    for (const row of this.rows) {
      const value = String(row.value || '').trim();
      const color = String(row.color || '').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      columns.push(value);
      if (color) colors.push(`${value} = ${color}`);
    }

    this.onSaveConfig(columns, colors, this.colorMode);
    this.close();
  }
}


const EMPTY_FILTER_VALUE = '__GENERIC_KANBAN_EMPTY_FILTER__';

class FilterConfigModal extends Modal {
  constructor(app, properties, availableProperties, onSave) {
    super(app);
    this.rows = [...properties];
    this.availableProperties = availableProperties;
    this.onSaveConfig = onSave;
    this.listId = `generic-kanban-filter-properties-${Math.random().toString(36).slice(2)}`;
  }

  onOpen() {
    this.setTitle('Configure quick filters');
    this.modalEl.addClass('generic-kanban-filter-config-modal');
    this.renderModal();
  }

  onClose() {
    this.contentEl.empty();
  }

  renderModal() {
    this.contentEl.empty();
    this.contentEl.createDiv({
      cls: 'generic-kanban-filter-modal-help',
      text: 'Choose which properties appear as quick filters above this Kanban view. Filters are temporary: they change only the visible cards, not the Base query.'
    });

    const datalist = this.contentEl.createEl('datalist', { attr: { id: this.listId } });
    for (const property of this.availableProperties) {
      datalist.createEl('option', { value: property.id, text: property.label });
    }

    const list = this.contentEl.createDiv({ cls: 'generic-kanban-filter-config-list' });
    this.rows.forEach((property, index) => this.renderRow(list, property, index));

    const add = this.contentEl.createEl('button', {
      cls: 'mod-cta generic-kanban-filter-add-row',
      text: 'Add filter property',
      attr: { type: 'button' }
    });
    add.addEventListener('click', () => {
      const used = new Set(this.rows);
      const next = this.availableProperties.find(property => !used.has(property.id));
      this.rows.push(next?.id || '');
      this.renderModal();
      const inputs = this.contentEl.querySelectorAll('.generic-kanban-filter-property-input');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    });

    const logic = this.contentEl.createDiv({ cls: 'generic-kanban-filter-logic-note' });
    logic.createSpan({ text: 'Logic: ' });
    logic.createEl('strong', { text: 'AND' });
    logic.createSpan({ text: ' between properties, ' });
    logic.createEl('strong', { text: 'OR' });
    logic.createSpan({ text: ' between selected values of the same property.' });

    const actions = this.contentEl.createDiv({ cls: 'generic-kanban-filter-modal-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'mod-cta', text: 'Save', attr: { type: 'button' } });
    save.addEventListener('click', () => this.save());
  }

  renderRow(container, property, index) {
    const row = container.createDiv({ cls: 'generic-kanban-filter-config-row' });

    const order = row.createDiv({ cls: 'generic-kanban-filter-order-controls' });
    const up = order.createEl('button', {
      cls: 'clickable-icon',
      attr: { type: 'button', 'aria-label': 'Move filter up', title: 'Move up' }
    });
    setIcon(up, 'chevron-up');
    up.disabled = index === 0;
    up.addEventListener('click', () => this.moveRow(index, -1));

    const down = order.createEl('button', {
      cls: 'clickable-icon',
      attr: { type: 'button', 'aria-label': 'Move filter down', title: 'Move down' }
    });
    setIcon(down, 'chevron-down');
    down.disabled = index === this.rows.length - 1;
    down.addEventListener('click', () => this.moveRow(index, 1));

    const input = row.createEl('input', {
      cls: 'generic-kanban-filter-property-input',
      attr: {
        type: 'text',
        list: this.listId,
        placeholder: 'e.g. note.assignee, note.institution, formula.status'
      }
    });
    input.value = property;
    input.addEventListener('input', () => { this.rows[index] = input.value; });

    const remove = row.createEl('button', {
      cls: 'clickable-icon',
      attr: { type: 'button', 'aria-label': 'Remove filter property', title: 'Remove filter' }
    });
    setIcon(remove, 'trash-2');
    remove.addEventListener('click', () => {
      this.rows.splice(index, 1);
      this.renderModal();
    });
  }

  moveRow(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= this.rows.length) return;
    const [row] = this.rows.splice(index, 1);
    this.rows.splice(target, 0, row);
    this.renderModal();
  }

  save() {
    const seen = new Set();
    const properties = [];
    for (const row of this.rows) {
      const property = String(row || '').trim();
      if (!property || seen.has(property)) continue;
      if (!/^(note|formula|file)\..+/.test(property)) continue;
      seen.add(property);
      properties.push(property);
    }
    this.onSaveConfig(properties);
    this.close();
  }
}

class FilterValueModal extends Modal {
  constructor(app, propertyLabel, options, selected, onApply) {
    super(app);
    this.propertyLabel = propertyLabel;
    this.options = options;
    this.selected = new Set(selected);
    this.onApply = onApply;
  }

  onOpen() {
    this.setTitle(`Filter by ${this.propertyLabel}`);
    this.modalEl.addClass('generic-kanban-filter-value-modal');
    this.renderModal();
  }

  onClose() {
    this.contentEl.empty();
  }

  renderModal() {
    this.contentEl.empty();

    const search = this.contentEl.createEl('input', {
      cls: 'generic-kanban-filter-search',
      attr: { type: 'search', placeholder: `Search ${this.propertyLabel}…`, 'aria-label': `Search ${this.propertyLabel}` }
    });

    const list = this.contentEl.createDiv({ cls: 'generic-kanban-filter-values' });
    if (!this.options.length) {
      list.createDiv({ cls: 'generic-kanban-filter-empty', text: 'No values are available for this property in the current Base result.' });
    } else {
      for (const option of this.options) {
        const label = list.createEl('label', { cls: 'generic-kanban-filter-value-row' });
        const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
        checkbox.checked = this.selected.has(option.key);
        checkbox.addEventListener('change', () => {
          if (checkbox.checked) this.selected.add(option.key);
          else this.selected.delete(option.key);
        });
        label.createSpan({ cls: 'generic-kanban-filter-value-label', text: option.label });
        label.dataset.search = option.label.toLocaleLowerCase();
      }
    }

    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase();
      list.querySelectorAll('.generic-kanban-filter-value-row').forEach(row => {
        row.toggle(!query || String(row.dataset.search || '').includes(query));
      });
    });

    const actions = this.contentEl.createDiv({ cls: 'generic-kanban-filter-modal-actions' });
    const clear = actions.createEl('button', { text: 'Clear', attr: { type: 'button' } });
    clear.addEventListener('click', () => {
      this.selected.clear();
      this.onApply(new Set());
      this.close();
    });
    const cancel = actions.createEl('button', { text: 'Cancel', attr: { type: 'button' } });
    cancel.addEventListener('click', () => this.close());
    const apply = actions.createEl('button', { cls: 'mod-cta', text: 'Apply', attr: { type: 'button' } });
    apply.addEventListener('click', () => {
      this.onApply(new Set(this.selected));
      this.close();
    });

    setTimeout(() => search.focus(), 0);
  }
}


class KanbanBasesView extends BasesView {
  type = VIEW_TYPE;

  constructor(controller, parentEl) {
    super(controller);
    this.rootEl = parentEl.createDiv({ cls: 'generic-kanban' });
    this.draggedPath = null;
    this.hoverPopover = null;
    this.quickFilterSelections = new Map();
    this.toolbarActionRegistered = false;
    this.toolbarActionFailed = false;
  }

  onload() {
    // BasesView extends Component. Register toolbar actions only after the
    // component has entered its lifecycle; doing this in the constructor can
    // abort view creation on some Obsidian versions.
    this.ensureToolbarAction();
  }

  onDataUpdated() {
    // Retry here because some Bases hosts create/update the toolbar after the
    // component's initial load hook. The guard prevents duplicate actions.
    this.ensureToolbarAction();
    this.render();
  }

  ensureToolbarAction() {
    if (this.toolbarActionRegistered) return;

    try {
      const action = this.addAction('ellipsis', 'Kanban options', (evt) => this.openKanbanOptionsMenu(evt));
      if (action) {
        this.toolbarActionRegistered = true;
        this.toolbarActionFailed = false;
      }
    } catch (error) {
      // A toolbar integration failure must never prevent the Kanban itself
      // from rendering. onDataUpdated() may retry once the Bases toolbar exists.
      this.toolbarActionFailed = true;
      console.warn('Generic Kanban: could not register native Bases toolbar action.', error);
    }
  }

  render() {
    this.rootEl.empty();

    const groupProp = this.config.getAsPropertyId('columnProperty');
    if (!groupProp) {
      this.renderMessage('Choose a “Column property” in the Kanban view options.');
      return;
    }
    const writableGroup = groupProp.startsWith('note.');
    const formulaGroup = groupProp.startsWith('formula.');
    if (!writableGroup && !formulaGroup) {
      this.renderMessage('Choose a note property or formula as the Kanban column property. File properties are not supported for grouping.');
      return;
    }

    const titleProp = this.config.getAsPropertyId('titleProperty') || 'file.name';
    const configuredColumns = this.asStringArray(this.config.get('columns'));
    const colorRules = this.parseColorRules(this.config.get('columnColors'));
    const colorMode = String(this.config.get('columnColorMode') || 'none');
    const showOther = this.config.get('showOther') !== false;
    const showEmpty = this.config.get('showEmpty') !== false;
    const showProps = this.config.get('showProperties') !== false;
    const quickFilterProperties = this.asStringArray(this.config.get('quickFilterProperties'));

    this.pruneQuickFilterSelections(quickFilterProperties);

    const allEntries = this.data?.data || [];
    const entries = allEntries.filter(entry => this.entryMatchesQuickFilters(entry, quickFilterProperties));
    const buckets = new Map();
    const discovered = [];

    // Discover columns from the full Base result so the board does not change shape
    // just because a temporary quick filter hides every card in one status.
    for (const entry of allEntries) {
      const value = entry.getValue(groupProp);
      const key = this.valueToColumnKey(value);
      if (key && !discovered.includes(key)) discovered.push(key);
    }

    // Bucket only the entries which pass the quick filters.
    for (const entry of entries) {
      const value = entry.getValue(groupProp);
      const key = this.valueToColumnKey(value);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(entry);
    }

    const columns = configuredColumns.length ? [...configuredColumns] : [...discovered];
    const hasUnassignedInSource = allEntries.some(entry => this.valueToColumnKey(entry.getValue(groupProp)) === '');
    if (!columns.length && hasUnassignedInSource) columns.push('');

    const unknown = discovered.filter(value => !columns.includes(value));
    if (showOther && unknown.length) columns.push(OTHER_COLUMN);
    if (hasUnassignedInSource && !columns.includes('')) columns.push('');

    const boardColumns = configuredColumns.length
      ? configuredColumns
      : columns.filter(value => value !== OTHER_COLUMN && value !== '');

    this.renderBoardControls(
      boardColumns,
      colorRules,
      colorMode,
      writableGroup,
      allEntries,
      quickFilterProperties,
      groupProp,
      titleProp
    );

    if (!columns.length) {
      this.renderMessage('No column values found. Add values in “Columns”, for example Backlog, Todo, In Progress, Done. Their order in that list is the board order.');
      return;
    }

    const board = this.rootEl.createDiv({ cls: 'generic-kanban-board' });
    for (const column of columns) {
      let columnEntries;
      if (column === OTHER_COLUMN) {
        columnEntries = unknown.flatMap(value => buckets.get(value) || []);
      } else {
        columnEntries = buckets.get(column) || [];
      }
      if (!showEmpty && columnEntries.length === 0) continue;

      const color = column === OTHER_COLUMN ? null : colorRules.get(column) || null;
      this.renderColumn(board, column, columnEntries, groupProp, titleProp, columns, showProps, color, colorMode, writableGroup);
    }
  }

  renderBoardControls(columns, colorRules, colorMode, writableGroup, entries, quickFilterProperties, groupProp, titleProp) {
    const activeCount = this.getActiveQuickFilterCount();
    const shouldShowFilters = quickFilterProperties.length > 0 || activeCount > 0;
    const shouldShowReadOnly = !writableGroup;
    const shouldShowFallbackMenu = this.toolbarActionFailed && !this.toolbarActionRegistered;

    if (!shouldShowFilters && !shouldShowReadOnly && !shouldShowFallbackMenu) return;

    const controls = this.rootEl.createDiv({ cls: 'generic-kanban-board-controls' });

    if (shouldShowFallbackMenu) {
      const fallback = controls.createEl('button', {
        cls: 'generic-kanban-fallback-menu clickable-icon',
        attr: { type: 'button', 'aria-label': 'Kanban options', title: 'Kanban options' }
      });
      setIcon(fallback, 'ellipsis');
      fallback.addEventListener('click', evt => this.openKanbanOptionsMenu(evt));
    }

    if (shouldShowFilters) {
      const quickFilters = controls.createDiv({ cls: 'generic-kanban-quick-filters' });

      for (const property of quickFilterProperties) {
        this.renderQuickFilterChip(quickFilters, entries, property);
      }

      if (activeCount > 0) {
        const clearAll = quickFilters.createEl('button', {
          cls: 'generic-kanban-clear-filters',
          attr: { type: 'button', 'aria-label': 'Clear all quick filters', title: 'Clear all filters' }
        });
        setIcon(clearAll, 'x');
        clearAll.createSpan({ text: `Clear ${activeCount}` });
        clearAll.addEventListener('click', () => {
          this.quickFilterSelections.clear();
          this.render();
        });
      }
    }

    if (shouldShowReadOnly) {
      const readOnly = controls.createDiv({ cls: 'generic-kanban-readonly-notice' });
      setIcon(readOnly.createSpan({ cls: 'generic-kanban-readonly-icon', attr: { 'aria-hidden': 'true' } }), 'sigma');
      readOnly.createSpan({
        text: 'Formula-driven columns — values are calculated by Bases, so drag-and-drop and column-specific note creation are disabled.'
      });
    }
  }

  openKanbanOptionsMenu(evt) {
    const menu = new Menu();

    menu.addItem(item => {
      item
        .setTitle('Configure quick filters')
        .setIcon('list-filter')
        .onClick(() => this.openQuickFilterConfig());
    });

    menu.addItem(item => {
      item
        .setTitle('Customize columns')
        .setIcon('settings-2')
        .onClick(() => this.openColumnConfig());
    });

    const activeCount = this.getActiveQuickFilterCount();
    if (activeCount > 0) {
      menu.addSeparator();
      menu.addItem(item => {
        item
          .setTitle(`Clear quick filters (${activeCount})`)
          .setIcon('x')
          .onClick(() => {
            this.quickFilterSelections.clear();
            this.render();
          });
      });
    }

    menu.showAtMouseEvent(evt);
  }

  openQuickFilterConfig() {
    const groupProp = this.config.getAsPropertyId('columnProperty');
    const titleProp = this.config.getAsPropertyId('titleProperty') || 'file.name';
    const quickFilterProperties = this.asStringArray(this.config.get('quickFilterProperties'));
    const entries = this.data?.data || [];
    const available = this.collectAvailableFilterProperties(entries, quickFilterProperties, groupProp, titleProp);

    const modal = new FilterConfigModal(this.app, quickFilterProperties, available, nextProperties => {
      this.config.set('quickFilterProperties', nextProperties);
      this.pruneQuickFilterSelections(nextProperties);
      this.render();
    });
    modal.open();
  }

  openColumnConfig() {
    const groupProp = this.config.getAsPropertyId('columnProperty');
    const configuredColumns = this.asStringArray(this.config.get('columns'));
    const colorRules = this.parseColorRules(this.config.get('columnColors'));
    const colorMode = String(this.config.get('columnColorMode') || 'none');
    const allEntries = this.data?.data || [];

    const discovered = [];
    if (groupProp) {
      for (const entry of allEntries) {
        const key = this.valueToColumnKey(entry.getValue(groupProp));
        if (key && !discovered.includes(key)) discovered.push(key);
      }
    }

    const columns = configuredColumns.length ? configuredColumns : discovered;
    const modal = new ColumnConfigModal(this.app, columns, colorRules, colorMode, (nextColumns, nextColors, nextColorMode) => {
      this.config.set('columns', nextColumns);
      this.config.set('columnColors', nextColors);
      this.config.set('columnColorMode', nextColorMode);
      this.render();
    });
    modal.open();
  }

  renderQuickFilterChip(container, entries, property) {
    const options = this.collectFilterOptions(entries, property);
    const selected = this.quickFilterSelections.get(property) || new Set();
    const label = this.getPropertyDisplayName(property);
    const chip = container.createEl('button', {
      cls: selected.size ? 'generic-kanban-filter-chip is-active' : 'generic-kanban-filter-chip',
      attr: { type: 'button', 'aria-label': `Filter by ${label}`, title: `Filter by ${label}` }
    });
    setIcon(chip, 'list-filter');
    chip.createSpan({ cls: 'generic-kanban-filter-chip-label', text: label });

    if (selected.size) {
      const selectedLabels = options.filter(option => selected.has(option.key)).map(option => option.label);
      const summary = selectedLabels.length === 1 ? selectedLabels[0] : `${selected.size} selected`;
      chip.createSpan({ cls: 'generic-kanban-filter-chip-value', text: summary });
    } else {
      chip.createSpan({ cls: 'generic-kanban-filter-chip-value', text: 'All' });
    }

    setIcon(chip.createSpan({ cls: 'generic-kanban-filter-chip-chevron', attr: { 'aria-hidden': 'true' } }), 'chevron-down');
    chip.addEventListener('click', () => {
      const modal = new FilterValueModal(this.app, label, options, selected, nextSelection => {
        if (nextSelection.size) this.quickFilterSelections.set(property, nextSelection);
        else this.quickFilterSelections.delete(property);
        this.render();
      });
      modal.open();
    });
  }

  pruneQuickFilterSelections(properties) {
    const allowed = new Set(properties);
    for (const property of this.quickFilterSelections.keys()) {
      if (!allowed.has(property)) this.quickFilterSelections.delete(property);
    }
  }

  getActiveQuickFilterCount() {
    let count = 0;
    for (const selection of this.quickFilterSelections.values()) {
      if (selection?.size) count += 1;
    }
    return count;
  }

  entryMatchesQuickFilters(entry, properties) {
    for (const property of properties) {
      const selected = this.quickFilterSelections.get(property);
      if (!selected || selected.size === 0) continue;
      const keys = new Set(this.getEntryFilterItems(entry, property).map(item => item.key));
      let matched = false;
      for (const selectedKey of selected) {
        if (keys.has(selectedKey)) {
          matched = true;
          break;
        }
      }
      if (!matched) return false;
    }
    return true;
  }

  collectFilterOptions(entries, property) {
    const options = new Map();
    for (const entry of entries) {
      for (const item of this.getEntryFilterItems(entry, property)) {
        if (!options.has(item.key)) options.set(item.key, item.label);
      }
    }

    return [...options.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => {
        if (a.key === EMPTY_FILTER_VALUE) return 1;
        if (b.key === EMPTY_FILTER_VALUE) return -1;
        return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' });
      });
  }

  getEntryFilterItems(entry, property) {
    if (property.startsWith('note.')) {
      const propertyName = property.slice(5);
      const cache = this.app.metadataCache.getFileCache(entry.file);
      const frontmatter = cache?.frontmatter;
      const raw = frontmatter ? frontmatter[propertyName] : undefined;
      return this.rawToFilterItems(raw);
    }

    let value;
    try {
      value = entry.getValue(property);
    } catch {
      return [{ key: EMPTY_FILTER_VALUE, label: 'Unassigned' }];
    }
    return this.basesValueToFilterItems(value);
  }

  rawToFilterItems(raw) {
    if (Array.isArray(raw)) {
      const flattened = raw.flatMap(value => this.rawToFilterItems(value).filter(item => item.key !== EMPTY_FILTER_VALUE));
      return flattened.length ? this.uniqueFilterItems(flattened) : [{ key: EMPTY_FILTER_VALUE, label: 'Unassigned' }];
    }
    if (raw === null || raw === undefined || raw === '') {
      return [{ key: EMPTY_FILTER_VALUE, label: 'Unassigned' }];
    }
    if (typeof raw === 'boolean') {
      return [{ key: `boolean:${raw}`, label: raw ? 'Checked' : 'Unchecked' }];
    }
    if (typeof raw === 'number') {
      return [{ key: `number:${raw}`, label: String(raw) }];
    }
    if (raw instanceof Date) {
      const text = raw.toISOString();
      return [{ key: `date:${text}`, label: text }];
    }
    if (typeof raw === 'object') {
      let text;
      try { text = JSON.stringify(raw); } catch { text = String(raw); }
      return [{ key: `object:${text}`, label: text }];
    }

    const text = String(raw).trim();
    if (!text) return [{ key: EMPTY_FILTER_VALUE, label: 'Unassigned' }];
    return [{ key: `string:${text}`, label: this.cleanFilterLabel(text) }];
  }

  basesValueToFilterItems(value) {
    if (!this.isRenderableValue(value)) return [{ key: EMPTY_FILTER_VALUE, label: 'Unassigned' }];

    // ListValue is public, but keeping this structural fallback makes the plugin
    // tolerant of different Value subclasses and future API additions.
    for (const candidate of [value?.values, value?.value, value?.items]) {
      if (Array.isArray(candidate)) {
        const flattened = candidate.flatMap(item => this.basesValueToFilterItems(item).filter(option => option.key !== EMPTY_FILTER_VALUE));
        return flattened.length ? this.uniqueFilterItems(flattened) : [{ key: EMPTY_FILTER_VALUE, label: 'Unassigned' }];
      }
    }

    if (typeof value?.[Symbol.iterator] === 'function' && typeof value !== 'string') {
      try {
        const iterable = Array.from(value);
        if (iterable.length && iterable.every(item => item !== value)) {
          const flattened = iterable.flatMap(item => this.basesValueToFilterItems(item).filter(option => option.key !== EMPTY_FILTER_VALUE));
          if (flattened.length) return this.uniqueFilterItems(flattened);
        }
      } catch {}
    }

    let text = '';
    try { text = String(value.toString()).trim(); } catch {}
    if (!text) return [{ key: EMPTY_FILTER_VALUE, label: 'Unassigned' }];
    return [{ key: `value:${text}`, label: this.cleanFilterLabel(text) }];
  }

  uniqueFilterItems(items) {
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.key)) map.set(item.key, item);
    }
    return [...map.values()];
  }

  cleanFilterLabel(text) {
    const value = String(text || '').trim();
    const wikilink = value.match(/^\[\[([^\]\n]+)\]\]$/);
    if (wikilink) {
      const body = wikilink[1].trim();
      const pipe = body.indexOf('|');
      const target = (pipe >= 0 ? body.slice(0, pipe) : body).trim();
      const alias = (pipe >= 0 ? body.slice(pipe + 1) : '').trim();
      return alias || this.wikilinkDisplayText(target);
    }
    return value;
  }

  collectAvailableFilterProperties(entries, configured, groupProp, titleProp) {
    const ids = new Set();
    const add = property => {
      const id = String(property || '').trim();
      if (/^(note|formula|file)\..+/.test(id)) ids.add(id);
    };

    for (const property of configured) add(property);
    for (const property of this.config.getOrder()) add(property);
    add(groupProp);
    add(titleProp);

    // Discover all ordinary note properties from the entries already provided
    // by Bases, even when those properties are not shown on the cards.
    for (const entry of entries) {
      const cache = this.app.metadataCache.getFileCache(entry.file);
      const frontmatter = cache?.frontmatter;
      if (!frontmatter) continue;
      for (const key of Object.keys(frontmatter)) add(`note.${key}`);
    }

    // Common file fields are useful even when they are not present in the card order.
    ['file.name', 'file.path', 'file.folder', 'file.ext'].forEach(add);

    return [...ids]
      .map(id => ({ id, label: this.getPropertyDisplayName(id) }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
  }

  getPropertyDisplayName(property) {
    try {
      const displayName = this.config.getDisplayName(property);
      if (displayName) return String(displayName);
    } catch {}

    const dot = property.indexOf('.');
    const name = dot >= 0 ? property.slice(dot + 1) : property;
    return name
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, char => char.toUpperCase());
  }

  renderMessage(text) {
    this.rootEl.createDiv({ cls: 'generic-kanban-message', text });
  }

  renderColumn(board, column, entries, groupProp, titleProp, columns, showProps, color, colorMode, writableGroup) {
    const isOther = column === OTHER_COLUMN;
    const label = isOther ? 'Other' : (column || 'Unassigned');
    const col = board.createDiv({ cls: 'generic-kanban-column' });
    col.dataset.column = column;

    if (color && colorMode !== 'none') {
      col.style.setProperty('--generic-kanban-column-color', color);
      col.addClass(`generic-kanban-color-${colorMode}`);
    }

    const header = col.createDiv({ cls: 'generic-kanban-column-header' });
    if (color && colorMode !== 'none') {
      header.createSpan({
        cls: 'generic-kanban-column-color-dot',
        attr: { 'aria-hidden': 'true' }
      });
    }
    header.createDiv({ cls: 'generic-kanban-column-title', text: label });
    header.createSpan({ cls: 'generic-kanban-count', text: String(entries.length) });

    if (!isOther && writableGroup) {
      const add = header.createEl('button', {
        cls: 'generic-kanban-add',
        text: '+',
        attr: { type: 'button', 'aria-label': `Create note in ${label}`, title: `Create note in ${label}` }
      });
      add.addEventListener('click', () => {
        const propName = groupProp.slice(5);
        void this.createFileForView(undefined, fm => {
          if (column === '') delete fm[propName];
          else fm[propName] = column;
        });
      });
    }

    const list = col.createDiv({ cls: 'generic-kanban-list' });
    if (!isOther && writableGroup) {
      list.addEventListener('dragover', event => {
        event.preventDefault();
        list.addClass('is-drag-over');
      });
      list.addEventListener('dragleave', () => list.removeClass('is-drag-over'));
      list.addEventListener('drop', event => {
        event.preventDefault();
        list.removeClass('is-drag-over');
        const path = event.dataTransfer?.getData('text/x-obsidian-kanban-path') || this.draggedPath;
        if (path) void this.moveFile(path, groupProp, column);
      });
    }

    for (const entry of entries) {
      this.renderCard(list, entry, groupProp, titleProp, columns, showProps, writableGroup);
    }
  }

  renderCard(list, entry, groupProp, titleProp, columns, showProps, writableGroup) {
    const card = list.createDiv({
      cls: writableGroup ? 'generic-kanban-card' : 'generic-kanban-card is-readonly',
      attr: { draggable: writableGroup ? 'true' : 'false' }
    });
    card.dataset.path = entry.file.path;

    if (writableGroup) {
      card.addEventListener('dragstart', event => {
        this.draggedPath = entry.file.path;
        card.addClass('is-dragging');
        event.dataTransfer?.setData('text/x-obsidian-kanban-path', entry.file.path);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
      });
      card.addEventListener('dragend', () => {
        this.draggedPath = null;
        card.removeClass('is-dragging');
        this.rootEl.querySelectorAll('.is-drag-over').forEach(el => el.removeClass('is-drag-over'));
      });
    }

    this.renderCardTitle(card, entry, titleProp);

    if (showProps) {
      const order = this.config.getOrder();
      const props = order.filter(property => property !== titleProp && property !== groupProp);
      if (props.length) {
        const meta = card.createDiv({ cls: 'generic-kanban-card-meta' });
        for (const property of props) {
          const value = entry.getValue(property);
          if (!this.isRenderableValue(value)) continue;

          const row = meta.createDiv({ cls: 'generic-kanban-card-property' });
          row.createSpan({
            cls: 'generic-kanban-card-property-name',
            text: this.config.getDisplayName(property)
          });
          const valueEl = row.createDiv({ cls: 'generic-kanban-card-property-value' });
          this.renderBasesValue(valueEl, value, entry.file.path);
        }
      }
    }

    // Accessible/mobile alternative to dragging for writable note properties.
    if (writableGroup) {
      const move = card.createEl('select', {
        cls: 'generic-kanban-move',
        attr: { 'aria-label': `Move ${entry.file.basename} to another column`, title: 'Move to…' }
      });
      move.createEl('option', { text: 'Move to…', value: '' });
      for (const column of columns.filter(value => value !== OTHER_COLUMN)) {
        move.createEl('option', { text: column || 'Unassigned', value: `v:${column}` });
      }
      move.addEventListener('change', () => {
        if (!move.value.startsWith('v:')) return;
        const value = move.value.slice(2);
        move.value = '';
        void this.moveFile(entry.file.path, groupProp, value);
      });
    }
  }

  renderCardTitle(card, entry, titleProp) {
    if (titleProp === 'file.name') {
      const link = card.createEl('a', {
        cls: 'generic-kanban-card-title',
        text: entry.file.basename
      });
      this.bindFileOpen(link, entry.file.path);
      return;
    }

    const titleValue = entry.getValue(titleProp);
    if (!this.isRenderableValue(titleValue)) {
      const fallback = card.createEl('a', {
        cls: 'generic-kanban-card-title',
        text: entry.file.basename
      });
      this.bindFileOpen(fallback, entry.file.path);
      return;
    }

    const titleRow = card.createDiv({ cls: 'generic-kanban-card-title-row' });
    const renderedTitle = titleRow.createDiv({ cls: 'generic-kanban-card-title generic-kanban-card-title-rendered' });
    this.renderBasesValue(renderedTitle, titleValue, entry.file.path);

    const open = titleRow.createEl('button', {
      cls: 'generic-kanban-open-note',
      text: '↗',
      attr: {
        type: 'button',
        'aria-label': `Open ${entry.file.basename}`,
        title: `Open ${entry.file.basename}`
      }
    });
    open.addEventListener('click', event => {
      event.stopPropagation();
      void this.app.workspace.openLinkText(entry.file.path, '', Keymap.isModEvent(event));
    });
  }

  valueToColumnKey(value) {
    if (!this.isRenderableValue(value)) return '';
    try {
      return String(value.toString()).trim();
    } catch {
      return '';
    }
  }

  isRenderableValue(value) {
    if (!value) return false;
    if (typeof NullValue === 'function' && value instanceof NullValue) return false;

    // Boolean false and numeric zero are meaningful values and must remain visible.
    // Empty string/list values normally stringify to an empty string.
    try {
      if (!value.isTruthy() && String(value.toString()).trim() === '') return false;
    } catch {
      return true;
    }
    return true;
  }

  renderBasesValue(container, value, sourcePath = '') {
    try {
      value.renderTo(container, new RenderContext());
    } catch (error) {
      console.warn('Generic Kanban: Bases value renderer failed; falling back to text.', error);
      container.setText(value.toString());
    }

    // Bases can expose frontmatter wikilinks as StringValue/ListValue items. In that
    // case Value.renderTo() correctly renders the value type, but the literal [[...]]
    // remains plain text. Post-process only those text nodes so native rendering for
    // dates, booleans, lists, tags, images, etc. is left untouched.
    this.linkifyWikilinks(container, sourcePath);
  }

  linkifyWikilinks(root, sourcePath) {
    const doc = root.ownerDocument;
    const view = doc.defaultView;
    const showText = view?.NodeFilter?.SHOW_TEXT ?? 4;
    const walker = doc.createTreeWalker(root, showText);
    const textNodes = [];

    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.nodeValue || '';
      if (!text.includes('[[')) continue;

      const parent = node.parentElement;
      if (!parent) continue;
      if (parent.closest('a, code, pre, input, textarea')) continue;
      textNodes.push(node);
    }

    // Do DOM replacement only after walking, otherwise TreeWalker can skip nodes.
    for (const node of textNodes) {
      const text = node.nodeValue || '';
      const fragment = doc.createDocumentFragment();
      const wikilink = /(!?)\[\[([^\]\n]+)\]\]/g;
      let lastIndex = 0;
      let match;
      let replaced = false;

      while ((match = wikilink.exec(text)) !== null) {
        const full = match[0];
        const isEmbed = match[1] === '!';
        const body = match[2].trim();
        if (!body || isEmbed) continue;

        if (match.index > lastIndex) {
          fragment.append(doc.createTextNode(text.slice(lastIndex, match.index)));
        }

        const pipe = body.indexOf('|');
        const target = (pipe >= 0 ? body.slice(0, pipe) : body).trim();
        const alias = (pipe >= 0 ? body.slice(pipe + 1) : '').trim();
        if (!target) {
          fragment.append(doc.createTextNode(full));
          lastIndex = match.index + full.length;
          continue;
        }

        const link = doc.createElement('a');
        link.addClass('internal-link');
        link.setAttr('href', target);
        link.setAttr('data-href', target);
        link.setAttr('draggable', 'false');
        link.setText(alias || this.wikilinkDisplayText(target));
        this.bindInternalLink(link, target, sourcePath);
        fragment.append(link);

        replaced = true;
        lastIndex = match.index + full.length;
      }

      if (!replaced) continue;
      if (lastIndex < text.length) fragment.append(doc.createTextNode(text.slice(lastIndex)));
      node.replaceWith(fragment);
    }
  }

  wikilinkDisplayText(target) {
    const hash = target.indexOf('#');
    const base = (hash >= 0 ? target.slice(0, hash) : target).trim();
    const heading = hash >= 0 ? target.slice(hash + 1).trim() : '';
    const slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
    const noteName = (slash >= 0 ? base.slice(slash + 1) : base).replace(/\.md$/i, '');

    if (!noteName && heading) return heading;
    if (heading) return `${noteName || base} › ${heading}`;
    return noteName || base || target;
  }

  bindInternalLink(link, target, sourcePath) {
    link.addEventListener('click', event => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      event.stopPropagation();
      const modEvent = Keymap.isModEvent(event);
      void this.app.workspace.openLinkText(target, sourcePath || '', modEvent);
    });

    link.addEventListener('mouseover', event => {
      this.app.workspace.trigger('hover-link', {
        event,
        source: 'bases',
        hoverParent: this,
        targetEl: link,
        linktext: target,
        sourcePath: sourcePath || ''
      });
    });
  }

  bindFileOpen(link, path) {
    link.addEventListener('click', event => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault();
      const modEvent = Keymap.isModEvent(event);
      void this.app.workspace.openLinkText(path, '', modEvent);
    });

    link.addEventListener('mouseover', event => {
      this.app.workspace.trigger('hover-link', {
        event,
        source: 'bases',
        hoverParent: this,
        targetEl: link,
        linktext: path
      });
    });
  }

  async moveFile(path, propertyId, value) {
    const file = this.app.vault.getFileByPath(path);
    if (!file) {
      new Notice(`Could not find ${path}`);
      return;
    }
    if (!propertyId.startsWith('note.')) {
      new Notice('Kanban can only update note properties.');
      return;
    }

    const property = propertyId.slice(5);
    try {
      await this.app.fileManager.processFrontMatter(file, fm => {
        if (value === '') delete fm[property];
        else fm[property] = value;
      });
    } catch (error) {
      console.error('Generic Kanban: failed to update property', error);
      new Notice(`Could not update “${property}”.`);
    }
  }

  asStringArray(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    for (const item of value) {
      const text = String(item).trim();
      if (!text || result.includes(text)) continue;
      result.push(text);
    }
    return result;
  }

  parseColorRules(value) {
    const rules = new Map();
    if (!Array.isArray(value)) return rules;

    for (const rawRule of value) {
      const rule = String(rawRule).trim();
      if (!rule) continue;

      const equals = rule.indexOf('=');
      if (equals <= 0) continue;

      const column = rule.slice(0, equals).trim();
      const color = rule.slice(equals + 1).trim();
      if (!column || !color || !this.isValidCssColor(color)) continue;
      rules.set(column, color);
    }
    return rules;
  }

  isValidCssColor(color) {
    try {
      return typeof CSS !== 'undefined' && CSS.supports('color', color);
    } catch {
      return false;
    }
  }
}

module.exports = class GenericKanbanPlugin extends Plugin {
  onload() {
    const registered = this.registerBasesView(VIEW_TYPE, {
      name: 'Kanban',
      icon: 'lucide-columns-3',
      factory: (controller, containerEl) => new KanbanBasesView(controller, containerEl),
      options: () => [
        {
          type: 'property',
          displayName: 'Column property',
          key: 'columnProperty',
          placeholder: 'Choose a note property or formula',
          filter: property => property.startsWith('note.') || property.startsWith('formula.')
        },
        {
          type: 'multitext',
          displayName: 'Columns (ordered)',
          key: 'columns',
          default: ['Backlog', 'Todo', 'In Progress', 'Done']
        },
        {
          type: 'multitext',
          displayName: 'Column colors',
          key: 'columnColors',
          default: []
        },
        {
          type: 'dropdown',
          displayName: 'Use column colors',
          key: 'columnColorMode',
          default: 'none',
          options: {
            none: 'Off',
            header: 'Header only',
            subtle: 'Subtle column background',
            full: 'Stronger column background'
          }
        },
        {
          type: 'multitext',
          displayName: 'Quick filter properties',
          key: 'quickFilterProperties',
          default: []
        },
        {
          type: 'property',
          displayName: 'Card title',
          key: 'titleProperty',
          default: 'file.name',
          placeholder: 'File name'
        },
        {
          type: 'toggle',
          displayName: 'Show card properties',
          key: 'showProperties',
          default: true
        },
        {
          type: 'toggle',
          displayName: 'Show empty columns',
          key: 'showEmpty',
          default: true
        },
        {
          type: 'toggle',
          displayName: 'Show unconfigured values in Other',
          key: 'showOther',
          default: true
        }
      ]
    });

    if (!registered) {
      console.warn('Generic Kanban: Bases core plugin is not enabled.');
    }
  }
};
