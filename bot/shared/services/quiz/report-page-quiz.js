'use strict';
/**
 * "Make a quiz" made INSIDE the page the closed-window coaching report opens.
 *
 * WHY. With the window closed the transcript quiz offer cannot go (Meta refuses a free-form message, 131047), so
 * closed-window-offer.js writes the session's quiz row as held (status 'skipped', meta.skip_reason 'window_closed').
 * The report still reaches the teacher as one UTILITY template whose URL button opens a page: their /cr report (v10
 * arms C/D, coaching/report-link-button.js) or /cq, a page with only the quiz on it (everyone else,
 * `quiz_page_template`). That page is where the quiz is made, read and handed on: no second message either way.
 *
 * HOW. The portal (dashboard/routes/coaching-report.routes.js) asks the bot over /api/internal/rq
 * (routes/report-quiz-internal.routes.js), naming the session and teacher its signed token carries:
 *   state  held | making | ask (the language, as two page buttons) | ready | failed | none
 *   make   the tap: the same yes as the report template's "Make a quiz" (processOffer, accepted), queued as the
 *          offer job with `page: true`, so the offer, the language ask and the generate step send the teacher nothing
 *          (the generate job's phone is PAGE_NO_SEND; the hand-off mints the code and the PDF and sends nothing). The
 *          row ends 'sent' with meta.made_via 'page', delivered_via 'page': the page is the delivery.
 *   lang   the language choice → generating
 *   pdf    a 1-hour link to the quiz's PDF (meta.pdf_key)
 * Every step is the teacher's own session only (the token's teacher must own it).
 *
 * WHO GETS A PAGE. report_page alone: C/D teachers only (their link template must be on). quiz_page_template: name
 * it only once Meta has approved it as UTILITY on that number (share_dc_report_open_v2; v1 was filed MARKETING and
 * is never named). Either way the session's quiz row is written as held (held_path 'template') when the report went.
 *
 * THE SWITCH. `app_settings.quiz_offer_closed_window`, the same row as the trace:
 *   { "trace": true, "report_page": true, "quiz_page_template": "share_dc_report_open_v2" }
 * Absent, false, or unreadable = off: no page block, the internal route 404s, today's report.
 *
 * The portal requires this file for its switch read (parseSwitch, fetchFrom), so it loads nothing of the bot's at
 * module scope (the portal has no pino). The bot half requires its modules when it runs.
 */

const SETTING = 'quiz_offer_closed_window';
const HELD_REASON = 'window_closed';
// The generate job's phone for a quiz made in the page: never a number, so no step sends it anything.
const PAGE_NO_SEND = 'report_page:no_send';
// A tap on a held row reads as "making" for this long, until the offer job turns the row.
const TAP_FRESH_MS = 10 * 60 * 1000;
const LANGS = Object.freeze(['ur', 'en']);
const SURFACES = Object.freeze(['cq', 'cr']);

const OFF = Object.freeze({ reportPage: false, pageTemplate: null });
/** Meta template names: lowercase letters, digits and underscores. */
const NAME_RE = /^[a-z0-9_]{1,512}$/;

/** { reportPage, pageTemplate } from the row's value. Pure; anything unexpected is off; no report_page = all off. */
function parseParts(value) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch (_) { return { ...OFF }; }
  }
  if (!v || typeof v !== 'object' || Array.isArray(v) || v.report_page !== true) return { ...OFF };
  const name = typeof v.quiz_page_template === 'string' ? v.quiz_page_template.trim() : '';
  return { reportPage: true, pageTemplate: NAME_RE.test(name) ? name : null };
}

/** report_page alone (the portal's question). */
function parseSwitch(value) {
  return parseParts(value).reportPage;
}

async function readParts(db) {
  const { data, error } = await db.from('app_settings').select('key,value').eq('key', SETTING);
  if (error) throw new Error(error.message || 'app_settings read failed');
  const row = (data || [])[0];
  return parseParts(row ? row.value : undefined);
}

/** One read through the given client: report_page. Throws on a failed read (the caller decides: off). */
async function fetchFrom(db) {
  return (await readParts(db)).reportPage;
}

