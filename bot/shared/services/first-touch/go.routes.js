'use strict';
/**
 * /api/internal/go/* — the one door's landing, called only by the portal's public edge (dashboard/routes/quiz-go.routes.js,
 * which forwards with x-api-key and the phone's x-wq-device). WHO is asking comes only from the signed go token and the
 * server's nonce map (go.store), never from the request; and the token's side is only a hint — every route re-resolves
 * the person on the server (role.service) before it answers.
 *
 *   GET  /land/:token      teacher → 302 the teacher home · child → 302 the child home (/h/<hub>?src=quiz) ·
 *                          join → 302 the join screen · unknown → the one question (HTML) · stale/used/other phone → go.stale
 *   POST /who   {t}        → 200 {side, next|null}: the question page asks this after paint (someone known goes straight on)
 *   POST /role  {t, side}  side ∈ child|teacher → the remembered answer (door.keys, writer `role_page`), the cached
 *                          verdict forgotten → 200 {next}; a stale token → 410 {error:'go.stale'}
 *   POST /bind  {t, kid}   the multi-child "Yes, it's me" (the join page's write) → 200 {next} | 409 {error} | 501
 *
 * Switch quiz_one_door OFF: EVERY route answers 404 {off:true} before anything is read; the edge then falls through.
 * Never a 500: a thrown read → the go.error page (200) on /land, 503 {error:'go.error'} on the JSON routes.
 * Nothing here writes the users row (role, registration, language). 0 WhatsApp messages.
 *
 * Events (ids only): one_door.landed{side, src, how}; with web_quiz_events_v3 ON web_quiz.role_asked / role_answered{role} /
 * go_stale{why}.
 */
const express = require('express');
const { requireInternalKey } = require('../../middleware/require-internal-key');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const Flags = require('./one-door.flags');
const GoToken = require('./go.token');
const Store = require('./go.store');
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
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const deviceOf = (req) => {
  const v = req.get('x-wq-device');
  return typeof v === 'string' && /^[A-Za-z0-9_-]{22}$/.test(v) ? v : null;
};

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

async function v3(name, props) {
  try {
    if ((await Flags.flags()).eventsV3) logEvent(`web_quiz.${name}`, { w: 's', ev_v: 3, v3: 1, kid: null, ...props });
  } catch (_) { /* never decides a response */ }
}
function landed(side, src, how) {
  try { logEvent('one_door.landed', { side, src, how }); } catch (_) { /* never decides a response */ }
}

/**
 * The token → { p (payload), phoneNorm, userId } when it is genuine, fresh, known to the server and on its first
 * device; else { stale: why }.
 */
async function open(t, device) {
  const v = GoToken.verifyGo(t);
  if (!v) return { stale: 'bad' };
  if (v.stale) return { stale: 'expired', p: v.stale };
  const p = v.ok;
  const who = await Store.who(p.n);
  if (!who || who.userId !== p.uid) return { stale: 'unknown_nonce', p };
  const dev = await Store.device(p.n, device);
  if (dev === 'other') return { stale: 'other_device', p };
  return { p, phoneNorm: who.phoneNorm, userId: who.userId };
}

/** Re-resolve on the server and say where this person goes: { side, next|null, how }. */
async function destination(o) {
  const who = await Role.resolveRole({ user: { id: o.userId }, phone: o.phoneNorm });
  const lang = o.p.lang;
  if (who.side === 'teacher') return { side: 'teacher', src: who.src, next: Targets.teacher({ uid: o.userId, lang }), how: 'teacher_home' };
  if (who.side === 'child') {
    if (who.src === 'roster' && who.children.length === 1) {
      // one chat-joined child and no binding yet: bound on the server before the home opens (0 replies)
      try { await Targets.autoBind({ phoneNorm: o.phoneNorm, userId: o.userId, kids: who.children }); } catch (_) { /* the home still opens */ }
    }
    return { side: 'child', src: who.src, next: await Targets.child(who.children), how: 'child_home' };
  }
  if (who.side === 'join') return { side: 'join', src: who.src, next: Targets.join({ uid: o.userId, n: o.p.n, lang }), how: 'join' };
  return { side: 'unknown', src: who.src, next: null, how: 'ask' };
}

