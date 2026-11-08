import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadExcelJS } from './exceljs.js';
import { buildWorkbook, readXlsxSheets } from '../docs/js/workbook.js';
import {
  COLUMNS,
  classifySheets,
  buildReport,
  categoryKey,
  formatMoney,
  makeSheetNamer,
  parseCents,
  parseCsv,
  parseDay,
  formatDay,
  toCsv,
  readTable,
  similarCategories,
} from '../docs/js/core.js';

const csv = (text, name) => readTable(parseCsv(text), COLUMNS[name], name);

// The sample files, as the page reads them.
const ExcelJS = loadExcelJS();
const dictionarySheets = await readXlsxSheets(ExcelJS, readFileSync(new URL('../docs/samples/dictionary.xlsx', import.meta.url)));
const found = classifySheets(dictionarySheets);
const samples = {
  expenses: readTable(parseCsv(readFileSync(new URL('../docs/samples/expenses.csv', import.meta.url), 'utf8')), COLUMNS.expenses, 'expenses'),
  dictionary: readTable(dictionarySheets[found.dictionary].grid, COLUMNS.dictionary, 'dictionary'),
  awards: readTable(dictionarySheets[found.awards].grid, COLUMNS.awards, 'awards'),
  templates: readTable(dictionarySheets[found.templates].grid, COLUMNS.templates, 'templates'),
};
const sampleReport = (extra = {}) => buildReport({ ...samples, ...extra });

test('parseCsv handles quotes, doubled quotes, CRLF and a BOM', () => {
  assert.deepEqual(parseCsv('﻿a,"b,c","say ""hi"""\r\n1,2,3\n'), [
    ['a', 'b,c', 'say "hi"'],
    ['1', '2', '3'],
  ]);
  assert.deepEqual(parseCsv('a,"line\nbreak"'), [['a', 'line\nbreak']]);
});

test('readTable matches headers loosely and reports missing columns', () => {
  const rows = readTable([['award', 'Cost Code', 'COST'], ['A1', 'C1', '5']], COLUMNS.expenses, 'expenses');
  assert.equal(rows[0].Award, 'A1');
  assert.equal(rows[0].CostCode, 'C1');
  assert.equal(rows[0].row, 2);
  assert.throws(() => readTable([['Award', 'Cost']], COLUMNS.expenses, 'expenses'), /missing the column CostCode/);
});

test('parseCents reads display text', () => {
  assert.equal(parseCents('1,234.56'), 123456);
  assert.equal(parseCents('$12'), 1200);
  assert.equal(parseCents('(25.00)'), -2500);
  assert.equal(parseCents('-'), 0);
  assert.equal(parseCents(''), 0);
  assert.equal(parseCents(0.1 + 0.2), 30);
  assert.equal(parseCents('abc'), null);
});

test('parseDay reads common formats and rejects bad dates', () => {
  const day = parseDay('2026-07-03');
  assert.equal(formatDay(day), '07/03/2026');
  assert.equal(parseDay('7/3/2026'), day);
  assert.equal(parseDay('03-JUL-26'), day);
  assert.equal(parseDay(new Date(Date.UTC(2026, 6, 3))), day);
  assert.equal(parseDay(46206), day); // Excel serial
  assert.ok(Number.isNaN(parseDay('2026-02-30')));
  assert.ok(Number.isNaN(parseDay('soon')));
  assert.equal(parseDay(''), null);
});

test('money formatting', () => {
  assert.equal(formatMoney(123456), '$1,234.56');
  assert.equal(formatMoney(-5), '-$0.05');
});

test('near-duplicate categories are grouped', () => {
  assert.equal(categoryKey('Other Direct Costs - Services'), categoryKey('Other Direct Costs – Service'));
  assert.equal(categoryKey('Materials & Supplies'), categoryKey('materials and supplies'));
  assert.deepEqual(similarCategories(['Travel', 'Travel ', 'Fringe']), [['Travel', 'Travel ']]);
});

test('sheet names are cleaned, shortened and unique', () => {
  const name = makeSheetNamer(['Unmapped codes']);
  assert.equal(name('A/B:C'), 'A-B-C');
  assert.equal(name('x'.repeat(40)).length, 31);
  assert.equal(name('x'.repeat(40)), `${'x'.repeat(27)} (2)`);
  assert.equal(name('Unmapped codes'), 'Unmapped codes (2)');
  assert.equal(name(''), 'Account');
});

