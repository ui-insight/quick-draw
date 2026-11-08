// The Templates tab: an editor for each template, a palette of blocks to drag
// in, a live preview and the help.

import {
  COLUMNS,
  FIELDS,
  LIST_FIELDS,
  cellText,
  compileTemplate,
  exampleValues,
  singleBraceNote,
  tableLayout,
  templateLabel,
  STANDARD_TEMPLATES,
} from './core.js';
import { scan } from './jinja.js';
import { SNIPPET_TYPE, visualEditor } from './blocks.js';
import { openLoopDialog } from './loops.js';
import { openGuide } from './guide.js';
import { el, fill, insertAtCaret, notice, tabStrip } from './dom.js';

// ------------------------------------------------------------- blocks

const out = (expr) => `{{ ${expr} }}`;

/** The palette: groups of blocks, each with the text it inserts. */
const PALETTE = [
  {
    title: 'Award values',
    note: 'One value for the whole award.',
    blocks: Object.entries(FIELDS).map(([name, field]) => ({
      label: field.label,
      insert: out(name),
      help: `${field.help} Example: ${field.example}`,
    })),
  },
  {
    title: 'Loops',
    note: 'Repeat text once for each item in a list.',
    builderNote: 'Repeat text for each item in a list. Click a loop in the template to set it up.',
    blocks: [
      {
        label: 'Each category',
        insert: '{% for c in categories %}{{ c.name }} ${{ c.amount }}{% if not loop.last %}, {% endif %}{% endfor %}',
        help: 'Lists every budget category with its amount, separated by commas. Change the text between the tags to change how each one reads.',
        kind: 'loop',
      },
      {
        label: 'Each code in the category',
        insert: '{% for code in c.codes %}{{ code.code }}{% if not loop.last %}, {% endif %}{% endfor %}',
        help: 'Goes inside the category loop. Lists the cost codes behind that category.',
        kind: 'loop',
      },
      {
        label: 'Each cost code',
        insert: '{% for code in codes %}{{ code.code }} ${{ code.amount }}{% if not loop.last %}, {% endif %}{% endfor %}',
        help: 'Lists every cost code on the award, across all categories.',
        kind: 'loop',
      },
    ],
  },
  {
    title: 'Inside a category loop',
    jinjaOnly: true,
    note: 'Use between {% for c in categories %} and {% endfor %}.',
    blocks: [
      ...Object.entries(LIST_FIELDS.categories.fields)
        .filter(([name]) => name !== 'codes')
        .map(([name, field]) => ({
          label: field.label,
          insert: out(`c.${name}`),
          help: `${field.help ?? ''} Example: ${field.example}`.trim(),
        })),
      {
        label: "Category's descriptions",
        insert: '{{ c.codes | map("description") | select | unique | join(", ") }}',
        help: 'The descriptions of the codes in this category, separated by commas.',
      },
    ],
  },
  {
    title: 'Inside a code loop',
    jinjaOnly: true,
    note: 'Use between {% for code in … %} and {% endfor %}.',
    blocks: Object.entries(LIST_FIELDS.codes.fields).map(([name, field]) => ({
      label: field.label,
      insert: out(`code.${name}`),
      help: `${field.help ?? ''} Example: ${field.example}`.trim(),
    })),
  },
  {
    title: 'Helpers',
    note: 'Small pieces for loops and optional text.',
    blocks: [
      {
        label: 'Comma between items',
        jinjaOnly: true,
        insert: '{% if not loop.last %}, {% endif %}',
        help: 'Inside a loop: a comma after every item except the last.',
        kind: 'logic',
      },
      {
        label: '"and" before the last',
        jinjaOnly: true,
        insert: '{% if loop.last and not loop.first %}and {% endif %}',
        help: 'Inside a loop, at the start: writes "and " before the last item.',
        kind: 'logic',
      },
      {
        label: 'Item number',
        jinjaOnly: true,
        insert: '{{ loop.index }}',
        help: 'Inside a loop: 1 for the first item, 2 for the second, and so on.',
      },
      {
        label: 'Only if there are dates',
        insert: '{% if start %}, incurred {{ start }} through {{ end }}{% endif %}',
        help: 'Writes the dates only when the expenses have a CostDate.',
        kind: 'logic',
      },
    ],
  },
];

