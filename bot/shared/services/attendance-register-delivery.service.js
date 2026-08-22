/**
 * Getting the monthly teacher register into the principal's hands.
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
const { rosterLabel } = require('./classes/roster-label');

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

/**
 * Every record for this roster in the month containing `date`, flattened to the one
 * shape buildMatrix() reads: { <person key>, date, status }.
 *
 * Two stores, because attendance is written to two: staff are one row per teacher per
 * day in teacher_attendance_records, students are a session per class per day with
 * child rows. Reconciled HERE rather than in the generator, so the workbook code has
 * one shape to render and does not grow a second branch.
 */
async function loadMonthRecords(subject, targetId, bounds) {
  if (subject === 'teacher') {
    const { data, error } = await supabase
      .from('teacher_attendance_records')
      .select('teacher_id, date, status')
      .eq('school_id', targetId)
      .gte('date', bounds.start)
      .lte('date', bounds.end);
    if (error) {
      logToFile('⚠️ Could not read the month for the register', { targetId, error: error.message });
      return [];
    }
    return data || [];
  }

  const { data: sessions, error } = await supabase
    .from('attendance_sessions')
    .select('session_date, attendance_records(student_id, status)')
    .eq('list_id', targetId)
    .gte('session_date', bounds.start)
    .lte('session_date', bounds.end);

  if (error) {
    logToFile('⚠️ Could not read the month for the register', { targetId, error: error.message });
    return [];
  }
  return (sessions || []).flatMap((s) => (s.attendance_records || []).map((r) => ({
    student_id: r.student_id, date: s.session_date, status: r.status,
  })));
}

/** The roster, and what to call it — the same two answers for either subject. */
async function loadRoster(subject, targetId, userId) {
  if (subject === 'teacher') {
    return { people: await loadStaffRoster(targetId, userId), label: await loadSchool(targetId) };
  }
  const { data: list } = await supabase
    .from('student_lists').select('id, class_name, section, class_id').eq('id', targetId).maybeSingle();

  // Enrollment first, legacy second — the same order the marking screen uses, so the
  // register cannot list a different set of children than the screen that filled it.
  let people = [];
  if (list && list.class_id) {
    const { data: enrolled } = await supabase
      .from('class_enrollments').select('student_id, roll_number')
      .eq('class_id', list.class_id).eq('is_active', true);
    if (enrolled && enrolled.length) {
      const { data: kids } = await supabase
        .from('students').select('id, student_name').in('id', enrolled.map((e) => e.student_id));
      const nameById = new Map((kids || []).map((k) => [k.id, k.student_name]));
      people = enrolled
        .map((e) => ({ id: e.student_id, student_name: nameById.get(e.student_id), roll_number: e.roll_number }))
        .sort((a, b) => (a.roll_number ?? 1e9) - (b.roll_number ?? 1e9));
    }
  }
  if (!people.length) {
    const { data } = await supabase
      .from('students').select('id, student_name, roll_number')
      .eq('list_id', targetId).eq('is_active', true).order('roll_number');
    people = data || [];
  }
  return { people, label: rosterLabel(list) };
}

/** What they read above the attachment. */
function buildCaption(label, bounds, date, todayTally, subject = 'teacher') {
  const monthName = AttendanceRegister.MONTH_NAMES[bounds.month - 1];
  const lines = [
    subject === 'student' ? '📋 *Attendance Register*' : '📋 *Teacher Attendance Register*',
    `${subject === 'student' ? '📚' : '🏫'} ${label}`,
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
async function deliverRegister({
  userId, principalUserId, subject, schoolId, targetId, date, staff, roster, todayTally,
} = {}) {
  const path = require('path');
  const fs = require('fs');

  // One signature, two subjects, and the older principal-only argument names still
  // resolve — the callers that used them are in this repo and are not worth churning.
  const who = userId || principalUserId;
  const resolvedSubject = subject === 'student' ? 'student' : 'teacher';
  const target = targetId || schoolId;
  const provided = roster || staff;

  try {
    const bounds = monthBounds(date);
    const [loaded, records, recipient] = await Promise.all([
      provided && provided.length
        ? Promise.resolve({ people: provided, label: null })
        : loadRoster(resolvedSubject, target, who),
      loadMonthRecords(resolvedSubject, target, bounds),
      loadPrincipal(who),
    ]);

    // A caller that handed us the roster still needs the label for the file name.
    const { people } = loaded;
    const label = loaded.label !== null
      ? loaded.label
      : (await loadRoster(resolvedSubject, target, who)).label;

    if (!recipient || !recipient.phone_number) {
      // Nothing to send it to. Not an error in the register — an error in the account.
      logToFile('⚠️ Register generated but the recipient has no phone number', { userId: who });
      return { delivered: false, error: 'no_phone_number' };
    }

    const buffer = await AttendanceRegister.createMonthlyRegisterBuffer(
      { title: label, subject: resolvedSubject }, bounds.month, bounds.year, people, records,
    );
    const fileName = AttendanceRegister.formatMonthlyFileName(label, bounds.month, bounds.year, resolvedSubject);

    // R2 is the archive, not the delivery. A storage outage must not stop the file
    // reaching the person who just made it, so this is attempted and then let go.
    let url = null;
    try {
      const { uploadBuffer } = require('../storage/r2');
      const folder = resolvedSubject === 'student' ? 'classes' : 'teachers';
      url = await uploadBuffer(
        buffer,
        `attendance/${folder}/${target}/${bounds.year}/${String(bounds.month).padStart(2, '0')}/${fileName}`,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    } catch (error) {
      logToFile('⚠️ Register upload to R2 failed — sending anyway', { error: error.message });
    }

    const { TEMP_DIR } = require('../utils/constants');
    // whatsapp-bot.js creates TEMP_DIR at boot, but this also runs from a worker and
    // on a freshly deployed container where that boot has not happened. Two other
    // services mkdir it defensively for the same reason; without it the register is
    // generated and then lost to ENOENT.
    if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
    const tempPath = path.join(TEMP_DIR, fileName);
    fs.writeFileSync(tempPath, buffer);

    try {
      const WhatsAppService = require('./whatsapp.service');
      await WhatsAppService.sendDocument(
        recipient.phone_number, tempPath, fileName,
        buildCaption(label, bounds, date, todayTally, resolvedSubject),
      );
    } finally {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch { /* a temp file is not worth an error */ }
    }

    logToFile('✅ Register delivered', {
      userId: who, subject: resolvedSubject, target, fileName,
      records: records.length, roster: people.length,
    });
    return { delivered: true, fileName, url };
  } catch (error) {
    logToFile('❌ Register delivery failed (the register itself is saved)', {
      userId: who, subject: resolvedSubject, target, date, error: error.message,
    }, 'error');
    return { delivered: false, error: error.message };
  }
}

/** The staff register, by its original name. Kept so existing callers read plainly. */
function deliverTeacherRegister(args) {
  return deliverRegister({ ...args, subject: 'teacher' });
}

module.exports = {
  deliverRegister,
  deliverTeacherRegister,
  monthBounds,
  buildCaption,
};
