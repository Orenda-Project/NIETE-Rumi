'use strict';

/**
 * Child test — the draw: which children a coach tests at a visit (PLAN §5, CONTRACT §5).
 *
 *   Frame    every active child in each Grade 3 / Grade 5 class of the school, snapshotted at the
 *            cycle's first draw for that class, with frame_size (the selection weight).
 *   Order    one seeded shuffle per class per cycle (draw/shuffle.js); every rank is written to
 *            child_test_draws before any name is shown.
 *   A visit  the observed grade if it is 3 or 5, else Grade 3 and Grade 5 alternate by the school's
 *            visits this cycle. 1 returning child + new children in rank order, round-robin across the
 *            grade's sections, to 5; then 2 alternates. A child already tested in any cycle is never
 *            drawn as new again.
 *   Shift    one shift per school-grade: the morning classes, or the evening ones only when the grade
 *            has no morning class with children (R1 §7.5) — a coach never chases a child who is not in
 *            school at that hour.
 *   Forms    CHILD_TEST_FORM_POLICY (CONTRACT §19):
 *            term (default)  every child in a cycle reads the cycle's set (draw/term-set.js). A child
 *                            returns only from an earlier cycle, never to a set already read, and never
 *                            when a same-name classmate makes "which child" uncertain (R1 §7.4 A).
 *            returning_b     v1: new children Form A; the returning child (earliest first test, last
 *                            test ≥ 42 days ago, not yet retested this cycle) Form B.
 *   Naming   no roll is written or shown (operator, 3 Oct). Each listed child carries the roster's class
 *            label, the class teacher and a same-name count against the class roster (L25, R1 §7).
 *   Absent   absent or refused: coded, the first alternate moves up, the alternates are topped up,
 *            and the child goes back in the queue at their rank — absent_final after two tries.
 *   Reopen   the visit's list is stored on the rows (last_listed_visit_id, or visit_key for a visit
 *            with no observe2 field form): every call for the same visit returns the same list.
 *   Visit    named by visitId (observe2's observation_field_forms.id) or by visitKey — cs:<coaching
 *            session id> after classic /observe, day:<coach>:<school>:<PKT date> for /egra with no
 *            visit (draw/visit-key.js). Internally one string names the visit; a key never looks
 *            like a uuid.
 *
 * There is no redraw: nothing here reshuffles, skips a child without a reason, or releases a list.
 * Classes of five or fewer are taken in full. Logs carry ids only, never a child's name.
 */

const store = require('../store');
const { cycleFor, sessionCodeFor } = require('./cycle');
const { ALGO_VERSION, seedFor, seedDigest, shuffle } = require('./shuffle');
const { logToFile } = require('../../../utils/logger');
const { classLabels, shiftOf } = require('./class-label');
const { formPolicy, termSet } = require('./term-set');
const { isVisitKey, parseVisitKey, pktDate, oneVisit } = require('./visit-key');

const REGION = 'ict';
const PER_VISIT = 5;
const ALTERNATES = 2;
const RETURN_AFTER_DAYS = 42;
const MAX_TRIES = 2;
const RETURNING_ALGO = 'ctd-v1-returning-earliest-tested';
const GRADES = [3, 5];
// A child in one of these states can be put on a visit's list (a 'listed' child from another visit
// was not reached there and goes back in at their rank).
const QUEUED = ['pending', 'listed', 'absent', 'refused'];
const OUTCOMES = ['present', 'absent', 'refused'];
const DAY_MS = 86400000;

// The visit a row is listed at, a history entry names, and the columns/fields that name it.
const visitOf = (d) => d.last_listed_visit_id || d.visit_key || null;
const visitOfEntry = (h) => h.visit_id || h.visit_key || null;
// Lists first claimed with this marker are ordered by classroom (L25); older lists keep their order.
const LIST_ORDER = 'room';
const visitRef = (visit) => (isVisitKey(visit) ? { visit_key: visit } : { visit_id: visit });
const visitColumns = (visit) => (isVisitKey(visit)
  ? { last_listed_visit_id: null, visit_key: visit }
  : { last_listed_visit_id: visit, visit_key: null });

const iso = (d) => (d instanceof Date ? d : new Date(d)).toISOString();

