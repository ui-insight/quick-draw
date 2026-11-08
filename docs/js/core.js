// Quick Draw core: reads the three tables, rolls costs up by budget category
// and drafts each award's justification. Pure functions, no DOM, so the same
// code runs in the browser and under `node --test`.

import { TemplateError, compile } from './jinja.js';

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
    { name: 'Sponsor' },
    { name: 'DrawAccount' },
    { name: 'Goal' },
    { name: 'Template' },
  ],
  templates: [
    { name: 'Name' },
    { name: 'DrawAccount' },
    { name: 'Sponsor' },
    { name: 'Template', required: true },
    { name: 'MaxLength' },
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
export const DICTIONARY_SHEETS = { dictionary: 'Cost codes', awards: 'Awards', templates: 'Templates' };

/**
 * Which sheet of a data dictionary workbook holds what, by its columns and
 * then its name. Returns { dictionary, awards, templates }, each a sheet
 * index or -1. Other sheets are left alone.
 */
export const classifySheets = (sheets) => {
  const found = { dictionary: -1, awards: -1, templates: -1 };
  const headers = sheets.map(({ grid }) => {
    const row = grid.find((r) => r && !isBlankRow(r)) ?? [];
    return new Set(row.map(headerKey));
  });
  const claim = (part, test) => {
    if (found[part] !== -1) return;
    const index = sheets.findIndex((sheet, i) => !Object.values(found).includes(i) && test(headers[i], sheet.name.toLowerCase()));
    if (index !== -1) found[part] = index;
  };
  // Awards sheets also have a Template column (naming one), so only a sheet without Award is the Templates sheet.
  claim('dictionary', (h) => h.has('costcode') && h.has('budgetcategory'));
  claim('awards', (h) => h.has('award') && !h.has('costcode') && !h.has('budgetcategory'));
  claim('templates', (h) => h.has('template') && !h.has('award'));
  claim('templates', (h, name) => name.includes('template'));
  claim('awards', (h, name) => name.includes('award'));
  claim('dictionary', (h, name) => name.includes('code') || name.includes('dictionary'));
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
  sponsor: { label: 'Sponsor', example: 'Sponsor A', help: "The draw account's sponsor. Blank when the expenses have none." },
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

  heading('The three sheets and what they are for');
  row('Cost codes', 'Maps each of your institution’s cost codes to a sponsor budget category, with a plain-language description. This is how expenses are grouped and totaled.');
  row('Awards', 'One row per award: its sponsor and draw account, a short goal saying what the award is for, and optionally which template it uses.');
  row('Templates', 'The wording of the justification, with blanks that Quick Draw fills in for each award. Keep as many versions as you like.');
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
  row('Sponsor', 'Optional. The award’s sponsor. Used when the expenses file doesn’t say; if both say, the expenses win.');
  row('DrawAccount', 'Optional. The payment-system account the award draws from. Used when the expenses file doesn’t say; if both say, the expenses win.');
  row('Goal', 'A few words on what the award is for, such as “mapping groundwater recharge in the upper basin”. Templates write it with {{ goal }}. Without one, the justification says [describe the award’s goal] until you fill it in.');
  row('Template', 'Optional. The Name of the template this award uses, when it should read differently from the rest of its account. Leave blank to use the account’s usual template.');
  row('Missing awards', 'Awards in the expenses that are not on this sheet are added for you, with their sponsor and draw account filled in, so you only write the goal.');
  gap();

  heading('Templates sheet');
  row('Name', 'Optional. What to call the template when you pick it.');
  row('DrawAccount', 'Optional. Awards in this draw account use this template automatically.');
  row('Sponsor', 'Optional. Accounts with this sponsor use this template automatically, unless the account has its own.');
  row('Template', 'Required. The justification text, written in Jinja: {{ value }} fills in a value, and {% for c in categories %} … {% endfor %} repeats text for each budget category.');
  row('MaxLength', 'Optional. The payment system’s character limit. Longer justifications are flagged.');
  row('Which template is used', 'The template named on the award’s row of the Awards sheet; else the first template for its draw account, else the first for its sponsor, else the first with neither. Picking a template for an award in Quick Draw writes its Name on the Awards sheet.');
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
  row('Award', 'A grant or contract, identified by its award number.');
  row('Draw account', 'The payment-system account an award draws its funds from.');
  row('Sponsor', 'The organization funding the award. Several draw accounts can share a sponsor.');
  row('Cost code', 'Your institution’s code for a kind of expense, also called an object or expense code.');
  row('Budget category', 'The sponsor’s budget line a cost is reported under, such as Travel or Fringe Benefits.');
  row('Goal', 'A short statement of what an award is for.');
  row('Justification', 'The short statement, required by many payment systems, of what a drawdown paid for.');
  row('Template', 'The justification’s wording with blanks for each award’s values.');
  row('Character limit', 'The most characters the payment system accepts in a justification.');
  row('Unmapped code', 'A cost code in the expenses that this workbook does not list. Its costs are left out until it is added.');
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
    const sponsor = account.sponsor ? ` (${account.sponsor})` : '';
    row(account.sheetName, `Draw account ${account.label}${sponsor}: ${account.awards.length} ${account.awards.length === 1 ? 'award' : 'awards'}.`);
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
      goal: cellText(record.Goal),
      sponsor: cellText(record.Sponsor),
      account: cellText(record.DrawAccount),
      template: cellText(record.Template),
      row: record.row,
    });
  }
  return awards;
};

