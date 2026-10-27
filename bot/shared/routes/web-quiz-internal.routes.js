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
 *   POST /bind/mint  GET /bind/status  POST /bind/undo   keep my place: the JUGNU- code, its state, page Undo
 *   GET /join/page/:t  POST /join/grade  POST /join   a child joins on their own: the shell, the grade tap, the one write
 *   POST /e                     E8 page events -> logs (allow-listed, no PII)
 *   GET  /media/:code/:qid      E10 302 to a presigned picture (or the bytes)
 *   GET  /videos/:code          E11 "watch another video": lessons of the quiz's grade
 *   POST /videos/start          E12 the code for one of them (minted once per class code)
 *   GET  /pulse/:code           E13 peer pulse: classmates' right answers, from memory
 *   GET  /ch/:token/back       the class round's hand-back: {to} the round page, or {to:null}
 *   GET  /ch/...  POST /ch/...  the kid's Challenge (POST /ch/live: a temporary key for a live read-aloud) (web-quiz-challenge.js); GET /challenge/results?list=
 *   POST /lr/key                a story page's one-read speech key (web-quiz-live-read-keys.js, web_quiz_live_read_v3)
 *   GET  /art/:id               E14 a share picture (JPEG): card, invite, class, school (web-quiz-art.js)
 *   POST /card  GET /card/:t.png  the finish card (web_quiz_card_v3): a card token for this child's finish, its picture
 *   GET  /card/s/:id            a short share link's card (web_quiz_share_short): {token, url}; 404 + the door's words
 *   GET  /hub/:token            the kid hub (web-quiz-hub.js): teacher card, play again, recs
 *   GET  /lib/:code             the video library from a quiz: subjects (grade strip), then chapters
 *   GET  /lib/h/:token          the same from the kid's hub
 *   GET  /videos/dl/:code       302 to a 1-hour link that saves a bank video
 *   GET  /stories/shelf  GET /stories/shelf/h/:token  GET /stories/book/:id/h/:token  POST /stories/event/h/:token   storybooks (web-quiz-stories.js; web_quiz_stories, off -> 404 stories_off)
 *   POST /hub/:token            the same, from the page with this phone's device_ref (names only for a trusted phone)
 *   GET|POST /hub/:token/grade  the child's grade for the grown-ups sheet, and a grown-up's change for good (web-quiz-grade-change.js; web_quiz_grade_change, off -> 404)
 *   POST /hub/:token/welcome    the child welcome's one write: shown | done | skipped (web-quiz-child-welcome.js; web_quiz_child_welcome, off -> 404)
 *   POST /hubdoor               the results card's door: {href: /h/<token>} for this session's child, bound to its phone
 *   GET  /cl/:code  POST /cl/*  the standing class link /j/<code> (web-quiz-class-link.routes.js)
 *   GET  /juice                 {on}: whether the sound + motion kit is on (the edge's demo page asks)
 */
