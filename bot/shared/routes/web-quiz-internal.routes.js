'use strict';
/**
 * /api/internal/wq/* — the web child quiz, called only by the portal (the
 * public edge), which validates, rate-limits and forwards with x-api-key.
 * Every route sits behind the existing requireInternalKey. The logic lives in
 * services/quiz/web-quiz.service.js; this file maps it to HTTP.
 *
 *   GET  /quiz/:code            E2 the quiz, the class's name chips, live counts
 *   POST /session               E3 start (or resume) a child's attempt
 *   POST /answers               E4 record 1..20 answers, idempotent
 *   POST /finish                E5 score, review, scorecard, challenge code
 *   GET  /board/:code           E6 the class league table
 *   GET  /schools/:code         E6b every school's points this week, the viewer's school marked
 *   POST /me                    E7 a phone's children: past scores, friends finished
 *   POST /e                     E8 page events -> logs (allow-listed, no PII)
 *   GET  /media/:code/:qid      E10 302 to a presigned picture (or the bytes)
 *   GET  /videos/:code          E11 "watch another video": lessons of the quiz's grade
 *   POST /videos/start          E12 the code for one of them (minted once per class code)
 */
const express = require('express');
const { requireInternalKey } = require('../middleware/require-internal-key');
const { logToFile } = require('../utils/logger');
const WebQuiz = require('../services/quiz/web-quiz.service');
const WebQuizVideos = require('../services/quiz/web-quiz-videos');
const WebQuizSchools = require('../services/quiz/web-quiz-schools');

const router = express.Router();
router.use(requireInternalKey);

const handle = (fn) => async (req, res) => {
  try {
    const out = await fn(req, res);
    if (res.headersSent) return undefined;
    if (out && out.redirect) return res.redirect(302, out.redirect);
    if (out && out.bytes) {
      res.set('Content-Type', out.contentType);
      res.set('Cache-Control', 'private, max-age=3600');
      return res.send(out.bytes);
    }
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof WebQuiz.WqError) return res.status(err.status).json(err.body);
    logToFile('❌ web-quiz route failed', { path: req.path, error: err.message }, 'error');
    return res.status(500).json({ error: 'server_error' });
  }
};

router.get('/quiz/:code', handle((req) => WebQuiz.getQuiz(req.params.code, { p: req.query.p })));
router.post('/session', handle((req) => WebQuiz.startSession(req.body || {})));
router.post('/answers', handle((req) => WebQuiz.recordAnswers(req.body || {})));
router.post('/finish', handle((req) => WebQuiz.finishSession(req.body || {})));
router.get('/board/:code', handle((req) => WebQuiz.board(req.params.code, { st: req.query.st })));
router.get('/schools/:code', handle((req) => WebQuizSchools.board(req.params.code, { st: req.query.st })));
router.post('/me', handle((req) => WebQuiz.me(req.body || {})));
// The teacher's "Who played?" on their own preview link (signed p token).
router.post('/who', handle((req) => WebQuiz.whoPlayed(req.body || {})));
router.post('/who/fix', handle((req) => WebQuiz.fixWho(req.body || {})));
router.post('/e', handle(async (req, res) => { WebQuiz.events(req.body || {}); res.status(204).end(); }));
router.get('/media/:code/:qid', handle((req) => WebQuiz.media(req.params.code, req.params.qid, { k: req.query.k, z: req.query.z })));
router.get('/videos/:code', handle((req) => WebQuizVideos.list(req.params.code, { st: req.query.st })));
router.post('/videos/start', handle((req) => WebQuizVideos.start(req.body || {})));

module.exports = router;
