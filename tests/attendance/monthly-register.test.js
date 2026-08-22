/**
 * The cumulative monthly register — the artifact the principal actually keeps.
 * (bd-43520)
 *
 * A day's tally shown on a Flow screen and then gone is not a register. The
 * original Rumi attendance flow (bd-199) sent an .xlsx after every submit holding
 * the whole month to date — a person x days matrix — and that is the shape being
 * matched here, with one addition this deployment needs: a third status. Rumi's
 * register knows P and A; NIETE records Leave as a first-class status, so an L that
 * collapsed into A would misreport approved leave as absence.
 */

jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));

const ExcelJS = require('exceljs');   // recording stub — see tests/__mocks__/exceljs.js
const register = require('../../bot/shared/services/attendance-register.service');

const STAFF = [
  { id: 'u1', first_name: 'Ayesha', last_name: 'Khan' },
  { id: 'u2', first_name: 'Bilal', last_name: 'Ahmed' },
  { id: 'u3', first_name: 'Sana', last_name: 'Iqbal' },
];

// August 2026: the 3rd is a Monday, the 8th a Saturday.
const RECORDS = [
  { teacher_id: 'u1', date: '2026-08-03', status: 'present' },
  { teacher_id: 'u2', date: '2026-08-03', status: 'absent' },
  { teacher_id: 'u3', date: '2026-08-03', status: 'leave' },
  { teacher_id: 'u1', date: '2026-08-04', status: 'present' },
  { teacher_id: 'u2', date: '2026-08-04', status: 'present' },
  { teacher_id: 'u3', date: '2026-08-04', status: 'absent' },
];

describe('the matrix', () => {
  it('places each person on each day they have a record', () => {
    const m = register.buildMatrix(STAFF, RECORDS);
    expect(m.u1.days[3]).toBe('P');
    expect(m.u2.days[3]).toBe('A');
    expect(m.u3.days[3]).toBe('L');
    expect(m.u3.days[4]).toBe('A');
  });

  it('keeps leave distinct from absence', () => {
    const m = register.buildMatrix(STAFF, RECORDS);
    expect(m.u3.days[3]).not.toBe('A');
  });

  it('leaves an unmarked day blank rather than assuming anything', () => {
    const m = register.buildMatrix(STAFF, RECORDS);
    expect(m.u1.days[5]).toBeUndefined();
  });

  it('includes a person with no records at all', () => {
    const m = register.buildMatrix([...STAFF, { id: 'u9', first_name: 'New', last_name: 'Joiner' }], RECORDS);
    expect(m.u9).toBeDefined();
    expect(Object.keys(m.u9.days)).toEqual([]);
  });
});

describe('the per-person totals', () => {
  it('counts present, absent and leave separately', () => {
    const s = register.monthlyStats({ 3: 'P', 4: 'A', 5: 'L', 6: 'P' });
    expect(s).toMatchObject({ present: 2, absent: 1, leave: 1 });
  });

  it('rates attendance over the days actually marked, not the whole month', () => {
    const s = register.monthlyStats({ 3: 'P', 4: 'A' });
    expect(s.percentage).toBe(50);
  });

  it('counts approved leave as neither present nor absent for the rate', () => {
    // Two marked working days, one attended: leave is not a black mark.
    const s = register.monthlyStats({ 3: 'P', 4: 'A', 5: 'L' });
    expect(s.percentage).toBe(50);
  });

  it('does not divide by zero for someone never marked', () => {
    expect(register.monthlyStats({}).percentage).toBe(0);
  });
});

describe('weekends', () => {
  it('knows which days of August 2026 are weekends', () => {
    const w = register.getWeekendDays(2026, 8);
    expect(w).toContain(8);   // Saturday
    expect(w).toContain(9);   // Sunday
    expect(w).not.toContain(10);
  });
});

describe('the filename', () => {
  it('names the school and the month', () => {
    const f = register.formatMonthlyFileName('GGPS Dhoke Ratta', 8, 2026);
    expect(f).toBe('Teacher_Attendance_GGPS_Dhoke_Ratta_August_2026.xlsx');
  });

  it('survives a school name full of punctuation', () => {
    const f = register.formatMonthlyFileName('G.G.P.S #4 (Girls)/Ratta', 8, 2026);
    expect(f).toMatch(/^Teacher_Attendance_[A-Za-z0-9_]+_August_2026\.xlsx$/);
  });
});

describe('the workbook', () => {
  let sheet;
  let buffer;

  beforeAll(async () => {
    buffer = await register.createMonthlyRegisterBuffer(
      { schoolName: 'GGPS Dhoke Ratta' }, 8, 2026, STAFF, RECORDS,
    );
    // The stub records what was written; ExcelJS's own serialisation is not ours
    // to test, and the real library is not installed in the root suite.
    const wb = new ExcelJS.Workbook();
    sheet = null;
    // createMonthlyRegisterBuffer built its own workbook — read the rows back off
    // the buffer the stub produced.
    const written = JSON.parse(buffer.toString());
    sheet = written[0];
    expect(wb.worksheets).toEqual([]);   // sanity: the stub is per-instance
  });

  it('produces a non-empty buffer for one sheet', () => {
    expect(buffer.length).toBeGreaterThan(0);
    expect(sheet.name).toBe('Teacher Register');
  });

  it('names the school and the month in the header', () => {
    const text = sheet.rows.flat().map((v) => String(v ?? '')).join(' ');
    expect(text).toContain('GGPS Dhoke Ratta');
    expect(text).toContain('August 2026');
  });

  it('has a column for every day of the month, plus the totals', () => {
    // Teacher name + 31 days + P + A + L + %
    const widest = Math.max(...sheet.rows.map((r) => r.length));
    expect(widest).toBe(1 + 31 + 4);
  });

  it('has one row per teacher, named, in roster order', () => {
    const names = sheet.rows
      .map((r) => String(r[0] ?? ''))
      .filter((n) => /Khan|Ahmed|Iqbal/.test(n));
    expect(names).toEqual(['Ayesha Khan', 'Bilal Ahmed', 'Sana Iqbal']);
  });

  it('writes P, A and L into the day cells', () => {
    const cells = sheet.rows.flat().map((v) => String(v ?? ''));
    expect(cells).toContain('P');
    expect(cells).toContain('A');
    expect(cells).toContain('L');
  });

  it('leaves an unmarked day as a dash rather than blank', () => {
    // A blank cell reads as "the file is broken"; a dash reads as "not marked".
    const ayesha = sheet.rows.find((r) => r[0] === 'Ayesha Khan');
    expect(ayesha[1 + 5]).toBe('-');   // the 5th, never marked
  });

  it('puts the day-of-month numbers and their weekday names above the grid', () => {
    const dayHeader = sheet.rows.find((r) => r[0] === 'Teacher');
    expect(dayHeader[1]).toBe('1');
    expect(dayHeader[31]).toBe('31');
    expect(dayHeader.slice(-4)).toEqual(['P', 'A', 'L', '%']);

    const weekdays = sheet.rows[sheet.rows.indexOf(dayHeader) + 1];
    expect(weekdays[3]).toBe('Mon');   // 3 August 2026
    expect(weekdays[8]).toBe('Sat');
  });
});