test('the sample workbook has its three sheets', () => {
  assert.deepEqual([...dictionarySheets].map((sheet) => String(sheet.name)), ['Read me', 'Cost codes', 'Awards', 'Templates']);
  assert.deepEqual(found, { dictionary: 1, awards: 2, templates: 3 });
  const readMe = dictionarySheets[0].grid;
  assert.equal(readMe[0][0], 'Quick Draw data dictionary');
  assert.ok(readMe.some((row) => row[0] === 'The three sheets and what they are for'));
  assert.ok(readMe.length > 50);
});

test('sheets are recognized by their columns before their names', () => {
  const sheet = (name, header) => ({ name, grid: [header] });
  assert.deepEqual(
    classifySheets([sheet('Notes', ['Anything']), sheet('Wording', ['Template']), sheet('Goals', ['Award', 'Goal']), sheet('Map', ['Cost Code', 'Budget Category'])]),
    { dictionary: 3, awards: 2, templates: 1 }
  );
  assert.deepEqual(classifySheets([sheet('Awards', ['Award']), sheet('Codes', ['X'])]), { dictionary: 1, awards: 0, templates: -1 });
  assert.deepEqual(
    classifySheets([sheet('A', ['Award', 'Goal', 'Template']), sheet('T', ['Name', 'Template']), sheet('C', ['CostCode', 'BudgetCategory', 'Award'])]),
    { dictionary: 2, awards: 0, templates: 1 }
  );
});

