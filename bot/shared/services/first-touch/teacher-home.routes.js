'use strict';
/**
 * /api/internal/th/* — the teacher home, called only by the portal's public edge (dashboard/routes/quiz-teacher.routes.js,
 * which forwards path-for-path with x-api-key). WHO is asking comes only from the signed `th` token
 * (teacher-home.token.js), never from the request.
 *
 *   GET  /quiz/teacher/:token[?lang]     the page shell (HTML). Reads NOTHING: the token check is CPU, every list
 *                                        comes after paint. Expired → the mk.stale page (200); forged → the same (404)
 *   GET  /api/th/home?t&g&lang           the home's JSON (teacher-home.model) with the cards that send from the page
 *                                        already carrying their class message and wa.me link (no fetch between the
 *                                        tap and the navigation); logs teacher_home_open
 *   GET  /api/th/library?t&g&lang        the library card for another grade (the grade chips)
 *   POST /api/th/send {t, kind, id}      a row's class message: kind video (a library quiz id) | share (a library
 *                                        share code id) | again (the teacher's own quiz id) → { message, wa }
 *   POST /api/th/quiz/make {t, kind, id} "Quiz this": kind lesson (the /quiz list key) | coaching (the session id)
 *                                        → { quizId } — the existing job; the chat hand-out still arrives as today
 *   GET  /api/th/quiz/:id?t&lang         the poll: { state: making|ready|failed, message?, wa? }
 *   POST /api/th/confirm {t, looseId, candidateId, decision: same|no|unsure}   one confirm row → 204
 *   POST /api/th/step {t, step, kind?, id?, origin?}   page events → 204 (share_tap logs teacher_send)
 *
 * Switch quiz_teacher_home OFF (absent, false, anything but true, or a failed read): EVERY route answers 404
 * {off:true} before anything else is read or verified; the edge then falls through to today's page.
 * Never a 500: a thrown read → the mk.error page (200) on the page route, 503 {error:'mk.error'} on the JSON routes.
 *
 * Events (ids only, never a phone, a name or a code): teacher_home_open { tk, first, has_lp, has_coaching,
 * zero_kids_open, primary_kind }, teacher_send { tk, kind: quiz|video|story, origin, again, prompted, cls_k },
 * teacher_home.step. `prompted`: the page was opened from a message the bot sent (the token's door is the report);
 * `cls_k`: the keyed class of the code sent (web-quiz-kid clsOf), null when the code is not this teacher's or has none.
 */
const crypto = require('crypto');
const express = require('express');
const { requireInternalKey } = require('../../middleware/require-internal-key');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { clampLanguage } = require('../../config/ux-strings');
const Flags = require('./teacher-home.flags');
const HomeToken = require('./teacher-home.token');
const Page = require('./teacher-home.page');
const Data = require('./teacher-home.data');
const Model = require('./teacher-home.model');
const Send = require('./teacher-home.send');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RX = /^[A-Za-z0-9_:.-]{1,200}$/;
const ASKABLE = Object.freeze(['en', 'ur']);
const COACH_ROLES = new Set(['coach', 'principal', 'school_leader', 'supervisor', 'aeo', 'head']);
const asked = (v) => (ASKABLE.includes(v) ? v : null);
const uuidIn = (v) => (typeof v === 'string' && UUID_RX.test(v) ? v : null);
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const optional = (path) => { try { return require(path); } catch (_) { return null; } };

/**
 * Builds the router. `deps` (tests) stands in for a data source; production passes nothing.
 */
