'use strict';
/**
 * THE SHARE PICTURES, served (web quiz). What travels with a child's share:
 *
 *   c  my card        ref = the session id     (the kept first-try score, as the league shows)
 *   i  the invite     ref = the challenge code (the challenger's counted score, from the DB)
 *   l  my class       ref = the class code, or the sharer's session (top rows as place + animal +
 *                     score; only the sharer's own row is named, "(me)")
 *   s  my school      ref = the class code     (the school board around this class's school)
 *   t  the class link ref = the class code's id  (drawn by web-quiz-class-pic.js: the teacher's own link, a PNG)
 *
 * The id is signed: "<kind>.<ref>.<mac12>". A link preview fetches the picture
 * with no session, so the id itself is the permission, and the mac stops
 * anyone making the server draw for an id it never issued. A session id
 * travels as its 16 bytes in base64url (22 characters).
 *
 * Drawn once per content: the facts (not the HTML, which carries megabytes of
 * fonts) are hashed with the template version into the R2 key
 * wq-art/<hash>.jpg. A cache miss draws and serves, and uploads in the background; R2 failing never
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
const { logEvent } = require('../../utils/structured-logger');
const T = require('./web-quiz-token');
const WebQuizBrand = require('../../config/web-quiz-brand');
const { orgName, botName } = require('../../config/branding');
const { pageTopic } = require('./quiz-child-title');
const { renderArt, SIZES } = require('../../templates/web-quiz-art.template');
const { clampLanguage } = require('../../config/ux-strings');
const { artId, parseArtId, UUID_RX } = require('./web-quiz-art-id');
const Schools = require('./web-quiz-schools');

const ART_V = 3;               // bump when the template's look, words or encoding change: every picture is drawn afresh (2: neutral Urdu invite, 0/N challenger; 3: q72)
const MEM_MAX = 64;
const CODE_RX = /^[A-Z0-9]{4,12}$/;
const KIND_OF = { c: 'card', i: 'invite', l: 'class', s: 'school' };

const mem = new Map();
// A picture id seen before -> its drawn key, so a repeat (the link preview after the scorecard warmed it) skips
// the facts' database reads. A card or invite never changes; a class or school picture moves as children play.
const byId = new Map();
const BY_ID_MS = { c: 86400000, i: 86400000, l: 120000, s: 120000 };

class ArtError extends Error {
  constructor(status, error) { super(error); this.status = status; this.body = { error }; }
}
const notFound = () => { throw new ArtError(404, 'not_found'); };

// ─── the facts each picture shows ───────────────────────────────────────────

async function brandKey() {
  try { return await WebQuizBrand.resolveBrandKey({ db: supabase, orgName, botName }); } catch { return WebQuizBrand.DEFAULT_BRAND; }
}

// want: the share's own language (web_quiz_share_pic_lang), in place of the class code's; null: the code's, as today
async function topicOf(sc, want = null) {
  const { data: q } = await supabase.from('quizzes').select('topic, meta').eq('id', sc.quiz_id).maybeSingle();
  return pageTopic({ lang: want || clampLanguage(sc.language), meta: q && q.meta, fallback: sc.topic || (q && q.topic) });
}

async function cardFacts(sessionId, want = null) {
  if (!UUID_RX.test(sessionId) && !/^[A-Za-z0-9-]{1,40}$/.test(sessionId)) notFound();
  const WebQuiz = require('./web-quiz.service');
  const { data: s } = await supabase.from('quiz_sessions')
    .select('id, student_id, student_name, share_code_id, status, user_id, invited_by_student_id, correct_answers, total_questions_answered, completed_at')
    .eq('id', sessionId).maybeSingle();
  if (!s || s.status !== 'completed' || !s.share_code_id || s.user_id) notFound();
  const { data: sc } = await supabase.from('quiz_share_codes').select('id, code, quiz_id, topic, language').eq('id', s.share_code_id).maybeSingle();
  if (!sc) notFound();
  const lang = want || clampLanguage(sc.language);
  // An invited friend is not in the challenger's class: their card names neither that class nor its school.
  const friend = Boolean(s.invited_by_student_id);
  // Independent lookups, together: the finish draws this card straight away, and one after another they took ~3.5 s.
  const [kept, nameOf, cls, school, topic] = await Promise.all([
    keptScore(s),
    WebQuiz.shownNames(lang, [s.student_id]),
    friend ? null : require('./video-quiz-report.service').loadClassRows(sc.id).catch(() => null),
    friend ? {} : schoolLine(sc.code, s),
    topicOf(sc, want),
  ]);
  return {
    lang,
    d: {
      first: nameOf(s.student_id, s.student_name), animal: T.animalFor(s.student_id || s.id),
      correct: kept.correct_answers || 0, total: kept.total_questions_answered || 0, topic, cls: (cls && cls.className) || '',
      ...school,
    },
  };
}

// The kept score (the child's first finish on the class code): one copy, shared with the card's result.
const { keptScore } = require('./web-quiz-card-data');

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

async function inviteFacts(code, want = null) {
  if (!CODE_RX.test(code)) notFound();
  const WebQuiz = require('./web-quiz.service');
  const ctx = await WebQuiz.resolveCode(code).catch(() => notFound());
  if (!ctx.invitedByStudentId) notFound();
  // the challenger's name as the picture's language shows it
  const ch = await WebQuiz.challengeOf(want ? { ...ctx, lang: want } : ctx);
  if (!ch) notFound();
  return { lang: want || ctx.lang, d: { first: ch.first, correct: ch.correct, total: ch.total, topic: await topicOf(ctx.parent, want) } };
}

const CLASS_ROWS = 5;

/** The class, by its code (nobody named) or by the sharer's session (their own row named). */
async function classFacts(ref, want = null) {
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
  // A storybook code has no class table (story-board.js): its board's 404 is this picture's 404, never a 500.
  const b = await WebQuiz.board(code, me ? { st: stFor(me) } : {}).catch((e) => (e && e.status === 404 ? notFound() : Promise.reject(e)));
  const cls = await require('./video-quiz-report.service').loadClassRows(ctx.shareCodeId).catch(() => null);
  // Classmates appear as place + animal + score only: the picture outlives the link and gets forwarded.
  const rows = (b.rows || []).slice(0, CLASS_ROWS).map((r) => ({ place: r.place, animal: r.animal, correct: r.correct, total: r.total }));
  if (me && b.you) {
    const nameOf = await WebQuiz.shownNames(want || ctx.lang, [me.student_id]);
    const mine = { place: b.you.place, animal: T.animalFor(me.student_id || me.id), correct: b.you.correct, total: b.you.total, me: true, first: nameOf(me.student_id, me.student_name) };
    const at = rows.findIndex((r) => r.place === mine.place && r.animal === mine.animal && r.correct === mine.correct);
    if (at >= 0) rows[at] = mine; else rows.push(mine);
  }
  const top = (b.rows || [])[0];
  return {
    lang: want || ctx.lang,
    d: { topic: await topicOf(ctx.parent, want), cls: (cls && cls.className) || '', played: b.finishers_n || 0, avgPct: b.class_avg_pct || 0, top: top ? { correct: top.correct, total: top.total } : null, rows },
  };
}

