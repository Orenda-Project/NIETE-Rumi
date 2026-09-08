'use strict';
/**
 * "Which group has more?" is the whole of early-years maths, not an
 * unanswerable question.
 *
 * Production, 2026-09-07 12:39 PKT: a grade 1-2 maths lesson — topic "More and
 * Less", whose second objective is literally «دو گروپس میں سے 'مور' اور 'لیس'
 * کی پہچان کرنا» (tell which of two GROUPS has more) and whose examples are all
 * "group A has 6, group B has 5" — could not produce a quiz at all. Three full
 * attempts and three targeted rewrites, six model calls and $0.053, and every
 * one was rejected as PEDAGOGY_UNANSWERABLE, because the detector treated the
 * bare words «کس گروپ» / "which group" as a reference to a group of CHILDREN
 * the quiz cannot know about. The teacher was told the recording was unclear.
 * It was not: the model was right six times and the validator was wrong.
 *
 * The fault the rule exists for is the INDEXICAL framing — a question whose
 * answer depends on which child you are, which group you sat in, what you
 * personally were asked to do. That is carried by the second person ("your
 * group", «آپ کے گروپ»), by the child-who construction, and by the activity
 * VERB ("which group was called to the board"). It is not carried by the noun
 * "group" on its own.
 */
const P = require('../../bot/shared/services/quiz/transcript-quiz-pedagogy.js');

describe('a group of OBJECTS is answerable; a group of CHILDREN is not', () => {
  const answerable = [
    ['ur', 'ان میں سے کس گروپ میں زیادہ اشیاء ہیں؟'],
    ['ur', 'کون سے گروپ میں less دائرے ہیں؟'],
    ['ur', 'گروپ A میں 6 اور گروپ B میں 5 مربع ہیں۔ کس گروپ میں more ہیں؟'],
    ['en', 'Which group has more circles?'],
    ['en', 'Group A has 6 squares and group B has 5. Which group has less?'],
    ['en', 'Which row of counters shows more?'],
  ];
  const unanswerable = [
    ['ur', 'آپ کے گروپ نے کتنی اشیاء گنیں؟'],
    ['ur', 'آپ کو کیا کہا گیا تھا؟'],
    ['ur', 'جس بچے کو بورڈ پر بلایا گیا اس نے کیا لکھا؟'],
    ['en', 'What did your group count?'],
    ['en', 'You were asked to draw which shape?'],
    ['en', 'Which group was called to the board?'],
    ['en', 'The student who answered first said what?'],
  ];
  test.each(answerable)('answerable (%s): %s', (lang, stem) => {
    expect(P.unanswerable(stem, lang)).toBe(false);
  });
  test.each(unanswerable)('unanswerable (%s): %s', (lang, stem) => {
    expect(P.unanswerable(stem, lang)).toBe(true);
  });
  test('the whole More-and-Less question set passes the pedagogy rules', () => {
    const digest = {
      subject: 'maths', grade_band: '1-2', topic: 'More and Less',
      slos: [
        { id: 'S1', statement: "'More' means زیادہ", taught_level: 'recall' },
        { id: 'S2', statement: 'tell which of two groups has more', taught_level: 'understand' },
      ],
    };
    const qs = [
      { slo_id: 'S1', level: 'recall', question: "'More' کا مطلب کیا ہے؟", options: ['زیادہ', 'تھوڑا', 'برابر'], correct_index: 0 },
      { slo_id: 'S2', level: 'understand', question: 'گروپ A میں 6 اور گروپ B میں 5 مربع ہیں۔ کس گروپ میں more ہیں؟', options: ['گروپ A', 'گروپ B', 'دونوں برابر'], correct_index: 0 },
    ];
    const codes = P.pedagogyDefects(qs, { language: 'ur', digest }).map((d) => d.code);
    expect(codes).not.toContain('PEDAGOGY_UNANSWERABLE');
  });
});
