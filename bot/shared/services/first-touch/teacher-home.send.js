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
const { fill } = require('./teacher-home.strings');

const BOT_RX = /^\d{10,15}$/;
const SENT = new Set(['sent', 'report_sent']);
const REMAKE = new Set(['none', 'offered', 'failed']);

const supabaseOf = (deps) => (deps && deps.supabase) || require('../../config/supabase');
const bankOf = (deps) => (deps && deps.Bank) || require('./maker.bank');
const listOf = (deps) => (deps && deps.List) || require('../quiz/transcript-quiz-list.service');
const providersOf = (deps) => (deps && deps.Providers) || require('../quiz/quiz-lesson-providers');
const transcriptOf = (deps) => (deps && deps.Transcript) || require('../quiz/transcript-lesson-provider');
const botOf = (deps) => {
  const n = String(((deps && deps.botNumber) || require('../quiz/video-quiz-share.service').botNumber)() || '');
  return BOT_RX.test(n) ? n : null;
};
const messageLang = (lang) => (lang === 'en' ? 'en' : 'ur');

/** The message with the return line appended (a blank line before it); unchanged when the number is unknown. */
function withReturn(message, lang, deps) {
  const bot = botOf(deps);
  if (!bot || typeof message !== 'string' || !message) return message;
  return `${message}\n\n${fill('cm.return', messageLang(lang), { link: `https://wa.me/${bot}?text=quiz` })}`;
}

const waHref = (message) => `https://wa.me/?text=${encodeURIComponent(message)}`;
const sendable = (message, lang, deps) => {
  const m = withReturn(message, lang, deps);
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
  const chip = await chipFor(quizId, deps);
  if (!chip) return null;
  const out = await bankOf(deps).make({ uid, lang, grade: chip.grade, subject: chip.subject, quizId });
  if (!out || out.error || typeof out.message !== 'string') return null;
  return { ...sendable(out.message, lang, deps), shareCodeId: out.shareCodeId, quizId };
}

/** A library quiz the teacher already holds a code for → { message, wa, shareCodeId } | null. */
async function shareSend({ uid, lang, shareCodeId }, deps) {
  const out = await bankOf(deps).shareMessage({ uid, lang, shareCodeId });
  if (!out || typeof out.message !== 'string') return null;
  return { ...sendable(out.message, lang, deps), shareCodeId, quizId: out.quizId };
}

/** The teacher's own quiz's stored forwardable, owner-checked and only while its code is live. */
async function ownMessage(uid, quizId, deps, now = Date.now()) {
  const supabase = supabaseOf(deps);
  const { data: q, error } = await supabase.from('quizzes').select('id, teacher_id, status, quiz_source, topic, meta')
    .eq('id', quizId).eq('teacher_id', uid).maybeSingle();
  if (error) throw new Error(error.message);
  const m = (q && q.meta) || {};
  if (!q || !SENT.has(q.status) || typeof m.student_message !== 'string' || !m.student_message || !m.share_code_id) return null;
  const { data: sc, error: e2 } = await supabase.from('quiz_share_codes').select('id, active, expires_at, teacher_user_id')
    .eq('id', m.share_code_id).maybeSingle();
  if (e2) throw new Error(e2.message);
  if (!sc || sc.teacher_user_id !== uid || sc.active === false || (sc.expires_at && new Date(sc.expires_at).getTime() <= now)) return null;
  return { message: m.student_message, shareCodeId: m.share_code_id, topic: q.topic || null, source: q.quiz_source || null };
}

/** The teacher's own quiz → { message, wa, shareCodeId } | null. */
async function againSend({ uid, lang, quizId }, deps) {
  const own = await ownMessage(uid, quizId, deps);
  return own ? { ...sendable(own.message, lang, deps), shareCodeId: own.shareCodeId, quizId, source: own.source } : null;
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
    const out = await parsed.provider.start(teacher, parsed.lessonRef, { phone, quizLanguage, via: 'list' });
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
    const out = await transcriptOf(deps).startTranscriptLesson(teacher, id, { phone, quizLanguage, via: 'list' });
    if (out && out.outcome === 'queued' && out.quizId) return { quizId: out.quizId };
    return { error: out && out.outcome === 'not_found' ? 'not_found' : 'busy' };
  }
  return { error: 'not_found' };
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

module.exports = { withReturn, waHref, chipFor, videoSend, shareSend, againSend, ownMessage, startQuiz, quizStatus };
