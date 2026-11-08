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
import { confirmWindow, el, fill, insertAtCaret, notice, tabStrip } from './dom.js';

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
const EXAMPLES = STANDARD_TEMPLATES.map((t) => ({ name: t.name, label: t.label, text: t.text, source: t.source, maxLength: t.maxLength }));

// --------------------------------------------------------------- help

const code = (text) => el('code', {}, text);

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
  ui.templateDrafts ??= new Map(); // grid row -> edited template text not yet saved
  if (!rows.some((r) => r.index === ui.templateRow)) ui.templateRow = rows[0]?.index ?? null;
  const current = rows.find((r) => r.index === ui.templateRow);

  const rerender = () => renderTemplates(container, app);

  const addTemplate = (values) => {
    ui.templateRow = app.addRow(values);
    app.onEdit();
    rerender();
  };

  // "+ New template" offers the standards, each shaped by an agency's requirements, or a blank one.
  const uniqueName = (name) => {
    const taken = new Set(rows.map((r) => (r.name || r.label).toUpperCase()));
    let candidate = name;
    for (let n = 2; taken.has(candidate.toUpperCase()); n++) candidate = `${name} ${n}`;
    return candidate;
  };
  const openNewMenu = () => {
    const tab = strip.querySelector('.tab-add');
    const outside = (event) => {
      if (!menu.contains(event.target) && !tab.contains(event.target)) close();
    };
    const close = () => {
      menu.remove();
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', close);
    };
    const choose = (values) => {
      close();
      addTemplate(values);
    };
    const item = (title, detail, values) =>
      el('button', { type: 'button', role: 'menuitem', onclick: () => choose(values) }, el('strong', {}, title), el('span', { class: 'muted small' }, detail));
    const menu = el(
      'div',
      { class: 'new-menu', role: 'menu', 'aria-label': 'New template' },
      el('p', { class: 'guide-label' }, 'Start from a standard'),
      EXAMPLES.map((example) =>
        item(example.label, example.source, { Name: uniqueName(example.name), Template: example.text, MaxLength: String(example.maxLength ?? '') })
      ),
      item('Blank', 'A one-line start to write your own.', { Name: uniqueName('New template'), Template: 'Payment for {{ costs }} under award {{ award }}.' })
    );
    menu.addEventListener('keydown', (event) => {
      const items = [...menu.querySelectorAll('[role=menuitem]')];
      const i = items.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        close();
        tab.focus();
      } else if (event.key === 'ArrowDown') items[(i + 1) % items.length].focus();
      else if (event.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
      else return;
      event.preventDefault();
    });
    // Fixed to the screen, right under the tab, so opening it never moves the page.
    document.body.append(menu);
    const box = tab.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${box.bottom + 4}px`;
    menu.style.maxHeight = `${Math.max(160, window.innerHeight - box.bottom - 16)}px`;
    document.addEventListener('pointerdown', outside, true);
    // Only the page scrolling closes it, not the tab row scrolling sideways.
    window.addEventListener('scroll', close, { once: true });
    menu.querySelector('[role=menuitem]').focus({ preventScroll: true });
  };

  const strip = tabStrip(
    [
      ...rows.map((r) => ({
        key: r.index,
        label: ui.templateDrafts.has(r.index) ? `${r.label} •` : r.label,
        title: ui.templateDrafts.has(r.index) ? 'This template has unsaved edits.' : null,
      })),
      { key: 'new', label: '+ New template', className: 'tab-add' },
    ],
    ui.templateRow,
    (key) => {
      if (key === 'new') openNewMenu();
      else {
        ui.templateRow = key;
        rerender();
      }
    },
    { label: 'Templates in this file', className: 'sub-tabs' }
  );

  const warnings = app.warnings.filter((w) => !current || !w.row || w.row === current.index + 1);
  const parts = [warnings.length ? notice('warn', null, warnings.map((w) => w.text)) : null, strip];

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
      { class: 'settings-actions' },
      el(
        'button',
        {
          type: 'button',
          class: 'button small secondary danger',
          onclick: async () => {
            const sure = await confirmWindow({
              title: `Delete the “${current.label}” template?`,
              message:
                'It is removed from the dictionary in this page right away. The deletion doesn’t take effect in your file until you save the dictionary, so until then the saved file still has it.',
              confirmLabel: 'Delete template',
              danger: true,
            });
            if (!sure) return;
            app.deleteRow(current.index);
            // Rows below move up one, and their drafts with them.
            ui.templateDrafts = new Map(
              [...ui.templateDrafts].filter(([row]) => row !== current.index).map(([row, draft]) => [row > current.index ? row - 1 : row, draft])
            );
            ui.templateRow = null;
            app.onEdit();
            rerender();
          },
        },
        'Delete template'
      )
    )
  );

  // The editor, in the chosen view.
  // Edits make a draft. Update puts it into the template; Add as new makes another template from it.
  let text = ui.templateDrafts.get(current.index) ?? current.text;
  const changed = (value) => {
    text = value;
    if (value === current.text) ui.templateDrafts.delete(current.index);
    else ui.templateDrafts.set(current.index, value);
    updateDraftBar();
    updatePreview();
    app.onDraft?.();
  };

  const draftBar = el('div', { class: 'draft-bar', 'aria-live': 'polite' });
  const markTab = () => {
    const tabNode = strip.querySelector(`#${CSS.escape(strip.querySelector('[aria-selected=true]')?.id ?? '')}`);
    const label = tabNode?.querySelector('.tab-label');
    if (label) label.textContent = ui.templateDrafts.has(current.index) ? `${current.label} •` : current.label;
  };
  const saveTemplate = () => {
    app.setCell(current.index, 'Template', text);
    ui.templateDrafts.delete(current.index);
    app.onEdit();
    current.text = text;
    updateDraftBar();
  };
  const saveAsNew = (name) => {
    const values = { Name: uniqueName(name.trim() || `${current.label} (edited)`), Template: text, MaxLength: limitInput.value };
    ui.templateDrafts.delete(current.index);
    addTemplate(values);
  };
  const discard = () => {
    ui.templateDrafts.delete(current.index);
    rerender();
  };
  function updateDraftBar() {
    markTab();
    const edited = ui.templateDrafts.has(current.index);
    draftBar.classList.toggle('idle', !edited);
    const asNew = el('button', { type: 'button', class: 'button small secondary' }, 'Add as new template…');
    asNew.addEventListener('click', () => {
      const name = el('input', { type: 'text', value: `${current.label} (edited)`, 'aria-label': 'Name for the new template', spellcheck: false });
      const confirmName = el('button', { type: 'button', class: 'button small', onclick: () => saveAsNew(name.value) }, 'Add template');
      const cancel = el('button', { type: 'button', class: 'link-button small', onclick: () => updateDraftBar() }, 'Cancel');
      name.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') saveAsNew(name.value);
        if (event.key === 'Escape') updateDraftBar();
      });
      fill(draftBar, el('span', { class: 'small' }, 'Name the new template:'), name, confirmName, cancel);
      name.select();
    });
    fill(
      draftBar,
      edited
        ? el(
            'span',
            {
              class: 'badge warn',
              title: 'These edits are only in the editor. Update template puts them into this template; Add as new template makes a new one and leaves this one as it was. Either way, save the dictionary file to keep them.',
            },
            'Unsaved edits'
          )
        : null,
      el(
        'span',
        { class: 'draft-actions' },
        edited ? el('button', { type: 'button', class: 'button small', onclick: saveTemplate }, 'Update template') : null,
        asNew,
        edited ? el('button', { type: 'button', class: 'link-button small', onclick: discard }, 'Discard edits') : null
      )
    );
  }
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
      )
    ),
    editorNode,
    draftBar,
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
  updateDraftBar();
};