const express = require('express');
const { requireInternalKey } = require('../middleware/require-internal-key');
const { logToFile } = require('../utils/logger');
const WebQuiz = require('../services/quiz/web-quiz.service');
const WebQuizVideos = require('../services/quiz/web-quiz-videos');
const WebQuizSchools = require('../services/quiz/web-quiz-schools');
const WebQuizPulse = require('../services/quiz/web-quiz-pulse');
const WebQuizArt = require('../services/quiz/web-quiz-art');
// Loaded with the routes: it listens for finished sessions and draws their card picture straight away.
const ShareWarm = require('../services/quiz/web-quiz-share-warm');
// The ranked next thing on a result (web_quiz_next_offer), required on use.
const NextOffer = () => require('../services/quiz/web-quiz-next-offer-result');
const AfterVideo = () => require('../services/quiz/web-quiz-next-offer-video');
// a scored read's coarse feedback band on every result body, and the menu's read_feedback (web_quiz_read_feedback)
const ReadFeedback = () => require('../services/quiz/web-quiz-read-feedback');
// Warm the next thing for the result while the child plays (web_quiz_next_offer; off -> nothing): after the answer, never in it.
const warmNext = (run) => { setImmediate(() => { Promise.resolve().then(run).catch(() => {}); }); };
const WebQuizOg = require('../services/quiz/web-quiz-og');
const Timing = require('../services/quiz/web-quiz-timing');
const WaitUx = require('../services/quiz/web-quiz-wait-ux');
// The busy page (web_quiz_busy_page): the hub and quiz answers say `busy_page: true` only when on.
const Busy = require('../services/quiz/web-quiz-busy-page');
// The child home's files in the portal's early head (web_quiz_home_preload): every hub answer says `home_pre: true` only when on.
const HomePreload = require('../services/quiz/web-quiz-home-preload');
const WebQuizLibrary = require('../services/quiz/web-quiz-library');
const CardImage = require('../services/quiz/web-quiz-card-image');
// One Urdu face (web_quiz_one_face): the quiz, hub and challenge menu answers say `one_face: true` only when on.
const OneFace = require('../services/quiz/web-quiz-one-face');
// A wordless first paint (web_quiz_plain_paint): the quiz and hub answers that say `fast: true` say `plain_paint: true` only when on.
const PlainPaint = require('../services/quiz/web-quiz-plain-paint');
// The closed pages in the child's language (web_quiz_closed_lang): the quiz and hub answers say `closed_lang: true`,
// and a genuine but expired home link's 401 carries the children's `lang`, only when on.
const ClosedLang = require('../services/quiz/web-quiz-closed-lang');
// One button system (web_quiz_one_button): the quiz, hub, challenge menu and library answers say `one_button: true` only when on.
const OneButton = require('../services/quiz/web-quiz-one-button');
// The adventure look (web_quiz_adventure_look): the same three answers say `adv: true` only when on.
const AdvLook = require('../services/quiz/web-quiz-adventure-look');
const PageLang = require('../services/quiz/web-quiz-page-lang');
// A grown-up changes the child's grade (web_quiz_grade_change, JSON true only): the hub answers say `grownups.grade`.
const GradeChange = require('../services/quiz/web-quiz-grade-change');
// The child home's step timings (web_quiz_server_timing): the hub answer's Server-Timing items, only when on.
const StepTiming = require('../services/quiz/web-quiz-server-timing');

const router = express.Router();
router.use(requireInternalKey);
// The hub's boot JSON (GET /hub/:token below) says `one_hop: true` only with web_quiz_one_hop and web_quiz_fast on
// (web-quiz-one-hop.js); off, it is web-quiz-hub.js's answer as it is.
router.get('/hub/:token', require('../services/quiz/web-quiz-one-hop').markHubAnswer);
// Every route logs its time and database round trips (web_quiz.timing; slow always, fast sampled).
Timing.patch(require('../config/supabase'));
// A tap while offline (web_quiz_offline_guard): the hub, menu and quiz answers say `offline_guard: true` only when on.
require('../services/quiz/web-quiz-offline-guard').mount(router);

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

