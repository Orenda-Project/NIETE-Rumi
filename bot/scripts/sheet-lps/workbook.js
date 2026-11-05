'use strict';
/**
 * A Google Sheet as plain rows of cells, hyperlinks kept (bd-97daxo.14).
 *
 * The sheet is read as its XLSX export: a CSV export keeps only a cell's text, and the LP PDF cells are a label
 * ("v9 built · open PDF") over a link. Amena's GB matrix is link-viewable, so the export needs no credentials.
 *
 * read(buffer) → { tabs: { [tab name]: rows } }, rows[i][j] = { v: string|number|null, link?: string },
 * 0-based, empty cells included, so a column index found on a header row indexes every row below it.
 */
const ExcelJS = require('exceljs');

const exportUrl = (sheetId) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/export?format=xlsx`;

function textOf(v) {
  if (v == null) return null;
  if (typeof v === 'string' || typeof v === 'number') return v;
  if (typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v.richText)) return v.richText.map((r) => r.text || '').join('');
  if ('text' in v) return textOf(v.text);
  if ('result' in v) return textOf(v.result);
  return null;
}

function cellOf(cell) {
  const raw = cell ? cell.value : null;
  const out = { v: textOf(raw) };
  const link = (raw && typeof raw === 'object' && raw.hyperlink) || (cell && cell.hyperlink) || null;
  if (link) out.link = String(link);
  return out;
}

/** Parse an XLSX buffer. `ExcelJS` is injectable for tests (jest maps the module to a stub). */
async function read(buffer, { ExcelJS: Impl = ExcelJS } = {}) {
  const wb = new Impl.Workbook();
  await wb.xlsx.load(buffer);
  const tabs = {};
  wb.eachSheet((ws) => {
    const rows = [];
    const width = ws.columnCount || 0;
    for (let r = 1; r <= ws.rowCount; r += 1) {
      const row = ws.getRow(r);
      const cells = [];
      for (let c = 1; c <= Math.max(width, row.cellCount); c += 1) cells.push(cellOf(row.getCell(c)));
      rows.push(cells);
    }
    tabs[ws.name] = rows;
  });
  return { tabs };
}

/** Download a link-viewable sheet's XLSX export. */
async function fetchPublic(sheetId, { fetch: fetchImpl = globalThis.fetch } = {}) {
  const res = await fetchImpl(exportUrl(sheetId), { redirect: 'follow' });
  if (!res.ok) throw new Error(`sheet export ${sheetId} answered HTTP ${res.status} (is it still link-viewable?)`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { read, fetchPublic, exportUrl };
