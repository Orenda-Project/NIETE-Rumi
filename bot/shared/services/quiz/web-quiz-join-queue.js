'use strict';
/**
 * The teacher join queue (switch web_quiz_identity_canon): "is this chat child the same as this child on your
 * class list?", one tap each, and the strict backward join as a job function.
 *
 *   computeCandidates(teacherUserId)  every queue row for ONE teacher, both tiers, ungated (tests, lead review)
 *   candidatesFor(teacherUserId)      the rows of the tiers that passed the truth-set gate (TIERS_SERVED)
 *   decide({teacherUserId, looseId, candidateId, decision})   'same' | 'no' | 'undo': the only queue write
 *   linkClassCodes({teacherUserId, classId})  the teacher's unbound quiz codes → this class (never a bound one)
 *   runBackwardJoin({dryRun = true})  the strict rule over every chat child; dryRun returns labels and counts only
 *
 * Who is in the queue (per teacher; the teacher's roster is the pool):
 *   a CHAT child = a loose student (list_id NULL, status 'active', merged_into NULL, no active enrolment) of this
 *   teacher (enrolled_by_user_id, or a session on one of the teacher's quiz codes or quizzes) that has a phone
 *   (students.phone / parent_phone or a session's parent_phone).
 *   1. a roster record shares its phone: one with the same name → the strict join ('phone_name'), not the queue;
 *      none with the same name and no roster name match → a sibling's phone, nobody.
 *   2. the exact folded name (+ grade) is unique on the roster:
 *        another loose record of this teacher with the same folded name on a different phone AND device → the
 *        strict join is BLOCKED (IDENTITY §11) and the pair is a 'roster_unique_with_loose' queue row,
 *        evidence.other_same_name_loose = true; else the strict join ('strict'), not the queue.
 *   3. the word-order fold (token set) is unique → the r0 tier B join; neither the queue nor this job.
 *   4. 'probable': every typed name word sits in exactly one roster name (same grade, or the roster grade unknown).
 *   Pairs whose latest merge_log decision of this teacher is 'same' or 'no' leave the queue; 'undo' re-admits.
 *
 * The fold is the r0 identity audit's `norm` (NFKD, marks and harakat dropped, Arabic letter variants mapped, titles
 * dropped), so the rows match the measured truth set. Rows carry first names only: never a surname, phone or device.
 * Never throws: a failure is an empty queue / a refused tap.
 */
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const IdFlags = require('./web-quiz-identity-flags');

const TIERS = Object.freeze(['roster_unique_with_loose', 'probable']);
// The truth-set gate (queue_truth.json, measured 15 Oct 2026): a tier is served only with n >= 100 labelled children
// AND a Wilson 95% lower bound >= 0.85. Measured: roster_unique_with_loose n=11 (0.741), probable n=12 (0.646), so both
// are held out and the queue serves nothing. Lead review flips this constant when a truth set passes.
const TIERS_SERVED = Object.freeze([]);
const DECISIONS = new Set(['same', 'no', 'undo']);
const CAP = 5000;
const JOB_PAGE = 1000;

// ─── the fold (r0 identity audit `norm`) ─────────────────────────────────────
const AR_MAP = { 'ي': 'ی', 'ى': 'ی', 'ك': 'ک', 'ه': 'ہ', 'ة': 'ہ', 'ۀ': 'ہ', 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ؤ': 'و', 'ئ': 'ی', 'ے': 'ی', 'ھ': 'ہ' };
const TITLE = new Set(['master', 'mr', 'miss', 'ms', 'baby', 'student']);
function norm(name) {
  if (!name) return '';
  let s = String(name).normalize('NFKD').replace(/\p{M}/gu, '');
  s = s.replace(/[ً-ٰٟۖ-ۭـ]/g, '');
  s = [...s].map((ch) => AR_MAP[ch] || ch).join('').toLowerCase().replace(/ß/g, 'ss');
  s = s.replace(/[^\p{L}\p{N}_\s]|\p{N}|_/gu, ' ');
  return s.split(/\s+/).filter((t) => t && !TITLE.has(t)).join(' ');
}
const tokset = (name) => norm(name).split(' ').filter(Boolean).sort().join(' ');
const words = (name) => new Set(norm(name).split(' ').filter(Boolean));
const canonFirst = (name) => norm(name).split(' ')[0] || '';
function gradeOf(txt) {
  const m = /[1-8]/.exec(String(txt == null ? '' : txt));
  return m ? Number(m[0]) : null;
}
const p10 = (phone) => String(phone || '').replace(/\D/g, '').slice(-10);
/** The display first name: the first word of the typed name that is not a title, as typed. */
function firstName(name) {
  const parts = String(name || '').trim().split(/[\s.\-_,/]+/);
  for (const p of parts) { const n = norm(p); if (n && !TITLE.has(n)) return p; }
  return '';
}

// ─── reads ───────────────────────────────────────────────────────────────────
async function rows(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message || 'read failed');
  return data || [];
}
const uniq = (xs) => [...new Set(xs.filter(Boolean))];

