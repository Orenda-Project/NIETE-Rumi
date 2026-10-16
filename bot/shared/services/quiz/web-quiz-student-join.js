'use strict';
/**
 * A CHILD JOINS ON THEIR OWN (switch `quiz_student_join`, default OFF; hard parent web_quiz_phone_bind for every write).
 *
 * A phone the bot has never seen sends `/quiz`; the landing (`/quiz/go`) knows the sender through its nonce
 * (first-touch/go-nonce.js) and sends a child here: ONE screen, "Which class are you in?" (grade chips 1–5) and
 * "What should Jugnu call you?" (a first name), then "Let's go!" lands on the child's home. No school, no phone, no
 * registration. The next `/quiz` from that phone finds the child through the binding, with no question.
 *
 *   flags()                          → { on, bind }   on = the switch; bind = on && phoneBind (the writes need both)
 *   signJoin({ n, lang, mode })      → the j token {k:'j', n?, l, m?, exp} (1 h); a practice token carries no n
 *   joinUrl({ n, lang, mode })       → '/quiz/join/<j>' | null (the switch off, no nonce outside practice)
 *   gradeTap({ t, grade, device })   → { ok, prefetch[] } | { off } | { stale }   the grade chip: join_grade, the home's warm list
 *   join({ t, grade, name, device, same, force })   the ONE write (below) → { next } | { ask } | { refused, next? } | { stale } | { off }
 *   practiceJoinUrl({ uid, lang })   the coach's "Try it as a student": a practice j token (no nonce) → its URL
 *   pageInfo({ t })                  the join page's shell answer (the switch, the token): { lang, practice } | { stale } | { off }
 *   autoBind({ n })                  the `/quiz` landing of a phone with children but no binding: never
 *                                    a silent bind — the confirm sheet's chips ("Is it <First>?" + the notice)
 *   bindPick({ n, chip })            the sheet's "Yes, it's me" → the binding (via 'guest'), home with from=bind
 *   noteRecognised({ phoneNorm })    join_recognised: a self-joined child's phone is known again (once a PKT day)
 *
 * THE WRITE (one request; each step guards the next, and a failure after the row undoes the row):
 *   1. a `students` row in the `/q/` forced_new shape {student_name, self_reported_class:'Grade n', list_id NULL,
 *      phone NULL, enrolled_by_user_id NULL} — NO new id_src: its runs are forced_new / low until a teacher links it
 *   2. child_identity(fixed_grade n, grade_source 'tapped', year_code)            (web-quiz-challenge-draw)
 *   3. child_phone_bindings via 'guest' through the binder (its refusals, its forget, bind_bound{via:'guest'})
 *   4. the door's child key `quiz_door_child` (first-touch/door.keys.js; it forgets the verdict too)
 * Before step 1: the token, its device, the nonce, a teacher's phone (refused, practice offered), the same first name
 * already on this phone ("Is this you?", never a twin row), and > 4 children on the phone (refused with a line).
 *
 * Practice (`mode:'practice'`, the coach's "Try it as a student"): the grade only (no name), no row, no binding, no key,
 * no nonce. A family phone on a teacher's class list (`students.parent_phone`) is offered its own roster
 * children (first names, ≤ 4, one school) on the same sheet; the tap writes ONE binding and nothing on `students`.
 * Events carry ids only (kid from the event-key module): join_grade, join_done, join_refused, join_recognised, bind_confirm.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');
const K = require('./web-quiz-kid');
const IdFlags = require('./web-quiz-identity-flags');
const BindRepo = require('./child-phone-bindings.repo');
const Homonym = require('./web-quiz-homonym');
const GoNonce = require('../first-touch/go-nonce');

const SWITCH_KEY = 'quiz_student_join';
const TTL_MS = 30 * 1000;
const JOIN_TTL_S = 60 * 60;
const GRADES = Object.freeze([1, 2, 3, 4, 5]);
const MAX_KIDS = T.HUB_MAX_KIDS;
const JOIN_PATH = '/quiz/join/';
// The child home with no child row (practice): the /quiz/home shell, told the grade and that nothing is saved.
const PRACTICE_HOME = '/quiz/home';
// What the home's first paint needs, warmed on the grade tap (long-cached assets; a prefetch costs nothing if unused).
const HOME_ASSETS = Object.freeze(['/wq/hub.js', '/wq/wq.css', '/wq/hub-play.js', '/wq/wq-tel.js']);
const DEV_PREFIX = 'ft:join:dev:';
const REC_PREFIX = 'ft:join:rec:';
const NAME_MAX = 20;
// Letters of any script, spaces, an apostrophe or a hyphen: never a digit (no phone number can be typed as a name).
const NAME_RX = /^[\p{L}\p{M}' -]+$/u;

let cache = null;

function isTrue(v) { return IdFlags.isTrue(v); }

/** → { on, bind }; all false on a failed read. Never throws. */
async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', SWITCH_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const on = isTrue(((data || [])[0] || {}).value);
    const bind = on && Boolean((await IdFlags.flags()).phoneBind);
    cache = { at: now, on, bind };
    return cache;
  } catch (err) {
    logToFile('⚠️ student join: settings lookup failed — switch off', { error: err.message });
    return { on: false, bind: false };
  }
}

