// Reading uploads and writing the output workbook. ExcelJS is passed in so
// this module runs in the browser (global ExcelJS) and under Node tests.

import { COLUMNS, README_SHEET, UNMAPPED_SHEET, formatDay, parseCsv, reportReadMeRows } from './core.js';

/** A workbook cell's value as a plain string, number, Date or null. */
export const plainValue = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value !== 'object') return value;
  if ('result' in value) return plainValue(value.result);
  if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
  if ('text' in value) return plainValue(value.text);
  if ('error' in value) return null;
  return String(value);
};

/** Every sheet of an .xlsx as { name, grid }, in workbook order. */
export const readXlsxSheets = async (ExcelJS, buffer) => {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error('This file could not be read as an Excel workbook (.xlsx).');
  }
  return workbook.worksheets.map((sheet) => {
    const grid = [];
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      const cells = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        // A merged range keeps its value in the top-left cell only.
        cells[colNumber - 1] = cell.isMerged && cell.master !== cell ? null : plainValue(cell.value);
      });
      grid[rowNumber - 1] = Array.from(cells, (v) => (v === undefined ? null : v));
    });
    return { name: sheet.name, grid: Array.from(grid, (row) => row ?? []) };
  });
};

/** The first sheet of an .xlsx as a grid of plain values. */
export const readXlsx = async (ExcelJS, buffer) => (await readXlsxSheets(ExcelJS, buffer))[0]?.grid ?? [];

/** CSV bytes as text: UTF-8, falling back to Windows-1252 for older exports. */
export const decodeCsv = (buffer) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('windows-1252').decode(buffer);
  }
};

/** Reads an uploaded file into its sheets, { name, grid }. A CSV is one sheet. */
export const readSheets = async (ExcelJS, name, buffer) => {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'csv') return [{ name: name.replace(/\.[^.]*$/, ''), grid: parseCsv(decodeCsv(buffer)) }];
  if (ext === 'xlsx' || ext === 'xlsm') return readXlsxSheets(ExcelJS, buffer);
  if (ext === 'xls') throw new Error('Older .xls workbooks are not supported. Save the file as .xlsx or .csv and try again.');
  throw new Error('Choose an Excel (.xlsx) or CSV (.csv) file.');
};

/** Reads an uploaded file's first sheet into a grid, by its extension. */
export const readGrid = async (ExcelJS, name, buffer) => {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'csv') return parseCsv(decodeCsv(buffer));
  if (ext === 'xlsx' || ext === 'xlsm') return readXlsx(ExcelJS, buffer);
  if (ext === 'xls') throw new Error('Older .xls workbooks are not supported. Save the file as .xlsx or .csv and try again.');
  throw new Error('Choose an Excel (.xlsx) or CSV (.csv) file.');
};

// ------------------------------------------------------------- writing

const MONEY = '"$"#,##0.00;-"$"#,##0.00';
const THIN = { style: 'thin', color: { argb: 'FFB7B7B7' } };
const BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const fill = (argb) => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const AWARD_FILL = fill('FFDCE9D5');
const HEADER_FILL = fill('FFF1F1F1');
const JUSTIFICATION_FILL = fill('FFFFF6DA');

const writeAccountSheet = (workbook, account, justificationFor) => {
  const sheet = workbook.addWorksheet(account.sheetName);
  sheet.columns = [{ width: 40 }, { width: 16 }, { width: 3 }, { width: 90 }];
  let r = 1;
  for (const award of account.awards) {
    const title = sheet.getCell(r, 1);
    title.value = award.award;
    title.font = { bold: true, size: 14 };
    title.fill = AWARD_FILL;
    title.border = BOX;
    if (award.start !== null) {
      const period = sheet.getCell(r, 2);
      period.value = `${formatDay(award.start)} to ${formatDay(award.end)}`;
      period.font = { italic: true, color: { argb: 'FF555555' } };
    }

    const headers = [
      [1, 'Budget category'],
      [2, 'Amount'],
    ];
    for (const [col, text] of headers) {
      const cell = sheet.getCell(r + 1, col);
      cell.value = text;
      cell.fill = HEADER_FILL;
      cell.border = BOX;
      cell.font = { bold: true };
    }
    sheet.getCell(r + 1, 2).alignment = { horizontal: 'right' };

    const justHeader = sheet.getCell(r + 1, 4);
    justHeader.value = 'Justification';
    justHeader.fill = JUSTIFICATION_FILL;
    justHeader.border = BOX;
    justHeader.font = { bold: true };

    award.categories.forEach((category, i) => {
      const row = r + 2 + i;
      sheet.getCell(row, 1).value = category.name;
      sheet.getCell(row, 1).border = BOX;
      const amount = sheet.getCell(row, 2);
      amount.value = category.cents / 100;
      amount.numFmt = MONEY;
      amount.border = BOX;
    });

    const totalRow = r + 2 + award.categories.length;
    const totalLabel = sheet.getCell(totalRow, 1);
    totalLabel.value = 'Total';
    totalLabel.font = { bold: true };
    totalLabel.border = BOX;
    const total = sheet.getCell(totalRow, 2);
    total.value = award.totalCents / 100;
    total.numFmt = MONEY;
    total.font = { bold: true };
    total.border = BOX;

    // The justification fills column D beside the table, merged down so long
    // text wraps in view.
    const textTop = r + 2;
    const textBottom = Math.max(totalRow, textTop + 3);
    sheet.mergeCells(textTop, 4, textBottom, 4);
    const text = sheet.getCell(textTop, 4);
    text.value = justificationFor(account, award);
    text.alignment = { wrapText: true, vertical: 'top' };
    text.border = BOX;

    r = textBottom + 3;
  }
};