/** The teacher's classes (class_teachers active ∪ the teacher's lists' classes) and lists (own ∪ on those classes). */
async function teacherScope(t) {
  const ct = await rows(supabase.from('class_teachers').select('class_id').eq('teacher_user_id', t).eq('is_active', true));
  const own = await rows(supabase.from('student_lists').select('id, class_id, class_name').eq('user_id', t).eq('is_active', true));
  const classIds = uniq([...ct.map((x) => x.class_id), ...own.map((l) => l.class_id)]);
  const onClass = classIds.length
    ? await rows(supabase.from('student_lists').select('id, class_id, class_name').in('class_id', classIds).eq('is_active', true)) : [];
  const lists = new Map();
  [...own, ...onClass].forEach((l) => lists.set(l.id, l));
  return { classIds, lists };
}

/** One teacher's roster: live list rows ∪ active class enrolments ⋈ live students. → Map id → {id, names, grade, class_id, phones} */
async function teacherRoster(t, scope) {
  const { classIds, lists } = scope || await teacherScope(t);
  const listIds = [...lists.keys()];
  const classes = classIds.length ? await rows(supabase.from('classes').select('id, grade_code').in('id', classIds)) : [];
  const classGrade = new Map(classes.map((x) => [x.id, gradeOf(x.grade_code)]));
  const enr = classIds.length ? await rows(supabase.from('class_enrollments').select('student_id, class_id').in('class_id', classIds).eq('is_active', true)) : [];
  const enrClass = new Map(enr.map((e) => [e.student_id, e.class_id]));
  const cols = 'id, list_id, student_name, student_name_urdu, phone, parent_phone, status, merged_into, is_active';
  const byList = listIds.length ? await rows(supabase.from('students').select(cols).in('list_id', listIds).limit(CAP)) : [];
  const enrIds = uniq(enr.map((e) => e.student_id)).filter((id) => !byList.some((s) => s.id === id));
  const byEnr = enrIds.length ? await rows(supabase.from('students').select(cols).in('id', enrIds).limit(CAP)) : [];
  const out = new Map();
  for (const s of [...byList, ...byEnr]) {
    if (s.status === 'merged' || s.merged_into || s.is_active === false) continue;
    const list = s.list_id ? lists.get(s.list_id) : null;
    const classId = (list && list.class_id) || enrClass.get(s.id) || null;
    const grade = list ? gradeOf(list.class_name) : null;
    out.set(s.id, {
      id: s.id, student_name: s.student_name, names: [s.student_name, s.student_name_urdu].filter(Boolean),
      grade: grade != null ? grade : (classId ? classGrade.get(classId) ?? null : null), class_id: classId,
      phones: uniq([p10(s.phone), p10(s.parent_phone)]),
    });
  }
  return out;
}

