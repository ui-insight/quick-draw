// Quick Draw page: one step per tab. Files → Expenses → Data dictionary →
// Templates → Report. Everything happens in this browser; nothing is sent
// anywhere.
//
// Two files: the expenses, and a data dictionary workbook whose sheets hold
// the cost codes, the awards and the templates.

import {
  COLUMNS,
  COLUMN_HELP,
  DICTIONARY_SHEETS,
  EXCLUDE,
  GOAL_MARKER,
  README_SHEET,
  buildReport,
  cellText,
  classifySheets,
  defaultFilename,
  formatDay,
  formatMoney,
  readMeRows,
  readTable,
  tableLayout,
  toCsv,
} from './core.js';
import { buildWorkbook, readSheets, writeXlsx } from './workbook.js';
import { renderDataTable } from './datatable.js';
import { renderTemplates } from './builder.js';
import { drawCostChart } from './chart.js';
import { PAYMENT_SYSTEMS, openGuide, renderGuidePage } from './guide.js';
import { $, downloadBytes, el, fill, installTooltips, notice, plural, tabStrip } from './dom.js';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const FILES = {
  expenses: {
    title: 'Expenses',
    about: 'One row per expense: Award, CostCode and Cost, with DrawAccount, Sponsor and CostDate if you have them.',
    sample: 'samples/expenses.csv',
  },
  dictionary: {
    title: 'Data dictionary',
    about: 'An Excel workbook with Cost codes (each code’s budget category), Awards (each award’s goal), Templates (the justification wording) and Payment systems (where requests go).',
    sample: 'samples/dictionary.xlsx',
    canStartEmpty: true,
  },
};

/** Each table, the file it lives in, and what to call it. */
const TABLES = {
  expenses: { file: 'expenses', title: 'Expenses' },
  dictionary: { file: 'dictionary', title: 'Cost codes' },
  awards: { file: 'dictionary', title: 'Awards' },
  templates: { file: 'dictionary', title: 'Templates' },
  systems: { file: 'dictionary', title: 'Payment systems' },
};

const STEPS = [
  { key: 'files', label: 'Files' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'dictionary', label: 'Data dictionary' },
  { key: 'templates', label: 'Templates' },
  { key: 'report', label: 'Report' },
  { key: 'help', label: 'Help' },
];

const state = {
  // file key -> { fileName, kind: 'csv' | 'xlsx', original, handle, dirty, error, note,
  //               tables: { name -> { grid, sheetName, records, error, added } } }
  files: { expenses: null, dictionary: null },
  // Rows Quick Draw added for codes and awards missing from the dictionary, by
  // code or award, so they can be taken away again if no longer needed.
  autoAdded: { dictionary: new Set(), awards: new Set() },
  report: null,
  warnings: [],
  edits: new Map(), // award key -> edited justification
  generated: new Map(), // award key -> drafted justification, to drop edits when the draft changes
  ui: {
    tab: 'files',
    dictionaryView: 'dictionary',
    account: null,
    open: new Set(),
    describing: new Set(), // award keys whose code descriptions are being edited
    sponsor: null,
    award: null,
    copied: new Set(), // award keys whose justification has been copied this session
    views: { expenses: { page: 0, filter: '' }, dictionary: { page: 0, filter: '' }, awards: { page: 0, filter: '' }, systems: { page: 0, filter: '' } },
    templateRow: null,
    templateView: 'builder',
    previewAward: null,
    filename: defaultFilename(),
  },
};

const main = () => $('#step');

// ------------------------------------------------------------- tables

const fileOf = (name) => state.files[TABLES[name].file];
const table = (name) => fileOf(name)?.tables[name] ?? null;
const usable = (name) => Boolean(table(name) && !table(name).error && !fileOf(name).error);
const ready = () => usable('expenses') && usable('dictionary');

const headerGrid = (name) => [COLUMNS[name].map((c) => c.name)];

const hasRows = (t) => {
  const { headerIndex } = tableLayout(t.grid, []);
  return t.grid.slice(headerIndex + 1).some((row) => row?.some((v) => cellText(v) !== ''));
};

const rebuild = () => {
  for (const name of Object.keys(TABLES)) {
    const t = table(name);
    if (!t) continue;
    try {
      t.records = readTable(t.grid, COLUMNS[name], TABLES[name].title.toLowerCase());
      t.error = null;
    } catch (err) {
      t.records = null;
      t.error = err.message;
    }
  }
  const records = (name) => (usable(name) ? table(name).records : []);
  const report = buildReport({
    expenses: records('expenses'),
    dictionary: records('dictionary'),
    awards: records('awards'),
    templates: records('templates'),
    systems: records('systems'),
  });
  state.warnings = report.warnings.filter((w) => w.area === 'report' || usable(w.area));
  if (!ready()) {
    state.report = null;
    return;
  }
  // All run, so missing codes and awards are added, and unneeded ones removed, in one pass.
  const changed = [addMissingCodes(report.unmapped), addMissingAwards(report.awardsSeen), removeUnneededRows(report)];
  if (changed.some(Boolean)) return rebuild();
  // Keep an edit only while its draft is unchanged, so a new dictionary or
  // template never hides behind an old edit.
  const generated = new Map();
  for (const account of report.accounts) {
    for (const award of account.awards) {
      generated.set(award.key, award.justification);
      if (state.generated.has(award.key) && state.generated.get(award.key) !== award.justification) {
        // The draft changed: an edit to the old draft is dropped, and a copy of it is out of date.
        state.edits.delete(award.key);
        state.ui.copied.delete(award.key);
      }
    }
  }
  for (const key of [...state.edits.keys()]) if (!generated.has(key)) state.edits.delete(key);
  state.generated = generated;
  state.report = report;
};

/** Writes one cell, adding the column to the header if the sheet lacks it. */
const setCell = (name, index, column, value) => {
  const t = table(name);
  const { headerIndex, positions } = tableLayout(t.grid, COLUMNS[name]);
  let position = positions[column];
  if (position === undefined) {
    const header = t.grid[headerIndex];
    position = header.length;
    header.push(column);
  }
  if (!t.grid[index]) t.grid[index] = [];
  const row = t.grid[index];
  while (row.length < position) row.push('');
  row[position] = value;
};

const addRow = (name, values) => {
  const t = table(name);
  const { headerIndex } = tableLayout(t.grid, COLUMNS[name]);
  t.grid.push(Array(t.grid[headerIndex].length).fill(''));
  const index = t.grid.length - 1;
  for (const [column, value] of Object.entries(values)) setCell(name, index, column, value);
  return index;
};

/** The grid index of the first row whose columns match `where`, or -1. */
const findRow = (name, where) => {
  const t = table(name);
  const { headerIndex, positions } = tableLayout(t.grid, COLUMNS[name]);
  for (let r = headerIndex + 1; r < t.grid.length; r++) {
    const row = t.grid[r] ?? [];
    const matches = Object.entries(where).every(([column, value]) => {
      const cell = column in positions ? cellText(row[positions[column]]) : '';
      return cell.toUpperCase() === value.toUpperCase();
    });
    if (matches) return r;
  }
  return -1;
};

/**
 * Adds a Cost codes row for each code in the expenses that has none, filled in
 * as far as possible, so the person only has to give its category. Returns
 * whether any were added.
 */