// The editor starts from templates shaped by the agencies' requirements.
const EXAMPLES = STANDARD_TEMPLATES.map((t) => ({ label: t.label, text: t.text, source: t.source, maxLength: t.maxLength }));

// --------------------------------------------------------------- help

const code = (text) => el('code', {}, text);

const helpSection = () =>
  el(
    'details',
    { class: 'help', open: readHelpOpen(), ontoggle: (e) => writeHelpOpen(e.target.open) },
    el('summary', {}, 'How templates work'),
    el(
      'div',
      { class: 'help-body' },
      el(
        'p',
        {},
        'Write the justification in your own words. Where a value goes, such as the award number or the total, drag in its block from the left (or click the block to add it at the cursor). Quick Draw fills it in for each award; the preview below shows the result.'
      ),
      el(
        'p',
        {},
        'To list each budget category, add ',
        el('strong', {}, 'Each category'),
        ' from Loops, then click the loop in your text to set it up.'
      ),
      el(
        'p',
        { class: 'muted small' },
        el('strong', {}, 'Jinja'),
        ' shows the same template as the text saved in your workbook. Templates are saved on its Templates sheet when you save the dictionary.'
      ),
      el(
        'p',
        {},
        el('button', { type: 'button', class: 'button small secondary', onclick: () => openGuide('templates') }, 'Read the guide'),
        ' What templates and loops are, why you’d want loops, and how to get started, with examples.'
      )
    )
  );

const HELP_KEY = 'quick-draw:help-open';
const readHelpOpen = () => {
  try {
    return localStorage.getItem(HELP_KEY) === 'true';
  } catch {
    return false;
  }
};
const writeHelpOpen = (open) => {
  try {
    localStorage.setItem(HELP_KEY, String(open));
  } catch {
    // Storage may be blocked; the help just opens again next time.
  }
};

// ------------------------------------------------------------ editor

const highlight = (pre, text) => {
  const parts = scan(text);
  fill(pre, 
    ...parts.map((part) => {
      const piece = text.slice(part.start, part.end);
      if (part.type === 'text') return document.createTextNode(piece);
      const cls = { output: 'tok-out', tag: 'tok-tag', comment: 'tok-comment', unclosed: 'tok-bad' }[part.type];
      return el('span', { class: cls }, piece);
    }),
    // A trailing newline needs a character after it to take up a line.
    document.createTextNode('\n')
  );
};

const codeEditor = (text, onInput) => {
  const pre = el('pre', { class: 'code-highlight', 'aria-hidden': 'true' });
  const area = el('textarea', {
    class: 'code-input',
    spellcheck: false,
    'aria-label': 'Template',
    rows: 6,
  });
  area.value = text;
  const fit = () => {
    area.style.height = 'auto';
    area.style.height = `${area.scrollHeight + 2}px`;
  };
  area.addEventListener('input', () => {
    highlight(pre, area.value);
    fit();
    onInput(area.value);
  });
  area.addEventListener('scroll', () => {
    pre.scrollTop = area.scrollTop;
  });
  // Remember the caret so a clicked block lands where the user last was.
  area.lastCaret = text.length;
  area.addEventListener('blur', () => {
    area.lastCaret = area.selectionStart;
  });
  // Show where a drop will land.
  area.addEventListener('dragover', () => area.classList.add('drop-target'));
  area.addEventListener('dragleave', () => area.classList.remove('drop-target'));
  area.addEventListener('drop', () => area.classList.remove('drop-target'));

  highlight(pre, text);
  const wrap = el('div', { class: 'code-editor' }, pre, area);
  requestAnimationFrame(fit);
  return { wrap, area };
};

// ---------------------------------------------------------- the tab

const templateRows = (table) => {
  const { headerIndex, positions } = tableLayout(table.grid, COLUMNS.templates);
  const rows = [];
  const seen = new Set();
  for (let r = headerIndex + 1; r < table.grid.length; r++) {
    const row = table.grid[r] ?? [];
    if (row.every((v) => cellText(v) === '')) continue;
    const get = (name) => (name in positions ? cellText(row[positions[name]]) : '');
    let label = templateLabel(get('Name'), get('DrawAccount'), get('Sponsor'));
    if (seen.has(label.toUpperCase())) label = `${label} (row ${r + 1})`;
    seen.add(label.toUpperCase());
    rows.push({
      index: r,
      label,
      name: get('Name'),
      account: get('DrawAccount'),
      sponsor: get('Sponsor'),
      text: get('Template'),
      maxLength: get('MaxLength'),
      fallback: get('Fallback'),
    });
  }
  return rows;
};

