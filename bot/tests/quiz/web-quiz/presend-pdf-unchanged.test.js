'use strict';
/**
 * The PRE-SEND teacher PDF (the hand-off: "here is your quiz, here is what each
 * question checks") is not part of the teacher web report's change (W37 12b):
 * the post-completion PDF gains its not-played section and links; this one does
 * not move by a byte. Rendered through the real template from a fixed synthetic
 * fixture in both languages, and compared with the output of the base template.
 *
 * If this fails on purpose (a deliberate redesign of the hand-off PDF), re-run
 * with PRINT_PRESEND_HASH=1 and paste the new hashes — and say so in the PR.
 */
jest.mock('../../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => ({}));

const crypto = require('crypto');
const renderTeacher = require('../../../shared/templates/transcript-quiz-teacher.template');
const { teacherPdfArgs } = require('../fixtures/teacher-pdf-synthetic');

const HASHES = { en: 'a4ea23c4a5005876264cce6aec6a008ce8f30f85a53a47ad0d0034c50626f74f', ur: 'cc43107819e4f18dd08441886514c14b03a38e702f27abeffad967a77ebc4fe8' };

function render(language) {
  const a = teacherPdfArgs(0);
  return renderTeacher({
    topic: 'Parts of a plant', teacherName: 'Teacher Testwala', date: a.date, link: 'https://portal.example.test/q/AB12CD',
    digest: a.digest, questions: a.questions, lessonSummary: 'The class named the parts of a plant. Then they drew one.',
    language, contentLanguage: language, quizSource: 'transcript',
  });
}

test.each(['en', 'ur'])('the hand-off PDF (%s) renders byte-identical to the base template', (language) => {
  const sha = crypto.createHash('sha256').update(render(language)).digest('hex');
  if (process.env.PRINT_PRESEND_HASH) console.log(language, sha);
  expect(sha).toBe(HASHES[language]);
});
