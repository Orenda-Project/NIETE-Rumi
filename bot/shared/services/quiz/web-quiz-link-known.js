'use strict';
/**
 * A CLASS LINK ON A PHONE THAT ALREADY HOLDS A CHILD ASKS "IS IT <FIRST>?" FIRST.
 *
 * A child who joined on their own is kept by their phone: opening their home (`/quiz` → the hub) trusts that browser
 * for them (web-quiz-hub-device deviceTrusted). The teacher's class link, opened later in the same browser, used to
 * ask "What is your name?" as for a stranger: the child typed their first name, the server could not tell it from a
 * new child, and the finish went to a second child the home never shows. With app_settings `web_quiz_link_known_child`
 * on (JSON `true` only; 30 s cache; off on any read error) the page asks the server which children this browser holds
 * and asks "Is it <First>?" (two or more: "Who is playing?") before the name box; "Yes" starts the session as that
 * child — the one id the child is known by — and "Someone else" is today's name box.
 *
 *   field(ctx, {preview})        true when the quiz payload may name `link_known` (the page then asks), else false
 *   known({code}, resolveCode, {device})  {kids: [{chip, first, animal}]}: the children THIS browser holds that belong
 *                                to this link, as cards for this code (first names only, ≤ KIDS_MAX, newest first);
 *                                {kids: []} otherwise
 *   kidFor(ctx, chip, device)    the session's child for a `via: 'known'` start: one of those children, or null
 *   closedHome({device})         a CLOSED class link's way home: {on: false} when off; else {on: true, home} where home is
 *                                '/h/<token>?from=link' for the children this browser holds (a hub token bound to THIS
 *                                browser, as the old-link home does), or null when it holds nobody
 *
 * The device is always the phone's own `wq_dv` cookie, forwarded by the edge as `x-wq-device` (the routes pass it) —
 * never a ref the page sends in a body: a page never names a child by what it sends.
 *
 * Who a browser holds: the children a hub (or a bot-sent link) trusted it with (deviceKids), each mapped to the one id
 * it is known by (a merged record → its survivor), still active, and passed by the same read-only gate the next offer
 * uses (deviceMayName). And a class link names only a held child who belongs to it: enrolled in the link's class (or on
 * that class's list), with a session on this code already, or a child of no class at all (joined on their own) whose
 * grade is the quiz's — so a sibling kept on the family phone for another class is never named. Never a classmate, never a child this browser was not trusted with: a link forwarded to a fresh
 * phone is answered nobody, and the page shows today's screen. Never on a friend's challenge code or the teacher's
 * preview. Telemetry: counts and reasons only (`web_quiz.link_known`), never an id or a name.
 */
const supabase = require('../../config/supabase');
const { read: dbRead } = require('./web-quiz-db-deadline');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const Device = require('./web-quiz-hub-device');

const KEY = 'web_quiz_link_known_child';
const TTL_MS = 30 * 1000;
// "Who is playing?" never grows past the one-door chips' size: a phone passed around a class shows its newest four.
const KIDS_MAX = 4;
let cache = null; // { at, on }

// JSON `true` only: a string 'true' row is off.
const isTrue = (value) => value === true;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || '';
// A grade digit in a class label ("Grade 4", "4-B"), as the join queue reads it; null when there is none.
const gradeOf = (txt) => { const m = /[1-8]/.exec(String(txt == null ? '' : txt)); return m ? Number(m[0]) : null; };

/** The switch. Off on any read error (never cached then). */
async function isOn(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === KEY);
    cache = { at: now, on: Boolean(row) && isTrue(row.value) };
    return cache.on;
  } catch (err) {
    logToFile('⚠️ web quiz link known child: settings lookup failed — off', { error: err.message });
    return false;
  }
}

/** May the quiz payload carry `link_known`? Never on a friend's challenge or the teacher's preview. Never throws. */
async function field(ctx, { preview = false } = {}) {
  try {
    if (!ctx || ctx.invitedByStudentId || preview) return false;
    return await isOn();
  } catch (_) {
    return false;
  }
}

/** The one id each held child is known by (the identity store's survivor), when that store is on; else the ids. */
async function canonical(ids) {
  try {
    if (!(await require('./web-quiz-identity-flags').flags()).canon) return new Map(ids.map((id) => [id, id]));
    return await require('./web-quiz-identity-roster').canonicalStudentIds(ids);
  } catch (_) {
    return new Map(ids.map((id) => [id, id]));
  }
}

/**
 * The children this browser holds, newest first: [{id, student_name, student_name_urdu, self_reported_class}] (≤ KIDS_MAX).
 * [] with no device, nobody trusted, Redis down, or any read error.
 */
async function heldBy(device) {
  const d = T.cleanDeviceRef(device);
  if (!d) return [];
  const held = await Device.deviceKids(d);
  if (!held.length) return [];
  const map = await canonical(held);
  const out = [];
  const seen = new Set();
  for (const id of held) {
    const c = String(map.get(String(id)) || id);
    if (seen.has(c)) continue;
    seen.add(c);
    // read-only: the child (or the record the phone was trusted with) on THIS browser, as the next offer checks it
    if (await Device.deviceMayName([...new Set([String(id), c])], d)) out.push({ c, rank: out.length });
  }
  if (!out.length) return [];
  const { data, error } = await dbRead('linkKnown:students:1', (db) => db.from('students')
    .select('id, student_name, student_name_urdu, self_reported_class, list_id, is_active, status').in('id', out.map((x) => x.c)));
  if (error) return [];
  const by = new Map((data || []).filter((r) => r.is_active !== false && r.status !== 'merged').map((r) => [String(r.id), r]));
  return out.map((x) => by.get(x.c)).filter(Boolean).slice(0, KIDS_MAX);
}