router.get('/land/:token', async (req, res) => {
  let lang = 'bi';
  try {
    const o = await open(String(req.params.token || ''), deviceOf(req));
    if (o.p) lang = o.p.lang;
    if (o.stale) {
      landed(null, null, `stale_${o.stale}`);
      await v3('go_stale', { why: o.stale, lang });
      return page(res, Page.buildMessagePage({ id: 'go.stale', lang }));
    }
    const d = await destination(o);
    landed(d.side, d.src, d.next ? d.how : (d.side === 'unknown' ? 'ask' : `${d.how}_missing`));
    if (d.next) { headers(res); return res.redirect(302, d.next); }
    if (d.side === 'unknown') return page(res, Page.buildRolePage({ t: String(req.params.token), lang }));
    if (d.side === 'join') return page(res, Page.buildMessagePage({ id: 'go.family', lang }));
    return page(res, Page.buildMessagePage({ id: 'go.error', lang }));
  } catch (err) {
    logToFile('❌ one door: landing failed', { error: err && err.message }, 'error');
    return page(res, Page.buildMessagePage({ id: 'go.error', lang }));
  }
});

router.post('/who', async (req, res) => {
  try {
    const o = await open(String(bodyOf(req).t || ''), deviceOf(req));
    if (o.stale) return json(res, 410, { error: 'go.stale' });
    const d = await destination(o);
    if (d.side === 'unknown') await v3('role_asked', { lang: o.p.lang });
    return json(res, 200, { side: d.side, next: d.next || null });
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
    const o = await open(String(b.t || ''), deviceOf(req));
    if (o.stale) return json(res, 410, { error: 'go.stale' });
    // the write is single-use per token: a second tap re-reads, it never writes twice
    if (await Store.consume(o.p.n, 'role')) {
      const Keys = require('./door.keys');
      // writer `role_page` (the one question): the remembered answer, then the cached verdict forgotten (inside markX)
      if (side === 'teacher') await Keys.markTeacher(o.userId, o.phoneNorm);
      else await Keys.markChild(o.userId, o.phoneNorm);
      await v3('role_answered', { role: side === 'teacher' ? 'teacher' : 'student', lang: o.p.lang });
      logEvent('one_door.role', { side, writer: 'role_page' });
    }
    const d = await destination(o);
    // the server's answer wins (a registered teacher who taps "I want to play" still has a teacher home)
    const next = d.next || `/quiz/go/${encodeURIComponent(String(b.t))}`;
    return json(res, 200, { next, side: d.side });
  } catch (err) {
    logToFile('❌ one door: role answer failed', { error: err && err.message }, 'error');
    return json(res, 503, { error: 'go.error' });
  }
});

router.post('/bind', async (req, res) => {
  try {
    const b = bodyOf(req);
    const kid = typeof b.kid === 'string' && UUID_RX.test(b.kid) ? b.kid : null;
    if (!kid) return json(res, 400, { error: 'go.error' });
    const o = await open(String(b.t || ''), deviceOf(req));
    if (o.stale) return json(res, 410, { error: 'go.stale' });
    if (!(await Store.consume(o.p.n, 'bind'))) return json(res, 409, { error: 'go.used' });
    const out = await Targets.bindChosen({ phoneNorm: o.phoneNorm, userId: o.userId, kid });
    if (out === null) return json(res, 501, { error: 'go.error' });
    if (!out || !out.ok) return json(res, 409, { error: (out && out.error) || 'go.error' });
    const d = await destination(o);
    return json(res, 200, { next: out.next || d.next || null });
  } catch (err) {
    logToFile('❌ one door: bind failed', { error: err && err.message }, 'error');
    return json(res, 503, { error: 'go.error' });
  }
});

module.exports = router;
module.exports._open = open;
module.exports._destination = destination;
