'use strict';
/**
 * /api/internal/ft/* — the teacher's quiz-maker page, called only by the portal's public edge
 * (dashboard/routes/first-touch.routes.js, which forwards with x-api-key). WHO is asking comes only from the signed
 * maker token (kind 'm', maker.token.js), never from the request.
 *
 *   GET  /m/:token[?lang=en|ur]   the maker page (HTML); a genuine but expired token → the mk.stale page (200),
 *                                  a forged one → the same page (404)
 *   GET  /m/:token/send?c=<shareCodeId>   "Send to class group": the make's message rebuilt on the server (the share
 *                                  code must be this teacher's, else 404) → 302 https://wa.me/?text=<message>, never
 *                                  stored; logs share_tap. Stale token → the mk.stale page; forged → 404
 *   POST /api/ft/make {t, grade, subject, quizId}   → { shareCodeId, message, qlang, preview, total } (maker.bank.js)
 *   POST /api/ft/tour {t, action, how?}   → 204; the tour banner's show / dismiss / replay (tour.routes.js)
 *   POST /api/ft/step {t, step, grade?, subject?, quizId?}   → 204; logs onboard.maker for the page's steps (chip
 *                                  taps, share_copy, lang_mark_seen, prefill_kept / prefill_changed — the last two
 *                                  take their cell from the token's pf, never from the body)
 *
 * Switch quiz_maker_page OFF (read OFF when absent): EVERY route of this router answers 404 {off:true} before
 * anything else is read or verified; the edge then falls through to today's handling.
 * Never a 500: a thrown read → the mk.error page (200) on the page route, 503 {error:'mk.error'} on the JSON routes.
 *
 * Events: onboard.maker { step, grade, subject, qlang, lang, via, quiz_id, ukey } — grade/subject as codes,
 * `ukey` only from the token's `uk`; never a phone, a name, a share code, a kid or a dk.
 */
const express = require('express');
const { requireInternalKey } = require('../../middleware/require-internal-key');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { clampLanguage } = require('../../config/ux-strings');
const IdFlags = require('../quiz/web-quiz-identity-flags');
const MakerToken = require('./maker.token');
const Bank = require('./maker.bank');
const Page = require('./maker.page');
const { SUBJECT_CODES } = require('./maker.strings');
// ── tour (TOUR.md §2-§5) ──
const Keys = require('./door.keys');
const Tour = require('./tour.page');
// ── end tour ──
// ── cards (TOUR.md §6-§7) ──
const Cards = require('./cards.page');
const Share = require('../quiz/video-quiz-share.service');
// ── end cards ──

const router = express.Router();
router.use(requireInternalKey);

// The switch, first: off → 404 {off:true} for every path of this router, whatever the token.
router.use(async (req, res, next) => {
  let on = false;
  try { on = (await IdFlags.flags()).makerPage === true; } catch (_) { on = false; }
  if (!on) return res.status(404).json({ off: true });
  return next();
});
router.use(express.json({ limit: '4kb' }));
router.use(express.urlencoded({ extended: false, limit: '4kb' }));

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Each step the page may post, and the fields it needs ('pf': the token's pre-fill cell).
const CLIENT_STEPS = Object.freeze({
  grade: ['grade'], subject: ['grade', 'subject'], topic: ['grade', 'subject', 'quizId'],
  share_copy: ['grade', 'subject', 'quizId'], lang_mark_seen: ['grade', 'subject'],
  prefill_kept: ['pf'], prefill_changed: ['pf'],
});
const PF_RX = /^grade_([1-5])\|([a-z_]+)$/;
const ASKABLE = Object.freeze(['en', 'ur']);
const asked = (v) => (ASKABLE.includes(v) ? v : null);
const gradeIn = (v) => (typeof v === 'string' && /^[1-5]$/.test(v) ? v : null);
const subjectIn = (v) => (typeof v === 'string' && SUBJECT_CODES.includes(v) ? v : null);
const quizIn = (v) => (typeof v === 'string' && UUID_RX.test(v) ? v : null);
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

function headers(res, csp) {
  res.set({
    'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', ...(csp ? { 'Content-Security-Policy': csp } : {}),
  });
}

function messagePage(res, status, id, lang) {
  const built = Page.buildMessagePage({ lang, id });
  headers(res, built.csp);
  return res.status(status).type('html').send(built.html);
}

/** onboard.maker with exactly the contract's fields. Never decides a response. */
function makerEvent(step, p, { grade = null, subject = null, qlang = null, quizId = null } = {}) {
  try {
    logEvent('onboard.maker', {
      step, grade: grade ? `grade_${grade}` : null, subject: subject || null, qlang: qlang || null,
      lang: p.lang, via: p.via, quiz_id: quizId || null, ukey: typeof p.uk === 'string' ? p.uk : null, w: 's',
    });
  } catch (_) { /* a failed log never decides a response */ }
}

/** The page route's wrapper: a throw → the mk.error page, 200. */
const handlePage = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    logToFile('❌ maker page route failed', { error: err && err.message }, 'error');
    if (!res.headersSent) messagePage(res, 200, 'mk.error', clampLanguage(asked(req.query && req.query.lang)));
  }
};
/** The JSON routes' wrapper: a throw → 503 {error:'mk.error'}. */
const handleJson = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    logToFile('❌ maker route failed', { route: req.path, error: err && err.message }, 'error');
    if (!res.headersSent) { headers(res); res.status(503).json({ error: 'mk.error' }); }
  }
};

