// The two guides: one page on templates (the ? on the Templates tab) and one
// page on loops (the ? in the loop window). Every example is rendered by the
// real template engine, with the same colored blocks the editor uses, so what
// a guide shows is what Quick Draw would write.

import { COLUMN_HELP, EXCLUDE, GLOSSARY, GOAL_MARKER, STANDARD_TEMPLATES, compileTemplate, parseDay, templateValues } from './core.js';
import { builderNodes } from './blocks.js';
import { writeLoop } from './loopsyntax.js';
import { el, fill } from './dom.js';

// ------------------------------------------------------- example awards

const exampleAward = (name, categories, { start = '2026-07-03', end = '2026-08-14', goal = '' } = {}) => {
  const cats = categories.map(([category, codes]) => ({
    name: category,
    cents: codes.reduce((sum, [, cents]) => sum + cents, 0),
    codes: codes.map(([code, cents, description]) => ({ code, cents, description })),
  }));
  return templateValues(
    {
      award: name,
      start: start ? parseDay(start) : null,
      end: end ? parseDay(end) : null,
      totalCents: cats.reduce((sum, c) => sum + c.cents, 0),
      goal,
      categories: cats,
    },
    'ACCT-A',
    'Sponsor A'
  );
};

const AWARD_A = exampleAward(
  'AWD-1001',
  [
    ['Fringe Benefits', [['C110', 260400, 'employee benefits']]],
    ['Materials & Supplies', [['C300', 14810, 'lab and field supplies']]],
    [
      'Salaries & Wages',
      [
        ['C100', 600000, 'faculty salaries'],
        ['C105', 240000, 'graduate student wages'],
      ],
    ],
    ['Travel', [['C200', 61245, 'conference travel']]],
  ],
  { goal: 'mapping groundwater recharge in the upper basin' }
);

const AWARD_B = exampleAward(
  'AWD-2001',
  [
    ['Salaries & Wages', [['C100', 360000, 'faculty salaries']]],
    ['Travel', [['C200', 95000, 'field travel']]],
  ],
  { start: '2026-07-01', end: '2026-07-31', goal: 'training graduate students in field hydrology' }
);

const AWARD_NO_GOAL = { ...AWARD_A, goal: GOAL_MARKER };
const AWARD_NO_DATES = { ...AWARD_B, start: '', end: '' };

// -------------------------------------------------------------- pieces

const OPEN = '';
const CLOSE = '';

/** The template's output, with every filled-in value tinted like its block. */
const rendered = (template, values) => {
  const marked = template.replace(/\{\{[\s\S]*?\}\}/g, (m) => `${OPEN}${m}${CLOSE}`);
  const compiled = compileTemplate(marked);
  const result = compiled.error ? compiled : compiled.render(values);
  if (result.error) return el('span', { class: 'error-text' }, result.error.detail);
  const nodes = [];
  for (const [i, piece] of result.text.split(new RegExp(`${OPEN}|${CLOSE}`)).entries()) {
    if (!piece) continue;
    nodes.push(i % 2 ? el('span', { class: 'filled' }, piece) : piece);
  }
  return nodes;
};

const plainLength = (template, values) => {
  const compiled = compileTemplate(template);
  const result = compiled.error ? { text: '' } : compiled.render(values);
  return result.text?.length ?? 0;
};

/** A template shown as blocks, read-only, the way the Builder shows it. */
const blocks = (template) => el('div', { class: 'visual-input guide-blocks', inert: true }, builderNodes(template));

/**
 * One worked example: the template as blocks, then what it becomes for one or
 * more awards, with the Jinja behind it a click away.
 */
const example = (template, outputs, { limit = null } = {}) =>
  el(
    'div',
    { class: 'guide-example' },
    el('p', { class: 'guide-label' }, 'Template'),
    blocks(template),
    outputs.map(({ label, values }) =>
      el(
        'div',
        { class: 'guide-output' },
        el(
          'p',
          { class: 'guide-label' },
          label,
          limit ? el('span', { class: 'count' }, ` · ${plainLength(template, values)} / ${limit} characters`) : null
        ),
        el('div', { class: 'preview-text' }, rendered(template, values))
      )
    ),
    el('details', { class: 'guide-jinja' }, el('summary', {}, 'See it as Jinja'), el('pre', { class: 'help-code' }, template))
  );

const chip = (kind, label) => el('span', { class: `chip chip-${kind}` }, label);
const b = (text) => el('strong', {}, text);
const p = (...children) => el('p', {}, ...children);

/** A still picture of the loop window, with its settings filled in. */
const loopWindow = ({ path, title, noun, item, between = '', beforeLast = '' }) =>
  el(
    'div',
    { class: 'guide-loop', inert: true },
    el('ol', { class: 'crumbs' }, path.map((step) => el('li', {}, step))),
    el('p', { class: 'guide-loop-title' }, title),
    el('p', { class: 'guide-label' }, `Write this once; it repeats for each ${noun}:`),
    blocks(item),
    el(
      'div',
      { class: 'guide-loop-settings' },
      el('label', {}, 'Between items', el('input', { type: 'text', value: between, placeholder: 'Nothing', readOnly: true })),
      el('label', {}, 'Before the last item', el('input', { type: 'text', value: beforeLast, placeholder: 'Nothing', readOnly: true }))
    )
  );

