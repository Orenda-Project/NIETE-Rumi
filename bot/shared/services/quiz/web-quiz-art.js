'use strict';
/**
 * THE SHARE PICTURES, served (web quiz). What travels with a child's share:
 *
 *   c  my card        ref = the session id     (the kept first-try score, as the league shows)
 *   i  the invite     ref = the challenge code (the challenger's counted score, from the DB)
 *   l  my class       ref = the class code, or the sharer's session (top rows as place + animal +
 *                     score; only the sharer's own row is named, "(me)")
 *   s  my school      ref = the class code     (the school board around this class's school)
 *
 * The id is signed: "<kind>.<ref>.<mac12>". A link preview fetches the picture
 * with no session, so the id itself is the permission, and the mac stops
 * anyone making the server draw for an id it never issued. A session id
 * travels as its 16 bytes in base64url (22 characters).
 *
 * Drawn once per content: the facts (not the HTML, which carries megabytes of
 * fonts) are hashed with the template version into the R2 key
 * wq-art/<hash>.jpg. A cache miss draws, uploads and serves; R2 failing never
 * stops the picture, it is only drawn again next time. A small in-process map
 * answers repeat fetches (a group's previews arrive together) without R2.
 */
const crypto = require('crypto');
// `sharp` is a native module installed with the bot's dependencies. It is required lazily (as in
// web-quiz-picture-zoom.js) so this module, reached from whatsapp-bot.js through the internal
// routes, still loads where it is absent: the root CI job's webhook suites. There a picture
// fails as that picture, never the whole module.
let sharpLib = null; let sharpTried = false;
function getSharp() {
  if (!sharpTried) { sharpTried = true; try { sharpLib = require('sharp'); } catch { sharpLib = null; } }
  if (!sharpLib) throw new Error('web-quiz-art: sharp is not installed here');
  return sharpLib;
}
const supabase = require('../../config/supabase');
const r2 = require('../../storage/r2');
const { logToFile } = require('../../utils/logger');
const T = require('./web-quiz-token');
const WebQuizBrand = require('../../config/web-quiz-brand');
const { orgName, botName } = require('../../config/branding');
const { pageTopic } = require('./quiz-child-title');
const { renderArt, SIZES } = require('../../templates/web-quiz-art.template');
const { clampLanguage } = require('../../config/ux-strings');
const { artId, parseArtId, UUID_RX } = require('./web-quiz-art-id');
const Schools = require('./web-quiz-schools');

const ART_V = 2;               // bump when the template's look or words change: every picture is drawn afresh (2: neutral Urdu invite, 0/N challenger)
const MEM_MAX = 64;
const CODE_RX = /^[A-Z0-9]{4,12}$/;
const KIND_OF = { c: 'card', i: 'invite', l: 'class', s: 'school' };

const mem = new Map();

class ArtError extends Error {
  constructor(status, error) { super(error); this.status = status; this.body = { error }; }
}
const notFound = () => { throw new ArtError(404, 'not_found'); };

// ─── the facts each picture shows ───────────────────────────────────────────

async function brandKey() {
  try { return await WebQuizBrand.resolveBrandKey({ db: supabase, orgName, botName }); } catch { return WebQuizBrand.DEFAULT_BRAND; }
}

async function topicOf(sc) {
  const { data: q } = await supabase.from('quizzes').select('topic, meta').eq('id', sc.quiz_id).maybeSingle();
  return pageTopic({ lang: clampLanguage(sc.language), meta: q && q.meta, fallback: sc.topic || (q && q.topic) });
}