let botSwitch = null;
function botParts(now = Date.now()) {
  if (!botSwitch) {
    const { cachedSwitch } = require('../settings/switch-cache'); // eslint-disable-line global-require
    botSwitch = cachedSwitch({ ttlMs: 30 * 1000, off: () => ({ ...OFF }), read: () => readParts(require('../../config/supabase')) }); // eslint-disable-line global-require
  }
  return botSwitch.get(now);
}
const botSwitchOn = async (now) => {
  try { return (await botParts(now)).reportPage === true; } catch (_) { return false; }
};

/**
 * Asked by coaching/report-window-send.js when the window is closed: the session (when it can take a quiz) and the
 * quiz-page template's name (null = C/D's link template only), or null when report_page is off. Never throws.
 */
async function pageOffer({ coachingSessionId, userId }) {
  try {
    const parts = await botParts();
    if (!parts.reportPage) return null;
    const session = await require('./transcript-quiz-offer.service').quizEligibleSession({ coachingSessionId, userId }); // eslint-disable-line global-require
    return session ? { session, pageTemplate: parts.pageTemplate } : null;
  } catch (_) {
    return null;
  }
}

// ─── the page's half (the bot side of /api/internal/rq) ──────────────────────

function defaults() {
  /* eslint-disable global-require */
  return {
    db: () => require('../../config/supabase'),
    queueJob: (...a) => require('../queue').queueJob(...a),
    log: (event, props) => require('../../utils/structured-logger').logEvent(event, props),
    presign: (key) => require('../../storage/r2').getPresignedGetUrl(key, 3600),
    preview: (code, ids) => require('./web-quiz-link').previewLink(code, ids),
    now: () => Date.now(),
  };
  /* eslint-enable global-require */
}

function safeLog(d, event, props) {
  try { d.log(event, props); } catch (_) { /* logging never decides */ }
}

/** The session when the token's teacher owns it, with their phone; else null. Throws on a failed read. */
async function ownedSession(d, sessionId, userId) {
  if (!sessionId || !userId) return null;
  const { data, error } = await d.db().from('coaching_sessions')
    .select('id, user_id, users!inner(phone_number)').eq('id', sessionId).maybeSingle();
  if (error) throw new Error(error.message || 'coaching_sessions read failed');
  return data && data.user_id === userId ? data : null;
}

async function quizOf(d, sessionId) {
  const { data, error } = await d.db().from('quizzes')
    .select('id, status, language, subject, topic, teacher_id, meta, coaching_session_id')
    .eq('coaching_session_id', sessionId).eq('quiz_source', 'transcript').maybeSingle();
  if (error) throw new Error(error.message || 'quizzes read failed');
  return data || null;
}

// A model or provider fault: making it again can come out differently (the set /quiz remakes, quiz-sources.js), so
// the page offers "Try again", at most MAX_PAGE_RETRIES times per quiz. A lesson-side cause keeps the /quiz line.
const RETRY_REASONS = new Set(['model_failed', 'validator_failed', 'key_conflict', 'key_disagreement', 'queue_failed', 'generate_failed']);
const MAX_PAGE_RETRIES = 2;
const failureReasonOf = (meta) => require('./quiz-sources').failureReasonOf(meta); // eslint-disable-line global-require

const isHeld = (q) => Boolean(q && q.status === 'skipped' && q.meta && q.meta.skip_reason === HELD_REASON);
const byPage = (q) => Boolean(q && q.meta && q.meta.made_via === 'page');

/** The page's questions: text, options in order, the key. */
async function questionsOf(d, quizId) {
  const { data } = await d.db().from('quiz_questions')
    .select('question_text, option_a, option_b, option_c, option_d, correct_option, sort_order')
    .eq('quiz_id', quizId).order('sort_order', { ascending: true });
  return (data || []).map((r) => ({
    text: r.question_text,
    options: ['a', 'b', 'c', 'd'].filter((k) => typeof r[`option_${k}`] === 'string' && r[`option_${k}`].trim())
      .map((k) => ({ key: k.toUpperCase(), text: r[`option_${k}`], correct: String(r.correct_option || '').toUpperCase() === k.toUpperCase() })),
  }));
}

