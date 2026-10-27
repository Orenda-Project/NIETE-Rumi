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
 *   practiceJoinUrl({ uid, lang, back })  the coach's "Try it as a student": a practice j token (no nonce) → its URL
 *   siblingJoinToken({ phoneNorm, userId?, lang })  "Someone new?" on a phone's child home: a fresh join token, minted
 *                                    by the home at render (never carried in a URL)
 *   pageInfo({ t })                  the join page's shell answer (the switch, the token): { lang, practice } | { stale } | { off }
 *   autoBind({ n })                  the `/quiz` landing of a phone with children but no binding: never
 *                                    a silent bind — the confirm sheet's chips ("Is it <First>?" + the notice)
 *   bindPick({ n, chip | kid, src, device, quizDevice, lang })  the sheet's "Yes, it's me" → the binding (via
 *                                    'guest'), home with from=bind
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
 * join_refused reasons: teacher_phone, max_kids, and bind_off (the join switch on, web_quiz_phone_bind off: join() and
 * bindPick() answer {off:true} at the write; autoBind(), a read on every landing, is not a refusal and logs nothing).
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');
const K = require('./web-quiz-kid');
const IdFlags = require('./web-quiz-identity-flags');
const HubFlags = require('./web-quiz-hub-flags');
const BindRepo = require('./child-phone-bindings.repo');
const Homonym = require('./web-quiz-homonym');
const GoNonce = require('../first-touch/go-nonce');
const CardSwitch = require('./web-quiz-card-switch');
const { clampLanguage } = require('../../config/ux-strings');
const Adv = require('../first-touch/adventure-look');

const SWITCH_KEY = 'quiz_student_join';
// The join page keeps a grade tap made before its script has loaded (the page draws it; join.js replays it). Read only
// while the join switch is on; OFF (or a failed read) → the page is today's, byte for byte.
const EARLY_TAP_KEY = 'quiz_join_early_tap';
// The join's last step, fast: the switches are ONE app_settings read (the identity and hub flags filled from it), the
// guards' reads start together, the binder's reads start together; the writes keep their order (the row, its identity,
// the binding, the door key, the remember line) and the answer is the same bytes. JSON true only; OFF → today's reads.
const FAST_KEY = 'quiz_join_fast';
// The go button says "Getting your games ready…" while the join runs (the page draws it; join.js shows it). Read in the
// join's own switch read (no read of its own); JSON true only, and only with the join switch on.
const WAIT_WORD_KEY = 'quiz_join_wait_word';
// One Urdu face on the join page too (the child pages' face). Read in the join's own switch read (no read of its own); JSON
// true only, and only with the join switch on; the page shell answer then says `one_face: true`.
const ONE_FACE_KEY = 'web_quiz_one_face';
// The child's language switch (web-quiz-return-lang.js KEY): the join reads it once the child row is written.
const RETURN_LANG_KEY = 'web_quiz_return_lang';
// The one read asks for every key the join's flags need, so ON fills the identity, hub and child-language caches from it.
// The one share (web_quiz_card_v3 + web_quiz_share_v4, both JSON true) rides the same read through HubFlags.KEYS: off,
// a join asks nothing more. The adventure look's two keys (Adv.KEYS) ride it too; the Set drops any duplicate key.
const flagKeys = () => [...new Set([SWITCH_KEY, EARLY_TAP_KEY, FAST_KEY, WAIT_WORD_KEY, ONE_FACE_KEY, ...(IdFlags.KEYS || []), ...(HubFlags.KEYS || []), ...Adv.KEYS, RETURN_LANG_KEY])];
const TTL_MS = 30 * 1000;
const JOIN_TTL_S = 60 * 60;
const GRADES = Object.freeze([1, 2, 3, 4, 5]);
const MAX_KIDS = T.HUB_MAX_KIDS;
const JOIN_PATH = '/quiz/join/';
// The child home with no child row (practice): a hub token with no child, the grade and "practice" — the home draws the
// class's view for that grade and writes nothing. `bk` (optional) is the teacher home the coach came from.
const PRACTICE_HOME = '/h/';
const BACK_RX = /^\/quiz\/teacher\/[A-Za-z0-9._~-]{1,600}$/;
// What the home's first paint needs, warmed on the grade tap (long-cached assets; a prefetch costs nothing if unused).
const HOME_ASSETS = Object.freeze(['/wq/hub.js', '/wq/wq.css', '/wq/hub-play.js', '/wq/wq-tel.js']);
const DEV_PREFIX = 'ft:join:dev:';
const REC_PREFIX = 'ft:join:rec:';
const NAME_MAX = 20;
// Letters of any script, spaces, an apostrophe or a hyphen: never a digit (no phone number can be typed as a name).
const NAME_RX = /^[\p{L}\p{M}' -]+$/u;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;
// The family-phone roster read: rows past this many on one number are a class's number, never a family's.
const ROSTER_SCAN = 40;

let cache = null;

function isTrue(v) { return IdFlags.isTrue(v); }

async function earlyTapOn() {
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').eq('key', EARLY_TAP_KEY);
    if (error) throw new Error(error.message || 'app_settings read failed');
    // JSON true only (a new key): the string 'true', 1, 'yes' or an object are all off
    return ((data || [])[0] || {}).value === true;
  } catch (err) {
    logToFile('⚠️ student join: early-tap setting lookup failed — off', { error: err.message });
    return false;
  }
}