async function cardFacts(sessionId) {
  if (!UUID_RX.test(sessionId) && !/^[A-Za-z0-9-]{1,40}$/.test(sessionId)) notFound();
  const WebQuiz = require('./web-quiz.service');
  const { data: s } = await supabase.from('quiz_sessions')
    .select('id, student_id, student_name, share_code_id, status, user_id, invited_by_student_id, correct_answers, total_questions_answered, completed_at')
    .eq('id', sessionId).maybeSingle();
  if (!s || s.status !== 'completed' || !s.share_code_id || s.user_id) notFound();
  const { data: sc } = await supabase.from('quiz_share_codes').select('id, code, quiz_id, topic, language').eq('id', s.share_code_id).maybeSingle();
  if (!sc) notFound();
  // The kept score: this child's FIRST finish on the class code, the one the league counts.
  let kept = s;
  if (s.student_id) {
    const { data: done } = await supabase.from('quiz_sessions')
      .select('id, correct_answers, total_questions_answered, completed_at')
      .eq('share_code_id', s.share_code_id).eq('student_id', s.student_id).eq('status', 'completed')
      .order('completed_at', { ascending: true }).limit(1);
    if (done && done[0]) kept = done[0];
  }
  const lang = clampLanguage(sc.language);
  const nameOf = await WebQuiz.shownNames(lang, [s.student_id]);
  // An invited friend is not in the challenger's class: their card names neither that class nor its school.
  const friend = Boolean(s.invited_by_student_id);
  const cls = friend ? null : await require('./video-quiz-report.service').loadClassRows(sc.id).catch(() => null);
  const school = friend ? {} : await schoolLine(sc.code, s);
  return {
    lang,
    d: {
      first: nameOf(s.student_id, s.student_name), animal: T.animalFor(s.student_id || s.id),
      correct: kept.correct_answers || 0, total: kept.total_questions_answered || 0, topic: await topicOf(sc), cls: (cls && cls.className) || '',
      ...school,
    },
  };
}

/** A session token for this child, minted here only to ask the page's own boards "where do I stand". */
function stFor(s) {
  return T.signSession({ sessionId: s.id, deviceRef: null, shareCodeId: s.share_code_id });
}

/** The child's school and the points this play added to it (the school league's own count), else nothing. */
async function schoolLine(code, s) {
  try {
    const b = await Schools.board(code, { st: stFor(s) });
    if (!b || !b.mine || !b.mine.name) return {};
    return { school: b.mine.name, added: b.added || null };
  } catch { return {}; }
}

async function inviteFacts(code) {
  if (!CODE_RX.test(code)) notFound();
  const WebQuiz = require('./web-quiz.service');
  const ctx = await WebQuiz.resolveCode(code).catch(() => notFound());
  if (!ctx.invitedByStudentId) notFound();
  const ch = await WebQuiz.challengeOf(ctx);
  if (!ch) notFound();
  return { lang: ctx.lang, d: { first: ch.first, correct: ch.correct, total: ch.total, topic: await topicOf(ctx.parent) } };
}

const CLASS_ROWS = 5;

/** The class, by its code (nobody named) or by the sharer's session (their own row named). */
async function classFacts(ref) {
  const WebQuiz = require('./web-quiz.service');
  let code = ref;
  let me = null;
  if (UUID_RX.test(ref)) {
    const { data: s } = await supabase.from('quiz_sessions').select('id, student_id, student_name, share_code_id, status, user_id').eq('id', ref).maybeSingle();
    if (!s || s.status !== 'completed' || !s.share_code_id || s.user_id) notFound();
    const { data: sc } = await supabase.from('quiz_share_codes').select('code').eq('id', s.share_code_id).maybeSingle();
    if (!sc) notFound();
    code = sc.code;
    me = s;
  } else if (!CODE_RX.test(code)) notFound();
  const ctx = await WebQuiz.resolveCode(code).catch(() => notFound());
  const b = await WebQuiz.board(code, me ? { st: stFor(me) } : {});
  const cls = await require('./video-quiz-report.service').loadClassRows(ctx.shareCodeId).catch(() => null);
  // Classmates appear as place + animal + score only: the picture outlives the link and gets forwarded.
  const rows = (b.rows || []).slice(0, CLASS_ROWS).map((r) => ({ place: r.place, animal: r.animal, correct: r.correct, total: r.total }));
  if (me && b.you) {
    const nameOf = await WebQuiz.shownNames(ctx.lang, [me.student_id]);
    const mine = { place: b.you.place, animal: T.animalFor(me.student_id || me.id), correct: b.you.correct, total: b.you.total, me: true, first: nameOf(me.student_id, me.student_name) };
    const at = rows.findIndex((r) => r.place === mine.place && r.animal === mine.animal && r.correct === mine.correct);
    if (at >= 0) rows[at] = mine; else rows.push(mine);
  }
  const top = (b.rows || [])[0];
  return {
    lang: ctx.lang,
    d: { topic: await topicOf(ctx.parent), cls: (cls && cls.className) || '', played: b.finishers_n || 0, avgPct: b.class_avg_pct || 0, top: top ? { correct: top.correct, total: top.total } : null, rows },
  };
}