const writeUnmappedSheet = (workbook, unmapped) => {
  const sheet = workbook.addWorksheet(UNMAPPED_SHEET);
  const dictionaryColumns = COLUMNS.dictionary.map((c) => c.name);
  const extra = ['UnmappedCost', 'FoundUnder', 'FoundInAwards'];
  writeRows(sheet, [[...dictionaryColumns, ...extra]]);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = HEADER_FILL;
  sheet.columns = [16, 32, 40, ...dictionaryColumns.slice(3).map(() => 16), 16, 24, 40].map((width) => ({ width }));
  const costColumn = dictionaryColumns.length + 1;
  for (const u of unmapped) {
    // Only CostCode is filled, so a completed row is a general mapping.
    const blanks = dictionaryColumns.slice(1).map(() => '');
    const r = sheet.rowCount + 1;
    writeRows(sheet, [[u.code, ...blanks, u.cents / 100, u.accounts.join(', '), u.awards.join(', ')]], r);
    sheet.getCell(r, costColumn).numFmt = MONEY;
  }
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
};

/**
 * The output workbook: one sheet per draw account, then the unmapped codes in
 * dictionary format. `justificationFor(account, award)` returns the text to
 * write, so the caller's edits are used.
 */
export const buildWorkbook = (ExcelJS, report, justificationFor = (_, award) => award.justification, info = {}) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Quick Draw';
  // A Read me first, saying what the workbook holds and where it came from.
  const readMe = workbook.addWorksheet(README_SHEET);
  const rows = reportReadMeRows(report, info);
  writeRows(readMe, rows);
  styleReadMe(readMe, rows);
  for (const account of report.accounts) writeAccountSheet(workbook, account, justificationFor);
  if (report.unmapped.length > 0) writeUnmappedSheet(workbook, report.unmapped);
  if (workbook.worksheets.length === 0) workbook.addWorksheet('Empty').getCell(1, 1).value = 'No costs mapped to the dictionary.';
  return workbook;
};

// -------------------------------------------------------- saving edits

/** A cell value to write back: plain numbers stay numbers. */
const storedValue = (value) => {
  if (typeof value !== 'string') return value ?? null;
  return /^-?\d+(\.\d+)?$/.test(value.trim()) && value.trim().length < 16 ? Number(value) : value;
};

/**
 * Writes rows cell by cell. (ExcelJS's addRow doesn't recognize arrays made
 * outside its own JavaScript realm, as when the sample script runs it under
 * Node, and silently writes blank rows.)
 */
const writeRows = (sheet, rows, first = 1) => {
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== null && value !== undefined && value !== '') sheet.getCell(first + r, c + 1).value = value;
    });
  });
};

/** Lays out a Read me sheet: wide wrapped text, bold headings. */
const styleReadMe = (sheet, grid) => {
  sheet.columns = [{ width: 34 }, { width: 110 }];
  grid.forEach((row, r) => {
    const [term, meaning] = row;
    const first = sheet.getCell(r + 1, 1);
    const second = sheet.getCell(r + 1, 2);
    first.alignment = { vertical: 'top', wrapText: true };
    second.alignment = { vertical: 'top', wrapText: true };
    if (term && !meaning) {
      first.font = { bold: true, size: r === 0 ? 16 : 13 };
    } else if (term) {
      first.font = { bold: true };
    }
  });
};

/**
 * The bytes of an .xlsx with the given sheets, [{ name, grid, readMe? }]. With
 * an original workbook, each sheet replaces the one with its name (keeping that
 * sheet's cell formatting) or is added; other sheets are kept as they were. A
 * readMe sheet is only added when the workbook has none, never overwritten.
 */
export const writeXlsx = async (ExcelJS, sheets, original = null) => {
  const workbook = new ExcelJS.Workbook();
  if (original) await workbook.xlsx.load(original);
  for (const { name, grid, readMe } of sheets) {
    let sheet = workbook.worksheets.find((ws) => ws.name.toLowerCase() === name.toLowerCase());
    if (readMe) {
      // Never overwrite someone's Read me, but fill in one that is empty.
      if (sheet && sheet.actualRowCount > 0) continue;
      sheet ??= workbook.addWorksheet(name);
      writeRows(sheet, grid);
      styleReadMe(sheet, grid);
      continue;
    }
    if (sheet) {
      for (const range of Object.keys(sheet._merges ?? {})) sheet.unMergeCells(range);
      const width = Math.max(sheet.columnCount, ...grid.map((row) => row?.length ?? 0));
      const height = Math.max(sheet.rowCount, grid.length);
      for (let r = 1; r <= height; r++) {
        for (let c = 1; c <= width; c++) sheet.getCell(r, c).value = null;
      }
    } else {
      sheet = workbook.addWorksheet(name);
      sheet.getRow(1).font = { bold: true };
    }
    grid.forEach((row, r) => {
      (row ?? []).forEach((value, c) => {
        const stored = storedValue(value);
        if (stored !== null && stored !== '') sheet.getCell(r + 1, c + 1).value = stored;
      });
    });
  }
  return workbook.xlsx.writeBuffer();
};
