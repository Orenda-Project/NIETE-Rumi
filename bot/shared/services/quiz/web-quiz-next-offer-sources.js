'use strict';
/**
 * The candidates the next-thing ranker (web-quiz-next-offer.js) chooses from, built from what the hub already reads,
 * and the three call sites' fields (each `{}` with `web_quiz_next_offer` off or on any failure — today's bytes):
 *
 *   hubPrep({ out, token, history, lang, chosenId, grade, stopsOf })   the slot's own reads, started by the hub BESIDE
 *                                                       Jugnu's corner and the Book (never after them): a promise that
 *                                                       never rejects (web_quiz_fast: one of the hub's parallel
 *                                                       branches, `out` a promise of the cards it needs)
 *   hubField({ out, token, history, collect, lang, prep })  the hub boot's `{ next }` (ctx home), from that prep
 * (The result cards' fields live in web-quiz-next-offer-result.js, which reads the hub: this module never requires
 * the hub, so the hub's require of it is no cycle.)
 *
 * Every candidate carries an href the child's phone can open (the home's `nextOf` ignores one without), its words in
 * English and Urdu (no test words), its picture (`art`: the subject's / grade's / the poster / the book's cover, else
 * Jugnu's own for the kind — never none), a teacher's new item its `tag`, and the facts the rules read: `rule` (teacher_quiz / month_stop / resume),
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
const HUB_DEADLINE_MS = 1200;
const DAY_MS = 86400000;
const READ_ALOUD = new Set(['read']);
const GAME_STOPS = new Set(['missing', 'bigger', 'numbers']);
// The tile's words (a verb phrase a 7-year-old knows; never practice/counted/challenge/trail/test). Urdu: native-read.
const COPY = {
  quiz: ['From your teacher', 'ٹیچر کی طرف سے'],
  quizOpen: ['Finish your quiz', 'اپنا کوئز پورا کریں'],
  again: ['Play again', 'دوبارہ کھیلیں'],
  video: ['Watch a video', 'ویڈیو دیکھیں'],
  read: ['Read to Jugnu', 'جگنو کو پڑھ کر سناؤ'],
  listen: ['Listen to a story', 'کہانی سنیں'],
  game: ['Play with Jugnu', 'جگنو کے ساتھ کھیلیں'],
  numbers: ['Play the numbers game', 'گنتی کا کھیل کھیلیں'],
  sticker: ['See your stickers', 'اپنے اسٹیکرز دیکھیں'],
  invite: ['Invite a friend', 'دوست کو بلائیں'],
};
const words = (k) => ({ title: COPY[k][0], title_ur: COPY[k][1] });
// A teacher's new item: "New" (Urdu agrees with the tile's noun: کوئز is masculine, a book's کہانی feminine).
const TAG = { quiz: { tag: 'New', tag_ur: 'نیا' }, storybook: { tag: 'New', tag_ur: 'نئی' } };
// Jugnu's own picture for a kind with no picture of its own (the app's shipped files: one-year cache, a few KB each).
const JUGNU_ART = {
  quiz: '/wq/jugnu/thinking.webp', video: '/wq/jugnu/idle.webp', read: '/wq/jugnu/hello.webp', listen: '/wq/jugnu/idle.webp',
  game: '/wq/jugnu/correct.webp', sticker: '/wq/jugnu/celebrate.webp', invite: '/wq/jugnu/hello.webp', storybook: '/wq/jugnu/hello.webp',
};
const artOr = (own, kind) => ({ art: (typeof own === 'string' && own) || JUGNU_ART[kind] });

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
 * `out` = the hub payload (teacher, last, again, lib, challenge, nav_home, book_on); `subjectArt` = the hub's subject
 * picture (subject -> path | null); `history` = the hub's
 * quizzesForStudents rows; `collect` = what the Jugnu corner read ({ trail, onItsWay, live, unseen, lantern, story });
 * `quizIds` = share code -> quiz id; `extra` = more candidates (storybooks, the finish's own). Returns the list.
 */
