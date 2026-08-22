/**
 * ExcelJS mock for the root test suite.
 *
 * exceljs lives in bot/node_modules and CI runs the root suite BEFORE `bot/ npm ci`,
 * so a test that loads register-generating source cannot require the real library.
 *
 * This is a RECORDING stub rather than a no-op: it keeps every row and cell written,
 * which is what the register tests actually assert on. Parsing a real workbook would
 * mostly test ExcelJS; reading back the rows tests the register logic, which is ours.
 */

class Cell {
  constructor(row, col, value) {
    this.row = row;
    this.col = col;
    this.value = value;
    this.font = undefined;
    this.fill = undefined;
    this.border = undefined;
    this.alignment = undefined;
  }
}

class Row {
  constructor(number, values) {
    this.number = number;
    this.values = values;
    this.height = undefined;
    this.font = undefined;
    this.alignment = undefined;
    this._cells = values.map((v, i) => new Cell(number, i + 1, v));
  }

  getCell(col) {
    return this._cells[col - 1] || new Cell(this.number, col, undefined);
  }

  eachCell(fn) {
    this._cells.forEach((cell, i) => fn(cell, i + 1));
  }
}

class Column {
  constructor(number) {
    this.number = number;
    this.width = undefined;
  }
}

class Worksheet {
  constructor(name, options) {
    this.name = name;
    this.options = options;
    this.rows = [];
    this.merges = [];
    this._columns = new Map();
  }

  get columnCount() {
    return this.rows.reduce((max, r) => Math.max(max, r.values.length), 0);
  }

  get rowCount() {
    return this.rows.length;
  }

  addRow(values) {
    const row = new Row(this.rows.length + 1, [...values]);
    this.rows.push(row);
    return row;
  }

  getRow(n) {
    return this.rows[n - 1];
  }

  eachRow(fn) {
    this.rows.forEach((row, i) => fn(row, i + 1));
  }

  mergeCells(...args) {
    this.merges.push(args);
  }

  getColumn(n) {
    if (!this._columns.has(n)) this._columns.set(n, new Column(n));
    return this._columns.get(n);
  }
}

class Workbook {
  constructor() {
    this.worksheets = [];
    this.creator = undefined;
    this.created = undefined;
    this.xlsx = {
      // A deterministic, non-empty buffer: callers assert it exists and has length,
      // and the shape assertions read `worksheets` instead.
      writeBuffer: async () => Buffer.from(JSON.stringify(
        this.worksheets.map((s) => ({ name: s.name, rows: s.rows.map((r) => r.values) })),
      )),
      load: async () => { throw new Error('exceljs mock cannot parse a workbook — assert on worksheets instead'); },
      writeFile: async () => undefined,
    };
  }

  addWorksheet(name, options) {
    const sheet = new Worksheet(name, options);
    this.worksheets.push(sheet);
    return sheet;
  }

  getWorksheet(nameOrIndex) {
    if (typeof nameOrIndex === 'number') return this.worksheets[nameOrIndex - 1];
    return this.worksheets.find((s) => s.name === nameOrIndex);
  }
}

module.exports = { Workbook, Worksheet, Row, Cell };
