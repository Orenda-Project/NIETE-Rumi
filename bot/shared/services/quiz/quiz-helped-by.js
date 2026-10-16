'use strict';
/**
 * bd-v0toag.10 (c) — "who helped?" After a child finishes a LESSON quiz on WhatsApp
 * (video-quiz.service.js finish()), one list: no one / a classmate / my teacher / my family.
 * The tap (vqh_<n|c|t|f>_<en|ur>_<sessionId> — the child's quiz state is gone by then, so the id carries the language; routed in whatsapp-bot.js before vq_) is stored on
 * quiz_sessions.helped_by (migration V1.6.13) — first answer wins.
 *
 * Off unless app_settings quiz_slo_retest_enabled is on. Apply V1.6.13 before switching on:
 * without the column the tap is still thanked, the write failure is logged.
 */
const supabase = require('../../config/supabase');
const WhatsAppService = require('../whatsapp.service');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { v21On } = require('./quiz-v21-flag');
const { isLessonQuiz } = require('./quiz-sources');

const PREFIX = 'vqh_';
const ROW_TITLE_MAX = 24;
const CHOICES = Object.freeze([
  { code: 'n', value: 'no_one', key: 'vqHelpedNoOne' },
  { code: 'c', value: 'classmate', key: 'vqHelpedClassmate' },
  { code: 't', value: 'teacher', key: 'vqHelpedTeacher' },
  { code: 'f', value: 'family', key: 'vqHelpedFamily' },
]);
const TAP_RE = /^vqh_([nctf])_(en|ur)_([0-9a-f-]{36})$/i;

const ux = (key, language) => resolveUx(key, { language });
const clampCp = (s, n) => [...String(s || '')].slice(0, n).join('');

/** Ask once, after the scorecard. Never throws: a child's finished quiz must not fail on this. */
async function offer(phone, state, quizSource) {
  try {
    if (!isLessonQuiz(quizSource) || !(await v21On())) return false;
    const lang = clampLanguage(state.language); // NIETE LANGUAGE_OFFER is flat en/ur
    const sent = await WhatsAppService.sendInteractiveMessage(phone, {
      body: { text: ux('vqHelpedAsk', lang) },
      action: {
        button: ux('vqHelpedPick', lang),
        sections: [{
          rows: CHOICES.map((c) => ({ id: `${PREFIX}${c.code}_${lang}_${state.sessionId}`, title: clampCp(ux(c.key, lang), ROW_TITLE_MAX) })),
        }],
      },
    });
    logEvent('quiz.helped_by_asked', { sessionId: state.sessionId, quizId: state.quizId, sent: Boolean(sent) });
    return Boolean(sent);
  } catch (err) {
    logToFile('⚠️ who-helped: the question failed (the quiz is already finished)', { sessionId: state && state.sessionId, error: err.message }, 'warn');
    return false;
  }
}

/** A list tap. Returns false when the id is not ours, so the router carries on. */
async function handleTap(phone, listId) {
  const m = TAP_RE.exec(String(listId || ''));
  if (!m) return false;
  const choice = CHOICES.find((c) => c.code === m[1].toLowerCase());
  const language = m[2].toLowerCase();
  const sessionId = m[3];
  const { error } = await supabase.from('quiz_sessions').update({ helped_by: choice.value })
    .eq('id', sessionId).is('helped_by', null);
  if (error) logToFile('⚠️ who-helped: could not store the answer', { sessionId, error: error.message }, 'warn');
  logEvent('quiz.helped_by_answered', { sessionId, helpedBy: choice.value, stored: !error });
  await WhatsAppService.sendMessage(phone, ux('vqHelpedThanks', language));
  return true;
}

module.exports = { offer, handleTap, CHOICES, PREFIX };