/**
 * Of the held children, those who belong to THIS link (a privacy filter, never a lookup of other children): enrolled in
 * the link's class or on its list, a session on this code, or of no class at all with the quiz's grade. The reads run
 * together; a read that fails names nobody by it.
 */
async function ofLink(ctx, kids) {
  if (!kids.length) return [];
  const ids = kids.map((k) => String(k.id));
  const safe = (p) => Promise.resolve(p).then((r) => (r && !r.error ? r.data || [] : []), () => []);
  const [resolved, enrolled, played, quiz, fixed] = await Promise.all([
    require('./web-quiz-identity').resolveQuizClass({ teacherUserId: ctx.teacherUserId, quizId: ctx.quizId, shareCodeId: ctx.moreVideosOf || ctx.shareCodeId }).catch(() => null),
    safe(dbRead('linkKnown:class_enrollments:1', (db) => db.from('class_enrollments').select('student_id, class_id').in('student_id', ids).eq('is_active', true))),
    safe(dbRead('linkKnown:quiz_sessions:1', (db) => db.from('quiz_sessions').select('student_id').in('student_id', ids).eq('share_code_id', ctx.shareCodeId).limit(50))),
    safe(dbRead('linkKnown:quizzes:1', (db) => db.from('quizzes').select('grade').eq('id', ctx.quizId).limit(1))),
    safe(dbRead('linkKnown:child_identity:1', (db) => db.from('child_identity').select('canonical_id, fixed_grade').in('canonical_id', ids))),
  ]);
  const classIds = new Set(((resolved && resolved.classes) || []).map((c) => c && c.id).filter(Boolean).map(String));
  const listIds = [...new Set(kids.map((k) => k.list_id).filter(Boolean).map(String))];
  const lists = listIds.length ? await safe(dbRead('linkKnown:student_lists:1', (db) => db.from('student_lists').select('id, class_id').in('id', listIds))) : [];
  const listClass = new Map(lists.map((l) => [String(l.id), l.class_id ? String(l.class_id) : null]));
  const quizGrade = gradeOf(quiz[0] && quiz[0].grade);
  return kids.filter((k) => {
    const id = String(k.id);
    const mine = enrolled.filter((e) => String(e.student_id) === id);
    if (mine.some((e) => classIds.has(String(e.class_id)))) return true;
    if (k.list_id && classIds.has(listClass.get(String(k.list_id)))) return true;
    if (played.some((p) => String(p.student_id) === id)) return true;
    if (mine.length || k.list_id) return false;   // a child of another class
    const f = fixed.find((x) => String(x.canonical_id) === id);
    const grade = f && f.fixed_grade != null ? Number(f.fixed_grade) : gradeOf(k.self_reported_class);
    return grade != null && quizGrade != null && grade === quizGrade;
  });
}

function shownFirst(lang, k) {
  return firstName(lang === 'ur' && k.student_name_urdu && String(k.student_name_urdu).trim() ? k.student_name_urdu : k.student_name);
}

async function known(body = {}, resolveCode = null, { device = null } = {}) {
  const none = (reason) => { logEvent('web_quiz.link_known', { ok: false, reason }); return { kids: [] }; };
  try {
    if (!(await isOn())) return { kids: [] };
    if (!T.cleanDeviceRef(device)) return none('no_device');
    // The quiz service's resolveCode, handed in by the caller (this module never requires the service: no require loop).
    if (typeof resolveCode !== 'function') return none('no_code');
    let ctx;
    try { ctx = await resolveCode(body.code); } catch (_) { return none('no_code'); }
    if (ctx.invitedByStudentId) return none('challenge');
    const kids = await ofLink(ctx, await heldBy(device));
    if (!kids.length) return none('nobody');
    logEvent('web_quiz.link_known', { ok: true, kids: kids.length });
    return { kids: kids.map((k) => ({ chip: T.chipId(ctx.shareCodeId, k.id), first: shownFirst(ctx.lang, k), animal: T.animalFor(k.id) })) };
  } catch (err) {
    logToFile('⚠️ web quiz link known child: nobody answered', { error: err.message });
    return { kids: [] };
  }
}

/** A `via: 'known'` start: the held child whose chip on this code it is → {id, student_name, self_reported_class}, or null. */
async function kidFor(ctx, chip, device) {
  try {
    if (!ctx || ctx.invitedByStudentId || !(await isOn())) return null;
    const k = (await ofLink(ctx, await heldBy(device))).find((x) => T.chipId(ctx.shareCodeId, x.id) === String(chip));
    return k ? { id: k.id, student_name: k.student_name, self_reported_class: k.self_reported_class || null } : null;
  } catch (_) {
    return null;
  }
}

/** A closed class link's way home (the edge's closed page asks once, with the phone's device). Never throws. */
async function closedHome({ device } = {}) {
  if (!(await isOn())) return { on: false };
  const none = (reason) => { logEvent('web_quiz.link_known', { ok: false, reason, w: 'closed' }); return { on: true, home: null }; };
  try {
    const d = T.cleanDeviceRef(device);
    if (!d) return none('no_device');
    const kids = await heldBy(d);
    if (!kids.length) return none('nobody');
    const token = T.signHub(kids.map((k) => String(k.id)));
    if (!token) return none('no_secret');
    const bound = await Device.deviceTrusted(token, d);
    if (!bound.ok) return none(bound.why);
    logEvent('web_quiz.door_shown', { door: 'link_home', surface: 'closed', w: 's' });
    return { on: true, home: `/h/${token}?from=link` };
  } catch (err) {
    logToFile('⚠️ web quiz link known child: no way home on a closed link', { error: err.message });
    return { on: true, home: null };
  }
}

module.exports = { field, known, kidFor, closedHome, isOn, KEY, KIDS_MAX, _resetCache: () => { cache = null; } };
