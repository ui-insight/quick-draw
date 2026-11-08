# Quick Draw

Build drawdown justifications in your browser. Upload your expenses, a data dictionary and justification templates as Excel or CSV, and download a workbook with costs rolled up by sponsor budget category. Nothing leaves your computer.

**Use it:** https://ui-insight.github.io/quick-draw/. It is in active development, so expect changes; the **Load the sample files** button shows how it works with made-up data.

Part of [AI4RA](https://ai4ra.uidaho.edu) at the University of Idaho.

**Discuss, or report a problem:** tell us what you think, or what went wrong, on the [AI4RA community on Groups.io](https://groups.ai4ra.uidaho.edu/g/main). Join the [#PostAward](https://groups.ai4ra.uidaho.edu/g/main/search?q=%23PostAward&ct=1) conversation, or start a new topic with #PostAward in the subject line.

## Why

When you draw funds from a federal payment system, many sponsors ask for a short justification of what the money paid for. Writing one by hand for each award means pulling expenses, grouping them into the sponsor's budget categories, totaling them and typing a sentence that fits the payment system's character limit. Quick Draw does the grouping and the totals and drafts the sentence from your template. You review and edit each one before you use it.

It works with any financial system. Export your expenses with the columns below, and Quick Draw takes it from there.

## How it works

The page walks you through five steps, one tab at a time:

1. **Files.** Choose your expenses file and your data dictionary workbook, or drag them onto the page. **Load the sample files** shows how it works with made-up data.
2. **Expenses.** See the rows as Quick Draw read them. Rows whose cost code is not in the dictionary are shaded.
3. **Data dictionary.** See and edit each code's budget category, and each award's goal. A cost code in the expenses that the dictionary lacks is added for you, highlighted at the top of the table, with whatever Quick Draw already knows about it filled in. Give it a category, or type `Exclude` to leave its costs out on purpose.
4. **Templates.** Write the justification wording in the template builder, with a live preview for a real award.
5. **Report.** Tabs for each sponsor, each of its draw accounts, and each award, counting the awards left to copy. For each award, pick its template if it needs a different one, read its justification, its costs and a bar chart of them, and **Copy** it into the payment system. Copy first warns about anything to fix: costs whose code is not in the dictionary, a missing goal, or text over the character limit. You can fill in an award's goal or its own code descriptions right there; they are saved to the dictionary. Download a workbook with one sheet per draw account.

You can edit both files in the page and save the changes. In Chrome and Edge, **Save** writes over the file you opened. In other browsers, download the edited file and use it in place of the old one.

The app runs entirely in your browser. Your files are read on your computer and are never uploaded, and nothing is kept after you close the page. The page's security policy lets it load and connect to its own files only, so nothing it reads can be sent anywhere. Keep your dictionary workbook and bring it back the next time.

## The two files

You need two files: your **expenses**, and a **data dictionary** workbook that holds everything else. Sample files with made-up data are in [`docs/samples/`](docs/samples/), and the page's **Load the sample files** button loads them. Open [`docs/samples/dictionary.xlsx`](docs/samples/dictionary.xlsx) for a ready-made dictionary to copy.

Column names match without regard to case, spaces or underscores, so `CostCode`, `Cost Code` and `cost_code` are the same column. Extra columns are ignored.

### 1. Expenses

An Excel (`.xlsx`) or CSV file, one row per expense. Only the first sheet of a workbook is read.

| Column | Required | What it holds |
|---|---|---|
| `Award` | yes | The award or grant identifier |
| `CostCode` | yes | Your institution's expense or object code |
| `Cost` | yes | The dollar amount. Commas, a `$` and negatives in parentheses are fine, and a lone `-` counts as zero. |
| `DrawAccount` | no | The payment system account the award draws from |
| `Sponsor` | no | The sponsor the draw account belongs to. Several accounts can share a sponsor, so you can write a mapping or template once for all of them. |
| `CostDate` | no | The date of the expense, used for the period start and end. Excel dates, `2026-07-31`, `7/31/2026` and `31-JUL-26` all work. |

### 2. The data dictionary workbook

An Excel workbook with these sheets. Quick Draw finds each one by its columns, so you can rename or reorder them; a missing sheet is added when you save.

| Sheet | What it is for |
|---|---|
| **Read me** | Explains the workbook: what each sheet and column means, how Quick Draw picks a category, description and template, what templates can use, and a glossary. Quick Draw skips it, and adds one when you save a workbook that has none. |
| **Cost codes** | Which sponsor budget category each cost code belongs to, with a plain-language description |
| **Awards** | Each award's sponsor, draw account and short goal, and optionally which template it uses |
| **Templates** | The justification wording, as many versions as you like |

A CSV file also works as a dictionary, but it can only hold the cost codes. If you add goals or templates to one, it is saved as a workbook.

#### Cost codes sheet

| Column | Required | What it holds |
|---|---|---|
| `CostCode` | yes | The cost code, matching the expenses file |
| `BudgetCategory` | yes | The sponsor budget category, such as Salaries & Wages. Leave it blank on a row that names an `Award`. |
| `Description` | no | What the code covers, in words a sponsor would understand |
| `DrawAccount` | no | Fill it in when one draw account categorizes the code differently |
| `Sponsor` | no | Fill it in when one sponsor categorizes the code differently |
| `Award` | no | Fill it in, with a `Description`, to describe the code differently for one award. The row's category is not used. |

For each expense, Quick Draw uses the code's row for its draw account if there is one, else its row for the sponsor, else the row with neither. So list each code once with `DrawAccount` and `Sponsor` blank, and add a row only where an account or sponsor differs. A code's description is the award's own one if there is one, else the one on the most specific row that has a description. If two rows give the same code and scope different categories, the first one is used and you are warned.

Costs whose code is not in the dictionary are left out of the totals. Quick Draw adds a row for each such code, highlighted at the top of the table, so you only fill in its category; the Report tab warns before you copy or download anything that leaves costs out. A `BudgetCategory` of `Exclude` leaves a code's costs out on purpose, such as unallowable costs. The downloaded workbook also has an "Unmapped codes" sheet in dictionary format.

Quick Draw also warns you when two category names differ only by spacing, punctuation, case, a dash, `&` versus "and" or a plural, such as "Other Direct Costs - Services" and "Other Direct Costs – Service". Left alone, those become separate lines in the totals.

#### Awards sheet

| Column | Required | What it holds |
|---|---|---|
| `Award` | yes | The award identifier, matching the expenses file |
| `Sponsor` | no | The award's sponsor, used when the expenses don't give one |
| `DrawAccount` | no | The award's draw account, used when the expenses don't give one |
| `Goal` | no | A few words on what the award is for, such as "mapping groundwater recharge in the upper basin" |
| `Template` | no | The `Name` of the template this award uses, when it should read differently from the rest of its account |

With `Sponsor` and `DrawAccount` here, the expenses file can be as simple as `Award`, `CostCode` and `Cost`. When the expenses do give them and they differ, the expenses win and you are warned. Awards in the expenses that this sheet lacks are added for you, with their sponsor and draw account filled in and the empty goal highlighted.

Templates write the goal with `{{ goal }}`. An award without one gets the marker `[describe the award's goal]`, and the Report tab flags it until you fill it in.

#### Templates sheet

One row per template.

| Column | Required | What it holds |
|---|---|---|
| `Name` | no | A name to pick the template by. Without one, it is called by its draw account or sponsor, or "Default". |
| `DrawAccount` | no | The account that uses this template automatically |
| `Sponsor` | no | The sponsor whose accounts use this template automatically, unless an account has its own |
| `Template` | yes | The justification text, in [Jinja](https://jinja.palletsprojects.com/en/stable/templates/) syntax |
| `MaxLength` | no | The payment system's character limit, such as 1000. Justifications over it are flagged. |

An award uses the template its row on the Awards sheet names. Otherwise it uses the first template for its draw account, else the first for its sponsor, else the first with neither. Picking a template for an award on the Report tab writes its name to the Awards sheet, so the choice is kept.

#### The template builder

The Templates tab has two views of the same template. **Builder** shows each value, loop and condition as a labeled block, such as *Award* or *For each category*: drag blocks in from the list, or click one to add it at the cursor, and type your own words around them. A loop is a single block: click it to open a window where you write the text once for one item, choose what goes between items, before the last one ("and") and when there are none, and see the whole list previewed. A loop inside a loop is a block in that window, so you drill down one level at a time. **Jinja** shows the text that is saved in the file. Below the editor, Quick Draw names any mistake and where it is, and previews the result for any award with its character count. The tab's **How to write a template** section explains everything below with examples.

#### What a template can use

`{{ name }}` writes a value:

| Value | Becomes |
|---|---|
| `{{ award }}` | The award identifier |
| `{{ account }}` and `{{ sponsor }}` | The draw account and its sponsor |
| `{{ start }}` and `{{ end }}` | The earliest and latest `CostDate` for the award, as MM/DD/YYYY |
| `{{ total }}` | The total of all mapped costs, with no dollar sign |
| `{{ costs }}` | Each budget category with its amount, such as `Salaries & Wages $12,400.00, Travel $850.00` |
| `{{ descriptions }}` | The descriptions of the codes behind the costs, separated by semicolons |
| `{{ goal }}` | The award's goal from the Awards sheet, or the marker `[describe the award's goal]` |

`{% for c in categories %} … {% endfor %}` repeats its text for each budget category. Each `c` has `c.name`, `c.amount` and `c.codes`. Each code in `c.codes`, or in the award-wide list `codes`, has `code.code`, `code.amount`, `code.description` and `code.category`. Inside a loop, `loop.first`, `loop.last` and `loop.index` tell you where you are. `{% if … %} … {% elif … %} … {% else %} … {% endif %}` writes text only when something is true or not blank.

Filters change how a value looks: `upper`, `lower`, `title`, `capitalize`, `trim`, `default`, `replace`, `length`, `first`, `last`, `join` and `map`. A dash inside a tag, as in `{%- … -%}`, removes the spaces and line breaks next to it.

Two example templates:

```
Payment for {{ costs }}, incurred {{ start }} through {{ end }} under award {{ award }}, for allowable costs in the approved budget to carry out {{ goal }}. Total ${{ total }}.
```

```
Drawdown for award {{ award }}: {% for c in categories %}{{ c.name }} ${{ c.amount }} ({{ c.codes | map("description") | join(", ") }}){% if not loop.last %}; {% endif %}{% endfor %}. Total ${{ total }}.
```

Quick Draw runs templates with its own small Jinja interpreter. It never runs code from a template, so a template can only read the values above, and a dictionary workbook from someone else cannot reach your data.

## Run it locally

The site is static. GitHub Pages serves `docs/` from `main`, so every push to `main` updates the live site within a minute or two. `docs/.nojekyll` tells Pages to serve the folder as is, without running it through Jekyll. To preview it, serve that folder with any static web server:

```bash
npm run serve
```

Then open http://localhost:4317. This runs [`scripts/serve.py`](scripts/serve.py), which tells the browser not to cache the page's files, so a reload always runs the latest code. Any static server works too, such as `python3 -m http.server 4317 -d docs`, but after changing the code you may need a hard reload (Cmd+Shift+R) to avoid a mix of old and new files. Opening `index.html` straight from disk does not work, because browsers block its scripts there.

Everything is plain HTML, CSS and JavaScript with no build step. Two libraries are kept in `docs/vendor/` so the page loads nothing from other sites: [ExcelJS](https://github.com/exceljs/exceljs) for reading and writing workbooks, and the bar-chart build of [Plotly](https://github.com/plotly/plotly.js), which loads only when a chart is first shown. Both are MIT licensed.

To run the tests, which use Node's built-in test runner and need nothing installed:

```bash
npm test
```

The sample dictionary workbook is built from the rows in [`scripts/build-samples.js`](scripts/build-samples.js). After changing them, run `npm run samples`. The tests and the script use the page's own copy of ExcelJS, so neither needs anything installed.

## Contributing

Contributions are welcome by pull request, and bugs can be reported as [GitHub Issues](https://github.com/ui-insight/quick-draw/issues). Please don't attach real expense data to an issue; use the sample files or made-up numbers. By submitting a contribution you agree that it will be licensed under the [Apache License, Version 2.0](LICENSE), the same license as the project, and you represent that you have the right to license it under those terms. Contributions keep the attribution in [NOTICE](NOTICE) intact.

## Disclaimer

Quick Draw is an independent project. It is not an official product of any sponsor, federal agency or payment system, and neither the U.S. National Science Foundation nor the University of Idaho endorses it. It drafts justifications from the files and templates you provide; the totals and text are provided as is, without warranty of any kind, and are not financial, accounting, legal or compliance advice. Review every total and justification against your financial system and the award terms before you submit it.

## License

Copyright 2026 Nathan Layman.

Licensed under the [Apache License, Version 2.0](LICENSE). The [NOTICE](NOTICE) file carries four attributions: Nathan Layman as the author, the University of Idaho, the AI4RA project, and the National Science Foundation award that funded the work. Under Section 4(d) of the license, anyone who redistributes this software or a derivative work must keep all four. NOTICE also credits the two open source libraries Quick Draw includes, ExcelJS and Plotly.js (both MIT). To cite the project, use [CITATION.cff](CITATION.cff).

## Acknowledgments

Quick Draw is a project of [AI4RA](https://github.com/AI4RA) at the University of Idaho. This material is based upon work supported by the National Science Foundation under the GRANTED program, [NSF Award #2427549](https://www.nsf.gov/awardsearch/show-award?AWD_ID=2427549), "Crossing the Innovation Valley of Death: Democratizing Data and Artificial Intelligence for Research Administration." Any opinions, findings, conclusions or recommendations expressed in this material are those of the author and do not necessarily reflect the views of the National Science Foundation.