const addMissingCodes = (unmapped) => {
  let added = false;
  for (const u of unmapped) {
    if (!u.code) continue;
    if (findRow('dictionary', { CostCode: u.code, DrawAccount: '', Sponsor: '', Award: '' }) !== -1) continue;
    // Another row for the same code (for another account or sponsor) may already describe it.
    const known = (table('dictionary').records ?? []).find((r) => cellText(r.CostCode).toUpperCase() === u.code.toUpperCase() && cellText(r.Description));
    addRow('dictionary', { CostCode: u.code, Description: known ? cellText(known.Description) : '' });
    state.autoAdded.dictionary.add(u.code.toUpperCase());
    added = true;
  }
  if (added) fileOf('dictionary').dirty = true;
  return added;
};

/** Adds an Awards row for each award in the expenses that has none, with its sponsor and draw account. */
const addMissingAwards = (seen) => {
  if (!usable('awards')) return false;
  const missing = seen.filter((a) => !a.listed);
  for (const a of missing) {
    addRow('awards', { Award: a.award, Sponsor: a.sponsor, DrawAccount: a.account });
    state.autoAdded.awards.add(a.award.toUpperCase());
  }
  if (missing.length) fileOf('awards').dirty = true;
  return missing.length > 0;
};

/**
 * Takes away rows Quick Draw added that are no longer needed: a code or award
 * that has left the expenses, whose row is still unfilled. A row someone has
 * filled in is theirs, and stays. Returns whether any were removed.
 */
const removeUnneededRows = (report) => {
  let removed = false;
  const unmapped = new Set(report.unmapped.map((u) => u.code.toUpperCase()));
  for (const code of [...state.autoAdded.dictionary]) {
    if (unmapped.has(code)) continue;
    state.autoAdded.dictionary.delete(code);
    const index = findRow('dictionary', { CostCode: code, DrawAccount: '', Sponsor: '', Award: '', BudgetCategory: '' });
    if (index !== -1) {
      table('dictionary').grid.splice(index, 1);
      removed = true;
    }
  }
  const seen = new Set(report.awardsSeen.map((a) => a.award.toUpperCase()));
  for (const award of [...state.autoAdded.awards]) {
    if (seen.has(award)) continue;
    state.autoAdded.awards.delete(award);
    const index = findRow('awards', { Award: award, Goal: '', Template: '' });
    if (index !== -1) {
      table('awards').grid.splice(index, 1);
      removed = true;
    }
  }
  return removed;
};

/** Grid rows still waiting for a value: cost codes without a BudgetCategory, awards without a Goal. */
const waitingRows = (name = 'dictionary') => {
  const rows = new Set();
  if (!usable(name)) return rows;
  for (const record of table(name).records) {
    const waiting =
      name === 'dictionary'
        ? cellText(record.CostCode) && !cellText(record.Award) && !cellText(record.BudgetCategory)
        : cellText(record.Award) && !cellText(record.Goal);
    if (waiting) rows.add(record.row - 1);
  }
  return rows;
};


const markDirty = (name) => {
  fileOf(name).dirty = true;
  updateSaveBar(TABLES[name].file);
};

/**
 * Redraws the current tab, keeping the cursor, selection and scroll where they
 * were. Skipped while a table cell holds typing not yet saved, so nothing is lost.
 */
const redrawKeepingPlace = () => {
  const active = document.activeElement;
  if (active?.matches?.('table.data input') && active.value !== active.defaultValue) return false;
  const label = active?.getAttribute?.('aria-label');
  const selection = [active?.selectionStart, active?.selectionEnd];
  const scrolled = [...document.querySelectorAll('.table-scroll')].map((node) => node.scrollLeft);
  const y = window.scrollY;
  RENDERERS[state.ui.tab]();
  document.querySelectorAll('.table-scroll').forEach((node, i) => (node.scrollLeft = scrolled[i] ?? 0));
  window.scrollTo(0, y);
  const again = label && [...main().querySelectorAll('[aria-label]')].find((node) => node.getAttribute('aria-label') === label);
  if (again) {
    again.focus({ preventScroll: true });
    try {
      again.setSelectionRange(...selection);
    } catch {
      // Not a text field.
    }
  }
  return true;
};

const TABLE_TABS = new Set(['expenses', 'dictionary']);

let rebuildTimer;
/**
 * After an edit in a table: mark its file changed, rebuild, and redraw so the
 * highlights match the rows as they are now. Adding or deleting rows redraws at
 * once (rows below move, so old highlights would land on the wrong ones); a
 * changed cell redraws a moment later. Returns true when it redrew.
 */
const edited = (name, kind) => {
  markDirty(name);
  clearTimeout(rebuildTimer);
  const refresh = () => {
    rebuild();
    renderNav();
    // Only the table tabs redraw; the Templates editor keeps its own state while you type.
    return TABLE_TABS.has(state.ui.tab) ? redrawKeepingPlace() : false;
  };
  if (kind === 'rows') return refresh();
  rebuildTimer = setTimeout(refresh, 250);
  return false;
};

/** An edit made from the Report tab: write it, rebuild and redraw at once. */
const editAndRedraw = (name, change) => {
  change();
  markDirty(name);
  rebuild();
  render();
};

// -------------------------------------------------------------- files

const readFile = async (key, file, handle = null) => {
  const kind = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
  const entry = { fileName: file.name, kind, original: null, handle, dirty: false, error: null, note: null, tables: {} };
  try {
    const buffer = await file.arrayBuffer();
    const sheets = await readSheets(window.ExcelJS, file.name, buffer);
    if (kind === 'xlsx') entry.original = buffer;
    if (key === 'expenses') {
      const first = sheets[0] ?? { name: 'Expenses', grid: [] };
      entry.tables.expenses = { grid: first.grid, sheetName: first.name };
    } else {
      const found = kind === 'csv' ? { dictionary: 0, awards: -1, templates: -1, systems: -1 } : classifySheets(sheets);
      const added = [];
      for (const name of ['dictionary', 'awards', 'templates', 'systems']) {
        const sheet = sheets[found[name]];
        if (sheet) entry.tables[name] = { grid: sheet.grid, sheetName: sheet.name };
        else {
          entry.tables[name] = { grid: headerGrid(name), sheetName: DICTIONARY_SHEETS[name], added: true };
          added.push(DICTIONARY_SHEETS[name]);
        }
      }
      if (found.dictionary === -1) entry.error = 'No sheet has CostCode and BudgetCategory columns.';
      if (added.length && kind === 'xlsx') entry.note = `No ${added.join(' or ')} sheet yet. ${added.length > 1 ? 'They are' : 'It is'} added when you save.`;
    }
  } catch (err) {
    entry.error = err.message;
  }
  state.files[key] = entry;
  rebuild();
  render();
};

const PICKER_TYPES = [{ description: 'Excel or CSV', accept: { 'text/csv': ['.csv'], [XLSX_TYPE]: ['.xlsx'] } }];

const chooseFile = async (key) => {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      await readFile(key, await handle.getFile(), handle);
    } catch (err) {
      if (err.name !== 'AbortError') alert(err.message);
    }
    return;
  }
  const input = el('input', { type: 'file', accept: '.xlsx,.csv' });
  input.addEventListener('change', () => input.files[0] && readFile(key, input.files[0]));
  input.click();
};

const loadSamples = async () => {
  for (const [key, info] of Object.entries(FILES)) {
    const response = await fetch(info.sample);
    await readFile(key, new File([await response.blob()], info.sample.split('/').pop()));
  }
};

const startEmptyDictionary = () => {
  const tables = {};
  for (const name of ['dictionary', 'awards', 'templates', 'systems']) tables[name] = { grid: headerGrid(name), sheetName: DICTIONARY_SHEETS[name] };
  state.files.dictionary = { fileName: 'dictionary.xlsx', kind: 'xlsx', original: null, handle: null, dirty: true, error: null, note: null, tables };
  rebuild();
  render();
};

