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
 *   POST /who/class             the teacher binds a hand-out to a class (identity v2)
 *   POST /e                     E8 page events -> logs (allow-listed, no PII)
 *   GET  /media/:code/:qid      E10 302 to a presigned picture (or the bytes)
 *   GET  /videos/:code          E11 "watch another video": lessons of the quiz's grade
 *   POST /videos/start          E12 the code for one of them (minted once per class code)
 *   GET  /pulse/:code           E13 peer pulse: classmates' right answers, from memory
 *   GET  /ch/...  POST /ch/...  the kid's Challenge (POST /ch/live: a temporary key for a live read-aloud) (web-quiz-challenge.js); GET /challenge/results?list=
 *   GET  /art/:id               E14 a share picture (JPEG): card, invite, class, school (web-quiz-art.js)
 *   GET  /hub/:token            the kid hub (web-quiz-hub.js): teacher card, play again, recs
 *   GET  /lib/:code             the video library from a quiz: subjects (grade strip), then chapters
 *   GET  /lib/h/:token          the same from the kid's hub
 *   GET  /videos/dl/:code       302 to a 1-hour link that saves a bank video
 *   POST /hub/:token            the same, from the page with this phone's device_ref (names only for a trusted phone)
 */
const express = require('express');
const { requireInternalKey } = require('../middleware/require-internal-key');
const { logToFile } = require('../utils/logger');
const WebQuiz = require('../services/quiz/web-quiz.service');
const WebQuizVideos = require('../services/quiz/web-quiz-videos');
const WebQuizSchools = require('../services/quiz/web-quiz-schools');
const WebQuizPulse = require('../services/quiz/web-quiz-pulse');
const WebQuizArt = require('../services/quiz/web-quiz-art');
const Timing = require('../services/quiz/web-quiz-timing');
const WebQuizLibrary = require('../services/quiz/web-quiz-library');

const router = express.Router();
router.use(requireInternalKey);
// Every route logs its time and database round trips (web_quiz.timing; slow always, fast sampled).
Timing.patch(require('../config/supabase'));

const handle = (fn) => (req, res) => Timing.run(() => (req.route && req.route.path) || 'other', () => serve(fn, req, res), () => res.statusCode);
const serve = async (fn, req, res) => {
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
// The teacher binds an unbound hand-out to one of their classes (identity v2).
router.post('/who/class', handle((req) => WebQuiz.whoClass(req.body || {})));
router.post('/e', handle(async (req, res) => { WebQuiz.events(req.body || {}); res.status(204).end(); }));
router.get('/media/:code/:qid', handle((req) => WebQuiz.media(req.params.code, req.params.qid, { k: req.query.k, z: req.query.z })));
router.get('/videos/:code', handle((req) => WebQuizVideos.list(req.params.code, { st: req.query.st })));
// device: the phone's device_ref from x-wq-device (the edge's wq_dv cookie), never trusted from the body.
router.post('/videos/start', handle((req) => WebQuizVideos.start({ ...(req.body || {}), device: req.get('x-wq-device') || undefined })));
router.get('/pulse/:code', handle((req) => WebQuizPulse.poll(req.params.code, { st: req.query.st, since: req.query.since }, WebQuiz)));
// M4c challenge — required on first use, so the bot boots without it; a missing module answers 503 'unavailable'.
const challenge = (fn) => handle((req) => {
  let C;
  try {
    C = require('../services/quiz/web-quiz-challenge');
  } catch (err) {
    logToFile('❌ web quiz challenge unavailable', { error: err.message }, 'error');
    throw new WebQuiz.WqError(503, { error: 'unavailable' });
  }
  return fn(C, req);
});
router.get('/ch/result/:ct', challenge((C, req) => C.poll(req.params.ct)));
router.post('/ch/upload', challenge((C, req) => C.presignUpload(req.body || {})));
// Read aloud, live: a temporary Soniox key for one run (web-quiz-soniox-live.js); the server key never leaves the bot.
router.post('/ch/live', challenge((C, req) => C.liveKey(req.body || {})));
router.post('/ch/result', challenge((C, req) => C.submit(req.body || {})));
// x-wq-device: the phone's device_ref, forwarded by the edge from the wq_dv cookie (a hub token opens nothing on another phone).
router.get('/ch/:token', challenge((C, req) => C.menu(req.params.token, { kid: req.query.kid, lang: req.query.lang, device: req.get('x-wq-device') })));
router.get('/ch/:token/:exercise', challenge((C, req) => C.exercise(req.params.token, req.params.exercise, { kid: req.query.kid, lang: req.query.lang, device: req.get('x-wq-device') })));
router.get('/challenge/results', challenge((C, req) => C.listResults({ cls: req.query.class, list: req.query.list })));
// A link preview fetches this with no session: the signed id is the permission, so anyone may cache it.
router.get('/art/:id', async (req, res) => {
  try {
    const out = await WebQuizArt.artImage(req.params.id, { size: req.query.f === 'sq' ? 'sq' : 'og' });
    res.set('Content-Type', out.contentType);
    res.set('Cache-Control', 'public, max-age=600');
    return res.send(out.bytes);
  } catch (err) {
    if (err instanceof WebQuizArt.ArtError) return res.status(err.status).json(err.body);
    logToFile('❌ web-quiz art failed', { error: err.message }, 'error');
    return res.status(500).json({ error: 'server_error' });
  }
});
// M4a hub — the kid hub's boot JSON (a WhatsApp /quiz link names this phone's own children)
router.get('/hub/:token', handle((req) => require('../services/quiz/web-quiz-hub').hub(req.params.token, { kid: req.query.kid, device: req.get('x-wq-device') })));
// M4b library
const q1 = (v) => (typeof v === 'string' ? v.slice(0, 400) : undefined);
router.get('/lib/h/:token', handle((req) => WebQuizLibrary.libHub(req.params.token, { kid: q1(req.query.kid), g: q1(req.query.g), s: q1(req.query.s), device: req.get('x-wq-device') })));
router.get('/lib/:code', handle((req) => WebQuizLibrary.lib(req.params.code, { st: q1(req.query.st), g: q1(req.query.g), s: q1(req.query.s) })));
router.get('/videos/dl/:code', handle((req) => WebQuizLibrary.download(req.params.code, { st: q1(req.query.st), vid: q1(req.query.vid) })));
// The page's own call carries this phone's device_ref (in the body, never the URL): only the
// first phone to open a hub link, or one the children played on, sees their names.
router.post('/hub/:token', handle((req) => require('../services/quiz/web-quiz-hub').hub(req.params.token, { kid: (req.body || {}).kid, device: (req.body || {}).device_ref })));

module.exports = router;