// The finish card's switch rides the page and its preview facts (named only when on): the edge then counts an Urdu
// link's preview in Urdu digits. Read beside the quiz, never after it; off, the payload is today's.
const withCard = (quizP) => Promise.all([quizP, CardImage.field()]).then(([out, card]) => (out && typeof out === 'object' ? Object.assign(out, card) : out));
// A closed class link (404 / 410 with its reason) says `known: true` while web_quiz_link_known_child is ON, so the edge asks
// /known/home for this phone's way home only then. The switch comes from its 30 s cache and is never waited on (a cold
// cache starts one background read and answers today's); switch off, the answer is today's, byte for byte.
async function closedKnows(err) {
  if (err instanceof WebQuiz.WqError && (err.status === 404 || err.status === 410) && err.body && typeof err.body.error === 'string'
    && require('../services/quiz/web-quiz-link-known').peekOn()) err.body = { ...err.body, known: true };
  return err;
}
// Step timings (web_quiz_server_timing, JSON true only): the class link's answer carries this request's own numbers
// (`app;dur`, the round-trip count), as the hub's does, a closed link's answer too; this route reads no switch itself,
// so the hub's batched switch read is refreshed in the background, never waited for. Off: no header, the call as before.
router.get('/quiz/:code', handle(async (req, res) => {
  const out = await PageLang.carry(PlainPaint.carry(ClosedLang.carry(AdvLook.carry(OneButton.carry(Busy.carry(OneFace.carry(withCard(WebQuiz.getQuiz(req.params.code, { p: req.query.p, k: req.query.k }))))))))).catch(async (err) => {
    StepTiming.timeRequest(res, [], { refresh: true });
    throw await closedKnows(err);
  });
  // Every child's page load teaches the preview facts (not a teacher's ?p= preview, which answers differently).
  if (!req.query.p) WebQuizOg.remember(req.params.code, out);
  StepTiming.timeRequest(res, [], { refresh: true });
  return out;
}));
// A shared link's preview facts (web-quiz-og.js): from memory, so a portal worker answers a link preview fast.
router.get('/og/:code', handle((req) => WebQuizOg.forCode(req.params.code, (c) => withCard(WebQuiz.getQuiz(c)))));
// Whether the sound + motion kit is on (web_quiz_juice): the edge serves the kit's demo page only then.
router.get('/juice', handle(async () => ({ on: await require('../services/quiz/web-quiz-juice').flag() })));
router.post('/session', handle(async (req) => {
  const out = await WebQuiz.startSession(req.body || {}, { device: req.get('x-wq-device') || null });
  warmNext(() => NextOffer().warmFromSession(out, { device: req.get('x-wq-device') || null }));
  return out;
}));
// An old, finished class link opened again on the phone that finished it: that child's hub, or {home: null}.
router.post('/linkhome', handle((req) => require('../services/quiz/web-quiz-link-home').home(req.body || {}, WebQuiz.resolveCode)));
// A class link on a phone that holds a child: the children this browser holds, for "Is it <First>?" ({kids: []} when off).
router.post('/known', handle((req) => WebQuiz.knownKids(req.body || {}, { device: req.get('x-wq-device') || null })));
// A CLOSED class link on that phone: its way home ({on:false} when off). The device is x-wq-device, never the body.
router.post('/known/home', handle((req) => require('../services/quiz/web-quiz-link-known').closedHome({ device: req.get('x-wq-device') || undefined })));
// The handset key: the page redeems a bot-sent link's ?x= token once with its device (web-quiz-handset.js).
router.post('/bind', handle((req) => require('../services/quiz/web-quiz-handset').bind(req.body || {}, WebQuiz.WqError)));
router.post('/answers', handle((req) => WebQuiz.recordAnswers(req.body || {})));
router.post('/finish', handle(async (req) => {
  const out = await WebQuiz.finishSession(req.body || {});
  // The share pictures are drawn now, after the answer, so a child who taps Share at once sends a ready picture.
  ShareWarm.afterFinish(out);
  // The finish card (web_quiz_card_v3): {card_v3: true} with the switch on, else nothing added.
  const card = Object.assign(out, await CardImage.field());
  // The ranked next thing (web_quiz_next_offer; off -> {} and the card is today's).
  return { ...card, ...(await NextOffer().finishField(req.body || {}, card, { device: req.get('x-wq-device') || null })) };
}));
router.get('/board/:code', handle((req) => WebQuiz.board(req.params.code, { st: req.query.st })));
router.get('/schools/:code', handle((req) => WebQuizSchools.board(req.params.code, { st: req.query.st })));
router.post('/me', handle((req) => WebQuiz.me(req.body || {})));
// The teacher's "Who played?" on their own preview link (signed p token).
router.post('/who', handle((req) => WebQuiz.whoPlayed(req.body || {})));
router.post('/who/fix', handle((req) => WebQuiz.fixWho(req.body || {})));
// The teacher binds an unbound hand-out to one of their classes (identity v2).
router.post('/who/class', handle((req) => WebQuiz.whoClass(req.body || {})));
// Jugnu's Book for the child a hub chip names on this phone (web-quiz-book.js; web_quiz_challenge_book, fails closed)
router.get('/book/h/:token', handle((req) => require('../services/quiz/web-quiz-book').bookFor({ hub: req.params.token, kid: typeof req.query.kid === 'string' ? req.query.kid.slice(0, 64) : undefined, device: req.get('x-wq-device'), lang: require('../config/ux-strings').clampLanguage(req.query.l) })));
// ── keep my place ── (web-quiz-bind-page.js; web_quiz_phone_bind, off -> {off:true}). The device is x-wq-device, never the body.
const BindPage = () => require('../services/quiz/web-quiz-bind-page');
router.post('/bind/mint', handle((req) => BindPage().mint({ hub: (req.body || {}).hub, kid: (req.body || {}).kid, lang: (req.body || {}).lang, device: req.get('x-wq-device') || undefined })));
router.get('/bind/status', handle((req) => BindPage().status({ code: typeof req.query.code === 'string' ? req.query.code.slice(0, 20) : '' })));
// {from:'join'}: the first home's "Jugnu will remember you on this phone" Undo (a self-join has no code; the phone that joined)
// {from:'home', kid}: the grown-ups corner's "Forget this phone" (the same erase, for the link's whole life)
router.post('/bind/undo', handle((req) => {
  const b = req.body || {};
  const device = req.get('x-wq-device') || undefined;
  if (b.from === 'join') return require('../services/quiz/web-quiz-home-remember').undo({ device, lang: b.lang });
  if (b.from === 'home') return require('../services/quiz/web-quiz-home-remember').forget({ device, kid: b.kid });
  return BindPage().undo({ code: b.code, device });
}));
// ── end keep my place ──
// ── a child joins on their own ── (web-quiz-student-join.js; quiz_student_join, off -> {off:true}). The device is x-wq-device.
const StudentJoin = () => require('../services/quiz/web-quiz-student-join');
// the page's shell answer: 404 with the switch off (the edge then falls through to the portal's own page), else the language
router.get('/join/page/:token', handle(async (req, res) => {
  // web_quiz_one_face rides the join's own settings read: pageInfo says `one_face: true` only when on
  const out = await StudentJoin().pageInfo({ t: req.params.token });
  if (out.off) return res.status(404).json({ error: 'off' });
  if (out.stale) return res.status(410).json({ error: 'stale', lang: out.lang, ...(out.bot ? { bot: out.bot } : {}), ...(out.one_face === true ? { one_face: true } : {}) });
  return out;
}));
router.post('/join/grade', handle((req) => StudentJoin().gradeTap({ t: (req.body || {}).t, grade: (req.body || {}).grade, device: req.get('x-wq-device') || undefined })));
router.post('/join', handle((req) => {
  const b = req.body || {};
  return StudentJoin().join({ t: b.t, grade: b.grade, name: b.name, same: typeof b.same === 'string' ? b.same : null, force: b.force === true, device: req.get('x-wq-device') || undefined });
}));
// ── end join ──
router.post('/e', handle(async (req, res) => { WebQuiz.events(req.body || {}, { device: req.get('x-wq-device') || null }); res.status(204).end(); }));
router.get('/media/:code/:qid', handle((req) => WebQuiz.media(req.params.code, req.params.qid, { k: req.query.k, z: req.query.z })));
router.get('/videos/:code', handle((req) => WebQuizVideos.list(req.params.code, { st: req.query.st })));
// device: the phone's device_ref from x-wq-device (the edge's wq_dv cookie), never trusted from the body.
// a class-less child's watch carries the ranked next thing after it (web_quiz_next_offer; nothing when off)
router.post('/videos/start', handle((req) => WebQuizVideos.start({ ...(req.body || {}), device: req.get('x-wq-device') || undefined }, { onWatch: (a) => AfterVideo().watchNext(a) })));
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
// A final result (a score or a failure, never {pending}) gains the ranked next thing (web_quiz_next_offer; off -> today's).
// A reading's speed (`wcpm`, and the last run's in `previous`) goes only to a phone that may name the run's child
// (web-quiz-hub-device deviceMayName: the phone the run was started on passes); a forwarded result link gets the score.
const speedOk = async (out, ct, device) => {
  if (!('wcpm' in out) && !(out.previous && typeof out.previous === 'object' && 'wcpm' in out.previous)) return true;
  try {
    const c = require('../services/quiz/web-quiz-token').verify(ct, 'c');
    return Boolean(c && c.sid && device && await require('../services/quiz/web-quiz-hub-device').deviceMayName([String(c.sid)], device));
  } catch (_) { return false; }
};
const withNext = async (out, ct, req) => {
  if (!out || typeof out !== 'object') return out;
  const device = req.get('x-wq-device') || null;
  const [ok, next] = await Promise.all([speedOk(out, ct, device), NextOffer().challengeField(out, ct, { device })]);
  if (ok) return { ...out, ...next };
  // nor what it is worked out from: wcpm = correct / (60 - time_left) * 60 (a whole minute's `correct` is the speed itself)
  const { wcpm, previous, ...rest } = out;
  const len = once(() => readLen(ct));
  if (rest.score && typeof rest.score === 'object') { const { correct, time_left, finished_early, ...heard } = rest.score; rest.score = await coarseScore(heard, len); }
  // the feedback band's words heard are the words attempted: another phone hears only none / some / all of the story
  if (rest.feedback && typeof rest.feedback === 'object' && 'words_heard' in rest.feedback) {
    const { words_heard, ...fb } = rest.feedback;
    const n = rest.score && typeof rest.score.attempted === 'number' ? rest.score.attempted : 0;
    const L = n > 1 ? await len() : 0;
    rest.feedback = { ...fb, read: !(words_heard > 0) || !n ? 'none' : L && n >= L ? 'all' : 'some' };
  }
  return { ...rest, ...next };
};
// and the words attempted (a timer-ended minute's count is the speed itself) only as a coarse count by the story's
// length as the page counts it (web-quiz-read-coarse.js); the length unknown: only none / some (0 / 1)
const coarseScore = async (score, len) => {
  if (typeof score.attempted !== 'number') return score;
  return { ...score, attempted: require('../services/quiz/web-quiz-read-coarse').coarseAttempted(score.attempted, await len()) };
};
const readLen = async (ct) => { try { return await require('../services/quiz/web-quiz-challenge').readLength(ct); } catch (_) { return 0; } };
const once = (fn) => { let p = null; return () => (p = p || fn()); };
router.get('/ch/result/:ct', challenge(async (C, req) => withNext(await ReadFeedback().withBand(await C.poll(req.params.ct)), req.params.ct, req)));
router.post('/ch/upload', challenge((C, req) => C.presignUpload(req.body || {}, { device: req.get('x-wq-device') })));
// Read aloud, live: a temporary Soniox key for one run (web-quiz-soniox-live.js); the server key never leaves the bot.
router.post('/ch/live', challenge((C, req) => C.liveKey(req.body || {})));
// Live reading v3: a story page's own one-read temporary key (web-quiz-live-read-keys.js; 404 'off' with the switch off).
router.post('/lr/key', handle((req) => { const b = req.body || {}; return require('../services/quiz/web-quiz-live-read-keys').storyKey({ st: b.st, kid: b.kid, book: b.book, page: b.page, lang: b.lang, device: req.get('x-wq-device') || undefined }); }));
// Questions after Read aloud: the reached questions with their 3 options (no key), then one answer per tap.
router.post('/ch/qs', challenge((C, req) => C.questions(req.body || {})));
router.post('/ch/qa', challenge((C, req) => C.answer(req.body || {})));
// x-wq-device on a result: the phone the mic notice was shown on (marked seen for that child on that phone)
router.post('/ch/result', challenge(async (C, req) => withNext(await ReadFeedback().withBand(await C.submit(req.body || {}, { device: req.get('x-wq-device') })), (req.body || {}).ct, req)));
// the read-along on practice runs: a practice listen's words after its questions; a grown-up's preview of a practice story
router.get('/ch/words/:ct', challenge((C, req) => C.listenWords({ ct: req.params.ct, lang: req.query.lang })));
// x-wq-device: the phone's device_ref, forwarded by the edge from the wq_dv cookie (a hub token opens nothing on another phone).
router.get('/listen/h/:token/:pid', challenge((C, req) => C.listenPreview(req.params.token, req.params.pid, { lang: req.query.lang, device: req.get('x-wq-device') })));
// The child home on (web_quiz_home_v3): {card_fold: true}, so the end cards are the card and one next thing.
// A grown-up's preview (web_quiz_practice_play: the menu says practice_play) folds its end cards too, with no share card
// and no reading moment: those are a child's own finish.
router.get('/ch/:token', challenge(async (C, req) => {
  const menu = await AdvLook.carry(OneButton.carry(OneFace.carry(C.menu(req.params.token, { kid: req.query.kid, lang: req.query.lang, device: req.get('x-wq-device') }))));
  if (menu && menu.practice_play === 1) return Object.assign(menu, await require('../services/quiz/web-quiz-hub-door').menuFoldField());
  return Object.assign(menu, await CardImage.field(), await require('../services/quiz/web-quiz-hub-door').menuFoldField(), await ReadFeedback().menuField(), await require('../services/quiz/web-quiz-fold-retry').menuField());
}));
// Story Time (?room=story&pid=<passage id>, read and listen only): passed on only with web_quiz_challenge_story on; off, ignored.
const storyAsk = async (C, req) => (req.query.room === 'story' && (req.params.exercise === 'read' || req.params.exercise === 'listen') && typeof C.storyOn === 'function' && (await C.storyOn())
  ? { passageId: typeof req.query.pid === 'string' ? req.query.pid : null, room: 'story' } : {});