/** The teacher's loose children with their phones and devices. → Map id → {id, student_name, grade, phones, devices} */
async function teacherLoose(t) {
  const codes = await rows(supabase.from('quiz_share_codes').select('id').eq('teacher_user_id', t));
  const quizzes = await rows(supabase.from('quizzes').select('id').eq('teacher_id', t));
  const sCols = 'student_id, parent_phone, device_ref';
  const viaCode = codes.length ? await rows(supabase.from('quiz_sessions').select(sCols).in('share_code_id', codes.map((x) => x.id)).limit(CAP)) : [];
  const viaQuiz = quizzes.length ? await rows(supabase.from('quiz_sessions').select(sCols).in('quiz_id', quizzes.map((x) => x.id)).limit(CAP)) : [];
  const cols = 'id, list_id, student_name, self_reported_class, phone, parent_phone, status, merged_into, is_active';
  const enrolled = await rows(supabase.from('students').select(cols).eq('enrolled_by_user_id', t).is('list_id', null).eq('status', 'active').is('merged_into', null).limit(CAP));
  const reached = uniq([...viaCode, ...viaQuiz].map((q) => q.student_id)).filter((id) => !enrolled.some((s) => s.id === id));
  const more = reached.length ? await rows(supabase.from('students').select(cols).in('id', reached).is('list_id', null).eq('status', 'active').is('merged_into', null)) : [];
  let kids = [...enrolled, ...more].filter((s) => s.is_active !== false);
  if (!kids.length) return new Map();
  const ids = kids.map((s) => s.id);
  const enr = await rows(supabase.from('class_enrollments').select('student_id').in('student_id', ids).eq('is_active', true));
  const enrolledSomewhere = new Set(enr.map((e) => e.student_id));
  kids = kids.filter((s) => !enrolledSomewhere.has(s.id));
  // every session of these children (not only this teacher's) carries their phones and devices
  const sessions = await rows(supabase.from('quiz_sessions').select(sCols).in('student_id', kids.map((s) => s.id)).limit(CAP));
  const out = new Map();
  for (const s of kids) {
    const mine = sessions.filter((q) => q.student_id === s.id);
    out.set(s.id, {
      id: s.id, student_name: s.student_name, grade: gradeOf(s.self_reported_class),
      phones: new Set(uniq([p10(s.phone), p10(s.parent_phone), ...mine.map((q) => p10(q.parent_phone))])),
      devices: new Set(uniq(mine.map((q) => q.device_ref))),
    });
  }
  return out;
}

// ─── the rule ────────────────────────────────────────────────────────────────
function match(kid, roster, key) {
  const k = key(kid.student_name);
  if (!k) return { v: 'no_name' };
  const C = [...roster.values()].filter((r) => r.names.some((n) => key(n) === k));
  const G = kid.grade == null ? C : C.filter((r) => r.grade == null || r.grade === kid.grade);
  if (G.length === 1) return { v: 'unique', r: G[0] };
  if (G.length > 1) return { v: 'ambiguous' };
  return { v: C.length ? 'grade_mismatch' : 'none' };
}

const disjoint = (a, b) => ![...a].some((x) => b.has(x));

/**
 * Route one chat child against one teacher's roster and loose set.
 * → {label: phone_name|strict|blocked|word_order|probable|ambiguous|grade_mismatch|sibling_phone|none, r?}
 */
function route(kid, roster, loose) {
  const exact = match(kid, roster, norm);
  const ph = [...roster.values()].filter((r) => r.phones.some((p) => p && kid.phones.has(p)));
  if (ph.length) {
    const named = ph.filter((r) => norm(r.student_name) === norm(kid.student_name));
    if (named.length === 1) return { label: 'phone_name', r: named[0] };
    if (exact.v === 'none' || exact.v === 'no_name') return { label: 'sibling_phone' };
  }
  if (exact.v === 'unique') {
    const k = norm(kid.student_name);
    const others = [...loose.values()].filter((o) => o.id !== kid.id && norm(o.student_name) === k
      && disjoint(o.phones, kid.phones) && disjoint(o.devices, kid.devices));
    return { label: others.length ? 'blocked' : 'strict', r: exact.r };
  }
  if (exact.v === 'none' || exact.v === 'grade_mismatch') {
    const t = match(kid, roster, tokset);
    if (t.v === 'unique') return { label: 'word_order', r: t.r };
  }
  if (['none', 'grade_mismatch', 'ambiguous'].includes(exact.v)) {
    const w = words(kid.student_name);
    if (w.size) {
      let P = [...roster.values()].filter((r) => r.names.some((n) => { const nw = words(n); return [...w].every((x) => nw.has(x)); }));
      if (kid.grade != null) P = P.filter((r) => r.grade == null || r.grade === kid.grade);
      if (P.length === 1) return { label: 'probable', r: P[0] };
    }
  }
  if (exact.v === 'ambiguous' || exact.v === 'grade_mismatch') return { label: exact.v };
  return { label: 'none' };
}