// ------------------------------------------------------------ templates

const CATEGORY_ITEM = '{{ c.name }} ${{ c.amount }}';
const LOOP_RUN_TOGETHER = writeLoop({ target: 'c', iter: 'categories', item: CATEGORY_ITEM });
const LOOP_LISTED = writeLoop({ target: 'c', iter: 'categories', item: CATEGORY_ITEM, between: ', ', beforeLast: 'and ' });
const CODE_LOOP = writeLoop({ target: 'code', iter: 'c.codes', item: '{{ code.description }}', between: ', ' });
const LOOP_NESTED = writeLoop({ target: 'c', iter: 'categories', item: `${CATEGORY_ITEM} (${CODE_LOOP})`, between: '; ' });
const DATES_IF = '{% if start %}, incurred {{ start }} through {{ end }}{% endif %}';
const FULL = `Payment under award {{ award }} for ${LOOP_LISTED}${DATES_IF}, to carry out {{ goal }}. Total \${{ total }}.`;

const section = (id, title, ...children) => el('section', { class: 'guide-section', id }, el('h3', {}, title), ...children);

const TEMPLATES_GUIDE = {
  kicker: 'Guide',
  title: 'Writing a justification template',
  sections: () => [
    section(
      'g-idea',
      'A template is your sentence, with blanks',
      p(
        'Most justifications say the same thing every time: what the money paid for, when, and why. Only the details change from award to award. A template is that sentence written once, with ',
        b('blanks'),
        ' where the details go. Quick Draw fills them in for each award.'
      ),
      p('Here is a short template and what it becomes for two awards. The tinted parts are what Quick Draw filled in.'),
      example('Drawdown for award {{ award }}: ${{ total }}.', [
        { label: 'For AWD-1001', values: AWARD_A },
        { label: 'For AWD-2001', values: AWARD_B },
      ])
    ),
    section(
      'g-values',
      'Values: the blue blocks',
      p(
        'Each blank is a ',
        b('value'),
        ', a blue block such as ',
        chip('value', 'Award'),
        ', ',
        chip('value', 'Total'),
        ' or ',
        chip('value', 'Award’s goal'),
        '. Everything around them is ordinary text you type. To add a value, drag its block from the list on the left into your text, or click in your text and then click the block. A block moves and deletes as one piece.'
      ),
      p(
        'Amounts come without a dollar sign, so type the $ yourself. ',
        chip('value', 'Award’s goal'),
        ' is a few words you keep for each award in the dictionary, saying what the award is for. Without one, the justification says ',
        el('code', {}, GOAL_MARKER),
        ' and the Report tab flags it.'
      ),
      example('Drawdown for award {{ award }} totaling ${{ total }}, for costs from {{ start }} to {{ end }}, to carry out {{ goal }}.', [
        { label: 'For AWD-1001', values: AWARD_A },
        { label: 'Without a goal yet', values: AWARD_NO_GOAL },
      ])
    ),
    section(
      'g-loops',
      'Loops: lists that fit each award',
      p(
        'A justification usually lists where the money went: each budget category and its amount. But awards don’t spend in the same number of categories. AWD-1001 spent in four this month, AWD-2001 in two, and next month it changes. A sentence with a fixed number of blanks can’t fit them all.'
      ),
      p(
        'A ',
        b('loop'),
        ' solves this. You write how ',
        b('one'),
        ' item should read, and Quick Draw repeats it for every item the award has, however many there are. It’s a mail merge for a list inside your sentence. One template, the right length for every award:'
      ),
      el(
        'div',
        { class: 'guide-compare' },
        el('div', {}, el('p', { class: 'guide-label' }, 'AWD-1001: four categories'), el('div', { class: 'preview-text' }, rendered(LOOP_LISTED, AWARD_A))),
        el('div', {}, el('p', { class: 'guide-label' }, 'AWD-2001: two categories'), el('div', { class: 'preview-text' }, rendered(LOOP_LISTED, AWARD_B)))
      ),
      p(
        'Loops are green blocks. In your text, a loop shows as a single block, such as ',
        chip('loop', '↻ For each category: Category name $Category amount, …'),
        '. You can loop over the budget categories, or over the cost codes. A loop can hold another loop, for example to name the codes inside each category.'
      ),
      p(
        'Don’t need that much control? ',
        chip('value', 'All costs as text'),
        ' is a ready-made list of every category and amount, separated by commas. Use a loop when you want to choose the wording: "and" before the last item, semicolons, or the codes behind each category.'
      )
    ),
    section(
      'g-start',
      'Getting started',
      el(
        'ol',
        { class: 'guide-steps' },
        el(
          'li',
          {},
          b('Start from a standard.'),
          ' Open the template for your sponsor (',
          b('HHS and NIH'),
          ', ',
          b('DOL VETS'),
          ' or ',
          b('NASA'),
          '), each shaped by that agency’s requirements, and use ',
          b('Add as new template'),
          ' to make your own copy. ',
          b('+ New template'),
          ' starts a blank one.'
        ),
        el('li', {}, b('Change the words'), ' until they sound like you. Delete what you don’t need, and drag in the values you do.'),
        el('li', {}, b('Add a loop'), ' if you want a list: add ', chip('loop', 'Each category'), ' from Loops, then ', b('click it'), ' to write how one category reads and what goes between them. The ? in that window explains loops in detail.'),
        el('li', {}, b('Check the preview'), ' below the editor. Pick different awards, especially long ones, and set the ', b('Character limit'), ' to your payment system’s.'),
        el('li', {}, b('Save the dictionary'), ' to keep the template. Templates live on its Templates sheet.')
      ),
      p('Here is a full template built that way: values, a loop with commas and "and", dates that appear only when there are some, and the goal.'),
      example(FULL, [{ label: 'For AWD-1001', values: AWARD_A }], { limit: 1000 })
    ),
    section(
      'g-more',
      'Good to know',
      el(
        'ul',
        { class: 'guide-legend' },
        el('li', {}, chip('value', 'Award'), ' Blue blocks are ', b('values'), ', filled in for each award.'),
        el('li', {}, chip('loop', 'For each category'), ' Green blocks are ', b('loops'), ', written once and repeated for each item. Click one to change it.'),
        el('li', {}, chip('logic', 'If there are dates'), ' Purple blocks are ', b('conditions'), ': text that appears only when something is there. ', b('Only if there are dates'), ' in Helpers is ready-made; other conditions are written in the Jinja view for now.')
      ),
      p(
        b('Which template an award uses:'),
        ' set in the data dictionary’s Template columns. The first one found wins: the award’s own (on Awards, or with the Template menu on the Report), else its draw account’s, else its sponsor’s, else the default, on the Sponsors row with Sponsor blank. The line under a template’s name says who uses it.'
      ),
      p(
        b('When something is wrong,'),
        ' a message under the editor says what and where, and ',
        b('Show me'),
        ' puts the cursor on it. ',
        b('Builder'),
        ' and ',
        b('Jinja'),
        ' are two views of the same template; Jinja is the text saved in your dictionary.'
      )
    ),
  ],
};

