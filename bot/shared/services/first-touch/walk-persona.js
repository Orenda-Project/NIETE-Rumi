'use strict';
/**
 * THE WALK-THROUGH (switch quiz_test_personas; sandbox only) — one listed test phone walks every person the one door
 * knows, with no database edit by hand: "Start as a new phone", "A teacher with no lessons yet", "Back to my real self".
 *
 * Who may: the switch ON (absent / false / garbage / a failed read → OFF; production and staging → OFF whatever the
 * switch says) AND the phone's user id on the fixture rule's test-teacher list (app_settings web_quiz_fixture_rule
 * .teachers, read by web-quiz-fixture fixtureConfig — data, never code). Anyone else: no row, and the POST is 404.
 *
 * State, Redis, keyed by sha256(phone_norm)[:32] (never the phone):
 *   wq:persona:<h>       { as: 'fresh'|'teacher_empty', since, walk }, 24 h from its last use (a phone that keeps
 *                        walking keeps its persona; "Back to my real self" or a day of silence ends it)
 *   wq:persona:kept:<h>  { walk, kept: [{ id, via }] } (ids only), 7 days — written by the first "Start as a new
 *                        phone" of a walk BEFORE it erases anything: when the walk began and whose links it erased
 * "Back to my real self" erases only the links bound since `walk` and re-binds the kept children, so the row is left
 * as it was. If the persona ran out first, the next read of this phone (a /quiz) does the same restore once. No table
 * is written by the persona itself.
 *
 *   flagOn()                  the switch, 30 s cache, never on production / staging
 *   allowed(userId)           flagOn() and the id is on the list (30 s cache)
 *   get(phone)                → { as, since, walk } | null — null whenever the switch is OFF, so every hook is one line
 *   set(phone, as, extra) / clear(phone)
 *   forHome(phone, lists)     the teacher home's lists, emptied for 'teacher_empty' (the same object otherwise)
 *   row({ lang, token })      → the row's HTML for the one question page ('' unless the token's user is listed);
 *                             its buttons carry data-persona, which the page's own script POSTs and then follows
 *   mount(router)             POST /persona {t, as} on the landing router (/api/internal/go; the edge forwards
 *                             /api/go/persona). The phone and user come from the token's server-side nonce only.
 *   handle({ as, phoneNorm, userId, lang })  the POST's work: fresh = this phone's links erased (the STOP eraser, no
 *                             reply) + the cached verdict forgotten; teacher_empty = the home's lists hidden; real = the
 *                             persona cleared, the links the walk itself made erased, the erased ones put back.
 *                             → { done: true, as, next } (next = a new landing: the one question for fresh, else the
 *                             person's home) | { error }
 *
 * The resolver (role.service: a fresh phone skips the teacher signs and the chat / roster rows and counts only the
 * door answers given since `since`; teacher_empty answers teacher), the question page and the landing router find
 * this module by name (optional-modules.js); the code binder and the join page ask get() directly.
 *
 * Nothing here logs, stores in a key or renders a phone or a user id. 0 WhatsApp messages.
 */
const crypto = require('crypto');
const supabase = require('../../config/supabase');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const SWITCH_KEY = 'quiz_test_personas';
const ASES = Object.freeze(['fresh', 'teacher_empty']);
const TAPS = Object.freeze(['fresh', 'teacher_empty', 'real']);
const TTL_S = 24 * 60 * 60;
const KEPT_TTL_S = 7 * 24 * 60 * 60;
const CACHE_MS = 30 * 1000;
const NEVER_ON = Object.freeze(['production', 'prod', 'staging']);
const h = (norm) => crypto.createHash('sha256').update(String(norm)).digest('hex').slice(0, 32);
const keyOf = (norm) => `wq:persona:${h(norm)}`;
const keptKeyOf = (norm) => `wq:persona:kept:${h(norm)}`;
const redis = () => require('../cache/railway-redis.service');
const normOf = (phone) => require('../quiz/student-identity.service').normalisePhone(phone);

let flagCache = null; // { at, on }
let listCache = null; // { at, teachers: Set }

/** Production and staging never walk, whatever the switch says. */
function blockedTier(env = process.env) {
  return [env.RAILWAY_ENVIRONMENT_NAME, env.RAILWAY_ENVIRONMENT, env.ENVIRONMENT]
    .some((v) => NEVER_ON.includes(String(v || '').trim().toLowerCase()));
}