test('sample files build the expected report', () => {
  const report = sampleReport();
  assert.deepEqual(report.accounts.map((a) => [a.account, a.sponsor]), [
    ['ACCT-A', 'Sponsor A'],
    ['ACCT-B', 'Sponsor B'],
  ]);
  assert.deepEqual(report.templates.map((t) => t.label), ['Standard', 'Itemized with descriptions', 'Short']);

  const [a, b] = report.accounts;
  const awd1001 = a.awards.find((w) => w.award === 'AWD-1001');
  assert.deepEqual(
    awd1001.categories.map((c) => [c.name, c.cents]),
    [
      ['Fringe Benefits', 260400],
      ['Materials & Supplies', 14810],
      ['Salaries & Wages', 840000],
      ['Travel', 61245],
    ]
  );
  assert.equal(awd1001.totalCents, 1176455);
  assert.equal(a.template.label, 'Standard');
  assert.equal(
    awd1001.justification,
    'Payment for Fringe Benefits $2,604.00, Materials & Supplies $148.10, Salaries & Wages $8,400.00, Travel $612.45, incurred 07/03/2026 through 08/14/2026 under award AWD-1001, for allowable costs in the approved budget to carry out mapping groundwater recharge in the upper basin. Total $11,764.55.'
  );
  // The award's own description of a code replaces the general one for that award only.
  const travel = awd1001.categories.find((c) => c.name === 'Travel').codes[0];
  assert.deepEqual(
    [travel.description, travel.awardDescription, travel.generalDescription],
    ['travel to the annual project meeting', 'travel to the annual project meeting', 'project travel']
  );

  // An award with no goal gets the marker.
  const awd1002 = a.awards.find((w) => w.award === 'AWD-1002');
  assert.match(awd1002.justification, /carry out \[describe the award's goal\]\./);
  assert.deepEqual(report.awardsWithoutGoal, ['AWD-1002']);

  // Sponsor B's mapping and template apply to ACCT-B; the description falls back to the general row.
  const awd2001 = b.awards[0];
  assert.equal(b.template.label, 'Itemized with descriptions');
  assert.equal(b.template.maxLength, 500);
  assert.equal(
    awd2001.justification,
    'Drawdown for award AWD-2001: Fringe Benefits $1,116.00 (employee benefits); Materials & Supplies $285.40 (lab and field supplies); Other Direct Costs - Equipment Rental $950.00 (equipment rental); Salaries & Wages $3,600.00 (personnel salaries). Costs from 07/03/2026 to 08/02/2026 supporting training graduate students in field hydrology. Total $5,951.40.'
  );
  // A negative cost nets against the category.
  assert.equal(awd2001.categories.find((c) => c.name === 'Materials & Supplies').cents, 28540);

  assert.deepEqual(report.unmapped, [{ code: 'C900', cents: 7500, accounts: ['ACCT-A'], awards: ['AWD-1002'] }]);
  assert.deepEqual(report.warnings, []);
});

test('an award can name its own template on the Awards sheet', () => {
  const awards = csv('Award,Goal,Template\nAWD-1001,mapping groundwater recharge in the upper basin,short\nAWD-1002,,No such template', 'awards');
  const report = sampleReport({ awards });
  const [a] = report.accounts;
  const [awd1001, awd1002] = a.awards;
  assert.deepEqual([awd1001.template.label, awd1001.template.chosen, awd1001.template.automaticRow], ['Short', true, 2]);
  assert.equal(awd1001.justification, 'Award AWD-1001: $11,764.55 for mapping groundwater recharge in the upper basin.');
  assert.equal(awd1002.template.label, 'Standard');
  assert.match(report.warnings.filter((w) => w.area === 'awards').map((w) => w.text).join('\n'), /AWD-1002 names the template "No such template"/);
});

test('the Awards sheet supplies the account and sponsor the expenses leave out', () => {
  const report = buildReport({
    expenses: csv('Award,CostCode,Cost\nA1,C1,5\nA2,C1,7\nA3,C1,1', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory\nC1,Travel', 'dictionary'),
    awards: csv('Award,Sponsor,DrawAccount,Goal\nA1,S1,X,first\nA2,S1,Y,second', 'awards'),
    templates: csv('Name,Sponsor,Template\nS1 wording,S1,{{ sponsor }}/{{ account }}: {{ goal }}\nDefault,,plain {{ award }}', 'templates'),
  });
  assert.deepEqual(
    report.accounts.map((a) => [a.label, a.sponsor, a.awards.map((w) => w.justification).join()]),
    [
      ['X', 'S1', 'S1/X: first'],
      ['Y', 'S1', 'S1/Y: second'],
      ['No draw account', '', 'plain A3'],
    ]
  );
  assert.deepEqual(
    report.awardsSeen.map((a) => [a.award, a.account, a.sponsor, a.listed]),
    [
      ['A1', 'X', 'S1', true],
      ['A2', 'Y', 'S1', true],
      ['A3', '', '', false],
    ]
  );
});

test('the expenses win when they disagree with the Awards sheet', () => {
  const report = buildReport({
    expenses: csv('Award,DrawAccount,CostCode,Cost\nA1,Z,C1,5', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory\nC1,Travel', 'dictionary'),
    awards: csv('Award,DrawAccount\nA1,X', 'awards'),
    templates: csv('Template\nok', 'templates'),
  });
  assert.equal(report.accounts[0].label, 'Z');
  assert.match(report.warnings.map((w) => w.text).join('\n'), /draw account Z \(the Awards sheet says X\)\. The expenses are used\./);
});

test('a draw account row beats a sponsor row, which beats a general row', () => {
  const report = buildReport({
    expenses: csv('Award,DrawAccount,Sponsor,CostCode,Cost\nA1,X,S,C1,1\nA2,Y,S,C1,1\nA3,Z,T,C1,1', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory,DrawAccount,Sponsor\nC1,General,,\nC1,For S,,S\nC1,For X,X,S', 'dictionary'),
    templates: csv('Name,DrawAccount,Sponsor,Template\nAll,,,all {{ sponsor }}\nS only,,S,s {{ sponsor }}\nX only,X,,x {{ account }}', 'templates'),
  });
  const by = Object.fromEntries(report.accounts.map((a) => [a.account, a]));
  assert.equal(by.X.awards[0].categories[0].name, 'For X');
  assert.equal(by.Y.awards[0].categories[0].name, 'For S');
  assert.equal(by.Z.awards[0].categories[0].name, 'General');
  assert.deepEqual([by.X, by.Y, by.Z].map((a) => a.awards[0].justification), ['x X', 's S', 'all T']);
});

test('awards file problems and missing goals', () => {
  const report = buildReport({
    expenses: csv('Award,CostCode,Cost\nA1,C1,1\nA2,C1,1', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory\nC1,Travel', 'dictionary'),
    awards: csv('Award,Goal\nA1,first goal\na1,second goal\n,orphan goal', 'awards'),
    templates: csv('Template\n{{ award }}: {{ goal }}', 'templates'),
  });
  assert.deepEqual(report.accounts[0].awards.map((w) => w.justification), ['A1: first goal', "A2: [describe the award's goal]"]);
  assert.deepEqual(report.awardsWithoutGoal, ['A2']);
  const text = report.warnings.filter((w) => w.area === 'awards').map((w) => w.text).join('\n');
  assert.match(text, /repeats award a1/);
  assert.match(text, /Goal but no Award/);
});

test('problems are reported on the tab they belong to', () => {
  const report = buildReport({
    expenses: csv('Award,CostCode,Cost,CostDate,DrawAccount\nA1,C1,10,bad,X\nA1,C1,oops,,X\n,C1,5,,X\nA2,c1,0,,X', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory\nC1,Travel\nC1,Other\nC2,', 'dictionary'),
    templates: csv('DrawAccount,Template,MaxLength\nY,{award} {{ nope }},ten', 'templates'),
  });
  const area = (name) => report.warnings.filter((w) => w.area === name).map((w) => w.text).join('\n');
  assert.match(area('dictionary'), /already maps it to "Travel"/);
  assert.doesNotMatch(area('dictionary'), /BudgetCategory/);
  assert.equal(report.warnings.find((w) => /already maps/.test(w.text)).row, 3);
  assert.match(area('templates'), /MaxLength "ten"/);
  assert.match(area('templates'), /\{award\} is plain text/);
  assert.match(area('expenses'), /not a number.*3/);
  assert.match(area('expenses'), /can't be read.*2/);
  assert.match(area('expenses'), /no Award.*4/);
  assert.match(area('report'), /No template fits A1/);
  assert.match(area('report'), /net to \$0\.00.*A2/);
  assert.equal(report.accounts[0].awards[0].justification, '');
  assert.equal(report.accounts[0].awards[0].start, null);
});

test('a template that fails is reported, with the error on each award', () => {
  const report = buildReport({
    expenses: csv('Award,CostCode,Cost\nA1,C1,1', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory\nC1,Travel', 'dictionary'),
    templates: csv('Template\n{{ c.name }}', 'templates'),
  });
  const award = report.accounts[0].awards[0];
  assert.equal(award.justification, '');
  assert.match(award.error, /"c" is not a variable here\. c only exists between/);
  assert.match(report.warnings.map((w) => w.text).join('\n'), /failed for A1/);
});

test('rows without a draw account use general mappings and the default template', () => {
  const report = buildReport({
    expenses: csv('Award,CostCode,Cost\nA1,C1,1.10\nA1,C1,2.20', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory\nC1,Travel', 'dictionary'),
    templates: csv('Template\n{{ award }}: {{ costs }} = {{ total }} [{{ start }}]', 'templates'),
  });
  const [account] = report.accounts;
  assert.equal(account.label, 'No draw account');
  assert.equal(account.awards[0].justification, 'A1: Travel $3.30 = 3.30 []');
});

test('toCsv quotes what needs quoting and round-trips through parseCsv', () => {
  const grid = [['a', 'b,c', 'say "hi"'], ['1', ' padded', 'line\nbreak']];
  assert.deepEqual(parseCsv(toCsv(grid)), grid);
});

test('a code marked Exclude is left out on purpose, not reported as missing', () => {
  const report = buildReport({
    expenses: csv('Award,CostCode,Cost\nA1,C1,10\nA1,C9,2.50\nA1,C8,1', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory\nC1,Travel\nC9,Exclude\nC8,', 'dictionary'),
    templates: csv('Template\n{{ total }}', 'templates'),
  });
  assert.equal(report.accounts[0].awards[0].justification, '10.00');
  assert.deepEqual(report.unmapped.map((u) => u.code), ['C8']);
  assert.match(report.warnings.map((w) => w.text).join('\n'), /\$2\.50 is left out on purpose, in a code marked Exclude: C9/);
});

test('the downloaded report opens with a Read me saying what it holds', async () => {
  const report = sampleReport();
  const workbook = buildWorkbook(ExcelJS, report, undefined, { expensesFile: 'expenses.csv', dictionaryFile: 'dictionary.xlsx', made: new Date(2026, 10, 7, 9, 5) });
  const sheets = await readXlsxSheets(ExcelJS, await workbook.xlsx.writeBuffer());
  assert.deepEqual([...sheets].map((sheet) => String(sheet.name)), ['Read me', 'ACCT-A', 'ACCT-B', 'Unmapped codes']);
  const readMe = new Map([...sheets[0].grid].map((row) => [String(row[0] ?? ''), String(row[1] ?? '')]));
  assert.equal(readMe.get('Made'), '2026-11-07 09:05');
  assert.equal(readMe.get('Expenses file'), 'expenses.csv');
  assert.equal(readMe.get('Covers'), '3 awards in 2 draw accounts, $22,418.45 in all.');
  assert.equal(readMe.get('ACCT-B'), 'Draw account ACCT-B (Sponsor B): 1 award.');
  assert.match(readMe.get('Unmapped codes'), /\$75\.00 in 1 code not in the dictionary: C900/);
});
