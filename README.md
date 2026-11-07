# Quick Draw

Build drawdown justifications in your browser. Upload your expenses, a data dictionary and justification templates as Excel or CSV, and download a workbook with costs rolled up by sponsor budget category. Nothing leaves your computer.

**Status:** in development. The app is not live yet. When it is, it will be at https://ui-insight.github.io/quick-draw/.

Part of [AI4RA](https://ai4ra.uidaho.edu) at the University of Idaho.

**Discuss, or report a problem:** tell us what you think, or what went wrong, on the [AI4RA community on Groups.io](https://groups.ai4ra.uidaho.edu/g/main).

## Why

When you draw funds from a federal payment system, many sponsors ask for a short justification of what the money paid for. Writing one by hand for each award means pulling expenses, grouping them into the sponsor's budget categories, totaling them and typing a sentence that fits the payment system's character limit. Quick Draw does the grouping and the totals and drafts the sentence from your template. You review and edit each one before you use it.

It works with any financial system. Export your expenses with the columns below, and Quick Draw takes it from there.

## How it works

1. Upload three files: your expenses, your data dictionary and your justification templates.
2. Quick Draw maps each cost code to a budget category, totals the costs for each award and drafts a justification from the matching template.
3. Review each award's totals and justification, and edit the text if you need to.
4. Download a workbook with one sheet per draw account, each award's budget categories and totals, and its justification.

The app runs entirely in your browser. Your files are read on your computer and are never uploaded, and nothing is kept after you close the page. Keep your dictionary and templates, and bring them back the next time.

## The three files

Each file can be Excel (`.xlsx`) or CSV, and only the first sheet of a workbook is read. Column names must match exactly. Extra columns are ignored. Sample files with fake data will be in `docs/samples/`.

### 1. Expenses

One row per expense.

| Column | Required | What it holds |
|---|---|---|
| `Award` | yes | The award or grant identifier |
| `CostCode` | yes | Your institution's expense or object code |
| `Cost` | yes | The dollar amount |
| `DrawAccount` | no | The payment system account the award draws from, for grouping |
| `CostDate` | no | The date of the expense, used for the period start and end |

### 2. Data dictionary

One row per cost code. This is where you say which budget category each code belongs to.

| Column | Required | What it holds |
|---|---|---|
| `CostCode` | yes | The cost code, matching the expenses file |
| `BudgetCategory` | yes | The sponsor budget category, such as Salaries & Wages |
| `Description` | no | What the code covers, in words a sponsor would understand |
| `DrawAccount` | no | Leave blank for a mapping that applies everywhere. Fill it in when one sponsor categorizes the code differently. |
| `Award` | no | Fill it in to give the code a description for one award only. It replaces the general description for that award. |

Costs whose code is not in the dictionary are left out of the totals. They are listed, with their dollar amounts, on a sheet of the output in dictionary format, so you can fill in the budget category and add the rows to your dictionary.

Quick Draw also warns you when two category names differ only by spacing, punctuation or a dash, such as "Other Direct Costs - Services" and "Other Direct Costs – Service". Left alone, those become separate lines in the totals.

### 3. Templates

One row per draw account, plus a default.

| Column | Required | What it holds |
|---|---|---|
| `DrawAccount` | no | The account the template applies to. Leave it blank for the default template. |
| `Template` | yes | The justification text, with placeholders |
| `MaxLength` | no | The payment system's character limit, such as 1000 |

Placeholders in a template are replaced for each award:

| Placeholder | Becomes |
|---|---|
| `{award}` | The award identifier |
| `{costs}` | Each budget category with its amount, such as `Salaries & Wages $12,400.00, Travel $850.00` |
| `{total}` | The total of all mapped costs |
| `{start}` and `{end}` | The earliest and latest `CostDate` for the award |
| `{work}` | A marker you replace with the work the costs supported |

An example template:

```
Payment for {costs}, incurred {start} through {end} under award {award}, for allowable costs in the approved budget to carry out {work}. Total ${total}.
```

## Run it locally

The site is static. GitHub Pages serves `docs/` from `main`. To preview it, serve that folder with any static web server:

```bash
python3 -m http.server 4173 -d docs
```

Then open http://localhost:4173.

## Contributing

Contributions are welcome by pull request, and bugs can be reported as [GitHub Issues](https://github.com/ui-insight/quick-draw/issues). Please don't attach real expense data to an issue; use the sample files or made-up numbers. By submitting a contribution you agree that it will be licensed under the [Apache License, Version 2.0](LICENSE), the same license as the project, and you represent that you have the right to license it under those terms. Contributions keep the attribution in [NOTICE](NOTICE) intact.

## License

Copyright 2026 Nathan Layman.

Licensed under the [Apache License, Version 2.0](LICENSE). The [NOTICE](NOTICE) file carries four attributions: Nathan Layman as the author, the University of Idaho, the AI4RA project, and the National Science Foundation award that funded the work. Under Section 4(d) of the license, anyone who redistributes this software or a derivative work must keep all four. To cite the project, use [CITATION.cff](CITATION.cff).

## Acknowledgments

Quick Draw is a project of [AI4RA](https://github.com/AI4RA) at the University of Idaho. This material is based upon work supported by the National Science Foundation under the GRANTED program, [NSF Award #2427549](https://www.nsf.gov/awardsearch/show-award?AWD_ID=2427549), "Crossing the Innovation Valley of Death: Democratizing Data and Artificial Intelligence for Research Administration." Any opinions, findings, conclusions or recommendations expressed in this material are those of the author and do not necessarily reflect the views of the National Science Foundation.
