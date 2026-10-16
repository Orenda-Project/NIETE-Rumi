'use strict';
/**
 * The candidates the next-thing ranker (web-quiz-next-offer.js) chooses from, built from what the hub already reads,
 * and the three call sites' fields (each `{}` with `web_quiz_next_offer` off or on any failure — today's bytes):
 *
 *   hubField({ out, token, history, collect, lang })    the hub boot's `{ next }` (ctx home)
 * (The result cards' fields live in web-quiz-next-offer-result.js, which reads the hub: this module never requires
 * the hub, so the hub's require of it is no cycle.)
 *
 * Every candidate carries an href the child's phone can open (the home's `nextOf` ignores one without), its words in
 * English and Urdu (no test words), and the facts the rules read: `rule` (teacher_quiz / month_stop / resume),
 * `sent_at`, `on_its_way` (a counted stop the draw would answer "a new story is on its way"), `read_aloud`,
 * `needs_root` (a video needs a class quiz: videos/start answers 409 no_class without one), `released_at`, `seen`,
 * `lantern` (today's lantern pick: the control arm's primary). The ids are content ids; a quiz is its keyed `qk`.
 *
 * Storybooks: a module `web-quiz-storybook-next.js` exporting `candidates({ studentId, lang, grade, token, chip })`
 * (the stories reader's) is asked when present; its rows (a half-read book = `rule: 'resume'`) join the list.
 */
const crypto = require('crypto');
const T = require('./web-quiz-token');
const K = require('./web-quiz-kid');
const NO = require('./web-quiz-next-offer');
const { logToFile } = require('../../utils/logger');
const { clampLanguage } = require('../../config/ux-strings');

const PIN_DAYS = 7;
const HUB_DEADLINE_MS = 1500;
const DAY_MS = 86400000;
const READ_ALOUD = new Set(['read']);
const GAME_STOPS = new Set(['missing', 'bigger', 'numbers']);
// The tile's words (a verb phrase a 7-year-old knows; never practice/counted/challenge/trail/test). Urdu: native read owed.
const COPY = {
  quiz: ['From your teacher', 'ٹیچر کی طرف سے'],
  quizOpen: ['Finish your quiz', 'اپنا کوئز پورا کریں'],
  again: ['Play again', 'دوبارہ کھیلیں'],
  video: ['Watch a video', 'ویڈیو دیکھیں'],
  read: ['Read a story with Jugnu', 'جگنو کے ساتھ کہانی پڑھیں'],
  listen: ['Listen to a story', 'کہانی سنیں'],
  game: ['Play with Jugnu', 'جگنو کے ساتھ کھیلیں'],
  numbers: ['Play the numbers game', 'گنتی کا کھیل کھیلیں'],
  sticker: ['See your stickers', 'اپنے اسٹیکرز دیکھیں'],
  invite: ['Invite a friend', 'دوست کو بلائیں'],
};
const words = (k) => ({ title: COPY[k][0], title_ur: COPY[k][1] });
const subOf = (s) => (s ? { sub: String(s), sub_ur: String(s) } : {});

function qkOf(quizId, code) {
  const kid = quizId ? K.qk(quizId) : null;
  if (kid) return kid;
  try {
    return crypto.createHmac('sha256', T.secret()).update(`q|${quizId || code}`).digest('hex').slice(0, 10);
  } catch (_) {
    return null;
  }
}

// ── links ────────────────────────────────────────────────────────────────────────────────────────────