function isTrue(value) {
  let v = value;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* plain string */ } }
  return v === true || (typeof v === 'string' && v.trim().toLowerCase() === 'true');
}

/** The switch. Never throws; a failed read is OFF (not cached). */
async function flagOn(now = Date.now()) {
  if (blockedTier()) return false;
  if (flagCache && now - flagCache.at < CACHE_MS) return flagCache.on;
  try {
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', [SWITCH_KEY]);
    if (error) throw new Error(error.message || 'app_settings read failed');
    const row = (data || []).find((r) => r.key === SWITCH_KEY);
    flagCache = { at: now, on: Boolean(row) && isTrue(row.value) };
    return flagCache.on;
  } catch (err) {
    logToFile('⚠️ walk-through: switch read failed — off', { error: err && err.message });
    return false;
  }
}

/** Is this user id one of the fixture rule's test teachers (and the switch on)? Never throws. */
async function allowed(userId, now = Date.now()) {
  if (!userId || !(await flagOn(now))) return false;
  try {
    if (!listCache || now - listCache.at >= CACHE_MS) {
      const { teachers } = await require('../quiz/web-quiz-fixture').fixtureConfig();
      listCache = { at: now, teachers };
    }
    return listCache.teachers.has(String(userId));
  } catch (_) { return false; }
}

const keptOf = (v) => (Array.isArray(v) ? v.filter((k) => k && typeof k.id === 'string' && k.id).map((k) => ({ id: k.id, via: k.via })) : []);

const numOrNull = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const obj = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (_) { return null; } };

function parse(v) {
  const o = obj(v);
  if (!o || !ASES.includes(o.as) || !Number.isFinite(Number(o.since))) return null;
  return { as: o.as, since: Number(o.since), walk: numOrNull(o.walk) };
}

/** The stored persona with no switch check (the POST's own read). */
async function stored(norm) {
  try { return parse(await redis().get(keyOf(norm))); } catch (_) { return null; }
}

/** The walk's record: { walk, kept } | null. */
async function keptRecord(norm) {
  try {
    const o = obj(await redis().get(keptKeyOf(norm)));
    return o && numOrNull(o.walk) != null ? { walk: Number(o.walk), kept: keptOf(o.kept) } : null;
  } catch (_) { return null; }
}

/** → { as, since, walk } | null. null whenever the switch is OFF. Never throws. */
async function get(phone) {
  try {
    const norm = normOf(phone);
    if (!norm || !(await flagOn())) return null;
    const p = await stored(norm);
    if (p) { try { await redis().expire(keyOf(norm), TTL_S); } catch (_) { /* it ends a day after the tap instead */ } }
    else await restoreOrphan(norm);
    return p;
  } catch (_) { return null; }
}

/** Keep a persona; true only when it reads back. */
async function set(phone, as, { now = Date.now(), walk = null } = {}) {
  const norm = normOf(phone);
  if (!norm || !ASES.includes(as)) return false;
  try {
    const value = { as, since: now, walk: numOrNull(walk) };
    await redis().set(keyOf(norm), JSON.stringify(value), TTL_S);
    const back = await stored(norm);
    return Boolean(back && back.as === as && back.since === now);
  } catch (_) { return false; }
}

async function clear(phone) {
  const norm = normOf(phone);
  if (!norm) return false;
  try { return Boolean(await redis().delete(keyOf(norm))); } catch (_) { return false; }
}

/** The teacher home's lists for this phone: emptied for 'teacher_empty' (the rows are untouched, only not shown). */
async function forHome(phone, lists) {
  const p = await get(phone);
  if (!p || p.as !== 'teacher_empty' || !lists) return lists;
  return { ...lists, lessons: [], played: new Map(), shares: [] };
}

/** The walk's own phone links (bound after the "new phone" tap) → erased; the count. */
async function eraseWalkLinks(norm, walk, now) {
  const Repo = require('../quiz/child-phone-bindings.repo');
  const live = await Repo.activeForPhone(norm, now);
  let n = 0;
  for (const b of live || []) {
    const at = new Date(b.bound_at || b.confirmed_at || 0).getTime();
    if (at >= walk) n += ((await Repo.eraseOne(b.id, 'stop', now)) || []).length;
  }
  return n;
}

