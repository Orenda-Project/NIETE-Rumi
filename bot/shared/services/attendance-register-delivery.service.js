/**
 * Getting the monthly teacher register into the principal's hands. (bd-43520)
 *
 * Split from attendance-register.service on purpose: that file is pure — people and
 * records in, a buffer out — and stays testable without R2, WhatsApp or a disk. This
 * one is the I/O, and it is written so that every one of those three can fail without
 * costing the register that was just saved.
 *
 * ORDER MATTERS. This runs AFTER the write, never before, so the day just marked is
 * in the file. Generating first ships a sheet missing the very register the principal
 * just saved, which reads as data loss and is the fastest way to lose their trust in
 * the number.
 *
 * The file is regenerated in full every time and named for the school and month, so
 * the newest copy always holds the whole month and there is never a folder of partial
 * days to reconcile.
 */

const supabase = require('../config/supabase');
const { logToFile } = require('../utils/logger');
const AttendanceRegister = require('./attendance-register.service');
const { loadStaffRoster } = require('./attendance-write.service');

/** First and last calendar day of the month a date falls in. */
function monthBounds(date) {
  const [year, month] = String(date).split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  return {
    year,
    month,
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(last)}`,
  };
}

async function loadSchool(schoolId) {
  const { data } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
  return data?.name || 'Your school';
}

async function loadPrincipal(userId) {
  const { data } = await supabase
    .from('users').select('id, phone_number, first_name').eq('id', userId).maybeSingle();
  return data || null;
}

/** Every teacher record for this school in the month containing `date`. */
async function loadMonthRecords(schoolId, bounds) {
  const { data, error } = await supabase
    .from('teacher_attendance_records')
    .select('teacher_id, date, status')
    .eq('school_id', schoolId)
    .gte('date', bounds.start)
    .lte('date', bounds.end);

  if (error) {
    logToFile('⚠️ Could not read the month for the register', { schoolId, error: error.message });
    return [];
  }
  return data || [];
}

/** What the principal reads above the attachment. */
function buildCaption(schoolName, bounds, date, todayTally) {
  const monthName = AttendanceRegister.MONTH_NAMES[bounds.month - 1];
  const lines = [
    '📋 *Teacher Attendance Register*',
    `🏫 ${schoolName}`,
    `📅 ${monthName} ${bounds.year} — up to and including ${date}`,
  ];

  if (todayTally) {
    lines.push(
      '',
      'Just saved:',
      `✅ Present: ${todayTally.present}`,
      `❌ Absent: ${todayTally.absent}`,
      `🟡 On leave: ${todayTally.leave}`,
    );
  }

  lines.push('', 'This file holds the whole month so far — the newest copy replaces the last.');
  return lines.join('\n');
}

/**
 * Generate and send the month-to-date register.
 *
 * Never throws. Every failure is reported in the return value and logged, because the
 * caller has already written the register and must not be made to look like it failed.
 *
 * @param {object} p
 * @param {string} p.principalUserId
 * @param {string} p.schoolId
 * @param {string} p.date              the day just marked, YYYY-MM-DD
 * @param {Array}  [p.staff]           the roster already in hand; loaded if absent
 * @param {object} [p.todayTally]      { present, absent, leave } for the caption
 * @returns {Promise<{delivered: boolean, fileName?: string, url?: string, error?: string}>}
 */
async function deliverTeacherRegister({ principalUserId, schoolId, date, staff, todayTally } = {}) {
  const path = require('path');
  const fs = require('fs');

  try {
    const bounds = monthBounds(date);
    const [schoolName, principal, roster, records] = await Promise.all([
      loadSchool(schoolId),
      loadPrincipal(principalUserId),
      staff && staff.length ? Promise.resolve(staff) : loadStaffRoster(schoolId, principalUserId),
      loadMonthRecords(schoolId, bounds),
    ]);

    if (!principal || !principal.phone_number) {
      // Nothing to send it to. Not an error in the register — an error in the account.
      logToFile('⚠️ Register generated but the principal has no phone number', { principalUserId });
      return { delivered: false, error: 'no_phone_number' };
    }

    const buffer = await AttendanceRegister.createMonthlyRegisterBuffer(
      { schoolName }, bounds.month, bounds.year, roster, records,
    );
    const fileName = AttendanceRegister.formatMonthlyFileName(schoolName, bounds.month, bounds.year);

    // R2 is the archive, not the delivery. A storage outage must not stop the file
    // reaching the person who just made it, so this is attempted and then let go.
    let url = null;
    try {
      const { uploadBuffer } = require('../storage/r2');
      url = await uploadBuffer(
        buffer,
        `attendance/teachers/${schoolId}/${bounds.year}/${String(bounds.month).padStart(2, '0')}/${fileName}`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } catch (error) {
      logToFile('⚠️ Register upload to R2 failed — sending anyway', { error: error.message });
    }

    const { TEMP_DIR } = require('../utils/constants');
    const tempPath = path.join(TEMP_DIR, fileName);
    fs.writeFileSync(tempPath, buffer);

    try {
      const WhatsAppService = require('./whatsapp.service');
      await WhatsAppService.sendDocument(
        principal.phone_number, tempPath, fileName,
        buildCaption(schoolName, bounds, date, todayTally),
      );
    } finally {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* a temp file is not worth an error */ }
    }

    logToFile('✅ Teacher register delivered', {
      principalUserId, schoolId, fileName, records: records.length, roster: roster.length,
    });
    return { delivered: true, fileName, url };
  } catch (error) {
    logToFile('❌ Register delivery failed (the register itself is saved)', {
      principalUserId, schoolId, date, error: error.message,
    });
    return { delivered: false, error: error.message };
  }
}

module.exports = {
  deliverTeacherRegister,
  monthBounds,
  buildCaption,
};