const fileBytes = async (key) => {
  const file = state.files[key];
  const names = key === 'expenses' ? ['expenses'] : ['dictionary', 'awards', 'templates', 'systems'];
  // A CSV holds one sheet. Once awards or templates are added, the dictionary becomes a workbook.
  if (file.kind === 'csv' && names.slice(1).some((name) => hasRows(file.tables[name]))) {
    file.kind = 'xlsx';
    file.fileName = file.fileName.replace(/\.csv$/i, '') + '.xlsx';
    file.handle = null;
    file.note = `Saved as ${file.fileName}, because a CSV file can’t hold the Awards and Templates sheets.`;
  }
  if (file.kind === 'csv') return new TextEncoder().encode(`﻿${toCsv(file.tables[names[0]].grid)}`);
  const sheets = names.map((name) => ({ name: file.tables[name].sheetName, grid: file.tables[name].grid }));
  // A dictionary workbook carries a Read me sheet explaining itself; added once, never overwritten.
  if (key === 'dictionary') sheets.unshift({ name: README_SHEET, grid: readMeRows(), readMe: true });
  return new Uint8Array(await writeXlsx(window.ExcelJS, sheets, file.original));
};

const saveFile = async (key, asCopy = false) => {
  const file = state.files[key];
  try {
    const bytes = await fileBytes(key);
    const type = file.kind === 'csv' ? 'text/csv' : XLSX_TYPE;
    if (file.handle && !asCopy) {
      const options = { mode: 'readwrite' };
      if ((await file.handle.queryPermission(options)) !== 'granted' && (await file.handle.requestPermission(options)) !== 'granted') {
        throw new Error('Permission to save over the file was not given.');
      }
      const writable = await file.handle.createWritable();
      await writable.write(bytes);
      await writable.close();
    } else {
      downloadBytes(bytes, file.fileName, type);
    }
    if (file.kind === 'xlsx') {
      file.original = bytes.buffer;
      for (const t of Object.values(file.tables)) t.added = false;
      if (!file.note?.startsWith('Saved as')) file.note = null;
    }
    if (!asCopy || !file.handle) file.dirty = false;
    updateSaveBar(key);
    renderNav();
  } catch (err) {
    alert(`The file could not be saved: ${err.message}`);
  }
};

// ---------------------------------------------------------- warnings

const warningNodes = (area) => {
  const items = state.warnings.filter((w) => w.area === area).map((w) => w.text);
  const nodes = [];
  const r = state.report;
  if (items.length) nodes.push(notice('warn', items.length > 1 ? 'Check these' : null, items));
  return nodes.filter(Boolean);
};

const linkTo = (tab, text, then) =>
  el('button', { type: 'button', class: 'link-button', onclick: () => (then?.(), go(tab)) }, text);

// --------------------------------------------------------------- nav

/** Joins tooltip lines, skipping empty ones. */
const tip = (...lines) => lines.filter(Boolean).join('\n');

/** Why the Data dictionary needs attention, for its badges. */
const dictionaryTip = (codes, goals, codeWarnings, awardWarnings) =>
  tip(
    codes && `${plural(codes, 'cost code')} from the expenses ${codes === 1 ? 'has' : 'have'} no budget category, so ${codes === 1 ? 'its' : 'their'} costs are left out. Fill in BudgetCategory on the highlighted ${codes === 1 ? 'row' : 'rows'} of Cost codes, or type ${EXCLUDE}.`,
    goals && `${plural(goals, 'award')} ${goals === 1 ? 'has' : 'have'} no goal. Write one on the highlighted ${goals === 1 ? 'row' : 'rows'} of Awards so the justification says what the money is for.`,
    codeWarnings && `${plural(codeWarnings, 'other problem')} on Cost codes. Open it to read ${codeWarnings === 1 ? 'it' : 'them'}.`,
    awardWarnings && `${plural(awardWarnings, 'other problem')} on Awards. Open it to read ${awardWarnings === 1 ? 'it' : 'them'}.`
  );

const countFor = (area) => state.warnings.filter((w) => w.area === area).length;

const badgeFor = (key) => {
  if (key === 'help') return {};
  const issue = (n, title) => (n ? { badge: String(n), badgeClass: 'warn', title } : {});
  const broken = (message) => ({ badge: '!', badgeClass: 'error', title: tip(message, 'Choose another file on the Files tab.') });
  if (key === 'files') {
    const loaded = Object.keys(FILES).filter((k) => state.files[k] && !state.files[k].error);
    const missing = Object.keys(FILES).filter((k) => !loaded.includes(k)).map((k) => FILES[k].title.toLowerCase());
    return loaded.length === 2
      ? { badge: '✓', badgeClass: 'ok', title: 'Both files are loaded.' }
      : { badge: `${loaded.length}/2`, title: `Still needed: the ${missing.join(' and the ')}. Choose ${missing.length === 1 ? 'it' : 'them'} on this tab.` };
  }
  if (key === 'report') {
    if (!state.report) return {};
    return progressBadge(state.report.accounts);
  }
  if (key === 'expenses') {
    const error = state.files.expenses?.error || table('expenses')?.error;
    if (error) return broken(error);
    const n = countFor('expenses');
    return issue(n, `${plural(n, 'problem')} reading the expenses, such as a cost that isn’t a number. Open this tab to read ${n === 1 ? 'it' : 'them'}; you can fix values in the table.`);
  }
  const file = state.files.dictionary;
  if (!file) return {};
  if (key === 'templates') {
    if (table('templates').error) return broken(table('templates').error);
    const n = countFor('templates');
    return issue(n, `${plural(n, 'problem')} with the templates. Open this tab to read ${n === 1 ? 'it' : 'them'} and fix the wording.`);
  }
  const error = file.error || table('dictionary').error || table('awards').error;
  if (error) return broken(error);
  const parts = [waitingRows().size, waitingRows('awards').size, countFor('dictionary'), countFor('awards')];
  return issue(parts.reduce((a, b) => a + b, 0), dictionaryTip(...parts));
};

const renderNav = () => {
  fill(
    $('#steps'),
    tabStrip(
      STEPS.map((step, i) => ({ key: step.key, label: `${i + 1}. ${step.label}`, ...badgeFor(step.key) })),
      state.ui.tab,
      go,
      { label: 'Steps', className: 'step-tabs' }
    )
  );
};

// Each tab has its own address, such as #requirements or #dictionary/awards,
// so a link opens it directly and Back and Forward move between tabs.
const DICTIONARY_HASH = { dictionary: '', awards: 'awards', systems: 'systems' };

const addressFor = () => {
  const { tab, dictionaryView } = state.ui;
  const sub = tab === 'dictionary' ? DICTIONARY_HASH[dictionaryView] : tab === 'help' && state.ui.helpView !== 'requirements' ? state.ui.helpView : '';
  return `#${tab}${sub ? `/${sub}` : ''}`;
};

/** Reads the tab (and dictionary sheet) from the address. Unknown addresses open Files. */
const fromAddress = () => {
  const [asked, sub] = decodeURIComponent(location.hash.slice(1)).toLowerCase().split('/');
  // Older links used #requirements for the Help tab.
  const tab = asked === 'requirements' ? 'help' : asked;
  state.ui.tab = STEPS.some((step) => step.key === tab) ? tab : 'files';
  if (state.ui.tab === 'help') state.ui.helpView = ['dictionary', 'templates', 'export', 'glossary'].includes(sub) ? sub : 'requirements';
  if (state.ui.tab === 'dictionary') {
    state.ui.dictionaryView = Object.keys(DICTIONARY_HASH).find((view) => DICTIONARY_HASH[view] === (sub ?? '')) ?? 'dictionary';
  }
};

