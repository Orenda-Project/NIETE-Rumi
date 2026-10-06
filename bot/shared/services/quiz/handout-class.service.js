'use strict';
/**
 * Which class is this hand-out for?
 *
 * A share code is the hand-out unit: the thing a class's children open. Bound
 * to a class (`quiz_share_codes.class_id`), it lets the web quiz match a child
 * against THAT class's roster and lets the teacher's report list who has not
 * played. The class comes from web-quiz-identity's resolveQuizClass:
 *   known     → bound at mint, nothing new is sent;
 *   ambiguous → the hand-out goes out exactly as before (unbound), THEN one
 *               question: "Which class is this quiz for?" — the class labels +
 *               "All / not sure". A tap binds that code late; "All / not sure"
 *               leaves it unbound (the child is asked on the quiz page);
 *   none      → unbound, as before.
 *
 * The hand-out never waits on the question: a quiz the teacher asked for must
 * arrive whether or not they answer. A child who opens it in the seconds before
 * the answer is asked their class on the page, which is fine.
 *
 * Each button carries the share code it is about (`vq_wc_<code id>_<class id>`
 * / `vq_wc_<code id>_any`), so two hand-outs in a row can never bind each
 * other's codes. The offered classes are kept per code in Redis for a week; a
 * tap after that binds nothing.
 */
const supabase = require('../../config/supabase');
const redisService = require('../cache/railway-redis.service');
const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');

// Never `vq_<x>_<digits>`: that shape is a quiz answer to render.parseAnswer,
// and handleAnswer is the catch-all of the vq_ chain. Uuids carry hyphens.
const TAP_PREFIX = 'vq_wc_';
const ANY = 'any';
const ASK_TTL_SECS = 7 * 24 * 60 * 60;
// Meta: 3 reply buttons (two classes + Any), 10 list rows (nine classes + Any).
const MAX_BUTTON_CLASSES = 2;
const MAX_LIST_CLASSES = 9;
const BUTTON_MAX = 20;
const ROW_TITLE_MAX = 24;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TAP_RX = new RegExp(`^${TAP_PREFIX}(${UUID})_(${UUID}|${ANY})$`, 'i');

const ASK_KEY = (shareCodeId) => `videoquiz:whichclass:${shareCodeId}`;
const tapId = (shareCodeId, classId) => `${TAP_PREFIX}${shareCodeId}_${classId}`;
const stripPlus = (p) => String(p || '').replace(/^\+/, '');
const clampCp = (s, n) => [...String(s || '')].slice(0, n).join('');
const ux = (key, language, params) => resolveUx(key, { language, params });
const NONE = Object.freeze({ state: 'none', class: null, classes: [] });

// ─── resolving ──────────────────────────────────────────────────────────────

let resolverMissingLogged = false;

/**
 * resolveQuizClass, failing open: any error is "none" (today's behaviour), logged.
 * @returns {Promise<{state:'known'|'ambiguous'|'none', class:object|null, classes:object[]}>}
 */
async function resolveClass({ teacherUserId, quizId }) {
  if (!teacherUserId || !quizId) return NONE;
  try {
    const { resolveQuizClass } = require('./web-quiz-identity');
    const r = await resolveQuizClass({ teacherUserId, quizId });
    if (r && r.state === 'known' && r.class && r.class.id) return r;
    // A legacy list standing in for a class has no class id: nothing a code can
    // be bound to, so it is never offered.
    const bindable = r && r.state === 'ambiguous' && Array.isArray(r.classes) ? r.classes.filter((c) => c && c.id) : [];
    if (bindable.length) return { ...r, classes: bindable };
    return NONE;
  } catch (err) {
    if (err && err.code === 'MODULE_NOT_FOUND' && /web-quiz-identity/.test(err.message || '')) {
      if (!resolverMissingLogged) {
        resolverMissingLogged = true;
        logToFile('⚠️ hand-out class: web-quiz-identity is not deployed here — hand-outs stay unbound', {}, 'warn');
      }
      return NONE;
    }
    logToFile('⚠️ hand-out class: resolveQuizClass failed — minting unbound', { quizId, error: err.message }, 'warn');
    logEvent('web_quiz.class_resolve_failed', { quizId, teacherUserId, error: String((err && err.code) || 'error') });
    return NONE;
  }
}