/**
 * → { on, bind, earlyTap, fast?, waitWord?, share?, adv? }; all false on a failed read. Never throws. The adventure look
 * (web_quiz_adventure_look AND web_quiz_one_button, both JSON true only) rides the switch's own read: no read is added.
 */
async function flags(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache;
  try {
    const asked = flagKeys();
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', asked);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const by = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    const on = isTrue(by[SWITCH_KEY]);
    const wait = on && by[WAIT_WORD_KEY] === true ? { waitWord: true } : {};
    const face = on && by[ONE_FACE_KEY] === true ? { oneFace: true } : {};
    const share = on && by[CardSwitch.KEY] === true && by[CardSwitch.SHARE_KEY] === true ? { share: true } : {};
    const look = on && Adv.advDrawn(by) ? { adv: true } : {};
    if (on && by[FAST_KEY] === true) {
      // the identity and hub flags from these same rows (an expired cache only), so the line below reads nothing
      if (typeof IdFlags.prime === 'function') await IdFlags.prime(data, now, asked);
      require('./web-quiz-return-lang').prime(by[RETURN_LANG_KEY], now);
      const bind = Boolean((await IdFlags.flags()).phoneBind);
      cache = { at: now, on, bind, earlyTap: by[EARLY_TAP_KEY] === true, fast: true, ...wait, ...face, ...share, ...look };
      return cache;
    }
    const bind = on && Boolean((await IdFlags.flags()).phoneBind);
    const earlyTap = on && (await earlyTapOn());
    cache = { at: now, on, bind, earlyTap, ...wait, ...face, ...share, ...look };
    return cache;
  } catch (err) {
    logToFile('⚠️ student join: settings lookup failed — switch off', { error: err.message });
    return { on: false, bind: false, earlyTap: false, adv: false };
  }
}

const langOf = (l) => clampLanguage(l);
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

/** The bot's WhatsApp number (the share links' variables), for the one tap back on an expired page: {bot} | {}. */
function botField() {
  const n = String(process.env.WHATSAPP_BOT_NUMBER || process.env.REFERRAL_BOT_NUMBER || '').replace(/\D/g, '');
  return /^\d{10,15}$/.test(n) ? { bot: n } : {};
}

/** The j token: the landing's nonce (none in practice), the page language, practice or not, one hour. */
function signJoin({ n = null, lang = 'en', mode = null, back = null } = {}) {
  const practice = mode === 'practice';
  if (!practice && (typeof n !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(n))) return null;
  const bk = practice && typeof back === 'string' && BACK_RX.test(back) ? { bk: back } : {};
  return T.sign({ k: 'j', ...(practice ? { m: 'practice' } : { n }), l: langOf(lang), ...bk, exp: nowS() + JOIN_TTL_S });
}

