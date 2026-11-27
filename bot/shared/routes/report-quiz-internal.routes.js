'use strict';
/**
 * /api/internal/rq/* — "Make a quiz" inside the page the closed-window coaching report opens (/cq, the /cr block).
 * Called only by the portal, which verifies the teacher's signed report token and forwards the session and teacher
 * it names with x-api-key. The logic lives in services/quiz/report-page-quiz.js; this file maps it to HTTP.
 *
 *   POST /state  { sessionId, userId }                       the page's state (held, making, ask, ready, failed, none)
 *   POST /make   { sessionId, userId, surface }              the tap: queue the offer job as the page's
 *   POST /lang   { sessionId, userId, language }             the language picked on the page
 *   POST /pdf    { sessionId, userId }                       { url } a 1-hour link to the quiz's PDF
 *
 * Switch quiz_offer_closed_window.report_page off → 404 on every route. A session that is not that teacher's → 404.
 */
const express = require('express');
const { requireInternalKey } = require('../middleware/require-internal-key');
const { logToFile } = require('../utils/logger');
const PageQuiz = require('../services/quiz/report-page-quiz');

const router = express.Router();
router.use(requireInternalKey);
router.use(express.json({ limit: '8kb' }));

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The route's handler with the switch, the ids and the error answer every route shares. */
const handle = (fn) => async (req, res) => {
  try {
    if (!(await PageQuiz.botSwitchOn())) return res.status(404).json({ error: 'off' });
    const b = req.body || {};
    if (!UUID_RX.test(String(b.sessionId || '')) || !UUID_RX.test(String(b.userId || ''))) return res.status(400).json({ error: 'bad_ids' });
    const out = await fn({ ...b, sessionId: String(b.sessionId), userId: String(b.userId) });
    if (!out) return res.status(404).json({ error: 'not_found' });
    return res.status(200).json(out);
  } catch (err) {
    logToFile('❌ report page quiz route failed', { path: req.path, error: err && err.message }, 'error');
    return res.status(503).json({ error: 'unavailable' });
  }
};

router.post('/state', handle((b) => PageQuiz.pageState(b)));
router.post('/make', handle((b) => PageQuiz.makeFromPage({ sessionId: b.sessionId, userId: b.userId, surface: b.surface })));
router.post('/lang', handle((b) => PageQuiz.chooseLanguage({ sessionId: b.sessionId, userId: b.userId, language: b.language })));
router.post('/pdf', handle(async (b) => {
  const url = await PageQuiz.pdfFor(b);
  return url ? { url } : null;
}));

module.exports = router;