/** The class id to mint with: only a KNOWN class binds at mint. */
const classIdToMint = (resolved) => (resolved && resolved.state === 'known' ? resolved.class.id : null);

// ─── the class_id column may not exist yet on this environment ─────────────

let classColumnMissing = false;

const classColumnAvailable = () => !classColumnMissing;

/** Postgres 42703 (undefined column) or PostgREST's PGRST204 (column not in the schema cache). */
function isMissingClassColumn(error) {
  if (!error) return false;
  const code = String(error.code || '');
  return (code === '42703' || code === 'PGRST204') && /class_id/.test(String(error.message || ''));
}

function markClassColumnMissing({ quizId } = {}) {
  if (classColumnMissing) return;
  classColumnMissing = true;
  logToFile('⚠️ quiz_share_codes.class_id does not exist here — hand-outs mint unbound until web_quiz_v2_identity.sql runs', { quizId }, 'warn');
  logEvent('web_quiz.class_bind_unavailable', { quizId: quizId || null });
}

// ─── coaching-born quizzes: the class's grade ──────────────────────────────

/**
 * A quiz with no grade (coaching-born ones often have none) takes its bound
 * class's grade, so grade filters (hub, library, class progress) see it. Only
 * the teacher's own quiz, never a shared video quiz (one row serves every
 * teacher), never over a grade already set, never a grade with no number.
 */
async function fillGradeIfEmpty({ quizId, teacherUserId, classId }) {
  try {
    const { data: quiz } = await supabase.from('quizzes')
      .select('grade, quiz_source, teacher_id').eq('id', quizId).maybeSingle();
    if (!quiz || quiz.grade !== null || quiz.quiz_source === 'video' || quiz.teacher_id !== teacherUserId) return false;
    const { data: cls } = await supabase.from('classes').select('grade_code').eq('id', classId).maybeSingle();
    const m = /^grade_(\d{1,2})$/.exec((cls && cls.grade_code) || '');
    if (!m) return false;
    // Conditional on still being NULL: a writer that got there first wins.
    const { error } = await supabase.from('quizzes').update({ grade: m[1] }).eq('id', quizId).is('grade', null);
    if (error) throw new Error(error.message);
    logEvent('web_quiz.quiz_grade_from_class', { quizId, classId, grade: m[1] });
    return true;
  } catch (err) {
    logToFile('⚠️ hand-out class: grade fill failed (non-fatal)', { quizId, error: err.message }, 'warn');
    return false;
  }
}

// ─── asking (after the hand-out went out) ──────────────────────────────────

const byLabel = (a, b) => String(a.label).localeCompare(String(b.label), 'en', { numeric: true });

/**
 * "Which class is this quiz for?" about a code that has ALREADY been sent,
 * unbound. Never throws: the hand-out is out either way.
 * @returns {Promise<boolean>} whether the question went out
 */
async function askAfterHandout(phone, { shareCodeId, quizId, userId, language }, classes) {
  try {
    if (!shareCodeId || !Array.isArray(classes) || !classes.length) return false;
    const lang = clampLanguage(language);
    const all = [...classes].sort(byLabel);
    const shape = all.length <= MAX_BUTTON_CLASSES ? 'buttons' : 'list';
    const shown = shape === 'buttons' ? all : all.slice(0, MAX_LIST_CLASSES);
    await redisService.set(ASK_KEY(shareCodeId), {
      phone: stripPlus(phone), classes: shown.map((c) => ({ id: c.id, label: c.label })),
      quizId, userId, language: lang, askedAt: Date.now(),
    }, ASK_TTL_SECS);

    const body = ux('vqWhichClass', lang);
    let ok;
    if (shape === 'buttons') {
      ok = await WhatsAppService.sendInteractiveButtons(phone, {
        body,
        buttons: [
          ...shown.map((c) => ({ id: tapId(shareCodeId, c.id), title: clampCp(c.label, BUTTON_MAX) })),
          { id: tapId(shareCodeId, ANY), title: ux('vqWhichClassAny', lang) },
        ],
      });
    } else {
      ok = await WhatsAppService.sendInteractiveMessage(phone, {
        body: { text: body },
        action: {
          button: ux('vqWhichClassPick', lang),
          sections: [{
            rows: [
              ...shown.map((c) => ({ id: tapId(shareCodeId, c.id), title: clampCp(c.label, ROW_TITLE_MAX) })),
              { id: tapId(shareCodeId, ANY), title: clampCp(ux('vqWhichClassAny', lang), ROW_TITLE_MAX) },
            ],
          }],
        },
      });
    }
    logEvent('web_quiz.class_ask_sent', { quizId, userId, shareCodeId, classes: all.length, shape, sent: Boolean(ok) });
    if (!ok) await redisService.delete(ASK_KEY(shareCodeId));
    return Boolean(ok);
  } catch (err) {
    logToFile('⚠️ hand-out class: the class question failed (the hand-out is already out)', { quizId, error: err.message }, 'warn');
    return false;
  }
}