const langOf = (l) => (l === 'ur' ? 'ur' : 'en');
const nowS = () => Math.floor(Date.now() / 1000);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 32);

function redisStore() {
  try {
    const redis = require('../cache/railway-redis.service');
    return redis && typeof redis.isAvailable === 'function' && redis.isAvailable() ? redis : null;
  } catch (_) {
    return null;
  }
}

/** The j token: the landing's nonce (none in practice), the page language, practice or not, one hour. */
function signJoin({ n = null, lang = 'en', mode = null } = {}) {
  const practice = mode === 'practice';
  if (!practice && (typeof n !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(n))) return null;
  return T.sign({ k: 'j', ...(practice ? { m: 'practice' } : { n }), l: langOf(lang), exp: nowS() + JOIN_TTL_S });
}

/**
 * '/quiz/join/<j>' for the landing's 302 and the role page's {next}; null with no token, or when the switch was last
 * read OFF. Synchronous (the landing builds its redirect without waiting): it answers from the switch's 30-s cache and
 * refreshes that cache in the background; before the first read it builds the link, and the page itself asks the
 * switch again before it draws anything (off → the portal's own page).
 */
function joinUrl({ n, lang, mode } = {}) {
  if (!cache || Date.now() - cache.at >= TTL_MS) flags().catch(() => {});
  if (cache && !cache.on) return null;
  const t = signJoin({ n, lang, mode });
  return t ? `${JOIN_PATH}${t}` : null;
}

/** The coach's "Try it as a student" (the teacher home's foot): a practice join, nothing written. Synchronous, as joinUrl. */
function practiceJoinUrl({ lang } = {}) {
  return joinUrl({ lang, mode: 'practice' });
}

/** The first device to use a j token keeps it (SET NX, read back). Practice needs no device. */
async function deviceHolds(t, device) {
  const d = T.cleanDeviceRef(device);
  const redis = redisStore();
  if (!d || !redis) return false;
  const key = DEV_PREFIX + sha(t);
  try {
    await redis.setNX(key, d, JOIN_TTL_S);
    return (await redis.get(key)) === d;
  } catch (_) {
    return false;
  }
}

/** The token as the page holds it → { tok, practice } | null. */
function readToken(t) {
  const tok = T.verify(t, 'j');
  if (!tok) return null;
  return { tok, practice: tok.m === 'practice' };
}

function cleanGrade(g) {
  const n = Number(g);
  return GRADES.includes(n) ? n : null;
}

/** A first name as the child typed it: trimmed, inner spaces folded, ≤ 2 words, ≤ 20 characters, letters only. */
function cleanFirstName(raw) {
  const s = String(raw || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s || s.length > NAME_MAX || !NAME_RX.test(s)) return null;
  const words = s.split(' ');
  return words.length <= 2 ? s : null;
}