// ---------------------------------------------------------------- loops

const LOOPS_GUIDE = {
  kicker: 'Guide',
  title: 'Loops in detail',
  sections: () => [
    section(
      'l-what',
      'What this window does',
      p(
        'A loop writes the same words once for each item in a list. In this window you write the words for ',
        b('one'),
        ' item, using that item’s blocks, and Quick Draw repeats them for every item the award has.'
      ),
      loopWindow({ path: ['Template', 'Each budget category'], title: 'Each budget category', noun: 'category', item: CATEGORY_ITEM }),
      p('The window’s preview shows the whole list for the award selected in the template preview.')
    ),
    section(
      'l-between',
      'Between items, and before the last',
      p('With nothing between them, the items run together:'),
      example(LOOP_RUN_TOGETHER, [{ label: 'For AWD-1001', values: AWARD_A }]),
      p(
        b('Between items'),
        ' goes between one item and the next, such as a comma and a space. ',
        b('Before the last item'),
        ' goes in front of the last one, such as "and ", so the list reads like a sentence: two items become "A and B", three or more "A, B, and C". Spaces count, so ", " is a comma and a space. The buttons beside each setting fill in the common choices.'
      ),
      loopWindow({ path: ['Template', 'Each budget category'], title: 'Each budget category', noun: 'category', item: CATEGORY_ITEM, between: ', ', beforeLast: 'and ' }),
      example(LOOP_LISTED, [
        { label: 'For AWD-1001', values: AWARD_A },
        { label: 'For AWD-2001', values: AWARD_B },
      ]),
      p(b('If there are none'), ' is written instead of the list when the award has no items to list. Leave it blank to write nothing.')
    ),
    section(
      'l-what-over',
      'What to repeat for',
      p(b('Repeat for'), ' at the top of the window chooses the list:'),
      el(
        'ul',
        {},
        el('li', {}, b('Each budget category'), ': one item per category, with ', chip('value', 'Category name'), ', ', chip('value', 'Category amount'), ' and ', chip('value', 'Category’s descriptions'), '.'),
        el('li', {}, b('Each cost code on the award'), ': one item per cost code, across all categories, with ', chip('value', 'Cost code'), ', ', chip('value', 'Code amount'), ', ', chip('value', 'Code description'), ' and ', chip('value', 'Code’s category'), '.'),
        el('li', {}, b('Each cost code in this category'), ': only inside a category loop; the codes behind that one category.')
      ),
      p('The block list on the left changes to match: it only offers blocks that make sense for one item of that list. Award values such as ', chip('value', 'Award'), ' are always there too.')
    ),
    section(
      'l-nested',
      'A loop inside a loop',
      p(
        'A category is often several cost codes: Salaries & Wages might be faculty salaries and graduate student wages. To name them, add ',
        chip('loop', 'Each code in this category'),
        ' inside the category loop. It shows as a block in the category’s text. Click it and a second window opens on top, one level deeper; the path at the top shows where you are, and Done takes you back up.'
      ),
      loopWindow({
        path: ['Template', 'Each budget category', 'Each cost code in this category'],
        title: 'Each cost code in this category',
        noun: 'cost code',
        item: '{{ code.description }}',
        between: ', ',
      }),
      example(LOOP_NESTED, [{ label: 'For AWD-1001', values: AWARD_A }]),
      p('Inside the inner loop, ', chip('value', 'Category name'), ' and ', chip('value', 'Category amount'), ' still refer to the category around it.')
    ),
    section(
      'l-number',
      'Numbering items',
      p(chip('value', 'Item number'), ' is 1 for the first item, 2 for the second, and so on, for numbered lists:'),
      example(writeLoop({ target: 'c', iter: 'categories', item: '({{ loop.index }}) {{ c.name }} ${{ c.amount }}', between: '; ' }), [{ label: 'For AWD-1001', values: AWARD_A }])
    ),
    section(
      'l-jinja',
      'The same loop in Jinja',
      p(
        'The window writes an ordinary Jinja loop, which is what the Jinja view shows and your dictionary saves. ',
        el('code', {}, '{% for c in categories %}'),
        ' starts it and ',
        el('code', {}, '{% endfor %}'),
        ' ends it; ',
        el('code', {}, 'c'),
        ' is the item. The separators are conditions on ',
        el('code', {}, 'loop.last'),
        ' and ',
        el('code', {}, 'loop.first'),
        ':'
      ),
      el('pre', { class: 'help-code' }, LOOP_LISTED),
      p('A loop you write by hand in the Jinja view still opens in this window. If its separators follow this pattern they show as settings; otherwise its text is shown and edited as it is.')
    ),
  ],
};

