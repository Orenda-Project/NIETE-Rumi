'use strict';
/**
 * The ranked next thing on a result card (switch `web_quiz_next_offer`, default OFF: `{}` and the result is today's):
 *
 *   finishField(body, out, { device })       the quiz finish's `{ next_offer }` (ctx after_quiz | after_quiz_low)
 *   challengeField(result, ct, { device })   a Jugnu stop's final result's `{ next_offer }` (after_read | after_read_weak |
 *                                            after_game | after_story); never on {pending}; one offer per run
 *
 * The candidates are the hub's own (web-quiz-next-offer-sources.js) for this child, read through a snapshot of the
 * hub's per-child reads with a hub token minted for the child and bound to this phone — only when this phone is
 * already the child's (it played as them, or a hub of theirs was opened on it), checked read-only before anything is
 * minted or written: a challenge token forwarded to another phone never turns into a hub link there.
 * A result is never held up: the whole field races a deadline (DEADLINE_MS) and gives up quietly.
 */
const crypto = require('crypto');
const T = require('./web-quiz-token');
const NO = require('./web-quiz-next-offer');
const S = require('./web-quiz-next-offer-sources');
const { logToFile } = require('../../utils/logger');

const DEADLINE_MS = 1200;
// A read that covered less than this share of the passage is a weak read (EVENTS v3 §7: after_read_weak).
const WEAK_SHARE = 0.4;
const RESULT_MEMO_S = 15 * 60;
const { candidatesOf, quizIdsOf, onItsWayOf, storybooks, hasRootOf, qkOf, words, subOf, artOr, withDeadline } = S;

/**
 * A child's snapshot for a result card: the hub's own reads for one child (teacher card, the quiz left open, play
 * again, the library, the Jugnu corner), with a hub token minted for this child and bound to this phone. Null — with
 * nothing minted or written — when this phone is not already the child's (never played as them, no hub of theirs
 * opened on it), when the caller's deadline has passed (`live`), or when anything fails.
 */
async function snapshot({ studentId, device, lang: asked = null, watch = false, live = null }) {
  const Hub = require('./web-quiz-hub');
  const f = await Hub.flags();
  if (!f.hub) return null;
  const canonical = (await require('./web-quiz-identity-flags').flags()).canon
    ? await require('./web-quiz-identity-roster').canonicalStudentId(studentId) : studentId;
  const Device = require('./web-quiz-hub-device');
  // read-only first: the run's child or the id they are known by, on THIS phone; a stranger phone gets nothing
  if (!(await Device.deviceMayName([...new Set([String(studentId), String(canonical)])], device))) return null;
  if (live && live.on === false) return null;   // past the deadline: nothing minted, nothing bound
  const token = T.signHub([canonical]);
  if (!token) return null;
  const bound = await Device.deviceTrusted(token, device);
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
  // the recommended lesson, only where the tile can use it: a class-less child with the v3 home's watch-only player
  if (watch && !hasRootOf(history)) {
    try { out.recs = await parts.recsFor(canonical, history, grade); } catch (_) { out.recs = []; }
  }
  const form = f.challenge ? await parts.challengeForm(canonical) : null;
  if (form) out.challenge = { on: true };
  const collect = {};
  await require('./web-quiz-hub-play').playFor({ chosenId: canonical, last: out.last, lang, now: new Date().toISOString(), challenge: out.challenge, grade, stopsOf: () => parts.trailStops(form), collect });
  return { canonical, token, out, history, collect, grade, lang };
}


/**
 * One result's `{ next_offer }`: the snapshot's candidates + the result's own, ranked for `ctx`. `extra` is a list, or a
 * function returning one (a read of the caller's own): started at once, beside the child's reads, inside the deadline.
 */
async function resultField({ studentId, device, lang: asked = null, ctx, extra = [], drop = () => false, live = null }) {
  const sw = await NO.switches();
  if (!studentId || !sw.on) return {};
  const ownP = typeof extra === 'function' ? Promise.resolve().then(extra).catch(() => []) : Promise.resolve(extra);
  const snap = await snapshot({ studentId, device, lang: asked, watch: sw.watch, live });
  if (!snap) return {};
  const { canonical, token, out, history, collect, grade, lang } = snap;
  const [{ quizIds, storyCodes, unsentCodes, known, covers }, books, onItsWay, own] = await Promise.all([
    quizIdsOf([out.teacher && out.teacher.code, out.last && out.last.code, ...(out.again || []).map((a) => a.code)], { history }),
    storybooks({ studentId: canonical, lang, grade, token, chip: out.kid }),
    onItsWayOf(canonical, studentId, collect.trail, lang, grade),
    ownP,
  ]);
  const candidates = [...(Array.isArray(own) ? own : []), ...candidatesOf({ out, token, history, collect: { ...collect, onItsWay }, lang, quizIds, storyCodes, unsentCodes, known, covers,
    subjectArt: require('./web-quiz-hub')._parts.subjectArtOf, extra: books, watch: sw.watch })]
    .filter((c, i, a) => !drop(c) && a.findIndex((x) => x.id === c.id) === i);
  const next = await NO.nextFor({ ctx, studentId: canonical, candidates, hasRoot: hasRootOf(history), lang, live });
  return next ? { next_offer: next } : {};
}

