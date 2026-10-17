'use strict';
/**
 * /api/internal/go/* — the one door's landing, called only by the portal's public edge (dashboard/routes/quiz-go.routes.js,
 * which forwards path-for-path with x-api-key and the phone's x-wq-device). WHO is asking comes only from the signed go
 * token and the server's nonce map (go-nonce.js), never from the request; the token's side is only a hint — every
 * decision re-resolves the person on the server (role.service) first.
 *
 *   GET  /land/:token[?ask=1]  side unknown (or ask=1) → the one question, rendered with NO database read (the token
 *                              is CPU, the nonce Redis) — the server is asked after paint (/who);
 *                              otherwise the server re-resolves: teacher → 302 the teacher home · a known child → 302
 *                              /h/<hub>?from=quiz · a child on this phone not yet kept here → the "Is it <First>?" sheet ·
 *                              the remembered child answer → 302 the join screen · unknown → the one question;
 *                              expired / unknown nonce / another device → go.stale (200, never a 500)
 *   POST /who   {t, d?}        → 200 {side, next|null, known?}: `known` = {pick, first} for a child who played on the
 *                              device `d` (the quiz page's own device ref), offered as one line above the tiles
 *   POST /role  {t, side}      side ∈ child|teacher → the remembered answer (writeRoleAnswer, writer role_page) ONCE per
 *                              link, the cached verdict forgotten → 200 {next, side}; a stale token → 410 {error}
 *   POST /bind  {t, pick, d?}  "Yes, it's me": `pick` must be one of THIS phone's children (or one who played on device
 *                              `d`), checked here; the binding is written by the join page's writer → 200 {next} |
 *                              409 {error} | 501 (writer not on this branch)
 *
 * Switch quiz_one_door OFF: EVERY route answers 404 {off:true} before anything is read; the edge then falls through.
 * Never a 500: a thrown read → the go.error page (200) on /land, 503 {error:'go.error'} on the JSON routes.
 * Nothing here writes the users row (role, registration, language). 0 WhatsApp messages.
 *
 * Events (ids only): one_door.landed{side, src, how}, one_door.role{side, writer}, one_door.bind{src, ok}; with
 * web_quiz_events_v3 ON web_quiz.role_asked / role_answered{role} / go_stale{why}.
 */
const crypto = require('crypto');
const express = require('express');
const { requireInternalKey } = require('../../middleware/require-internal-key');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Flags = require('./one-door.flags');
const GoToken = require('./go.token');
const GoNonce = require('./go-nonce');
const Role = require('./role.service');
const Targets = require('./go.targets');
const Page = require('./go.page');

const router = express.Router();
router.use(requireInternalKey);

router.use(async (req, res, next) => {
  if (!(await Flags.on())) return res.status(404).json({ off: true });
  return next();
});
router.use(express.json({ limit: '4kb' }));

const ROLE_SIDES = Object.freeze(['child', 'teacher']);
const DEVICE_RX = /^[A-Za-z0-9_-]{22}$/;
const PICK_RX = /^[0-9a-f]{16}$/;
const DEVICE_DAYS = 120;
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const deviceOf = (req) => {
  const v = req.get('x-wq-device');
  return typeof v === 'string' && DEVICE_RX.test(v) ? v : null;
};
const quizDevice = (v) => (typeof v === 'string' && DEVICE_RX.test(v) ? v : null);

function headers(res, csp) {
  res.set({
    'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', ...(csp ? { 'Content-Security-Policy': csp } : {}),
  });
}
function page(res, built, status = 200) {
  headers(res, built.csp);
  return res.status(status).type('html').send(built.html);
}
function json(res, status, body) {
  headers(res);
  return res.status(status).json(body);
}

// a door line under events v3: the shared envelope (kid_v, kid null) and the sitting keyed by this phone's dk, so the
// role answer joins the sitting the child then plays in (EVENTS v3 §0)
async function v3(name, props, device = null) {
  try {
    if ((await Flags.flags()).eventsV3) await require('../quiz/web-quiz-events-v3').emit3(`web_quiz.${name}`, props, { device });
  } catch (_) { /* never decides a response */ }
}
function event(name, props) {
  try { logEvent(name, props); } catch (_) { /* never decides a response */ }
}