function links({ token, chip, lang, home }) {
  const h = home ? '&home=1' : '';
  const lc = clampLanguage(lang);
  const l = `&lang=${lc}`;
  const ch = token && chip ? `/c/${encodeURIComponent(token)}?kid=${encodeURIComponent(chip)}${l}${h}` : null;
  return {
    ch,
    stop: (ex) => (ch ? `${ch}#${ex}` : null),
    story: (pid) => (ch ? `${ch}&room=story&pid=${encodeURIComponent(pid)}` : null),
    quiz: (code, k, again) => (code ? `/q/${encodeURIComponent(code)}?${again ? 'again=1&' : ''}k=${encodeURIComponent(k || '')}` : null),
    lib: token && chip ? `/lib/${encodeURIComponent(token)}?kid=${encodeURIComponent(chip)}&l=${lc}${h}` : null,
    book: token && chip ? `/h/${encodeURIComponent(token)}?kid=${encodeURIComponent(chip)}${l}#book` : null,
    watch: token && chip ? (vid) => `/h/${encodeURIComponent(token)}?kid=${encodeURIComponent(chip)}${l}#watch/${encodeURIComponent(vid)}` : null,
  };
}

// ── the candidates (pure, from the hub's own data) ──────────────────────────────────────────────────

/**
 * `out` = the hub payload (teacher, last, again, lib, challenge, nav_home, book_on); `history` = the hub's
 * quizzesForStudents rows; `collect` = what the Jugnu corner read ({ trail, onItsWay, live, unseen, lantern, story });
 * `quizIds` = share code -> quiz id; `extra` = more candidates (storybooks, the finish's own). Returns the list.
 */
function candidatesOf({ out = {}, token, history = [], collect = {}, lang = 'en', quizIds = new Map(), storyCodes = new Set(), extra = [], watch = false, nowMs = Date.now() } = {}) {
  const L = links({ token, chip: out.kid, lang, home: out.nav_home });
  const list = [];
  const push = (c) => { if (c && c.href && c.id) list.push(c); };
  const entryOf = (code) => history.find((e) => e && e.code === code) || null;

  // the teacher's quizzes: the hub's teacher card (an open code from the last 7 days), and the quiz left open
  if (out.teacher && out.teacher.code) {
    const t = out.teacher;
    // a storybook the teacher sent rides a quiz row + its code (quiz_source 'story'): the same pin, its own kind
    const story = storyCodes.has(t.code);
    push({ kind: story ? 'storybook' : 'quiz', variant: story ? 'teacher' : 'new', id: story ? `sb.${qkOf(quizIds.get(t.code), t.code)}` : qkOf(quizIds.get(t.code), t.code), href: L.quiz(t.code, t.k),
      ...words('quiz'), ...subOf(t.topic || t.subject), minutes: 3, rule: 'teacher_quiz', sent_at: t.sent_at || null });
  }
  if (out.last && out.last.code && out.last.state === 'open') {
    const e = entryOf(out.last.code) || {};
    // pinned only while never finished (a replay left open on a finished quiz is not "your teacher's quiz" any more)
    const fresh = e.teacherSent && !e.latest && Number.isFinite(Date.parse(e.sentAt)) && nowMs - Date.parse(e.sentAt) <= PIN_DAYS * DAY_MS;
    push({ kind: 'quiz', variant: 'new', id: qkOf(e.quizId, out.last.code), href: L.quiz(out.last.code, out.last.k), ...words('quizOpen'), ...subOf(out.last.topic || out.last.subject),
      minutes: 3, ...(fresh ? { rule: 'teacher_quiz', sent_at: e.sentAt } : {}) });
  }
  // play again: the last finished quiz, then the hub's list (newest first)
  const again = [];
  if (out.last && out.last.code && out.last.state === 'done' && out.last.again) again.push(out.last);
  (out.again || []).forEach((a) => again.push(a));
  again.slice(0, 2).forEach((a) => {
    const e = entryOf(a.code) || {};
    push({ kind: 'quiz', variant: 'again', id: qkOf(e.quizId, a.code), href: L.quiz(a.code, a.k, true), ...words('again'), ...subOf(a.topic || a.subject), minutes: 3 });
  });
  // a video: the library (a recommended video starts by a POST, so the tile opens the library on the child's grade)
  if (out.lib && typeof out.lib.href === 'string' && out.lib.href.startsWith('/lib/') && L.lib) push({ kind: 'video', variant: 'library', id: 'library', href: L.lib, ...words('video'), minutes: 3, needs_root: true });
  // a child with no class quiz: the v3 home's own player watches the recommended lesson (nothing minted, no root needed)
  const rec = (out.recs || []).find((r) => r && r.vid);
  if (watch && rec && !hasRootOf(history) && L.watch) {
    push({ kind: 'video', variant: 'recommended', id: rec.vid, href: L.watch(rec.vid), ...words('video'), ...subOf(rec.title), minutes: 3, ...(rec.poster ? { art: rec.poster } : {}) });
  }

  // the Jugnu corner: this month's stops (rule 2), the stories (newest unseen first), the numbers game
  const lantern = collect.lantern || null;
  (collect.trail || []).forEach((ex, i) => {
    const kind = GAME_STOPS.has(ex) ? 'game' : 'story';
    push({ kind, id: `stop.${ex}`, href: L.stop(ex), ...words(ex === 'read' ? 'read' : ex === 'listen' ? 'listen' : 'game'), minutes: 2,
      rule: 'month_stop', read_aloud: READ_ALOUD.has(ex), on_its_way: Boolean(collect.onItsWay && collect.onItsWay[ex]),
      ...(lantern && lantern.kind === 'trail' && i === 0 ? { lantern: true } : {}) });
  });
  const kindOf = new Map((collect.live || []).map((r) => [r.passage_id, r.kind]));
  (collect.unseen || []).forEach((u) => {
    const listen = kindOf.get(u.pid) === 'listen';
    push({ kind: 'story', id: u.pid, href: L.story(u.pid), ...words(listen ? 'listen' : 'read'), ...subOf(u.title), minutes: 2,
      released_at: u.released_at, seen: false, read_aloud: !listen, ...(lantern && lantern.kind === 'story' && lantern.pid === u.pid ? { lantern: true } : {}) });
  });
  if (collect.story && L.ch) push({ kind: 'game', id: 'numbers', href: L.ch, ...words('numbers'), minutes: 1, ...(lantern && lantern.kind === 'numbers' ? { lantern: true } : {}) });
  if (watch && out.book_on && L.book) push({ kind: 'sticker', id: 'book', href: L.book, ...words('sticker'), minutes: 1 });
  (extra || []).forEach(push);
  return list;
}