/** The latest decision per (loose, candidate) pair of this teacher. */
async function lastDecisions(t, looseIds) {
  if (!looseIds.length) return new Map();
  const log = await rows(supabase.from('merge_log').select('loose_id, candidate_id, decision, decided_at')
    .eq('teacher_id', t).in('loose_id', looseIds).order('decided_at', { ascending: true }));
  const m = new Map();
  log.forEach((x) => m.set(`${x.loose_id}|${x.candidate_id}`, x.decision));
  return m;
}

async function canonOn() {
  try { return Boolean((await IdFlags.flags()).canon); } catch (_) { return false; }
}

async function compute(t) {
  const scope = await teacherScope(t);
  const roster = await teacherRoster(t, scope);
  if (!roster.size) return [];
  const loose = await teacherLoose(t);
  const out = [];
  for (const kid of loose.values()) {
    if (!kid.phones.size) continue; // a page child: never routed (it can still block a chat child)
    const res = route(kid, roster, loose);
    if (res.label !== 'blocked' && res.label !== 'probable') continue;
    const tier = res.label === 'blocked' ? 'roster_unique_with_loose' : 'probable';
    out.push({
      loose_id: kid.id, candidate_id: res.r.id,
      first_name: firstName(kid.student_name), candidate_first_name: firstName(res.r.student_name),
      class_id: res.r.class_id, grade: res.r.grade,
      evidence: {
        tier, name_words_matched: words(kid.student_name).size,
        same_grade: kid.grade != null && res.r.grade === kid.grade, other_same_name_loose: tier === 'roster_unique_with_loose',
      },
    });
  }
  const decided = await lastDecisions(t, uniq(out.map((x) => x.loose_id)));
  return out.filter((x) => !['same', 'no'].includes(decided.get(`${x.loose_id}|${x.candidate_id}`)))
    .sort((a, b) => String(a.loose_id).localeCompare(String(b.loose_id)));
}

/** Every queue row of both tiers for one teacher (ungated). [] when the switch is off. Never throws. */
async function computeCandidates(teacherUserId) {
  try {
    if (!teacherUserId || !(await canonOn())) return [];
    return await compute(teacherUserId);
  } catch (err) {
    logToFile('⚠️ join queue: candidates failed — an empty queue', { error: err.message });
    return [];
  }
}

const serveTiers = (list, tiers = TIERS_SERVED) => list.filter((x) => tiers.includes(x.evidence.tier));

/** The queue the teacher is shown: only the tiers that passed the truth-set gate. */
async function candidatesFor(teacherUserId) {
  if (!TIERS_SERVED.length) {
    await canonOn(); // the switch is still read, so the off path's reads are the same either way
    return [];
  }
  return serveTiers(await computeCandidates(teacherUserId));
}

// ─── the tap ─────────────────────────────────────────────────────────────────
/**
 * → {ok:true, decision, already?} | {ok:false, reason} | {off:true}. Writes only on a valid tap of THIS teacher; the same
 * tap twice writes once ({already:true}). Pure of HTTP: the caller supplies the teacher from its own signed session.
 */