function candidatesOf({ out = {}, token, history = [], collect = {}, lang = 'en', quizIds = new Map(), storyCodes = new Set(), unsentCodes = new Set(), known = null, covers = new Map(), subjectArt = () => null, extra = [], watch = false, nowMs = Date.now() } = {}) {
  const L = links({ token, chip: out.kid, lang, home: out.nav_home });
  const list = [];
  const push = (c) => { if (c && c.href && c.id) list.push(c); };
  const entryOf = (code) => history.find((e) => e && e.code === code) || null;

  // the teacher's quizzes: the hub's teacher card (an open code from the last 7 days), and the quiz left open.
  // Fail closed: a card whose quiz row could not be read (`known` = the codes whose row was) is never offered — it
  // might be a storybook the teacher only previewed.
  if (out.teacher && out.teacher.code && !unsentCodes.has(out.teacher.code) && (!known || known.has(out.teacher.code))) {
    const t = out.teacher;
    // a storybook the teacher sent rides a quiz row + its code (quiz_source 'story'): the same pin, its own kind
    const story = storyCodes.has(t.code);
    const kind = story ? 'storybook' : 'quiz';
    push({ kind, variant: story ? 'teacher' : 'new', id: story ? `sb.${qkOf(quizIds.get(t.code), t.code)}` : qkOf(quizIds.get(t.code), t.code), href: L.quiz(t.code, t.k),
      ...words('quiz'), ...subOf(t.topic || t.subject), minutes: 3, ...artOr(story ? covers.get(t.code) : (t.art || subjectArt(t.subject)), kind), ...TAG[kind],
      rule: 'teacher_quiz', sent_at: t.sent_at || null });
  }
  if (out.last && out.last.code && out.last.state === 'open') {
    const e = entryOf(out.last.code) || {};
    // pinned only while never finished (a replay left open on a finished quiz is not "your teacher's quiz" any more)
    const fresh = e.teacherSent && !e.latest && Number.isFinite(Date.parse(e.sentAt)) && nowMs - Date.parse(e.sentAt) <= PIN_DAYS * DAY_MS;
    push({ kind: 'quiz', variant: 'new', id: qkOf(e.quizId, out.last.code), href: L.quiz(out.last.code, out.last.k), ...words('quizOpen'), ...subOf(out.last.topic || out.last.subject),
      minutes: 3, ...artOr(out.last.art || subjectArt(out.last.subject), 'quiz'), ...(fresh ? { rule: 'teacher_quiz', sent_at: e.sentAt } : {}) });
  }
  // play again: the last finished quiz, then the hub's list (newest first)
  const again = [];
  if (out.last && out.last.code && out.last.state === 'done' && out.last.again) again.push(out.last);
  (out.again || []).forEach((a) => again.push(a));
  again.slice(0, 2).forEach((a) => {
    const e = entryOf(a.code) || {};
    push({ kind: 'quiz', variant: 'again', id: qkOf(e.quizId, a.code), href: L.quiz(a.code, a.k, true), ...words('again'), ...subOf(a.topic || a.subject), minutes: 3,
      ...artOr(a.art || subjectArt(a.subject), 'quiz') });
  });
  // a video: the library (a recommended video starts by a POST, so the tile opens the library on the child's grade)
  if (out.lib && typeof out.lib.href === 'string' && out.lib.href.startsWith('/lib/') && L.lib) {
    push({ kind: 'video', variant: 'library', id: 'library', href: L.lib, ...words('video'), minutes: 3, ...artOr(out.lib.art, 'video'), needs_root: true });
  }
  // a child with no class quiz: the v3 home's own player watches the recommended lesson (nothing minted, no root needed)
  const rec = (out.recs || []).find((r) => r && r.vid);
  if (watch && rec && !hasRootOf(history) && L.watch) {
    push({ kind: 'video', variant: 'recommended', id: rec.vid, href: L.watch(rec.vid), ...words('video'), ...subOf(rec.title), minutes: 3, ...artOr(rec.poster || rec.art, 'video') });
  }

  // the Jugnu corner: this month's stops (rule 2), the stories (newest unseen first), the numbers game
  const lantern = collect.lantern || null;
  (collect.trail || []).forEach((ex, i) => {
    const kind = GAME_STOPS.has(ex) ? 'game' : 'story';
    const w = ex === 'read' ? 'read' : ex === 'listen' ? 'listen' : 'game';
    push({ kind, id: `stop.${ex}`, href: L.stop(ex), ...words(w), minutes: 2, ...artOr(null, w),
      rule: 'month_stop', read_aloud: READ_ALOUD.has(ex), on_its_way: Boolean(collect.onItsWay && collect.onItsWay[ex]),
      ...(lantern && lantern.kind === 'trail' && i === 0 ? { lantern: true } : {}) });
  });
  const kindOf = new Map((collect.live || []).map((r) => [r.passage_id, r.kind]));
  (collect.unseen || []).forEach((u) => {
    const listen = kindOf.get(u.pid) === 'listen';
    push({ kind: 'story', id: u.pid, href: L.story(u.pid), ...words(listen ? 'listen' : 'read'), ...subOf(u.title), minutes: 2, ...artOr(null, listen ? 'listen' : 'read'),
      released_at: u.released_at, seen: false, read_aloud: !listen, ...(lantern && lantern.kind === 'story' && lantern.pid === u.pid ? { lantern: true } : {}) });
  });
  if (collect.story && L.ch) push({ kind: 'game', id: 'numbers', href: L.ch, ...words('numbers'), minutes: 1, ...artOr(null, 'game'), ...(lantern && lantern.kind === 'numbers' ? { lantern: true } : {}) });
  if (watch && out.book_on && L.book) push({ kind: 'sticker', id: 'book', href: L.book, ...words('sticker'), minutes: 1, ...artOr(null, 'sticker') });
  // the caller's own (a result's play again / invite, the stories reader's books): Jugnu's picture when they bring none
  (extra || []).forEach((c) => push(c && !c.art && JUGNU_ART[c.kind] ? { ...c, ...artOr(null, c.kind) } : c));
  return list;
}