// --------------------------------------------------------------- window

// ---------------------------------------------------------------- about

const link = (href, text) => el('a', { href, target: '_blank', rel: 'noopener' }, text);

/** Federal payment systems recipients draw from. */
export const PAYMENT_SYSTEMS = [
  {
    name: 'Payment Management System (PMS)',
    short: 'PMS',
    url: 'https://pms.psc.gov/',
    who: 'HHS’s system. HHS agencies, including NIH, pay through it, and so do other agencies such as NASA and DOL. This is where the justification field is.',
  },
  {
    name: 'Automated Standard Application for Payments (ASAP)',
    short: 'ASAP',
    url: 'https://www.asap.gov/',
    who: 'The Treasury’s system, used by several other agencies.',
  },
  {
    name: 'Research.gov',
    short: 'Research.gov',
    url: 'https://www.research.gov/',
    who: 'NSF’s site, where NSF recipients request payments.',
  },
];

// When the requirements on this page were last checked against the sources. Update after each review.
export const REQUIREMENTS_REVIEWED = 'November 7, 2026';

// Copies kept in the repo, served beside the page, in case an agency moves its file.
const SAVED = {
  hhs: 'references/hhs-payment-justification-guidance-2026-10-07.pdf',
  dol: 'references/dol-vets-go-memo-02-26-pms-payment-justification-2026-04-17.pdf',
};
const savedCopy = (key) => [' (', link(SAVED[key], 'saved copy'), ')'];

const SOURCES = {
  hhs: 'https://www.hhs.gov/sites/default/files/asfr-payment-justification-guidance-hhs-recipients.pdf',
  pms: 'https://pms.psc.gov/',
  eo: 'https://www.govinfo.gov/content/pkg/FR-2025-03-03/html/2025-03527.htm',
  nih: 'https://grants.nih.gov/grants/policy/nihgps/HTML5/section_6/6.1_nih_payment_review_process.htm',
  nasa: 'https://www.nasa.gov/wp-content/uploads/2025/06/gic-25-01-grant-payment-justifications.pdf',
  dol: 'https://www.dol.gov/sites/dolgov/files/VETS/files/GO_Memo_02-26_PMS_Mandatory_Payment_Justification.pdf',
  acf: 'https://content.govdelivery.com/attachments/USACFOCC/2025/04/22/file_attachments/3237925/Defend%20the%20Spend%20Recipient%20Comms%20FINAL%204.22.25.pdf',
};

// The HHS / NIH standard template, the one the sample dictionary uses by default.
const ABOUT_TEMPLATE = STANDARD_TEMPLATES[0].text;

const q = (text) => el('blockquote', { class: 'guide-quote' }, text);
const qList = (items) => el('blockquote', { class: 'guide-quote' }, el('ul', {}, items.map((item) => el('li', {}, item))));