function normaliseGrade(g) {
  const n = Number(String(g == null ? '' : g).replace(/^grade_/, ''));
  return GRADES.includes(n) ? n : null;
}
const gradeOfClass = (c) => normaliseGrade(c.grade_code);
const bySectionThenId = (a, b) => String(a.section || '').localeCompare(String(b.section || '')) || String(a.id).localeCompare(String(b.id));

// Same-name children (R1 §4): names compared lower-cased with punctuation and digits removed.
const nameKey = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const fatherKey = nameKey;

/**
 * A child's classmates with the same name, counted on the class roster (not the list), and whether the
 * father's name tells this child apart from every one of them.
 * @param {Map<string, object>} enrolled  student_id → enrolment (student_name, father_name) of one class
 */
function namesakeOf(enrolled, studentId) {
  const me = enrolled && enrolled.get(studentId);
  const key = me && nameKey(me.student_name);
  if (!key) return { namesakes: 1, fatherTellsApart: false };
  const same = [...enrolled.values()].filter((e) => nameKey(e.student_name) === key);
  if (same.length < 2) return { namesakes: 1, fatherTellsApart: false };
  const mine = fatherKey(me.father_name);
  const apart = Boolean(mine) && same.every((e) => e.student_id === studentId || (fatherKey(e.father_name) && fatherKey(e.father_name) !== mine));
  return { namesakes: same.length, fatherTellsApart: apart };
}
const unresolvedNamesake = (n) => n.namesakes > 1 && !n.fatherTellsApart;

/** One shift per grade: the morning classes, else (no morning class with children) the evening ones. */
function oneShift(classes) {
  const morning = classes.filter((c) => shiftOf(c) === 'morning');
  return morning.length ? morning : classes;
}

function visitsListedBefore(draws, visit) {
  const visits = new Set();
  for (const d of draws) {
    for (const h of d.history || []) {
      const v = visitOfEntry(h);
      if (h.event === 'listed' && v && v !== visit) visits.add(v);
    }
  }
  return visits;
}

// ── What the school looks like now ─────────────────────────────────────────────────────────────

async function loadContext({ schoolId, cycleId, now }) {
  const cls = await store.listGradeClasses(schoolId, sessionCodeFor(now));
  if (!cls.ok) return cls;
  const enr = await store.listActiveEnrollments(cls.classes.map((c) => c.id));
  if (!enr.ok) return enr;
  const enrolledByClass = new Map();
  for (const e of enr.enrollments) {
    if (!enrolledByClass.has(e.class_id)) enrolledByClass.set(e.class_id, new Map());
    enrolledByClass.get(e.class_id).set(e.student_id, e);
  }
  const classesByGrade = new Map(GRADES.map((g) => [g, []]));
  for (const c of cls.classes) {
    const g = gradeOfClass(c);
    if (g && enrolledByClass.has(c.id)) classesByGrade.get(g).push(c);
  }
  for (const [g, list] of classesByGrade) classesByGrade.set(g, oneShift(list).sort(bySectionThenId));

  const draws = await store.listSchoolDraws(schoolId, cycleId);
  if (!draws.ok) return draws;
  const tested = await store.listTestedDraws(schoolId);
  if (!tested.ok) return tested;
  return { ok: true, schoolId, cycleId, now, classesByGrade, enrolledByClass, draws: draws.draws, tested: tested.draws };
}