// ── the reads (never throw) ──────────────────────────────────────────────────────────────────────────

/** code -> quiz id, and the codes whose quiz row is a storybook send (quiz_source 'story'). Never throws. */
async function quizIdsOf(codes) {
  const want = [...new Set(codes.filter(Boolean))];
  const none = { quizIds: new Map(), storyCodes: new Set() };
  if (!want.length) return none;
  try {
    const { read: dbRead } = require('./web-quiz-db-deadline');
    const { data } = await dbRead('nextOffer:quiz_share_codes:1', (db) => db.from('quiz_share_codes').select('code, quiz_id').in('code', want.slice(0, 20)));
    const quizIds = new Map((data || []).map((r) => [r.code, r.quiz_id]));
    const ids = [...new Set([...quizIds.values()].filter(Boolean))];
    const { data: rows } = ids.length
      ? await dbRead('nextOffer:quizzes:1', (db) => db.from('quizzes').select('id, quiz_source').in('id', ids))
      : { data: [] };
    const story = new Set((rows || []).filter((q) => q.quiz_source === 'story').map((q) => q.id));
    return { quizIds, storyCodes: new Set([...quizIds].filter(([, id]) => story.has(id)).map(([code]) => code)) };
  } catch (_) {
    return none;
  }
}

/**
 * Would the counted serve of this stop answer "on its way"? The serve's own rule (web-quiz-challenge.js serveV2), read
 * from the draw module's exported parts: only a read/listen stop in check mode with the pool on can be; a read that
 * fails is "yes" (fail closed: never offer what may not open).
 */
