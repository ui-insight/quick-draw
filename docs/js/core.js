// Quick Draw core: reads the three tables, rolls costs up by budget category
// and drafts each award's justification. Pure functions, no DOM, so the same
// code runs in the browser and under `node --test`.

import { TemplateError, compile } from './jinja.js';
import { writeLoop } from './loopsyntax.js';

export const GOAL_MARKER = "[describe the award's goal]";

/** A BudgetCategory of "Exclude" leaves a code's costs out on purpose, such as unallowable costs. */
export const EXCLUDE = 'Exclude';
export const isExcluded = (category) => /^(exclude|excluded)$/i.test(category.trim());
export const NO_ACCOUNT = 'No draw account';
export const UNMAPPED_SHEET = 'Unmapped codes';

export const COLUMNS = {
  expenses: [
    { name: 'Award', required: true },
    { name: 'CostCode', required: true },
    { name: 'Cost', required: true },
    { name: 'DrawAccount' },
    { name: 'Sponsor' },
    { name: 'CostDate' },
  ],
  dictionary: [
    { name: 'CostCode', required: true },
    { name: 'BudgetCategory', required: true },
    { name: 'Description' },
    { name: 'DrawAccount' },
    { name: 'Sponsor' },
    { name: 'Award' },
  ],
  awards: [
    { name: 'Award', required: true },
    { name: 'DrawAccount' },
    { name: 'Sponsor' },
    { name: 'Program' },
    { name: 'Goal' },
    { name: 'Template' },
  ],
  accounts: [
    { name: 'DrawAccount' },
    { name: 'PaymentSystem' },
    { name: 'URL' },
    { name: 'Template' },
  ],
  sponsors: [
    { name: 'Sponsor' },
    { name: 'Template' },
  ],
  templates: [
    { name: 'Name' },
    { name: 'Template', required: true },
    { name: 'MaxLength' },
    { name: 'Fallback' },
  ],
};


// ---------------------------------------------------------------- reading

/** Header names match without regard to case, spaces or punctuation. */
export const headerKey = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** Matching key for codes, awards and accounts: trimmed, case-insensitive. */
const idKey = (value) => value.trim().toUpperCase();

/** A cell as trimmed text. Dates become YYYY-MM-DD. */
export const cellText = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return isoDay(dayNumber(value));
  return String(value).trim();
};

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF line ends. */
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
};

const isBlankRow = (row) => row.every((cell) => cellText(cell) === '');

/**
 * Where a table's header row is and which grid column holds each named
 * column: { headerIndex, positions }. headerIndex is -1 for an empty grid.
 */
export const tableLayout = (grid, columns) => {
  const headerIndex = grid.findIndex((row) => row && !isBlankRow(row));
  const positions = {};
  if (headerIndex === -1) return { headerIndex, positions };
  const header = grid[headerIndex].map(headerKey);
  for (const column of columns) {
    const index = header.indexOf(headerKey(column.name));
    if (index !== -1) positions[column.name] = index;
  }
  return { headerIndex, positions };
};

/**
 * Turns a grid (first non-blank row is the header) into records keyed by the
 * canonical column names. Each record's `row` is its 1-based row in the grid.
 * Throws when a required column is missing.
 */
export const readTable = (grid, columns, label) => {
  const { headerIndex, positions } = tableLayout(grid, columns);
  if (headerIndex === -1) throw new Error(`The ${label} file is empty.`);
  const missing = columns.filter((c) => c.required && !(c.name in positions)).map((c) => c.name);
  if (missing.length > 0) {
    const list = missing.join(', ');
    throw new Error(
      `The ${label} file is missing the column${missing.length > 1 ? 's' : ''} ${list}. ` +
        `Its first row should hold the column names.`
    );
  }
  const records = [];
  for (let r = headerIndex + 1; r < grid.length; r++) {
    const row = grid[r];
    if (!row || isBlankRow(row)) continue;
    const record = { row: r + 1 };
    for (const [name, index] of Object.entries(positions)) record[name] = row[index] ?? null;
    records.push(record);
  }
  return records;
};

/** Default sheet names for the parts of the data dictionary workbook. */
export const DICTIONARY_SHEETS = { dictionary: 'Cost codes', awards: 'Awards', accounts: 'Draw accounts', sponsors: 'Sponsors', templates: 'Templates' };
/** The dictionary's tables, in the order its sheets are saved. */
export const DICTIONARY_TABLES = Object.keys(DICTIONARY_SHEETS);

/**
 * Which sheet of a data dictionary workbook holds what, by its columns and
 * then its name. Returns { dictionary, awards, accounts, sponsors, templates },
 * each a sheet index or -1. Other sheets are left alone. Older workbooks'
 * Payment systems sheet counts as Draw accounts.
 */
export const classifySheets = (sheets) => {
  const found = Object.fromEntries(DICTIONARY_TABLES.map((name) => [name, -1]));
  const headers = sheets.map(({ grid }) => {
    const row = grid.find((r) => r && !isBlankRow(r)) ?? [];
    return new Set(row.map(headerKey));
  });
  const claim = (part, test) => {
    if (found[part] !== -1) return;
    const index = sheets.findIndex((sheet, i) => !Object.values(found).includes(i) && test(headers[i], sheet.name.toLowerCase()));
    if (index !== -1) found[part] = index;
  };
  // Awards, Draw accounts and Sponsors all have a Template column (naming one), so the
  // Templates sheet is the one with a Template column and its own Name, MaxLength or Fallback,
  // or with nothing else to say whose it is.
  const isTemplates = (h) => h.has('template') && !h.has('award') && (h.has('name') || h.has('maxlength') || h.has('fallback') || (!h.has('sponsor') && !h.has('drawaccount')));
  claim('dictionary', (h) => h.has('costcode') && h.has('budgetcategory'));
  claim('awards', (h) => h.has('award') && !h.has('costcode') && !h.has('budgetcategory'));
  claim('templates', isTemplates);
  claim('accounts', (h) => h.has('drawaccount') && (h.has('paymentsystem') || h.has('url')) && !h.has('award') && !h.has('costcode'));
  claim('accounts', (h) => h.has('url') && h.has('name') && !h.has('template'));
  claim('sponsors', (h) => h.has('sponsor') && h.has('template') && !h.has('drawaccount') && !h.has('award') && !h.has('costcode'));
  claim('templates', (h, name) => name.includes('template'));
  claim('awards', (h, name) => name.includes('award'));
  claim('dictionary', (h, name) => name.includes('code') || name.includes('dictionary'));
  claim('accounts', (h, name) => name.includes('account') || name.includes('payment') || name.includes('system'));
  claim('sponsors', (h, name) => name.includes('sponsor'));
  return found;
};

/** CSV text for a grid. Dates are written as YYYY-MM-DD. */
export const toCsv = (grid) =>
  grid
    .map((row) =>
      (row ?? [])
        .map((value) => {
          const text = typeof value === 'string' ? value : cellText(value);
          return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(',')
    )
    .join('\r\n') + '\r\n';

// ----------------------------------------------------------- values

/** Dollars to integer cents. Accepts $, commas, (negatives) and a bare dash for zero. */
export const parseCents = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }
  let text = String(value).trim().replace(/[$,\s]/g, '');
  if (text === '' || text === '-') return 0;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (/^-?\d*\.?\d+$/.test(text) || /^-?\d+\.$/.test(text)) {
    const cents = Math.round(Number(text) * 100);
    return negative ? -cents : cents;
  }
  return null;
};

const DAY_MS = 86400000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Days since 1970-01-01 for a Date, read in UTC (how workbook dates arrive). */
const dayNumber = (date) => Math.floor(date.getTime() / DAY_MS);

const fromParts = (year, month, day) => {
  if (year < 100) year += 2000;
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return time / DAY_MS;
};

/** A date cell to a day number, or null when blank. Returns NaN when unreadable. */
export const parseDay = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? NaN : dayNumber(value);
  if (typeof value === 'number') {
    // An Excel serial date that arrived without a date format.
    if (value > 1 && value < 2958466) return Math.floor(value) - 25569;
    return NaN;
  }
  const text = String(value).trim();
  if (text === '') return null;
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (m) return fromParts(+m[1], +m[2], +m[3]) ?? NaN;
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:\s.*)?$/);
  if (m) return fromParts(+m[3], +m[1], +m[2]) ?? NaN;
  m = text.match(/^(\d{1,2})[- ]([a-z]{3})[a-z]*[- ,]+(\d{2}|\d{4})$/i);
  if (m) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1;
    if (month > 0) return fromParts(+m[3], month, +m[1]) ?? NaN;
  }
  return NaN;
};