// The frame: written once per class per cycle. A lost race re-reads what the winner wrote.
async function ensureFrames(ctx, grade, secret) {
  const classes = ctx.classesByGrade.get(grade);
  const framed = new Set(ctx.draws.filter((d) => d.sample_role === 'new').map((d) => d.class_id));
  const inFrame = new Set(ctx.draws.filter((d) => d.sample_role === 'new').map((d) => d.student_id));
  for (const c of classes) {
    if (framed.has(c.id)) continue;
    // A child enrolled in two classes (a roster error) is framed once, in the first class drawn.
    const enrolled = [...ctx.enrolledByClass.get(c.id).values()].filter((e) => !inFrame.has(e.student_id));
    if (!enrolled.length) continue;
    const canonical = enrolled.map((e) => e.student_id).sort();
    const seed = seedFor(secret, ctx.cycleId, c.id);
    const digest = seedDigest(seed);
    const order = shuffle(canonical, seed);
    const rows = order.map((sid, i) => ({
      cycle_id: ctx.cycleId,
      region: REGION,
      school_id: ctx.schoolId,
      class_id: c.id,
      grade,
      student_id: sid,
      frame_size: order.length,
      draw_rank: i + 1,
      seed_digest: digest,
      algo_version: ALGO_VERSION,
      sample_role: 'new',
      form: formPolicy() === 'term' ? termSet(ctx.cycleId) : 'A',
      status: 'pending',
      attempts: 0,
      history: [],
    }));
    const ins = await store.insertDraws(rows);
    if (!ins.ok && !ins.conflict) return ins;
    if (ins.ok) {
      ctx.draws.push(...ins.draws);
      for (const sid of order) inFrame.add(sid);
      logToFile('[child-test] frame drawn', { cycleId: ctx.cycleId, schoolId: ctx.schoolId, classId: c.id, frameSize: order.length, algo: ALGO_VERSION });
    } else {
      const again = await store.listSchoolDraws(ctx.schoolId, ctx.cycleId);
      if (!again.ok) return again;
      ctx.draws = again.draws;
    }
  }
  return { ok: true };
}

// New children in the order they are taken: rank order within a class, round-robin across the
// grade's sections, starting one section further on at each visit.
function newSequence(ctx, grade, { visitId, exclude = new Set(), rotation = 0 }) {
  const everTested = new Set(ctx.tested.map((d) => d.student_id));
  const classes = ctx.classesByGrade.get(grade);
  const queues = classes.map((c) => ctx.draws
    .filter((d) => d.class_id === c.id && d.sample_role === 'new' && QUEUED.includes(d.status)
      && visitOf(d) !== visitId && !exclude.has(d.id) && !everTested.has(d.student_id)
      && ctx.enrolledByClass.get(c.id).has(d.student_id))
    .sort((a, b) => a.draw_rank - b.draw_rank));
  const out = [];
  const n = queues.length;
  if (!n) return out;
  const idx = queues.map(() => 0);
  let remaining = queues.reduce((s, q) => s + q.length, 0);
  for (let turn = 0; remaining > 0; turn++) {
    const k = (rotation + turn) % n;
    if (idx[k] < queues[k].length) { out.push(queues[k][idx[k]++]); remaining--; }
  }
  return out;
}

// Where a child is enrolled now, among the grade's classes.
function currentClassOf(ctx, grade, studentId) {
  for (const c of ctx.classesByGrade.get(grade)) {
    const e = ctx.enrolledByClass.get(c.id).get(studentId);
    if (e) return { cls: c, enrollment: e };
  }
  return null;
}

