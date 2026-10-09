'use strict';
/**
 * The message for a finished paper or lesson plan she did not see (bd-fmf24g.15), as the parameters of one of the
 * two UTILITY templates drafted in infrastructure/templates/drafts/ (lesson_plan_ready_v1 / paper_ready_v1, en + ur).
 * PURE: no network, no database — `buildSend` turns an item into `{ name, language, components }` for
 * WhatsAppService.sendTemplate, and nothing else sends.
 *
 *   header   the PDF itself, a DOCUMENT by presigned link, its file name always Latin ("Paper - Grade 4 Science - …")
 *   body     {{1}} the title, {{2}} the grade, {{3}} the subject (paper: {{4}} the question count)
 *   button   one URL button, https://portal.niete.edu.pk/t/{{1}}: the signed link token (portal-link-token.js, area 'ready')
 *
 * The words of the message are the TEMPLATE's (approved by Meta, in her language); this file only supplies the
 * variables. Meta rejects a variable with a newline, a tab or four spaces in a row, so every variable is one line, and a
 * title is cut at 60 code points (measured as code points, never `.length` — language-protocol §3).
 */

const { TEMPLATE_LANGUAGES } = require('./portal-web-link');

const TEMPLATES = Object.freeze({
  lesson: { env: 'PORTAL_READY_LESSON_TEMPLATE', default: 'lesson_plan_ready_v1' },
  paper: { env: 'PORTAL_READY_PAPER_TEMPLATE', default: 'paper_ready_v1' },
});
const TITLE_MAX = 60;

/** One line, single-spaced, at most `max` code points (an ellipsis when it was cut). */
function oneLine(text, max = TITLE_MAX) {
  const t = String(text == null ? '' : text).replace(/[\s‎‏⁦-⁩]+/g, ' ').trim();
  const cps = [...t];
  return cps.length <= max ? t : `${cps.slice(0, max - 1).join('').trimEnd()}…`;
}

/** Latin letters, digits and a little punctuation only: the document's file name is the same in every language. */
function latin(text) {
  return String(text == null ? '' : text).replace(/[^A-Za-z0-9 .,&'()_-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function fileName(kind, grade, subject, title) {
  const label = kind === 'paper' ? 'Paper' : 'Lesson plan';
  const klass = [grade ? `Grade ${grade}` : '', latin(subject)].filter(Boolean).join(' ');
  return `${[label, klass, latin(title).slice(0, 60).trim()].filter(Boolean).join(' - ')}.pdf`;
}

/**
 * @param {{ kind: 'paper'|'lesson', lang?: string, token: string, pdfUrl: string, title?: string|null,
 *           grade?: number|null, subject?: string|null, questions?: number|null }} item
 * @returns {{ name: string, language: 'en'|'ur', components: object[] }}
 */
function buildSend(item) {
  const kind = item.kind === 'paper' ? 'paper' : 'lesson';
  const language = TEMPLATE_LANGUAGES.includes(item.lang) ? item.lang : 'en';
  const spec = TEMPLATES[kind];
  const name = (process.env[spec.env] || '').trim() || spec.default;
  const title = oneLine(item.title) || (kind === 'paper' ? 'Paper' : 'Lesson plan');
  const subject = oneLine(item.subject, 40) || '-';
  const params = [title, item.grade ? String(item.grade) : '-', subject];
  if (kind === 'paper') params.push(String(item.questions != null ? item.questions : '-'));
  return {
    name,
    language,
    components: [
      { type: 'header', parameters: [{ type: 'document', document: { link: item.pdfUrl, filename: fileName(kind, item.grade, item.subject, item.title) } }] },
      { type: 'body', parameters: params.map((text) => ({ type: 'text', text })) },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: item.token }] },
    ],
  };
}

module.exports = { buildSend, oneLine, fileName, TEMPLATES, TITLE_MAX };
