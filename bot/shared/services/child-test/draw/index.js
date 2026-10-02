'use strict';

/**
 * Child test — the draw: which children a coach tests at a visit (PLAN §5, CONTRACT §5).
 *
 *   Frame    every active child in each Grade 3 / Grade 5 class of the school, snapshotted at the
 *            cycle's first draw for that class, with frame_size (the selection weight).
 *   Order    one seeded shuffle per class per cycle (draw/shuffle.js); every rank is written to
 *            child_test_draws before any name is shown.
 *   A visit  the observed grade if it is 3 or 5, else Grade 3 and Grade 5 alternate by the school's
 *            visits this cycle. 1 returning child (earliest first test in the school and grade, last
 *            test ≥ 42 days ago, not yet retested this cycle; reads Form B) + new children in rank
 *            order, round-robin across the grade's sections, to 5 (Form A); then 2 alternates.
 *            A child already tested in any cycle is never drawn as new again.
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
  for (const list of classesByGrade.values()) list.sort(bySectionThenId);

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
      roll_number: ctx.enrolledByClass.get(c.id).get(sid).roll_number ?? null,
      frame_size: order.length,
      draw_rank: i + 1,
      seed_digest: digest,
      algo_version: ALGO_VERSION,
      sample_role: 'new',
      form: 'A',
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
  const thisCycle = ctx.draws.filter((d) => d.sample_role === 'returning' && d.grade === grade);
  const queued = thisCycle
    .filter((d) => QUEUED.includes(d.status) && visitOf(d) !== visitId && currentClassOf(ctx, grade, d.student_id))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  if (queued.length) return { ok: true, draw: queued[0] };

  const retestedThisCycle = new Set(thisCycle.map((d) => d.student_id));
  const cutoff = ctx.now.getTime() - RETURN_AFTER_DAYS * DAY_MS;
  const byStudent = new Map();
  for (const d of ctx.tested) {
    if (d.grade !== grade || !d.tested_at) continue;
    const t = new Date(d.tested_at).getTime();
    const s = byStudent.get(d.student_id) || { first: null, last: -Infinity };
    if (!s.first || t < new Date(s.first.tested_at).getTime()) s.first = d;
    s.last = Math.max(s.last, t);
    byStudent.set(d.student_id, s);
  }
  const eligible = [...byStudent.entries()]
    .filter(([sid, s]) => s.last <= cutoff && !retestedThisCycle.has(sid) && currentClassOf(ctx, grade, sid))
    .sort(([a, x], [b, y]) => String(x.first.tested_at).localeCompare(String(y.first.tested_at)) || String(a).localeCompare(String(b)));
  if (!eligible.length) return { ok: true, draw: null };

  const [sid, s] = eligible[0];
  const { cls, enrollment } = currentClassOf(ctx, grade, sid);
  const frameRow = ctx.draws.find((d) => d.sample_role === 'new' && d.class_id === cls.id);
  const ownRow = ctx.draws.find((d) => d.sample_role === 'new' && d.student_id === sid);
  const ins = await store.insertDraws([{
    cycle_id: ctx.cycleId,
    region: REGION,
    school_id: ctx.schoolId,
    class_id: cls.id,
    grade,
    student_id: sid,
    roll_number: enrollment.roll_number ?? null,
    frame_size: frameRow ? frameRow.frame_size : ctx.enrolledByClass.get(cls.id).size,
    draw_rank: ownRow ? ownRow.draw_rank : s.first.draw_rank,
    seed_digest: s.first.seed_digest,
    algo_version: RETURNING_ALGO,
    sample_role: 'returning',
    form: 'B',
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
  const history = [...(d.history || []), { event: 'listed', ...visitRef(visitId), slot, at, ...extra }];
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

// ── The list as the coach sees it ──────────────────────────────────────────────────────────────

async function listFor(visitId, extra = {}) {
  const v = await store.listVisitDraws(visitId);
  if (!v.ok) return v;
  const rows = v.draws.filter((d) => d.list_slot);
  if (!rows.length) return { ok: true, empty: true };
  const [students, classes] = await Promise.all([
    store.listStudents(rows.map((d) => d.student_id)),
    store.getClassesByIds(rows.map((d) => d.class_id)),
  ]);
  if (!students.ok) return students;
  if (!classes.ok) return classes;
  const nameOf = new Map(students.students.map((s) => [s.id, s]));
  const sectionOf = new Map(classes.classes.map((c) => [c.id, c.section || null]));
  const item = (d) => {
    const s = nameOf.get(d.student_id) || {};
    return {
      drawId: d.id,
      studentId: d.student_id,
      rollNumber: d.roll_number,
      classId: d.class_id,
      section: sectionOf.get(d.class_id) || null,
      displayName: s.student_name || null,
      displayNameUrdu: s.student_name_urdu || null,
      role: d.sample_role,
      form: d.form,
      status: d.status,
      attempts: d.attempts,
    };
  };
  const order = (a, b) => (a.sample_role === b.sample_role ? 0 : a.sample_role === 'new' ? -1 : 1)
    || String(sectionOf.get(a.class_id) || '').localeCompare(String(sectionOf.get(b.class_id) || ''))
    || a.draw_rank - b.draw_rank;
  const main = rows.filter((d) => d.list_slot === 'main').sort(order);
  const alts = rows.filter((d) => d.list_slot === 'alternate' && d.status === 'listed').sort(order);
  const listedHere = rows.flatMap((d) => (d.history || []).filter((h) => h.event === 'listed' && visitOfEntry(h) === visitId));
  const children = main.map(item);
  return {
    ok: true,
    cycleId: rows[0].cycle_id,
    grade: rows[0].grade,
    classId: children.length ? children[0].classId : rows[0].class_id,
    classIds: [...new Set(rows.map((d) => d.class_id))],
    gradeFallback: listedHere.some((h) => h.grade_fallback),
    reused: false,
    children,
    alternates: alts.map(item),
    ...extra,
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
    const extra = grade !== primary ? { grade_fallback: true } : {};
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
  const got = await claimInOrder(more, { i: 0 }, need, 'alternate', visit, at, { top_up: true });
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