/** Puts the current tab in the address: a new history entry, or replacing the current one. */
const showAddress = (replace = false) => {
  const address = addressFor();
  if (location.hash === address) return;
  if (replace) history.replaceState(null, '', address);
  else history.pushState(null, '', address);
};

const go = (tab) => {
  state.ui.tab = tab;
  showAddress();
  render();
  main().focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
};

window.addEventListener('popstate', () => {
  fromAddress();
  showAddress(true);
  render();
});

const nextButton = (tab) => {
  const next = STEPS[STEPS.findIndex((s) => s.key === tab) + 1];
  if (!next) return null;
  return el('div', { class: 'next' }, el('button', { type: 'button', class: 'button', onclick: () => go(next.key) }, `Next: ${next.label} →`));
};

// ------------------------------------------------------------ files tab

const fileSummary = (key) => {
  const file = state.files[key];
  if (key === 'expenses') return plural(table('expenses').records?.length ?? 0, 'row');
  const count = (name, one, many) => plural(file.tables[name].records?.length ?? 0, one, many);
  return `${count('dictionary', 'cost code row')}, ${count('awards', 'award')}, ${count('templates', 'template')}, ${count('systems', 'payment system')}`;
};

const renderFiles = () => {
  const slot = (key) => {
    const info = FILES[key];
    const file = state.files[key];
    const tableError = file && !file.error && Object.keys(file.tables).map((n) => file.tables[n].error).find(Boolean);
    const status = !file
      ? el('p', { class: 'status muted' }, 'No file yet')
      : file.error || tableError
        ? el('p', { class: 'status error-text' }, `${file.fileName}: ${file.error || tableError}`)
        : el('p', { class: 'status ok' }, `✓ ${file.fileName}: ${fileSummary(key)}`);
    const card = el(
      'div',
      {
        class: `file-slot ${file ? (file.error || tableError ? 'failed' : 'loaded') : ''}`,
        title: file && (file.error || tableError) ? `${file.error || tableError}\nFix the file and choose it again, or choose another.` : null,
      },
      el('h3', {}, info.title),
      el('p', { class: 'muted small' }, info.about),
      el(
        'div',
        { class: 'slot-actions' },
        el('button', { type: 'button', class: 'button small', onclick: () => chooseFile(key) }, file ? 'Choose another' : 'Choose file'),
        info.canStartEmpty && !file ? el('button', { type: 'button', class: 'link-button', onclick: startEmptyDictionary }, 'or start an empty one') : null,
        key === 'expenses' ? el('button', { type: 'button', class: 'link-button', onclick: () => openGuide('export') }, 'What to export') : null
      ),
      status,
      file?.note ? el('p', { class: 'muted small' }, file.note) : null
    );
    card.addEventListener('dragover', (event) => {
      event.preventDefault();
      card.classList.add('drag');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag'));
    card.addEventListener('drop', async (event) => {
      event.preventDefault();
      card.classList.remove('drag');
      const item = [...event.dataTransfer.items].find((i) => i.kind === 'file');
      if (!item) return;
      const handle = item.getAsFileSystemHandle ? await item.getAsFileSystemHandle().catch(() => null) : null;
      const picked = handle?.kind === 'file' ? await handle.getFile() : item.getAsFile();
      readFile(key, picked, handle?.kind === 'file' ? handle : null);
    });
    return card;
  };

  fill(
    main(),
    el('h2', {}, 'Choose your two files'),
    el(
      'p',
      { class: 'lead' },
      'HHS now requires a short justification with every payment request in PMS. Quick Draw drafts them from your expenses. ',
      el('button', { type: 'button', class: 'link-button', onclick: () => go('help') }, 'What the requirement says'),
      '.'
    ),
    el('p', { class: 'muted' }, 'Choose each file, or drag it onto its box. Your files are read in this browser and never uploaded.'),
    el('div', { class: 'file-grid' }, Object.keys(FILES).map(slot)),
    el('p', { class: 'muted' }, 'Just looking? ', el('button', { type: 'button', class: 'link-button', onclick: loadSamples }, 'Load the sample files'), ', which are made up.'),
    ready() ? nextButton('files') : null
  );
};

// ------------------------------------------------------- table tabs

const saveBar = (key) => el('div', { class: 'save-bar', id: `save-${key}` });

const updateSaveBar = (key) => {
  const bar = $(`#save-${key}`);
  const file = state.files[key];
  if (!bar || !file) return;
  const canSaveOver = Boolean(file.handle);
  // While there is something to save, the bar stays pinned in view as you scroll.
  bar.classList.toggle('unsaved', file.dirty);
  fill(
    bar,
    el('span', { class: 'file-name' }, file.fileName),
    file.dirty
      ? el(
          'span',
          {
            class: 'badge warn',
            title: canSaveOver
              ? 'Your changes are only in this page until you save. Save writes them to the file you opened.'
              : 'Your changes are only in this page until you save. This browser can only save a copy (to your Downloads); Chrome and Edge can save over the file.',
          },
          'Unsaved changes'
        )
      : el('span', { class: 'muted small' }, 'All changes saved'),
    el(
      'span',
      { class: 'save-actions' },
      canSaveOver
        ? [
            el('button', { type: 'button', class: 'button small', disabled: !file.dirty, onclick: () => saveFile(key) }, 'Save'),
            el('button', { type: 'button', class: 'button small secondary', onclick: () => saveFile(key, true) }, 'Save a copy'),
          ]
        : el(
            'button',
            { type: 'button', class: 'button small', onclick: () => saveFile(key, true), title: `Downloads ${file.fileName} with your changes.` },
            `Save a copy (downloads ${file.fileName})`
          )
    ),
    file.note
      ? el('p', { class: 'muted small save-note' }, file.note)
      : !canSaveOver && file.dirty
        ? el(
            'p',
            { class: 'muted small save-note' },
            'Changes are kept only once saved. Safari and Firefox don’t let web pages save over a file, so this saves a copy to your Downloads; use it in place of the old one. In Chrome or Edge, open the file with Choose file, and Save writes over it directly.'
          )
        : null
  );
};

const missingFile = (title) => [el('h2', {}, title), el('p', { class: 'empty' }, 'No file yet. ', linkTo('files', 'Choose one on the Files tab'), '.')];

const brokenFile = (title, fileName, message) => [
  el('h2', {}, title),
  notice('error', `${fileName} could not be used`, [message], el('p', {}, linkTo('files', 'Choose another file'), '.')),
];

const tableView = (name, flagged = new Map()) => {
  const holder = el('div', { class: 'table-holder' });
  renderDataTable(holder, {
    name,
    table: table(name),
    columns: COLUMNS[name],
    columnHelp: COLUMN_HELP[name],
    view: state.ui.views[name],
    flagged,
    onEdit: (kind) => edited(name, kind),
  });
  return holder;
};

const renderExpenses = () => {
  const file = state.files.expenses;
  if (!file) return fill(main(), ...missingFile('Expenses'));
  const t = table('expenses');
  if (file.error || t.error) return fill(main(), ...brokenFile('Expenses', file.fileName, file.error || t.error));
  const flagged = new Map();
  if (state.report) {
    const missing = new Set(state.report.unmapped.map((u) => u.code.toUpperCase()));
    for (const record of t.records) {
      const code = cellText(record.CostCode);
      if (missing.has(code.toUpperCase())) flagged.set(
          record.row - 1,
          `Cost code ${code || '(blank)'} is not in the dictionary, so this cost is left out. Give it a budget category on the Data dictionary tab.`
        );
    }
  }
  fill(
    main(),
    el('h2', {}, 'Expenses'),
    el(
      'p',
      { class: 'lead' },
      'Check the expenses read correctly. You can fix a value here; it changes this copy, which you can save. ',
      el('button', { type: 'button', class: 'link-button', onclick: () => openGuide('export') }, 'What the export should contain'),
      '.'
    ),
    saveBar('expenses'),
    el('div', { id: 'tab-warnings', dataset: { area: 'expenses' } }, warningNodes('expenses')),
    tableView('expenses', flagged),
    nextButton('expenses')
  );
  updateSaveBar('expenses');
};

/** Where a Cost codes row applies, worked out from its DrawAccount, Sponsor and Award. */
const codeRowScope = (index) => {
  const t = table('dictionary');
  const { positions } = tableLayout(t.grid, COLUMNS.dictionary);
  const get = (column) => (column in positions ? cellText(t.grid[index]?.[positions[column]]) : '');
  if (get('Award')) return { text: `Award: ${get('Award')} (description only)`, kind: 'award' };
  if (get('DrawAccount')) return { text: `Draw account: ${get('DrawAccount')}`, kind: 'account' };
  if (get('Sponsor')) return { text: `Sponsor: ${get('Sponsor')}`, kind: 'sponsor' };
  return { text: 'Everywhere', kind: 'general' };
};

const DICTIONARY_VIEWS = {
  dictionary: {
    label: 'Cost codes',
    intro: 'Each row gives a cost code its sponsor budget category and a plain-language description. A code can have more than one row; Applies to shows where each is used.',
  },
  awards: {
    label: 'Awards',
    intro:
      'One row per award: its sponsor and draw account (used when the expenses don’t give them), a short goal that templates write with {{ goal }}, and, if it should not use its account’s usual wording, the Name of its template.',
  },
  systems: {
    label: 'Payment systems',
    intro:
      'Where payment requests go, and the link each award’s Open button uses on the Report tab. Leave DrawAccount and Sponsor blank for the system most awards use; add a row for a sponsor or account that draws somewhere else, such as NSF in Research.gov.',
  },
};

const renderDictionary = () => {
  const file = state.files.dictionary;
  if (!file) return fill(main(), ...missingFile('Data dictionary'));
  if (file.error) return fill(main(), ...brokenFile('Data dictionary', file.fileName, file.error));
  const view = state.ui.dictionaryView;
  const t = table(view);
  const flagged = new Map();
  for (const w of state.warnings) if (w.area === view && w.row) flagged.set(w.row - 1, w.text);
  fill(
    main(),
    el('h2', {}, 'Data dictionary'),
    saveBar('dictionary'),
    tabStrip(
      Object.entries(DICTIONARY_VIEWS).map(([key, v]) => ({ key, label: v.label, ...badgeForView(key) })),
      view,
      (key) => {
        state.ui.dictionaryView = key;
        showAddress();
        renderDictionary();
      },
      { label: 'Dictionary sheets', className: 'sub-tabs' }
    ),
    el(
      'div',
      { class: 'lead-with-help' },
      el('p', { class: 'lead' }, DICTIONARY_VIEWS[view].intro),
      el(
        'button',
        { type: 'button', class: 'help-button', 'aria-label': 'How the data dictionary works', title: 'How the data dictionary works', onclick: () => openGuide('codes') },
        '?'
      )
    ),
    t.error
      ? notice('error', `The ${DICTIONARY_VIEWS[view].label} sheet can’t be used`, [t.error])
      : [
          waitingHint(view),
          el('div', { id: 'tab-warnings', dataset: { area: view } }, warningNodes(view)),
          view === 'dictionary' ? codesTable(flagged) : view === 'awards' ? awardsTable(flagged) : tableView(view, flagged),
        ],
    el('div', { id: 'next-area' }, nextButton('dictionary'))
  );
  updateSaveBar('dictionary');
};

/** One line above a table when rows are waiting for a value. */
const waitingHint = (view = 'dictionary') => {
  const n = waitingRows(view).size;
  if (!n) return null;
  const text =
    view === 'dictionary'
      ? `${n === 1 ? 'The highlighted cost code is' : `${n} highlighted cost codes are`} in the expenses but ${n === 1 ? 'has' : 'have'} no budget category yet. Fill in its BudgetCategory, or type ${EXCLUDE} to leave its costs out on purpose.`
      : `${n === 1 ? 'The highlighted award has' : `${n} highlighted awards have`} no goal yet. Write a few words on what ${n === 1 ? 'it is' : 'each is'} for; justifications use it.`;
  return el('p', { class: 'waiting-hint', dataset: { view }, title: 'Point at a highlighted row for the details. You can keep going without filling them in; the Report tab warns before you copy anything they affect.' }, text);
};

/** The Awards table, with awards waiting for a goal pinned to the top. */
const awardsTable = (flagged) => {
  const holder = el('div', { class: 'table-holder' });
  const names = (state.report?.templates ?? []).map((t) => t.label);
  const { positions } = tableLayout(table('awards').grid, COLUMNS.awards);
  for (const index of waitingRows('awards')) {
    const award = cellText(table('awards').grid[index]?.[positions.Award]);
    flagged.set(index, `${award} has no goal. Write a few words in Goal on what the award is for; justifications use it with {{ goal }}.`);
  }
  renderDataTable(holder, {
    name: 'awards',
    table: table('awards'),
    columnHelp: COLUMN_HELP.awards,
    columns: COLUMNS.awards,
    view: state.ui.views.awards,
    flagged,
    pinned: waitingRows('awards'),
    needs: 'Goal',
    suggest: new Map([['Template', names]]),
    onEdit: (kind) => edited('awards', kind),
  });
  return holder;
};

/** The Cost codes table, with rows waiting for a category pinned to the top. */
const codesTable = (flagged) => {
  const holder = el('div', { class: 'table-holder' });
  const categories = new Set();
  for (const record of table('dictionary').records ?? []) {
    const category = cellText(record.BudgetCategory);
    if (category) categories.add(category);
  }
  // Each waiting row explains itself, with the dollars behind it, when you point at it.
  const waiting = waitingRows();
  for (const index of waiting) {
    const code = cellText(table('dictionary').grid[index]?.[tableLayout(table('dictionary').grid, COLUMNS.dictionary).positions.CostCode]);
    flagged.set(index, `${code} has no budget category, so its costs are left out. Type one in BudgetCategory (it suggests yours), or ${EXCLUDE} to leave them out on purpose.`);
  }
  for (const u of state.report?.unmapped ?? []) {
    const index = findRow('dictionary', { CostCode: u.code, DrawAccount: '', Sponsor: '', Award: '' });
    if (waiting.has(index)) {
      flagged.set(
        index,
        `${u.code} is in the expenses (${formatMoney(u.cents)} on ${u.awards.join(', ')}) but has no budget category, so those costs are left out. Type one in BudgetCategory (it suggests yours), or ${EXCLUDE} to leave them out on purpose.`
      );
    }
  }
  renderDataTable(holder, {
    name: 'dictionary',
    table: table('dictionary'),
    columnHelp: COLUMN_HELP.dictionary,
    appliesTo: codeRowScope,
    columns: COLUMNS.dictionary,
    view: state.ui.views.dictionary,
    flagged,
    pinned: waiting,
    needs: 'BudgetCategory',
    suggest: new Map([['BudgetCategory', [...[...categories].sort(), EXCLUDE]]]),
    onEdit: (kind) => edited('dictionary', kind),
  });
  return holder;
};

const badgeForView = (key) => {
  const waiting = waitingRows(key).size;
  const n = countFor(key) + waiting;
  if (!n) return {};
  const title = key === 'dictionary' ? dictionaryTip(waiting, 0, countFor(key), 0) : dictionaryTip(0, waiting, 0, countFor(key));
  return { badge: String(n), badgeClass: 'warn', title };
};

const renderTemplatesTab = () => {
  const file = state.files.dictionary;
  if (!file) return fill(main(), ...missingFile('Templates'));
  if (file.error) return fill(main(), ...brokenFile('Templates', file.fileName, file.error));
  const t = table('templates');
  const holder = el('div');
  fill(
    main(),
    el('h2', {}, 'Templates'),
    el('p', { class: 'lead' }, 'Write the justification once, with blanks that Quick Draw fills in for each award. Templates are kept on the Templates sheet of the data dictionary.'),
    saveBar('dictionary'),
    t.error ? notice('error', 'The Templates sheet can’t be used', [t.error]) : holder,
    nextButton('templates')
  );
  updateSaveBar('dictionary');
  if (t.error) return;
  const accounts = new Set();
  const sponsors = new Set();
  for (const record of table('expenses')?.records ?? []) {
    if (cellText(record.DrawAccount)) accounts.add(cellText(record.DrawAccount));
    if (cellText(record.Sponsor)) sponsors.add(cellText(record.Sponsor));
  }
  renderTemplates(holder, {
    table: t,
    report: state.report,
    ui: state.ui,
    warnings: state.warnings.filter((w) => w.area === 'templates'),
    accounts: [...accounts].sort(),
    sponsors: [...sponsors].sort(),
    setCell: (index, column, value) => setCell('templates', index, column, value),
    addRow: (values) => addRow('templates', values),
    deleteRow: (index) => t.grid.splice(index, 1),
    onEdit: () => edited('templates'),
  });
};

// ------------------------------------------------------------ report tab

/** Saves an award's goal to the Awards sheet. */
const saveGoal = (award, goal) =>
  editAndRedraw('awards', () => {
    const index = findRow('awards', { Award: award });
    if (index === -1) addRow('awards', { Award: award, Goal: goal });
    else setCell('awards', index, 'Goal', goal);
  });

/** Saves which template an award uses (blank for its account's usual one) on the Awards sheet. */
const saveTemplateChoice = (award, name) =>
  editAndRedraw('awards', () => {
    const index = findRow('awards', { Award: award });
    if (index === -1) addRow('awards', { Award: award, Template: name });
    else setCell('awards', index, 'Template', name);
  });

/** Saves (or clears) an award's own description of a code, on the Cost codes sheet. */
const saveCodeDescription = (award, code, description) =>
  editAndRedraw('dictionary', () => {
    const index = findRow('dictionary', { CostCode: code, Award: award });
    if (index !== -1 && !description) table('dictionary').grid.splice(index, 1);
    else if (index !== -1) setCell('dictionary', index, 'Description', description);
    else if (description) addRow('dictionary', { CostCode: code, Award: award, Description: description });
  });

const keepEdits = (award) =>
  !state.edits.has(award.key) || confirm(`This redrafts the ${award.award} justification and replaces your edits to it. Continue?`);

/** The award's costs as a table: each code on its own row, grouped by budget category. */
const costTable = (award) => {
  const editing = state.ui.describing.has(award.key);
  const description = (code) => {
    if (!editing) return code.description || el('span', { class: 'muted' }, '—');
    const input = el('input', {
      type: 'text',
      value: code.awardDescription,
      placeholder: code.generalDescription || 'No description',
      'aria-label': `${award.award}'s description of ${code.code}`,
    });
    input.addEventListener('change', () => {
      if (keepEdits(award)) saveCodeDescription(award.award, code.code, input.value.trim());
      else input.value = code.awardDescription;
    });
    return input;
  };
  const rows = award.categories.flatMap((c) => [
    ...c.codes.map((code, i) =>
      el(
        'tr',
        { class: i === 0 ? 'group-start' : null },
        i === 0 ? el('th', { scope: 'rowgroup', rowSpan: c.codes.length, class: 'category' }, c.name) : null,
        el('td', { class: 'code' }, code.code),
        el('td', { class: `description${editing ? ' editing' : ''}` }, description(code)),
        el('td', { class: 'amount' }, formatMoney(code.cents))
      )
    ),
    c.codes.length > 1
      ? el('tr', { class: 'subtotal' }, el('td', { colSpan: 3 }, `${c.name} total`), el('td', { class: 'amount' }, formatMoney(c.cents)))
      : null,
  ]);
  return el(
    'div',
    { class: 'costs-scroll' },
    el(
      'table',
      { class: 'costs' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { scope: 'col' }, 'Budget category'),
          el('th', { scope: 'col' }, 'Cost code'),
          el('th', { scope: 'col' }, 'Description'),
          el('th', { scope: 'col', class: 'amount' }, 'Amount')
        )
      ),
      el('tbody', {}, rows),
      el('tfoot', {}, el('tr', {}, el('td', { colSpan: 3 }, 'Total'), el('td', { class: 'amount' }, formatMoney(award.totalCents))))
    )
  );
};