// ── the reads (never throw) ──────────────────────────────────────────────────────────────────────────

const SENT = new Set(['sent', 'report_sent']);
const BOOK_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * code -> quiz id; the codes whose quiz row is a storybook send (quiz_source 'story') the teacher SENT, and those only
 * previewed; `known` = the codes whose quiz row was read (a failed or empty read leaves a code unknown, and the
 * teacher card's code unknown is never offered: fail closed); `covers` = a sent book's cover. Never throws.
 */
async function quizIdsOf(codes, { history = [], seen = null } = {}) {
  const want = [...new Set(codes.filter(Boolean))].slice(0, 20);
  const none = { quizIds: new Map(), storyCodes: new Set(), unsentCodes: new Set(), known: new Set(), covers: new Map() };
  if (!want.length) return none;
  try {
    const { read: dbRead } = require('./web-quiz-db-deadline');
    // the hub's own history already knows the quiz behind every code this child has played: read only the rest
    const had = new Map((history || []).filter((e) => e && e.code && e.quizId).map((e) => [e.code, e.quizId]));
    // fast (the hub's parallel branches): the teacher card's own reads, its codes and the quiz rows it read with these
    // same columns, are not read again
    const pre = seen && Array.isArray(seen.codes) && Array.isArray(seen.rows) && seen.ids instanceof Set ? seen : null;
    const preCode = new Map(pre ? pre.codes.filter((c) => c && c.code).map((c) => [c.code, c.quiz_id]) : []);
    const ask = want.filter((c) => !had.has(c) && !preCode.has(c));
    const { data, error } = ask.length
      ? await dbRead('nextOffer:quiz_share_codes:1', (db) => db.from('quiz_share_codes').select('code, quiz_id').in('code', ask))
      : { data: [] };
    if (error || !Array.isArray(data)) return none;
    const quizIds = new Map([...want.filter((c) => had.has(c)).map((c) => [c, had.get(c)]),
      ...want.filter((c) => !had.has(c) && preCode.has(c)).map((c) => [c, preCode.get(c)]), ...data.map((r) => [r.code, r.quiz_id])]);
    const ids = [...new Set([...quizIds.values()].filter(Boolean))];
    const readIds = pre ? ids.filter((id) => !pre.ids.has(id)) : ids;
    const { data: read, error: qErr } = readIds.length
      ? await dbRead('nextOffer:quizzes:1', (db) => db.from('quizzes').select('id, quiz_source, status, meta').in('id', readIds))
      : { data: [] };
    if (qErr || !Array.isArray(read)) return { ...none, quizIds };
    const rows = pre ? [...pre.rows.filter((q) => q && ids.includes(q.id)), ...read] : read;
    const stories = rows.filter((q) => q.quiz_source === 'story');
    // a story's code is minted when the teacher OPENS the book (the send link is built at render); only a tapped send
    // (status 'sent' / 'report_sent' / meta.sent_at) is the teacher's — a preview is never pinned
    const sent = (q) => SENT.has(q.status) || Boolean(q.meta && (q.meta.sent_at || q.meta.first_sent_at));
    const codesOf = (pick) => new Set([...quizIds].filter(([, id]) => pick.has(id)).map(([code]) => code));
    const sentBooks = stories.filter(sent);
    return {
      quizIds,
      storyCodes: codesOf(new Set(sentBooks.map((q) => q.id))),
      unsentCodes: codesOf(new Set(stories.filter((q) => !sent(q)).map((q) => q.id))),
      known: codesOf(new Set(rows.map((q) => q.id))),
      covers: await coversOf(quizIds, sentBooks, dbRead),
    };
  } catch (_) {
    return none;
  }
}

/** code -> a sent book's cover (`/s/<book id>/<cover file>`, the reader's own address), from meta.story.book_id. */
async function coversOf(quizIds, books, dbRead) {
  const out = new Map();
  const bookOf = new Map(books.map((q) => [q.id, q.meta && q.meta.story && BOOK_RX.test(String(q.meta.story.book_id || '')) ? String(q.meta.story.book_id) : null]));
  const bookIds = [...new Set([...bookOf.values()].filter(Boolean))];
  if (!bookIds.length) return out;
  try {
    const { data } = await dbRead('nextOffer:story_books:1', (db) => db.from('story_books').select('id, cover_file').in('id', bookIds));
    const cover = new Map((Array.isArray(data) ? data : []).filter((b) => b && b.cover_file).map((b) => [b.id, `/s/${b.id}/${encodeURIComponent(b.cover_file)}`]));
    for (const [code, qid] of quizIds) if (cover.has(bookOf.get(qid))) out.set(code, cover.get(bookOf.get(qid)));
  } catch (_) { /* no cover: Jugnu's picture */ }
  return out;
}

/**
 * Would the counted serve of this stop answer "on its way"? The serve's own rule (web-quiz-challenge.js serveV2), read
 * from the draw module's exported parts: only a read/listen stop in check mode with the pool on can be; a read that
 * fails is "yes" (fail closed: never offer what may not open).
 */
// early (the hub's parallel branches): the passage registry is read beside the child's rows, not after them.
async function onItsWayOf(canonicalId, rawId, stops, lang, grade, { early = false } = {}) {
  const out = {};
  const ask = (stops || []).filter((ex) => ex === 'read' || ex === 'listen');
  if (!ask.length) return out;
  try {
    const s = await NO.switches();
    if (!s.pool) return out;
    const D = require('./web-quiz-challenge-draw');
    // the draw compares grades as numbers (serveV2 passes the visit's number); the hub's grade is a string
    const g = Number(grade) || null;
    const registryP = early ? D.registryPassages() : null;
    if (registryP) registryP.catch(() => {});
    const [rows, periodRows, fixed] = await Promise.all([D.childRows(canonicalId, [rawId]), D.periods(), D.fixedGradeOf(canonicalId, g)]);
    if (rows.readFailed) { ask.forEach((ex) => { out[ex] = true; }); return out; }
    const periodNow = D.periodIdFor(new Date(), periodRows);
    const registry = await (registryP || D.registryPassages());
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

/**
 * Resolves to the work's value, or null past `ms` (the caller then adds nothing). `work` is a function given the
 * `live` token ({ on }), which the deadline sets false: work still running then must write and log nothing (the slot's
 * state and next_set count only what a child is shown). A plain promise is raced as it is.
 */
function withDeadline(work, ms) {
  let timer;
  const live = { on: true };
  const p = typeof work === 'function' ? Promise.resolve().then(() => work(live)) : work;
  return Promise.race([p, new Promise((res) => { timer = setTimeout(() => { live.on = false; res(null); }, ms); })]).finally(() => clearTimeout(timer));
}

/**
 * The slot's own reads for the hub, started beside Jugnu's corner and the Book (they need only the child, the quiz
 * codes the hub has already chosen and the Trail's stops): the switches, the quiz rows behind the codes, the storybook
 * candidates, the "on its way" verdicts. Resolves to null when the slot is off; never rejects.
 */
function hubPrep({ out, token, history, lang, chosenId, grade, stopsOf, chip, seen } = {}) {
  if (out && typeof out.then === 'function') return branchPrep({ out, token, history, lang, chosenId, grade, stopsOf, chip, seen });
  return (async () => {
    const sw = await NO.switches();
    if (!sw.on || !out || !chosenId) return null;
    const stops = typeof stopsOf === 'function' ? await Promise.resolve().then(stopsOf).catch(() => []) : [];
    const [rows, books, onItsWay] = await Promise.all([
      quizIdsOf([out.teacher && out.teacher.code, out.last && out.last.code, ...(out.again || []).map((a) => a.code)], { history }),
      storybooks({ studentId: chosenId, lang, grade, token, chip: out.kid }),
      onItsWayOf(chosenId, chosenId, stops, lang, grade),
    ]);
    return { sw, rows, books, onItsWay };
  })().catch(() => null);
}

/**
 * hubPrep as one of the hub's parallel branches (web_quiz_fast): `out` is a promise of { teacher, last, again } (the
 * payload's, computed as the hub computes them) and `chip` the child's chip. The storybook candidates and the "on its
 * way" verdicts need none of them and start at once; the quiz rows wait for the teacher card and reuse its reads (`seen`).
 */
function branchPrep({ out, token, history, lang, chosenId, grade, stopsOf, chip, seen }) {
  Promise.resolve(out).catch(() => {});   // a failed teacher card is the hub's to report (where it reads it), not this one's
  return (async () => {
    const sw = await NO.switches();
    if (!sw.on || !chosenId) return null;
    const stops = typeof stopsOf === 'function' ? Promise.resolve().then(stopsOf).catch(() => []) : Promise.resolve([]);
    const [rows, books, onItsWay] = await Promise.all([
      out.then((o) => quizIdsOf([o.teacher && o.teacher.code, o.last && o.last.code, ...(o.again || []).map((a) => a.code)], { history, seen })),
      storybooks({ studentId: chosenId, lang, grade, token, chip }),
      stops.then((st) => onItsWayOf(chosenId, chosenId, st, lang, grade, { early: true })),
    ]);
    return { sw, rows, books, onItsWay };
  })().catch(() => null);
}

async function hubNext({ out, token, history, collect, lang, chosenId, grade, subjectArt, prep, live }) {
  const p = await (prep || hubPrep({ out, token, history, lang, chosenId, grade, stopsOf: () => collect.trail || [] }));
  if (!p) return {};
  const { quizIds, storyCodes, unsentCodes, known, covers } = p.rows;
  // the verdicts were read for the Trail's stops; the corner offers only the ones still waiting this month
  const candidates = candidatesOf({ out, token, history, collect: { ...collect, onItsWay: p.onItsWay }, lang, quizIds, storyCodes, unsentCodes, known, covers, subjectArt, extra: p.books, watch: p.sw.watch });
  const next = await NO.nextFor({ ctx: 'home', studentId: chosenId, candidates, hasRoot: hasRootOf(history), lang, live });
  return next ? { next } : {};
}

/**
 * The hub boot's `{ next }` (ctx home), from the payload the hub has just built (`chosenId` = the child's known id).
 * `{}` when off, on any failure, or past the deadline (1.2 s, the settings read inside it): the hub JSON is fetched
 * after paint, and a slow read here must never hold it.
 */
async function hubField({ out, token, history, collect = {}, lang, chosenId, grade, subjectArt, prep = null } = {}) {
  try {
    if (!out || !chosenId) return {};
    return (await withDeadline((live) => hubNext({ out, token, history, collect, lang, chosenId, grade, subjectArt, prep, live }), HUB_DEADLINE_MS)) || {};
  } catch (err) {
    logToFile('⚠️ web quiz next offer: hub field unavailable', { error: err.message });
    return {};
  }
}

module.exports = { candidatesOf, hubPrep, hubField, withDeadline, quizIdsOf, onItsWayOf, storybooks, hasRootOf, qkOf, words, subOf, links, artOr, COPY, TAG, JUGNU_ART, HUB_DEADLINE_MS };
