'use strict';
/**
 * /api/internal/wq/cl/* — the standing class link (web-quiz-class-link.js), called only by the portal's /j/<code>
 * page and its /api/wq/cl/* forwards. Mounted inside web-quiz-internal.routes.js, behind requireInternalKey.
 * Every answer with the switch off (or a parent off) is 404 not_found, the same as an unknown code.
 *
 *   GET  /cl/:code[?pv=1][&jt=]  the landing: {lang, class_label?} for a live link (no door_shown for pv=1, a link-preview fetch,
 *                           or jt, the teacher card's signed token for this code)
 *   POST /cl/arrive         {code, device_ref, jt?, via?}  → "Whose turn?" (played here) or the teacher step; counts the
 *                           open (class_link_open, via = the landing's marker, else remembered / forward)
 *   POST /cl/teacher        {code, s, tk}                → the letter step, or the teacher step again
 *   POST /cl/letter         {code, s, letter}            → the first-name chips under that letter
 *   POST /cl/pick           {code, s, chip, device_ref}  → {href: /h/<token>}
 *   POST /cl/app            {teacher}                    → the teacher app's Home card {classes, reportHref}
 *   POST /cl/app/tap        {teacher, class_id, how}     → the card's Send / Copy: {ok, href?} (web-quiz-class-link-app.js)
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const CL = require('../services/quiz/web-quiz-class-link');

const router = express.Router();

const serve = (fn) => async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.status(200).json(await fn(req));
  } catch (err) {
    if (err instanceof CL.ClassLinkError) return res.status(err.status).json(err.body);
    logToFile('❌ web quiz class link route failed', { path: req.route && req.route.path, error: err.message }, 'error');
    return res.status(500).json({ error: 'server_error' });
  }
};

// ── the teacher app's Home card (web-quiz-class-link-app.js). `teacher` is trusted ONLY because the portal's
// /api/portal/class-link sets it from the signed-in session, never from the browser; this router sits behind the
// internal key. Off, outside the canary, or not the teacher's class → 404 not_found, as every other /cl answer.
//   POST /app      {teacher}                          → {classes, reportHref}
//   POST /app/tap  {teacher, class_id, how: forward|copy} → {ok, href?}
const App = () => require('../services/quiz/web-quiz-class-link-app');
const ID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idOr400 = (v) => { if (typeof v === 'string' && ID_RX.test(v)) return v; throw new CL.ClassLinkError(400, { error: 'bad_request' }); };
const orNotFound = (v) => { if (!v) throw new CL.ClassLinkError(404, { error: 'not_found' }); return v; };
router.post('/app', serve(async (req) => orNotFound(await App().forApp(idOr400((req.body || {}).teacher)))));
router.post('/app/tap', serve(async (req) => {
  const b = req.body || {};
  if (b.how !== 'forward' && b.how !== 'copy') throw new CL.ClassLinkError(400, { error: 'bad_request' });
  return orNotFound(await App().tap({ teacherId: idOr400(b.teacher), classId: idOr400(b.class_id), how: b.how }));
}));
// ── end the teacher app's Home card ──
router.post('/arrive', serve((req) => CL.arrive(req.body || {})));
router.post('/teacher', serve((req) => CL.teacher(req.body || {})));
router.post('/letter', serve((req) => CL.letter(req.body || {})));
router.post('/pick', serve((req) => CL.pick(req.body || {})));
router.get('/:code', serve((req) => CL.resolve(req.params.code, {
  preview: req.query.pv === '1',
  jt: typeof req.query.jt === 'string' ? req.query.jt : null,
})));

module.exports = router;