/**
 * The school board around this class's school: the league's own crop (my school and up to 3 either side),
 * so the picture and the page agree. A school with no points yet sits under the leaders as its own row.
 */
async function schoolFacts(code, want = null) {
  if (!CODE_RX.test(code)) notFound();
  const ctx = await require('./web-quiz.service').resolveCode(code).catch(() => notFound());
  const near = Schools.neighbours(await Schools.board(code), 3);
  const row = (r, you) => ({ rank: r.place == null ? '–' : r.place, name: r.name, sector: r.sector, points: r.points || 0, kids: r.kids || 0, move: typeof r.move === 'number' ? r.move : 0, you });
  const rows = (near.rows || []).map((r) => row(r, Boolean(r.mine)));
  if (near.mine && !rows.some((r) => r.you)) rows.push(row(near.mine, true));
  if (!rows.length) notFound();
  return { lang: want || ctx.lang, d: { rows } };
}

async function facts(kind, ref, want = null) {
  if (kind === 'c') return cardFacts(ref, want);
  if (kind === 'i') return inviteFacts(ref, want);
  if (kind === 'l') return classFacts(ref, want);
  if (kind === 's') return schoolFacts(ref, want);
  return notFound();
}

// ─── draw + cache ───────────────────────────────────────────────────────────

// Every draw is a headless-browser render in the one bot process that also serves WhatsApp: at most DRAW_MAX at
// once (a class finishing together asks for many pictures), the rest wait their turn.
const DRAW_MAX = 2;
let drawing = 0;
const turns = [];
async function drawTurn(fn) {
  if (drawing >= DRAW_MAX) await new Promise((r) => turns.push(r));
  drawing += 1;
  try { return await fn(); } finally {
    drawing -= 1;
    const next = turns.shift();
    if (next) next();
  }
}

async function draw(input) {
  return drawTurn(() => drawNow(input));
}

