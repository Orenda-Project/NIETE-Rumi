'use strict';
/**
 * The candidates the next-thing ranker (web-quiz-next-offer.js) chooses from, built from what the hub already reads,
 * and the three call sites' fields (each `{}` with `web_quiz_next_offer` off or on any failure — today's bytes):
 *
 *   hubField({ out, token, history, collect, lang })    the hub boot's `{ next }` (ctx home)
 *   finishField(body, out, { device })                   the quiz finish's `{ next_offer }` (ctx after_quiz | after_quiz_low)
 *   challengeField(result, ct, { device })               a Jugnu stop's final result's `{ next_offer }` (after_read |
 *                                                        after_read_weak | after_game | after_story); never on {pending}
 *
 * Every candidate carries an href the child's phone can open (the home's `nextOf` ignores one without), its words in
 * English and Urdu (no test words), and the facts the rules read: `rule` (teacher_quiz / month_stop / resume),
 * `sent_at`, `on_its_way` (a counted stop the draw would answer "a new story is on its way"), `read_aloud`,
 * `needs_root` (a video needs a class quiz: videos/start answers 409 no_class without one), `released_at`, `seen`,
 * `lantern` (today's lantern pick: the control arm's primary). The ids are content ids; a quiz is its keyed `qk`.
 *
 * Storybooks: a module `web-quiz-storybook-next.js` exporting `candidates({ studentId, lang, grade, token, chip })`
 * (the stories reader's) is asked when present; its rows (a half-read book = `rule: 'resume'`) join the list.
 * A result is never held up: the snapshot for a result card races a deadline (DEADLINE_MS) and gives up quietly.
 */
const crypto = require('crypto');
const T = require('./web-quiz-token');
const K = require('./web-quiz-kid');
const NO = require('./web-quiz-next-offer');
const { logToFile } = require('../../utils/logger');

const DEADLINE_MS = 1200;
const RESULT_MEMO_S = 15 * 60;
const PIN_DAYS = 7;
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
  const l = `&lang=${lang === 'ur' ? 'ur' : 'en'}`;
  const ch = token && chip ? `/c/${encodeURIComponent(token)}?kid=${encodeURIComponent(chip)}${l}${h}` : null;
  return {
    ch,
    stop: (ex) => (ch ? `${ch}#${ex}` : null),
    story: (pid) => (ch ? `${ch}&room=story&pid=${encodeURIComponent(pid)}` : null),
    quiz: (code, k, again) => (code ? `/q/${encodeURIComponent(code)}?${again ? 'again=1&' : ''}k=${encodeURIComponent(k || '')}` : null),
    lib: token && chip ? `/lib/${encodeURIComponent(token)}?kid=${encodeURIComponent(chip)}&l=${lang === 'ur' ? 'ur' : 'en'}${h}` : null,
    book: token && chip ? `/h/${encodeURIComponent(token)}?kid=${encodeURIComponent(chip)}${l}#book` : null,
  };
}

// ── the candidates (pure, from the hub's own data) ──────────────────────────────────────────────────

/**
 * `out` = the hub payload (teacher, last, again, lib, challenge, nav_home, book_on); `history` = the hub's
 * quizzesForStudents rows; `collect` = what the Jugnu corner read ({ trail, onItsWay, live, unseen, lantern, story });
 * `quizIds` = share code -> quiz id; `extra` = more candidates (storybooks, the finish's own). Returns the list.
 */