const isoDay = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** A day number as MM/DD/YYYY. */
export const formatDay = (day) => {
  if (day === null || day === undefined) return '';
  const [y, m, d] = isoDay(day).split('-');
  return `${m}/${d}/${y}`;
};

/** Cents as 1,234.56 (no dollar sign). */
export const formatAmount = (cents) => {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-US');
  return `${sign}${whole}.${String(abs % 100).padStart(2, '0')}`;
};

/** Cents as $1,234.56, or -$1,234.56. */
export const formatMoney = (cents) =>
  cents < 0 ? `-$${formatAmount(-cents)}` : `$${formatAmount(cents)}`;

// -------------------------------------------------------- categories

/**
 * A key that ignores case, spacing, punctuation, dash style, "&" versus "and"
 * and a plural "s", so near-identical category names collide.
 */
export const categoryKey = (name) =>
  name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith('s') ? word.slice(0, -1) : word))
    .join(' ');

/** Groups of two or more category names that differ only cosmetically. */
export const similarCategories = (names) => {
  const groups = new Map();
  for (const name of new Set(names)) {
    const key = categoryKey(name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(name);
  }
  return [...groups.values()].filter((group) => group.length > 1).map((group) => group.sort());
};

// ---------------------------------------------------------- templates

/** What each template value means, for the builder and the help. */
export const FIELDS = {
  award: { label: 'Award', example: 'AWD-1001', help: 'The award identifier.' },
  account: { label: 'Draw account', example: 'ACCT-A', help: 'The draw account. Blank when the expenses have none.' },
  sponsor: { label: 'Sponsor', example: 'Sponsor A', help: "The award's sponsor. Blank when neither the expenses nor the Awards sheet say." },
  start: { label: 'Start date', example: '07/03/2026', help: 'The earliest CostDate, as MM/DD/YYYY. Blank without dates.' },
  end: { label: 'End date', example: '08/14/2026', help: 'The latest CostDate, as MM/DD/YYYY. Blank without dates.' },
  total: { label: 'Total', example: '11,764.55', help: 'All mapped costs, with no dollar sign.' },
  costs: {
    label: 'All costs as text',
    example: 'Fringe Benefits $2,604.00, Travel $612.45',
    help: 'Every category and its amount, joined by commas. A shortcut for the category loop.',
  },
  descriptions: {
    label: 'All descriptions as text',
    example: 'employee benefits; project travel',
    help: 'The dictionary descriptions of the codes behind the costs, joined by semicolons.',
  },
  program: {
    label: 'Program name',
    example: 'Homeless Veterans’ Reintegration Program',
    help: 'The award’s program, from the Program column of the Awards sheet. Some agencies, such as DOL, ask for it. Blank if none.',
  },
  goal: {
    label: "Award's goal",
    example: 'mapping groundwater recharge in the upper basin',
    help: `The award's Goal from the Awards sheet. Without one, the marker ${'"'}[describe the award's goal]${'"'}, for you to replace.`,
  },
};

export const LIST_FIELDS = {
  categories: {
    label: 'Categories',
    help: 'One entry per budget category, in alphabetical order.',
    item: 'c',
    fields: {
      name: { label: 'Category name', example: 'Travel' },
      amount: { label: 'Category amount', example: '612.45', help: 'No dollar sign.' },
      codes: { label: "Category's cost codes", help: 'A list. Loop over it with {% for code in c.codes %}.' },
    },
  },
  codes: {
    label: 'Cost codes',
    help: 'One entry per cost code with costs on the award, across all categories.',
    item: 'code',
    fields: {
      code: { label: 'Cost code', example: 'C200' },
      amount: { label: 'Code amount', example: '612.45', help: 'No dollar sign.' },
      description: { label: 'Code description', example: 'project travel', help: 'Blank when the dictionary has none.' },
      category: { label: "Code's category", example: 'Travel' },
    },
  },
};

/** Advice shown when a loop variable is used outside its loop. */
export const TEMPLATE_HINTS = {
  c: 'c only exists between {% for c in categories %} and {% endfor %}.',
  code: 'code only exists between {% for code in c.codes %} (or {% for code in codes %}) and {% endfor %}.',
  loop: 'loop only exists inside a {% for %} loop.',
};

const OLD_STYLE = new RegExp(`(^|[^{])\\{\\s*(${Object.keys(FIELDS).join('|')})\\s*\\}(?!\\})`, 'i');

/** Compiles a template, returning { render } or { error }. */
export const compileTemplate = (text) => {
  try {
    const compiled = compile(text, TEMPLATE_HINTS);
    return {
      render(values) {
        try {
          return { text: compiled.render(values) };
        } catch (err) {
          if (err instanceof TemplateError) return { error: err };
          throw err;
        }
      },
    };
  } catch (err) {
    if (err instanceof TemplateError) return { error: err };
    throw err;
  }
};

/** A note when a template uses single braces, which are plain text in Jinja. */
export const singleBraceNote = (text) => {
  const m = text.match(OLD_STYLE);
  return m ? `{${m[2]}} is plain text. Write {{ ${m[2]} }} to fill in the value.` : null;
};

/** The values a template sees for one award. */
export const templateValues = (award, account, sponsor = '') => {
  const categories = award.categories.map((c) => ({
    name: c.name,
    amount: formatAmount(c.cents),
    codes: c.codes.map((code) => ({
      code: code.code,
      amount: formatAmount(code.cents),
      description: code.description,
    })),
  }));
  const codes = award.categories.flatMap((c) =>
    c.codes.map((code) => ({
      code: code.code,
      amount: formatAmount(code.cents),
      description: code.description,
      category: c.name,
    }))
  );
  const descriptions = [];
  for (const code of codes) {
    if (code.description && !descriptions.includes(code.description)) descriptions.push(code.description);
  }
  return {
    award: award.award,
    account,
    sponsor,
    program: award.program ?? '',
    start: formatDay(award.start),
    end: formatDay(award.end),
    total: formatAmount(award.totalCents),
    costs: award.categories.map((c) => `${c.name} ${formatMoney(c.cents)}`).join(', '),
    descriptions: descriptions.join('; '),
    goal: award.goal || GOAL_MARKER,
    categories,
    codes,
  };
};

/** Made-up values so the template builder has something to preview without data. */
export const exampleValues = () =>
  templateValues(
    {
      award: 'AWD-1001',
      start: parseDay('2026-07-03'),
      end: parseDay('2026-08-14'),
      totalCents: 1176455,
      categories: [
        { name: 'Fringe Benefits', cents: 260400, codes: [{ code: 'C110', cents: 260400, description: 'employee benefits' }] },
        { name: 'Materials & Supplies', cents: 14810, codes: [{ code: 'C300', cents: 14810, description: 'lab and field supplies' }] },
        { name: 'Salaries & Wages', cents: 840000, codes: [{ code: 'C100', cents: 840000, description: 'personnel salaries' }] },
        { name: 'Travel', cents: 61245, codes: [{ code: 'C200', cents: 61245, description: 'project travel' }] },
      ],
    },
    'ACCT-A',
    'Sponsor A'
  );

/** What each column means, shown when you point at its heading. */
export const COLUMN_HELP = {
  accounts: {
    DrawAccount: 'The payment-system account. Leave it blank on one row to give the payment system for every account not listed.',
    PaymentSystem: 'Where this account requests payment: PMS, ASAP, Research.gov, WAWF or another. Blank uses the row with DrawAccount blank, else PMS.',
    URL: 'The link its Open button goes to. Only needed for a system other than PMS, ASAP, Research.gov or WAWF.',
    Template: 'Optional. The template every award in this account uses, instead of its sponsor’s or the default. An award’s own Template still comes first.',
  },
  sponsors: {
    Sponsor: 'The sponsor, as it appears in the expenses or on the Awards sheet. Leave it blank on one row: that row’s Template is the default for everyone.',
    Template: 'The template this sponsor’s awards use, unless their draw account or the award names one. On the row with Sponsor blank, the default template.',
  },
  expenses: {
    Award: 'The award or grant this cost belongs to.',
    CostCode: 'Your institution’s expense or object code. The data dictionary turns it into a budget category.',
    Cost: 'The dollar amount. Negative amounts (credits) reduce the total.',
    DrawAccount: 'The payment-system account the award draws from. Optional: the Awards sheet can supply it.',
    Sponsor: 'The sponsor the draw account belongs to. Optional: the Awards sheet can supply it.',
    CostDate: 'When the cost happened. The earliest and latest dates become the period in the justification.',
  },
  dictionary: {
    CostCode: 'The cost code, exactly as it appears in the expenses.',
    BudgetCategory: `The sponsor budget category this code is totaled under, such as Travel. Type ${EXCLUDE} to leave the code’s costs out on purpose. Leave blank on a row that names an Award.`,
    Description: 'What the code pays for, in words a sponsor would understand. Templates can include it.',
    DrawAccount: 'Fill in only to make this row apply to one draw account, when that account categorizes the code differently.',
    Sponsor: 'Fill in only to make this row apply to one sponsor’s accounts, when that sponsor categorizes the code differently.',
    Award: 'Fill in, with a Description, to describe this code differently for one award. The row’s category is not used.',
  },
  awards: {
    Award: 'The award or grant, exactly as it appears in the expenses.',
    Sponsor: 'The award’s sponsor. Used when the expenses don’t say.',
    DrawAccount: 'The payment-system account the award draws from. Used when the expenses don’t say.',
    Goal: 'A few words on what the award is for. Templates write it with {{ goal }}.',
    Template: 'Optional. The template this award uses, ahead of its draw account’s, its sponsor’s and the default. The Template menu on the Report sets it too.',
  },
};


// ---------------------------------------------------- standard templates

/** A list in a sentence: "A and B", or "A, B, and C". */
const listOf = (item, target = 'c', iter = 'categories') => writeLoop({ target, iter, item, between: ', ', beforeLast: 'and ' });

/** A category with the descriptions of its codes in parentheses, skipping blank and repeated ones. */
const CATEGORY_WITH_PURPOSE =
  '{{ c.name }}{% if c.codes | map("description") | select %} ({{ c.codes | map("description") | select | unique | join(", ") }}){% endif %}';

const DATES = (lead) => `{% if start %}${lead}{{ start }} through {{ end }}{% endif %}`;

/**
 * Templates shaped by the agencies' stated requirements, not by what the
 * engine can do. The sample dictionary and the editor's "Start from" buttons
 * both use these.
 */
export const STANDARD_TEMPLATES = [
  {
    name: 'HHS and NIH',
    label: 'HHS / NIH',
    source: 'HHS Payment Justification Guidance (2026): the cost or activity, how it supports the award, and when it was incurred, in plain language.',
    text: `Payment for ${listOf(CATEGORY_WITH_PURPOSE)}${DATES(' incurred ')} to support {{ goal }} under award {{ award }}.`,
    maxLength: 1000,
    fallback: 'HHS and NIH, short',
  },
  {
    name: 'HHS and NIH, short',
    label: 'HHS / NIH short',
    source: 'The same requirements with categories only, used when the full version is over the limit.',
    text: `Payment for ${listOf('{{ c.name }}')}${DATES(' incurred ')} to support {{ goal }} under award {{ award }}.`,
    maxLength: 1000,
  },
  {
    name: 'DOL VETS',
    label: 'DOL VETS',
    source: 'DOL VETS Grant Officer’s Memorandum 02-26 (2026): the program, the date range, and each budget category with its amount, adding up to the total.',
    text: `These funds are for expenditures under the {{ program | default("award " ~ award) }}${DATES(', for the period ').replace(' through ', ' to ')}, for ${listOf('{{ c.name | lower }} (${{ c.amount }})')} as outlined in the grant award.`,
    maxLength: 1000,
  },
  {
    name: 'NASA',
    label: 'NASA',
    source: 'NASA Grant Information Circular 25-01 (2025): how much is requested, the approved budget categories, and why.',
    text: `Payment of \${{ total }} is requested for ${listOf('{{ c.name }} (${{ c.amount }})')} in accordance with the pre-approved budget categories of award {{ award }}, to support {{ goal }}.`,
    maxLength: 1000,
  },
];

// ------------------------------------------------------------ glossary

/** What the terms in Quick Draw mean. The Help tab, the Glossary window and the Read me sheet all use this. */
export const GLOSSARY = [
  ['Award', 'A grant or cooperative agreement, identified by its award number. Each award is one row group in the expenses and one tab on the Report.'],
  ['Subaccount', 'In PMS, the account for one award under a recipient’s draw account. HHS asks for a justification for each subaccount.'],
  ['Draw account', 'The payment-system account an award draws its funds from; in PMS, the account its subaccount sits under. Groups awards on the Report.'],
  ['Sponsor', 'The organization funding the award, such as NIH. Several draw accounts can share a sponsor.'],
  ['Payment system', 'Where payment requests are made, such as PMS, ASAP or Research.gov. Each draw account belongs to one, set on the Draw accounts sheet; one sponsor can use several.'],
  ['PMS', 'The HHS Payment Management System. Since March 17, 2025, each payment request in it needs a justification of up to 1,000 characters.'],
  ['Drawdown', 'A request for award funds from the payment system, usually to reimburse costs already paid.'],
  ['Defend the Spend', 'The review system where agencies approve, question or reject each payment request and its justification.'],
  ['Justification', 'The short statement sent with a payment request saying what the money is for and how it relates to the award.'],
  ['Expenses file', 'An export from your financial system with one row per expense: award, cost code, amount and, ideally, date.'],
  ['Data dictionary', 'The Excel workbook you keep for Quick Draw, with its Cost codes, Awards, Draw accounts, Sponsors and Templates sheets.'],
  ['Cost code', 'Your institution’s code for a kind of expense, also called an object or expense code.'],
  ['Budget category', 'The sponsor’s budget line a cost is reported under, such as Travel or Fringe Benefits.'],
  ['Description', 'Plain words for what a cost code pays for. An award can have its own description of a code.'],
  ['Exclude', 'A budget category that leaves a code’s costs out of every total, for costs that can’t be drawn down.'],
  ['Unmapped code', 'A cost code in the expenses that the dictionary doesn’t list. Its costs are left out until it gets a budget category.'],
  ['Goal', 'A few words on what an award is for, kept on the Awards sheet. Templates write it with {{ goal }}.'],
  ['Program', 'An award’s program name, for agencies that ask for it, such as DOL.'],
  ['Template', 'A justification’s wording with blanks that Quick Draw fills in for each award.'],
  ['Standard template', 'A template shaped by an agency’s stated requirements: HHS and NIH, DOL VETS or NASA.'],
  ['Default template', 'The template every award uses unless the award, its draw account or its sponsor names another. Set on the Sponsors sheet, on the row with Sponsor blank.'],
  ['Fallback template', 'A shorter template used automatically for an award whose justification would run over the character limit.'],
  ['Character limit', 'The most characters a payment system accepts in a justification; 1,000 in PMS.'],
  ['Value', 'A blue block in a template, such as Award or Total, that Quick Draw fills in for each award.'],
  ['Loop', 'A green block that writes the same words for each item in a list, such as each budget category.'],
  ['Condition', 'A purple block that writes its words only when something is there, such as dates.'],
  ['Jinja', 'The template language Quick Draw’s templates are written in; the Jinja view shows it.'],
];

// ------------------------------------------------------------ read me

export const README_SHEET = 'Read me';

/**
 * The Read me sheet of a data dictionary workbook, as rows of [term, meaning].
 * A row with only a term is a heading. Quick Draw ignores this sheet when it
 * reads the workbook; it is there for people.
 */
export const readMeRows = () => {
  const rows = [];
  const heading = (text) => rows.push([text, '']);
  const row = (term, meaning) => rows.push([term, meaning]);
  const gap = () => rows.push(['', '']);
  const fieldRows = (fields, prefix = '') =>
    Object.entries(fields).forEach(([name, f]) =>
      row(`{{ ${prefix}${name} }}`, [f.label, f.help, f.example ? `Example: ${f.example}` : ''].filter(Boolean).join('. ').replace(/\.\./g, '.'))
    );

  heading('Quick Draw data dictionary');
  row('What this workbook is', 'Everything Quick Draw needs besides your expenses: what budget category each cost code belongs to, what each award is for, and how each justification should read. Keep it, edit it, and bring it back each time you use Quick Draw.');
  row('Where it is used', 'Open Quick Draw in a browser, choose your expenses file and this workbook. Nothing is uploaded; the files are read on your computer.');
  gap();

  heading('The sheets and what they are for');
  row('Cost codes', 'Maps each of your institution’s cost codes to a sponsor budget category, with a plain-language description. This is how expenses are grouped and totaled.');
  row('Awards', 'One row per award: its draw account and sponsor, a short goal saying what the award is for, and optionally its template.');
  row('Draw accounts', 'Each draw account’s payment system, such as PMS or ASAP, and optionally the template its awards use.');
  row('Sponsors', 'The template each sponsor’s awards use. The row with Sponsor blank gives the default template for everyone.');
  row('Templates', 'The wording of the justification, with blanks that Quick Draw fills in for each award. Keep as many versions as you like.');
  row('Which template an award uses', 'Read the sheets from Awards to Sponsors; the first Template found wins: the award’s own, else its draw account’s, else its sponsor’s, else the default (the Sponsors row with Sponsor blank, or else the first template).');
  row('Read me', 'This sheet. Quick Draw skips it.');
  row('Sheet names', 'Quick Draw finds each sheet by its column names, so you can rename or reorder the sheets. Column names match without regard to case or spaces. Extra columns are ignored.');
  gap();

  heading('Cost codes sheet');
  row('CostCode', 'Required. Your institution’s expense or object code, as it appears in the expenses file.');
  row('BudgetCategory', 'Required, except on a row with an Award. The sponsor budget category the code is totaled under, such as Salaries & Wages.');
  row('Description', 'Optional. What the code covers, in words a sponsor would understand. Templates can include it.');
  row('DrawAccount', 'Optional. Fill in to make the row apply only to awards drawn from that payment-system account. Leave blank otherwise.');
  row('Sponsor', 'Optional. Fill in to make the row apply only to that sponsor’s draw accounts. Leave blank otherwise.');
  row('Award', 'Optional. Fill in, with a Description, to describe the code differently for one award. Its BudgetCategory is not used.');
  row('Which row is used', 'For each expense, Quick Draw uses the row for its draw account if there is one, else the row for its sponsor, else the row with neither. So list a code once with DrawAccount and Sponsor blank, and add a row only where an account or sponsor categorizes it differently.');
  row('Which description is used', 'The award’s own description of the code if there is one, else the description on the most specific row that has one.');
  row('Codes not listed', 'Costs whose code is not on this sheet are left out of the totals. Quick Draw lists them, with their dollars, so you can add them.');
  gap();

  heading('Awards sheet');
  row('Award', 'Required. The award identifier, as it appears in the expenses file.');
  row('DrawAccount', 'Optional. The payment-system account the award draws from. Used when the expenses file doesn’t say; if both say, the expenses win.');
  row('Sponsor', 'Optional. The award’s sponsor. Used when the expenses file doesn’t say; if both say, the expenses win.');
  row('Program', 'Optional. The award’s program name, for agencies that ask for it, such as DOL. Templates write it with {{ program }}.');
  row('Goal', 'A few words on what the award is for, such as “mapping groundwater recharge in the upper basin”. Templates write it with {{ goal }}. Without one, the justification says [describe the award’s goal] until you fill it in.');
  row('Template', 'Optional. The Name of the template this award uses, ahead of its draw account’s and sponsor’s. The Template menu on the Report sets it too.');
  row('Missing awards', 'Awards in the expenses that are not on this sheet are added for you, with their sponsor and draw account filled in, so you only write the goal.');
  gap();

  heading('Draw accounts sheet');
  row('DrawAccount', 'The payment-system account, as in the expenses. Leave it blank on one row to give the payment system for every account not listed.');
  row('PaymentSystem', 'Where the account requests payment, such as PMS, ASAP, Research.gov or WAWF. One sponsor can use several systems, so this goes by account. Blank uses the row with DrawAccount blank, else PMS.');
  row('URL', 'Optional. The link the Open button goes to. Needed only for a system Quick Draw doesn’t know.');
  row('Template', 'Optional. The template every award in this account uses, ahead of its sponsor’s.');
  row('Missing accounts', 'Draw accounts in the expenses that are not on this sheet are added for you.');
  gap();

  heading('Sponsors sheet');
  row('Sponsor', 'The sponsor, as in the expenses or on the Awards sheet. Leave it blank on one row for the default.');
  row('Template', 'The template this sponsor’s awards use. On the row with Sponsor blank, the default template for everyone.');
  row('Missing sponsors', 'Sponsors in the expenses that are not on this sheet are added for you.');
  gap();

  heading('Templates sheet');
  row('Name', 'What to call the template. The Template columns on the other sheets pick it by this name.');
  row('Template', 'Required. The justification text, written in Jinja: {{ value }} fills in a value, and {% for c in categories %} … {% endfor %} repeats text for each budget category.');
  row('MaxLength', 'Optional. The payment system’s character limit. Longer justifications are flagged.');
  row('Fallback', 'Optional. The Name of a shorter template to use for an award whose justification would run over MaxLength.');
  gap();

  heading('Values a template can use');
  fieldRows(FIELDS);
  row('{% for c in categories %}', 'Repeats text for each budget category. Inside: {{ c.name }}, {{ c.amount }}, and the list c.codes.');
  row('{% for code in c.codes %}', 'Inside a category loop, repeats text for each cost code in it. Inside: {{ code.code }}, {{ code.amount }}, {{ code.description }}, {{ code.category }}.');
  row('{% for code in codes %}', 'Repeats text for every cost code on the award, across categories.');
  row('loop.first, loop.last, loop.index', 'Inside a loop: whether this is the first or last item, and its number (1, 2, 3…). {% if not loop.last %}, {% endif %} puts a comma between items.');
  row('{% if … %} … {% endif %}', 'Writes text only when something is true or not blank, such as {% if start %}from {{ start }}{% endif %}.');
  gap();

  heading('Glossary');
  for (const [term, meaning] of GLOSSARY) row(term, meaning);
  return rows;
};

/**
 * The Read me sheet of a downloaded report, as rows of [term, meaning]. `info`
 * has the names of the files it came from and when it was made.
 */
export const reportReadMeRows = (report, { expensesFile = '', dictionaryFile = '', made = new Date() } = {}) => {
  const rows = [];
  const heading = (text) => rows.push([text, '']);
  const row = (term, meaning) => rows.push([term, meaning]);
  const gap = () => rows.push(['', '']);
  const awards = report.accounts.reduce((n, a) => n + a.awards.length, 0);
  const total = report.accounts.reduce((sum, a) => sum + a.awards.reduce((s, w) => s + w.totalCents, 0), 0);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${made.getFullYear()}-${pad(made.getMonth() + 1)}-${pad(made.getDate())} ${pad(made.getHours())}:${pad(made.getMinutes())}`;

  heading('Quick Draw drawdown report');
  row('What this is', 'Drawdown justifications for each award, with its costs rolled up by sponsor budget category, as they read when the report was downloaded.');
  row('Made', stamp);
  if (expensesFile) row('Expenses file', expensesFile);
  if (dictionaryFile) row('Data dictionary', dictionaryFile);
  row('Covers', `${awards} ${awards === 1 ? 'award' : 'awards'} in ${report.accounts.length} draw ${report.accounts.length === 1 ? 'account' : 'accounts'}, ${formatMoney(total)} in all.`);
  gap();

  heading('The sheets');
  row('Read me', 'This sheet.');
  for (const account of report.accounts) {
    const system = account.paymentSystem ? ` (${account.paymentSystem.name})` : '';
    row(account.sheetName, `Draw account ${account.label}${system}: ${account.awards.length} ${account.awards.length === 1 ? 'award' : 'awards'}.`);
  }
  if (report.unmapped.length) {
    row(UNMAPPED_SHEET, 'Cost codes in the expenses that the data dictionary does not list. Their costs are not in any total.');
  }
  gap();

  heading('Reading an account sheet');
  row('One block per award', 'The award number, with its date range beside it, then a table of its sponsor budget categories and amounts, and a Total row.');
  row('Justification', 'In column D beside the table: the justification as it read in Quick Draw when the report was downloaded, including any edits made there.');
  row('Dates', 'The earliest and latest CostDate of the award’s costs in the expenses file.');
  gap();

  heading('What the totals leave out');
  row('Unmapped codes', report.unmapped.length
    ? `${formatMoney(report.unmappedCents)} in ${report.unmapped.length} ${report.unmapped.length === 1 ? 'code' : 'codes'} not in the dictionary: ${report.unmapped.map((u) => u.code).join(', ')}. See the ${UNMAPPED_SHEET} sheet.`
    : 'None. Every cost code in the expenses is in the dictionary.');
  row('Excluded codes', `Costs in codes whose BudgetCategory is ${EXCLUDE} in the dictionary are left out on purpose.`);
  row('Net-zero categories', 'A category whose costs net to $0.00 is not listed.');
  if (report.unmapped.length) {
    gap();
    heading(`Using the ${UNMAPPED_SHEET} sheet`);
    row('To add them', 'Fill in each BudgetCategory, then copy the rows into the Cost codes sheet of your data dictionary. The UnmappedCost, FoundUnder and FoundInAwards columns are for reference; Quick Draw ignores them.');
  }
  gap();

  heading('Before you submit');
  row('Review', 'Check every total and justification against your financial system and the award terms. Quick Draw drafts from the files and templates it was given and is not financial, accounting, legal or compliance advice.');
  return rows;
};

// --------------------------------------------------------- sheet names

const SHEET_NAME_MAX = 31;

/** Excel sheet names: at most 31 characters, none of []:*?/\, unique ignoring case. */
export const makeSheetNamer = (reserved = []) => {
  const used = new Set(reserved.map((name) => name.toLowerCase()));
  return (label) => {
    let base = label
      .replace(/[[\]:*?/\\]/g, '-')
      .replace(/^'+|'+$/g, '')
      .trim();
    if (base === '' || base.toLowerCase() === 'history') base = base ? `${base} (account)` : 'Account';
    base = base.slice(0, SHEET_NAME_MAX);
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, SHEET_NAME_MAX - suffix.length) + suffix;
    }
    used.add(name.toLowerCase());
    return name;
  };
};

// ------------------------------------------------------------- report

const byText = (a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' });

const listSome = (items) =>
  `${items.slice(0, 10).join(', ')}${items.length > 10 ? ` and ${items.length - 10} more` : ''}`;

/**
 * Where a dictionary or template row applies: one draw account, one sponsor,
 * or everywhere. A row with both a DrawAccount and a Sponsor applies to the
 * account.
 */
const scopeKey = (account, sponsor) => (account ? `A:${idKey(account)}` : sponsor ? `S:${idKey(sponsor)}` : 'G:');

const describeScope = (account, sponsor) =>
  account ? ` for draw account ${account}` : sponsor ? ` for sponsor ${sponsor}` : '';

/** The scopes to look in for an expense, most specific first. */
const scopesFor = (account, sponsor) => [account && `A:${idKey(account)}`, sponsor && `S:${idKey(sponsor)}`, 'G:'].filter(Boolean);

const readDictionary = (records, warn) => {
  const mappings = new Map(); // `${SCOPE}\0${CODE}` -> { category, description, row }
  const awardDescriptions = new Map(); // `${AWARD}\0${CODE}` -> description
  const categories = [];
  for (const record of records) {
    const code = cellText(record.CostCode);
    const category = cellText(record.BudgetCategory);
    const description = cellText(record.Description);
    const account = cellText(record.DrawAccount);
    const sponsor = cellText(record.Sponsor);
    const award = cellText(record.Award);
    const where = `Row ${record.row}`;
    if (code === '') {
      warn(`${where} has no CostCode, so it is skipped.`, record.row);
      continue;
    }
    if (award !== '') {
      if (description === '') {
        warn(`${where} names award ${award} but has no Description, so it is skipped.`, record.row);
        continue;
      }
      const key = `${idKey(award)}\0${idKey(code)}`;
      if (awardDescriptions.has(key)) {
        warn(`${where} repeats award ${award} and code ${code}. The first description is used.`, record.row);
      } else {
        awardDescriptions.set(key, description);
      }
      continue;
    }
    // A row still waiting for its category is shown highlighted in the table, not warned about.
    if (category === '') continue;
    const key = `${scopeKey(account, sponsor)}\0${idKey(code)}`;
    const existing = mappings.get(key);
    if (existing) {
      if (existing.category !== category) {
        const scope = describeScope(account, sponsor);
        warn(
          `${where} maps code ${code}${scope} to "${category}", but row ${existing.row} already maps it to "${existing.category}". Row ${existing.row} is used.`,
          record.row
        );
      }
      continue;
    }
    mappings.set(key, { category, description, row: record.row });
    categories.push(category);
  }
  /** The mapping for a code, and the most specific description found for it. */
  const find = (account, sponsor, code) => {
    const found = scopesFor(account, sponsor)
      .map((scope) => mappings.get(`${scope}\0${idKey(code)}`))
      .filter(Boolean);
    return { mapping: found[0] ?? null, description: found.find((m) => m.description)?.description ?? '' };
  };
  return { find, awardDescriptions, categories };
};

/** The Awards sheet: each award's goal, and its sponsor, draw account and template if given. */
const readAwards = (records, warn) => {
  const awards = new Map(); // AWARD -> { goal, sponsor, account, template, row }
  for (const record of records) {
    const award = cellText(record.Award);
    if (award === '') {
      if (cellText(record.Goal)) warn(`Row ${record.row} has a Goal but no Award, so it is skipped.`, record.row);
      continue;
    }
    if (awards.has(idKey(award))) {
      warn(`Row ${record.row} repeats award ${award}. The first row is used.`, record.row);
      continue;
    }
    awards.set(idKey(award), {
      name: award,
      goal: cellText(record.Goal),
      sponsor: cellText(record.Sponsor),
      account: cellText(record.DrawAccount),
      template: cellText(record.Template),
      program: cellText(record.Program),
      row: record.row,
    });
  }
  return awards;
};

/** Payment systems Quick Draw knows, so a Draw accounts row can name one without its link. */
export const KNOWN_SYSTEMS = {
  PMS: 'https://pms.psc.gov/',
  ASAP: 'https://www.asap.gov/',
  'RESEARCH.GOV': 'https://www.research.gov/',
  WAWF: 'https://piee.eb.mil/',
};
const PMS = { name: 'PMS', url: KNOWN_SYSTEMS.PMS };

/** A template's display name: its Name, or "Untitled" until it has one. */
export const templateLabel = (name) => name || 'Untitled';

const readTemplates = (records, warn) => {
  const list = []; // every usable template, in file order
  const labels = new Map();
  for (const record of records) {
    const name = cellText(record.Name);
    const text = cellText(record.Template);
    const where = `Row ${record.row}`;
    // A template with no text yet (one just added) is simply not used.
    if (text === '') continue;
    let maxLength = null;
    const rawMax = cellText(record.MaxLength);
    if (rawMax !== '') {
      const n = Number(rawMax.replace(/,/g, ''));
      if (Number.isInteger(n) && n > 0) maxLength = n;
      else warn(`${where} has MaxLength "${rawMax}", which is not a whole number, so it is ignored.`, record.row);
    }
    let label = templateLabel(name);
    if (labels.has(label.toUpperCase())) label = `${label} (row ${record.row})`;
    labels.set(label.toUpperCase(), true);
    const compiled = compileTemplate(text);
    if (compiled.error) warn(`The "${label}" template has an error. ${compiled.error.message}`, record.row);
    const note = singleBraceNote(text);
    if (note) warn(`The "${label}" template: ${note}`, record.row);
    list.push({ row: record.row, label, name, text, maxLength, compiled, fallbackName: cellText(record.Fallback) });
  }
  /** A template by its Name (or the label it is shown with). */
  const named = (name) => {
    const key = name.trim().toUpperCase();
    return list.find((t) => t.name.toUpperCase() === key) ?? list.find((t) => t.label.toUpperCase() === key) ?? null;
  };
  // A template's Fallback names a shorter one to use when an award runs over the limit.
  for (const template of list) {
    if (!template.fallbackName) continue;
    template.fallback = named(template.fallbackName);
    if (!template.fallback) {
      warn(`The "${template.label}" template's Fallback, "${template.fallbackName}", is not a template on this sheet, so it is ignored.`, template.row);
    } else if (template.fallback === template) {
      template.fallback = null;
      warn(`The "${template.label}" template names itself as its Fallback, so it is ignored.`, template.row);
    }
  }
  return { list, named };
};