/** A template's display name: its Name, else its draw account or sponsor, else "Default". */
export const templateLabel = (name, account, sponsor = '') => name || account || sponsor || 'Default';

const readTemplates = (records, warn) => {
  const list = []; // every usable template, in file order
  const byScope = new Map(); // scope -> first template for it
  const labels = new Map();
  for (const record of records) {
    const name = cellText(record.Name);
    const account = cellText(record.DrawAccount);
    const sponsor = cellText(record.Sponsor);
    const text = cellText(record.Template);
    const where = `Row ${record.row}`;
    if (text === '') {
      if (name || account || sponsor) warn(`${where} has no Template, so it is skipped.`, record.row);
      continue;
    }
    let maxLength = null;
    const rawMax = cellText(record.MaxLength);
    if (rawMax !== '') {
      const n = Number(rawMax.replace(/,/g, ''));
      if (Number.isInteger(n) && n > 0) maxLength = n;
      else warn(`${where} has MaxLength "${rawMax}", which is not a whole number, so it is ignored.`, record.row);
    }
    let label = templateLabel(name, account, sponsor);
    if (labels.has(label.toUpperCase())) label = `${label} (row ${record.row})`;
    labels.set(label.toUpperCase(), true);
    const compiled = compileTemplate(text);
    if (compiled.error) warn(`The "${label}" template has an error. ${compiled.error.message}`, record.row);
    const note = singleBraceNote(text);
    if (note) warn(`The "${label}" template: ${note}`, record.row);
    const template = { row: record.row, label, name, account, sponsor, text, maxLength, compiled };
    list.push(template);
    const key = scopeKey(account, sponsor);
    if (!byScope.has(key)) byScope.set(key, template);
  }
  /** The template an award uses when it doesn't name one. */
  const automatic = (account, sponsor) =>
    scopesFor(account, sponsor)
      .map((scope) => byScope.get(scope))
      .find(Boolean) ?? null;
  /** A template by its Name (or the label it is shown with). */
  const named = (name) => {
    const key = name.trim().toUpperCase();
    return list.find((t) => t.name.toUpperCase() === key) ?? list.find((t) => t.label.toUpperCase() === key) ?? null;
  };
  return { list, automatic, named };
};

