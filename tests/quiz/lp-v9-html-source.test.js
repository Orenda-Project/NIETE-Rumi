'use strict';
/**
 * A v9 K-5 lesson plan exists only as HTML. lp-v9-html-source reads it into the
 * slide-script shape so the quiz author writes from the lesson the teacher was
 * actually served. Run through the REAL digest picker (carry/lessonExcerpts),
 * because that is the only door the author reads a lesson through.
 */
const V9 = require('../../bot/shared/services/quiz/lp-v9-html-source');
const LpDigest = require('../../bot/shared/services/quiz/lp-quiz-digest.service');
const KeyCheck = require('../../bot/shared/services/quiz/lp-quiz-key-check.service');
const { EN, UR } = require('./fixtures/lp-v9-html');

describe('v9 lesson-plan HTML → the slide-script shape', () => {
  test('the author reads the lesson itself: outcome, I-Do, worked example, mistake, practice, key words, board', () => {
    const ss = V9.toSlideScript(EN, { lessonId: 'grade_2_math_ch6_seg3' });
    expect(ss.meta).toMatchObject({
      lessonId: 'grade_2_math_ch6_seg3', grade: 2, subject: 'math', language: 'en',
      topic: 'Sharing pebbles into equal groups', chapterTitle: 'Ch.6 · The Pebble Market', minutes: 35, source: 'v9_html',
    });
    expect(ss.sloCode).toBe('M-02-DV-01');
    const text = LpDigest.lessonExcerpts(ss);
    expect(text).toContain('Sharing means putting the same number of things in every group.');
    expect(text).toContain('one pebble for each bag');
    expect(text).toContain('Share 8 pebbles into 2 bags');
    expect(text).toContain('Groups are only equal when every group is counted');
    expect(text).toContain('Share 10 pebbles into 2 bags. How many in each bag?');
    expect(text).toContain('equal — the same amount in each group');
    expect(text).toContain('TWELVE PEBBLES, THREE BAGS: Four pebbles go in each bag.');
    expect(LpDigest.isUsable(ss)).toBe(true);
  });

  test('no answer and no exit ticket ever reaches the author', () => {
    const ss = V9.toSlideScript(EN, { lessonId: 'grade_2_math_ch6_seg3' });
    const authorSees = [LpDigest.lessonExcerpts(ss), LpDigest.lessonExcerpts(ss, { authorGates: true }), JSON.stringify(LpDigest.carry(ss))].join('\n');
    ['WARMUP-ANSWER-SECRET', 'PRACTICE-ANSWER-SECRET', 'EXIT-PROMPT-SECRET', 'EXIT-ANSWER-SECRET'].forEach((s) => {
      expect(authorSees).not.toContain(s);
    });
    // The We-Do talk is not the I-Do key fact.
    expect(V9.toSlideScript(EN, { lessonId: 'grade_2_math_ch6_seg3' }).iDo.keyFact).not.toContain('WE-DO-LINE');
  });

  test('the KEY CHECK reads the plan\'s own answers, in the v8 places (practice answer, exit options) — the author never does', () => {
    const ss = V9.toSlideScript(EN, { lessonId: 'grade_2_math_ch6_seg3' });
    expect(ss.youDo.problems).toEqual([{ n: 1, prompt: 'Share 10 pebbles into 2 bags. How many in each bag?', answer: 'PRACTICE-ANSWER-SECRET' }]);
    expect(ss.wrap.exitOptions).toEqual([{ prompt: 'EXIT-PROMPT-SECRET', answer: 'EXIT-ANSWER-SECRET' }]);
    const facts = KeyCheck.sourceAnswers(ss).facts.join('\n');
    expect(facts).toContain('PRACTICE-ANSWER-SECRET');
    expect(facts).toContain('EXIT-ANSWER-SECRET');
    expect(facts).not.toContain('WARMUP-ANSWER-SECRET');
  });

  test('an Urdu plan: language, Urdu digits in the minutes, the paragraph outcome, bidi marks gone', () => {
    const ss = V9.toSlideScript(UR, { lessonId: 'grade_1_urdu_ch2_seg4' });
    expect(ss.meta).toMatchObject({ language: 'ur', grade: 1, subject: 'urdu', minutes: 40, topic: 'حروف جوڑ کر لفظ بنانا' });
    expect(ss.goal).toBe('بچے دو حروف جوڑ کر ایک چھوٹا لفظ پڑھ سکیں گے۔');
    expect(ss.youDo.problems.map((p) => p.prompt)).toEqual(['ج + ا = ___']);
    expect(JSON.stringify(ss)).not.toMatch(/[⁦-⁩]/);
    expect(LpDigest.lessonExcerpts(ss)).not.toMatch(/(^|\s)جا(\s|$)/);
    expect(ss.youDo.problems[0].answer).toBe('جا');
  });

  test('validate: a lesson plan passes; a script tag, an empty file or a bodiless page do not', () => {
    expect(V9.validate(EN.repeat(1), { lessonId: 'grade_2_math_ch6_seg3' })).toMatchObject({ ok: true, language: 'en' });
    expect(V9.validate('', {})).toMatchObject({ ok: false, reason: 'empty' });
    expect(V9.validate(EN.replace('</body>', '<script>x()</script></body>'), {})).toMatchObject({ ok: false, reason: 'has_script' });
    expect(V9.validate('<html lang="en"><body><div class="h-title">Only a title</div></body></html>', {}))
      .toMatchObject({ ok: false, reason: 'no_lesson_body' });
    expect(V9.validate('<html><body><div class="h-title">t</div>' + 'x '.repeat(600) + '</body></html>', {}))
      .toMatchObject({ ok: false, reason: 'no_language' });
  });
});
