'use strict';
/**
 * /api/internal/sagame/* — the big flight, called only by the portal's edge (dashboard/routes/sa-game.routes.js) with
 * x-api-key. Who the child is comes only from the hub token + chip + the phone's device header.
 *
 *   GET /page/:token?kid&lang    the page's facts (page.js): 404 {off:true} with the switch off (the edge falls through),
 *                                401 when the link does not open as a child on this phone, else {ok, lang, grade, form}
 *
 *   /s/*                         the game's sink (sink.routes.js): a run's session, its batches and its audio
 *
 * Never a 500: a thrown read answers 503 {error:'unavailable'}.
 */
const express = require('express');
const { requireInternalKey } = require('../../middleware/require-internal-key');
const { logToFile } = require('../../utils/logger');
const Page = require('./page');

function createRouter({ page = Page } = {}) {
  const router = express.Router();
  router.use(requireInternalKey);
  // the sink loads on its own: a module that throws costs only the sink (the page still answers)
  try { router.use('/s', require('./sink.routes').createSinkRouter()); } catch (err) { logToFile('❌ sa game sink failed to load — not mounted', { error: err && err.message }, 'error'); }
  router.get('/page/:token', async (req, res) => {
    try {
      const out = await page.info({ token: req.params.token, kid: req.query.kid, device: req.get('x-wq-device') || undefined, lang: req.query.lang });
      if (out.status === 404) return res.status(404).json({ off: true });
      if (out.status !== 200) return res.status(out.status).json({ error: 'not_child' });
      return res.status(200).json(out.body);
    } catch (err) {
      logToFile('⚠️ sa game page: unavailable', { error: err.message });
      return res.status(503).json({ error: 'unavailable' });
    }
  });
  return router;
}

module.exports = { createRouter };