async function drawNow(input) {
  const sharp = getSharp();
  const { htmlToImage } = require('../../utils/html-to-pdf');
  const [w, h] = SIZES[input.size];
  // a picture that fits its words to the drawn fonts (web_quiz_share_copy_one's Urdu class table) asks for its hook to run
  const fit = Boolean(input.ui && input.ui.one === true);
  const png = await htmlToImage(renderArt(input), { width: w, height: h, deviceScaleFactor: 1, selector: '.art', ...(fit ? { beforeCapture: true } : {}) });
  // q72: the phone downloads the picture after the preview's text is already showing; 27-29% fewer bytes than q82
  // on the real card and invite, no visible loss at 1200x630.
  return sharp(png).resize(w, h, { fit: 'cover' }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
}

function remember(key, bytes) {
  mem.set(key, bytes);
  if (mem.size > MEM_MAX) mem.delete(mem.keys().next().value);
}

/**
 * The picture for a signed id: { bytes, contentType: 'image/jpeg', key }.
 * Throws ArtError(404) for an id we did not issue or a thing that is not there.
 */
// One event per picture served (kind, size, ms, from: drawn | r2 | mem, and where the time went): a link preview fetches
// the picture with no session, so this is how the logs show a phone fetched one. No id, code or name.
function served(input, t0, from, steps = {}) {
  logEvent('web_quiz.art_served', { kind: input.kind, size: input.size, ms: Date.now() - t0, from, ...steps });
}

// A picture being drawn right now: a second caller (the scorecard, a moment after the finish asked) waits for the
// same draw instead of starting another.
const inflight = new Map();

// fresh: the caller knows this picture was never drawn (a card at the finish of its session), so R2 is not asked.
// code: the /q/<CODE> the picture was asked under; only the class link's picture (kind t) reads it.
// door: the invite for the friend's door (web_quiz_challenge_fold asks for it); any other picture ignores it.
// lang: the share's language (en|ur, the page's own); drawn in it only with web_quiz_share_pic_lang on, and kept apart
// per language, so an English share never gets the Urdu picture drawn for the same id. Off or absent: the code's, as today.
function artImage(id, { size = 'og', fresh = false, code = null, door = false, lang = null } = {}) {
  // The class link's picture (web-quiz-class-pic.js): its own facts, switches and PNG; never this module's kinds.
  if (typeof id === 'string' && id.startsWith('t.')) return require('./web-quiz-class-pic').image(id, { code, drawTurn, ArtError });
  const dr = door === true && typeof id === 'string' && id.startsWith('i.');
  const l = lang === 'en' || lang === 'ur' ? lang : null;
  const k = `${id}|${SIZES[size] ? size : 'og'}${dr ? '|door' : ''}${l ? `|${l}` : ''}`;
  if (inflight.has(k)) return inflight.get(k);
  const p = artImageNow(id, { size, fresh, door: dr, lang: l }).finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

const { artInput } = require('./web-quiz-art-input');

async function wantLang(lang) {
  if (!lang) return null;
  const Switch = require('./web-quiz-card-switch');
  await Switch.on().catch(() => false);
  return Switch.picLangCached() ? lang : null;
}

async function artImageNow(id, { size = 'og', fresh = false, door = false, lang = null } = {}) {
  const t0 = Date.now();
  const p = parseArtId(id);
  if (!p) notFound();
  const sz = SIZES[size] ? size : 'og';
  const want = await wantLang(lang);
  const at = `${id}|${sz}${door ? '|door' : ''}${want ? `|${want}` : ''}`;
  const seen = byId.get(at);
  if (seen && seen.until > Date.now() && mem.has(seen.key)) {
    served({ kind: KIND_OF[p.kind], size: sz }, t0, 'mem');
    return { bytes: mem.get(seen.key), contentType: 'image/jpeg', key: seen.key };
  }
  const [f, brand, ui, ink] = await Promise.all([
    facts(p.kind, p.ref, want), brandKey(), require('./web-quiz-ur-polish').ui().catch(() => null),
    require('./web-quiz-card-switch').shareOn().catch(() => false),
  ]);
  const steps = { facts_ms: Date.now() - t0, r2_ms: 0, draw_ms: 0 };
  // the one share on: an Urdu picture with room for its ink (its own key); an English one is unchanged
  // Urdu digits (web_quiz_share_ur_digits, read in the same switch read as the share): an Urdu picture says ۴/۷ as its page does
  const ud = f.lang === 'ur' && require('./web-quiz-card-switch').urDigitsCached();
  const u = ink && f.lang === 'ur' ? { ...(ui || {}), ink: true } : ui;
  // the card's name fits its picture (web_quiz_share_name_fit, the same read)
  const nf = p.kind === 'c' && require('./web-quiz-card-switch').nameFitCached();
  const u2 = ud ? { ...(u || {}), ud: true } : u;
  const u3 = nf ? { ...(u2 || {}), nf: true } : u2;
  // the Urdu card, challenge and class table pictures as one stack (web_quiz_share_ur_stack, the same read); English never changes
  const us = f.lang === 'ur' && (p.kind === 'c' || p.kind === 'i' || p.kind === 'l') && require('./web-quiz-card-switch').urStackCached();
  const u4 = us ? { ...(u3 || {}), us: true } : u3;
  // the challenge and class table pictures' polish, both languages (web_quiz_share_pic_polish, the same read)
  const pp = (p.kind === 'i' || p.kind === 'l') && require('./web-quiz-card-switch').picPolishCached();
  const u5 = pp ? { ...(u4 || {}), pp: true } : u4;
  // one child, one kid on the class table and the school pictures (web_quiz_share_copy_one, the same read)
  const one = (p.kind === 'l' || p.kind === 's') && require('./web-quiz-card-switch').copyOneCached();
  const u6 = one ? { ...(u5 || {}), one: true } : u5;
  // each Urdu count keeps its word on the class table and the school pictures, and the school picture names its sectors
  // by their display names in either language (web_quiz_share_bidi, the same read)
  const nb = ((f.lang === 'ur' && p.kind === 'l') || p.kind === 's') && require('./web-quiz-card-switch').shareBidiCached();
  const u7 = nb ? { ...(u6 || {}), nb: true } : u6;
  // the Urdu class table picture's numbers in the digit face, never Nastaliq's (a lone ۱ reads as alif there;
  // web_quiz_end_copy_fix, the same read)
  const dg = f.lang === 'ur' && p.kind === 'l' && require('./web-quiz-card-switch').endCopyCached();
  const input = artInput(KIND_OF[p.kind], sz, brand, f, dg ? { ...(u7 || {}), dg: true } : u7, door);
  const key = `wq-art/${crypto.createHash('sha256').update(JSON.stringify({ v: ART_V, ...input })).digest('hex').slice(0, 32)}.jpg`;
  if (mem.has(key)) {
    byId.set(at, { key, until: Date.now() + BY_ID_MS[p.kind] });
    served(input, t0, 'mem', steps);
    return { bytes: mem.get(key), contentType: 'image/jpeg', key };
  }
  let bytes = null;
  let from = 'r2';
  // Ask first: a picture not drawn yet is a cache miss, and downloadFromR2 logs every failure as an error.
  // A fresh picture (a card at its session's finish) cannot be in R2: asking would only delay its draw.
  const r0 = Date.now();
  try {
    if (!fresh && (await r2.headObject(key)).exists) bytes = await r2.downloadFromR2(key);
  } catch (e) {
    bytes = null;
    logToFile('⚠️ web-quiz art: R2 read failed, drawing instead', { key, error: (e && e.name) || 'error' }, 'warn');
  }
  steps.r2_ms = Date.now() - r0;
  if (!bytes || !bytes.length) {
    const d0 = Date.now();
    from = 'drawn';
    bytes = await draw(input);
    steps.draw_ms = Date.now() - d0;
    logToFile('web-quiz art drawn', { kind: input.kind, size: sz, ms: Date.now() - d0, kb: Math.round(bytes.length / 1024) });
    // R2 is the next process's cache: it fills in the background, so the picture (and a link preview waiting on
    // it) never waits for the upload (~1 s on sandbox).
    const up = bytes;
    Promise.resolve().then(() => r2.uploadBuffer(up, key, 'image/jpeg'))
      .catch((e) => logToFile('⚠️ web-quiz art: R2 upload failed', { error: (e && e.message) || 'error' }));
  }
  remember(key, bytes);
  byId.set(at, { key, until: Date.now() + BY_ID_MS[p.kind] });
  if (byId.size > MEM_MAX * 4) byId.delete(byId.keys().next().value);
  served(input, t0, from, steps);
  return { bytes, contentType: 'image/jpeg', key };
}

function _resetCache() { mem.clear(); byId.clear(); }

// drawTurn: the one headless queue every server-drawn picture waits in (the finish card's too, web-quiz-card-image.js).
module.exports = { artId, parseArtId, artImage, ArtError, ART_V, _resetCache, _drawForTests: draw, artInput, drawTurn };
