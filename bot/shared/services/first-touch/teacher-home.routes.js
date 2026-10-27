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
 *   GET  /api/th/library?t&g&lang        the library card for another grade (the grade chips); a story sent this
 *                                        month is skipped by the pick and dated, as on the home
 *   POST /api/th/send {t, kind, id}      a row's class message: kind video (a library quiz id) | share (a library
 *                                        share code id) | again (the teacher's own quiz id) → { message, wa }
 *   POST /api/th/quiz/make {t, kind, id} "Quiz this": kind lesson (the /quiz list key) | coaching (the session id)
 *                                        → { quizId } — the existing job; the chat hand-out still arrives as today
 *   GET  /api/th/quiz/:id?t&lang         the poll: { state: making|ready|failed, message?, wa? }
 *   POST /api/th/confirm {t, looseId, candidateId, decision: same|no|unsure}   one confirm row → 204
 *   POST /api/th/step {t, step, kind?, id?, origin?}   page events → 204 (share_tap logs teacher_send)
 *   GET  /quiz/teacher/:token/send?c&o&lang   a library code's send: marked sent here, teacher_send, 302 → wa.me
 *
 * Switch quiz_teacher_home_paged ON: /api/th/home starts every read at once (the light list reads, the class report's
 * own-quiz rows, the send-again rows by teacher, the gate, the user, the prefill, the stories shelf) and answers the
 * same JSON as OFF in a few round trips. OFF: today's reads, one after another.
 * Switch quiz_teacher_home_wait ON: the shell carries the slow-answer wait's script (Page.WAIT_MS: «Try again» re-uses
 * the home read still on its way); read in the quick answer's own settings read. OFF: today's.
 * Switch quiz_teacher_home_grade_fast (a JSON true, answered by the quick answer's own app_settings read): the page
 * shell carries the script whose grade chips answer from the page (teacher-home.page FAST_SWAPS); off → today's shell.
 * Switch quiz_teacher_home_portal_link ON (JSON true; the page read): the shell's foot carries "Open my portal" and the
 * home's JSON `portalHref`, the /portal command's own signed link to the portal Home (portalHref below). OFF: today's.
 * Switch quiz_teacher_home OFF (absent, false, anything but true, or a failed read): EVERY route answers 404
 * {off:true} before anything else is read or verified; the edge then falls through to today's page.
 * Switch quiz_teacher_server_timing ON (JSON true; read with quiz_teacher_home, never on its own): every 200 answer of
 * /api/th/home and /api/th/library carries `Server-Timing: settings;dur=…, db;dur=…, total;dur=…` (ms): the switch
 * reads waited on, the data phase that builds the JSON, the whole handler. Refusals and errors carry none. OFF: nothing.
 * Never a 500: a thrown read → the mk.error page (200) on the page route, 503 {error:'mk.error'} on the JSON routes.
 *
 * Events (ids only, never a phone, a name or a code): teacher_home_open { tk, first, has_lp, has_coaching,
 * zero_kids_open, primary_kind, role: coach|teacher }, teacher_send { tk, kind: quiz|video|story, origin, again, prompted, cls_k },
 * teacher_home.step. `prompted`: the page was opened from a message the bot sent (the token's door is the report);
 * `cls_k`: the keyed class of the code sent (web-quiz-kid clsOf), null when the code is not this teacher's or has none.
 */
const express = require('express');
const { requireInternalKey } = require('../../middleware/require-internal-key');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { clampLanguage } = require('../../config/ux-strings');
const Flags = require('./teacher-home.flags');
const MoreFlags = require('./teacher-home.more-flags');
const HomeToken = require('./teacher-home.token');
const Page = require('./teacher-home.page');
const Data = require('./teacher-home.data');
const Model = require('./teacher-home.model');
const Send = require('./teacher-home.send');
const StaleWords = require('./teacher-stories-stale.flag');
const { isRegistered } = require('../../utils/registration-status');

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_RX = /^[A-Za-z0-9_:.-]{1,200}$/;
const ASKABLE = Object.freeze(['en', 'ur']);
const COACH_ROLES = new Set(['coach', 'principal', 'school_leader', 'supervisor', 'aeo', 'head']);
// app_settings web_quiz_practice_play: "Try it as a student" for every teacher. On the home it rides the page switches'
// one read (req.thPractice); this is the fallback for a path without that read (30 s cache; false on any failure)
const practiceOn = () => require('../quiz/web-quiz-practice-play').on().catch(() => false);
// the home open's role tag (web_quiz.* F3): a coach or a leader, else a teacher; never the role row itself
const roleTag = (user) => (user && COACH_ROLES.has(String(user.role || '').toLowerCase()) ? 'coach' : 'teacher');
const PLAYED_MS = 60000;
const PLAYED_MAX = 500;
const ownSentOf = (lessons) => lessons.filter((r) => (r.state === 'sent' || r.state === 'report_sent') && r.quizId).map((r) => r.quizId);
const asked = (v) => (ASKABLE.includes(v) ? v : null);
// A page request: anything but a JSON-only caller (Accept names application/json and not text/html).
const wantsPage = (req) => { const a = String((req.headers && req.headers.accept) || ''); return !/application\/json/i.test(a) || /text\/html/i.test(a); };
const uuidIn = (v) => (typeof v === 'string' && UUID_RX.test(v) ? v : null);
const bodyOf = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const optional = (path) => { try { return require(path); } catch (_) { return null; } };
/** The bot's dialable number, digits only, from the return line's own link (one source), or null. */
function botDigits() {
  try {
    const m = /^https:\/\/wa\.me\/(\d{10,15})\?text=quiz$/.exec(require('./teacher-home.copy').chatLink() || '');
    return m ? m[1] : null;
  } catch (_) { return null; }
}
/** A first-touch module by its name in the registry (`./optional-modules`) when that is on the branch, else by its path; absent or broken → null. */
function byName(name, path) {
  const R = optional('./optional-modules');
  try { if (R && typeof R.load === 'function') { const m = R.load(name); if (m) return m; } } catch (_) { return null; }
  return optional(path);
}

/**
 * Builds the router. `deps` (tests) stands in for a data source; production passes nothing.
 */
function createRouter(deps = null) {
  const router = express.Router();
  router.use(requireInternalKey);

  // The switch, first: off → 404 {off:true} for every path of this router, whatever the token.
  router.use(async (req, res, next) => {
    const start = process.hrtime.bigint(); // Server-Timing's clock; its one cost with the timing switch off
    let on = false;
    try { on = (await Flags.on()) === true; } catch (_) { on = false; }
    if (!on) return res.status(404).json({ off: true });
    // the timing switch rides the home's read (no read, no wait); on → the switch reads so far count as settings
    let timed = false;
    try { timed = Flags.timing() === true; } catch (_) { timed = false; }
    req.thTime = timed ? { start, settings: process.hrtime.bigint() - start, db: null } : null;
    // the quick answer's switch, asked only once the home is on (its own 30 s cache), by the home and its shell
    // (the same read answers quiz_teacher_home_grade_fast, used by the shell alone)
    const sw = req.path === '/api/th/home' || /^\/quiz\/teacher\/[^/]+$/.test(req.path) ? Flags.pageSwitches().then((v) => v || {}, () => ({})) : null;
    req.thPaged = sw ? sw.then((v) => v[Flags.PAGED_KEY] === true) : null;
    // web_quiz_practice_play rides the same page read: "Try it as a student" for every teacher costs no read of its own
    req.thPractice = sw ? sw.then((v) => v[Flags.PRACTICE_KEY] === true) : null;
    req.thWait = sw ? sw.then((v) => v[Flags.WAIT_KEY] === true) : null;
    req.thGradeFast = sw ? sw.then((v) => v[Flags.GRADE_FAST_KEY] === true) : null;
    req.thPortal = sw ? sw.then((v) => v[Flags.PORTAL_LINK_KEY] === true) : null;
    return next();
  });
  router.use(express.json({ limit: '4kb' }));

  function headers(res, csp) {
    res.set({
      'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff', ...(csp ? { 'Content-Security-Policy': csp } : {}),
    });
  }
  async function messagePage(res, status, id, lang, req = null) {
    // one tap back to the chat on every stale / error page (wa.me/<bot>?text=quiz); none when the number is unknown —
    // with web_quiz_closed_way_back ON always ONE tap: the signed go.back sentence, wa.me/<bot>?text=quiz or whatsapp://send?text=quiz
    let tap = null;
    try {
      if ((await require('./closed-way-back.flags').on()) === true) {
        lang = require('./chat-tap').linkLang(req) || lang; // the link's language (?lang=, the token's) before today's choice
        tap = require('./chat-tap').backTap(clampLanguage(lang === 'bi' ? 'ur' : lang), botDigits());
      }
    } catch (_) { tap = null; }
    if (!tap) {
      const href = require('./teacher-home.copy').chatLink();
      const l = lang === 'en' ? 'en' : 'ur';
      tap = href ? { href, text: require('./teacher-home.strings').str('th.open.wa', l) } : null;
    }
    const built = require('./maker.page').buildMessagePage({ lang, id, tap });
    headers(res, built.csp);
    return res.status(status).type('html').send(built.html);
  }
  const handlePage = (fn) => async (req, res) => {
    try { await fn(req, res); } catch (err) {
      logToFile('❌ teacher home page failed', { error: err && err.message }, 'error');
      if (!res.headersSent) await messagePage(res, 200, 'mk.error', clampLanguage(asked(req.query && req.query.lang)), req);
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
  /**
   * The class report's played counts, held 60 s per teacher (the newest 500): only a read that answered is held, and any
   * send, share or mark made from the page drops it (`dropPlayed`; a read that began before a drop is never held).
   */
  const memo = new Map();
  let drops = 0;
  function playedOwn(uid, light = false) {
    const hit = memo.get(uid);
    if (hit && Date.now() - hit.at < PLAYED_MS) return Promise.resolve(hit.v);
    const gen = drops;
    // light (the paged home): the report's own-quiz rows, the same Map (an own quiz's row counts its own codes only)
    return (light ? Data.playedOwn(uid, deps, { light: true }) : Data.playedOwn(uid, deps)).then((v) => {
      if (gen === drops) { memo.delete(uid); memo.set(uid, { at: Date.now(), v }); if (memo.size > PLAYED_MAX) memo.delete(memo.keys().next().value); }
      return v;
    });
  }
  const dropPlayed = (uid) => { drops += 1; memo.delete(uid); };
  const langFor = (p, req) => Page.pageLang(p.lang, asked(req.query && req.query.lang)).lang;
  const fail = (res, status) => { headers(res); res.status(status).json({ error: 'mk.error' }); };
  /** Server-Timing (req.thTime, switch on): a switch wait since `from` counts as settings; the data phase starts. */
  const waited = (req, from) => { if (req.thTime) req.thTime.settings += process.hrtime.bigint() - from; };
  const dataStart = (req) => { if (req.thTime) req.thTime.db = process.hrtime.bigint(); };
  /** Sets Server-Timing just before a 200 body: settings, db (the data phase so far), total (from the router's entry). */
  function serverTiming(req, res) {
    const t = req.thTime;
    if (!t) return;
    const now = process.hrtime.bigint();
    const ms = (ns) => Math.round(Number(ns) / 1e6); // whole ms
    res.set('Server-Timing', `settings;dur=${ms(t.settings)}, db;dur=${ms(t.db == null ? 0n : now - t.db)}, total;dur=${ms(now - t.start)}`);
  }

  /** The teacher's event key, from the shared helper: null without a key of 32+ bytes. It also names the first-open mark,
   *  so a WEB_QUIZ_KID_KEY rotation re-arms every teacher's first open. */
  const tkOf = (uid) => require('../quiz/web-quiz-kid').tk(uid);
  function event(name, uid, fields) {
    try { logEvent(name, { w: 's', ev_v: 3, tk: tkOf(uid), ...fields }); } catch (_) { /* a failed log never decides a response */ }
  }

  /**
   * The teacher's first open of the home ever (a year-long SET NX on the event key); false when it cannot be told. The
   * client's setNX answers true when the store is down or fails (it never blocks its callers), so a true is believed
   * only when the key now reads back. The key is the teacher's tk, so a rotated kid key re-arms every first open.
   */
  async function firstOpen(uid) {
    const tk = tkOf(uid);
    if (!tk) return false;
    try {
      const R = require('../cache/railway-redis.service');
      const key = `th:open:${tk}`;
      return (await R.setNX(key, '1', 400 * 86400)) === true && (await R.get(key)) != null;
    } catch (_) { return false; }
  }
  async function makerOn() {
    try { return (await require('../quiz/web-quiz-identity-flags').flags()).makerPage === true; } catch (_) { return false; }
  }
  /** The stories page for this token, in the page's own language (the stories page follows `lang`, not the token's bi). */
  function storiesBaseFor(token, lang) {
    const S = Data.dep(deps, 'Stories');
    return S && typeof S.shelf === 'function' ? `/quiz/teacher/${encodeURIComponent(token)}/stories?lang=${lang === 'en' ? 'en' : 'ur'}` : null;
  }
  /**
   * The library card's one counts line for the whole teacher: { sent, read } once at least one story went out; null
   * otherwise (its own switch off, no stories module, the stories switch off, nothing sent, a failed read).
   */
  async function storyCountsOf(uid) {
    if (!(await Data.dep(deps, 'CountsFlag').on())) return null;
    const S = Data.dep(deps, 'Stories');
    if (!S || typeof S.storyCounts !== 'function') return null;
    const c = await S.storyCounts(uid);
    const sent = c && Number(c.sent);
    if (!Number.isInteger(sent) || sent < 1) return null;
    const read = Number(c.read);
    return { sent, read: Number.isInteger(read) && read > 0 ? read : 0 };
  }
  function cardsFor(lang) {
    const Cards = byName('cardsPage', './cards.page');
    if (!Cards || typeof Cards.cardsFor !== 'function') return [];
    try {
      const bot = require('../quiz/video-quiz-share.service').botNumber();
      return (Cards.cardsFor({ lang, bot }) || []).map((c) => ({ card: c.card, title: c.title, href: c.href }));
    } catch (_) { return []; }
  }
  /** The walk-through persona's view of the lists (the persona module decides; absent → the lists as they are). */
  async function walkLists(user, lists) {
    const P = byName('testPersona', './walk-persona');
    if (!P || typeof P.forHome !== 'function' || !user || !user.phone_number) return lists;
    try { return (await P.forHome(user.phone_number, lists)) || lists; } catch (_) { return lists; }
  }
  /**
   * "Not a teacher? Change" → a fresh one-question landing from the one door, when it is there (a link, no write here).
   * `src:'change'` keeps the question on screen there (the landing does not send a known teacher straight back).
   */
  async function changeLanding(user, lang) {
    const OneDoor = byName('oneDoor', './one-door.service');
    if (!OneDoor || typeof OneDoor.mintLanding !== 'function' || !user || !user.phone_number) return null;
    try {
      const url = await OneDoor.mintLanding({ user, phone: user.phone_number, side: 'unknown', lang: lang === 'en' ? 'bi' : 'ur', src: 'change' });
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
      const P = byName('testPersona', './walk-persona');
      if (!P || typeof P.row !== 'function') return null;
      const html = await P.row({ lang, token: t });
      return typeof html === 'string' && html.startsWith('<section data-screen="walk">') ? { html, t } : null;
    } catch (_) { return null; }
  }
  /**
   * The teacher's portal Home, signed in: the /portal command's own link (app-login-link 'menu', 24 h, re-tappable),
   * minted here and never read from a URL. null when the page was opened from the portal itself (via 'portal': the
   * browser's back is the way there), for someone not registered (/portal asks them to register first), and when this
   * deployment has no portal address or signing key.
   */
  function portalHref(user, via) {
    if (via === 'portal' || !user || !user.id || !isRegistered(user)) return null;
    try {
      const base = String(require('../../config/branding').portalUrl() || '').replace(/\/+$/, '');
      const t = base ? require('../app-login-link').signAppLink(user.id, 'menu') : null;
      if (t) return `${base}/go/${t}`;
      // the switch is on and the link cannot be made: said at error level, never a silent missing link
      logToFile('❌ teacher home: portal link not minted (no portal address or signing key on this deployment)', { base: Boolean(base) }, 'error');
      return null;
    } catch (err) {
      logToFile('❌ teacher home: portal link failed', { error: err && err.message }, 'error');
      return null;
    }
  }
  // "Try it as a student": a coach's (or a leader's) always; every teacher's with app_settings web_quiz_practice_play on
  // (the preview then plays: web-quiz-practice-play.js). Off: coaches only, as before.
  // playP: the switch's read, started beside the user read (never a serial round trip after the lists)
  async function practiceUrl(user, lang, playP = null) {
    if (!user) return null;
    if (!COACH_ROLES.has(String(user.role || '').toLowerCase()) && !(await (playP || practiceOn()))) return null;
    const Join = byName('studentJoin', '../quiz/web-quiz-student-join');
    if (!Join || typeof Join.practiceJoinUrl !== 'function') return null;
    try { return Join.practiceJoinUrl({ uid: user.id, lang }) || null; } catch (_) { return null; }
  }

  /** The library card (and, when the top card is a library pick, that pick with its message) for one grade. */
  async function libraryFor({ p, token, lang, grade, tree, pfSubject }) {
    const [stories] = await Promise.all([Data.within(Data.storyShelf(p.uid, grade, lang, deps), Data.SIDE_BUDGET_MS, null, 'stories')]);
    const video = Data.videoPick(tree, grade, pfSubject);
    return { stories, video, storiesBase: stories && stories.length ? storiesBaseFor(token, lang) : null };
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
    if (!v) return messagePage(res, 404, 'mk.stale', clampLanguage(asked(req.query.lang)), req);
    if (v.stale) return messagePage(res, 200, 'mk.stale', v.stale.lang === 'en' ? 'en' : 'ur', req);
    const { lang, switchTo } = Page.pageLang(v.ok.lang, asked(req.query.lang));
    // the script's switched parts (each OFF unless JSON true; off, today's shell byte for byte); quiz_teacher_home_grade_fast
    // is answered by the quick answer's switch read above, never a read of its own
    const [named, early, counts, gradeFast] = await Promise.all([MoreFlags.namedOn(), MoreFlags.earlyOn(), Data.dep(deps, 'CountsFlag').on(), req.thGradeFast]);
    const wait = await req.thWait;
    const portal = (await req.thPortal) === true;
    const built = Page.buildShell({ token: req.params.token, lang, switchTo, asked: asked(req.query.lang), ...(await req.thPaged ? { paged: true } : {}), named, early, counts, ...(gradeFast === true ? { gradeFast: true } : {}), ...(wait ? { wait: true } : {}), ...(portal ? { portal: true } : {}) });
    headers(res, built.csp);
    return res.status(200).type('html').send(built.html);
  }));

  /**
   * The quick home's lists, every read started at once: the light /quiz list (Data.lessons light), the class report's
   * own-quiz rows (held 60 s), the library shares, the send-again rows by teacher, the report gate. The walk-through's
   * view applied as on the full answer. → { lessons, played, shares, reports, againable, sendRows }.
   * `soon` = the reads already started by the home.
   */
  async function quickLists(p, user, soon) {
    const [lessons0, played0, shares0, gateOn, sendRows] = await Promise.all([soon.lessons, soon.played, soon.shares, soon.gate, soon.sendRows]);
    const { lessons, played, shares } = await walkLists(user, { lessons: lessons0, played: played0, shares: shares0 });
    const ownSent = ownSentOf(lessons);
    const reports = new Map();
    if (ownSent.length && gateOn) ownSent.forEach((id) => { const u = Data.dep(deps, 'Gate').reportUrls({ teacherId: p.uid, quizId: id }); if (u) reports.set(id, { live: u.live, remind: u.remind }); });
    // "Send again" only where the send would answer (the same rule as sendableOwn); rows unread or late → offered as before
    const againable = sendRows ? new Set([...ownSent, ...played.keys()].filter((id) => sendRows.has(id))) : null;
    return { lessons, played, shares, reports, againable, sendRows };
  }
  function quickReads(uid) {
    return {
      lessons: Data.within(Data.lessons(uid, deps, { light: true }), Data.REPORT_BUDGET_MS, [], 'lessons'),
      played: Data.within(playedOwn(uid, true), Data.REPORT_BUDGET_MS, new Map(), 'class report'),
      shares: Data.within(Data.libraryShares(uid, deps, Date.now(), { light: true }), Data.SIDE_BUDGET_MS, [], 'library shares'),
      gate: Data.within(Data.dep(deps, 'Gate').teacherReportOn(uid), Data.SIDE_BUDGET_MS, false, 'report gate'),
      sendRows: Data.within(Data.sendableRows(uid, deps), Data.SIDE_BUDGET_MS, null, 'send-again check'),
    };
  }

  /** The quick home: the same JSON as today's, its reads started together. */
  async function quickHome(req, res, p, userP, playP = null) {
    const token = String(req.query.t);
    const lang = langFor(p, req);
    const Bank = Data.dep(deps, 'Bank');
    const Cta = Data.dep(deps, 'Cta');
    const soon = quickReads(p.uid);
    const pfP = Data.within(Cta.prefillOf(p.uid), Data.SIDE_BUDGET_MS, null, 'prefill');
    const treeP = Data.within(Bank.chipTree(Date.now(), { quick: true }), Data.SIDE_BUDGET_MS, {}, 'video bank');
    // the grade the page asked for is known now: the stories shelf need not wait for the prefill
    const gradeP = /^[1-5]$/.test(String(req.query.g || '')) ? Promise.resolve(Data.gradeOf(req.query.g, null)) : pfP.then((pf) => Data.gradeOf(req.query.g, pf));
    // the shelf as soon as the grade is known (never after the video bank); the video pick once the bank is in
    const storiesP = gradeP.then((grade) => Data.within(Data.storyShelf(p.uid, grade, lang, deps), Data.SIDE_BUDGET_MS, null, 'stories'));
    const libP = Promise.all([gradeP, pfP, treeP, storiesP]).then(([grade, pf, tree, stories]) => {
      const pfSubject = (/^grade_[1-5]\|([a-z_]+)$/.exec(String(pf || '')) || [])[1] || null;
      return { grade, lib: { stories, video: Data.videoPick(tree, grade, pfSubject), storiesBase: stories && stories.length ? storiesBaseFor(token, lang) : null } };
    });
    const confirmP = Data.within(Data.confirmRows(p.uid, deps), Data.SIDE_BUDGET_MS, [], 'confirm queue');
    const makerP = makerOn().then((on) => (on ? Data.within(Data.makerLink(p.uid, lang, null, deps), Data.SIDE_BUDGET_MS, null, 'maker link') : null));
    const sideP = userP.then((user) => (user ? Promise.all([
      Data.within(Data.childrenLink(user, deps), Data.SIDE_BUDGET_MS, null, 'children'),
      changeLanding(user, lang).then(async (change) => ({ change, walk: await walkRow(change, lang) })),
    ]) : null));
    // a failed user read is answered below (the route's 503); the reads chained on it must not reject unheard
    sideP.catch(() => {});
    const firstP = firstOpen(p.uid);
    const user = await userP;
    if (!user) { headers(res); res.status(404).json({ error: 'mk.stale' }); return; }
    const namedP = MoreFlags.namedOn(); // once the teacher is known (a gone teacher costs no more reads); awaited with the lists
    const countsP = Data.within(storyCountsOf(p.uid), Data.SIDE_BUDGET_MS, null, 'story counts'); // the same, as on the full answer
    const [lists, { grade, lib }, confirm, maker, [children, { change, walk }]] = await Promise.all([quickLists(p, user, soon), libP, confirmP, makerP, sideP]);
    const home = Model.buildHome({
      first: Data.firstNameOf(user), grade, lessons: lists.lessons, played: lists.played, shares: lists.shares, reports: lists.reports,
      stories: lib.stories, video: lib.video, maker, storiesBase: lib.storiesBase, children, confirm, tryStudent: await practiceUrl(user, lang, playP), change,
      againable: lists.againable, named: await namedP,
    });
    const counts = await countsP;
    if (counts && home.library) home.library.counts = counts;
    if (walk) home.walk = walk;
    // the class card's "Send again" from the rows already read; anything else (a library pick) as on the full answer
    const top = home.primary;
    const own = top && top.kind === 'class' && top.again && top.again.sendKind === 'again' && lists.sendRows ? lists.sendRows.get(top.again.id) : null;
    const sent = own ? { ...top, send: { ...pick(Send.againOf(own, top.again.id, lang)), origin: 'again', sendKind: 'again' } } : await withSend(top, p, lang);
    home.primary = sent || (maker ? { kind: 'make', href: maker } : { kind: 'none' });
    home.cards = maker ? cardsFor(lang) : [];
    home.lang = lang;
    home.bot = botDigits();
    if (await req.thPortal) { const ph = portalHref(user, p.via); if (ph) home.portalHref = ph; }
    const { facts } = home;
    delete home.facts;
    event('teacher_home_open', p.uid, { first: await firstP, ...facts, primary_kind: Model.primaryKind(home.primary), via: p.via, lang, role: roleTag(user) });
    serverTiming(req, res);
    headers(res);
    res.status(200).json(home);
  }
  const pick = (out) => ({ message: out.message, wa: out.wa, c: out.shareCodeId || null });

  router.get('/api/th/home', handleJson(async (req, res) => {
    const p = authorise(req.query.t, res);
    if (!p) return;
    // the user read starts alongside the quick answer's switch read (one round trip, not a serial one after it); a
    // failed read is answered where it is awaited (the route's 503), never left unheard
    const asked0 = req.thTime ? process.hrtime.bigint() : null;
    const userP = Data.teacherOf(p.uid, deps);
    userP.catch(() => {});
    const playP = req.thPractice || practiceOn();
    const quick = await req.thPaged;
    waited(req, asked0);
    dataStart(req);
    if (quick) { await quickHome(req, res, p, userP, playP); return; }
    const token = String(req.query.t);
    const lang = langFor(p, req);
    const user = await userP;
    if (!user) { headers(res); res.status(404).json({ error: 'mk.stale' }); return; }
    const Bank = Data.dep(deps, 'Bank');
    const Cta = Data.dep(deps, 'Cta');
    const namedP = MoreFlags.namedOn(); // read alongside the block below, awaited after it
    const gate = (ids) => (ids.length ? Data.within(Data.dep(deps, 'Gate').teacherReportOn(p.uid), Data.SIDE_BUDGET_MS, false, 'report gate') : false);
    // "Send again" only where the send would answer, asked in two halves: the lessons' own sent quizzes as soon as the
    // lessons are in, the class report's quizzes as soon as it is in (less those the lessons' half already asks); the
    // answers joined. Either half failing or running late → offered as before (null), as the one check would.
    const sendableOf = (ids) => (ids.length ? Data.within(Data.sendableOwn(p.uid, ids, deps), Data.SIDE_BUDGET_MS, null, 'send-again check') : new Set());
    const sendable = (idsP, playedP) => {
      let asking = null;
      const mine = Promise.resolve(idsP).then((ids) => { asking = new Set(ids); return sendableOf(ids); });
      const theirs = Promise.resolve(playedP).then((pl) => sendableOf([...pl.keys()].filter((id) => !(asking && asking.has(id)))));
      return Promise.all([mine, theirs]).then(([a, b]) => (a && b ? new Set([...a, ...b]) : null));
    };
    const lessonsP = Data.within(Data.lessons(p.uid, deps), Data.REPORT_BUDGET_MS, [], 'lessons');
    const playedP = Data.within(playedOwn(p.uid), Data.REPORT_BUDGET_MS, new Map(), 'class report');
    // the gate and the send-again check start as soon as their own inputs are in, alongside the other reads
    const [lessons0, played0, shares0, pf, tree, children, confirm, maker, on0, againable0, counts] = await Promise.all([
      lessonsP,
      playedP,
      Data.within(Data.libraryShares(p.uid, deps), Data.SIDE_BUDGET_MS, [], 'library shares'),
      Data.within(Cta.prefillOf(p.uid), Data.SIDE_BUDGET_MS, null, 'prefill'),
      Data.within(Bank.chipTree(), Data.SIDE_BUDGET_MS, {}, 'video bank'),
      Data.within(Data.childrenLink(user, deps), Data.SIDE_BUDGET_MS, null, 'children'),
      Data.within(Data.confirmRows(p.uid, deps), Data.SIDE_BUDGET_MS, [], 'confirm queue'),
      makerOn().then((on) => (on ? Data.within(Data.makerLink(p.uid, lang, null, deps), Data.SIDE_BUDGET_MS, null, 'maker link') : null)),
      lessonsP.then((l) => gate(ownSentOf(l))),
      sendable(lessonsP.then(ownSentOf), playedP),
      Data.within(storyCountsOf(p.uid), Data.SIDE_BUDGET_MS, null, 'story counts'),
    ]);
    // a listed test phone walking as "a teacher with no lessons yet" (sandbox walk-through only): the lists hidden, never touched
    const { lessons, played, shares } = await walkLists(user, { lessons: lessons0, played: played0, shares: shares0 });
    const grade = Data.gradeOf(req.query.g, pf);
    const pfSubject = (/^grade_[1-5]\|([a-z_]+)$/.exec(String(pf || '')) || [])[1] || null;
    const lib = await libraryFor({ p, token, lang, grade, tree, pfSubject });
    const reports = new Map();
    const ownSent = ownSentOf(lessons);
    const walked = lessons !== lessons0 || played !== played0; // the walk-through's lists: both asked again on what it shows
    if (ownSent.length) {
      const on = walked ? await gate(ownSent) : on0;
      if (on) ownSent.forEach((id) => { const u = Data.dep(deps, 'Gate').reportUrls({ teacherId: p.uid, quizId: id }); if (u) reports.set(id, { live: u.live, remind: u.remind }); });
    }
    const change = await changeLanding(user, lang);
    const againable = walked ? await sendable(ownSent, played) : againable0;
    const home = Model.buildHome({
      first: Data.firstNameOf(user), grade, lessons, played, shares, reports, stories: lib.stories, video: lib.video,
      maker, storiesBase: lib.storiesBase, children, confirm, tryStudent: await practiceUrl(user, lang, playP), change, againable,
      named: await namedP,
    });
    // the teacher's story sends and their readers: only once a story went out, else no key (the JSON is as it was)
    if (counts && home.library) home.library.counts = counts;
    const walk = await walkRow(change, lang);
    if (walk) home.walk = walk;
    home.primary = (await withSend(home.primary, p, lang)) || (maker ? { kind: 'make', href: maker } : { kind: 'none' });
    home.cards = maker ? cardsFor(lang) : [];
    home.lang = lang;
    home.bot = botDigits(); // the edge's own error page taps back to the chat with it
    if (await req.thPortal) { const ph = portalHref(user, p.via); if (ph) home.portalHref = ph; }
    const { facts } = home;
    delete home.facts;
    event('teacher_home_open', p.uid, { first: await firstOpen(p.uid), ...facts, primary_kind: Model.primaryKind(home.primary), via: p.via, lang, role: roleTag(user) });
    serverTiming(req, res);
    headers(res);
    res.status(200).json(home);
  }));

  router.get('/api/th/library', handleJson(async (req, res) => {
    const p = authorise(req.query.t, res);
    if (!p) return;
    const lang = langFor(p, req);
    const grade = Data.gradeOf(req.query.g, null);
    // the teacher's own sends (which books went out this month), read alongside the bank and the shelf; late or failed → no skip, no date
    // (a listed walk-through phone sees the same lists here as on its home)
    dataStart(req);
    const played = Promise.all([
      Data.within(Data.playedOwn(p.uid, deps), Data.SIDE_BUDGET_MS, new Map(), 'class report'),
      Data.within(Data.teacherOf(p.uid, deps), Data.SIDE_BUDGET_MS, null, 'teacher'),
    ]).then(([pl, user]) => walkLists(user, { lessons: [], played: pl, shares: [] })).then((l) => l.played);
    const tree = await Data.within(Data.dep(deps, 'Bank').chipTree(), Data.SIDE_BUDGET_MS, {}, 'video bank');
    const lib = await libraryFor({ p, token: String(req.query.t), lang, grade, tree, pfSubject: null });
    const shaped = Model.buildHome({ grade, played: await played, stories: lib.stories, video: lib.video, storiesBase: lib.storiesBase });
    const pick = shaped.primary.kind === 'story' || shaped.primary.kind === 'video' ? await withSend(shaped.primary, p, lang) : null;
    serverTiming(req, res);
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
    dropPlayed(p.uid);
    let out = null;
    if (b.kind === 'video') out = await Send.videoSend({ uid: p.uid, lang, quizId: id }, deps);
    else if (b.kind === 'share') out = await Send.shareSend({ uid: p.uid, lang, shareCodeId: id }, deps);
    else if (b.kind === 'again') out = await Send.againSend({ uid: p.uid, lang, quizId: id }, deps);
    else { fail(res, 400); return; }
    dropPlayed(p.uid); // again after the write: a read that began during it holds nothing
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
    dropPlayed(p.uid);
    const user = await Data.teacherOf(p.uid, deps);
    if (!user) { fail(res, 404); return; }
    const out = await Send.startQuiz({ user, kind, id, lang }, deps);
    dropPlayed(p.uid);
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
    dropPlayed(p.uid);
    // "Not sure" leaves the pair in the queue and writes nothing (as the report page's queue does).
    if (b.decision !== 'unsure') {
      const r = await Data.dep(deps, 'Queue').decide({ teacherUserId: p.uid, looseId, candidateId, decision: b.decision });
      dropPlayed(p.uid);
      if (!r || !r.ok) { fail(res, r && r.off ? 404 : 409); return; }
    }
    event('teacher_home.step', p.uid, { step: `confirm_${b.decision}` });
    headers(res);
    res.status(204).end();
  }));

  const STEPS = new Set(['share_tap', 'share_copy', 'copy_failed', 'more', 'grade', 'story_tile', 'videos', 'make', 'children', 'try_student', 'card_lp', 'card_coach', 'card_exam', 'home_slow', 'home_retry', 'portal']);
  const SEND_KIND = { video: 'video', share: 'video', again: 'quiz', story: 'story' };
  const ORIGINS = new Set(['library', 'again', 'lesson_plan', 'coaching']);
  const PROMPTED_VIAS = new Set(['report']);
  /** A code id → { mine, cls_k }: whether this teacher holds it, and its keyed class; a failed read → not mine. */
  async function codeOf(uid, codeId) {
    if (!codeId) return { mine: false, cls_k: null };
    try {
      const { data } = await Data.dep(deps, 'supabase').from('quiz_share_codes').select('class_id, teacher_user_id').eq('id', codeId).maybeSingle();
      if (!data || data.teacher_user_id !== uid) return { mine: false, cls_k: null };
      return { mine: true, cls_k: data.class_id ? (require('../quiz/web-quiz-kid').clsOf(data.class_id) || null) : null };
    } catch (_) { return { mine: false, cls_k: null }; }
  }
  /**
   * One send: the code (only the teacher's own) is no longer "prepared", then teacher_send is logged once — only after
   * that clear landed. → false when the clear failed (no event).
   */
  async function sent(p, { kind, origin, again, id, c }) {
    dropPlayed(p.uid);
    const code = await codeOf(p.uid, c);
    const marked = !code.mine || await require('./teacher-home.sent').markSent(c);
    dropPlayed(p.uid);
    if (!marked) {
      logToFile('⚠️ teacher home: a send could not be marked sent', { kind });
      return false;
    }
    event('teacher_send', p.uid, { kind, origin: ORIGINS.has(origin) ? origin : 'library', again, id, prompted: PROMPTED_VIAS.has(p.via), cls_k: code.cls_k });
    return true;
  }
  router.post('/api/th/step', handleJson(async (req, res) => {
    const b = bodyOf(req);
    const p = authorise(b.t, res);
    if (!p) return;
    if (!STEPS.has(b.step)) { fail(res, 400); return; }
    if (b.step === 'share_tap' && SEND_KIND[b.kind]) {
      if (!(await sent(p, { kind: SEND_KIND[b.kind], origin: b.origin, again: b.kind === 'again' || b.kind === 'share', id: uuidIn(b.id), c: uuidIn(b.c) }))) { fail(res, 503); return; }
    } else {
      event('teacher_home.step', p.uid, { step: b.step, screen: 'home' });
    }
    headers(res);
    res.status(204).end();
  }));

  // The send itself for a library code (the sheet's "Send to my class"): the code is marked sent HERE, on the server,
  // then 302 → wa.me with the class message — the page's beacon is only a hint. A code that is not this teacher's → the
  // error page, nothing marked.
  router.get('/quiz/teacher/:token/send', handlePage(async (req, res) => {
    const v = HomeToken.verifyTeacherHome(req.params.token);
    if (!v) return messagePage(res, 404, 'mk.stale', clampLanguage(asked(req.query.lang)), req);
    if (v.stale) return messagePage(res, 200, 'mk.stale', v.stale.lang === 'en' ? 'en' : 'ur', req);
    const p = v.ok;
    const lang = Page.pageLang(p.lang, asked(req.query.lang)).lang;
    const c = uuidIn(req.query.c);
    const out = c ? await Send.shareSend({ uid: p.uid, lang, shareCodeId: c }, deps) : null;
    if (!out) return messagePage(res, 404, 'mk.error', lang, req);
    const origin = ORIGINS.has(req.query.o) ? req.query.o : 'library';
    await sent(p, { kind: 'video', origin, again: origin === 'again', id: out.quizId || null, c }); // a failed mark never blocks the send
    headers(res);
    return res.redirect(302, out.wa);
  }));

  // The stories page (/quiz/teacher/<token>/stories): the stories router's own render, when that module is there.
  // Its switch off answers the same {off:true} as this router's, so the edge falls through to today's page.
  router.get('/quiz/teacher/:token/stories', async (req, res, next) => {
    const Stories = optional('../../routes/story-teacher-internal.routes');
    if (!Stories || typeof Stories.servePage !== 'function') return res.status(404).json({ off: true });
    const Svc = optional('../quiz/story-teacher.service');
    let on = true;
    try { on = !Svc || typeof Svc.flagOn !== 'function' || (await Svc.flagOn()) === true; } catch (_) { on = false; }
    if (!on) return res.status(404).json({ off: true });
    // An expired or forged link asked for as a page (quiz_teacher_stories_stale_words): the home's own stale page, as
    // `/` and `/send` answer; a JSON caller keeps the stories router's answer.
    if (wantsPage(req) && (await StaleWords.on())) {
      const v = HomeToken.verifyTeacherHome(req.params.token);
      if (!v) return messagePage(res, 404, 'mk.stale', clampLanguage(asked(req.query.lang)));
      if (v.stale) return messagePage(res, 200, 'mk.stale', asked(req.query.lang) || (v.stale.lang === 'en' ? 'en' : 'ur'));
    }
    return Stories.servePage(req, res, next);
  });

  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