/** The quiz finish's `{ next_offer }` (the route wraps finishSession). `{}` for a teacher's or a friend's run. */
async function finishInner(body = {}, out = {}, { device = null } = {}, live = null) {
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
    // (its id is the video's: a share code never rides beside a kid)
    if (out.next && out.next.code && out.next.title && out.next.vid) {
      extra.push({ kind: 'video', variant: 'chapter', id: `chapter.${out.next.vid}`, href: `/q/${encodeURIComponent(out.next.code)}`, ...words('video'), ...subOf(out.next.title), minutes: 3, ...artOr(out.next.poster || out.next.art, 'video') });
    }
    if (out.challenge_code) {
      const base = String(process.env.PORTAL_URL || '').replace(/\/+$/, '');
      const link = `${base}/q/${out.challenge_code}`;
      const text = (lang || 'en') === 'ur' ? `میرے ساتھ یہ کوئز کھیلو!\n${link}` : `Play this quiz with me!\n${link}`;
      if (base) extra.push({ kind: 'invite', id: 'invite', href: `https://wa.me/?text=${encodeURIComponent(text)}`, ...words('invite'), minutes: 1 });
    }
    // the quiz just finished is not "your teacher's quiz" any more
    const doneId = qkOf(s.quiz_id, sc && sc.code);
    return await resultField({ studentId: s.student_id, device: tok.d || device, lang, ctx, extra, drop: (c) => c.variant === 'new' && c.id === doneId, live });
  } catch (err) {
    logToFile('⚠️ web quiz next offer: finish field unavailable', { error: err.message });
    return {};
  }
}

/**
 * The context of a Jugnu stop's final result (pure). A read with almost nothing read (no word heard, or given up in
 * the first seconds: the "you tried" card) is `after_read_tried`; a weak one failed otherwise, ended by the timer or an
 * error, or covered < 40 % of the passage (`words` = the passage's word count, when known; read = score.attempted).
 */
const TRIED = new Set(['unheard', 'abandoned']);
function challengeCtx(ex, result = {}, { words: total = null } = {}) {
  if (ex === 'read') {
    if (result.failed && TRIED.has(result.reason)) return 'after_read_tried';
    if (result.failed) return 'after_read_weak';
    if (['timer', 'error', 'timeout'].includes(result.ended)) return 'after_read_weak';
    const read = Number(result.score && result.score.attempted);
    if (Number.isFinite(read) && Number(total) > 0 && read / Number(total) < WEAK_SHARE) return 'after_read_weak';
    return 'after_read';
  }
  if (ex === 'listen') return 'after_story';
  return 'after_game';
}

/** The run's passage word count (its served passage), or null when it cannot be read. Never throws. */
async function passageWords(runId) {
  try {
    if (!runId) return null;
    const { read: dbRead } = require('./web-quiz-db-deadline');
    const { data } = await dbRead('nextOffer:challenge_runs:1', (db) => db.from('web_quiz_challenge_runs').select('id, passage_id').eq('id', runId).maybeSingle());
    if (!data || !data.passage_id) return null;
    const p = require('./web-quiz-challenge').passageFor(data.passage_id, require('../child-test/item-bank'));
    return p && Array.isArray(p.tokens) && p.tokens.length ? p.tokens.length : null;
  } catch (_) {
    return null;
  }
}

/** A Jugnu stop's final result's `{ next_offer }` (the route wraps submit and poll). `{}` on {pending} or a null. */
async function challengeInner(result, ct, { device = null, lang = null } = {}, live = null) {
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
    const words = c.ex === 'read' && !result.failed ? await passageWords(c.r) : null;
    const field = await resultField({ studentId: c.sid, device, lang, ctx: challengeCtx(c.ex, result, { words }), drop, live });
    // the memo only for an offer the child got (past the deadline the next poll draws afresh, and logs it then)
    if (memo && field.next_offer && (!live || live.on)) redis.set(memo, field.next_offer, RESULT_MEMO_S).catch(() => {});
    return field;
  } catch (err) {
    logToFile('⚠️ web quiz next offer: challenge field unavailable', { error: err.message });
    return {};
  }
}

/**
 * Any other activity's `{ next_offer }` (e.g. a watched video, ctx after_video): the child's candidates plus the
 * caller's own (`extra`: the same shape, as a list or a function that reads them — run inside the deadline), ranked for
 * `ctx`. `{}` when off, past the deadline or on any failure.
 */
async function offerFor({ studentId, device, lang = null, ctx, extra = [] } = {}) {
  try {
    if (!studentId || !device || typeof ctx !== 'string') return {};
    return (await withDeadline((live) => resultField({ studentId, device, lang, ctx, extra, live }), DEADLINE_MS)) || {};
  } catch (_) {
    return {};
  }
}

/** The quiz finish's `{ next_offer }`, or `{}` past the deadline (the card is never held up). */
async function finishField(body, out, opts) {
  return (await withDeadline((live) => finishInner(body, out, opts, live), DEADLINE_MS)) || {};
}

/** A Jugnu stop's final result's `{ next_offer }`, or `{}` past the deadline. */
async function challengeField(result, ct, opts) {
  return (await withDeadline((live) => challengeInner(result, ct, opts, live), DEADLINE_MS)) || {};
}

module.exports = { finishField, challengeField, offerFor, challengeCtx, passageWords, DEADLINE_MS, WEAK_SHARE, _snapshot: snapshot };
