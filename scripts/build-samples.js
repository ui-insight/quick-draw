// Builds docs/samples/dictionary.xlsx, the made-up data dictionary workbook,
// from the rows below. Run with `npm run samples` after changing them.
// Uses the page's own copy of ExcelJS, so there is nothing to install.

import { writeFileSync } from 'node:fs';
import { loadExcelJS } from '../tests/exceljs.js';
import { writeXlsx } from '../docs/js/workbook.js';
import { README_SHEET, STANDARD_TEMPLATES, readMeRows } from '../docs/js/core.js';

const costCodes = [
  ['CostCode', 'BudgetCategory', 'Description', 'DrawAccount', 'Sponsor', 'Award'],
  ['C100', 'Salaries & Wages', 'personnel salaries', '', '', ''],
  ['C110', 'Fringe Benefits', 'employee benefits', '', '', ''],
  ['C200', 'Travel', 'project travel', '', '', ''],
  ['C300', 'Materials & Supplies', 'lab and field supplies', '', '', ''],
  ['C400', 'Other Direct Costs - Services', 'contracted services', '', '', ''],
  ['C410', 'Other Direct Costs - Services', 'equipment rental', '', '', ''],
  ['C410', 'Other Direct Costs - Equipment Rental', '', '', 'Sponsor B', ''],
  ['C200', '', 'travel to the annual project meeting', '', '', 'AWD-1001'],
];

const awards = [
  ['Award', 'Sponsor', 'DrawAccount', 'Program', 'Goal', 'Template'],
  ['AWD-1001', 'Sponsor A', 'ACCT-A', '', 'mapping groundwater recharge in the upper basin', ''],
  ['AWD-2001', 'Sponsor B', 'ACCT-B', 'Sample Workforce Program', 'training graduate students in field hydrology', ''],
];

// The standard templates. HHS and NIH is the default; Sponsor B's account uses the DOL format.
const sponsorFor = { 'DOL VETS': 'Sponsor B' };
const templates = [
  ['Name', 'DrawAccount', 'Sponsor', 'Template', 'MaxLength', 'Fallback'],
  ...STANDARD_TEMPLATES.map((t) => [t.name, '', sponsorFor[t.name] ?? '', t.text, t.maxLength, t.fallback ?? '']),
];

// Where payment requests go. PMS for everything by default; NSF shows a sponsor that draws elsewhere.
const systems = [
  ['Name', 'URL', 'DrawAccount', 'Sponsor'],
  ['PMS', 'https://pms.psc.gov/', '', ''],
  ['Research.gov', 'https://www.research.gov/', '', 'NSF'],
];

const bytes = await writeXlsx(loadExcelJS(), [
  { name: README_SHEET, grid: readMeRows(), readMe: true },
  { name: 'Cost codes', grid: costCodes },
  { name: 'Awards', grid: awards },
  { name: 'Templates', grid: templates },
  { name: 'Payment systems', grid: systems },
]);
writeFileSync(new URL('../docs/samples/dictionary.xlsx', import.meta.url), Buffer.from(bytes));
console.log('Wrote docs/samples/dictionary.xlsx');