async function onItsWayOf(canonicalId, rawId, stops, lang, grade) {
  const out = {};
  const ask = (stops || []).filter((ex) => ex === 'read' || ex === 'listen');
  if (!ask.length) return out;
  try {
    const s = await NO.switches();
    if (!s.pool) return out;
    const D = require('./web-quiz-challenge-draw');
    // the draw compares grades as numbers (serveV2 passes the visit's number); the hub's grade is a string
    const g = Number(grade) || null;
    const [rows, periodRows, fixed] = await Promise.all([D.childRows(canonicalId, [rawId]), D.periods(), D.fixedGradeOf(canonicalId, g)]);
    if (rows.readFailed) { ask.forEach((ex) => { out[ex] = true; }); return out; }
    const periodNow = D.periodIdFor(new Date(), periodRows);
    const registry = await D.registryPassages();
    const ob = await D.openBand(canonicalId, fixed.grade);
    const band = D.drawBand({ fixedGrade: fixed.grade, openBand: ob.band, lastCountedRead: D.lastCountedRead(rows) });
    ask.forEach((ex) => {
      if (periodNow && D.countedThisPeriod(rows, ex, periodNow, lang)) return;   // a practice serve: never on its way
      if (registry.provenanceMissing) { out[ex] = true; return; }
      const d = D.drawPassage({ rows: registry.filter((r) => r.pool === 'check'), seenIds: D.seenIdsOf(rows), kind: ex, lang, band: band.band,
        band_reason: band.band_reason, now: new Date(), seed: '00000000000000000000000000000000', counted: true });
      if (d.outcome === 'on_its_way') out[ex] = true;
    });
    return out;
  } catch (_) {
    ask.forEach((ex) => { out[ex] = true; });
    return out;
  }
}

async function storybooks(args) {
  let mod = null;
  try { mod = require('./web-quiz-storybook-next'); } catch (_) { return []; }
  try {
    const rows = typeof mod.candidates === 'function' ? await mod.candidates(args) : [];
    return Array.isArray(rows) ? rows : [];
  } catch (_) {
    return [];
  }
}

const hasRootOf = (history) => (history || []).some((e) => e && e.teacherSent);

// ── the call sites ───────────────────────────────────────────────────────────────────────────────────

/** Resolves to the promise's value, or null past `ms` (the caller then adds nothing). */
function withDeadline(p, ms) {
  let timer;
  return Promise.race([p, new Promise((res) => { timer = setTimeout(() => res(null), ms); })]).finally(() => clearTimeout(timer));
}

async function hubNext({ out, token, history, collect, lang, chosenId, grade, watch }) {
  const [{ quizIds, storyCodes }, books, onItsWay] = await Promise.all([
    quizIdsOf([out.teacher && out.teacher.code, out.last && out.last.code, ...(out.again || []).map((a) => a.code)]),
    storybooks({ studentId: chosenId, lang, grade, token, chip: out.kid }),
    onItsWayOf(chosenId, chosenId, collect.trail, lang, grade),
  ]);
  const candidates = candidatesOf({ out, token, history, collect: { ...collect, onItsWay }, lang, quizIds, storyCodes, extra: books, watch });
  const next = await NO.nextFor({ ctx: 'home', studentId: chosenId, candidates, hasRoot: hasRootOf(history), lang });
  return next ? { next } : {};
}

/**
 * The hub boot's `{ next }` (ctx home), from the payload the hub has just built (`chosenId` = the child's known id).
 * `{}` when off, on any failure, or past the deadline: the hub JSON is fetched after paint, and a slow read here
 * must never hold it.
 */
async function hubField({ out, token, history, collect = {}, lang, chosenId, grade } = {}) {
  try {
    const sw = await NO.switches();
    if (!out || !chosenId || !sw.on) return {};
    return (await withDeadline(hubNext({ out, token, history, collect, lang, chosenId, grade, watch: sw.watch }), HUB_DEADLINE_MS)) || {};
  } catch (err) {
    logToFile('⚠️ web quiz next offer: hub field unavailable', { error: err.message });
    return {};
  }
}

module.exports = { candidatesOf, hubField, withDeadline, quizIdsOf, onItsWayOf, storybooks, hasRootOf, qkOf, words, subOf, links, COPY };