/** Is this phone a teacher's (identity or activity, as the door reads it)? true when unsure. */
async function teacherPhone(userId) {
  try {
    const Ingress = require('../student-ingress');
    const { data, error } = await supabase.from('users')
      .select('id, registration_completed, registration_state, name, teacher_uuid, school_id, portal_activated, role')
      .eq('id', userId).maybeSingle();
    if (error || !data) return true;
    if (Ingress.identity(data)) return true;
    return (await Ingress.activity(userId)) !== false;
  } catch (_) {
    return true;
  }
}

const hubKid = (id) => T.chipId('h', id);

/** The child's home: the hub of this phone's children, opened on `id`, marked with the route that brought them. */
function homeUrl(kids, id, src, lang) {
  const ids = [String(id), ...kids.map((k) => String(k.id)).filter((x) => x !== String(id))];
  const token = T.signHub(ids, `student_join_${src}`);
  if (!token) return null;
  const q = new URLSearchParams();
  q.set('from', src);
  if (id) q.set('kid', hubKid(id));
  q.set('lang', langOf(lang));
  return `/h/${token}?${q}`;
}

function practiceHome(grade, lang) {
  return `${PRACTICE_HOME}?m=practice&g=${grade}&lang=${langOf(lang)}`;
}

const emit = (name, fields, canonicalId = null, device = null) => K.emit(`web_quiz.${name}`, fields, { canonicalId, device });

/** The join page's shell (no database read but the cached switch): the language and the mode the screen is drawn in. */
async function pageInfo({ t } = {}) {
  if (!(await flags()).on) return { off: true };
  const r = readToken(t);
  if (!r) {
    const old = T.verify(t, 'j', { allowExpired: true });
    return { stale: true, lang: old ? langOf(old.l) : null };
  }
  return { ok: true, lang: langOf(r.tok.l), practice: r.practice };
}

/** The grade chip: the join_grade line and the home's warm list (fired before the name is typed). */
async function gradeTap({ t, grade, device } = {}) {
  const f = await flags();
  if (!f.on) return { off: true };
  const r = readToken(t);
  if (!r) return { stale: true };
  const g = cleanGrade(grade);
  if (!g) return { error: 'bad_request' };
  if (!r.practice && !(await deviceHolds(t, device))) return { stale: true, why: 'other_device' };
  await emit('join_grade', { grade: g, ...(r.practice ? { mode: 'practice' } : {}) }, null, device);
  return { ok: true, prefetch: [...HOME_ASSETS] };
}

/** The phone's children as the binder counts them (bound ∪ chat, canonical). */
const phoneSet = (phoneNorm) => BindRepo.childrenForPhone(phoneNorm);

/** The children on this phone whose first name folds to the typed one. */
function sameNamed(set, name) {
  const want = Homonym.canonFirst(name);
  return want ? set.filter((k) => Homonym.canonFirst(k.student_name) === want) : [];
}

/** Undo a row whose binding failed: the row leaves every list (no delete: an audit trail of the attempt stays). */
async function retire(id) {
  try {
    await supabase.from('students').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id).is('list_id', null);
  } catch (err) {
    logToFile('⚠️ student join: row not retired after a failed bind', { error: err.message });
  }
}

async function bindChild(phoneNorm, id) {
  return require('./web-quiz-bind.service').bindOnPhone({ phone: phoneNorm, canonicalId: id, via: 'guest', mode: 'student' });
}

/**
 * The ONE write. `same` (a chip from an "Is this you?") picks that child; `force` makes a new child although the
 * name is on the phone already. Never throws.
 */
