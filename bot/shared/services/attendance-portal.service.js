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
 * Every function takes its I/O as `deps` (defaultDeps() in production), so the rules are tested
 * without a database.
 */

const { rosterLabel } = require('./classes/roster-label');

const SESSION_TYPE = 'full_day';

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

/** Her classes, each with its roster size and the status of one day (today by default). */
async function listClasses({ userId, date } = {}, deps = defaultDeps()) {
  const day = date == null ? deps.regionToday() : realDate(date);
  if (!day || !inWindow(day, deps)) return { code: 'BAD_DATE' };

  const lists = (await deps.lists(userId)) || [];
  if (!lists.length) return { date: day, classes: [] };

  const classIds = lists.filter((l) => l.class_id).map((l) => l.class_id);
  const [counts, meta, sessions] = await Promise.all([
    deps.rosterCounts(lists),
    classIds.length ? deps.classMeta(userId, classIds) : Promise.resolve(new Map()),
    deps.sessionsOn(lists.map((l) => l.id), day),
  ]);
  const byList = new Map((sessions || []).map((s) => [s.list_id, s]));

  return {
    date: day,
    classes: lists.map((l) => {
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
    }),
  };
}

/** The children of her class, in roll order. */
async function roster({ userId, listId } = {}, deps = defaultDeps()) {
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
async function mark({ userId, listId, date, absentIds, leaveIds } = {}, deps = defaultDeps()) {
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

/** One day of her class: whether it was marked, the counts, and each child's status. */
async function day({ userId, listId, date } = {}, deps = defaultDeps()) {
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
async function month({ userId, listId, month: m } = {}, deps = defaultDeps()) {
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

/** The month's Excel register — the same builder WhatsApp sends. */
async function registerFile({ userId, listId, month: m } = {}, deps = defaultDeps()) {
  const bounds = monthOf(m);
  if (!bounds) return { code: 'BAD_MONTH' };
  const list = await deps.ownList(userId, listId);
  if (!list) return { code: 'NOT_FOUND' };

  const { people, label, records } = await deps.registerParts(listId, userId, bounds);
  const buffer = await deps.buildRegister({ title: label, subject: 'student' }, bounds.month, bounds.year, people, records);
  return { fileName: deps.registerFileName(label, bounds.month, bounds.year), base64: Buffer.from(buffer).toString('base64') };
}

/** Send the month's register to her WhatsApp — the existing delivery. This month runs up to today. */
async function sendRegister({ userId, listId, month: m } = {}, deps = defaultDeps()) {
  const bounds = monthOf(m);
  if (!bounds) return { code: 'BAD_MONTH' };
  const list = await deps.ownList(userId, listId);
  if (!list) return { code: 'NOT_FOUND' };

  const today = deps.regionToday();
  const date = today.slice(0, 7) === m ? today : bounds.end;
  const out = await deps.deliverRegister({ userId, subject: 'student', targetId: listId, date });
  return out && out.delivered ? { delivered: true } : { delivered: false, error: (out && out.error) || 'not_delivered' };
}

/** Production I/O. Required lazily, so a test that injects deps never loads Supabase. */
function defaultDeps() {
  const supabase = require('../config/supabase');
  const Marking = require('../routes/attendance-marking-endpoint');
  const { markStudents } = require('./attendance-write.service');
  const Delivery = require('./attendance-register-delivery.service');
  const Register = require('./attendance-register.service');

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
    registerFileName: (label, m, y) => Register.formatMonthlyFileName(label, m, y, 'student'),
    deliverRegister: (args) => Delivery.deliverRegister(args),
  };
}

module.exports = {
  listClasses, roster, mark, day, month, registerFile, sendRegister,
  realDate, monthOf, defaultDeps,
};