// The returning slot: a queued returning row of this cycle first (an absent returning child is
// sought again), else the earliest-tested eligible child, for whom a returning row is written.
async function returningChild(ctx, grade, visitId) {
  const term = formPolicy() === 'term';
  const set = term ? termSet(ctx.cycleId) : 'B';
  const thisCycle = ctx.draws.filter((d) => d.sample_role === 'returning' && d.grade === grade);
  const queued = thisCycle
    .filter((d) => QUEUED.includes(d.status) && visitOf(d) !== visitId && currentClassOf(ctx, grade, d.student_id))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (queued.length) return { ok: true, draw: queued[0] };

  const retestedThisCycle = new Set(thisCycle.map((d) => d.student_id));
  const cutoff = ctx.now.getTime() - RETURN_AFTER_DAYS * DAY_MS;
  // term: nobody reads a set twice, and a child who was a namesake when listed (or is one now) is
  // never brought back — the teacher may have sent the other child (R1 §7.4 A).
  const barred = new Set();
  if (term) {
    for (const d of ctx.tested) {
      if (d.form === set || d.cycle_id === ctx.cycleId) barred.add(d.student_id);
      if ((d.history || []).some((h) => h.event === 'listed' && h.namesake === true)) barred.add(d.student_id);
    }
  }
  const byStudent = new Map();
  for (const d of ctx.tested) {
    if (d.grade !== grade || !d.tested_at || barred.has(d.student_id)) continue;
    const t = new Date(d.tested_at).getTime();
    const s = byStudent.get(d.student_id) || { first: null, last: -Infinity };
    if (!s.first || t < new Date(s.first.tested_at).getTime()) s.first = d;
    s.last = Math.max(s.last, t);
    byStudent.set(d.student_id, s);
  }
  const namesakeNow = (sid) => {
    const at = currentClassOf(ctx, grade, sid);
    return Boolean(at) && unresolvedNamesake(namesakeOf(ctx.enrolledByClass.get(at.cls.id), sid));
  };
  const eligible = [...byStudent.entries()]
    .filter(([sid, s]) => s.last <= cutoff && !retestedThisCycle.has(sid) && currentClassOf(ctx, grade, sid)
      && !(term && namesakeNow(sid)))
    .sort(([a, x], [b, y]) => String(x.first.tested_at).localeCompare(String(y.first.tested_at)) || String(a).localeCompare(String(b)));
  if (!eligible.length) return { ok: true, draw: null };

  const [sid, s] = eligible[0];
  const { cls } = currentClassOf(ctx, grade, sid);
  const frameRow = ctx.draws.find((d) => d.sample_role === 'new' && d.class_id === cls.id);
  const ownRow = ctx.draws.find((d) => d.sample_role === 'new' && d.student_id === sid);
  const ins = await store.insertDraws([{
    cycle_id: ctx.cycleId,
    region: REGION,
    school_id: ctx.schoolId,
    class_id: cls.id,
    grade,
    student_id: sid,
    frame_size: frameRow ? frameRow.frame_size : ctx.enrolledByClass.get(cls.id).size,
    draw_rank: ownRow ? ownRow.draw_rank : s.first.draw_rank,
    seed_digest: s.first.seed_digest,
    algo_version: RETURNING_ALGO,
    sample_role: 'returning',
    form: set,
    status: 'pending',
    attempts: 0,
    source_draw_id: s.first.id,
    history: [],
  }]);
  if (!ins.ok) return ins.conflict ? { ok: false, conflict: true } : ins;
  ctx.draws.push(ins.draws[0]);
  return { ok: true, draw: ins.draws[0] };
}

// Claim one row for the visit, compare-and-set on what was read: a child another visit claimed in
// the meantime is not taken from it ({ won: false }); the caller moves on to the next in order.
async function claim(d, slot, visitId, at, extra = {}) {
  const more = typeof extra === 'function' ? extra(d) : extra;
  const history = [...(d.history || []), { event: 'listed', ...visitRef(visitId), slot, at, ...more }];
  const upd = await store.updateDraw(
    d.id,
    { status: 'listed', list_slot: slot, ...visitColumns(visitId), history },
    { statusIn: QUEUED, match: { status: d.status, last_listed_visit_id: d.last_listed_visit_id || null, visit_key: d.visit_key || null } },
  );
  if (!upd.ok) return upd;
  return { ok: true, won: Boolean(upd.draw) };
}

// Claim up to `need` rows from `candidates` (in order), starting at cursor.i; advances the cursor.
async function claimInOrder(candidates, cursor, need, slot, visitId, at, extra) {
  const got = [];
  while (got.length < need && cursor.i < candidates.length) {
    const d = candidates[cursor.i++];
    const c = await claim(d, slot, visitId, at, extra);
    if (!c.ok) return c;
    if (c.won) got.push(d);
  }
  return { ok: true, rows: got };
}

// ── The child number (L20, CONTRACT §18) ───────────────────────────────────────────────────────
// Each child on a visit's list has a number the coach writes on the maths strip: its place in the
// list as first sent (main 1–5, then the alternates). It is read off the rows, not stored: this
// visit's first "listed" entry gives when the child joined and in which slot; children who joined
// together are in list order. A later change (absence, promotion, top-up) never moves a number.
function childNumbers(rows, visitId, order) {
  const joined = (d) => (d.history || []).find((h) => h.event === 'listed' && visitOfEntry(h) === visitId) || {};
  const slotRank = (d) => ((joined(d).slot || d.list_slot) === 'main' ? 0 : 1);
  const sorted = [...rows].sort((a, b) => String(joined(a).at || '').localeCompare(String(joined(b).at || ''))
    || slotRank(a) - slotRank(b) || order(a, b));
  return new Map(sorted.map((d, i) => [d.id, i + 1]));
}

