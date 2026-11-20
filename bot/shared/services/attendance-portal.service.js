'use strict';
/**
 * bd-fmf24g.7 — class attendance for the teacher portal (v2).
 *
 * The portal reaches this over the internal API (routes/internal-attendance.routes.js), the way
 * it reaches the LP catalogue and the assessment editor. WhatsApp's marking Flow and this module
 * share every rule that matters, so the two surfaces cannot disagree about a day:
 *
 *   - WHO is in a class: the marking endpoint's loadStudentRoster (enrollment first, legacy second);
 *   - the WRITE: attendance-write's markStudents (mark by exception; re-marking a day replaces it);
 *   - the DATE window: the marking endpoint's dateBounds (the region's today back 90 days);
 *   - the REGISTER: attendance-register's builder and attendance-register-delivery's sender.
 *
 * Every call is for a class the teacher owns (student_lists.user_id). Anything else answers
 * { code: 'NOT_FOUND' } before a single row about the class is read or written. Errors the caller
 * can act on come back as { code }; anything else throws.
 *
 * bd-33wxxi.10 — THE STAFF REGISTER (listId "staff"): a principal's teachers, as one more register.
 * Only when the caller says it is allowed ({ staff: true } — the portal sends it for a principal the
 * principal app is on for) AND her users row is role principal with a school, as WhatsApp's router
 * asks. Every rule is WhatsApp's principal path, so the two channels agree about a day:
 *
 *   - WHO: attendance-write's loadStaffRoster (the school's live teachers, never herself);
 *   - the WRITE: attendance-write's markTeachers (one row per teacher per day in
 *     teacher_attendance_records, marked_by = her; leave type left to its default, casual);
 *   - the MONTH: the register's staff rule, present ÷ (present + absent) — leave is excused —
 *     computed with the register's own buildMatrix/monthlyStats, so the app's % is the Excel's;
 *   - the REGISTER: the same builder and delivery, subject 'teacher', for her school.
 *
 * Without both, "staff" is NOT_FOUND and nothing is read or written; it is never sent to the class
 * reads (student_lists.id is a uuid).
 *
 * Every function takes its I/O as `deps` (defaultDeps() in production), so the rules are tested
 * without a database.
 */

const { rosterLabel } = require('./classes/roster-label');
// Pure (people and records in, numbers out): the staff month uses the register's own rule.
const Register = require('./attendance-register.service');

const SESSION_TYPE = 'full_day';

/** bd-33wxxi.10 — the listId the principal's teacher register goes by. Never a uuid, so never a class. */
const STAFF = 'staff';

/** A YYYY-MM-DD that names a real calendar day, or null. */
function realDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