async function decide({ teacherUserId, looseId, candidateId, decision } = {}) {
  if (!(await canonOn())) return { off: true };
  if (!teacherUserId || !looseId || !candidateId || looseId === candidateId || !DECISIONS.has(decision)) return { ok: false, reason: 'bad_request' };
  try {
    const roster = await teacherRoster(teacherUserId);
    if (!roster.has(candidateId)) return { ok: false, reason: 'not_your_roster' };
    const now = new Date().toISOString();
    const log = (d) => rows(supabase.from('merge_log').insert({
      loose_id: looseId, candidate_id: candidateId, teacher_id: teacherUserId, decision: d, source: 'queue', decided_at: now,
    }).select('id'));
    // Idempotent: the same tap again (a 303-and-refresh double submit) writes nothing and answers as the first did.
    const last = (await lastDecisions(teacherUserId, [looseId])).get(`${looseId}|${candidateId}`);
    if (last === decision) {
      if (decision !== 'same') return { ok: true, decision, already: true };
      const cur = await rows(supabase.from('students').select('id').eq('id', looseId).eq('merged_into', candidateId));
      if (cur.length) return { ok: true, decision, already: true };
    }
    if (decision === 'undo') {
      if (last !== 'same') return { ok: false, reason: 'nothing_to_undo' };
      const back = await rows(supabase.from('students').update({ merged_into: null, status: 'active', is_active: true, updated_at: now })
        .eq('id', looseId).eq('merged_into', candidateId).is('list_id', null).select('id'));
      if (!back.length) return { ok: false, reason: 'nothing_to_undo' };
      await log('undo');
      return { ok: true, decision };
    }
    const loose = await teacherLoose(teacherUserId);
    if (!loose.has(looseId)) return { ok: false, reason: 'not_loose' };
    if (decision === 'no') {
      await log('no');
      return { ok: true, decision };
    }
    if (!(await mergeLoose(looseId, candidateId, now))) return { ok: false, reason: 'not_loose' };
    await log('same');
    logEvent('web_quiz.id_confirmed', { w: 's', by: 'merged' });
    return { ok: true, decision };
  } catch (err) {
    logToFile('⚠️ join queue: decision not written', { error: err.message });
    return { ok: false, reason: 'failed' };
  }
}

/** The loose row → merged into the roster record, only if it is still loose and active (mergeTypedInto's guard). */
async function mergeLoose(looseId, candidateId, now) {
  const enr = await rows(supabase.from('class_enrollments').select('student_id').eq('student_id', looseId).eq('is_active', true));
  if (enr.length) return false;
  const done = await rows(supabase.from('students').update({ status: 'merged', merged_into: candidateId, is_active: false, updated_at: now })
    .eq('id', looseId).is('list_id', null).eq('status', 'active').is('merged_into', null).select('id'));
  return done.length > 0;
}

// ─── "link this class's quiz codes" ──────────────────────────────────────────
/** → {linked: n} | {linked: 0, reason} | {off:true}. Never rewrites a code that already has a class. */
async function linkClassCodes({ teacherUserId, classId } = {}) {
  if (!(await canonOn())) return { off: true };
  if (!teacherUserId || !classId) return { linked: 0, reason: 'bad_request' };
  try {
    const { classIds } = await teacherScope(teacherUserId);
    if (!classIds.includes(classId)) return { linked: 0, reason: 'not_your_class' };
    const done = await rows(supabase.from('quiz_share_codes').update({ class_id: classId })
      .eq('teacher_user_id', teacherUserId).is('class_id', null).select('id'));
    logToFile('🔗 join queue: quiz codes linked to a class', { teacherUserId, classId, n: done.length });
    return { linked: done.length };
  } catch (err) {
    logToFile('⚠️ join queue: codes not linked', { error: err.message });
    return { linked: 0, reason: 'failed' };
  }
}

// ─── the strict backward join, as a job ──────────────────────────────────────
/**
 * Every chat child (loose, with a phone) against the roster of each teacher it reached; joined only by
 * (a) a shared phone + the same name, or (b) a roster-unique exact folded name + grade with no other same-name loose
 * record of that teacher on another phone or device, and only when exactly one teacher's roster says so and no other
 * teacher's roster holds the name too. A job is not a teacher's tap: merge_log gets source 'queue' with the roster's
 * teacher until the CHECK allows a job source. → {dryRun, labels: {loose_id: label}, counts} | {off:true}
 */