/** A chart that draws itself once its card is open, since a hidden chart can't measure its width. */
const costChart = (award) => {
  const node = el('div', { class: 'cost-chart', role: 'img', 'aria-label': `Bar chart of ${award.award}'s costs by budget category. The table beside it has the same numbers.` });
  node.draw = () => drawCostChart(node, award).catch((err) => (node.textContent = err.message));
  return node;
};

/**
 * What to check before an award's justification is used, each as { text, fix }.
 * Empty when it is ready.
 */
const problemsWith = (account, award) => {
  const text = state.edits.get(award.key) ?? award.justification;
  const max = award.template?.maxLength;
  const problems = [];
  if (award.error) {
    problems.push({ text: 'The template has a problem, so there is no justification.', fix: `Open the template on the Templates tab; the message under it says what to fix. (${award.error})` });
  } else if (!text.trim()) {
    problems.push({ text: 'The justification is empty.', fix: 'Pick a template for this award, or type the justification yourself.' });
  }
  if (award.missing) {
    const codes = award.missing.codes.join(', ');
    problems.push({
      text: `${formatMoney(award.missing.cents)} in ${codes} is not in the dictionary, so it is left out of the totals.`,
      fix: `Give ${codes} a budget category on the Data dictionary tab (its row is highlighted there), or type ${EXCLUDE} if these costs should be left out.`,
    });
  }
  if (text.includes(GOAL_MARKER)) {
    problems.push({ text: `It still says “${GOAL_MARKER}”.`, fix: 'Type a few words on what this award is for in the Goal field above. It is saved to the dictionary’s Awards sheet.' });
  }
  if (max && text.length > max) {
    problems.push({
      text: `It is ${text.length} characters, over the ${max}-character limit.`,
      fix: 'Shorten the text here, or pick a shorter template for this award.',
    });
  }
  return problems;
};