/** The bot's user row for this phone (the sender of its `/quiz`), when the caller holds only the phone. */
async function userIdForPhone(phoneNorm) {
  try {
    const { data, error } = await supabase.from('users').select('id').in('phone_number', [String(phoneNorm), `+${phoneNorm}`]).limit(1);
    return !error && data && data[0] && data[0].id ? String(data[0].id) : null;
  } catch (_) {
    return null;
  }
}

/**
 * "Someone new?" on a phone's child home: a join link of its OWN (a fresh nonce for the same phone, so a brother's
 * join never meets the first child's single-use link). `userId` is optional: the home holds only the phone, and the
 * phone's own user row is read. → the j token (the home links /quiz/join/<it>) | null.
 */
async function siblingJoinToken({ phoneNorm, userId = null, lang = 'en' } = {}) {
  if (!(await flags()).bind || !phoneNorm) return null;
  const uid = userId || (await userIdForPhone(phoneNorm));
  if (!uid) return null;
  const n = await GoNonce.mint({ phoneNorm, userId: uid });
  return n ? signJoin({ n, lang }) : null;
}

/**
 * '/quiz/join/<j>' for the landing's 302 and the role page's {next}; null with no token, or when the switch was last
 * read OFF. Synchronous (the landing builds its redirect without waiting): it answers from the switch's 30-s cache and
 * refreshes that cache in the background; before the first read it builds the link, and the page itself asks the
 * switch again before it draws anything (off → the portal's own page).
 */
function joinUrl({ n, lang, mode, back } = {}) {
  if (!cache || Date.now() - cache.at >= TTL_MS) flags().catch(() => {});
  if (cache && !cache.on) return null;
  const t = signJoin({ n, lang, mode, back });
  return t ? `${JOIN_PATH}${t}` : null;
}