// The class round's hand-back (/c/<turn token>/back at the edge): {to} the round page the teacher opened, or {to:null}
// (unknown, expired, not a turn) and the edge sends the phone home. Before /ch/:token/:exercise ('back' is no game).
router.get('/ch/:token/back', handle(async (req) => {
  let to = null;
  try { to = await require('../services/quiz/web-quiz-class-round').backTo(req.params.token, { lang: req.query.lang, device: req.get('x-wq-device') || undefined }); } catch (_) { to = null; }
  return { to };
}));
router.get('/ch/:token/:exercise', challenge(async (C, req) => {
  const out = await C.exercise(req.params.token, req.params.exercise, { kid: req.query.kid, lang: req.query.lang, device: req.get('x-wq-device'), ...(await storyAsk(C, req)) });
  warmNext(() => NextOffer().warmFromChallenge(out, { device: req.get('x-wq-device') || null }));
  return out;
}));
router.get('/challenge/results', challenge((C, req) => C.listResults({ cls: req.query.class, list: req.query.list })));
// A link preview fetches this with no session: the signed id is the permission, so anyone may cache it.
router.get('/art/:id', async (req, res) => {
  try {
    // c: the /q/<CODE> the edge was asked under (the class link's picture is drawn only for its own code)
    const code = typeof req.query.c === 'string' ? req.query.c.slice(0, 12) : null;
    // w=door: the invite drawn for the friend's door ("Your turn!" in place of the link pill)
    // l: the share's language (en|ur); drawn in it only with web_quiz_share_pic_lang on, else the code's as today
    const out = await WebQuizArt.artImage(req.params.id, { size: req.query.f === 'sq' ? 'sq' : 'og', code, door: req.query.w === 'door', lang: req.query.l === 'en' || req.query.l === 'ur' ? req.query.l : null });
    res.set('Content-Type', out.contentType);
    // a picture whose link carries its own version (the class link's ?v=) never changes under that link
    res.set('Cache-Control', out.immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=600');
    return res.send(out.bytes);
  } catch (err) {
    if (err instanceof WebQuizArt.ArtError) return res.status(err.status).json(err.body);
    logToFile('❌ web-quiz art failed', { error: err.message }, 'error');
    return res.status(500).json({ error: 'server_error' });
  }
});
// The finish card (web-quiz-card-image.js, web_quiz_card_v3). POST /card: a token for this child's finish (the
// session, run or hub token names the child; the page names only the deed). GET /card/<t>.png: its picture; a link
// preview fetches it with no session, so the sealed token is the permission and anyone may cache it. The token is
// never logged (the access log is the edge's, which logs the route pattern only).
const cardServe = (fn) => async (req, res) => {
  try {
    const out = await fn(req);
    if (out && out.bytes) {
      res.set('Content-Type', out.contentType);
      res.set('Cache-Control', 'public, max-age=86400, immutable');
      return res.send(out.bytes);
    }
    res.set('Cache-Control', 'no-store');
    return res.status(200).json(out);
  } catch (err) {
    if (err instanceof CardImage.CardError) return res.status(err.status).set('Cache-Control', 'no-store').json(err.body);
    logToFile('❌ web-quiz card failed', { error: err.message }, 'error');
    return res.status(500).json({ error: 'server_error' });
  }
};
router.post('/card', cardServe((req) => CardImage.mint(req.body || {}, { device: req.get('x-wq-device') || null })));
router.get('/card/:token.png', cardServe((req) => CardImage.image(req.params.token)));
// A short link's id (web_quiz_share_short): the token and its long path; unknown or expired, a 404 that carries the
// join door's words, so the edge opens the door, never a dead end
router.get('/card/s/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    return res.status(200).json(await CardImage.byShort(req.params.id));
  } catch (err) {
    if (err instanceof CardImage.CardError) return res.status(404).json({ error: 'not_found', ret: CardImage.returnLine('en') });
    logToFile('❌ web-quiz card short link failed', { error: err.message }, 'error');
    return res.status(500).json({ error: 'server_error' });
  }
});
router.get('/card/:token', cardServe(async (req) => CardImage.landing(req.params.token)));
// M4a hub — the kid hub's boot JSON (a WhatsApp /quiz link names this phone's own children)
// `src`: the route that brought the child (hub_open.src), read by the hub_open emit as opts.src.
// `lang`: the language the page that sent the child was in (?lang=, the edge forwards only en|ur); the hub checks it again.
// Step timings (app_settings web_quiz_server_timing, default off, JSON true only): Server-Timing items, one
// `name;dur=<ms>` per awaited step of the build (web-quiz-server-timing.js), added after any timing already on the
// answer. A header only: the JSON is the hub's own. Off: no stopwatch and no header, the call exactly as before.
// web_quiz_edge_learn on: the hub answer says `edge_learn: true` (web-quiz-edge-learn.js carry; from the hub's own switch
// read, no read of its own), so a portal process that stopped asking learns again; off: the answer is untouched.
const EdgeLearn = () => require('../services/quiz/web-quiz-edge-learn');
router.get('/hub/:token', handle((req, res) => {
  const opts = { kid: req.query.kid, device: req.get('x-wq-device'), src: require('../services/quiz/web-quiz-hub-play').srcOf(req.query.src), lang: req.query.lang };
  // the grown-ups corner's language tap on a phone the page render already knows (keep=1, only with a language): kept now
  if (req.query.keep === '1' && (req.query.lang === 'en' || req.query.lang === 'ur')) opts.keep = true;
  const st = StepTiming.on() ? StepTiming.steps() : null;
  if (!st) return ClosedLang.closedHub(GradeChange.carry(PageLang.carry(PlainPaint.carryHub(ClosedLang.carryHub(EdgeLearn().carry(HomePreload.carry(AdvLook.carry(OneButton.carry(Busy.carry(WaitUx.carry(OneFace.carry(require('../services/quiz/web-quiz-hub').hub(req.params.token, opts)))))))))))), req.params.token);
  StepTiming.attach(res, st);
  return ClosedLang.closedHub(GradeChange.carry(PageLang.carry(PlainPaint.carryHub(ClosedLang.carryHub(EdgeLearn().carry(HomePreload.carry(AdvLook.carry(OneButton.carry(Busy.carry(WaitUx.carry(OneFace.carry(require('../services/quiz/web-quiz-hub').hub(req.params.token, { ...opts, st })))))))))))), req.params.token);
}));
// M4b library
const q1 = (v) => (typeof v === 'string' ? v.slice(0, 400) : undefined);
// `l`: the page's language (en|ur, anything else dropped); read only under app_settings web_quiz_videos_v3.
const ql = (v) => (v === 'en' || v === 'ur' ? v : undefined);
// web_quiz_video_shelf: a lesson's small thumbnail for the Videos door's shelves (off: 404 not_found, never kept; a
// lesson with no picture: 404 no_picture, kept 10 minutes so its cards do not ask storage on every view)
router.get('/vt/:vid.webp', async (req, res) => {
  try {
    const Thumb = require('../services/quiz/web-quiz-video-thumb');
    const pic = await Thumb.thumb(req.params.vid);
    if (!pic && (await Thumb.noPicture(req.params.vid))) return res.status(404).set('Cache-Control', `public, max-age=${Math.round(Thumb.NONE_MS / 1000)}`).json({ error: 'no_picture' });
    if (!pic) return res.status(404).set('Cache-Control', 'no-store').json({ error: 'not_found' });
    return res.status(200).set({ 'Content-Type': pic.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' }).send(pic.bytes);
  } catch (err) {
    logToFile('❌ web-quiz video thumb failed', { error: err.message }, 'error');
    return res.status(500).set('Cache-Control', 'no-store').json({ error: 'server_error' });
  }
});
router.get('/lib/h/:token', handle((req) => OneButton.carry(WebQuizLibrary.libHub(req.params.token, { kid: q1(req.query.kid), g: q1(req.query.g), s: q1(req.query.s), l: ql(req.query.l), device: req.get('x-wq-device') }))));
// the v3 home's door screens (web-quiz-hub-doors.js; web_quiz_home_v3, off -> 404 home_off): what is behind Stories / Games
router.get('/doors/h/:token', handle((req) => require('../services/quiz/web-quiz-hub-doors').door(req.params.token, { kid: q1(req.query.kid), d: q1(req.query.d), lang: q1(req.query.l), device: req.get('x-wq-device') })));
router.get('/lib/:code', handle((req) => OneButton.carry(WebQuizLibrary.lib(req.params.code, { st: q1(req.query.st), g: q1(req.query.g), s: q1(req.query.s), l: ql(req.query.l) }))));
router.get('/videos/dl/:code', handle((req) => WebQuizLibrary.download(req.params.code, { st: q1(req.query.st), vid: q1(req.query.vid) })));
// Storybooks (web-quiz-stories.js; web_quiz_stories, fails closed). x-wq-device: this phone's device_ref, as for the library.
const Stories = () => require('../services/quiz/web-quiz-stories');
router.get('/stories/shelf', handle((req) => Stories().shelfPublic({ g: q1(req.query.g), l: q1(req.query.l) })));
router.get('/stories/shelf/h/:token', handle((req) => Stories().shelf(req.params.token, { kid: q1(req.query.kid), g: q1(req.query.g), l: q1(req.query.l), t: q1(req.query.t), device: req.get('x-wq-device') })));
router.get('/stories/book/:id/h/:token', handle((req) => Stories().book(req.params.id, req.params.token, { kid: q1(req.query.kid), device: req.get('x-wq-device') })));
router.post('/stories/event/h/:token', handle((req) => Stories().event(req.params.token, req.body || {}, { device: req.get('x-wq-device') })));
// The page's own call carries this phone's device_ref (in the body, never the URL): only the
// first phone to open a hub link, or one the children played on, sees their names.
router.post('/hub/:token', handle((req) => GradeChange.carry(PageLang.carry(EdgeLearn().carry(HomePreload.carry(AdvLook.carry(OneButton.carry(Busy.carry(WaitUx.carry(OneFace.carry(require('../services/quiz/web-quiz-hub').hub(req.params.token, { kid: (req.body || {}).kid, device: (req.body || {}).device_ref, lang: (req.body || {}).lang, ...((req.body || {}).keep === 1 ? { keep: true } : {}) }))))))))))));
// The grown-ups sheet's Grade row, for the child a hub chip names on a phone the hub trusts (x-wq-device, never the body):
// GET ?kid= -> {now, cls} when the sheet opens; POST {kid, grade} -> 200 {ok, grade}; 400 bad grade; 403 not this link's
// child or another phone; 404 switch off; 429 the day's 6th.
router.get('/hub/:token/grade', handle((req) => GradeChange.get({ token: req.params.token, kid: q1(req.query.kid), device: req.get('x-wq-device') || undefined })));
router.post('/hub/:token/grade', handle((req) => GradeChange.set({ token: req.params.token, kid: (req.body || {}).kid, device: req.get('x-wq-device') || undefined, grade: (req.body || {}).grade })));
// The child welcome's one write (web_quiz_child_welcome; off -> 404): POST {kid, outcome: shown|done|skipped|reset} for the
// child a hub chip names on a phone the hub trusts (x-wq-device) -> {ok}; 400 bad outcome; 403 not this link's child.
router.post('/hub/:token/welcome', handle((req) => require('../services/quiz/web-quiz-child-welcome').record({ token: req.params.token, kid: (req.body || {}).kid, device: req.get('x-wq-device') || undefined, outcome: (req.body || {}).outcome })));
// The results card's door to the child's own hub: a hub link minted for this session's child, bound to this phone.
// The Jugnu card's Play (body.jugnu; web-quiz-card.js) rides the same route: no new route.
router.post('/hubdoor', handle((req) => ((req.body || {}).jugnu ? require('../services/quiz/web-quiz-card').go(req.body, WebQuiz.WqError) : require('../services/quiz/web-quiz-hub-door').door(req.body || {}, WebQuiz.WqError))));

// ─── the teacher join queue (web-quiz-join-queue.js; switch web_quiz_identity_canon, every answer {off:true} or empty when off) ───
// The DASHBOARD-PROXY path. The teacher's results page does not use it: it calls the module's functions from its own
// routes with the teacher taken from the signed report token. Here `teacher` is trusted ONLY because the dashboard's
// proxy sets it from the logged-in teacher's session, never from the browser's body or query; this router is reachable
// only with the internal key (requireInternalKey above). decide and link-codes are idempotent (a resubmit writes once).
//   GET  /teacher/queue?teacher=<id>         → {rows: [Mock M4 row], tiers_served: [tier]} (served now: [] when off or held)
//   POST /teacher/queue/decide {teacher, loose_id, candidate_id, decision: 'same'|'no'|'undo'} → {ok, decision, already?} | {ok:false, reason ('not_served' for a pair not in the served queue)} | {off:true}
//   POST /teacher/queue/link-codes {teacher, class_id} → {linked: n} | {linked: 0, reason} | {off:true}
const JoinQueue = () => require('../services/quiz/web-quiz-join-queue');
router.get('/teacher/queue', handle(async (req) => ({ rows: await JoinQueue().candidatesFor(q1(req.query.teacher)), tiers_served: await JoinQueue().servedTiers() })));
router.post('/teacher/queue/decide', handle((req) => {
  const b = req.body || {};
  return JoinQueue().decide({ teacherUserId: b.teacher, looseId: b.loose_id, candidateId: b.candidate_id, decision: b.decision });
}));
router.post('/teacher/queue/link-codes', handle((req) => JoinQueue().linkClassCodes({ teacherUserId: (req.body || {}).teacher, classId: (req.body || {}).class_id })));
// ─── end of the teacher join queue ───
// ── standing class link (web_quiz_class_link; off → every /cl answer is 404 not_found) ──
router.use('/cl', require('./web-quiz-class-link.routes'));
// ── end standing class link ──
// ── GET /edge: the page switches a fresh portal process would learn from its first payload (web-quiz-edge-learn.js;
// web_quiz_edge_learn, off -> {learn:false}, else {learn:true, fast, brand, rt, ui?, one_face?}) ──
router.get('/edge', handle(() => EdgeLearn().answer()));
// ── end GET /edge ──

module.exports = router;