/**
 * Looks up a template named in a Template cell. Warns, on that sheet's tab,
 * when no template has that name. Returns the template or null.
 */
const templateNamed = (temps, name, warn, row, who) => {
  if (!name) return null;
  const found = temps.named(name);
  if (!found) warn(`${who} names the template "${name}", which is not on the Templates sheet, so it is ignored.`, row);
  return found;
};

/**
 * The Draw accounts sheet: each account's payment system and, optionally, the
 * template its awards use. A row with DrawAccount blank gives the system for
 * every account not listed. Payment systems go by account, not sponsor: one
 * sponsor can draw through several systems.
 */
const readAccounts = (records, temps, warn) => {
  const rows = new Map(); // ACCOUNT ('' for every other account) -> { account, system, template, row }
  for (const record of records) {
    const account = cellText(record.DrawAccount);
    const name = cellText(record.PaymentSystem);
    const url = cellText(record.URL);
    const templateName = cellText(record.Template);
    if (!account && !name && !url && !templateName) continue;
    const who = account ? `Draw account ${account}` : 'The row with DrawAccount blank';
    if (rows.has(idKey(account))) {
      warn(`${who} is listed twice; row ${rows.get(idKey(account)).row} is used.`, record.row);
      continue;
    }
    let system = null;
    if (name || url) {
      const link = url || KNOWN_SYSTEMS[name.toUpperCase()] || '';
      if (!/^https?:\/\/\S+$/i.test(link)) {
        warn(
          url
            ? `${who} has URL "${url}", which doesn't start with https://, so its payment system is ignored.`
            : `${who} uses ${name}, which Quick Draw has no link for. Add its URL.`,
          record.row
        );
      } else system = { name: name || link, url: link };
    }
    let template = null;
    if (templateName && !account) {
      warn(
        'The row with DrawAccount blank has a Template, which is ignored: set the template for everyone on the Sponsors tab, on its row with Sponsor blank.',
        record.row
      );
    } else template = templateNamed(temps, templateName, warn, record.row, who);
    rows.set(idKey(account), { account, system, template, row: record.row });
  }
  const fallback = rows.get('')?.system ?? PMS;
  return {
    rows,
    /** An account's payment system: its own row's, else the row with DrawAccount blank, else PMS. */
    systemFor: (account) => rows.get(idKey(account))?.system ?? fallback,
    templateFor: (account) => (account ? rows.get(idKey(account))?.template ?? null : null),
  };
};

