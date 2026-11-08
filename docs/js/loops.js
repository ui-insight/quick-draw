// The loop dialog. Clicking a loop block in the Builder opens this: choose
// what to repeat over, write the text for one item, and say what goes between
// items. A loop inside the item opens another dialog on top, one level down.

import { FIELDS, LIST_FIELDS, compileTemplate } from './core.js';
import { loopLists, readLoop, writeLoop } from './loopsyntax.js';
import { SNIPPET_TYPE, visualEditor } from './blocks.js';
import { el, fill } from './dom.js';

const out = (expr) => `{{ ${expr} }}`;

/** The value a loop's list holds for a given set of values, such as values.c.codes. */
const listValue = (values, iter) => iter.split('.').reduce((v, key) => (v && typeof v === 'object' ? v[key] : undefined), values);

/** Blocks for the dialog's list, given what the loop repeats over. */
const paletteFor = (settings, vars) => {
  const groups = [];
  const { target, iter } = settings;
  if (iter === 'categories') {
    groups.push({
      title: 'This category',
      blocks: [
        { label: LIST_FIELDS.categories.fields.name.label, insert: out(`${target}.name`) },
        { label: LIST_FIELDS.categories.fields.amount.label, insert: out(`${target}.amount`), help: 'No dollar sign.' },
        { label: "Category's descriptions", insert: `{{ ${target}.codes | map("description") | join(", ") }}`, help: 'The descriptions of the codes in this category.' },
      ],
    });
    groups.push({
      title: 'Loops',
      blocks: [
        {
          label: 'Each code in this category',
          insert: `{% for code in ${target}.codes %}{{ code.code }}{% if not loop.last %}, {% endif %}{% endfor %}`,
          help: 'Lists the cost codes behind this category. Click the new block to change it.',
          kind: 'loop',
        },
      ],
    });
  } else if (iter === 'codes' || iter.endsWith('.codes')) {
    const fields = Object.entries(LIST_FIELDS.codes.fields).filter(([name]) => name !== 'category' || iter === 'codes');
    groups.push({
      title: 'This cost code',
      blocks: fields.map(([name, f]) => ({ label: f.label, insert: out(`${target}.${name}`), help: f.help })),
    });
  }
  if (vars.includes('c') && target !== 'c') {
    groups.push({
      title: 'The category around it',
      blocks: [
        { label: 'Category name', insert: out('c.name') },
        { label: 'Category amount', insert: out('c.amount') },
      ],
    });
  }
  groups.push({ title: 'Helpers', blocks: [{ label: 'Item number', insert: out('loop.index'), help: '1 for the first item, 2 for the second, and so on.' }] });
  groups.push({
    title: 'Award values',
    blocks: Object.entries(FIELDS).map(([name, f]) => ({ label: f.label, insert: out(name), help: f.help })),
  });
  return groups;
};

/** A row of quick choices for a separator field. */
const choices = (input, options, update) =>
  el(
    'span',
    { class: 'quick-choices' },
    options.map(([label, value]) =>
      el(
        'button',
        {
          type: 'button',
          class: 'button small secondary',
          onclick: () => {
            input.value = value;
            update();
          },
        },
        label
      )
    )
  );

/**
 * Opens the dialog for one loop. Resolves with the new Jinja for the loop, ''
 * to remove it, or null when cancelled.
 *
 * context: { values, vars, path } — the values to preview with (including any
 * loop variables already bound), the names of loops already open around this
 * one, and the breadcrumb of where this loop sits.
 */
let dialogsMade = 0;

