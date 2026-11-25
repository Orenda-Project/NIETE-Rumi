'use strict';
/**
 * What the teacher home sends and starts. The class messages are TODAY's, from the code that already writes them:
 *
 *   video   a library video quiz: maker.bank make (the maker's own code reuse + mintCode + vqClassMessage)
 *   share   a library quiz the teacher already sent: maker.bank shareMessage (the same message rebuilt for that code)
 *   again   the teacher's own lesson / coaching quiz: its stored `meta.student_message` (the forwardable the chat
 *           hand-out wrote), only when the quiz is theirs and its code is still live
 * Every one ends with `cm.return` (the "any day: send quiz" line) when the bot's number is known, and goes to the
 * class through `https://wa.me/?text=` — the page's plain link, 0 bot replies. The report arrives as today because
 * every code here is minted through mintCode.
 *
 * "Quiz this" starts the EXISTING job: a lesson-plan provider's start / the recording's startTranscriptLesson (the
 * daily cap and the chat hand-out are untouched); the page then polls quizStatus until the forwardable exists.
 */
const { returnLineText } = require('./teacher-home.copy');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');

const SENT = new Set(['sent', 'report_sent']);
const REMAKE = new Set(['none', 'offered', 'failed']);

const supabaseOf = (deps) => (deps && deps.supabase) || require('../../config/supabase');
const bankOf = (deps) => (deps && deps.Bank) || require('./maker.bank');
const listOf = (deps) => (deps && deps.List) || require('../quiz/transcript-quiz-list.service');
const providersOf = (deps) => (deps && deps.Providers) || require('../quiz/quiz-lesson-providers');
const transcriptOf = (deps) => (deps && deps.Transcript) || require('../quiz/transcript-lesson-provider');
const messageLang = (lang) => (lang === 'en' ? 'en' : 'ur');
// The language an own quiz's stored message was written in (quizzes.language), when this deployment offers it, else null.
const quizLangOf = (q) => { try { return q && require('../../config/languages').isOffered(q.language) ? q.language : null; } catch (_) { return null; } };

/** The message with the return line appended (a blank line before it); unchanged when the bot's number is unknown. */
function withReturn(message, lang) {
  const line = returnLineText(messageLang(lang));
  return line && typeof message === 'string' && message ? `${message}\n\n${line}` : message;
}

const waHref = (message) => `https://wa.me/?text=${encodeURIComponent(message)}`;
const sendable = (message, lang) => {
  const m = withReturn(message, lang);
  return { message: m, wa: waHref(m) };
};

/** The bank chip for a quiz id, wherever it sits in the tree; null when it is not a live library quiz. */
async function chipFor(quizId, deps) {
  const tree = await bankOf(deps).chipTree();
  for (const g of Object.keys(tree || {})) {
    for (const s of Object.keys(tree[g] || {})) {
      const t = (tree[g][s] || []).find((x) => x.quizId === quizId);
      if (t) return { grade: g, subject: s, quizId, topic: t.topic };
    }
  }
  return null;
}

/** A library video quiz → { message, wa, shareCodeId } | null. */
async function videoSend({ uid, lang, quizId }, deps) {
  const Sent = require('./teacher-home.sent');
  // a code minted just to show its message is not a send until the tap: with no store to mark it, mint nothing
  if (!Sent.canMark()) return null;
  const chip = await chipFor(quizId, deps);
  if (!chip) return null;
  const out = await bankOf(deps).make({ uid, lang, grade: chip.grade, subject: chip.subject, quizId });
  if (!out || out.error || typeof out.message !== 'string') return null;
  if (out.minted && !(await Sent.markPrepared(out.shareCodeId))) {
    // the store refused the mark: retire the code just minted, so it can never read as a send ("Send again")
    const { error } = await supabaseOf(deps).from('quiz_share_codes').update({ active: false })
      .eq('id', out.shareCodeId).eq('teacher_user_id', uid);
    if (error) logToFile('❌ teacher home: a code shown but not marked could not be retired', { error: error.message }, 'error');
    return null;
  }
  return { ...sendable(out.message, lang), shareCodeId: out.shareCodeId, quizId };
}

/** A library quiz the teacher already holds a code for → { message, wa, shareCodeId } | null. */
async function shareSend({ uid, lang, shareCodeId }, deps) {
  const out = await bankOf(deps).shareMessage({ uid, lang, shareCodeId });
  if (!out || typeof out.message !== 'string') return null;
  return { ...sendable(out.message, lang), shareCodeId, quizId: out.quizId };
}