// ── The list as the coach sees it ──────────────────────────────────────────────────────────────

/**
 * Who each listed room's class teacher is: the flagged class teacher, else the only reachable one,
 * else nobody (the coach asks the head teacher). Mirrors conversation/context.js classTeachersOf.
 */
function pickTeachers(links) {
  const byClass = new Map();
  for (const l of links) {
    if (!l.reachable) continue;
    if (!byClass.has(l.class_id)) byClass.set(l.class_id, []);
    byClass.get(l.class_id).push(l);
  }
  const out = new Map();
  for (const [classId, reachable] of byClass) {
    const flagged = reachable.filter((l) => l.is_class_teacher).sort((a, b) => String(a.teacher_user_id).localeCompare(String(b.teacher_user_id)));
    const pick = flagged.length ? flagged[0] : (reachable.length === 1 ? reachable[0] : null);
    const name = pick ? String(pick.name || '').replace(/\s+/g, ' ').trim() : '';
    if (pick && name) out.set(classId, { teacherUserId: pick.teacher_user_id, teacherName: name });
  }
  return out;
}

async function listFor(visitId, extra = {}) {
  const v = await store.listVisitDraws(visitId);
  if (!v.ok) return v;
  const rows = v.draws.filter((d) => d.list_slot);
  if (!rows.length) return { ok: true, empty: true };
  const classIds = [...new Set(rows.map((d) => d.class_id))];
  const [students, classes, enr, teachers] = await Promise.all([
    store.listStudents(rows.map((d) => d.student_id)),
    store.getClassesByIds(classIds),
    store.listActiveEnrollments(classIds),
    store.listClassTeachers(classIds),
  ]);
  for (const r of [students, classes, enr, teachers]) if (!r.ok) return r;
  const nameOf = new Map(students.students.map((s) => [s.id, s]));
  const classOf = new Map(classes.classes.map((c) => [c.id, c]));
  const rosterOf = new Map();
  for (const e of enr.enrollments) {
    if (!rosterOf.has(e.class_id)) rosterOf.set(e.class_id, new Map());
    rosterOf.get(e.class_id).set(e.student_id, e);
  }
  const teacherOf = pickTeachers(teachers.links);

  // "Grade 3 (no section)" only when an unsectioned class sits beside other classes of its grade and shift.
  const sessions = new Map();
  for (const c of classes.classes) if (!c.section && c.school_id && c.session_code) sessions.set(`${c.school_id}|${c.session_code}`, c);
  const siblings = [];
  for (const c of sessions.values()) {
    const g = await store.listGradeClasses(c.school_id, c.session_code);
    if (!g.ok) return g;
    siblings.push(...g.classes);
  }
  const hasSiblings = (c) => siblings.some((x) => x.id !== c.id && x.grade_code === c.grade_code && shiftOf(x) === shiftOf(c) && x.school_id === c.school_id);

  const roomOf = new Map(classIds.map((id) => {
    const c = classOf.get(id) || { id };
    const t = teacherOf.get(id) || { teacherUserId: null, teacherName: null };
    return [id, {
      classId: id,
      grade: normaliseGrade(c.grade_code),
      section: c.section || null,
      shift: c.grade_code ? shiftOf(c) : null,
      ...classLabels(c, { noSectionSiblings: !c.section && hasSiblings(c) }),
      ...t,
    }];
  }));
  const item = (d) => {
    const s = nameOf.get(d.student_id) || {};
    const room = roomOf.get(d.class_id);
    return {
      drawId: d.id,
      studentId: d.student_id,
      classId: d.class_id,
      grade: room.grade || d.grade,
      section: room.section,
      shift: room.shift,
      classLabel: room.classLabel,
      classLabelUr: room.classLabelUr,
      classShort: room.classShort,
      teacherName: room.teacherName,
      teacherUserId: room.teacherUserId,
      displayName: s.student_name || null,
      displayNameUrdu: s.student_name_urdu || null,
      fatherName: s.father_name || null,
      fatherNameUrdu: s.father_name_urdu || null,
      ...namesakeOf(rosterOf.get(d.class_id), d.student_id),
      role: d.sample_role,
      form: d.form,
      status: d.status,
      attempts: d.attempts,
      childNo: childNos.get(d.id) || null,
    };
  };
  const listedHere = rows.flatMap((d) => (d.history || []).filter((h) => h.event === 'listed' && visitOfEntry(h) === visitId));
  // Lists claimed since L25 are ordered room by room (section order, morning first), the returning
  // child inside their own room; a list first sent before keeps its order and its child numbers.
  const byRoom = listedHere.some((h) => h.list_order === LIST_ORDER);
  const roomRank = new Map([...classes.classes].sort((a, b) => (shiftOf(a) === 'morning' ? 0 : 1) - (shiftOf(b) === 'morning' ? 0 : 1)
    || bySectionThenId(a, b)).map((c, i) => [c.id, i]));
  const sectionOf = (d) => String((classOf.get(d.class_id) || {}).section || '');
  const roleRank = (d) => (d.sample_role === 'new' ? 0 : 1);
  const order = byRoom
    ? (a, b) => ((roomRank.get(a.class_id) ?? 99) - (roomRank.get(b.class_id) ?? 99)) || roleRank(a) - roleRank(b) || a.draw_rank - b.draw_rank
    : (a, b) => roleRank(a) - roleRank(b) || sectionOf(a).localeCompare(sectionOf(b)) || a.draw_rank - b.draw_rank;
  const main = rows.filter((d) => d.list_slot === 'main').sort(order);
  const alts = rows.filter((d) => d.list_slot === 'alternate' && d.status === 'listed').sort(order);
  const childNos = childNumbers(rows, visitId, order);
  const children = main.map(item);
  const alternates = alts.map(item);
  const rooms = [...new Set([...children, ...alternates].map((k) => k.classId))]
    .sort((a, b) => (roomRank.get(a) ?? 99) - (roomRank.get(b) ?? 99))
    .map((id) => {
      const { grade, section, shift, classLabel, classLabelUr, classShort, teacherName, teacherUserId } = roomOf.get(id);
      return {
        classId: id, grade, section, shift, classLabel, classLabelUr, classShort, teacherName, teacherUserId,
        drawIds: children.filter((k) => k.classId === id).map((k) => k.drawId),
        alternateDrawIds: alternates.filter((k) => k.classId === id).map((k) => k.drawId),
      };
    });
  return {
    ok: true,
    cycleId: rows[0].cycle_id,
    grade: rows[0].grade,
    formPolicy: formPolicy(),
    termSet: termSet(rows[0].cycle_id),
    classId: children.length ? children[0].classId : rows[0].class_id,
    classIds: [...new Set(rows.map((d) => d.class_id))],
    classes: rooms,
    gradeFallback: listedHere.some((h) => h.grade_fallback),
    reused: false,
    children,
    alternates,
    ...extra,
  };
}