function createRouter(deps = null) {
  const router = express.Router();
  router.use(requireInternalKey);

  // The switch, first: off → 404 {off:true} for every path of this router, whatever the token.
  router.use(async (req, res, next) => {
    let on = false;
    try { on = (await Flags.on()) === true; } catch (_) { on = false; }
    if (!on) return res.status(404).json({ off: true });
    return next();
  });
  router.use(express.json({ limit: '4kb' }));

  function headers(res, csp) {
    res.set({
      'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', ...(csp ? { 'Content-Security-Policy': csp } : {}),
    });
  }
  function messagePage(res, status, id, lang) {
    // one tap back to the chat on every stale / error page (wa.me/<bot>?text=quiz); none when the number is unknown
    const href = require('./teacher-home.copy').chatLink();
    const l = lang === 'en' ? 'en' : 'ur';
    const built = require('./maker.page').buildMessagePage({ lang, id, tap: href ? { href, text: require('./teacher-home.strings').str('th.open.wa', l) } : null });
    headers(res, built.csp);
    return res.status(status).type('html').send(built.html);
  }
  const handlePage = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) {
      logToFile('❌ teacher home page failed', { error: err && err.message }, 'error');
      if (!res.headersSent) messagePage(res, 200, 'mk.error', clampLanguage(asked(req.query && req.query.lang)));
    }
  };
  const handleJson = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) {
      logToFile('❌ teacher home route failed', { route: req.path, error: err && err.message }, 'error');
      if (!res.headersSent) { headers(res); res.status(503).json({ error: 'mk.error' }); }
    }
  };
  /** The token's payload for a JSON route, or the refusal already sent (null). */
  function authorise(t, res) {
    const v = HomeToken.verifyTeacherHome(t);
    if (v && v.ok) return v.ok;
    headers(res);
    res.status(v && v.stale ? 410 : 404).json({ error: 'mk.stale' });
    return null;
  }
  const langFor = (p, req) => Page.pageLang(p.lang, asked(req.query && req.query.lang)).lang;
  const fail = (res, status) => { headers(res); res.status(status).json({ error: 'mk.error' }); };

  /** The teacher's event key: HMAC(kid key, 't|' + users.id)[:16]; null without the key (never an unkeyed hash). */
  function tkOf(uid) {
    const k = process.env.WEB_QUIZ_KID_KEY;
    if (typeof k !== 'string' || Buffer.byteLength(k, 'utf8') < 16) return null;
    return crypto.createHmac('sha256', k).update(`t|${uid}`).digest('hex').slice(0, 16);
  }
  function event(name, uid, fields) {
    try { logEvent(name, { w: 's', ev_v: 3, tk: tkOf(uid), ...fields }); } catch (_) { /* a failed log never decides a response */ }
  }

  /** The teacher's first open of the home ever (a year-long SET NX on the event key); false when it cannot be told. */
  async function firstOpen(uid) {
    const tk = tkOf(uid);
    if (!tk) return false;
    try { return (await require('../cache/railway-redis.service').setNX(`th:open:${tk}`, '1', 400 * 86400)) === true; } catch (_) { return false; }
  }
  async function makerOn() {
    try { return (await require('../quiz/web-quiz-identity-flags').flags()).makerPage === true; } catch (_) { return false; }
  }
  function storiesBaseFor(token) {
    const S = Data.dep(deps, 'Stories');
    return S && typeof S.shelf === 'function' ? `/quiz/teacher/${encodeURIComponent(token)}/stories` : null;
  }
  function cardsFor(lang) {
    const Cards = optional('./cards.page');
    if (!Cards || typeof Cards.cardsFor !== 'function') return [];
    try {
      const bot = require('../quiz/video-quiz-share.service').botNumber();
      return (Cards.cardsFor({ lang, bot }) || []).map((c) => ({ card: c.card, title: c.title, href: c.href }));
    } catch (_) { return []; }
  }
  /** The walk-through persona's view of the lists (the persona module decides; absent → the lists as they are). */
  async function walkLists(user, lists) {
    const P = optional('./walk-persona');
    if (!P || typeof P.forHome !== 'function' || !user || !user.phone_number) return lists;
    try { return (await P.forHome(user.phone_number, lists)) || lists; } catch (_) { return lists; }
  }
  /** "Not a teacher? Change" → a fresh one-question landing from the one door, when it is there (a link, no write here). */
  async function changeLanding(user, lang) {
    const OneDoor = optional('./one-door.service');
    if (!OneDoor || typeof OneDoor.mintLanding !== 'function' || !user || !user.phone_number) return null;
    try {
      const url = await OneDoor.mintLanding({ user, phone: user.phone_number, side: 'unknown', lang: lang === 'en' ? 'bi' : 'ur', src: 'other' });
      if (typeof url !== 'string') return null;
      const at = url.indexOf('/quiz/go/');
      return at >= 0 ? url.slice(at) : null;
    } catch (_) { return null; }
  }
  /**
   * The sandbox walk-through row for a listed test phone (the one door's walk-through module renders it from the go
   * token of the "Change" link): its HTML, or null — for every phone that is not listed, and whenever the module or the
   * link is absent, the home's JSON is exactly what it was.
   */
  async function walkRow(change, lang) {
    const t = typeof change === 'string' ? change.slice('/quiz/go/'.length) : '';
    if (!t || t.includes('/')) return null;
    try {
      const OneDoor = optional('./optional-modules');
      const P = OneDoor && typeof OneDoor.load === 'function' ? OneDoor.load('testPersona') : null;
      if (!P || typeof P.row !== 'function') return null;
      const html = await P.row({ lang, token: t });
      return typeof html === 'string' && html.startsWith('<section data-screen="walk">') ? { html, t } : null;
    } catch (_) { return null; }
  }
  function practiceUrl(user, lang) {
    if (!user || !COACH_ROLES.has(String(user.role || '').toLowerCase())) return null;
    const Join = optional('../quiz/web-quiz-student-join');
    if (!Join || typeof Join.practiceJoinUrl !== 'function') return null;
    try { return Join.practiceJoinUrl({ uid: user.id, lang }) || null; } catch (_) { return null; }
  }

  /** The library card (and, when the top card is a library pick, that pick with its message) for one grade. */
  async function libraryFor({ p, token, lang, grade, tree, pfSubject }) {
    const [stories] = await Promise.all([Data.within(Data.storyShelf(p.uid, grade, lang, deps), Data.SIDE_BUDGET_MS, null, 'stories')]);
    const video = Data.videoPick(tree, grade, pfSubject);
    return { stories, video, storiesBase: stories && stories.length ? storiesBaseFor(token) : null };
  }
  /** Adds the class message + wa.me link to a card that sends from the page; a card that cannot is dropped to null. */
  async function withSend(card, p, lang) {
    if (!card) return card;
    let out = null;
    if (card.kind === 'video') out = await Send.videoSend({ uid: p.uid, lang, quizId: card.id }, deps);
    else if (card.kind === 'class' && card.again && card.again.sendKind === 'again') out = await Send.againSend({ uid: p.uid, lang, quizId: card.again.id }, deps);
    else if (card.kind === 'class' && card.again && card.again.sendKind === 'share') out = await Send.shareSend({ uid: p.uid, lang, shareCodeId: card.again.id }, deps);
    else return card;
    if (!out) return card.kind === 'class' ? { ...card, again: null } : null;
    return { ...card, send: { message: out.message, wa: out.wa, c: out.shareCodeId || null, origin: card.kind === 'video' ? 'library' : 'again', sendKind: card.kind === 'video' ? 'video' : card.again.sendKind } };
  }

  router.get('/quiz/teacher/:token', handlePage(async (req, res) => {
    const v = HomeToken.verifyTeacherHome(req.params.token);
    if (!v) return messagePage(res, 404, 'mk.stale', clampLanguage(asked(req.query.lang)));
    if (v.stale) return messagePage(res, 200, 'mk.stale', v.stale.lang === 'en' ? 'en' : 'ur');
    const { lang, switchTo } = Page.pageLang(v.ok.lang, asked(req.query.lang));
    const built = Page.buildShell({ token: req.params.token, lang, switchTo, asked: asked(req.query.lang) });
    headers(res, built.csp);
    return res.status(200).type('html').send(built.html);
  }));

  router.get('/api/th/home', handleJson(async (req, res) => {
    const p = authorise(req.query.t, res);
    if (!p) return;
    const token = String(req.query.t);
    const lang = langFor(p, req);
    const user = await Data.teacherOf(p.uid, deps);
    if (!user) { headers(res); res.status(404).json({ error: 'mk.stale' }); return; }
    const Bank = Data.dep(deps, 'Bank');
    const Cta = Data.dep(deps, 'Cta');
    const [lessons0, played0, shares0, pf, tree, children, confirm, maker] = await Promise.all([
      Data.within(Data.lessons(p.uid, deps), Data.REPORT_BUDGET_MS, [], 'lessons'),
      Data.within(Data.playedOwn(p.uid, deps), Data.REPORT_BUDGET_MS, new Map(), 'class report'),
      Data.within(Data.libraryShares(p.uid, deps), Data.SIDE_BUDGET_MS, [], 'library shares'),
      Data.within(Cta.prefillOf(p.uid), Data.SIDE_BUDGET_MS, null, 'prefill'),
      Data.within(Bank.chipTree(), Data.SIDE_BUDGET_MS, {}, 'video bank'),
      Data.within(Data.childrenLink(user, deps), Data.SIDE_BUDGET_MS, null, 'children'),
      Data.within(Data.confirmRows(p.uid, deps), Data.SIDE_BUDGET_MS, [], 'confirm queue'),
      makerOn().then((on) => (on ? Data.within(Data.makerLink(p.uid, lang, null, deps), Data.SIDE_BUDGET_MS, null, 'maker link') : null)),
    ]);
    // a listed test phone walking as "a teacher with no lessons yet" (sandbox walk-through only): the lists hidden, never touched
    const { lessons, played, shares } = await walkLists(user, { lessons: lessons0, played: played0, shares: shares0 });
    const grade = Data.gradeOf(req.query.g, pf);
    const pfSubject = (/^grade_[1-5]\|([a-z_]+)$/.exec(String(pf || '')) || [])[1] || null;
    const lib = await libraryFor({ p, token, lang, grade, tree, pfSubject });
    const reports = new Map();
    const ownSent = lessons.filter((r) => (r.state === 'sent' || r.state === 'report_sent') && r.quizId).map((r) => r.quizId);
    if (ownSent.length) {
      const on = await Data.within(Data.dep(deps, 'Gate').teacherReportOn(p.uid), Data.SIDE_BUDGET_MS, false, 'report gate');
      if (on) ownSent.forEach((id) => { const u = Data.dep(deps, 'Gate').reportUrls({ teacherId: p.uid, quizId: id }); if (u) reports.set(id, { live: u.live, remind: u.remind }); });
    }
    const change = await changeLanding(user, lang);
    const home = Model.buildHome({
      first: Data.firstNameOf(user), grade, lessons, played, shares, reports, stories: lib.stories, video: lib.video,
      maker, storiesBase: lib.storiesBase, children, confirm, tryStudent: practiceUrl(user, lang), change,
    });
    const walk = await walkRow(change, lang);
    if (walk) home.walk = walk;
    home.primary = (await withSend(home.primary, p, lang)) || (maker ? { kind: 'make', href: maker } : { kind: 'none' });
    home.cards = maker ? cardsFor(lang) : [];
    home.lang = lang;
    const { facts } = home;
    delete home.facts;
    event('teacher_home_open', p.uid, { first: await firstOpen(p.uid), ...facts, primary_kind: Model.primaryKind(home.primary), via: p.via, lang });
    headers(res);
    res.status(200).json(home);
  }));

  router.get('/api/th/library', handleJson(async (req, res) => {
    const p = authorise(req.query.t, res);
    if (!p) return;
    const lang = langFor(p, req);
    const grade = Data.gradeOf(req.query.g, null);
    const tree = await Data.within(Data.dep(deps, 'Bank').chipTree(), Data.SIDE_BUDGET_MS, {}, 'video bank');
    const lib = await libraryFor({ p, token: String(req.query.t), lang, grade, tree, pfSubject: null });
    const shaped = Model.buildHome({ grade, stories: lib.stories, video: lib.video, storiesBase: lib.storiesBase });
    const pick = shaped.primary.kind === 'story' || shaped.primary.kind === 'video' ? await withSend(shaped.primary, p, lang) : null;
    headers(res);
    res.status(200).json({ ...shaped.library, pick: pick || null });
  }));

  router.post('/api/th/send', handleJson(async (req, res) => {
    const b = bodyOf(req);
    const p = authorise(b.t, res);
    if (!p) return;
    const lang = Page.pageLang(p.lang, asked(b.lang)).lang;
    const id = uuidIn(b.id);
    if (!id) { fail(res, 400); return; }
    let out = null;
    if (b.kind === 'video') out = await Send.videoSend({ uid: p.uid, lang, quizId: id }, deps);
    else if (b.kind === 'share') out = await Send.shareSend({ uid: p.uid, lang, shareCodeId: id }, deps);
    else if (b.kind === 'again') out = await Send.againSend({ uid: p.uid, lang, quizId: id }, deps);
    else { fail(res, 400); return; }
    if (!out) { fail(res, 404); return; }
    headers(res);
    res.status(200).json({ message: out.message, wa: out.wa, c: out.shareCodeId || null });
  }));

  router.post('/api/th/quiz/make', handleJson(async (req, res) => {
    const b = bodyOf(req);
    const p = authorise(b.t, res);
    if (!p) return;
    const lang = Page.pageLang(p.lang, asked(b.lang)).lang;
    const kind = b.kind === 'lesson' || b.kind === 'coaching' ? b.kind : null;
    const id = kind === 'coaching' ? uuidIn(b.id) : (typeof b.id === 'string' && KEY_RX.test(b.id) ? b.id : null);
    if (!kind || !id) { fail(res, 400); return; }
    const user = await Data.teacherOf(p.uid, deps);
    if (!user) { fail(res, 404); return; }
    const out = await Send.startQuiz({ user, kind, id, lang }, deps);
    event('teacher_home.quiz_make', p.uid, { kind, outcome: out.quizId ? 'started' : out.error });
    if (!out.quizId) { fail(res, out.error === 'not_found' ? 404 : 409); return; }
    headers(res);
    res.status(200).json({ quizId: out.quizId });
  }));

  router.get('/api/th/quiz/:id', handleJson(async (req, res) => {
    const p = authorise(req.query.t, res);
    if (!p) return;
    const quizId = uuidIn(req.params.id);
    if (!quizId) { fail(res, 400); return; }
    const out = await Send.quizStatus({ uid: p.uid, lang: langFor(p, req), quizId }, deps);
    if (!out) { fail(res, 404); return; }
    headers(res);
    res.status(200).json(out);
  }));

  router.post('/api/th/confirm', handleJson(async (req, res) => {
    const b = bodyOf(req);
    const p = authorise(b.t, res);
    if (!p) return;
    const looseId = uuidIn(b.looseId);
    const candidateId = uuidIn(b.candidateId);
    if (!looseId || !candidateId || !['same', 'no', 'unsure'].includes(b.decision)) { fail(res, 400); return; }
    // "Not sure" leaves the pair in the queue and writes nothing (as the report page's queue does).
    if (b.decision !== 'unsure') {
      const r = await Data.dep(deps, 'Queue').decide({ teacherUserId: p.uid, looseId, candidateId, decision: b.decision });
      if (!r || !r.ok) { fail(res, r && r.off ? 404 : 409); return; }
    }
    event('teacher_home.step', p.uid, { step: `confirm_${b.decision}` });
    headers(res);
    res.status(204).end();
  }));

  const STEPS = new Set(['share_tap', 'share_copy', 'copy_failed', 'more', 'grade', 'story_tile', 'videos', 'make', 'children', 'try_student', 'card_lp', 'card_coach', 'card_exam']);
  const SEND_KIND = { video: 'video', share: 'video', again: 'quiz', story: 'story' };
  const ORIGINS = new Set(['library', 'again', 'lesson_plan', 'coaching']);
  const PROMPTED_VIAS = new Set(['report']);
  /** The keyed class of a code this teacher holds; null for no code, another teacher's code or a failed read. */
  async function classKeyOf(uid, codeId) {
    if (!codeId) return null;
    try {
      const { data } = await Data.dep(deps, 'supabase').from('quiz_share_codes').select('class_id, teacher_user_id').eq('id', codeId).maybeSingle();
      if (!data || data.teacher_user_id !== uid || !data.class_id) return null;
      return require('../quiz/web-quiz-kid').clsOf(data.class_id) || null;
    } catch (_) { return null; }
  }
  router.post('/api/th/step', handleJson(async (req, res) => {
    const b = bodyOf(req);
    const p = authorise(b.t, res);
    if (!p) return;
    if (!STEPS.has(b.step)) { fail(res, 400); return; }
    if (b.step === 'share_tap' && SEND_KIND[b.kind]) {
      if (uuidIn(b.c)) await require('./teacher-home.sent').markSent(b.c);
      event('teacher_send', p.uid, {
        kind: SEND_KIND[b.kind], origin: ORIGINS.has(b.origin) ? b.origin : 'library', again: b.kind === 'again' || b.kind === 'share', id: uuidIn(b.id),
        prompted: PROMPTED_VIAS.has(p.via), cls_k: await classKeyOf(p.uid, uuidIn(b.c)),
      });
    } else {
      event('teacher_home.step', p.uid, { step: b.step, screen: 'home' });
    }
    headers(res);
    res.status(204).end();
  }));

  // The stories page (/quiz/teacher/<token>/stories): the stories router's own render, when that module is there.
  router.get('/quiz/teacher/:token/stories', (req, res, next) => {
    const Stories = optional('../../routes/story-teacher-internal.routes');
    if (!Stories || typeof Stories.servePage !== 'function') return res.status(404).json({ off: true });
    return Stories.servePage(req, res, next);
  });

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