/** A quiz row (id, teacher_id, status, quiz_source, topic, meta) whose stored message can be sent again → its code id, or null. */
function storedCodeOf(q) {
  const m = (q && q.meta) || {};
  if (!q || !SENT.has(q.status) || typeof m.student_message !== 'string' || !m.student_message || !m.share_code_id) return null;
  return m.share_code_id;
}

/** The send-again rule, on rows already read: the quiz is the teacher's, sent, with its message, and its code theirs, open and unexpired. */
function ownFrom(uid, q, sc, now = Date.now()) {
  if (!q || q.teacher_id !== uid || !storedCodeOf(q)) return null;
  if (!sc || sc.id !== q.meta.share_code_id || sc.teacher_user_id !== uid || sc.active === false || (sc.expires_at && new Date(sc.expires_at).getTime() <= now)) return null;
  return { message: q.meta.student_message, shareCodeId: q.meta.share_code_id, topic: q.topic || null, source: q.quiz_source || null, language: quizLangOf(q) };
}

/** The teacher's own quiz's stored forwardable, owner-checked and only while its code is live. */
async function ownMessage(uid, quizId, deps, now = Date.now()) {
  const supabase = supabaseOf(deps);
  const { data: q, error } = await supabase.from('quizzes').select('id, teacher_id, status, quiz_source, topic, language, meta')
    .eq('id', quizId).eq('teacher_id', uid).maybeSingle();
  if (error) throw new Error(error.message);
  if (!storedCodeOf(q)) return null;
  const { data: sc, error: e2 } = await supabase.from('quiz_share_codes').select('id, active, expires_at, teacher_user_id')
    .eq('id', q.meta.share_code_id).maybeSingle();
  if (e2) throw new Error(e2.message);
  return ownFrom(uid, q, sc, now);
}

/**
 * An own message (ownMessage / ownFrom) → { message, wa, shareCodeId, quizId, source }. The class group reads it, so the
 * return line follows the message's own language (the quiz's), not the home's: one message, one language. No quiz
 * language → the home's, as before.
 */
const againOf = (own, quizId, lang) => ({ ...sendable(own.message, own.language || lang), shareCodeId: own.shareCodeId, quizId, source: own.source });

/** The teacher's own quiz → { message, wa, shareCodeId } | null. */
async function againSend({ uid, lang, quizId }, deps) {
  const own = await ownMessage(uid, quizId, deps);
  return own ? againOf(own, quizId, lang) : null;
}

/**
 * "Quiz this": start the existing job for a lesson plan (`kind:'lesson'`, id = the /quiz list's `lsn_…` key) or a
 * recorded lesson (`kind:'coaching'`, id = the coaching session id). The server re-checks ownership (the providers
 * do). → { quizId } (queued, or a quiz that already exists for it) | { error: 'not_found'|'unavailable'|'busy' }.
 */
async function startQuiz({ user, kind, id, lang }, deps) {
  const quizLanguage = messageLang(lang);
  const teacher = { id: user.id, phone_number: user.phone_number, preferred_language: user.preferred_language };
  const phone = user.phone_number;
  if (!phone) return { error: 'unavailable' };
  if (kind === 'lesson') {
    const parsed = providersOf(deps).parseLessonKey(id);
    if (!parsed || !parsed.provider) return { error: 'not_found' };
    const out = await parsed.provider.start(teacher, parsed.lessonRef, { phone, quizLanguage, via: 'home' });
    if (out && out.quizId && (out.outcome === 'queued' || out.outcome === 'already')) return { quizId: out.quizId };
    return { error: out && out.outcome === 'unavailable' ? 'unavailable' : 'busy' };
  }
  if (kind === 'coaching') {
    const supabase = supabaseOf(deps);
    const { data: existing, error } = await supabase.from('quizzes').select('id, status')
      .eq('coaching_session_id', id).eq('teacher_id', user.id).maybeSingle();
    if (error) throw new Error(error.message);
    // A quiz made, being made or sent for this lesson is never re-made from the page (the job would start over).
    if (existing && !REMAKE.has(listOf(deps).quizState(existing))) return { quizId: existing.id };
    const out = await transcriptOf(deps).startTranscriptLesson(teacher, id, { phone, quizLanguage, via: 'home' });
    if (out && out.outcome === 'queued' && out.quizId) return { quizId: out.quizId };
    return { error: out && out.outcome === 'not_found' ? 'not_found' : 'busy' };
  }
  return { error: 'not_found' };
}