async function runBackwardJoin({ dryRun = true } = {}) {
  if (!(await canonOn())) return { off: true };
  try {
    const teachers = new Set();
    let from = null;
    // the teachers reached by a loose child: enrolled_by, then the owners of the codes and quizzes of its sessions
    for (;;) {
      let q = supabase.from('students').select('id, enrolled_by_user_id').is('list_id', null).eq('status', 'active').is('merged_into', null)
        .order('id', { ascending: true }).limit(JOB_PAGE);
      if (from) q = q.gt('id', from);
      const page = await rows(q);
      page.forEach((s) => teachers.add(s.enrolled_by_user_id));
      const ids = page.map((s) => s.id);
      if (ids.length) {
        const ss = await rows(supabase.from('quiz_sessions').select('share_code_id, quiz_id').in('student_id', ids).limit(CAP * 4));
        const codes = uniq(ss.map((x) => x.share_code_id));
        const quizzes = uniq(ss.map((x) => x.quiz_id));
        if (codes.length) (await rows(supabase.from('quiz_share_codes').select('teacher_user_id').in('id', codes))).forEach((x) => teachers.add(x.teacher_user_id));
        if (quizzes.length) (await rows(supabase.from('quizzes').select('teacher_id').in('id', quizzes))).forEach((x) => teachers.add(x.teacher_id));
      }
      if (page.length < JOB_PAGE) break;
      from = ids[ids.length - 1];
    }
    const verdicts = new Map(); // loose id → [{t, label, r}]
    for (const t of [...teachers].filter(Boolean).sort()) {
      const roster = await teacherRoster(t);
      const loose = await teacherLoose(t);
      for (const kid of loose.values()) {
        if (!kid.phones.size) continue;
        const res = roster.size ? route(kid, roster, loose) : { label: 'none' };
        if (!verdicts.has(kid.id)) verdicts.set(kid.id, []);
        verdicts.get(kid.id).push({ t, ...res });
      }
    }
    const RANK = ['phone_name', 'strict', 'blocked', 'ambiguous', 'grade_mismatch', 'sibling_phone'];
    const labels = {};
    const joins = [];
    for (const [id, vs] of verdicts) {
      const joinsHere = vs.filter((v) => v.label === 'phone_name' || v.label === 'strict');
      const nameElsewhere = vs.some((v) => !joinsHere.includes(v) && ['blocked', 'ambiguous', 'word_order', 'probable'].includes(v.label));
      if (joinsHere.length === 1 && !nameElsewhere) {
        labels[id] = joinsHere[0].label;
        joins.push({ id, ...joinsHere[0] });
        continue;
      }
      const best = vs.map((v) => v.label).filter((l) => RANK.includes(l)).sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0];
      labels[id] = joinsHere.length > 1 ? 'ambiguous' : (best === 'phone_name' || best === 'strict' ? 'blocked' : (best || 'none'));
    }
    const counts = { phone_name: 0, strict: 0, blocked: 0, ambiguous: 0, none: 0, sibling_phone: 0, grade_mismatch: 0 };
    Object.values(labels).forEach((l) => { counts[l] += 1; });
    let joined = 0;
    if (!dryRun) {
      for (const j of joins) {
        const now = new Date().toISOString();
        if (!(await mergeLoose(j.id, j.r.id, now))) continue;
        await rows(supabase.from('merge_log').insert({ loose_id: j.id, candidate_id: j.r.id, teacher_id: j.t, decision: 'same', source: 'queue', decided_at: now }).select('id'));
        logEvent('web_quiz.id_confirmed', { w: 's', by: 'merged' });
        joined += 1;
      }
    } else joined = joins.length;
    counts.joined = joined;
    logToFile('🔗 join queue: backward join', { dryRun, ...counts });
    return { dryRun, labels, counts };
  } catch (err) {
    logToFile('⚠️ join queue: backward join failed', { error: err.message });
    return { dryRun, labels: {}, counts: { joined: 0 }, error: 'failed' };
  }
}

module.exports = {
  computeCandidates, candidatesFor, serveTiers, decide, linkClassCodes, runBackwardJoin,
  TIERS, TIERS_SERVED, norm, tokset, words, canonFirst, gradeOf, firstName, route,
};
