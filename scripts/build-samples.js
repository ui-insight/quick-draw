// Builds docs/samples/dictionary.xlsx, the made-up data dictionary workbook,
// from the rows below. Run with `npm run samples` after changing them.
// Uses the page's own copy of ExcelJS, so there is nothing to install.

import { writeFileSync } from 'node:fs';
import { loadExcelJS } from '../tests/exceljs.js';
import { writeXlsx } from '../docs/js/workbook.js';
import { README_SHEET, readMeRows } from '../docs/js/core.js';

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
  ['Award', 'Sponsor', 'DrawAccount', 'Goal', 'Template'],
  ['AWD-1001', 'Sponsor A', 'ACCT-A', 'mapping groundwater recharge in the upper basin', ''],
  ['AWD-2001', 'Sponsor B', 'ACCT-B', 'training graduate students in field hydrology', ''],
];

const templates = [
  ['Name', 'DrawAccount', 'Sponsor', 'Template', 'MaxLength'],
  [
    'Standard',
    '',
    '',
    'Payment for {{ costs }}, incurred {{ start }} through {{ end }} under award {{ award }}, for allowable costs in the approved budget to carry out {{ goal }}. Total ${{ total }}.',
    1000,
  ],
  [
    'Itemized with descriptions',
    '',
    'Sponsor B',
    'Drawdown for award {{ award }}: {% for c in categories %}{{ c.name }} ${{ c.amount }} ({{ c.codes | map("description") | join(", ") }}){% if not loop.last %}; {% endif %}{% endfor %}. Costs from {{ start }} to {{ end }} supporting {{ goal }}. Total ${{ total }}.',
    500,
  ],
  ['Short', '', '', 'Award {{ award }}: ${{ total }} for {{ goal }}.', 250],
];

const bytes = await writeXlsx(loadExcelJS(), [
  { name: README_SHEET, grid: readMeRows(), readMe: true },
  { name: 'Cost codes', grid: costCodes },
  { name: 'Awards', grid: awards },
  { name: 'Templates', grid: templates },
]);
writeFileSync(new URL('../docs/samples/dictionary.xlsx', import.meta.url), Buffer.from(bytes));
console.log('Wrote docs/samples/dictionary.xlsx');