/** The coach's "Try it as a student" (the teacher home's foot): a practice join, nothing written. Synchronous, as joinUrl. */
function practiceJoinUrl({ lang, back = null } = {}) {
  return joinUrl({ lang, mode: 'practice', back });
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

/** A walk-through persona on a sandbox test phone ('fresh' = a new phone): the walk-persona module, when present. */
async function freshPersona(phoneNorm) {
  let M = null;
  try { M = require('../first-touch/walk-persona'); } catch (_) { return false; }
  try { const p = M && typeof M.get === 'function' ? await M.get(phoneNorm) : null; return Boolean(p && p.as === 'fresh'); } catch (_) { return false; }
}

/** Is this phone a teacher's (identity or activity, as the door reads it)? true when unsure. */
async function teacherPhone(userId, phoneNorm = null) {
  if (phoneNorm && (await freshPersona(phoneNorm))) return false;
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

/**
 * teacherPhone with every read started together (quiz_join_fast): the walk persona, the users row and the teacher
 * activity counts (Ingress.activityAll) side by side, weighed in teacherPhone's order — the same verdict.
 */
async function teacherPhoneTogether(userId, phoneNorm = null) {
  try {
    const Ingress = require('../student-ingress');
    const IngressIdentity = require('../student-ingress-identity');
    const user = supabase.from('users')
      .select('id, registration_completed, registration_state, name, teacher_uuid, school_id, portal_activated, role')
      .eq('id', userId).maybeSingle();
    const [fresh, { data, error }, act] = await Promise.all([
      phoneNorm ? freshPersona(phoneNorm) : false, user, IngressIdentity.activityAll(userId).catch(() => null),
    ]);
    if (fresh) return false;
    if (error || !data) return true;
    if (Ingress.identity(data)) return true;
    return act !== false;
  } catch (_) {
    return true;
  }
}

const hubKid = (id) => T.chipId('h', id);

/**
 * The child's home: the hub of this phone's children, opened on `id` (none: the home's own pick), marked with the
 * route that brought them. `lang` only when the caller knows it; without it the home keeps the family's own language.
 */
function homeUrl(kids, id, src, lang = null) {
  const ids = [...(id ? [String(id)] : []), ...kids.map((k) => String(k.id)).filter((x) => x !== String(id))];
  const token = T.signHub(ids, `student_join_${src}`);
  if (!token) return null;
  const q = new URLSearchParams();
  q.set('from', src);
  if (id) q.set('kid', hubKid(id));
  if (lang) q.set('lang', langOf(lang));
  return `/h/${token}?${q}`;
}

function practiceHome(grade, lang, back = null) {
  const bk = typeof back === 'string' && BACK_RX.test(back) ? { bk: back } : {};
  const t = T.sign({ k: 'h', ids: [], pr: 1, g: grade, lang: langOf(lang), ...bk, exp: nowS() + T.HUB_TTL_S });
  return t ? `${PRACTICE_HOME}${t}?from=join` : null;
}

const emit = (name, fields, canonicalId = null, device = null) => K.emit(`web_quiz.${name}`, fields, { canonicalId, device });

/**
 * The join page's shell (no database read but the cached switch): the language and the mode the screen is drawn in,
 * and the bot's number for the page's one tap back to WhatsApp when a link has expired.
 */
async function pageInfo({ t } = {}) {
  const f = await flags();
  if (!f.on) return { off: true };
  const r = readToken(t);
  if (!r) {
    const old = T.verify(t, 'j', { allowExpired: true });
    return { stale: true, lang: old ? langOf(old.l) : null, ...botField(), ...(f.adv ? { adv: true } : {}), ...(f.oneFace ? { one_face: true } : {}) };
  }
  return { ok: true, lang: langOf(r.tok.l), practice: r.practice, ...botField(), ...(f.earlyTap ? { earlyTap: true } : {}), ...(f.waitWord ? { waitWord: true } : {}), ...(f.adv ? { adv: true } : {}), ...(f.oneFace ? { one_face: true } : {}) };
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
    const { error } = await supabase.from('students').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id).is('list_id', null);
    if (error) throw new Error(error.message || 'update failed');
  } catch (err) {
    logToFile('❌ student join: row not retired after a failed bind (an active row with no phone)', { error: err.message }, 'error');
  }
}

