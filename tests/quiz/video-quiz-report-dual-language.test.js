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

  // UPDATED bd-mg9c7.48/D6 — the operator's own words: the staging report
  // said "FOR TEACHERS" then "For Haroon"; he asked for just his name, no
  // duplication. The lockup chrome is gone from this document entirely; the
  // "who" line now reads "<name> · Grade N" with the name in its own span.
  test('no lockup chrome — the who line is the teacher\'s name, not "FOR TEACHERS"', () => {
    expect(html).not.toMatch(/FOR TEACHERS/);
    expect(html).not.toMatch(/class="lockup"/);
    expect(html).toMatch(/<span class="nm content" dir="ltr">Rifat Noor<\/span>/);
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

/**
 * bd-mg9c7.44 — a roster is a list of names people wrote themselves, so the
 * quiz's language does not decide any of their scripts.
 *
 * The roster took its direction and its face from `contentLanguage`, which is
 * right for the questions (one quiz, one language) and wrong for the names: in
 * an Urdu class "Ali" is still Latin, and in an English one "عائشہ" is still
 * Perso-Arabic. Keyed off the quiz, half of a real roster is set in the wrong
 * face — Latin letters through Nastaliq metrics, or Urdu through a Latin-first
 * stack that has no glyphs for it at all.
 */
describe('bd-mg9c7.44 — each roster name follows its own script', () => {
  const roster = [
    { student_name: 'علی', student_class: '4', correct_answers: 6, total_questions_answered: 8, mastery_percentage: 75 },
    { student_name: 'Ali', student_class: '4', correct_answers: 7, total_questions_answered: 8, mastery_percentage: 88 },
  ];

  test('an Urdu quiz still sets a Latin name LTR', () => {
    const html = renderHtml({ ...BASE, language: 'en', contentLanguage: 'ur', students: roster });
    expect(html).toMatch(/<span class="nm content" dir="rtl">علی<\/span>/);
    expect(html).toMatch(/<span class="nm content" dir="ltr">Ali<\/span>/);
  });

  test('an English quiz still sets a Perso-Arabic name RTL', () => {
    const html = renderHtml({
      ...BASE, topic: 'Fractions', language: 'en', contentLanguage: 'en', students: roster,
    });
    expect(html).toMatch(/<span class="nm content" dir="rtl">علی<\/span>/);
    expect(html).toMatch(/<span class="nm content" dir="ltr">Ali<\/span>/);
  });

  test('the two content rules give each script its own face', () => {
    const html = renderHtml({ ...BASE, language: 'en', contentLanguage: 'en', students: roster });
    expect(ruleFor(html, '.content[dir="rtl"]')).toMatch(/font-family:'NastaliqUrdu'/);
    expect(ruleFor(html, '.content[dir="ltr"]')).toMatch(/font-family:'Lexend'/);
  });
});