/** True when the children's code no longer opens (switched off or past its expiry). A failed read = open, as today. */
async function codeClosed(d, shareCodeId) {
  if (!shareCodeId) return false;
  try {
    const { data, error } = await d.db().from('quiz_share_codes').select('active, expires_at').eq('id', shareCodeId).maybeSingle();
    if (error || !data) return false;
    const expiry = Date.parse(data.expires_at || '');
    return data.active === false || (Number.isFinite(expiry) && expiry < d.now());
  } catch (_) {
    return false;
  }
}

/**
 * What the page shows for this quiz row. Pure but for the ready state's reads (questions, preview link).
 * @returns {Promise<{state: string, page: boolean, ...}>}
 */
async function stateOf(d, q) {
  const page = byPage(q);
  if (!q) return { state: 'none', page };
  const meta = q.meta || {};
  if (isHeld(q)) {
    const tapped = Date.parse(meta.page_make_at || '');
    // tapped in the page, the job not yet run: the page's own quiz, being made
    return Number.isFinite(tapped) && d.now() - tapped < TAP_FRESH_MS ? { state: 'making', page: true } : { state: 'held', page };
  }
  if (q.status === 'offered' && page && meta.awaiting_language) {
    const rule = LANGS.includes(q.language) ? q.language : LANGS[0];
    return { state: 'ask', page, choices: [rule, ...LANGS.filter((l) => l !== rule)] };
  }
  // A live WhatsApp offer (Yes / Not now) is still the teacher's to take: the page offers it too.
  if (q.status === 'offered') return { state: 'held', page };
  if (['generating', 'ready'].includes(q.status)) return { state: 'making', page };
  if (['sent', 'report_sent'].includes(q.status) && typeof meta.student_message === 'string' && meta.student_message.trim()) {
    let preview = null;
    try { preview = await d.preview(meta.share_code, { shareCodeId: meta.share_code_id, teacherUserId: q.teacher_id }); } catch (_) { preview = null; }
    return {
      state: 'ready', page, quizId: q.id, message: meta.student_message, topic: q.topic || null, language: q.language || null,
      questions: await questionsOf(d, q.id), pdf: Boolean(meta.pdf_key), preview: preview || null,
      ...(await codeClosed(d, meta.share_code_id) ? { closed: true } : {}),
    };
  }
  if (page && (q.status === 'failed' || q.status === 'skipped')) {
    const reason = q.status === 'failed' ? failureReasonOf(meta) : (meta.skip_reason || 'generate_failed');
    if (!RETRY_REASONS.has(reason)) return { state: 'failed', page, reason };
    return (Number(meta.page_remakes) || 0) < MAX_PAGE_RETRIES
      ? { state: 'failed', page, reason, retry: true } : { state: 'failed', page, reason, capped: true };
  }
  return { state: 'none', page };
}

/** The page's state for this session, for its own teacher only (null = not theirs). */
async function pageState({ sessionId, userId }, deps = {}) {
  const d = { ...defaults(), ...deps };
  if (!(await ownedSession(d, sessionId, userId))) return null;
  return stateOf(d, await quizOf(d, sessionId));
}

/**
 * "Make a quiz" tapped in the page. A held row is marked as tapped and the offer job is queued as the page's; any
 * other row is answered with its state (a double tap never queues twice in the same breath).
 * @returns {Promise<object|null>} the state after the tap, or null when the session is not the teacher's
 */
