// An editable, paged view of one uploaded table. Edits go straight into the
// table's grid; the caller is told so it can rebuild the report and mark the
// file as changed.

import { cellText, tableLayout } from './core.js';
import { $, el, fill } from './dom.js';

const PAGE_SIZE = 50;

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
 *   onEdit(kind) called after any edit; kind is 'rows' when rows were added
 *              or deleted. Returning true means the caller has redrawn the table.
 */
export const renderDataTable = (container, options) => {
  const { table, columns, view, flagged = new Map(), pinned = new Set(), needs = null, suggest = new Map(), onEdit } = options;
  const grid = table.grid;
  const { headerIndex, positions } = tableLayout(grid, columns);
  const header = grid[headerIndex] ?? [];
  const width = Math.max(header.length, ...grid.map((row) => row?.length ?? 0));
  const known = new Set(Object.values(positions));

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

  const body = shown.map((r) => {
    const note = flagged.get(r);
    const isPinned = pinned.has(r);
    return el(
      'tr',
      { class: isPinned ? 'needs-input' : note ? 'flagged' : null, title: note ?? null },
      el('th', { scope: 'row', class: 'row-number' }, String(r + 1)),
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
      el(
        'table',
        { class: 'data' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', { scope: 'col', class: 'row-number' }, 'Row'),
            Array.from({ length: width }, (_, c) =>
              el(
                'th',
                { scope: 'col', class: known.has(c) ? null : 'extra', title: known.has(c) ? null : 'Not used by Quick Draw' },
                cellText(header[c]) || `Column ${c + 1}`
              )
            ),
            el('th', { scope: 'col', class: 'row-actions' }, el('span', { class: 'visually-hidden' }, 'Actions'))
          )
        ),
        el('tbody', {}, body)
      )
    ),
    [...listIds.values()].map(({ id, values }) => el('datalist', { id }, values.map((value) => el('option', { value })))),
    pager,
    flagged.size > pinned.size
      ? el('p', { class: 'muted small' }, 'Point at a shaded row to see what is wrong and what to do.')
      : null
  );
};
