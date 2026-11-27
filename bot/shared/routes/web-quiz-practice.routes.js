'use strict';
/**
 * /api/internal/wq/practice/* — the practice door (A/B test ict-quiz-practice-door, arm B; services/quiz/test-practice).
 * Called only by the portal's /api/wq/practice/* forwards. Mounted inside web-quiz-internal.routes.js, behind
 * requireInternalKey. Switch off, not in arm B, or not the child's round → 404 not_found, as an unknown route.
 *
 *   POST /start   {st}                    → {topics, rounds_left}
 *   POST /start   {st, topics: [string]}  → {round_id, questions, rounds_left} | {capped: true} | {short: true}
 *   POST /finish  {st, round_id, answers: {qid: 'A'|'B'|'C'}} → {score, total, items}
 * Sends nothing to anyone.
 */
const express = require('express');
const { logToFile } = require('../utils/logger');
const Practice = require('../services/quiz/test-practice/service');

const router = express.Router();

const isStr = (v) => typeof v === 'string' && v.length > 0 && v.length <= 2048;
const topicsOk = (v) => v === undefined || (Array.isArray(v) && v.length <= 20 && v.every((t) => typeof t === 'string' && t.length <= 200));
const answersOk = (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length <= 20;

const serve = (check, fn) => async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const b = req.body || {};
  if (!check(b)) return res.status(400).json({ error: 'bad_request' });
  try {
    const out = await fn(b);
    return out ? res.status(200).json(out) : res.status(404).json({ error: 'not_found' });
  } catch (err) {
    logToFile('❌ web quiz practice route failed', { path: req.route && req.route.path, error: err.message }, 'error');
    return res.status(500).json({ error: 'server_error' });
  }
};

router.post('/start', serve((b) => isStr(b.st) && topicsOk(b.topics), (b) => Practice.start({ st: b.st, topics: b.topics })));
router.post('/finish', serve((b) => isStr(b.st) && isStr(b.round_id) && answersOk(b.answers),
  (b) => Practice.finish({ st: b.st, round_id: b.round_id, answers: b.answers })));

module.exports = router;