/** An opaque per-link id for one child: the page never holds a student id. */
function pickOf(n, kid) {
  const key = require('../quiz/web-quiz-token').secret();
  if (!key) return null;
  return crypto.createHmac('sha256', key).update(`go-pick|${n}|${kid}`).digest('hex').slice(0, 16);
}

/**
 * The token → { p (payload), phoneNorm, userId } when it is genuine, fresh, known to the server and on its first
 * device; else { stale: why }. Redis only — no database read.
 */
async function open(t, device) {
  const v = GoToken.verifyGo(t);
  if (!v) return { stale: 'bad' };
  if (v.stale) return { stale: 'expired', p: v.stale };
  const p = v.ok;
  const who = await GoNonce.peek(p.n);
  if (!who || who.userId !== p.uid) return { stale: 'unknown_nonce', p };
  if ((await GoNonce.bindDevice(p.n, device)) === 'other') return { stale: 'other_device', p };
  return { p, phoneNorm: who.phoneNorm, userId: who.userId };
}

/** The children who played on the quiz page with device ref `d` (newest first), as [{id, first}] (≤ 4). */
async function deviceKids(d) {
  if (!d) return [];
  const supabase = require('../../config/supabase');
  const since = new Date(Date.now() - DEVICE_DAYS * 86400000).toISOString();
  const { data, error } = await supabase.from('quiz_sessions').select('student_id, created_at')
    .eq('device_ref', d).gte('created_at', since).order('created_at', { ascending: false }).limit(50);
  if (error) throw new Error(error.message || 'device read failed');
  const ids = [...new Set((data || []).map((r) => String(r.student_id || '')).filter(Boolean))].slice(0, 4);
  if (!ids.length) return [];
  const { data: rows, error: serr } = await supabase.from('students').select('id, student_name, is_active, status').in('id', ids);
  if (serr) throw new Error(serr.message || 'student read failed');
  const live = new Map((rows || []).filter((r) => r.is_active !== false && (r.status || 'active') === 'active')
    .map((r) => [String(r.id), Role.firstOf(r.student_name)]));
  return ids.filter((id) => live.has(id)).map((id) => ({ id, first: live.get(id) }));
}

/** This deployment's dialable bot number (the share links' source), or null. */
function botNumber() {
  try { return require('../quiz/video-quiz-share.service').botNumber() || null; } catch (_) { return null; }
}

/** The bind claim given back (the write did not happen). Best effort: a Redis miss leaves the link used, never wrong. */
async function releaseBind(n) {
  try { await require('../cache/railway-redis.service').delete(GoNonce._key.used(n, 'bind')); } catch (_) { /* used stays used */ }
}

/** Re-resolve on the server: { side, src, how, next?, page?, kids? }. */
async function destination(o) {
  const who = await Role.resolveRole({ user: { id: o.userId }, phone: o.phoneNorm });
  const lang = o.p.lang;
  const base = { side: who.side, src: who.src };
  if (who.side === 'teacher') return { ...base, how: 'teacher_home', next: await Targets.teacher({ uid: o.userId, lang }) };
  if (who.side === 'child') {
    // a child kept on this phone already → the home; one on the phone but not kept here yet → "Is it <First>?" first
    // (the notice before any binding); the class roster's family → the same sheet, never a silent bind
    if ((who.src === 'family' || who.src === 'roster') && Targets.canBind()) {
      return { ...base, how: 'confirm', page: 'pick', kids: who.kids.map((k) => ({ pick: pickOf(o.p.n, k.id), first: k.first })) };
    }
    if (who.src === 'family') return { ...base, side: 'unknown', how: 'ask_no_writer', page: 'role' };
    return { ...base, how: 'child_home', next: await Targets.child(who.children, 'quiz', lang) };
  }
  if (who.side === 'join') return { ...base, how: 'join', next: Targets.join({ n: o.p.n, lang }) };
  return { ...base, how: 'ask', page: 'role' };
}