async function join({ t, grade, name, device, same = null, force = false } = {}) {
  try {
    const f = await flags();
    if (!f.on) return { off: true };
    const r = readToken(t);
    if (!r) return { stale: true };
    const lang = langOf(r.tok.l);
    const g = cleanGrade(grade);
    if (!g) return { error: 'bad_request', why: 'grade' };
    if (r.practice) {
      await emit('join_done', { grade: g, mode: 'practice', kids_n: 0 }, null, device);
      return { next: practiceHome(g, lang), practice: true };
    }
    const first = cleanFirstName(name);
    if (!first) return { error: 'bad_request', why: 'name' };
    if (!f.bind) return { off: true };
    if (!(await deviceHolds(t, device))) return { stale: true, why: 'other_device' };
    const who = await GoNonce.peek(r.tok.n);
    if (!who) return { stale: true };
    if (await teacherPhone(who.userId)) {
      await emit('join_refused', { reason: 'teacher_phone' }, null, device);
      return { refused: 'teacher_phone', next: practiceHome(g, lang) };
    }

    const set = await phoneSet(who.phoneNorm);
    // "Is this you?" → yes: that child, bound on this phone (a chat child gains its binding; a bound one renews).
    if (same) {
      const kid = set.find((k) => T.chipId('j', k.id) === String(same));
      if (!kid) return { error: 'bad_request', why: 'same' };
      const b = await bindChild(who.phoneNorm, String(kid.id));
      if (!b || !b.ok) return b && b.outcome === 'refused' ? { refused: b.reason, next: homeUrl(set, set[0] && set[0].id, 'join', lang) } : { error: 'unavailable' };
      await emit('join_done', { grade: g, kids_n: set.length, again: true }, String(kid.id), device);
      return { next: homeUrl(set, kid.id, 'join', lang) };
    }
    const twins = sameNamed(set, first);
    if (twins.length && !force) {
      const guarded = Homonym.guard(twins.map((k) => ({ id: String(k.id), first: String(k.student_name || '').split(/\s+/)[0], avatar: T.animalFor(k.id) })), { surface: 'who' });
      return { ask: 'is_this_you', kids: guarded.map((c) => ({ chip: T.chipId('j', c.id), first: c.first, animal: c.avatar })) };
    }
    if (set.length >= MAX_KIDS) {
      await emit('join_refused', { reason: 'max_kids', kids_n: set.length }, null, device);
      return { refused: 'max_kids', next: homeUrl(set, null, 'join', lang) };
    }
    // single use from here: a second "Let's go" on the same link (a double tap, a back-and-again) makes no second child
    if (!(await GoNonce.claim(r.tok.n, 'join'))) {
      const again = sameNamed(set, first)[0];
      return again ? { next: homeUrl(set, again.id, 'join', lang) } : { stale: true, why: 'used' };
    }

    const { data: row, error } = await supabase.from('students').insert({
      student_name: first, self_reported_class: `Grade ${g}`, enrolled_by_user_id: null, phone: null, list_id: null,
    }).select('id, student_name, self_reported_class').single();
    if (error || !row) {
      logToFile('❌ student join: could not create the child', { error: error && error.message }, 'error');
      return { error: 'unavailable' };
    }
    const id = String(row.id);
    await require('./web-quiz-challenge-draw').writeChildIdentity({ canonicalId: id, grade: g, gradeSource: 'self' });
    const b = await bindChild(who.phoneNorm, id);
    if (!b || !b.ok) {
      await retire(id);
      if (b && b.outcome === 'refused') return { refused: b.reason, next: set.length ? homeUrl(set, null, 'join', lang) : null };
      return { error: 'unavailable' };
    }
    try {
      await require('../first-touch/door.keys').markChild(who.userId, who.phoneNorm);
    } catch (err) {
      logToFile('⚠️ student join: the door key was not written (the binding answers the next /quiz)', { error: err.message });
    }
    const kids = [{ id }, ...set];
    await emit('join_done', { grade: g, kids_n: kids.length }, id, device);
    return { next: homeUrl(kids, id, 'join', lang) };
  } catch (err) {
    logToFile('⚠️ student join: the join threw (nothing promised)', { error: err.message });
    return { error: 'unavailable' };
  }
}

/** The confirm sheet's chips: first names through the homonym guard, never a stranger, never a surname. */
function pickChips(set) {
  const guarded = Homonym.guard(set.map((k) => ({ id: String(k.id), first: String(k.student_name || '').split(/\s+/)[0], avatar: T.animalFor(k.id) })), { surface: 'who' });
  return guarded.map((c) => ({ chip: T.chipId('go', c.id), first: c.first, animal: c.avatar, ...(c.line2 ? { line2: c.line2 } : {}) }));
}

