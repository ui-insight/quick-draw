// An editable, paged view of one uploaded table. Edits go straight into the
// table's grid; the caller is told so it can rebuild the report and mark the
// file as changed.

import { cellText, tableLayout } from './core.js';
import { $, el, fill } from './dom.js';

const PAGE_SIZE = 50;
const ROW_NUMBER_WIDTH = 56;
const ACTIONS_WIDTH = 40;
const MIN_WIDTH = 60;

// Column widths someone dragged, by table and column name, remembered in this browser.
const widthsKey = (name) => `quick-draw:widths:${name}`;
const loadWidths = (name) => {
  try {
    return JSON.parse(localStorage.getItem(widthsKey(name)) ?? '{}');
  } catch {
    return {};
  }
};
const saveWidths = (name, widths) => {
  try {
    localStorage.setItem(widthsKey(name), JSON.stringify(widths));
  } catch {
    // Storage may be blocked; widths then last until the page is reloaded.
  }
};

/** A starting width for a column, from the longest text in its header and shown cells. */
const autoWidth = (texts) => {
  const longest = Math.max(4, ...texts.map((t) => Math.min(t.length, 40)));
  return Math.round(Math.min(360, Math.max(80, longest * 8 + 28)));
};

/**
 * Renders the table into `container`.
 *
 * options:
 *   table      { grid } from the page state
 *   columns    the canonical column list (for header hints)
 *   view       { page, filter } kept by the caller between renders
 *   flagged    Map of grid row index -> note, shown on those rows
 *   pinned     Set of grid row indexes that need a value: shown first, highlighted
 *   needs      the column name a pinned row is missing, whose cell is outlined
 *   suggest    Map of column name -> values its cells suggest as you type
 *   name       remembers dragged column widths under this name
 *   columnHelp { column name: what it means }, shown when you point at a heading
 *   appliesTo  (grid row) -> { text, kind } for a read-only "Applies to" column
 *   onEdit(kind) called after any edit; kind is 'rows' when rows were added
 *              or deleted. Returning true means the caller has redrawn the table.
 */
