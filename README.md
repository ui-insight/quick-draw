# Quick Draw

Build drawdown justifications in your browser. Upload your expenses, a data dictionary and justification templates as Excel or CSV, and download a workbook with costs rolled up by sponsor budget category. Nothing leaves your computer.

**Use it:** https://ui-insight.github.io/quick-draw/ · **Source:** https://github.com/ui-insight/quick-draw. It is in active development, so expect changes; the **Load the sample files** button shows how it works with made-up data.

Part of [AI4RA](https://ai4ra.uidaho.edu) at the University of Idaho.

**Discuss, or report a problem:** tell us what you think, or what went wrong, on the [AI4RA community on Groups.io](https://groups.ai4ra.uidaho.edu/g/main). Join the [#PostAward](https://groups.ai4ra.uidaho.edu/g/main/search?q=%23PostAward&ct=1) conversation, or start a new topic with #PostAward in the subject line.

## Why

When you draw funds from a federal payment system, many sponsors ask for a short justification of what the money paid for. Writing one by hand for each award means pulling expenses, grouping them into the sponsor's budget categories, totaling them and typing a sentence that fits the payment system's character limit. Quick Draw does the grouping and the totals and drafts the sentence from your template. You review and edit each one before you use it.

Since March 2025, the HHS Payment Management System (PMS) requires a justification of up to 1,000 characters with every payment request, and in October 2026 HHS published [Payment Justification Guidance for HHS Recipients](https://www.hhs.gov/sites/default/files/asfr-payment-justification-guidance-hhs-recipients.pdf), which sets what a justification must say. Quick Draw focuses on that requirement because it covers NIH. Other agencies, payment systems and sponsors ask for justifications too, with different character or word limits and different expectations for detail; a template for each, with its own character limit, handles that. The page's **Help** tab explains it and links to the sources; it was last checked against them on November 7, 2026. Requirements change, so read the agency's current version before relying on it.

It works with any financial system. Export your expenses with the columns below, and Quick Draw takes it from there.

## How it works

The page walks you through its steps, one tab at a time:

1. **Files.** Choose your expenses file and your data dictionary workbook, or drag them onto the page. **Load the sample files** shows how it works with made-up data.
2. **Expenses.** See the rows as Quick Draw read them. Rows whose cost code is not in the dictionary are shaded.
3. **Data dictionary.** See and edit each code's budget category, and each award's goal. A cost code in the expenses that the dictionary lacks is added for you, highlighted at the top of the table, with whatever Quick Draw already knows about it filled in. Give it a category, or type `Exclude` to leave its costs out on purpose.
4. **Templates.** Write the justification wording in the template builder, with a live preview for a real award.
5. **Report.** Tabs for each payment system, each draw account in it, and each award, counting the awards left to copy: the order you work in, signing in to a system, opening an account, then entering each award. For each award, pick its template if it needs a different one, read its justification, its costs and a bar chart of them, and **Copy** it into the payment system. Copy first warns about anything to fix: costs whose code is not in the dictionary, a missing goal, or text over the character limit. You can fill in an award's goal or its own code descriptions right there; they are saved to the dictionary. **Open PMS** (or whichever system the award's account uses) beside Copy opens the payment system to paste into. Download a workbook with one sheet per draw account.
6. **Help.** What HHS requires and how Quick Draw meets it, with links to the sources and payment systems; how the data dictionary works; writing templates; and what to export.

Each tab has its own address, so you can link straight to one, for example [#help](https://ui-insight.github.io/quick-draw/#help). The others are `#files`, `#expenses`, `#dictionary` (with `#dictionary/awards`, `#dictionary/accounts` and `#dictionary/sponsors`), `#templates` and `#report`. Help has a page for each topic: `#help/dictionary`, `#help/templates`, `#help/loops`, `#help/export` and `#help/glossary` (`#requirements` still opens Help). The Glossary button in the header opens the glossary from any tab.

You can edit both files in the page and save the changes. In Chrome and Edge, **Save** writes over the file you opened. In other browsers, download the edited file and use it in place of the old one.

The app runs entirely in your browser. Your files are read on your computer and are never uploaded, and nothing is kept after you close the page. The page's security policy lets it load and connect to its own files only, so nothing it reads can be sent anywhere. Keep your dictionary workbook and bring it back the next time.

## The two files

You need two files: your **expenses**, and a **data dictionary** workbook that holds everything else. Sample files with made-up data are in [`docs/samples/`](docs/samples/), and the page's **Load the sample files** button loads them. Open [`docs/samples/dictionary.xlsx`](docs/samples/dictionary.xlsx) for a ready-made dictionary to copy.

Column names match without regard to case, spaces or underscores, so `CostCode`, `Cost Code` and `cost_code` are the same column. Extra columns are ignored.

### 1. Expenses

An Excel (`.xlsx`) or CSV file, one row per expense. Only the first sheet of a workbook is read.

**Export only the costs in this draw**, from the day after your last draw, with the date each cost was incurred. The justification's amounts and dates come straight from this file, so an inception-to-date or year-to-date export would claim costs already paid. Include indirect costs (F&A) as their own rows if you draw them, and credits as negative amounts; leave out cost share and anything you won't draw (or give those codes the category `Exclude`). The page's **What to export** link has the details.

| Column | Required | What it holds |
|---|---|---|
| `Award` | yes | The award or grant identifier |
| `CostCode` | yes | Your institution's expense or object code |
| `Cost` | yes | The dollar amount. Commas, a `$` and negatives in parentheses are fine, and a lone `-` counts as zero. |
| `DrawAccount` | no | The payment system account the award draws from |
| `Sponsor` | no | The award's sponsor (the agency). A mapping or template can be written once for all of a sponsor's awards. |
| `CostDate` | no | The date of the expense, used for the period start and end. Excel dates, `2026-07-31`, `7/31/2026` and `31-JUL-26` all work. |

### 2. The data dictionary workbook

An Excel workbook with these sheets. Quick Draw finds each one by its columns, so you can rename or reorder them; a missing sheet is added when you save.

| Sheet | What it is for |
|---|---|
| **Read me** | Explains the workbook: what each sheet and column means, how Quick Draw picks a category, description and template, what templates can use, and a glossary. Quick Draw skips it, and adds one when you save a workbook that has none. |
| **Cost codes** | Which sponsor budget category each cost code belongs to, with a plain-language description |
| **Awards** | Each award's draw account, sponsor and short goal, and optionally its template |
| **Draw accounts** | Each draw account's payment system, with the link its **Open** button uses, and optionally a template for all its awards |
| **Sponsors** | The template each sponsor's awards use; the row with `Sponsor` blank is the default |
| **Templates** | The justification wording, as many versions as you like |

The Data dictionary tab shows them from most to least specific: Cost codes, Awards, Draw accounts, Sponsors. An award sits in one draw account; a sponsor is a broader grouping that can span accounts. Templates have their own tab.

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
| `DrawAccount` | no | The award's draw account, used when the expenses don't give one |
| `Sponsor` | no | The award's sponsor, used when the expenses don't give one |
| `Program` | no | The award's program name, for agencies that ask for it, such as DOL. Templates write it with `{{ program }}`. |
| `Goal` | no | A few words on what the award is for, such as "mapping groundwater recharge in the upper basin" |
| `Template` | no | The `Name` of the template this award uses, ahead of its draw account's and sponsor's. The Template menu on the Report tab sets it too. |

With `Sponsor` and `DrawAccount` here, the expenses file can be as simple as `Award`, `CostCode` and `Cost`. When the expenses do give them and they differ, the expenses win and you are warned. Awards in the expenses that this sheet lacks are added for you, with their sponsor and draw account filled in and the empty goal highlighted.

Templates write the goal with `{{ goal }}`. An award without one gets the marker `[describe the award's goal]`, and the Report tab flags it until you fill it in.

#### Draw accounts sheet

| Column | Required | What it holds |
|---|---|---|
| `DrawAccount` | yes | The payment-system account, as in the expenses |
| `PaymentSystem` | no | Where the account requests payment, such as PMS or ASAP. It names the account's tab on the Report and its **Open** button. |
| `URL` | no | The link the **Open** button goes to, starting with `https://`. Without a `PaymentSystem` and `URL`, the account has no button. |
| `Template` | no | The template every award in this account uses, ahead of its sponsor's |

Each draw account names its own payment system and link; Quick Draw has no built-in list of systems or links. This goes by draw account, not sponsor, because one sponsor can use several systems: within DoD, ONR takes payment requests through WAWF while other offices use PMS, and within USDA, NIFA uses ASAP. The Report tab's top row of tabs groups draw accounts by system. The sample puts ACCT-C in [ASAP](https://www.asap.gov/) and everything else in [PMS](https://pms.psc.gov/).

#### Sponsors sheet

| Column | Required | What it holds |
|---|---|---|
| `Sponsor` | no | The sponsor. Leave it blank on one row for the default. |
| `Template` | no | The template this sponsor's awards use. On the row with `Sponsor` blank, the default template for everyone. |

Draw accounts and sponsors found in the expenses get rows added for you. Each tab's `DrawAccount`, `Sponsor`, `Award` and `Template` cells suggest the values on the tabs to its right (Cost codes from Awards, Draw accounts and Sponsors; Awards from Draw accounts, Sponsors and Templates), so you mostly pick. The sample's default is HHS and NIH, and Sponsor B uses DOL VETS.

#### Which template an award uses

Awards, Draw accounts and Sponsors each have a `Template` column. The first one filled in wins, from most to least specific:

1. The award's own, on the Awards sheet. The Template menu on the Report tab sets it too.
2. Its draw account's, on the Draw accounts sheet.
3. Its sponsor's, on the Sponsors sheet.
4. The default: the Sponsors row with `Sponsor` blank, which the **Default template** box on the Templates tab sets. Without one, an award with nothing else set has no justification, and the Report says so.

The Report's menu shows where the usual one comes from, such as "DOL VETS (for Sponsor B)" or "HHS and NIH (default)", and the Templates tab says who uses each template. Awards in one draw account can have different sponsors, and so different templates. Renaming a template updates the `Template` cells that name it.

Workbooks from older versions of Quick Draw are brought up to date when you open them: their Payment systems sheet becomes Draw accounts, and the `Default`, `DrawAccount` and `Sponsor` columns on the Templates sheet move to the Draw accounts and Sponsors sheets. A notice says what moved; save to keep it.

#### Templates sheet

One row per template.

| Column | Required | What it holds |
|---|---|---|
| `Name` | no | The name the `Template` columns pick it by |
| `Template` | yes | The justification text, in [Jinja](https://jinja.palletsprojects.com/en/stable/templates/) syntax |
| `MaxLength` | no | The payment system's character limit, such as 1000. Justifications over it are flagged. |
| `Fallback` | no | The `Name` of a shorter template to use for an award whose justification would run over `MaxLength`. The Report tab says when it was used. |

#### Standard templates

The sample dictionary comes with templates shaped by each agency's stated requirements. To make your own, open one and use **Add as new template**; **+ New template** starts a blank one.

| Template | Follows | What it says |
|---|---|---|
| **HHS / NIH** | [HHS Payment Justification Guidance](https://www.hhs.gov/sites/default/files/asfr-payment-justification-guidance-hhs-recipients.pdf) (2026) | Each budget category with what it paid for, when the costs were incurred, and how they support the award's goal |
| **HHS / NIH short** | The same | Categories only; the fallback when the full version is over the limit |
| **DOL VETS** | [DOL VETS Grant Officer's Memorandum 02-26](https://www.dol.gov/sites/dolgov/files/VETS/files/GO_Memo_02-26_PMS_Mandatory_Payment_Justification.pdf) (2026) | The program, the period, and each category with its amount, adding up to the total |
| **NASA** | [NASA Grant Information Circular 25-01](https://www.nasa.gov/wp-content/uploads/2025/06/gic-25-01-grant-payment-justifications.pdf) (2025) | The amount requested, the approved budget categories, and why |

#### The template builder

The Templates tab has two views of the same template. **Builder** shows each value, loop and condition as a labeled block, such as *Award* or *For each category*: drag blocks in from the list, or click one to add it at the cursor, and type your own words around them. A loop is a single block: click it to open a window where you write the text once for one item, choose what goes between items, before the last one ("and") and when there are none, and see the whole list previewed. A loop inside a loop is a block in that window, so you drill down one level at a time. **Jinja** shows the text that is saved in the file. Below the editor, Quick Draw names any mistake and where it is, and previews the result for any award with its character count. **Help › Templates** explains everything below with examples.

#### What a template can use

`{{ name }}` writes a value:

| Value | Becomes |
|---|---|
| `{{ award }}` | The award identifier |
| `{{ account }}` and `{{ sponsor }}` | The draw account and its sponsor |
| `{{ program }}` | The award's program name, from the Awards sheet |
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

Copies of the HHS guidance and the DOL memo the Help tab quotes are kept in [`docs/references/`](docs/references/), in case an agency moves its file.

Everything is plain HTML, CSS and JavaScript with no build step. Two libraries are kept in `docs/vendor/` so the page loads nothing from other sites: [ExcelJS](https://github.com/exceljs/exceljs) for reading and writing workbooks, and the bar-chart build of [Plotly](https://github.com/plotly/plotly.js), which loads only when a chart is first shown. Both are MIT licensed.

To run the tests, which use Node's built-in test runner and need nothing installed:

```bash
npm test
```

The sample dictionary workbook is built from the rows in [`scripts/build-samples.js`](scripts/build-samples.js). After changing them, run `npm run samples`. The tests and the script use the page's own copy of ExcelJS, so neither needs anything installed.

## Contributing

Contributions are welcome by pull request, and bugs can be reported as [GitHub Issues](https://github.com/ui-insight/quick-draw/issues). Please don't attach real expense data to an issue; use the sample files or made-up numbers. By submitting a contribution you agree that it will be licensed under the [Apache License, Version 2.0](LICENSE), the same license as the project, and you represent that you have the right to license it under those terms. Contributions keep the attribution in [NOTICE](NOTICE) intact.

## Disclaimer

Quick Draw is an independent project, not an official product of, or endorsed by, any sponsor, federal agency, payment system, NSF or the University of Idaho. It runs only in your browser and stores nothing: your files are never sent to AI4RA, the University of Idaho or anyone else. Its totals and text are provided as is, without warranty, and are not financial, legal or compliance advice; review them before you submit.

## License

Copyright 2026 Nathan Layman.

Licensed under the [Apache License, Version 2.0](LICENSE). The [NOTICE](NOTICE) file carries four attributions: Nathan Layman as the author, the University of Idaho, the AI4RA project, and the National Science Foundation award that funded the work. Under Section 4(d) of the license, anyone who redistributes this software or a derivative work must keep all four. NOTICE also credits the two open source libraries Quick Draw includes, ExcelJS and Plotly.js (both MIT). To cite the project, use [CITATION.cff](CITATION.cff).

## Acknowledgments

Quick Draw is a project of [AI4RA](https://github.com/AI4RA) at the University of Idaho. This material is based upon work supported by the National Science Foundation under the GRANTED program, [NSF Award #2427549](https://www.nsf.gov/awardsearch/show-award?AWD_ID=2427549), "Crossing the Innovation Valley of Death: Democratizing Data and Artificial Intelligence for Research Administration." Any opinions, findings, conclusions or recommendations expressed in this material are those of the author and do not necessarily reflect the views of the National Science Foundation.
