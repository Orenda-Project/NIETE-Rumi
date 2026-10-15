'use strict';
/**
 * /api/internal/wq/cl/* — the standing class link (web-quiz-class-link.js), called only by the portal's /j/<code>
 * page and its /api/wq/cl/* forwards. Mounted inside web-quiz-internal.routes.js, behind requireInternalKey.
 * Every answer with the switch off (or a parent off) is 404 not_found, the same as an unknown code.
 *
 *   GET  /cl/:code[?pv=1]   the landing: {lang} for a live link (pv=1: a link-preview fetch, no door_shown)
 *   POST /cl/arrive         {code, device_ref, jt?}      → "Whose turn?" (played here) or the teacher step
 *   POST /cl/teacher        {code, s, tk}                → the letter step, or the teacher step again
 *   POST /cl/letter         {code, s, letter}            → the first-name chips under that letter
 *   POST /cl/pick           {code, s, chip, device_ref}  → {href: /h/<token>}
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

router.post('/arrive', serve((req) => CL.arrive(req.body || {})));
router.post('/teacher', serve((req) => CL.teacher(req.body || {})));
router.post('/letter', serve((req) => CL.letter(req.body || {})));
router.post('/pick', serve((req) => CL.pick(req.body || {})));
router.get('/:code', serve((req) => CL.resolve(req.params.code, { preview: req.query.pv === '1' })));

module.exports = router;