// ─── the answer ─────────────────────────────────────────────────────────────

/** Bind an already-minted code (only while it has no class) and confirm to the teacher. */
async function bindCode(phone, { shareCodeId, quizId, userId, language }, chosen) {
  const { error } = await supabase.from('quiz_share_codes')
    .update({ class_id: chosen.id }).eq('id', shareCodeId).is('class_id', null);
  if (error) {
    if (isMissingClassColumn(error)) markClassColumnMissing({ quizId });
    else logToFile('⚠️ hand-out class: bind failed', { quizId, error: error.message }, 'warn');
    return false;
  }
  await fillGradeIfEmpty({ quizId, teacherUserId: userId, classId: chosen.id });
  await WhatsAppService.sendMessage(phone, ux('vqWhichClassBound', clampLanguage(language), { cls: chosen.label }));
  return true;
}

/**
 * A `vq_wc_` button or list row. Every such id is claimed (a stale or foreign
 * one does nothing), so it can never fall through to handleAnswer.
 */
async function handleTap(id, phone) {
  if (!String(id || '').startsWith(TAP_PREFIX)) return false;
  const m = TAP_RX.exec(String(id));
  if (!m) {
    logEvent('web_quiz.class_ask_stale', { reason: 'bad_id' });
    return true;
  }
  const [, shareCodeId, pick] = m;
  const ask = await redisService.get(ASK_KEY(shareCodeId));
  if (!ask) {
    // A week has passed, or it was already answered: the code stays as it is.
    logEvent('web_quiz.class_ask_expired', { shareCodeId, reason: 'tap_after_ttl' });
    return true;
  }
  if (ask.phone !== stripPlus(phone)) {
    logEvent('web_quiz.class_ask_stale', { shareCodeId, reason: 'other_phone' });
    return true;
  }
  if (pick.toLowerCase() === ANY) {
    await redisService.delete(ASK_KEY(shareCodeId));
    logEvent('web_quiz.class_ask_answered', { quizId: ask.quizId, shareCodeId, via: 'any', bound: false });
    return true;
  }
  const chosen = (ask.classes || []).find((c) => String(c.id).toLowerCase() === pick.toLowerCase());
  if (!chosen) {
    logEvent('web_quiz.class_ask_stale', { shareCodeId, reason: 'class_not_offered' });
    return true;
  }
  await redisService.delete(ASK_KEY(shareCodeId));
  const bound = await bindCode(phone, { shareCodeId, quizId: ask.quizId, userId: ask.userId, language: ask.language }, chosen);
  logEvent('web_quiz.class_ask_answered', { quizId: ask.quizId, shareCodeId, via: 'tap', bound });
  return true;
}

function _resetForTests() {
  classColumnMissing = false;
  resolverMissingLogged = false;
}

module.exports = {
  resolveClass, classIdToMint, askAfterHandout, handleTap, bindCode, fillGradeIfEmpty,
  classColumnAvailable, isMissingClassColumn, markClassColumnMissing,
  TAP_PREFIX, ASK_KEY,
  _resetForTests,
};