function candidatesOf({ out = {}, token, history = [], collect = {}, lang = 'en', quizIds = new Map(), storyCodes = new Set(), extra = [], nowMs = Date.now() } = {}) {
  const L = links({ token, chip: out.kid, lang, home: out.nav_home });
  const list = [];
  const push = (c) => { if (c && c.href && c.id) list.push(c); };
  const entryOf = (code) => history.find((e) => e && e.code === code) || null;

  // the teacher's quizzes: the hub's teacher card (an open code from the last 7 days), and the quiz left open
  if (out.teacher && out.teacher.code) {
    const t = out.teacher;
    // a storybook the teacher sent rides a quiz row + its code (quiz_source 'story'): the same pin, its own kind
    const story = storyCodes.has(t.code);
    push({ kind: story ? 'storybook' : 'quiz', variant: story ? 'teacher' : 'new', id: story ? `sb.${t.code}` : qkOf(quizIds.get(t.code), t.code), href: L.quiz(t.code, t.k),
      ...words('quiz'), ...subOf(t.topic || t.subject), minutes: 3, rule: 'teacher_quiz', sent_at: t.sent_at || null });
  }
  if (out.last && out.last.code && out.last.state === 'open') {
    const e = entryOf(out.last.code) || {};
    const fresh = e.teacherSent && Number.isFinite(Date.parse(e.sentAt)) && nowMs - Date.parse(e.sentAt) <= PIN_DAYS * DAY_MS;
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
  if (out.lib && out.lib.href && L.lib) push({ kind: 'video', variant: 'library', id: 'library', href: L.lib, ...words('video'), minutes: 3, needs_root: true });

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
  if (out.book_on && L.book) push({ kind: 'sticker', id: 'book', href: L.book, ...words('sticker'), minutes: 1 });
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
    const [rows, periodRows, fixed] = await Promise.all([D.childRows(canonicalId, [rawId]), D.periods(), D.fixedGradeOf(canonicalId, grade)]);
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

/** The hub boot's `{ next }` (ctx home), from the payload the hub has just built. `{}` when off or on any failure. */
async function hubField({ out, token, history, collect = {}, lang, chosenId, grade } = {}) {
  try {
    if (!out || !chosenId || !(await NO.switches()).on) return {};
    const canonical = chosenId;
    const [{ quizIds, storyCodes }, books, onItsWay] = await Promise.all([
      quizIdsOf([out.teacher && out.teacher.code, out.last && out.last.code, ...(out.again || []).map((a) => a.code)]),
      storybooks({ studentId: canonical, lang, grade, token, chip: out.kid }),
      onItsWayOf(canonical, chosenId, collect.trail, lang, grade),
    ]);
    const candidates = candidatesOf({ out, token, history, collect: { ...collect, onItsWay }, lang, quizIds, storyCodes, extra: books });
    const next = await NO.nextFor({ ctx: 'home', studentId: canonical, candidates, hasRoot: hasRootOf(history), lang });
    return next ? { next } : {};
  } catch (err) {
    logToFile('⚠️ web quiz next offer: hub field unavailable', { error: err.message });
    return {};
  }
}

/**
 * A child's snapshot for a result card: the hub's own reads for one child (teacher card, the quiz left open, play
 * again, the library, the Jugnu corner), with a hub token minted for this child and bound to this phone (as the
 * card's hub door does). Null when the phone cannot be bound or anything fails.
 */
async function snapshot({ studentId, device, lang: asked = null }) {
  const Hub = require('./web-quiz-hub');
  const f = await Hub.flags();
  if (!f.hub) return null;
  const canonical = (await require('./web-quiz-identity-flags').flags()).canon
    ? await require('./web-quiz-identity-roster').canonicalStudentId(studentId) : studentId;
  const token = T.signHub([canonical]);
  if (!token) return null;
  const bound = await require('./web-quiz-hub-device').deviceTrusted(token, device);
  if (!bound.ok) return null;
  const parts = Hub._parts;
  const ctx = await parts.kidContext(canonical);
  if (!ctx) return null;
  const { history, grade } = ctx;
  const { clampLanguage } = require('../../config/ux-strings');
  const lang = asked ? clampLanguage(asked) : clampLanguage(require('./student-quiz.service').childLanguage(history));
  const chosen = { id: canonical };
  const out = { kid: parts.kidChip(canonical), lang, teacher: null, again: [], lib: null, challenge: null };
  if (f.homeButton) out.nav_home = true;
  out.teacher = await parts.teacherCard(chosen, ctx.list, history, grade);
  out.again = parts.againOf(history, canonical, out.teacher && out.teacher.code);
  out.last = parts.lastOf(history, canonical);
  if (out.last && out.teacher && out.teacher.code === out.last.code) out.teacher = null;
  if (out.last) out.again = out.again.filter((a) => a.code !== out.last.code);
  if (f.library) out.lib = { href: `/lib/${token}?kid=${out.kid}&l=${lang}` };
  const form = f.challenge ? await parts.challengeForm(canonical) : null;
  if (form) out.challenge = { on: true };
  const collect = {};
  await require('./web-quiz-hub-play').playFor({ chosenId: canonical, last: out.last, lang, now: new Date().toISOString(), challenge: out.challenge, grade, stopsOf: () => parts.trailStops(form), collect });
  return { canonical, token, out, history, collect, grade, lang };
}

function withDeadline(p, ms = DEADLINE_MS) {
  let timer;
  return Promise.race([p, new Promise((res) => { timer = setTimeout(() => res(null), ms); })]).finally(() => clearTimeout(timer));
}

/** One result's `{ next_offer }`: the snapshot's candidates + the result's own, ranked for `ctx`. */
async function resultField({ studentId, device, lang: asked = null, ctx, extra = [], drop = () => false }) {
  if (!studentId || !(await NO.switches()).on) return {};
  const snap = await withDeadline(snapshot({ studentId, device, lang: asked }));
  if (!snap) return {};
  const { canonical, token, out, history, collect, grade, lang } = snap;
  const [{ quizIds, storyCodes }, books, onItsWay] = await Promise.all([
    quizIdsOf([out.teacher && out.teacher.code, out.last && out.last.code, ...(out.again || []).map((a) => a.code)]),
    storybooks({ studentId: canonical, lang, grade, token, chip: out.kid }),
    onItsWayOf(canonical, studentId, collect.trail, lang, grade),
  ]);
  const candidates = [...extra, ...candidatesOf({ out, token, history, collect: { ...collect, onItsWay }, lang, quizIds, storyCodes, extra: books })]
    .filter((c, i, a) => !drop(c) && a.findIndex((x) => x.id === c.id) === i);
  const next = await NO.nextFor({ ctx, studentId: canonical, candidates, hasRoot: hasRootOf(history), lang });
  return next ? { next_offer: next } : {};
}

/** The quiz finish's `{ next_offer }` (the route wraps finishSession). `{}` for a teacher's or a friend's run. */
async function finishField(body = {}, out = {}, { device = null } = {}) {
  try {
    if (!out || !out.score || !(await NO.switches()).on) return {};
    const tok = T.verify(body.st, 's');
    if (!tok || !tok.sid || !tok.d) return {};
    const { read: dbRead } = require('./web-quiz-db-deadline');
    const { data: s } = await dbRead('nextOffer:quiz_sessions:1', (db) => db.from('quiz_sessions')
      .select('id, student_id, user_id, invited_by_student_id, share_code_id, quiz_id').eq('id', tok.sid).maybeSingle());
    if (!s || s.share_code_id !== tok.sc || !s.student_id || s.user_id || (s.invited_by_student_id && s.invited_by_student_id !== s.student_id)) return {};
    const lang = body.lang === 'en' || body.lang === 'ur' ? body.lang : null;   // else the child's own language (history)
    const pct = Number(out.score.pct);
    const ctx = Number.isFinite(pct) && pct < 50 ? 'after_quiz_low' : 'after_quiz';
    const { data: sc } = await dbRead('nextOffer:quiz_share_codes:2', (db) => db.from('quiz_share_codes').select('code, active').eq('id', s.share_code_id).maybeSingle());
    const extra = [];
    const k = T.chipId(s.share_code_id, s.student_id);
    if (sc && sc.code && sc.active !== false) extra.push({ kind: 'quiz', variant: 'again', id: qkOf(s.quiz_id, sc.code), href: `/q/${encodeURIComponent(sc.code)}?again=1&k=${encodeURIComponent(k)}`, ...words('again'), minutes: 3 });
    // the quiz's own "next in this chapter" (a video quiz with a code) is one candidate among the rest
    if (out.next && out.next.code && out.next.title) extra.push({ kind: 'video', variant: 'chapter', id: `chapter.${out.next.vid || out.next.code}`, href: `/q/${encodeURIComponent(out.next.code)}`, ...words('video'), ...subOf(out.next.title), minutes: 3 });
    if (out.challenge_code) {
      const base = String(process.env.PORTAL_URL || '').replace(/\/+$/, '');
      const link = `${base}/q/${out.challenge_code}`;
      const text = (lang || 'en') === 'ur' ? `میرے ساتھ یہ کوئز کھیلو!\n${link}` : `Play this quiz with me!\n${link}`;
      if (base) extra.push({ kind: 'invite', id: 'invite', href: `https://wa.me/?text=${encodeURIComponent(text)}`, ...words('invite'), minutes: 1 });
    }
    // the quiz just finished is not "your teacher's quiz" any more
    const doneId = qkOf(s.quiz_id, sc && sc.code);
    return await resultField({ studentId: s.student_id, device: tok.d || device, lang, ctx, extra, drop: (c) => c.variant === 'new' && c.id === doneId });
  } catch (err) {
    logToFile('⚠️ web quiz next offer: finish field unavailable', { error: err.message });
    return {};
  }
}

/** The context of a Jugnu stop's final result (pure). */
function challengeCtx(ex, result = {}) {
  if (ex === 'read') {
    if (result.failed) return 'after_read_weak';
    if (['timer', 'error', 'timeout'].includes(result.ended)) return 'after_read_weak';
    return 'after_read';
  }
  if (ex === 'listen') return 'after_story';
  return 'after_game';
}

/** A Jugnu stop's final result's `{ next_offer }` (the route wraps submit and poll). `{}` on {pending} or a null. */
async function challengeField(result, ct, { device = null, lang = null } = {}) {
  try {
    if (!result || result.pending || !(await NO.switches()).on) return {};
    const c = T.verify(ct, 'c');
    if (!c || !c.sid || !c.ex || c.cr) return {};   // a class round's turn goes back to the teacher's round, not on
    if (!device) return {};
    // one offer per run: the page polls a scoring read; every poll after the first gets the same object (and one next_set)
    const redis = require('../cache/railway-redis.service');
    const memo = c.r ? `wq:nxr:${crypto.createHash('sha256').update(String(c.r)).digest('hex').slice(0, 24)}` : null;
    const had = memo ? await redis.get(memo) : null;
    if (had && typeof had === 'object' && had.href) return { next_offer: had };
    const drop = (x) => x.id === `stop.${c.ex}`;
    const field = await resultField({ studentId: c.sid, device, lang, ctx: challengeCtx(c.ex, result), drop });
    if (memo && field.next_offer) await redis.set(memo, field.next_offer, RESULT_MEMO_S);
    return field;
  } catch (err) {
    logToFile('⚠️ web quiz next offer: challenge field unavailable', { error: err.message });
    return {};
  }
}

module.exports = { candidatesOf, hubField, finishField, challengeField, challengeCtx, onItsWayOf, links, COPY, DEADLINE_MS };