// The sandbox walk-through (switch quiz_test_personas; its own module, optional-modules.js): its route and its row on
// the one question page. Without the module (or with its switch off) nothing here changes a byte.
const personaModule = () => require('./optional-modules').load('testPersona');
async function personaRow(lang, t) {
  try {
    const M = personaModule();
    if (!M || typeof M.row !== 'function') return '';
    const row = await M.row({ lang, token: t });
    return typeof row === 'string' ? row : '';
  } catch (_) { return ''; }
}
const rolePage = async (res, t, lang) => page(res, Page.buildRolePage({ t, lang, extra: await personaRow(lang, t), bot: botNumber() }));

function render(res, d, t, lang) {
  if (d.next) { headers(res); return res.redirect(302, d.next); }
  if (d.page === 'pick') return page(res, Page.buildPickPage({ t, lang, kids: d.kids, bot: botNumber() }));
  if (d.page === 'role') return rolePage(res, t, lang);
  if (d.side === 'join') return page(res, Page.buildMessagePage({ id: 'go.family', lang }));
  return page(res, Page.buildMessagePage({ id: 'go.error', lang, bot: botNumber() }));
}

router.get('/land/:token', async (req, res) => {
  let lang = 'bi';
  const t = String(req.params.token || '');
  try {
    const o = await open(t, deviceOf(req));
    if (o.p) lang = o.p.lang;
    if (o.stale) {
      event('one_door.landed', { side: null, src: null, how: `stale_${o.stale}` });
      await v3('go_stale', { why: o.stale, lang }, deviceOf(req));
      return page(res, Page.buildMessagePage({ id: 'go.stale', lang, bot: botNumber() }));
    }
    // the one question paints before any database read; who this phone is, is asked after paint
    if (o.p.side === 'unknown' || req.query.ask === '1') {
      event('one_door.landed', { side: 'unknown', src: null, how: req.query.ask === '1' ? 'ask_again' : 'ask' });
      return rolePage(res, t, lang);
    }
    const d = await destination(o);
    event('one_door.landed', { side: d.side, src: d.src, how: d.next || d.page ? d.how : `${d.how}_missing` });
    return render(res, d, t, lang);
  } catch (err) {
    logToFile('❌ one door: landing failed', { error: err && err.message }, 'error');
    return page(res, Page.buildMessagePage({ id: 'go.error', lang, bot: botNumber() }));
  }
});

router.post('/who', async (req, res) => {
  try {
    const b = bodyOf(req);
    const t = String(b.t || '');
    const o = await open(t, deviceOf(req));
    if (o.stale) return json(res, 410, { error: 'go.stale' });
    // "Not a teacher? Change": the person asked to answer again, so the question stays (the tap meets the server's answer)
    const d = o.p.side === 'unknown' && o.p.src === 'change' ? { side: 'unknown' } : await destination(o);
    if (d.next) return json(res, 200, { side: d.side, next: d.next });
    if (d.page === 'pick') return json(res, 200, { side: d.side, next: `/quiz/go/${encodeURIComponent(t)}` });
    await v3('role_asked', { lang: o.p.lang }, deviceOf(req));
    // a child who played on THIS device's quiz page: one line above the tiles (only when a binding can be written)
    const qd = quizDevice(b.d);
    if (qd && Targets.canBind()) {
      const kids = await deviceKids(qd).catch(() => []);
      if (kids.length) return json(res, 200, { side: 'unknown', next: null, known: { pick: pickOf(o.p.n, kids[0].id), first: kids[0].first } });
    }
    return json(res, 200, { side: d.side, next: null });
  } catch (err) {
    logToFile('❌ one door: who failed', { error: err && err.message }, 'error');
    return json(res, 503, { error: 'go.error' });
  }
});