/** A YYYY-MM month → its first and last day, or null. */
function monthOf(value) {
  const m = typeof value === 'string' ? value.match(/^(\d{4})-(0[1-9]|1[0-2])$/) : null;
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  return { year, month, start: `${year}-${mm}-01`, end: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/** Inside WhatsApp's window: the region's today back 90 days, never the future. */
function inWindow(date, deps) {
  const { min_date: min, max_date: max } = deps.dateBounds();
  return date >= min && date <= max;
}

const ids = (list) => (Array.isArray(list) ? list.filter((x) => typeof x === 'string') : []);

/**
 * bd-33wxxi.10 — her school, when the staff register is hers to open: the caller allowed it AND her
 * users row is a principal's with a school (WhatsApp's router asks the same). Else null.
 */
async function staffSchool({ userId, staff }, deps) {
  if (staff !== true || !userId) return null;
  const me = await deps.principalSchool(userId);
  return me && me.schoolId ? me : null;
}

/** Present / absent / leave over teacher_attendance_records rows. */
function staffTally(records) {
  const tally = { present: 0, absent: 0, leave: 0 };
  for (const r of records || []) if (tally[r.status] !== undefined) tally[r.status] += 1;
  return tally;
}

/** The staff register as the selector shows it: her school's teachers and one day's status. */
async function staffEntry(userId, school, day, deps) {
  const [people, label, records] = await Promise.all([
    deps.staffRoster(school.schoolId, userId),
    deps.schoolName(school.schoolId),
    deps.staffDay(school.schoolId, day),
  ]);
  const marked = (records || []).length > 0;
  const t = staffTally(records);
  return {
    listId: STAFF,
    label,
    gradeCode: null,
    section: null,
    subjectCodes: [],
    students: (people || []).length,
    marked,
    present: marked ? t.present : null,
    absent: marked ? t.absent : null,
    leave: marked ? t.leave : null,
  };
}

/**
 * Her classes, each with its roster size and the status of one day (today by default). A principal
 * whose staff register is allowed gets it FIRST (bd-33wxxi.10), then her classes as a teacher's.
 */
async function listClasses({ userId, date, staff } = {}, deps = defaultDeps()) {
  const day = date == null ? deps.regionToday() : realDate(date);
  if (!day || !inWindow(day, deps)) return { code: 'BAD_DATE' };

  const school = await staffSchool({ userId, staff }, deps);
  const [lists, staffRow] = await Promise.all([
    deps.lists(userId),
    school ? staffEntry(userId, school, day, deps) : Promise.resolve(null),
  ]);
  const head = staffRow ? [staffRow] : [];
  const classRows = await classEntries(userId, lists || [], day, deps);
  return { date: day, classes: [...head, ...classRows] };
}

/** Her classes' rows for the selector, for one day. */
async function classEntries(userId, lists, day, deps) {
  if (!lists.length) return [];

  const classIds = lists.filter((l) => l.class_id).map((l) => l.class_id);
  const [counts, meta, sessions] = await Promise.all([
    deps.rosterCounts(lists),
    classIds.length ? deps.classMeta(userId, classIds) : Promise.resolve(new Map()),
    deps.sessionsOn(lists.map((l) => l.id), day),
  ]);
  const byList = new Map((sessions || []).map((s) => [s.list_id, s]));

  return lists.map((l) => {
    const m = (l.class_id && meta.get(l.class_id)) || {};
    const s = byList.get(l.id);
    return {
      listId: l.id,
      label: rosterLabel(l),
      gradeCode: m.gradeCode || null,
      section: m.section || l.section || null,
      subjectCodes: m.subjectCodes || [],
      students: counts.get(l.id) || 0,
      marked: !!s,
      present: s ? s.present_count || 0 : null,
      absent: s ? s.absent_count || 0 : null,
      leave: s ? s.leave_count || 0 : null,
    };
  });
}

/** The children of her class, in roll order. The staff register: her school's teachers, as WhatsApp names them. */
async function roster({ userId, listId, staff } = {}, deps = defaultDeps()) {
  if (listId === STAFF) {
    const school = await staffSchool({ userId, staff }, deps);
    if (!school) return { code: 'NOT_FOUND' };
    const [people, label] = await Promise.all([deps.staffRoster(school.schoolId, userId), deps.schoolName(school.schoolId)]);
    return {
      listId: STAFF,
      label,
      students: (people || []).map((p) => ({ id: p.id, name: deps.personName(p), roll: null })),
    };
  }
  const list = await deps.ownList(userId, listId);
  if (!list) return { code: 'NOT_FOUND' };
  const people = (await deps.loadStudentRoster(listId, list)) || [];
  return {
    listId,
    label: rosterLabel(list),
    students: people.map((p) => ({ id: p.id, name: p.student_name || '', roll: p.roll_number ?? null })),
  };
}

/** Mark her class for one day — by exception, through the one write path. */
async function mark({ userId, listId, date, absentIds, leaveIds, staff } = {}, deps = defaultDeps()) {
  if (listId === STAFF) return markStaff({ userId, date, absentIds, leaveIds, staff }, deps);
  const day = realDate(date);
  if (!day || !inWindow(day, deps)) return { code: 'BAD_DATE' };
  const list = await deps.ownList(userId, listId);
  if (!list) return { code: 'NOT_FOUND' };

  const people = (await deps.loadStudentRoster(listId, list)) || [];
  if (!people.length) return { code: 'EMPTY_ROSTER' };

  // Only children on this class's roster can be named; anyone else is dropped, not written.
  const onRoster = new Set(people.map((p) => p.id));
  const result = await deps.markStudents({
    userId,
    listId,
    date: day,
    roster: people,
    absentIds: ids(absentIds).filter((id) => onRoster.has(id)),
    leaveIds: ids(leaveIds).filter((id) => onRoster.has(id)),
  });
  const s = result.summary || {};
  return { date: day, present: s.present || 0, absent: s.absent || 0, leave: s.leave || 0, replaced: !!result.replaced };
}

/**
 * bd-33wxxi.10 — mark her teachers for one day through WhatsApp's principal write (markTeachers):
 * one row per teacher, her as the marker, at her school. Only teachers on her staff roster can be
 * named; the leave type is left to the write's default (casual), as WhatsApp's Flow does.
 */
async function markStaff({ userId, date, absentIds, leaveIds, staff }, deps) {
  const school = await staffSchool({ userId, staff }, deps);
  if (!school) return { code: 'NOT_FOUND' };
  const day = realDate(date);
  if (!day || !inWindow(day, deps)) return { code: 'BAD_DATE' };

  const people = (await deps.staffRoster(school.schoolId, userId)) || [];
  if (!people.length) return { code: 'EMPTY_ROSTER' };

  const onRoster = new Set(people.map((p) => p.id));
  const result = await deps.markTeachers({
    principalUserId: userId,
    schoolId: school.schoolId,
    date: day,
    staff: people,
    absentIds: ids(absentIds).filter((id) => onRoster.has(id)),
    leaveIds: ids(leaveIds).filter((id) => onRoster.has(id)),
  });
  const s = result.summary || {};
  return { date: day, present: s.present || 0, absent: s.absent || 0, leave: s.leave || 0, replaced: !!result.replaced };
}

/** One day of her class: whether it was marked, the counts, and each child's status. */
async function day({ userId, listId, date, staff } = {}, deps = defaultDeps()) {
  if (listId === STAFF) {
    const school = await staffSchool({ userId, staff }, deps);
    if (!school) return { code: 'NOT_FOUND' };
    const d0 = realDate(date);
    if (!d0) return { code: 'BAD_DATE' };
    const records = (await deps.staffDay(school.schoolId, d0)) || [];
    if (!records.length) return { date: d0, marked: false, present: null, absent: null, leave: null, statuses: {} };
    const statuses = {};
    for (const r of records) statuses[r.teacher_id] = r.status;
    return { date: d0, marked: true, ...staffTally(records), statuses };
  }
  const d = realDate(date);
  if (!d) return { code: 'BAD_DATE' };
  const list = await deps.ownList(userId, listId);
  if (!list) return { code: 'NOT_FOUND' };

  const session = await deps.sessionOn(listId, d);
  if (!session) return { date: d, marked: false, present: null, absent: null, leave: null, statuses: {} };
  const records = (await deps.recordsFor(session.id)) || [];
  const statuses = {};
  for (const r of records) statuses[r.student_id] = r.status;
  return {
    date: d,
    marked: true,
    present: session.present_count || 0,
    absent: session.absent_count || 0,
    leave: session.leave_count || 0,
    statuses,
  };
}

/**
 * A month of her class: each marked day's counts (oldest first) and each child's present ÷ days
 * marked, lowest first. Leave is not present — the register's student rule (a child on leave was
 * not in the room). A child never marked this month has no percentage.
 */
async function month({ userId, listId, month: m, staff } = {}, deps = defaultDeps()) {
  if (listId === STAFF) return staffMonth({ userId, month: m, staff }, deps);
  const bounds = monthOf(m);
  if (!bounds) return { code: 'BAD_MONTH' };
  const list = await deps.ownList(userId, listId);
  if (!list) return { code: 'NOT_FOUND' };

  const [people, sessions] = await Promise.all([
    deps.loadStudentRoster(listId, list),
    deps.monthSessions(listId, bounds.start, bounds.end),
  ]);

  const days = (sessions || [])
    .map((s) => {
      const tally = { present: 0, absent: 0, leave: 0 };
      for (const r of s.records || []) if (tally[r.status] !== undefined) tally[r.status] += 1;
      return { date: s.session_date, ...tally, total: (s.records || []).length };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const seen = new Map();
  for (const s of sessions || []) {
    for (const r of s.records || []) {
      const t = seen.get(r.student_id) || { present: 0, marked: 0 };
      t.marked += 1;
      if (r.status === 'present') t.present += 1;
      seen.set(r.student_id, t);
    }
  }

  const students = (people || [])
    .map((p) => {
      const t = seen.get(p.id) || { present: 0, marked: 0 };
      return {
        id: p.id,
        name: p.student_name || '',
        roll: p.roll_number ?? null,
        present: t.present,
        marked: t.marked,
        pct: t.marked ? Math.round((t.present / t.marked) * 100) : null,
      };
    })
    .sort((a, b) => {
      if (a.pct === null && b.pct !== null) return 1;
      if (b.pct === null && a.pct !== null) return -1;
      if (a.pct !== b.pct) return a.pct - b.pct;
      return (a.roll ?? 1e9) - (b.roll ?? 1e9);
    });

  return { month: m, days, students };
}

/**
 * bd-33wxxi.10 — a month of her teachers under the REGISTER'S STAFF RULE: present ÷ (present + absent),
 * leave excused. Computed with the register's own buildMatrix + monthlyStats, so each teacher's % here is
 * the % on the Excel sheet. A day's `total` is that day's denominator (present + absent), which is what
 * the month calendar tints by. A teacher with no present or absent day this month has no percentage.
 */
async function staffMonth({ userId, month: m, staff }, deps) {
  const school = await staffSchool({ userId, staff }, deps);
  if (!school) return { code: 'NOT_FOUND' };
  const bounds = monthOf(m);
  if (!bounds) return { code: 'BAD_MONTH' };

  const [people, records] = await Promise.all([
    deps.staffRoster(school.schoolId, userId),
    deps.staffMonth(school.schoolId, bounds.start, bounds.end),
  ]);

  const byDate = new Map();
  for (const r of records || []) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date).push(r);
  }
  const days = [...byDate.entries()]
    .map(([date, rows]) => {
      const t = staffTally(rows);
      return { date, ...t, total: t.present + t.absent };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const matrix = Register.buildMatrix(people || [], records || []);
  const students = (people || [])
    .map((p, order) => {
      const st = Register.monthlyStats((matrix[p.id] || {}).days, { subject: 'teacher' });
      const counted = st.present + st.absent;
      return {
        id: p.id,
        name: deps.personName(p),
        roll: null,
        present: st.present,
        marked: counted,
        pct: counted ? st.percentage : null,
        order,
      };
    })
    .sort((a, b) => {
      if (a.pct === null && b.pct !== null) return 1;
      if (b.pct === null && a.pct !== null) return -1;
      if (a.pct !== b.pct) return a.pct - b.pct;
      return a.order - b.order;
    })
    .map(({ order, ...s }) => s); // eslint-disable-line no-unused-vars

  return { month: m, days, students };
}

/** The month's Excel register — the same builder WhatsApp sends. */
async function registerFile({ userId, listId, month: m, staff } = {}, deps = defaultDeps()) {
  if (listId === STAFF) {
    const school = await staffSchool({ userId, staff }, deps);
    if (!school) return { code: 'NOT_FOUND' };
    const b = monthOf(m);
    if (!b) return { code: 'BAD_MONTH' };
    const { people, label, records } = await deps.staffRegisterParts(school.schoolId, userId, b);
    const buf = await deps.buildRegister({ title: label, subject: 'teacher' }, b.month, b.year, people, records);
    return { fileName: deps.registerFileName(label, b.month, b.year, 'teacher'), base64: Buffer.from(buf).toString('base64') };
  }
  const bounds = monthOf(m);
  if (!bounds) return { code: 'BAD_MONTH' };
  const list = await deps.ownList(userId, listId);
  if (!list) return { code: 'NOT_FOUND' };

  const { people, label, records } = await deps.registerParts(listId, userId, bounds);
  const buffer = await deps.buildRegister({ title: label, subject: 'student' }, bounds.month, bounds.year, people, records);
  return { fileName: deps.registerFileName(label, bounds.month, bounds.year, 'student'), base64: Buffer.from(buffer).toString('base64') };
}

/** Send the month's register to her WhatsApp — the existing delivery. This month runs up to today. */
async function sendRegister({ userId, listId, month: m, staff } = {}, deps = defaultDeps()) {
  let subject = 'student';
  let targetId = listId;
  if (listId === STAFF) {
    const school = await staffSchool({ userId, staff }, deps);
    if (!school) return { code: 'NOT_FOUND' };
    subject = 'teacher';
    targetId = school.schoolId;
  }
  const bounds = monthOf(m);
  if (!bounds) return { code: 'BAD_MONTH' };
  if (subject === 'student') {
    const list = await deps.ownList(userId, listId);
    if (!list) return { code: 'NOT_FOUND' };
  }

  const today = deps.regionToday();
  const date = today.slice(0, 7) === m ? today : bounds.end;
  const out = await deps.deliverRegister({ userId, subject, targetId, date });
  return out && out.delivered ? { delivered: true } : { delivered: false, error: (out && out.error) || 'not_delivered' };
}

/** Production I/O. Required lazily, so a test that injects deps never loads Supabase. */
function defaultDeps() {
  const supabase = require('../config/supabase');
  const Marking = require('../routes/attendance-marking-endpoint');
  const { markStudents, markTeachers, loadStaffRoster, personName } = require('./attendance-write.service');
  const Delivery = require('./attendance-register-delivery.service');

  return {
    regionToday: () => Marking.regionToday(),
    dateBounds: () => Marking.dateBounds(),

    async ownList(userId, listId) {
      if (!userId || !listId) return null;
      const { data, error } = await supabase
        .from('student_lists')
        .select('id, class_name, section, class_id')
        .eq('id', listId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw new Error(`student_lists read failed: ${error.message}`);
      return data || null;
    },

    async lists(userId) {
      const { data, error } = await supabase
        .from('student_lists')
        .select('id, class_name, section, class_id')
        .eq('user_id', userId)
        .eq('is_active', true)
        .order('created_at');
      if (error) throw new Error(`student_lists read failed: ${error.message}`);
      return data || [];
    },

    rosterCounts: (lists) => Marking.rosterCounts(lists),

    async classMeta(userId, classIds) {
      const [classes, assignments] = await Promise.all([
        supabase.from('classes').select('id, grade_code, section').in('id', classIds),
        supabase.from('class_teachers').select('id, class_id')
          .eq('teacher_user_id', userId).eq('is_active', true).in('class_id', classIds),
      ]);
      if (classes.error) throw new Error(`classes read failed: ${classes.error.message}`);
      const mine = (assignments && assignments.data) || [];
      const subjects = mine.length
        ? await supabase.from('class_teacher_subjects').select('class_teacher_id, subject_code')
          .in('class_teacher_id', mine.map((a) => a.id))
        : { data: [] };
      const classOf = new Map(mine.map((a) => [a.id, a.class_id]));
      const codes = new Map();
      for (const s of (subjects && subjects.data) || []) {
        const cid = classOf.get(s.class_teacher_id);
        if (!cid) continue;
        if (!codes.has(cid)) codes.set(cid, []);
        if (!codes.get(cid).includes(s.subject_code)) codes.get(cid).push(s.subject_code);
      }
      return new Map((classes.data || []).map((c) => [c.id, {
        gradeCode: c.grade_code || null, section: c.section || null, subjectCodes: codes.get(c.id) || [],
      }]));
    },

    async sessionsOn(listIds, date) {
      const { data, error } = await supabase
        .from('attendance_sessions')
        .select('id, list_id, present_count, absent_count, leave_count')
        .in('list_id', listIds)
        .eq('session_date', date)
        .eq('session_type', SESSION_TYPE);
      if (error) throw new Error(`attendance_sessions read failed: ${error.message}`);
      return data || [];
    },

    loadStudentRoster: (listId, list) => Marking.loadStudentRoster(listId, list),
    markStudents,

    async sessionOn(listId, date) {
      const { data, error } = await supabase
        .from('attendance_sessions')
        .select('id, present_count, absent_count, leave_count')
        .eq('list_id', listId)
        .eq('session_date', date)
        .eq('session_type', SESSION_TYPE)
        .limit(1);
      if (error) throw new Error(`attendance_sessions read failed: ${error.message}`);
      return (data || [])[0] || null;
    },

    async recordsFor(sessionId) {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('student_id, status')
        .eq('session_id', sessionId);
      if (error) throw new Error(`attendance_records read failed: ${error.message}`);
      return data || [];
    },

    async monthSessions(listId, start, end) {
      const { data, error } = await supabase
        .from('attendance_sessions')
        .select('session_date, attendance_records(student_id, status)')
        .eq('list_id', listId)
        .eq('session_type', SESSION_TYPE)
        .gte('session_date', start)
        .lte('session_date', end);
      if (error) throw new Error(`attendance_sessions read failed: ${error.message}`);
      return (data || []).map((s) => ({ session_date: s.session_date, records: s.attendance_records || [] }));
    },

    async registerParts(listId, userId, bounds) {
      const [{ people, label }, records] = await Promise.all([
        Delivery.loadRoster('student', listId, userId),
        Delivery.loadMonthRecords('student', listId, bounds),
      ]);
      return { people, label, records };
    },
    buildRegister: (...args) => Register.createMonthlyRegisterBuffer(...args),
    registerFileName: (label, m, y, subject = 'student') => Register.formatMonthlyFileName(label, m, y, subject),
    deliverRegister: (args) => Delivery.deliverRegister(args),

    /* bd-33wxxi.10 — the staff register: WhatsApp's principal path, read and written as it does. */

    /** Her school when her users row is a principal's (WhatsApp's router: role === 'principal' + school_id). */
    async principalSchool(userId) {
      const { data, error } = await supabase.from('users').select('id, role, school_id').eq('id', userId).maybeSingle();
      if (error) throw new Error(`users read failed: ${error.message}`);
      return data && data.role === 'principal' && data.school_id ? { schoolId: data.school_id } : null;
    },
    /** What the register calls her school (attendance-register-delivery loadSchool's read and fallback). */
    async schoolName(schoolId) {
      const { data } = await supabase.from('schools').select('name').eq('id', schoolId).maybeSingle();
      return (data && data.name) || 'Your school';
    },
    staffRoster: (schoolId, userId) => loadStaffRoster(schoolId, userId),
    personName,
    markTeachers,

    /** One day of the school's teachers — the rows WhatsApp's "already marked" check reads. */
    async staffDay(schoolId, date) {
      const { data, error } = await supabase
        .from('teacher_attendance_records')
        .select('teacher_id, status, date')
        .eq('school_id', schoolId)
        .eq('date', date);
      if (error) throw new Error(`teacher_attendance_records read failed: ${error.message}`);
      return data || [];
    },

    /** A month of the school's teachers — the register's read (Delivery.loadMonthRecords), but a failure throws. */
    async staffMonth(schoolId, start, end) {
      const { data, error } = await supabase
        .from('teacher_attendance_records')
        .select('teacher_id, date, status')
        .eq('school_id', schoolId)
        .gte('date', start)
        .lte('date', end);
      if (error) throw new Error(`teacher_attendance_records read failed: ${error.message}`);
      return data || [];
    },

    async staffRegisterParts(schoolId, userId, bounds) {
      const [{ people, label }, records] = await Promise.all([
        Delivery.loadRoster('teacher', schoolId, userId),
        Delivery.loadMonthRecords('teacher', schoolId, bounds),
      ]);
      return { people, label, records };
    },
  };
}

module.exports = {
  listClasses, roster, mark, day, month, registerFile, sendRegister,
  realDate, monthOf, defaultDeps, STAFF,
};