/** What a claim writes on the "listed" history entry: the room-order marker, and a namesake flag (R1 §7.4 A). */
function listedExtra(ctx, base) {
  return (d) => {
    const n = namesakeOf(ctx.enrolledByClass.get(d.class_id), d.student_id);
    return { ...base, list_order: LIST_ORDER, ...(unresolvedNamesake(n) ? { namesake: true } : {}) };
  };
}

// ── todaysList ─────────────────────────────────────────────────────────────────────────────────

async function todaysList({ coachUserId, schoolId, visitId: givenVisitId, visitKey, observedGrade, now = new Date() } = {}, attempt = 0) {
  const named = oneVisit(givenVisitId, visitKey);
  if (!named.ok) return named;
  const visitId = named.visit; // a field form id or a visit key, from here on
  if (!visitId) return { ok: false, reason: 'missing_visit' };
  if (!schoolId) return { ok: false, reason: 'missing_school' };
  const secret = process.env.CHILD_TEST_DRAW_SECRET;
  if (!secret) {
    logToFile('[child-test] CHILD_TEST_DRAW_SECRET is not set; refusing to draw', { schoolId, visitId }, 'error');
    return { ok: false, reason: 'draw_secret_missing' };
  }

  const existing = await listFor(visitId, { reused: true });
  if (!existing.ok) return existing;
  if (!existing.empty) return existing;

  // A day key draws only for its own coach, at its own school, on its own day (reopening a past
  // day's list, above, is a read and is allowed).
  const day = visitKey ? parseVisitKey(visitKey) : null;
  if (day && day.kind === 'day' && (day.schoolId !== schoolId || (coachUserId && day.coachUserId !== coachUserId) || day.date !== pktDate(now))) {
    logToFile('[child-test] day key does not match the call; refusing to draw', { schoolId, coachUserId, visitId }, 'warn');
    return { ok: false, reason: 'bad_visit_key' };
  }

  const cycleId = cycleFor(now);
  const ctx = await loadContext({ schoolId, cycleId, now });
  if (!ctx.ok) return ctx;
  const prior = visitsListedBefore(ctx.draws, visitId);
  const observed = normaliseGrade(observedGrade);
  const primary = observed || (prior.size % 2 === 0 ? 3 : 5);
  const tryOrder = [primary, primary === 3 ? 5 : 3];

  let firstReason = null;
  for (const grade of tryOrder) {
    if (!ctx.classesByGrade.get(grade).length) { firstReason = firstReason || 'no_class_list'; continue; }
    const framed = await ensureFrames(ctx, grade, secret);
    if (!framed.ok) return framed;

    const ret = await returningChild(ctx, grade, visitId);
    if (!ret.ok) {
      if (ret.conflict && attempt < 2) return todaysList({ coachUserId, schoolId, visitId: givenVisitId, visitKey, observedGrade, now }, attempt + 1);
      return ret;
    }
    const rotation = prior.size % Math.max(1, ctx.classesByGrade.get(grade).length);
    const seq = newSequence(ctx, grade, { visitId, rotation });
    if (!ret.draw && !seq.length) { firstReason = firstReason || 'frame_exhausted'; continue; }

    const at = iso(now);
    const extra = listedExtra(ctx, grade !== primary ? { grade_fallback: true } : {});
    const main = [];
    if (ret.draw) {
      const c = await claim(ret.draw, 'main', visitId, at, extra);
      if (!c.ok) return c;
      if (c.won) main.push(ret.draw);
    }
    const cursor = { i: 0 };
    const a = await claimInOrder(seq, cursor, PER_VISIT - main.length, 'main', visitId, at, extra);
    if (!a.ok) return a;
    main.push(...a.rows);
    const b = await claimInOrder(seq, cursor, ALTERNATES, 'alternate', visitId, at, extra);
    if (!b.ok) return b;
    if (!main.length) { firstReason = firstReason || 'frame_exhausted'; continue; }
    logToFile('[child-test] visit list drawn', {
      cycleId, schoolId, visitId, coachUserId, grade, gradeFallback: grade !== primary,
      main: main.map((d) => d.id), alternates: b.rows.map((d) => d.id), returning: main.some((d) => d.sample_role === 'returning'),
    });
    return listFor(visitId);
  }
  // Nothing to list in either grade: report the observed (or scheduled) grade's reason.
  const reason = ctx.classesByGrade.get(primary).length ? 'frame_exhausted' : (firstReason === 'frame_exhausted' ? 'frame_exhausted' : 'no_class_list');
  logToFile('[child-test] no list for the visit', { cycleId, schoolId, visitId, grade: primary, reason });
  return { ok: false, reason, grade: primary };
}