export const renderDataTable = (container, options) => {
  const { table, columns, view, flagged = new Map(), pinned = new Set(), needs = null, suggest = new Map(), onEdit, name = 'table', columnHelp = {}, appliesTo = null } = options;
  const APPLIES_WIDTH = 190;
  const grid = table.grid;
  const { headerIndex, positions } = tableLayout(grid, columns);
  const header = grid[headerIndex] ?? [];
  const width = Math.max(header.length, ...grid.map((row) => row?.length ?? 0));

  const allRows = [];
  for (let r = headerIndex + 1; r < grid.length; r++) allRows.push(r);
  const needle = view.filter.trim().toLowerCase();
  const matching = needle
    ? allRows.filter((r) => (grid[r] ?? []).some((value) => cellText(value).toLowerCase().includes(needle)))
    : allRows;
  // Rows that need a value come first, so they are never on a later page.
  const rows = [...matching.filter((r) => pinned.has(r)), ...matching.filter((r) => !pinned.has(r))];
  const needsColumn = needs ? positions[needs] : undefined;
  const listIds = new Map();
  for (const [column, values] of suggest) {
    if (positions[column] !== undefined) listIds.set(positions[column], { id: `suggest-${column}-${Math.random().toString(36).slice(2, 8)}`, values });
  }
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  view.page = Math.min(Math.max(view.page, 0), pages - 1);
  const shown = rows.slice(view.page * PAGE_SIZE, (view.page + 1) * PAGE_SIZE);

  const rerender = () => renderDataTable(container, options);

  const search = el('input', {
    type: 'search',
    class: 'table-search',
    placeholder: 'Search rows',
    'aria-label': 'Search rows',
    value: view.filter,
  });
  let searchTimer;
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      view.filter = search.value;
      view.page = 0;
      rerender();
      const again = $('.table-search', container);
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    }, 200);
  });

  const addRow = el(
    'button',
    {
      type: 'button',
      class: 'button small secondary',
      onclick: () => {
        grid.push(Array(width).fill(''));
        view.filter = '';
        view.page = Number.MAX_SAFE_INTEGER;
        if (onEdit('rows') !== true) rerender();
        const inputs = container.querySelectorAll('tbody tr:last-child input');
        inputs[0]?.focus();
      },
    },
    'Add a row'
  );

  const cellInput = (r, c) => {
    const input = el('input', {
      type: 'text',
      value: cellText(grid[r]?.[c]),
      'aria-label': `${cellText(header[c]) || `Column ${c + 1}`}, row ${r + 1}`,
      spellcheck: false,
    });
    // The saved value, so a redraw can tell whether this cell is mid-edit.
    input.defaultValue = input.value;
    if (listIds.has(c)) input.setAttribute('list', listIds.get(c).id);
    input.addEventListener('change', () => {
      if (!grid[r]) grid[r] = [];
      grid[r][c] = input.value;
      input.defaultValue = input.value;
      onEdit('cell');
    });
    return input;
  };

  const appliesCell = (r) => {
    const { text, kind } = appliesTo(r);
    return el('td', { class: 'applies' }, el('span', { class: `applies-tag ${kind}` }, text));
  };

  // What each heading means, for the columns Quick Draw reads.
  const known = new Map(Object.entries(positions).map(([column, index]) => [index, column]));
  const headingTip = (c) => (known.has(c) ? columnHelp[known.get(c)] ?? null : 'Not used by Quick Draw');

  const body = shown.map((r) => {
    const note = flagged.get(r);
    const isPinned = pinned.has(r);
    return el(
      'tr',
      { class: isPinned ? 'needs-input' : note ? 'flagged' : null, title: note ?? null },
      el('th', { scope: 'row', class: 'row-number' }, String(r + 1)),
      appliesTo ? appliesCell(r) : null,
      Array.from({ length: width }, (_, c) => {
        const cell = el('td', { class: isPinned && c === needsColumn ? 'needs-value' : null }, cellInput(r, c));
        if (note) cell.firstChild.title = note;
        return cell;
      }),
      el(
        'td',
        { class: 'row-actions' },
        el(
          'button',
          {
            type: 'button',
            class: 'icon-button',
            'aria-label': `Delete row ${r + 1}`,
            title: 'Delete this row',
            onclick: () => {
              grid.splice(r, 1);
              // Rows below move up, so highlights must be worked out again, not reused.
              if (onEdit('rows') !== true) rerender();
            },
          },
          '×'
        )
      )
    );
  });

  const pager =
    pages > 1
      ? el(
          'div',
          { class: 'pager' },
          el(
            'button',
            { type: 'button', class: 'button small secondary', disabled: view.page === 0, onclick: () => ((view.page -= 1), rerender()) },
            'Previous'
          ),
          el('span', {}, `Page ${view.page + 1} of ${pages}`),
          el(
            'button',
            {
              type: 'button',
              class: 'button small secondary',
              disabled: view.page >= pages - 1,
              onclick: () => ((view.page += 1), rerender()),
            },
            'Next'
          )
        )
      : null;

  // Column widths: dragged ones are remembered; the rest fit their content.
  const saved = loadWidths(name);
  const columnName = (c) => cellText(header[c]) || `Column ${c + 1}`;
  const widths = Array.from({ length: width }, (_, c) => saved[columnName(c)] ?? autoWidth([columnName(c), ...shown.map((r) => cellText(grid[r]?.[c]))]));
  const cols = widths.map((w) => el('col', { style: `width: ${w}px` }));
  const tableNode = el('table', { class: 'data resizable' });
  const setTableWidth = () =>
    (tableNode.style.width = `${ROW_NUMBER_WIDTH + (appliesTo ? APPLIES_WIDTH : 0) + ACTIONS_WIDTH + widths.reduce((a, b) => a + b, 0)}px`);
  setTableWidth();

  const resize = (c, next, remember = true) => {
    widths[c] = Math.max(MIN_WIDTH, Math.round(next));
    cols[c].style.width = `${widths[c]}px`;
    setTableWidth();
    if (remember) saveWidths(name, { ...loadWidths(name), [columnName(c)]: widths[c] });
  };

  const handle = (c) => {
    const grip = el('span', {
      class: 'col-resize',
      role: 'separator',
      tabIndex: 0,
      'aria-orientation': 'vertical',
      'aria-label': `Resize ${columnName(c)}`,
      title: 'Drag to resize. Double-click to reset.',
    });
    grip.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      grip.setPointerCapture(event.pointerId);
      const start = event.clientX;
      const startWidth = widths[c];
      grip.classList.add('dragging');
      const move = (e) => resize(c, startWidth + e.clientX - start, false);
      const up = () => {
        grip.removeEventListener('pointermove', move);
        grip.classList.remove('dragging');
        resize(c, widths[c]);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', up, { once: true });
      grip.addEventListener('pointercancel', up, { once: true });
    });
    grip.addEventListener('dblclick', () => {
      const remembered = loadWidths(name);
      delete remembered[columnName(c)];
      saveWidths(name, remembered);
      resize(c, autoWidth([columnName(c), ...shown.map((r) => cellText(grid[r]?.[c]))]), false);
    });
    grip.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? 64 : 16;
      if (event.key === 'ArrowLeft') resize(c, widths[c] - step);
      else if (event.key === 'ArrowRight') resize(c, widths[c] + step);
      else return;
      event.preventDefault();
    });
    return grip;
  };

  const first = rows.length === 0 ? 0 : view.page * PAGE_SIZE + 1;
  const last = view.page * PAGE_SIZE + shown.length;
  fill(container, 
    el(
      'div',
      { class: 'table-tools' },
      search,
      el('span', { class: 'muted' }, rows.length ? `Rows ${first}–${last} of ${rows.length}` : needle ? 'No rows match' : 'No rows yet'),
      addRow
    ),
    el(
      'div',
      { class: 'table-scroll' },
      (tableNode.append(
        el(
          'colgroup',
          {},
          el('col', { style: `width: ${ROW_NUMBER_WIDTH}px` }),
          appliesTo ? el('col', { style: `width: ${APPLIES_WIDTH}px` }) : null,
          cols,
          el('col', { style: `width: ${ACTIONS_WIDTH}px` })
        ),
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col', class: 'row-number' }, 'Row'),
            appliesTo
              ? el('th', { scope: 'col' }, el('span', { class: 'col-name', title: 'Which expenses this row is used for. Worked out from DrawAccount, Sponsor and Award; it isn’t saved in the file.' }, 'Applies to'))
              : null,
            Array.from({ length: width }, (_, c) =>
              el('th', { scope: 'col', class: known.has(c) ? null : 'extra' }, el('span', { class: 'col-name', title: headingTip(c) }, columnName(c)), handle(c))
            ),
            el('th', { scope: 'col', class: 'row-actions' }, el('span', { class: 'visually-hidden' }, 'Actions'))
          )
        ),
        el('tbody', {}, body)
      ),
      tableNode)
    ),
    [...listIds.values()].map(({ id, values }) => el('datalist', { id }, values.map((value) => el('option', { value })))),
    pager,
    flagged.size > pinned.size
      ? el('p', { class: 'muted small' }, 'Point at a shaded row to see what is wrong and what to do.')
      : null
  );
};
