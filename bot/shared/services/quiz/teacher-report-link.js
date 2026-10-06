'use strict';
/**
 * The teacher's report link (W37, M3 SPEC §1.3) — one function, two transports.
 *
 *   teacher-report-gate reportUrls({teacherId, quizId}) — the live report for
 *   one quiz, or (quizId null) all the teacher's classes; the URL button's
 *   suffix is its token.
 *
 * With app_settings `teacher_report_template` naming an APPROVED template
 * (quiz_teacher_report_v1: body {{1}} = the topic, {{2}} = the counts line, a URL
 * button whose suffix is the token), the link goes as that template: a template's URL button is what
 * opens WhatsApp's in-app browser. Without it — or when WhatsApp refuses the
 * template — the link goes as text (`tqrLinkText`), which opens the phone's
 * browser; the page works the same there.
 *
 * Event: teacher_report.link_sent {userId, quizId|null, scope:'q'|'all', how:'template'|'text'}.
 */

const WhatsAppService = require('../whatsapp.service');
const { logToFile } = require('../../utils/logger');
const { logEvent } = require('../../utils/structured-logger');
const { resolveUx, clampLanguage } = require('../../config/ux-strings');
const Gate = require('./teacher-report-gate');

/**
 * @param {object} args
 * @param {object} args.teacher   the users row (id, preferred_language)
 * @param {string} args.phone     where to send
 * @param {string|null} [args.quizId] one quiz, or null for all the teacher's classes
 * @param {string} args.topic     the quiz's topic, or "all your classes"
 * @param {{played:number, of:number|null}|null} [args.counts] the tapped row's counts (one quiz only)
 * @param {string|null} [args.language] the teacher's language
 * @returns {Promise<{ok: boolean, how: 'template'|'text'|null}>}
 */
/**
 * The counts line both transports carry ({{2}} on the template): "12 of 31 played · 19 still to play",
 * "12 played" with no known class, "no one has played yet", or for all classes what the page holds.
 * @returns {{line: string, left: number}}
 */
function countsLine(counts, quizId, language) {
  if (!quizId) return { line: resolveUx('tqrCountsClasses', { language }), left: 0 };
  const played = Math.max(0, Number((counts && counts.played) || 0));
  const of = counts && Number.isFinite(counts.of) && counts.of > 0 ? counts.of : null;
  if (of) {
    const left = Math.max(0, of - played);
    return left
      ? { line: resolveUx('tqrCountsOf', { language, params: { played, of, left } }), left }
      : { line: resolveUx('tqrCountsOfDone', { language, params: { of } }), left: 0 };
  }
  return { line: resolveUx(played ? 'tqrCountsPlayed' : 'tqrCountsNone', { language, params: { played } }), left: 0 };
}

async function sendTeacherReportLink({ teacher, phone, quizId = null, topic, counts = null, language = null }) {
  const teacherId = (teacher && teacher.id) || null;
  const lang = clampLanguage(language || (teacher && teacher.preferred_language));
  const scope = quizId ? 'q' : 'all';
  const urls = Gate.reportUrls({ teacherId, quizId });
  if (!urls) {
    // No signing secret, or no portal URL on this deployment: say so, never a dead link.
    logToFile('⚠️ teacher report: no link (token secret or base URL missing)', { userId: teacherId });
    await WhatsAppService.sendMessage(phone, resolveUx('tqrLinkFailed', { language: lang }));
    return { ok: false, how: null };
  }
  const shown = String(topic || '').trim() || resolveUx('tqrAllClasses', { language: lang });
  const { line, left } = countsLine(counts, quizId, lang);

  let how = null;
  const template = await Gate.reportTemplate();
  if (template) {
    const components = [
      { type: 'body', parameters: [{ type: 'text', text: shown }, { type: 'text', text: line }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: urls.token }] },
    ];
    if ((await WhatsAppService.sendTemplate(phone, template, lang, components)) === true) how = 'template';
    else logToFile('⚠️ teacher report: template refused — sending the link as text', { userId: teacherId, template, lang });
  }
  if (!how) {
    await WhatsAppService.sendMessage(phone, resolveUx(left ? 'tqrLinkTextRemind' : 'tqrLinkText', { language: lang, params: { topic: shown, counts: line, url: urls.live } }));
    how = 'text';
  }
  logEvent('teacher_report.link_sent', { userId: teacherId, quizId: quizId || null, scope, how });
  return { ok: true, how };
}

module.exports = { sendTeacherReportLink, countsLine };