/** Awards to preview: those using this template first, then the rest. */
const previewChoices = (report, index) => {
  if (!report) return [];
  const all = report.accounts.flatMap((a) => a.awards.map((award) => ({ award, account: a, uses: award.template?.row === index + 1 })));
  return [...all.filter((c) => c.uses), ...all.filter((c) => !c.uses)];
};

let disposeEditor = () => {};

/**
 * Renders the Templates tab.
 *
 * app: { table, report, ui, warnings, accounts[], setCell(index, column, value),
 *        addRow(values) -> index, deleteRow(index), onEdit() }
 */
export const renderTemplates = (container, app) => {
  disposeEditor();
  disposeEditor = () => {};
  const { table, ui } = app;
  ui.templateView ??= 'builder';
  const rows = templateRows(table);
  if (!rows.some((r) => r.index === ui.templateRow)) ui.templateRow = rows[0]?.index ?? null;
  const current = rows.find((r) => r.index === ui.templateRow);

  const rerender = () => renderTemplates(container, app);

  const addTemplate = (values) => {
    ui.templateRow = app.addRow(values);
    app.onEdit();
    rerender();
  };

  const strip = tabStrip(
    [...rows.map((r) => ({ key: r.index, label: r.label })), { key: 'new', label: '+ New template', className: 'tab-add' }],
    ui.templateRow,
    (key) => {
      if (key === 'new') addTemplate({ Name: `Template ${rows.length + 1}`, Template: EXAMPLES[0].text, MaxLength: EXAMPLES[0].maxLength });
      else {
        ui.templateRow = key;
        rerender();
      }
    },
    { label: 'Templates in this file', className: 'sub-tabs' }
  );

  const warnings = app.warnings.filter((w) => !current || !w.row || w.row === current.index + 1);
  const parts = [helpSection(), warnings.length ? notice('warn', null, warnings.map((w) => w.text)) : null, strip];

  if (!current) {
    parts.push(el('p', { class: 'empty' }, 'This file has no templates yet. Click ', el('strong', {}, '+ New template'), ' to start one.'));
    fill(container, ...parts);
    return;
  }

  // Name, account and limit.
  const nameInput = el('input', { type: 'text', id: 'template-name', value: current.name, placeholder: current.account || 'Default', spellcheck: false });
  nameInput.addEventListener('change', () => {
    app.setCell(current.index, 'Name', nameInput.value.trim());
    app.onEdit();
    rerender();
  });
  const listId = 'template-accounts';
  const accountInput = el('input', { type: 'text', id: 'template-account', value: current.account, placeholder: 'Any account', spellcheck: false });
  accountInput.setAttribute('list', listId);
  accountInput.addEventListener('change', () => {
    app.setCell(current.index, 'DrawAccount', accountInput.value.trim());
    app.onEdit();
    rerender();
  });
  const sponsorInput = el('input', { type: 'text', id: 'template-sponsor', value: current.sponsor, placeholder: 'Any sponsor', spellcheck: false });
  sponsorInput.setAttribute('list', 'template-sponsors');
  sponsorInput.addEventListener('change', () => {
    app.setCell(current.index, 'Sponsor', sponsorInput.value.trim());
    app.onEdit();
    rerender();
  });
  const fallbackSelect = el(
    'select',
    {
      id: 'template-fallback',
      onchange: (event) => {
        app.setCell(current.index, 'Fallback', event.target.value);
        app.onEdit();
      },
    },
    el('option', { value: '', selected: !current.fallback }, 'Nothing (just warn)'),
    rows
      .filter((r) => r.index !== current.index)
      .map((r) => el('option', { value: r.name || r.label, selected: Boolean(current.fallback) && [r.name, r.label].includes(current.fallback) }, r.label))
  );
  const limitInput = el('input', { type: 'number', id: 'template-limit', min: 1, step: 1, value: current.maxLength, placeholder: 'None' });
  limitInput.addEventListener('input', () => {
    app.setCell(current.index, 'MaxLength', limitInput.value);
    app.onEdit();
    updatePreview();
  });

  const settings = el(
    'div',
    { class: 'template-settings' },
    el('div', { class: 'field' }, el('label', { for: 'template-name' }, 'Name'), nameInput),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'template-account', title: 'Awards in this draw account use this template unless you pick another on the Report tab. Leave blank for any account without its own.' }, 'Draw account'),
      accountInput,
      el('datalist', { id: listId }, app.accounts.map((a) => el('option', { value: a })))
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'template-sponsor', title: 'Accounts with this sponsor use this template unless they have their own, or you pick another on the Report tab.' }, 'Sponsor'),
      sponsorInput,
      el('datalist', { id: 'template-sponsors' }, (app.sponsors ?? []).map((a) => el('option', { value: a })))
    ),
    el('div', { class: 'field narrow' }, el('label', { for: 'template-limit' }, 'Character limit'), limitInput),
    el(
      'div',
      { class: 'field' },
      el(
        'label',
        { for: 'template-fallback', title: 'When an award’s justification would run over the character limit, Quick Draw uses this shorter template instead, and says so on the Report tab.' },
        'If too long, use'
      ),
      fallbackSelect
    ),
    el(
      'div',
      { class: 'settings-actions' },
      el(
        'button',
        {
          type: 'button',
          class: 'button small secondary',
          onclick: () =>
            addTemplate({
              Name: `${current.label} copy`,
              DrawAccount: current.account,
              Sponsor: current.sponsor,
              Template: text,
              MaxLength: limitInput.value,
            }),
        },
        'Duplicate'
      ),
      el(
        'button',
        {
          type: 'button',
          class: 'button small secondary danger',
          onclick: () => {
            if (!confirm(`Delete the "${current.label}" template?`)) return;
            app.deleteRow(current.index);
            ui.templateRow = null;
            app.onEdit();
            rerender();
          },
        },
        'Delete'
      )
    )
  );

  // The editor, in the chosen view.
  let text = current.text;
  const changed = (value) => {
    text = value;
    app.setCell(current.index, 'Template', value);
    app.onEdit();
    updatePreview();
  };
  let insert;
  let editorNode;
  const previewValues = () => {
    const choice = choices.find((c) => c.award.key === ui.previewAward);
    return choice ? choice.award.values : exampleValues();
  };
  if (ui.templateView === 'builder') {
    const visual = visualEditor(text, changed, {
      onLoop: (raw) => openLoopDialog(raw, { values: previewValues(), vars: [], path: [current.label] }),
    });
    disposeEditor = visual.dispose;
    insert = visual.insert;
    editorNode = visual.node;
  } else {
    const { wrap, area } = codeEditor(text, changed);
    insert = (snippet) => {
      if (document.activeElement !== area) area.setSelectionRange(area.lastCaret, area.lastCaret);
      insertAtCaret(area, snippet);
    };
    editorNode = wrap;
  }

  const viewTabs = tabStrip(
    [
      { key: 'builder', label: 'Builder' },
      { key: 'jinja', label: 'Jinja' },
    ],
    ui.templateView,
    (key) => {
      ui.templateView = key;
      rerender();
    },
    { label: 'Template view', className: 'view-tabs' }
  );

  const examples = el(
    'div',
    { class: 'examples' },
    el('span', { class: 'muted small', title: 'Templates shaped by each agency’s stated requirements. Point at one to see which.' }, 'Start from a standard:'),
    EXAMPLES.map((example) =>
      el(
        'button',
        {
          type: 'button',
          class: 'button small secondary',
          title: example.source,
          onclick: () => {
            if (text.trim() && text !== example.text && !confirm('Replace the whole template with this one?')) return;
            changed(example.text);
            if (!limitInput.value && example.maxLength) app.setCell(current.index, 'MaxLength', String(example.maxLength));
            rerender();
          },
        },
        example.label
      )
    )
  );

  // Palette.
  const block = (b) => {
    const kind = b.kind ?? 'value';
    const node = el(
      'button',
      {
        type: 'button',
        class: `chip chip-${kind} palette-chip`,
        draggable: true,
        title: `${b.help}\n\nJinja: ${b.insert}`,
        onclick: () => insert(b.insert),
      },
      b.label
    );
    node.addEventListener('dragstart', (event) => {
      event.dataTransfer.setData(SNIPPET_TYPE, b.insert);
      event.dataTransfer.setData('text/plain', b.insert);
      event.dataTransfer.effectAllowed = 'copy';
    });
    return node;
  };
  const palette = el(
    'aside',
    { class: 'palette', 'aria-label': 'Blocks to add to the template' },
    el('p', { class: 'palette-intro' }, 'Drag a block into the template, or click one to add it at the cursor. Point at a block to see what it does.'),
    PALETTE.filter((group) => ui.templateView === 'jinja' || !group.jinjaOnly).map((group) => {
      const blocks = group.blocks.filter((b) => ui.templateView === 'jinja' || !b.jinjaOnly);
      if (!blocks.length) return null;
      const note = ui.templateView === 'builder' ? group.builderNote ?? group.note : group.note;
      return el('section', {}, el('h3', {}, group.title), el('p', { class: 'muted small' }, note), el('div', { class: 'blocks' }, blocks.map(block)));
    })
  );

  // Status and preview.
  const status = el('div', { class: 'template-status', 'aria-live': 'polite' });
  const choices = previewChoices(app.report, current.index);
  if (!choices.some((c) => c.award.key === ui.previewAward)) ui.previewAward = choices[0]?.award.key ?? 'example';
  const select = el(
    'select',
    { id: 'preview-award', onchange: (e) => ((ui.previewAward = e.target.value), updatePreview()) },
    choices.map((c) => el('option', { value: c.award.key, selected: c.award.key === ui.previewAward }, `${c.award.award} (${c.account.label})`)),
    el('option', { value: 'example', selected: ui.previewAward === 'example' }, 'A made-up example award')
  );
  const previewText = el('div', { class: 'preview-text' });
  const previewCount = el('span', { class: 'count' });

  function updatePreview() {
    const compiled = compileTemplate(text);
    const result = compiled.error ? compiled : compiled.render(previewValues());
    const max = Number(limitInput.value) || null;
    if (result.error) {
      const err = result.error;
      fill(status, 
        el(
          'div',
          { class: 'notice error compact', title: 'The template can’t be used until this is fixed. Show me puts the cursor where the problem is.' },
          el('span', {}, err.message, ' '),
          el(
            'button',
            {
              type: 'button',
              class: 'link-button',
              onclick: () => {
                ui.templateView = 'jinja';
                rerender();
                const area = container.querySelector('.code-input');
                area.focus();
                area.setSelectionRange(err.position, Math.min(err.position + 2, area.value.length));
              },
            },
            'Show me'
          )
        )
      );
      previewText.textContent = '';
      previewText.classList.add('empty');
      previewCount.textContent = '';
    } else {
      const note = singleBraceNote(text);
      fill(
        status,
        note
          ? el('div', { class: 'notice warn compact', title: 'Jinja fills in a value only inside double braces. Change {award} to {{ award }}, or drag the block in from the left.' }, note)
          : el('span', { class: 'ok small' }, '✓ No problems found')
      );
      previewText.textContent = result.text;
      previewText.classList.toggle('empty', !result.text);
      const length = result.text.length;
      previewCount.textContent = max ? `${length} / ${max} characters` : `${length} characters`;
      previewCount.classList.toggle('over', Boolean(max) && length > max);
      previewCount.title = Boolean(max) && length > max ? 'This award’s justification would be over the character limit. Shorten the wording, or raise the limit if the payment system allows more.' : '';
    }
  }

  const editorColumn = el(
    'div',
    { class: 'editor-column' },
    el(
      'div',
      { class: 'editor-head' },
      el(
        'div',
        { class: 'view-and-help' },
        viewTabs,
        el(
          'button',
          {
            type: 'button',
            class: 'help-button',
            'aria-label': 'Guide to writing templates',
            title: 'Guide to writing templates',
            onclick: () => openGuide('templates'),
          },
          '?'
        )
      ),
      examples
    ),
    editorNode,
    status,
    el(
      'div',
      { class: 'preview' },
      el('div', { class: 'preview-head' }, el('label', { for: 'preview-award' }, 'Preview for'), select, previewCount),
      previewText
    )
  );

  parts.push(el('div', { class: 'template-panel', role: 'tabpanel' }, settings, el('div', { class: 'builder' }, palette, editorColumn)));
  fill(container, ...parts);
  updatePreview();
};
