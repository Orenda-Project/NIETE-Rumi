'use strict';
/**
 * The live report page's Urdu sentences name a WhatsApp command («WhatsApp پر /quiz بھیجیں۔»). At 360 px the Urdu empty
 * state broke the line between "/" and "quiz", so a teacher saw "/" at the end of one line and "quiz" on the next, and
 * types back what they see. The command is one atom that never breaks: the words are unchanged.
 *
 * A pure renderer: data in, HTML out.
 */
const { renderPage } = require('../../shared/templates/teacher-report.page');

const TOKEN = 'eyJrIjoidHIifQ.AAAAAAAAAAAAAAAAAAAAAA';
const page = (lang) => renderPage({ class: { cells: [], weeks: [], quizzes: [] } }, { lang, tab: 'class', tokens: { self: TOKEN, quiz: {} }, now: Date.parse('2026-11-22T09:30:00Z') });
const css = (html) => (html.match(/<style>([\s\S]*?)<\/style>/) || ['', ''])[1];

describe('a command in Urdu prose never breaks inside itself', () => {
  test('UR empty state: /quiz is one no-break atom', () => {
    const html = page('ur');
    // the page's Latin isolates may wrap "quiz" inside; the no-break atom holds the whole command
    expect(html).toMatch(/<span class="ltr nb">\/(?:<span class="ltr">)?quiz(?:<\/span>)?<\/span>/);
    expect(css(html)).toMatch(/(^|\n)\.nb\{white-space:nowrap\}/);
  });

  test('the words are unchanged (only the wrap)', () => {
    const text = page('ur').replace(/<[^>]+>/g, '');
    expect(text).toContain('نیا بنانے کے لیے WhatsApp پر /quiz بھیجیں۔');
  });
});