const sponsorLabel = (sponsor) => sponsor || 'No sponsor';
const remaining = (accounts) => accounts.reduce((n, a) => n + a.awards.filter((w) => !state.ui.copied.has(w.key)).length, 0);
const progressBadge = (accounts) => {
  const left = remaining(accounts);
  return left
    ? { badge: String(left), badgeClass: 'warn', title: `${plural(left, 'award')} not copied yet. Open each one, check its justification, and press Copy.` }
    : { badge: '✓', badgeClass: 'ok', title: 'Every justification here has been copied.' };
};

const copyJustification = async (account, award) => {
  const problems = problemsWith(account, award);
  if (problems.length && !confirm(`Before you copy ${award.award}:\n\n${problems.map((p) => `• ${p.text}\n  ${p.fix}`).join('\n')}\n\nCopy it anyway?`)) return;
  const text = state.edits.get(award.key) ?? award.justification;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Some browsers only allow copying from a selection.
    const area = $('#justification');
    area.select();
    if (!document.execCommand('copy')) return alert('Copying was blocked. Select the text and press Ctrl+C or Cmd+C.');
  }
  state.ui.copied.add(award.key);
  renderReport();
};

/**
 * The button that opens where this account's payment requests go, from the
 * Payment systems sheet. A dictionary without that sheet links to PMS.
 */