// ── markOutcome ────────────────────────────────────────────────────────────────────────────────

async function markOutcome({ drawId, outcome, note = null, visitId, visitKey, now = new Date() } = {}) {
  if (!OUTCOMES.includes(outcome)) return { ok: false, reason: 'bad_outcome' };
  const named = oneVisit(visitId, visitKey);
  if (!named.ok) return named;
  const got = await store.getDraw(drawId);
  if (!got.ok) return got;
  const d = got.draw;
  if (!d) return { ok: false, reason: 'no_draw' };
  const visit = named.visit || visitOf(d);
  if (!visit || visitOf(d) !== visit || d.list_slot !== 'main') return { ok: false, reason: 'not_on_list' };
  if (d.status !== 'listed') return { ok: false, reason: 'already_marked' };

  const at = iso(now);
  let patch;
  if (outcome === 'present') {
    patch = { status: 'tested', tested_at: at, outcome_at: at, history: [...(d.history || []), { event: 'outcome', ...visitRef(visit), outcome, at }] };
  } else {
    const attempts = (d.attempts || 0) + 1;
    patch = {
      status: attempts >= MAX_TRIES ? 'absent_final' : outcome,
      attempts,
      outcome_at: at,
      outcome_note: note == null ? null : String(note).slice(0, 500),
      history: [...(d.history || []), { event: 'outcome', ...visitRef(visit), outcome, attempt: attempts, at }],
    };
  }
  const upd = await store.updateDraw(d.id, patch, { statusIn: ['listed'] });
  if (!upd.ok) return upd;
  if (!upd.draw) return { ok: false, reason: 'already_marked' };
  logToFile('[child-test] outcome', { drawId: d.id, visitId: visit, outcome, status: upd.draw.status, attempts: upd.draw.attempts });

  if (outcome !== 'present') {
    const promoted = await promoteAndTopUp(d, visit, now);
    if (!promoted.ok) return promoted;
  }
  const list = await listFor(visit);
  if (!list.ok) return list;
  return { ok: true, list };
}