/** HHS's own words, quoted from the guidance, for the window behind "Read HHS's wording". */
const HHS_WORDING = {
  kicker: 'HHS’s wording',
  title: 'Payment Justification Guidance for HHS Recipients',
  lead: () =>
    el(
      'div',
      { class: 'source-box' },
      el(
        'p',
        {},
        'Quoted from version 1.0, published October 7, 2026, as of ',
        REQUIREMENTS_REVIEWED,
        '. HHS may have revised it since: ',
        b('read the current version on hhs.gov'),
        ' before relying on these quotes.'
      ),
      el(
        'div',
        { class: 'source-links' },
        el('a', { class: 'button small', href: SOURCES.hhs, target: '_blank', rel: 'noopener' }, 'Open the official guidance ↗'),
        el('a', { class: 'button small secondary', href: SAVED.hhs, target: '_blank', rel: 'noopener' }, 'Saved copy (October 7, 2026)')
      )
    ),
  sections: () => [
    section(
      'h-purpose',
      'Purpose',
      q('HHS requires discretionary grant or cooperative agreement recipients to submit a justification with each payment request. HHS reviews payment justifications to help ensure Federal funds are used for the purposes of their awards and in accordance with the terms and conditions of award and all applicable laws, regulations, and policy requirements.')
    ),
    section(
      'h-standard',
      'Standard for a sufficient payment justification',
      q('A payment justification must provide enough information for HHS to understand what the recipient is requesting payment for and how the cost or activity relates to the award.'),
      q('All payment requests must be for allowable costs and activities consistent with the terms and conditions of the award and applicable laws, regulations, and policies.')
    ),
    section(
      'h-include',
      'Information a payment justification must include',
      qList([
        'identify and describe the cost or activity consistent with applicable award requirements;',
        'explain how the cost or activity supports the objectives and goals of the award;',
        'include the timeframe when costs were incurred, as appropriate;',
        'use plain language;',
        'exclude confidential, sensitive, or personally identifiable information;',
        'follow any additional payment justification requirements issued by your HHS Division, as applicable.',
      ]),
      q('Where a payment request contains multiple subaccounts, the justification associated with each subaccount must describe the costs or activities attributable to that subaccount. If a subaccount includes multiple types of costs, the justification should clearly summarize each type.'),
      q('A justification must provide sufficient information to meet these requirements within the character limit available in PMS.')
    ),
    section(
      'h-examples',
      'Examples',
      el('p', { class: 'guide-label' }, 'Insufficient'),
      q('“Payment for staff salaries for July through September.” This justification identifies the cost and timeframe but does not explain how the personnel costs support the award.'),
      el('p', { class: 'guide-label' }, 'Sufficient'),
      q('“Payment for salary and fringe benefits for project staff from July through September to conduct the community outreach activities supported by this award.” This justification identifies the cost, timeframe, award activity, and connection to the award.'),
      el('p', { class: 'guide-label' }, 'Also sufficient'),
      qList([
        '“Payment for equipment purchased in August, identified in the approved budget, that will be used to conduct laboratory testing under the award.”',
        '“Payment for indirect facilities and administrative costs, calculated using the approved negotiated indirect cost rate agreement, that support essential operations for activities under this award during the current budget period.”',
      ])
    ),
    section(
      'h-sensitive',
      'Protecting sensitive information',
      q('Do not include confidential, sensitive, or personally identifiable information (PII) in a payment justification.'),
      q('If HHS identifies prohibited sensitive information in a justification, HHS will require the recipient to remove the information and provide a revised justification.')
    ),
    section(
      'h-review',
      'HHS review of justifications',
      q('Based on the available information, HHS will:'),
      qList([
        'approve the request when the available information provides a sufficient basis to determine that the payment appropriately relates to the award and meets applicable requirements;',
        'request for additional information when additional information is needed to make a determination; or',
        'reject the request when the available information establishes that the payment cannot be approved, including when requested costs are unallowable or inconsistent with award restrictions.',
      ]),
      q('Approval of a payment request does not constitute a final HHS determination of cost allowability.')
    ),
  ],
};

/** Sends people to the agencies' own pages, and says when this page was last checked. */
const sourceBox = () =>
  el(
    'div',
    { class: 'source-box' },
    el('p', { class: 'source-title' }, 'Read it at the source'),
    el(
      'div',
      { class: 'source-links' },
      el('a', { class: 'button small', href: SOURCES.hhs, target: '_blank', rel: 'noopener' }, 'HHS guidance ↗'),
      el('a', { class: 'button small secondary', href: SOURCES.nih, target: '_blank', rel: 'noopener' }, 'NIH policy ↗'),
      el('a', { class: 'button small secondary', href: SOURCES.pms, target: '_blank', rel: 'noopener' }, 'PMS ↗')
    ),
    el(
      'p',
      { class: 'muted small' },
      `This page was last checked against its sources on ${REQUIREMENTS_REVIEWED}. Requirements change, and your agency or Notice of Award may add its own, so read the current version at the source before relying on this summary.`
    )
  );

const wordingButton = (label = 'Read HHS’s wording') =>
  el('button', { type: 'button', class: 'button small secondary', onclick: () => openGuide('hhs') }, label);