const systemLink = (account) => {
  const listed = state.report.paymentSystems.length > 0;
  const system = account.paymentSystem ?? (listed ? null : { name: 'PMS', url: PAYMENT_SYSTEMS[0].url });
  if (!system) return null;
  return el(
    'a',
    {
      class: 'button secondary',
      href: system.url,
      target: '_blank',
      rel: 'noopener',
      title: `Open ${system.name} in a new tab, to paste the justification. Set where each account draws on the Payment systems sheet of the data dictionary.`,
    },
    `Open ${system.name} ↗`
  );
};

/** One award: its justification, goal, costs and chart. */
const awardPanel = (account, award) => {
  const area = el('textarea', { class: 'justification', id: 'justification', rows: 5 });
  area.value = state.edits.get(award.key) ?? award.justification;
  const count = el('span', { class: 'count' });
  const reset = el('button', { type: 'button', class: 'button small secondary' }, 'Undo my edits');
  const copied = state.ui.copied.has(award.key);
  const copy = el('button', { type: 'button', class: 'button', onclick: () => copyJustification(account, award) }, copied ? 'Copy again' : 'Copy');
  const problems = el('ul', { class: 'problems' });

  const update = () => {
    const text = area.value;
    const max = award.template?.maxLength;
    count.textContent = max ? `${text.length} / ${max} characters` : `${text.length} characters`;
    count.classList.toggle('over', Boolean(max) && text.length > max);
    reset.hidden = !state.edits.has(award.key);
    fill(problems, problemsWith(account, award).map((p) => el('li', { title: p.fix }, p.text)));
    count.title = count.classList.contains('over') ? 'Over the payment system’s limit. Shorten the text, or pick a shorter template for this award.' : '';
  };
  area.addEventListener('input', () => {
    if (area.value === award.justification) state.edits.delete(award.key);
    else state.edits.set(award.key, area.value);
    state.ui.copied.delete(award.key);
    update();
  });
  reset.addEventListener('click', () => {
    state.edits.delete(award.key);
    area.value = award.justification;
    update();
  });

  const goal = el('input', { type: 'text', id: 'goal', value: award.goal, placeholder: 'A few words on what this award is for' });
  goal.addEventListener('change', () => {
    if (keepEdits(award)) saveGoal(award.award, goal.value.trim());
    else goal.value = award.goal;
  });

  const automatic = state.report.templates.find((t) => t.row === award.template?.automaticRow) ?? account.template;
  const picker = el(
    'select',
    {
      id: 'template-pick',
      onchange: (event) => {
        const name = event.target.value === 'auto' ? '' : state.report.templates.find((t) => String(t.row) === event.target.value)?.label ?? '';
        if (keepEdits(award)) saveTemplateChoice(award.award, name);
        else event.target.value = award.template?.chosen ? String(award.template.row) : 'auto';
      },
    },
    el('option', { value: 'auto', selected: !award.template?.chosen }, automatic ? `${automatic.label} (the account’s usual)` : 'None'),
    state.report.templates.map((t) => el('option', { value: String(t.row), selected: Boolean(award.template?.chosen) && award.template.row === t.row }, t.label))
  );

  const chart = costChart(award);
  const describing = state.ui.describing.has(award.key);
  const panel = el(
    'div',
    { class: 'award-panel level-panel', role: 'tabpanel' },
    el(
      'p',
      { class: 'award-line' },
      el('strong', {}, award.award),
      ` · ${formatMoney(award.totalCents)}`,
      award.start !== null ? ` · ${formatDay(award.start)} – ${formatDay(award.end)}` : '',
      copied ? el('span', { class: 'copied' }, '✓ Copied') : null
    ),
    award.error ? notice('error', null, [award.error], el('p', {}, linkTo('templates', 'Fix the template'), '.')) : null,
    award.fallback
      ? el(
          'p',
          {
            class: 'fallback-note',
            title: 'The template’s Fallback setting picks the shorter template. Change it on the Templates tab.',
          },
          `${award.fallback.from} came to ${award.fallback.length.toLocaleString()} characters, over the ${award.fallback.limit.toLocaleString()} limit, so the shorter ${award.fallback.to} template was used.`
        )
      : null,
    el('div', { class: 'goal-field' }, el('label', { for: 'goal' }, 'Goal'), goal),
    el(
      'div',
      { class: 'goal-field' },
      el('label', { for: 'template-pick' }, 'Template'),
      picker,
      award.template ? linkTo('templates', 'Edit', () => (state.ui.templateRow = award.template.row - 1)) : null
    ),
    el('label', { class: 'field-label', for: 'justification' }, 'Justification'),
    area,
    el(
      'div',
      { class: 'editor-bar' },
      count,
      el(
        'span',
        { class: 'editor-actions' },
        reset,
        systemLink(account),
        copy
      )
    ),
    problems,
    el(
      'div',
      { class: 'breakdown' },
      el('div', {}, el('h3', { class: 'breakdown-title' }, 'Costs'), costTable(award)),
      el('div', {}, el('h3', { class: 'breakdown-title' }, 'Costs by budget category'), chart)
    ),
    el(
      'button',
      {
        type: 'button',
        class: 'link-button small describe-toggle',
        onclick: () => {
          if (describing) state.ui.describing.delete(award.key);
          else state.ui.describing.add(award.key);
          renderReport();
        },
      },
      describing ? 'Done editing descriptions' : 'Describe these codes differently for this award'
    )
  );
  update();
  requestAnimationFrame(() => chart.draw());
  return panel;
};

/** One level of the report: a labeled row of folder tabs over the panel it opens. */
const level = (depth, label, tabs, content) =>
  el(
    'div',
    { class: `report-level depth-${depth}` },
    el('div', { class: 'level-head' }, el('span', { class: 'level-label' }, label), tabs),
    depth === 3 ? content : el('div', { class: 'level-panel' }, content)
  );