/** The token's payload for a JSON route, or the refusal already sent (null). */
function authoriseJson(t, res) {
  const v = MakerToken.verifyMaker(t);
  if (v && v.ok) return v.ok;
  headers(res);
  res.status(v && v.stale ? 410 : 404).json({ error: 'mk.stale' });
  return null;
}

router.get('/m/:token', handlePage(async (req, res) => {
  const v = MakerToken.verifyMaker(req.params.token);
  if (!v) return messagePage(res, 404, 'mk.stale', clampLanguage(asked(req.query.lang)));
  if (v.stale) return messagePage(res, 200, 'mk.stale', v.stale.lang);
  const p = v.ok;
  const tree = await Bank.chipTree();
  const { lang, switchTo } = Page.pageLang(p.lang, asked(req.query.lang));
  // ── tour: the banner iff the token says tour:0 AND no quiz_tour row (one read, none when tour:1; error → hidden) ──
  const show = p.tour === 0 && !(await Keys.tourSeen(p.uid));
  const addons = [Tour.tourAddon({ lang, show })];
  // ── end tour ──
  // ── cards: the three branch cards + the forward line; no dialable bot number → nothing ──
  addons.push(Cards.cardsAddon({ lang, bot: Share.botNumber() }));
  // ── end cards ──
  const built = Page.buildMakerPage({ token: req.params.token, lang, switchTo, via: p.via, tree, pf: p.pf, addons });
  makerEvent('open', p);
  headers(res, built.csp);
  return res.status(200).type('html').send(built.html);
}));

router.get('/m/:token/send', handlePage(async (req, res) => {
  const v = MakerToken.verifyMaker(req.params.token);
  if (!v) return messagePage(res, 404, 'mk.stale', clampLanguage(asked(req.query.lang)));
  if (v.stale) return messagePage(res, 200, 'mk.stale', v.stale.lang);
  const p = v.ok;
  const shareCodeId = quizIn(req.query.c);
  const out = shareCodeId ? await Bank.shareMessage({ uid: p.uid, lang: p.lang, shareCodeId }) : null;
  if (!out) return messagePage(res, 404, 'mk.error', p.lang);
  makerEvent('share_tap', p, { grade: out.grade, subject: out.subject, qlang: out.qlang, quizId: out.quizId });
  headers(res);
  return res.redirect(302, `https://wa.me/?text=${encodeURIComponent(out.message)}`);
}));

router.post('/api/ft/make', handleJson(async (req, res) => {
  const b = bodyOf(req);
  const p = authoriseJson(b.t, res);
  if (!p) return;
  const grade = gradeIn(b.grade);
  const subject = subjectIn(b.subject);
  const quizId = quizIn(b.quizId);
  if (!grade || !subject || !quizId) { headers(res); res.status(400).json({ error: 'mk.error' }); return; }
  const out = await Bank.make({ uid: p.uid, lang: p.lang, grade, subject, quizId });
  if (out.error) { headers(res); res.status(out.error === 400 ? 400 : 503).json({ error: 'mk.error' }); return; }
  makerEvent('made', p, { grade, subject, qlang: out.qlang, quizId });
  headers(res);
  res.status(200).json({ shareCodeId: out.shareCodeId, message: out.message, qlang: out.qlang, preview: out.preview, total: out.total });
}));

router.post('/api/ft/step', handleJson(async (req, res) => {
  const b = bodyOf(req);
  const p = authoriseJson(b.t, res);
  if (!p) return;
  const needs = Object.prototype.hasOwnProperty.call(CLIENT_STEPS, b.step) ? CLIENT_STEPS[b.step] : null;
  let grade = null; let subject = null; let quizId = null;
  if (needs && needs.includes('pf')) {
    const m = PF_RX.exec(typeof p.pf === 'string' ? p.pf : '');
    if (m) { grade = m[1]; subject = subjectIn(m[2]); }
  } else if (needs) {
    grade = gradeIn(b.grade);
    subject = needs.includes('subject') ? subjectIn(b.subject) : null;
    quizId = needs.includes('quizId') ? quizIn(b.quizId) : null;
  }
  const missing = !needs || !grade || (needs.some((n) => n === 'subject' || n === 'pf') && !subject) || (needs.includes('quizId') && !quizId);
  if (missing) { headers(res); res.status(400).json({ error: 'mk.error' }); return; }
  const chip = quizId ? await Bank.chipOf(grade, subject, quizId) : null;
  makerEvent(b.step, p, { grade, subject, quizId, qlang: chip ? chip.qlang : null });
  headers(res);
  res.status(204).end();
}));

// ── slot: family door (its PR adds one line: require('./family.routes').mount(router);) ──
// ── tour: POST /api/ft/tour (behind the switch and the body parsers above) ──
require('./tour.routes').mount(router, { headers, handleJson, authoriseJson });
// ── end tour ──

module.exports = router;