export const openLoopDialog = (raw, { values, vars = [], path = ['Template'] }) =>
  new Promise((resolve) => {
    // Dialogs stack, so each one's ids are its own.
    const id = (name) => `loop-${dialogsMade}-${name}`;
    dialogsMade++;
    const settings = readLoop(raw) ?? { target: 'c', iter: 'categories', item: '', between: ', ', beforeLast: '', empty: null };
    const lists = loopLists(vars);
    if (!lists.some((l) => l.iter === settings.iter)) {
      lists.push({ iter: settings.iter, target: settings.target, label: `Each ${settings.target} in ${settings.iter}`, noun: settings.target });
    }
    const listFor = () => lists.find((l) => l.iter === settings.iter);

    const dialog = el('dialog', { class: 'loop-dialog', 'aria-labelledby': id('title') });
    let editor = null;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      editor?.dispose();
      dialog.close();
      dialog.remove();
      resolve(result);
    };
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });

    const preview = el('div', { class: 'preview-text' });
    const status = el('div', { class: 'template-status' });
    const between = el('input', { type: 'text', id: id('between'), value: settings.between, placeholder: 'Nothing' });
    const beforeLast = el('input', { type: 'text', id: id('last'), value: settings.beforeLast, placeholder: 'Nothing' });
    const empty = el('input', { type: 'text', id: id('empty'), value: settings.empty ?? '', placeholder: 'Nothing' });

    const update = () => {
      settings.between = between.value;
      settings.beforeLast = beforeLast.value;
      settings.empty = empty.value || null;
      const compiled = compileTemplate(writeLoop(settings));
      const result = compiled.error ? compiled : compiled.render(values);
      if (result.error) {
        fill(status, el('div', { class: 'notice error compact', title: 'The loop can’t be used until this is fixed. Usually a block is used where it doesn’t exist, such as a code field outside a code loop.' }, result.error.detail));
        preview.textContent = '';
        preview.classList.add('empty');
      } else {
        fill(status);
        preview.textContent = result.text;
        preview.classList.toggle('empty', !result.text);
      }
    };
    for (const input of [between, beforeLast, empty]) input.addEventListener('input', update);

    const title = el('h2', { id: id('title') });
    const crumbs = el('ol', { class: 'crumbs', 'aria-label': 'Where this loop is' });
    const editorHolder = el('div', { class: 'loop-editor' });
    const paletteHolder = el('aside', { class: 'palette', 'aria-label': 'Blocks for this loop' });
    const itemLabel = el('p', { class: 'field-label' });
    const intro = el('p', { class: 'loop-intro' });

    const draw = () => {
      const list = listFor();
      title.textContent = list.label;
      fill(crumbs, [...path, list.label].map((step) => el('li', {}, step)));
      itemLabel.textContent = `Write this once; it repeats for each ${list.noun}:`;
      intro.textContent = `Write what to say about one ${list.noun}, using the blocks on the left. Quick Draw repeats it for every ${list.noun} on the award and puts your “between” text between them. The preview shows the whole list.`;
      // The item editor, with loops inside it opening the next level down.
      editor?.dispose();
      const first = listValue(values, settings.iter)?.[0];
      const inner = { values: { ...values, [settings.target]: first ?? {} }, vars: [...vars, settings.target], path: [...path, list.label] };
      editor = visualEditor(
        settings.item,
        (text) => {
          settings.item = text;
          update();
        },
        { onLoop: (loopRaw) => openLoopDialog(loopRaw, inner) }
      );
      fill(editorHolder, editor.node);
      fill(
        paletteHolder,
        el('p', { class: 'palette-intro' }, 'Drag a block into the text, or click one to add it at the cursor.'),
        paletteFor(settings, vars).map((group) =>
          el(
            'section',
            {},
            el('h3', {}, group.title),
            el(
              'div',
              { class: 'blocks' },
              group.blocks.map((b) => {
                const node = el(
                  'button',
                  {
                    type: 'button',
                    class: `chip chip-${b.kind ?? 'value'} palette-chip`,
                    draggable: true,
                    title: `${b.help ? `${b.help}\n\n` : ''}Jinja: ${b.insert}`,
                    onclick: () => editor.insert(b.insert),
                  },
                  b.label
                );
                node.addEventListener('dragstart', (event) => {
                  event.dataTransfer.setData(SNIPPET_TYPE, b.insert);
                  event.dataTransfer.setData('text/plain', b.insert);
                  event.dataTransfer.effectAllowed = 'copy';
                });
                return node;
              })
            )
          )
        )
      );
      update();
    };

    const listSelect = el(
      'select',
      {
        id: id('list'),
        onchange: (event) => {
          const chosen = lists.find((l) => l.iter === event.target.value);
          const old = settings.target;
          settings.iter = chosen.iter;
          settings.target = chosen.target;
          // Keep the item's own references pointing at the renamed loop variable.
          if (old !== chosen.target) settings.item = settings.item.replace(new RegExp(`\\b${old}\\.`, 'g'), `${chosen.target}.`);
          draw();
        },
      },
      lists.map((l) => el('option', { value: l.iter, selected: l.iter === settings.iter }, l.label))
    );

    const field = (id, label, input, help, extra) =>
      el('div', { class: 'loop-field' }, el('label', { for: id }, label), el('div', { class: 'loop-input' }, input, extra), help ? el('p', { class: 'muted small' }, help) : null);

    dialog.append(
      el(
        'div',
        { class: 'loop-head' },
        crumbs,
        title,
        intro,
        el('div', { class: 'loop-field inline' }, el('label', { for: id('list') }, 'Repeat for'), listSelect)
      ),
      el('div', { class: 'builder loop-builder' }, paletteHolder, el('div', { class: 'editor-column' }, itemLabel, editorHolder)),
      el(
        'div',
        { class: 'loop-settings' },
        field(id('between'), 'Between items', between, 'Spaces count: ", " is a comma and a space.', choices(between, [['Comma', ', '], ['Semicolon', '; '], ['Space', ' '], ['None', '']], update)),
        field(id('last'), 'Before the last item', beforeLast, 'Only when there are two or more.', choices(beforeLast, [['"and"', 'and '], ['"or"', 'or '], ['None', '']], update)),
        field(id('empty'), 'If there are none', empty, 'Written instead when the list is empty.')
      ),
      el('div', { class: 'preview' }, el('div', { class: 'preview-head' }, el('span', { class: 'field-label' }, 'Preview')), preview, status),
      el(
        'div',
        { class: 'loop-actions' },
        el('button', { type: 'button', class: 'button small secondary danger', onclick: () => finish('') }, 'Remove loop'),
        el('span', { class: 'spacer' }),
        el('button', { type: 'button', class: 'button secondary', onclick: () => finish(null) }, 'Cancel'),
        el('button', { type: 'button', class: 'button', onclick: () => finish(writeLoop(settings)) }, 'Done')
      )
    );

    document.body.append(dialog);
    draw();
    dialog.showModal();
    editor.node.focus();
  });