const renderReport = () => {
  const report = state.report;
  if (!report) {
    const missing = Object.keys(FILES).filter((key) => !state.files[key] || state.files[key].error).map((key) => FILES[key].title.toLowerCase());
    return fill(
      main(),
      el('h2', {}, 'Report'),
      el('p', { class: 'empty' }, missing.length ? `The report needs both files. Still needed: ${missing.join(' and ')}. ` : 'A file has a problem. ', linkTo('files', 'Go to Files'), '.')
    );
  }
  if (report.accounts.length === 0) {
    return fill(main(), el('h2', {}, 'Report'), notice('error', 'No costs map to the dictionary', ['Check that the CostCode values in the expenses match the dictionary.']));
  }

  // Sponsor › draw account › award, each its own row of tabs.
  const sponsors = [...new Set(report.accounts.map((a) => a.sponsor))].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)));
  if (!sponsors.includes(state.ui.sponsor)) state.ui.sponsor = sponsors[0];
  const accounts = report.accounts.filter((a) => a.sponsor === state.ui.sponsor);
  if (!accounts.some((a) => a.key === state.ui.account)) state.ui.account = accounts[0].key;
  const account = accounts.find((a) => a.key === state.ui.account);
  if (!account.awards.some((w) => w.key === state.ui.award)) {
    state.ui.award = (account.awards.find((w) => !state.ui.copied.has(w.key)) ?? account.awards[0]).key;
  }
  const award = account.awards.find((w) => w.key === state.ui.award);

  const choose = (key, value) => {
    state.ui[key] = value;
    renderReport();
  };

  // Always shown, even for one sponsor, so the three levels read as a hierarchy.
  const sponsorTabs = tabStrip(
    sponsors.map((s) => ({ key: s, label: sponsorLabel(s), ...progressBadge(report.accounts.filter((a) => a.sponsor === s)) })),
    state.ui.sponsor,
    (value) => choose('sponsor', value),
    { label: 'Sponsors', className: 'folder-tabs' }
  );
  const accountTabs = tabStrip(
    accounts.map((a) => ({ key: a.key, label: a.label, ...progressBadge([a]) })),
    account.key,
    (value) => choose('account', value),
    { label: 'Draw accounts', className: 'folder-tabs' }
  );
  const awardTabs = tabStrip(
    account.awards.map((w) => {
      const done = state.ui.copied.has(w.key);
      const issues = problemsWith(account, w).length;
      return {
        key: w.key,
        label: w.award,
        badge: done ? '✓' : issues ? '!' : null,
        badgeClass: done ? 'ok' : 'warn',
        title: done
          ? 'Copied. Edit it or press Copy again if something changes.'
          : issues
            ? tip('Check before copying:', ...problemsWith(account, w).map((p) => `• ${p.text} ${p.fix}`))
            : 'Ready to copy.',
      };
    }),
    award.key,
    (value) => choose('award', value),
    { label: 'Awards', className: 'folder-tabs' }
  );

  const filename = el('input', { type: 'text', id: 'filename', value: state.ui.filename, spellcheck: false });
  filename.addEventListener('input', () => (state.ui.filename = filename.value));
  const reportWarnings = state.warnings.filter((w) => w.area === 'report').map((w) => w.text);
  const dictionaryChanged = state.files.dictionary?.dirty;

  fill(
    main(),
    el('h2', {}, 'Report'),
    el('p', { class: 'lead' }, 'Open each award, check its justification, and copy it into the payment system. Tabs count the awards left to copy.'),
    reportWarnings.length ? notice('warn', null, reportWarnings) : null,
    // Sponsor › draw account › award, each a row of folder tabs over a panel holding the next level.
    level(
      1,
      'Sponsor',
      sponsorTabs,
      level(2, 'Draw account', accountTabs, level(3, 'Award', awardTabs, awardPanel(account, award)))
    ),
    el(
      'section',
      { class: 'download' },
      el('h3', {}, 'Download the report'),
      el('p', { class: 'muted small' }, 'A workbook with one sheet per draw account and every justification as it reads now.'),
      el(
        'div',
        { class: 'download-row' },
        el('label', { for: 'filename', class: 'visually-hidden' }, 'File name'),
        filename,
        el('button', { type: 'button', class: 'button', onclick: downloadWorkbook }, 'Download')
      ),
      dictionaryChanged
        ? el(
            'p',
            { class: 'muted small' },
            'The dictionary has unsaved changes. ',
            el('button', { type: 'button', class: 'link-button', onclick: () => saveFile('dictionary', !state.files.dictionary.handle) }, 'Save it'),
            ' to keep them for next time.'
          )
        : null
    )
  );
};

// Charts take their colors from the page, so redraw them when light or dark mode changes.
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (state.ui.tab === 'report') renderReport();
});

const downloadWorkbook = async () => {
  const report = state.report;
  const missing = report.unmapped.reduce((sum, u) => sum + u.cents, 0);
  const notes = [];
  if (report.unmapped.length) {
    notes.push(`${formatMoney(missing)} in ${plural(report.unmapped.length, 'cost code')} (${report.unmapped.map((u) => u.code).join(', ')}) is not in the dictionary, so it is left out.`);
  }
  const unfinished = report.accounts.flatMap((a) => a.awards.filter((w) => (state.edits.get(w.key) ?? w.justification).includes(GOAL_MARKER)).map((w) => w.award));
  if (unfinished.length) notes.push(`${plural(unfinished.length, 'justification still says', 'justifications still say')} “${GOAL_MARKER}”: ${unfinished.join(', ')}.`);
  if (notes.length && !confirm(`Before you download:\n\n• ${notes.join('\n• ')}\n\nDownload anyway?`)) return;
  try {
    const workbook = buildWorkbook(window.ExcelJS, report, (_, award) => state.edits.get(award.key) ?? award.justification, {
      expensesFile: state.files.expenses?.fileName,
      dictionaryFile: state.files.dictionary?.fileName,
    });
    let name = state.ui.filename.trim().replace(/[\\/:*?"<>|]+/g, '-') || defaultFilename();
    if (!/\.xlsx$/i.test(name)) name += '.xlsx';
    downloadBytes(await workbook.xlsx.writeBuffer(), name, XLSX_TYPE);
  } catch (err) {
    alert(`The workbook could not be made: ${err.message}`);
  }
};

// -------------------------------------------------------------- render

// The Help tab gathers every guide, each with its own address (#help/dictionary and so on).
const HELP_VIEWS = {
  requirements: { label: 'Requirements', guide: 'about' },
  dictionary: { label: 'Data dictionary', guide: 'codes' },
  templates: { label: 'Templates', guide: 'templates' },
  export: { label: 'Exporting', guide: 'export' },
  glossary: { label: 'Glossary', guide: 'glossary' },
};

const renderHelp = () => {
  if (!HELP_VIEWS[state.ui.helpView]) state.ui.helpView = 'requirements';
  const holder = el('div', { class: 'help-hub' });
  fill(
    main(),
    el('h2', {}, 'Help'),
    tabStrip(
      Object.entries(HELP_VIEWS).map(([key, v]) => ({ key, label: v.label })),
      state.ui.helpView,
      (key) => {
        state.ui.helpView = key;
        showAddress();
        renderHelp();
      },
      { label: 'Help topics', className: 'sub-tabs' }
    ),
    holder
  );
  renderGuidePage(holder, HELP_VIEWS[state.ui.helpView].guide);
};

const RENDERERS = {
  help: renderHelp,
  files: renderFiles,
  expenses: renderExpenses,
  dictionary: renderDictionary,
  templates: renderTemplatesTab,
  report: renderReport,
};

const render = () => {
  renderNav();
  RENDERERS[state.ui.tab]();
};

installTooltips();
$('#glossary-link').addEventListener('click', () => openGuide('glossary'));

window.addEventListener('beforeunload', (event) => {
  const unsaved = Object.values(state.files).some((f) => f?.dirty) || state.edits.size > 0 || state.ui.templateDrafts?.size > 0;
  if (unsaved) event.preventDefault();
});

fromAddress();
showAddress(true);
render();
