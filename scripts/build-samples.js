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
  ['Award', 'DrawAccount', 'Sponsor', 'Program', 'Goal', 'Template'],
  ['AWD-1001', 'ACCT-A', 'Sponsor A', '', 'mapping groundwater recharge in the upper basin', ''],
  ['AWD-2001', 'ACCT-B', 'Sponsor B', 'Sample Workforce Program', 'training graduate students in field hydrology', ''],
  ['AWD-3001', 'ACCT-C', 'Sponsor C', '', 'monitoring soil moisture on working farms', ''],
];

// Each draw account's payment system and the link its Open button uses: ACCT-C
// is an ASAP account, the others are in PMS.
const accounts = [
  ['DrawAccount', 'PaymentSystem', 'URL', 'Template'],
  ['ACCT-A', 'PMS', 'https://pms.psc.gov/', ''],
  ['ACCT-B', 'PMS', 'https://pms.psc.gov/', ''],
  ['ACCT-C', 'ASAP', 'https://www.asap.gov/', ''],
];

// Which template each sponsor uses: HHS and NIH by default, the DOL format for Sponsor B.
const sponsors = [
  ['Sponsor', 'Template'],
  ['', 'HHS and NIH'],
  ['Sponsor A', ''],
  ['Sponsor B', 'DOL VETS'],
  ['Sponsor C', ''],
];

// The standard templates: the wording only.
const templates = [['Name', 'Template', 'MaxLength', 'Fallback'], ...STANDARD_TEMPLATES.map((t) => [t.name, t.text, t.maxLength, t.fallback ?? ''])];

const bytes = await writeXlsx(loadExcelJS(), [
  { name: README_SHEET, grid: readMeRows(), readMe: true },
  { name: 'Cost codes', grid: costCodes },
  { name: 'Awards', grid: awards },
  { name: 'Draw accounts', grid: accounts },
  { name: 'Sponsors', grid: sponsors },
  { name: 'Templates', grid: templates },
]);
writeFileSync(new URL('../docs/samples/dictionary.xlsx', import.meta.url), Buffer.from(bytes));
console.log('Wrote docs/samples/dictionary.xlsx');