async function promoteAndTopUp(d, visit, now) {
  const v = await store.listVisitDraws(visit);
  if (!v.ok) return v;
  const alts = v.draws.filter((x) => x.list_slot === 'alternate' && x.status === 'listed').sort((a, b) => a.draw_rank - b.draw_rank);
  const at = iso(now);
  let left = alts.length;
  if (alts.length) {
    const first = alts[0];
    const history = [...(first.history || []), { event: 'promoted', ...visitRef(visit), replaces: d.id, at }];
    const up = await store.updateDraw(first.id, { list_slot: 'main', history }, { statusIn: ['listed'] });
    if (!up.ok) return up;
    left -= 1;
    logToFile('[child-test] alternate promoted', { visitId: visit, drawId: first.id, replaces: d.id });
  }
  const need = ALTERNATES - left;
  if (need <= 0) return { ok: true };
  const ctx = await loadContext({ schoolId: d.school_id, cycleId: d.cycle_id, now });
  if (!ctx.ok) return ctx;
  if (!ctx.classesByGrade.get(d.grade).length) return { ok: true };
  const onThisVisit = new Set(v.draws.map((x) => x.id));
  const prior = visitsListedBefore(ctx.draws, visit);
  const rotation = prior.size % Math.max(1, ctx.classesByGrade.get(d.grade).length);
  const more = newSequence(ctx, d.grade, { visitId: visit, exclude: onThisVisit, rotation });
  const got = await claimInOrder(more, { i: 0 }, need, 'alternate', visit, at, listedExtra(ctx, { top_up: true }));
  return got.ok ? { ok: true } : got;
}

// ── The visit's school ─────────────────────────────────────────────────────────────────────────

async function resolveVisitSchool({ coachUserId, visitId } = {}) {
  const got = await store.getVisit(visitId);
  if (!got.ok) return got;
  const ext = got.visit && got.visit.visit_context && got.visit.visit_context.school_ext_id;
  if (ext == null || ext === '') return { ok: false, reason: 'no_school' };
  const viaCoach = await store.findCoachSchool(coachUserId || got.visit.observer_user_id, ext);
  if (!viaCoach.ok) return viaCoach;
  if (viaCoach.schoolId) return { ok: true, schoolId: viaCoach.schoolId };
  // observe2 writes 'niete:' || emis; older rows carry a bare numeric source id.
  const raw = String(ext);
  const via = raw.includes(':')
    ? await store.findSchoolByEmis(raw.split(':').pop())
    : await store.findSchoolBySourceId(raw);
  if (!via.ok) return via;
  if (via.schoolId) return { ok: true, schoolId: via.schoolId };
  return { ok: false, reason: 'no_school' };
}

module.exports = { cycleFor, todaysList, markOutcome, resolveVisitSchool };