/** The Sponsors sheet: the template each sponsor's awards use. The row with Sponsor blank is the default. */
const readSponsors = (records, temps, warn) => {
  const rows = new Map(); // SPONSOR ('' for the default) -> { sponsor, template, row }
  for (const record of records) {
    const sponsor = cellText(record.Sponsor);
    const templateName = cellText(record.Template);
    if (!sponsor && !templateName) continue;
    const who = sponsor ? `Sponsor ${sponsor}` : 'The default row (Sponsor blank)';
    if (rows.has(idKey(sponsor))) {
      warn(`${who} is listed twice; row ${rows.get(idKey(sponsor)).row} is used.`, record.row);
      continue;
    }
    rows.set(idKey(sponsor), { sponsor, template: templateNamed(temps, templateName, warn, record.row, who), row: record.row });
  }
  return {
    rows,
    templateFor: (sponsor) => (sponsor ? rows.get(idKey(sponsor))?.template ?? null : null),
    // Without a default row, the first template on the Templates sheet.
    defaultTemplate: rows.get('')?.template ?? temps.list[0] ?? null,
  };
};

// ---------------------------------------------------- older workbooks

/** A checkbox cell: TRUE, yes, y, x, 1 or ✓. */
const isChecked = (value) => value === true || /^(true|yes|y|x|1|✓|✔)$/i.test(cellText(value));

