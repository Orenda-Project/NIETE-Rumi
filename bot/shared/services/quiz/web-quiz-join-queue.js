'use strict';
/**
 * The teacher join queue (switch web_quiz_identity_canon): "is this chat child the same as this child on your
 * class list?", one tap each, and the strict backward join as a job function.
 *
 *   computeCandidates(teacherUserId)  every queue row for ONE teacher, both tiers, ungated (tests, lead review)
 *   candidatesFor(teacherUserId)      the rows of the served tiers (TIERS_SERVED minus any tier held by precision),
 *                                     from the teacher's cached queue (QUEUE_TTL_S, Redis with a local fallback):
 *                                     the rows are computed once per teacher per few minutes; every decision drops it
 *   precisionByTier()                 per tier: the teachers' decisions so far, precision, Wilson lower bound, held
 *   servedTiers()                     the tiers served right now ([] when the switch is off)
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
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

/** The keyed child id for an event (the event-key module, when present); nothing when it is not. Never a raw id. */
function kidFor(canonicalId) {
  try {
    const Kid = require('./web-quiz-kid');
    const kid = Kid && typeof Kid.kidOf === 'function' ? Kid.kidOf(canonicalId) : null;
    return kid ? { kid } : {};
  } catch (_) {
    return {};
  }
}
const IdFlags = require('./web-quiz-identity-flags');
const { inChunks } = require('./web-quiz-in-chunks');   // every `.in()` on a data-sized list: <= 200 ids a request

const TIERS = Object.freeze(['roster_unique_with_loose', 'probable']);
// Bounded labelling mode (IDENTITY §12 gate, ruled 15 Oct 2026): the queue serves roster_unique_with_loose only (0 wrong
// of 11 on the labelled set, queue_truth.json); probable is held out (1 wrong of 12, Wilson lower 0.646). A served tier
// is also held automatically, per tier, once it has n >= HOLD_MIN_N teacher decisions and the Wilson 95% lower bound
// of their precision falls under HOLD_LOWER (precisionByTier, read from merge_log at serve time).
const TIERS_SERVED = Object.freeze(['roster_unique_with_loose']);
let served = TIERS_SERVED; // tests only (_serveForTest); production always serves TIERS_SERVED
const HOLD_MIN_N = 50;
const HOLD_LOWER = 0.85;
const PRECISION_TTL_MS = 60 * 1000;
const DECISIONS = new Set(['same', 'no', 'undo']);
const CAP = 5000;
const QUEUE_TTL_S = 10 * 60;      // a teacher's computed queue is kept this long (the tab and every tap read it)
const QUEUE_PREFIX = 'wq:jq:t:';  // + sha256(teacher id)[0:16]: ids and hashes only in a key
const JOB_PAGE = 200;   // a page of loose ids goes into one `.in()`: at most IN_CHUNK (web-quiz-in-chunks)

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
    ? await inChunks(() => supabase.from('student_lists').select('id, class_id, class_name').eq('is_active', true), 'class_id', classIds) : [];
  const lists = new Map();
  [...own, ...onClass].forEach((l) => lists.set(l.id, l));
  return { classIds, lists };
}