/**
 * The roster children whose family phone (students.parent_phone, as the teacher typed it) is this phone —
 * only when they are 1–4 children of ONE school (a wrong number on a roster then exposes one first name at most,
 * never a class). [] otherwise, and on any read error.
 */
async function rosterForPhone(phoneNorm) {
  try {
    const local = `0${String(phoneNorm).slice(2)}`;
    const { data, error } = await supabase.from('students').select('id, student_name, school_id, list_id, status, merged_into, is_active')
      .in('parent_phone', [`+${phoneNorm}`, String(phoneNorm), local]).limit(MAX_KIDS + 1);
    if (error) return [];
    const kids = (data || []).filter((k) => k.list_id && k.is_active !== false && k.status !== 'merged' && !k.merged_into);
    const schools = new Set(kids.map((k) => k.school_id || null));
    if (!kids.length || kids.length > MAX_KIDS || schools.size !== 1) return [];
    return kids;
  } catch (_) {
    return [];
  }
}

/** Who the sheet may offer on this phone: its own children (bound ∪ chat), else its roster children. */
async function offerFor(phoneNorm) {
  const set = await phoneSet(phoneNorm);
  if (set.length) return { set, kids: set, src: 'quiz' };
  return { set, kids: await rosterForPhone(phoneNorm), src: 'roster' };
}

/**
 * A `/quiz` landing for a phone the resolver called `child`. Never a silent bind (IDENTITY §8): every
 * child already bound → home (from=quiz, no toast); a child not yet bound → the confirm sheet's chips ("Is it
 * <First>?" + the three notice sentences + "Yes, it's me"; the landing draws it); none at all → the join screen;
 * a roster number that is not one family (two schools, > 4) → { none } (the role question).
 * → { next } | { confirm: { src, kids } } | { join } | { none } | { off } | { stale }. Writes nothing. Never throws.
 */
async function autoBind({ n, lang = 'en' } = {}) {
  try {
    const f = await flags();
    if (!f.bind) return { off: true };
    const who = await GoNonce.peek(n);
    if (!who) return { stale: true };
    const { set, kids, src } = await offerFor(who.phoneNorm);
    if (set.length) {
      const bound = await BindRepo.activeForPhone(who.phoneNorm);
      if (set.every((k) => bound.some((b) => String(b.canonical_id) === String(k.id)))) return { next: homeUrl(set, set.length === 1 ? set[0].id : null, 'quiz', lang) };
    }
    if (!kids.length) {
      // a roster number with no family match → the role question; a phone with nothing at all → the join screen
      return src === 'roster' && (await rosterHits(who.phoneNorm)) ? { none: true } : { join: await joinUrl({ n, lang }) };
    }
    return { confirm: { src, kids: pickChips(kids) } };
  } catch (err) {
    logToFile('⚠️ student join: the landing offer threw', { error: err.message });
    return { error: 'unavailable' };
  }
}

/** Does any roster row carry this phone at all (for "not one family" vs "nobody")? */
async function rosterHits(phoneNorm) {
  try {
    const local = `0${String(phoneNorm).slice(2)}`;
    const { data, error } = await supabase.from('students').select('id').in('parent_phone', [`+${phoneNorm}`, String(phoneNorm), local]).limit(1);
    return !error && (data || []).length > 0;
  } catch (_) {
    return false;
  }
}

/** Did this device play as this child on a quiz page (the landing's "Is it <First>?" for a child known on this device)? */
async function playedHere(studentId, device) {
  const d = T.cleanDeviceRef(device);
  if (!d || !studentId) return null;
  try {
    const { data, error } = await supabase.from('quiz_sessions').select('student_id').eq('student_id', String(studentId)).eq('device_ref', d).limit(1);
    if (error || !(data || []).length) return null;
    const { data: row } = await supabase.from('students').select('id, student_name, is_active, status').eq('id', String(studentId)).maybeSingle();
    return row && row.is_active !== false && (row.status || 'active') === 'active' ? row : null;
  } catch (_) {
    return null;
  }
}