/** The header row of a grid and a way to find, or add, a column in it. */
const gridColumns = (grid) => {
  const headerIndex = grid.findIndex((row) => row && !isBlankRow(row));
  const header = headerIndex === -1 ? null : grid[headerIndex];
  const find = (name) => (header ? header.findIndex((h) => headerKey(h) === headerKey(name)) : -1);
  const ensure = (name) => {
    let index = find(name);
    if (index === -1) {
      index = header.length;
      header.push(name);
    }
    return index;
  };
  const body = () => (headerIndex === -1 ? [] : grid.slice(headerIndex + 1).map((row, i) => ({ row: row ?? [], index: headerIndex + 1 + i })));
  const removeColumn = (name) => {
    const index = find(name);
    if (index === -1) return;
    for (let r = headerIndex; r < grid.length; r++) grid[r]?.splice(index, 1);
  };
  return { header, find, ensure, body, removeColumn };
};

/** Fills a Template cell on the row whose key column matches `key`, adding the row if needed, unless one is set. */
const setTemplateFor = (grid, keyColumn, key, templateName) => {
  const cols = gridColumns(grid);
  const keyAt = cols.ensure(keyColumn);
  const templateAt = cols.ensure('Template');
  const existing = cols.body().find(({ row }) => idKey(cellText(row[keyAt])) === idKey(key));
  if (existing) {
    if (cellText(existing.row[templateAt])) return false;
    existing.row[templateAt] = templateName;
    return true;
  }
  const row = Array(cols.header.length).fill('');
  row[keyAt] = key;
  row[templateAt] = templateName;
  grid.push(row);
  return true;
};

