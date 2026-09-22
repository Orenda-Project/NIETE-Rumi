'use strict';
/**
 * R8 lane D task 3.6 — the teacher PDF of a quiz born of a LESSON PLAN.
 *
 * The sheet opens on "What you taught" and closes on "Made from your lesson
 * recording". An lp_v8 quiz was written from the plan the teacher was served
 * — nobody heard the lesson — so both lines would state something untrue about
 * the document in the teacher's hand. The lp_v8 sheet says "What you planned"
 * and "Made from your lesson plan"; the transcript sheet is unchanged.
 */
jest.mock('../../bot/shared/utils/html-to-pdf', () => ({ htmlToPdf: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.4 fake')) }));
jest.mock('../../bot/shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../bot/shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('../../bot/shared/config/supabase', () => ({ from: jest.fn() }));

const { htmlToPdf } = require('../../bot/shared/utils/html-to-pdf');
const render = require('../../bot/shared/templates/transcript-quiz-teacher.template');
const Gen = require('../../bot/shared/services/quiz/transcript-quiz-generate.service');

const DIGEST = { subject: 'maths', slos: [{ id: 'S1', statement_en: 'Add with carrying', statement_ur: 'جمع', taught_level: 'apply' }] };
const Q = [{
  slo_id: 'S1', level: 'apply', question: 'What is 146 + 27?', options: ['173', '163', '1613'], correct_index: 0, explanation: 'Ones first.',
}];
const base = {
  topic: 'Adding with carrying', teacherName: 'Rifat Noor', grade: '2', date: '22 Sep 2026', link: 'https://wa.me/1?text=QUIZ-X',
  digest: DIGEST, questions: Q, lessonSummary: 'You planned column addition with 146 + 27.',
};

describe.each(['en', 'ur'])('the %s sheet', (lang) => {
  test('an lp_v8 sheet names the lesson PLAN — never "taught" as a heading, never the recording', () => {
    const html = render({ ...base, language: lang, contentLanguage: lang, quizSource: 'lp_v8' });
    if (lang === 'en') {
      expect(html).toContain('What you planned');
      expect(html).toContain('Made from your lesson plan');
      expect(html).not.toContain('What you taught');
    } else {
      expect(html).toContain('آپ کے سبق کا منصوبہ');
      expect(html).toContain('lesson plan');
      expect(html).not.toContain('آپ نے کیا پڑھایا');
    }
    expect(html).not.toMatch(/recording|ریکارڈنگ/i);
  });

  test('a transcript sheet is what it always was', () => {
    const html = render({ ...base, language: lang, contentLanguage: lang });
    expect(html).toMatch(lang === 'en' ? /Made from your lesson recording/ : /ریکارڈنگ سے تیار/);
  });
});

test('renderPdf hands the row’s quiz_source to the template', async () => {
  await Gen.renderPdf({
    quiz: { topic: 'Adding with carrying', language: 'en', quiz_source: 'lp_v8' },
    questions: Q, digest: DIGEST, teacherName: 'Rifat Noor', grade: '2', lessonSummary: '', language: 'en', date: '22 Sep', link: 'x',
  });
  expect(htmlToPdf.mock.calls[0][0]).toContain('Made from your lesson plan');
});