/** The phone's own links the walk erased → kept again (a re-bind of each child not already on the phone); the count. */
async function restoreKept(norm, kept, now) {
  const Repo = require('../quiz/child-phone-bindings.repo');
  if (!kept.length) return 0;
  const live = new Set(((await Repo.activeForPhone(norm, now)) || []).map((b) => String(b.canonical_id)));
  let n = 0;
  for (const k of kept) {
    if (live.has(k.id)) continue;
    const via = Repo.VIA.includes(k.via) ? k.via : 'save';
    if (await Repo.insert({ canonicalId: k.id, phoneNorm: norm, via, confirmedAt: now, expiresAt: Repo.expiresAtFor(now) })) n += 1;
    live.add(k.id);
  }
  return n;
}

/** Put the phone back as it was before the walk (its own links re-bound, the walk's erased) and drop the record. */
async function putBack(norm, rec, now) {
  const erased = await eraseWalkLinks(norm, rec.walk, now);
  const restored = await restoreKept(norm, rec.kept, now);
  try { await redis().delete(keptKeyOf(norm)); } catch (_) { /* it expires in a week */ }
  return { erased, restored };
}

/** A walk whose persona ran out before "Back to my real self": the first read of the phone afterwards puts it back. */
async function restoreOrphan(norm) {
  const rec = await keptRecord(norm);
  if (!rec) return;
  const out = await putBack(norm, rec, new Date());
  await require('./role.service').forgetDoorVerdict(norm);
  try { logEvent('web_quiz.test_persona', { as: 'expired', ...out, w: 's' }); } catch (_) { /* never decides */ }
}

/**
 * Where the page goes after a tap, in the same web view: a new landing link (its own nonce, so the question's one
 * answer is not already spent) — the one question for a new phone, else the person's home (the landing re-resolves).
 * null when no link can be made (the page then shows its error line; typing quiz still works).
 */
async function nextLanding({ userId, norm, as, lang }) {
  if (!userId) return null;
  try {
    const url = await require('./one-door.service').mintLanding({
      user: { id: String(userId) }, phone: norm, side: as === 'fresh' ? 'unknown' : 'teacher', lang: lang === 'ur' ? 'ur' : 'bi', src: 'other',
    });
    const i = url ? url.indexOf('/quiz/go/') : -1;
    return i >= 0 ? url.slice(i) : null;
  } catch (_) { return null; }
}

/**
 * The POST's work, after the caller checked the token and allowed(). Never throws.
 * @returns {Promise<{done: true, as: string}|{error: string}>}
 */
async function handle({ as, phoneNorm, userId = null, lang = 'bi', now = new Date() } = {}) {
  if (!TAPS.includes(as)) return { error: 'bad_request' };
  const norm = normOf(phoneNorm);
  if (!norm) return { error: 'go.error' };
  const at = now.getTime();
  try {
    const Role = require('./role.service');
    const prior = await stored(norm);
    const Repo = require('../quiz/child-phone-bindings.repo');
    let erased = 0;
    let restored = 0;
    const rec = await keptRecord(norm);
    if (as === 'fresh') {
      // a walk already running keeps its first record (what is on the phone now is the walk's own)
      const walk = rec ? rec.walk : at;
      if (!(await set(norm, 'fresh', { now: at, walk }))) return { error: 'go.error' };
      if (!rec) {
        const seen = new Set();
        const kept = ((await Repo.activeForPhone(norm, now)) || [])
          .map((b) => ({ id: String(b.canonical_id), via: b.via }))
          .filter((k) => k.id && !seen.has(k.id) && seen.add(k.id));
        await redis().set(keptKeyOf(norm), JSON.stringify({ walk, kept }), KEPT_TTL_S);
        // nothing is erased unless the phone's own links can be put back
        if (!(await keptRecord(norm))) { await clear(norm); return { error: 'go.error' }; }
      }
      // the STOP eraser itself (the phone link only — the children's readings stay); no WhatsApp reply from a page tap
      erased = ((await Repo.eraseAllForPhone(norm, 'stop', now)) || []).length;
    } else if (as === 'teacher_empty') {
      if (!(await set(norm, 'teacher_empty', { now: at, walk: prior ? prior.walk : (rec ? rec.walk : null) }))) return { error: 'go.error' };
    } else {
      // put back first, then end the persona (a /quiz in between sees the walk still on, never an orphan)
      if (rec) ({ erased, restored } = await putBack(norm, rec, now));
      await clear(norm);
    }
    await Role.forgetDoorVerdict(norm);
    try { logEvent('web_quiz.test_persona', { as, erased, restored, w: 's' }); } catch (_) { /* never decides the answer */ }
    return { done: true, as, next: await nextLanding({ userId, norm, as, lang }) };
  } catch (err) {
    logToFile('❌ walk-through: tap failed', { as, error: err && err.message }, 'error');
    return { error: 'go.error' };
  }
}