/**
 * A lesson key a registered provider can parse (`lsn_<source>_<ref>`, the /quiz list's key) → the key, else null. Format
 * only, no read: whose lesson it is, the provider checks when the quiz is made (startQuiz).
 */
function lessonKeyOf(key, deps) {
  if (typeof key !== 'string' || !/^lsn_[A-Za-z0-9_:.-]{1,200}$/.test(key)) return null;
  const parsed = providersOf(deps).parseLessonKey(key);
  return parsed && parsed.provider ? key : null;
}

// A74: the one-lesson page waits this long for its lesson's name, then opens without it (today's page)
const TITLE_WAIT_MS = 400;
const TITLE_MAX = 200; // code points; catalog names are far shorter

/**
 * The name of the lesson PLAN a one-lesson page opened for (?lesson=, A74), read by its provider's nameOf(teacher, ref) when
 * it has one, else its get: for lp_v8 the delivery or app open behind the key, only when it is this teacher's (and sent),
 * named from the K-5 catalog (the name the home's list and the 15:00 offer print, in the lesson's own language). → the name,
 * or null for anything else: a key no provider parses, another teacher's lesson, no catalog name, a failed read, a read
 * slower than `ms`. Never throws; a failed or slow read is logged and the page opens as today. Every read is logged with
 * its time, named or not (`teacher_home.lesson_title`), so the wait is measured where it runs (QF-F5).
 */
async function lessonTitleOf(uid, key, deps, { ms = TITLE_WAIT_MS } = {}) {
  const parsed = uid && lessonKeyOf(key, deps) ? providersOf(deps).parseLessonKey(key) : null;
  const p = parsed && parsed.provider;
  const ask = p && ['nameOf', 'get'].find((f) => typeof p[f] === 'function');
  if (!ask) return null;
  const t0 = Date.now();
  const said = (named, more) => {
    const reads = ask === 'nameOf' ? p.nameReads || null : null;
    try { logEvent('teacher_home.lesson_title', { w: 's', ev_v: 1, named, source: p.source || null, reads, ...more }); } catch (_) { /* never decides */ }
  };
  let timer = null;
  const late = new Promise((r) => { timer = setTimeout(() => r({ late: true }), ms); if (timer.unref) timer.unref(); });
  const read = Promise.resolve().then(() => p[ask](uid, parsed.lessonRef)).then((item) => ({ item }), (err) => ({ err }));
  const got = await Promise.race([read, late]);
  clearTimeout(timer);
  if (got.late || got.err) {
    const reason = got.late ? 'slow' : 'read_failed';
    logToFile('⚠️ teacher home: the one-lesson page opened without its lesson name', { reason, ms, error: got.err && got.err.message }, 'warn');
    said(false, { reason, ms: got.late ? ms : Date.now() - t0 });
    return null;
  }
  const name = got.item && typeof got.item.topic === 'string' ? got.item.topic.trim() : '';
  said(!!name, { ms: Date.now() - t0, ...(name ? {} : { reason: 'unnamed' }) });
  return name ? [...name].slice(0, TITLE_MAX).join('') : null;
}

/** A quiz the page is waiting on → { state, message?, wa? } | null (not this teacher's). */
async function quizStatus({ uid, lang, quizId }, deps) {
  const supabase = supabaseOf(deps);
  const { data: q, error } = await supabase.from('quizzes').select('id, teacher_id, status, topic')
    .eq('id', quizId).eq('teacher_id', uid).maybeSingle();
  if (error) throw new Error(error.message);
  if (!q) return null;
  const state = listOf(deps).quizState(q);
  if (SENT.has(state)) {
    const ready = await againSend({ uid, lang, quizId }, deps);
    if (ready) return { state: 'ready', title: q.topic || '', message: ready.message, wa: ready.wa };
    return { state: 'making', title: q.topic || '' };
  }
  return { state: state === 'failed' ? 'failed' : 'making', title: q.topic || '' };
}

module.exports = { withReturn, waHref, chipFor, videoSend, shareSend, againSend, ownMessage, storedCodeOf, ownFrom, againOf, startQuiz, quizStatus, lessonKeyOf, lessonTitleOf, TITLE_WAIT_MS };
