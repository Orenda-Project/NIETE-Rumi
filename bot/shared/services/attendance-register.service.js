/**
 * The cumulative monthly teacher-attendance register.
 *
 * A tally on a Flow screen is not a register — it is gone the moment the principal
 * taps Done. What a school actually keeps is the month-to-date sheet, and the shape
 * that has already proven itself is the upstream student register's: one row per person, one
 * narrow column per day of the month, running totals on the right, weekends greyed.
 * Regenerated in full after every submit, so the newest file always holds the whole
 * month and there is never a set of partial files to reconcile.
 *
 * ONE DELIBERATE DIFFERENCE from the upstream student register: a third status. That
 * one knows only P and A. Here Leave is a first-class status in
 * teacher_attendance_records, and collapsing L into A would report approved leave as
 * absence — a misreport against a colleague, in the document the school files.
 *
 * The attendance RATE therefore divides by the days actually worked (present +
 * absent) and not by every marked day: approved leave is neither attendance nor a
 * black mark against it.
 */

const ExcelJS = require('exceljs');
const { logToFile } = require('../utils/logger');

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** One letter per status, and nothing for a day nobody marked. */
const CODES = { present: 'P', absent: 'A', leave: 'L' };

const COLORS = {
  headerBg: 'FF1F4E5F',
  border: 'FFBFBFBF',
  presentBg: 'FFE8F5E9',
  presentText: 'FF1B5E20',
  absentBg: 'FFFFEBEE',
  absentText: 'FFB71C1C',
  leaveBg: 'FFFFF8E1',
  leaveText: 'FF8D6E00',
  weekendHeaderBg: 'FF808080',
  weekendBg: 'FFE8E8E8',
  weekendText: 'FF999999',
};