// ─── the row ────────────────────────────────────────────────────────────────
// The Urdu is the native read's signed wording (shown only to listed grown-up test phones). The row uses the question
// page's own classes (no style or script of its own: the page's policy allows only its own hashed ones).

const S = Object.freeze({
  'tp.h': Object.freeze({ en: 'Walk-through — this phone is on the list', ur: 'قدم بہ قدم — یہ فون فہرست میں شامل ہے' }),
  'tp.fresh': Object.freeze({ en: 'Start as a new phone', ur: 'نئے فون کی طرح شروع کریں' }),
  'tp.empty': Object.freeze({ en: 'A teacher with no lessons yet', ur: 'ٹیچر — ابھی کوئی سبق نہیں' }),
  'tp.real': Object.freeze({ en: 'Back to my real self', ur: 'اپنے اکاؤنٹ پر واپس جائیں' }),
});
const str = (id, lang) => S[id][lang === 'en' ? 'en' : 'ur'];
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const two = (id, lang) => `<span lang="ur">${esc(str(id, 'ur'))}</span>${lang === 'ur' ? '' : `<span class="en" lang="en" dir="ltr">${esc(str(id, 'en'))}</span>`}`;

/** The row's HTML for a listed test phone, else ''. `token` = the page's go token (its user id is read, CPU only). */
async function row({ lang = 'bi', token = '' } = {}) {
  try {
    const v = require('./go.token').verifyGo(String(token || ''));
    const uid = v && v.ok ? v.ok.uid : null;
    if (!uid || !(await allowed(uid))) return '';
    return '<section data-screen="walk">'
      + `<p class="note">${two('tp.h', lang)}</p>`
      + `<button type="button" class="no" data-tap="walk_fresh" data-persona="fresh">${two('tp.fresh', lang)}</button>`
      + `<button type="button" class="no" data-tap="walk_empty" data-persona="teacher_empty">${two('tp.empty', lang)}</button>`
      + `<button type="button" class="no" data-tap="walk_real" data-persona="real">${two('tp.real', lang)}</button>`
      + '</section>';
  } catch (_) { return ''; }
}

const DEVICE_RX = /^[A-Za-z0-9_-]{22}$/;
const send = (res, status, body) => {
  res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
  return res.status(status).json(body);
};

/** POST /persona {t, as} on the landing router: 404 {off:true} unless the token's phone is a listed one. */
function mount(router) {
  router.post('/persona', async (req, res) => {
    try {
      const b = req.body && typeof req.body === 'object' ? req.body : {};
      const dv = req.get('x-wq-device');
      const o = await require('./go.routes')._open(String(b.t || ''), typeof dv === 'string' && DEVICE_RX.test(dv) ? dv : null);
      if (o.stale) return (await flagOn()) ? send(res, 410, { error: 'go.stale' }) : send(res, 404, { off: true });
      if (!(await allowed(o.userId))) return send(res, 404, { off: true });
      if (!TAPS.includes(b.as)) return send(res, 400, { error: 'go.error' });
      const out = await handle({ as: b.as, phoneNorm: o.phoneNorm, userId: o.userId, lang: o.p && o.p.lang });
      return out && out.done ? send(res, 200, out) : send(res, 503, { error: 'go.error' });
    } catch (err) {
      logToFile('❌ walk-through: tap failed', { error: err && err.message }, 'error');
      return send(res, 503, { error: 'go.error' });
    }
  });
  return router;
}

module.exports = {
  flagOn, allowed, get, set, clear, forHome, row, mount, handle, blockedTier,
  SWITCH_KEY, ASES, TAPS, TTL_S, KEPT_TTL_S, STRINGS: S, _key: keyOf, _keptKey: keptKeyOf,
  _resetCache: () => { flagCache = null; listCache = null; },
};