/**
 * The school board around this class's school: the league's own crop (my school and up to 3 either side),
 * so the picture and the page agree. A school with no points yet sits under the leaders as its own row.
 */
async function schoolFacts(code) {
  if (!CODE_RX.test(code)) notFound();
  const ctx = await require('./web-quiz.service').resolveCode(code).catch(() => notFound());
  const near = Schools.neighbours(await Schools.board(code), 3);
  const row = (r, you) => ({ rank: r.place == null ? '–' : r.place, name: r.name, sector: r.sector, points: r.points || 0, kids: r.kids || 0, move: typeof r.move === 'number' ? r.move : 0, you });
  const rows = (near.rows || []).map((r) => row(r, Boolean(r.mine)));
  if (near.mine && !rows.some((r) => r.you)) rows.push(row(near.mine, true));
  if (!rows.length) notFound();
  return { lang: ctx.lang, d: { rows } };
}

async function facts(kind, ref) {
  if (kind === 'c') return cardFacts(ref);
  if (kind === 'i') return inviteFacts(ref);
  if (kind === 'l') return classFacts(ref);
  return schoolFacts(ref);
}

// ─── draw + cache ───────────────────────────────────────────────────────────

async function draw(input) {
  const sharp = getSharp();
  const { htmlToImage } = require('../../utils/html-to-pdf');
  const [w, h] = SIZES[input.size];
  const png = await htmlToImage(renderArt(input), { width: w, height: h, deviceScaleFactor: 1, selector: '.art' });
  return sharp(png).resize(w, h, { fit: 'cover' }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}

function remember(key, bytes) {
  mem.set(key, bytes);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}

/**
 * The picture for a signed id: { bytes, contentType: 'image/jpeg', key }.
 * Throws ArtError(404) for an id we did not issue or a thing that is not there.
 */
async function artImage(id, { size = 'og' } = {}) {
  const p = parseArtId(id);
  if (!p) notFound();
  const sz = SIZES[size] ? size : 'og';
  const f = await facts(p.kind, p.ref);
  const input = { kind: KIND_OF[p.kind], size: sz, brand: await brandKey(), lang: f.lang, d: f.d };
  const key = `wq-art/${crypto.createHash('sha256').update(JSON.stringify({ v: ART_V, ...input })).digest('hex').slice(0, 32)}.jpg`;
  if (mem.has(key)) return { bytes: mem.get(key), contentType: 'image/jpeg', key };
  let bytes = null;
  // Ask first: a picture not drawn yet is a cache miss, and downloadFromR2 logs every failure as an error.
  try {
    if ((await r2.headObject(key)).exists) bytes = await r2.downloadFromR2(key);
  } catch (e) {
    bytes = null;
    logToFile('⚠️ web-quiz art: R2 read failed, drawing instead', { key, error: (e && e.name) || 'error' }, 'warn');
  }
  if (!bytes || !bytes.length) {
    const t0 = Date.now();
    bytes = await draw(input);
    logToFile('web-quiz art drawn', { kind: input.kind, size: sz, ms: Date.now() - t0, kb: Math.round(bytes.length / 1024) });
    try { await r2.uploadBuffer(bytes, key, 'image/jpeg'); } catch (e) { logToFile('⚠️ web-quiz art: R2 upload failed', { error: e.message }); }
  }
  remember(key, bytes);
  return { bytes, contentType: 'image/jpeg', key };
}

function _resetCache() { mem.clear(); }

module.exports = { artId, parseArtId, artImage, ArtError, ART_V, _resetCache, _drawForTests: draw };
