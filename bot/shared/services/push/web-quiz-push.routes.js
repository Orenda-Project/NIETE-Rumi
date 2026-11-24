'use strict';
/**
 * /api/internal/wqpush/* — the reminder push (web_quiz_push_remind; OFF → every route 404 {off:true}, and the portal
 * edge falls through). Called only by the portal edge (dashboard/routes/push-remind.routes.js) with x-api-key; the
 * phone's wq_dv cookie arrives as x-wq-device, its user agent as user-agent. The logic is web-quiz-push.service.js.
 *
 *   GET  /state        {remind, test, portal}: the edge's /remind/:code page and the portal's teacher card ask before they draw
 *   GET  /key?code=    {key, ask, ask_v?}: the VAPID public key; ask false outside the canary (web_quiz_push_canary);
 *                      ask_v 'a' | 'b' (web_quiz_push_ask_v2 on): the arm, by the phone's x-wq-device
 *   POST /subscribe    {sub, code, lang, chips, chip?, rotate_from?, ps?} → {ok:1} | 409 {err:'class_phone'} | 400 {err:'bad_sub'}
 *   POST /unsubscribe  {endpoint, by?}  POST /opened {endpoint, ps?}   → {ok:1}
 *   POST /test         {endpoint} → {ok:1, sent, status} (web_quiz_push_test only)
 *   POST /e            {step, how?, iab?, lang?, ok?, src?, ps?, dwell_ms?, perm?, after?, ask_v?} → {ok:1}: a page step, allow-listed enums only;
 *                      dwell_ms (whole ms, at most a day) only on the ask's first answer: yes / later / escape / gone
 *                      perm ('denied' | 'default') only on denied; after ('yes') only on gone
 *   POST /delivered    {tag, shown?, err?, ps?} → {ok:1}: the worker showed a reminder (the funnel's delivered step)
 *                      ps?: the page-session id (wq-tel.js) the page sent or kept for its worker; logged, never stored
 *                      /e, /subscribe, /opened, /delivered: a user agent carrying "QFIXQA" (a QA walk) logs qa: true
 *   POST /portal/subscribe|unsubscribe|test   the teacher card (portal_push_remind): the edge adds user_id from its session
 */
const express = require('express');
const { requireInternalKey } = require('../../middleware/require-internal-key');
const { logToFile } = require('../../utils/logger');
const Push = require('./web-quiz-push.service');

function createRouter() {
  const router = express.Router();
  router.use(requireInternalKey);
  router.use(express.json({ limit: '8kb' }));
  // every route here exists only while the switch is on (and every env is set)
  router.use(async (req, res, next) => {
    const s = await Push.switches();
    // the switch could not be read (and never has been): not an off, so the page keeps whatever worker it has
    if (s.unread) return res.status(503).json({ err: 'unavailable' });
    if (!s.remind) return res.status(404).json({ off: true });
    if (req.path.startsWith('/portal/') && !s.portal) return res.status(404).json({ off: true });
    req.pushSwitches = s;
    return next();
  });
  // a refusal carries {status, err}; a result may carry the push service's own status as data ({ok, sent, status})
  const send = (res, out) => (out && out.err ? res.status(out.status || 400).json({ err: out.err }) : res.json(out));
  const wrap = (fn) => async (req, res) => {
    try {
      return send(res, await fn(req));
    } catch (err) {
      logToFile('❌ web quiz push route failed', { route: req.path, error: err.message }, 'error');
      return res.status(500).json({ err: 'failed' });
    }
  };
  const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

  // adv: the child pages' look (web_quiz_adventure_look) from the hub switches' cache, so the landing matches the quiz page
  const advNow = () => { try { return require('../quiz/web-quiz-hub-flags').advNow() === true; } catch (_) { return false; } };
  router.get('/state', (req, res) => res.json({ remind: true, test: req.pushSwitches.test, portal: req.pushSwitches.portal, ...(advNow() ? { adv: true } : {}) }));
  router.get('/key', wrap((req) => Push.keyFor({ code: typeof req.query.code === 'string' ? req.query.code : null, device: req.get('x-wq-device') })));
  router.post('/subscribe', wrap((req) => {
    const b = body(req);
    return Push.subscribe({ sub: b.sub, code: b.code, lang: b.lang, chips_n: b.chips, chip: b.chip, rotate_from: b.rotate_from, ps: b.ps,
      device_ref: req.get('x-wq-device'), ua: req.get('user-agent'), via: 'family_phone' });
  }));
  router.post('/unsubscribe', wrap((req) => Push.unsubscribe({ endpoint: body(req).endpoint, by: body(req).by === 'notification' ? 'notification' : 'page' })));
  router.post('/opened', wrap((req) => Push.markOpened({ endpoint: body(req).endpoint, ps: body(req).ps, ua: req.get('user-agent') })));
  router.post('/test', wrap((req) => Push.sendTest({ endpoint: body(req).endpoint })));
  router.post('/e', wrap((req) => Push.stepEvent(body(req), { ua: req.get('user-agent') })));
  router.post('/delivered', wrap((req) => Push.delivered({ tag: body(req).tag, shown: body(req).shown, err: body(req).err, ps: body(req).ps, ua: req.get('user-agent') })));

  // the teacher card (car C): the edge's portal session names the teacher
  router.post('/portal/subscribe', wrap((req) => {
    const b = body(req);
    return Push.subscribe({ sub: b.sub, lang: b.lang, user_id: b.user_id, ua: req.get('user-agent'), via: 'teacher_portal' });
  }));
  router.post('/portal/unsubscribe', wrap((req) => Push.unsubscribe({ endpoint: body(req).endpoint, by: 'teacher' })));
  router.post('/portal/test', wrap((req) => Push.sendTest({ endpoint: body(req).endpoint })));
  return router;
}

module.exports = { createRouter };
