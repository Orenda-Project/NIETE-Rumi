'use strict';
/**
 * bd-mg9c7.27 — the class report reads in the TEACHER's language and quotes
 * the class's questions in the QUIZ's language.
 *
 * This is the Rawalpindi /videos edge case, and it is the norm rather than the
 * exception here: the teacher's interface preference and the language her
 * lesson was taught in are independent facts. The report used to take both
 * from the quiz, so an English-reading teacher got an entirely Urdu report;
 * keying it the other way would have been the same bug pointed the other
 * direction, printing her Urdu questions as empty boxes.
 */
const renderHtml = require('../../bot/shared/templates/video-quiz-report.template');

const BASE = {
  topic: 'کسریں', teacherName: 'Rifat Noor', grade: '',
  started: 5, finished: 3, average: 74,
  students: [
    { student_name: 'علی', student_class: '4', correct_answers: 6, total_questions_answered: 8, mastery_percentage: 75 },
  ],
  hardest: [{
    question_text: 'آدھی روٹی کا fraction کیا ہے؟', wrong: 4, total: 5,
    top_wrong_text: '⅓', correct_text: '½', misconception: 'تین حصے سمجھنا',
    slo: 'آدھے کو کسر میں لکھنا',
  }],
  guidance: 'They think a half means any small piece.',
  unfinished: ['Faizan'],
  generatedAt: '5 Sep 2026',
};

function styleRules(html) {
  const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
  return css.replace(/@font-face\{[^}]*\}/g, '');
}
function ruleFor(html, selector) {
  const re = new RegExp(`${selector.replace(/[.[\]()*+?^$|\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const m = styleRules(html).match(re);
  return m ? m[1] : null;
}

describe('teacher en + quiz ur', () => {
  const html = renderHtml({ ...BASE, language: 'en', contentLanguage: 'ur' });

  test('the document is an English report', () => {
    expect(html).toMatch(/<html dir="ltr" lang="en">/);
    expect(html).toMatch(/Worth reteaching/);
    expect(html).toMatch(/For tomorrow/);
    expect(html).not.toMatch(/دوبارہ پڑھانے کے قابل/);
  });

  test('the missed question and its explanation are RTL content blocks', () => {
    expect(html).toMatch(/<div class="m-q content" dir="rtl">/);
    expect(html).toMatch(/آدھی روٹی/);
    expect(html).toMatch(/class="slo content" dir="rtl"/);
  });

  test('the RTL content rule leads with NastaliqUrdu and gives Urdu line-height', () => {
    const rule = ruleFor(html, '.content[dir="rtl"]');
    expect(rule).toMatch(/font-family:'NastaliqUrdu'/);
    expect(rule).toMatch(/line-height:1\.9/);
  });

  test('EVERY font-family declaration names both a Latin family and NastaliqUrdu', () => {
    const decls = styleRules(html).match(/font-family:[^;}]+/g) || [];
    expect(decls.length).toBeGreaterThan(5);
    decls.forEach((d) => {
      expect(d).toMatch(/NastaliqUrdu/);
      expect(d).toMatch(/Lexend|Fraunces/);
    });
  });

  test('an Urdu student name still renders as a content block', () => {
    expect(html).toMatch(/<span class="nm content" dir="rtl">علی<\/span>/);
  });
});

describe('NIETE brand on the report hero', () => {
  const html = renderHtml({ ...BASE, language: 'en', contentLanguage: 'ur' });

  test('carries the on-dark mark and a drawn diamond lattice', () => {
    expect(html).toMatch(/<img class="hero-mark" src="data:image\/png;base64,[A-Za-z0-9+/=]{500,}"/);
    expect(html).toMatch(/<svg class="lattice"/);
    expect(html).toMatch(/pattern id="niete-lattice/);
  });

  test('badges the audience with the brand-book lockup', () => {
    expect(html).toMatch(/FOR TEACHERS/);
  });

  test('the score bands are NIETE colours — no gold, no coral, no other navy', () => {
    expect(html).not.toMatch(/#001F3F/i);
    expect(html).not.toMatch(/#F5B301|#D9A233|#e0a52e|#dd7a5c/i);
  });
});

describe('teacher ur + quiz ur (both sides the same)', () => {
  const html = renderHtml({ ...BASE, language: 'ur', contentLanguage: 'ur' });
  test('renders a fully Urdu report', () => {
    expect(html).toMatch(/<html dir="rtl" lang="ur">/);
    expect(html).toMatch(/دوبارہ پڑھانے کے قابل/);
    expect(html).not.toMatch(/Worth reteaching/);
  });
});

describe('contentLanguage defaults to the chrome language', () => {
  test('a caller that passes only `language` keeps its old behaviour', () => {
    const html = renderHtml({ ...BASE, language: 'ur' });
    expect(html).toMatch(/<div class="m-q content" dir="rtl">/);
  });
});