/**
 * Brings an older dictionary workbook up to date, in place. Older workbooks set
 * who uses a template on the Templates sheet (DrawAccount, Sponsor, Default)
 * and kept a Payment systems sheet (Name, URL, DrawAccount, Sponsor). Now the
 * Draw accounts and Sponsors sheets say which template each uses.
 *
 * tables: { templates, accounts, sponsors }, each { grid, sheetName }.
 * Returns notes saying what moved; empty when nothing did.
 */
export const migrateDictionary = (tables) => {
  const notes = [];
  // The Payment systems sheet becomes Draw accounts.
  const accounts = gridColumns(tables.accounts.grid);
  if (accounts.header && accounts.find('Name') !== -1 && accounts.find('PaymentSystem') === -1) {
    accounts.header[accounts.find('Name')] = 'PaymentSystem';
    if (/payment|system/i.test(tables.accounts.sheetName)) tables.accounts.sheetName = DICTIONARY_SHEETS.accounts;
    notes.push('The Payment systems sheet is now Draw accounts, with the system in a PaymentSystem column.');
  }
  const sponsorAt = accounts.find('Sponsor');
  if (sponsorAt !== -1) {
    const accountAt = accounts.find('DrawAccount');
    const dropped = [];
    for (const { row, index } of accounts.body().reverse()) {
      const sponsor = cellText(row[sponsorAt]);
      if (!sponsor) continue;
      if (accountAt === -1 || !cellText(row[accountAt])) {
        dropped.push(`${cellText(row[accounts.find('PaymentSystem')]) || 'a system'} for ${sponsor}`);
        tables.accounts.grid.splice(index, 1);
      }
    }
    accounts.removeColumn('Sponsor');
    notes.push(
      dropped.length
        ? `Payment systems now go by draw account, since one sponsor can use several, so these rows were removed: ${dropped.reverse().join('; ')}. Add a row for each of those sponsors’ draw accounts.`
        : 'Payment systems now go by draw account, since one sponsor can use several, so the Sponsor column was removed from Draw accounts.'
    );
  }

  // Who uses each template moves from the Templates sheet to Draw accounts and Sponsors.
  const templates = gridColumns(tables.templates.grid);
  const at = { name: templates.find('Name'), def: templates.find('Default'), account: templates.find('DrawAccount'), sponsor: templates.find('Sponsor'), text: templates.find('Template') };
  if (templates.header && (at.def !== -1 || at.account !== -1 || at.sponsor !== -1)) {
    const nameAt = templates.ensure('Name');
    const used = new Set();
    const rows = templates.body().filter(({ row }) => at.text !== -1 && cellText(row[at.text]));
    let defaultName = '';
    const moved = [];
    for (const { row } of rows) {
      const account = at.account === -1 ? '' : cellText(row[at.account]);
      const sponsor = at.sponsor === -1 ? '' : cellText(row[at.sponsor]);
      // Older templates without a Name were called by their account, sponsor or "Default".
      let name = cellText(row[nameAt]) || account || sponsor || 'Default';
      for (let n = 2; used.has(name.toUpperCase()); n++) name = `${cellText(row[nameAt]) || account || sponsor || 'Default'} ${n}`;
      used.add(name.toUpperCase());
      row[nameAt] = name;
      const ticked = at.def !== -1 && isChecked(row[at.def]);
      if (ticked && !defaultName) defaultName = name;
      if (account) {
        if (setTemplateFor(tables.accounts.grid, 'DrawAccount', account, name)) moved.push(`${name} → draw account ${account}`);
      } else if (sponsor) {
        if (setTemplateFor(tables.sponsors.grid, 'Sponsor', sponsor, name)) moved.push(`${name} → sponsor ${sponsor}`);
      } else if (!defaultName && at.def === -1) defaultName = name;
    }
    if (!defaultName) defaultName = cellText(rows.find(({ row }) => !(at.account !== -1 && cellText(row[at.account])) && !(at.sponsor !== -1 && cellText(row[at.sponsor])))?.row[nameAt]);
    if (defaultName && setTemplateFor(tables.sponsors.grid, 'Sponsor', '', defaultName)) moved.unshift(`${defaultName} → the default`);
    templates.removeColumn('Default');
    templates.removeColumn('DrawAccount');
    templates.removeColumn('Sponsor');
    notes.push(
      `Which template each draw account and sponsor uses now lives on the Draw accounts and Sponsors sheets, not the Templates sheet${moved.length ? `, so it was moved: ${moved.join('; ')}` : ''}.`
    );
  }
  return notes;
};