async function bindChild(phoneNorm, id, fast = false, pre = null) {
  return require('./web-quiz-bind.service').bindOnPhone({ phone: phoneNorm, canonicalId: id, via: 'guest', mode: 'student', ...(fast ? { fast: true, pre } : {}) });
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
      return { next: practiceHome(g, lang, r.tok.bk), practice: true };
    }
    const first = cleanFirstName(name);
    if (!first) return { error: 'bad_request', why: 'name' };
    if (!f.bind) {
      // the join switch is on and its hard parent web_quiz_phone_bind is not: the child picked a grade and typed a name,
      // and is refused at the last step. Said in the logs (ids only), never silently.
      await emit('join_refused', { reason: 'bind_off' }, null, device);
      return { off: true };
    }
    let who;
    let set;
    if (f.fast) {
      // the device hold beside the nonce peek (a read); then the teacher check, the phone's children and the home's
      // switches (the remember line's, read now so it waits for nothing later) together; the same guards, in order
      const [holds, peeked] = await Promise.all([deviceHolds(t, device), GoNonce.peek(r.tok.n)]);
      if (!holds) return { stale: true, why: 'other_device' };
      who = peeked;
      if (!who) return { stale: true };
      const [teacher, kids] = await Promise.all([
        teacherPhoneTogether(who.userId, who.phoneNorm), BindRepo.childrenForPhone(who.phoneNorm, { together: true }),
        require('./web-quiz-home-flags').flags(),
      ]);
      if (teacher) {
        await emit('join_refused', { reason: 'teacher_phone' }, null, device);
        return { refused: 'teacher_phone', next: practiceHome(g, lang) };
      }
      set = kids;
    } else {
      if (!(await deviceHolds(t, device))) return { stale: true, why: 'other_device' };
      who = await GoNonce.peek(r.tok.n);
      if (!who) return { stale: true };
      if (await teacherPhone(who.userId, who.phoneNorm)) {
        await emit('join_refused', { reason: 'teacher_phone' }, null, device);
        return { refused: 'teacher_phone', next: practiceHome(g, lang) };
      }
      set = await phoneSet(who.phoneNorm);
    }
    // "Is this you?" → yes: that child, bound on this phone (a chat child gains its binding; a bound one renews).
    if (same) {
      const kid = set.find((k) => T.chipId('j', k.id) === String(same));
      if (!kid) return { error: 'bad_request', why: 'same' };
      const b = await bindChild(who.phoneNorm, String(kid.id), f.fast);
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
    // fast: the binder's reads (the new row, the phone's children, bindings and prior row) run while the identity is written
    const pre = f.fast ? require('./web-quiz-bind.service').prefetch({ phone: who.phoneNorm, canonicalId: id }) : null;
    await require('./web-quiz-challenge-draw').writeChildIdentity({ canonicalId: id, grade: g, gradeSource: 'self' });
    const b = await bindChild(who.phoneNorm, id, f.fast, pre);
    if (!b || !b.ok) {
      await retire(id);
      if (b && b.outcome === 'refused') return { refused: b.reason, next: set.length ? homeUrl(set, null, 'join', lang) : null };
      return { error: 'unavailable' };
    }
    // web_quiz_return_lang: the child keeps the language they joined in (child_language 'join'; off: nothing written)
    const Ret = require('./web-quiz-return-lang');
    if (Ret.linkLang(r.tok.l) && (await Ret.on())) await require('./child-language.repo').joined(id, r.tok.l);
    try {
      await require('../first-touch/door.keys').markChild(who.userId, who.phoneNorm);
    } catch (err) {
      logToFile('⚠️ student join: the door key was not written (the binding answers the next /quiz)', { error: err.message });
    }
    const kids = [{ id }, ...set];
    fresh(r.tok.n, id, set);
    await emit('join_done', { grade: g, kids_n: kids.length }, id, device);
    // the home this opens says once "Jugnu will remember you on this phone", with Undo (web_quiz_home_v3; off: nothing)
    await require('./web-quiz-home-remember').note({ device, bindingId: b.bindingId, canonicalId: id, userId: who.userId });
    // "Someone new?" (a brother or sister on the same phone) is the home's to draw: it mints their own link at render
    // (siblingJoinToken), so no join token ever rides this URL
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

/** 1 April 00:00 PKT that starts the school year `now` falls in (the landing's rung 3b rule, role.service.js). */
function schoolYearStart(now = new Date()) {
  const pkt = new Date(now.getTime() + PKT_OFFSET_MS);
  const y = pkt.getUTCMonth() >= 3 ? pkt.getUTCFullYear() : pkt.getUTCFullYear() - 1;
  return new Date(Date.UTC(y, 3, 1) - PKT_OFFSET_MS);
}

/**
 * The roster children whose family phone (students.parent_phone, as the teacher typed it) is this phone: active,
 * unmerged rows on an active class list made THIS school year — only when they are 1–4 children of ONE school (a
 * wrong number on a roster then exposes one first name at most, never a class). The row filters run in the query and
 * the count after the year's lists, so old or left rows never crowd out this year's child; a number on more rows than
 * a scan reads is a class's number, not a family's. [] otherwise, and on any read error.
 */
async function rosterForPhone(phoneNorm, now = new Date()) {
  try {
    const local = `0${String(phoneNorm).slice(2)}`;
    const { data, error } = await supabase.from('students').select('id, student_name, school_id, list_id')
      .in('parent_phone', [`+${phoneNorm}`, String(phoneNorm), local])
      .eq('is_active', true).eq('status', 'active').is('merged_into', null).not('list_id', 'is', null)
      .limit(ROSTER_SCAN);
    if (error || !(data || []).length || data.length >= ROSTER_SCAN) return [];
    const listIds = [...new Set(data.map((k) => String(k.list_id)))];
    const { data: lists, error: lerr } = await supabase.from('student_lists').select('id, is_active, created_at').in('id', listIds);
    if (lerr) return [];
    const since = schoolYearStart(now).getTime();
    const live = new Set((lists || []).filter((l) => l.is_active !== false && l.created_at && new Date(l.created_at).getTime() >= since).map((l) => String(l.id)));
    const kids = data.filter((k) => live.has(String(k.list_id)));
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
async function autoBind({ n, lang = null } = {}) {
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
      return src === 'roster' && (await rosterHits(who.phoneNorm)) ? { none: true } : { join: await joinUrl({ n, lang: lang || 'en' }) };
    }
    return { confirm: { src, kids: pickChips(kids) } };
  } catch (err) {
    logToFile('⚠️ student join: the landing offer threw', { error: err.message });
    return { error: 'unavailable' };
  }
}

/**
 * Does a roster row of THIS school year carry this phone at all (for "not one family" vs "nobody")? The same rows
 * rosterForPhone reads (active, unmerged, on an active list made since 1 April PKT): last year's roster, or a child
 * who left, says nothing about this phone today, so it never sends the phone to the role question.
 */
async function rosterHits(phoneNorm, now = new Date()) {
  try {
    const local = `0${String(phoneNorm).slice(2)}`;
    const { data, error } = await supabase.from('students').select('id, list_id')
      .in('parent_phone', [`+${phoneNorm}`, String(phoneNorm), local])
      .eq('is_active', true).eq('status', 'active').is('merged_into', null).not('list_id', 'is', null)
      .limit(ROSTER_SCAN);
    if (error || !(data || []).length) return false;
    const listIds = [...new Set(data.map((k) => String(k.list_id)))];
    const { data: lists, error: lerr } = await supabase.from('student_lists').select('id, is_active, created_at').in('id', listIds);
    if (lerr) return false;
    const since = schoolYearStart(now).getTime();
    return (lists || []).some((l) => l.is_active !== false && l.created_at && new Date(l.created_at).getTime() >= since);
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
 * played on this very device: `quizDevice` is the quiz page's own device (its local wq_d; the /q/ page keeps no
 * cookie), else `device` (this browser's cookie). A stranger is refused. `lang` only when the landing knows it.
 */
async function bindPick({ n, chip = null, kid: kidId = null, src: askedSrc = null, device = null, quizDevice = null, lang = null } = {}) {
  try {
    const f = await flags();
    if (!f.bind) {
      // the join on and the bind off: the family's "Yes, it's me" is refused; said in the logs, as join()'s is
      if (f.on) await emit('join_refused', { reason: 'bind_off', step: 'bind_pick' }, null, device || quizDevice);
      return { off: true };
    }
    const who = await GoNonce.peek(n);
    if (!who) return { stale: true };
    const offer = await offerFor(who.phoneNorm);
    const { set, kids } = offer;
    let src = offer.src;
    let kid = kids.find((k) => (chip && T.chipId('go', k.id) === String(chip)) || (kidId && String(k.id) === String(kidId))) || null;
    if (!kid && kidId && askedSrc === 'device') {
      kid = await playedHere(kidId, quizDevice || device);
      if (kid) src = 'device';
    }
    if (!kid) return { refused: 'child_unknown' };
    const home = [kid, ...set.filter((k) => String(k.id) !== String(kid.id))];
    // already saved on this phone: home with no write and no "saved" line
    if ((await BindRepo.activeForPhone(who.phoneNorm)).some((b) => String(b.canonical_id) === String(kid.id))) return { next: homeUrl(home, kid.id, 'quiz', lang) };
    if (await teacherPhone(who.userId, who.phoneNorm)) return { refused: 'teacher_phone', next: homeUrl(home, kid.id, 'quiz', lang) };
    const b = await bindChild(who.phoneNorm, String(kid.id));
    if (!b || !b.ok) return { refused: (b && b.reason) || 'unavailable', next: set.length ? homeUrl(set, set[0].id, 'quiz', lang) : null };
    await emit('bind_confirm', { src }, String(kid.id));
    if (!b.renewed) await require('./web-quiz-home-remember').note({ device, bindingId: b.bindingId, canonicalId: String(kid.id), userId: who.userId });
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
async function hideCardIfBound(out, studentId, pre = null) {
  try {
    if (!out || !studentId) return out;
    // pre (web_quiz_hub_waves2): boundRowsOf's answer, read beside the hub's other reads; null = off or a failed read
    const rows = pre ? await pre : await (async () => {
      if (!(await flags()).bind) return null;
      const canon = await require('./web-quiz-identity-roster').canonicalStudentIds([String(studentId)]);
      return BindRepo.activeForChild(canon.get(String(studentId)) || String(studentId));
    })();
    if (!rows) return out;
    if (rows.some((b) => b.via === 'guest')) out.bind = { offer: false, state: 'bound' };
    return out;
  } catch (_) {
    return out;
  }
}

/**
 * hideCardIfBound's reads started early (web_quiz_hub_waves2): the child's active phone bindings under their canonical
 * id (the hub visit's shared lookup), or null when the switch is off or a read fails. Never rejects.
 */
async function boundRowsOf(studentId) {
  try {
    if (!studentId || !(await flags()).bind) return null;
    const canon = await require('./web-quiz-identity-roster').canonicalStudentIdsShared([String(studentId)]);
    return await BindRepo.activeForChild(canon.get(String(studentId)) || String(studentId));
  } catch (_) {
    return null;
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

// The NEW child a join just made, by its link's nonce (in this process, read once by opening() below): a shared card's
// sharer gains a friend only for a new child (web_quiz_share_joined), never for a child the phone already had.
const FRESH = new Map();
function fresh(n, id, set) {
  if (FRESH.size > 500) FRESH.clear();
  FRESH.set(String(n), { id: String(id), set: (set || []).map((k) => String(k.id)) });
}

// A shared card's item kept for this phone (web_quiz_share_v4, web-quiz-share-open.js): the home link a join, a
// landing or a pick answers with opens on it. The nonce names the phone; nothing kept, or the switch off: today's link.
function opening(fn, nonceOf) {
  return async (args = {}) => {
    const out = await fn(args);
    const n = nonceOf(args);
    const made = n ? FRESH.get(String(n)) : null;
    if (made) FRESH.delete(String(n));
    // the switch from the join's own read (its cache, warm from this join): off, nothing more is asked
    if (!out || typeof out.next !== 'string' || !(cache && cache.share === true)) return out;
    try {
      const who = n ? await GoNonce.peek(n) : null;
      if (who && who.phoneNorm) out.next = await require('./web-quiz-share-open').withOpen(who.phoneNorm, out.next, made ? { fresh: made } : null);
    } catch (err) {
      logToFile('⚠️ student join: the shared item was not added (the home opens as today)', { error: err.message });
    }
    return out;
  };
}
const joinOpen = opening(join, (a) => { const r = readToken(a.t); return r && r.tok ? r.tok.n : null; });
const autoBindOpen = opening(autoBind, (a) => a.n);
const bindPickOpen = opening(bindPick, (a) => a.n);

module.exports = {
  SWITCH_KEY, EARLY_TAP_KEY, FAST_KEY, WAIT_WORD_KEY, JOIN_PATH, PRACTICE_HOME, HOME_ASSETS, GRADES,
  flags, signJoin, joinUrl, practiceJoinUrl, siblingJoinToken, pageInfo, gradeTap, join: joinOpen, autoBind: autoBindOpen, bindPick: bindPickOpen, noteRecognised, hideCardIfBound, boundRowsOf,
  cleanFirstName, cleanGrade, pickChips, rosterForPhone, schoolYearStart,
  _resetCache: () => { cache = null; },
};