function personName(p) {
  const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
  return name || p.student_name || p.phone_number || 'Unnamed';
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

/** Saturdays and Sundays, as day-of-month numbers. */
function getWeekendDays(year, month) {
  if (!year || !month) return [];
  const out = [];
  for (let day = 1; day <= daysInMonth(year, month); day += 1) {
    const dow = new Date(year, month - 1, day).getDay();
    if (dow === 0 || dow === 6) out.push(day);
  }
  return out;
}

/**
 * `Teacher_Attendance_<School>_<Month>_<Year>.xlsx` for staff,
 * `Attendance_<Class>_<Month>_<Year>.xlsx` for a class.
 *
 * Named for the roster and the month rather than the day, because it IS the month:
 * a date-stamped name would read as one day's file and invite a folder of thirty.
 */
function formatMonthlyFileName(name, month, year, subject = 'teacher') {
  const safe = String(name || 'School')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
  const prefix = subject === 'student' ? 'Attendance' : 'Teacher_Attendance';
  return `${prefix}_${safe || 'School'}_${MONTH_NAMES[month - 1]}_${year}.xlsx`;
}

/**
 * person × day → status code.
 *
 * Everyone on the roster gets an entry even with no records at all, so a teacher who
 * joined mid-month appears as a row of blanks rather than vanishing from the register.
 *
 * @param {Array} people   [{ id, first_name, last_name }]
 * @param {Array} records  [{ teacher_id, date: 'YYYY-MM-DD', status }]
 */
function buildMatrix(people, records) {
  const matrix = {};
  for (const person of people || []) {
    matrix[person.id] = { person, days: {} };
  }

  for (const record of records || []) {
    const entry = matrix[record.teacher_id || record.person_id || record.student_id];
    if (!entry) continue;
    const code = CODES[record.status];
    if (!code) continue;
    // Parsed off the string rather than through Date: `new Date('2026-08-03')` is
    // midnight UTC, and in any positive offset .getDate() is still the 3rd — but in
    // a negative one it is the 2nd, and the register would shift a column.
    const day = Number(String(record.date || '').slice(8, 10));
    if (day >= 1 && day <= 31) entry.days[day] = code;
  }

  return matrix;
}

/**
 * One person's month.
 *
 * The rate is present / (present + absent). Leave is excluded from BOTH sides — it is
 * a day the school agreed they would not be there, so counting it as absence
 * penalises approved leave and counting it as attendance inflates the figure.
 */
function monthlyStats(days) {
  const values = Object.values(days || {});
  const present = values.filter((v) => v === 'P').length;
  const absent = values.filter((v) => v === 'A').length;
  const leave = values.filter((v) => v === 'L').length;
  const worked = present + absent;

  return {
    present,
    absent,
    leave,
    percentage: worked ? Math.round((present / worked) * 100) : 0,
  };
}

function thinBorder() {
  const side = { style: 'thin', color: { argb: COLORS.border } };
  return { top: side, left: side, bottom: side, right: side };
}

/**
 * The workbook.
 *
 * @param {{schoolName: string}} metadata
 * @param {number} month 1-12
 * @param {number} year
 * @param {Array} people
 * @param {Array} records
 * @returns {Promise<Buffer>}
 */
async function createMonthlyRegisterBuffer(metadata, month, year, people, records) {
  const workbook = new ExcelJS.Workbook();
  const isStudent = (metadata && metadata.subject) === 'student';
  workbook.creator = isStudent ? 'NIETE Student Attendance' : 'NIETE Teacher Attendance';

  const total = daysInMonth(year, month);
  const weekends = getWeekendDays(year, month);
  const matrix = buildMatrix(people, records);
  // A class register leads with the roll number, because that is the order a teacher
  // reads a register in and the key she will cross-check against her own book. Staff
  // have no roll numbers, so their sheet starts at the name.
  const idCols = isStudent ? 2 : 1;
  const lastCol = idCols + total + 4;   // [roll] + name + days + P + A + L + %
  const title = (metadata && (metadata.title || metadata.schoolName)) || 'Register';

  const sheet = workbook.addWorksheet(isStudent ? 'Class Register' : 'Teacher Register', {
    // Freeze the names and the four header rows, so scrolling into the 20s of the
    // month still shows whose row it is.
    views: [{ state: 'frozen', xSplit: idCols, ySplit: 4 }],
  });

  // ── Header ────────────────────────────────────────────────────────────────
  const titleRow = sheet.addRow([
    isStudent ? 'Monthly Attendance Register' : 'Monthly Teacher Attendance Register',
  ]);
  sheet.mergeCells(1, 1, 1, lastCol);
  titleRow.font = { bold: true, size: 14 };
  titleRow.alignment = { horizontal: 'center' };
  titleRow.height = 24;

  sheet.addRow([isStudent ? 'Class:' : 'School:', title]);
  sheet.addRow(['Month:', `${MONTH_NAMES[month - 1]} ${year}`]);

  const header = isStudent ? ['Roll #', 'Student'] : ['Teacher'];
  for (let day = 1; day <= total; day += 1) header.push(String(day));
  header.push('P', 'A', 'L', '%');

  const headerRow = sheet.addRow(header);
  headerRow.height = 24;
  headerRow.eachCell((cell, col) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = thinBorder();
    const weekend = col > idCols && col <= total + idCols && weekends.includes(col - idCols);
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: weekend ? COLORS.weekendHeaderBg : COLORS.headerBg },
    };
  });

  const dayNames = new Array(idCols).fill('');
  for (let day = 1; day <= total; day += 1) {
    dayNames.push(DAY_NAMES[new Date(year, month - 1, day).getDay()]);
  }
  dayNames.push('', '', '', '');
  const subHeader = sheet.addRow(dayNames);
  subHeader.height = 16;
  subHeader.eachCell((cell, col) => {
    cell.font = { size: 8, color: { argb: 'FF666666' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    if (col > idCols && col <= total + idCols && weekends.includes(col - idCols)) {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.weekendBg } };
    }
  });

  // ── Rows ──────────────────────────────────────────────────────────────────
  for (const person of people || []) {
    const days = matrix[person.id]?.days || {};
    const stats = monthlyStats(days);

    const values = isStudent ? [person.roll_number ?? '', personName(person)] : [personName(person)];
    for (let day = 1; day <= total; day += 1) values.push(days[day] || '-');
    values.push(stats.present, stats.absent, stats.leave, `${stats.percentage}%`);

    const row = sheet.addRow(values);
    row.eachCell((cell, col) => {
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder();
      cell.font = { size: 9 };

      if (col <= idCols) {
        // The name reads left-aligned; a roll number stays centred like a number.
        if (col === idCols) cell.alignment = { horizontal: 'left', vertical: 'middle' };
        return;
      }

      if (col > idCols && col <= total + idCols) {
        const day = col - idCols;
        const code = days[day];
        const weekend = weekends.includes(day);

        if (weekend) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.weekendBg } };
          cell.font = { size: 9, color: { argb: COLORS.weekendText } };
        }
        if (code === 'P') {
          cell.font = { bold: true, size: 9, color: { argb: COLORS.presentText } };
          if (!weekend) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.presentBg } };
        } else if (code === 'A') {
          cell.font = { bold: true, size: 9, color: { argb: COLORS.absentText } };
          if (!weekend) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.absentBg } };
        } else if (code === 'L') {
          cell.font = { bold: true, size: 9, color: { argb: COLORS.leaveText } };
          if (!weekend) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.leaveBg } };
        }
        return;
      }

      if (col === lastCol) {
        if (stats.percentage >= 90) cell.font = { bold: true, size: 9, color: { argb: COLORS.presentText } };
        else if (stats.percentage < 75) cell.font = { bold: true, size: 9, color: { argb: COLORS.absentText } };
      }
    });
  }

  // ── Widths ────────────────────────────────────────────────────────────────
  if (isStudent) { sheet.getColumn(1).width = 6; sheet.getColumn(2).width = 24; }
  else sheet.getColumn(1).width = 24;
  for (let col = idCols + 1; col <= total + idCols; col += 1) sheet.getColumn(col).width = 3.5;
  for (let col = total + idCols + 1; col <= lastCol; col += 1) sheet.getColumn(col).width = 5;

  const buffer = await workbook.xlsx.writeBuffer();
  logToFile('📗 Register generated', {
    subject: isStudent ? 'student' : 'teacher', roster: title, month, year,
    people: (people || []).length, bytes: buffer.length,
  });
  return Buffer.from(buffer);
}

module.exports = {
  createMonthlyRegisterBuffer,
  buildMatrix,
  monthlyStats,
  getWeekendDays,
  formatMonthlyFileName,
  personName,
  daysInMonth,
  MONTH_NAMES,
  DAY_NAMES,
  CODES,
};