/**
 * Builds the report from the tables' records (see readTable).
 *
 * An award's draw account and sponsor come from its expense rows, or else from
 * the Awards sheet. Its template is the first named on the Awards, Draw accounts
 * and Sponsors sheets, in that order, else the default. Its payment system is
 * its draw account's.
 *
 * Returns { accounts, templates, unmapped, unmappedCents, awardsWithoutGoal,
 * warnings, stats }. Each warning is { area, text, row? } where area is the tab
 * it belongs on: expenses, dictionary, awards, accounts, sponsors, templates or report.
 */
export const buildReport = ({ expenses, dictionary, templates, awards = [], accounts: accountRecords = [], sponsors: sponsorRecords = [] }) => {
  const warnings = [];
  const warnFor = (area) => (text, row) => warnings.push({ area, text, row });
  const dict = readDictionary(dictionary, warnFor('dictionary'));
  const temps = readTemplates(templates, warnFor('templates'));
  const awardInfo = readAwards(awards, warnFor('awards'));
  const accountInfo = readAccounts(accountRecords, temps, warnFor('accounts'));
  const sponsorInfo = readSponsors(sponsorRecords, temps, warnFor('sponsors'));
  const seenAwards = new Map(); // AWARD -> { award, account, sponsor } as first seen, for every award in the expenses
  const disagreements = new Map(); // AWARD -> text, when the expenses and the Awards sheet differ

  for (const group of similarCategories(dict.categories)) {
    warnings.push({
      area: 'dictionary',
      text: `These categories differ only by spacing, punctuation, case or a plural, and are totaled separately: ${group
        .map((name) => `"${name}"`)
        .join(', ')}.`,
    });
  }

  const accounts = new Map();
  const unmapped = new Map();
  const excluded = new Map(); // CODE -> { code, cents } for codes marked Exclude
  const missingByAward = new Map(); // `${ACCOUNT}\0${AWARD}` -> { cents, codes } not in the dictionary
  const stats = { rows: expenses.length, mappedRows: 0, skippedRows: 0 };
  const badDates = [];
  const badCosts = [];
  const noAward = [];

  for (const record of expenses) {
    const award = cellText(record.Award);
    const code = cellText(record.CostCode);
    if (award === '') {
      stats.skippedRows++;
      noAward.push(record.row);
      continue;
    }
    // The expense row says which account and sponsor; the Awards sheet fills in what it leaves blank.
    const info = awardInfo.get(idKey(award));
    const rowAccount = cellText(record.DrawAccount);
    const rowSponsor = cellText(record.Sponsor);
    const account = rowAccount || info?.account || '';
    const sponsor = rowSponsor || info?.sponsor || '';
    if (info && !disagreements.has(idKey(award))) {
      const differ = [];
      if (rowAccount && info.account && idKey(rowAccount) !== idKey(info.account)) differ.push(`draw account ${rowAccount} (the Awards sheet says ${info.account})`);
      if (rowSponsor && info.sponsor && idKey(rowSponsor) !== idKey(info.sponsor)) differ.push(`sponsor ${rowSponsor} (the Awards sheet says ${info.sponsor})`);
      if (differ.length) disagreements.set(idKey(award), { text: `The expenses give award ${award} ${differ.join(' and ')}. The expenses are used.`, row: info.row });
    }
    if (!seenAwards.has(idKey(award))) seenAwards.set(idKey(award), { award, account, sponsor });
    const cents = parseCents(record.Cost);
    if (cents === null) {
      stats.skippedRows++;
      badCosts.push(`${record.row} ("${cellText(record.Cost)}")`);
      continue;
    }
    let day = parseDay(record.CostDate);
    if (Number.isNaN(day)) {
      badDates.push(`${record.row} ("${cellText(record.CostDate)}")`);
      day = null;
    }

    const { mapping, description: mappedDescription } = dict.find(account, sponsor, code);
    if (!mapping) {
      const key = idKey(code);
      if (!unmapped.has(key)) unmapped.set(key, { code, cents: 0, accounts: new Set(), awards: new Set() });
      const entry = unmapped.get(key);
      entry.cents += cents;
      entry.accounts.add(account || NO_ACCOUNT);
      entry.awards.add(award);
      // Also by award, so copying one award's justification can say what it leaves out.
      const awardKey = `${idKey(account)}\0${idKey(award)}`;
      if (!missingByAward.has(awardKey)) missingByAward.set(awardKey, { cents: 0, codes: new Set() });
      missingByAward.get(awardKey).cents += cents;
      missingByAward.get(awardKey).codes.add(code || '(blank)');
      continue;
    }
    if (isExcluded(mapping.category)) {
      const key = idKey(code);
      if (!excluded.has(key)) excluded.set(key, { code, cents: 0 });
      excluded.get(key).cents += cents;
      continue;
    }
    stats.mappedRows++;

    const accountKey = idKey(account);
    if (!accounts.has(accountKey)) accounts.set(accountKey, { account, sponsors: new Set(), awards: new Map() });
    if (sponsor) accounts.get(accountKey).sponsors.add(sponsor);
    const awards = accounts.get(accountKey).awards;
    const awardKey = idKey(award);
    if (!awards.has(awardKey)) awards.set(awardKey, { award, sponsor, categories: new Map(), start: null, end: null });
    const entry = awards.get(awardKey);
    if (day !== null) {
      entry.start = entry.start === null ? day : Math.min(entry.start, day);
      entry.end = entry.end === null ? day : Math.max(entry.end, day);
    }
    if (!entry.categories.has(mapping.category)) {
      entry.categories.set(mapping.category, { name: mapping.category, cents: 0, codes: new Map() });
    }
    const category = entry.categories.get(mapping.category);
    category.cents += cents;
    const codeKey = idKey(code);
    if (!category.codes.has(codeKey)) {
      const awardDescription = dict.awardDescriptions.get(`${awardKey}\0${codeKey}`) ?? '';
      category.codes.set(codeKey, {
        code,
        cents: 0,
        description: awardDescription || mappedDescription,
        awardDescription,
        generalDescription: mappedDescription,
      });
    }
    category.codes.get(codeKey).cents += cents;
  }

  const expenseWarn = warnFor('expenses');
  if (badCosts.length > 0) expenseWarn(`Rows with a Cost that is not a number are left out: ${listSome(badCosts)}.`);
  if (badDates.length > 0) expenseWarn(`Rows with a CostDate that can't be read have their dates ignored: ${listSome(badDates)}.`);
  if (noAward.length > 0) expenseWarn(`Rows with no Award are left out: ${listSome(noAward.map(String))}.`);

  const awardsWarn = warnFor('awards');
  for (const { text, row } of disagreements.values()) awardsWarn(text, row);
  const unknownTemplates = new Set();

  const usualTemplate = (account, sponsor) => {
    const forAccount = accountInfo.templateFor(account);
    if (forAccount) return { template: forAccount, source: 'account', scope: account };
    const forSponsor = sponsorInfo.templateFor(sponsor);
    if (forSponsor) return { template: forSponsor, source: 'sponsor', scope: sponsor };
    return sponsorInfo.defaultTemplate ? { template: sponsorInfo.defaultTemplate, source: 'default', scope: '' } : null;
  };

  const namer = makeSheetNamer([UNMAPPED_SHEET, README_SHEET]);
  const missingTemplate = [];
  const zeroAwards = [];
  const accountList = [...accounts.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : byText(a, b)))
    .map(([key, { account, sponsors, awards }]) => {
      const system = accountInfo.systemFor(account);
      const label = account || NO_ACCOUNT;
      const awardList = [];
      for (const entry of [...awards.values()].sort((a, b) => byText(a.award, b.award))) {
        const categories = [...entry.categories.values()]
          .filter((c) => c.cents !== 0)
          .sort((a, b) => byText(a.name, b.name))
          .map((c) => ({
            name: c.name,
            cents: c.cents,
            codes: [...c.codes.values()].filter((code) => code.cents !== 0).sort((a, b) => byText(a.code, b.code)),
          }));
        if (categories.length === 0) {
          zeroAwards.push(entry.award);
          continue;
        }
        const award = {
          key: `${key}\0${idKey(entry.award)}`,
          award: entry.award,
          sponsor: entry.sponsor,
          categories,
          totalCents: categories.reduce((sum, c) => sum + c.cents, 0),
          start: entry.start,
          end: entry.end,
          goal: awardInfo.get(idKey(entry.award))?.goal ?? '',
          program: awardInfo.get(idKey(entry.award))?.program ?? '',
        };
        // The award's own template, if the Awards sheet names one that exists.
        const info = awardInfo.get(idKey(entry.award));
        let chosen = null;
        if (info?.template) {
          chosen = temps.named(info.template);
          if (!chosen) unknownTemplates.add(JSON.stringify([entry.award, info.template, info.row]));
        }
        // Otherwise its usual one: its draw account's, else its sponsor's, else the default.
        const usual = usualTemplate(account, entry.sponsor);
        const template = chosen ?? usual?.template ?? null;
        if (!template) missingTemplate.push(entry.award);
        award.template = template
          ? { row: template.row, label: template.label, maxLength: template.maxLength, chosen: Boolean(chosen), automaticRow: usual?.template.row ?? null }
          : null;
        // Where the usual template comes from, for the Report's menu.
        award.usual = usual ? { row: usual.template.row, label: usual.template.label, source: usual.source, scope: usual.scope } : null;
        const missing = missingByAward.get(award.key);
        award.missing = missing ? { cents: missing.cents, codes: [...missing.codes].sort(byText) } : null;
        award.values = templateValues(award, account, entry.sponsor);
        award.justification = '';
        award.error = null;
        award.fallback = null;
        if (template && !template.compiled.error) {
          const result = template.compiled.render(award.values);
          if (result.error) award.error = result.error.message;
          else award.justification = result.text;
          // Too long for the limit: use the template's shorter Fallback, if it has one.
          const limit = template.maxLength;
          const fallback = template.fallback;
          if (!result.error && limit && result.text.length > limit && fallback && !fallback.compiled.error) {
            const shorter = fallback.compiled.render(award.values);
            if (!shorter.error) {
              award.fallback = { from: template.label, to: fallback.label, length: result.text.length, limit };
              award.justification = shorter.text;
              award.template = { ...award.template, row: fallback.row, label: fallback.label, maxLength: fallback.maxLength ?? limit };
            }
          }
        } else if (template) {
          award.error = template.compiled.error.message;
        }
        awardList.push(award);
      }
      return {
        key,
        account,
        sponsors: [...sponsors].sort(byText),
        label,
        sheetName: namer(label),
        // Where this account's payment requests go, from the Draw accounts sheet.
        paymentSystem: { name: system.name, url: system.url },
        awards: awardList,
      };
    })
    .filter((account) => account.awards.length > 0);

  const reportWarn = warnFor('report');
  const dictionaryWarn = warnFor('dictionary');
  if (excluded.size > 0) {
    const list = [...excluded.values()].sort((a, b) => byText(a.code, b.code));
    const total = list.reduce((sum, e) => sum + e.cents, 0);
    dictionaryWarn(
      `${formatMoney(total)} is left out on purpose, in ${list.length === 1 ? 'a code' : 'codes'} marked ${EXCLUDE}: ${list.map((e) => `${e.code} (${formatMoney(e.cents)})`).join(', ')}.`
    );
  }
  for (const entry of unknownTemplates) {
    const [award, name, row] = JSON.parse(entry);
    awardsWarn(`Award ${award} names the template "${name}", which is not on the Templates sheet, so its usual template is used.`, row);
  }
  if (missingTemplate.length > 0) {
    reportWarn(
      `There are no templates, so these justifications are empty: ${listSome(missingTemplate)}. Add one on the Templates tab.`
    );
  }
  const failed = accountList.flatMap((a) => a.awards.filter((w) => w.error && w.template).map((w) => w.award));
  if (failed.length > 0) reportWarn(`The template failed for ${listSome(failed)}. Fix it on the Templates tab.`);
  if (zeroAwards.length > 0) {
    reportWarn(`These awards' mapped costs net to $0.00, so they have no justification: ${listSome(zeroAwards)}.`);
  }

  // Where each template is named, for the Templates tab.
  const usedBy = (template) => ({
    default: sponsorInfo.defaultTemplate === template,
    sponsors: [...sponsorInfo.rows.values()].filter((r) => r.sponsor && r.template === template).map((r) => r.sponsor),
    accounts: [...accountInfo.rows.values()].filter((r) => r.account && r.template === template).map((r) => r.account),
    awards: [...awardInfo.entries()].filter(([, a]) => a.template && temps.named(a.template) === template).map(([, a]) => a.name),
  });

  const unmappedList = [...unmapped.values()]
    .sort((a, b) => byText(a.code, b.code))
    .map((u) => ({
      code: u.code,
      cents: u.cents,
      accounts: [...u.accounts].sort(byText),
      awards: [...u.awards].sort(byText),
    }));

  return {
    accounts: accountList,
    awardsWithoutGoal: [...seenAwards.entries()].filter(([key]) => !awardInfo.get(key)?.goal).map(([, a]) => a.award).sort(byText),
    // Every award in the expenses, with the account and sponsor it ended up with, and whether the Awards sheet lists it.
    awardsSeen: [...seenAwards.entries()]
      .map(([key, a]) => ({ ...a, listed: awardInfo.has(key), goal: awardInfo.get(key)?.goal ?? '' }))
      .sort((a, b) => byText(a.award, b.award)),
    // Draw accounts and sponsors in the expenses, and whether their sheets list them, for adding rows.
    accountsSeen: [...new Set([...seenAwards.values()].map((a) => a.account).filter(Boolean))]
      .sort(byText)
      .map((account) => ({ account, listed: accountInfo.rows.has(idKey(account)) })),
    sponsorsSeen: [...new Set([...seenAwards.values()].map((a) => a.sponsor).filter(Boolean))]
      .sort(byText)
      .map((sponsor) => ({ sponsor, listed: sponsorInfo.rows.has(idKey(sponsor)) })),
    hasDefaultSponsor: sponsorInfo.rows.has(''),
    hasDefaultAccount: accountInfo.rows.has(''),
    templates: temps.list.map((t) => ({ row: t.row, label: t.label, name: t.name, maxLength: t.maxLength, usedBy: usedBy(t) })),
    unmapped: unmappedList,
    unmappedCents: unmappedList.reduce((sum, u) => sum + u.cents, 0),
    warnings,
    stats,
  };
};

/** Default download name: quick-draw-YYYY-MM-DD.xlsx in local time. */
export const defaultFilename = (now = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `quick-draw-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.xlsx`;
};