/**
 * The sheet's "Yes, it's me" → that child's binding on this phone (via 'guest'), home with from=bind. The child is
 * named by the sheet's `chip`, or by the landing's `kid` (a student id the landing already matched); either way it
 * must be one of THIS phone's children (bound, chat, or its class-list family), or — `src:'device'` — a child who
 * played on this very device. A stranger is refused.
 */
async function bindPick({ n, chip = null, kid: kidId = null, src: askedSrc = null, device = null, lang = 'en' } = {}) {
  try {
    const f = await flags();
    if (!f.bind) return { off: true };
    const who = await GoNonce.peek(n);
    if (!who) return { stale: true };
    const offer = await offerFor(who.phoneNorm);
    const { set, kids } = offer;
    let src = offer.src;
    let kid = kids.find((k) => (chip && T.chipId('go', k.id) === String(chip)) || (kidId && String(k.id) === String(kidId))) || null;
    if (!kid && kidId && askedSrc === 'device') {
      kid = await playedHere(kidId, device);
      if (kid) src = 'device';
    }
    if (!kid) return { refused: 'child_unknown' };
    const home = [kid, ...set.filter((k) => String(k.id) !== String(kid.id))];
    // already saved on this phone: home with no write and no "saved" line
    if ((await BindRepo.activeForPhone(who.phoneNorm)).some((b) => String(b.canonical_id) === String(kid.id))) return { next: homeUrl(home, kid.id, 'quiz', lang) };
    if (await teacherPhone(who.userId)) return { refused: 'teacher_phone', next: homeUrl(home, kid.id, 'quiz', lang) };
    const b = await bindChild(who.phoneNorm, String(kid.id));
    if (!b || !b.ok) return { refused: (b && b.reason) || 'unavailable', next: set.length ? homeUrl(set, set[0].id, 'quiz', lang) : null };
    await emit('bind_confirm', { src }, String(kid.id));
    return { next: homeUrl(home, kid.id, 'bind', lang) };
  } catch (err) {
    logToFile('⚠️ student join: bind pick threw', { error: err.message });
    return { error: 'unavailable' };
  }
}

/**
 * The hub's "keep my place" card for a chosen child whose place is already saved on a family phone with no code
 * (an active binding via 'guest'): `out.bind` becomes { offer:false, state:'bound' } — the claim never shows on an
 * old or new link for that child. Switch off, no such binding, or a failed read: `out` untouched. Never throws.
 */
async function hideCardIfBound(out, studentId) {
  try {
    if (!out || !studentId || !(await flags()).bind) return out;
    const canon = await require('./web-quiz-identity-roster').canonicalStudentIds([String(studentId)]);
    const id = canon.get(String(studentId)) || String(studentId);
    const rows = await BindRepo.activeForChild(id);
    if (rows.some((b) => b.via === 'guest')) out.bind = { offer: false, state: 'bound' };
    return out;
  } catch (_) {
    return out;
  }
}

/** join_recognised: this phone holds a child that joined on its own, and `/quiz` found it again. Once a PKT day. */
async function noteRecognised({ phoneNorm } = {}) {
  try {
    if (!(await flags()).bind || !phoneNorm) return false;
    const guest = (await BindRepo.activeForPhone(phoneNorm)).find((b) => b.via === 'guest');
    if (!guest) return false;
    const redis = redisStore();
    if (redis) {
      const day = K.pktDay ? K.pktDay() : new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10);
      const key = `${REC_PREFIX}${sha(phoneNorm)}:${day}`;
      if (!(await redis.setNX(key, '1', 26 * 3600))) return false;
    }
    await emit('join_recognised', {}, String(guest.canonical_id));
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  SWITCH_KEY, JOIN_PATH, PRACTICE_HOME, HOME_ASSETS, GRADES,
  flags, signJoin, joinUrl, practiceJoinUrl, pageInfo, gradeTap, join, autoBind, bindPick, noteRecognised, hideCardIfBound,
  cleanFirstName, cleanGrade, pickChips, rosterForPhone,
  _resetCache: () => { cache = null; },
};