router.post('/role', async (req, res) => {
  try {
    const b = bodyOf(req);
    const side = ROLE_SIDES.includes(b.side) ? b.side : null;
    if (!side) return json(res, 400, { error: 'go.error' });
    const t = String(b.t || '');
    const o = await open(t, deviceOf(req));
    if (o.stale) return json(res, 410, { error: 'go.stale' });
    // the write is single-use per link: a second tap re-reads, it never writes twice
    if (await GoNonce.claim(o.p.n, 'role')) {
      await Role.writeRoleAnswer({ userId: o.userId, side, phone: o.phoneNorm, src: 'role_page' });
      await v3('role_answered', { role: side === 'teacher' ? 'teacher' : 'student', lang: o.p.lang }, deviceOf(req));
      event('one_door.role', { side, writer: 'role_page' });
    }
    const d = await destination(o);
    // the server's answer wins (a registered teacher who taps "I want to play" still has a teacher home)
    const next = d.next || `/quiz/go/${encodeURIComponent(t)}`;
    return json(res, 200, { next, side: d.side });
  } catch (err) {
    logToFile('❌ one door: role answer failed', { error: err && err.message }, 'error');
    return json(res, 503, { error: 'go.error' });
  }
});

router.post('/bind', async (req, res) => {
  try {
    const b = bodyOf(req);
    const pick = typeof b.pick === 'string' && PICK_RX.test(b.pick) ? b.pick : null;
    if (!pick) return json(res, 400, { error: 'go.error' });
    if (!Targets.canBind()) return json(res, 501, { error: 'go.error' });
    const t = String(b.t || '');
    const o = await open(t, deviceOf(req));
    if (o.stale) return json(res, 410, { error: 'go.stale' });
    // the pick must be one of THIS phone's children (the sheet's), or a child who played on this device (the line's)
    const who = await Role.resolveRole({ user: { id: o.userId }, phone: o.phoneNorm });
    if (who.side === 'teacher') return json(res, 409, { error: 'go.error', why: 'teacher_phone' });
    let src = who.side === 'child' ? who.src : null;
    let kid = who.side === 'child' ? (who.kids.find((k) => pickOf(o.p.n, k.id) === pick) || null) : null;
    if (!kid && quizDevice(b.d)) {
      kid = (await deviceKids(quizDevice(b.d))).find((k) => pickOf(o.p.n, k.id) === pick) || null;
      src = 'device';
    }
    if (!kid) return json(res, 400, { error: 'go.error' });
    // one binding per link: claimed before the write (a double tap never writes twice), released when the write did not
    // happen (a refusal or an error), so the same link can still bind the right child on the next tap
    if (!(await GoNonce.claim(o.p.n, 'bind'))) return json(res, 409, { error: 'go.error', why: 'used' });
    const qd = quizDevice(b.d);
    let out;
    try {
      out = await Targets.bindPick({
        n: o.p.n, kid: kid.id, device: deviceOf(req), src: src === 'family' ? 'roster' : (src === 'device' ? 'device' : 'quiz'),
        ...(qd ? { quizDevice: qd } : {}), ...(o.p.lang === 'ur' ? { lang: 'ur' } : {}),
      });
    } catch (err) {
      await releaseBind(o.p.n);
      throw err;
    }
    event('one_door.bind', { src, ok: Boolean(out && out.next) });
    if (out && out.next) return json(res, 200, { next: out.next });
    await releaseBind(o.p.n);
    return json(res, 409, { error: 'go.error', why: (out && (out.refused || out.error)) || 'refused' });
  } catch (err) {
    logToFile('❌ one door: bind failed', { error: err && err.message }, 'error');
    return json(res, 503, { error: 'go.error' });
  }
});

(function mountPersona() {
  const M = personaModule();
  if (M && typeof M.mount === 'function') M.mount(router);   // POST /persona {t, as}
}());

module.exports = router;
module.exports._open = open;
module.exports._destination = destination;
module.exports._pickOf = pickOf;
