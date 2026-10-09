'use strict';
/**
 * Reading a finished paper's questions for the portal's paper page (bd-fmf24g.31). One route behind the
 * shared secret; the service owns ownership and shape. Its own file, like the edit routes.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const { requireInternalKey } = require('../middleware/require-internal-key');

const router = express.Router();
const STATUS = { NOT_FOUND: 404, NOT_READY: 409 };

router.post('/assessment/paper/view', requireInternalKey, async (req, res) => {
  const body = req.body || {};
  const userId = String(body.userId || '').trim();
  const paperId = String(body.paperId || '').trim();
  if (!userId) return res.status(400).json({ success: false, error: 'userId is required' });
  if (!paperId) return res.status(400).json({ success: false, error: 'paperId is required' });
  try {
    const View = require('../services/assessment/assessment-paper-view.service');
    const out = await View.view({ userId, paperId });
    if (out.code) return res.status(STATUS[out.code] || 502).json({ success: false, code: out.code });
    return res.json({ success: true, ...out });
  } catch (error) {
    logToFile('❌ Internal assessment paper view failed', { error: error?.message }, 'error');
    return res.status(500).json({ success: false, error: 'Assessment view failed' });
  }
});

module.exports = router;