const ABOUT_GUIDE = {
  kicker: 'Requirements',
  title: 'Drawdown justification requirements',
  lead: () =>
    el(
      'div',
      { class: 'guide-standard' },
      el('p', { class: 'guide-label' }, 'The HHS standard'),
      el(
        'p',
        { class: 'guide-standard-text' },
        'A payment justification must provide enough information for HHS to understand what the recipient is requesting payment for and how the cost or activity relates to the award.'
      ),
      el('p', { class: 'muted small' }, link(SOURCES.hhs, 'Payment Justification Guidance for HHS Recipients'), ', version 1.0, October 7, 2026')
    ),
  after: () => sourceBox(),
  sections: () => [
    section(
      'a-rule',
      'The requirement',
      p(
        'Since March 17, 2025, every payment request in the HHS ',
        link(SOURCES.pms, 'Payment Management System (PMS)'),
        ' needs a justification for each grant subaccount, up to ',
        b('1,000 characters'),
        ', and is reviewed before it is paid. It comes from ',
        link(SOURCES.eo, 'Executive Order 14222'),
        ', section 3(a). HHS agencies, including NIH, apply it, and so do other agencies that pay through PMS.'
      )
    ),
    section(
      'a-contents',
      'What it must include',
      p('In HHS’s words, at a minimum, a payment justification must:'),
      qList([
        'identify and describe the cost or activity consistent with applicable award requirements;',
        'explain how the cost or activity supports the objectives and goals of the award;',
        'include the timeframe when costs were incurred, as appropriate;',
        'use plain language;',
        'exclude confidential, sensitive, or personally identifiable information;',
        'follow any additional payment justification requirements issued by your HHS Division, as applicable.',
      ]),
      p('Each subaccount’s justification describes its own costs, summarizing each type, within the PMS character limit.'),
      p(wordingButton(), el('span', { class: 'muted small' }, ' Examples of sufficient and insufficient justifications, sensitive information, and how HHS reviews them.'))
    ),
    section(
      'a-review',
      'What happens to it',
      p('HHS approves the request, asks for more information, or rejects it. Approval is not a final ruling on allowability, and vague justifications bring requests for more information, which delay payment.'),
      p(
        b('Justifications can be public.'),
        ' DOL notes that justifications and approval comments are posted at ',
        link('https://www.doge.gov/payments', 'doge.gov/payments'),
        '. Write for any reader, and keep personal information out.'
      )
    ),
    section(
      'a-others',
      'Other agencies',
      p(
        'Other agencies, payment systems and sponsors ask for justifications too, with different character or word limits and different levels of detail. ',
        link(SOURCES.nasa, 'NASA'),
        ' asks for the amount, the approved budget category and why. ',
        link(SOURCES.dol, 'DOL VETS'),
        ' asks for the program, the date range, and each budget category with its own amount, adding up to the total. Quick Draw focuses on HHS because it covers NIH, the largest federal funder of university research; for other sponsors, use a template worded to their rules and set its character limit. Quick Draw counts characters, not words.'
      )
    ),
    section(
      'a-help',
      'How Quick Draw helps',
      p(
        'Writing each justification by hand means pulling an award’s expenses, grouping them into the sponsor’s categories, totaling them and describing them, for every award and every draw. Quick Draw does the grouping and totaling and drafts each one from your wording; you review and edit before you use it.'
      ),
      el(
        'table',
        { class: 'help-table guide-map' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Required'), el('th', {}, 'In Quick Draw'))),
        el(
          'tbody',
          {},
          [
            ['The cost or activity', 'Cost codes grouped into budget categories, with their descriptions'],
            ['How it supports the award', 'Each award’s Goal, from the Awards sheet'],
            ['When', 'The earliest and latest dates of the award’s costs'],
            ['Plain language', 'Your own template wording'],
            ['No personal information', 'Only your template, descriptions and goals are written; keep names out of them'],
            ['Agency rules and limits', 'A standard template per agency, each with its character limit and a shorter fallback'],
          ].map(([ask, answer]) => el('tr', {}, el('td', {}, b(ask)), el('td', {}, answer)))
        )
      ),
      example(ABOUT_TEMPLATE, [{ label: 'Drafted for AWD-1001 with the HHS / NIH standard template', values: AWARD_A }], { limit: 1000 })
    ),
    section(
      'a-systems',
      'Payment systems',
      el('ul', { class: 'guide-links' }, PAYMENT_SYSTEMS.map((s) => el('li', {}, link(s.url, s.name), ': ', s.who))),
      p('One agency can use more than one: within DoD, ONR takes payment requests through WAWF while other offices use PMS, and within USDA, NIFA uses ASAP. So the Draw accounts sheet of your data dictionary says which system each draw account uses, and the Report groups draw accounts by system. The Open button beside each justification goes there.')
    ),
    section(
      'a-sources',
      'Sources',
      el(
        'ul',
        { class: 'guide-links' },
        el('li', {}, link(SOURCES.hhs, 'Payment Justification Guidance for HHS Recipients'), ' (HHS, v1.0, October 7, 2026)', savedCopy('hhs')),
        el('li', {}, link(SOURCES.eo, 'Executive Order 14222'), ', 90 FR 11095, section 3(a)'),
        el('li', {}, link(SOURCES.nih, 'NIH Grants Policy Statement 6.1, NIH Payment Review Process')),
        el('li', {}, link(SOURCES.nasa, 'NASA Grant Information Circular 25-01'), ' (June 16, 2025)'),
        el('li', {}, link(SOURCES.dol, 'DOL VETS Grant Officer’s Memorandum 02-26'), ' (April 17, 2026)', savedCopy('dol')),
        el('li', {}, link(SOURCES.acf, 'PMS updated payment processing steps'), ' (notice to ACF recipients, April 22, 2025)')
      ),
      p(
        'PMS help: ',
        link('mailto:PMSSupport@psc.hhs.gov', 'PMSSupport@psc.hhs.gov'),
        ', 1-877-614-5533. Questions about an award: the Grants Management Specialist on your Notice of Award.'
      ),
      p(
        el(
          'span',
          { class: 'muted small' },
          `Last checked against these sources on ${REQUIREMENTS_REVIEWED}. Quick Draw is independent and not affiliated with any agency; the agency’s own page is always the authority.`
        )
      )
    ),
  ],
};

// ---------------------------------------------------------------- export

const EXPORT_GUIDE = {
  kicker: 'Guide',
  title: 'What to export from your financial system',
  lead: () =>
    el(
      'div',
      { class: 'guide-standard' },
      el('p', { class: 'guide-label' }, 'In short'),
      el('p', { class: 'guide-standard-text' }, 'Export only the costs in this draw: one row per expense, with the date each was incurred.'),
      el('p', { class: 'muted small' }, 'The justification’s amounts and dates come straight from this file, so it has to match what you are drawing.')
    ),
  sections: () => [
    section(
      'x-columns',
      'The columns',
      el(
        'table',
        { class: 'help-table guide-map' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Column'), el('th', {}, 'What to put in it'))),
        el(
          'tbody',
          {},
          [
            ['Award', 'Required. The award number, written the same way as on the Awards sheet. Usually the grant or document number that is your PMS subaccount.'],
            ['CostCode', 'Required. Your expense or object code, as listed on the Cost codes sheet.'],
            ['Cost', 'Required. The amount. Credits and reversals as negative amounts.'],
            ['CostDate', 'Recommended. The date the cost was incurred, such as the transaction or posting date. The earliest and latest become the justification’s timeframe, which HHS asks for.'],
            ['DrawAccount', 'Optional. The payment-system account. Leave it out if the Awards sheet has it.'],
            ['Sponsor', 'Optional. Leave it out if the Awards sheet has it.'],
          ].map(([column, text]) => el('tr', {}, el('td', {}, el('code', {}, column)), el('td', {}, text)))
        )
      ),
      p('Other columns are ignored, so a wider export works. An Excel file or a CSV both work; only the first sheet of a workbook is read.')
    ),
    section(
      'x-which',
      'Which costs to include',
      el(
        'ul',
        {},
        el('li', {}, b('Only this draw’s costs:'), ' from the day after your last draw through the costs you are drawing for now. An inception-to-date or year-to-date export would claim costs already paid, and give the wrong dates.'),
        el('li', {}, b('Indirect costs (F&A),'), ' if you draw them, as their own rows with their own cost code. Map that code to the indirect cost category on the Cost codes sheet.'),
        el('li', {}, b('Credits and reversals,'), ' so the totals match what you are actually requesting.'),
        el('li', {}, b('Not'), ' cost share, program income, or costs you don’t intend to draw. Leave them out of the export, or give their codes the category ', el('code', {}, 'Exclude'), '.')
      ),
      p('Check that each award’s total in the Report tab matches the amount you will request in the payment system.')
    ),
    section(
      'x-detail',
      'How much detail',
      p(
        'One row per transaction is best: it gives exact dates. If your system can only export totals by award and cost code, that works too; use the last date of the period as the CostDate, or leave dates out and choose a template without them.'
      ),
      p(
        'Quick Draw never writes the payee, the employee, or any other column into a justification, only budget categories, your descriptions and your template’s words. Still, an export with fewer columns is easier to handle safely, so leave out names and IDs you don’t need.'
      )
    ),
    section(
      'x-subaccounts',
      'Awards and subaccounts',
      p(
        'Justifications are written for each subaccount, so each award in Quick Draw should be one subaccount. If your financial system splits one award into several funds or projects, give them all the same Award value in the export so they total together, or keep them apart if they draw from different subaccounts.'
      ),
      p('Several agencies suggest a separate payment request for each subaccount, so one that needs more information doesn’t hold up the others.')
    ),
  ],
};

// ------------------------------------------------------------ dictionary

const columnTable = (help) =>
  el('table', { class: 'help-table guide-map' }, el('tbody', {}, Object.entries(help).map(([column, text]) => el('tr', {}, el('td', {}, el('code', {}, column)), el('td', {}, text)))));

const CODES_GUIDE = {
  kicker: 'Guide',
  title: 'The data dictionary',
  sections: () => [
    section(
      'd-sheets',
      'What it holds',
      p('One Excel workbook you keep and bring back each time. Quick Draw finds each sheet by its columns, so the names and order don’t matter. The tabs go from most to least specific: an award sits in one draw account, and its sponsor is a broader grouping.'),
      el(
        'ul',
        {},
        el('li', {}, b('Cost codes'), ': each cost code’s sponsor budget category and description.'),
        el('li', {}, b('Awards'), ': each award’s draw account, sponsor, goal and, optionally, its template.'),
        el('li', {}, b('Draw accounts'), ': each account’s payment system and, optionally, a template for all its awards.'),
        el('li', {}, b('Sponsors'), ': the template each sponsor’s awards use, and the default.'),
        el('li', {}, b('Templates'), ': the justification wording, edited on the Templates tab.'),
        el('li', {}, b('Read me'), ': explains the workbook; Quick Draw skips it.')
      )
    ),
    section('d-columns', 'Cost codes: the columns', columnTable(COLUMN_HELP.dictionary)),
    section(
      'd-rows',
      'Why a code can have more than one row',
      p(
        'List each code once with DrawAccount and Sponsor blank. That row applies ',
        b('everywhere'),
        '. Add another row for the same code only where one draw account or sponsor puts it in a different category. For each expense, Quick Draw uses the row for its draw account if there is one, else the row for its sponsor, else the everywhere row. The ',
        b('Applies to'),
        ' column on the Data dictionary tab shows which is which.'
      )
    ),
    section(
      'd-award',
      'A description for one award',
      p(
        'To describe a code differently for one award, add a row with the CostCode, the Award and the new Description, and leave BudgetCategory blank. The easy way: on the Report tab, open the award and choose ',
        b('Describe these codes differently for this award'),
        '. Quick Draw adds the rows for you.'
      )
    ),
    section('d-exclude', 'Leaving costs out', p(`A BudgetCategory of ${EXCLUDE} leaves that code’s costs out of every total, such as costs that can’t be drawn down.`)),
    section(
      'd-missing',
      'Codes and awards that are missing',
      p(
        'When the expenses have a cost code or award the dictionary doesn’t, Quick Draw adds a row for it, highlighted at the top of the table with what it already knows filled in. Fill in the highlighted cell: the BudgetCategory for a code, the Goal for an award. Point at a highlighted row to see why it’s there.'
      )
    ),
    section('d-awards', 'Awards: the columns', columnTable(COLUMN_HELP.awards)),
    section(
      'd-accounts',
      'Draw accounts: the columns',
      columnTable(COLUMN_HELP.accounts),
      p('Each draw account belongs to one payment system: its own row’s, else the row with DrawAccount blank, else PMS. It goes by draw account, not sponsor, because one sponsor can use several systems. The Report’s top row of tabs groups accounts by system.')
    ),
    section('d-sponsors', 'Sponsors: the columns', columnTable(COLUMN_HELP.sponsors)),
    section(
      'd-template',
      'Which template an award uses',
      p('Awards, Draw accounts and Sponsors each have a Template column. Read them in that order, from most to least specific; the first one filled in wins:'),
      el(
        'ol',
        {},
        el('li', {}, b('Awards'), ': the award’s own. The Template menu on the Report sets it too.'),
        el('li', {}, b('Draw accounts'), ': for every award in the account.'),
        el('li', {}, b('Sponsors'), ': for every award from the sponsor.'),
        el('li', {}, b('Sponsors, the row with Sponsor blank'), ': the default for everyone else. Without one, the first template is used.')
      ),
      p('Most dictionaries need only the default and a row for each sponsor with its own rules, such as DOL. Leave the rest blank. Draw accounts and sponsors in the expenses get rows added for you, so you only pick.')
    ),
    section(
      'd-saving',
      'Saving',
      p(
        'Changes you make in Quick Draw are only in the page until you save the dictionary from the bar at the top of the Data dictionary or Templates tab. In Chrome and Edge, Save writes over the file you opened; in Safari and Firefox, it saves a copy to your Downloads, to use in place of the old one.'
      )
    ),
  ],
};

const GLOSSARY_GUIDE = {
  kicker: 'Glossary',
  title: 'Terms used in Quick Draw',
  sections: () => [
    el(
      'section',
      { class: 'guide-section', id: 'g-terms' },
      el(
        'dl',
        { class: 'glossary' },
        [...GLOSSARY]
          .sort(([a], [b]) => a.localeCompare(b))
          .flatMap(([term, meaning]) => [el('dt', {}, term), el('dd', {}, meaning)])
      )
    ),
  ],
};

const GUIDES = { templates: TEMPLATES_GUIDE, loops: LOOPS_GUIDE, about: ABOUT_GUIDE, export: EXPORT_GUIDE, hhs: HHS_WORDING, codes: CODES_GUIDE, glossary: GLOSSARY_GUIDE };

/** Renders a guide as a page inside `container`, for the tab that shows it. */
export const renderGuidePage = (container, which) => {
  const guide = GUIDES[which];
  const sections = guide.sections();
  const contents = el(
    'nav',
    { class: 'guide-contents', 'aria-label': 'On this page' },
    sections.map((node) =>
      el(
        'button',
        { type: 'button', class: 'link-button', onclick: () => node.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
        node.querySelector('h3')?.textContent
      )
    )
  );
  fill(container, el('div', { class: 'guide-page' }, el('h2', {}, guide.title), guide.lead?.(), guide.after?.(), sections.length > 1 ? contents : null, sections));
};

/** Opens a guide, 'templates', 'loops', 'about' or 'export', as one scrolling page. */
export const openGuide = (which = 'templates') => {
  const guide = GUIDES[which];
  const id = `guide-title-${which}`;
  const sections = guide.sections();
  const dialog = el('dialog', { class: 'guide', 'aria-labelledby': id });
  const body = el('div', { class: 'guide-body', tabIndex: -1 });
  const close = () => dialog.close();
  dialog.addEventListener('close', () => dialog.remove());

  // A short list of the sections, linking down the page.
  const contents = el(
    'nav',
    { class: 'guide-contents', 'aria-label': 'On this page' },
    sections.map((node) =>
      el(
        'button',
        {
          type: 'button',
          class: 'link-button',
          onclick: () => body.querySelector(`#${node.id}`).scrollIntoView({ behavior: 'smooth', block: 'start' }),
        },
        node.querySelector('h3')?.textContent
      )
    )
  );
  fill(body, guide.lead?.(), guide.after?.(), sections.length > 1 ? contents : null, sections);

  dialog.append(
    el(
      'div',
      { class: 'guide-head' },
      el('div', {}, el('p', { class: 'guide-kicker' }, guide.kicker), el('h2', { id }, guide.title)),
      el('button', { type: 'button', class: 'icon-button guide-close', 'aria-label': 'Close the guide', title: 'Close (Esc)', onclick: close }, '×')
    ),
    body,
    el('div', { class: 'guide-foot' }, el('button', { type: 'button', class: 'button', onclick: close }, 'Close'))
  );
  document.body.append(dialog);
  dialog.showModal();
  body.focus();
};