async function makeFromPage({ sessionId, userId, surface }, deps = {}) {
  const d = { ...defaults(), ...deps };
  const where = SURFACES.includes(surface) ? surface : 'cq';
  const session = await ownedSession(d, sessionId, userId);
  if (!session) {
    safeLog(d, 'transcript_quiz.page_make_failed', { coachingSessionId: sessionId, reason: 'not_owner', surface: where });
    return null;
  }
  const q = await quizOf(d, sessionId);
  const before = await stateOf(d, q);
  if (before.state === 'failed' && before.retry) return retryFromPage(d, { q, session, sessionId, userId, where, reason: before.reason });
  if (before.state !== 'held') return before;
  const tapAt = new Date(d.now()).toISOString();
  if (isHeld(q)) {
    await d.db().from('quizzes').update({ meta: { ...(q.meta || {}), page_make_at: tapAt, page_surface: where } })
      .eq('id', q.id).eq('status', 'skipped');
  }
  const phone = String((session.users && session.users.phone_number) || '').replace(/\D/g, '');
  await d.queueJob(sessionId, 'quiz_offer', {
    coachingSessionId: sessionId, userId, phone, accepted: true, page: true, tapAt, surface: where, source: 'offer',
  }, { delaySeconds: 0 });
  safeLog(d, 'transcript_quiz.page_make_tap', { coachingSessionId: sessionId, quizId: q ? q.id : null, surface: where });
  return { state: 'making', page: true };
}

/**
 * "Try again" after a model fault: the row goes back to held, marked as tapped, in one conditional write (a double tap
 * moves it once), and the offer job is queued with the retry's count, which the offer carries onto the revived row.
 */
async function retryFromPage(d, { q, session, sessionId, userId, where, reason }) {
  const meta = q.meta || {};
  const remakes = (Number(meta.page_remakes) || 0) + 1;
  const tapAt = new Date(d.now()).toISOString();
  const { data: moved } = await d.db().from('quizzes').update({
    status: 'skipped',
    meta: { step: 'skipped', skip_reason: HELD_REASON, held_path: meta.held_path || null, made_via: 'page',
      page_make_at: tapAt, page_surface: where, page_remakes: remakes, page_last_failure: reason },
  }).eq('id', q.id).eq('status', q.status).select('id');
  if (!moved || !moved.length) return stateOf(d, await quizOf(d, sessionId));
  const phone = String((session.users && session.users.phone_number) || '').replace(/\D/g, '');
  await d.queueJob(sessionId, 'quiz_offer', {
    coachingSessionId: sessionId, userId, phone, accepted: true, page: true, tapAt, surface: where, source: 'offer', remakes,
  }, { delaySeconds: 0 });
  safeLog(d, 'transcript_quiz.page_make_tap', { coachingSessionId: sessionId, quizId: q.id, surface: where, retry: true, remakes });
  return { state: 'making', page: true };
}

/** The language picked on the page → generating. null when not theirs; the state otherwise. */
async function chooseLanguage({ sessionId, userId, language }, deps = {}) {
  const d = { ...defaults(), ...deps };
  const session = await ownedSession(d, sessionId, userId);
  if (!session) return null;
  const q = await quizOf(d, sessionId);
  const now = await stateOf(d, q);
  if (now.state !== 'ask' || !LANGS.includes(language)) return now;
  const phone = String((session.users && session.users.phone_number) || '').replace(/\D/g, '');
  const Offer = require('./transcript-quiz-offer.service'); // eslint-disable-line global-require
  await Offer.handleLanguageButton(`tq_lang_${language}_${q.id}`, phone, null, { page: true });
  return stateOf(d, await quizOf(d, sessionId));
}

/** A 1-hour link to the quiz's PDF, or null (not theirs, not ready, no PDF). */
async function pdfFor({ sessionId, userId }, deps = {}) {
  const d = { ...defaults(), ...deps };
  if (!(await ownedSession(d, sessionId, userId))) return null;
  const q = await quizOf(d, sessionId);
  const key = q && ['sent', 'report_sent'].includes(q.status) && q.meta && q.meta.pdf_key;
  return key ? d.presign(key) : null;
}

function _resetCache() { if (botSwitch) botSwitch.reset(); }

module.exports = {
  SETTING, PAGE_NO_SEND, LANGS, SURFACES, parseParts, parseSwitch, fetchFrom, pageOffer, botSwitchOn,
  pageState, makeFromPage, chooseLanguage, pdfFor, _resetCache,
};