/**
 * Builds the report from the tables' records (see readTable).
 *
 * An award's draw account and sponsor come from its expense rows, or else from
 * the Awards sheet. Its template is the one named on the Awards sheet, or else
 * the first template for its draw account, else for its sponsor, else the first
 * with neither.
 *
 * Returns { accounts, templates, unmapped, unmappedCents, awardsWithoutGoal,
 * warnings, stats }. Each warning is { area, text, row? } where area is the tab
 * it belongs on: expenses, dictionary, awards, templates or report.
 */
export const buildReport = ({ expenses, dictionary, templates, awards = [] }) => {
  const warnings = [];
  const warnFor = (area) => (text, row) => warnings.push({ area, text, row });
  const dict = readDictionary(dictionary, warnFor('dictionary'));
  const temps = readTemplates(templates, warnFor('templates'));
  const awardInfo = readAwards(awards, warnFor('awards'));
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
    if (!awards.has(awardKey)) awards.set(awardKey, { award, categories: new Map(), start: null, end: null });
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

  const namer = makeSheetNamer([UNMAPPED_SHEET, README_SHEET]);
  const missingTemplate = [];
  const zeroAwards = [];
  const accountList = [...accounts.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : byText(a, b)))
    .map(([key, { account, sponsors, awards }]) => {
      const sponsor = [...sponsors][0] ?? '';
      if (sponsors.size > 1) {
        expenseWarn(
          `Draw account ${account || NO_ACCOUNT} has rows for more than one Sponsor (${[...sponsors].join(', ')}). Its template is chosen as if its sponsor were ${sponsor}.`
        );
      }
      const automatic = temps.automatic(account, sponsor);
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
          categories,
          totalCents: categories.reduce((sum, c) => sum + c.cents, 0),
          start: entry.start,
          end: entry.end,
          goal: awardInfo.get(idKey(entry.award))?.goal ?? '',
        };
        // The award's own template, if the Awards sheet names one that exists.
        const info = awardInfo.get(idKey(entry.award));
        let chosen = null;
        if (info?.template) {
          chosen = temps.named(info.template);
          if (!chosen) unknownTemplates.add(JSON.stringify([entry.award, info.template, info.row]));
        }
        const template = chosen ?? automatic;
        if (!template) missingTemplate.push(entry.award);
        award.template = template
          ? { row: template.row, label: template.label, maxLength: template.maxLength, chosen: Boolean(chosen), automaticRow: automatic?.row ?? null }
          : null;
        const missing = missingByAward.get(award.key);
        award.missing = missing ? { cents: missing.cents, codes: [...missing.codes].sort(byText) } : null;
        award.values = templateValues(award, account, sponsor);
        award.justification = '';
        award.error = null;
        if (template && !template.compiled.error) {
          const result = template.compiled.render(award.values);
          if (result.error) award.error = result.error.message;
          else award.justification = result.text;
        } else if (template) {
          award.error = template.compiled.error.message;
        }
        awardList.push(award);
      }
      return {
        key,
        account,
        sponsor,
        label,
        sheetName: namer(label),
        // The template the account's awards use unless they name their own.
        template: automatic ? { row: automatic.row, label: automatic.label, maxLength: automatic.maxLength } : null,
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
    awardsWarn(`Award ${award} names the template "${name}", which is not on the Templates sheet. Its account's template is used.`, row);
  }
  if (missingTemplate.length > 0) {
    reportWarn(
      `No template fits ${listSome(missingTemplate)}, and there is no default template (one with DrawAccount and Sponsor blank), so those justifications are empty.`
    );
  }
  const failed = accountList.flatMap((a) => a.awards.filter((w) => w.error && w.template).map((w) => w.award));
  if (failed.length > 0) reportWarn(`The template failed for ${listSome(failed)}. Fix it on the Templates tab.`);
  if (zeroAwards.length > 0) {
    reportWarn(`These awards' mapped costs net to $0.00, so they have no justification: ${listSome(zeroAwards)}.`);
  }

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
    templates: temps.list.map((t) => ({ row: t.row, label: t.label, account: t.account, sponsor: t.sponsor, maxLength: t.maxLength })),
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
