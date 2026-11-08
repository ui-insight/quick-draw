import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadExcelJS } from './exceljs.js';
import { buildWorkbook, readXlsxSheets } from '../docs/js/workbook.js';
import {
  COLUMNS,
  STANDARD_TEMPLATES,
  compileTemplate,
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
  systems: readTable(dictionarySheets[found.systems].grid, COLUMNS.systems, 'systems'),
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

test('the sample workbook has its sheets', () => {
  assert.deepEqual([...dictionarySheets].map((sheet) => String(sheet.name)), ['Read me', 'Cost codes', 'Awards', 'Templates', 'Payment systems']);
  assert.deepEqual(found, { dictionary: 1, awards: 2, templates: 3, systems: 4 });
  const readMe = dictionarySheets[0].grid;
  assert.equal(readMe[0][0], 'Quick Draw data dictionary');
  assert.ok(readMe.some((row) => row[0] === 'The sheets and what they are for'));
  assert.ok(readMe.length > 50);
});

test('sheets are recognized by their columns before their names', () => {
  const sheet = (name, header) => ({ name, grid: [header] });
  assert.deepEqual(
    classifySheets([sheet('Notes', ['Anything']), sheet('Wording', ['Template']), sheet('Goals', ['Award', 'Goal']), sheet('Map', ['Cost Code', 'Budget Category'])]),
    { dictionary: 3, awards: 2, templates: 1, systems: -1 }
  );
  assert.deepEqual(classifySheets([sheet('Awards', ['Award']), sheet('Codes', ['X'])]), { dictionary: 1, awards: 0, templates: -1, systems: -1 });
  assert.deepEqual(
    classifySheets([sheet('A', ['Award', 'Goal', 'Template']), sheet('T', ['Name', 'Template']), sheet('C', ['CostCode', 'BudgetCategory', 'Award'])]),
    { dictionary: 2, awards: 0, templates: 1, systems: -1 }
  );
});

test('sample files build the expected report', () => {
  const report = sampleReport();
  assert.deepEqual(report.accounts.map((a) => [a.account, a.sponsors]), [
    ['ACCT-A', ['Sponsor A']],
    ['ACCT-B', ['Sponsor B']],
    ['ACCT-C', ['Sponsor C']],
  ]);
  assert.deepEqual(report.templates.map((t) => t.label), ['HHS and NIH', 'HHS and NIH, short', 'DOL VETS', 'NASA']);

  const [a, b, c] = report.accounts;
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
  assert.equal(awd1001.template.label, 'HHS and NIH');
  assert.deepEqual(awd1001.usual, { row: 2, label: 'HHS and NIH', source: 'default', scope: '' });
  // The HHS template: each cost with what it paid for, when, and how it supports the award.
  assert.equal(
    awd1001.justification,
    'Payment for Fringe Benefits (employee benefits), Materials & Supplies (lab and field supplies), Salaries & Wages (personnel salaries), and Travel (travel to the annual project meeting) incurred 07/03/2026 through 08/14/2026 to support mapping groundwater recharge in the upper basin under award AWD-1001.'
  );
  // The award's own description of a code replaces the general one for that award only.
  const travel = awd1001.categories.find((c) => c.name === 'Travel').codes[0];
  assert.deepEqual(
    [travel.description, travel.awardDescription, travel.generalDescription],
    ['travel to the annual project meeting', 'travel to the annual project meeting', 'project travel']
  );

  // An award with no goal gets the marker.
  const awd1002 = a.awards.find((w) => w.award === 'AWD-1002');
  assert.match(awd1002.justification, /to support \[describe the award's goal\] under award AWD-1002\./);
  assert.deepEqual(report.awardsWithoutGoal, ['AWD-1002']);

  // Sponsor B uses the DOL format: program, period, and each category's amount, adding up to the total.
  const awd2001 = b.awards[0];
  assert.equal(awd2001.template.label, 'DOL VETS');
  assert.deepEqual([awd2001.usual.source, awd2001.usual.scope], ['sponsor', 'Sponsor B']);
  assert.equal(
    awd2001.justification,
    'These funds are for expenditures under the Sample Workforce Program, for the period 07/03/2026 to 08/02/2026, for fringe benefits ($1,116.00), materials & supplies ($285.40), other direct costs - equipment rental ($950.00), and salaries & wages ($3,600.00) as outlined in the grant award.'
  );
  const listed = [...awd2001.justification.matchAll(/\$([\d,]+\.\d\d)/g)].reduce((sum, m) => sum + Math.round(Number(m[1].replace(/,/g, '')) * 100), 0);
  assert.equal(listed, awd2001.totalCents);
  // A negative cost nets against the category.
  assert.equal(awd2001.categories.find((c) => c.name === 'Materials & Supplies').cents, 28540);

  // Sponsor C has no template of its own, so it gets the Default.
  assert.equal(c.awards[0].template.label, 'HHS and NIH');

  assert.deepEqual(report.unmapped, [{ code: 'C900', cents: 7500, accounts: ['ACCT-A'], awards: ['AWD-1002'] }]);
  assert.deepEqual(report.warnings, []);
});

test('an award can name its own template on the Awards sheet', () => {
  const awards = csv('Award,Goal,Template\nAWD-1001,mapping groundwater recharge in the upper basin,nasa\nAWD-1002,,No such template', 'awards');
  const report = sampleReport({ awards });
  const [a] = report.accounts;
  const [awd1001, awd1002] = a.awards;
  assert.deepEqual([awd1001.template.label, awd1001.template.chosen, awd1001.template.automaticRow], ['NASA', true, 2]);
  assert.equal(
    awd1001.justification,
    'Payment of $11,764.55 is requested for Fringe Benefits ($2,604.00), Materials & Supplies ($148.10), Salaries & Wages ($8,400.00), and Travel ($612.45) in accordance with the pre-approved budget categories of award AWD-1001, to support mapping groundwater recharge in the upper basin.'
  );
  assert.equal(awd1002.template.label, 'HHS and NIH');
  assert.match(report.warnings.filter((w) => w.area === 'awards').map((w) => w.text).join('\n'), /AWD-1002 names the template "No such template"/);
});

test('an award too long for its template uses the shorter fallback, and says so', () => {
  const templates = csv(
    'Name,Template,MaxLength,Fallback\nLong,{{ award }}: {{ costs }} plus a great deal more wording than will fit,40,Short\nShort,{{ award }}: ${{ total }},40,\nBroken,x,10,Nowhere',
    'templates'
  );
  const report = sampleReport({ templates });
  const award = report.accounts[0].awards[0];
  assert.equal(award.justification, 'AWD-1001: $11,764.55');
  assert.deepEqual(award.fallback, { from: 'Long', to: 'Short', length: award.fallback.length, limit: 40 });
  assert.ok(award.fallback.length > 40);
  assert.equal(award.template.label, 'Short');
  assert.match(report.warnings.map((w) => w.text).join('\n'), /"Broken" template's Fallback, "Nowhere", is not a template/);
});

test('the standard templates all compile and stay within their limits for the samples', () => {
  for (const t of STANDARD_TEMPLATES) {
    const compiled = compileTemplate(t.text);
    assert.equal(compiled.error, undefined, t.name);
  }
});

test('a draw account row beats a sponsor row, which beats a general row', () => {
  const report = buildReport({
    expenses: csv('Award,DrawAccount,Sponsor,CostCode,Cost\nA1,X,S,C1,1\nA2,Y,S,C1,1\nA3,Z,T,C1,1', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory,DrawAccount,Sponsor\nC1,General,,\nC1,For S,,S\nC1,For X,X,S', 'dictionary'),
    templates: csv('Name,Default,DrawAccount,Sponsor,Template\nSpare,,,,spare\nAll,TRUE,,,all {{ sponsor }}\nS only,,,S,s {{ sponsor }}\nX only,,X,,x {{ account }}', 'templates'),
  });
  const by = Object.fromEntries(report.accounts.map((a) => [a.account, a]));
  assert.equal(by.X.awards[0].categories[0].name, 'For X');
  assert.equal(by.Y.awards[0].categories[0].name, 'For S');
  assert.equal(by.Z.awards[0].categories[0].name, 'General');
  // Templates: the award's draw account, else its sponsor, else the one marked Default.
  assert.deepEqual([by.X, by.Y, by.Z].map((a) => a.awards[0].justification), ['x X', 's S', 'all T']);
  assert.deepEqual([by.X, by.Y, by.Z].map((a) => a.awards[0].usual.source), ['account', 'sponsor', 'default']);
  assert.deepEqual(report.warnings, []);
});

test('awards in one draw account can have different sponsors, and so different templates', () => {
  const report = buildReport({
    expenses: csv('Award,DrawAccount,Sponsor,CostCode,Cost\nA1,P,NIH,C1,1\nA2,P,DOL,C1,1', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory\nC1,Travel', 'dictionary'),
    templates: csv('Name,Default,Sponsor,Template\nHHS,yes,,hhs\nDOL,,DOL,dol', 'templates'),
  });
  assert.deepEqual(report.accounts.map((a) => a.sponsors), [['DOL', 'NIH']]);
  assert.deepEqual(report.accounts[0].awards.map((w) => w.justification), ['hhs', 'dol']);
  assert.deepEqual(report.warnings, []);
});

test('the Default template: the one ticked, else the first with no account or sponsor', () => {
  const build = (templates) =>
    buildReport({
      expenses: csv('Award,CostCode,Cost\nA1,C1,1', 'expenses'),
      dictionary: csv('CostCode,BudgetCategory\nC1,Travel', 'dictionary'),
      templates: csv(templates, 'templates'),
    });
  const older = build('Name,Template\nFirst,one\nSecond,two');
  assert.equal(older.accounts[0].awards[0].justification, 'one');
  assert.match(older.warnings.map((w) => w.text).join('\n'), /No template is marked Default, so First is used/);
  const two = build('Name,Default,Template\nFirst,,one\nSecond,TRUE,two\nThird,x,three');
  assert.equal(two.accounts[0].awards[0].justification, 'two');
  assert.match(two.warnings.map((w) => w.text).join('\n'), /More than one template is marked Default \(Second, Third\)/);
  assert.deepEqual(two.templates.map((t) => t.isDefault), [false, true, false]);
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
  assert.deepEqual([...sheets].map((sheet) => String(sheet.name)), ['Read me', 'ACCT-A', 'ACCT-B', 'ACCT-C', 'Unmapped codes']);
  const readMe = new Map([...sheets[0].grid].map((row) => [String(row[0] ?? ''), String(row[1] ?? '')]));
  assert.equal(readMe.get('Made'), '2026-11-07 09:05');
  assert.equal(readMe.get('Expenses file'), 'expenses.csv');
  assert.equal(readMe.get('Covers'), '4 awards in 3 draw accounts, $26,650.65 in all.');
  assert.equal(readMe.get('ACCT-B'), 'Draw account ACCT-B (PMS): 1 award.');
  assert.equal(readMe.get('ACCT-C'), 'Draw account ACCT-C (ASAP): 1 award.');
  assert.match(readMe.get('Unmapped codes'), /\$75\.00 in 1 code not in the dictionary: C900/);
});

test('each draw account has one payment system: its own row, else the row with no account', () => {
  // One agency can draw through several systems, so the sponsor doesn't decide it.
  const report = buildReport({
    expenses: csv('Award,DrawAccount,Sponsor,CostCode,Cost\nA1,X,DoD,C1,1\nA2,Y,DoD,C1,1\nA3,Z,NIH,C1,1', 'expenses'),
    dictionary: csv('CostCode,BudgetCategory\nC1,Travel', 'dictionary'),
    templates: csv('Default,Template\nTRUE,ok', 'templates'),
    systems: csv('Name,URL,DrawAccount\nPMS,https://pms.psc.gov/,\nWAWF,https://piee.eb.mil/,X\nOther,https://example.org/,Z\nBad,not a link,', 'systems'),
  });
  assert.deepEqual(
    report.accounts.map((a) => [a.account, a.paymentSystem?.name]),
    [
      ['X', 'WAWF'],
      ['Y', 'PMS'],
      ['Z', 'Other'],
    ]
  );
  assert.match(report.warnings.map((w) => w.text).join('\n'), /Row 5 \(Bad\) needs a URL starting with https/);
});

test('the sample sends ACCT-C to ASAP and the rest to PMS', () => {
  assert.deepEqual(sampleReport().accounts.map((a) => a.paymentSystem), [
    { name: 'PMS', url: 'https://pms.psc.gov/' },
    { name: 'PMS', url: 'https://pms.psc.gov/' },
    { name: 'ASAP', url: 'https://www.asap.gov/' },
  ]);
});
