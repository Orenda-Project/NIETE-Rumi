'use strict';
/**
 * The first sentence of "What you planned" is a SENTENCE, not everything up to
 * the first "!".
 *
 * The teacher's sheet shows the first sentence of the lesson summary. A quiz
 * written from a lesson PLAN quotes the lesson by its title, and the titles
 * carry their own "!" and "?": the K-5 catalog has "Hello World!", "Five Senses
 * Funland!", "… how does water reach the leaves? (hook)", the 6-12 Urdu poems
 * "آؤ بچو! سیر کرائیں تم کو پاکستان کی". The sentence split did not know a
 * quotation, so a replayed Grade 7 Urdu quiz printed «آج کے سبق میں 'آؤ بچو!»
 * ("In today's lesson 'Come, children!") and stopped — half a sentence, with an
 * unclosed quote, as the first thing the teacher reads.
 *
 * Rendered through the real template; only the database and the network are
 * absent.
 */
jest.mock('../../shared/config/supabase', () => ({ from: jest.fn() }));
jest.mock('../../shared/services/whatsapp.service', () => ({}));
jest.mock('../../shared/utils/logger', () => ({ logToFile: jest.fn() }));
jest.mock('../../shared/utils/structured-logger', () => ({ logEvent: jest.fn() }));
jest.mock('openchemlib', () => ({}));

const renderTeacher = require('../../shared/templates/transcript-quiz-teacher.template');
const { teacherPdfArgs } = require('./fixtures/teacher-pdf-synthetic');

/** The text of the "What you planned / taught" box, tags and isolates removed. */
function plannedBox(html) {
  const i = html.indexOf('<div class="taught">');
  if (i < 0) return '';
  const box = html.slice(i, html.indexOf('<span class="fromlesson">', i));
  return box.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function render(lessonSummary, language) {
  const a = teacherPdfArgs(0);
  return renderTeacher({
    topic: 'x', teacherName: '', date: a.date, link: '', digest: a.digest, questions: a.questions,
    lessonSummary, language, contentLanguage: language, quizSource: 'lp_v8',
  });
}

describe('the first sentence of the lesson summary survives a quoted title', () => {
  test('Urdu: a title with "!" inside quotes does not end the sentence', () => {
    const first = "آج کے سبق میں 'آؤ بچو! سیر کرائیں تم کو پاکستان کی' کے آٹھ اہم الفاظ کے معنی کی مشق کی جائے گی۔";
    const box = plannedBox(render(`${first} سبق میں 'فروغ' کے معنی کو ایک جملے سے سمجھایا جائے گا۔`, 'ur'));
    expect(box).toContain('کے آٹھ اہم الفاظ کے معنی کی مشق کی جائے گی۔');
    expect(box).not.toContain('سمجھایا جائے گا');
  });

  test('English: "Hello World!" and a "?" in a quoted title stay inside the first sentence', () => {
    const box = plannedBox(render(
      "Today's lesson plans to practise 'Hello World!' greetings and how the class feels. Then the children draw a poster.",
      'en',
    ));
    expect(box).toContain("practise 'Hello World!' greetings and how the class feels.");
    expect(box).not.toContain('poster');
    const box2 = plannedBox(render(
      'The class investigates “how does water reach the leaves?” with coloured water. They record what they see.', 'en',
    ));
    expect(box2).toContain('with coloured water.');
    expect(box2).not.toContain('record');
  });

  test('an ordinary summary still shows its first sentence only, and an apostrophe is not a quote', () => {
    const box = plannedBox(render("The class learned the children's rhyme. Then they sang it twice. Then they drew.", 'en'));
    expect(box).toContain("The class learned the children's rhyme.");
    expect(box).not.toContain('sang');
  });
});