/** One teacher's roster: live list rows ∪ active class enrolments ⋈ live students. → Map id → {id, names, grade, class_id, phones} */
async function teacherRoster(t, scope) {
  const { classIds, lists } = scope || await teacherScope(t);
  const listIds = [...lists.keys()];
  const classes = classIds.length ? await inChunks(() => supabase.from('classes').select('id, grade_code'), 'id', classIds) : [];
  const classGrade = new Map(classes.map((x) => [x.id, gradeOf(x.grade_code)]));
  const enr = classIds.length ? await inChunks(() => supabase.from('class_enrollments').select('student_id, class_id').eq('is_active', true), 'class_id', classIds) : [];
  const enrClass = new Map(enr.map((e) => [e.student_id, e.class_id]));
  const cols = 'id, list_id, student_name, student_name_urdu, father_name, phone, parent_phone, status, merged_into, is_active';
  const byList = listIds.length ? await inChunks(() => supabase.from('students').select(cols).limit(CAP), 'list_id', listIds) : [];
  const enrIds = uniq(enr.map((e) => e.student_id)).filter((id) => !byList.some((s) => s.id === id));
  const byEnr = enrIds.length ? await inChunks(() => supabase.from('students').select(cols).limit(CAP), 'id', enrIds) : [];
  const out = new Map();
  for (const s of [...byList, ...byEnr]) {
    if (s.status === 'merged' || s.merged_into || s.is_active === false) continue;
    const list = s.list_id ? lists.get(s.list_id) : null;
    const classId = (list && list.class_id) || enrClass.get(s.id) || null;
    const grade = list ? gradeOf(list.class_name) : null;
    out.set(s.id, {
      id: s.id, student_name: s.student_name, father_name: s.father_name || null, names: [s.student_name, s.student_name_urdu].filter(Boolean),
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
  const viaCode = codes.length ? await inChunks(() => supabase.from('quiz_sessions').select(sCols).limit(CAP), 'share_code_id', codes.map((x) => x.id)) : [];
  const viaQuiz = quizzes.length ? await inChunks(() => supabase.from('quiz_sessions').select(sCols).limit(CAP), 'quiz_id', quizzes.map((x) => x.id)) : [];
  const cols = 'id, list_id, student_name, self_reported_class, father_name, phone, parent_phone, status, merged_into, is_active';
  const enrolled = await rows(supabase.from('students').select(cols).eq('enrolled_by_user_id', t).is('list_id', null).eq('status', 'active').is('merged_into', null).limit(CAP));
  const reached = uniq([...viaCode, ...viaQuiz].map((q) => q.student_id)).filter((id) => !enrolled.some((s) => s.id === id));
  const more = reached.length ? await inChunks(() => supabase.from('students').select(cols).is('list_id', null).eq('status', 'active').is('merged_into', null), 'id', reached) : [];
  let kids = [...enrolled, ...more].filter((s) => s.is_active !== false);
  if (!kids.length) return new Map();
  const ids = kids.map((s) => s.id);
  const enr = await inChunks(() => supabase.from('class_enrollments').select('student_id').eq('is_active', true), 'student_id', ids);
  const enrolledSomewhere = new Set(enr.map((e) => e.student_id));
  kids = kids.filter((s) => !enrolledSomewhere.has(s.id));
  // every session of these children (not only this teacher's) carries their phones and devices
  const sessions = await inChunks(() => supabase.from('quiz_sessions').select(sCols).limit(CAP), 'student_id', kids.map((s) => s.id));
  const out = new Map();
  for (const s of kids) {
    const mine = sessions.filter((q) => q.student_id === s.id);
    out.set(s.id, {
      id: s.id, student_name: s.student_name, father_name: s.father_name || null, grade: gradeOf(s.self_reported_class),
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
  const log = await inChunks(() => supabase.from('merge_log').select('loose_id, candidate_id, decision, decided_at')
    .eq('teacher_id', t).order('decided_at', { ascending: true }), 'loose_id', looseIds);
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
      first: firstName(kid.student_name), candidate_first: firstName(res.r.student_name),
      // the teacher view may show the father's FIRST name under each name (never a surname; null when the record has none)
      father_first: kid.father_name ? firstName(kid.father_name) : null, candidate_father_first: res.r.father_name ? firstName(res.r.father_name) : null,
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

const serveTiers = (list, tiers = served) => list.filter((x) => tiers.includes(x.evidence.tier));

// ─── the per-tier auto-hold ──────────────────────────────────────────────────
/** The Wilson score interval's lower bound at 95% (z = 1.96) for k successes of n; null when n = 0. */
function wilsonLower(k, n, z = 1.96) {
  if (!n) return null;
  const p = k / n;
  const z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}
const round4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

let precisionCache = null; // {at, value}

// ─── the per-teacher queue cache ─────────────────────────────────────────────
// compute() is the slow part (every roster row, every session of every loose child: seconds on a teacher with many
// codes) and it ran on every tab load AND inside every decision. The computed rows (both tiers, ungated) are kept per
// teacher for QUEUE_TTL_S in Redis — a local in-process map when Redis is down — and every write of decide() drops the
// teacher's entry, so a decided pair never comes back stale. The row shape in the cache is exactly compute()'s (first
// names only; never a phone or a device).
const localQueue = new Map(); // key → {at, rows}
const queueKey = (t) => QUEUE_PREFIX + crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 16);
function redisOrNull() {
  try {
    const r = require('../cache/railway-redis.service');
    return r && typeof r.isAvailable === 'function' && r.isAvailable() ? r : null;
  } catch (_) { return null; }
}
async function cachedCompute(t) {
  const key = queueKey(t);
  const now = Date.now();
  const r = redisOrNull();
  if (r) {
    // Redis up: it is the one home of the cached queue (shared by every bot process); a miss recomputes.
    try {
      const v = await r.get(key);
      const hit = v && typeof v === 'string' ? JSON.parse(v) : v;
      if (hit && Array.isArray(hit.rows)) return hit.rows;
    } catch (_) { /* a failed read computes */ }
    const rows = await compute(t);
    try { await r.set(key, { at: now, rows }, QUEUE_TTL_S); } catch (_) { /* served uncached this once */ }
    return rows;
  }
  // Redis down: this process keeps its own copy for the same TTL (never consulted while Redis is up).
  const loc = localQueue.get(key);
  if (loc && now - loc.at < QUEUE_TTL_S * 1000) return loc.rows;
  const rows = await compute(t);
  localQueue.set(key, { at: now, rows });
  return rows;
}
async function dropQueue(t) {
  if (!t) return;
  const key = queueKey(t);
  localQueue.delete(key);
  const r = redisOrNull();
  if (r) { try { await r.delete(key); } catch (_) { /* expires on its own */ } }
}

async function countDecisions(tier, decision) {
  const { count, error } = await supabase.from('merge_log').select('id', { count: 'exact', head: true })
    .eq('source', 'queue').eq('tier', tier).eq('decision', decision);
  if (error) throw new Error(error.message || 'read failed');
  return count || 0;
}

/**
 * Per tier, from the teachers' queue decisions (merge_log source 'queue', tier set): an undo reverses a same, so
 * same_net = same - undo, n = same_net + no, `precision` = same_net / n (null when n = 0). NOTE: this is the
 * TEACHER-ACCEPTED SHARE (a tap is a judgement, not a label); the labelled precision is queue_truth.json's. The strip
 * prints it as "teacher-accepted share". wilson_lower_95 is its 95% Wilson lower bound, held = n >= 50 and
 * wilson_lower_95 < 0.85. → [{tier, n, same, no, undo, precision, wilson_lower_95, held}]
 * in TIERS order. Never throws: a failed read holds every tier ({held:true, error:true}). Cached 60 s in-process.
 */
async function precisionByTier() {
  if (precisionCache && Date.now() - precisionCache.at < PRECISION_TTL_MS) return precisionCache.value.map((x) => ({ ...x }));
  try {
    const value = [];
    for (const tier of TIERS) {
      const same = await countDecisions(tier, 'same');
      const no = await countDecisions(tier, 'no');
      const undo = await countDecisions(tier, 'undo');
      const sameNet = Math.max(0, same - undo);
      const n = sameNet + no;
      const lower = wilsonLower(sameNet, n);
      value.push({
        tier, n, same, no, undo, precision: n ? round4(sameNet / n) : null, wilson_lower_95: round4(lower),
        held: n >= HOLD_MIN_N && lower < HOLD_LOWER,
      });
    }
    precisionCache = { at: Date.now(), value };
    return value.map((x) => ({ ...x }));
  } catch (err) {
    logToFile('⚠️ join queue: tier precision not read — every tier held', { error: err.message });
    return TIERS.map((tier) => ({ tier, n: 0, same: 0, no: 0, undo: 0, precision: null, wilson_lower_95: null, held: true, error: true }));
  }
}

/** The tiers served now: TIERS_SERVED minus any tier precisionByTier holds. Assumes the switch was checked. */
async function liveTiers() {
  if (!served.length) return [];
  const held = new Set((await precisionByTier()).filter((x) => x.held).map((x) => x.tier));
  return served.filter((t) => !held.has(t));
}

/** The tiers the queue serves right now; [] when the switch is off. Never throws. */
async function servedTiers() {
  if (!(await canonOn())) return [];
  return liveTiers();
}

/** The queue the teacher is shown: only the served tiers that are not held. [] when the switch is off. */
async function candidatesFor(teacherUserId) {
  try {
    if (!teacherUserId || !(await canonOn())) return [];
    const tiers = await liveTiers();
    if (!tiers.length) return [];
    return serveTiers(await cachedCompute(teacherUserId), tiers);
  } catch (err) {
    logToFile('⚠️ join queue: candidates failed — an empty queue', { error: err.message });
    return [];
  }
}

// ─── the tap ─────────────────────────────────────────────────────────────────
/**
 * → {ok:true, decision, already?} | {ok:false, reason} | {off:true}. Writes only on a valid tap of THIS teacher
 * ('same' only on a pair in the served queue, else reason 'not_served'); the same
 * tap twice writes once ({already:true}). Pure of HTTP: the caller supplies the teacher from its own signed session.
 */
async function decide({ teacherUserId, looseId, candidateId, decision } = {}) {
  if (!(await canonOn())) return { off: true };
  if (!teacherUserId || !looseId || !candidateId || looseId === candidateId || !DECISIONS.has(decision)) return { ok: false, reason: 'bad_request' };
  try {
    const now = new Date().toISOString();
    const log = (d, tier) => rows(supabase.from('merge_log').insert({
      loose_id: looseId, candidate_id: candidateId, teacher_id: teacherUserId, decision: d, source: 'queue', tier: tier || null, decided_at: now,
    }).select('id')).then(async (x) => { precisionCache = null; await dropQueue(teacherUserId); return x; });
    // Idempotent: the same tap again (a 303-and-refresh double submit) writes nothing and answers as the first did.
    const last = (await lastDecisions(teacherUserId, [looseId])).get(`${looseId}|${candidateId}`);
    if (last === decision) {
      if (decision !== 'same') return { ok: true, decision, already: true };
      const cur = await rows(supabase.from('students').select('id').eq('id', looseId).eq('merged_into', candidateId));
      if (cur.length) return { ok: true, decision, already: true };
    }
    // "Same child" only for a pair the teacher is actually shown: the served queue (a tier held out or held by its
    // precision can never be written through any caller). 'no' and 'undo' keep their own checks (an undo stays
    // possible). Every row records the tier of the pair as shown; an undo, the tier of the 'same' it reverses.
    // The pair as the teacher was shown it: the served tiers of the teacher's cached queue (computed at most
    // QUEUE_TTL_S ago from this teacher's roster and loose children, so a served pair IS on the roster and IS loose
    // as of then). 'same' / 'no' on a served pair verify nothing else and go to the write: the merge keeps its own
    // guard (still loose, still active, not enrolled) so a pair that went stale is refused, never mis-merged.
    const tiers = decision === 'undo' ? [] : await liveTiers();
    const shown = tiers.length ? serveTiers(await cachedCompute(teacherUserId), tiers) : [];
    const pair = shown.find((x) => x.loose_id === looseId && x.candidate_id === candidateId) || null;
    if (pair && decision === 'same') {
      if (!(await mergeLoose(looseId, candidateId, now))) { await dropQueue(teacherUserId); return { ok: false, reason: 'not_loose' }; }
      await log('same', pair.evidence.tier);
      logEvent('web_quiz.id_confirmed', { w: 's', by: 'merged', ...kidFor(candidateId) });
      return { ok: true, decision };
    }
    if (pair && decision === 'no') {
      await log('no', pair.evidence.tier);
      return { ok: true, decision };
    }
    // Not a served pair (or an undo): today's full checks, unchanged.
    const roster = await teacherRoster(teacherUserId);
    if (!roster.has(candidateId)) return { ok: false, reason: 'not_your_roster' };
    if (decision === 'same') return { ok: false, reason: 'not_served' };
    if (decision === 'undo') {
      if (last !== 'same') return { ok: false, reason: 'nothing_to_undo' };
      const back = await rows(supabase.from('students').update({ merged_into: null, status: 'active', is_active: true, updated_at: now })
        .eq('id', looseId).eq('merged_into', candidateId).is('list_id', null).select('id'));
      if (!back.length) return { ok: false, reason: 'nothing_to_undo' };
      await log('undo', await sameTier(teacherUserId, looseId, candidateId));
      return { ok: true, decision };
    }
    const loose = await teacherLoose(teacherUserId);
    if (!loose.has(looseId)) return { ok: false, reason: 'not_loose' };
    if (decision === 'no') {
      // The tier is recorded only for a pair the teacher was shown (the served, unheld queue); a 'no' on any other
      // pair is kept without a tier, so nothing counts toward a tier's accepted share before the teacher saw it.
      await log('no', null);
      return { ok: true, decision };
    }
    return { ok: false, reason: 'bad_request' };
  } catch (err) {
    logToFile('⚠️ join queue: decision not written', { error: err.message });
    return { ok: false, reason: 'failed' };
  }
}

/** The tier of this teacher's latest 'same' on the pair (what an undo reverses); null when it carried none. */
async function sameTier(t, looseId, candidateId) {
  const last = await rows(supabase.from('merge_log').select('tier, decided_at').eq('teacher_id', t).eq('loose_id', looseId)
    .eq('candidate_id', candidateId).eq('decision', 'same').order('decided_at', { ascending: false }).limit(1));
  return (last[0] && last[0].tier) || null;
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
        const ss = await inChunks(() => supabase.from('quiz_sessions').select('share_code_id, quiz_id').limit(CAP * 4), 'student_id', ids);
        const codes = uniq(ss.map((x) => x.share_code_id));
        const quizzes = uniq(ss.map((x) => x.quiz_id));
        if (codes.length) (await inChunks(() => supabase.from('quiz_share_codes').select('teacher_user_id'), 'id', codes)).forEach((x) => teachers.add(x.teacher_user_id));
        if (quizzes.length) (await inChunks(() => supabase.from('quizzes').select('teacher_id'), 'id', quizzes)).forEach((x) => teachers.add(x.teacher_id));
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
        // tier NULL: the job joins only by phone + name or the strict rule, never a queue tier (blocked/probable pairs
        // are the teacher's), so these rows never count toward a tier's precision.
        // source 'job': the backward-join job never wears a teacher tap's label (tier stays null)
        await rows(supabase.from('merge_log').insert({ loose_id: j.id, candidate_id: j.r.id, teacher_id: j.t, decision: 'same', source: 'job', tier: null, decided_at: now }).select('id'));
        logEvent('web_quiz.id_confirmed', { w: 's', by: 'merged', ...kidFor(j.r.id) });
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
  computeCandidates, candidatesFor, serveTiers, decide, linkClassCodes, runBackwardJoin, precisionByTier, servedTiers,
  TIERS, TIERS_SERVED, HOLD_MIN_N, HOLD_LOWER, norm, wilsonLower,
  _serveForTest: (tiers) => { served = tiers ? Object.freeze([...tiers]) : TIERS_SERVED; precisionCache = null; },
  _resetPrecisionCache: () => { precisionCache = null; }, _resetQueueCache: () => { localQueue.clear(); }, QUEUE_TTL_S,
  tokset, words, canonFirst, gradeOf, firstName, route,
};
